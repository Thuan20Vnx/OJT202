import { withWorkspaceLock } from '../services/membership.js';
import { isDateInput, parseDate } from '../utils/dates.js';
import { Router } from 'express';
import { z } from 'zod';
import { USER, ilike, isId, populate, populateAll, prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { middlewareProject, middlewareWorkspace, readableProjectsWhere } from '../middleware/access.js';
import { emitProject, refreshUserAccess } from '../services/realtime.js';
import { lockProject, saveProjectMembers, projectAudit } from '../services/project-members.js';
import { badRequest, forbidden, parse } from '../utils/http.js';

const router = Router();
router.use(requireAuth);

const COLORS = ['blue', 'purple', 'emerald', 'amber', 'rose', 'slate', 'cyan'];

const dateStr = z
  .string()
  .refine(isDateInput, 'Ngày không hợp lệ; thời điểm phải có múi giờ');

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
    members: z.array(z.string().uuid()).default([]),
    manager: z.string().uuid().optional(),
    memberRoles: z.record(z.enum(['pm', 'member', 'viewer'])).optional(),
    sprint: z.object({ name: z.string().max(60), goal: z.string().max(300), start: dateStr.nullable(), end: dateStr.nullable() }).partial().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.endDate && new Date(v.endDate) < new Date(v.startDate)) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Ngày kết thúc không được trước ngày bắt đầu' });
    }
  });

function validateSprint(sprint) {
  if (sprint?.start && sprint?.end && new Date(sprint.end) < new Date(sprint.start)) throw badRequest('Ngày kết thúc sprint không được trước ngày bắt đầu');
}
function normalizeDates(body, timezone) {
  for (const field of ['startDate', 'endDate']) if (body[field]) body[field] = parseDate(body[field], timezone, field === 'endDate');
  if (body.sprint) {
    for (const field of ['start', 'end']) if (body.sprint[field]) body.sprint[field] = parseDate(body.sprint[field], timezone, field === 'end');
    validateSprint(body.sprint);
  }
}

const SPRINT_DEFAULT = { name: '', goal: '', start: null, end: null };
/** Sprint lưu JSONB: gộp với giá trị cũ, ngày lưu dạng ISO */
const mergeSprint = (cur, patch) => ({
  ...SPRINT_DEFAULT,
  ...cur,
  ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])),
});

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
    prisma.project.findMany({ where, include: { memberships: true }, orderBy: { createdAt: 'asc' } }).then((rows) =>
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
    projects: projects.map(({ memberships, ...p }) => ({ ...p, projectRole: role === 'viewer' ? 'viewer' : memberships.find((m) => m.user === req.user.id).role, memberRoles: Object.fromEntries(memberships.map((m) => [m.user, m.role])), stats: stats[p.id] || { total: 0, done: 0, overdue: 0 } })),
    counts: { active, archived },
  });
});

router.post('/workspaces/:wsId/projects', middlewareWorkspace('wsId', 'admin'), async (req, res) => {
  const body = parse(projectBody, req.body);
  normalizeDates(body, req.user.timezone);
  const wsId = req.ws.workspace.id;
  if (body.manager && body.manager !== req.user.id) throw badRequest('Người tạo dự án phải là PM; hãy chuyển giao sau khi tạo');
  const { members: requested, memberRoles = {}, manager, ...fields } = body;
  const project = await withWorkspaceLock(wsId, async (tx) => {
    const members = [...new Set([...requested, req.user.id])];
    const wsMembers = await tx.membership.findMany({ where: { workspace: wsId, user: { in: members } } });
    const current = wsMembers.find((m) => m.user === req.user.id);
    if (!current || !['owner', 'admin'].includes(current.role)) throw forbidden('Chỉ Owner/Admin được tạo dự án');
    const p = await tx.project.create({ data: { ...fields, sprint: mergeSprint({}, fields.sprint || {}), keyPrefix: fields.keyPrefix || 'TF', workspace: wsId, members: [], manager: req.user.id, createdBy: req.user.id } });
    const roster = members.map((user) => ({ user, role: user === req.user.id ? 'pm' : memberRoles[user] || (wsMembers.find((m) => m.user === user)?.role === 'viewer' ? 'viewer' : 'member') }));
    const result = await saveProjectMembers(tx, { ...p, memberships: [] }, roster, req.user.id, req.user.id);
    await projectAudit(tx, result, req.user.id, 'Tạo dự án', {}, { members, manager: req.user.id });
    return result;
  });
  res.status(201).json({ project });
});

