import { z } from 'zod';
import { USER, isId, prisma } from '../db.js';
import { taskPermissions, workspaceAccess } from '../middleware/access.js';
import { pagination, parse } from '../utils/http.js';
import { addDays, startOfDay, weekRange } from '../utils/dates.js';
import { listParam, taskFilters, taskSearch } from './task-filters.js';

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
  const mineOr = [{ assignee: req.user.id }, { contributors: { some: { user: req.user.id } } }];
  const weekAgo = new Date(sod.getTime() - 6 * 86400000);
  // 4 câu SQL thay vì 12 (U031, Supabase: số câu SQL là trần thông lượng): danh sách kèm mọi dữ liệu đi kèm trong
  // một câu include, việc chặn một câu, tổng số một câu, và 5 chỉ số tóm tắt đếm bằng JS trên các việc của mình.
  const [rows, total, mineRows] = await Promise.all([
    prisma.task.findMany({
      where: { ...where, deletedAt: null },
      include: {
        contributors: true,
        assigneeRef: { select: USER },
        projectRef: { select: { id: true, name: true, color: true, keyPrefix: true, manager: true, status: true, memberships: { where: { user: req.user.id } } } },
        checklistItems: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
        subtasks: { where: { deletedAt: null }, select: { status: true } },
        _count: { select: { comments: { where: { deletedAt: null } } } },
      },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }, { number: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.task.count({ where: { ...where, deletedAt: null } }),
    prisma.task.findMany({
      where: { deletedAt: null, workspace: workspace.id, ...readable, AND: [{ OR: mineOr }, { OR: [{ status: { not: 'done' } }, { status: 'done', completedAt: { gte: weekAgo } }] }] },
      select: { status: true, dueDate: true, completedAt: true },
    }),
  ]);
  const blockerIds = [...new Set(rows.flatMap((t) => t.blockedBy))];
  const blockers = blockerIds.length
    ? await prisma.task.findMany({ where: { id: { in: blockerIds }, deletedAt: null, project: { in: [...new Set(rows.map((t) => t.project))] } }, select: { id: true, project: true, key: true, title: true, status: true, dueDate: true } })
    : [];
  const byId = new Map(blockers.map((b) => [b.id, b]));
  const items = rows.map(({ assigneeRef, projectRef, checklistItems, subtasks, _count, ...t }) => {
    const projectRole = role === 'viewer' ? 'viewer' : projectRef.memberships[0]?.role;
    // Workspace đang chờ xóa: chỉ đọc như ở chi tiết việc/Kanban.
    const canWrite = !!projectRole && projectRole !== 'viewer' && projectRef.status !== 'archived' && !workspace.deletionScheduledAt;
    const access = { project: projectRef, projectRole, canWrite, canManage: canWrite && projectRole === 'pm' };
    const permissions = taskPermissions(access, req.user.id, t);
    return {
      ...t,
      assignee: assigneeRef ?? null,
      project: projectRef,
      blockedBy: t.blockedBy.map((id) => byId.get(id)).filter((b) => b && b.project === t.project).map(({ project: _p, ...b }) => b),
      checklist: checklistItems.map((c) => ({ _id: c.id, text: c.title, done: c.isDone })),
      subtasks: { total: subtasks.length, done: subtasks.filter((x) => x.status === 'done').length },
      commentCount: _count.comments,
      permissions,
      access: { canWrite: permissions.canUpdateProgress, canManage: access.canManage },
    };
  });
  const summary = { today: 0, overdue: 0, upcoming: 0, doneWeek: 0, actionable: 0 };
  for (const t of mineRows) {
    if (t.status === 'done') { if (t.completedAt && t.completedAt >= weekAgo) summary.doneWeek++; continue; }
    const d = t.dueDate;
    if (!d) continue;
    if (d >= sod && d < eod) summary.today++;
    if (d < now) summary.overdue++;
    if (d >= now && d < eow) summary.upcoming++;
    // Gộp quá hạn và đến hạn hôm nay, việc quá hạn từ sáng nay chỉ tính một lần.
    if (d < eod) summary.actionable++;
  }
  res.json({
    items,
    total,
    page,
    limit,
    summary,
  });
}

export async function myTasksFromQuery(req, res) {
  const { workspace } = parse(z.object({ workspace: z.uuid() }), req.query);
  req.ws = await workspaceAccess(req.user.id, workspace);
  return listMyTasks(req, res);
}
