import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { AppCtx } from '../src/lib/app.jsx';
import { api, ApiError } from '../src/lib/api.js';
import { ErrorBox, Tabs, MenuItem, Select } from '../src/components/ui.jsx';
import Admin from '../src/pages/Admin.jsx';
import Meeting from '../src/pages/ai/Meeting.jsx';

beforeEach(() => { globalThis.window = new EventTarget(); globalThis.document = new EventTarget(); });
const label = (n) => typeof n === 'string' ? n : (n.children || []).map(label).join('');
const button = (tree, name) => tree.root.findAllByType('button').filter((b) => label(b).includes(name)).at(-1);
const user = { _id: 'u', name: 'User cần kiểm tra', email: 'user@example.test', createdAt: '2026-11-05', workspaces: 1 };
const response = (url) => url.includes('/users') ? { users: [user], total: 1, page: 1, limit: 20, reasons: ['Khác'] }
  : url.endsWith('/workspaces') ? { workspaces: [] } : url.endsWith('/audit') ? { items: [] } : { users: 1, active: 1, locked: 0, workspaces: 1 };

test('U027: sửa nguồn trong lúc trích phải trích lại hoặc khôi phục trước khi duyệt', async (t) => {
  t.mock.method(api, 'get', async (url) => url.endsWith('/p') ? { project: { members: [] }, access: { canManage: true } } : { drafts: [] });
  let finish;
  t.mock.method(api, 'post', (_, input) => new Promise((resolve) => {
    finish = () => resolve({ draft: { _id: 'd', status: 'draft', version: 1, input, items: [{ key: 'a', selected: true, title: 'Viết API', excerpt: input.text }] } });
  }));
  let tree;
  await act(async () => { tree = create(React.createElement(Meeting, { project: { _id: 'p' }, onUsage: () => {} })); });
  t.after(() => act(() => tree.unmount()));
  const changeText = (value) => act(async () => tree.root.findByType('textarea').props.onChange({ target: { value } }));
  const original = 'Lộc: mình sẽ viết API';
  await changeText(original);
  let pending;
  await act(async () => { pending = button(tree, 'Trích action items').props.onClick(); });
  await changeText('Như: gửi báo cáo');
  await act(async () => { finish(); await pending; });
  assert.match(label(tree.root), /Biên bản đã thay đổi/);
  assert.equal(button(tree, 'Duyệt'), undefined);
  await changeText(original);
  assert.doesNotMatch(label(tree.root), /Biên bản đã thay đổi/);
  assert.ok(button(tree, 'Duyệt'));
});
async function mount(t, isSystemAdmin = true) {
  let tree;
  await act(async () => { tree = create(React.createElement(MemoryRouter, {}, React.createElement(AppCtx.Provider,
    { value: { me: { _id: 'admin', isSystemAdmin } } }, React.createElement(Admin)))); });
  t.after(() => act(() => tree.unmount()));
  return tree;
}
for (const tab of ['users', 'workspaces', 'audit']) test(`Lộc Sprint 3 U028: ${tab} lỗi tải có thử lại, không crash/spinner vô hạn`, async (t) => {
  let failed = true;
  t.mock.method(api, 'get', async (url) => {
    if (failed && url.includes(`/admin/${tab}`)) throw new ApiError(503, 'Lỗi kiểm thử tải dữ liệu');
    return response(url);
  });
  const tree = await mount(t);
  if (tab !== 'users') await act(async () => tree.root.findByType(Tabs).props.onChange(tab));
  assert.match(label(tree.root), /Lỗi kiểm thử tải dữ liệu/);
  failed = false;
  await act(async () => tree.root.findAllByType(ErrorBox).find((e) => e.props.error).props.onRetry());
  assert.doesNotMatch(label(tree.root), /Lỗi kiểm thử tải dữ liệu/);
});

test('Lộc Sprint 3 U028: người thường không gọi API quản trị', async (t) => {
  const get = t.mock.method(api, 'get', async (url) => response(url));
  await mount(t, false);
  assert.equal(get.mock.callCount(), 0);
});

test('Lộc Sprint 3 U028: khóa gửi một lần; lỗi giữ lý do để thử lại', async (t) => {
  t.mock.method(api, 'get', async (url) => response(url));
  let reject;
  const post = t.mock.method(api, 'post', () => new Promise((_, no) => { reject = no; }));
  const tree = await mount(t);
  await act(async () => tree.root.findByProps({ 'aria-label': user.name }).parent.props.onClick());
  await act(async () => tree.root.findAllByType(MenuItem).find((m) => m.props.icon === 'lock').props.onClick());
  await act(async () => tree.root.findAllByType(Select).at(-1).props.onChange({ target: { value: 'Khác' } }));
  let pending;
  const submit = button(tree, 'Khóa tài khoản').props.onClick;
  await act(async () => { pending = submit(); void submit(); });
  assert.equal(post.mock.callCount(), 1);
  assert.equal(button(tree, 'Hủy').props.disabled, true);
  await act(async () => { reject(new ApiError(503, 'Không lưu được')); await pending; });
  assert.equal(tree.root.findAllByType(Select).at(-1).props.value, 'Khác');
  assert.equal(button(tree, 'Khóa tài khoản').props.disabled, false);
});
