import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTaskDates, parseTaskDates } from '../src/services/task-dates.js';

const zone = 'Asia/Ho_Chi_Minh';
const now = new Date('2026-10-30T08:00:00Z');

test('ngày kế hoạch/thực tế: đầu ngày và cuối ngày theo profile, giữ timestamp', () => {
  const patch = { plannedStartDate: '2026-10-29', dueDate: '2026-10-30', actualStartDate: '2026-10-29T07:00:00Z', actualEndDate: '2026-10-30' };
  parseTaskDates(patch, zone);
  applyTaskDates(patch, {}, zone, now);
  assert.equal(new Date(patch.plannedStartDate).toISOString(), '2026-10-28T17:00:00.000Z');
  assert.equal(new Date(patch.dueDate).toISOString(), '2026-10-30T16:59:59.999Z');
  assert.equal(patch.actualStartDate.toISOString(), '2026-10-29T07:00:00.000Z');
  assert.equal(new Date(patch.actualEndDate).toISOString(), '2026-10-30T16:59:59.999Z');
});

test('kiểm khoảng ngày sau khi gộp patch với bản đã lưu; chặn ngày thực tế tương lai', () => {
  assert.throws(() => applyTaskDates({ plannedStartDate: new Date('2026-11-01') }, { dueDate: new Date('2026-10-30') }, zone, now), /kết thúc kế hoạch/);
  assert.throws(() => applyTaskDates({ actualEndDate: new Date('2026-10-28') }, { actualStartDate: new Date('2026-10-29') }, zone, now), /kết thúc thực tế/);
  assert.throws(() => applyTaskDates({ actualStartDate: new Date('2099-01-01') }, {}, zone, now), /tương lai/);
});

test('bắt đầu chỉ ghi lần đầu; Done giữ ngày người dùng nhập, mở lại xóa ngày kết thúc', () => {
  const started = { status: 'in_progress' };
  applyTaskDates(started, { status: 'todo' }, zone, now);
  assert.equal(started.actualStartDate, now);
  const repeated = { status: 'in_progress' };
  applyTaskDates(repeated, { actualStartDate: now }, zone, new Date(now.getTime() + 1000));
  assert.equal(repeated.actualStartDate, undefined);
  const finished = { status: 'done' };
  applyTaskDates(finished, { status: 'review' }, zone, now);
  assert.equal(finished.actualEndDate, now);
  assert.equal(finished.actualStartDate, undefined, 'không bịa ngày bắt đầu task cũ');
  const manual = { status: 'done' };
  applyTaskDates(manual, { status: 'review', actualEndDate: now }, zone, new Date(now.getTime() + 1000));
  assert.equal(manual.actualEndDate, undefined);
  const reopened = { status: 'todo' };
  applyTaskDates(reopened, { status: 'done', actualStartDate: now, actualEndDate: now }, zone, now);
  assert.equal(reopened.actualEndDate, null);
});
