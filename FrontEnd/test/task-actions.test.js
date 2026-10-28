import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskActions } from '../src/lib/task-actions.js';
import { taskActions as projectActions } from '../src/lib/task-permissions.js';

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

test('My Tasks dùng quyền server: Member bắt đầu rồi gửi Review, không duyệt hoặc mở lại', () => {
  const project = { status: 'active', projectRole: 'member' };
  const me = { _id: 'member-1' };
  for (const [status, next] of [['todo', 'in_progress'], ['in_progress', 'review'], ['review', null], ['done', null]]) {
    const task = { status, assignee: me._id };
    task.permissions = projectActions(task, project, me);
    const actions = taskActions(task);
    assert.equal(actions.nextStatus, next);
    assert.deepEqual(actions.statuses, task.permissions.allowedStatuses);
  }
  const other = { status: 'todo', assignee: 'other-member' };
  other.permissions = projectActions(other, project, me);
  assert.equal(taskActions(other).nextStatus, null);
});

test('Kanban và My Tasks cùng giới hạn PM duyệt Done sau Review', () => {
  const project = { status: 'active', projectRole: 'pm' };
  for (const status of ['todo', 'in_progress', 'review', 'done']) {
    const permissions = projectActions({ status }, project, { _id: 'pm-1' });
    assert.equal(permissions.allowedStatuses.includes('done'), ['review', 'done'].includes(status));
    assert.deepEqual(taskActions({ status, permissions }).statuses, permissions.allowedStatuses);
  }
});
