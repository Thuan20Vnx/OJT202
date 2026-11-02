import { t as tr, translateError } from './i18n.js';
// Gọi API kèm cookie; tự làm mới access token một lần khi gặp 401.
export class ApiError extends Error {
  status: number;
  details: ApiErrorDetails;
  constructor(status: number, message: string, details: ApiErrorDetails = {}) {
    super(translateError(message));
    this.status = status;
    this.details = details || {};
  }
  get fields() {
    return Object.fromEntries(Object.entries(this.details.fields || {}).map(([key, value]) => [key, translateError(value)]));
  }
}

export interface ApiErrorDetails { fields?: Record<string, string>; code?: string; [key: string]: unknown }
interface RequestOptions { isForm?: boolean; noRefresh?: boolean }
const API_BASE = '/api/v1';
let refreshing: Promise<Response> | null = null;
let authGeneration = 0;
const listeners = new Set<() => void>();
export const onUnauthorized = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));

async function raw(method: string, url: string, body?: unknown, isForm = false): Promise<Response> {
  const headers: Record<string, string> = { 'x-taskflow': '1' };
  if (isForm && !(body instanceof FormData)) throw new TypeError('Upload yêu cầu FormData');
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  return fetch(`${API_BASE}${url}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : isForm ? body as FormData : JSON.stringify(body),
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

async function authenticatedResponse(method: string, url: string, body?: unknown, { isForm = false, noRefresh = false }: RequestOptions = {}): Promise<Response> {
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

async function readBody(res: Response, type: 'blob'): Promise<Blob>;
async function readBody(res: Response, type: 'json' | 'text'): Promise<unknown>;
async function readBody(res: Response, type: 'json' | 'text' | 'blob'): Promise<unknown> {
  try {
    return await res[type]();
  } catch (error) {
    // A successful response can still lose its connection while streaming.
    // Preserve HTTP errors even when a proxy returns malformed JSON.
    throw new ApiError(res.ok ? (error instanceof SyntaxError ? 502 : 0) : res.status, OFFLINE_MSG);
  }
}

export async function request<T = unknown>(method: string, url: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const res = await authenticatedResponse(method, url, body, options);
  const type = res.headers.get('content-type') || '';
  const data = await readBody(res, type.includes('application/json') ? 'json' : 'text');
  // 5xx không kèm JSON: proxy/reverse proxy không tới được API (API luôn trả lỗi dạng JSON)
  const failure = data && typeof data === 'object' ? data as { error?: unknown; details?: ApiErrorDetails } : {};
  if (res.status >= 500 && typeof failure.error !== 'string') throw new ApiError(res.status, OFFLINE_MSG);
  if (!res.ok) throw new ApiError(res.status, typeof failure.error === 'string' ? failure.error : tr('Đã có lỗi xảy ra'), failure.details);
  return data as T;
}

export const api = {
  get: <T = unknown>(url: string) => request<T>('GET', url),
  post: <T = unknown>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T = unknown>(url: string, body: unknown) => request<T>('PATCH', url, body),
  put: <T = unknown>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T = unknown>(url: string) => request<T>('DELETE', url),
  upload: <T = unknown>(url: string, form: FormData) => request<T>('POST', url, form, { isForm: true }),
};

export function qs(params: Record<string, unknown>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}

/** Tải tệp qua backend (cookie đi kèm) */
export async function download(url: string, filename: string): Promise<void> {
  const res = await authenticatedResponse('GET', url);
  if (!res.ok) {
    const data = res.headers.get('content-type')?.includes('application/json') ? await readBody(res, 'json') : null;
    const failure = data && typeof data === 'object' ? data as { error?: unknown; details?: ApiErrorDetails } : {};
    throw new ApiError(res.status, typeof failure.error === 'string' ? failure.error : tr('Không tải được tệp'), failure.details);
  }
  const blob = await readBody(res, 'blob');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
