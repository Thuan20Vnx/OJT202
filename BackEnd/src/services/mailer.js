import { config } from '../config.js';
import { prisma } from '../db.js';
import nodemailer from 'nodemailer';
import { HttpError } from '../utils/http.js';

export function validateMailConfig(mail = config.mail, isProd = config.isProd) {
  if (!['smtp', 'gmail', 'outbox'].includes(mail.mode)) throw new Error('MAIL_MODE phải là smtp, gmail hoặc outbox');
  if (isProd && mail.mode === 'outbox') throw new Error('Production yêu cầu MAIL_MODE=smtp hoặc gmail');
  if (mail.mode === 'outbox') return;
  if (mail.mode === 'gmail') {
    if (!mail.from || !mail.gmail?.clientId || !mail.gmail.clientSecret || !mail.gmail.refreshToken)
      throw new Error('MAIL_MODE=gmail cần MAIL_FROM, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET và GMAIL_REFRESH_TOKEN');
    return;
  }
  if (!mail.host || !mail.from || !Number.isInteger(mail.port) || mail.port < 1 || mail.port > 65535)
    throw new Error('Cần SMTP_HOST, SMTP_PORT hợp lệ và MAIL_FROM');
  if (!!mail.user !== !!mail.pass) throw new Error('SMTP_USER và SMTP_PASS phải được cấu hình cùng nhau');
  if (isProd && !mail.secure && !mail.requireTLS) throw new Error('SMTP production phải dùng TLS');
}

validateMailConfig();

const NO_REPLY_NOTE = 'Đây là email tự động, vui lòng không trả lời.';

const MAIL_HEADERS = { 'Auto-Submitted': 'auto-generated' };
const mailBody = (text, link) => [text, link, NO_REPLY_NOTE].filter(Boolean).join('\n\n');
const mailUnavailable = () => new HttpError(503, 'Chưa gửi được email. Vui lòng thử gửi lại sau.', { code: 'MAIL_UNAVAILABLE' });

let gmailToken = null;

async function gmailAccessToken({ clientId, clientSecret, refreshToken, tokenUrl }) {
  if (gmailToken && gmailToken.expiresAt > Date.now() + 60000) return gmailToken.value;
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('Gmail token rejected');
  const data = await res.json();
  gmailToken = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 0) * 1000 };
  return gmailToken.value;
}

/** Gửi qua Gmail API bằng HTTPS: dùng được cả trên host chặn cổng SMTP. */
async function sendViaGmail({ to, subject, text, link }) {
  const { from, gmail } = config.mail;
  try {
    const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, disableFileAccess: true, disableUrlAccess: true });
    const { message } = await composer.sendMail({ from, to, subject, text: mailBody(text, link), headers: MAIL_HEADERS });
    const res = await fetch(gmail.sendUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${await gmailAccessToken(gmail)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw: message.toString('base64url') }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      gmailToken = null;
      throw new Error('Gmail send rejected');
    }
  } catch {
    // Same rule as SMTP: never expose provider responses or credentials.
    throw mailUnavailable();
  }
}

/** SMTP uses TLS by default (Gmail 465). Outbox is an explicit development mode.
 * Never write SMTP credentials, message bodies or verification tokens to logs.
 */
export async function sendMail({ to, subject, text, link }) {
  validateMailConfig();
  if (config.mail.mode === 'outbox') {
    await prisma.outbox.create({ data: { to, subject, text, link } });
    return;
  }
  if (config.mail.mode === 'gmail') return sendViaGmail({ to, subject, text, link });
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
    const result = await transport.sendMail({
      from, to, subject,
      text: mailBody(text, link),
      headers: MAIL_HEADERS,
    });
    if (!result.accepted?.length || result.rejected?.length) throw new Error('Recipient rejected');
  } catch {
    // SMTP responses can contain credentials/addresses. Only expose a fixed error.
    throw mailUnavailable();
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
