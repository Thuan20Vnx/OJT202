import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../src/lib/api.js';
import { AppCtx, useLoad } from '../src/lib/app.jsx';
import { invalidateProject, useProjectInfo } from '../src/lib/hooks.js';
import Planner from '../src/pages/ai/Planner.jsx';
import { History } from '../src/pages/ai/Planner.jsx';
import Ai from '../src/pages/Ai.jsx';
import Qa from '../src/pages/ai/Qa.jsx';
import Report from '../src/pages/ai/Report.jsx';
import DraftItems from '../src/pages/ai/DraftItems.jsx';
import { closeSocket } from '../src/lib/socket.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
beforeEach(() => { globalThis.window = new EventTarget(); });
afterEach(() => closeSocket());
const mount = async (t, element) => {
  let tree;
  await act(async () => { tree = create(element); });
  t.after(() => act(() => tree.unmount()));
  return tree;
};

test('useLoad không giữ dữ liệu dự án trước khi dự án mới tải lỗi', async (t) => {
  const pending = deferred();
  let state;
  function Probe({ id }) { state = useLoad(() => id === 'a' ? Promise.resolve('A') : pending.promise, [id]); return null; }
  const tree = await mount(t, React.createElement(Probe, { id: 'a' }));
  assert.equal(state.data, 'A');
  await act(async () => tree.update(React.createElement(Probe, { id: 'b' })));
  assert.equal(state.data, null);
  await act(async () => pending.reject(new Error('Không tải được B')));
  assert.equal(state.data, null);
  assert.equal(state.error.message, 'Không tải được B');
});

test('reload cũ không được thay thế kết quả của phạm vi mới', async (t) => {
  let state;
  function Probe({ id }) { state = useLoad(() => Promise.resolve(id), [id]); return null; }
  const tree = await mount(t, React.createElement(Probe, { id: 'a' }));
  const oldReload = state.reload;
  const oldSetData = state.setData;
  await act(async () => tree.update(React.createElement(Probe, { id: 'b' })));
  await act(async () => oldReload());
  await act(async () => oldSetData('Nội dung cũ'));
  assert.equal(state.data, 'b');
});

test('quyền bị vô hiệu hóa chỉ tải lại đúng dự án và khóa ghi trong lúc chờ', async (t) => {
  let info;
  const pending = deferred();
  const get = t.mock.method(api, 'get', async () => ({ access: { canManage: true } }));
  function Probe() { info = useProjectInfo('current'); return null; }
  await mount(t, React.createElement(Probe));
  await act(async () => invalidateProject('other'));
  assert.equal(get.mock.callCount(), 1);
  get.mock.mockImplementation(() => pending.promise);
  await act(async () => invalidateProject('current'));
  assert.equal(info, null);
  await act(async () => pending.resolve({ access: { canManage: false } }));
  assert.equal(info.access.canManage, false);
});

test('quyền dự án không còn lấy từ cache cũ sau khi component đã đóng và resync', async (t) => {
  let state, allowed = true;
  t.mock.method(api, 'get', async () => ({ access: { canManage: allowed } }));
  function Probe() { state = useProjectInfo('cache-regression'); return null; }
  const first = await mount(t, React.createElement(Probe));
  assert.equal(state.access.canManage, true);
  await act(async () => first.unmount());
  allowed = false;
  window.dispatchEvent(new Event('tf:resync'));
  await mount(t, React.createElement(Probe));
  assert.equal(state.access.canManage, false);
});

test('chọn lịch sử sau cùng thắng phản hồi cũ đến muộn', async (t) => {
  const a = deferred(), b = deferred();
  t.mock.method(api, 'get', async (url) => {
    if (url === '/ai/drafts/a') return a.promise;
    if (url === '/ai/drafts/b') return b.promise;
    if (url.includes('/ai/drafts?')) return { drafts: [] };
    return { project: { members: [] }, access: { canManage: true } };
  });
  const tree = await mount(t, React.createElement(MemoryRouter, null, React.createElement(Planner, { project: { _id: 'history', name: 'P' }, onUsage() {} })));
  let first, last;
  act(() => { first = tree.root.findByType(History).props.onOpen('a'); last = tree.root.findByType(History).props.onOpen('b'); });
  const draft = (id) => ({ draft: { _id: id, title: id, status: 'draft', items: [], input: { goal: id } } });
  await act(async () => { b.resolve(draft('b')); await last; });
  await act(async () => { a.resolve(draft('a')); await first; });
  assert.equal(tree.root.findByType(History).props.activeId, 'b');
});

