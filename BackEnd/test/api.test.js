// Kiểm thử tích hợp API theo tiêu chí nghiệm thu trong Product Backlog.
// Chạy: npm test  (dùng PostgreSQL nhúng tạm thời + AIService chạy cùng tiến trình, không đụng dữ liệu dev)
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { io as connectSocket } from 'socket.io-client';
import { smtpSandbox } from './helpers/smtp.js';

process.env.NODE_ENV = 'test';
process.env.MAIL_MODE = 'outbox';
process.env.DATABASE_URL = '';
const testUploads = await fs.mkdtemp(path.join(os.tmpdir(), 'taskflow-test-uploads-'));
process.env.UPLOAD_DIR = testUploads;

// AIService thật (bộ AI nội bộ) trên cổng ngẫu nhiên – BackEnd gọi qua HTTP như khi chạy thật
process.env.ANTHROPIC_API_KEY = '';
const { createApp: createAiApp } = await import('../../AIService/src/app.js');
const aiServer = http.createServer(createAiApp());
await new Promise((r) => aiServer.listen(0, r));
process.env.AI_SERVICE_URL = `http://127.0.0.1:${aiServer.address().port}`;

const { createApp } = await import('../src/app.js');
const { seedDemo, DEMO_PASSWORD } = await import('../src/seed.js');
const { csvCell } = await import('../src/utils/security.js');
const db = await import('../src/db.js');
const { initRealtime, emitProject } = await import('../src/services/realtime.js');
const { projectOverview, riskAlerts, workload } = await import('../src/services/metrics.js');
const { config } = await import('../src/config.js');

let server;
let base;
let seed;
let realtime;

class Client {
  cookies = {};
  async req(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-taskflow': '1',
        cookie: Object.entries(this.cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join('; '),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      this.cookies[kv.slice(0, i)] = kv.slice(i + 1);
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data, setCookies: res.headers.getSetCookie() };
  }
  get = (u) => this.req('GET', u);
  post = (u, b = {}) => this.req('POST', u, b);
  patch = (u, b) => this.req('PATCH', u, b);
  del = (u) => this.req('DELETE', u);
  async login(email) {
    const r = await this.post('/auth/login', { email, password: DEMO_PASSWORD });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return this;
  }
}

/** Đặt hạn mức AI/ngày của workspace demo (cột JSONB) */
async function setDailyLimit(n) {
  const ws = await db.prisma.workspace.findUnique({ where: { id: seed.workspace.id } });
  await db.prisma.workspace.update({ where: { id: ws.id }, data: { ai: { ...ws.ai, dailyLimit: n } } });
}

before(async () => {
  await db.connectDb({ ephemeral: true });
  seed = await seedDemo();
  server = http.createServer(createApp());
  realtime = initRealtime(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  await new Promise((resolve) => realtime?.close(resolve) ?? resolve());
  server?.close();
  aiServer.close();
  await db.disconnectDb();
  if (path.dirname(testUploads) === os.tmpdir() && path.basename(testUploads).startsWith('taskflow-test-uploads-')) await fs.rm(testUploads, { recursive: true, force: true });
});

test('U025: thống kê nguồn trực tiếp có ACL, bỏ task xóa và ảnh; không tải toàn bộ nội dung', async () => {
  const c = new Client();
  await c.post('/auth/login', { email: 'nhu@nhom24.edu.vn', password: DEMO_PASSWORD });
  const project = await db.prisma.project.findFirst({ where: { memberships: { some: { user: seed.users.nhu.id } } } });
  const r = await c.get(`/projects/${project.id}/ai/sources`);
  assert.equal(r.status, 200);
  assert.equal(r.data.retrieval, 'live');
  assert.equal(r.data.tasks, await db.prisma.task.count({ where: { project: project.id, deletedAt: null } }));
  assert.equal(r.data.documents, await db.prisma.document.count({ where: { project: project.id, isScan: false, OR: [{ kind: 'doc' }, { mime: 'text/plain' }] } }));
  assert.equal(r.data.content, undefined);
  assert.equal((await c.get('/projects/00000000-0000-4000-8000-000000000000/ai/sources')).status, 404);
  assert.equal((await new Client().get(`/projects/${project.id}/ai/sources`)).status, 401);
});

describe('Hoàng Anh Sprint 2 — tài liệu, phụ thuộc, thông báo và review nghiệp vụ', () => {
  test('U011-T3: kết hợp filter, phân trang/trang rỗng và project private', async () => {
    const { owner, member, ws, pid, create } = await permissionFixture();
    for (let i = 0; i < 2; i++) await create({ title: `Filter needle ${i}`, assignee: seed.users.nhu.id, status: 'in_progress', priority: 'high', dueDate: new Date().toISOString() });
    await create({ title: 'Filter needle sai ưu tiên', assignee: seed.users.nhu.id, priority: 'low' });
    const privateProject = await owner.post(`/workspaces/${ws}/projects`, { name: 'Private filter' });
    await owner.post(`/projects/${privateProject.data.project._id}/tasks`, { title: 'Filter needle bí mật', priority: 'high', status: 'in_progress', dueDate: new Date().toISOString() });
    const query = `/workspaces/${ws}/my-tasks?assignee=me&status=in_progress&priority=high&due=today&search=needle&limit=1`;
    const first = await member.get(query);
    const second = await member.get(`${query}&page=2`);
    assert.equal(first.status, 200);
    assert.equal(first.data.total, 2);
    assert.equal(second.data.total, 2);
    assert.notEqual(first.data.items[0]._id, second.data.items[0]._id);
    assert.deepEqual((await member.get(`${query}&page=3`)).data.items, []);
    const all = await member.get(`/workspaces/${ws}/my-tasks?assignee=all&search=needle&includeDone=true`);
    assert.ok(all.data.items.every((t) => t.project._id === pid));
  });

  test('U015-T1: version bắt buộc, lưu đồng thời chỉ một bản thắng, revision không mất', async () => {
    const { owner, member, pid } = await permissionFixture();
    const created = await owner.post(`/projects/${pid}/documents`, { name: 'CAS', content: 'Ban đầu' });
    const id = created.data.document._id;
    assert.equal((await owner.patch(`/documents/${id}`, { content: 'Thiếu version' })).status, 400);
    const results = await Promise.all([owner.patch(`/documents/${id}`, { content: 'Owner', version: 1 }), member.patch(`/documents/${id}`, { content: 'Member', version: 1 })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await db.prisma.documentRevision.count({ where: { document: id } }), 2);
    assert.equal((await owner.get(`/documents/${id}/revisions/1`)).data.revision.content, 'Ban đầu');
    assert.equal((await member.del(`/documents/${id}`)).status, 403, 'Member không xóa tài liệu người khác');
    const viewer = await new Client().login('khanh.linh@nhom24.edu.vn');
    assert.equal((await viewer.patch(`/documents/${id}`, { content: 'Không được ghi', version: 2 })).status, 403);
  });

  test('U015-T1: magic bytes đầy đủ, UTF-8 và biên tệp 10MB; rollback cả lô', async () => {
    const { owner, pid } = await permissionFixture();
    const upload = async (name, bytes, mime) => {
      const form = new FormData();
      form.append('files', new Blob([bytes], { type: mime }), name);
      return fetch(`${base}/projects/${pid}/documents/upload`, { method: 'POST', headers: { 'x-taskflow': '1', cookie: Object.entries(owner.cookies).map(([k, v]) => `${k}=${v}`).join('; ') }, body: form });
    };
    for (const [name, bytes, mime] of [
      ['fake.png', Buffer.from([137, 80, 78, 71, 0, 0, 0, 0]), 'image/png'],
      ['fake.jpg', Buffer.from([255, 216, 0]), 'image/jpeg'],
      ['fake.pdf', '%PDFjunk', 'application/pdf'],
      ['bad.txt', Buffer.from([0xff, 0xfe, 0xff]), 'text/plain'],
      ['run.exe', 'MZ', 'application/octet-stream'],
    ]) assert.equal((await upload(name, bytes, mime)).status, 400, name);
    assert.equal(await db.prisma.document.count({ where: { project: pid } }), 0);
    assert.equal((await upload('large.txt', Buffer.alloc(10 * 1024 * 1024 + 1, 97), 'text/plain')).status, 400);
    const exact = await upload('exact.txt', Buffer.alloc(10 * 1024 * 1024, 97), 'text/plain');
    assert.equal(exact.status, 201);
    const id = (await exact.json()).documents[0]._id;
    const response = await fetch(`${base}/documents/${id}/download`, { headers: { cookie: Object.entries(owner.cookies).map(([k, v]) => `${k}=${v}`).join('; ') } });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal((await response.arrayBuffer()).byteLength, 10 * 1024 * 1024);
  });

  test('U015-T1: tạo/sửa/xóa phát invalidation sau commit, RAG đọc đúng nguồn mới', async (t) => {
    const { owner, member, pid } = await permissionFixture();
    const socket = await socketFor(member, t);
    assert.equal((await join(socket, pid)).ok, true);
    const events = [];
    socket.on('documents:changed', (e) => events.push(e));
    const { collectSources, sourceFingerprint } = await import('../src/services/ai/qa.js');
    const created = await owner.post(`/projects/${pid}/documents`, { name: 'Nguồn', content: 'Nguồn v1' });
    const id = created.data.document._id;
    const before = sourceFingerprint(await collectSources(pid));
    assert.equal((await owner.patch(`/documents/${id}`, { content: 'Nguồn v2', version: 1 })).status, 200);
    const sources = await collectSources(pid);
    assert.notEqual(sourceFingerprint(sources), before);
    assert.ok(sources.some((s) => s.refId === id && s.text.includes('Nguồn v2')));
    assert.equal((await owner.del(`/documents/${id}`)).status, 200);
    await join(socket, pid);
    assert.deepEqual(events.map((e) => e.action), ['create', 'update', 'delete']);
    assert.ok(events.every((e) => e.sourceInvalidated && e.documentIds.includes(id)));
    assert.ok(!(await collectSources(pid)).some((s) => s.refId === id));
    assert.equal((await member.get(`/documents/${id}/download`)).status, 404);
  });

  test('U016-T2: nhiều tab khởi tạo preference đồng thời không lỗi unique', async () => {
    const { member } = await permissionFixture();
    await db.prisma.notificationPref.deleteMany({ where: { user: seed.users.nhu.id } });
    const results = await Promise.all(Array.from({ length: 12 }, () => member.get('/me/notification-prefs')));
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.data)));
    assert.equal(await db.prisma.notificationPref.count({ where: { user: seed.users.nhu.id } }), 1);
  });

  test('U016-T2: đọc idempotent, read-all theo quyền, đồng bộ tab và không đổi thông báo người khác', async (t) => {
    const { owner, member, ws, pid } = await permissionFixture();
    const socket = await socketFor(member, t);
    const events = [];
    socket.on('notification:read', (e) => events.push(e));
    const privateProject = await owner.post(`/workspaces/${ws}/projects`, { name: 'Private notifications' });
    const [visible, hidden, other] = await Promise.all([
      db.prisma.notification.create({ data: { user: seed.users.nhu.id, workspace: ws, project: pid, type: 'assigned', text: 'Visible', dedupeKey: `${ws}:visible` } }),
      db.prisma.notification.create({ data: { user: seed.users.nhu.id, workspace: ws, project: privateProject.data.project._id, type: 'assigned', text: 'Hidden', dedupeKey: `${ws}:hidden` } }),
      db.prisma.notification.create({ data: { user: seed.users.maianh.id, workspace: ws, type: 'assigned', text: 'Other', dedupeKey: `${ws}:other` } }),
    ]);
    await member.post(`/notifications/${visible.id}/read`);
    const first = await db.prisma.notification.findUnique({ where: { id: visible.id } });
    await member.post(`/notifications/${visible.id}/read`);
    assert.deepEqual((await db.prisma.notification.findUnique({ where: { id: visible.id } })).readAt, first.readAt);
    await member.post(`/notifications/${other.id}/read`);
    await member.post('/notifications/read-all', { workspace: ws });
    assert.equal((await db.prisma.notification.findUnique({ where: { id: hidden.id } })).readAt, null);
    assert.equal((await db.prisma.notification.findUnique({ where: { id: other.id } })).readAt, null);
    assert.equal((await member.get(`/notifications?workspace=${ws}`)).data.unread, 0);
    await join(socket, pid);
    assert.equal(events.length, 1);
  });

  test('U018-T1: dependency lặp không tăng version/audit; Blocked suy ra và không là trạng thái thứ năm', async () => {
    const { owner, member, create } = await permissionFixture();
    const blocker = await create({ status: 'review' });
    const dependent = await create();
    const url = `/tasks/${dependent._id}/dependencies`;
    const added = await owner.post(url, { blockedBy: blocker._id });
    assert.equal(added.status, 200);
    assert.equal(added.data.task.isBlocked, true);
    assert.equal((await owner.post(url, { blockedBy: blocker._id })).data.task.version, added.data.task.version);
    assert.equal(await db.prisma.activity.count({ where: { entityId: dependent._id, action: 'Thêm phụ thuộc' } }), 1);
    assert.equal((await member.post(url, { blockedBy: blocker._id })).status, 403);
    assert.equal((await owner.patch(`/tasks/${dependent._id}`, { status: 'blocked', version: added.data.task.version })).status, 400);
    assert.equal((await owner.patch(`/tasks/${blocker._id}`, { status: 'done', version: blocker.version })).status, 200);
    assert.equal((await owner.get(`/tasks/${dependent._id}`)).data.task.isBlocked, false);
    const removed = await owner.del(`${url}/${blocker._id}`);
    assert.equal((await owner.del(`${url}/${blocker._id}`)).data.task.version, removed.data.task.version);
  });

  test('U013 review: preview xóa chính xác, phát hiện cây thay đổi; gỡ dependency có audit', async () => {
    const { owner, member, create } = await permissionFixture();
    const parent = await create();
    assert.equal((await owner.patch(`/tasks/${parent._id}`, { parent: parent._id, version: parent.version })).status, 400, 'không cho tự làm cha qua trường PATCH không hỗ trợ');
    await create({ parent: parent._id });
    const dependent = await create({ blockedBy: [parent._id] });
    const preview = `/tasks/${parent._id}/deletion-preview`;
    assert.equal((await member.get(preview)).status, 403);
    const old = (await owner.get(preview)).data.impact;
    assert.equal(old.tasks.length, 2);
    assert.equal(old.dependentCount, 1);
    await create({ parent: parent._id });
    assert.equal((await owner.del(`/tasks/${parent._id}?confirm=true&impact=${old.impactToken}`)).status, 409);
    assert.equal((await db.prisma.task.findUnique({ where: { id: parent._id } })).deletedAt, null);
    const fresh = (await owner.get(preview)).data.impact;
    assert.equal((await owner.del(`/tasks/${parent._id}?confirm=true&impact=${fresh.impactToken}`)).status, 200);
    const audit = await db.prisma.activity.findFirst({ where: { entityId: dependent._id, action: 'Gỡ phụ thuộc khi xóa công việc' } });
    assert.deepEqual(audit.before, [parent._id]);
    assert.deepEqual(audit.after, []);
    assert.equal(audit.entityLabel, `${dependent.key} ${dependent.title}`);
  });

  test('U019 review: chỉ cộng task lá, bao gồm overdue; tách thiếu hạn/estimate, không lộ project khác', async () => {
    const { owner, member, pid, create } = await permissionFixture();
    const parent = await create({ assignee: seed.users.nhu.id, estimateHours: 50, dueDate: '2026-10-29' });
    const child = await create({ parent: parent._id, assignee: seed.users.nhu.id, estimateHours: 3, dueDate: '2026-10-20' });
    await create({ assignee: seed.users.nhu.id, estimateHours: 20 });
    await create({ assignee: seed.users.nhu.id, dueDate: '2026-10-31' });
    await create({ assignee: seed.users.nhu.id, estimateHours: 99, dueDate: '2026-11-02' });
    const deleted = await create({ assignee: seed.users.nhu.id, estimateHours: 9, dueDate: '2026-10-30' });
    await owner.del(`/tasks/${deleted._id}`);
    const row = (await workload(pid, undefined, new Date('2026-10-30T00:00:00Z'))).find((w) => w.user.id === seed.users.nhu.id);
    assert.equal(row.hours, 3);
    assert.equal(row.missingDeadlines, 1);
    assert.equal(row.missingEstimates, 1);
    assert.ok(row.taskIds.includes(child._id));
    assert.ok(!row.taskIds.includes(parent._id));
    const privateProject = await owner.post(`/workspaces/${(await db.prisma.project.findUnique({ where: { id: pid } })).workspace}/projects`, { name: 'Private metrics' });
    assert.equal((await member.get(`/projects/${privateProject.data.project._id}/overview`)).status, 404);
  });

  test('U019 review: capacity workspace/user/week, số 0, quyền và hai request cạnh tranh', async () => {
    const { owner, member, admin, ws, pid, create } = await permissionFixture();
    await create({ assignee: seed.users.nhu.id, estimateHours: 2, dueDate: '2026-10-30' });
    const url = `/workspaces/${ws}/members/${seed.users.nhu.id}/capacity/2026-10-26`;
    assert.equal((await member.patch(url, { hours: 0, version: 0 })).status, 403);
    assert.equal((await owner.patch(url, { hours: 0, version: 0 })).status, 200);
    const row = (await workload(pid, undefined, new Date('2026-10-30T00:00:00Z'))).find((w) => w.user.id === seed.users.nhu.id);
    assert.equal(row.available, 0);
    assert.equal(row.pct, null);
    assert.equal(row.overloaded, true);
    assert.equal((await member.get(url.replace('2026-10-26', '2026-11-02'))).data.capacity.hours, 20);
    for (const hours of [-1, 81, '2']) assert.equal((await owner.patch(url, { hours, version: 1 })).status, 400);
    assert.equal((await owner.patch(url.replace('2026-10-26', '2026-10-27'), { hours: 5, version: 0 })).status, 400);
    const results = await Promise.all([owner.patch(url, { hours: 4, version: 1 }), owner.patch(url, { hours: 6, version: 1 })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await admin.patch(url.replace(seed.users.nhu.id, seed.users.maianh.id), { hours: 2, version: 0 })).status, 403);
    assert.equal((await db.prisma.membership.findUnique({ where: { workspace_user: { workspace: ws, user: seed.users.nhu.id } } })).weeklyHours, 20);
    assert.equal(await db.prisma.activity.count({ where: { workspace: ws, field: 'weeklyCapacity' } }), 2);
  });

  test('U019 review: migration chặn capacity sai và thay đổi capacity làm report stale', async () => {
    const { owner, ws, pid } = await permissionFixture();
    const user = seed.users.nhu.id;
    await assert.rejects(db.prisma.weeklyCapacity.create({ data: { workspace: ws, user, weekStart: new Date('2026-10-26T00:00:00Z'), hours: 81 } }));
    await assert.rejects(db.prisma.weeklyCapacity.create({ data: { workspace: ws, user, weekStart: new Date('2026-10-27T00:00:00Z'), hours: 4 } }));
    assert.equal(await db.prisma.weeklyCapacity.count({ where: { workspace: ws } }), 0);
    const { reportSourceRevision } = await import('../src/services/ai/qa.js');
    const before = await reportSourceRevision(pid);
    assert.equal((await owner.patch(`/workspaces/${ws}/members/${user}/capacity/2026-10-26`, { hours: 10, version: 0 })).status, 200);
    assert.notEqual(await reportSourceRevision(pid), before);
  });

  test('U020-T2: CSV không cắt âm thầm sau 10.000 dòng', async () => {
    const { member, ws, pid } = await permissionFixture();
    await db.prisma.activity.createMany({ data: Array.from({ length: 10001 }, (_, i) => ({ workspace: ws, project: pid, entityType: 'task', action: 'CSV overflow', entityLabel: `Export ${i}` })) });
    const response = await member.get(`/workspaces/${ws}/activity.csv?action=CSV%20overflow`);
    assert.equal(response.status, 400);
    assert.match(response.data.error, /10.000/);
    const narrowed = await member.get(`/workspaces/${ws}/activity.csv?action=CSV%20overflow&search=Export%2010000`);
    assert.equal(narrowed.status, 200);
    assert.match(narrowed.data, /Export 10000/);
  });

  test('U020-T2: khoảng ngày/cột hợp lệ, CSV theo quyền và chống formula injection', async () => {
    const { owner, member, ws, pid } = await permissionFixture();
    await db.prisma.activity.create({ data: { workspace: ws, project: pid, actor: seed.users.maianh.id, action: 'CSV test', entityType: 'task', entityLabel: '=HYPERLINK("x")', before: '=1+1', createdAt: new Date('2026-10-29T16:59:59Z') } });
    const privateProject = await owner.post(`/workspaces/${ws}/projects`, { name: 'Private CSV' });
    await db.prisma.activity.create({ data: { workspace: ws, project: privateProject.data.project._id, action: 'Private-only', entityType: 'task', entityLabel: 'Hidden CSV' } });
    const url = `/workspaces/${ws}/activity`;
    for (const query of ['from=2026-10-31&to=2026-10-01', 'from=2026-02-30', 'project=bad', 'actor=bad']) assert.equal((await member.get(`${url}?${query}`)).status, 400);
    for (const columns of ['bad', 'time,time', '']) assert.equal((await member.get(`${url}.csv?columns=${columns}`)).status, 400);
    const csv = await member.get(`${url}.csv?from=2026-10-29&to=2026-10-29&columns=entity,before`);
    assert.equal(csv.status, 200);
    assert.match(csv.data, /'=HYPERLINK/);
    assert.match(csv.data, /'=1\+1/);
    assert.ok(!csv.data.includes('Hidden CSV'));
    assert.ok(!(await member.get(url)).data.actions.includes('Private-only'));
  });
});

describe('Xác thực & phiên (U003, U004, U005)', () => {
  test('sai mật khẩu và email không tồn tại trả cùng một lỗi chung', async () => {
    const c = new Client();
    const a = await c.post('/auth/login', { email: 'mai.anh@nhom24.edu.vn', password: 'Sai12345' });
    const b = await c.post('/auth/login', { email: 'khongco@x.com', password: 'Sai12345' });
    assert.equal(a.status, 401);
    assert.equal(a.data.error, b.data.error);
  });

  test('đăng ký: email duy nhất không phân biệt hoa thường, phải xác minh mới đăng nhập', async () => {
    const c = new Client();
    const dup = await c.post('/auth/register', { name: 'X', email: 'MAI.ANH@nhom24.edu.vn', password: 'Abcdefg1', acceptTerms: true });
    assert.equal(dup.status, 400);
    const ok = await c.post('/auth/register', { name: 'Người mới', email: 'Moi@Test.vn', password: 'Abcdefg1', acceptTerms: true });
    assert.equal(ok.status, 201);
    const blocked = await c.post('/auth/login', { email: 'moi@test.vn', password: 'Abcdefg1' });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.details.code, 'EMAIL_NOT_VERIFIED');
    const mail = await db.prisma.outbox.findFirst({ where: { to: 'moi@test.vn' }, orderBy: { createdAt: 'desc' } });
    const token = new URL(mail.link).searchParams.get('token');
    assert.equal((await c.post('/auth/verify-email', { token })).status, 200);
    assert.equal((await c.post('/auth/verify-email', { token })).status, 400, 'token chỉ dùng một lần');
  });

  test('mật khẩu yếu bị từ chối', async () => {
    const r = await new Client().post('/auth/register', { name: 'A', email: 'yeu@test.vn', password: 'abc', acceptTerms: true });
    assert.equal(r.status, 400);
  });

  test('refresh token xoay vòng; dùng lại token cũ thu hồi cả chuỗi phiên', async () => {
    const c = await new Client().login('nhu@nhom24.edu.vn');
    const old = c.cookies.tf_rt;
    assert.equal((await c.post('/auth/refresh')).status, 200);
    assert.notEqual(c.cookies.tf_rt, old);
    const thief = new Client();
    thief.cookies.tf_rt = old;
    assert.equal((await thief.post('/auth/refresh')).status, 401);
    assert.equal((await c.post('/auth/refresh')).status, 401, 'chuỗi phiên đã bị thu hồi');
  });

  test('logout thu hồi phiên', async () => {
    const c = await new Client().login('dat@nhom24.edu.vn');
    const at = c.cookies.tf_at;
    await c.post('/auth/logout');
    const replay = new Client();
    replay.cookies.tf_at = at;
    assert.equal((await replay.get('/me')).status, 401);
  });

  test('đặt lại mật khẩu: token một lần, thu hồi phiên cũ', async () => {
    const victim = await new Client().login('loc@nhom24.edu.vn');
    const c = new Client();
    await c.post('/auth/forgot-password', { email: 'loc@nhom24.edu.vn' });
    const mail = await db.prisma.outbox.findFirst({ where: { to: 'loc@nhom24.edu.vn', subject: { contains: 'Đặt lại' } }, orderBy: { createdAt: 'desc' } });
    const token = new URL(mail.link).searchParams.get('token');
    assert.equal((await c.post('/auth/reset-password', { token, password: 'NewPass123' })).status, 200);
    assert.equal((await c.post('/auth/reset-password', { token, password: 'NewPass456' })).status, 400);
    assert.equal((await victim.get('/me')).status, 401, 'phiên cũ bị thu hồi');
    assert.equal((await new Client().post('/auth/login', { email: 'loc@nhom24.edu.vn', password: 'NewPass123' })).status, 200);
  });

  test('cập nhật hồ sơ không đổi được vai trò', async () => {
    const c = await new Client().login('hiep@nhom24.edu.vn');
    const r = await c.patch('/me', { name: 'Hiệp', role: 'owner' });
    assert.equal(r.status, 400);
  });

  test('CSRF: request ghi thiếu header bảo vệ bị chặn', async () => {
    const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 403);
  });
});

