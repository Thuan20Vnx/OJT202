import { badRequest } from '../utils/http.js';
import { dateKey, parseDate } from '../utils/dates.js';

export const TASK_DATE_LABELS = {
  plannedStartDate: 'Ngày bắt đầu kế hoạch',
  dueDate: 'Ngày kết thúc kế hoạch',
  actualStartDate: 'Ngày bắt đầu thực tế',
  actualEndDate: 'Ngày kết thúc thực tế',
};

export function parseTaskDates(body, timezone) {
  for (const field of Object.keys(TASK_DATE_LABELS)) {
    if (body[field] !== undefined) body[field] = body[field] ? parseDate(body[field], timezone, field === 'dueDate' || field === 'actualEndDate') : null;
  }
}

/** Actual work dates are independent of the PM approval timestamp completedAt. */
export function applyTaskDates(patch, before, timezone, now = new Date()) {
  if (patch.status === 'in_progress' && !before.actualStartDate && patch.actualStartDate === undefined) patch.actualStartDate = now;
  if (patch.status === 'done' && before.status !== 'done' && !before.actualEndDate && patch.actualEndDate === undefined) patch.actualEndDate = now;
  if (before.status === 'done' && patch.status && patch.status !== 'done' && patch.actualEndDate === undefined) patch.actualEndDate = null;
  const next = { ...before, ...patch };
  const invalid = (field, message) => { throw badRequest(message, { fields: { [field]: message } }); };
  if (next.plannedStartDate && next.dueDate && next.dueDate < next.plannedStartDate) invalid('dueDate', 'Ngày kết thúc kế hoạch không được trước ngày bắt đầu kế hoạch');
  if (next.actualStartDate && next.actualEndDate && next.actualEndDate < next.actualStartDate) invalid('actualEndDate', 'Ngày kết thúc thực tế không được trước ngày bắt đầu thực tế');
  for (const field of ['actualStartDate', 'actualEndDate']) {
    if (patch[field] && dateKey(patch[field], timezone) > dateKey(now, timezone)) invalid(field, `${TASK_DATE_LABELS[field]} không được ở tương lai`);
  }
}
