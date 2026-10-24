import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { isId, prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';
import { meUser } from '../services/serialize.js';
import { badRequest, forbidden, notFound, parse } from '../utils/http.js';
import { passwordIssues, sha256 } from '../utils/security.js';
import { withWorkspaceLock } from '../services/membership.js';
import { disconnectUser, refreshUserAccess } from '../services/realtime.js';
import { withUserLock } from '../services/sessions.js';
import { isTimeZone } from '../utils/dates.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const memberships = await prisma.membership.findMany({
    where: { user: req.user.id },
    include: { workspaceRef: { select: { id: true, name: true, slug: true, plan: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json({
    user: meUser(req.user),
    workspaces: memberships.map((m) => ({ ...m.workspaceRef, role: m.role })),
  });
});

// Cập nhật hồ sơ: chỉ các trường cá nhân. Vai trò do Owner/Admin quản lý nên không nhận ở đây.
router.patch('/', async (req, res) => {
  const body = parse(
    z
      .object({
        name: z.string().trim().min(1, 'Vui lòng nhập họ tên').max(80),
        title: z.string().trim().max(60),
        timezone: z.string().min(1).max(60).refine(isTimeZone, 'Múi giờ IANA không hợp lệ'),
        language: z.enum(['vi', 'en']),
      })
      .partial()
      .strict('Trường không được phép cập nhật'),
    req.body,
  );
  const user = await prisma.user.update({ where: { id: req.user.id }, data: body });
  res.json({ user: meUser(user) });
});

const revokeOthers = (req, db) => db.session.updateMany({ where: { user: req.user.id, revokedAt: null, family: { not: req.session.family } }, data: { revokedAt: new Date() } });

router.post('/password', async (req, res) => {
  const body = parse(z.object({ currentPassword: z.string().min(1, 'Nhập mật khẩu hiện tại'), newPassword: z.string() }), req.body);
  const issues = passwordIssues(body.newPassword);
  if (issues.length) throw badRequest(`Mật khẩu cần ${issues.join(', ')}`, { fields: { newPassword: issues.join(', ') } });
  if (Buffer.byteLength(body.currentPassword, 'utf8') > 72) throw badRequest('Mật khẩu hiện tại không đúng');
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, omit: { passwordHash: false } });
  if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
    throw badRequest('Mật khẩu hiện tại không đúng', { fields: { currentPassword: 'Mật khẩu hiện tại không đúng' } });
  }
  const passwordHash = await bcrypt.hash(body.newPassword, 12);
  const { count } = await withUserLock(user.id, async (tx) => {
    const current = await tx.user.findUnique({ where: { id: user.id }, omit: { passwordHash: false } });
    const session = await tx.session.findUnique({ where: { id: req.session.id } });
    if (current.passwordHash !== user.passwordHash || !session || session.revokedAt || current.isLocked) throw forbidden('Thông tin đăng nhập đã thay đổi, vui lòng đăng nhập lại');
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await tx.token.updateMany({ where: { user: user.id, type: { in: ['reset', 'verify'] }, usedAt: null }, data: { usedAt: new Date() } });
    return revokeOthers(req, tx);
  });
  await disconnectUser(req.user.id);
  res.json({ ok: true, revokedSessions: count });
});

router.get('/sessions', async (req, res) => {
  const sessions = await prisma.session.findMany({
    where: { user: req.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' },
  });
  res.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastUsedAt: s.updatedAt,
      current: s.family === req.session.family,
    })),
  });
});

router.delete('/sessions/:id', async (req, res) => {
  const s = isId(req.params.id) ? await prisma.session.findFirst({ where: { id: req.params.id, user: req.user.id } }) : null;
  if (!s) throw notFound('Không tìm thấy phiên');
  await withUserLock(req.user.id, (tx) => tx.session.updateMany({ where: { family: s.family, revokedAt: null }, data: { revokedAt: new Date() } }));
  await disconnectUser(req.user.id);
  res.json({ ok: true, current: s.family === req.session.family });
});

router.post('/sessions/revoke-others', async (req, res) => {
  const { count } = await withUserLock(req.user.id, (tx) => revokeOthers(req, tx));
  await disconnectUser(req.user.id);
  res.json({ ok: true, revoked: count });
});

router.get('/notification-prefs', async (req, res) => {
  const pref = await prisma.notificationPref.upsert({ where: { user: req.user.id }, create: { user: req.user.id }, update: {} });
  res.json({ prefs: pref });
});

router.patch('/notification-prefs', async (req, res) => {
  const body = parse(
    z.object({ assigned: z.boolean(), mentioned: z.boolean(), due_soon: z.boolean(), status: z.boolean(), comment: z.boolean(), email: z.boolean() }).partial(),
    req.body,
  );
  const pref = await prisma.notificationPref.upsert({ where: { user: req.user.id }, create: { user: req.user.id, ...body }, update: body });
  res.json({ prefs: pref });
});

// Chấp nhận lời mời – email đăng nhập phải trùng email được mời
router.post('/invites/:token/accept', async (req, res) => {
  const inv = await prisma.invite.findUnique({ where: { tokenHash: sha256(req.params.token) } });
  if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) throw badRequest('Lời mời đã hết hạn hoặc không còn hiệu lực');
  if (inv.email !== req.user.email) throw forbidden(`Lời mời này dành cho ${inv.email}`);
  const userId = req.user.id;
  await withWorkspaceLock(inv.workspace, async (tx) => {
    const { count } = await tx.invite.updateMany({
      where: { id: inv.id, tokenHash: sha256(req.params.token), acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date() },
    });
    if (!count) throw badRequest('Lời mời đã hết hạn hoặc không còn hiệu lực');
    await tx.membership.upsert({
      where: { workspace_user: { workspace: inv.workspace, user: userId } },
      create: { workspace: inv.workspace, user: userId, role: inv.role },
      update: {},
    });
    // Thêm vào các dự án được chỉ định (không trùng)
    const projects = await tx.project.findMany({
      where: { id: { in: inv.projects }, workspace: inv.workspace, status: 'active', NOT: { members: { has: userId } } },
      select: { id: true },
    });
    for (const p of projects) await tx.project.update({ where: { id: p.id }, data: { members: { push: userId } } });
  });
  await refreshUserAccess(userId);
  await logActivity({
    workspace: inv.workspace,
    actor: userId,
    action: 'Tham gia workspace',
    entityType: 'member',
    entityId: userId,
    entityLabel: req.user.name,
    after: inv.role,
  });
  res.json({ ok: true, workspaceId: inv.workspace });
});

export default router;
