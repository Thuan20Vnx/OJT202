import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { AppCtx } from '../src/lib/app.jsx';
import { api, ApiError } from '../src/lib/api.js';
import { ErrorBox, Tabs, Toggle } from '../src/components/ui.jsx';
import AiSettings from '../src/pages/settings/AiSettings.jsx';
import Invites from '../src/pages/settings/Invites.jsx';
import Profile from '../src/pages/Profile.jsx';

beforeEach(() => { globalThis.window = new EventTarget(); });
const label = (node) => node.children.map((c) => typeof c === 'string' ? c : label(c)).join('');
const button = (tree, text) => tree.root.findAllByType('button').find((n) => label(n).includes(text));
const settings = { enabled: true, dailyLimit: 100, timeoutSec: 30, features: { planner: true } };
const aiData = () => ({ settings: { ...settings }, today: { used: 0, tokens: 0, avgLatencyMs: 0, errors: 0, total: 0 }, provider: { type: 'local' } });
async function mount(t, Component) {
  let tree;
  const value = { ws: { workspace: { _id: 'ws' } }, role: 'owner', projects: [], me: { _id: 'me', name: 'Người dùng', email: 'me@example.test', timezone: 'Asia/Ho_Chi_Minh', language: 'vi' }, setMe() {}, logout() {} };
  await act(async () => { tree = create(React.createElement(MemoryRouter, null, React.createElement(AppCtx.Provider, { value }, React.createElement(Component)))); });
  t.after(() => act(() => tree.unmount()));
  return tree;
}

for (const [Component, name, good] of [[AiSettings, 'Cài đặt AI', aiData], [Invites, 'Lời mời', () => ({ invites: [] })]]) {
  test(`${name}: tải lần đầu thất bại có lỗi và Thử lại, không crash`, async (t) => {
    let failing = true;
    t.mock.method(api, 'get', async (url) => {
      if (url.includes('/calls')) return { items: [], total: 0 };
      if (failing) throw new ApiError(503, 'Máy chủ tạm lỗi');
      return good();
    });
    const tree = await mount(t, Component);
    assert.match(label(tree.root), /Máy chủ tạm lỗi/);
    failing = false;
    await act(async () => tree.root.findByType(ErrorBox).props.onRetry());
    assert.doesNotMatch(label(tree.root), /Máy chủ tạm lỗi/);
  });
}

test('Cài đặt AI: bật tính năng và resync không xóa hạn mức/timeout đang nhập', async (t) => {
  t.mock.method(api, 'get', async (url) => url.includes('/calls') ? { items: [], total: 0 } : aiData());
  t.mock.method(api, 'patch', async (_url, body) => ({ settings: { ...settings, ...body } }));
  const tree = await mount(t, AiSettings);
  const numbers = () => tree.root.findAllByType('input').filter((n) => n.props.type === 'number');
  await act(async () => numbers()[0].props.onChange({ target: { value: '245' } }));
  await act(async () => numbers()[1].props.onChange({ target: { value: '45' } }));
  await act(async () => tree.root.findAllByType(Toggle)[0].props.onChange(false));
  await act(async () => window.dispatchEvent(new Event('tf:resync')));
  assert.equal(String(numbers()[0].props.value), '245');
  assert.equal(String(numbers()[1].props.value), '45');
});

test('Cài đặt AI: hạn mức trống không được lưu thành 0', async (t) => {
  t.mock.method(api, 'get', async (url) => url.includes('/calls') ? { items: [], total: 0 } : aiData());
  const patch = t.mock.method(api, 'patch', async () => ({ settings }));
  const tree = await mount(t, AiSettings);
  await act(async () => tree.root.findAllByType('input').find((n) => n.props.type === 'number').props.onChange({ target: { value: '' } }));
  await act(async () => button(tree, 'Lưu thay đổi').props.onClick());
  assert.equal(patch.mock.callCount(), 0);
  assert.match(label(tree.root), /hạn mức/i);
});

