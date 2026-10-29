import { Router } from 'express';
import { z } from 'zod';
import { USER, countBy, ilike, isId, nextSeq, populate, populateAll, prisma, subtaskCounts } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { assertManage, taskPermissions, assertTaskStatus, assertWrite, middlewareProject, projectAccess, taskAccess } from '../middleware/access.js';
import { logActivityIn, logTaskChanges } from '../services/activity.js';
import { withWorkspaceLock } from '../services/membership.js';
import { notify } from '../services/notify.js';
import { emitProject } from '../services/realtime.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../utils/http.js';
import { plainText } from '../utils/security.js';
import { BUSINESS_TIMEZONE, isDateInput, parseDate } from '../utils/dates.js';

const router = Router();
router.use(requireAuth);

export const STATUS_VI = { todo: 'Cần làm', in_progress: 'Đang thực hiện', review: 'Đang kiểm duyệt', done: 'Hoàn thành' };
export const PRIORITY_VI = { low: 'Thấp', medium: 'Trung bình', high: 'Cao' };

const optDate = z.union([z.string(), z.null()]).refine((s) => s === null || s === '' || isDateInput(s), 'Ngày không hợp lệ; thời điểm phải có múi giờ');

const taskFields = {
  title: z.string({ required_error: 'Vui lòng nhập tên công việc' }).trim().min(1, 'Vui lòng nhập tên công việc').max(200),
  description: z.string().max(20000),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(300)).max(30),
  status: z.enum(['todo', 'in_progress', 'review', 'done']),
  priority: z.enum(['low', 'medium', 'high']),
  assignee: z.string().nullable(),
  dueDate: optDate,
  estimateHours: z.number().min(0).max(1000).nullable(),
  remainingHours: z.number().min(0).max(1000).nullable(),
  spentHours: z.number().min(0).max(1000),
  labels: z.array(z.string().trim().min(1).max(40)).max(20),
  sprint: z.string().max(60),
  checklist: z.array(z.object({ text: z.string().trim().min(1).max(300), done: z.boolean().default(false) })).max(50),
};

const STALE_MSG = 'Công việc vừa được người khác cập nhật. Dữ liệu đã được tải lại.';

/** Nạp người nhận/người tạo/phụ thuộc + đếm việc con, bình luận, tệp – tất cả chạy song song trong một lượt */
async function enrich(tasks, access, userId) {
  const permissions = access ? new Map(tasks.map((t) => [t.id, taskPermissions(access, userId, t)])) : null;
  const ids = tasks.map((t) => t.id);
  const [, subs, comments, files] = await Promise.all([
    populateAll(tasks, [
      ['assignee', 'user', USER],
      ['creator', 'user', USER],
      ['blockedBy', 'task', { key: true, title: true, status: true, dueDate: true, assignee: true }],
    ]),
    subtaskCounts(ids),
    countBy('comment', 'task', { task: { in: ids } }),
    countBy('document', 'task', { task: { in: ids } }),
  ]);
  return tasks.map((t) => ({
    ...t,
    ...(permissions && { permissions: permissions.get(t.id) }),
    subtasks: subs[t.id] || { total: 0, done: 0 },
    commentCount: comments[t.id] || 0,
    fileCount: files[t.id] || 0,
    isBlocked: (t.blockedBy || []).some((b) => b && b.status !== 'done'),
  }));
}

async function loadTask(id) {
  const t = await prisma.task.findUnique({ where: { deletedAt: null, id } });
  if (!t) throw notFound('Không tìm thấy công việc');
  return t ? (await enrich([t]))[0] : null;
}

async function assertAssignee(project, assignee, db = prisma) {
  if (assignee && !project.members.includes(assignee)) {
    throw badRequest('Người nhận phải là thành viên của dự án', { fields: { assignee: 'Chỉ thành viên của dự án mới được giao' } });
  }
  if (assignee) {
    const member = await db.membership.findUnique({ where: { workspace_user: { workspace: project.workspace, user: assignee } } });
    const pm = await db.projectMember.findUnique({ where: { project_user: { project: project.id, user: assignee } } });
    if (!member || member.role === 'viewer' || !pm || pm.role === 'viewer') throw badRequest('Người nhận phải là thành viên có quyền làm việc trong dự án');
  }
}

const listParam = (v, allowed) =>
  String(v)
    .split(',')
    .filter((x) => allowed.includes(x));

