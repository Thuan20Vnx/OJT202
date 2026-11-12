import { prisma } from '../db.js';
import { HttpError, badRequest, unauthorized } from '../utils/http.js';
import { randomToken, sha256 } from '../utils/security.js';
import { BUSINESS_TIMEZONE, isTimeZone } from '../utils/dates.js';
import { enforce } from './throttle.js';

export const TOKEN_PREFIX = 'tfp_';
const MAX_ACTIVE = 10;
const DAY = 86400000;

/** Tạo token cho agent trên máy. Giá trị thật chỉ trả về một lần; database chỉ giữ hash. */
export async function createAgentToken(userId, { name, days }) {
  const active = await prisma.agentToken.count({ where: { user: userId, revokedAt: null, expiresAt: { gt: new Date() } } });
  if (active >= MAX_ACTIVE) throw badRequest(`Mỗi người tối đa ${MAX_ACTIVE} token đang dùng. Hãy thu hồi token cũ trước.`);
  const token = `${TOKEN_PREFIX}${randomToken(32)}`;
  const record = await prisma.agentToken.create({
    data: { user: userId, name, tokenHash: sha256(token), prefix: token.slice(0, 12), expiresAt: new Date(Date.now() + days * DAY) },
    omit: { tokenHash: true },
  });
  return { token, record };
}

export const listAgentTokens = (userId) =>
  prisma.agentToken.findMany({ where: { user: userId, revokedAt: null }, omit: { tokenHash: true }, orderBy: { createdAt: 'desc' } });

export const revokeAgentToken = (userId, id) => prisma.agentToken.updateMany({ where: { id, user: userId, revokedAt: null }, data: { revokedAt: new Date() } });

/**
 * Xác thực cho MCP API. Token chỉ dùng được ở /api/mcp (không thay được cookie đăng nhập),
 * mang đúng quyền của người tạo, hết hạn hoặc bị thu hồi là mất hiệu lực ngay.
 */
export async function requireAgentToken(req, _res, next) {
  const [scheme, value] = String(req.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !value?.startsWith(TOKEN_PREFIX)) throw unauthorized('Thiếu token agent');
  const found = await prisma.agentToken.findUnique({ where: { tokenHash: sha256(value) }, include: { userRef: true } });
  if (!found || found.revokedAt || found.expiresAt <= new Date() || found.userRef.isLocked) throw unauthorized('Token agent không hợp lệ, đã hết hạn hoặc đã bị thu hồi');
  await enforce(`agent-token:${found.id}`, { limit: 120, windowMs: 60000 }, 'Agent gọi quá nhiều lần, vui lòng chờ một phút');
  const { userRef: user, ...token } = found;
  if (!isTimeZone(user.timezone)) user.timezone = BUSINESS_TIMEZONE;
  req.user = user;
  req.agentToken = token;
  if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 5 * 60000)
    await prisma.agentToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
  next();
}

// Câu trả lời hỏi đáp nhỏ và nhiều hơn báo cáo: hạn mức riêng.
export const answerLimit = (tokenId) => enforce(`agent-answer:${tokenId}`, { limit: 120, windowMs: 3600000 }, 'Agent đã lưu quá 120 câu trả lời trong một giờ');
export const reportLimit = (tokenId) => enforce(`agent-report:${tokenId}`, { limit: 30, windowMs: 3600000 }, 'Agent đã gửi quá 30 báo cáo trong một giờ');
export { HttpError };
