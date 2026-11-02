// Regressions promoted from the 28/10 review probe into the standard test suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../src/lib/api.js';
import { AppCtx } from '../src/lib/app.jsx';
import { getSocket, closeSocket } from '../src/lib/socket.js';
import TaskDetailModal, { CommentBox } from '../src/components/TaskDetailModal.jsx';

const task = (version) => ({ _id: 'task', workspace: 'workspace', project: 'project', key: 'TF-1', title: 'Original', description: '', status: 'todo', priority: 'medium', version, blockedBy: [], checklist: [], labels: [], createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z' });
const response = (version) => ({ task: task(version), subtasks: [], blocking: [], files: [], activity: [], access: { canEdit: true, canWrite: true, canManage: true, canUpdateProgress: true } });

async function checklistFixture(t) {
  globalThis.window = new EventTarget();
  t.mock.method(api, 'get', async (url) => {
    if (url.endsWith('/comments')) return { comments: [] };
    if (url.startsWith('/tasks/')) return { ...response(1), task: { ...task(1), _id: url.split('/').at(-1) } };
    return { project: { name: 'P', members: [] }, access: { canWrite: true } };
  });
  const element = (id) => React.createElement(MemoryRouter, null, React.createElement(AppCtx.Provider, {
    value: { me: { _id: 'owner' }, wsId: 'workspace', setWsId() {}, setProjectId() {} },
  }, React.createElement(TaskDetailModal, { taskId: id, onClose() {} })));
  let tree;
  await act(async () => { tree = create(element('task')); });
  t.after(async () => { await act(() => tree.unmount()); closeSocket(); });
  return { tree, element, input: () => tree.root.findAllByType('input').find((n) => n.props.placeholder === '+ Thêm mục checklist') };
}

test('Sprint2 hardening: checklist khóa Enter lặp và giữ draft mới trong lúc chờ lưu', async (t) => {
  const { input } = await checklistFixture(t);
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const write = t.mock.method(api, 'patch', () => pending);
  await act(() => input().props.onChange({ target: { value: 'Mục A' } }));
  let first, second;
  await act(async () => {
    first = input().props.onKeyDown({ key: 'Enter', preventDefault() {} });
    second = input().props.onKeyDown({ key: 'Enter', preventDefault() {} });
  });
  const count = write.mock.callCount();
  await act(() => input().props.onChange({ target: { value: 'Mục B mới' } }));
  await act(async () => { finish({ task: { ...task(2), checklist: [{ _id: 'item', text: 'Mục A', done: false }] } }); await Promise.all([first, second]); });
  assert.equal(count, 1, 'one request even before React renders the busy state');
  assert.equal(input().props.value, 'Mục B mới');
});

test('Sprint2 hardening: chuyển task xóa draft phụ; phản hồi task cũ không xóa draft task mới', async (t) => {
  const { tree, element, input } = await checklistFixture(t);
  let finish;
  t.mock.method(api, 'patch', () => new Promise((resolve) => { finish = resolve; }));
  await act(() => input().props.onChange({ target: { value: 'Trùng tên' } }));
  let saving;
  await act(async () => { saving = input().props.onKeyDown({ key: 'Enter', preventDefault() {} }); });
  await act(async () => tree.update(element('other')));
  const afterSwitch = input().props.value;
  await act(() => input().props.onChange({ target: { value: 'Trùng tên' } }));
  await act(async () => { finish({ task: task(2) }); await saving; });
  assert.equal(afterSwitch, '', 'draft must not migrate to another task');
  assert.equal(input().props.value, 'Trùng tên', 'old completion must not clear a new task draft');
});

test('Sprint2 hardening: Enter khi đang gõ IME không tạo checklist', async (t) => {
  const { input } = await checklistFixture(t);
  const write = t.mock.method(api, 'patch', async () => ({ task: task(2) }));
  await act(() => input().props.onChange({ target: { value: 'Đang gõ' } }));
  await act(async () => input().props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: true }, preventDefault() {} }));
  assert.equal(write.mock.callCount(), 0);
  assert.equal(input().props.value, 'Đang gõ');
});

