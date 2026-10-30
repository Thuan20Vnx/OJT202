import { saveProjectMembers } from '../services/project-members.js';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { USER, countBy, ilike, isId, isUniqueError, populate, populateAll, prisma, subtaskCounts } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { atLeast, taskPermissions, middlewareWorkspace, readableProjectsWhere, workspaceAccess } from '../middleware/access.js';
import { logActivity, logActivityIn } from '../services/activity.js';
import { aiServiceInfo } from '../services/ai/gateway.js';
import { sendMail } from '../services/mailer.js';
import { emitProject, refreshUserAccess } from '../services/realtime.js';
import { unassignTasks, withWorkspaceLock } from '../services/membership.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../utils/http.js';
import { pagination } from '../utils/http.js';
import { randomToken, sha256, slugify, toCsv } from '../utils/security.js';
import { addDays, isDateInput, parseDate, startOfDay, weekRange } from '../utils/dates.js';

const router = Router();
router.use(requireAuth);

const ROLE_VI = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };

const findMember = (workspace, user) => (isId(user) ? prisma.membership.findUnique({ where: { workspace_user: { workspace, user } } }) : null);

// ---------- Tạo & xem workspace ----------
router.post('/', async (req, res) => {
  const body = parse(
    z.object({
      name: z.string({ error: 'Vui lòng nhập tên workspace' }).trim().min(2, 'Tên workspace quá ngắn').max(80),
      slug: z.string().trim().max(40).optional(),
      size: z.enum(['2-5', '6-10', '11-20']).default('6-10'),
    }),
    req.body,
  );
  const baseSlug = slugify(body.slug || body.name);
  let ws;
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = attempt ? `${baseSlug.slice(0, 31)}-${sha256(randomToken(12)).slice(0, 8)}` : baseSlug;
    try {
      ws = await prisma.workspace.create({ data: { name: body.name, slug, owner: req.user.id, size: body.size, memberships: { create: { user: req.user.id, role: 'owner' } } } });
      break;
    } catch (e) {
      if (!isUniqueError(e) || attempt === 2) throw e;
    }
  }
  await logActivity({ workspace: ws.id, actor: req.user.id, action: 'Tạo workspace', entityType: 'workspace', entityId: ws.id, entityLabel: ws.name });
  res.status(201).json({ workspace: ws });
});

router.get('/check-slug', async (req, res) => {
  const slug = slugify(String(req.query.slug || ''));
  res.json({ slug, available: !(await prisma.workspace.findUnique({ where: { slug } })) });
});

router.get('/:wsId', middlewareWorkspace(), async (req, res) => {
  const { workspace, role } = req.ws;
  const projects = await prisma.project.findMany({ where: readableProjectsWhere(req.user.id, workspace.id, role), include: { memberships: { where: { user: req.user.id } } }, orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] });
  res.json({ workspace, role, projects: projects.map(({ memberships, ...p }) => ({ ...p, projectRole: role === 'viewer' ? 'viewer' : memberships[0].role })) });
});

router.patch('/:wsId', middlewareWorkspace('wsId', 'admin'), async (req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(2).max(80) }).partial(), req.body);
  const ws = await withWorkspaceLock(req.ws.workspace.id, async (tx) => {
    const fresh = await workspaceAccess(req.user.id, req.ws.workspace.id, tx);
    if (!atLeast(fresh.role, 'admin')) throw forbidden();
    const updated = await tx.workspace.update({ where: { id: fresh.workspace.id }, data: body });
    await logActivityIn(tx, {
      workspace: updated.id, actor: req.user.id, action: 'Cập nhật workspace',
      entityType: 'workspace', entityId: updated.id, entityLabel: updated.name,
      before: fresh.workspace.name, after: updated.name,
    });
    return updated;
  });
  res.json({ workspace: ws });
});

