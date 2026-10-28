import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, onUnauthorized, request } from '../src/lib/api.js';

const response = (status, body = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => new Promise((resolve) => setTimeout(resolve, 5)));

test('refresh gặp 503 không đăng xuất người dùng và không xoay token khi /me lỗi server', async (t) => {
  const calls = [];
  let loggedOut = 0;
  t.after(onUnauthorized(() => loggedOut++));
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    return response(url === '/api/me' ? 503 : 401);
  });
  await assert.rejects(request('GET', '/projects'), (e) => e instanceof ApiError && e.status === 503);
  assert.deepEqual(calls, ['/api/projects', '/api/me']);
  assert.equal(loggedOut, 0);
  await new Promise((resolve) => setTimeout(resolve, 5));
});

test('lỗi mạng trong refresh hoặc retry được chuẩn hóa thành ApiError', async (t) => {
  let loggedOut = 0;
  t.after(onUnauthorized(() => loggedOut++));
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url === '/api/me') throw new TypeError('fetch failed');
    return response(401);
  });
  await assert.rejects(request('GET', '/projects'), (e) => e instanceof ApiError && e.status === 0);
  assert.equal(loggedOut, 0);
  await new Promise((resolve) => setTimeout(resolve, 5));
});

test('refresh trả 401 mới phát sự kiện hết phiên', async (t) => {
  let loggedOut = 0;
  t.after(onUnauthorized(() => loggedOut++));
  t.mock.method(globalThis, 'fetch', async () => response(401));
  await assert.rejects(request('GET', '/projects'), (e) => e.status === 401);
  assert.equal(loggedOut, 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
});

test('nhiều request 401 đồng thời chỉ xoay refresh một lần', async (t) => {
  let rotations = 0;
  let refreshed = false;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url === '/api/auth/refresh') { rotations++; refreshed = true; return response(200); }
    return response(refreshed ? 200 : 401, { ok: refreshed });
  });
  const results = await Promise.all([request('GET', '/a'), request('GET', '/b'), request('GET', '/c')]);
  assert.equal(rotations, 1);
  assert.ok(results.every((r) => r.ok));
  await new Promise((resolve) => setTimeout(resolve, 5));
});
