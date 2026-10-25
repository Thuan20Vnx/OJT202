import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskActions } from '../src/lib/task-actions.js';

test('Member gửi Review, không thể tự duyệt Done', () => {
  const access = { canWrite: true, canManage: false };
  for (const status of ['todo', 'in_progress']) assert.equal(taskActions({ status, access }).nextStatus, 'review');
  const review = taskActions({ status: 'review', access });
  assert.equal(review.nextStatus, null);
  assert.ok(!review.statuses.includes('done'));
});
test('PM chỉ được duyệt Done từ Review, có thể mở lại Done', () => {
  const access = { canWrite: true, canManage: true };
  assert.ok(!taskActions({ status: 'todo', access }).statuses.includes('done'));
  assert.equal(taskActions({ status: 'review', access }).nextStatus, 'done');
  assert.equal(taskActions({ status: 'done', access }).nextStatus, 'todo');
});
test('Viewer, dự án archived hoặc chưa tải quyền không có thao tác ghi', () => {
  for (const access of [undefined, { canWrite: false, canManage: true }, { canWrite: false, canManage: false }]) {
    const actions = taskActions({ status: 'review', access });
    assert.equal(actions.canWrite, false);
    assert.equal(actions.nextStatus, null);
  }
});
