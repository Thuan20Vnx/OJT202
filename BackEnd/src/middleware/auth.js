import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { isId, prisma } from '../db.js';
import { forbidden, unauthorized } from '../utils/http.js';
import { randomToken, sha256 } from '../utils/security.js';
import { withUserLock } from '../services/sessions.js';
import { BUSINESS_TIMEZONE, isTimeZone } from '../utils/dates.js';

export const ACCESS_COOKIE = 'tf_at';
export const REFRESH_COOKIE = 'tf_rt';

const cookieBase = () => ({ httpOnly: true, secure: config.isProd, sameSite: 'lax' });

export function signAccess(userId, sessionId) {
  return jwt.sign({ sub: String(userId), sid: String(sessionId) }, config.jwtSecret, { expiresIn: config.accessTtlSec });
}

/** Tạo phiên mới + cặp token, ghi cookie HttpOnly. */
export async function startSession(res, req, user, { remember = false } = {}) {
  const refresh = randomToken(48);
  const session = await withUserLock(user.id, async (tx) => {
    const current = await tx.user.findUnique({ where: { id: user.id }, omit: { passwordHash: false } });
    if (!current || current.isLocked || !current.emailVerified || (user.passwordHash && current.passwordHash !== user.passwordHash))
      throw unauthorized('Thông tin đăng nhập đã thay đổi, vui lòng đăng nhập lại');
    return tx.session.create({
      data: {
        user: user.id,
        refreshHash: sha256(refresh),
        family: randomToken(12),
        remember,
        userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
        ip: req.ip,
        expiresAt: new Date(Date.now() + (remember ? config.refreshTtlSec : 24 * 3600) * 1000),
      },
    });
  });
  setAuthCookies(res, signAccess(user.id, session.id), refresh, session);
  return session;
}

export function setAuthCookies(res, access, refresh, session) {
  const remaining = Math.max(0, new Date(session.expiresAt).getTime() - Date.now());
  res.cookie(ACCESS_COOKIE, access, { ...cookieBase(), path: '/', ...(session.remember ? { maxAge: Math.min(config.accessTtlSec * 1000, remaining) } : {}) });
  res.cookie(REFRESH_COOKIE, refresh, { ...cookieBase(), path: '/api/auth', ...(session.remember ? { maxAge: remaining } : {}) });
}

export function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...cookieBase(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...cookieBase(), path: '/api/auth' });
}

/** Xác thực access token và kiểm tra phiên còn hiệu lực, tài khoản chưa bị khóa. */
export async function authenticate(token) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
  if (!isId(payload.sid)) return null;
  // Phiên + người dùng trong một câu JOIN (chạy ở mọi request nên cần nhanh)
  const found = await prisma.session.findUnique({ where: { id: payload.sid }, include: { userRef: true } });
  if (!found || found.revokedAt || found.expiresAt <= new Date() || found.user !== payload.sub) return null;
  const { userRef: user, ...session } = found;
  if (user.isLocked) return null;
  // Profiles saved before timezone validation may contain an invalid legacy value.
  if (!isTimeZone(user.timezone)) user.timezone = BUSINESS_TIMEZONE;
  return { user, session };
}

export async function requireAuth(req, _res, next) {
  const result = await authenticate(req.cookies?.[ACCESS_COOKIE]);
  if (!result) throw unauthorized();
  req.user = result.user;
  req.session = result.session;
  next();
}

export function requireSystemAdmin(req, _res, next) {
  if (!req.user?.isSystemAdmin) throw forbidden('Chỉ System Admin mới truy cập được');
  next();
}

/** Chống CSRF: mọi request ghi phải kèm header tùy biến mà form chéo trang không gửi được. */
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-taskflow') !== '1') return res.status(403).json({ error: 'Thiếu header bảo vệ CSRF' });
  next();
}
