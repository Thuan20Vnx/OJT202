import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { USER, countBy, ilike, isId, populate, populateAll, prisma, subtaskCounts } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { atLeast, middlewareWorkspace, readableProjectsWhere } from '../middleware/access.js';
import { logActivity } from '../services/activity.js';
import { sendMail } from '../services/mailer.js';
import { kickFromProject } from '../services/realtime.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../utils/http.js';
import { randomToken, sha256, slugify, toCsv } from '../utils/security.js';

const router = Router();
router.use(requireAuth);

const ROLE_VI = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };

const findMember = (workspace, user) => (isId(user) ? prisma.membership.findUnique({ where: { workspace_user: { workspace, user } } }) : null);
const userName = async (id) => (await prisma.user.findUnique({ where: { id }, select: { name: true } }))?.name;

// ---------- Tạo & xem workspace ----------
router.post('/', async (req, res) => {
  const body = parse(
    z.object({
      name: z.string({ required_error: 'Vui lòng nhập tên workspace' }).trim().min(2, 'Tên workspace quá ngắn').max(80),
      slug: z.string().trim().max(40).optional(),
      size: z.enum(['2-5', '6-10', '11-20']).default('6-10'),
    }),
    req.body,
  );
  // Tên workspace là duy nhất trong danh sách workspace của chính người dùng
  const dup = await prisma.membership.findFirst({ where: { user: req.user.id, workspaceRef: { name: { equals: body.name, mode: 'insensitive' } } } });
  if (dup) throw conflict('Bạn đã có workspace tên này. Vui lòng chọn tên khác.', { fields: { name: 'Bạn đã có workspace tên này' } });
  let slug = slugify(body.slug || body.name);
  if (await prisma.workspace.findUnique({ where: { slug } })) slug = `${slug}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const ws = await prisma.workspace.create({
    data: { name: body.name, slug, owner: req.user.id, size: body.size, memberships: { create: { user: req.user.id, role: 'owner' } } },
  });
  await logActivity({ workspace: ws.id, actor: req.user.id, action: 'Tạo workspace', entityType: 'workspace', entityId: ws.id, entityLabel: ws.name });
  res.status(201).json({ workspace: ws });
});

router.get('/check-slug', async (req, res) => {
  const slug = slugify(String(req.query.slug || ''));
  res.json({ slug, available: !(await prisma.workspace.findUnique({ where: { slug } })) });
});

router.get('/:wsId', middlewareWorkspace(), async (req, res) => {
  const { workspace, role } = req.ws;
  const projects = await prisma.project.findMany({ where: readableProjectsWhere(req.user.id, workspace.id, role), orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] });
  res.json({ workspace, role, projects });
});

router.patch('/:wsId', middlewareWorkspace('wsId', 'admin'), async (req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(2).max(80) }).partial(), req.body);
  const ws = await prisma.workspace.update({ where: { id: req.ws.workspace.id }, data: body });
  res.json({ workspace: ws });
});

// ---------- Thành viên ----------
router.get('/:wsId/members', middlewareWorkspace(), async (req, res) => {
  const wsId = req.ws.workspace.id;
  const [members, projects, lastSeen] = await Promise.all([
    prisma.membership.findMany({ where: { workspace: wsId }, include: { userRef: { select: USER } }, orderBy: { createdAt: 'asc' } }),
    prisma.project.findMany({ where: { workspace: wsId }, select: { id: true, name: true, color: true, members: true } }),
    // Lần hoạt động gần nhất = phiên được làm mới gần nhất của thành viên workspace
    prisma.session.groupBy({ by: ['user'], where: { userRef: { memberships: { some: { workspace: wsId } } } }, _max: { updatedAt: true } }),
  ]);
  const seen = Object.fromEntries(lastSeen.map((s) => [s.user, s._max.updatedAt]));
  res.json({
    members: members.map((m) => ({
      id: m.id,
      user: m.userRef,
      role: m.role,
      title: m.title,
      weeklyHours: m.weeklyHours,
      lastActiveAt: seen[m.user] || null,
      projects: projects.filter((p) => p.members.includes(m.user)).map((p) => ({ id: p.id, name: p.name, color: p.color })),
    })),
  });
});

router.patch('/:wsId/members/:userId', middlewareWorkspace('wsId', 'admin'), async (req, res) => {
  const body = parse(
    z.object({ role: z.enum(['owner', 'admin', 'member', 'viewer']).optional(), title: z.string().max(60).optional(), weeklyHours: z.number().min(0).max(80).optional() }),
    req.body,
  );
  const wsId = req.ws.workspace.id;
  const target = await findMember(wsId, req.params.userId);
  if (!target) throw notFound('Không tìm thấy thành viên');
  const data = {};
  if (body.role && body.role !== target.role) {
    // Chỉ Owner được trao/thu quyền Owner hoặc Admin
    if ((['owner', 'admin'].includes(body.role) || ['owner', 'admin'].includes(target.role)) && req.ws.role !== 'owner') {
      throw forbidden('Chỉ Owner mới thay đổi được quyền Owner/Admin');
    }
    if (target.role === 'owner' && body.role !== 'owner') {
      const owners = await prisma.membership.count({ where: { workspace: wsId, role: 'owner' } });
      if (owners <= 1) throw badRequest('Không thể hạ quyền Owner cuối cùng');
    }
    await logActivity({
      workspace: wsId,
      actor: req.user.id,
      action: 'Phân quyền',
      entityType: 'member',
      entityId: target.user,
      entityLabel: await userName(target.user),
      before: ROLE_VI[target.role],
      after: ROLE_VI[body.role],
    });
    data.role = body.role;
  }
  if (body.title !== undefined) data.title = body.title;
  if (body.weeklyHours !== undefined) data.weeklyHours = body.weeklyHours;
  const member = await prisma.membership.update({ where: { id: target.id }, data });
  res.json({ member });
});

router.delete('/:wsId/members/:userId', middlewareWorkspace('wsId', 'admin'), async (req, res) => {
  const wsId = req.ws.workspace.id;
  const target = await findMember(wsId, req.params.userId);
  if (!target) throw notFound('Không tìm thấy thành viên');
  if (target.role === 'owner') {
    if (req.ws.role !== 'owner') throw forbidden('Chỉ Owner mới gỡ được Owner');
    const owners = await prisma.membership.count({ where: { workspace: wsId, role: 'owner' } });
    if (owners <= 1) throw badRequest('Không thể xóa Owner cuối cùng');
  }
  const projects = await prisma.$transaction(async (tx) => {
    await tx.membership.delete({ where: { id: target.id } });
    const ps = await tx.project.findMany({ where: { workspace: wsId, members: { has: target.user } }, select: { id: true, members: true } });
    for (const p of ps) await tx.project.update({ where: { id: p.id }, data: { members: p.members.filter((u) => u !== target.user) } });
    return ps;
  });
  for (const p of projects) await kickFromProject(target.user, p.id); // thu hồi có hiệu lực ngay
  await logActivity({ workspace: wsId, actor: req.user.id, action: 'Gỡ thành viên', entityType: 'member', entityId: target.user, entityLabel: await userName(target.user), before: ROLE_VI[target.role] });
  res.json({ ok: true });
});

// ---------- Lời mời ----------
router.get('/:wsId/invites', middlewareWorkspace('wsId', 'admin'), async (req, res) => {
  const invites = await prisma.invite.findMany({
    where: { workspace: req.ws.workspace.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    omit: { tokenHash: true },
    orderBy: { createdAt: 'desc' },
  });
  await populateAll(invites, [
    ['invitedBy', 'user', USER],
    ['projects', 'project', { name: true, color: true }],
  ]);
  res.json({ invites });
});

async function sendInvite(ws, invite, raw, inviter) {
  await sendMail({
    to: invite.email,
    subject: `${inviter.name} mời bạn vào ${ws.name} trên TaskFlow`,
    text: 'Lời mời hết hạn sau 72 giờ.',
    link: `${config.clientUrl}/invite/${raw}`,
  });
}

router.post('/:wsId/invites', middlewareWorkspace('wsId', 'admin'), async (req, res) => {
  const body = parse(
    z.object({
      emails: z.array(z.string().trim().toLowerCase().email('Email không hợp lệ')).min(1, 'Nhập ít nhất một email').max(20),
      role: z.enum(['admin', 'member', 'viewer']).default('member'),
      projects: z.array(z.string()).default([]),
    }),
    req.body,
  );
  if (body.role === 'admin' && req.ws.role !== 'owner') throw forbidden('Chỉ Owner mới mời được Admin');
  const ws = req.ws.workspace;
  const projects = await prisma.project.findMany({ where: { id: { in: body.projects.filter(isId) }, workspace: ws.id }, select: { id: true } });
  const created = [];
  const skipped = [];
  for (const email of [...new Set(body.emails)]) {
    const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser && (await findMember(ws.id, existingUser.id))) {
      skipped.push({ email, reason: 'Đã là thành viên' });
      continue;
    }
    await prisma.invite.updateMany({ where: { workspace: ws.id, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const raw = randomToken(24);
    const inv = await prisma.invite.create({
      data: {
        workspace: ws.id,
        email,
        role: body.role,
        projects: projects.map((p) => p.id),
        tokenHash: sha256(raw),
        invitedBy: req.user.id,
        expiresAt: new Date(Date.now() + config.inviteTtlMs),
      },
    });
    await sendInvite(ws, inv, raw, req.user);
    created.push({ id: inv.id, email, role: inv.role, expiresAt: inv.expiresAt });
  }
  res.status(201).json({ created, skipped });
});

router.post('/:wsId/invites/:id/resend', middlewareWorkspace('wsId', 'admin'), async (req, res) => {
  const inv = isId(req.params.id)
    ? await prisma.invite.findFirst({ where: { id: req.params.id, workspace: req.ws.workspace.id, acceptedAt: null, revokedAt: null } })
    : null;
  if (!inv) throw notFound('Không tìm thấy lời mời');
  const raw = randomToken(24);
  const updated = await prisma.invite.update({ where: { id: inv.id }, data: { tokenHash: sha256(raw), expiresAt: new Date(Date.now() + config.inviteTtlMs) } });
  await sendInvite(req.ws.workspace, updated, raw, req.user);
  res.json({ ok: true, expiresAt: updated.expiresAt });
});

router.delete('/:wsId/invites/:id', middlewareWorkspace('wsId', 'admin'), async (req, res) => {
  if (isId(req.params.id)) await prisma.invite.updateMany({ where: { id: req.params.id, workspace: req.ws.workspace.id }, data: { revokedAt: new Date() } });
  res.json({ ok: true });
});

// ---------- Nhật ký hoạt động (chỉ đọc) ----------
const ENTITY_TYPES = ['task', 'project', 'member', 'file', 'workspace', 'comment', 'ai'];

function activityWhere(req) {
  const { workspace, role } = req.ws;
  const and = [{ workspace: workspace.id }];
  // Thành viên thường chỉ thấy log của dự án mình được gán + log cấp workspace (lọc lồng trong cùng truy vấn)
  if (!atLeast(role, 'admin')) and.push({ OR: [{ projectRef: { members: { has: req.user.id } } }, { project: null }] });
  const { actor, action, entityType, project, from, to, search } = req.query;
  if (isId(actor)) and.push({ actor });
  if (action) and.push({ action: String(action) });
  if (ENTITY_TYPES.includes(entityType)) and.push({ entityType });
  if (isId(project)) and.push({ project });
  if (from) and.push({ createdAt: { gte: new Date(from) } });
  if (to) and.push({ createdAt: { lte: new Date(`${to}T23:59:59`) } });
  if (search) and.push({ entityLabel: ilike(search) });
  return { AND: and };
}

router.get('/:wsId/activity', middlewareWorkspace(), async (req, res) => {
  const where = activityWhere(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 20);
  const [items, total, actions] = await Promise.all([
    prisma.activity.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }).then((r) =>
      populateAll(r, [
        ['actor', 'user', USER],
        ['project', 'project', { name: true, color: true }],
      ]),
    ),
    prisma.activity.count({ where }),
    prisma.activity.findMany({ where: { workspace: req.ws.workspace.id }, distinct: ['action'], select: { action: true } }),
  ]);
  res.json({ items, total, page, limit, actions: actions.map((a) => a.action) });
});

router.get('/:wsId/activity.csv', middlewareWorkspace(), async (req, res) => {
  const items = await prisma.activity.findMany({ where: activityWhere(req), orderBy: { createdAt: 'desc' }, take: 10000 });
  await populateAll(items, [
    ['actor', 'user', { name: true, email: true }],
    ['project', 'project', { name: true }],
  ]);
  const cols = String(req.query.columns || 'time,actor,action,entity,before,after,project').split(',');
  const header = { time: 'Thời gian', actor: 'Người thực hiện', action: 'Hành động', entity: 'Đối tượng', before: 'Giá trị cũ', after: 'Giá trị mới', project: 'Dự án' };
  const val = (a, c) =>
    ({
      time: new Date(a.createdAt).toISOString(),
      actor: a.actor?.name,
      action: a.action,
      entity: a.entityLabel,
      before: a.before && typeof a.before === 'object' ? JSON.stringify(a.before) : a.before,
      after: a.after && typeof a.after === 'object' ? JSON.stringify(a.after) : a.after,
      project: a.project?.name,
    })[c];
  const rows = [cols.map((c) => header[c] || c), ...items.map((a) => cols.map((c) => val(a, c)))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="nhat-ky-${Date.now()}.csv"`);
  res.send(toCsv(rows));
});

