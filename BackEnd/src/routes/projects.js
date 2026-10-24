import { Router } from 'express';
import { z } from 'zod';
import { USER, ilike, isId, populate, populateAll, prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { atLeast, middlewareProject, middlewareWorkspace, projectAccess, readableProjectsWhere, workspaceAccess } from '../middleware/access.js';
import { logActivityIn } from '../services/activity.js';
import { emitProject, refreshUserAccess } from '../services/realtime.js';
import { unassignTasks, withWorkspaceLock } from '../services/membership.js';
import { badRequest, forbidden, parse } from '../utils/http.js';
import { isDateInput, parseDate } from '../utils/dates.js';

const router = Router();
router.use(requireAuth);

const COLORS = ['blue', 'purple', 'emerald', 'amber', 'rose', 'slate', 'cyan'];

const dateStr = z
  .string()
  .refine(isDateInput, 'Ngày không hợp lệ; thời điểm phải có múi giờ')
  .transform((s) => parseDate(s));

const projectBody = z
  .object({
    name: z.string({ required_error: 'Vui lòng nhập tên dự án' }).trim().min(1, 'Vui lòng nhập tên dự án').max(100),
    description: z.string().trim().max(2000).default(''),
    color: z.enum(COLORS).default('blue'),
    keyPrefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2,5}$/, 'Mã dự án gồm 2–5 chữ cái')
      .optional(),
    startDate: dateStr.nullable().optional(),
    endDate: dateStr.nullable().optional(),
    members: z.array(z.string()).default([]),
    manager: z.string().optional(),
    sprint: z
      .object({ name: z.string().max(60), goal: z.string().max(300), start: dateStr.nullable(), end: dateStr.nullable() })
      .partial()
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Ngày kết thúc không được trước ngày bắt đầu' });
    }
    if (v.sprint?.start && v.sprint?.end && v.sprint.end < v.sprint.start) {
      ctx.addIssue({ code: 'custom', path: ['sprint'], message: 'Ngày kết thúc Sprint không được trước ngày bắt đầu' });
    }
  });

const SPRINT_DEFAULT = { name: '', goal: '', start: null, end: null };
/** Sprint lưu JSONB: gộp với giá trị cũ, ngày lưu dạng ISO */
const mergeSprint = (cur, patch) => ({
  ...SPRINT_DEFAULT,
  ...cur,
  ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])),
});

async function validMembers(workspaceId, ids, db = prisma) {
  if (ids.some((id) => !isId(id))) throw badRequest('Mã thành viên không hợp lệ');
  const ms = await db.membership.findMany({ where: { workspace: workspaceId, user: { in: ids } }, select: { user: true } });
  if (ms.length !== new Set(ids).size) throw badRequest('Thành viên phải thuộc workspace');
  return ms.map((m) => m.user);
}

/** Tổng/đã xong/quá hạn của công việc cấp 1 theo dự án – một truy vấn SQL gộp */
async function projectStats(projectIds) {
  if (!projectIds.length) return {};
  const rows = await prisma.$queryRaw`
    SELECT project_id AS id,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'done')::int AS done,
           COUNT(*) FILTER (WHERE status <> 'done' AND "dueDate" IS NOT NULL AND "dueDate" < now())::int AS overdue
    FROM tasks
    WHERE project_id = ANY(${projectIds}::uuid[]) AND parent_id IS NULL
    GROUP BY project_id`;
  return Object.fromEntries(rows.map(({ id, ...r }) => [id, r]));
}

router.get('/workspaces/:wsId/projects', middlewareWorkspace(), async (req, res) => {
  const { workspace, role } = req.ws;
  const readable = readableProjectsWhere(req.user.id, workspace.id, role);
  const where = { ...readable };
  if (['active', 'archived'].includes(req.query.status)) where.status = req.query.status;
  if (req.query.search) where.name = ilike(req.query.search);
  if (isId(req.query.manager)) where.manager = req.query.manager;
  const [[projects, stats], counts] = await Promise.all([
    prisma.project.findMany({ where, orderBy: { createdAt: 'asc' } }).then((rows) =>
      Promise.all([
        populateAll(rows, [
          ['members', 'user', USER],
          ['manager', 'user', USER],
        ]),
        projectStats(rows.map((p) => p.id)),
      ]),
    ),
    prisma.project.groupBy({ by: ['status'], where: readable, _count: { _all: true } }),
  ]);
  const count = (st) => counts.find((c) => c.status === st)?._count._all || 0;
  const [active, archived] = [count('active'), count('archived')];
  res.json({
    projects: projects.map((p) => ({ ...p, stats: stats[p.id] || { total: 0, done: 0, overdue: 0 } })),
    counts: { active, archived },
  });
});

