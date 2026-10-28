import { Router } from 'express';
import { z } from 'zod';
import { USER, countBy, ilike, isId, nextSeq, populate, populateAll, prisma, subtaskCounts } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { assertWrite, assertManage, taskPermissions, middlewareProject, taskAccess } from '../middleware/access.js';
import { logActivity, taskChangeEntries } from '../services/activity.js';
import { notify } from '../services/notify.js';
import { emitProject } from '../services/realtime.js';
import { lockProject } from '../services/project-members.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../utils/http.js';
import { plainText } from '../utils/security.js';

const router = Router();
router.use(requireAuth);

export const STATUS_VI = { todo: 'Cần làm', in_progress: 'Đang thực hiện', review: 'Đang kiểm duyệt', done: 'Hoàn thành' };
export const PRIORITY_VI = { low: 'Thấp', medium: 'Trung bình', high: 'Cao' };

const optDate = z
  .union([z.string(), z.null()])
  .refine((s) => s === null || s === '' || !Number.isNaN(Date.parse(s)), 'Ngày không hợp lệ')
  .transform((s) => (s ? new Date(s) : null));

const taskFields = {
  title: z.string({ required_error: 'Vui lòng nhập tên công việc' }).trim().min(1, 'Vui lòng nhập tên công việc').max(200),
  description: z.string().max(20000),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(300)).max(30),
  status: z.enum(['todo', 'in_progress', 'review', 'done']),
  priority: z.enum(['low', 'medium', 'high']),
  assignee: z.string().nullable(),
  dueDate: optDate,
  estimateHours: z.number().min(0).max(1000).nullable(),
  spentHours: z.number().min(0).max(1000),
  remainingHours: z.number().min(0).max(1000).nullable(),
  labels: z.array(z.string().trim().min(1).max(40)).max(20),
  sprint: z.string().max(60),
  checklist: z.array(z.object({ text: z.string().trim().min(1).max(300), done: z.boolean().default(false) })).max(50),
};

const STALE_MSG = 'Công việc vừa được người khác cập nhật. Dữ liệu đã được tải lại.';

/** Nạp người nhận/người tạo/phụ thuộc + đếm việc con, bình luận, tệp – tất cả chạy song song trong một lượt */
async function enrich(tasks, access, userId) {
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
    subtasks: subs[t.id] || { total: 0, done: 0 },
    commentCount: comments[t.id] || 0,
    fileCount: files[t.id] || 0,
    isBlocked: (t.blockedBy || []).some((b) => b && b.status !== 'done'),
    ...(access && { permissions: taskPermissions(access, userId, { ...t, assignee: t.assignee?.id || t.assignee }) }),
  }));
}

async function loadTask(id) {
  const t = await prisma.task.findUnique({ where: { id } });
  if (!t) return null;
  return (await enrich([t]))[0];
}

async function assertAssignee(project, assignee, client = prisma) {
  if (assignee && !project.members.includes(assignee)) {
    throw badRequest('Người nhận phải là thành viên của dự án', { fields: { assignee: 'Chỉ thành viên của dự án mới được giao' } });
  }
  if (assignee) {
    const member = await client.projectMember.findUnique({ where: { project_user: { project: project.id, user: assignee } } });
    if (!member || member.role === 'viewer') throw badRequest('Không thể giao việc cho Project Viewer');
  }
}

const listParam = (v, allowed) => String(v).split(',').filter((x) => allowed.includes(x));

// ---------- Bảng công việc ----------
router.get('/projects/:projectId/tasks', middlewareProject(), async (req, res) => {
  const where = { project: req.pa.project.id, parent: null };
  const { assignee, priority, search } = req.query;
  if (assignee === 'me') where.assignee = req.user.id;
  else if (isId(assignee)) where.assignee = assignee;
  if (priority) where.priority = { in: listParam(priority, ['low', 'medium', 'high']) };
  if (search) where.OR = [{ title: ilike(search) }, { key: ilike(search) }];
  const tasks = await prisma.task.findMany({ where, orderBy: [{ order: 'asc' }, { number: 'asc' }] });
  res.json({ tasks: await enrich(tasks, req.pa, req.user.id) });
});