// ---------- Cài đặt AI ----------
router.get('/:wsId/ai', middlewareWorkspace(), async (req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = await prisma.aiCall.findMany({ where: { workspace: req.ws.workspace.id, createdAt: { gte: start }, status: { notIn: ['quota_exceeded', 'disabled'] } } });
  const ok = today.filter((c) => c.status.includes('success'));
  res.json({
    settings: req.ws.workspace.ai,
    today: {
      used: today.length,
      tokens: today.reduce((s, c) => s + c.inputTokens + c.outputTokens, 0),
      avgLatencyMs: ok.length ? Math.round(ok.reduce((s, c) => s + c.latencyMs, 0) / ok.length) : 0,
      errors: today.filter((c) => !c.status.includes('success')).length,
      total: today.length,
    },
    provider: config.ai.apiKey ? { type: 'anthropic', model: config.ai.model } : { type: 'local', model: 'taskflow-local-rules' },
  });
});

router.patch('/:wsId/ai', middlewareWorkspace('wsId', 'admin'), async (req, res) => {
  const body = parse(
    z.object({
      enabled: z.boolean().optional(),
      dailyLimit: z.number().int().min(0, 'Hạn mức không âm').max(10000).optional(),
      timeoutSec: z.number().int().min(5).max(120).optional(),
      features: z.object({ planner: z.boolean(), report: z.boolean(), qa: z.boolean(), risk: z.boolean(), meeting: z.boolean() }).partial().optional(),
    }),
    req.body,
  );
  const ws = await prisma.$transaction(async (tx) => {
    // Khóa dòng workspace để hai admin cùng lưu không ghi đè lẫn nhau
    await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${req.ws.workspace.id}::uuid FOR UPDATE`;
    const cur = await tx.workspace.findUnique({ where: { id: req.ws.workspace.id }, select: { ai: true } });
    const ai = { ...cur.ai, ...body, features: { ...cur.ai.features, ...body.features } };
    return tx.workspace.update({ where: { id: req.ws.workspace.id }, data: { ai } });
  });
  await logActivity({ workspace: ws.id, actor: req.user.id, action: 'Cập nhật cài đặt AI', entityType: 'ai', entityLabel: 'Trợ lý AI', after: body });
  res.json({ settings: ws.ai });
});

const AI_STATUSES = ['success', 'retried_success', 'timeout', 'error', 'quota_exceeded', 'disabled'];
const AI_FEATURES = ['planner', 'report', 'qa', 'risk', 'meeting'];

router.get('/:wsId/ai/calls', middlewareWorkspace('wsId', 'admin'), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 10);
  const where = { workspace: req.ws.workspace.id };
  if (AI_STATUSES.includes(req.query.status)) where.status = req.query.status;
  if (AI_FEATURES.includes(req.query.feature)) where.feature = req.query.feature;
  const [items, total] = await Promise.all([
    prisma.aiCall.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }).then((r) => populate(r, 'user', 'user', USER)),
    prisma.aiCall.count({ where }),
  ]);
  res.json({ items, total, page, limit });
});

router.get('/:wsId/ai/calls.csv', middlewareWorkspace('wsId', 'admin'), async (req, res) => {
  const items = await prisma.aiCall.findMany({ where: { workspace: req.ws.workspace.id }, orderBy: { createdAt: 'desc' }, take: 10000 });
  await populate(items, 'user', 'user', { name: true });
  const rows = [
    ['Thời gian', 'Người dùng', 'Tính năng', 'Model', 'Token vào', 'Token ra', 'Độ trễ (ms)', 'Trạng thái', 'Lỗi'],
    ...items.map((c) => [new Date(c.createdAt).toISOString(), c.user?.name, c.feature, c.model, c.inputTokens, c.outputTokens, c.latencyMs, c.status, c.error]),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="nhat-ky-ai.csv"');
  res.send(toCsv(rows));
});

// ---------- Việc của tôi & tìm kiếm ----------
const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];
const listParam = (v, allowed) => String(v).split(',').filter((x) => allowed.includes(x));

router.get('/:wsId/my-tasks', middlewareWorkspace(), async (req, res) => {
  const { workspace, role } = req.ws;
  // Chỉ trả task thuộc dự án được phép đọc – điều kiện lồng trong cùng truy vấn
  const readable = atLeast(role, 'admin') ? {} : { projectRef: { members: { has: req.user.id } } };
  const where = { workspace: workspace.id, ...readable };
  const { assignee = 'me', status, priority, due, project, search } = req.query;
  if (assignee === 'me') where.assignee = req.user.id;
  else if (assignee === 'unassigned') where.assignee = null;
  else if (isId(assignee)) where.assignee = assignee;
  if (status) where.status = { in: listParam(status, TASK_STATUSES) };
  else if (req.query.includeDone !== 'true') where.status = { not: 'done' };
  if (priority) where.priority = { in: listParam(priority, PRIORITIES) };
  if (project) where.project = { in: String(project).split(',').filter(isId) };
  const now = new Date();
  const sod = new Date(now);
  sod.setHours(0, 0, 0, 0);
  const eod = new Date(sod.getTime() + 86400000);
  const eow = new Date(sod.getTime() + 7 * 86400000);
  if (due === 'today') where.dueDate = { gte: sod, lt: eod };
  else if (due === 'week') where.dueDate = { gte: sod, lt: eow };
  else if (due === 'overdue') {
    where.dueDate = { lt: sod };
    where.status = { not: 'done' };
  } else if (due === 'none') where.dueDate = null;
  if (search) where.OR = [{ title: ilike(search) }, { key: ilike(search) }];
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 20);
  const mine = { workspace: workspace.id, ...readable, assignee: req.user.id };
  const open = { ...mine, status: { not: 'done' } };
  const weekAgo = new Date(sod.getTime() - 6 * 86400000);
  // Danh sách (kèm dữ liệu liên quan), tổng số và 4 chỉ số tóm tắt chạy song song
  const [items, total, today, overdue, upcoming, doneWeek] = await Promise.all([
    prisma.task
      .findMany({ where, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }, { number: 'asc' }], skip: (page - 1) * limit, take: limit })
      .then(async (rows) => {
        const ids = rows.map((t) => t.id);
        const [, subs, comments] = await Promise.all([
          populateAll(rows, [
            ['assignee', 'user', USER],
            ['project', 'project', { name: true, color: true, keyPrefix: true }],
            ['blockedBy', 'task', { key: true, title: true, status: true, dueDate: true }],
          ]),
          subtaskCounts(ids),
          countBy('comment', 'task', { task: { in: ids } }),
        ]);
        return rows.map((t) => ({ ...t, subtasks: subs[t.id] || { total: 0, done: 0 }, commentCount: comments[t.id] || 0 }));
      }),
    prisma.task.count({ where }),
    prisma.task.count({ where: { ...open, dueDate: { gte: sod, lt: eod } } }),
    prisma.task.count({ where: { ...open, dueDate: { lt: sod } } }),
    prisma.task.count({ where: { ...open, dueDate: { gte: sod, lt: eow } } }),
    prisma.task.count({ where: { ...mine, status: 'done', completedAt: { gte: weekAgo } } }),
  ]);
  res.json({
    items,
    total,
    page,
    limit,
    summary: { today, overdue, upcoming, doneWeek },
  });
});

router.get('/:wsId/search', middlewareWorkspace(), async (req, res) => {
  const { workspace, role } = req.ws;
  const s = String(req.query.q || '').trim();
  if (!s) return res.json({ tasks: [], projects: [] });
  const readable = readableProjectsWhere(req.user.id, workspace.id, role);
  const [tasks, projects] = await Promise.all([
    prisma.task
      .findMany({ where: { projectRef: readable, OR: [{ title: ilike(s) }, { key: ilike(s) }] }, select: { id: true, key: true, title: true, status: true, project: true }, take: 8 })
      .then((r) => populate(r, 'project', 'project', { name: true, color: true })),
    prisma.project.findMany({ where: { ...readable, name: ilike(s) }, select: { id: true, name: true, color: true, status: true }, take: 5 }),
  ]);
  res.json({ tasks, projects });
});

export default router;