router.post('/workspaces/:wsId/projects', middlewareWorkspace('wsId', 'member'), async (req, res) => {
  const body = parse(projectBody, req.body);
  const wsId = req.ws.workspace.id;
  const project = await withWorkspaceLock(wsId, async (tx) => {
    const access = await workspaceAccess(req.user.id, wsId, tx);
    if (!atLeast(access.role, 'member')) throw forbidden();
    const members = await validMembers(wsId, [...new Set([...body.members, req.user.id])], tx);
    const manager = body.manager || req.user.id;
    if (!isId(manager) || !members.includes(manager)) throw badRequest('PM phải là thành viên của dự án');
    const pm = await tx.membership.findUnique({ where: { workspace_user: { workspace: wsId, user: manager } } });
    if (!pm || pm.role === 'viewer') throw badRequest('Viewer không thể làm PM');
    const project = await tx.project.create({
      data: {
        ...body,
        sprint: mergeSprint({}, body.sprint || {}),
        keyPrefix: body.keyPrefix || 'TF',
        workspace: wsId,
        members,
        manager,
        createdBy: req.user.id,
      },
    });
    await logActivityIn(tx, {
      workspace: wsId,
      project: project.id,
      actor: req.user.id,
      action: 'Tạo dự án',
      entityType: 'project',
      entityId: project.id,
      entityLabel: project.name,
    });
    return project;
  });
  res.status(201).json({ project });
});

router.get('/projects/:projectId', middlewareProject(), async (req, res) => {
  // Dự án đã tải sẵn khi kiểm quyền – chỉ cần nạp thành viên + vai trò song song
  const project = { ...req.pa.project };
  const [memberships] = await Promise.all([
    prisma.membership.findMany({ where: { workspace: project.workspace, user: { in: [...req.pa.project.members] } } }),
    populateAll(project, [
      ['members', 'user', USER],
      ['manager', 'user', USER],
    ]),
  ]);
  const roleOf = Object.fromEntries(memberships.map((m) => [m.user, m]));
  res.json({
    project: {
      ...project,
      members: project.members.map((m) => ({ ...m, role: roleOf[m.id]?.role, weeklyHours: roleOf[m.id]?.weeklyHours ?? 20, jobTitle: roleOf[m.id]?.title })),
    },
    access: { role: req.pa.role, canWrite: req.pa.canWrite, canManage: req.pa.canManage },
  });
});

