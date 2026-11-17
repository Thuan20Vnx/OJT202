// Xóa workspace hẹn 24 giờ (chỉ đọc, thông báo, hủy, job xóa), chặn Hoàn thành khi việc chặn chưa xong,
// token agent của Viewer/Giảng viên: chỉ đọc + hỏi đáp riêng.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.MAIL_MODE = 'outbox';
process.env.GEMINI_API_KEY = '';
process.env.PG_EMBEDDED_PORT = '54345';

const db = await import('../src/db.js');
const { createApp } = await import('../src/app.ts');
const { runWorkspaceDeletions, DELETION_DELAY_MS } = await import('../src/services/workspace-deletion.js');

let server;
let base;
const PASSWORD = 'Matkhau123';

class Client {
  cookies = {};
  bearer = null;
  async req(method, path, body) {
    const headers = { 'content-type': 'application/json', 'x-taskflow': '1', cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    const res = await fetch(`${base}/api${path}`, { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      this.cookies[pair.slice(0, i)] = pair.slice(i + 1);
    }
    return { status: res.status, data: await res.json().catch(() => null) };
  }
  get = (p) => this.req('GET', p);
  post = (p, b = {}) => this.req('POST', p, b);
  patch = (p, b) => this.req('PATCH', p, b);
  del = (p) => this.req('DELETE', p);
}

let seq = 0;
async function user(name) {
  const email = `${name.toLowerCase()}${++seq}@xoa.test`;
  const c = new Client();
  assert.equal((await c.post('/auth/register', { name, email, password: PASSWORD, acceptTerms: true })).status, 201);
  await db.prisma.user.update({ where: { email }, data: { emailVerified: true } });
  assert.equal((await c.post('/auth/login', { email, password: PASSWORD })).status, 200);
  c.email = email;
  c.id = (await c.get('/me')).data.user._id;
  return c;
}

/** Owner + Admin + Member + Viewer + Giảng viên, cùng một dự án. */
async function team() {
  const owner = await user('Owner');
  const ws = (await owner.post('/workspaces', { name: `Nhóm xóa ${++seq}` })).data.workspace;
  const roles = { admin: ['admin', false], member: ['member', false], viewer: ['viewer', false], mentor: ['viewer', true] };
  const people = {};
  for (const [key, [role, isMentor]] of Object.entries(roles)) {
    const c = await user(key);
    await db.prisma.membership.create({ data: { workspace: ws._id, user: c.id, role, isMentor } });
    people[key] = c;
  }
  const members = Object.values(people).map((p) => p.id);
  const project = (await owner.post(`/workspaces/${ws._id}/projects`, { name: 'Đồ án', members })).data.project;
  return { owner, ws, project, ...people };
}

before(async () => {
  await db.connectDb({ ephemeral: true });
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.disconnectDb();
});

describe('Hoàn thành khi còn việc chặn', () => {
  test('server chặn chuyển sang Hoàn thành và nêu việc đang chờ; xong việc chặn thì cho qua', async () => {
    const { owner, project } = await team();
    const a = (await owner.post(`/projects/${project._id}/tasks`, { title: 'Thiết kế database' })).data.task;
    const b = (await owner.post(`/projects/${project._id}/tasks`, { title: 'Viết API', blockedBy: [a._id], status: 'review' })).data.task;
    const blocked = await owner.patch(`/tasks/${b._id}`, { status: 'done', version: b.version });
    assert.equal(blocked.status, 400);
    assert.match(blocked.data.error, new RegExp(`đang chờ ${a.key} Thiết kế database`));
    // Kéo thả trên bảng cũng bị chặn
    assert.equal((await owner.post(`/tasks/${b._id}/move`, { status: 'done', order: 1, version: b.version })).status, 400);
    // Tạo sẵn ở Hoàn thành mà còn việc chặn cũng không được
    assert.equal((await owner.post(`/projects/${project._id}/tasks`, { title: 'Kiểm thử', blockedBy: [a._id], status: 'done' })).status, 400);

    const ar = (await owner.patch(`/tasks/${a._id}`, { status: 'review', version: a.version })).data.task;
    assert.equal((await owner.patch(`/tasks/${a._id}`, { status: 'done', version: ar.version })).status, 200);
    const done = await owner.patch(`/tasks/${b._id}`, { status: 'done', version: b.version });
    assert.equal(done.status, 200);
    assert.equal(done.data.task.status, 'done');
  });
});

describe('Xóa workspace hẹn 24 giờ', () => {
  test('chỉ Owner, phải gõ đúng tên; báo Owner/Admin/Member, không báo Viewer/Giảng viên', async () => {
    const t = await team();
    const url = `/workspaces/${t.ws._id}/deletion`;
    assert.equal((await t.admin.post(url, { name: t.ws.name })).status, 403);
    assert.equal((await t.owner.post(url, { name: 'sai tên' })).status, 400);
    const before = Date.now();
    const r = await t.owner.post(url, { name: t.ws.name });
    assert.equal(r.status, 200);
    const at = new Date(r.data.workspace.deletionScheduledAt).getTime();
    assert.ok(Math.abs(at - before - DELETION_DELAY_MS) < 60000, 'hẹn sau 24 giờ');
    assert.equal((await t.owner.post(url, { name: t.ws.name })).status, 409);

    const notified = await db.prisma.notification.findMany({ where: { workspace: t.ws._id, type: 'workspace' }, select: { user: true } });
    assert.deepEqual(new Set(notified.map((n) => n.user)), new Set([t.owner.id, t.admin.id, t.member.id]));
    const mails = await db.prisma.outbox.findMany({ where: { subject: { contains: t.ws.name } } });
    assert.deepEqual(new Set(mails.map((m) => m.to)), new Set([t.owner.email, t.admin.email, t.member.email]));
  });

  test('trong 24 giờ chờ: chỉ đọc với mọi người, Owner hủy được và mọi thứ trở lại bình thường', async () => {
    const t = await team();
    const task = (await t.owner.post(`/projects/${t.project._id}/tasks`, { title: 'Việc cũ', assignee: t.member.id })).data.task;
    assert.equal((await t.owner.post(`/workspaces/${t.ws._id}/deletion`, { name: t.ws.name })).status, 200);

    // Đọc và tải về vẫn được
    assert.equal((await t.member.get(`/projects/${t.project._id}/tasks`)).status, 200);
    assert.equal((await t.viewer.get(`/tasks/${task._id}`)).status, 200);
    const info = (await t.member.get(`/projects/${t.project._id}`)).data;
    assert.equal(info.access.canWrite, false);
    assert.equal(info.access.pendingDeletion, true);

    // Mọi thao tác ghi đều bị chặn với thông báo rõ ràng, kể cả Owner
    const blocked = [
      await t.owner.post(`/projects/${t.project._id}/tasks`, { title: 'Việc mới' }),
      await t.member.patch(`/tasks/${task._id}`, { status: 'in_progress', version: task.version }),
      await t.member.post(`/tasks/${task._id}/comments`, { body: 'Bình luận' }),
      await t.owner.patch(`/workspaces/${t.ws._id}`, { name: 'Đổi tên' }),
      await t.admin.post(`/workspaces/${t.ws._id}/invites`, { email: 'moi@xoa.test', role: 'member' }),
      await t.owner.post(`/workspaces/${t.ws._id}/projects`, { name: 'Dự án mới' }),
      await t.owner.post(`/projects/${t.project._id}/archive`),
    ];
    for (const r of blocked) {
      assert.equal(r.status, 403);
      assert.match(r.data.error, /đang chờ xóa/);
    }

    assert.equal((await t.admin.del(`/workspaces/${t.ws._id}/deletion`)).status, 403);
    const cancelled = await t.owner.del(`/workspaces/${t.ws._id}/deletion`);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.workspace.deletionScheduledAt, null);
    assert.equal((await t.owner.post(`/projects/${t.project._id}/tasks`, { title: 'Việc mới' })).status, 201);
    assert.ok(await db.prisma.notification.findFirst({ where: { user: t.member.id, type: 'workspace', text: { contains: 'đã hủy' } } }));
    assert.equal((await t.owner.del(`/workspaces/${t.ws._id}/deletion`)).status, 409);
  });

  test('job nhắc trước 1 giờ (không gửi trùng) rồi xóa hẳn khi tới hạn', async () => {
    const t = await team();
    await t.owner.post(`/projects/${t.project._id}/tasks`, { title: 'Việc sẽ mất' });
    const at = new Date((await t.owner.post(`/workspaces/${t.ws._id}/deletion`, { name: t.ws.name })).data.workspace.deletionScheduledAt);

    assert.deepEqual(await runWorkspaceDeletions(new Date(at.getTime() - 3 * 3600000)), { reminded: 0, deleted: 0 });
    const soon = new Date(at.getTime() - 30 * 60000);
    await runWorkspaceDeletions(soon);
    await runWorkspaceDeletions(soon);
    const reminders = await db.prisma.notification.findMany({ where: { workspace: t.ws._id, dedupeKey: { startsWith: 'workspace-deletion:reminder' } } });
    assert.equal(reminders.length, 3, 'mỗi người một lần nhắc');
    assert.ok(await db.prisma.workspace.findUnique({ where: { id: t.ws._id } }), 'chưa tới hạn thì chưa xóa');

    const result = await runWorkspaceDeletions(new Date(at.getTime() + 60000));
    assert.equal(result.deleted >= 1, true);
    assert.equal(await db.prisma.workspace.findUnique({ where: { id: t.ws._id } }), null);
    assert.equal(await db.prisma.task.count({ where: { project: t.project._id } }), 0);
    assert.equal((await t.member.get(`/workspaces/${t.ws._id}`)).status, 404);
    // Người dùng vẫn còn, chỉ workspace mất; có email báo đã xóa
    assert.equal((await t.member.get('/me')).status, 200);
    assert.ok(await db.prisma.outbox.findFirst({ where: { to: t.member.email, subject: { contains: 'đã bị xóa' } } }));
    assert.equal(await db.prisma.outbox.count({ where: { to: t.viewer.email, subject: { contains: t.ws.name } } }), 0);
  });

  test('Owner hủy đúng lúc job chạy thì không xóa', async () => {
    const t = await team();
    const at = new Date((await t.owner.post(`/workspaces/${t.ws._id}/deletion`, { name: t.ws.name })).data.workspace.deletionScheduledAt);
    await t.owner.del(`/workspaces/${t.ws._id}/deletion`);
    await runWorkspaceDeletions(new Date(at.getTime() + 60000));
    assert.ok(await db.prisma.workspace.findUnique({ where: { id: t.ws._id } }));
  });
});

describe('Token agent của Viewer / Giảng viên', () => {
  test('chỉ đọc + hỏi đáp riêng; các thao tác ghi bị chặn', async () => {
    const t = await team();
    const task = (await t.owner.post(`/projects/${t.project._id}/tasks`, { title: 'Trang đăng nhập' })).data.task;
    for (const person of [t.viewer, t.mentor]) {
      const created = await person.post('/agent-tokens', { name: 'Laptop', days: 7 });
      assert.equal(created.status, 201);
      assert.equal(created.data.access.readOnly, true);
      assert.equal((await person.get('/agent-tokens')).data.access.readOnly, true);
      const agent = new Client();
      agent.bearer = created.data.token;
      assert.equal((await agent.get('/mcp/me')).data.token.readOnly, true);
      const projects = (await agent.get('/mcp/projects')).data.projects;
      assert.equal(projects.find((p) => p.projectId === t.project._id).access, 'read_only');
      // Đọc được
      assert.equal((await agent.get(`/mcp/projects/${t.project._id}/tasks`)).status, 200);
      assert.equal((await agent.get(`/mcp/projects/${t.project._id}/search?q=${task.key}`)).status, 200);
      // Hỏi đáp: lưu vào lịch sử của chính người hỏi
      const saved = await agent.post(`/mcp/projects/${t.project._id}/answers`, { question: 'Việc nào đang mở?', answer: 'Chưa ghi nhận.', agent: 'Claude Code' });
      assert.equal(saved.status, 201, JSON.stringify(saved.data));
      const conv = await db.prisma.aiConversation.findUnique({ where: { id: saved.data.conversationId } });
      assert.equal(conv.user, person.id);
      // Giao việc hỏi đáp từ web cho agent trên máy (runner đang bật)
      assert.equal((await agent.post('/mcp/runner/poll', { agents: ['claude'], claim: false })).status, 200);
      const job = await person.post(`/projects/${t.project._id}/agent/jobs`, { kind: 'qa', agent: 'claude', input: { question: 'Việc nào quá hạn?' } });
      assert.equal(job.status, 201, JSON.stringify(job.data));
      // Ghi: bị chặn
      assert.equal((await agent.post(`/mcp/projects/${t.project._id}/tasks/complete`, { tasks: [{ taskId: task.key, evidence: 'src/login.js có form đăng nhập' }] })).status, 403);
      assert.equal((await agent.post(`/mcp/projects/${t.project._id}/reports`, { kind: 'review', title: 'Review', summary: 'Ổn', items: [] })).status, 403);
      assert.equal((await agent.post(`/mcp/projects/${t.project._id}/plans`, { goal: 'Làm trang thanh toán', tasks: [] })).status, 403);
      assert.equal((await person.post(`/projects/${t.project._id}/agent/jobs`, { kind: 'plan', agent: 'claude', input: { goal: 'Làm trang thanh toán' } })).status, 403);
    }
    // Member vẫn là token thường
    assert.equal((await t.member.post('/agent-tokens', { name: 'Máy', days: 7 })).data.access.readOnly, false);
    const other = (await t.owner.get(`/projects/${t.project._id}/tasks`)).data.tasks.find((x) => x._id === task._id);
    assert.equal(other.status, 'todo', 'token chỉ đọc không đổi được trạng thái');
  });
});
