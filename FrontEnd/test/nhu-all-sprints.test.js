import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../src/lib/api.js';
import { AppCtx } from '../src/lib/app.jsx';
import { useDebouncedValue } from '../src/lib/hooks.js';
import { CommentBox } from '../src/components/TaskDetailModal.jsx';
import CapacityEditor from '../src/components/CapacityEditor.jsx';
import MyTasks from '../src/pages/MyTasks.jsx';
import Qa from '../src/pages/ai/Qa.jsx';
import { closeSocket } from '../src/lib/socket.js';

beforeEach(() => { globalThis.window = new EventTarget(); });
const text = (node) => node.children.map((c) => typeof c === 'string' ? c : text(c)).join('');
async function mount(t, element) {
  let tree;
  await act(async () => { tree = create(element); });
  t.after(async () => { await act(() => tree.unmount()); closeSocket(); });
  return tree;
}
const wrap = (element) => React.createElement(MemoryRouter, null, React.createElement(AppCtx.Provider, { value: { wsId: 'ws', me: { _id: 'me' }, projects: [], setProjectId() {} } }, element));

test('U011: debounce chỉ lấy chuỗi cuối, hủy timer khi unmount', async (t) => {
  let value;
  function Probe({ query }) { value = useDebouncedValue(query, 20); return null; }
  const tree = await mount(t, React.createElement(Probe, { query: '' }));
  await act(() => tree.update(React.createElement(Probe, { query: 'T' })));
  await act(() => tree.update(React.createElement(Probe, { query: 'TF-12' })));
  assert.equal(value, '');
  await act(async () => new Promise((r) => setTimeout(r, 40)));
  assert.equal(value, 'TF-12');
});

test('U014: lỗi gửi giữ bình luận và không reject; Ctrl+Enter không gửi lặp', async (t) => {
  let reject, calls = 0;
  const pending = new Promise((_r, no) => { reject = no; });
  const tree = await mount(t, React.createElement(CommentBox, { members: [], initial: 'Nội dung cần giữ', onSend: () => { calls++; return pending; } }));
  const key = { key: 'Enter', ctrlKey: true, preventDefault() {} };
  await act(() => tree.root.findByType('textarea').props.onKeyDown(key));
  await act(() => tree.root.findByType('textarea').props.onKeyDown(key));
  assert.equal(calls, 1);
  await act(async () => reject(new Error('Không có mạng')));
  assert.equal(tree.root.findByType('textarea').props.value, 'Nội dung cần giữ');
  assert.equal(text(tree.root.findByProps({ role: 'alert' })), 'Không có mạng');
});

test('U014: mention hỗ trợ mũi tên, Enter và Escape', async (t) => {
  const tree = await mount(t, React.createElement(CommentBox, { members: [{ _id: 'a', name: 'An' }, { _id: 'b', name: 'Bình' }], onSend() {} }));
  await act(() => tree.root.findByType('textarea').props.onChange({ target: { value: '@', selectionStart: 1 } }));
  assert.equal(tree.root.findByType('textarea').props['aria-expanded'], true);
  await act(() => tree.root.findByType('textarea').props.onKeyDown({ key: 'Escape', preventDefault() {} }));
  assert.equal(tree.root.findByType('textarea').props['aria-expanded'], false);
});

test('U019: giờ trống không thành 0, giờ 0 được gửi đúng và lỗi giữ form', async (t) => {
  const patch = t.mock.method(api, 'patch', async () => { throw new Error('Lưu lỗi'); });
  const tree = await mount(t, React.createElement(CapacityEditor, { workspaceId: 'ws', member: { available: 20, user: { _id: 'u', name: 'Như' } }, onSaved() {} }));
  await act(() => tree.root.findByType('button').props.onClick());
  await act(() => tree.root.findByType('input').props.onChange({ target: { value: '' } }));
  await act(() => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(patch.mock.callCount(), 0);
  await act(() => tree.root.findByType('input').props.onChange({ target: { value: '0' } }));
  await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(patch.mock.calls[0].arguments, ['/workspaces/ws/members/u', { weeklyHours: 0 }]);
  assert.equal(tree.root.findByType('input').props.value, '0');
  assert.equal(text(tree.root.findByProps({ role: 'alert' })), 'Lưu lỗi');
});

test('U011/U031: API lỗi không báo danh sách rỗng hoặc crash', async (t) => {
  t.mock.method(api, 'get', async () => { throw new Error('Không tải được công việc'); });
  const tree = await mount(t, wrap(React.createElement(MyTasks)));
  assert.match(text(tree.root), /Không tải được công việc/);
  assert.doesNotMatch(text(tree.root), /Không có công việc nào khớp/);
});

test('U025: dùng API thống kê nhỏ, lỗi nguồn/lịch sử hiện rõ, không giả số 0', async (t) => {
  const get = t.mock.method(api, 'get', async () => { throw new Error('Nguồn tạm lỗi'); });
  const tree = await mount(t, wrap(React.createElement(Qa, { project: { _id: 'p', name: 'P' }, onUsage() {} })));
  assert.ok(get.mock.calls.some((c) => c.arguments[0] === '/projects/p/ai/sources'));
  assert.ok(get.mock.calls.every((c) => !c.arguments[0].endsWith('/tasks')));
  assert.match(text(tree.root), /Nguồn tạm lỗi/);
  assert.doesNotMatch(text(tree.root), /Chưa có cuộc hỏi đáp/);
});