router.get('/projects/:projectId', middlewareProject(), async (req, res) => {
  // Dự án đã tải sẵn khi kiểm quyền – chỉ cần nạp thành viên + vai trò song song
  const project = { ...req.pa.project };
  const [memberships, projectMemberships] = await Promise.all([
    prisma.membership.findMany({ where: { workspace: project.workspace, user: { in: [...req.pa.project.members] } } }),
    prisma.projectMember.findMany({ where: { project: project.id } }),
    populateAll(project, [
      ['members', 'user', USER],
      ['manager', 'user', USER],
    ]),
  ]);
  const roleOf = Object.fromEntries(memberships.map((m) => [m.user, m]));
  res.json({
    project: {
      ...project,
      members: project.members.map((m) => ({ ...m, role: roleOf[m.id]?.role, projectRole: projectMemberships.find((pm) => pm.user === m.id)?.role, weeklyHours: roleOf[m.id]?.weeklyHours ?? 20, jobTitle: roleOf[m.id]?.title })),
    },
    access: { role: req.pa.role, projectRole: req.pa.projectRole, canWrite: req.pa.canWrite, canManage: req.pa.canManage },
  });
});

router.patch('/projects/:projectId', middlewareProject(), async (req, res) => {
  if (!req.pa.canManage) throw forbidden(req.pa.project.status === 'archived' ? 'Dự án đã lưu trữ, chỉ được xem' : 'Chỉ PM được sửa dự án');
  const body = parse(projectBody.innerType().partial(), req.body);
  normalizeDates(body, req.user.timezone);
  const removed = [];
  const project = await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const cur = await lockProject(tx, req.pa.project.id, req.user.id);
    const start = body.startDate !== undefined ? body.startDate : cur.startDate;
    const end = body.endDate !== undefined ? body.endDate : cur.endDate;
    if (start && end && new Date(end) < new Date(start)) throw badRequest('Ngày kết thúc không được trước ngày bắt đầu', { fields: { endDate: 'Ngày kết thúc không được trước ngày bắt đầu' } });
    const { members, memberRoles, manager, ...data } = body;
    if (members || memberRoles || manager) {
      const ids = members || cur.members;
      const roster = [...new Set(ids)].map((user) => ({ user, role: memberRoles?.[user] || cur.memberships.find((m) => m.user === user)?.role || 'member' }));
      if (manager) {
        if (!ids.includes(manager)) throw badRequest('PM mới phải là thành viên dự án');
        for (const row of roster) {
          if (row.user === manager) row.role = 'pm';
          else if (row.user === cur.manager) row.role = 'member';
        }
      }
      await saveProjectMembers(tx, cur, roster, manager || cur.manager, req.user.id);
      removed.push(...cur.members.filter((u) => !ids.includes(u)));
    }
    if (body.sprint) data.sprint = mergeSprint(cur.sprint, body.sprint);
    validateSprint(data.sprint);
    const result = await tx.project.update({ where: { id: cur.id }, data });
    await projectAudit(tx, result, req.user.id, 'Cập nhật dự án', { members: cur.members, manager: cur.manager }, { fields: Object.keys(body), members: result.members, manager: result.manager });
    return result;
  });
  for (const user of removed) await refreshUserAccess(user);
  for (const user of project.members) await refreshUserAccess(user);
  await emitProject(project.id, 'board:refresh', {});
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
    const cur = await lockProject(tx, req.pa.project.id, req.user.id);
    const result = await tx.project.update({ where: { id: cur.id }, data: { riskRules: { ...cur.riskRules, ...body } } });
    await projectAudit(tx, result, req.user.id, 'Cập nhật quy tắc rủi ro', cur.riskRules, result.riskRules);
    return result;
  });
  await emitProject(project.id, 'risks:changed', {});
  res.json({ riskRules: project.riskRules });
});

