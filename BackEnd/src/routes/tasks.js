import { Router } from 'express';
import { z } from 'zod';
import { USER, countBy, ilike, isId, nextSeq, populate, populateAll, prisma, subtaskCounts } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { assertComment, assertManage, taskPermissions, assertTaskStatus, assertWrite, middlewareProject, projectAccess, taskAccess } from '../middleware/access.js';
import { logActivityIn, logTaskChanges } from '../services/activity.js';
import { withWorkspaceLock } from '../services/membership.js';
import { notify } from '../services/notify.js';
import { emitProject } from '../services/realtime.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../utils/http.js';
import { plainText, sha256 } from '../utils/security.js';
import { BUSINESS_TIMEZONE, isDateInput, parseDate } from '../utils/dates.js';
import { acceptanceCriteriaSchema, normalizeTaskInput } from '../services/acceptance-criteria.ts';
import { checklistMap, checklistSchema, readChecklist, saveChecklist } from '../services/checklists.js';
import { applyDueFilter, taskFilters, taskSearch } from '../services/task-filters.js';
import { applyTaskDates, parseTaskDates } from '../services/task-dates.js';

const router = Router();
router.use(requireAuth);

export const STATUS_VI = { todo: 'Cần làm', in_progress: 'Đang thực hiện', review: 'Đang kiểm duyệt', done: 'Hoàn thành' };
export const PRIORITY_VI = { low: 'Thấp', medium: 'Trung bình', high: 'Cao' };

const optDate = z.union([z.string(), z.null()]).refine((s) => s === null || s === '' || isDateInput(s), 'Ngày không hợp lệ; thời điểm phải có múi giờ');

const taskFields = {
  title: z.string({ error: 'Vui lòng nhập tên công việc' }).trim().min(1, 'Vui lòng nhập tên công việc').max(200),
  description: z.string().max(20000),
  acceptanceCriteria: acceptanceCriteriaSchema,
  status: z.enum(['todo', 'in_progress', 'review', 'done']),
  priority: z.enum(['low', 'medium', 'high']),
  assignee: z.string().nullable(),
  dueDate: optDate,
  workType: z.enum(['unclassified', 'development', 'testing', 'database', 'design', 'documentation', 'devops', 'research']),
  plannedStartDate: optDate,
  actualStartDate: optDate,
  actualEndDate: optDate,
  estimateHours: z.number().min(0).max(1000).nullable(),
  remainingHours: z.number().min(0).max(1000).nullable(),
  spentHours: z.number().min(0).max(1000),
  labels: z.array(z.string().trim().min(1).max(40)).max(20),
  sprint: z.string().max(60),
  checklist: checklistSchema,
};

const STALE_MSG = 'Công việc vừa được người khác cập nhật. Dữ liệu đã được tải lại.';

/** Nạp người nhận/người tạo/phụ thuộc + đếm việc con, bình luận, tệp – tất cả chạy song song trong một lượt */
async function enrich(tasks, access, userId, db = prisma) {
  const contributions = await db.taskContributor.findMany({ where: { task: { in: tasks.map((t) => t.id) } }, include: { userRef: { select: USER } } });
  for (const task of tasks) task.contributors = contributions.filter((c) => c.task === task.id);
  const permissions = access ? new Map(tasks.map((t) => [t.id, taskPermissions(access, userId, t)])) : null;
  const ids = tasks.map((t) => t.id);
  const [, subs, comments, files, checklists, logs] = await Promise.all([
    populateAll(tasks, [
      ['assignee', 'user', USER],
      ['creator', 'user', USER],
      ['blockedBy', 'task', { key: true, title: true, status: true, dueDate: true, assignee: true }],
    ], db),
    subtaskCounts(ids, db),
    countBy('comment', 'task', { task: { in: ids }, deletedAt: null }, db),
    countBy('document', 'task', { task: { in: ids } }, db),
    checklistMap(ids, db),
    countBy('taskDailyUpdate', 'task', { task: { in: ids } }, db),
  ]);
  return tasks.map((t) => ({
    ...t,
    checklist: checklists.get(t.id) || [],
    ...(permissions && { permissions: permissions.get(t.id) }),
    subtasks: subs[t.id] || { total: 0, done: 0 },
    commentCount: comments[t.id] || 0,
    fileCount: files[t.id] || 0,
    hasDailyUpdates: (logs[t.id] || 0) > 0,
    isBlocked: (t.blockedBy || []).some((b) => b && b.status !== 'done'),
  }));
}