test('mở lịch sử thất bại được báo trên giao diện, không reject khỏi handler', async (t) => {
  t.mock.method(api, 'get', async (url) => {
    if (url === '/ai/drafts/missing') throw new Error('Bản nháp không còn');
    return url.includes('/ai/drafts?') ? { drafts: [] } : { project: { members: [] }, access: {} };
  });
  const tree = await mount(t, React.createElement(MemoryRouter, null, React.createElement(Planner, { project: { _id: 'missing-history' }, onUsage() {} })));
  await act(async () => tree.root.findByType(History).props.onOpen('missing'));
  assert.match(JSON.stringify(tree.toJSON()), /Bản nháp không còn/);
});

const app = (element, project = { _id: 'p', name: 'P' }) => React.createElement(MemoryRouter, null,
  React.createElement(AppCtx.Provider, { value: { project, me: { _id: 'owner', name: 'Owner' } } }, element));
const label = (node) => node.children.map((child) => typeof child === 'string' ? child : label(child)).join('');
const button = (tree, text) => tree.root.findAllByType('button').find((node) => label(node).includes(text));
const stubReads = (t) => t.mock.method(api, 'get', async (url) => {
  if (url.endsWith('/ai/usage')) return { enabled: true, used: 0, limit: 10 };
  if (url.includes('/ai/drafts?')) return { drafts: [] };
  if (url.endsWith('/ai/reports')) return { reports: [] };
  if (url.endsWith('/ai/conversations')) return { conversations: [] };
  if (url.endsWith('/tasks')) return { tasks: [] };
  if (url.includes('/documents?')) return { counts: { doc: 0 } };
  return { project: { members: [] }, access: { canManage: true, canWrite: true } };
});

test('đổi dự án xóa kế hoạch đang mở và bỏ phản hồi tạo nháp cũ', async (t) => {
  stubReads(t);
  const pending = deferred();
  t.mock.method(api, 'post', () => pending.promise);
  const tree = await mount(t, app(React.createElement(Ai), { _id: 'a', name: 'A' }));
  await act(async () => tree.root.findByType('textarea').props.onChange({ target: { value: 'Kế hoạch dự án A' } }));
  let request;
  act(() => { request = button(tree, 'Tạo kế hoạch nháp').props.onClick(); });
  await act(async () => tree.update(app(React.createElement(Ai), { _id: 'b', name: 'B' })));
  assert.equal(tree.root.findByType('textarea').props.value, '');
  await act(async () => { pending.resolve({ draft: { _id: 'old', status: 'draft', items: [] } }); await request; });
  assert.equal(tree.root.findAllByType(DraftItems).length, 0);
});

test('báo cáo lưu lỗi giữ nguyên editor và nội dung để thử lại', async (t) => {
  stubReads(t);
  const report = { _id: 'r', user: 'owner', title: 'Báo cáo', status: 'draft', sections: [{ key: 'done', title: 'Hoàn thành', body: 'Bản gốc' }] };
  t.mock.method(api, 'post', async () => ({ report }));
  const patch = t.mock.method(api, 'patch', async () => { throw new Error('Không lưu được'); });
  const tree = await mount(t, app(React.createElement(Report, { project: { _id: 'p', name: 'P' }, onUsage() {} })));
  await act(async () => button(tree, 'Tạo báo cáo nháp').props.onClick());
  await act(async () => tree.root.findByProps({ title: 'Sửa' }).props.onClick());
  await act(async () => tree.root.findByType('textarea').props.onChange({ target: { value: 'Nội dung chưa lưu' } }));
  await act(async () => button(tree, 'Lưu sửa').props.onClick());
  assert.equal(tree.root.findByType('textarea').props.value, 'Nội dung chưa lưu');
  patch.mock.restore();
  t.mock.method(api, 'patch', async () => ({ report: { ...report, sections: [{ ...report.sections[0], body: 'Nội dung chưa lưu' }] } }));
  await act(async () => button(tree, 'Lưu sửa').props.onClick());
  assert.equal(tree.root.findAllByType('textarea').length, 0);
  assert.match(JSON.stringify(tree.toJSON()), /Nội dung chưa lưu/);
});

