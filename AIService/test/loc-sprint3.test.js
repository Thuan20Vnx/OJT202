import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localMeeting, parseDue, extractActions } from '../src/features/meeting.js';

const now = new Date('2026-11-05T03:00:00Z');
const members = [{ id: 'loc', name: 'Lộc' }, { id: 'nhu', name: 'Như' }];
// Development regression fixtures, not the hidden acceptance dataset.
const cases = [
  ['M01 explicit self', 'Lộc: mình sẽ viết API ngày 15/11/2026', members, 1, 'loc', '2026-11-15T16:59:59.999Z'],
  ['M02 no person', 'Cần ai đó kiểm thử API', members, 1, undefined, null],
  ['M03 duplicate names', 'Lộc: mình sẽ viết API', [...members, { id: 'other', name: 'Lộc' }], 1, undefined, null],
  ['M04 multiple recipients', 'Lộc và Như sẽ kiểm thử API', members, 1, undefined, null],
  ['M05 two dates', 'Lộc: viết API ngày 15/11/2026 hoặc 16/11/2026', members, 1, 'loc', null],
  ['M06 two weekdays', 'Lộc: viết API thứ hai hoặc thứ ba', members, 1, 'loc', null],
  ['M07 cancelled', 'Lộc: không cần viết API', members, 0],
  ['M08 paused', 'Lộc: tạm dừng triển khai API', members, 0],
  ['M09 invalid date', 'Lộc: viết API ngày 31/02/2027', members, 1, 'loc', null],
  ['M10 incomplete date', 'Lộc: viết API ngày 15', members, 1, 'loc', null],
  ['M11 no deadline', 'Như: cập nhật wireframe', members, 1, 'nhu', null],
  ['M12 unknown speaker', 'Khách: mình sẽ viết API', members, 1, undefined, null],
  ['M13 named recipient', 'Nhờ Như kiểm thử API', members, 1, 'nhu', null],
  ['M14 relative ambiguity', 'Lộc: viết API hôm nay hoặc ngày mai', members, 1, 'loc', null],
  ['M15 leap date', 'Lộc: viết API ngày 29/02/2028', members, 1, 'loc', '2028-02-29T16:59:59.999Z'],
  ['M16 named subject', 'Lộc: Hoàng Anh sẽ viết API', [...members, { id: 'ha', name: 'Hoàng Anh' }], 1, 'ha', null],
  ['M17 recipient', 'Lộc: gửi báo cáo cho Như', members, 1, 'loc', null],
  ['M18 recipient without speaker', 'Gửi báo cáo cho Như', members, 1, undefined, null],
  ['M19 reassigned', 'Lộc: nhờ Như gửi báo cáo cho Lộc', members, 1, 'nhu', null],
  ['M20 explicit stop', 'Lộc: không triển khai API thanh toán', members, 0],
  ['M21 self with namesake', 'Lộc: mình sẽ viết API', [...members, { id: 'minh', name: 'Minh' }], 1, 'loc', null],
  ['M22 negative acceptance criterion', 'Lộc: viết test để không gửi email trùng', members, 1, 'loc', null],
  ['M23 negative security criterion', 'Lộc: viết kiểm thử để người dùng không được tự cấp quyền admin', members, 1, 'loc', null],
  ['M24 cancelled testing', 'Lộc: sẽ không kiểm thử API nữa', members, 0],
  ['M25 next Friday', 'Lộc: gửi báo cáo thứ sáu tuần sau', members, 1, 'loc', '2026-11-13T16:59:59.999Z'],
  ['M26 incomplete alternative', 'Lộc: gửi báo cáo ngày 15/11/2026 hoặc ngày 16', members, 1, 'loc', null],
  ['M27 cancelled before purpose', 'Lộc: không viết test để không gửi email trùng', members, 0],
  ['M28 negative requirement', 'Lộc: sửa API nhằm đảm bảo không cần đăng nhập lại', members, 1, 'loc', null],
  ['M29 next weekend', 'Lộc: gửi báo cáo cuối tuần sau', members, 1, 'loc', '2026-11-15T16:59:59.999Z'],
  ['M30 unspecified offset', 'Lộc: viết API sau 2 ngày', members, 1, 'loc', null],
];
for (const [label, text, people, count, assignee, due] of cases) test(`Lộc Sprint 3 ${label}`, () => {
  const items = localMeeting(text, people, { now });
  assert.equal(items.length, count);
  if (count) {
    assert.equal(items[0].assignee, assignee);
    assert.equal(items[0].dueDate?.toISOString() ?? null, due);
  }
});

