import { z } from 'zod';
import { USER, countBy, isId, populateAll, prisma, subtaskCounts } from '../db.js';
import { taskPermissions, workspaceAccess } from '../middleware/access.js';
import { pagination, parse } from '../utils/http.js';
import { addDays, startOfDay, weekRange } from '../utils/dates.js';
import { listParam, taskFilters, taskSearch } from './task-filters.js';
import { checklistMap } from './checklists.js';

export async function listMyTasks(req, res) {
  const { workspace, role } = req.ws;
  // Chỉ trả task thuộc dự án được phép đọc – điều kiện lồng trong cùng truy vấn
  const readable = { projectRef: { memberships: { some: { user: req.user.id } } } };
  const where = { workspace: workspace.id, ...readable };
  const { assignee = 'me', status, priority, due, project, search } = taskFilters(req.query);
  if (assignee === 'me') where.AND = [{ OR: [{ assignee: req.user.id }, { contributors: { some: { user: req.user.id } } }] }];
  else if (assignee === 'unassigned') where.assignee = null;
  else if (isId(assignee)) where.AND = [{ OR: [{ assignee }, { contributors: { some: { user: assignee } } }] }];
  if (status) where.status = { in: listParam(status) };
  else if (req.query.includeDone !== 'true') where.status = { not: 'done' };
  if (priority) where.priority = { in: listParam(priority) };
  if (project) where.project = { in: String(project).split(',').filter(isId) };
  const now = new Date();
  const sod = startOfDay(now, req.user.timezone);
  const eod = addDays(sod, 1, req.user.timezone);
  const { end: eow } = weekRange(now, req.user.timezone);
  if (due === 'today') where.dueDate = { gte: sod, lt: eod };
  else if (due === 'week') where.dueDate = { gte: sod, lt: eow };
  else if (due === 'overdue') {
    where.dueDate = { lt: now };
    where.status = { ...where.status, not: 'done' };
  } else if (due === 'none') where.dueDate = null;
  if (search) where.OR = taskSearch(search);
  const { page, limit } = pagination(req.query, 20);
  const mine = { workspace: workspace.id, ...readable, OR: [{ assignee: req.user.id }, { contributors: { some: { user: req.user.id } } }] };
  const open = { ...mine, status: { not: 'done' } };
  const weekAgo = new Date(sod.getTime() - 6 * 86400000);
  // Danh sách (kèm dữ liệu liên quan), tổng số và 4 chỉ số tóm tắt chạy song song
  const [items, total, today, overdue, upcoming, doneWeek, actionable] = await Promise.all([
    prisma.task
      .findMany({ where: { ...where, deletedAt: null }, include: { contributors: true }, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }, { number: 'asc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit })
      .then(async (rows) => {
        const ids = rows.map((t) => t.id);
        const [, subs, comments, checklists] = await Promise.all([
          populateAll(rows, [
            ['assignee', 'user', USER],
            ['project', 'project', { name: true, color: true, keyPrefix: true, manager: true, status: true, memberships: { where: { user: req.user.id } } }],
            ['blockedBy', 'task', { key: true, title: true, status: true, dueDate: true }],
          ]),
          subtaskCounts(ids),
          countBy('comment', 'task', { task: { in: ids }, deletedAt: null }),
          checklistMap(ids),
        ]);
        return rows.map((t) => {
          const projectRole = role === 'viewer' ? 'viewer' : t.project.memberships[0]?.role;
          const canWrite = !!projectRole && projectRole !== 'viewer' && t.project.status !== 'archived';
          const access = { project: t.project, projectRole, canWrite, canManage: canWrite && projectRole === 'pm' };
          const permissions = taskPermissions(access, req.user.id, { ...t, assignee: t.assignee?.id });
          return {
            ...t, checklist: checklists.get(t.id) || [], subtasks: subs[t.id] || { total: 0, done: 0 }, commentCount: comments[t.id] || 0,
            permissions,
            access: { canWrite: permissions.canUpdateProgress, canManage: access.canManage },
          };
        });
      }),
    prisma.task.count({ where: { ...where, deletedAt: null } }),
    prisma.task.count({ where: { deletedAt: null, ...open, dueDate: { gte: sod, lt: eod } } }),
    prisma.task.count({ where: { deletedAt: null, ...open, dueDate: { lt: now } } }),
    prisma.task.count({ where: { deletedAt: null, ...open, dueDate: { gte: now, lt: eow } } }),
    prisma.task.count({ where: { deletedAt: null, ...mine, status: 'done', completedAt: { gte: weekAgo } } }),
    // Union of overdue and due today, so tasks overdue earlier today count once.
    prisma.task.count({ where: { deletedAt: null, ...open, dueDate: { lt: eod } } }),
  ]);
  res.json({
    items,
    total,
    page,
    limit,
    summary: { today, overdue, upcoming, doneWeek, actionable },
  });
}

export async function myTasksFromQuery(req, res) {
  const { workspace } = parse(z.object({ workspace: z.uuid() }), req.query);
  req.ws = await workspaceAccess(req.user.id, workspace);
  return listMyTasks(req, res);
}
