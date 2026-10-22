import { Router } from 'express';
import { z } from 'zod';
import { USER, countBy, ilike, isId, populate, populateAll, prisma } from '../db.js';
import { requireAuth, requireSystemAdmin } from '../middleware/auth.js';
import { disconnectUser } from '../services/realtime.js';
import { badRequest, notFound, parse } from '../utils/http.js';

/**
 * Quản trị hệ thống: quản lý TÀI KHOẢN toàn nền tảng.
 * Không có endpoint nào đọc nội dung dự án/công việc của workspace – System Admin không mặc định xem dữ liệu nhóm.
 */
const router = Router();
router.use(requireAuth, requireSystemAdmin);

const REASONS = ['Spam lời mời', 'Vi phạm điều khoản', 'Yêu cầu của chủ nhóm', 'Khác'];

const findUser = async (id) => {
  const user = isId(id) ? await prisma.user.findUnique({ where: { id } }) : null;
  if (!user) throw notFound('Không tìm thấy người dùng');
  return user;
};
const revokeAll = (user) => prisma.session.updateMany({ where: { user, revokedAt: null }, data: { revokedAt: new Date() } });

router.get('/stats', async (_req, res) => {
  const [users, locked, workspaces] = await Promise.all([prisma.user.count(), prisma.user.count({ where: { isLocked: true } }), prisma.workspace.count()]);
  res.json({ users, active: users - locked, locked, workspaces });
});

router.get('/users', async (req, res) => {
  const where = {};
  if (req.query.status === 'locked') where.isLocked = true;
  if (req.query.status === 'active') where.isLocked = false;
  if (req.query.search) where.OR = [{ name: ilike(req.query.search) }, { email: ilike(req.query.search) }];
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 20);
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.user.count({ where }),
  ]);
  const wsCount = await countBy('membership', 'user', { user: { in: users.map((u) => u.id) } });
  res.json({
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      emailVerified: u.emailVerified,
      isSystemAdmin: u.isSystemAdmin,
      locked: u.isLocked ? { reason: u.lockReason, at: u.lockedAt } : null,
      workspaces: wsCount[u.id] || 0,
    })),
    total,
    page,
    limit,
    reasons: REASONS,
  });
});

router.post('/users/:id/lock', async (req, res) => {
  const body = parse(z.object({ reason: z.enum(REASONS, { errorMap: () => ({ message: 'Vui lòng chọn lý do khóa' }) }), note: z.string().max(500).default('') }), req.body);
  if (req.params.id === req.user.id) throw badRequest('Không thể tự khóa tài khoản của mình');
  const user = await findUser(req.params.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { isLocked: true, lockReason: body.reason, lockNote: body.note, lockedAt: new Date(), lockedBy: req.user.id },
  });
  // Chặn mọi phiên đăng nhập ngay lập tức
  await revokeAll(user.id);
  await disconnectUser(user.id);
  await prisma.adminAudit.create({ data: { admin: req.user.id, action: 'lock', targetUser: user.id, reason: body.reason, note: body.note } });
  res.json({ ok: true });
});

router.post('/users/:id/unlock', async (req, res) => {
  const user = await findUser(req.params.id);
  await prisma.user.update({ where: { id: user.id }, data: { isLocked: false, lockReason: null, lockNote: null, lockedAt: null, lockedBy: null } });
  await prisma.adminAudit.create({ data: { admin: req.user.id, action: 'unlock', targetUser: user.id } });
  res.json({ ok: true });
});

router.post('/users/:id/logout', async (req, res) => {
  const user = await findUser(req.params.id);
  await revokeAll(user.id);
  await disconnectUser(user.id);
  await prisma.adminAudit.create({ data: { admin: req.user.id, action: 'force_logout', targetUser: user.id } });
  res.json({ ok: true });
});

router.get('/workspaces', async (_req, res) => {
  const [ws, members] = await Promise.all([
    prisma.workspace.findMany({ select: { id: true, name: true, slug: true, plan: true, createdAt: true, owner: true }, orderBy: { createdAt: 'desc' } }).then((r) => populate(r, 'owner', 'user', USER)),
    countBy('membership', 'workspace', {}),
  ]);
  res.json({ workspaces: ws.map((w) => ({ ...w, members: members[w.id] || 0 })) });
});

router.get('/audit', async (_req, res) => {
  const items = await prisma.adminAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  await populateAll(items, [
    ['admin', 'user', USER],
    ['targetUser', 'user', USER],
  ]);
  res.json({ items });
});

export default router;