test('Sprint2 hardening: GET cũ không phục hồi bình luận đã ẩn hoặc làm mất bình luận realtime mới', async (t) => {
  const { tree } = await checklistFixture(t);
  const comment = (id, body) => ({ _id: id, body, author: { _id: 'member', name: 'Member' }, createdAt: '2026-11-02T00:00:00Z' });
  const old = comment('hidden', 'SECRET_HIDDEN_COMMENT');
  const keep = comment('keep', 'COMMENT_TO_KEEP');
  const added = comment('added', 'NEW_REALTIME_COMMENT');
  let finish;
  const pending = new Promise((r) => { finish = r; });
  t.mock.method(api, 'get', async (url) => url.endsWith('/comments') ? pending : response(2));
  await act(async () => getSocket().emitEvent(['task:changed', { task: task(2) }]));
  await act(async () => {
    getSocket().emitEvent(['comment:deleted', { taskId: 'task', commentId: old._id }]);
    getSocket().emitEvent(['comment:new', { taskId: 'task', comment: added }]);
  });
  await act(async () => finish({ comments: [old, keep] }));
  // A delayed POST/PATCH or socket delivery must not undo a later deletion.
  await act(async () => getSocket().emitEvent(['comment:updated', { taskId: 'task', comment: old }]));
  const displayed = JSON.stringify(tree.toJSON());
  assert.ok(!displayed.includes(old.body));
  assert.ok(displayed.includes(keep.body));
  assert.ok(displayed.includes(added.body));
});

test('Sprint2 hardening: gửi bình luận task trước không chèn vào task đang mở', async (t) => {
  const { tree, element } = await checklistFixture(t);
  let finish, sending;
  t.mock.method(api, 'post', () => new Promise((r) => { finish = r; }));
  await act(async () => { sending = tree.root.findByType(CommentBox).props.onSend('OLD_TASK_COMMENT'); });
  await act(async () => tree.update(element('other')));
  await act(async () => { finish({ comment: { _id: 'old', body: 'OLD_TASK_COMMENT', author: { _id: 'owner' } } }); await sending; });
  assert.ok(!JSON.stringify(tree.toJSON()).includes('OLD_TASK_COMMENT'));
});

test('Sprint2 hardening: tạo subtask chỉ gửi một lần và không xóa draft task mới', async (t) => {
  const { tree, element } = await checklistFixture(t);
  const input = () => tree.root.findAllByType('input').find((n) => n.props.placeholder?.startsWith('+ Thêm công việc con'));
  let finish, first, second;
  const pending = new Promise((r) => { finish = r; });
  const write = t.mock.method(api, 'post', () => pending);
  await act(() => input().props.onChange({ target: { value: 'Subtask' } }));
  await act(async () => {
    first = input().props.onKeyDown({ key: 'Enter', preventDefault() {} });
    second = input().props.onKeyDown({ key: 'Enter', preventDefault() {} });
  });
  const calls = write.mock.callCount();
  await act(async () => tree.update(element('other')));
  await act(() => input().props.onChange({ target: { value: 'Draft của task mới' } }));
  await act(async () => { finish({ task: { _id: 'sub' } }); await Promise.all([first, second]); });
  assert.equal(calls, 1, 'subtask must not be duplicated');
  assert.equal(input().props.value, 'Draft của task mới');
});