describe('Workspace, phân quyền & cách ly dữ liệu (U006, U007, U008)', () => {
  test('người ngoài nhóm không đọc được workspace/dự án/công việc (404)', async () => {
    const outsider = new Client();
    await outsider.post('/auth/register', { name: 'Ngoài', email: 'ngoai@x.vn', password: 'Abcdefg1', acceptTerms: true });
    const mail = await db.prisma.outbox.findFirst({ where: { to: 'ngoai@x.vn' } });
    await outsider.post('/auth/verify-email', { token: new URL(mail.link).searchParams.get('token') });
    const { workspace, projects } = seed;
    const t = await db.prisma.task.findFirst({ where: { project: projects.website.id } });
    assert.equal((await outsider.get(`/workspaces/${workspace.id}`)).status, 404);
    assert.equal((await outsider.get(`/projects/${projects.website.id}/tasks`)).status, 404);
    assert.equal((await outsider.get(`/tasks/${t.id}`)).status, 404);
    assert.equal((await outsider.patch(`/tasks/${t.id}`, { title: 'hack' })).status, 404);
  });

  test('workspace cùng tên được phân biệt bằng ID và slug', async () => {
    const c = await new Client().login('mai.anh@nhom24.edu.vn');
    const r = await c.post('/workspaces', { name: 'nhóm 24 - product hub' });
    assert.equal(r.status, 201);
    assert.notEqual(r.data.workspace._id, seed.workspace.id);
    assert.notEqual(r.data.workspace.slug, seed.workspace.slug);
    assert.equal((await c.get(`/workspaces/${r.data.workspace._id}`)).data.role, 'owner');
  });

  test('không xóa / hạ quyền được Owner cuối cùng', async () => {
    const c = await new Client().login('mai.anh@nhom24.edu.vn');
    const ws = seed.workspace.id;
    assert.equal((await c.del(`/workspaces/${ws}/members/${seed.users.maianh.id}`)).status, 400);
    assert.equal((await c.patch(`/workspaces/${ws}/members/${seed.users.maianh.id}`, { role: 'member' })).status, 400);
  });

  test('lời mời hết hạn sau 72 giờ', async () => {
    const c = await new Client().login('mai.anh@nhom24.edu.vn');
    const r = await c.post(`/workspaces/${seed.workspace.id}/invites`, { emails: ['moi.vao@x.vn'], role: 'member' });
    assert.equal(r.status, 201);
    const hours = (new Date(r.data.created[0].expiresAt) - Date.now()) / 3600000;
    assert.ok(hours > 71.9 && hours <= 72);
  });

  test('ngày kết thúc dự án không được trước ngày bắt đầu', async () => {
    const c = await new Client().login('mai.anh@nhom24.edu.vn');
    const r = await c.post(`/workspaces/${seed.workspace.id}/projects`, { name: 'X', startDate: '2026-06-01', endDate: '2026-05-25' });
    assert.equal(r.status, 400);
    assert.match(r.data.details.fields.endDate, /không được trước/);
  });

  test('dự án lưu trữ là chỉ đọc', async () => {
    const c = await new Client().login('mai.anh@nhom24.edu.vn');
    const r = await c.post(`/projects/${seed.projects.hackathon.id}/tasks`, { title: 'Việc mới' });
    assert.equal(r.status, 403);
  });
});

describe('Công việc & Kanban (U009, U010, U013, U018)', () => {
  test('người nhận phải thuộc dự án; thiếu ngày thì không tự đặt hạn', async () => {
    const c = await new Client().login('nhu@nhom24.edu.vn');
    const pid = seed.projects.mobile.id;
    const bad = await c.post(`/projects/${pid}/tasks`, { title: 'A', assignee: String(seed.users.loc.id) });
    assert.equal(bad.status, 400);
    const ok = await c.post(`/projects/${pid}/tasks`, { title: 'B', assignee: String(seed.users.nhu.id) });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.task.dueDate, null);
  });

  test('Viewer không được kéo thả', async () => {
    const c = await new Client().login('khanh.linh@nhom24.edu.vn');
    const t = await db.prisma.task.findFirst({ where: { project: seed.projects.website.id, parent: null } });
    const r = await c.post(`/tasks/${t.id}/move`, { status: 'done', order: 1, version: t.version });
    assert.equal(r.status, 403);
  });

  test('cập nhật với version cũ trả 409', async () => {
    const a = await new Client().login('mai.anh@nhom24.edu.vn');
    const t = await db.prisma.task.findFirst({ where: { project: seed.projects.website.id, key: 'TF-105' } });
    assert.equal((await a.post(`/tasks/${t.id}/move`, { status: 'in_progress', order: 5, version: t.version })).status, 200);
    const stale = await a.post(`/tasks/${t.id}/move`, { status: 'review', order: 5, version: t.version });
    assert.equal(stale.status, 409);
    assert.ok(stale.data.details.task, 'trả kèm bản mới nhất để UI tải lại');
  });

  test('subtask tối đa 1 cấp; xóa cha cần xác nhận', async () => {
    const c = await new Client().login('mai.anh@nhom24.edu.vn');
    const pid = seed.projects.website.id;
    const parent = await db.prisma.task.findFirst({ where: { project: pid, key: 'TF-103' } });
    const sub = await db.prisma.task.findFirst({ where: { parent: parent.id } });
    assert.equal((await c.post(`/projects/${pid}/tasks`, { title: 'cháu', parent: String(sub.id) })).status, 400);
    const del = await c.del(`/tasks/${parent.id}`);
    assert.equal(del.status, 409);
    assert.equal(del.data.details.code, 'CONFIRM_REQUIRED');
  });

  test('phụ thuộc: không tự liên kết, không khác dự án, không chu trình', async () => {
    const c = await new Client().login('mai.anh@nhom24.edu.vn');
    const t103 = await db.prisma.task.findFirst({ where: { key: 'TF-103', project: seed.projects.website.id } });
    const t110 = await db.prisma.task.findFirst({ where: { key: 'TF-110', project: seed.projects.website.id } });
    const other = await db.prisma.task.findFirst({ where: { project: seed.projects.mobile.id } });
    assert.equal((await c.post(`/tasks/${t103.id}/dependencies`, { blockedBy: String(t103.id) })).status, 400);
    assert.equal((await c.post(`/tasks/${t103.id}/dependencies`, { blockedBy: String(other.id) })).status, 400);
    const cyc = await c.post(`/tasks/${t103.id}/dependencies`, { blockedBy: String(t110.id) });
    assert.equal(cyc.status, 400);
    assert.equal(cyc.data.details.code, 'CYCLE');
  });

  test('bình luận: nội dung HTML bị loại bỏ, chỉ sửa được của mình', async () => {
    const a = await new Client().login('mai.anh@nhom24.edu.vn');
    const b = await new Client().login('thuan@nhom24.edu.vn');
    const t = await db.prisma.task.findFirst({ where: { key: 'TF-103', project: seed.projects.website.id } });
    const r = await a.post(`/tasks/${t.id}/comments`, { body: '<script>alert(1)</script>Xin chào @Thuận' });
    assert.equal(r.status, 201);
    assert.ok(!r.data.comment.body.includes('<script>'));
    assert.equal(r.data.comment.mentions[0].name, 'Thuận');
    assert.equal((await b.patch(`/comments/${r.data.comment._id}`, { body: 'sửa' })).status, 403);
  });
});