async function loadTask(id) {
  return prisma.$transaction(async (tx) => {
    const t = await tx.task.findUnique({ where: { deletedAt: null, id } });
    if (!t) throw notFound('Không tìm thấy công việc');
    return (await enrich([t], null, null, tx))[0];
  }, { isolationLevel: 'RepeatableRead' });
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

/** Nhãn đi theo danh mục của dự án: dùng đúng cách viết đã có, nhãn mới tự được thêm vào danh mục. */
async function catalogLabels(tx, project, labels) {
  const catalog = await tx.projectLabel.findMany({ where: { project }, select: { name: true } });
  const known = new Map(catalog.map((l) => [l.name.toLowerCase(), l.name]));
  const result = [...new Set(labels.map((l) => known.get(l.toLowerCase()) ?? l))];
  const added = result.filter((l) => !known.has(l.toLowerCase()));
  if (added.length) await tx.projectLabel.createMany({ data: added.map((name) => ({ project, name })), skipDuplicates: true });
  return result;
}

/** Chia đều giờ ước lượng cho người chính và người cùng làm; PM chỉnh lại ở mục phân bổ effort. */
function splitEffort(people, estimate) {
  const share = Math.floor((estimate / people.length) * 100) / 100;
  return people.map((user, i) => {
    const plannedHours = i === 0 ? Math.round((estimate - share * (people.length - 1)) * 100) / 100 : share;
    return { user, plannedHours, remainingHours: plannedHours };
  });
}

const listParam = (v, allowed) =>
  String(v)
    .split(',')
    .filter((x) => allowed.includes(x));

// ---------- Bảng công việc ----------
router.get('/projects/:projectId/tasks', middlewareProject(), async (req, res) => {
  const where = { project: req.pa.project.id, parent: null };
  const { assignee, priority, search, status, due } = taskFilters(req.query);
  if (assignee === 'me') where.assignee = req.user.id;
  else if (assignee === 'unassigned') where.assignee = null;
  else if (isId(assignee)) where.assignee = assignee;
  if (priority) where.priority = { in: listParam(priority, ['low', 'medium', 'high']) };
  if (status) where.status = { in: listParam(status, Object.keys(STATUS_VI)) };
  applyDueFilter(where, due, req.user.timezone);
  if (search) where.OR = taskSearch(search);
  if (typeof req.query.sprint === 'string') where.sprint = req.query.sprint.slice(0, 60);
  if (typeof req.query.label === 'string' && req.query.label) where.labels = { has: req.query.label.slice(0, 40) };
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
      select: { id: true, project: true, key: true, title: true, status: true, dueDate: true, blockedBy: true, assignee: true },
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
      collaborators: z.array(z.string().uuid()).max(20).optional(),
    }),
    normalizeTaskInput(req.body),
  );
  const collaborators = [...new Set(body.collaborators || [])].filter((u) => u !== body.assignee);
  delete body.collaborators;
  if (collaborators.length && !body.assignee) throw badRequest('Hãy chọn người chịu trách nhiệm chính trước khi thêm người cùng làm', { fields: { assignee: 'Chọn người chịu trách nhiệm chính' } });
  if (collaborators.length && !(body.estimateHours > 0)) throw badRequest('Nhập giờ ước lượng để chia cho những người cùng làm', { fields: { estimateHours: 'Nhập giờ ước lượng' } });
  parseTaskDates(body, req.user.timezone);
  applyTaskDates(body, {}, req.user.timezone);
  const { task, parent, project } = await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const access = await projectAccess(req.user.id, req.pa.project.id, tx);
    assertManage(access);
    assertTaskStatus(access, body.status);
    const project = access.project;
    await assertAssignee(project, body.assignee, tx);
    for (const user of collaborators) await assertAssignee(project, user, tx);
    if (body.labels) body.labels = await catalogLabels(tx, project.id, body.labels);
    let parent = null;
    if (body.parent) {
      parent = isId(body.parent) ? await tx.task.findFirst({ where: { deletedAt: null, id: body.parent, project: project.id } }) : null;
      if (!parent) throw badRequest('Công việc cha không thuộc dự án');
      if (parent.parent) throw badRequest('Công việc con chỉ được tối đa 1 cấp');
    }
    const { blockedBy, checklist = [], ...fields } = body;
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
        legacySpentHours: body.spentHours ?? 0,
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
    await saveChecklist(task.id, checklist, tx);
    if (collaborators.length) await tx.taskContributor.createMany({ data: splitEffort([task.assignee, ...collaborators], task.estimateHours).map((c) => ({ ...c, task: task.id })) });
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
    ...collaborators.map((user) => notify({
      user,
      actor: req.user.id,
      type: 'assigned',
      workspace: task.workspace,
      project: task.project,
      task: task.id,
      text: `${req.user.name} đã thêm bạn vào ${task.key} ${task.title}`,
      dedupeKey: `assigned:${task.id}:${user}`,
    })),
  ]);
  emitProject(project.id, 'task:changed', { task: full });
  if (parentFull) emitProject(project.id, 'task:changed', { task: parentFull });
  res.status(201).json({ task: full });
});

