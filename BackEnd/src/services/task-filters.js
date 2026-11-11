import { z } from 'zod';
import { ilike, isId } from '../db.js';
import { parse } from '../utils/http.js';
import { addDays, startOfDay, weekRange } from '../utils/dates.js';

export const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done'];
export const PRIORITIES = ['low', 'medium', 'high'];
export const listParam = (value) => value.split(',');
const optionalFilter = (valid) => z.string().refine((value) => !value || valid(value), 'Bộ lọc không hợp lệ').transform((value) => value || undefined).optional();
const schema = z.object({
  assignee: optionalFilter((s) => ['me', 'all', 'unassigned'].includes(s) || isId(s)),
  status: optionalFilter((s) => s.split(',').every((v) => TASK_STATUSES.includes(v))),
  priority: optionalFilter((s) => s.split(',').every((v) => PRIORITIES.includes(v))),
  project: optionalFilter((s) => s.split(',').every(isId)),
  due: optionalFilter((s) => ['today', 'week', 'overdue', 'none'].includes(s)),
  includeDone: z.enum(['true', 'false', '']).optional(),
  search: z.string().trim().max(2000).optional(),
});
export const taskFilters = (query) => parse(schema, query);
export const taskSearch = (text) => [{ title: ilike(text) }, { key: ilike(text) }, { description: ilike(text) }];

export function applyDueFilter(where, due, timezone, now = new Date()) {
  const sod = startOfDay(now, timezone);
  if (due === 'today') where.dueDate = { gte: sod, lt: addDays(sod, 1, timezone) };
  else if (due === 'week') where.dueDate = { gte: sod, lt: weekRange(now, timezone).end };
  else if (due === 'overdue') {
    where.dueDate = { lt: now };
    where.status = { ...where.status, not: 'done' };
  } else if (due === 'none') where.dueDate = null;
}
