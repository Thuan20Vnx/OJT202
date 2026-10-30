import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { api, ApiError } from '../src/lib/api.js';
import { AppCtx } from '../src/lib/app.jsx';
import { closeSocket, getSocket } from '../src/lib/socket.js';
import { Toggle } from '../src/components/ui.jsx';
import CapacityEditor from '../src/components/CapacityEditor.jsx';
import Notifications from '../src/pages/Notifications.jsx';
import Activity from '../src/pages/settings/Activity.jsx';
import Board from '../src/pages/Board.jsx';

beforeEach(() => { globalThis.window = new EventTarget(); });
const text = (node) => node.children.map((c) => typeof c === 'string' ? c : text(c)).join('');
const button = (tree, label) => tree.root.findAllByType('button').find((n) => text(n).includes(label));
async function mount(t, element, overrides = {}) {
  let tree;
  const value = { wsId: 'ws', ws: { workspace: { _id: 'ws' } }, projects: [], me: { _id: 'u' }, setProjectId() {}, refreshUnread() {}, ...overrides };
  await act(async () => { tree = create(React.createElement(MemoryRouter, null, React.createElement(AppCtx.Provider, { value }, element))); });
  t.after(async () => { await act(() => tree.unmount()); closeSocket(); });
  return tree;
}

test('U016-T2: khóa lưu preference và read-all ngay cả khi click lặp trong cùng frame', async (t) => {
  t.mock.method(api, 'get', async (url) => url.includes('notification-prefs')
    ? { prefs: { assigned: true, due_soon: true, mentioned: true, status: true, email: false } }
    : { items: [], unread: 2 });
  let resolvePref, resolveRead;
  const patch = t.mock.method(api, 'patch', () => new Promise((resolve) => { resolvePref = resolve; }));
  const post = t.mock.method(api, 'post', () => new Promise((resolve) => { resolveRead = resolve; }));
  const tree = await mount(t, React.createElement(Notifications));
  const toggle = tree.root.findAllByType(Toggle)[0];
  await act(() => { toggle.props.onChange(false); toggle.props.onChange(false); });
  assert.equal(patch.mock.callCount(), 1);
  assert.equal(tree.root.findAllByType(Toggle)[0].props.disabled, true);
  await act(async () => resolvePref({ prefs: { assigned: false } }));
  const read = button(tree, 'Đánh dấu tất cả đã đọc');
  await act(() => { read.props.onClick(); read.props.onClick(); });
  assert.equal(post.mock.callCount(), 1);
  assert.equal(button(tree, 'Đánh dấu tất cả đã đọc').props.disabled, true);
  await act(async () => resolveRead({ ok: true }));
});

test('U016-T2: trang tải thêm cũ không ghép vào tab mới', async (t) => {
  let resolveMore;
  const item = (id) => ({ _id: id, text: id, type: 'assigned', readAt: null, createdAt: new Date().toISOString() });
  t.mock.method(api, 'get', async (url) => {
    if (url.includes('notification-prefs')) return { prefs: {} };
    if (url.includes('cursor=')) return new Promise((resolve) => { resolveMore = resolve; });
    return { items: [item(url.includes('tab=assigned') ? 'Assigned-only' : 'All-only')], unread: 2, nextCursor: url.includes('tab=assigned') ? null : 'cursor' };
  });
  const tree = await mount(t, React.createElement(Notifications));
  await act(() => { button(tree, 'Tải thêm thông báo').props.onClick(); });
  await act(async () => button(tree, 'Được giao').props.onClick());
  await act(async () => resolveMore({ items: [item('Stale-page')], unread: 2, nextCursor: null }));
  assert.match(text(tree.root), /Assigned-only/);
  assert.doesNotMatch(text(tree.root), /All-only|Stale-page/);
});

test('U020-T2: CSV lỗi giữ modal và bộ lọc, export không gửi hai request', async (t) => {
  t.mock.method(api, 'get', async (url) => url.includes('/members') ? { members: [] } : { items: [], actions: [], total: 0 });
  let resolve;
  const fetchMock = t.mock.method(globalThis, 'fetch', () => new Promise((done) => { resolve = done; }));
  const tree = await mount(t, React.createElement(Activity));
  await act(() => button(tree, 'Xuất CSV').props.onClick());
  const exportButton = tree.root.findAllByType('button').filter((b) => text(b).includes('Xuất CSV')).at(-1);
  await act(() => { exportButton.props.onClick(); exportButton.props.onClick(); });
  assert.equal(fetchMock.mock.callCount(), 1);
  await act(async () => resolve(new Response(JSON.stringify({ error: 'Thu hẹp khoảng ngày để xuất đủ' }), { status: 400, headers: { 'content-type': 'application/json' } })));
  assert.match(text(tree.root), /Thu hẹp khoảng ngày để xuất đủ/);
  assert.equal(tree.root.findAllByProps({ type: 'date' }).length, 4);
});

test('U019 review: 409 giữ giờ đang nhập, tải lại rõ ràng rồi lưu version mới', async (t) => {
  const patch = t.mock.method(api, 'patch', async () => { throw new ApiError(409, 'Giờ đã thay đổi'); });
  t.mock.method(api, 'get', async () => ({ capacity: { hours: 8, version: 2 } }));
  const tree = await mount(t, React.createElement(CapacityEditor, { workspaceId: 'ws', member: { available: 20, capacityVersion: 1, weekStart: '2026-10-26', user: { _id: 'u', name: 'Như' } }, onSaved() {} }));
  await act(() => button(tree, 'Chỉnh giờ khả dụng').props.onClick());
  await act(() => tree.root.findByType('input').props.onChange({ target: { value: '5' } }));
  await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(tree.root.findByType('input').props.value, '5');
  assert.equal(button(tree, 'Lưu').props.disabled, true);
  await act(async () => button(tree, 'Tải giá trị mới').props.onClick());
  assert.equal(tree.root.findByType('input').props.value, '8');
  await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(patch.mock.calls[1].arguments[1], { hours: 8, version: 2 });
});

test('U018-T1: blocker hoàn thành làm Kanban tải lại cờ Blocked từ DB', async (t) => {
  let blocked = true;
  t.mock.method(api, 'get', async (url) => url.endsWith('/tasks')
    ? { tasks: [{ _id: 't', project: 'p', title: 'Dependent', key: 'TF-2', status: 'todo', priority: 'medium', labels: [], isBlocked: blocked, blockedBy: [{ _id: 'b', key: 'TF-1', status: blocked ? 'todo' : 'done' }] }] }
    : { project: { _id: 'p', members: [] }, access: { canManage: true } });
  const tree = await mount(t, React.createElement(Board), { project: { _id: 'p', name: 'P', status: 'active', projectRole: 'pm' }, role: 'owner', canManageProject: true, canWriteProject: true });
  assert.match(text(tree.root), /Đang bị chặn/);
  blocked = false;
  await act(async () => getSocket().emitEvent(['dependencies:changed', { taskId: 'b' }]));
  assert.doesNotMatch(text(tree.root), /Đang bị chặn/);
});