// ---------- Chi tiết ----------
router.get('/tasks/:id', async (req, res) => {
  const result = await prisma.$transaction(async (tx) => {
  const access = await taskAccess(req.user.id, req.params.id, tx);
  const { task, canWrite, canManage, role, project, projectRole } = access;
  // Mỗi phần tải song song rồi tự nạp dữ liệu liên quan – tổng cộng 2 lượt đi-về tới DB
  const [[full], subtasks, blocking, files, activity, parent] = await Promise.all([
    enrich([{ ...task }], null, null, tx),
    tx.task.findMany({ where: { deletedAt: null, parent: task.id }, orderBy: { number: 'asc' } }).then((r) => populate(r, 'assignee', 'user', USER, tx)),
    tx.task.findMany({ where: { deletedAt: null, blockedBy: { has: task.id } }, select: { id: true, key: true, title: true, status: true, dueDate: true } }),
    tx.document.findMany({ where: { task: task.id }, omit: { storageKey: true }, orderBy: { createdAt: 'desc' } }).then((r) => populate(r, 'uploadedBy', 'user', USER, tx)),
    tx.activity.findMany({ where: { entityType: 'task', entityId: task.id }, orderBy: { createdAt: 'desc' }, take: 50 }).then((r) => populate(r, 'actor', 'user', USER, tx)),
    task.parent ? tx.task.findUnique({ where: { deletedAt: null, id: task.parent }, select: { id: true, key: true, title: true } }) : null,
  ]);
  return {
    task: full,
    subtasks,
    blocking,
    parent,
    files,
    activity,
    access: { ...taskPermissions(access, req.user.id), canWrite, canManage, canComment: access.canComment, role, projectRole, archived: project.status === 'archived' },
  };
  }, { isolationLevel: 'RepeatableRead' });
  res.json(result);
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
async function applyUpdate(req, before, project, patch, prepare) {
  const { task, full } = await withWorkspaceLock(project.workspace, async (tx) => {
    const access = await taskAccess(req.user.id, before.id, tx);
    assertWrite(access);
    if (access.task.version !== before.version) throw conflict(STALE_MSG, { task: await loadTask(before.id) });
    // Checklist read-modify-write must use the same lock and version as the write.
    before = access.task;
    if (prepare) {
      assertManage(access);
      patch = await prepare(tx);
    }
    const permissions = taskPermissions(access, req.user.id);
    if (!permissions.canUpdateProgress) throw forbidden('Chỉ được cập nhật công việc được giao cho mình');
    if (!access.canManage && Object.keys(patch).some((k) => !['status', 'order', 'remainingHours', 'actualStartDate', 'actualEndDate'].includes(k))) throw forbidden('Chỉ PM được sửa nội dung công việc');
    assertTaskStatus(access, patch.status, access.task.status);
    if (patch.status && !permissions.allowedStatuses.includes(patch.status)) throw forbidden('Chuyển trạng thái không hợp lệ');
    applyTaskDates(patch, access.task, req.user.timezone);
    if (patch.spentHours !== undefined && patch.spentHours !== access.task.spentHours) {
      if (await tx.taskDailyUpdate.count({ where: { task: before.id } })) throw badRequest('Effort đã có nhật ký. Hãy sửa giờ trong nhật ký thay vì ghi đè tổng giờ.');
      patch.legacySpentHours = patch.spentHours;
    }
    if (patch.assignee && access.task.contributors.length && !access.task.contributors.some((c) => c.user === patch.assignee)) throw badRequest('Hãy thêm người chịu trách nhiệm mới vào danh sách phân bổ trước');
    if (access.task.contributors.length && patch.estimateHours !== undefined && patch.estimateHours !== access.task.estimateHours) throw badRequest('Giờ ước lượng được tính từ phân bổ từng người. Hãy sửa ở mục phân bổ effort.');
    if (access.task.contributors.length && patch.remainingHours !== undefined && patch.status !== 'done') {
      if (patch.remainingHours !== access.task.remainingHours) throw badRequest('Hãy cập nhật giờ còn lại theo từng người trong phân bổ effort hoặc nhật ký');
      delete patch.remainingHours;
    }
    if (patch.status === 'done') patch.progressPct = 100;
    else if (access.task.status === 'done' && patch.status) patch.progressPct = Math.min(99, access.task.progressPct);
    if ((patch.status ?? access.task.status) === 'done') patch.remainingHours = 0;
    else if (access.task.status === 'done' && patch.status) patch.remainingHours = access.task.contributors.length ? access.task.contributors.reduce((sum, c) => sum + c.remainingHours, 0) : patch.remainingHours ?? null;
    if (patch.assignee !== undefined) await assertAssignee(access.project, patch.assignee, tx);
    if (patch.labels) patch.labels = await catalogLabels(tx, access.project.id, patch.labels);
    if (patch.description !== undefined) patch.description = plainText(patch.description, 20000);
    if (patch.status && patch.status !== before.status) {
      patch.completedAt = patch.status === 'done' ? new Date() : null;
      patch.reviewSince = patch.status === 'review' ? new Date() : null;
    }
    // UPDATE … RETURNING: cập nhật và lấy bản mới trong cùng một câu lệnh
    const { checklist, ...fields } = patch;
    const priorChecklist = checklist === undefined ? undefined : await readChecklist(before.id, tx);
    const [task] = await tx.task.updateManyAndReturn({ where: { id: before.id, version: before.version }, data: { ...fields, version: { increment: 1 } } });
    if (!task) throw conflict(STALE_MSG, { task: await loadTask(before.id) });
    if (checklist !== undefined) {
      before = { ...before, checklist: priorChecklist };
      task.checklist = await saveChecklist(task.id, checklist, tx);
    }
    await logTaskChanges({ task, actor: req.user.id, before, after: task, labels: ACTIVITY_LABELS }, tx);
    // Capture the response while the workspace lock still protects this write.
    // A read after commit could adopt another writer's version and silently
    // rebase an older client form onto that version.
    const [full] = await enrich([{ ...task }], null, null, tx);
    return { task, full };
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
  const [parentFull] = await Promise.all([
    task.parent && loadTask(task.parent),
    ...notifications.map((n) => notify({ ...n, actor: req.user.id, workspace: task.workspace, project: task.project, task: task.id })),
  ]);
  emitProject(task.project, 'task:changed', { task: full });
  if (parentFull) emitProject(task.project, 'task:changed', { task: parentFull });
  if (patch.status && patch.status !== before.status) await emitProject(task.project, 'dependencies:changed', { taskId: task.id });
  return full;
}

router.patch('/tasks/:id', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  assertWrite(access);
  const body = parse(z.object({ ...Object.fromEntries(Object.entries(taskFields).map(([k, v]) => [k, v.optional()])), version: z.number().int().min(1) }).strict(), normalizeTaskInput(req.body));
  parseTaskDates(body, req.user.timezone);
  const { version, ...patch } = body;
  if (version !== access.task.version) throw conflict(STALE_MSG, { task: await loadTask(access.task.id) });
  res.json({ task: await applyUpdate(req, access.task, access.project, patch) });
});

router.get('/tasks/:id/checklist', async (req, res) => {
  const result = await prisma.$transaction(async (tx) => {
    const { task } = await taskAccess(req.user.id, req.params.id, tx);
    return { items: await readChecklist(task.id, tx), version: task.version };
  }, { isolationLevel: 'RepeatableRead' });
  res.json(result);
});

router.post('/tasks/:id/checklist', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  assertManage(access);
  const { version, ...item } = parse(z.object({ version: z.number().int().positive(), text: z.string().trim().min(1).max(300), done: z.boolean().default(false) }).strict(), req.body);
  const task = await applyUpdate(req, { ...access.task, version }, access.project, {}, async (tx) => ({
    checklist: parse(checklistSchema, [...await readChecklist(access.task.id, tx), item]),
  }));
  res.status(201).json({ task });
});

async function checklistAccess(req) {
  const item = isId(req.params.id) ? await prisma.checklistItem.findUnique({ where: { id: req.params.id } }) : null;
  if (!item) throw notFound('Không tìm thấy mục checklist');
  const access = await taskAccess(req.user.id, item.task);
  assertManage(access);
  return { item, access };
}

router.patch('/checklist/:id', async (req, res) => {
  const { item, access } = await checklistAccess(req);
  const { version, ...patch } = parse(z.object({ version: z.number().int().positive(), text: z.string().trim().min(1).max(300).optional(), done: z.boolean().optional() }).strict(), req.body);
  if (!Object.keys(patch).length) throw badRequest('Chưa có thay đổi checklist');
  const task = await applyUpdate(req, { ...access.task, version }, access.project, {}, async (tx) => {
    const items = await readChecklist(item.task, tx);
    if (!items.some((current) => current._id === item.id)) throw notFound('Không tìm thấy mục checklist');
    return { checklist: items.map((current) => current._id === item.id ? { ...current, ...patch } : current) };
  });
  res.json({ task });
});

router.delete('/checklist/:id', async (req, res) => {
  const { item, access } = await checklistAccess(req);
  const { version } = parse(z.object({ version: z.string().regex(/^[1-9]\d*$/).transform(Number).refine(Number.isSafeInteger) }), req.query);
  const task = await applyUpdate(req, { ...access.task, version }, access.project, {}, async (tx) => {
    const items = await readChecklist(item.task, tx);
    if (!items.some((current) => current._id === item.id)) throw notFound('Không tìm thấy mục checklist');
    return { checklist: items.filter((current) => current._id !== item.id) };
  });
  res.json({ task });
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

async function deletionImpact(tx, task) {
  const children = await tx.task.findMany({ where: { deletedAt: null, parent: task.id }, select: { id: true, key: true, title: true, version: true }, orderBy: { id: 'asc' } });
  const ids = [task.id, ...children.map((c) => c.id)];
  const [dependents, attachmentCount] = await Promise.all([
    tx.task.findMany({ where: { project: task.project, deletedAt: null, blockedBy: { hasSome: ids } }, select: { id: true, version: true, blockedBy: true }, orderBy: { id: 'asc' } }),
    tx.document.count({ where: { task: { in: ids } } }),
  ]);
  const tasks = [{ id: task.id, key: task.key, title: task.title, version: task.version }, ...children];
  const impactToken = sha256(JSON.stringify({ tasks, dependents, attachmentCount }));
  const dependentCount = dependents.reduce((count, t) => count + t.blockedBy.filter((id) => ids.includes(id)).length, 0);
  return { tasks, dependentCount, affectedTaskCount: dependents.length, attachmentCount, impactToken, preservesAttachments: true };
}

router.get('/tasks/:id/deletion-preview', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  assertManage(access);
  const impact = await withWorkspaceLock(access.project.workspace, async (tx) => {
    const fresh = await taskAccess(req.user.id, access.task.id, tx);
    assertManage(fresh);
    return deletionImpact(tx, fresh.task);
  });
  res.json({ impact });
});

router.delete('/tasks/:id', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  assertManage(access);
  const { impact: expectedImpact } = parse(z.object({ impact: z.string().regex(/^[a-f0-9]{64}$/).optional() }), req.query);
  const { task, ids } = await withWorkspaceLock(access.project.workspace, async (tx) => {
    const fresh = await taskAccess(req.user.id, access.task.id, tx);
    assertManage(fresh);
    const { task } = fresh;
    if (expectedImpact && (await deletionImpact(tx, task)).impactToken !== expectedImpact) throw conflict('Phạm vi xóa đã thay đổi. Hãy xem lại trước khi xác nhận.', { code: 'DELETE_CHANGED' });
    const children = await tx.task.findMany({ where: { deletedAt: null, parent: task.id }, select: { id: true } });
    if (children.length && req.query.confirm !== 'true') {
      throw conflict(`Công việc có ${children.length} công việc con. Xác nhận để xóa tất cả.`, { code: 'CONFIRM_REQUIRED', children: children.length });
    }
    const ids = [task.id, ...children.map((c) => c.id)];
    // Giữ task/bình luận để truy vết; gỡ phụ thuộc và giữ tệp ở thư viện dự án.
    const dependents = await tx.task.findMany({ where: { deletedAt: null, blockedBy: { hasSome: ids } }, select: { id: true, key: true, title: true, blockedBy: true } });
    for (const d of dependents) {
      const after = d.blockedBy.filter((b) => !ids.includes(b));
      await tx.task.update({ where: { id: d.id }, data: { blockedBy: after, version: { increment: 1 } } });
      await logActivityIn(tx, {
        workspace: task.workspace, project: task.project, actor: req.user.id,
        action: 'Gỡ phụ thuộc khi xóa công việc', entityType: 'task', entityId: d.id,
        entityLabel: `${d.key} ${d.title}`,
        field: 'blockedBy', before: d.blockedBy, after,
      });
    }
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
    if (task.blockedBy.includes(blockedBy)) return task;
    const before = task.blockedBy;
    await addDependency(task, blockedBy, tx);
    await tx.task.update({ where: { id: task.id }, data: { blockedBy: task.blockedBy, version: { increment: 1 } } });
    await logActivityIn(tx, {
      workspace: task.workspace,
      project: task.project,
      actor: req.user.id,
      action: 'Thêm phụ thuộc',
      entityType: 'task',
      entityId: task.id,
      entityLabel: `${task.key} ${task.title}`,
      field: 'blockedBy', before, after: task.blockedBy,
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
  parse(z.string().uuid('Mã công việc phụ thuộc không hợp lệ'), req.params.depId);
  const task = await withWorkspaceLock(access.project.workspace, async (tx) => {
    const fresh = await taskAccess(req.user.id, access.task.id, tx);
    assertManage(fresh);
    const task = fresh.task;
    if (!task.blockedBy.includes(req.params.depId)) return task;
    await tx.task.update({ where: { id: task.id }, data: { blockedBy: task.blockedBy.filter((b) => b !== req.params.depId), version: { increment: 1 } } });
    await logActivityIn(tx, {
      workspace: task.workspace,
      project: task.project,
      actor: req.user.id,
      action: 'Gỡ phụ thuộc',
      entityType: 'task',
      entityId: task.id,
      entityLabel: `${task.key} ${task.title}`,
      field: 'blockedBy',
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
  const comments = await prisma.comment.findMany({ where: { task: task.id, deletedAt: null }, orderBy: { createdAt: 'asc' } });
  await populateAll(comments, [
    ['author', 'user', USER],
    ['mentions', 'user', USER],
  ]);
  res.json({ comments });
});

async function resolveMentions(project, body, explicit = [], db = prisma) {
  const members = await db.user.findMany({ where: { id: { in: project.members }, isLocked: false }, select: { id: true, name: true } });
  const ids = new Set(explicit.filter((id) => members.some((m) => m.id === id)));
  for (const m of members) if (body.includes(`@${m.name}`)) ids.add(m.id); // chỉ người trong dự án
  return [...ids];
}

const commentAccess = async (req, db = prisma) => {
  const comment = isId(req.params.id) ? await db.comment.findUnique({ where: { id: req.params.id, deletedAt: null } }) : null;
  if (!comment) throw notFound('Không tìm thấy bình luận');
  return { comment, access: await taskAccess(req.user.id, comment.task, db) };
};

router.post('/tasks/:id/comments', async (req, res) => {
  const access = await taskAccess(req.user.id, req.params.id);
  assertComment(access);
  const { body: raw, mentions: explicit } = parse(z.object({ body: z.string().min(1, 'Nội dung trống').max(5000), mentions: z.array(z.string()).default([]) }), req.body);
  const body = plainText(raw);
  if (!body) throw badRequest('Nội dung trống');
  const { full, mentions, task } = await withWorkspaceLock(access.project.workspace, async (tx) => {
    const fresh = await taskAccess(req.user.id, req.params.id, tx);
    assertComment(fresh);
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
  assertComment(access);
  const { body: raw } = parse(z.object({ body: z.string().min(1).max(5000) }), req.body);
  const body = plainText(raw);
  if (!body) throw badRequest('Nội dung trống');
  const full = await withWorkspaceLock(access.project.workspace, async (tx) => {
    const fresh = await commentAccess(req, tx);
    assertComment(fresh.access);
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
  if (comment.author !== req.user.id && !access.canManage) throw forbidden('Chỉ được xóa bình luận của mình');
  await withWorkspaceLock(access.project.workspace, async (tx) => {
    const fresh = await commentAccess(req, tx);
    assertComment(fresh.access);
    if (fresh.comment.author !== req.user.id && !fresh.access.canManage) throw forbidden('Chỉ PM được ẩn bình luận của người khác');
    await tx.comment.update({ where: { id: comment.id }, data: { deletedAt: new Date() } });
    await logActivityIn(tx, {
      workspace: access.task.workspace,
      project: access.project.id,
      actor: req.user.id,
      action: comment.author === req.user.id ? 'Xóa bình luận' : 'Ẩn bình luận vi phạm',
      entityType: 'comment',
      entityId: access.task.id,
      entityLabel: `${access.task.key} ${access.task.title}`,
      before: '(nội dung đã xóa)',
      after: { commentId: comment.id, author: comment.author, hidden: true },
    });
  });
  emitProject(access.project.id, 'comment:deleted', { taskId: comment.task, commentId: comment.id });
  res.json({ ok: true });
});

export { loadTask, enrich, addDependency, applyUpdate };
export default router;
