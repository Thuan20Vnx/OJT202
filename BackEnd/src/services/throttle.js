import { config } from '../config.js';
import { prisma } from '../db.js';
import { HttpError } from '../utils/http.js';
import { sha256 } from '../utils/security.js';

// Bộ đếm lưu trong PostgreSQL: giữ được qua khởi động lại và dùng chung khi chạy nhiều instance.
// express-rate-limit chỉ đếm trong bộ nhớ của một tiến trình nên không đủ cho các giới hạn dài.

/** Tăng bộ đếm trong cửa sổ cố định. Trả số đếm mới và số giây tới khi cửa sổ kết thúc. */
export async function hit(key, { limit, windowMs, amount = 1 }) {
  const cutoff = new Date(Date.now() - windowMs);
  const [row] = await prisma.$queryRaw`
    INSERT INTO rate_counters (key, count, "windowStart") VALUES (${key}, ${amount}, now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_counters."windowStart" < ${cutoff} THEN ${amount} ELSE rate_counters.count + ${amount} END,
      "windowStart" = CASE WHEN rate_counters."windowStart" < ${cutoff} THEN now() ELSE rate_counters."windowStart" END
    RETURNING count, "windowStart"`;
  const retryAfterSec = Math.max(1, Math.ceil((row.windowStart.getTime() + windowMs - Date.now()) / 1000));
  return { allowed: row.count <= limit, count: row.count, retryAfterSec };
}

/** Giới hạn theo IP/người dùng: vượt thì trả 429, không liên quan tới việc email có tồn tại hay không. */
export async function enforce(key, options, message) {
  if (!config.security.throttle) return;
  const { allowed, retryAfterSec } = await hit(key, options);
  if (!allowed) throw new HttpError(429, message, { code: 'RATE_LIMITED', retryAfterSec });
}

const HOUR = 3600 * 1000;

/**
 * Được gửi thêm thư tới địa chỉ này không. Endpoint công khai vẫn trả OK khi bị chặn
 * để kẻ tấn công không biết email có tồn tại; chỉ đơn giản là không gửi thêm.
 */
export async function mailAllowed(email) {
  if (!config.security.throttle) return true;
  const id = sha256(email);
  const { mailCooldownSec, mailPerEmailPerHour } = config.security;
  const cooldown = await hit(`mail:cooldown:${id}`, { limit: 1, windowMs: mailCooldownSec * 1000 });
  if (!cooldown.allowed) return false;
  return (await hit(`mail:hour:${id}`, { limit: mailPerEmailPerHour, windowMs: HOUR })).allowed;
}

const minutesText = (sec) => Math.max(1, Math.ceil(sec / 60));

// Khóa theo email (băm), không theo tài khoản: email không tồn tại cũng bị khóa y hệt nên không dò được.
const loginKey = (email) => `login:${sha256(email)}`;

/** Ném 429 nếu email đang bị tạm khóa. Gọi trước bcrypt để không tốn CPU cho request bị khóa. */
export async function assertLoginAllowed(email) {
  const row = await prisma.rateCounter.findUnique({ where: { key: loginKey(email) } });
  if (!row?.lockedUntil || row.lockedUntil <= new Date()) return;
  const retryAfterSec = Math.ceil((row.lockedUntil.getTime() - Date.now()) / 1000);
  throw new HttpError(429, `Bạn đã nhập sai mật khẩu quá ${config.security.loginMaxFailures} lần. Vui lòng thử lại sau ${minutesText(retryAfterSec)} phút.`, { code: 'LOGIN_LOCKED', retryAfterSec });
}

/** Ghi một lần sai. Đủ số lần thì khóa và đặt lại bộ đếm. Trả số lần còn được thử (0 = vừa bị khóa). */
export async function recordLoginFailure(email) {
  const { loginMaxFailures: max, loginLockMinutes, loginFailureWindowMinutes } = config.security;
  const cutoff = new Date(Date.now() - loginFailureWindowMinutes * 60000);
  const lockUntil = new Date(Date.now() + loginLockMinutes * 60000);
  const [row] = await prisma.$queryRaw`
    INSERT INTO rate_counters (key, count, "windowStart") VALUES (${loginKey(email)}, 1, now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_counters."windowStart" < ${cutoff} THEN 1 ELSE rate_counters.count + 1 END,
      "windowStart" = CASE WHEN rate_counters."windowStart" < ${cutoff} THEN now() ELSE rate_counters."windowStart" END
    RETURNING count`;
  if (row.count < max) return max - row.count;
  await prisma.rateCounter.update({ where: { key: loginKey(email) }, data: { count: 0, lockedUntil: lockUntil, windowStart: new Date() } });
  return 0;
}

/** Đăng nhập đúng hoặc đặt lại mật khẩu thành công thì xóa bộ đếm sai. */
export const clearLoginFailures = (email) => prisma.rateCounter.deleteMany({ where: { key: loginKey(email) } });

export const lockedMessage = () => `Bạn đã nhập sai mật khẩu quá ${config.security.loginMaxFailures} lần. Vui lòng thử lại sau ${config.security.loginLockMinutes} phút.`;

/** Dọn bộ đếm đã hết hiệu lực; chạy cùng job định kỳ. */
export function purgeRateCounters(now = new Date()) {
  return prisma.rateCounter.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 24 * HOUR) }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] } });
}
