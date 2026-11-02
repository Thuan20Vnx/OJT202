import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { api, ApiError } from '../src/lib/api.js';
import { AppCtx } from '../src/lib/app.jsx';
import { getSocket, closeSocket } from '../src/lib/socket.js';
import Board, { TaskCard } from '../src/pages/Board.jsx';
import CreateTaskModal from '../src/components/CreateTaskModal.jsx';
import TaskDetailModal from '../src/components/TaskDetailModal.jsx';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const task = (id = 'task', version = 1) => ({ _id: id, project: 'project', workspace: 'ws', key: `TF-${id}`, title: id, description: '', status: 'todo', priority: 'medium', assignee: { _id: 'me' }, version, order: 10, blockedBy: [], checklist: [], labels: [], createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z' });
const response = (version = 1) => ({ task: task('task', version), subtasks: [], blocking: [], files: [], activity: [], access: { canEdit: true, canManage: true, canWrite: true, canUpdateProgress: true, allowedStatuses: ['todo', 'in_progress', 'review'] } });
const project = { _id: 'project', name: 'P', projectRole: 'pm', status: 'active' };
const app = (element, overrides = {}) => React.createElement(MemoryRouter, null, React.createElement(AppCtx.Provider, {
  value: { project, me: { _id: 'me', name: 'Như' }, wsId: 'ws', setProjectId() {}, setWsId() {}, canWriteProject: true, canManageProject: true, role: 'member', ...overrides },
}, element));
const label = (node) => node.children.map((c) => typeof c === 'string' ? c : label(c)).join('');
const button = (tree, text) => tree.root.findAllByType('button').find((n) => label(n).trim().endsWith(text));
beforeEach(() => { globalThis.window = new EventTarget(); });
async function mount(t, element) {
  let tree;
  await act(async () => { tree = create(element); });
  t.after(async () => { await act(() => tree.unmount()); closeSocket(); });
  return tree;
}
const stubReads = (t, tasks = [task()]) => t.mock.method(api, 'get', async (url) => {
  if (url.endsWith('/tasks')) return { tasks };
  if (url.endsWith('/comments')) return { comments: [] };
  if (url.startsWith('/tasks/')) return response();
  return { project: { ...project, members: [{ _id: 'me', name: 'Như', role: 'member' }] }, access: { canManage: true } };
});

test('U010-T2: thẻ có nút mở bằng bàn phím và select trạng thái đúng quyền', async (t) => {
  let opened = 0, selected;
  const tree = await mount(t, React.createElement(TaskCard, { task: task(), onOpen: () => opened++, statuses: ['todo', 'in_progress'], onMove: (value) => { selected = value; } }));
  const open = tree.root.findByType('button');
  assert.equal(open.props.type, 'button');
  assert.match(open.props['aria-label'], /Mở TF-task/);
  await act(() => open.props.onClick({ stopPropagation() {} }));
  assert.equal(opened, 1);
  assert.deepEqual(tree.root.findAllByType('option').map((n) => n.props.value), ['todo', 'in_progress']);
  await act(() => tree.root.findByType('select').props.onChange({ target: { value: 'in_progress' } }));
  assert.equal(selected, 'in_progress');
});

test('U010-T2: lỗi move chỉ rollback thẻ thất bại, giữ thẻ khác và khóa gửi lặp', async (t) => {
  stubReads(t, [task('a'), task('b')]);
  const pending = deferred();
  const post = t.mock.method(api, 'post', (url) => url.includes('/a/') ? pending.promise : Promise.resolve({ task: { ...task('b', 2), status: 'in_progress' } }));
  const tree = await mount(t, app(React.createElement(Board)));
  const card = (id) => tree.root.findAllByType(TaskCard).find((n) => n.props.task._id === id);
  let first;
  await act(async () => { first = card('a').props.onMove('in_progress'); });
  await act(async () => card('a').props.onMove('review'));
  assert.equal(card('a').props.busy, true);
  await act(async () => card('b').props.onMove('in_progress'));
  assert.equal(post.mock.callCount(), 2);
  await act(async () => { pending.reject(new ApiError(503, 'API lỗi')); await first; });
  assert.equal(card('a').props.task.status, 'todo');
  assert.equal(card('b').props.task.status, 'in_progress');
  assert.equal(card('b').props.task.version, 2);
});

test('U010-T3: Viewer không có kéo thả hoặc điều khiển ghi trên thẻ', async (t) => {
  stubReads(t);
  const tree = await mount(t, app(React.createElement(Board), { project: { ...project, projectRole: 'viewer' }, role: 'viewer', canWriteProject: false, canManageProject: false }));
  assert.equal(tree.root.findByType(TaskCard).props.draggable, false);
  assert.equal(tree.root.findAllByType('select').length, 0);
});

test('U009-T2: phản hồi realtime đang chờ không ghi đè draft hoặc version gốc', async (t) => {
  const pending = deferred();
  let reads = 0;
  t.mock.method(api, 'get', async (url) => {
    if (url === '/tasks/task') return ++reads === 1 ? response() : pending.promise;
    if (url.endsWith('/comments')) return { comments: [] };
    return { project: { ...project, members: [] }, access: { canManage: true } };
  });
  const patch = t.mock.method(api, 'patch', async (_url, body) => { assert.equal(body.version, 1); throw new ApiError(409, 'Xung đột'); });
  const tree = await mount(t, app(React.createElement(TaskDetailModal, { taskId: 'task', onClose() {} })));
  await act(async () => getSocket().emitEvent(['task:changed', { task: task('task', 2) }]));
  const description = () => tree.root.findAllByType('textarea').find((n) => n.props.placeholder === 'Chưa có mô tả');
  await act(async () => description().props.onChange({ target: { value: 'Nội dung chưa lưu' } }));
  await act(async () => pending.resolve(response(2)));
  assert.equal(description().props.value, 'Nội dung chưa lưu');
  await act(async () => button(tree, 'Lưu thay đổi').props.onClick());
  assert.equal(patch.mock.callCount(), 1);
  assert.equal(description().props.value, 'Nội dung chưa lưu');
  assert.match(label(tree.root), /thay đổi chưa lưu của bạn sẽ mất/);
  await act(async () => button(tree, 'Tải lại').props.onClick());
  assert.equal(description().props.value, '');
});

test('U009-T2: tạo task gửi đúng thuộc tính, chặn bấm lặp và giữ form khi API lỗi', async (t) => {
  stubReads(t);
  const pending = deferred();
  const post = t.mock.method(api, 'post', () => pending.promise);
  const tree = await mount(t, app(React.createElement(CreateTaskModal, { open: true, onClose() {} })));
  const inputs = tree.root.findAllByType('input');
  const title = inputs.find((n) => n.props.maxLength === 200);
  await act(() => title.props.onChange({ target: { value: 'Việc của Như' } }));
  await act(() => inputs.find((n) => n.props.type === 'date').props.onChange({ target: { value: '2026-10-28' } }));
  await act(() => button(tree, 'Cao').props.onClick());
  let first;
  await act(async () => { first = button(tree, 'Tạo công việc').props.onClick(); });
  await act(async () => button(tree, 'Tạo công việc').props.onClick());
  assert.equal(post.mock.callCount(), 1);
  const body = post.mock.calls[0].arguments[1];
  assert.equal(body.title, 'Việc của Như');
  assert.equal(body.priority, 'high');
  assert.equal(body.dueDate, '2026-10-28');
  await act(async () => { pending.reject(new ApiError(400, 'Người nhận sai', { fields: { assignee: 'Không thuộc dự án' } })); await first; });
  assert.equal(tree.root.findAllByType('input').find((n) => n.props.maxLength === 200).props.value, 'Việc của Như');
  assert.match(label(tree.root), /Không thuộc dự án/);
});

test('U009-T2: chưa tải được quyền thì không gửi tạo công việc', async (t) => {
  t.mock.method(api, 'get', async () => { throw new ApiError(503, 'Mất kết nối'); });
  const post = t.mock.method(api, 'post', async () => assert.fail('Không được gọi API ghi'));
  const tree = await mount(t, app(React.createElement(CreateTaskModal, { open: true, onClose() {} })));
  assert.equal(button(tree, 'Tạo công việc').props.disabled, true);
  await act(async () => button(tree, 'Tạo công việc').props.onClick());
  assert.equal(post.mock.callCount(), 0);
});