// ---------- Thành viên ----------
router.get('/:wsId/members', middlewareWorkspace(), async (req, res) => {
  const wsId = req.ws.workspace.id;
  const [members, projects, lastSeen] = await Promise.all([
    prisma.membership.findMany({ where: { workspace: wsId }, include: { userRef: { select: USER } }, orderBy: { createdAt: 'asc' } }),
    prisma.project.findMany({ where: readableProjectsWhere(req.user.id, wsId, req.ws.role), select: { id: true, name: true, color: true, members: true } }),
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
  const member = await withWorkspaceLock(wsId, async (tx) => {
    const current = await workspaceAccess(req.user.id, wsId, tx);
    if (!atLeast(current.role, 'admin')) throw forbidden();
    const target = isId(req.params.userId) ? await tx.membership.findUnique({ where: { workspace_user: { workspace: wsId, user: req.params.userId } } }) : null;
    if (!target) throw notFound('Không tìm thấy thành viên');
    if (['owner', 'admin'].includes(target.role) && current.role !== 'owner') throw forbidden('Chỉ Owner mới quản lý được Owner/Admin');
    const data = {};
    if (body.role && body.role !== target.role) {
      // Chỉ Owner được trao/thu quyền Owner hoặc Admin
      if ((['owner', 'admin'].includes(body.role) || ['owner', 'admin'].includes(target.role)) && current.role !== 'owner') {
        throw forbidden('Chỉ Owner mới thay đổi được quyền Owner/Admin');
      }
      if (target.role === 'owner' && body.role !== 'owner') {
        const owners = await tx.membership.count({ where: { workspace: wsId, role: 'owner' } });
        if (owners <= 1) throw badRequest('Không thể hạ quyền Owner cuối cùng');
      }
      await tx.activity.create({
        data: {
          workspace: wsId,
          actor: req.user.id,
          action: 'Phân quyền',
          entityType: 'member',
          entityId: target.user,
          entityLabel: (await tx.user.findUnique({ where: { id: target.user }, select: { name: true } })).name,
          before: ROLE_VI[target.role],
          after: ROLE_VI[body.role],
        },
      });
      data.role = body.role;
      if (body.role === 'viewer') {
        await unassignTasks(tx, { workspace: wsId, users: [target.user], actor: req.user.id });
        const projects = await tx.project.findMany({ where: { workspace: wsId, memberships: { some: { user: target.user } } }, include: { memberships: true } });
        for (const p of projects) await saveProjectMembers(tx, p, p.memberships.map((m) => ({ user: m.user, role: m.user === target.user ? 'viewer' : m.role })), p.manager, req.user.id);
      }
      if (current.workspace.owner === target.user && body.role !== 'owner') {
        const replacement = await tx.membership.findFirst({ where: { workspace: wsId, role: 'owner', user: { not: target.user } }, orderBy: { createdAt: 'asc' } });
        await tx.workspace.update({ where: { id: wsId }, data: { owner: replacement.user } });
      }
    }
    if (body.title !== undefined) data.title = body.title;
    if (body.weeklyHours !== undefined) data.weeklyHours = body.weeklyHours;
    return tx.membership.update({ where: { id: target.id }, data });
  });
  await refreshUserAccess(member.user);
  const projects = await prisma.project.findMany({ where: { workspace: wsId }, select: { id: true } });
  for (const p of projects) emitProject(p.id, 'board:refresh', {});
  res.json({ member });
});

router.delete('/:wsId/members/:userId', middlewareWorkspace('wsId', 'admin'), async (req, res) => {
  const wsId = req.ws.workspace.id;
  const projects = await withWorkspaceLock(wsId, async (tx) => {
    const current = await workspaceAccess(req.user.id, wsId, tx);
    if (!atLeast(current.role, 'admin')) throw forbidden();
    const target = isId(req.params.userId) ? await tx.membership.findUnique({ where: { workspace_user: { workspace: wsId, user: req.params.userId } } }) : null;
    if (!target) throw notFound('Không tìm thấy thành viên');
    if (['owner', 'admin'].includes(target.role) && current.role !== 'owner') throw forbidden('Chỉ Owner mới gỡ được Owner/Admin');
    if (target.role === 'owner') {
      const owners = await tx.membership.count({ where: { workspace: wsId, role: 'owner' } });
      if (owners <= 1) throw badRequest('Không thể xóa Owner cuối cùng');
    }
    const person = await tx.user.findUnique({ where: { id: target.user }, select: { email: true, name: true } });
    await unassignTasks(tx, { workspace: wsId, users: [target.user], actor: req.user.id });
    const ps = await tx.project.findMany({ where: { workspace: wsId, memberships: { some: { user: target.user } } }, include: { memberships: true } });
    for (const p of ps) await saveProjectMembers(tx, p, p.memberships.filter((m) => m.user !== target.user).map(({ user, role }) => ({ user, role })), p.manager, req.user.id);
    await tx.membership.delete({ where: { id: target.id } });
    await tx.invite.updateMany({ where: { workspace: wsId, email: person.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (current.workspace.owner === target.user) {
      const replacement = await tx.membership.findFirst({ where: { workspace: wsId, role: 'owner' }, orderBy: { createdAt: 'asc' } });
      await tx.workspace.update({ where: { id: wsId }, data: { owner: replacement.user } });
    }
    await tx.activity.create({
      data: { workspace: wsId, actor: req.user.id, action: 'Gỡ thành viên', entityType: 'member', entityId: target.user, entityLabel: person.name, before: ROLE_VI[target.role] },
    });
    return ps;
  });
  await refreshUserAccess(req.params.userId);
  for (const p of projects) emitProject(p.id, 'board:refresh', {});
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
  const result = await withWorkspaceLock(req.ws.workspace.id, async (tx) => {
    const fresh = await workspaceAccess(req.user.id, req.ws.workspace.id, tx);
    if (!atLeast(fresh.role, 'admin')) throw forbidden();
    if (body.role === 'admin' && fresh.role !== 'owner') throw forbidden('Chỉ Owner mới mời được Admin');
    const ws = fresh.workspace;
    if (body.projects.some((id) => !isId(id))) throw badRequest('Dự án không hợp lệ');
    const projects = await tx.project.findMany({ where: { id: { in: body.projects }, workspace: ws.id, status: 'active', memberships: { some: { user: req.user.id, role: 'pm' } } }, select: { id: true } });
    if (projects.length !== new Set(body.projects).size) throw badRequest('Dự án không thuộc workspace hoặc đã lưu trữ');
    const created = [];
    const skipped = [];
    for (const email of [...new Set(body.emails)]) {
      const existingUser = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (existingUser && (await tx.membership.findUnique({ where: { workspace_user: { workspace: ws.id, user: existingUser.id } } }))) {
        skipped.push({ email, reason: 'Đã là thành viên' });
        continue;
      }
      const pending = await tx.invite.findFirst({ where: { workspace: ws.id, email, acceptedAt: null, revokedAt: null, role: 'admin' } });
      if (pending && fresh.role !== 'owner') throw forbidden('Chỉ Owner được thay đổi lời mời Admin');
      await tx.invite.updateMany({ where: { workspace: ws.id, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const raw = randomToken(24);
      const inv = await tx.invite.create({
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
      created.push({ inv, raw });
    }
    return { ws, created, skipped };
  });
  for (const { inv, raw } of result.created) await sendInvite(result.ws, inv, raw, req.user);
  res.status(201).json({ created: result.created.map(({ inv }) => ({ id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt })), skipped: result.skipped });
});

router.post('/:wsId/invites/:id/resend', middlewareWorkspace('wsId', 'admin'), async (req, res) => {
  const raw = randomToken(24);
  const updated = await withWorkspaceLock(req.ws.workspace.id, async (tx) => {
    const fresh = await workspaceAccess(req.user.id, req.ws.workspace.id, tx);
    if (!atLeast(fresh.role, 'admin')) throw forbidden();
    const inv = isId(req.params.id) ? await tx.invite.findFirst({ where: { id: req.params.id, workspace: fresh.workspace.id, acceptedAt: null, revokedAt: null } }) : null;
    if (!inv) throw notFound('Không tìm thấy lời mời');
    if (inv.role === 'admin' && fresh.role !== 'owner') throw forbidden('Chỉ Owner được thay đổi lời mời Admin');
    return tx.invite.update({ where: { id: inv.id }, data: { tokenHash: sha256(raw), expiresAt: new Date(Date.now() + config.inviteTtlMs) } });
  });
  await sendInvite(req.ws.workspace, updated, raw, req.user);
  res.json({ ok: true, expiresAt: updated.expiresAt });
});

router.delete('/:wsId/invites/:id', middlewareWorkspace('wsId', 'admin'), async (req, res) => {
  await withWorkspaceLock(req.ws.workspace.id, async (tx) => {
    const fresh = await workspaceAccess(req.user.id, req.ws.workspace.id, tx);
    if (!atLeast(fresh.role, 'admin')) throw forbidden();
    const inv = isId(req.params.id) ? await tx.invite.findFirst({ where: { id: req.params.id, workspace: fresh.workspace.id, acceptedAt: null, revokedAt: null } }) : null;
    if (!inv) return;
    if (inv.role === 'admin' && fresh.role !== 'owner') throw forbidden('Chỉ Owner được thay đổi lời mời Admin');
    await tx.invite.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
  });
  res.json({ ok: true });
});

// ---------- Nhật ký hoạt động (chỉ đọc) ----------
const ENTITY_TYPES = ['task', 'project', 'member', 'file', 'workspace', 'comment', 'ai'];

function activityWhere(req) {
  const { workspace } = req.ws;
  const and = [{ workspace: workspace.id }];
  // Thành viên thường chỉ thấy log của dự án mình được gán + log cấp workspace (lọc lồng trong cùng truy vấn)
  and.push({ OR: [{ projectRef: { memberships: { some: { user: req.user.id } } } }, { project: null }] });
  const date = z.string().refine(isDateInput, 'Khoảng ngày không hợp lệ');
  const { actor, action, entityType, project, from, to, search } = parse(z.object({
    actor: z.string().uuid().optional(), project: z.string().uuid().optional(),
    action: z.string().max(200).optional(), entityType: z.enum(ENTITY_TYPES).optional(),
    from: date.optional(), to: date.optional(), search: z.string().max(2000).optional(),
  }), req.query);
  if (actor) and.push({ actor });
  if (action) and.push({ action });
  if (entityType) and.push({ entityType });
  if (project) and.push({ project });
  const start = from ? parseDate(from, req.user.timezone) : null;
  const end = to ? parseDate(to, req.user.timezone, true) : null;
  if (start && end && end < start) throw badRequest('Ngày kết thúc phải từ ngày bắt đầu trở đi');
  if (start) and.push({ createdAt: { gte: start } });
  if (end) and.push({ createdAt: { lte: end } });
  if (search) and.push({ entityLabel: ilike(search) });
  return { AND: and };
}

router.get('/:wsId/activity', middlewareWorkspace(), async (req, res) => {
  const where = activityWhere(req);
  const { page, limit } = pagination(req.query, 20);
  const [items, total, actions] = await Promise.all([
    prisma.activity.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }).then((r) =>
      populateAll(r, [
        ['actor', 'user', USER],
        ['project', 'project', { name: true, color: true }],
      ]),
    ),
    prisma.activity.count({ where }),
    prisma.activity.findMany({ where: activityWhere({ ...req, query: {} }), distinct: ['action'], select: { action: true } }),
  ]);
  res.json({ items, total, page, limit, actions: actions.map((a) => a.action) });
});

router.get('/:wsId/activity.csv', middlewareWorkspace(), async (req, res) => {
  const columns = ['time', 'actor', 'action', 'entity', 'before', 'after', 'project'];
  const { columns: requested } = parse(z.object({ columns: z.string().optional() }), req.query);
  const cols = requested === undefined ? columns : requested.split(',');
  if (!cols.length || cols.some((c) => !columns.includes(c)) || new Set(cols).size !== cols.length) throw badRequest('Cột CSV không hợp lệ');
  const items = await prisma.activity.findMany({ where: activityWhere(req), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10001 });
  if (items.length > 10000) throw badRequest('Có hơn 10.000 bản ghi. Hãy thu hẹp khoảng ngày hoặc bộ lọc để xuất đầy đủ.');
  await populateAll(items, [
    ['actor', 'user', { name: true, email: true }],
    ['project', 'project', { name: true }],
  ]);
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
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `attachment; filename="nhat-ky-${Date.now()}.csv"`);
  res.send(toCsv(rows));
});

// ---------- Cài đặt AI ----------
router.get('/:wsId/ai', middlewareWorkspace(), async (req, res) => {
  const start = startOfDay();
  const [today, provider] = await Promise.all([
    prisma.aiCall.findMany({ where: { workspace: req.ws.workspace.id, createdAt: { gte: start }, status: { notIn: ['quota_exceeded', 'disabled'] } } }),
    aiServiceInfo(),
  ]);
  const ok = today.filter((c) => c.status.includes('success'));
  res.json({
    settings: req.ws.workspace.ai,
    today: {
      used: today.length,
      tokens: today.reduce((s, c) => s + c.inputTokens + c.outputTokens, 0),
      avgLatencyMs: ok.length ? Math.round(ok.reduce((s, c) => s + c.latencyMs, 0) / ok.length) : 0,
      errors: today.filter((c) => ['error', 'timeout'].includes(c.status)).length,
      total: today.length,
    },
    provider: provider || { type: 'unavailable', model: null }, // null: không kết nối được AIService
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
    if (!atLeast((await workspaceAccess(req.user.id, req.ws.workspace.id, tx)).role, 'admin')) throw forbidden();
    const cur = await tx.workspace.findUnique({ where: { id: req.ws.workspace.id }, select: { ai: true } });
    const ai = { ...cur.ai, ...body, features: { ...cur.ai.features, ...body.features } };
    return tx.workspace.update({ where: { id: req.ws.workspace.id }, data: { ai } });
  });
  await logActivity({ workspace: ws.id, actor: req.user.id, action: 'Cập nhật cài đặt AI', entityType: 'ai', entityLabel: 'Trợ lý AI', after: body });
  res.json({ settings: ws.ai });
});

const AI_STATUSES = ['pending', 'success', 'retried_success', 'timeout', 'error', 'quota_exceeded', 'disabled'];
const AI_FEATURES = ['planner', 'report', 'qa', 'risk', 'meeting'];

router.get('/:wsId/ai/calls', middlewareWorkspace('wsId', 'admin'), async (req, res) => {
  const { page, limit } = pagination(req.query, 10);
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
const listParam = (v, allowed) =>
  String(v)
    .split(',')
    .filter((x) => allowed.includes(x));

router.get('/:wsId/my-tasks', middlewareWorkspace(), async (req, res) => {
  const { workspace, role } = req.ws;
  // Chỉ trả task thuộc dự án được phép đọc – điều kiện lồng trong cùng truy vấn
  const readable = { projectRef: { memberships: { some: { user: req.user.id } } } };
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
  const sod = startOfDay(now, req.user.timezone);
  const eod = addDays(sod, 1, req.user.timezone);
  const { end: eow } = weekRange(now, req.user.timezone);
  if (due === 'today') where.dueDate = { gte: sod, lt: eod };
  else if (due === 'week') where.dueDate = { gte: sod, lt: eow };
  else if (due === 'overdue') {
    where.dueDate = { lt: now };
    where.status = { ...where.status, not: 'done' };
  } else if (due === 'none') where.dueDate = null;
  if (search) where.OR = [{ title: ilike(search) }, { key: ilike(search) }];
  const { page, limit } = pagination(req.query, 20);
  const mine = { workspace: workspace.id, ...readable, assignee: req.user.id };
  const open = { ...mine, status: { not: 'done' } };
  const weekAgo = new Date(sod.getTime() - 6 * 86400000);
  // Danh sách (kèm dữ liệu liên quan), tổng số và 4 chỉ số tóm tắt chạy song song
  const [items, total, today, overdue, upcoming, doneWeek, actionable] = await Promise.all([
    prisma.task
      .findMany({ where: { ...where, deletedAt: null }, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }, { number: 'asc' }], skip: (page - 1) * limit, take: limit })
      .then(async (rows) => {
        const ids = rows.map((t) => t.id);
        const [, subs, comments] = await Promise.all([
          populateAll(rows, [
            ['assignee', 'user', USER],
            ['project', 'project', { name: true, color: true, keyPrefix: true, manager: true, status: true, memberships: { where: { user: req.user.id } } }],
            ['blockedBy', 'task', { key: true, title: true, status: true, dueDate: true }],
          ]),
          subtaskCounts(ids),
          countBy('comment', 'task', { task: { in: ids } }),
        ]);
        return rows.map((t) => {
          const projectRole = role === 'viewer' ? 'viewer' : t.project.memberships[0]?.role;
          const canWrite = !!projectRole && projectRole !== 'viewer' && t.project.status !== 'archived';
          const access = { project: t.project, projectRole, canWrite, canManage: canWrite && projectRole === 'pm' };
          const permissions = taskPermissions(access, req.user.id, { ...t, assignee: t.assignee?.id });
          return {
            ...t, subtasks: subs[t.id] || { total: 0, done: 0 }, commentCount: comments[t.id] || 0,
            permissions,
            access: { canWrite: permissions.canUpdateProgress, canManage: access.canManage },
          };
        });
      }),
    prisma.task.count({ where: { ...where, deletedAt: null } }),
    prisma.task.count({ where: { deletedAt: null, ...open, dueDate: { gte: sod, lt: eod } } }),
    prisma.task.count({ where: { deletedAt: null, ...open, dueDate: { lt: now } } }),
    prisma.task.count({ where: { deletedAt: null, ...open, dueDate: { gte: now, lt: eow } } }),
    prisma.task.count({ where: { deletedAt: null, ...mine, status: 'done', completedAt: { gte: weekAgo } } }),
    // Union of overdue and due today, so tasks overdue earlier today count once.
    prisma.task.count({ where: { deletedAt: null, ...open, dueDate: { lt: eod } } }),
  ]);
  res.json({
    items,
    total,
    page,
    limit,
    summary: { today, overdue, upcoming, doneWeek, actionable },
  });
});

router.get('/:wsId/search', middlewareWorkspace(), async (req, res) => {
  const { workspace, role } = req.ws;
  const s = String(req.query.q || '').trim();
  if (!s) return res.json({ tasks: [], projects: [] });
  const readable = readableProjectsWhere(req.user.id, workspace.id, role);
  const [tasks, projects] = await Promise.all([
    prisma.task
      .findMany({
        where: { deletedAt: null, projectRef: readable, OR: [{ title: ilike(s) }, { key: ilike(s) }] },
        select: { id: true, key: true, title: true, status: true, project: true },
        take: 8,
      })
      .then((r) => populate(r, 'project', 'project', { name: true, color: true })),
    prisma.project.findMany({ where: { ...readable, name: ilike(s) }, select: { id: true, name: true, color: true, status: true }, take: 5 }),
  ]);
  res.json({ tasks, projects });
});

export default router;
