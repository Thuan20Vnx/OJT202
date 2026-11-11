import { Router } from 'express';
import { z } from 'zod';
import { USER, isId, prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { assertManage, assertWrite, middlewareProject, projectAccess } from '../middleware/access.js';
import { logActivityIn } from '../services/activity.js';
import { withWorkspaceLock } from '../services/membership.js';
import { sprintBurndown } from '../services/metrics.js';
import { notify } from '../services/notify.js';
import { emitProject } from '../services/realtime.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../utils/http.js';
import { isCalendarDate, parseDate } from '../utils/dates.js';
import { plainText, toCsv } from '../utils/security.js';

const router = Router();
router.use(requireAuth);

const version = z.number().int().min(0);
const assertVersion = (given, actual) => { if (given !== actual) throw conflict('Dữ liệu đã thay đổi. Hãy tải lại trước khi lưu.'); };
const text = (max) => z.string().trim().max(max).transform((s) => plainText(s, max));
const requiredText = (max) => text(max).refine((s) => s.length > 0, 'Vui lòng nhập nội dung');
const calendarDate = z.string().refine(isCalendarDate, 'Ngày không hợp lệ');
const audit = (tx, project, actor, action, entityLabel, after) =>
  logActivityIn(tx, { workspace: project.workspace, project: project.id, actor, action, entityType: 'project', entityId: project.id, entityLabel, ...(after !== undefined && { after }) });

// ===================== NHÃN =====================
router.get('/projects/:projectId/labels', middlewareProject(), async (req, res) => {
  const labels = await prisma.projectLabel.findMany({ where: { project: req.pa.project.id }, orderBy: { name: 'asc' } });
  res.json({ labels: labels.map((l) => l.name) });
});

const labelName = z.string().trim().min(1, 'Vui lòng nhập tên nhãn').max(40);

router.post('/projects/:projectId/labels', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  const { name } = parse(z.object({ name: labelName }).strict(), req.body);
  const existing = await prisma.projectLabel.findFirst({ where: { project: req.pa.project.id, name: { equals: name, mode: 'insensitive' } } });
  if (existing) return res.json({ name: existing.name });
  await prisma.projectLabel.create({ data: { project: req.pa.project.id, name } });
  res.status(201).json({ name });
});

// Đổi tên hoặc xóa nhãn cập nhật luôn các công việc đang dùng để thống kê không bị tách đôi.
async function replaceLabel(req, from, to) {
  await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const access = await projectAccess(req.user.id, req.pa.project.id, tx);
    assertManage(access);
    const tasks = await tx.task.findMany({ where: { project: access.project.id, labels: { has: from } }, select: { id: true, labels: true } });
    for (const t of tasks) {
      const labels = [...new Set(t.labels.map((l) => (l === from ? to : l)).filter(Boolean))];
      await tx.task.update({ where: { id: t.id }, data: { labels, version: { increment: 1 } } });
    }
    await tx.projectLabel.deleteMany({ where: { project: access.project.id, name: from } });
    if (to) await tx.projectLabel.createMany({ data: [{ project: access.project.id, name: to }], skipDuplicates: true });
    await audit(tx, access.project, req.user.id, to ? 'Đổi tên nhãn' : 'Xóa nhãn', from, to || undefined);
  });
  await emitProject(req.pa.project.id, 'board:refresh', {});
}

router.patch('/projects/:projectId/labels/:name', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  const { name } = parse(z.object({ name: labelName }).strict(), req.body);
  await replaceLabel(req, req.params.name, name);
  res.json({ ok: true });
});

router.delete('/projects/:projectId/labels/:name', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  await replaceLabel(req, req.params.name, null);
  res.json({ ok: true });
});

// ===================== SPRINT & BACKLOG =====================
const brief = { id: true, key: true, title: true, status: true, priority: true, dueDate: true, estimateHours: true, assignee: true };

router.get('/projects/:projectId/sprints', middlewareProject(), async (req, res) => {
  const project = req.pa.project.id;
  const [sprints, tasks] = await Promise.all([
    prisma.sprint.findMany({ where: { project }, orderBy: [{ start: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }] }),
    prisma.task.findMany({ where: { project, parent: null, deletedAt: null }, select: { ...brief, sprint: true, completedAt: true }, orderBy: { number: 'asc' } }),
  ]);
  const hours = (list) => list.reduce((sum, t) => sum + (t.estimateHours || 0), 0);
  res.json({
    sprints: sprints.map((s) => {
      const mine = tasks.filter((t) => t.sprint === s.name);
      const done = mine.filter((t) => t.status === 'done');
      return { ...s, burndown: sprintBurndown(mine, s), stats: { total: mine.length, done: done.length, hours: hours(mine), doneHours: hours(done) }, tasks: mine };
    }),
    backlog: tasks.filter((t) => !t.sprint),
    access: { canManage: req.pa.canManage },
  });
});

