import { Router } from 'express';
import { z } from 'zod';
import { USER, ilike, isId, populate, populateAll, prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { atLeast, middlewareProject, middlewareWorkspace, readableProjectsWhere } from '../middleware/access.js';
import { logActivity } from '../services/activity.js';
import { kickFromProject } from '../services/realtime.js';
import { badRequest, forbidden, parse } from '../utils/http.js';

const router = Router();
router.use(requireAuth);

const COLORS = ['blue', 'purple', 'emerald', 'amber', 'rose', 'slate', 'cyan'];

const dateStr = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Ngày không hợp lệ')
  .transform((s) => new Date(s));

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
    sprint: z.object({ name: z.string().max(60), goal: z.string().max(300), start: dateStr.nullable(), end: dateStr.nullable() }).partial().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Ngày kết thúc không được trước ngày bắt đầu' });
    }
  });

const SPRINT_DEFAULT = { name: '', goal: '', start: null, end: null };
/** Sprint lưu JSONB: gộp với giá trị cũ, ngày lưu dạng ISO */
const mergeSprint = (cur, patch) => ({
  ...SPRINT_DEFAULT,
  ...cur,
  ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])),
});

async function validMembers(workspaceId, ids) {
  const ms = await prisma.membership.findMany({ where: { workspace: workspaceId, user: { in: ids.filter(isId) } }, select: { user: true } });
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
  const members = await validMembers(wsId, [...new Set([...body.members, req.user.id])]);
  const project = await prisma.project.create({
    data: {
      ...body,
      sprint: mergeSprint({}, body.sprint || {}),
      keyPrefix: body.keyPrefix || 'TF',
      workspace: wsId,
      members,
      manager: body.manager && members.includes(body.manager) ? body.manager : req.user.id,
      createdBy: req.user.id,
    },
  });
  await logActivity({ workspace: wsId, project: project.id, actor: req.user.id, action: 'Tạo dự án', entityType: 'project', entityId: project.id, entityLabel: project.name });
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
  const cur = req.pa.project;
  const start = body.startDate !== undefined ? body.startDate : cur.startDate;
  const end = body.endDate !== undefined ? body.endDate : cur.endDate;
  if (start && end && new Date(end) < new Date(start)) throw badRequest('Ngày kết thúc không được trước ngày bắt đầu', { fields: { endDate: 'Ngày kết thúc không được trước ngày bắt đầu' } });
  const data = { ...body };
  if (body.members) {
    const members = await validMembers(cur.workspace, body.members);
    const removed = cur.members.filter((m) => !members.includes(m));
    for (const u of removed) await kickFromProject(u, cur.id);
    data.members = members;
  }
  if (body.manager !== undefined && !isId(body.manager)) delete data.manager;
  if (body.sprint) data.sprint = mergeSprint(cur.sprint, body.sprint);
  const project = await prisma.project.update({ where: { id: cur.id }, data });
  await logActivity({
    workspace: project.workspace,
    project: project.id,
    actor: req.user.id,
    action: 'Cập nhật dự án',
    entityType: 'project',
    entityId: project.id,
    entityLabel: project.name,
    after: Object.keys(body).join(', '),
  });
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
  const project = await prisma.project.update({ where: { id: req.pa.project.id }, data: { riskRules: { ...req.pa.project.riskRules, ...body } } });
  res.json({ riskRules: project.riskRules });
});

async function setStatus(req, res, status) {
  const isManager = req.pa.project.manager === req.user.id;
  if (!isManager && !atLeast(req.pa.role, 'admin')) throw forbidden('Chỉ quản lý dự án hoặc Admin được lưu trữ dự án');
  const project = await prisma.project.update({ where: { id: req.pa.project.id }, data: { status } });
  await logActivity({
    workspace: project.workspace,
    project: project.id,
    actor: req.user.id,
    action: status === 'archived' ? 'Lưu trữ dự án' : 'Khôi phục dự án',
    entityType: 'project',
    entityId: project.id,
    entityLabel: project.name,
  });
  res.json({ project });
}
router.post('/projects/:projectId/archive', middlewareProject(), (req, res) => setStatus(req, res, 'archived'));
router.post('/projects/:projectId/restore', middlewareProject(), (req, res) => setStatus(req, res, 'active'));

export { COLORS };
export default router;