describe('Sprint 1 Hoàng Anh — quyền dự án và workflow (U006-T1, U008-T1, U010-T1)', () => {
  const privateProject = async () => {
    const pm = await new Client().login('mai.anh@nhom24.edu.vn');
    const r = await pm.post(`/workspaces/${seed.workspace.id}/projects`, {
      name: 'Sprint 1 private', members: [seed.users.nhu.id, seed.users.linh.id],
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return { pm, project: r.data.project, pid: r.data.project._id };
  };

  test('Member/Viewer không tạo project; creator là PM trong cùng transaction', async () => {
    for (const email of ['nhu@nhom24.edu.vn', 'khanh.linh@nhom24.edu.vn']) {
      const c = await new Client().login(email);
      assert.equal((await c.post(`/workspaces/${seed.workspace.id}/projects`, { name: 'Forbidden' })).status, 403);
    }
    const { pid } = await privateProject();
    const row = await db.prisma.projectMember.findUnique({ where: { project_user: { project: pid, user: seed.users.maianh.id } } });
    assert.equal(row.role, 'pm');
  });

  test('hai request tạo workspace cùng tên đều thành công, slug không trùng', async () => {
    const pm = await new Client().login('mai.anh@nhom24.edu.vn');
    const results = await Promise.all([pm.post('/workspaces', { name: 'Concurrent workspace' }), pm.post('/workspaces', { name: 'Concurrent workspace' })]);
    assert.deepEqual(results.map((r) => r.status), [201, 201]);
    assert.notEqual(results[0].data.workspace.slug, results[1].data.workspace.slug);
  });

  test('PM archive làm project chỉ đọc với cả PM; Member không restore', async () => {
    const { pm, pid } = await privateProject();
    const member = await new Client().login('nhu@nhom24.edu.vn');
    assert.equal((await pm.post(`/projects/${pid}/archive`)).status, 200);
    assert.equal((await pm.get(`/projects/${pid}`)).status, 200);
    assert.equal((await pm.post(`/projects/${pid}/tasks`, { title: 'Read only' })).status, 403);
    assert.equal((await pm.patch(`/projects/${pid}`, { name: 'Read only' })).status, 403);
    assert.equal((await pm.post(`/projects/${pid}/members`, { user: seed.users.dat.id })).status, 403);
    assert.equal((await member.post(`/projects/${pid}/restore`)).status, 403);
    assert.equal((await pm.post(`/projects/${pid}/restore`)).status, 200);
    assert.equal((await pm.post(`/projects/${pid}/tasks`, { title: 'Writable' })).status, 201);
  });

  test('không hạ Workspace Viewer cho PM cuối; transaction và audit không ghi thay đổi thất bại', async () => {
    const pm = await new Client().login('mai.anh@nhom24.edu.vn');
    const before = await db.prisma.activity.count({ where: { entityId: seed.users.nhu.id, action: 'Phân quyền' } });
    assert.equal((await pm.patch(`/workspaces/${seed.workspace.id}/members/${seed.users.nhu.id}`, { role: 'viewer' })).status, 400);
    assert.equal((await db.prisma.membership.findUnique({ where: { workspace_user: { workspace: seed.workspace.id, user: seed.users.nhu.id } } })).role, 'member');
    assert.equal(await db.prisma.activity.count({ where: { entityId: seed.users.nhu.id, action: 'Phân quyền' } }), before);
  });

  test('Admin ngoài project không đọc được project/task/file/metrics/search/activity', async () => {
    const { pm, pid } = await privateProject();
    const admin = await new Client().login('hoang.anh@nhom24.edu.vn');
    const t = await pm.post(`/projects/${pid}/tasks`, { title: 'Private secret 40971' });
    const doc = await pm.post(`/projects/${pid}/documents`, { name: 'Private', content: 'secret' });
    for (const path of [`/projects/${pid}`, `/projects/${pid}/overview`, `/tasks/${t.data.task._id}`, `/documents/${doc.data.document._id}/download`]) {
      assert.equal((await admin.get(path)).status, 404, path);
    }
    assert.ok(!(await admin.get(`/workspaces/${seed.workspace.id}/projects`)).data.projects.some((p) => p._id === pid));
    assert.equal((await admin.get(`/workspaces/${seed.workspace.id}/search?q=40971`)).data.tasks.length, 0);
    assert.equal((await admin.get(`/workspaces/${seed.workspace.id}/my-tasks?assignee=all&search=40971`)).data.total, 0);
    assert.ok(!(await admin.get(`/workspaces/${seed.workspace.id}/activity`)).data.items.some((a) => a.project?._id === pid || a.project === pid));
  });

  test('không nhận member ngoài workspace và không nâng Workspace Viewer thành PM/Member', async () => {
    const { pm, pid } = await privateProject();
    for (const role of ['pm', 'member']) {
      assert.equal((await pm.patch(`/projects/${pid}/members/${seed.users.linh.id}`, { role })).status, 400);
    }
    const outsider = await db.prisma.user.findUnique({ where: { email: 'admin@taskflow.local' } });
    const bad = await pm.post(`/workspaces/${seed.workspace.id}/projects`, { name: 'Rollback', members: [outsider.id] });
    assert.equal(bad.status, 400);
    assert.equal(await db.prisma.project.count({ where: { name: 'Rollback' } }), 0);
  });

  test('PM cuối không bị gỡ/hạ quyền/rời workspace trước khi chuyển giao', async () => {
    const { pm, pid } = await privateProject();
    assert.equal((await pm.del(`/projects/${pid}/members/${seed.users.maianh.id}`)).status, 400);
    assert.equal((await pm.patch(`/projects/${pid}/members/${seed.users.maianh.id}`, { role: 'member' })).status, 400);
    assert.equal((await pm.patch(`/projects/${pid}`, { members: [seed.users.nhu.id] })).status, 400);
    const transfer = await pm.post(`/projects/${pid}/transfer-manager`, { user: seed.users.nhu.id });
    assert.equal(transfer.status, 200);
    assert.equal(transfer.data.project.manager, seed.users.nhu.id);
    assert.equal((await pm.patch(`/projects/${pid}`, { name: 'No longer PM' })).status, 403);
    const nextPm = await new Client().login('nhu@nhom24.edu.vn');
    assert.equal((await nextPm.del(`/projects/${pid}/members/${seed.users.maianh.id}`)).status, 200);
    assert.equal((await pm.get(`/projects/${pid}`)).status, 404);
  });

  test('hai PM hạ quyền nhau đồng thời vẫn giữ ít nhất một PM', async () => {
    const { pm, pid } = await privateProject();
    assert.equal((await pm.patch(`/projects/${pid}/members/${seed.users.nhu.id}`, { role: 'pm' })).status, 200);
    const next = await new Client().login('nhu@nhom24.edu.vn');
    const attempts = await Promise.all([
      pm.patch(`/projects/${pid}/members/${seed.users.nhu.id}`, { role: 'member' }),
      next.patch(`/projects/${pid}/members/${seed.users.maianh.id}`, { role: 'member' }),
    ]);
    assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 403]);
    assert.equal(await db.prisma.projectMember.count({ where: { project: pid, role: 'pm' } }), 1);
  });

  test('gỡ thành viên bỏ gán task; project và bảng thành viên luôn đồng bộ', async () => {
    const { pm, pid } = await privateProject();
    const t = await pm.post(`/projects/${pid}/tasks`, { title: 'Assigned', assignee: seed.users.nhu.id });
    assert.equal((await pm.del(`/projects/${pid}/members/${seed.users.nhu.id}`)).status, 200);
    assert.equal((await db.prisma.task.findUnique({ where: { id: t.data.task._id } })).assignee, null);
    const project = await db.prisma.project.findUnique({ where: { id: pid }, include: { memberships: true } });
    assert.deepEqual([...project.members].sort(), project.memberships.map((m) => m.user).sort());
  });

  test('Member chỉ đổi trạng thái task mình nhận; chỉ PM duyệt Done/reopen', async () => {
    const { pm, pid } = await privateProject();
    const member = await new Client().login('nhu@nhom24.edu.vn');
    const own = (await pm.post(`/projects/${pid}/tasks`, { title: 'Workflow', assignee: seed.users.nhu.id, estimateHours: 8 })).data.task;
    const other = (await pm.post(`/projects/${pid}/tasks`, { title: 'Other', assignee: seed.users.maianh.id })).data.task;
    assert.equal((await member.post(`/tasks/${other._id}/move`, { status: 'in_progress', order: 1, version: other.version })).status, 403);
    assert.equal((await member.patch(`/tasks/${own._id}`, { status: 'done', version: own.version })).status, 403);
    assert.equal((await member.patch(`/tasks/${own._id}`, { assignee: seed.users.maianh.id, version: own.version })).status, 403);
    assert.equal((await member.patch(`/tasks/${own._id}`, { estimateHours: 99, version: own.version })).status, 403);
    let r = await member.post(`/tasks/${own._id}/move`, { status: 'in_progress', order: 42.5, version: own.version });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    r = await member.patch(`/tasks/${own._id}`, { remainingHours: 3, status: 'review', version: r.data.task.version });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const done = await pm.patch(`/tasks/${own._id}`, { status: 'done', version: r.data.task.version });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    assert.equal(done.data.task.remainingHours, 0);
    assert.ok(done.data.task.completedAt);
    const editedDone = await pm.patch(`/tasks/${own._id}`, { remainingHours: 8, version: done.data.task.version });
    assert.equal(editedDone.status, 200);
    assert.equal(editedDone.data.task.remainingHours, 0, 'sửa task Done vẫn giữ giờ còn lại bằng 0');
    done.data.task = editedDone.data.task;
    assert.equal((await member.patch(`/tasks/${own._id}`, { status: 'in_progress', version: done.data.task.version })).status, 403);
    const reopened = await pm.patch(`/tasks/${own._id}`, { status: 'in_progress', remainingHours: 2, version: done.data.task.version });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.data.task.completedAt, null);
    assert.equal(reopened.data.task.remainingHours, 2);
    assert.equal(reopened.data.task.order, 42.5);
    assert.ok(await db.prisma.activity.count({ where: { entityId: own._id, field: 'status' } }) >= 4);
  });

  test('cập nhật thiếu version bị từ chối; hai request cùng version chỉ một thành công', async () => {
    const { pm, pid } = await privateProject();
    const t = (await pm.post(`/projects/${pid}/tasks`, { title: 'Concurrent' })).data.task;
    assert.equal((await pm.patch(`/tasks/${t._id}`, { title: 'No version' })).status, 400);
    const results = await Promise.all([
      pm.patch(`/tasks/${t._id}`, { status: 'in_progress', version: t.version }),
      pm.patch(`/tasks/${t._id}`, { status: 'review', version: t.version }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(results.find((r) => r.status === 409).data.details.task.version, t.version + 1);
  });

  test('quyền progress trên Kanban/My Tasks/detail nhất quán', async () => {
    const { pm, pid } = await privateProject();
    const member = await new Client().login('nhu@nhom24.edu.vn');
    const t = (await pm.post(`/projects/${pid}/tasks`, { title: 'Permissions', assignee: seed.users.nhu.id })).data.task;
    const detail = (await member.get(`/tasks/${t._id}`)).data.access;
    const board = (await member.get(`/projects/${pid}/tasks`)).data.tasks.find((x) => x._id === t._id).permissions;
    const mine = (await member.get(`/workspaces/${seed.workspace.id}/my-tasks`)).data.items.find((x) => x._id === t._id).permissions;
    for (const p of [detail, board, mine]) {
      assert.equal(p.canEdit, false);
      assert.equal(p.canUpdateProgress, true);
      assert.deepEqual(p.allowedStatuses, ['todo', 'in_progress']);
    }
  });
});

describe('Nhật ký & xuất dữ liệu (U020)', () => {
  test('CSV chống chèn công thức', () => {
    assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
    assert.equal(csvCell('+1'), "'+1");
    assert.equal(csvCell('@SUM'), "'@SUM");
    assert.equal(csvCell('bình thường'), 'bình thường');
  });

  test('nhật ký không có API sửa/xóa', async () => {
    const c = await new Client().login('mai.anh@nhom24.edu.vn');
    const list = await c.get(`/workspaces/${seed.workspace.id}/activity`);
    assert.ok(list.data.total > 0);
    const id = list.data.items[0]._id;
    assert.equal((await c.del(`/workspaces/${seed.workspace.id}/activity/${id}`)).status, 404);
  });
});

describe('Trợ lý AI (U021–U027)', () => {
  test('kế hoạch nháp 5–15 việc; không có hạn thì không tự đặt; duyệt nhiều lần không tạo trùng', async () => {
    const c = await new Client().login('mai.anh@nhom24.edu.vn');
    const pid = seed.projects.website.id;
    const r = await c.post(`/projects/${pid}/ai/plan`, { goal: 'Hoàn thiện luồng thanh toán VNPay & Momo', maxHours: 60, people: 3 });
    assert.equal(r.status, 201);
    const items = r.data.draft.items;
    assert.ok(items.length >= 5 && items.length <= 15);
    assert.ok(items.every((i) => i.dueDate === null));
    const before = await db.prisma.task.count({ where: { project: pid } });
    const [a1, a2] = await Promise.all([c.post(`/ai/drafts/${r.data.draft._id}/approve`), c.post(`/ai/drafts/${r.data.draft._id}/approve`)]);
    assert.equal(a1.status, 200);
    assert.equal(a2.status, 200);
    assert.equal(await db.prisma.task.count({ where: { project: pid } }), before + items.length);
  });

  test('hỏi đáp có nguồn; thiếu chứng cứ thì từ chối', async () => {
    const c = await new Client().login('thuan@nhom24.edu.vn');
    const pid = seed.projects.website.id;
    const ok = await c.post(`/projects/${pid}/ai/ask`, { question: 'Vì sao TF-103 đang bị chặn?' });
    const m = ok.data.conversation.messages.at(-1);
    assert.equal(m.refused, false);
    assert.ok(m.citations.length > 0);
    const no = await c.post(`/projects/${pid}/ai/ask`, { question: 'Ngân sách marketing quý 3 là bao nhiêu?' });
    assert.equal(no.data.conversation.messages.at(-1).refused, true);
  });

  test('hỏi đáp không đọc được dự án không có quyền', async () => {
    // Như không thuộc dự án Hệ thống Backend
    const nhu = await new Client().login('nhu@nhom24.edu.vn');
    const r = await nhu.post(`/projects/${seed.projects.backend.id}/ai/ask`, { question: 'Migration schema là gì?' });
    assert.equal(r.status, 404);
  });

  test('báo cáo: số liệu tính từ DB', async () => {
    const c = await new Client().login('mai.anh@nhom24.edu.vn');
    const pid = seed.projects.website.id;
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const r = await c.post(`/projects/${pid}/ai/reports`, { from, to });
    assert.equal(r.status, 201);
    const expectedDone = await db.prisma.task.count({
      where: { project: pid, parent: null, status: 'done', completedAt: { gte: new Date(from), lte: new Date(`${to}T23:59:59.999`) } },
    });
    assert.equal(r.data.report.stats.done, expectedDone);
    assert.ok(r.data.report.sections.find((s) => s.key === 'blocked').refs.length > 0);
  });

  test('vượt hạn mức AI trả 429 nhưng CRUD vẫn hoạt động', async () => {
    const c = await new Client().login('mai.anh@nhom24.edu.vn');
    await setDailyLimit(0);
    const r = await c.post(`/projects/${seed.projects.website.id}/ai/ask`, { question: 'TF-103 là gì?' });
    assert.equal(r.status, 429);
    const crud = await c.post(`/projects/${seed.projects.website.id}/tasks`, { title: 'Vẫn tạo được việc' });
    assert.equal(crud.status, 201);
    await setDailyLimit(50);
  });

  test('ghi chú họp qua AIService: không rõ người/hạn thì để trống', async () => {
    const c = await new Client().login('mai.anh@nhom24.edu.vn');
    const r = await c.post(`/projects/${seed.projects.website.id}/ai/meeting`, {
      title: 'Họp nhanh',
      text: 'Thuận: mình sẽ xong API WebSocket trước thứ 6\nMai Anh: cần ai đó kiểm thử bảo mật thanh toán\nNhư: cập nhật wireframe Thông báo',
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const [a, b, n] = r.data.draft.items;
    assert.equal(r.data.draft.items.length, 3);
    assert.equal(a.assignee?._id, String(seed.users.thuan.id));
    assert.ok(a.dueDate);
    assert.equal(b.assignee ?? null, null);
    assert.equal(b.dueDate, null);
    assert.equal(n.assignee?._id, String(seed.users.nhu.id));
  });

  test('AIService không chạy: tính năng AI báo bận (503), CRUD vẫn hoạt động', async () => {
    const c = await new Client().login('mai.anh@nhom24.edu.vn');
    const { config } = await import('../src/config.js');
    const url = config.ai.serviceUrl;
    config.ai.serviceUrl = 'http://127.0.0.1:9'; // cổng không có dịch vụ
    const r = await c.post(`/projects/${seed.projects.website.id}/ai/ask`, { question: 'TF-103 là gì?' });
    config.ai.serviceUrl = url;
    assert.equal(r.status, 503);
    assert.equal(r.data.details?.code, 'AI_UNAVAILABLE');
    assert.equal((await c.post(`/projects/${seed.projects.website.id}/tasks`, { title: 'CRUD khi AI lỗi' })).status, 201);
  });

  test('cảnh báo rủi ro dựa trên quy tắc', async () => {
    const c = await new Client().login('mai.anh@nhom24.edu.vn');
    // Tải tuần phụ thuộc thứ trong tuần => hạ giờ khả dụng của Thuận để quy tắc quá tải luôn kích hoạt
    // (TF-103 đến hạn hôm nay còn 5 giờ > 4 giờ khả dụng)
    const member = `/workspaces/${seed.workspace.id}/members/${seed.users.thuan.id}`;
    await c.patch(member, { weeklyHours: 4 });
    const r = await c.get(`/projects/${seed.projects.website.id}/risks`);
    await c.patch(member, { weeklyHours: 20 });
    const types = new Set(r.data.open.map((a) => a.type));
    assert.ok(types.has('overdue'));
    assert.ok(types.has('overload'));
    assert.ok(r.data.open.some((a) => a.type === 'overload' && a.owner._id === seed.users.thuan.id));
  });
});

describe('Quản trị hệ thống (U028)', () => {
  test('khóa tài khoản chặn phiên ngay và bắt buộc lý do; admin không đọc nội dung dự án', async () => {
    const admin = await new Client().login('admin@taskflow.local');
    const victim = await new Client().login('hiep@nhom24.edu.vn');
    assert.equal((await admin.post(`/admin/users/${seed.users.hiep.id}/lock`, {})).status, 400);
    assert.equal((await admin.post(`/admin/users/${seed.users.hiep.id}/lock`, { reason: 'Khác' })).status, 200);
    assert.equal((await victim.get('/me')).status, 401);
    assert.equal((await admin.get(`/projects/${seed.projects.website.id}/tasks`)).status, 404);
    await admin.post(`/admin/users/${seed.users.hiep.id}/unlock`);
  });
});

// Mỗi ca có workspace/project riêng, không dùng trạng thái demo làm bằng chứng đóng góp.
describe('Rà soát vòng 2: thông báo và dữ liệu đầu vào', () => {
  test('phân trang đủ 61 thông báo cùng thời điểm, không lặp và vẫn lọc quyền hiện tại', async () => {
    const { member, ws, pid } = await permissionFixture();
    const createdAt = new Date('2026-10-25T01:00:00Z');
    await db.prisma.notification.createMany({ data: Array.from({ length: 61 }, (_, i) => ({
      user: seed.users.nhu.id, workspace: ws, project: pid, type: 'assigned', text: `Cùng thời điểm ${i}`, createdAt, dedupeKey: `${ws}:${i}`,
    })) });
    const first = await member.get(`/notifications?workspace=${ws}&limit=50&tab=assigned`);
    assert.equal(first.status, 200);
    assert.equal(first.data.items.length, 50);
    assert.equal(first.data.hasMore, true);
    assert.ok(first.data.nextCursor);
    const url = `/notifications?workspace=${ws}&limit=50&tab=assigned&cursor=${encodeURIComponent(first.data.nextCursor)}`;
    const second = await member.get(url);
    assert.equal(second.status, 200);
    assert.equal(second.data.items.length, 11);
    assert.equal(second.data.hasMore, false);
    assert.equal(second.data.nextCursor, null);
    assert.equal(new Set([...first.data.items, ...second.data.items].map((n) => n._id)).size, 61);
    await db.prisma.projectMember.deleteMany({ where: { project: pid, user: seed.users.nhu.id } });
    await db.prisma.project.update({ where: { id: pid }, data: { members: { set: [seed.users.maianh.id] } } });
    assert.deepEqual((await member.get(url)).data.items, []);
  });

  test('cursor và ngày phân trang sai trả 400', async () => {
    const { member } = await permissionFixture();
    for (const query of ['cursor=not-a-cursor', 'before=not-a-date', `cursor=${Buffer.from(JSON.stringify({ at: 'bad', id: seed.users.nhu.id })).toString('base64url')}`]) {
      assert.equal((await member.get(`/notifications?${query}`)).status, 400, query);
    }
  });

  test('tắt nhắc hạn chặn cả sắp hạn lẫn quá hạn, bật lại gửi được', async (t) => {
    const { ws, pid } = await permissionFixture();
    const { notify } = await import('../src/services/notify.js');
    const user = seed.users.nhu.id;
    const previous = await db.prisma.notificationPref.findUnique({ where: { user } });
    t.after(async () => {
      await db.prisma.notificationPref.deleteMany({ where: { user } });
      if (previous) await db.prisma.notificationPref.create({ data: previous });
    });
    await db.prisma.notificationPref.upsert({ where: { user }, create: { user, due_soon: false }, update: { due_soon: false } });
    const input = { user, workspace: ws, project: pid, text: 'Kiểm thử tùy chọn', dedupeKey: ws };
    assert.equal(await notify({ ...input, type: 'due_soon' }), null);
    assert.equal(await notify({ ...input, type: 'overdue' }), null);
    assert.equal(await db.prisma.notification.count({ where: { workspace: ws, user } }), 0);
    await db.prisma.notificationPref.update({ where: { user }, data: { due_soon: true } });
    assert.ok(await notify({ ...input, type: 'overdue' }));
  });

  test('chưa mở cài đặt vẫn áp dụng mặc định không nhận bình luận', async (t) => {
    const { ws } = await permissionFixture();
    const { notify } = await import('../src/services/notify.js');
    const user = seed.users.nhu.id;
    const previous = await db.prisma.notificationPref.findUnique({ where: { user } });
    t.after(async () => {
      await db.prisma.notificationPref.deleteMany({ where: { user } });
      if (previous) await db.prisma.notificationPref.create({ data: previous });
    });
    await db.prisma.notificationPref.deleteMany({ where: { user } });
    assert.equal(await notify({ user, workspace: ws, type: 'comment', text: 'Mặc định', dedupeKey: `${ws}:comment` }), null);
    assert.ok(await notify({ user, workspace: ws, type: 'assigned', text: 'Vẫn nhận giao việc', dedupeKey: `${ws}:assigned` }));
  });

  test('TXT chứa NUL sau 512 byte bị chặn 400 và không lưu dở lô upload', async () => {
    const { owner, pid } = await permissionFixture();
    const filesBefore = (await fs.readdir(testUploads)).sort();
    const form = new FormData();
    form.append('files', new Blob(['Văn bản hợp lệ'], { type: 'text/plain' }), 'valid.txt');
    form.append('files', new Blob(['a'.repeat(1024) + '\u0000bad'], { type: 'text/plain' }), 'invalid.txt');
    const response = await fetch(`${base}/projects/${pid}/documents/upload`, {
      method: 'POST', headers: { 'x-taskflow': '1', cookie: Object.entries(owner.cookies).map(([k, v]) => `${k}=${v}`).join('; ') }, body: form,
    });
    assert.equal(response.status, 400, await response.text());
    assert.equal(await db.prisma.document.count({ where: { project: pid } }), 0);
    assert.deepEqual((await fs.readdir(testUploads)).sort(), filesBefore);
  });
});

describe('Rà soát 26/10: dữ liệu không hợp lệ và nhắc hạn dự án lưu trữ', () => {
  test('NUL trong tên công việc, JSON checklist và hồ sơ trả 400, không lưu dở', async () => {
    const { owner, pid } = await permissionFixture();
    for (const fields of [{ title: 'Tên\u0000lỗi' }, { title: 'Checklist lỗi', checklist: [{ text: 'Bước\u0000lỗi' }] }]) {
      const r = await owner.post(`/projects/${pid}/tasks`, fields);
      assert.equal(r.status, 400, JSON.stringify(r.data));
    }
    const profile = await owner.patch('/me', { name: 'Tên\u0000lỗi' });
    assert.equal(profile.status, 400, JSON.stringify(profile.data));
    assert.equal(await db.prisma.task.count({ where: { project: pid } }), 0);
  });

  test('dự án lưu trữ không gửi nhắc hạn; khôi phục vẫn gửi đúng một lần', async () => {
    const { owner, ws, pid, create } = await permissionFixture();
    const { runDueReminders } = await import('../src/services/jobs.js');
    const now = new Date();
    for (const hours of [-1, 1]) await create({ assignee: seed.users.nhu.id, dueDate: new Date(now.getTime() + hours * 3600000).toISOString() });
    await owner.post(`/projects/${pid}/archive`);
    const where = { workspace: ws, type: { in: ['due_soon', 'overdue'] } };
    await runDueReminders(now);
    assert.equal(await db.prisma.notification.count({ where }), 0);
    await owner.post(`/projects/${pid}/restore`);
    await runDueReminders(now);
    await runDueReminders(now);
    assert.equal(await db.prisma.notification.count({ where }), 2);
  });
});

describe('Rà soát 26/10 vòng 2: phạm vi thông báo và thời gian phiên', () => {
  test('workspace sai không được biến read-all thành đánh dấu toàn bộ tài khoản', async () => {
    const { member, ws } = await permissionFixture();
    const n = await db.prisma.notification.create({ data: { user: seed.users.nhu.id, workspace: ws, type: 'assigned', text: 'Giữ chưa đọc', dedupeKey: `${ws}:invalid-scope` } });
    const other = await db.prisma.notification.create({ data: { user: seed.users.nhu.id, workspace: seed.workspace.id, type: 'assigned', text: 'Workspace khác', dedupeKey: `${ws}:other-scope` } });
    for (const workspace of ['bad', '', null, [ws]]) {
      const r = await member.post('/notifications/read-all', { workspace });
      assert.equal(r.status, 400, JSON.stringify(r.data));
    }
    assert.equal((await db.prisma.notification.findUnique({ where: { id: n.id } })).readAt, null);
    assert.equal((await member.get('/notifications?workspace=bad')).status, 400);
    assert.equal((await member.get('/notifications?project=bad')).status, 400);
    assert.equal((await member.post('/notifications/read-all', { workspace: ws })).status, 200);
    assert.ok((await db.prisma.notification.findUnique({ where: { id: n.id } })).readAt);
    assert.equal((await db.prisma.notification.findUnique({ where: { id: other.id } })).readAt, null);
  });

  test('phiên trả lastUsedAt thực thay vì thời điểm sửa bản ghi', async () => {
    const c = await new Client().login('mai.anh@nhom24.edu.vn');
    const { sha256 } = await import('../src/utils/security.js');
    const session = await db.prisma.session.findFirst({ where: { refreshHash: sha256(c.cookies.tf_rt) } });
    const lastUsedAt = new Date('2026-01-02T03:04:05Z');
    await db.prisma.session.update({ where: { id: session.id }, data: { lastUsedAt } });
    const result = await c.get('/me/sessions');
    assert.equal(result.data.sessions.find((s) => s._id === session.id).lastUsedAt, lastUsedAt.toISOString());
  });
});

let fixtureNumber = 0;
async function permissionFixture() {
  const owner = await new Client().login('mai.anh@nhom24.edu.vn');
  const member = await new Client().login('nhu@nhom24.edu.vn');
  const admin = await new Client().login('thuan@nhom24.edu.vn');
  const other = await new Client().login('dat@nhom24.edu.vn');
  const r = await owner.post('/workspaces', { name: `Loc regression ${++fixtureNumber}` });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const ws = r.data.workspace._id;
  await db.prisma.membership.createMany({
    data: [
      { workspace: ws, user: seed.users.nhu.id, role: 'member' },
      { workspace: ws, user: seed.users.thuan.id, role: 'admin' },
      { workspace: ws, user: seed.users.dat.id, role: 'member' },
      { workspace: ws, user: seed.users.linh.id, role: 'viewer' },
    ],
  });
  const p = await owner.post(`/workspaces/${ws}/projects`, { name: 'Dự án kiểm thử quyền', members: [seed.users.nhu.id, seed.users.dat.id, seed.users.linh.id] });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  const pid = p.data.project._id;
  const create = async (fields = {}) => {
    const r = await owner.post(`/projects/${pid}/tasks`, { title: 'Kiểm thử phân quyền', ...fields });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.task;
  };
  return { owner, member, admin, other, ws, pid, create };
}

async function socketFor(client, t) {
  const socket = connectSocket(base.replace(/\/api$/, ''), {
    transports: ['websocket'],
    reconnection: false,
    autoConnect: false,
    extraHeaders: {
      cookie: Object.entries(client.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
    },
  });
  t.after(() => socket.disconnect());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket không kết nối trong 5 giây')), 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.connect();
  });
  return socket;
}
const join = (socket, pid) => socket.timeout(5000).emitWithAck('project:join', pid);

describe('Rà soát 25/10: thu hồi quyền và bảo toàn tài liệu', () => {
  test('My Tasks trả quyền từng dự án và đếm hợp nhất việc cần xử lý', async () => {
    const { owner, member, pid, ws, create } = await permissionFixture();
    const task = await create({ assignee: seed.users.nhu.id, dueDate: new Date(Date.now() - 1000).toISOString(), status: 'review' });
    const list = await member.get(`/workspaces/${ws}/my-tasks`);
    assert.equal(list.status, 200);
    assert.equal(list.data.summary.actionable, 1);
    assert.deepEqual(list.data.items.find((t) => t._id === task._id).access, { canWrite: true, canManage: false });
    const ownerList = await owner.get(`/workspaces/${ws}/my-tasks?assignee=all`);
    assert.deepEqual(ownerList.data.items[0].access, { canWrite: true, canManage: true });
    await owner.patch(`/projects/${pid}`, { manager: seed.users.nhu.id });
    assert.deepEqual((await member.get(`/workspaces/${ws}/my-tasks`)).data.items[0].access, { canWrite: true, canManage: true });
    const viewer = await new Client().login('khanh.linh@nhom24.edu.vn');
    assert.deepEqual((await viewer.get(`/workspaces/${ws}/my-tasks?assignee=all`)).data.items[0].access, { canWrite: false, canManage: false });
    await member.post(`/projects/${pid}/archive`);
    assert.deepEqual((await member.get(`/workspaces/${ws}/my-tasks`)).data.items[0].access, { canWrite: false, canManage: false });
  });

  test('Admin bị hạ quyền sau middleware không thể đổi tên workspace', { timeout: 15000 }, async (t) => {
    const { owner, admin, ws } = await permissionFixture();
    let release;
    let arrived;
    const gate = new Promise((resolve) => { release = resolve; });
    const reached = new Promise((resolve) => { arrived = resolve; });
    const original = db.prisma.membership.findUnique.bind(db.prisma.membership);
    let held = false;
    db.prisma.membership.findUnique = async (args) => {
      const result = await original(args);
      if (!held && args.include?.workspaceRef && args.where.workspace_user?.workspace === ws && args.where.workspace_user?.user === seed.users.thuan.id) {
        held = true;
        arrived();
        await gate;
      }
      return result;
    };
    t.after(() => { db.prisma.membership.findUnique = original; release(); });
    const pending = admin.patch(`/workspaces/${ws}`, { name: 'Tên không được phép' });
    await reached;
    try {
      assert.equal((await owner.patch(`/workspaces/${ws}/members/${seed.users.thuan.id}`, { role: 'member' })).status, 200);
    } finally { release(); }
    assert.equal((await pending).status, 403);
    assert.notEqual((await db.prisma.workspace.findUnique({ where: { id: ws } })).name, 'Tên không được phép');
  });

  test('editor nhận đủ nội dung hơn 20.000 ký tự, kiểm quyền và version khi lưu', async () => {
    const { owner, member, ws, pid } = await permissionFixture();
    const content = 'Nội dung dài. '.repeat(3000) + 'KẾT THÚC';
    const created = await owner.post(`/projects/${pid}/documents`, { name: 'Dài', content });
    assert.equal(created.status, 201);
    const id = created.data.document._id;
    const loaded = await member.get(`/documents/${id}/content`);
    assert.equal(loaded.status, 200);
    assert.equal(loaded.data.content, content);
    assert.equal(loaded.data.version, 1);
    assert.equal((await owner.patch(`/documents/${id}`, { content: loaded.data.content + ' mới', version: loaded.data.version })).status, 200);
    assert.equal((await owner.get(`/documents/${id}/download`)).data, content + ' mới');
    assert.equal((await member.patch(`/documents/${id}`, { content: 'bản cũ', version: loaded.data.version })).status, 409);
    await owner.del(`/workspaces/${ws}/members/${seed.users.nhu.id}`);
    assert.equal((await member.get(`/documents/${id}/content`)).status, 404);
  });

  const uploadText = async (owner, pid, content) => {
    const form = new FormData();
    form.append('files', new Blob([content], { type: 'text/plain' }), 'source.txt');
    const res = await fetch(`${base}/projects/${pid}/documents/upload`, {
      method: 'POST', headers: { 'x-taskflow': '1', cookie: Object.entries(owner.cookies).map(([k, v]) => `${k}=${v}`).join('; ') }, body: form,
    });
    assert.equal(res.status, 201);
    return (await res.json()).documents[0]._id;
  };

  test('TXT lớn tải nguyên bản, không cho ghi đè từ phần nội dung đã cắt', async () => {
    const { owner, pid } = await permissionFixture();
    const content = 'a'.repeat(210000) + 'ĐUÔI TỆP';
    const id = await uploadText(owner, pid, content);
    const downloaded = await owner.get(`/documents/${id}/download`);
    assert.equal(downloaded.data.length, content.length);
    assert.ok(downloaded.data.endsWith('ĐUÔI TỆP'));
    assert.equal((await owner.get(`/documents/${id}/content`)).status, 400);
    assert.equal((await owner.patch(`/documents/${id}`, { content: 'cắt ngắn', version: 1 })).status, 400);
    assert.equal((await owner.patch(`/documents/${id}`, { name: 'Đổi tên tệp lớn.txt', version: 1 })).status, 200);
    assert.equal((await owner.get(`/documents/${id}/download`)).data, content);
  });

  test('TXT upload khôi phục được nguyên văn bản gốc sau chỉnh sửa', async () => {
    const { owner, pid } = await permissionFixture();
    const original = 'Nguồn gốc <tag>không phải HTML</tag>\r\nDòng cuối';
    const id = await uploadText(owner, pid, original);
    assert.equal((await owner.patch(`/documents/${id}`, { content: 'Đã sửa', version: 1 })).status, 200);
    assert.equal((await owner.get(`/documents/${id}/revisions/1`)).data.revision?.content, original);
    assert.equal((await owner.patch(`/documents/${id}`, { restoreVersion: 1, version: 2 })).status, 200);
    assert.equal((await owner.get(`/documents/${id}/download`)).data, original);
  });

  test('văn bản giữ nguyên markup và khoảng trắng; NUL bị từ chối rõ ràng', async () => {
    const { owner, pid } = await permissionFixture();
    const content = '  <script>alert("không thực thi")</script>\r\n  <T>\t\n';
    const created = await owner.post(`/projects/${pid}/documents`, { name: 'Văn bản', content });
    assert.equal(created.status, 201);
    const id = created.data.document._id;
    assert.equal((await owner.get(`/documents/${id}/content`)).data.content, content);
    assert.equal((await owner.patch(`/documents/${id}`, { content, version: 1 })).status, 200);
    assert.equal((await owner.get(`/documents/${id}/download`)).data, content);
    assert.equal((await owner.patch(`/documents/${id}`, { content: 'a\u0000b', version: 2 })).status, 400);
  });

  test('đổi tên tăng version, chặn ghi đè tên cũ; revision sai định dạng trả 404', async () => {
    const { owner, pid } = await permissionFixture();
    const created = await owner.post(`/projects/${pid}/documents`, { name: 'Ban đầu', content: 'Nội dung' });
    const id = created.data.document._id;
    const renamed = await owner.patch(`/documents/${id}`, { name: 'Tên mới.txt', version: 1 });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.data.document.version, 2);
    assert.equal((await owner.patch(`/documents/${id}`, { name: 'Tên lỗi thời.txt', version: 1 })).status, 409);
    for (const v of ['1abc', '1.5', '2147483648']) assert.equal((await owner.get(`/documents/${id}/revisions/${v}`)).status, 404);
  });
});

describe('Lộc: phân quyền và nghiệp vụ bổ sung', () => {
  test('Member bị chặn Done qua cả create, PATCH và Kanban; PM phải duyệt từ Review', async () => {
    const { owner, member, pid, create } = await permissionFixture();
    const task = await create({ assignee: seed.users.nhu.id });
    assert.equal((await member.post(`/projects/${pid}/tasks`, { title: 'Bỏ qua duyệt', status: 'done' })).status, 403);
    assert.equal((await owner.post(`/projects/${pid}/tasks`, { title: 'Done trực tiếp', status: 'done' })).status, 400);
    assert.equal((await member.patch(`/tasks/${task._id}`, { status: 'done', version: task.version })).status, 403);
    assert.equal((await member.post(`/tasks/${task._id}/move`, { status: 'done', order: 1, version: task.version })).status, 403);
    assert.equal((await owner.patch(`/tasks/${task._id}`, { status: 'done', version: task.version })).status, 400);
    const started = await member.patch(`/tasks/${task._id}`, { status: 'in_progress', version: task.version });
    assert.equal(started.status, 200);
    const review = await member.patch(`/tasks/${task._id}`, { status: 'review', version: started.data.task.version });
    assert.equal(review.status, 200);
    const approved = await owner.post(`/tasks/${task._id}/move`, { status: 'done', order: 2, version: review.data.task.version });
    assert.equal(approved.status, 200);
    assert.ok(approved.data.task.completedAt);
    assert.equal((await db.prisma.task.findUnique({ where: { id: task._id } })).status, 'done');
  });

  test('PM là Member vẫn được duyệt; Viewer không thể làm PM hoặc nhận task', async () => {
    const { owner, member, pid, create } = await permissionFixture();
    const task = await create({ status: 'review' });
    assert.equal((await owner.patch(`/projects/${pid}`, { manager: seed.users.nhu.id })).status, 200);
    assert.equal((await member.patch(`/tasks/${task._id}`, { status: 'done', version: task.version })).status, 200);
    assert.equal((await member.patch(`/projects/${pid}`, { manager: seed.users.linh.id })).status, 400);
    assert.equal((await member.post(`/projects/${pid}/tasks`, { title: 'Viewer', assignee: seed.users.linh.id })).status, 400);
  });

  test('gỡ khỏi project: bỏ giao task cha/con, tăng version, giữ audit và thu hồi API/file/AI/thông báo', async () => {
    const { owner, member, ws, pid, create } = await permissionFixture();
    const parent = await create({ assignee: seed.users.nhu.id });
    const child = await create({ parent: parent._id, assignee: seed.users.nhu.id });
    const doc = await db.prisma.document.create({
      data: { workspace: ws, project: pid, kind: 'doc', name: 'Bí mật dự án', content: 'Nguồn nội bộ', uploadedBy: seed.users.maianh.id },
    });
    assert.equal((await member.get(`/documents/${doc.id}/download`)).status, 200);
    assert.ok((await member.get(`/notifications?project=${pid}`)).data.items.length > 0);
    assert.equal((await owner.patch(`/projects/${pid}`, { members: [seed.users.maianh.id, seed.users.dat.id] })).status, 200);
    for (const original of [parent, child]) {
      const task = await db.prisma.task.findUnique({ where: { id: original._id } });
      assert.equal(task.assignee, null);
      assert.equal(task.version, original.version + 1);
      const audit = await db.prisma.activity.findFirst({ where: { entityId: task.id, field: 'assignee', action: 'Bỏ giao việc khi thu hồi quyền' } });
      assert.equal(audit.before, seed.users.nhu.id);
      assert.equal(audit.after, 'Chưa giao');
    }
    assert.equal((await member.get(`/tasks/${parent._id}`)).status, 404);
    assert.equal((await member.get(`/documents/${doc.id}/download`)).status, 404);
    assert.equal((await member.post(`/projects/${pid}/ai/ask`, { question: 'Nguồn nội bộ là gì?' })).status, 404);
    assert.equal((await member.get(`/notifications?project=${pid}`)).data.items.length, 0);
    assert.equal((await owner.patch(`/tasks/${parent._id}`, { title: 'Bản cũ', version: parent.version })).status, 409);
  });

  test('gỡ khỏi workspace: bỏ giao, gỡ PM và không để lại quyền dự án', async () => {
    const { owner, member, ws, pid, create } = await permissionFixture();
    const task = await create({ assignee: seed.users.nhu.id });
    await owner.patch(`/projects/${pid}`, { manager: seed.users.nhu.id });
    assert.equal((await owner.del(`/workspaces/${ws}/members/${seed.users.nhu.id}`)).status, 400, 'phải giữ ít nhất một PM');
    assert.equal((await member.patch(`/projects/${pid}/members/${seed.users.maianh.id}`, { role: 'pm' })).status, 200);
    assert.equal((await owner.del(`/workspaces/${ws}/members/${seed.users.nhu.id}`)).status, 200);
    const p = await db.prisma.project.findUnique({ where: { id: pid } });
    assert.equal(p.manager, seed.users.maianh.id);
    assert.ok(!p.members.includes(seed.users.nhu.id));
    assert.equal((await db.prisma.task.findUnique({ where: { id: task._id } })).assignee, null);
    assert.equal((await member.get(`/workspaces/${ws}`)).status, 404);
    assert.equal((await member.get(`/projects/${pid}/tasks`)).status, 404);
  });

  test('hạ PM xuống Viewer: vẫn đọc được, không được ghi/duyệt/lưu trữ và task được bỏ giao', async () => {
    const { owner, member, ws, pid, create } = await permissionFixture();
    const task = await create({ status: 'review', assignee: seed.users.nhu.id });
    await owner.patch(`/projects/${pid}`, { manager: seed.users.nhu.id });
    assert.equal((await owner.patch(`/workspaces/${ws}/members/${seed.users.nhu.id}`, { role: 'viewer' })).status, 400);
    assert.equal((await member.patch(`/projects/${pid}/members/${seed.users.maianh.id}`, { role: 'pm' })).status, 200);
    assert.equal((await owner.patch(`/workspaces/${ws}/members/${seed.users.nhu.id}`, { role: 'viewer' })).status, 200);
    const info = await member.get(`/projects/${pid}`);
    assert.equal(info.status, 200);
    assert.equal(info.data.access.canManage, false);
    assert.equal(info.data.access.canWrite, false);
    assert.equal(info.data.project.manager._id, seed.users.maianh.id);
    assert.equal((await member.patch(`/tasks/${task._id}`, { status: 'done' })).status, 403);
    assert.equal((await member.post(`/projects/${pid}/archive`)).status, 403);
    assert.equal((await db.prisma.task.findUnique({ where: { id: task._id } })).assignee, null);
  });

  test('Admin không gỡ Admin khác hoặc sửa quyền cấp cao', async () => {
    const { owner, admin, ws } = await permissionFixture();
    await owner.patch(`/workspaces/${ws}/members/${seed.users.dat.id}`, { role: 'admin' });
    assert.equal((await admin.del(`/workspaces/${ws}/members/${seed.users.dat.id}`)).status, 403);
    assert.equal((await admin.patch(`/workspaces/${ws}/members/${seed.users.dat.id}`, { role: 'member' })).status, 403);
    assert.equal((await admin.patch(`/workspaces/${ws}/members/${seed.users.nhu.id}`, { role: 'owner' })).status, 403);
  });

  test('hai Owner hạ quyền đồng thời: luôn còn một Owner và owner_id hợp lệ', async () => {
    const { owner, other, ws } = await permissionFixture();
    assert.equal((await owner.patch(`/workspaces/${ws}/members/${seed.users.dat.id}`, { role: 'owner' })).status, 200);
    const results = await Promise.all([
      owner.patch(`/workspaces/${ws}/members/${seed.users.maianh.id}`, { role: 'member' }),
      other.patch(`/workspaces/${ws}/members/${seed.users.dat.id}`, { role: 'member' }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    const owners = await db.prisma.membership.findMany({ where: { workspace: ws, role: 'owner' } });
    assert.equal(owners.length, 1);
    assert.equal((await db.prisma.workspace.findUnique({ where: { id: ws } })).owner, owners[0].user);
  });

  test('giao task đồng thời gỡ thành viên: không để lại assignee ngoài dự án', async () => {
    const { owner, pid } = await permissionFixture();
    const [created, removed] = await Promise.all([
      owner.post(`/projects/${pid}/tasks`, { title: 'Giao đồng thời', assignee: seed.users.nhu.id }),
      owner.patch(`/projects/${pid}`, { members: [seed.users.maianh.id] }),
    ]);
    assert.ok([201, 400].includes(created.status), JSON.stringify(created.data));
    assert.equal(removed.status, 200);
    assert.equal(await db.prisma.task.count({ where: { project: pid, assignee: seed.users.nhu.id } }), 0);
  });

  test('giao lại task đồng thời gỡ thành viên: version và assignee vẫn nhất quán', async () => {
    const { owner, pid, create } = await permissionFixture();
    const task = await create();
    const [updated, removed] = await Promise.all([
      owner.patch(`/tasks/${task._id}`, { assignee: seed.users.nhu.id, version: task.version }),
      owner.patch(`/projects/${pid}`, { members: [seed.users.maianh.id] }),
    ]);
    assert.ok([200, 400, 409].includes(updated.status), JSON.stringify(updated.data));
    assert.equal(removed.status, 200);
    assert.equal((await db.prisma.task.findUnique({ where: { id: task._id } })).assignee, null);
  });

  test('dữ liệu PM sai phải rollback cả bỏ giao và thay đổi thành viên', async () => {
    const { owner, pid, create } = await permissionFixture();
    const task = await create({ assignee: seed.users.nhu.id });
    const r = await owner.patch(`/projects/${pid}`, { members: [seed.users.maianh.id], manager: seed.users.nhu.id });
    assert.equal(r.status, 400);
    assert.ok((await db.prisma.project.findUnique({ where: { id: pid } })).members.includes(seed.users.nhu.id));
    const persisted = await db.prisma.task.findUnique({ where: { id: task._id } });
    assert.equal(persisted.assignee, seed.users.nhu.id);
    assert.equal(persisted.version, task.version);
    assert.equal(await db.prisma.activity.count({ where: { entityId: task._id, action: 'Bỏ giao việc khi thu hồi quyền' } }), 0);
  });

  test('socket đang mở bị thu hồi khi gỡ thành viên, không join lại hoặc nhận sự kiện', async (t) => {
    const { owner, member, pid } = await permissionFixture();
    const s = await socketFor(member, t);
    assert.equal((await join(s, pid)).ok, true);
    const messages = [];
    s.on('permission:probe', (data) => messages.push(data));
    await emitProject(pid, 'permission:probe', { text: 'Trước thu hồi' });
    await join(s, pid);
    assert.equal(messages.length, 1);
    assert.equal((await owner.patch(`/projects/${pid}`, { members: [seed.users.maianh.id] })).status, 200);
    assert.equal((await join(s, pid)).ok, false);
    assert.equal(realtime.sockets.sockets.get(s.id).rooms.has(`project:${pid}`), false);
    await emitProject(pid, 'permission:probe', { text: 'Sau thu hồi' });
    await join(s, pid);
    assert.equal(messages.length, 1);
  });

  test('Admin ngoài dự án bị chặn; gỡ membership thu hồi socket và API', async (t) => {
    const { owner, admin, ws, pid } = await permissionFixture();
    const s = await socketFor(admin, t);
    assert.equal((await join(s, pid)).ok, false, 'Admin ngoài dự án không có quyền');
    assert.equal((await owner.post(`/projects/${pid}/members`, { user: seed.users.thuan.id })).status, 200);
    assert.equal((await join(s, pid)).ok, true);
    assert.equal((await owner.del(`/projects/${pid}/members/${seed.users.thuan.id}`)).status, 200);
    assert.equal((await owner.patch(`/workspaces/${ws}/members/${seed.users.thuan.id}`, { role: 'member' })).status, 200);
    assert.equal((await join(s, pid)).ok, false);
    assert.equal((await admin.get(`/projects/${pid}`)).status, 404);
    assert.equal(realtime.sockets.sockets.get(s.id).rooms.has(`project:${pid}`), false);
  });

  test('logout chấm dứt socket đang mở', async (t) => {
    const { member, pid } = await permissionFixture();
    const s = await socketFor(member, t);
    await join(s, pid);
    const disconnected = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket vẫn mở sau logout')), 5000);
      s.once('disconnect', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    assert.equal((await member.post('/auth/logout')).status, 200);
    await disconnected;
    assert.equal(s.connected, false);
  });

  test('không lộ danh sách dự án riêng qua endpoint thành viên workspace', async () => {
    const { owner, member, ws, pid } = await permissionFixture();
    await owner.patch(`/projects/${pid}`, { members: [seed.users.maianh.id] });
    const r = await member.get(`/workspaces/${ws}/members`);
    assert.equal(r.status, 200);
    assert.ok(r.data.members.every((m) => m.projects.every((p) => p._id !== pid)));
  });

  test('nhận cùng lời mời đồng thời: chỉ một lần thành công; lời mời đã thu hồi/hết hạn bị chặn', async () => {
    const { owner, other, ws } = await permissionFixture();
    await owner.del(`/workspaces/${ws}/members/${seed.users.dat.id}`);
    const issued = await owner.post(`/workspaces/${ws}/invites`, { emails: ['dat@nhom24.edu.vn'] });
    assert.equal(issued.status, 201);
    const mail = await db.prisma.outbox.findFirst({ where: { to: 'dat@nhom24.edu.vn' }, orderBy: { createdAt: 'desc' } });
    const token = new URL(mail.link).pathname.split('/').at(-1);
    const results = await Promise.all([other.post(`/me/invites/${token}/accept`), other.post(`/me/invites/${token}/accept`)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    const invite = issued.data.created[0];
    await owner.del(`/workspaces/${ws}/members/${seed.users.dat.id}`);
    await db.prisma.invite.update({ where: { id: invite._id }, data: { acceptedAt: null, revokedAt: new Date() } });
    assert.equal((await other.post(`/me/invites/${token}/accept`)).status, 400);
    await db.prisma.invite.update({ where: { id: invite._id }, data: { revokedAt: null, expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await other.post(`/me/invites/${token}/accept`)).status, 400);
  });

  test('quá hạn theo thời điểm: hôm nay, đúng hạn, không hạn, Done và ngưỡng 0/1 ngày', async () => {
    const { owner, pid, create } = await permissionFixture();
    const now = new Date();
    const late = await create({ dueDate: new Date(+now - 60000).toISOString() });
    const exact = await create({ dueDate: now.toISOString() });
    await create({ dueDate: new Date(+now + 3600000).toISOString() });
    await create();
    const done = await create({ dueDate: new Date(+now - 172800000).toISOString(), status: 'review' });
    assert.equal((await owner.patch(`/tasks/${done._id}`, { status: 'done', version: done.version })).status, 200);
    const ov = await projectOverview(pid, { now });
    assert.deepEqual(
      ov.overdue.map((t) => t.id),
      [late._id],
    );
    await db.prisma.project.update({ where: { id: pid }, data: { riskRules: { overdue: true, overdueDays: 0, overload: false, dueSoon: false, blockedByOverdue: false } } });
    const zero = await riskAlerts(pid, { now });
    assert.ok(zero.open.some((a) => a.type === 'overdue' && a.tasks[0].id === late._id));
    assert.ok(!zero.open.some((a) => a.tasks.some((t) => t.id === exact._id || t.id === done._id)));
    await db.prisma.project.update({ where: { id: pid }, data: { riskRules: { overdue: true, overdueDays: 1, overload: false, dueSoon: false, blockedByOverdue: false } } });
    assert.equal((await riskAlerts(pid, { now })).open.length, 0);
  });

  test('0 giờ khả dụng: có việc phải cảnh báo; không việc không cảnh báo; thiếu estimate được báo rõ', async () => {
    const { owner, ws, pid, create } = await permissionFixture();
    await owner.patch(`/workspaces/${ws}/members/${seed.users.nhu.id}`, { weeklyHours: 0 });
    const task = await create({ assignee: seed.users.nhu.id, estimateHours: 5, dueDate: new Date(Date.now() - 3600000).toISOString() });
    await create({ assignee: seed.users.nhu.id, dueDate: new Date(Date.now() - 3600000).toISOString() });
    const w = (await workload(pid)).find((w) => w.user.id === seed.users.nhu.id);
    assert.equal(w.pct, null);
    assert.equal(w.overloaded, true);
    assert.equal(w.missingEstimates, 1);
    assert.ok((await riskAlerts(pid)).open.some((a) => a.type === 'overload' && a.owner.id === seed.users.nhu.id));
    // Remaining work is now explicitly editable, independent from hours spent.
    await owner.patch(`/tasks/${task._id}`, { spentHours: 5, remainingHours: 0, version: task.version });
    const empty = (await workload(pid)).find((w) => w.user.id === seed.users.nhu.id);
    assert.equal(empty.pct, 0);
    assert.equal(empty.overloaded, false);
    assert.ok(!(await riskAlerts(pid)).open.some((a) => a.type === 'overload' && a.owner.id === seed.users.nhu.id));
  });

  test('ngưỡng tải so sánh số thực trước khi làm tròn phần trăm', async () => {
    const { owner, ws, pid, create } = await permissionFixture();
    await owner.patch(`/workspaces/${ws}/members/${seed.users.nhu.id}`, { weeklyHours: 20 });
    await create({ assignee: seed.users.nhu.id, estimateHours: 20.01, dueDate: new Date(Date.now() - 1000).toISOString() });
    const w = (await workload(pid)).find((w) => w.user.id === seed.users.nhu.id);
    assert.equal(w.pct, 100);
    assert.equal(w.overloaded, true);
    assert.ok((await riskAlerts(pid)).open.some((a) => a.type === 'overload' && a.owner.id === seed.users.nhu.id));
  });

  test('hai phụ thuộc ngược nhau được gửi đồng thời vẫn không tạo chu trình', async () => {
    const { owner, create } = await permissionFixture();
    const a = await create({ title: 'A' });
    const b = await create({ title: 'B' });
    const results = await Promise.all([owner.post(`/tasks/${a._id}/dependencies`, { blockedBy: b._id }), owner.post(`/tasks/${b._id}/dependencies`, { blockedBy: a._id })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  });

  test('bản nháp AI không giao việc cho Viewer hoặc người bị gỡ trong lúc duyệt', async () => {
    const { owner, ws, pid } = await permissionFixture();
    assert.equal((await owner.patch(`/projects/${pid}/members/${seed.users.dat.id}`, { role: 'viewer' })).status, 200);
    const draft = await db.prisma.aiDraft.create({
      data: {
        workspace: ws,
        project: pid,
        user: seed.users.maianh.id,
        type: 'plan',
        items: [
          { key: '1', title: 'Người sắp bị gỡ', selected: true, assignee: seed.users.nhu.id },
          { key: '2', title: 'Viewer', selected: true, assignee: seed.users.linh.id },
          { key: '3', title: 'Project Viewer', selected: true, assignee: seed.users.dat.id, estimateHours: 4 },
        ],
      },
    });
    const [approved, removed] = await Promise.all([
      owner.post(`/ai/drafts/${draft.id}/approve`),
      owner.patch(`/projects/${pid}`, { members: [seed.users.maianh.id, seed.users.linh.id, seed.users.dat.id] }),
    ]);
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    assert.equal(removed.status, 200);
    const tasks = await db.prisma.task.findMany({ where: { project: pid } });
    assert.equal(tasks.length, 3);
    assert.equal(tasks.find((t) => t.title === 'Project Viewer').remainingHours, 4);
    assert.ok(tasks.every((t) => t.assignee === null));
  });

  test('bản nháp AI lỗi giữa chừng rollback mọi task và audit', async () => {
    const { owner, ws, pid } = await permissionFixture();
    const draft = await db.prisma.aiDraft.create({
      data: {
        workspace: ws,
        project: pid,
        user: seed.users.maianh.id,
        type: 'plan',
        items: [
          { key: '1', title: 'Hợp lệ', selected: true },
          { key: '2', title: 'x'.repeat(201), selected: true },
        ],
      },
    });
    assert.equal((await owner.post(`/ai/drafts/${draft.id}/approve`)).status, 500);
    assert.equal(await db.prisma.task.count({ where: { project: pid } }), 0);
    assert.equal(await db.prisma.activity.count({ where: { project: pid, entityType: 'task' } }), 0);
    assert.equal((await db.prisma.aiDraft.findUnique({ where: { id: draft.id } })).status, 'draft');
  });

  test('thu hồi quyền khi AI đang xử lý: không trả nội dung và không lưu cuộc hỏi đáp', { timeout: 15000 }, async (t) => {
    const { owner, member, ws, pid } = await permissionFixture();
    const { config } = await import('../src/config.js');
    const originalUrl = config.ai.serviceUrl;
    let release;
    let arrived;
    const received = new Promise((resolve) => {
      arrived = resolve;
    });
    const fake = http.createServer((req, res) => {
      req.resume();
      release = () => {
        if (res.writableEnded) return;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ result: { content: 'Nội dung riêng tư', citations: [], refused: false }, model: 'test-delayed', provider: 'test' }));
      };
      arrived();
    });
    await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
      config.ai.serviceUrl = originalUrl;
      release?.();
      fake.closeAllConnections();
      await new Promise((resolve) => fake.close(resolve));
    });
    config.ai.serviceUrl = `http://127.0.0.1:${fake.address().port}`;
    const pending = member.post(`/projects/${pid}/ai/ask`, { question: 'Nội dung riêng tư là gì?' });
    await received;
    assert.equal((await owner.del(`/workspaces/${ws}/members/${seed.users.nhu.id}`)).status, 200);
    release();
    const result = await pending;
    assert.equal(result.status, 404);
    assert.ok(!JSON.stringify(result.data).includes('Nội dung riêng tư'));
    assert.equal(await db.prisma.aiConversation.count({ where: { project: pid } }), 0);
  });

  test('subtask/checklist không tự duyệt task cha; dữ liệu trống cho thống kê bằng 0', async () => {
    const { owner, member, pid, create } = await permissionFixture();
    const empty = (await owner.get(`/projects/${pid}/overview`)).data;
    assert.equal(empty.kpis.total, 0);
    assert.equal(empty.kpis.progressPct, 0);
    assert.equal(empty.riskCount, 0);
    const parent = await create({ checklist: [{ text: 'Bước 1', done: false }] });
    const child = await create({ parent: parent._id, status: 'review' });
    assert.equal((await owner.patch(`/tasks/${child._id}`, { status: 'done', version: child.version })).status, 200);
    assert.equal((await owner.patch(`/tasks/${parent._id}`, { checklist: [{ text: 'Bước 1', done: true }], version: parent.version })).status, 200);
    assert.equal((await db.prisma.task.findUnique({ where: { id: parent._id } })).status, 'todo');
  });

  test('refresh đồng thời chỉ xoay token một lần và phát hiện dùng lại', async () => {
    const original = await new Client().login('dat@nhom24.edu.vn');
    const clients = Array.from({ length: 8 }, () => Object.assign(new Client(), { cookies: { ...original.cookies } }));
    const responses = await Promise.all(clients.map((c) => c.post('/auth/refresh')));
    assert.equal(responses.filter((r) => r.status === 200).length, 1);
    assert.equal(responses.filter((r) => r.status === 401).length, 7);
    const { sha256 } = await import('../src/utils/security.js');
    const session = await db.prisma.session.findFirst({ where: { refreshHash: sha256(original.cookies.tf_rt) } });
    assert.equal(await db.prisma.session.count({ where: { family: session.family, revokedAt: null } }), 0);
  });

  test('AI plan/apply/report chỉ dành PM; Member được hỏi đáp, Viewer không ghi', async () => {
    const { owner, member, ws, pid } = await permissionFixture();
    const viewer = await new Client().login('khanh.linh@nhom24.edu.vn');
    const period = { from: '2026-10-01', to: '2026-10-22' };
    const beforeUsage = await db.prisma.aiCall.count({ where: { workspace: ws } });
    assert.equal((await viewer.post(`/projects/${pid}/ai/ask`, { question: 'Dự án có gì?' })).status, 403);
    assert.equal(await db.prisma.aiCall.count({ where: { workspace: ws } }), beforeUsage, 'Viewer không tiêu quota');
    for (const c of [member, viewer]) {
      assert.equal((await c.post(`/projects/${pid}/ai/plan`, { goal: 'Kế hoạch kiểm thử' })).status, 403);
      assert.equal((await c.post(`/projects/${pid}/ai/meeting`, { title: 'Họp', text: 'Kiểm thử phần giao việc' })).status, 403);
      assert.equal((await c.post(`/projects/${pid}/ai/reports`, period)).status, 403);
    }
    assert.equal((await member.post(`/projects/${pid}/ai/ask`, { question: 'Dự án có gì?' })).status, 200);
    assert.equal((await owner.patch(`/projects/${pid}`, { manager: seed.users.nhu.id })).status, 200);
    const plan = await member.post(`/projects/${pid}/ai/plan`, { goal: 'Kế hoạch kiểm thử' });
    assert.equal(plan.status, 201);
    const report = await member.post(`/projects/${pid}/ai/reports`, period);
    assert.equal(report.status, 201);
    assert.equal((await member.patch(`/projects/${pid}`, { manager: seed.users.maianh.id })).status, 200);
    assert.equal((await member.post(`/ai/drafts/${plan.data.draft._id}/approve`)).status, 403);
    assert.equal((await member.patch(`/ai/drafts/${plan.data.draft._id}`, { items: [] })).status, 403);
    assert.equal((await member.patch(`/ai/reports/${report.data.report._id}`, { share: true })).status, 403);
    assert.equal((await member.del(`/ai/reports/${report.data.report._id}`)).status, 403);
    assert.equal(await db.prisma.task.count({ where: { project: pid } }), 0);
  });

  for (const feature of ['plan', 'meeting', 'reports', 'ask']) {
    test(`AI ${feature}: kiểm lại quyền hoặc nguồn sau khi dịch vụ trả về`, { timeout: 15000 }, async (t) => {
      const { owner, member, pid, create } = await permissionFixture();
      const task = await create();
      await owner.patch(`/projects/${pid}`, { manager: seed.users.nhu.id });
      const { config } = await import('../src/config.js');
      const originalUrl = config.ai.serviceUrl;
      let release;
      let arrived;
      const received = new Promise((r) => {
        arrived = r;
      });
      const fake = http.createServer((req, res) => {
        req.resume();
        release = () => {
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              result: { items: [], summary: 'Dữ liệu cũ', suggestions: '', content: 'Dữ liệu cũ', citations: [], refused: false },
              model: 'test',
              provider: 'test',
            }),
          );
        };
        arrived();
      });
      await new Promise((r) => fake.listen(0, '127.0.0.1', r));
      t.after(async () => {
        config.ai.serviceUrl = originalUrl;
        fake.closeAllConnections();
        await new Promise((r) => fake.close(r));
      });
      config.ai.serviceUrl = `http://127.0.0.1:${fake.address().port}`;
      const bodies = {
        plan: { goal: 'Kế hoạch kiểm thử' },
        meeting: { title: 'Họp', text: 'Nội dung cuộc họp kiểm thử' },
        reports: { from: '2026-10-01', to: '2026-10-22' },
        ask: { question: 'Nội dung công việc là gì?' },
      };
      const pending = member.post(`/projects/${pid}/ai/${feature}`, bodies[feature]);
      await received;
      if (feature === 'ask') assert.equal((await member.del(`/tasks/${task._id}`)).status, 200);
      else assert.equal((await member.patch(`/projects/${pid}`, { manager: seed.users.maianh.id })).status, 200);
      release();
      const r = await pending;
      assert.equal(r.status, feature === 'ask' ? 409 : 403, JSON.stringify(r.data));
      assert.ok(!JSON.stringify(r.data).includes('Dữ liệu cũ'));
      assert.equal(await db.prisma.aiDraft.count({ where: { project: pid } }), 0);
      assert.equal(await db.prisma.aiReport.count({ where: { project: pid } }), 0);
      assert.equal(await db.prisma.aiConversation.count({ where: { project: pid } }), 0);
    });
  }

  test('hạn mức AI đồng thời bao gồm lượt đang xử lý', async (t) => {
    const { ws } = await permissionFixture();
    const { config } = await import('../src/config.js');
    const { runAi, usageToday } = await import('../src/services/ai/gateway.js');
    const w = await db.prisma.workspace.findUnique({ where: { id: ws } });
    await db.prisma.workspace.update({ where: { id: ws }, data: { ai: { ...w.ai, dailyLimit: 1 } } });
    const originalUrl = config.ai.serviceUrl;
    let calls = 0;
    const fake = http.createServer((req, res) => {
      req.resume();
      calls++;
      setTimeout(() => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ result: { content: 'ok' }, model: 'quota-test', provider: 'test' }));
      }, 150);
    });
    await new Promise((r) => fake.listen(0, '127.0.0.1', r));
    t.after(async () => {
      config.ai.serviceUrl = originalUrl;
      fake.closeAllConnections();
      await new Promise((r) => fake.close(r));
    });
    config.ai.serviceUrl = `http://127.0.0.1:${fake.address().port}`;
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => runAi({ workspaceId: ws, userId: seed.users.maianh.id, feature: 'qa', payload: {} })));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter((r) => r.status === 'rejected' && r.reason.status === 429).length, 4);
    assert.equal(calls, 1);
    assert.equal(await usageToday(ws), 1);
  });

  test('quá hạn trong ngày đồng nhất giữa My Tasks, báo cáo và nhắc hạn', async () => {
    const { owner, member, ws, pid, create } = await permissionFixture();
    const now = new Date();
    const late = await create({ assignee: seed.users.nhu.id, dueDate: new Date(now.getTime() - 1000).toISOString() });
    const soon = await create({ assignee: seed.users.nhu.id, dueDate: new Date(now.getTime() + 3600000).toISOString() });
    const list = await member.get(`/workspaces/${ws}/my-tasks?due=overdue`);
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.data.items.map((x) => x._id),
      [late._id],
    );
    assert.equal(list.data.summary.overdue, 1);
    const { buildReportData } = await import('../src/services/ai/report.js');
    const p = await db.prisma.project.findUnique({ where: { id: pid } });
    const report = await buildReportData(pid, now, now, p);
    assert.deepEqual(report.sections.find((s) => s.key === 'late').refs, [late._id]);
    assert.ok(report.sections.find((s) => s.key === 'late').body.includes('quá hạn'));
    assert.ok(!report.sections.find((s) => s.key === 'late').refs.includes(soon._id));
    const { runDueReminders } = await import('../src/services/jobs.js');
    await runDueReminders(now);
    await runDueReminders(now);
    assert.equal(await db.prisma.notification.count({ where: { task: late._id, type: 'overdue' } }), 1);
  });

  test('Viewer không tạo/sửa/xóa bình luận; archived chặn cả tác giả; nội dung rỗng bị từ chối', async () => {
    const { owner, member, ws, pid, create } = await permissionFixture();
    const task = await create();
    const viewer = await new Client().login('khanh.linh@nhom24.edu.vn');
    assert.equal((await viewer.post(`/tasks/${task._id}/comments`, { body: 'Không được ghi' })).status, 403);
    const c = await member.post(`/tasks/${task._id}/comments`, { body: 'Bình luận của tôi' });
    assert.equal(c.status, 201);
    const cid = c.data.comment._id;
    assert.equal((await member.patch(`/comments/${cid}`, { body: '<b></b>' })).status, 400);
    await owner.patch(`/workspaces/${ws}/members/${seed.users.nhu.id}`, { role: 'viewer' });
    assert.equal((await member.patch(`/comments/${cid}`, { body: 'Sửa khi Viewer' })).status, 403);
    assert.equal((await member.del(`/comments/${cid}`)).status, 403);
    await owner.patch(`/workspaces/${ws}/members/${seed.users.nhu.id}`, { role: 'member' });
    assert.equal((await owner.post(`/projects/${pid}/archive`)).status, 200);
    assert.equal((await member.del(`/comments/${cid}`)).status, 403);
    assert.ok(await db.prisma.comment.findUnique({ where: { id: cid } }));
  });

  test('Admin không gửi lại/thu hồi/thay thế lời mời Admin; resend vô hiệu token cũ', async () => {
    const { owner, admin, ws } = await permissionFixture();
    const { sha256 } = await import('../src/utils/security.js');
    const raw = 'invite-admin-old-test';
    const inv = await db.prisma.invite.create({
      data: { workspace: ws, email: 'invite.loc@example.test', role: 'admin', invitedBy: seed.users.maianh.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 3600000) },
    });
    assert.equal((await admin.post(`/workspaces/${ws}/invites/${inv.id}/resend`)).status, 403);
    assert.equal((await admin.del(`/workspaces/${ws}/invites/${inv.id}`)).status, 403);
    assert.equal((await admin.post(`/workspaces/${ws}/invites`, { emails: [inv.email], role: 'member' })).status, 403);
    assert.equal((await owner.post(`/workspaces/${ws}/invites/${inv.id}/resend`)).status, 200);
    assert.equal((await owner.get(`/auth/invite/${raw}`)).data.valid, false);
  });

  test('tải lô tệp sai rollback toàn bộ; TXT sau sửa tải đúng phiên bản; restore sai trả 404', async () => {
    const { owner, pid } = await permissionFixture();
    const upload = async (files) => {
      const form = new FormData();
      for (const [name, content, type] of files) form.append('files', new Blob([content], { type }), name);
      const r = await fetch(`${base}/projects/${pid}/documents/upload`, {
        method: 'POST',
        headers: {
          'x-taskflow': '1',
          cookie: Object.entries(owner.cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; '),
        },
        body: form,
      });
      return { status: r.status, data: await r.json() };
    };
    assert.equal(
      (
        await upload([
          ['ok.txt', 'Nội dung', 'text/plain'],
          ['bad.pdf', 'Không phải PDF', 'application/pdf'],
        ])
      ).status,
      400,
    );
    assert.equal(await db.prisma.document.count({ where: { project: pid } }), 0);
    const good = await upload([['ok.txt', 'Nội dung ban đầu', 'text/plain']]);
    assert.equal(good.status, 201);
    const did = good.data.documents[0]._id;
    assert.equal((await owner.patch(`/documents/${did}`, { content: 'Phiên bản mới', version: 1 })).status, 200);
    assert.equal((await owner.get(`/documents/${did}/download`)).data, 'Phiên bản mới');
    assert.equal((await owner.patch(`/documents/${did}`, { restoreVersion: 999, version: 2 })).status, 404);
    assert.equal((await owner.patch(`/documents/${did}`, { content: 'Ghi đè từ bản cũ', version: 1 })).status, 409);
    assert.equal((await owner.get(`/documents/${did}/download`)).data, 'Phiên bản mới');
  });

  test('hai câu hỏi đồng thời không ghi đè mất lịch sử hội thoại', async () => {
    const { member, pid } = await permissionFixture();
    const first = await member.post(`/projects/${pid}/ai/ask`, { question: 'Nguồn dữ liệu ở đâu?' });
    assert.equal(first.status, 200);
    const id = first.data.conversation._id;
    const questions = ['Công việc hôm nay là gì?', 'Ai phụ trách kiểm thử?'];
    const results = await Promise.all(questions.map((question) => member.post(`/projects/${pid}/ai/ask`, { question, conversation: id })));
    assert.ok(results.every((r) => r.status === 200));
    const saved = await db.prisma.aiConversation.findUnique({ where: { id } });
    assert.equal(saved.messages.length, 6);
    for (const question of questions) assert.ok(saved.messages.some((m) => m.role === 'user' && m.content === question));
  });

  test('thu hồi phiên đồng thời refresh không để lại phiên con còn sống', async () => {
    const main = await new Client().login('dat@nhom24.edu.vn');
    const victim = await new Client().login('dat@nhom24.edu.vn');
    const { sha256 } = await import('../src/utils/security.js');
    const session = await db.prisma.session.findFirst({ where: { refreshHash: sha256(victim.cookies.tf_rt) } });
    const [removed, refreshed] = await Promise.all([main.del(`/me/sessions/${session.id}`), victim.post('/auth/refresh')]);
    assert.equal(removed.status, 200);
    assert.ok([200, 401].includes(refreshed.status));
    assert.equal(await db.prisma.session.count({ where: { family: session.family, revokedAt: null } }), 0);
    assert.equal((await victim.get('/me')).status, 401);
  });

  test('hai System Admin khóa nhau đồng thời vẫn còn người quản trị hoạt động và audit đầy đủ', async (t) => {
    await db.prisma.user.update({ where: { id: seed.users.dat.id }, data: { isSystemAdmin: true } });
    const sys = await new Client().login('admin@taskflow.local');
    const dat = await new Client().login('dat@nhom24.edu.vn');
    const system = await db.prisma.user.findUnique({ where: { email: 'admin@taskflow.local' } });
    t.after(async () => {
      await db.prisma.user.update({ where: { id: seed.users.dat.id }, data: { isSystemAdmin: false, isLocked: false } });
      await db.prisma.user.update({ where: { id: system.id }, data: { isLocked: false } });
    });
    const results = await Promise.all([sys.post(`/admin/users/${seed.users.dat.id}/lock`, { reason: 'Khác' }), dat.post(`/admin/users/${system.id}/lock`, { reason: 'Khác' })]);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(results.filter((r) => [401, 403].includes(r.status)).length, 1);
    assert.equal(await db.prisma.user.count({ where: { isSystemAdmin: true, isLocked: false } }), 1);
    const locked = await db.prisma.user.findFirst({ where: { id: { in: [system.id, seed.users.dat.id] }, isLocked: true } });
    assert.ok(await db.prisma.adminAudit.findFirst({ where: { targetUser: locked.id, action: 'lock' } }));
  });
});