// ---------- Bảng công việc ----------
router.get('/projects/:projectId/tasks', middlewareProject(), async (req, res) => {
  const where = { project: req.pa.project.id, parent: null };
  const { assignee, priority, search } = req.query;
  if (assignee === 'me') where.assignee = req.user.id;
  else if (isId(assignee)) where.assignee = assignee;
  if (priority) where.priority = { in: listParam(priority, ['low', 'medium', 'high']) };
  if (search) where.OR = [{ title: ilike(search) }, { key: ilike(search) }];
  const tasks = await prisma.task.findMany({ where: { ...where, deletedAt: null }, orderBy: [{ order: 'asc' }, { number: 'asc' }] });
  res.json({ tasks: await enrich(tasks, req.pa, req.user.id) });
});

router.get('/projects/:projectId/calendar', middlewareProject(), async (req, res) => {
  if ((req.query.from && !isDateInput(req.query.from)) || (req.query.to && !isDateInput(req.query.to))) throw badRequest('Khoảng ngày không hợp lệ');
  const from = req.query.from ? parseDate(req.query.from, req.user.timezone) : new Date(Date.now() - 31 * 86400000);
  const to = req.query.to ? parseDate(req.query.to, req.user.timezone, true) : new Date(Date.now() + 62 * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) throw badRequest('Khoảng ngày không hợp lệ');
  const where = { project: req.pa.project.id, dueDate: { gte: from, lte: to } };
  if (isId(req.query.assignee)) where.assignee = req.query.assignee;
  if (req.query.status) where.status = { in: listParam(req.query.status, Object.keys(STATUS_VI)) };
  // Chuỗi phụ thuộc trong dự án để vẽ panel "Phụ thuộc công việc"
  const [tasks, deps] = await Promise.all([
    prisma.task.findMany({ where: { ...where, deletedAt: null }, orderBy: { dueDate: 'asc' } }),
    prisma.task.findMany({
      where: { deletedAt: null, project: req.pa.project.id, NOT: { blockedBy: { isEmpty: true } } },
      select: { id: true, key: true, title: true, status: true, dueDate: true, blockedBy: true, assignee: true },
    }),
  ]);
  const [enriched] = await Promise.all([
    enrich(tasks, req.pa, req.user.id),
    populateAll(deps, [
      ['blockedBy', 'task', { key: true, title: true, status: true, dueDate: true }],
      ['assignee', 'user', USER],
    ]),
  ]);
  res.json({ tasks: enriched, dependencies: deps });
});

router.post('/projects/:projectId/tasks', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  const body = parse(
    z.object({
      ...Object.fromEntries(Object.entries(taskFields).map(([k, v]) => [k, k === 'title' ? v : v.optional()])),
      parent: z.string().optional(),
      blockedBy: z.array(z.string()).optional(),
    }),
    req.body,
  );
  if (body.dueDate !== undefined) body.dueDate = body.dueDate ? parseDate(body.dueDate, req.user.timezone, true) : null;
  const { task, parent, project } = await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const access = await projectAccess(req.user.id, req.pa.project.id, tx);
    assertManage(access);
    assertTaskStatus(access, body.status);
    const project = access.project;
    await assertAssignee(project, body.assignee, tx);
    let parent = null;
    if (body.parent) {
      parent = isId(body.parent) ? await tx.task.findFirst({ where: { deletedAt: null, id: body.parent, project: project.id } }) : null;
      if (!parent) throw badRequest('Công việc cha không thuộc dự án');
      if (parent.parent) throw badRequest('Công việc con chỉ được tối đa 1 cấp');
    }
    const { blockedBy, ...fields } = body;
    // Kiểm tra phụ thuộc trước khi cấp số thứ tự để lỗi không làm nhảy số
    const deps = { id: null, project: project.id, blockedBy: [] };
    for (const dep of blockedBy || []) await addDependency(deps, dep, tx);
    const number = await nextSeq(`task:${project.id}`, tx);
    // Không tự suy diễn deadline: thiếu ngày thì để trống
    const task = await tx.task.create({
      data: {
        ...fields,
        blockedBy: deps.blockedBy,
        description: plainText(body.description || '', 20000),
        dueDate: body.dueDate ?? null,
        remainingHours: body.remainingHours ?? body.estimateHours ?? null,
        workspace: project.workspace,
        project: project.id,
        number,
        key: `${project.keyPrefix}-${number}`,
        creator: req.user.id,
        parent: parent?.id ?? null,
        sprint: body.sprint ?? project.sprint?.name ?? '',
        order: Date.now(),
        completedAt: body.status === 'done' ? new Date() : null,
        reviewSince: body.status === 'review' ? new Date() : null,
      },
    });
    await logActivityIn(tx, {
      workspace: task.workspace,
      project: task.project,
      actor: req.user.id,
      action: 'Tạo công việc',
      entityType: 'task',
      entityId: task.id,
      entityLabel: `${task.key} ${task.title}`,
    });
    return { task, parent, project };
  });
  const [full, parentFull] = await Promise.all([
    loadTask(task.id),
    parent && loadTask(parent.id),
    task.assignee &&
      notify({
        user: task.assignee,
        actor: req.user.id,
        type: 'assigned',
        workspace: task.workspace,
        project: task.project,
        task: task.id,
        text: `${req.user.name} đã giao cho bạn ${task.key} ${task.title}`,
        dedupeKey: `assigned:${task.id}:${task.assignee}`,
      }),
  ]);
  emitProject(project.id, 'task:changed', { task: full });
  if (parentFull) emitProject(project.id, 'task:changed', { task: parentFull });
  res.status(201).json({ task: full });
});

