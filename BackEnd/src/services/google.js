import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';
import { unauthorized } from '../utils/http.js';

let client;
let verifier = async (credential) => {
  client ??= new OAuth2Client(config.google.clientId);
  const ticket = await client.verifyIdToken({ idToken: credential, audience: config.google.clientId });
  return ticket.getPayload();
};

/** Chỉ dùng trong test để thay bước gọi Google thật. */
export function setGoogleVerifier(fn) {
  verifier = fn;
}

/** Xác minh ID token do Google Identity Services cấp; chỉ nhận email đã được Google xác minh. */
export async function verifyGoogleCredential(credential) {
  let payload;
  try {
    payload = await verifier(credential);
  } catch {
    throw unauthorized('Không xác minh được tài khoản Google');
  }
  if (!payload?.sub || !payload.email || payload.email_verified !== true) throw unauthorized('Email Google chưa được xác minh');
  return { sub: String(payload.sub), email: String(payload.email).trim().toLowerCase(), name: String(payload.name || '').trim() };
}