describe('Ngày giờ và nâng dependency — hồi quy bổ sung', () => {
  async function dateFixture() {
    const owner = await new Client().login('mai.anh@nhom24.edu.vn');
    const w = await owner.post('/workspaces', { name: `Kiểm thử mốc ngày ${++fixtureNumber}` });
    assert.equal(w.status, 201);
    const p = await owner.post(`/workspaces/${w.data.workspace._id}/projects`, { name: 'Ngày giờ' });
    assert.equal(p.status, 201);
    return { owner, pid: p.data.project._id, ws: w.data.workspace._id };
  }

  test('API lưu date-only cuối ngày theo profile, giữ timestamp cụ thể khi cập nhật', async (t) => {
    const { owner, pid } = await dateFixture();
    const old = (await owner.get('/me')).data.user.timezone;
    t.after(() => owner.patch('/me', { timezone: old }));
    assert.equal((await owner.patch('/me', { timezone: 'America/New_York' })).status, 200);
    const r = await owner.post(`/projects/${pid}/tasks`, { title: 'Hạn ngày DST', dueDate: '2026-03-08' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.task.dueDate, '2026-03-09T03:59:59.999Z');
    const exact = '2026-10-22T09:30:12.345Z';
    const patch = await owner.patch(`/tasks/${r.data.task._id}`, { dueDate: exact, version: r.data.task.version });
    assert.equal(patch.status, 200);
    assert.equal(patch.data.task.dueDate, exact);
  });

  test('API từ chối ngày không tồn tại, timestamp thiếu offset và timezone giả', async () => {
    const { owner, pid } = await dateFixture();
    for (const dueDate of ['2026-02-30', '2026-10-22T17:00:00', '2026-02-30T12:00:00Z']) {
      assert.equal((await owner.post(`/projects/${pid}/tasks`, { title: 'Ngày sai', dueDate })).status, 400);
    }
    assert.equal((await owner.patch('/me', { timezone: 'Mars/Olympus' })).status, 400);
    assert.equal((await owner.get(`/projects/${pid}/calendar?from=bad&to=2026-10-22`)).status, 400);
  });

  test('báo cáo bao gồm đúng hết ngày VN, không lấn qua ngày tiếp theo', async () => {
    const { owner, pid } = await dateFixture();
    for (const [title, at] of [
      ['Trong ngày', '2026-10-22T16:59:59.999Z'],
      ['Ngoài ngày', '2026-10-22T17:00:00.000Z'],
    ]) {
      const r = await owner.post(`/projects/${pid}/tasks`, { title });
      assert.equal(r.status, 201);
      await db.prisma.task.update({ where: { id: r.data.task._id }, data: { status: 'done', completedAt: new Date(at) } });
    }
    const report = await owner.post(`/projects/${pid}/ai/reports`, { from: '2026-10-22', to: '2026-10-22' });
    assert.equal(report.status, 201, JSON.stringify(report.data));
    assert.equal(report.data.report.stats.done, 1);
    const section = report.data.report.sections.find((s) => s.key === 'done');
    assert.ok(section.body.includes('Trong ngày'));
    assert.ok(!section.body.includes('Ngoài ngày'));
  });

  test('Sprint không được đảo ngày kể cả PATCH chỉ một đầu mốc', async () => {
    const { owner, pid } = await dateFixture();
    assert.equal((await owner.patch(`/projects/${pid}`, { sprint: { start: '2026-10-01', end: '2026-10-14' } })).status, 200);
    assert.equal((await owner.patch(`/projects/${pid}`, { sprint: { start: '2026-10-15' } })).status, 400);
    const persisted = await db.prisma.project.findUnique({ where: { id: pid } });
    assert.equal(new Date(persisted.sprint.start).toISOString(), '2026-09-30T17:00:00.000Z');
  });
});

describe('Tính hiện thời của nguồn AI', () => {
  async function snapshotFixture() {
    const owner = await new Client().login('mai.anh@nhom24.edu.vn');
    const w = await owner.post('/workspaces', { name: `Snapshot ${++fixtureNumber}` });
    const p = await owner.post(`/workspaces/${w.data.workspace._id}/projects`, { name: 'Nguồn AI' });
    const pid = p.data.project._id;
    const task = (await owner.post(`/projects/${pid}/tasks`, { title: 'Task quá hạn', dueDate: '2020-01-01', estimateHours: 1 })).data.task;
    return { owner, ws: w.data.workspace._id, pid, task };
  }

  test('hỏi đáp cũ báo thay đổi và khóa link nguồn đã xóa; bản cũ chưa có revision báo unknown', async () => {
    const { owner, ws, pid, task } = await snapshotFixture();
    const { annotateConversation, collectSources, sourceFingerprint } = await import('../src/services/ai/qa.js');
    const revision = sourceFingerprint(await collectSources(pid));
    const stored = await db.prisma.aiConversation.create({
      data: {
        project: pid,
        workspace: ws,
        user: seed.users.maianh.id,
        title: 'Kiểm thử nguồn',
        messages: [
          {
            role: 'assistant',
            content: 'Nội dung lưu trước đó',
            sourceRevision: revision,
            citations: [{ kind: 'task', refId: task._id, n: 1, label: task.key, excerpt: task.title }],
          },
        ],
      },
    });
    assert.equal((await owner.get(`/ai/conversations/${stored.id}`)).data.conversation.messages[0].sourceState, 'current');
    assert.equal((await owner.patch(`/tasks/${task._id}`, { title: 'Nội dung đã sửa', version: task.version })).status, 200);
    const changed = (await owner.get(`/ai/conversations/${stored.id}`)).data.conversation.messages[0];
    assert.equal(changed.sourceState, 'changed');
    assert.equal(changed.citations[0].available, true);
    assert.equal((await owner.del(`/tasks/${task._id}`)).status, 200);
    const gone = (await owner.get(`/ai/conversations/${stored.id}`)).data.conversation.messages[0];
    assert.equal(gone.sourceState, 'changed');
    assert.equal(gone.citations[0].available, false);
    assert.equal(gone.content, 'Nội dung lưu trước đó', 'không sửa nội dung lịch sử');
    assert.equal(annotateConversation({ messages: [{ role: 'assistant', content: 'Bản cũ' }] }, []).messages[0].sourceState, 'unknown');
  });

  test('report phát hiện sửa estimate và xóa task, vẫn giữ số liệu snapshot', async () => {
    const { owner, pid, task } = await snapshotFixture();
    const created = await owner.post(`/projects/${pid}/ai/reports`, { from: '2020-01-01', to: '2026-10-22' });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const report = created.data.report;
    assert.equal(report.sourceState, 'current');
    assert.equal((await owner.patch(`/tasks/${task._id}`, { estimateHours: 9, version: task.version })).status, 200);
    const changed = (await owner.get(`/ai/reports/${report._id}`)).data.report;
    assert.equal(changed.sourceState, 'changed');
    assert.equal((await owner.del(`/tasks/${task._id}`)).status, 200);
    const gone = (await owner.get(`/ai/reports/${report._id}`)).data.report;
    assert.equal(gone.missingSources, 1);
    assert.equal(gone.stats.overdue, 1);
    await db.prisma.aiReport.update({ where: { id: report._id }, data: { sourceRevision: null } });
    assert.equal((await owner.get(`/ai/reports/${report._id}`)).data.report.sourceState, 'unknown');
  });
});

describe('Vòng đời xác minh và giới hạn mật khẩu', () => {
  test('xác minh một lần vô hiệu mọi link xác minh cũ, không dùng lại để đăng nhập', async () => {
    const c = new Client();
    const email = `loc-verify-${++fixtureNumber}@test.vn`;
    assert.equal((await c.post('/auth/register', { name: 'Xác minh', email, password: 'Abcdefg123', acceptTerms: true })).status, 201);
    assert.equal((await c.post('/auth/resend-verification', { email })).status, 200);
    const mails = await db.prisma.outbox.findMany({ where: { to: email }, orderBy: { createdAt: 'asc' } });
    assert.equal(mails.length, 2);
    const tokens = mails.map((m) => new URL(m.link).searchParams.get('token'));
    assert.equal((await c.post('/auth/verify-email', { token: tokens[0] })).status, 200);
    assert.equal((await c.post('/auth/logout')).status, 200);
    const retry = await new Client().post('/auth/verify-email', { token: tokens[1] });
    assert.equal(retry.status, 400, 'link khác đã gửi trước xác minh không được tạo phiên mới');
  });

  test('không nhận mật khẩu bị bcrypt cắt ở 72 byte, kể cả Unicode', async () => {
    const c = new Client();
    for (const password of ['a'.repeat(72) + 'A1', 'Á'.repeat(36) + '1']) {
      const result = await c.post('/auth/register', { name: 'Mật khẩu dài', email: `long-${++fixtureNumber}@test.vn`, password, acceptTerms: true });
      assert.equal(result.status, 400, 'phải chặn trước khi bcrypt cắt mật khẩu');
    }
  });
});

describe('Phiên đăng nhập và dữ liệu biên', () => {
  test('Ghi nhớ đăng nhập quyết định cookie persistent; refresh không kéo dài quá hạn phiên', async () => {
    const { sha256 } = await import('../src/utils/security.js');
    for (const remember of [false, true]) {
      const c = new Client();
      const login = await c.post('/auth/login', { email: 'mai.anh@nhom24.edu.vn', password: DEMO_PASSWORD, remember });
      assert.equal(login.status, 200);
      assert.equal(
        login.setCookies.every((s) => /Max-Age=/i.test(s) === remember),
        true,
      );
      const session = await db.prisma.session.findFirst({ where: { refreshHash: sha256(c.cookies.tf_rt) } });
      assert.equal(session.remember, remember);
      const ttlHours = (session.expiresAt - session.createdAt) / 3600000;
      assert.ok(Math.abs(ttlHours - (remember ? 720 : 24)) < 0.01);
      await db.prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() + 1200000) } });
      const refresh = await c.post('/auth/refresh');
      assert.equal(refresh.status, 200);
      assert.equal(
        refresh.setCookies.every((s) => /Max-Age=/i.test(s) === remember),
        true,
      );
      if (remember) assert.ok(Number(refresh.setCookies.find((s) => s.startsWith('tf_rt=')).match(/Max-Age=(\d+)/i)[1]) <= 1200);
      const next = await db.prisma.session.findFirst({ where: { refreshHash: sha256(c.cookies.tf_rt) } });
      assert.equal(next.remember, remember);
    }
  });

  test('hai link xác minh khác nhau chạy đồng thời chỉ tạo một phiên', async () => {
    const c = new Client();
    const email = `verify-race-${++fixtureNumber}@test.vn`;
    assert.equal((await c.post('/auth/register', { name: 'Verify Race', email, password: 'Abcdefg123', acceptTerms: true })).status, 201);
    await c.post('/auth/resend-verification', { email });
    const mails = await db.prisma.outbox.findMany({ where: { to: email } });
    const responses = await Promise.all(mails.map((m) => new Client().post('/auth/verify-email', { token: new URL(m.link).searchParams.get('token') })));
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
    const user = await db.prisma.user.findUnique({ where: { email } });
    assert.equal(await db.prisma.session.count({ where: { user: user.id, revokedAt: null } }), 1);
  });

  test('client trực tiếp không giả IP qua X-Forwarded-For để né rate limit', async () => {
    const { sha256 } = await import('../src/utils/security.js');
    const r = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-taskflow': '1', 'x-forwarded-for': '198.51.100.77' },
      body: JSON.stringify({ email: 'mai.anh@nhom24.edu.vn', password: DEMO_PASSWORD }),
    });
    assert.equal(r.status, 200);
    const raw = r.headers
      .getSetCookie()
      .find((s) => s.startsWith('tf_rt='))
      .split(';')[0]
      .slice(6);
    const session = await db.prisma.session.findFirst({ where: { refreshHash: sha256(raw) } });
    assert.notEqual(session.ip, '198.51.100.77');
    assert.ok(['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(session.ip));
  });

  test('burndown giới hạn số điểm với khoảng cực lớn, Sprint một ngày không lấn ngày sau', async () => {
    const owner = await new Client().login('mai.anh@nhom24.edu.vn');
    const w = await owner.post('/workspaces', { name: `Burndown ${++fixtureNumber}` });
    const p = await owner.post(`/workspaces/${w.data.workspace._id}/projects`, { name: 'Sprint biên', sprint: { start: '1000-01-01', end: '9999-12-31' } });
    assert.equal(p.status, 201);
    const pid = p.data.project._id;
    const huge = await projectOverview(pid);
    assert.ok(huge.burndown.days.length <= 367);
    assert.equal(huge.burndown.sampled, true);
    assert.equal((await owner.patch(`/projects/${pid}`, { sprint: { start: '2026-10-23', end: '2026-10-23' } })).status, 200);
    const single = await projectOverview(pid);
    assert.equal(single.burndown.days.length, 1);
    assert.equal(single.burndown.days[0].ideal, 0);
  });
});