// ---------- Chi tiết ----------
router.get('/tasks/:id', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  const { task, canWrite, canManage, role, project, projectRole } = access;
  // Mỗi phần tải song song rồi tự nạp dữ liệu liên quan – tổng cộng 2 lượt đi-về tới DB
  const [[full], subtasks, blocking, files, activity, parent] = await Promise.all([
    enrich([{ ...task }]),
    prisma.task.findMany({ where: { deletedAt: null, parent: task.id }, orderBy: { number: 'asc' } }).then((r) => populate(r, 'assignee', 'user', USER)),
    prisma.task.findMany({ where: { deletedAt: null, blockedBy: { has: task.id } }, select: { id: true, key: true, title: true, status: true, dueDate: true } }),
    prisma.document.findMany({ where: { task: task.id }, omit: { storageKey: true }, orderBy: { createdAt: 'desc' } }).then((r) => populate(r, 'uploadedBy', 'user', USER)),
    prisma.activity.findMany({ where: { entityType: 'task', entityId: task.id }, orderBy: { createdAt: 'desc' }, take: 50 }).then((r) => populate(r, 'actor', 'user', USER)),
    task.parent ? prisma.task.findUnique({ where: { deletedAt: null, id: task.parent }, select: { id: true, key: true, title: true } }) : null,
  ]);
  res.json({
    task: full,
    subtasks,
    blocking,
    parent,
    files,
    activity,
    access: { ...taskPermissions(access, req.user.id), canWrite, canManage, role, projectRole, archived: project.status === 'archived' },
  });
});

const ACTIVITY_LABELS = {
  status: (v) => STATUS_VI[v] || v,
  priority: (v) => PRIORITY_VI[v] || v,
  dueDate: (v) => (v ? new Date(v).toLocaleString('vi-VN', { timeZone: BUSINESS_TIMEZONE }) : 'Chưa đặt'),
};

/**
 * Cập nhật có kiểm tra version ngay trong câu UPDATE (… WHERE id = ? AND version = ?):
 * hai người cùng sửa thì người sau nhận 409 kèm bản mới để UI tải lại, không ghi đè lẫn nhau.
 */
