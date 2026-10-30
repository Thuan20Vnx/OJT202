import { config } from '../config.js';
import { prisma } from '../db.js';
import nodemailer from 'nodemailer';
import { HttpError } from '../utils/http.js';

export function validateMailConfig(mail = config.mail, isProd = config.isProd) {
  if (!['smtp', 'outbox'].includes(mail.mode)) throw new Error('MAIL_MODE phải là smtp hoặc outbox');
  if (isProd && mail.mode !== 'smtp') throw new Error('Production yêu cầu MAIL_MODE=smtp');
  if (mail.mode === 'outbox') return;
  if (!mail.host || !mail.from || !Number.isInteger(mail.port) || mail.port < 1 || mail.port > 65535)
    throw new Error('Cần SMTP_HOST, SMTP_PORT hợp lệ và MAIL_FROM');
  if (!!mail.user !== !!mail.pass) throw new Error('SMTP_USER và SMTP_PASS phải được cấu hình cùng nhau');
  if (isProd && !mail.secure && !mail.requireTLS) throw new Error('SMTP production phải dùng TLS');
}

validateMailConfig();

/** SMTP uses TLS by default (Gmail 465). Outbox is an explicit development mode.
 * Never write SMTP credentials, message bodies or verification tokens to logs.
 */
export async function sendMail({ to, subject, text, link }) {
  validateMailConfig();
  if (config.mail.mode === 'outbox') {
    await prisma.outbox.create({ data: { to, subject, text, link } });
    return;
  }
  const { host, port, secure, requireTLS, user, pass, from } = config.mail;
  const transport = nodemailer.createTransport({
    host, port, secure, requireTLS: !secure && requireTLS,
    ...(user && { auth: { user, pass } }),
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true,
    tls: { minVersion: 'TLSv1.2' },
    logger: false, debug: false,
  });
  try {
    const result = await transport.sendMail({ from, to, subject, text: [text, link].filter(Boolean).join('\n\n') });
    if (!result.accepted?.length || result.rejected?.length) throw new Error('Recipient rejected');
  } catch {
    // SMTP responses can contain credentials/addresses. Only expose a fixed error.
    throw new HttpError(503, 'Chưa gửi được email. Vui lòng thử gửi lại sau.', { code: 'MAIL_UNAVAILABLE' });
  } finally {
    transport.close();
  }
}

/** Public recovery endpoints must not reveal account existence when SMTP fails. */
export async function privateMailAttempt(send) {
  try { await send(); }
  catch (error) {
    if (error?.details?.code !== 'MAIL_UNAVAILABLE') throw error;
    console.warn('[mail] Delivery unavailable; user may retry the recovery request.');
  }
}