describe('Rủi ro: quyền sau AI và cập nhật đồng thời', () => {
  async function riskFixture() {
    const owner = await new Client().login('mai.anh@nhom24.edu.vn');
    const member = await new Client().login('nhu@nhom24.edu.vn');
    const w = await owner.post('/workspaces', { name: `Risk checks ${++fixtureNumber}` });
    const ws = w.data.workspace._id;
    await db.prisma.membership.create({ data: { workspace: ws, user: seed.users.nhu.id, role: 'member' } });
    const p = await owner.post(`/workspaces/${ws}/projects`, { name: 'Risk checks', members: [seed.users.nhu.id] });
    const pid = p.data.project._id;
    const task = (await owner.post(`/projects/${pid}/tasks`, { title: 'Nguồn rủi ro cũ', dueDate: new Date(Date.now() - 2 * 86400000).toISOString() })).data.task;
    const key = (await member.get(`/projects/${pid}/risks`)).data.open.find((a) => a.type === 'overdue').key;
    return { owner, member, ws, pid, task, key };
  }

  for (const mode of ['risk-revoked', 'risk-source', 'report-source']) {
    test(`AI đang chạy phải từ chối dữ liệu cũ: ${mode}`, { timeout: 15000 }, async (t) => {
      const { owner, member, pid, task, key } = await riskFixture();
      const { config } = await import('../src/config.js');
      const original = config.ai.serviceUrl;
      let release, arrive;
      const received = new Promise((r) => {
        arrive = r;
      });
      const fake = http.createServer((req, res) => {
        req.resume();
        release = () => {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ result: { explanation: 'Nội dung không được trả', summary: 'Nội dung không được trả', suggestions: '' }, model: 'test', provider: 'test' }));
        };
        arrive();
      });
      await new Promise((r) => fake.listen(0, '127.0.0.1', r));
      t.after(async () => {
        config.ai.serviceUrl = original;
        fake.closeAllConnections();
        await new Promise((r) => fake.close(r));
      });
      config.ai.serviceUrl = `http://127.0.0.1:${fake.address().port}`;
      const pending =
        mode === 'report-source' ? owner.post(`/projects/${pid}/ai/reports`, { from: '2026-10-01', to: '2026-10-23' }) : member.post(`/projects/${pid}/risks/explain`, { key });
      await received;
      if (mode === 'risk-revoked') assert.equal((await owner.patch(`/projects/${pid}`, { members: [seed.users.maianh.id] })).status, 200);
      else assert.equal((await owner.patch(`/tasks/${task._id}`, { title: 'Nguồn rủi ro mới', version: task.version })).status, 200);
      release();
      const response = await pending;
      assert.equal(response.status, mode === 'risk-revoked' ? 404 : 409, JSON.stringify(response.data));
      assert.ok(!JSON.stringify(response.data).includes('Nội dung không được trả'));
      assert.equal(await db.prisma.aiReport.count({ where: { project: pid } }), 0);
    });
  }

  test('resolve chỉ nhận cảnh báo tồn tại, ghi audit; cập nhật hai quy tắc đồng thời không mất dữ liệu', async () => {
    const { owner, member, ws, pid, key } = await riskFixture();
    assert.equal((await member.post(`/projects/${pid}/risks/resolve`, { key: 'invented-key' })).status, 404);
    assert.equal((await member.post(`/projects/${pid}/risks/resolve`, { key, title: 'Tiêu đề giả' })).status, 200);
    const resolved = await db.prisma.riskResolution.findUnique({ where: { project_key: { project: pid, key } } });
    assert.ok(resolved.title.includes('Nguồn rủi ro cũ'));
    assert.ok(await db.prisma.activity.findFirst({ where: { project: pid, action: 'Xử lý cảnh báo rủi ro' } }));
    assert.equal((await member.del(`/projects/${pid}/risks/resolve?key=${encodeURIComponent(key)}`)).status, 200);
    assert.ok(await db.prisma.activity.findFirst({ where: { project: pid, action: 'Mở lại cảnh báo rủi ro' } }));
    const results = await Promise.all([owner.req('PUT', `/projects/${pid}/risk-rules`, { overdueDays: 0 }), owner.req('PUT', `/projects/${pid}/risk-rules`, { overloadPct: 155 })]);
    assert.ok(results.every((r) => r.status === 200));
    const rules = (await db.prisma.project.findUnique({ where: { id: pid } })).riskRules;
    assert.equal(rules.overdueDays, 0);
    assert.equal(rules.overloadPct, 155);
    await owner.patch(`/workspaces/${ws}/members/${seed.users.nhu.id}`, { role: 'viewer' });
    assert.equal((await member.post(`/projects/${pid}/risks/resolve`, { key })).status, 403);
  });
});

