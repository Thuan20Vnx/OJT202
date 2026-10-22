import { config } from '../config.js';
import { prisma } from '../db.js';

/**
 * Gửi email. Bản phát triển chưa cấu hình SMTP: lưu vào "hộp thư dev" (bảng outbox)
 * và in ra console để có thể mở link xác minh / đặt lại mật khẩu.
 * Khi triển khai thật, thay phần thân hàm bằng nhà cung cấp email (SES, SendGrid, SMTP...).
 */
export async function sendMail({ to, subject, text, link }) {
  await prisma.outbox.create({ data: { to, subject, text, link } });
  if (!config.isTest) console.log(`[mail] → ${to}: ${subject}${link ? `\n        ${link}` : ''}`);
}
