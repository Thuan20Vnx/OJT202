import { requireValue } from './core.mjs';

export class LocalClient {
  cookies = new Map();
  constructor(base) {
    const url = new URL(base);
    requireValue(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Evaluation only targets an isolated loopback fixture');
    this.base = url.origin;
  }
  async request(method, route, body) {
    const url = new URL(route, this.base);
    requireValue(route.startsWith('/api/') && url.origin === this.base, 'Evaluation route must stay in the fixture API');
    const queuedAt = new Date().toISOString(), started = performance.now();
    try {
      const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(70000), headers: { 'content-type': 'application/json', 'x-taskflow': '1', cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ') }, ...(body !== undefined && { body: JSON.stringify(body) }) });
      for (const cookie of response.headers.getSetCookie()) {
        const first = cookie.split(';')[0], at = first.indexOf('=');
        this.cookies.set(first.slice(0, at), first.slice(at + 1));
      }
      const raw = await response.text();
      let data;
      try { data = JSON.parse(raw); } catch { data = null; }
      return { status: response.status, data, queuedAt, finishedAt: new Date().toISOString(), elapsedMs: performance.now() - started };
    } catch (error) {
      return { status: 0, data: null, error: error.name, queuedAt, finishedAt: new Date().toISOString(), elapsedMs: performance.now() - started };
    }
  }
}
