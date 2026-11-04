import { Router } from 'express';
import { z } from 'zod';
import { prisma, isId } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { assertManage, assertWrite, middlewareProject, middlewareWorkspace, projectAccess, taskAccess, taskPermissions } from '../middleware/access.js';
import { withWorkspaceLock } from '../services/membership.js';
import { logActivityIn } from '../services/activity.js';
import { emitProject } from '../services/realtime.js';
import { capacityWeek, currentCapacityWeek } from '../services/capacity.js';
import { badRequest, conflict, forbidden, notFound, pagination, parse } from '../utils/http.js';
import { dateKey, isCalendarDate, parseDate } from '../utils/dates.js';
import { plainText } from '../utils/security.js';

const router = Router();
router.use(requireAuth);
const person = { id: true, name: true, email: true };
const version = z.number().int().min(0);
const hours = z.number().finite().min(0).max(1000);
const text = (max) => z.string().trim().max(max).transform((s) => plainText(s, max));
const requiredText = (max) => text(max).refine((s) => s.trim().length > 0, 'Vui lòng nhập nội dung');
const date = z.string().refine(isCalendarDate, 'Ngày không hợp lệ');
const assertVersion = (given, actual) => { if (given !== actual) throw conflict('Dữ liệu đã thay đổi. Hãy tải lại trước khi lưu.'); };
const audit = (tx, access, user, action, after) => logActivityIn(tx, { workspace: access.project.workspace, project: access.project.id, actor: user, entityType: 'task', entityId: access.task.id, entityLabel: `${access.task.key} ${access.task.title}`, action, after });
async function projectWorkers(tx, project, ids, allowViewer = false) {
  const unique = [...new Set(ids)];
  const count = await tx.projectMember.count({ where: { project: project.id, user: { in: unique }, ...(allowViewer ? {} : { role: { not: 'viewer' } }), userRef: { isLocked: false, memberships: { some: { workspace: project.workspace, ...(allowViewer ? {} : { role: { not: 'viewer' } }) } } } } });
  if (count !== unique.length) throw badRequest('Chỉ chọn thành viên hiện tại có quyền phù hợp trong dự án');
}
const taskChanged = async (access) => { await emitProject(access.project.id, 'board:refresh', {}); };

router.get('/projects/:projectId/delivery-timeline', middlewareProject(), async (req, res) => {
  const { page, limit } = pagination(req.query, 20);
  const search = parse(z.string().max(200), req.query.search || '');
  const where = { project: req.pa.project.id, deletedAt: null, ...(search && { OR: [{ title: { contains: search, mode: 'insensitive' } }, { key: { contains: search, mode: 'insensitive' } }] }) };
  const [tasks, total] = await Promise.all([
    prisma.task.findMany({ where, select: { id: true, key: true, title: true, status: true, workType: true, priority: true, parent: true, progressPct: true, estimateHours: true, spentHours: true, remainingHours: true, plannedStartDate: true, dueDate: true, actualStartDate: true, actualEndDate: true, assigneeRef: { select: person } }, orderBy: [{ priority: 'desc' }, { number: 'asc' }], skip: (page - 1) * limit, take: limit }),
    prisma.task.count({ where }),
  ]);
  res.json({ tasks, total, page, limit });
});

