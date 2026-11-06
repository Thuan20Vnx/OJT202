import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const remote = () => config.storage.url && config.storage.serviceKey;
const localPath = (key) => path.join(config.uploadDir, path.basename(key));
const objectUrl = (key) => `${config.storage.url}/storage/v1/object/${encodeURIComponent(config.storage.bucket)}/${encodeURIComponent(path.basename(key))}`;

// Khóa JWT cũ gửi kèm Authorization; khóa sb_secret_ mới chỉ gửi qua apikey.
function authHeaders() {
  const key = config.storage.serviceKey;
  return { apikey: key, ...(key.split('.').length === 3 && { authorization: `Bearer ${key}` }) };
}

const notFound = () => Object.assign(new Error('Stored object not found'), { code: 'ENOENT' });

async function isMissing(res) {
  if (res.status === 404) return true;
  // Storage API có thể trả 400 kèm statusCode 404 trong body.
  return res.status === 400 && /not.?found|"statusCode":"404"/i.test(await res.clone().text());
}

async function request(method, key, init = {}) {
  return fetch(objectUrl(key), { method, signal: AbortSignal.timeout(30000), ...init, headers: { ...authHeaders(), ...init.headers } });
}

/** Lưu tệp vào Supabase Storage khi đã cấu hình, nếu không thì vào UPLOAD_DIR. */
export async function saveFile(key, buffer, mime) {
  if (!remote()) return fs.promises.writeFile(localPath(key), buffer);
  const res = await request('POST', key, { body: buffer, headers: { 'content-type': mime, 'x-upsert': 'false' } });
  if (!res.ok) throw new Error(`Storage upload failed: ${res.status}`);
}

/** Đọc tệp; không tồn tại thì ném lỗi có code ENOENT ở cả hai chế độ. */
export async function readFile(key) {
  if (!remote()) return fs.promises.readFile(localPath(key));
  const res = await request('GET', key);
  if (await isMissing(res)) throw notFound();
  if (!res.ok) throw new Error(`Storage download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function removeFile(key) {
  if (!remote()) return fs.promises.rm(localPath(key), { force: true });
  const res = await request('DELETE', key);
  if (!res.ok && !(await isMissing(res))) throw new Error(`Storage delete failed: ${res.status}`);
}
