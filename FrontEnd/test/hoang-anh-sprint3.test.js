import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { api, ApiError } from '../src/lib/api.js';
import { AppCtx } from '../src/lib/app.jsx';
import { closeSocket, getSocket } from '../src/lib/socket.js';
import DraftItems from '../src/pages/ai/DraftItems.jsx';
import Risks from '../src/pages/Risks.jsx';

beforeEach(() => { globalThis.window = new EventTarget(); });
afterEach(() => closeSocket());
const text = (node) => typeof node === 'string' ? node : (node.children || []).map(text).join('');
const button = (tree, label) => tree.root.findAllByType('button').find((node) => text(node).includes(label));
async function mount(t, element) {
  let tree;
  await act(async () => { tree = create(element); });
  t.after(() => act(() => tree.unmount()));
  return tree;
}
const original = { _id: 'draft', status: 'draft', version: 4, items: [{ key: 'one', title: 'Tên cũ', selected: true, priority: 'medium' }] };

test('U021: lỗi 409 giữ nội dung sửa và version gốc; chỉ tải bản mới khi người dùng chọn', async (t) => {
  const patch = t.mock.method(api, 'patch', async () => { throw new ApiError(409, 'Bản nháp đã thay đổi'); });
  const get = t.mock.method(api, 'get', async () => ({ draft: { ...original, version: 5 } }));
  function Editor() {
    const [draft, setDraft] = React.useState(original);
    return React.createElement(DraftItems, { draft, setDraft, members: [], canManage: true });
  }
  const tree = await mount(t, React.createElement(Editor));
  await act(async () => button(tree, 'Chưa rõ người phụ trách').props.onClick());
  const title = tree.root.findAllByType('input').find((node) => node.props.value === 'Tên cũ');
  await act(async () => title.props.onChange({ target: { value: 'Nội dung chưa lưu' } }));
  await act(async () => button(tree, 'Lưu sửa').props.onClick());
  assert.equal(patch.mock.calls[0].arguments[1].version, 4);
  assert.equal(title.props.value, 'Nội dung chưa lưu');
  assert.equal(get.mock.callCount(), 0);
  await act(async () => button(tree, 'Tải bản mới').props.onClick());
  assert.equal(get.mock.callCount(), 1);
  assert.equal(tree.root.findAllByType('textarea').length, 0);
});

test('U021: duyệt gửi đúng version và dùng draft/version server trả về', async (t) => {
  const saved = { ...original, status: 'approved', version: 5 };
  const post = t.mock.method(api, 'post', async () => ({ draft: saved, created: [{ _id: 'task' }] }));
  let result;
  const tree = await mount(t, React.createElement(DraftItems, { draft: original, setDraft: (fn) => { result = fn(original); }, members: [], canManage: true }));
  await act(async () => button(tree, 'Duyệt & tạo').props.onClick());
  assert.deepEqual(post.mock.calls[0].arguments, ['/ai/drafts/draft/approve', { version: 4 }]);
  assert.deepEqual(result, saved);
});

const alert = { key: 'overdue:task', type: 'overdue', severity: 'warning', sourceVersion: 'a'.repeat(64), title: 'Việc quá hạn', rule: 'Đã quá hạn', explanation: 'Giải thích theo quy tắc', tasks: [{ _id: 'task', key: 'HA-1', title: 'Việc' }] };
const risks = (item = alert) => ({ open: [item], resolved: [], rules: { overdueDays: 1, overloadPct: 100, dueSoonProgressPct: 80 }, access: { canManage: true, canWrite: true } });
const riskPage = (project = 'p') => React.createElement(MemoryRouter, {}, React.createElement(AppCtx.Provider, { value: { project: { _id: project, name: project } } }, React.createElement(Risks)));

test('U026: modal yêu cầu lý do, gửi sourceVersion và giữ lý do khi nguồn đã thay đổi', async (t) => {
  t.mock.method(api, 'get', async () => risks());
  const post = t.mock.method(api, 'post', async () => { throw new ApiError(409, 'Nguồn cảnh báo đã thay đổi'); });
  const tree = await mount(t, riskPage());
  await act(async () => button(tree, 'Đã xử lý').props.onClick());
  assert.equal(button(tree, 'Xác nhận xử lý').props.disabled, true);
  await act(async () => tree.root.findByType('textarea').props.onChange({ target: { value: 'Đã họp điều phối công việc' } }));
  await act(async () => button(tree, 'Xác nhận xử lý').props.onClick());
  assert.deepEqual(post.mock.calls[0].arguments[1], { key: alert.key, sourceVersion: alert.sourceVersion, reason: 'Đã họp điều phối công việc' });
  assert.equal(tree.root.findByType('textarea').props.value, 'Đã họp điều phối công việc');
  assert.equal(button(tree, 'Xác nhận xử lý').props.disabled, true);
  assert.match(text(tree.root), /Nguồn cảnh báo đã thay đổi/);
});

test('U026: diễn giải cũ không được hiển thị sau khi realtime trả phiên bản nguồn mới', async (t) => {
  let current = alert;
  t.mock.method(api, 'get', async () => risks(current));
  t.mock.method(api, 'post', async () => ({ explanation: 'AI cho nguồn cũ', sourceVersion: alert.sourceVersion }));
  const tree = await mount(t, riskPage());
  await act(async () => button(tree, 'Diễn giải bằng AI').props.onClick());
  assert.match(text(tree.root), /AI cho nguồn cũ/);
  current = { ...alert, sourceVersion: 'b'.repeat(64) };
  await act(async () => getSocket().emitEvent(['board:refresh', {}]));
  assert.doesNotMatch(text(tree.root), /AI cho nguồn cũ/);
  assert.ok(button(tree, 'Diễn giải bằng AI'));
});

test('U026: chuyển dự án không giữ modal xử lý của dự án trước', async (t) => {
  t.mock.method(api, 'get', async () => risks());
  const tree = await mount(t, riskPage('first'));
  await act(async () => button(tree, 'Đã xử lý').props.onClick());
  assert.equal(tree.root.findAllByProps({ role: 'dialog' }).length, 1);
  await act(async () => tree.update(riskPage('second')));
  assert.equal(tree.root.findAllByProps({ role: 'dialog' }).length, 0);
});

test('U026: phản hồi xử lý muộn của dự án cũ không đóng modal dự án mới', async (t) => {
  let release;
  t.mock.method(api, 'get', async () => risks());
  t.mock.method(api, 'post', () => new Promise((resolve) => { release = resolve; }));
  const tree = await mount(t, riskPage('first'));
  await act(async () => button(tree, 'Đã xử lý').props.onClick());
  await act(async () => tree.root.findByType('textarea').props.onChange({ target: { value: 'Lý do dự án cũ' } }));
  await act(() => { button(tree, 'Xác nhận xử lý').props.onClick(); });
  await act(async () => tree.update(riskPage('second')));
  await act(async () => button(tree, 'Đã xử lý').props.onClick());
  await act(async () => tree.root.findByType('textarea').props.onChange({ target: { value: 'Lý do dự án mới' } }));
  await act(async () => release({ ok: true }));
  assert.equal(tree.root.findByType('textarea').props.value, 'Lý do dự án mới');
  assert.equal(tree.root.findAllByProps({ role: 'dialog' }).length, 1);
});
