import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies, signAccess, startSession } from '../middleware/auth.js';
import { verifyGoogleCredential } from '../services/google.js';
import { sendMail, privateMailAttempt } from '../services/mailer.js';
import { consumeOtp, issueOtp } from '../services/otp.js';
import { assertLoginAllowed, clearLoginFailures, enforce, lockedMessage, mailAllowed, recordLoginFailure } from '../services/throttle.js';
import { disconnectUser } from '../services/realtime.js';
import { withUserLock } from '../services/sessions.js';
import { revokeAllAgentTokens } from '../services/agent-tokens.js';
import { HttpError, badRequest, forbidden, parse, unauthorized } from '../utils/http.js';
import { passwordIssues, randomToken, sha256 } from '../utils/security.js';

const router = Router();

// Bộ test API đăng nhập hơn 1000 lần từ một IP trong một cửa sổ; ngưỡng production vẫn kiểm ở test/auth-limit.test.js.
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isProd ? 30 : config.isTest ? 100000 : 1000, standardHeaders: true, legacyHeaders: false });
router.use(limiter);

const email = z.string({ error: 'Vui lòng nhập email' }).trim().toLowerCase().email('Email không hợp lệ');
const strongPassword = z.string().superRefine((pw, ctx) => {
  const issues = passwordIssues(pw);
  if (issues.length) ctx.addIssue({ code: 'custom', message: `Mật khẩu cần ${issues.join(', ')}` });
});

async function issueToken(user, type, ttlMs) {
  const raw = randomToken(32);
  await prisma.token.create({ data: { user: user.id, type, hash: sha256(raw), expiresAt: new Date(Date.now() + ttlMs) } });
  return raw;
}

async function sendVerification(user) {
  const raw = await issueToken(user, 'verify', config.verifyTtlMs);
  const code = await issueOtp(user.id, 'verify');
  const link = `${config.clientUrl}/verify-email?token=${raw}`;
  await sendMail({ to: user.email, subject: 'Xác minh email TaskFlow', text: `Chào ${user.name}, mã xác minh của bạn là ${code} (hiệu lực 10 phút). Hoặc bấm liên kết bên dưới để xác minh (hiệu lực 24 giờ).`, link });
}

const HOUR = 3600 * 1000;
const enforceMailIp = (req) => enforce(`mail:ip:${req.ip}`, { limit: config.security.mailPerIpPerHour, windowMs: HOUR }, 'Bạn đã yêu cầu gửi email quá nhiều lần. Vui lòng thử lại sau.');

router.post('/register', async (req, res) => {
  const body = parse(
    z.object({
      name: z.string({ error: 'Vui lòng nhập họ tên' }).trim().min(1, 'Vui lòng nhập họ tên').max(80),
      email,
      password: strongPassword,
      acceptTerms: z.literal(true, { error: 'Bạn cần đồng ý điều khoản' }),
      // Bẫy bot: trường ẩn trên form, người thật không bao giờ điền.
      website: z.string().max(200).optional(),
    }),
    req.body,
  );
  if (body.website) return res.status(201).json({ ok: true, email: body.email });
  await enforce(`register:ip:${req.ip}`, { limit: config.security.registerPerIpPerHour, windowMs: HOUR }, 'Đã tạo quá nhiều tài khoản từ mạng này. Vui lòng thử lại sau 1 giờ.');
  const exists = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
  if (exists) throw badRequest('Email đã được sử dụng', { fields: { email: 'Email đã được sử dụng' } });
  const user = await prisma.user.create({ data: { name: body.name, email: body.email, passwordHash: await bcrypt.hash(body.password, 12) } });
  await sendVerification(user);
  res.status(201).json({ ok: true, email: user.email });
});