router.get('/projects/:projectId/calendar', middlewareProject(), async (req, res) => {
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 31 * 86400000);
  const to = req.query.to ? new Date(req.query.to) : new Date(Date.now() + 62 * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw badRequest('Khoảng ngày không hợp lệ');
  const where = { project: req.pa.project.id, dueDate: { gte: from, lte: to } };
  if (isId(req.query.assignee)) where.assignee = req.query.assignee;
  if (req.query.status) where.status = { in: listParam(req.query.status, Object.keys(STATUS_VI)) };
  // Chuỗi phụ thuộc trong dự án để vẽ panel "Phụ thuộc công việc"
  const [tasks, deps] = await Promise.all([
    prisma.task.findMany({ where, orderBy: { dueDate: 'asc' } }),
    prisma.task.findMany({
      where: { project: req.pa.project.id, NOT: { blockedBy: { isEmpty: true } } },
      select: { id: true, key: true, title: true, status: true, dueDate: true, blockedBy: true, assignee: true },
    }),
  ]);
  const [enriched] = await Promise.all([
    enrich(tasks),
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
  const project = req.pa.project;
  await assertAssignee(project, body.assignee);
  let parent = null;
  if (body.parent) {
    parent = isId(body.parent) ? await prisma.task.findFirst({ where: { id: body.parent, project: project.id } }) : null;
    if (!parent) throw badRequest('Công việc cha không thuộc dự án');
    if (parent.parent) throw badRequest('Công việc con chỉ được tối đa 1 cấp');
  }
  const { blockedBy, ...fields } = body;
  // Kiểm tra phụ thuộc trước khi cấp số thứ tự để lỗi không làm nhảy số
  const deps = { id: null, project: project.id, blockedBy: [] };
  for (const dep of blockedBy || []) await addDependency(deps, dep);
  const number = await nextSeq(`task:${project.id}`);
  // Không tự suy diễn deadline: thiếu ngày thì để trống
  const task = await prisma.$transaction(async (tx) => {
    const current = await lockProject(tx, project.id, req.user.id);
    await assertAssignee(current, body.assignee, tx);
    const created = await tx.task.create({
      data: {
        ...fields,
        blockedBy: deps.blockedBy,
        description: plainText(body.description || '', 20000),
        dueDate: body.dueDate ?? null,
        workspace: project.workspace,
        project: project.id,
        number,
        key: `${project.keyPrefix}-${number}`,
        creator: req.user.id,
        parent: parent?.id ?? null,
        sprint: body.sprint ?? project.sprint?.name ?? '',
        order: Date.now(),
        completedAt: body.status === 'done' ? new Date() : null,
        remainingHours: body.status === 'done' ? 0 : body.remainingHours ?? body.estimateHours ?? null,
        reviewSince: body.status === 'review' ? new Date() : null,
      },
    });
    await tx.activity.create({ data: { workspace: created.workspace, project: created.project, actor: req.user.id, action: 'Tạo công việc', entityType: 'task', entityId: created.id, entityLabel: `${created.key} ${created.title}` } });
    return created;
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
  const { task, canWrite, role, project, projectRole, canManage } = access;
  // Mỗi phần tải song song rồi tự nạp dữ liệu liên quan – tổng cộng 2 lượt đi-về tới DB
  const [[full], subtasks, blocking, files, activity, parent] = await Promise.all([
    enrich([{ ...task }]),
    prisma.task.findMany({ where: { parent: task.id }, orderBy: { number: 'asc' } }).then((r) => populate(r, 'assignee', 'user', USER)),
    prisma.task.findMany({ where: { blockedBy: { has: task.id } }, select: { id: true, key: true, title: true, status: true, dueDate: true } }),
    prisma.document.findMany({ where: { task: task.id }, omit: { storageKey: true }, orderBy: { createdAt: 'desc' } }).then((r) => populate(r, 'uploadedBy', 'user', USER)),
    prisma.activity.findMany({ where: { entityType: 'task', entityId: task.id }, orderBy: { createdAt: 'desc' }, take: 50 }).then((r) => populate(r, 'actor', 'user', USER)),
    task.parent ? prisma.task.findUnique({ where: { id: task.parent }, select: { id: true, key: true, title: true } }) : null,
  ]);
  res.json({
    task: full,
    subtasks,
    blocking,
    parent,
    files,
    activity,
    access: { canWrite, role, projectRole, canManage, ...taskPermissions(access, req.user.id), archived: project.status === 'archived' },
  });
});

const ACTIVITY_LABELS = {
  status: (v) => STATUS_VI[v] || v,
  priority: (v) => PRIORITY_VI[v] || v,
  dueDate: (v) => (v ? new Date(v).toLocaleDateString('vi-VN') : 'Chưa đặt'),
};

/**
 * Cập nhật có kiểm tra version ngay trong câu UPDATE (… WHERE id = ? AND version = ?):
 * hai người cùng sửa thì người sau nhận 409 kèm bản mới để UI tải lại, không ghi đè lẫn nhau.
 */
async function applyUpdate(req, before, project, patch) {
  if (patch.description !== undefined) patch.description = plainText(patch.description, 20000);
  const task = await prisma.$transaction(async (tx) => {
    // Shared with PM/member changes so a concurrent revoke cannot authorize a stale update.
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${project.id}::uuid FOR UPDATE`;
    const current = await tx.project.findUnique({ where: { id: project.id } });
    const member = await tx.projectMember.findUnique({ where: { project_user: { project: project.id, user: req.user.id } } });
    const wsMember = await tx.membership.findUnique({ where: { workspace_user: { workspace: project.workspace, user: req.user.id } } });
    if (!member || !wsMember) throw notFound('Không tìm thấy công việc');
    const access = { project: current, projectRole: wsMember.role === 'viewer' ? 'viewer' : member.role, canWrite: current.status !== 'archived' && wsMember.role !== 'viewer' && member.role !== 'viewer' };
    assertWrite(access);
    if (patch.assignee !== undefined) await assertAssignee(current, patch.assignee, tx);
    const permissions = taskPermissions(access, req.user.id, before);
    if (member.role !== 'pm') {
      if (!permissions.canUpdateProgress) throw forbidden('Member chỉ cập nhật công việc mình nhận và chưa Done');
      if (Object.keys(patch).some((k) => !['status', 'order', 'remainingHours'].includes(k))) throw forbidden('Member chỉ được cập nhật trạng thái, thứ tự và giờ còn lại');
      if (patch.status && !permissions.allowedStatuses.includes(patch.status)) throw forbidden('Chỉ PM được duyệt Done hoặc mở lại công việc');
    }
    if (patch.status && patch.status !== before.status) {
      patch.completedAt = patch.status === 'done' ? new Date() : null;
      patch.reviewSince = patch.status === 'review' ? new Date() : null;
    }
    if (patch.status === 'done') patch.remainingHours = 0;
    if (before.status === 'done' && patch.status && patch.status !== 'done' && patch.remainingHours === undefined) patch.remainingHours = null;
    const [updated] = await tx.task.updateManyAndReturn({ where: { id: before.id, version: before.version }, data: { ...patch, version: { increment: 1 } } });
    if (!updated) throw conflict(STALE_MSG);
    for (const entry of taskChangeEntries({ task: updated, actor: req.user.id, before, after: updated, labels: ACTIVITY_LABELS })) {
      await tx.activity.create({ data: entry });
    }
    return updated;
  }).catch(async (e) => {
    if (e.status === 409) throw conflict(STALE_MSG, { task: await loadTask(before.id) });
    throw e;
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
      notifications.push({ user: u, type: 'status', text: `${req.user.name} đã chuyển ${task.key} sang ${STATUS_VI[task.status]}`, dedupeKey: `status:${task.id}:${task.version}` });
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
  const body = parse(z.object({ ...Object.fromEntries(Object.entries(taskFields).map(([k, v]) => [k, v.optional()])), version: z.number().int() }).strict(), req.body);
  const { version, ...patch } = body;
  if (version !== undefined && version !== access.task.version) throw conflict(STALE_MSG, { task: await loadTask(access.task.id) });
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
  const { task } = access;
  const children = await prisma.task.findMany({ where: { parent: task.id }, select: { id: true } });
  if (children.length && req.query.confirm !== 'true') {
    throw conflict(`Công việc có ${children.length} công việc con. Xác nhận để xóa tất cả.`, { code: 'CONFIRM_REQUIRED', children: children.length });
  }
  const ids = [task.id, ...children.map((c) => c.id)];
  await prisma.$transaction(async (tx) => {
    // Gỡ khỏi danh sách phụ thuộc của việc khác; bình luận xóa theo (CASCADE), tệp đính kèm giữ lại (SET NULL)
    const dependents = await tx.task.findMany({ where: { blockedBy: { hasSome: ids } }, select: { id: true, blockedBy: true } });
    for (const d of dependents) await tx.task.update({ where: { id: d.id }, data: { blockedBy: d.blockedBy.filter((b) => !ids.includes(b)) } });
    await tx.task.deleteMany({ where: { id: { in: ids } } });
  });
  const [, parentFull] = await Promise.all([
    logActivity({ workspace: task.workspace, project: task.project, actor: req.user.id, action: 'Xóa công việc', entityType: 'task', entityId: task.id, entityLabel: `${task.key} ${task.title}` }),
    task.parent && loadTask(task.parent),
  ]);
  for (const id of ids) emitProject(task.project, 'task:deleted', { taskId: id });
  if (parentFull) emitProject(task.project, 'task:changed', { task: parentFull });
  res.json({ ok: true, deleted: ids.length });
});

// ---------- Phụ thuộc ----------
async function addDependency(task, depId) {
  if (depId === task.id) throw badRequest('Công việc không thể phụ thuộc vào chính nó');
  if (!isId(depId)) throw notFound('Không tìm thấy công việc phụ thuộc');
  // Một truy vấn: lấy việc phụ thuộc + kiểm tra chu trình bằng CTE đệ quy
  // (duyệt mọi việc mà dep đang chờ; nếu gặp lại task => vòng lặp)
  const [dep] = await prisma.$queryRaw`
    WITH RECURSIVE chain(id) AS (
      SELECT ${depId}::uuid
      UNION
      SELECT unnest(t."blockedBy") FROM tasks t JOIN chain c ON t.id = c.id
    )
    SELECT d.project_id AS project, d.key,
           ${task.id}::uuid IN (SELECT id FROM chain) AS "cycle"
    FROM tasks d WHERE d.id = ${depId}::uuid`;
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
  const task = { ...access.task };
  const dep = await addDependency(task, blockedBy);
  await prisma.task.update({ where: { id: task.id }, data: { blockedBy: task.blockedBy, version: { increment: 1 } } });
  const [full] = await Promise.all([
    loadTask(task.id),
    logActivity({
      workspace: task.workspace,
      project: task.project,
      actor: req.user.id,
      action: 'Thêm phụ thuộc',
      entityType: 'task',
      entityId: task.id,
      entityLabel: `${task.key} ${task.title}`,
      after: `Bị chặn bởi ${dep.key}`,
    }),
  ]);
  emitProject(task.project, 'task:changed', { task: full });
  res.json({ task: full });
});

router.delete('/tasks/:id/dependencies/:depId', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  assertManage(access);
  const { task } = access;
  await prisma.task.update({ where: { id: task.id }, data: { blockedBy: task.blockedBy.filter((b) => b !== req.params.depId), version: { increment: 1 } } });
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

async function resolveMentions(project, body, explicit = []) {
  const members = await prisma.user.findMany({ where: { id: { in: project.members } }, select: { id: true, name: true } });
  const ids = new Set(explicit.filter((id) => members.some((m) => m.id === id)));
  for (const m of members) if (body.includes(`@${m.name}`)) ids.add(m.id); // chỉ người trong dự án
  return [...ids];
}

const commentAccess = async (req) => {
  const comment = isId(req.params.id) ? await prisma.comment.findUnique({ where: { id: req.params.id } }) : null;
  if (!comment) throw notFound('Không tìm thấy bình luận');
  return { comment, access: await taskAccess(req.user.id, comment.task) };
};

router.post('/tasks/:id/comments', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  if (access.project.status === 'archived') throw forbidden('Dự án đã lưu trữ, chỉ được xem');
  const { body: raw, mentions: explicit } = parse(z.object({ body: z.string().min(1, 'Nội dung trống').max(5000), mentions: z.array(z.string()).default([]) }), req.body);
  const body = plainText(raw);
  if (!body) throw badRequest('Nội dung trống');
  const mentions = await resolveMentions(access.project, body, explicit);
  const { task } = access;
  const full = await prisma.comment.create({ data: { task: task.id, project: access.project.id, author: req.user.id, body, mentions } });
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
  if (access.project.status === 'archived') throw forbidden('Dự án đã lưu trữ, chỉ được xem');
  const { body: raw } = parse(z.object({ body: z.string().min(1).max(5000) }), req.body);
  const body = plainText(raw);
  const full = await prisma.comment.update({ where: { id: comment.id }, data: { body, mentions: await resolveMentions(access.project, body), editedAt: new Date() } });
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
  await prisma.comment.delete({ where: { id: comment.id } });
  await logActivity({
    workspace: access.task.workspace,
    project: access.project.id,
    actor: req.user.id,
    action: 'Xóa bình luận',
    entityType: 'comment',
    entityId: access.task.id,
    entityLabel: `${access.task.key} ${access.task.title}`,
    before: '(nội dung đã xóa)',
  });
  emitProject(access.project.id, 'comment:deleted', { taskId: comment.task, commentId: comment.id });
  res.json({ ok: true });
});

export { loadTask, enrich, addDependency };
export default router;