const sprintDates = (body, timezone) => {
  for (const field of ['start', 'end']) if (body[field]) body[field] = parseDate(body[field], timezone, field === 'end');
  if (body.start && body.end && body.end < body.start) throw badRequest('Ngày kết thúc Sprint không được trước ngày bắt đầu');
};
const sprintFields = {
  name: z.string().trim().min(1, 'Vui lòng nhập tên Sprint').max(60),
  goal: text(300).optional(),
  start: calendarDate.nullable().optional(),
  end: calendarDate.nullable().optional(),
};
// Bản sao của Sprint đang chạy mà phần tổng quan, báo cáo và việc mới đang đọc.
const snapshot = (s) => ({ name: s.name, goal: s.goal, start: s.start?.toISOString() ?? null, end: s.end?.toISOString() ?? null });
const EMPTY_SPRINT = { name: '', goal: '', start: null, end: null };

const findSprint = async (tx, project, id) => {
  const sprint = isId(id) ? await tx.sprint.findFirst({ where: { id, project } }) : null;
  if (!sprint) throw notFound('Không tìm thấy Sprint');
  return sprint;
};

router.post('/projects/:projectId/sprints', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  const body = parse(z.object(sprintFields).strict(), req.body);
  sprintDates(body, req.user.timezone);
  const sprint = await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const access = await projectAccess(req.user.id, req.pa.project.id, tx);
    assertManage(access);
    if (await tx.sprint.findFirst({ where: { project: access.project.id, name: { equals: body.name, mode: 'insensitive' } } })) throw conflict('Tên Sprint đã tồn tại trong dự án');
    const sprint = await tx.sprint.create({ data: { ...body, project: access.project.id } });
    await audit(tx, access.project, req.user.id, 'Tạo Sprint', sprint.name);
    return sprint;
  });
  await emitProject(req.pa.project.id, 'sprints:changed', {});
  res.status(201).json({ sprint });
});

router.patch('/projects/:projectId/sprints/:sprintId', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  const body = parse(z.object({ ...sprintFields, name: sprintFields.name.optional(), version }).strict(), req.body);
  sprintDates(body, req.user.timezone);
  const { version: given, ...data } = body;
  const sprint = await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const access = await projectAccess(req.user.id, req.pa.project.id, tx);
    assertManage(access);
    const current = await findSprint(tx, access.project.id, req.params.sprintId);
    assertVersion(given, current.version);
    if (data.name && data.name.toLowerCase() !== current.name.toLowerCase() && await tx.sprint.findFirst({ where: { project: access.project.id, name: { equals: data.name, mode: 'insensitive' } } })) throw conflict('Tên Sprint đã tồn tại trong dự án');
    const start = data.start === undefined ? current.start : data.start;
    const end = data.end === undefined ? current.end : data.end;
    if (start && end && end < start) throw badRequest('Ngày kết thúc Sprint không được trước ngày bắt đầu');
    const sprint = await tx.sprint.update({ where: { id: current.id }, data: { ...data, version: { increment: 1 } } });
    // Công việc tham chiếu Sprint theo tên nên phải đổi cùng transaction.
    if (data.name && data.name !== current.name) await tx.task.updateMany({ where: { project: access.project.id, sprint: current.name }, data: { sprint: data.name } });
    if (sprint.status === 'active') await tx.project.update({ where: { id: access.project.id }, data: { sprint: snapshot(sprint) } });
    await audit(tx, access.project, req.user.id, 'Cập nhật Sprint', sprint.name);
    return sprint;
  });
  await emitProject(req.pa.project.id, 'sprints:changed', {});
  res.json({ sprint });
});