test('Lộc Sprint 3: trích đoạn ở nửa sau biên bản 30.000 ký tự không bị cắt ngầm', async () => {
  const excerpt = 'Lộc: mình sẽ viết API.';
  const text = `${'Nội dung thảo luận. '.repeat(900)}\n${excerpt}`;
  let prompt;
  const result = await extractActions({ complete: async (input) => {
    prompt = input.prompt;
    return { text: JSON.stringify([{ title: 'Viết API', excerpt, assigneeId: 'loc', dueDate: null }]) };
  } }, { text, members });
  assert.ok(prompt.includes(excerpt));
  assert.equal(result.items[0].excerpt, excerpt);
});

test('Lộc Sprint 3: provider không tự chọn một người trong hai người trùng tên', async () => {
  const text = 'Lộc: mình sẽ viết API ngày 15/11/2026 hoặc 16/11/2026';
  const result = await extractActions({ complete: async () => ({ text: JSON.stringify([{ title: 'Viết API', excerpt: text, assigneeId: 'loc', dueDate: '2026-11-15' }]) }) },
    { text, members: [...members, { id: 'other', name: 'Lộc' }] });
  assert.equal(result.items[0].assignee, undefined);
  assert.equal(result.items[0].dueDate, null);
  assert.equal(parseDue('hạn 15/11/2026 hoặc ngày mai', now), null);
});

test('Lộc Sprint 3: tên ngắn lồng trong tên dài chỉ ưu tiên tại cùng vị trí', () => {
  const people = [{ id: 'ha', name: 'Hoàng Anh' }, { id: 'a', name: 'Anh' }];
  assert.equal(localMeeting('Hoàng Anh: mình sẽ viết API', people)[0].assignee, 'ha');
  assert.equal(localMeeting('Hoàng Anh và Anh sẽ viết API', people)[0].assignee, undefined);
});

test('U027: dòng trùng nhau giữ hai vị trí UTF-16 khác nhau sau emoji và CRLF', () => {
  const excerpt = 'Như: cập nhật wireframe';
  const text = `😀\r\n  ${excerpt}  \r\n\r\n${excerpt}`;
  const items = localMeeting(text, members);
  assert.deepEqual(items.map((item) => item.sourceSpan.start), [text.indexOf(excerpt), text.lastIndexOf(excerpt)]);
  for (const { sourceSpan, excerpt: value } of items) assert.equal(text.slice(sourceSpan.start, sourceSpan.end), value);
});

test('U027: provider cắt mất phủ định hoặc dùng trích đoạn trùng vị trí', async () => {
  const excerpt = 'triển khai API';
  const llm = { complete: async () => ({ text: JSON.stringify([{ title: 'Triển khai API', excerpt }]) }) };
  await assert.rejects(extractActions(llm, { text: 'Lộc: không cần triển khai API', members }), /phủ định/);
  await assert.rejects(extractActions(llm, { text: 'Lộc: triển khai API\nNhư: triển khai API', members }), /nhiều vị trí/);
});

test('U027: trích riêng tên và ngày không được làm mất sự mơ hồ của cả dòng', async () => {
  const excerpt = 'Như sẽ viết API ngày 15/11/2026';
  const text = `Lộc và ${excerpt} hoặc 16/11/2026`;
  const llm = { complete: async () => ({ text: JSON.stringify([{ excerpt, title: 'Viết API', assigneeId: 'nhu', dueDate: '2026-11-15' }]) }) };
  const { items } = await extractActions(llm, { text, members });
  assert.equal(items[0].assignee, undefined);
  assert.equal(items[0].dueDate, null);
});

test('U027: provider preserves negative criteria but cannot revive cancelled testing', async () => {
  const valid = 'Lộc: viết kiểm thử để người dùng không được tự cấp quyền admin';
  const response = (excerpt) => ({ complete: async () => ({ text: JSON.stringify([{ title: 'Viết kiểm thử quyền', excerpt, assigneeId: 'loc' }]) }) });
  assert.equal((await extractActions(response(valid), { text: valid, members })).items[0].assignee, 'loc');
  const cancelled = 'Lộc: sẽ không kiểm thử API nữa';
  await assert.rejects(extractActions(response('kiểm thử API'), { text: cancelled, members }), /phủ định/);
});

test('U027: next week is calendar-based at Sunday/year boundaries', () => {
  assert.equal(parseDue('thứ hai tuần sau', new Date('2026-11-08T03:00:00Z')).toISOString(), '2026-11-09T16:59:59.999Z');
  assert.equal(parseDue('thứ sáu tuần sau', new Date('2026-12-31T03:00:00Z')).toISOString(), '2027-01-08T16:59:59.999Z');
});