test('P2: a pending realtime reload must preserve edits started while it was loading', async (t) => {
  globalThis.window = new EventTarget();
  let resolveReload, reads = 0;
  const pending = new Promise((resolve) => { resolveReload = resolve; });
  t.mock.method(api, 'get', async (url) => {
    if (url === '/tasks/task') return ++reads === 1 ? response(1) : pending;
    if (url.endsWith('/comments')) return { comments: [] };
    return { project: { name: 'P', members: [] }, access: { canWrite: true } };
  });
  let tree;
  t.after(async () => { await act(() => tree?.unmount()); closeSocket(); });
  await act(async () => {
    tree = create(React.createElement(MemoryRouter, null, React.createElement(AppCtx.Provider, {
      value: { me: { _id: 'owner' }, wsId: 'workspace', setWsId() {}, setProjectId() {} },
    }, React.createElement(TaskDetailModal, { taskId: 'task', onClose() {} }))));
  });
  await act(async () => getSocket().emitEvent(['task:changed', { task: task(2) }]));
  assert.equal(reads, 2);
  await act(async () => tree.root.findAllByType('textarea')[0].props.onChange({ target: { value: 'My unsaved edit' } }));
  assert.equal(tree.root.findAllByType('textarea')[0].props.value, 'My unsaved edit');
  await act(async () => resolveReload(response(2)));
  assert.equal(tree.root.findAllByType('textarea')[0].props.value, 'My unsaved edit');
  let submitted;
  t.mock.method(api, 'patch', async (_url, body) => {
    submitted = body;
    throw Object.assign(new Error('Conflict'), { status: 409 });
  });
  const save = tree.root.findAllByType('button').find((b) => b.children.includes('Lưu thay đổi'));
  assert.ok(save);
  await act(async () => save.props.onClick());
  assert.equal(submitted.version, 1, 'draft retains its original server version');
  assert.equal(tree.root.findAllByType('textarea')[0].props.value, 'My unsaved edit', '409 must preserve the draft too');
});

test('out-of-order realtime responses cannot replace the newest task', async (t) => {
  globalThis.window = new EventTarget();
  let reads = 0, resolveOld, resolveNew;
  const old = new Promise((r) => { resolveOld = r; });
  const latest = new Promise((r) => { resolveNew = r; });
  t.mock.method(api, 'get', async (url) => {
    if (url === '/tasks/task') return ++reads === 1 ? response(1) : reads === 2 ? old : latest;
    if (url.endsWith('/comments')) return { comments: [] };
    return { project: { name: 'P', members: [] }, access: { canWrite: true } };
  });
  let tree;
  t.after(async () => { await act(() => tree?.unmount()); closeSocket(); });
  await act(async () => {
    tree = create(React.createElement(MemoryRouter, null, React.createElement(AppCtx.Provider, {
      value: { me: { _id: 'owner' }, wsId: 'workspace', setWsId() {}, setProjectId() {} },
    }, React.createElement(TaskDetailModal, { taskId: 'task', onClose() {} }))));
  });
  await act(async () => getSocket().emitEvent(['task:changed', { task: task(2) }]));
  await act(async () => getSocket().emitEvent(['task:changed', { task: task(3) }]));
  const newest = response(3);
  newest.task.title = 'Newest';
  await act(async () => resolveNew(newest));
  await act(async () => resolveOld(response(2)));
  assert.equal(tree.root.findAllByType('textarea')[0].props.value, 'Newest');
});

test('explicit reload discards the old draft but keeps edits started during the reload', async (t) => {
  globalThis.window = new EventTarget();
  let reads = 0, finish;
  const pending = new Promise((r) => { finish = r; });
  t.mock.method(api, 'get', async (url) => {
    if (url === '/tasks/task') return ++reads < 3 ? response(reads) : pending;
    if (url.endsWith('/comments')) return { comments: [] };
    return { project: { name: 'P', members: [] }, access: { canWrite: true } };
  });
  let tree;
  t.after(async () => { await act(() => tree?.unmount()); closeSocket(); });
  await act(async () => {
    tree = create(React.createElement(MemoryRouter, null, React.createElement(AppCtx.Provider, {
      value: { me: { _id: 'owner' }, wsId: 'workspace', setWsId() {}, setProjectId() {} },
    }, React.createElement(TaskDetailModal, { taskId: 'task', onClose() {} }))));
  });
  const edit = (value) => tree.root.findAllByType('textarea')[0].props.onChange({ target: { value } });
  const cancel = () => tree.root.findAllByType('button').find((b) => b.children.includes('Hủy'));
  await act(async () => edit('Discard me'));
  assert.ok(cancel());
  await act(async () => cancel().props.onClick());
  assert.equal(tree.root.findAllByType('textarea')[0].props.value, 'Original');
  await act(async () => edit('Old draft'));
  await act(async () => { cancel().props.onClick(); });
  await act(async () => edit('Typed during reload'));
  await act(async () => finish(response(3)));
  assert.equal(tree.root.findAllByType('textarea')[0].props.value, 'Typed during reload');
});
