// Review probes, run explicitly; not part of the normal *.test.js suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localMeeting, extractActions } from '../src/features/meeting.js';

test('P2: explicit cancellation must not create a meeting action item', () => {
  const items = localMeeting('Lộc: Không cần triển khai API thanh toán nữa, hủy công việc này.', [{ id: 'loc', name: 'Lộc' }]);
  assert.equal(items.length, 0, JSON.stringify(items));
});

test('P2: provider excerpts must actually occur in the meeting source', async () => {
  const llm = { complete: async () => ({ text: JSON.stringify([{ title: 'Triển khai thanh toán', excerpt: 'Lộc sẽ triển khai thanh toán ngày mai.', assigneeId: 'loc', dueDate: '2099-02-15' }]), inputTokens: 1, outputTokens: 1 }) };
  await assert.rejects(() => extractActions(llm, { text: 'Lộc: Chỉ thảo luận giao diện hôm nay.', members: [{ id: 'loc', name: 'Lộc' }] }));
});