router.post('/projects/:projectId/sprints/:sprintId/start', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  const { version: given } = parse(z.object({ version }).strict(), req.body);
  const sprint = await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const access = await projectAccess(req.user.id, req.pa.project.id, tx);
    assertManage(access);
    const current = await findSprint(tx, access.project.id, req.params.sprintId);
    assertVersion(given, current.version);
    if (current.status !== 'planned') throw badRequest('Chỉ bắt đầu được Sprint chưa chạy');
    if (!current.start || !current.end) throw badRequest('Hãy đặt ngày bắt đầu và kết thúc trước khi chạy Sprint');
    const running = await tx.sprint.findFirst({ where: { project: access.project.id, status: 'active' } });
    if (running) throw conflict(`Đang chạy ${running.name}. Hãy đóng Sprint đó trước.`);
    const sprint = await tx.sprint.update({ where: { id: current.id }, data: { status: 'active', closedAt: null, version: { increment: 1 } } });
    await tx.project.update({ where: { id: access.project.id }, data: { sprint: snapshot(sprint) } });
    await audit(tx, access.project, req.user.id, 'Bắt đầu Sprint', sprint.name);
    return sprint;
  });
  await emitProject(req.pa.project.id, 'sprints:changed', {});
  await emitProject(req.pa.project.id, 'board:refresh', {});
  res.json({ sprint });
});

// Đóng Sprint: việc chưa xong chuyển sang Sprint khác hoặc về backlog, việc đã xong ở lại để giữ lịch sử.
router.post('/projects/:projectId/sprints/:sprintId/close', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  const body = parse(z.object({ version, moveTo: z.string().uuid().nullable().default(null) }).strict(), req.body);
  const result = await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const access = await projectAccess(req.user.id, req.pa.project.id, tx);
    assertManage(access);
    const current = await findSprint(tx, access.project.id, req.params.sprintId);
    assertVersion(body.version, current.version);
    if (current.status !== 'active') throw badRequest('Chỉ đóng được Sprint đang chạy');
    let target = '';
    if (body.moveTo) {
      const next = await findSprint(tx, access.project.id, body.moveTo);
      if (next.id === current.id || next.status === 'closed') throw badRequest('Chọn một Sprint chưa đóng khác để chuyển việc');
      target = next.name;
    }
    const moved = await tx.task.updateMany({ where: { project: access.project.id, sprint: current.name, status: { not: 'done' }, deletedAt: null }, data: { sprint: target, version: { increment: 1 } } });
    const sprint = await tx.sprint.update({ where: { id: current.id }, data: { status: 'closed', closedAt: new Date(), version: { increment: 1 } } });
    await tx.project.update({ where: { id: access.project.id }, data: { sprint: EMPTY_SPRINT } });
    await audit(tx, access.project, req.user.id, 'Đóng Sprint', sprint.name, { movedTasks: moved.count, moveTo: target || 'Backlog' });
    return { sprint, moved: moved.count };
  });
  await emitProject(req.pa.project.id, 'sprints:changed', {});
  await emitProject(req.pa.project.id, 'board:refresh', {});
  res.json(result);
});

router.delete('/projects/:projectId/sprints/:sprintId', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const access = await projectAccess(req.user.id, req.pa.project.id, tx);
    assertManage(access);
    const current = await findSprint(tx, access.project.id, req.params.sprintId);
    if (current.status !== 'planned') throw badRequest('Chỉ xóa được Sprint chưa chạy');
    await tx.task.updateMany({ where: { project: access.project.id, sprint: current.name }, data: { sprint: '', version: { increment: 1 } } });
    await tx.sprint.delete({ where: { id: current.id } });
    await audit(tx, access.project, req.user.id, 'Xóa Sprint', current.name);
  });
  await emitProject(req.pa.project.id, 'sprints:changed', {});
  res.json({ ok: true });
});

// Xếp nhiều việc vào Sprint (hoặc về backlog khi sprint = null).
router.post('/projects/:projectId/sprints/assign', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  const body = parse(z.object({ tasks: z.array(z.string().uuid()).min(1, 'Chọn ít nhất một công việc').max(200), sprint: z.string().uuid().nullable() }).strict(), req.body);
  const moved = await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const access = await projectAccess(req.user.id, req.pa.project.id, tx);
    assertManage(access);
    let name = '';
    if (body.sprint) {
      const sprint = await findSprint(tx, access.project.id, body.sprint);
      if (sprint.status === 'closed') throw badRequest('Không xếp việc vào Sprint đã đóng');
      name = sprint.name;
    }
    const { count } = await tx.task.updateMany({ where: { id: { in: body.tasks }, project: access.project.id, deletedAt: null }, data: { sprint: name, version: { increment: 1 } } });
    await audit(tx, access.project, req.user.id, 'Xếp việc vào Sprint', name || 'Backlog', { tasks: count });
    return count;
  });
  await emitProject(req.pa.project.id, 'sprints:changed', {});
  await emitProject(req.pa.project.id, 'board:refresh', {});
  res.json({ moved });
});

