// Kiểm thử tích hợp API theo tiêu chí nghiệm thu trong Product Backlog.
// Chạy: npm test  (dùng PostgreSQL nhúng tạm thời + AIService chạy cùng tiến trình, không đụng dữ liệu dev)
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

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

let server;
let base;
let seed;

class Client {
  cookies = {};
  async req(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', 'x-taskflow': '1', cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
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
    return { status: res.status, data };
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
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  server?.close();
  aiServer.close();
  await db.disconnectDb();
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
    const expectedDone = await db.prisma.task.count({ where: { project: pid, parent: null, status: 'done', completedAt: { gte: new Date(from), lte: new Date(`${to}T23:59:59.999`) } } });
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