async function setStatus(req, res, status) {
  const project = await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const cur = await lockProject(tx, req.pa.project.id, req.user.id, { allowArchived: true });
    const result = await tx.project.update({ where: { id: cur.id }, data: { status } });
    await projectAudit(tx, result, req.user.id, status === 'archived' ? 'Lưu trữ dự án' : 'Khôi phục dự án', { status: cur.status }, { status });
    return result;
  });
  for (const user of project.members) await refreshUserAccess(user);
  await emitProject(project.id, 'board:refresh', {});
  res.json({ project });
}
router.post('/projects/:projectId/archive', middlewareProject(), (req, res) => setStatus(req, res, 'archived'));
router.post('/projects/:projectId/restore', middlewareProject(), (req, res) => setStatus(req, res, 'active'));

router.get('/projects/:projectId/members', middlewareProject(), async (req, res) => {
  const members = await prisma.projectMember.findMany({ where: { project: req.pa.project.id }, include: { userRef: { select: USER } } });
  res.json({ members: members.map(({ userRef, ...m }) => ({ ...m, user: userRef })) });
});

async function changeMembers(req, res, change) {
  const removed = [];
  const project = await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const cur = await lockProject(tx, req.pa.project.id, req.user.id);
    const { roster, manager = cur.manager } = change(cur);
    const result = await saveProjectMembers(tx, cur, roster, manager, req.user.id);
    removed.push(...cur.members.filter((u) => !result.members.includes(u)));
    await projectAudit(tx, result, req.user.id, 'Cập nhật thành viên dự án', { members: cur.memberships }, { members: roster, manager: result.manager });
    return result;
  });
  for (const user of removed) await refreshUserAccess(user);
  for (const user of project.members) await refreshUserAccess(user);
  await emitProject(project.id, 'board:refresh', {});
  res.json({ project });
}

router.post('/projects/:projectId/members', middlewareProject(), async (req, res) => {
  const body = parse(z.object({ user: z.string().uuid(), role: z.enum(['pm', 'member', 'viewer']).default('member') }), req.body);
  await changeMembers(req, res, (p) => ({ roster: [...p.memberships.filter((m) => m.user !== body.user).map(({ user, role }) => ({ user, role })), body] }));
});

router.patch('/projects/:projectId/members/:userId', middlewareProject(), async (req, res) => {
  const { role } = parse(z.object({ role: z.enum(['pm', 'member', 'viewer']) }), req.body);
  await changeMembers(req, res, (p) => {
    if (!p.members.includes(req.params.userId)) throw badRequest('Thành viên không thuộc dự án');
    return { roster: p.memberships.map((m) => ({ user: m.user, role: m.user === req.params.userId ? role : m.role })) };
  });
});

router.delete('/projects/:projectId/members/:userId', middlewareProject(), async (req, res) => {
  await changeMembers(req, res, (p) => ({ roster: p.memberships.filter((m) => m.user !== req.params.userId).map(({ user, role }) => ({ user, role })) }));
});

router.post('/projects/:projectId/transfer-manager', middlewareProject(), async (req, res) => {
  const { user } = parse(z.object({ user: z.string().uuid() }), req.body);
  await changeMembers(req, res, (p) => {
    if (!p.members.includes(user)) throw badRequest('PM mới phải là thành viên dự án');
    return { manager: user, roster: p.memberships.map((m) => ({ user: m.user, role: m.user === user ? 'pm' : m.user === p.manager ? 'member' : m.role })) };
  });
});

export { COLORS };
export default router;