router.patch('/projects/:projectId', middlewareProject(), async (req, res) => {
  if (!req.pa.canManage) throw forbidden(req.pa.project.status === 'archived' ? 'Dự án đã lưu trữ, chỉ được xem' : 'Chỉ quản lý dự án hoặc Admin được sửa dự án');
  const body = parse(projectBody.innerType().partial(), req.body);
  const { project, affected } = await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const fresh = await projectAccess(req.user.id, req.pa.project.id, tx);
    if (!fresh.canManage) throw forbidden('Chỉ quản lý dự án hoặc Admin được sửa dự án đang hoạt động');
    const cur = fresh.project;
    const start = body.startDate !== undefined ? body.startDate : cur.startDate;
    const end = body.endDate !== undefined ? body.endDate : cur.endDate;
    if (start && end && new Date(end) < new Date(start))
      throw badRequest('Ngày kết thúc không được trước ngày bắt đầu', { fields: { endDate: 'Ngày kết thúc không được trước ngày bắt đầu' } });
    const data = { ...body };
    let removed = [];
    if (body.members) {
      const members = await validMembers(cur.workspace, body.members, tx);
      removed = cur.members.filter((m) => !members.includes(m));
      await unassignTasks(tx, { workspace: cur.workspace, project: cur.id, users: removed, actor: req.user.id });
      data.members = members;
      if (removed.includes(cur.manager)) data.manager = null;
    }
    if (body.manager !== undefined) {
      if (!isId(body.manager) || !(data.members || cur.members).includes(body.manager)) throw badRequest('PM phải là thành viên của dự án');
      const pm = await tx.membership.findUnique({ where: { workspace_user: { workspace: cur.workspace, user: body.manager } } });
      if (!pm || pm.role === 'viewer') throw badRequest('Viewer không thể làm PM');
      data.manager = body.manager;
    }
    if (body.sprint) {
      data.sprint = mergeSprint(cur.sprint, body.sprint);
      if (data.sprint.start && data.sprint.end && new Date(data.sprint.end) < new Date(data.sprint.start)) throw badRequest('Ngày kết thúc Sprint không được trước ngày bắt đầu');
    }
    const project = await tx.project.update({ where: { id: cur.id }, data });
    await tx.activity.create({
      data: {
        workspace: project.workspace,
        project: project.id,
        actor: req.user.id,
        action: 'Cập nhật dự án',
        entityType: 'project',
        entityId: project.id,
        entityLabel: project.name,
        before: { members: cur.members, manager: cur.manager },
        after: { fields: Object.keys(body), members: project.members, manager: project.manager },
      },
    });
    return { project, affected: [...new Set([...cur.members, ...project.members])] };
  });
  for (const user of affected) await refreshUserAccess(user);
  emitProject(project.id, 'board:refresh', {});
  res.json({ project });
});

router.put('/projects/:projectId/risk-rules', middlewareProject(), async (req, res) => {
  if (!req.pa.canManage) throw forbidden();
  const body = parse(
    z
      .object({
        overdue: z.boolean(),
        overdueDays: z.number().int().min(0).max(30),
        blockedByOverdue: z.boolean(),
        overload: z.boolean(),
        overloadPct: z.number().int().min(50).max(300),
        dueSoon: z.boolean(),
        dueSoonProgressPct: z.number().int().min(0).max(100),
        reviewStaleDays: z.number().int().min(1).max(30),
      })
      .partial(),
    req.body,
  );
  const project = await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const fresh = await projectAccess(req.user.id, req.pa.project.id, tx);
    if (!fresh.canManage) throw forbidden();
    const updated = await tx.project.update({ where: { id: fresh.project.id }, data: { riskRules: { ...fresh.project.riskRules, ...body } } });
    await logActivityIn(tx, {
      workspace: updated.workspace,
      project: updated.id,
      actor: req.user.id,
      action: 'Cập nhật quy tắc rủi ro',
      entityType: 'project',
      entityId: updated.id,
      entityLabel: updated.name,
      before: fresh.project.riskRules,
      after: updated.riskRules,
    });
    return updated;
  });
  await emitProject(project.id, 'risks:changed', {});
  res.json({ riskRules: project.riskRules });
});

async function setStatus(req, res, status) {
  const project = await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const access = await projectAccess(req.user.id, req.pa.project.id, tx);
    const isManager = access.project.manager === req.user.id;
    if (access.role === 'viewer' || (!isManager && !atLeast(access.role, 'admin'))) throw forbidden('Chỉ quản lý dự án hoặc Admin được lưu trữ dự án');
    const project = await tx.project.update({ where: { id: access.project.id }, data: { status } });
    await logActivityIn(tx, {
      workspace: project.workspace,
      project: project.id,
      actor: req.user.id,
      action: status === 'archived' ? 'Lưu trữ dự án' : 'Khôi phục dự án',
      entityType: 'project',
      entityId: project.id,
      entityLabel: project.name,
    });
    return project;
  });
  for (const user of project.members) await refreshUserAccess(user);
  res.json({ project });
}
router.post('/projects/:projectId/archive', middlewareProject(), (req, res) => setStatus(req, res, 'archived'));
router.post('/projects/:projectId/restore', middlewareProject(), (req, res) => setStatus(req, res, 'active'));

export { COLORS };
export default router;