router.post('/verify-email', async (req, res) => {
  const body = parse(z.object({ token: z.string().min(1).max(200) }), req.body);
  const token = await prisma.token.findUnique({ where: { hash: sha256(body.token) } });
  if (!token || token.type !== 'verify') throw badRequest('Liên kết đã hết hạn hoặc đã được sử dụng');
  const user = await withUserLock(token.user, async (tx) => {
    const current = await tx.user.findUnique({ where: { id: token.user }, omit: { passwordHash: false } });
    if (!current || current.emailVerified || current.isLocked) return null;
    const used = await tx.token.updateMany({ where: { id: token.id, type: 'verify', usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (!used.count) return null;
    await tx.token.updateMany({ where: { user: current.id, type: 'verify', usedAt: null }, data: { usedAt: new Date() } });
    return tx.user.update({ where: { id: current.id }, data: { emailVerified: true }, omit: { passwordHash: false } });
  });
  if (!user) throw badRequest('Liên kết đã hết hạn hoặc đã được sử dụng');
  await startSession(res, req, user);
  res.json({ ok: true });
});

/** Xác minh email bằng mã OTP 6 số gửi kèm email đăng ký. */
router.post('/verify-otp', async (req, res) => {
  const body = parse(z.object({ email, code: z.string().trim().regex(/^\d{6}$/, 'Mã gồm 6 chữ số') }), req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
  const verified = user
    ? await withUserLock(user.id, async (tx) => {
        const current = await tx.user.findUnique({ where: { id: user.id }, omit: { passwordHash: false } });
        if (!current || current.emailVerified || current.isLocked) return null;
        if (!(await consumeOtp(current.id, 'verify', body.code, tx))) return null;
        await tx.token.updateMany({ where: { user: current.id, type: 'verify', usedAt: null }, data: { usedAt: new Date() } });
        return tx.user.update({ where: { id: current.id }, data: { emailVerified: true }, omit: { passwordHash: false } });
      })
    : null;
  if (!verified) throw badRequest('Mã không đúng hoặc đã hết hạn', { code: 'OTP_INVALID' });
  await startSession(res, req, verified);
  res.json({ ok: true });
});

router.post('/resend-verification', async (req, res) => {
  const { email: mail } = parse(z.object({ email }), req.body);
  await enforceMailIp(req);
  const user = await prisma.user.findUnique({ where: { email: mail } });
  if (user && !user.emailVerified && await mailAllowed(mail)) await privateMailAttempt(() => sendVerification(user));
  res.json({ ok: true }); // luôn trả ok để không lộ email nào tồn tại
});

const GENERIC_LOGIN_ERROR = 'Email hoặc mật khẩu không đúng';
const DUMMY_HASH = bcrypt.hashSync('taskflow-dummy-password', 12);

router.post('/login', async (req, res) => {
  const body = parse(z.object({ email, password: z.string().min(1, 'Vui lòng nhập mật khẩu'), remember: z.boolean().optional() }), req.body);
  await assertLoginAllowed(body.email);
  const user = await prisma.user.findUnique({ where: { email: body.email }, omit: { passwordHash: false } });
  // So sánh với hash giả khi không có user để thời gian phản hồi như nhau
  const tooLong = Buffer.byteLength(body.password, 'utf8') > 72;
  const ok = !tooLong && await bcrypt.compare(body.password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) {
    const attemptsLeft = await recordLoginFailure(body.email);
    if (!attemptsLeft) throw new HttpError(429, lockedMessage(), { code: 'LOGIN_LOCKED', retryAfterSec: config.security.loginLockMinutes * 60 });
    throw new HttpError(401, GENERIC_LOGIN_ERROR, { code: 'BAD_CREDENTIALS', attemptsLeft });
  }
  if (user.isLocked) throw forbidden('Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.');
  if (!user.emailVerified) throw new HttpError(403, 'Vui lòng xác minh email trước khi đăng nhập', { code: 'EMAIL_NOT_VERIFIED' });
  await clearLoginFailures(body.email);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await startSession(res, req, user, { remember: body.remember === true });
  res.json({ ok: true });
});

/** Xoay vòng refresh token. Dùng lại token cũ => thu hồi cả "họ" phiên (nghi bị đánh cắp). */
router.post('/refresh', async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) throw unauthorized();
  const nextRaw = randomToken(48);
  const result = await prisma.$transaction(async (tx) => {
    const hash = sha256(raw);
    // Khóa người dùng để các thế hệ token trong cùng họ cũng tuần tự hóa.
    const found = await tx.session.findFirst({ where: { refreshHash: hash } });
    if (!found) return null;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${found.user}::uuid FOR UPDATE`;
    const session = await tx.session.findUnique({ where: { id: found.id } });
    if (session.revokedAt) {
      if (session.replacedBy) await tx.session.updateMany({ where: { family: session.family, revokedAt: null }, data: { revokedAt: new Date() } });
      // Trả kết quả, không throw trong transaction: phải commit việc thu hồi họ phiên.
      return { revokedUser: session.user };
    }
    if (session.expiresAt <= new Date()) return null;
    const user = await tx.user.findUnique({ where: { id: session.user } });
    if (!user || user.isLocked) return null;
    const next = await tx.session.create({
      data: {
        user: user.id,
        refreshHash: sha256(nextRaw),
        family: session.family,
        remember: session.remember,
        userAgent: session.userAgent,
        ip: req.ip,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
      },
    });
    await tx.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), replacedBy: next.id } });
    return { user, next };
  });
  if (!result?.next) {
    if (result?.revokedUser) await disconnectUser(result.revokedUser);
    clearAuthCookies(res, req.baseUrl);
    throw unauthorized('Phiên đăng nhập không còn hiệu lực');
  }
  setAuthCookies(res, signAccess(result.user.id, result.next.id), nextRaw, result.next, req.baseUrl);
  res.json({ ok: true });
});

router.post('/logout', async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (raw) {
    const s = await prisma.session.findFirst({ where: { refreshHash: sha256(raw) } });
    if (s) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${s.user}::uuid FOR UPDATE`;
        await tx.session.updateMany({ where: { family: s.family, revokedAt: null }, data: { revokedAt: new Date() } });
      });
      await disconnectUser(s.user);
    }
  }
  clearAuthCookies(res, req.baseUrl);
  res.json({ ok: true });
});