test('phân trang sai trả 400 thay vì lỗi Prisma 500 hoặc lấy ngược bản ghi', async () => {
  const { pagination } = await import('../src/utils/http.js');
  for (const value of ['-1', '1.5', 'Infinity', 'NaN', '0', '9007199254740992', ['1', '2']]) {
    assert.throws(
      () => pagination({ limit: value }),
      (e) => e.status === 400,
    );
    assert.throws(
      () => pagination({ page: value }),
      (e) => e.status === 400,
    );
  }
  assert.throws(
    () => pagination({ page: '2147483647', limit: '100' }),
    (e) => e.status === 400,
  );
  assert.deepEqual(pagination({ limit: '500' }), { page: 1, limit: 100 });
  const owner = await new Client().login('mai.anh@nhom24.edu.vn');
  for (const url of [
    `/workspaces/${seed.workspace.id}/my-tasks`,
    `/workspaces/${seed.workspace.id}/activity`,
    `/projects/${seed.projects.website.id}/documents`,
    '/notifications',
  ]) {
    assert.equal((await owner.get(`${url}?limit=-1`)).status, 400, url);
    assert.equal((await owner.get(`${url}?page=1.5`)).status, 400, url);
  }
});

describe('AI: hạn biên bản và giới hạn kế hoạch', () => {
  async function fixture() {
    const owner = await new Client().login('mai.anh@nhom24.edu.vn');
    const w = await owner.post('/workspaces', { name: `AI dates ${++fixtureNumber}` });
    const p = await owner.post(`/workspaces/${w.data.workspace._id}/projects`, { name: 'Kiểm tra hạn AI' });
    return { owner, ws: w.data.workspace._id, pid: p.data.project._id };
  }

  test('biên bản qua HTTP và duyệt task giữ ngày ISO/cuối ngày profile, ngày sai để trống', async (t) => {
    const { owner, pid } = await fixture();
    const user = await db.prisma.user.findUnique({ where: { id: seed.users.maianh.id } });
    t.after(() => db.prisma.user.update({ where: { id: user.id }, data: { timezone: user.timezone } }));
    await db.prisma.user.update({ where: { id: user.id }, data: { timezone: 'America/New_York' } });
    const r = await owner.post(`/projects/${pid}/ai/meeting`, {
      title: 'Hạn công việc',
      text: 'Mai Anh: mình sẽ hoàn thành API ngày 2099-02-15\nMai Anh: mình sẽ kiểm thử ngày 31/02/2099',
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const draft = r.data.draft;
    assert.equal(draft.items[0].dueDate, '2099-02-16T04:59:59.999Z');
    assert.equal(draft.items[1].dueDate, null);
    assert.equal((await owner.post(`/ai/drafts/${draft._id}/approve`)).status, 200);
    const tasks = await db.prisma.task.findMany({ where: { project: pid }, orderBy: { number: 'asc' } });
    assert.equal(tasks[0].dueDate.toISOString(), draft.items[0].dueDate);
    assert.equal(tasks[1].dueDate, null);
  });

  test('kế hoạch 1 giờ hợp lệ, sửa vượt giới hạn bị chặn trước khi tạo task', async () => {
    const { owner, pid } = await fixture();
    const r = await owner.post(`/projects/${pid}/ai/plan`, { goal: 'Xây dựng đăng nhập OTP', maxHours: 1, deadline: '2099-02-15' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const draft = r.data.draft;
    assert.ok(draft.items.reduce((n, it) => n + it.estimateHours, 0) <= 1 + 1e-9);
    const key = draft.items[0].key;
    assert.equal((await owner.patch(`/ai/drafts/${draft._id}`, { items: [{ key, estimateHours: 2 }] })).status, 200);
    let denied = await owner.post(`/ai/drafts/${draft._id}/approve`);
    assert.equal(denied.status, 400);
    assert.match(denied.data.error, /giờ/);
    assert.equal(await db.prisma.task.count({ where: { project: pid } }), 0);
    assert.equal((await owner.patch(`/ai/drafts/${draft._id}`, { items: [{ key, estimateHours: draft.items[0].estimateHours, dueDate: '2099-02-16' }] })).status, 200);
    denied = await owner.post(`/ai/drafts/${draft._id}/approve`);
    assert.equal(denied.status, 400);
    assert.match(denied.data.error, /hạn/);
    assert.equal(await db.prisma.task.count({ where: { project: pid } }), 0);
    await owner.patch(`/ai/drafts/${draft._id}`, { items: [{ key, dueDate: draft.items[0].dueDate }] });
    assert.equal((await owner.post(`/ai/drafts/${draft._id}/approve`)).status, 200);
    assert.equal(await db.prisma.task.count({ where: { project: pid } }), draft.items.length);
  });

  test('hạn kế hoạch đã qua không gọi AI; bản nháp không chọn việc không bị đánh dấu đã duyệt', async () => {
    const { owner, ws, pid } = await fixture();
    assert.equal((await owner.post(`/projects/${pid}/ai/plan`, { goal: 'Xây dựng API', deadline: '2000-01-01' })).status, 400);
    assert.equal(await db.prisma.aiDraft.count({ where: { project: pid } }), 0);
    const draft = await db.prisma.aiDraft.create({
      data: { workspace: ws, project: pid, user: seed.users.maianh.id, type: 'plan', items: [{ key: 'empty', title: 'Chưa chọn', selected: false }] },
    });
    assert.equal((await owner.post(`/ai/drafts/${draft.id}/approve`)).status, 400);
    assert.equal((await db.prisma.aiDraft.findUnique({ where: { id: draft.id } })).status, 'draft');
  });
});

describe('Lộc Sprint 1: SMTP, giờ còn lại và xóa mềm', () => {
  test('SMTP thực nhận email register/resend/verify và invite/resend/revoke/accept', async (t) => {
    const { messages } = await smtpSandbox(t, config);
    const client = new Client();
    const email = 'loc.smtp@example.test';
    const beforeOutbox = await db.prisma.outbox.count();
    const registered = await client.post('/auth/register', { name: 'SMTP Test', email, password: DEMO_PASSWORD, acceptTerms: true });
    assert.equal(registered.status, 201, JSON.stringify(registered.data));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].envelope.rcptTo[0].address, email);
    const token = messages[0].raw.match(/verify-email\?token=([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(token, 'SMTP message contains the verification link');
    assert.equal((await client.post('/auth/resend-verification', { email })).status, 200);
    assert.equal(messages.length, 2);
    assert.equal((await client.post('/auth/verify-email', { token })).status, 200);
    assert.equal((await client.post('/auth/verify-email', { token })).status, 400);
    const { owner, ws, pid } = await permissionFixture();
    const invite = await owner.post(`/workspaces/${ws}/invites`, { emails: [email], projects: [pid] });
    assert.equal(invite.status, 201, JSON.stringify(invite.data));
    const oldToken = messages.at(-1).raw.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1];
    const id = invite.data.created[0]._id;
    assert.equal((await owner.post(`/workspaces/${ws}/invites/${id}/resend`)).status, 200);
    const newToken = messages.at(-1).raw.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(newToken && newToken !== oldToken);
    assert.equal((await client.get(`/auth/invite/${oldToken}`)).data.valid, false);
    const wrongUser = owner;
    assert.equal((await wrongUser.post(`/me/invites/${newToken}/accept`)).status, 403);
    assert.equal((await client.post(`/me/invites/${newToken}/accept`)).status, 200);
    assert.equal((await client.post(`/me/invites/${newToken}/accept`)).status, 400);
    const revoked = await owner.post(`/workspaces/${ws}/invites`, { emails: ['revoked.smtp@example.test'] });
    const revokedToken = messages.at(-1).raw.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1];
    assert.equal((await owner.del(`/workspaces/${ws}/invites/${revoked.data.created[0]._id}`)).status, 200);
    assert.equal((await wrongUser.get(`/auth/invite/${revokedToken}`)).data.valid, false);
    assert.equal(await db.prisma.outbox.count(), beforeOutbox, 'SMTP does not persist raw email tokens in the dev outbox');
  });

  test('SMTP lỗi báo lỗi an toàn, có thể gửi lại; recovery không lộ tài khoản', async (t) => {
    const { messages, state } = await smtpSandbox(t, config);
    const client = new Client();
    state.reject = true;
    const email = 'loc.smtp.retry@example.test';
    const failed = await client.post('/auth/register', { name: 'Retry SMTP', email, password: DEMO_PASSWORD, acceptTerms: true });
    assert.equal(failed.status, 503);
    assert.equal(failed.data.details.code, 'MAIL_UNAVAILABLE');
    assert.ok(!JSON.stringify(failed.data).includes('local-test-password'));
    for (const route of ['/auth/resend-verification', '/auth/forgot-password']) {
      const known = await client.post(route, { email });
      const unknown = await client.post(route, { email: 'never-existed@example.test' });
      assert.equal(known.status, 200);
      assert.deepEqual(known.data, unknown.data);
    }
    state.reject = false;
    assert.equal((await client.post('/auth/resend-verification', { email })).status, 200);
    assert.equal(messages.length, 1);
    const token = messages[0].raw.match(/verify-email\?token=([A-Za-z0-9_-]+)/)?.[1];
    assert.equal((await client.post('/auth/verify-email', { token })).status, 200);
    const { sendMail, validateMailConfig } = await import('../src/services/mailer.js');
    config.mail.pass = 'wrong-password';
    await assert.rejects(() => sendMail({ to: email, subject: 'Auth failure', text: 'Test' }), (e) => e.status === 503);
    config.mail.pass = 'local-test-password';
    config.mail.requireTLS = true;
    await assert.rejects(() => sendMail({ to: email, subject: 'TLS required', text: 'Test' }), (e) => e.status === 503);
    assert.equal(messages.length, 1, 'no SMTP success claimed after auth/TLS failures');
    assert.throws(() => validateMailConfig({ mode: 'outbox' }, true), /Production/);
    assert.throws(() => validateMailConfig({ ...config.mail, requireTLS: false }, true), /TLS/);
  });

  test('remainingHours nhận 0/null, kiểm biên/quyền, audit và thống kê dùng số cập nhật', async () => {
    const { owner, member, other, pid, create } = await permissionFixture();
    let task = await create({ title: 'Remaining work', assignee: seed.users.nhu.id, estimateHours: 8, remainingHours: 0, dueDate: new Date().toISOString() });
    assert.equal(task.remainingHours, 0);
    for (const remainingHours of [-1, 1001, '3']) {
      assert.equal((await member.patch(`/tasks/${task._id}`, { remainingHours, version: task.version })).status, 400);
    }
    assert.equal((await other.patch(`/tasks/${task._id}`, { remainingHours: 2, version: task.version })).status, 403);
    let result = await member.patch(`/tasks/${task._id}`, { remainingHours: 2.5, version: task.version });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    task = result.data.task;
    assert.equal((await workload(pid)).find((x) => x.user.id === seed.users.nhu.id).hours, 2.5);
    assert.ok(await db.prisma.activity.findFirst({ where: { entityId: task._id, field: 'remainingHours' } }));
    result = await owner.patch(`/tasks/${task._id}`, { remainingHours: null, version: task.version });
    assert.equal(result.status, 200);
    assert.equal(result.data.task.remainingHours, null);
  });

  test('soft-delete giữ dữ liệu/audit, ẩn mọi luồng, không tái tạo hoặc sửa task đã xóa', async () => {
    const { owner, member, ws, pid, create } = await permissionFixture();
    const parent = await create({ title: 'TombstoneParent', assignee: seed.users.nhu.id, estimateHours: 8, dueDate: new Date().toISOString() });
    const child = await create({ title: 'TombstoneChild', parent: parent._id });
    const dependent = await create({ title: 'Survivor', blockedBy: [parent._id] });
    const comment = await owner.post(`/tasks/${parent._id}/comments`, { body: 'Keep audit content' });
    assert.equal(comment.status, 201);
    const file = await owner.post(`/projects/${pid}/documents`, { name: 'Keep document', content: 'preserve me', task: parent._id });
    assert.equal(file.status, 201, JSON.stringify(file.data));
    assert.equal((await member.del(`/tasks/${parent._id}?confirm=true`)).status, 403);
    assert.equal((await owner.del(`/tasks/${parent._id}`)).status, 409);
    assert.equal((await owner.del(`/tasks/${parent._id}?confirm=true`)).status, 200);
    for (const original of [parent, child]) {
      const stored = await db.prisma.task.findUnique({ where: { id: original._id } });
      assert.ok(stored.deletedAt);
      assert.equal(stored.version, original.version + 1);
      assert.equal((await owner.get(`/tasks/${original._id}`)).status, 404);
      assert.equal((await owner.patch(`/tasks/${original._id}`, { title: 'Revive', version: stored.version })).status, 404);
      assert.equal((await owner.post(`/tasks/${original._id}/move`, { status: 'in_progress', order: 0, version: stored.version })).status, 404);
    }
    assert.equal(await db.prisma.comment.count({ where: { task: parent._id } }), 1);
    assert.equal((await owner.get(`/tasks/${parent._id}/comments`)).status, 404);
    assert.equal((await owner.patch(`/comments/${comment.data.comment._id}`, { body: 'Overwrite' })).status, 404);
    assert.equal((await owner.del(`/tasks/${parent._id}?confirm=true`)).status, 404);
    const audit = await db.prisma.activity.findFirst({ where: { entityId: parent._id, action: 'Xóa công việc' } });
    assert.deepEqual([...audit.after.deletedTaskIds].sort(), [parent._id, child._id].sort());
    assert.equal((await db.prisma.document.findUnique({ where: { id: file.data.document._id } })).task, null);
    assert.equal((await owner.get(`/documents/${file.data.document._id}`)).status, 200);
    const live = (await owner.get(`/projects/${pid}/tasks`)).data.tasks;
    assert.deepEqual(live.map((x) => x._id), [dependent._id]);
    assert.deepEqual(live[0].blockedBy, []);
    assert.equal((await owner.get(`/projects/${pid}/calendar`)).data.tasks.length, 0);
    assert.equal((await member.get(`/workspaces/${ws}/my-tasks`)).data.total, 0);
    assert.equal((await owner.get(`/workspaces/${ws}/search?q=Tombstone`)).data.tasks.length, 0);
    assert.equal((await owner.get(`/workspaces/${ws}/projects`)).data.projects.find((p) => p._id === pid).stats.total, 1);
    assert.equal((await projectOverview(pid)).total, 1);
    const { collectSources } = await import('../src/services/ai/qa.js');
    assert.ok(!(await collectSources(pid)).some((s) => [parent._id, child._id].includes(s.refId)));
    assert.equal((await owner.post(`/projects/${pid}/tasks`, { title: 'Invalid child', parent: parent._id })).status, 400);
    assert.equal((await owner.post(`/tasks/${dependent._id}/dependencies`, { blockedBy: parent._id })).status, 404);
    const { runDueReminders } = await import('../src/services/jobs.js');
    await runDueReminders(new Date(Date.now() + 1000));
    assert.equal(await db.prisma.notification.count({ where: { task: parent._id, type: { in: ['overdue', 'due_soon'] } } }), 0);
    assert.ok(!(await member.get(`/notifications?workspace=${ws}`)).data.items.some((n) => n.task?._id === parent._id));
  });

  test('soft-delete rollback nếu audit thất bại; xóa/sửa đồng thời không phục hồi task', async (t) => {
    const { owner, pid, create } = await permissionFixture();
    const task = await create();
    const txOriginal = db.prisma.$transaction.bind(db.prisma);
    const original = db.prisma.$transaction;
    t.after(() => { db.prisma.$transaction = original; });
    db.prisma.$transaction = (callback, options) => txOriginal(async (tx) => {
      const createMany = tx.activity.createMany.bind(tx.activity);
      tx.activity.createMany = (args) => {
        if (args.data.some((a) => a.action === 'Xóa công việc')) throw new Error('Simulated audit failure');
        return createMany(args);
      };
      return callback(tx);
    }, options);
    assert.equal((await owner.del(`/tasks/${task._id}`)).status, 500);
    db.prisma.$transaction = original;
    assert.equal((await db.prisma.task.findUnique({ where: { id: task._id } })).deletedAt, null);
    const [removed, changed] = await Promise.all([
      owner.del(`/tasks/${task._id}`),
      owner.patch(`/tasks/${task._id}`, { title: 'Concurrent edit', version: task.version }),
    ]);
    assert.equal(removed.status, 200);
    assert.ok([200, 404].includes(changed.status), JSON.stringify(changed.data));
    assert.equal((await owner.get(`/projects/${pid}/tasks`)).data.tasks.length, 0);
  });
});