router.get('/tasks/:id/delivery', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  const { page, limit } = pagination(req.query);
  const day = req.query.date ? parse(date, req.query.date) : dateKey(new Date(), req.user.timezone);
  const [contributors, updates, total, issues, sums, ownUpdate, issueTotal, childCount] = await Promise.all([
    prisma.taskContributor.findMany({ where: { task: access.task.id }, include: { userRef: { select: person } }, orderBy: { user: 'asc' } }),
    prisma.taskDailyUpdate.findMany({ where: { task: access.task.id }, include: { userRef: { select: person } }, orderBy: [{ workDate: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
    prisma.taskDailyUpdate.count({ where: { task: access.task.id } }),
    prisma.taskIssue.findMany({ where: { task: access.task.id }, include: { reporterRef: { select: person }, ownerRef: { select: person } }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 100 }),
    prisma.taskDailyUpdate.groupBy({ by: ['user'], where: { task: access.task.id }, _sum: { hours: true } }),
    prisma.taskDailyUpdate.findUnique({ where: { task_user_workDate: { task: access.task.id, user: req.user.id, workDate: new Date(`${day}T00:00:00Z`) } } }),
    prisma.taskIssue.count({ where: { task: access.task.id } }),
    prisma.task.count({ where: { parent: access.task.id, deletedAt: null } }),
  ]);
  res.json({ taskVersion: access.task.version, task: access.task, childCount, contributors, updates, total, page, limit, issues, issueTotal, ownUpdate, loggedHours: sums.reduce((s, r) => s + (r._sum.hours || 0), 0), effortByUser: sums.map((r) => ({ user: r.user, hours: r._sum.hours || 0 })), access: { canManage: access.canManage, canWrite: access.canWrite, canUpdate: taskPermissions(access, req.user.id).canUpdateProgress } });
});

router.put('/tasks/:id/contributors', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  assertManage(access);
  const body = parse(z.object({ version, items: z.array(z.object({ user: z.string().uuid(), responsibility: requiredText(300), plannedHours: hours.refine((n) => n > 0, 'Giờ phân bổ phải lớn hơn 0'), remainingHours: hours }).strict()).max(20) }).strict(), req.body);
  if (new Set(body.items.map((i) => i.user)).size !== body.items.length) throw badRequest('Một người chỉ được phân bổ một lần');
  const plannedHours = body.items.reduce((s, i) => s + i.plannedHours, 0);
  const remainingHours = body.items.reduce((s, i) => s + i.remainingHours, 0);
  if (plannedHours > 1000 || remainingHours > 1000) throw badRequest('Tổng giờ task không được vượt 1000');
  const task = await withWorkspaceLock(access.project.workspace, async (tx) => {
    const current = await taskAccess(req.user.id, access.task.id, tx);
    assertManage(current); assertVersion(body.version, current.task.version);
    if (await tx.task.count({ where: { parent: current.task.id, deletedAt: null } })) throw badRequest('Hãy phân bổ effort ở công việc con để tránh tính trùng task cha');
    await projectWorkers(tx, current.project, body.items.map((i) => i.user));
    if (current.task.assignee && body.items.length && !body.items.some((i) => i.user === current.task.assignee)) throw badRequest('Danh sách phân bổ phải bao gồm người chịu trách nhiệm chính');
    await tx.taskContributor.deleteMany({ where: { task: current.task.id } });
    if (body.items.length) await tx.taskContributor.createMany({ data: body.items.map((i) => ({ ...i, task: current.task.id })) });
    const task = await tx.task.update({ where: { id: current.task.id }, data: { version: { increment: 1 }, ...(body.items.length && { assignee: current.task.assignee || body.items[0].user, estimateHours: plannedHours, remainingHours: current.task.status === 'done' ? 0 : remainingHours }) } });
    await audit(tx, current, req.user.id, 'Phân bổ trách nhiệm và effort', body.items);
    return task;
  });
  await taskChanged(access); res.json({ task });
});

router.put('/tasks/:id/daily-updates/:date', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  const day = parse(date, req.params.date);
  if (day > dateKey(new Date(), req.user.timezone)) throw badRequest('Không ghi nhật ký cho ngày tương lai');
  const body = parse(z.object({ version, taskVersion: version, hours: z.number().finite().min(0).max(24), completed: requiredText(2000), nextStep: text(2000), blockers: text(2000), progressPct: z.number().int().min(0).max(100), remainingHours: hours }).strict(), req.body);
  const update = await withWorkspaceLock(access.project.workspace, async (tx) => {
    const current = await taskAccess(req.user.id, access.task.id, tx);
    if (!taskPermissions(current, req.user.id).canUpdateProgress || current.task.status === 'done') throw forbidden('Chỉ người thực hiện hoặc PM được cập nhật task chưa hoàn thành');
    assertVersion(body.taskVersion, current.task.version);
    if (await tx.task.count({ where: { parent: current.task.id, deletedAt: null } })) throw badRequest('Hãy ghi nhật ký ở công việc con để tránh tính trùng effort');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`worklog:${req.user.id}`}))`;
    const workDate = new Date(`${day}T00:00:00Z`);
    const where = { task_user_workDate: { task: current.task.id, user: req.user.id, workDate } };
    const previous = await tx.taskDailyUpdate.findUnique({ where });
    assertVersion(body.version, previous?.version ?? 0);
    const daily = await tx.taskDailyUpdate.aggregate({ where: { user: req.user.id, workDate }, _sum: { hours: true } });
    if ((daily._sum.hours || 0) - (previous?.hours || 0) + body.hours > 24) throw badRequest('Tổng giờ đã ghi trong một ngày không được vượt 24');
    const { version: _v, taskVersion: _tv, remainingHours, ...fields } = body;
    const update = previous ? await tx.taskDailyUpdate.update({ where, data: { ...fields, version: { increment: 1 } } }) : await tx.taskDailyUpdate.create({ data: { ...fields, task: current.task.id, user: req.user.id, workDate } });
    const contribution = current.task.contributors.find((c) => c.user === req.user.id);
    if (current.task.contributors.length && !contribution) throw forbidden('PM chưa được phân bổ trong task này; hãy phân bổ trước khi ghi effort');
    if (contribution) await tx.taskContributor.update({ where: { task_user: { task: current.task.id, user: req.user.id } }, data: { remainingHours } });
    const aggregate = await tx.taskDailyUpdate.aggregate({ where: { task: current.task.id }, _sum: { hours: true } });
    const allocation = contribution ? await tx.taskContributor.aggregate({ where: { task: current.task.id }, _sum: { remainingHours: true } }) : null;
    const actualStartDate = current.task.actualStartDate || parseDate(day, req.user.timezone);
    if (current.task.actualEndDate && actualStartDate > current.task.actualEndDate) throw badRequest('Ngày nhật ký bắt đầu sau ngày kết thúc thực tế đã ghi');
    await tx.task.update({ where: { id: current.task.id }, data: { actualStartDate, spentHours: current.task.legacySpentHours + (aggregate._sum.hours || 0), remainingHours: allocation ? allocation._sum.remainingHours || 0 : remainingHours, progressPct: body.progressPct, version: { increment: 1 } } });
    await audit(tx, current, req.user.id, previous ? 'Sửa nhật ký hằng ngày' : 'Cập nhật công việc hằng ngày', { day, hours: body.hours, previousHours: previous?.hours ?? 0, progressPct: body.progressPct, remainingHours });
    return update;
  });
  await taskChanged(access); res.json({ update });
});

router.post('/tasks/:id/issues', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  const body = parse(z.object({ title: requiredText(200), severity: z.enum(['low', 'medium', 'high', 'critical']), cause: requiredText(2000), action: requiredText(2000), owner: z.string().uuid().nullable() }).strict(), req.body);
  const issue = await withWorkspaceLock(access.project.workspace, async (tx) => {
    const current = await taskAccess(req.user.id, access.task.id, tx); assertWrite(current);
    if (body.owner) await projectWorkers(tx, current.project, [body.owner]);
    const issue = await tx.taskIssue.create({ data: { ...body, task: current.task.id, reporter: req.user.id } });
    await audit(tx, current, req.user.id, 'Ghi nhận vấn đề gây chậm', body);
    return issue;
  });
  await taskChanged(access); res.status(201).json({ issue });
});

router.patch('/tasks/:id/issues/:issueId', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  const body = parse(z.object({ version, status: z.enum(['open', 'resolved']), resolution: text(2000) }).strict(), req.body);
  if (body.status === 'resolved' && !body.resolution.trim()) throw badRequest('Ghi kết quả xử lý trước khi đóng vấn đề');
  const issue = await withWorkspaceLock(access.project.workspace, async (tx) => {
    const current = await taskAccess(req.user.id, access.task.id, tx); assertWrite(current);
    const found = isId(req.params.issueId) ? await tx.taskIssue.findFirst({ where: { id: req.params.issueId, task: current.task.id } }) : null;
    if (!found) throw notFound();
    if (!current.canManage && found.owner !== req.user.id && found.reporter !== req.user.id) throw forbidden();
    assertVersion(body.version, found.version);
    const issue = await tx.taskIssue.update({ where: { id: found.id }, data: { status: body.status, resolution: body.resolution, version: { increment: 1 } } });
    await audit(tx, current, req.user.id, 'Cập nhật xử lý vấn đề', { issue: issue.id, status: issue.status, resolution: issue.resolution }); return issue;
  });
  await taskChanged(access); res.json({ issue });
});

router.get('/workspaces/:wsId/team-workload', middlewareWorkspace(), async (req, res) => {
  const workspace = req.ws.workspace.id;
  const week = req.query.week || currentCapacityWeek();
  const weekStart = capacityWeek(week);
  const start = parseDate(week); const end = new Date(start.getTime() + 7 * 86400000);
  const projects = await prisma.project.findMany({ where: { workspace, memberships: { some: { user: req.user.id } } }, include: { memberships: { select: { user: true, role: true } } } });
  const ids = projects.map((p) => p.id);
  const [tasks, members, capacities, logs] = await Promise.all([
    prisma.task.findMany({ where: { project: { in: ids }, deletedAt: null }, include: { contributors: true }, orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }] }),
    prisma.membership.findMany({ where: { workspace, user: { in: [...new Set(projects.flatMap((p) => p.memberships.map((m) => m.user)))] } }, include: { userRef: { select: person } } }),
    prisma.weeklyCapacity.findMany({ where: { workspace, weekStart } }),
    prisma.taskDailyUpdate.findMany({ where: { taskRef: { project: { in: ids }, deletedAt: null }, workDate: { gte: weekStart, lt: new Date(weekStart.getTime() + 7 * 86400000) } }, select: { user: true, hours: true, task: true } }),
  ]);
  const people = members.map((m) => {
    const assigned = tasks.filter((t) => t.contributors.length ? t.contributors.some((c) => c.user === m.user) : t.assignee === m.user);
    const open = assigned.filter((t) => t.status !== 'done');
    const scheduled = open.filter((t) => projects.find((p) => p.id === t.project)?.status === 'active' && !tasks.some((c) => c.parent === t.id) && t.dueDate && t.dueDate < end && (!t.plannedStartDate || t.plannedStartDate < end));
    const remaining = (t) => t.contributors.length ? t.contributors.find((c) => c.user === m.user)?.remainingHours ?? 0 : t.remainingHours ?? (t.estimateHours == null ? null : Math.max(0, t.estimateHours - t.spentHours));
    const load = scheduled.reduce((sum, t) => sum + remaining(t), 0);
    const available = capacities.find((c) => c.user === m.user)?.hours ?? m.weeklyHours;
    return { user: m.userRef, available, remainingHours: load, missingEffortCount: scheduled.filter((t) => remaining(t) == null).length, loadPct: available ? Math.round(load / available * 100) : load ? null : 0, overloaded: load > available, loggedHours: logs.filter((l) => l.user === m.user).reduce((s, l) => s + l.hours, 0), noDueCount: open.filter((t) => !t.dueDate).length, roleByProject: projects.filter((p) => p.memberships.some((r) => r.user === m.user)).map((p) => ({ id: p.id, name: p.name, role: p.memberships.find((r) => r.user === m.user).role })), tasks: assigned.map((t) => ({ id: t.id, key: t.key, title: t.title, project: t.project, projectName: projects.find((p) => p.id === t.project)?.name, status: t.status, priority: t.priority, workType: t.workType, progressPct: t.progressPct, plannedStartDate: t.plannedStartDate, dueDate: t.dueDate, actualStartDate: t.actualStartDate, actualEndDate: t.actualEndDate, remainingHours: remaining(t) })) };
  });
  res.json({ week, people, scope: 'readable-projects', note: 'Chỉ tổng hợp dự án bạn có quyền xem; không phải tổng tải toàn công ty nếu còn dự án ngoài quyền.' });
});

router.get('/projects/:projectId/meetings', middlewareProject(), async (req, res) => {
  const { page, limit } = pagination(req.query);
  const where = { project: req.pa.project.id };
  const [meetings, total] = await Promise.all([prisma.projectMeeting.findMany({ where, include: { creatorRef: { select: person }, participants: { include: { userRef: { select: person } } } }, orderBy: { startAt: 'desc' }, take: limit, skip: (page - 1) * limit }), prisma.projectMeeting.count({ where })]);
  res.json({ meetings, total, page, limit, canWrite: req.pa.canWrite });
});
const meetingBody = { title: requiredText(200), agenda: text(4000), location: text(500), startAt: z.string().datetime({ offset: true }), endAt: z.string().datetime({ offset: true }), participants: z.array(z.string().uuid()).min(1).max(20) };
async function saveMeeting(req, id = null) {
  const access = await projectAccess(req.user.id, req.params.projectId);
  const body = parse(z.object({ ...meetingBody, ...(id && { version }) }).strict(), req.body);
  const startAt = new Date(body.startAt), endAt = new Date(body.endAt);
  if (endAt <= startAt || endAt - startAt > 86400000) throw badRequest('Cuộc họp phải kết thúc sau bắt đầu, tối đa 24 giờ');
  if (endAt < new Date()) throw badRequest('Không đặt cuộc họp đã kết thúc trong quá khứ');
  const participants = [...new Set([...body.participants, req.user.id])].sort();
  if (participants.length > 20) throw badRequest('Cuộc họp tối đa 20 người bao gồm người tạo');
  const meeting = await withWorkspaceLock(access.project.workspace, async (tx) => {
    const current = await projectAccess(req.user.id, access.project.id, tx); assertWrite(current);
    const existing = id && isId(id) ? await tx.projectMeeting.findFirst({ where: { id, project: current.project.id } }) : null;
    if (id && !existing) throw notFound();
    if (existing) { if (!current.canManage && existing.creator !== req.user.id) throw forbidden(); assertVersion(body.version, existing.version); if (existing.status !== 'scheduled') throw badRequest('Cuộc họp đã hủy'); }
    await projectWorkers(tx, current.project, participants, true);
    for (const user of participants) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting:${user}`}))`;
    const overlapping = await tx.projectMeeting.count({ where: { ...(id && { id: { not: id } }), status: 'scheduled', startAt: { lt: endAt }, endAt: { gt: startAt }, participants: { some: { user: { in: participants } } } } });
    if (overlapping) throw conflict('Một hoặc nhiều người đã có lịch họp trùng thời gian. Hãy chọn khung giờ khác.');
    const data = { title: body.title, agenda: body.agenda, location: body.location, startAt, endAt };
    if (existing) await tx.meetingParticipant.deleteMany({ where: { meeting: id } });
    const meeting = existing ? await tx.projectMeeting.update({ where: { id }, data: { ...data, version: { increment: 1 }, participants: { create: participants.map((user) => ({ user })) } } }) : await tx.projectMeeting.create({ data: { ...data, project: current.project.id, creator: req.user.id, participants: { create: participants.map((user) => ({ user })) } } });
    await logActivityIn(tx, { workspace: current.project.workspace, project: current.project.id, actor: req.user.id, entityType: 'project', entityId: current.project.id, entityLabel: meeting.title, action: existing ? 'Đổi lịch họp' : 'Đặt lịch họp', after: { meeting: meeting.id, startAt, endAt, participants } }); return meeting;
  });
  await emitProject(access.project.id, 'meetings:changed', {}); return meeting;
}
router.post('/projects/:projectId/meetings', async (req, res) => res.status(201).json({ meeting: await saveMeeting(req) }));
router.put('/projects/:projectId/meetings/:meetingId', async (req, res) => res.json({ meeting: await saveMeeting(req, req.params.meetingId) }));
router.post('/projects/:projectId/meetings/:meetingId/cancel', async (req, res) => {
  const access = await projectAccess(req.user.id, req.params.projectId);
  const body = parse(z.object({ version }).strict(), req.body);
  const meeting = await withWorkspaceLock(access.project.workspace, async (tx) => {
    const current = await projectAccess(req.user.id, access.project.id, tx); assertWrite(current);
    const meeting = isId(req.params.meetingId) ? await tx.projectMeeting.findFirst({ where: { id: req.params.meetingId, project: current.project.id } }) : null;
    if (!meeting) throw notFound();
    if (!current.canManage && meeting.creator !== req.user.id) throw forbidden();
    assertVersion(body.version, meeting.version);
    await logActivityIn(tx, { workspace: current.project.workspace, project: current.project.id, actor: req.user.id, action: 'Hủy lịch họp', entityType: 'project', entityId: current.project.id, entityLabel: meeting.title });
    return tx.projectMeeting.update({ where: { id: meeting.id }, data: { status: 'cancelled', version: { increment: 1 } } });
  });
  await emitProject(access.project.id, 'meetings:changed', {}); res.json({ meeting });
});
export default router;
