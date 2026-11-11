import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localMeeting, parseDue } from '../../../../AIService/src/features/meeting.js';
const now = new Date('2026-11-05T03:00:00Z');
const members = [{ id: 'loc', name: 'Lộc' }];
// Independent review probes: expected failures record defects, not acceptance evidence.
test('Review U027: negative acceptance criterion must retain the action', () => {
  const items = localMeeting('Lộc: viết kiểm thử để người dùng không được tự cấp quyền admin', members, { now });
  assert.equal(items.length, 1);
});
test('Review U027: cancelled testing action must not become a task', () => {
  const items = localMeeting('Lộc: sẽ không kiểm thử API nữa', members, { now });
  assert.equal(items.length, 0);
});
test('Review U027: Friday next week must not become this Friday', () => {
  const due = parseDue('Lộc: gửi báo cáo thứ sáu tuần sau', now);
  assert.equal(due?.toISOString(), '2026-11-13T16:59:59.999Z');
});
test('Review U027: complete date followed by incomplete alternative is ambiguous', () => {
  const due = parseDue('Lộc: gửi báo cáo ngày 15/11/2026 hoặc ngày 16', now);
  assert.equal(due, null);
});