// ===================== ISSUE CẤP DỰ ÁN =====================
const ISSUE_TYPES = ['technical', 'absence', 'scope', 'external', 'other'];
const issueInclude = {
  reporterRef: { select: USER },
  ownerRef: { select: USER },
  affectedRef: { select: USER },
  taskRef: { select: { id: true, key: true, title: true, deletedAt: true } },
};

router.get('/projects/:projectId/issues', middlewareProject(), async (req, res) => {
  const where = { project: req.pa.project.id };
  if (['open', 'resolved'].includes(req.query.status)) where.status = req.query.status;
  if (ISSUE_TYPES.includes(req.query.type)) where.type = req.query.type;
  const issues = await prisma.taskIssue.findMany({ where, include: issueInclude, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 200 });
  res.json({ issues, access: { canWrite: req.pa.canWrite, canManage: req.pa.canManage } });
});

router.post('/projects/:projectId/issues', middlewareProject(), async (req, res) => {
  assertWrite(req.pa);
  const body = parse(
    z.object({
      title: requiredText(200),
      type: z.enum(ISSUE_TYPES).default('technical'),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      cause: requiredText(2000),
      action: requiredText(2000),
      owner: z.string().uuid().nullable().default(null),
      task: z.string().uuid().nullable().default(null),
      affectedUser: z.string().uuid().nullable().default(null),
      startDate: calendarDate.nullable().default(null),
      endDate: calendarDate.nullable().default(null),
    }).strict(),
    req.body,
  );
  if (body.startDate && body.endDate && body.endDate < body.startDate) throw badRequest('Ngày kết thúc không được trước ngày bắt đầu');
  if (body.type === 'absence' && (!body.affectedUser || !body.startDate || !body.endDate)) throw badRequest('Vấn đề vắng mặt cần có người vắng và khoảng ngày');
  const { issue, recipients } = await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const access = await projectAccess(req.user.id, req.pa.project.id, tx);
    assertWrite(access);
    const people = [body.owner, body.affectedUser].filter(Boolean);
    if (people.length && await tx.projectMember.count({ where: { project: access.project.id, user: { in: people } } }) !== new Set(people).size) throw badRequest('Người được chọn phải là thành viên dự án');
    if (body.task && !(await tx.task.findFirst({ where: { id: body.task, project: access.project.id, deletedAt: null } }))) throw badRequest('Công việc không thuộc dự án');
    const dates = { startDate: body.startDate && new Date(`${body.startDate}T00:00:00Z`), endDate: body.endDate && new Date(`${body.endDate}T00:00:00Z`) };
    const issue = await tx.taskIssue.create({ data: { ...body, ...dates, project: access.project.id, reporter: req.user.id } });
    await audit(tx, access.project, req.user.id, 'Ghi nhận vấn đề', issue.title, { type: issue.type, severity: issue.severity });
    const pms = await tx.projectMember.findMany({ where: { project: access.project.id, role: 'pm' }, select: { user: true } });
    return { issue, recipients: [...new Set([body.owner, ...pms.map((p) => p.user)].filter(Boolean))] };
  });
  await Promise.all(recipients.map((user) => notify({
    user, actor: req.user.id, type: 'status', workspace: req.pa.project.workspace, project: req.pa.project.id, task: issue.task,
    text: `${req.user.name} đã ghi nhận vấn đề: ${issue.title}`, dedupeKey: `issue:${issue.id}`,
  })));
  await emitProject(req.pa.project.id, 'issues:changed', {});
  res.status(201).json({ issue });
});

router.patch('/projects/:projectId/issues/:issueId', middlewareProject(), async (req, res) => {
  assertWrite(req.pa);
  const body = parse(z.object({ version, status: z.enum(['open', 'resolved']), resolution: text(2000) }).strict(), req.body);
  if (body.status === 'resolved' && !body.resolution) throw badRequest('Ghi kết quả xử lý trước khi đóng vấn đề');
  const issue = await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const access = await projectAccess(req.user.id, req.pa.project.id, tx);
    assertWrite(access);
    const found = isId(req.params.issueId) ? await tx.taskIssue.findFirst({ where: { id: req.params.issueId, project: access.project.id } }) : null;
    if (!found) throw notFound('Không tìm thấy vấn đề');
    if (!access.canManage && found.owner !== req.user.id && found.reporter !== req.user.id) throw forbidden('Chỉ người báo, người xử lý hoặc PM được cập nhật');
    assertVersion(body.version, found.version);
    const issue = await tx.taskIssue.update({ where: { id: found.id }, data: { status: body.status, resolution: body.resolution, version: { increment: 1 } } });
    await audit(tx, access.project, req.user.id, 'Cập nhật xử lý vấn đề', issue.title, { status: issue.status });
    return issue;
  });
  await emitProject(req.pa.project.id, 'issues:changed', {});
  res.json({ issue });
});