router.post('/forgot-password', async (req, res) => {
  const { email: mail } = parse(z.object({ email }), req.body);
  await enforceMailIp(req);
  const user = await prisma.user.findUnique({ where: { email: mail } });
  if (user && !user.isLocked && await mailAllowed(mail)) {
    const raw = await issueToken(user, 'reset', config.resetTtlMs);
    const code = await issueOtp(user.id, 'reset');
    await privateMailAttempt(() => sendMail({
      to: user.email,
      subject: 'Đặt lại mật khẩu TaskFlow',
      text: `Mã đặt lại mật khẩu của bạn là ${code} (hiệu lực 10 phút). Hoặc dùng liên kết bên dưới, chỉ dùng được một lần và hết hạn sau 30 phút.`,
      link: `${config.clientUrl}/reset-password?token=${raw}`,
    }));
  }
  res.json({ ok: true }); // không tiết lộ email có tồn tại hay không
});

router.get('/reset-password/check', async (req, res) => {
  const t = await prisma.token.findFirst({ where: { hash: sha256(String(req.query.token || '')), type: 'reset', usedAt: null, expiresAt: { gt: new Date() } } });
  res.json({ valid: !!t });
});

router.post('/reset-password', async (req, res) => {
  const body = parse(z.object({ token: z.string().min(1), password: strongPassword }), req.body);
  const token = await prisma.token.findUnique({ where: { hash: sha256(body.token) } });
  if (!token) throw badRequest('Liên kết đã hết hạn hoặc đã được sử dụng', { code: 'TOKEN_INVALID' });
  const passwordHash = await bcrypt.hash(body.password, 12);
  await withUserLock(token.user, async (tx) => {
    const { count } = await tx.token.updateMany({ where: { id: token.id, type: 'reset', usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (!count) throw badRequest('Liên kết đã hết hạn hoặc đã được sử dụng', { code: 'TOKEN_INVALID' });
    await tx.user.update({ where: { id: token.user }, data: { passwordHash, emailVerified: true } });
    await tx.token.updateMany({ where: { user: token.user, type: { in: ['reset', 'verify'] }, usedAt: null }, data: { usedAt: new Date() } });
    await tx.session.updateMany({ where: { user: token.user, revokedAt: null }, data: { revokedAt: new Date() } });
    await revokeAllAgentTokens(tx, token.user);
  });
  const owner = await prisma.user.findUnique({ where: { id: token.user }, select: { email: true } });
  if (owner) await clearLoginFailures(owner.email);
  await disconnectUser(token.user);
  clearAuthCookies(res, req.baseUrl);
  res.json({ ok: true });
});

/** Đặt lại mật khẩu bằng mã OTP 6 số gửi qua email. */
router.post('/reset-password-otp', async (req, res) => {
  const body = parse(z.object({ email, code: z.string().trim().regex(/^\d{6}$/, 'Mã gồm 6 chữ số'), password: strongPassword }), req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
  const passwordHash = await bcrypt.hash(body.password, 12);
  const ok = user
    ? await withUserLock(user.id, async (tx) => {
        const current = await tx.user.findUnique({ where: { id: user.id } });
        if (!current || current.isLocked) return false;
        if (!(await consumeOtp(user.id, 'reset', body.code, tx))) return false;
        await tx.user.update({ where: { id: user.id }, data: { passwordHash, emailVerified: true } });
        await tx.token.updateMany({ where: { user: user.id, type: { in: ['reset', 'verify'] }, usedAt: null }, data: { usedAt: new Date() } });
        await tx.session.updateMany({ where: { user: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
        await revokeAllAgentTokens(tx, user.id);
        return true;
      })
    : false;
  if (!ok) throw badRequest('Mã không đúng hoặc đã hết hạn', { code: 'OTP_INVALID' });
  await clearLoginFailures(body.email);
  await disconnectUser(user.id);
  clearAuthCookies(res, req.baseUrl);
  res.json({ ok: true });
});

/** Đăng nhập bằng Google: nhận ID token từ Google Identity Services ở FrontEnd. */
router.post('/google', async (req, res) => {
  if (!config.google.clientId) throw new HttpError(503, 'Đăng nhập Google chưa được cấu hình', { code: 'GOOGLE_NOT_CONFIGURED' });
  const body = parse(z.object({
    credential: z.string().min(20).max(4096),
    remember: z.boolean().optional(),
    acceptTerms: z.boolean().optional(),
  }), req.body);
  const g = await verifyGoogleCredential(body.credential);
  let account = await prisma.user.findUnique({ where: { googleId: g.sub }, omit: { passwordHash: false } });
  if (!account) {
    const byEmail = await prisma.user.findUnique({ where: { email: g.email }, omit: { passwordHash: false } });
    if (byEmail?.googleId && byEmail.googleId !== g.sub) throw unauthorized('Email này đã liên kết với tài khoản Google khác');
    if (byEmail) {
      if (byEmail.isLocked) throw forbidden('Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.');
      account = await prisma.user.update({ where: { id: byEmail.id }, data: { googleId: g.sub, emailVerified: true }, omit: { passwordHash: false } });
    } else {
      if (body.acceptTerms !== true) throw badRequest('Bạn cần đồng ý điều khoản để tạo tài khoản mới');
      // Tài khoản Google không có mật khẩu: lưu hash của chuỗi ngẫu nhiên không ai biết.
      account = await prisma.user.create({
        data: { name: (g.name || g.email.split('@')[0]).slice(0, 80), email: g.email, googleId: g.sub, emailVerified: true, passwordHash: await bcrypt.hash(randomToken(32), 12) },
        omit: { passwordHash: false },
      });
    }
  }
  if (account.isLocked) throw forbidden('Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.');
  await prisma.user.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
  await startSession(res, req, account, { remember: body.remember === true });
  res.json({ ok: true });
});

/** Thông tin lời mời (chấp nhận cần đăng nhập bằng đúng email được mời). */
router.get('/invite/:token', async (req, res) => {
  const inv = await prisma.invite.findUnique({ where: { tokenHash: sha256(req.params.token) } });
  if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) return res.json({ valid: false });
  const ws = await prisma.workspace.findUnique({ where: { id: inv.workspace }, select: { id: true, name: true } });
  res.json({ valid: true, email: inv.email, role: inv.role, mentor: inv.mentor, workspace: ws });
});

export default router;
