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
import Report from '../src/pages/ai/Report.jsx';
import { reportPeriodInput } from '../src/lib/dates.js';

beforeEach(() => { globalThis.window = new EventTarget(); globalThis.document = new EventTarget(); });
const label = (n) => typeof n === 'string' ? n : (n.children || []).map(label).join('');
const button = (tree, name) => tree.root.findAllByType('button').filter((b) => label(b).includes(name)).at(-1);
const user = { _id: 'u', name: 'User cần kiểm tra', email: 'user@example.test', createdAt: '2026-11-05', workspaces: 1 };
const response = (url) => url.includes('/users') ? { users: [user], total: 1, page: 1, limit: 20, reasons: ['Khác'] }
  : url.endsWith('/workspaces') ? { workspaces: [] } : url.endsWith('/audit') ? { items: [] } : { users: 1, active: 1, locked: 0, workspaces: 1 };

test('U022: report form submits canonical dates in the loaded project timezone', async (t) => {
  t.mock.method(api, 'get', async (url) => url.endsWith('/period-project') ? { project: { timezone: 'America/New_York' }, access: { canManage: true } } : { reports: [] });
  let sent;
  t.mock.method(api, 'post', async (_url, input) => { sent = input; throw new ApiError(503, 'Retry later'); });
  let tree;
  await act(async () => { tree = create(React.createElement(MemoryRouter, {}, React.createElement(AppCtx.Provider,
    { value: { me: { _id: 'owner' } } }, React.createElement(Report, { project: { _id: 'period-project', name: 'Period test' }, onUsage: () => {} })))); });
  t.after(() => act(() => tree.unmount()));
  for (let i = 0; i < 2; i++) await act(async () => tree.root.findAllByProps({ type: 'date' })[i].props.onChange({ target: { value: '2026-03-08' } }));
  await act(async () => button(tree, 'Tạo báo cáo nháp').props.onClick());
  assert.deepEqual(sent, { period_start: '2026-03-08T05:00:00.000Z', period_end: '2026-03-09T04:00:00.000Z', template: 'week' });
  assert.equal(tree.root.findAllByProps({ type: 'date' })[1].props.value, '2026-03-08');
  assert.match(label(tree.root), /America\/New_York/);
});

test('U022: inclusive UI dates cover the complete DST fall day', () => {
  const p = reportPeriodInput({ from: '2026-11-01', to: '2026-11-01', template: 'week' }, 'America/New_York');
  assert.equal((new Date(p.period_end) - new Date(p.period_start)) / 3600000, 25);
});

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

test('U022: báo cáo đã chia sẻ là bản chốt, ẩn sửa tiêu đề/mục và nút chia sẻ', async (t) => {
  t.mock.method(api, 'get', async (url) => url.endsWith('/shared-project') ? { project: { timezone: 'Asia/Ho_Chi_Minh' }, access: { canManage: true } } : { reports: [] });
  const draft = { _id: 'r1', user: 'owner', status: 'draft', title: 'Báo cáo tuần', sourceState: 'current', sourceTasks: [], stats: { done: 1, overdue: 0, blocked: 0, progressPct: 50 },
    sections: [{ key: 'summary', title: 'Tóm tắt', body: 'Hoàn thành 1 công việc', refs: [] }] };
  t.mock.method(api, 'post', async () => ({ report: draft }));
  const patches = [];
  t.mock.method(api, 'patch', async (_url, body) => { patches.push(body); return { report: { ...draft, status: 'shared' } }; });
  let tree;
  await act(async () => { tree = create(React.createElement(MemoryRouter, {}, React.createElement(AppCtx.Provider,
    { value: { me: { _id: 'owner' } } }, React.createElement(Report, { project: { _id: 'shared-project', name: 'Shared test' }, onUsage: () => {} })))); });
  t.after(() => act(() => tree.unmount()));
  await act(async () => button(tree, 'Tạo báo cáo nháp').props.onClick());
  const editButtons = () => tree.root.findAll((n) => n.type === 'button' && n.props.title === 'Sửa');
  const titleInput = () => tree.root.find((n) => n.type === 'input' && n.props.defaultValue === 'Báo cáo tuần');
  assert.equal(editButtons().length, 1);
  assert.equal(titleInput().props.readOnly, false);
  await act(async () => button(tree, 'Lưu & chia sẻ nội bộ').props.onClick());
  assert.deepEqual(patches, [{ share: true }]);
  assert.equal(editButtons().length, 0);
  assert.equal(titleInput().props.readOnly, true);
  assert.equal(button(tree, 'Lưu & chia sẻ nội bộ'), undefined);
  assert.match(label(tree.root), /bản chốt/);
});

test('U022: tệp xuất báo cáo giữ trạng thái, kỳ, thời điểm chốt số liệu và mã nguồn từng mục', async () => {
  const { reportText } = await import('../src/lib/report-text.js');
  const report = {
    title: 'Báo cáo tuần', status: 'draft', periodConvention: 'exclusive-end', timezone: 'Asia/Ho_Chi_Minh',
    period_start: '2026-11-01T17:00:00.000Z', period_end: '2026-11-08T17:00:00.000Z', generatedAt: '2026-11-09T02:30:00.000Z',
    sections: [
      { key: 'summary', title: 'Tóm tắt', body: 'Hoàn thành 2 công việc', refs: [{ _id: 'a', key: 'TF-1' }, { _id: 'b', key: 'TF-2' }] },
      { key: 'suggestions', title: 'Đề xuất', body: 'Ưu tiên TF-2', refs: [], aiSuggested: true },
    ],
  };
  const text = reportText(report, 'UTC');
  assert.match(text, /Trạng thái: Nháp – chưa chia sẻ/);
  assert.match(text, /Kỳ báo cáo: 02\/11\/2026 – 08\/11\/2026 \(Asia\/Ho_Chi_Minh\)/);
  assert.match(text, /Số liệu chốt lúc: .*09\/11\/2026/);
  assert.match(text, /## Tóm tắt\nHoàn thành 2 công việc\nNguồn: TF-1, TF-2/);
  assert.match(text, /## Đề xuất \(Gợi ý AI\)\nƯu tiên TF-2\n\n?$/);
  assert.match(reportText({ ...report, status: 'shared' }, 'UTC'), /Trạng thái: Đã chia sẻ nội bộ/);
});
