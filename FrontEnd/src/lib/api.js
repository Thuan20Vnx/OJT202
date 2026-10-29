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
let authGeneration = 0;
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
  // Nhiều tab dùng chung cookie: tab sau kiểm tra cookie mới trước khi xoay token.
  const rotate = async () => {
    const current = await raw('GET', '/me');
    if (current.ok) return current;
    if (current.status !== 401) throw new ApiError(current.status, OFFLINE_MSG);
    return raw('POST', '/auth/refresh');
  };
  refreshing ||= (globalThis.navigator?.locks ? navigator.locks.request('taskflow-refresh', rotate) : rotate()).finally(() => setTimeout(() => (refreshing = null), 0));
  const res = await refreshing;
  if (!res.ok && res.status !== 401) throw new ApiError(res.status, OFFLINE_MSG);
  return res.ok;
}

const OFFLINE_MSG = 'Không kết nối được máy chủ, vui lòng thử lại sau giây lát';

async function authenticatedResponse(method, url, body, { isForm = false, noRefresh = false } = {}) {
  const generation = authGeneration;
  let res;
  try {
    res = await raw(method, url, body, isForm);
    if (res.status === 401 && generation === authGeneration && !noRefresh && !url.startsWith('/auth/')) {
      if (await refresh()) res = await raw(method, url, body, isForm);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, OFFLINE_MSG); // lỗi mạng: server tắt/đang khởi động lại
  }
  // An anonymous /me request can finish after verification/login creates a session.
  // Its stale 401 must not clear the newly authenticated account.
  if (res.ok && ['/auth/login', '/auth/verify-email', '/auth/google', '/auth/logout'].includes(url)) authGeneration++;
  if (res.status === 401 && generation === authGeneration && !url.startsWith('/auth/')) listeners.forEach((fn) => fn());
  return res;
}

async function readBody(res, type) {
  try {
    return await res[type]();
  } catch (error) {
    // A successful response can still lose its connection while streaming.
    // Preserve HTTP errors even when a proxy returns malformed JSON.
    throw new ApiError(res.ok ? (error instanceof SyntaxError ? 502 : 0) : res.status, OFFLINE_MSG);
  }
}

export async function request(method, url, body, options = {}) {
  const res = await authenticatedResponse(method, url, body, options);
  const type = res.headers.get('content-type') || '';
  const data = await readBody(res, type.includes('application/json') ? 'json' : 'text');
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
  const res = await authenticatedResponse('GET', url);
  if (!res.ok) throw new ApiError(res.status, 'Không tải được tệp');
  const blob = await readBody(res, 'blob');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
