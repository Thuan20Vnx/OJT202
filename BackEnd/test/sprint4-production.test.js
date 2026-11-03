import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
process.env.NODE_ENV = 'test';
const { config } = await import('../src/config.js');
const { createApp } = await import('../src/app.js');
const { setAuthCookies } = await import('../src/middleware/auth.js');
let base, server, directory;
const html = '<html><script type="module" src="/assets/app-123.js"></script><link rel="stylesheet" href="/assets/app-123.css"></html>';
before(async () => {
  config.isProd = true;
  config.clientUrl = 'https://app.example.test';
  config.release = { revision: 'a'.repeat(40), sourceHash: 'b'.repeat(64) };
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taskflow-prod-test-'));
  await fs.mkdir(path.join(directory, 'assets'));
  await fs.writeFile(path.join(directory, 'index.html'), html);
  await fs.writeFile(path.join(directory, 'assets/app-123.js'), 'export const ok = true;');
  await fs.writeFile(path.join(directory, 'assets/app-123.css'), 'body{color:black}');
  server = http.createServer(createApp({ staticDir: directory }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise((r) => server.close(r));
  if (directory && path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('taskflow-prod-test-')) await fs.rm(directory, { recursive: true, force: true });
});
test('U033: route reload dùng HTML không cache; asset có hash immutable, asset thiếu trả 404', async () => {
  for (const route of ['/login', '/board', '/ai/planner']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), html);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors/);
  }
  const js = await fetch(base + '/assets/app-123.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.match(js.headers.get('cache-control'), /immutable/);
  for (const route of ['/assets/missing.js', '/missing.json']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 404);
    assert.doesNotMatch(response.headers.get('content-type'), /html/);
  }
});
test('U033: health nhận đúng build, API private không rơi vào SPA và Origin sai bị chặn', async () => {
  assert.deepEqual((await (await fetch(base + '/api/health')).json()).build, config.release);
  const missing = await fetch(base + '/api/not-a-route');
  assert.ok([401, 404].includes(missing.status));
  assert.match(missing.headers.get('content-type'), /json/);
  for (const origin of ['null', 'https://app.example.test.attacker.invalid']) {
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { origin, 'x-taskflow': '1', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'Origin không được phép');
  }
});
test('U033: access/refresh cookie Secure + HttpOnly, đúng path cho hai prefix API', () => {
  for (const prefix of ['/api/auth', '/api/v1/auth']) {
    const cookies = [];
    setAuthCookies({ cookie: (name, value, options) => cookies.push({ name, options }) }, 'redacted', 'redacted', { remember: true, expiresAt: new Date(Date.now() + 60000) }, prefix);
    assert.deepEqual(cookies.map((c) => c.options.path), ['/', prefix]);
    for (const cookie of cookies) { assert.equal(cookie.options.secure, true); assert.equal(cookie.options.httpOnly, true); assert.equal(cookie.options.sameSite, 'lax'); }
  }
});
