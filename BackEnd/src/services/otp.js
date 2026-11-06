import crypto from 'node:crypto';
import { config } from '../config.js';
import { prisma } from '../db.js';

const hashCode = (userId, purpose, code) => crypto.createHmac('sha256', config.jwtSecret).update(`${userId}:${purpose}:${code}`).digest('hex');

/** Tạo mã 6 số mới; mã cũ chưa dùng của cùng mục đích bị vô hiệu. Chỉ lưu hash. */
export async function issueOtp(userId, purpose, client = prisma) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await client.otp.updateMany({ where: { user: userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
  await client.otp.create({ data: { user: userId, purpose, codeHash: hashCode(userId, purpose, code), expiresAt: new Date(Date.now() + config.otp.ttlMs) } });
  return code;
}

/**
 * Kiểm tra và tiêu thụ mã. Trả true khi đúng; sai thì tăng số lần thử (quá giới hạn => mã bị khóa).
 * Không throw để việc tăng `attempts` luôn được commit.
 */
export async function consumeOtp(userId, purpose, code, client = prisma) {
  if (!/^\d{6}$/.test(String(code))) return false;
  const otp = await client.otp.findFirst({ where: { user: userId, purpose, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  if (!otp || otp.attempts >= config.otp.maxAttempts) return false;
  const expected = Buffer.from(otp.codeHash);
  const actual = Buffer.from(hashCode(userId, purpose, code));
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    await client.otp.updateMany({ where: { id: otp.id, usedAt: null }, data: { attempts: { increment: 1 } } });
    return false;
  }
  const { count } = await client.otp.updateMany({ where: { id: otp.id, usedAt: null, attempts: { lt: config.otp.maxAttempts } }, data: { usedAt: new Date() } });
  return count === 1;
}
