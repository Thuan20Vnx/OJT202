import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { isId, prisma } from '../db.js';
import { forbidden, unauthorized } from '../utils/http.js';
import { randomToken, sha256 } from '../utils/security.js';

export const ACCESS_COOKIE = 'tf_at';
export const REFRESH_COOKIE = 'tf_rt';

const cookieBase = () => ({ httpOnly: true, secure: config.isProd, sameSite: 'lax' });

export function signAccess(userId, sessionId) {
  return jwt.sign({ sub: String(userId), sid: String(sessionId) }, config.jwtSecret, { expiresIn: config.accessTtlSec });
}

/** Tạo phiên mới + cặp token, ghi cookie HttpOnly. */
export async function startSession(res, req, user, family = randomToken(12)) {
  const refresh = randomToken(48);
  const session = await prisma.session.create({
    data: {
      user: user.id,
      refreshHash: sha256(refresh),
      family,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      ip: req.ip,
      expiresAt: new Date(Date.now() + config.refreshTtlSec * 1000),
    },
  });
  setAuthCookies(res, signAccess(user.id, session.id), refresh);
  return session;
}

export function setAuthCookies(res, access, refresh) {
  res.cookie(ACCESS_COOKIE, access, { ...cookieBase(), path: '/', maxAge: config.accessTtlSec * 1000 });
  res.cookie(REFRESH_COOKIE, refresh, { ...cookieBase(), path: '/api/auth', maxAge: config.refreshTtlSec * 1000 });
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
  if (!found || found.revokedAt || found.user !== payload.sub) return null;
  const { userRef: user, ...session } = found;
  if (user.isLocked) return null;
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