test('Cài đặt AI: lưu lỗi giữ dữ liệu, thử lại cho phép hạn mức 0 có chủ ý', async (t) => {
  t.mock.method(api, 'get', async (url) => url.includes('/calls') ? { items: [], total: 0 } : aiData());
  let failing = true;
  const patch = t.mock.method(api, 'patch', async (_url, body) => {
    if (failing) throw new ApiError(503, 'Chưa lưu được hạn mức');
    return { settings: { ...settings, ...body } };
  });
  const tree = await mount(t, AiSettings);
  const number = () => tree.root.findAllByType('input').find((n) => n.props.type === 'number');
  await act(async () => number().props.onChange({ target: { value: '0' } }));
  await act(async () => button(tree, 'Lưu thay đổi').props.onClick());
  assert.equal(String(number().props.value), '0');
  assert.match(label(tree.root), /Chưa lưu được hạn mức/);
  failing = false;
  await act(async () => button(tree, 'Lưu thay đổi').props.onClick());
  assert.equal(patch.mock.calls.at(-1).arguments[1].dailyLimit, 0);
  assert.equal(String(number().props.value), '0');
  assert.doesNotMatch(label(tree.root), /Chưa lưu được hạn mức/);
});

test('Cài đặt AI: lỗi nhật ký có Thử lại và lỗi xuất CSV được báo', async (t) => {
  let fail = true;
  t.mock.method(api, 'get', async (url) => {
    if (!url.includes('/calls')) return aiData();
    if (fail) throw new ApiError(503, 'Không tải được nhật ký AI');
    return { items: [], total: 0 };
  });
  t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 503 }));
  const tree = await mount(t, AiSettings);
  assert.match(label(tree.root), /Không tải được nhật ký AI/);
  fail = false;
  await act(async () => tree.root.findAllByType(ErrorBox).find((n) => n.props.onRetry).props.onRetry());
  assert.doesNotMatch(label(tree.root), /Không tải được nhật ký AI/);
  await act(async () => button(tree, 'Xuất CSV').props.onClick());
  assert.match(label(tree.root), /Không tải được tệp/);
  assert.equal(button(tree, 'Xuất CSV').props.disabled, false);
});

test('Lời mời: gửi lại và hủy lỗi được xử lý, giữ mục để thử lại', async (t) => {
  t.mock.method(api, 'get', async () => ({ invites: [{ _id: 'i', email: 'invite@example.test', role: 'member', expiresAt: new Date(Date.now() + 3600000).toISOString() }] }));
  t.mock.method(api, 'post', async () => { throw new ApiError(503, 'Gửi lại thất bại'); });
  t.mock.method(api, 'del', async () => { throw new ApiError(503, 'Hủy thất bại'); });
  const tree = await mount(t, Invites);
  await act(async () => button(tree, 'Gửi lại').props.onClick());
  assert.match(label(tree.root), /Gửi lại thất bại/);
  await act(async () => button(tree, 'Hủy lời mời').props.onClick());
  assert.match(label(tree.root), /Hủy thất bại/);
  assert.match(label(tree.root), /invite@example.test/);
});

test('Hồ sơ: lỗi đổi mật khẩu không có fields vẫn được hiển thị', async (t) => {
  t.mock.method(api, 'get', async () => ({ sessions: [] }));
  t.mock.method(api, 'post', async () => { throw new ApiError(503, 'Chưa đổi được mật khẩu'); });
  const tree = await mount(t, Profile);
  const inputs = () => tree.root.findAllByType('input').filter((n) => n.props.type === 'password');
  for (let i = 0; i < 3; i++) await act(async () => inputs()[i].props.onChange({ target: { value: i ? 'NewPassword123' : 'CurrentPassword123' } }));
  await act(async () => button(tree, 'Cập nhật mật khẩu').props.onClick());
  assert.match(label(tree.root), /Chưa đổi được mật khẩu/);
});

test('Hồ sơ: lỗi tải phiên có Thử lại, lỗi thu hồi phiên không thoát khỏi handler', async (t) => {
  let fail = true;
  t.mock.method(api, 'get', async () => {
    if (fail) throw new ApiError(503, 'Không tải được phiên');
    return { sessions: [{ _id: 's', current: false, userAgent: 'Firefox', lastUsedAt: new Date().toISOString() }] };
  });
  t.mock.method(api, 'del', async () => { throw new ApiError(503, 'Chưa thu hồi được phiên'); });
  const tree = await mount(t, Profile);
  await act(async () => tree.root.findByType(Tabs).props.onChange('security'));
  assert.match(label(tree.root), /Không tải được phiên/);
  fail = false;
  await act(async () => tree.root.findAllByType(ErrorBox).find((n) => n.props.onRetry).props.onRetry());
  await act(async () => tree.root.findAllByType('button').find((n) => label(n).trim() === 'Đăng xuất').props.onClick());
  assert.match(label(tree.root), /Chưa thu hồi được phiên/);
});
