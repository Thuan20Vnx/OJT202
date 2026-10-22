import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies, signAccess, startSession } from '../middleware/auth.js';
import { sendMail } from '../services/mailer.js';
import { disconnectUser } from '../services/realtime.js';
import { HttpError, badRequest, forbidden, parse, unauthorized } from '../utils/http.js';
import { passwordIssues, randomToken, sha256 } from '../utils/security.js';

const router = Router();

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isProd ? 30 : 1000, standardHeaders: true, legacyHeaders: false });
router.use(limiter);

const email = z.string({ required_error: 'Vui lòng nhập email' }).trim().toLowerCase().email('Email không hợp lệ');
const strongPassword = z.string().superRefine((pw, ctx) => {
  const issues = passwordIssues(pw);
  if (issues.length) ctx.addIssue({ code: 'custom', message: `Mật khẩu cần ${issues.join(', ')}` });
});

async function issueToken(user, type, ttlMs) {
  const raw = randomToken(32);
  await prisma.token.create({ data: { user: user.id, type, hash: sha256(raw), expiresAt: new Date(Date.now() + ttlMs) } });
  return raw;
}

/** Dùng token một lần: kiểm tra hạn + chưa dùng, đánh dấu đã dùng nguyên tử (UPDATE có điều kiện). */
async function consumeToken(raw, type) {
  if (!raw) return null;
  const hash = sha256(String(raw));
  const { count } = await prisma.token.updateMany({ where: { hash, type, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  return count ? prisma.token.findUnique({ where: { hash } }) : null;
}

async function sendVerification(user) {
  const raw = await issueToken(user, 'verify', config.verifyTtlMs);
  const link = `${config.clientUrl}/verify-email?token=${raw}`;
  await sendMail({ to: user.email, subject: 'Xác minh email TaskFlow', text: `Chào ${user.name}, bấm liên kết để xác minh (hiệu lực 24 giờ).`, link });
}

const revokeWhere = (where) => prisma.session.updateMany({ where: { ...where, revokedAt: null }, data: { revokedAt: new Date() } });

router.post('/register', async (req, res) => {
  const body = parse(
    z.object({
      name: z.string({ required_error: 'Vui lòng nhập họ tên' }).trim().min(1, 'Vui lòng nhập họ tên').max(80),
      email,
      password: strongPassword,
      acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Bạn cần đồng ý điều khoản' }) }),
    }),
    req.body,
  );
  const exists = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
  if (exists) throw badRequest('Email đã được sử dụng', { fields: { email: 'Email đã được sử dụng' } });
  const user = await prisma.user.create({ data: { name: body.name, email: body.email, passwordHash: await bcrypt.hash(body.password, 12) } });
  await sendVerification(user);
  res.status(201).json({ ok: true, email: user.email });
});

router.post('/verify-email', async (req, res) => {
  const token = await consumeToken(req.body?.token, 'verify');
  if (!token) throw badRequest('Liên kết đã hết hạn hoặc đã được sử dụng');
  const user = await prisma.user.update({ where: { id: token.user }, data: { emailVerified: true } });
  await startSession(res, req, user);
  res.json({ ok: true });
});

router.post('/resend-verification', async (req, res) => {
  const { email: mail } = parse(z.object({ email }), req.body);
  const user = await prisma.user.findUnique({ where: { email: mail } });
  if (user && !user.emailVerified) await sendVerification(user);
  res.json({ ok: true }); // luôn trả ok để không lộ email nào tồn tại
});

const GENERIC_LOGIN_ERROR = 'Email hoặc mật khẩu không đúng';
const DUMMY_HASH = bcrypt.hashSync('taskflow-dummy-password', 10);

router.post('/login', async (req, res) => {
  const body = parse(z.object({ email, password: z.string().min(1, 'Vui lòng nhập mật khẩu'), remember: z.boolean().optional() }), req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email }, omit: { passwordHash: false } });
  // So sánh với hash giả khi không có user để thời gian phản hồi như nhau
  const ok = await bcrypt.compare(body.password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) throw unauthorized(GENERIC_LOGIN_ERROR);
  if (user.isLocked) throw forbidden('Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.');
  if (!user.emailVerified) throw new HttpError(403, 'Vui lòng xác minh email trước khi đăng nhập', { code: 'EMAIL_NOT_VERIFIED' });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await startSession(res, req, user);
  res.json({ ok: true });
});

/** Xoay vòng refresh token. Dùng lại token cũ => thu hồi cả "họ" phiên (nghi bị đánh cắp). */
router.post('/refresh', async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) throw unauthorized();
  const session = await prisma.session.findFirst({ where: { refreshHash: sha256(raw) } });
  if (!session) throw unauthorized();
  if (session.revokedAt) {
    if (session.replacedBy) await revokeWhere({ family: session.family });
    clearAuthCookies(res);
    throw unauthorized('Phiên đăng nhập không còn hiệu lực');
  }
  if (session.expiresAt < new Date()) throw unauthorized('Phiên đăng nhập đã hết hạn');
  const user = await prisma.user.findUnique({ where: { id: session.user } });
  if (!user || user.isLocked) throw unauthorized();

  const nextRaw = randomToken(48);
  const next = await prisma.session.create({
    data: {
      user: user.id,
      refreshHash: sha256(nextRaw),
      family: session.family,
      userAgent: session.userAgent,
      ip: req.ip,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
    },
  });
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), replacedBy: next.id } });
  setAuthCookies(res, signAccess(user.id, next.id), nextRaw);
  res.json({ ok: true });
});