test('mở báo cáo khác đóng editor cũ để không lưu nhầm nội dung sang báo cáo mới', async (t) => {
  const report = (id) => ({ _id: id, user: 'owner', title: id, status: 'draft', sections: [{ key: 'done', title: 'Hoàn thành', body: id }] });
  t.mock.method(api, 'get', async (url) => url.startsWith('/ai/reports/') ? { report: report(url.split('/').at(-1)) }
    : { reports: [], project: { members: [] }, access: { canManage: true } });
  const tree = await mount(t, app(React.createElement(Report, { project: { _id: 'p', name: 'P' }, onUsage() {} })));
  await act(async () => tree.root.findByType(History).props.onOpen('a'));
  await act(async () => tree.root.findByProps({ title: 'Sửa' }).props.onClick());
  await act(async () => tree.root.findByType('textarea').props.onChange({ target: { value: 'Nội dung A' } }));
  await act(async () => tree.root.findByType(History).props.onOpen('b'));
  assert.equal(tree.root.findAllByType('textarea').length, 0);
  assert.equal(tree.root.findByType(History).props.activeId, 'b');
});

test('hỏi đáp chặn Enter gửi lặp khi đang chờ và bỏ phản hồi sau Cuộc hỏi mới', async (t) => {
  stubReads(t);
  const pending = deferred();
  const post = t.mock.method(api, 'post', () => pending.promise);
  const tree = await mount(t, app(React.createElement(Qa, { project: { _id: 'p', name: 'P' }, onUsage() {} })));
  await act(async () => tree.root.findByType('textarea').props.onChange({ target: { value: 'Tiến độ hiện tại?' } }));
  let request;
  act(() => { request = button(tree, 'Gửi').props.onClick(); });
  await act(async () => tree.root.findByType('textarea').props.onChange({ target: { value: 'Câu thứ hai' } }));
  await act(async () => tree.root.findByType('textarea').props.onKeyDown({ key: 'Enter', preventDefault() {} }));
  assert.equal(post.mock.callCount(), 1);
  await act(async () => button(tree, 'Cuộc hỏi mới').props.onClick());
  await act(async () => { pending.resolve({ conversation: { _id: 'old', messages: [{ role: 'assistant', content: 'Phản hồi cũ', citations: [] }] } }); await request; });
  assert.doesNotMatch(JSON.stringify(tree.toJSON()), /Phản hồi cũ/);
  assert.equal(tree.root.findByType('textarea').props.value, '');
});

test('duyệt nháp phải chờ lưu checkbox và không duyệt khi còn sửa chưa lưu', async (t) => {
  const pending = deferred();
  t.mock.method(api, 'patch', () => pending.promise);
  const post = t.mock.method(api, 'post', async () => ({ created: [] }));
  const draft = { _id: 'd', status: 'draft', items: [{ key: 'one', title: 'Việc', selected: true, priority: 'medium' }] };
  const tree = await mount(t, React.createElement(DraftItems, { draft, setDraft() {}, members: [], canManage: true }));
  let patch;
  act(() => { patch = tree.root.findAllByType('input').find((n) => n.props.type === 'checkbox').props.onChange({ target: { checked: false } }); });
  await act(async () => button(tree, 'Duyệt & tạo').props.onClick());
  assert.equal(post.mock.callCount(), 0);
  await act(async () => { pending.resolve({ draft }); await patch; });
  await act(async () => button(tree, 'Chưa rõ người phụ trách').props.onClick());
  assert.equal(button(tree, 'Duyệt & tạo').props.disabled, true);
});
