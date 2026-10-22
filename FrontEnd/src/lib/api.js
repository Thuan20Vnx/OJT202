// Gọi API kèm cookie; tự làm mới access token một lần khi gặp 401.
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details || {};
  }
  get fields() {
    return this.details.fields || {};
  }
}

let refreshing = null;
const listeners = new Set();
export const onUnauthorized = (fn) => (listeners.add(fn), () => listeners.delete(fn));

async function raw(method, url, body, isForm) {
  const headers = { 'x-taskflow': '1' };
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  return fetch(`/api${url}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
}

async function refresh() {
  refreshing ||= raw('POST', '/auth/refresh').finally(() => setTimeout(() => (refreshing = null), 0));
  const res = await refreshing;
  return res.ok;
}

const OFFLINE_MSG = 'Không kết nối được máy chủ, vui lòng thử lại sau giây lát';

export async function request(method, url, body, { isForm = false, noRefresh = false } = {}) {
  let res;
  try {
    res = await raw(method, url, body, isForm);
  } catch {
    throw new ApiError(0, OFFLINE_MSG); // lỗi mạng: server tắt/đang khởi động lại
  }
  if (res.status === 401 && !noRefresh && !url.startsWith('/auth/')) {
    if (await refresh()) res = await raw(method, url, body, isForm);
  }
  if (res.status === 401 && !url.startsWith('/auth/')) listeners.forEach((fn) => fn());
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  // 5xx không kèm JSON: proxy/reverse proxy không tới được API (API luôn trả lỗi dạng JSON)
  if (res.status >= 500 && !data?.error) throw new ApiError(res.status, OFFLINE_MSG);
  if (!res.ok) throw new ApiError(res.status, data?.error || 'Đã có lỗi xảy ra', data?.details);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  patch: (url, body) => request('PATCH', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, form) => request('POST', url, form, { isForm: true }),
};

export function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : '';
}

/** Tải tệp qua backend (cookie đi kèm) */
export async function download(url, filename) {
  let res = await fetch(`/api${url}`, { credentials: 'include' });
  if (res.status === 401 && (await refresh())) res = await fetch(`/api${url}`, { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, 'Không tải được tệp');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