router.post('/logout', async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (raw) {
    const s = await prisma.session.findFirst({ where: { refreshHash: sha256(raw) } });
    if (s) await revokeWhere({ family: s.family });
  }
  clearAuthCookies(res);
  res.json({ ok: true });
});

router.post('/forgot-password', async (req, res) => {
  const { email: mail } = parse(z.object({ email }), req.body);
  const user = await prisma.user.findUnique({ where: { email: mail } });
  if (user && !user.isLocked) {
    const raw = await issueToken(user, 'reset', config.resetTtlMs);
    await sendMail({
      to: user.email,
      subject: 'Đặt lại mật khẩu TaskFlow',
      text: 'Liên kết chỉ dùng được một lần và hết hạn sau 30 phút.',
      link: `${config.clientUrl}/reset-password?token=${raw}`,
    });
  }
  res.json({ ok: true }); // không tiết lộ email có tồn tại hay không
});

router.get('/reset-password/check', async (req, res) => {
  const t = await prisma.token.findFirst({ where: { hash: sha256(String(req.query.token || '')), type: 'reset', usedAt: null, expiresAt: { gt: new Date() } } });
  res.json({ valid: !!t });
});

router.post('/reset-password', async (req, res) => {
  const body = parse(z.object({ token: z.string().min(1), password: strongPassword }), req.body);
  const token = await consumeToken(body.token, 'reset');
  if (!token) throw badRequest('Liên kết đã hết hạn hoặc đã được sử dụng', { code: 'TOKEN_INVALID' });
  await prisma.user.update({ where: { id: token.user }, data: { passwordHash: await bcrypt.hash(body.password, 12), emailVerified: true } });
  // Đổi mật khẩu => thu hồi mọi phiên cũ
  await revokeWhere({ user: token.user });
  await disconnectUser(token.user);
  clearAuthCookies(res);
  res.json({ ok: true });
});

/** Thông tin lời mời (chấp nhận cần đăng nhập bằng đúng email được mời). */
router.get('/invite/:token', async (req, res) => {
  const inv = await prisma.invite.findUnique({ where: { tokenHash: sha256(req.params.token) } });
  if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) return res.json({ valid: false });
  const ws = await prisma.workspace.findUnique({ where: { id: inv.workspace }, select: { id: true, name: true } });
  res.json({ valid: true, email: inv.email, role: inv.role, workspace: ws });
});

export default router;
