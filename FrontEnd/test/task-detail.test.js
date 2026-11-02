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

async function checklistFixture(t, details = {}) {
  globalThis.window = new EventTarget();
  t.mock.method(api, 'get', async (url) => {
    if (url.endsWith('/comments')) return { comments: [] };
    if (url.startsWith('/tasks/')) return { ...response(1), ...details, task: { ...task(1), ...details.task, _id: url.split('/').at(-1) } };
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

const textOf = (node) => node.children.map((c) => typeof c === 'string' ? c : textOf(c)).join('');
const namedButton = (tree, name) => tree.root.findAllByType('button').find((n) => textOf(n) === name);

test('Sprint2 followup: lỗi tải/gỡ phụ thuộc được xử lý và có thể thử lại', async (t) => {
  const { tree } = await checklistFixture(t, { task: { blockedBy: [{ _id: 'dep', key: 'D-1', title: 'Blocker', status: 'todo' }] } });
  t.mock.method(api, 'get', async () => { throw new Error('NETWORK_DEPENDENCY_ERROR'); });
  let loadError, removeError;
  await act(async () => { try { await namedButton(tree, '+ Thêm phụ thuộc').props.onClick(); } catch (e) { loadError = e; } });
  t.mock.method(api, 'del', async () => { throw new Error('REMOVE_DEPENDENCY_ERROR'); });
  await act(async () => { try { await tree.root.findAllByType('button').find((n) => n.props.title === 'Gỡ phụ thuộc').props.onClick(); } catch (e) { removeError = e; } });
  assert.equal(loadError, undefined, 'load errors must not reject from event handler');
  assert.equal(removeError, undefined, 'remove errors must not reject from event handler');
  assert.ok(JSON.stringify(tree.toJSON()).includes('NETWORK_DEPENDENCY_ERROR'));
  t.mock.method(api, 'get', async () => ({ tasks: [{ _id: 'retry', key: 'R-1', title: 'RETRY_DEPENDENCY', status: 'todo' }] }));
  await act(async () => namedButton(tree, 'Thử lại').props.onClick());
  assert.ok(JSON.stringify(tree.toJSON()).includes('RETRY_DEPENDENCY'));
});

test('Sprint2 followup: danh sách phụ thuộc đến muộn không lọt sang task mới', async (t) => {
  const { tree, element } = await checklistFixture(t);
  let finish, loading;
  const pending = new Promise((r) => { finish = r; });
  t.mock.method(api, 'get', async (url) => {
    if (url === '/projects/project/tasks') return pending;
    if (url.endsWith('/comments')) return { comments: [] };
    return { ...response(1), task: { ...task(1), _id: 'other' } };
  });
  await act(async () => { loading = namedButton(tree, '+ Thêm phụ thuộc').props.onClick(); });
  await act(async () => tree.update(element('other')));
  await act(async () => { finish({ tasks: [{ _id: 'leak', key: 'SECRET', title: 'OLD_TASK_OPTIONS' }] }); await loading; });
  assert.ok(!JSON.stringify(tree.toJSON()).includes('OLD_TASK_OPTIONS'));
});

test('Sprint2 followup: gỡ phụ thuộc cũ không thay task đang mở', async (t) => {
  const { tree, element } = await checklistFixture(t, { task: { blockedBy: [{ _id: 'dep', key: 'D-1', status: 'todo' }] } });
  let finish, removing;
  t.mock.method(api, 'del', () => new Promise((r) => { finish = r; }));
  await act(async () => { removing = tree.root.findAllByType('button').find((n) => n.props.title === 'Gỡ phụ thuộc').props.onClick(); });
  await act(async () => tree.update(element('other')));
  await act(async () => { finish({ task: task(2) }); await removing; });
  assert.equal(tree.root.findAllByType('textarea')[0]?.props.value, 'Original', 'new task must remain rendered');
});

test('Sprint2 followup: dependency không nâng version của draft chưa lưu để ghi đè nội dung mới', async (t) => {
  const { tree } = await checklistFixture(t, { task: { blockedBy: [{ _id: 'dep', key: 'D-1', status: 'todo' }] } });
  await act(() => tree.root.findAllByType('textarea')[0].props.onChange({ target: { value: 'My draft' } }));
  t.mock.method(api, 'del', async () => ({ task: { ...task(3), title: 'Edited by someone else' } }));
  await act(async () => tree.root.findAllByType('button').find((n) => n.props.title === 'Gỡ phụ thuộc').props.onClick());
  let body;
  t.mock.method(api, 'patch', async (_url, patch) => { body = patch; throw Object.assign(new Error('Conflict'), { status: 409 }); });
  await act(async () => namedButton(tree, 'Lưu thay đổi').props.onClick());
  assert.equal(body.version, 1, 'keep original draft version so the server detects external edits');
  assert.equal(tree.root.findAllByType('textarea')[0].props.value, 'My draft');
});

test('Sprint2 followup: đổi trạng thái subtask khóa click lặp và không reload task cũ', async (t) => {
  const { tree, element } = await checklistFixture(t, { subtasks: [{ _id: 'child', title: 'Child', status: 'review', version: 1 }] });
  let finish, first, second;
  const pending = new Promise((r) => { finish = r; });
  const write = t.mock.method(api, 'patch', () => pending);
  const get = api.get;
  const reads = t.mock.method(api, 'get', (...args) => get(...args));
  const checkbox = tree.root.findAllByType('input').find((n) => n.props.type === 'checkbox');
  await act(async () => { first = checkbox.props.onChange(); second = checkbox.props.onChange(); });
  await act(async () => tree.update(element('other')));
  const before = reads.mock.callCount();
  await act(async () => { finish({ task: { _id: 'child', status: 'done' } }); await Promise.all([first, second]); });
  assert.equal(write.mock.callCount(), 1);
  assert.equal(reads.mock.callCount(), before, 'old mutation must not trigger another load');
});

test('Sprint2 followup: form sạch nhận nội dung mới sau thay đổi phụ thuộc', async (t) => {
  const { tree } = await checklistFixture(t, { task: { blockedBy: [{ _id: 'dep', key: 'D-1', status: 'todo' }] } });
  t.mock.method(api, 'del', async () => ({ task: { ...task(3), title: 'Server title' } }));
  t.mock.method(api, 'get', async (url) => url.endsWith('/comments') ? { comments: [] } : { ...response(3), task: { ...task(3), title: 'Server title' } });
  await act(async () => tree.root.findAllByType('button').find((n) => n.props.title === 'Gỡ phụ thuộc').props.onClick());
  assert.equal(tree.root.findAllByType('textarea')[0].props.value, 'Server title');
});

test('Sprint2 followup: thu hồi quyền vô hiệu hóa phản hồi ghi đang chờ', async (t) => {
  const { tree } = await checklistFixture(t, { task: { blockedBy: [{ _id: 'dep', key: 'D-1', status: 'todo' }] } });
  let finish, removing;
  t.mock.method(api, 'del', () => new Promise((r) => { finish = r; }));
  await act(async () => { removing = tree.root.findAllByType('button').find((n) => n.props.title === 'Gỡ phụ thuộc').props.onClick(); });
  t.mock.method(api, 'get', async (url) => url.endsWith('/comments') ? { comments: [] } : { ...response(2), access: { canEdit: false, canWrite: false, canManage: false, canUpdateProgress: false } });
  await act(async () => getSocket().emitEvent(['access:changed', {}]));
  await act(async () => { finish({ task: { ...task(3), title: 'OLD_AUTHORIZED_RESPONSE' } }); await removing; });
  assert.ok(!JSON.stringify(tree.toJSON()).includes('OLD_AUTHORIZED_RESPONSE'));
  assert.equal(namedButton(tree, '+ Thêm phụ thuộc'), undefined);
});

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