async function applyUpdate(req, before, project, patch) {
  const task = await withWorkspaceLock(project.workspace, async (tx) => {
    const access = await taskAccess(req.user.id, before.id, tx);
    assertWrite(access);
    if (access.task.version !== before.version) throw conflict(STALE_MSG, { task: await loadTask(before.id) });
    const permissions = taskPermissions(access, req.user.id);
    if (!permissions.canUpdateProgress) throw forbidden('Chỉ được cập nhật công việc được giao cho mình');
    if (!access.canManage && Object.keys(patch).some((k) => !['status', 'order', 'remainingHours'].includes(k))) throw forbidden('Chỉ PM được sửa nội dung công việc');
    assertTaskStatus(access, patch.status, access.task.status);
    if (patch.status && !permissions.allowedStatuses.includes(patch.status)) throw forbidden('Chuyển trạng thái không hợp lệ');
    if ((patch.status ?? access.task.status) === 'done') patch.remainingHours = 0;
    else if (access.task.status === 'done' && patch.status) patch.remainingHours = patch.remainingHours ?? null;
    if (patch.assignee !== undefined) await assertAssignee(access.project, patch.assignee, tx);
    if (patch.description !== undefined) patch.description = plainText(patch.description, 20000);
    if (patch.status && patch.status !== before.status) {
      patch.completedAt = patch.status === 'done' ? new Date() : null;
      patch.reviewSince = patch.status === 'review' ? new Date() : null;
    }
    // UPDATE … RETURNING: cập nhật và lấy bản mới trong cùng một câu lệnh
    const [task] = await tx.task.updateManyAndReturn({ where: { id: before.id, version: before.version }, data: { ...patch, version: { increment: 1 } } });
    if (!task) throw conflict(STALE_MSG, { task: await loadTask(before.id) });
    await logTaskChanges({ task, actor: req.user.id, before, after: task, labels: ACTIVITY_LABELS }, tx);
    return task;
  });

  const notifications = [];
  if (task.assignee && task.assignee !== before.assignee) {
    notifications.push({
      user: task.assignee,
      type: 'assigned',
      text: `${req.user.name} đã giao cho bạn ${task.key} ${task.title}`,
      dedupeKey: `assigned:${task.id}:${task.assignee}:${task.version}`,
    });
  }
  if (patch.status && patch.status !== before.status) {
    for (const u of new Set([task.assignee, task.creator].filter(Boolean))) {
      notifications.push({
        user: u,
        type: 'status',
        text: `${req.user.name} đã chuyển ${task.key} sang ${STATUS_VI[task.status]}`,
        dedupeKey: `status:${task.id}:${task.version}`,
      });
    }
  }
  // Nhật ký, thông báo và tải lại công việc (+ việc cha) chạy song song
  const [full, parentFull] = await Promise.all([
    loadTask(task.id),
    task.parent && loadTask(task.parent),
    ...notifications.map((n) => notify({ ...n, actor: req.user.id, workspace: task.workspace, project: task.project, task: task.id })),
  ]);
  emitProject(task.project, 'task:changed', { task: full });
  if (parentFull) emitProject(task.project, 'task:changed', { task: parentFull });
  return full;
}

router.patch('/tasks/:id', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  assertWrite(access);
  const body = parse(z.object({ ...Object.fromEntries(Object.entries(taskFields).map(([k, v]) => [k, v.optional()])), version: z.number().int().min(1) }), req.body);
  if (body.dueDate !== undefined) body.dueDate = body.dueDate ? parseDate(body.dueDate, req.user.timezone, true) : null;
  const { version, ...patch } = body;
  if (version !== access.task.version) throw conflict(STALE_MSG, { task: await loadTask(access.task.id) });
  res.json({ task: await applyUpdate(req, access.task, access.project, patch) });
});

// Kéo thả trên Kanban
router.post('/tasks/:id/move', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  if (access.role === 'viewer') throw forbidden('Viewer không được kéo thả công việc');
  assertWrite(access);
  const body = parse(z.object({ status: taskFields.status, order: z.number(), version: z.number().int() }), req.body);
  if (body.version !== access.task.version) throw conflict('Công việc vừa được người khác cập nhật. Bảng đã được tải lại.', { task: await loadTask(access.task.id) });
  const task = await applyUpdate(req, access.task, access.project, { status: body.status, order: body.order });
  res.json({ task });
});

router.delete('/tasks/:id', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  assertManage(access);
  const { task, ids } = await withWorkspaceLock(access.project.workspace, async (tx) => {
    const fresh = await taskAccess(req.user.id, access.task.id, tx);
    assertManage(fresh);
    const { task } = fresh;
    const children = await tx.task.findMany({ where: { deletedAt: null, parent: task.id }, select: { id: true } });
    if (children.length && req.query.confirm !== 'true') {
      throw conflict(`Công việc có ${children.length} công việc con. Xác nhận để xóa tất cả.`, { code: 'CONFIRM_REQUIRED', children: children.length });
    }
    const ids = [task.id, ...children.map((c) => c.id)];
    // Giữ task/bình luận để truy vết; gỡ phụ thuộc và giữ tệp ở thư viện dự án.
    const dependents = await tx.task.findMany({ where: { deletedAt: null, blockedBy: { hasSome: ids } }, select: { id: true, blockedBy: true } });
    for (const d of dependents) await tx.task.update({ where: { id: d.id }, data: { blockedBy: d.blockedBy.filter((b) => !ids.includes(b)), version: { increment: 1 } } });
    await tx.document.updateMany({ where: { task: { in: ids } }, data: { task: null } });
    await tx.task.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: new Date(), version: { increment: 1 } } });
    await logActivityIn(tx, {
      workspace: task.workspace,
      project: task.project,
      actor: req.user.id,
      action: 'Xóa công việc',
      entityType: 'task',
      entityId: task.id,
      entityLabel: `${task.key} ${task.title}`,
      after: { deletedTaskIds: ids },
    });
    return { task, ids };
  });
  const parentFull = task.parent && (await loadTask(task.parent));
  for (const id of ids) emitProject(task.project, 'task:deleted', { taskId: id });
  if (parentFull) emitProject(task.project, 'task:changed', { task: parentFull });
  emitProject(task.project, 'board:refresh', {});
  res.json({ ok: true, deleted: ids.length });
});

