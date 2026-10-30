import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, download, onUnauthorized, request } from '../src/lib/api.js';

const response = (status, body = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => new Promise((resolve) => setTimeout(resolve, 5)));

test('401 đang chờ từ phiên ẩn danh không đăng xuất phiên vừa xác minh', async (t) => {
  let finishRefresh, refreshStarted;
  const started = new Promise((resolve) => { refreshStarted = resolve; });
  const delayed = new Promise((resolve) => { finishRefresh = resolve; });
  let loggedOut = 0;
  t.after(onUnauthorized(() => loggedOut++));
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url === '/api/auth/verify-email') return response(200);
    if (url === '/api/auth/refresh') { refreshStarted(); return delayed; }
    return response(401);
  });
  const oldIdentity = request('GET', '/me');
  const rejected = assert.rejects(oldIdentity, (e) => e.status === 401);
  await started;
  await request('POST', '/auth/verify-email', { token: 'test' });
  finishRefresh(response(401));
  await rejected;
  assert.equal(loggedOut, 0);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(request('GET', '/me'), (e) => e.status === 401);
  assert.equal(loggedOut, 1, 'a 401 for the current session still logs out');
});

test('download: lỗi mạng được chuẩn hóa; hết phiên thật mới phát unauthorized', async (t) => {
  let loggedOut = 0;
  t.after(onUnauthorized(() => loggedOut++));
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(download('/documents/a/download', 'a.txt'), (e) => e instanceof ApiError && e.status === 0);
  assert.equal(loggedOut, 0);
  fetch.mock.mockImplementation(async () => response(401));
  await assert.rejects(download('/documents/a/download', 'a.txt'), (e) => e instanceof ApiError && e.status === 401);
  assert.equal(loggedOut, 1);
});

test('JSON sai hoặc kết nối đứt khi đọc body được báo bằng ApiError', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('{', { status: 502, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(request('GET', '/me'), (e) => e instanceof ApiError && e.status === 502);
  fetch.mock.mockImplementation(async () => ({ status: 200, ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => { throw new TypeError('terminated'); } }));
  await assert.rejects(request('GET', '/me'), (e) => e instanceof ApiError && e.status === 0);
});

test('download làm mới phiên và tải đủ byte; refresh 503 không đăng xuất', async (t) => {
  let loggedOut = 0, downloads = 0, refreshed = false;
  t.after(onUnauthorized(() => loggedOut++));
  const fetch = t.mock.method(globalThis, 'fetch', async (url) => {
    if (url === '/api/auth/refresh') { refreshed = true; return response(200); }
    if (!refreshed) return response(401);
    return new Response('Tệp đầy đủ\nDòng cuối', { headers: { 'content-type': 'text/plain' } });
  });
  let downloadedBlob;
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ click() { downloads++; } }) };
  t.after(() => { globalThis.document = previousDocument; });
  t.mock.method(URL, 'createObjectURL', (blob) => { downloadedBlob = blob; return 'blob:test-download'; });
  await download('/documents/a/download', 'a.txt');
  assert.equal(downloads, 1);
  assert.equal(await downloadedBlob.text(), 'Tệp đầy đủ\nDòng cuối');
  await new Promise((resolve) => setTimeout(resolve, 5));
  fetch.mock.mockImplementation(async (url) => response(url === '/api/me' ? 503 : 401));
  await assert.rejects(download('/documents/a/download', 'a.txt'), (e) => e instanceof ApiError && e.status === 503);
  assert.equal(loggedOut, 0);
  assert.equal(downloads, 1);
});

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
