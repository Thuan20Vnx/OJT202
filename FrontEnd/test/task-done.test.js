// Chuyển sang Hoàn thành khi còn việc dở và gợi ý phụ thuộc không tạo vòng lặp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unfinishedText, unfinishedWork } from '../src/lib/task-done.js';
import { dependencyCandidates } from '../src/components/TaskDetailModal.jsx';

test('đếm việc con và checklist chưa xong (thẻ trên bảng và chi tiết việc)', () => {
  const card = { subtasks: { total: 3, done: 1 }, checklist: [{ done: true }, { done: false }] };
  assert.deepEqual(unfinishedWork(card), { subs: 2, checks: 1, any: true });
  const detail = unfinishedWork({ checklist: [] }, [{ status: 'done' }, { status: 'review' }]);
  assert.deepEqual(detail, { subs: 1, checks: 0, any: true });
  assert.equal(unfinishedWork({ subtasks: { total: 2, done: 2 }, checklist: [{ done: true }] }).any, false);
  assert.equal(unfinishedText({ subs: 2, checks: 1 }), '2 việc con chưa xong và 1 mục checklist chưa tick');
});

test('không gợi ý việc đang (gián tiếp) chờ việc này, việc đã liên kết hay chính nó', () => {
  // C chờ B, B chờ A. Mở A: chọn B hoặc C làm "chặn A" sẽ thành vòng lặp.
  const tasks = [
    { _id: 'A', blockedBy: [] },
    { _id: 'B', blockedBy: [{ _id: 'A' }] },
    { _id: 'C', blockedBy: ['B'] },
    { _id: 'D', blockedBy: [] },
    { _id: 'E', blockedBy: [] },
  ];
  const a = { _id: 'A', blockedBy: [{ _id: 'E' }] };
  assert.deepEqual(dependencyCandidates(tasks, a).map((t) => t._id), ['D']);
  // Mở C: A, B đã ở phía trước C nên chọn được (B đã liên kết thì bỏ), D, E chọn được.
  assert.deepEqual(dependencyCandidates(tasks, { _id: 'C', blockedBy: ['B'] }).map((t) => t._id), ['A', 'D', 'E']);
});
