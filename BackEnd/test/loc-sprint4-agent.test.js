// Lộc Sprint 4 (U030-T3): token agent là một loại thông tin đăng nhập, phải bị thu hồi cùng lúc với phiên đăng nhập
// khi đặt lại/đổi mật khẩu, khi System Admin khóa hoặc buộc đăng xuất. Đăng xuất thường không thu hồi token.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.MAIL_MODE = 'outbox';
process.env.DATABASE_URL = '';
process.env.GEMINI_API_KEY = '';

const { createApp } = await import('../src/app.js');
const { seedDemo, DEMO_PASSWORD } = await import('../src/seed.js');
const db = await import('../src/db.js');

let server, base, seed, admin, pid, templateHash, sequence = 0;

class Client {
  cookies = {};
  bearer = null;
  async req(method, url, body) {
    const headers = { 'content-type': 'application/json', 'x-taskflow': '1', cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      this.cookies[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return { status: res.status, data: await res.json().catch(() => null) };
  }
}
const login = async (email, password = DEMO_PASSWORD) => {
  const client = new Client();
  const r = await client.req('POST', '/api/auth/login', { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return client;
};
const agent = (token) => Object.assign(new Client(), { bearer: token });

/** Người dùng riêng cho mỗi ca để đổi mật khẩu không ảnh hưởng ca khác; là Member của dự án mẫu. */
async function person() {
  const email = `agent.revoke.${++sequence}@example.test`;
  const user = await db.prisma.user.create({ data: { name: `Thu hồi ${sequence}`, email, passwordHash: templateHash, emailVerified: true } });
  const project = await db.prisma.project.findUnique({ where: { id: pid } });
  await db.prisma.membership.create({ data: { workspace: project.workspace, user: user.id, role: 'member' } });
  await db.prisma.projectMember.create({ data: { project: pid, user: user.id, role: 'member' } });
  await db.prisma.project.update({ where: { id: pid }, data: { members: { push: user.id } } });
  const client = await login(email);
  const { status, data } = await client.req('POST', '/api/agent-tokens', { name: 'Runner trên laptop', days: 90 });
  assert.equal(status, 201);
  assert.equal((await agent(data.token).req('GET', '/api/mcp/me')).status, 200, 'token mới phải dùng được');
  return { user, email, client, token: data.token };
}
const tokenStatus = async (token) => (await agent(token).req('GET', '/api/mcp/projects')).status;
const queuedJob = (user) => db.prisma.agentJob.create({ data: { workspace: seed.workspace.id, project: pid, user: user.id, kind: 'qa', agent: 'claude', input: { question: 'Còn việc nào?' } } });
const lastMail = (to) => db.prisma.outbox.findFirst({ where: { to }, orderBy: { createdAt: 'desc' } });

before(async () => {
  await db.connectDb({ ephemeral: true });
  seed = await seedDemo();
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  pid = seed.projects.website.id;
  templateHash = (await db.prisma.user.findFirst({ where: { email: 'nhu@nhom24.edu.vn' }, omit: { passwordHash: false } })).passwordHash;
  admin = await login('admin@taskflow.local');
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.disconnectDb();
});

describe('Lộc Sprint 4: thu hồi token agent cùng phiên đăng nhập', () => {
  test('đặt lại mật khẩu bằng liên kết thu hồi token và hủy việc agent đang chờ', async () => {
    const p = await person();
    const job = await queuedJob(p.user);
    assert.equal((await new Client().req('POST', '/api/auth/forgot-password', { email: p.email })).status, 200);
    const raw = new URL((await lastMail(p.email)).link).searchParams.get('token');
    assert.equal((await new Client().req('POST', '/api/auth/reset-password', { token: raw, password: 'MatKhauMoi2026' })).status, 200);
    assert.equal(await tokenStatus(p.token), 401);
    assert.equal((await db.prisma.agentJob.findUnique({ where: { id: job.id } })).status, 'cancelled');
  });

  test('đặt lại mật khẩu bằng OTP thu hồi token', async () => {
    const p = await person();
    await new Client().req('POST', '/api/auth/forgot-password', { email: p.email });
    const code = /(\d{6})/.exec((await lastMail(p.email)).text)[1];
    assert.equal((await new Client().req('POST', '/api/auth/reset-password-otp', { email: p.email, code, password: 'MatKhauMoi2026' })).status, 200);
    assert.equal(await tokenStatus(p.token), 401);
  });

  test('đổi mật khẩu khi đang đăng nhập thu hồi token; phiên hiện tại vẫn dùng được', async () => {
    const p = await person();
    assert.equal((await p.client.req('POST', '/api/me/password', { currentPassword: DEMO_PASSWORD, newPassword: 'MatKhauMoi2026' })).status, 200);
    assert.equal(await tokenStatus(p.token), 401);
    assert.equal((await p.client.req('GET', '/api/me')).status, 200);
    const fresh = await p.client.req('POST', '/api/agent-tokens', { name: 'Token sau khi đổi mật khẩu', days: 7 });
    assert.equal(await tokenStatus(fresh.data.token), 200, 'tạo lại token mới thì dùng được');
  });

  test('System Admin khóa tài khoản: token bị thu hồi, mở khóa cũng không sống lại', async () => {
    const p = await person();
    const job = await queuedJob(p.user);
    assert.equal((await admin.req('POST', `/api/admin/users/${p.user.id}/lock`, { reason: 'Khác', note: 'Kiểm thu hồi token' })).status, 200);
    assert.equal(await tokenStatus(p.token), 401);
    assert.equal((await admin.req('POST', `/api/admin/users/${p.user.id}/unlock`)).status, 200);
    assert.equal(await tokenStatus(p.token), 401, 'giống phiên đăng nhập: mở khóa không làm token cũ có hiệu lực lại');
    assert.equal((await db.prisma.agentJob.findUnique({ where: { id: job.id } })).status, 'cancelled');
  });

  test('System Admin buộc đăng xuất: token bị thu hồi', async () => {
    const p = await person();
    assert.equal((await admin.req('POST', `/api/admin/users/${p.user.id}/logout`)).status, 200);
    assert.equal(await tokenStatus(p.token), 401);
    assert.equal((await p.client.req('GET', '/api/me')).status, 401);
  });

  test('đăng xuất thường trên một trình duyệt không thu hồi token agent', async () => {
    const p = await person();
    assert.equal((await p.client.req('POST', '/api/auth/logout')).status, 200);
    assert.equal(await tokenStatus(p.token), 200);
  });

  test('thu hồi không đụng token của người khác', async () => {
    const a = await person();
    const b = await person();
    await admin.req('POST', `/api/admin/users/${a.user.id}/logout`);
    assert.equal(await tokenStatus(a.token), 401);
    assert.equal(await tokenStatus(b.token), 200);
  });
});