// ---------- Phụ thuộc ----------
async function addDependency(task, depId, db = prisma) {
  if (depId === task.id) throw badRequest('Công việc không thể phụ thuộc vào chính nó');
  if (!isId(depId)) throw notFound('Không tìm thấy công việc phụ thuộc');
  // Một truy vấn: lấy việc phụ thuộc + kiểm tra chu trình bằng CTE đệ quy
  // (duyệt mọi việc mà dep đang chờ; nếu gặp lại task => vòng lặp)
  const [dep] = await db.$queryRaw`
    WITH RECURSIVE chain(id) AS (
      SELECT ${depId}::uuid
      UNION
      SELECT unnest(t."blockedBy") FROM tasks t JOIN chain c ON t.id = c.id WHERE t.deleted_at IS NULL
    )
    SELECT d.project_id AS project, d.key,
           ${task.id}::uuid IN (SELECT id FROM chain) AS "cycle"
    FROM tasks d WHERE d.id = ${depId}::uuid AND d.deleted_at IS NULL`;
  if (!dep) throw notFound('Không tìm thấy công việc phụ thuộc');
  if (dep.project !== task.project) throw badRequest('Chỉ liên kết được công việc trong cùng dự án');
  if (dep.cycle) throw badRequest('Không thể liên kết: tạo vòng lặp phụ thuộc', { code: 'CYCLE' });
  if (!task.blockedBy.includes(depId)) task.blockedBy = [...task.blockedBy, depId];
  return dep;
}

router.post('/tasks/:id/dependencies', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  assertManage(access);
  const { blockedBy } = parse(z.object({ blockedBy: z.string() }), req.body);
  const task = await withWorkspaceLock(access.project.workspace, async (tx) => {
    const fresh = await taskAccess(req.user.id, access.task.id, tx);
    assertManage(fresh);
    const task = { ...fresh.task };
    const dep = await addDependency(task, blockedBy, tx);
    await tx.task.update({ where: { id: task.id }, data: { blockedBy: task.blockedBy, version: { increment: 1 } } });
    await logActivityIn(tx, {
      workspace: task.workspace,
      project: task.project,
      actor: req.user.id,
      action: 'Thêm phụ thuộc',
      entityType: 'task',
      entityId: task.id,
      entityLabel: `${task.key} ${task.title}`,
      after: `Bị chặn bởi ${dep.key}`,
    });
    return task;
  });
  const full = await loadTask(task.id);
  emitProject(task.project, 'task:changed', { task: full });
  res.json({ task: full });
});

router.delete('/tasks/:id/dependencies/:depId', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  assertManage(access);
  const task = await withWorkspaceLock(access.project.workspace, async (tx) => {
    const fresh = await taskAccess(req.user.id, access.task.id, tx);
    assertManage(fresh);
    const task = fresh.task;
    await tx.task.update({ where: { id: task.id }, data: { blockedBy: task.blockedBy.filter((b) => b !== req.params.depId), version: { increment: 1 } } });
    await logActivityIn(tx, {
      workspace: task.workspace,
      project: task.project,
      actor: req.user.id,
      action: 'Gỡ phụ thuộc',
      entityType: 'task',
      entityId: task.id,
      entityLabel: `${task.key} ${task.title}`,
      before: task.blockedBy,
      after: task.blockedBy.filter((b) => b !== req.params.depId),
    });
    return task;
  });
  const full = await loadTask(task.id);
  emitProject(task.project, 'task:changed', { task: full });
  res.json({ task: full });
});

// ---------- Bình luận & nhắc tên ----------
router.get('/tasks/:id/comments', async (req, res) => {
  const { task } = await taskAccess(req.user.id, req.params.id);
  const comments = await prisma.comment.findMany({ where: { task: task.id }, orderBy: { createdAt: 'asc' } });
  await populateAll(comments, [
    ['author', 'user', USER],
    ['mentions', 'user', USER],
  ]);
  res.json({ comments });
});