// ===================== BẢNG ĐÓNG GÓP =====================
async function contributions(project, { sprint } = {}) {
  const taskWhere = { project: project.id, deletedAt: null, ...(sprint && { sprint }) };
  const [members, tasks, logs, comments, issues] = await Promise.all([
    prisma.projectMember.findMany({ where: { project: project.id }, include: { userRef: { select: USER } } }),
    prisma.task.findMany({ where: taskWhere, include: { contributors: true } }),
    prisma.taskDailyUpdate.groupBy({ by: ['user'], where: { taskRef: taskWhere }, _sum: { hours: true }, _count: { _all: true } }),
    prisma.comment.groupBy({ by: ['author'], where: { project: project.id, deletedAt: null, ...(sprint && { taskRef: { sprint } }) }, _count: { _all: true } }),
    prisma.taskIssue.groupBy({ by: ['owner', 'status'], where: { project: project.id, owner: { not: null } }, _count: { _all: true } }),
  ]);
  const parents = new Set(tasks.filter((t) => t.parent).map((t) => t.parent));
  const leaves = tasks.filter((t) => !parents.has(t.id));
  const totalHours = logs.reduce((sum, l) => sum + (l._sum.hours || 0), 0);
  const rows = members.map(({ user, role, userRef }) => {
    const mine = leaves.filter((t) => (t.contributors.length ? t.contributors.some((c) => c.user === user) : t.assignee === user));
    const done = mine.filter((t) => t.status === 'done');
    const late = done.filter((t) => t.dueDate && t.completedAt && t.completedAt > t.dueDate);
    const overdue = mine.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < new Date());
    const planned = mine.reduce((sum, t) => sum + (t.contributors.length ? t.contributors.find((c) => c.user === user)?.plannedHours || 0 : t.estimateHours || 0), 0);
    const log = logs.find((l) => l.user === user);
    const loggedHours = log?._sum.hours || 0;
    return {
      user: userRef, role,
      assigned: mine.length, done: done.length, doneOnTime: done.length - late.length, doneLate: late.length, overdue: overdue.length,
      plannedHours: planned, loggedHours, logDays: log?._count._all || 0,
      sharePct: totalHours ? Math.round((loggedHours / totalHours) * 100) : 0,
      comments: comments.find((c) => c.author === user)?._count._all || 0,
      issuesResolved: issues.find((i) => i.owner === user && i.status === 'resolved')?._count._all || 0,
    };
  });
  // Xếp theo tên: đây là số liệu làm bằng chứng, không phải bảng xếp hạng.
  rows.sort((a, b) => a.user.name.localeCompare(b.user.name, 'vi'));
  return { rows, totalHours, totalTasks: leaves.length, unassigned: leaves.filter((t) => !t.assignee && !t.contributors.length).length };
}

const sprintQuery = async (req) => {
  if (!req.query.sprint) return undefined;
  const sprint = await findSprint(prisma, req.pa.project.id, String(req.query.sprint));
  return sprint.name;
};

router.get('/projects/:projectId/contributions', middlewareProject(), async (req, res) => {
  res.json(await contributions(req.pa.project, { sprint: await sprintQuery(req) }));
});

router.get('/projects/:projectId/contributions.csv', middlewareProject(), async (req, res) => {
  const { rows } = await contributions(req.pa.project, { sprint: await sprintQuery(req) });
  const csv = [
    ['Thành viên', 'Email', 'Vai trò dự án', 'Việc được giao', 'Đã xong', 'Xong đúng hạn', 'Xong trễ', 'Đang quá hạn', 'Giờ phân bổ', 'Giờ đã ghi', 'Số ngày ghi nhật ký', 'Tỷ trọng giờ (%)', 'Bình luận', 'Vấn đề đã xử lý'],
    ...rows.map((r) => [r.user.name, r.user.email, r.role, r.assigned, r.done, r.doneOnTime, r.doneLate, r.overdue, r.plannedHours, r.loggedHours, r.logDays, r.sharePct, r.comments, r.issuesResolved]),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="dong-gop-thanh-vien.csv"');
  res.send(toCsv(csv));
});

export default router;