async function resolveMentions(project, body, explicit = [], db = prisma) {
  const members = await db.user.findMany({ where: { id: { in: project.members } }, select: { id: true, name: true } });
  const ids = new Set(explicit.filter((id) => members.some((m) => m.id === id)));
  for (const m of members) if (body.includes(`@${m.name}`)) ids.add(m.id); // chỉ người trong dự án
  return [...ids];
}

const commentAccess = async (req, db = prisma) => {
  const comment = isId(req.params.id) ? await db.comment.findUnique({ where: { id: req.params.id } }) : null;
  if (!comment) throw notFound('Không tìm thấy bình luận');
  return { comment, access: await taskAccess(req.user.id, comment.task, db) };
};

router.post('/tasks/:id/comments', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  assertWrite(access);
  const { body: raw, mentions: explicit } = parse(z.object({ body: z.string().min(1, 'Nội dung trống').max(5000), mentions: z.array(z.string()).default([]) }), req.body);
  const body = plainText(raw);
  if (!body) throw badRequest('Nội dung trống');
  const { full, mentions, task } = await withWorkspaceLock(access.project.workspace, async (tx) => {
    const fresh = await taskAccess(req.user.id, req.params.id, tx);
    assertWrite(fresh);
    const mentions = await resolveMentions(fresh.project, body, explicit, tx);
    const full = await tx.comment.create({ data: { task: fresh.task.id, project: fresh.project.id, author: req.user.id, body, mentions } });
    return { full, mentions, task: fresh.task };
  });
  const base = { actor: req.user.id, workspace: task.workspace, project: task.project, task: task.id, excerpt: body.slice(0, 200) };
  await Promise.all([
    populateAll(full, [
      ['author', 'user', USER],
      ['mentions', 'user', USER],
    ]),
    ...mentions.map((u) => notify({ ...base, user: u, type: 'mentioned', text: `${req.user.name} đã nhắc đến bạn trong ${task.key}`, dedupeKey: `mention:${full.id}:${u}` })),
    task.assignee &&
      !mentions.includes(task.assignee) &&
      notify({ ...base, user: task.assignee, type: 'comment', text: `${req.user.name} đã bình luận trong ${task.key}`, dedupeKey: `comment:${full.id}` }),
  ]);
  emitProject(task.project, 'comment:new', { taskId: task.id, comment: full });
  res.status(201).json({ comment: full });
});

router.patch('/comments/:id', async (req, res) => {
  const { comment, access } = await commentAccess(req);
  if (comment.author !== req.user.id) throw forbidden('Chỉ được sửa bình luận của mình');
  assertWrite(access);
  const { body: raw } = parse(z.object({ body: z.string().min(1).max(5000) }), req.body);
  const body = plainText(raw);
  if (!body) throw badRequest('Nội dung trống');
  const full = await withWorkspaceLock(access.project.workspace, async (tx) => {
    const fresh = await commentAccess(req, tx);
    assertWrite(fresh.access);
    return tx.comment.update({ where: { id: comment.id }, data: { body, mentions: await resolveMentions(fresh.access.project, body, [], tx), editedAt: new Date() } });
  });
  await populateAll(full, [
    ['author', 'user', USER],
    ['mentions', 'user', USER],
  ]);
  emitProject(access.project.id, 'comment:updated', { taskId: comment.task, comment: full });
  res.json({ comment: full });
});

router.delete('/comments/:id', async (req, res) => {
  const { comment, access } = await commentAccess(req);
  if (comment.author !== req.user.id) throw forbidden('Chỉ được xóa bình luận của mình');
  await withWorkspaceLock(access.project.workspace, async (tx) => {
    assertWrite((await commentAccess(req, tx)).access);
    await tx.comment.delete({ where: { id: comment.id } });
    await logActivityIn(tx, {
      workspace: access.task.workspace,
      project: access.project.id,
      actor: req.user.id,
      action: 'Xóa bình luận',
      entityType: 'comment',
      entityId: access.task.id,
      entityLabel: `${access.task.key} ${access.task.title}`,
      before: '(nội dung đã xóa)',
    });
  });
  emitProject(access.project.id, 'comment:deleted', { taskId: comment.task, commentId: comment.id });
  res.json({ ok: true });
});

export { loadTask, enrich, addDependency };
export default router;
