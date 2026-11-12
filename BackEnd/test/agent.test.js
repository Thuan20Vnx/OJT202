// Agent: repo chỉ đọc metadata, gợi ý hằng ngày tra MCP Registry + npm (server giả), MCP API dùng token agent.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.MAIL_MODE = 'outbox';
process.env.DATABASE_URL = '';
process.env.GEMINI_API_KEY = '';
process.env.REPO_ALLOW_PRIVATE_HOST = 'true';

const SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const hits = [];
const now = Date.now();
const iso = (days) => new Date(now - days * 86400000).toISOString();
let taskKeys = {};

function githubRoute(path) {
  if (path === '/repos/acme/app') return { default_branch: 'main', private: true, html_url: 'https://github.com/acme/app', description: 'Ứng dụng quản lý', topics: ['postgres', 'websocket'] };
  if (path === '/repos/acme/app/languages') return { JavaScript: 1000, TypeScript: 200 };
  if (path.startsWith('/repos/acme/app/commits')) return [{ sha: 'a1', commit: { message: `${taskKeys.todo} bắt đầu làm`, author: { name: 'An', date: iso(1) } }, html_url: 'https://github.com/acme/app/commit/a1' }];
  if (path.startsWith('/repos/acme/app/pulls')) return [{ number: 7, title: 'Đăng nhập', body: '', user: { login: 'an' }, state: 'open', head: { ref: 'feat' }, base: { ref: 'main' }, html_url: 'https://github.com/acme/app/pull/7', updated_at: iso(5) }];
  return null;
}
function gitlabRoute(path) {
  const base = `/api/v4/projects/${encodeURIComponent('group/sub/app')}`;
  if (path === base) return { default_branch: 'develop', visibility: 'private', web_url: 'https://gitlab.example/group/sub/app' };
  return null;
}
function catalogRoute(path) {
  const q = new URL(path, 'http://x').searchParams;
  if (path.startsWith('/registry/v0/servers')) return { servers: [{ server: { name: `io.example/${q.get('search')}-mcp`, description: `MCP cho ${q.get('search')}`, websiteUrl: `https://mcp.example/${encodeURIComponent(q.get('search'))}` } }] };
  if (path.startsWith('/npm/search')) return { objects: [{ package: { name: `${q.get('text')}-kit`.replace(/\s+/g, '-'), description: 'Thư viện', links: { npm: `https://www.npmjs.com/package/${encodeURIComponent(q.get('text'))}-kit` } } }] };
  return null;
}
const fake = http.createServer((req, res) => {
  hits.push({ url: req.url, auth: req.headers.authorization });
  const catalog = req.url.startsWith('/registry') || req.url.startsWith('/npm');
  const body = req.url.startsWith('/api/v4') ? gitlabRoute(req.url) : catalog ? catalogRoute(req.url) : githubRoute(req.url);
  res.statusCode = body ? 200 : 404;
  res.end(JSON.stringify(body ?? {}));
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const fakeOrigin = `http://127.0.0.1:${fake.address().port}`;
process.env.GITHUB_API_URL = fakeOrigin;
process.env.MCP_REGISTRY_URL = `${fakeOrigin}/registry`;
process.env.NPM_SEARCH_URL = `${fakeOrigin}/npm/search`;

const { createApp: createAiApp } = await import('../../AIService/src/app.js');
const aiServer = http.createServer(createAiApp());
await new Promise((r) => aiServer.listen(0, r));
process.env.AI_SERVICE_URL = `http://127.0.0.1:${aiServer.address().port}`;

const { createApp } = await import('../src/app.js');
const { seedDemo, DEMO_PASSWORD } = await import('../src/seed.js');
const db = await import('../src/db.js');
const { config } = await import('../src/config.js');
const { runDailySuggestions } = await import('../src/services/repo/agent.js');
const { validateAiResult, validateAgentReport } = await import('../src/services/ai/contracts.js');

let server, base, seed, pm, member, outsider, pid;

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
const login = async (email) => {
  const client = new Client();
  assert.equal((await client.req('POST', '/api/auth/login', { email, password: DEMO_PASSWORD })).status, 200);
  return client;
};
const agentClient = (token) => Object.assign(new Client(), { bearer: token });
const connect = (client = pm, body = {}) => client.req('PUT', `/api/projects/${pid}/repo`, { provider: 'github', url: 'https://github.com/acme/app', ...body });
const reset = () => db.prisma.agentRun.deleteMany({ where: { project: pid } });

before(async () => {
  await db.connectDb({ ephemeral: true });
  seed = await seedDemo();
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  pid = seed.projects.website.id;
  const members = await db.prisma.projectMember.findMany({ where: { project: pid }, include: { userRef: { select: { email: true, id: true } } } });
  pm = await login(members.find((m) => m.role === 'pm').userRef.email);
  member = await login(members.find((m) => m.role !== 'pm' && m.role !== 'viewer').userRef.email);
  // Người ngoài dự án: dùng chung mật khẩu demo (sao chép hash) để đăng nhập được.
  const demo = await db.prisma.user.findFirst({ where: { id: members[0].userRef.id }, omit: { passwordHash: false } });
  const stranger = await db.prisma.user.create({ data: { name: 'Người ngoài', email: 'nguoi.ngoai@example.test', passwordHash: demo.passwordHash, emailVerified: true } });
  outsider = await login(stranger.email);
  const tasks = await db.prisma.task.findMany({ where: { project: pid, deletedAt: null }, select: { key: true, status: true } });
  taskKeys = { todo: tasks.find((t) => t.status === 'todo').key, done: tasks.find((t) => t.status === 'done').key };
});
after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => aiServer.close(r));
  await new Promise((r) => fake.close(r));
  await db.disconnectDb();
});

describe('Kết nối repo (chỉ metadata)', () => {
  test('chỉ PM kết nối được; token repo được mã hóa và không trả về client', async () => {
    assert.equal((await connect(member, { token: 'tok-1' })).status, 403);
    const r = await connect(pm, { token: 'tok-secret-1' });
    assert.equal(r.status, 200);
    assert.equal(r.data.connection.hasToken, true);
    assert.ok(!JSON.stringify(r.data).includes('tok-secret-1'));
    const row = await db.prisma.repoConnection.findUnique({ where: { project: pid } });
    assert.ok(row.tokenEnc && !row.tokenEnc.includes('tok-secret-1'));
    assert.equal(hits.at(-1).auth, 'Bearer tok-secret-1');
  });

  test('đổi repo mà không nhập token mới thì bỏ token cũ', async () => {
    await connect(pm, { token: 'tok-secret-1' });
    const gitlab = await connect(pm, { provider: 'gitlab', url: `${fakeOrigin}/group/sub/app` });
    assert.equal(gitlab.status, 200);
    assert.equal(gitlab.data.connection.hasToken, false);
    assert.equal(gitlab.data.connection.defaultBranch, 'develop');
  });

  test('từ chối URL có thông tin đăng nhập, sai máy chủ và địa chỉ nội bộ', async () => {
    assert.equal((await connect(pm, { url: 'https://user:pw@github.com/acme/app' })).status, 400);
    assert.equal((await connect(pm, { url: 'https://evil.example/acme/app' })).status, 400);
    config.repo.allowPrivateHosts = false;
    try {
      assert.equal((await connect(pm, { provider: 'gitlab', url: 'https://127.0.0.1/group/app' })).status, 400);
      assert.equal((await connect(pm, { provider: 'gitlab', url: 'https://169.254.169.254/latest/meta' })).status, 400);
    } finally {
      config.repo.allowPrivateHosts = true;
    }
  });

  test('server không còn đọc code: review và quét bảo mật phía server đã bỏ', async () => {
    await connect(pm, { token: 'tok-secret-1' });
    assert.equal((await pm.req('POST', `/api/projects/${pid}/agent/review`, { number: 7 })).status, 404);
    assert.equal((await pm.req('POST', `/api/projects/${pid}/agent/security`, {})).status, 404);
    const before = hits.length;
    await pm.req('GET', `/api/projects/${pid}/repo/progress`);
    assert.ok(!hits.slice(before).some((h) => /contents|git\/trees|readme|\/files/.test(h.url)), 'chỉ được gọi API metadata');
  });

  test('chỉ ra chỗ bảng công việc lệch với repo', async () => {
    const r = await member.req('GET', `/api/projects/${pid}/repo/progress`);
    assert.equal(r.status, 200);
    assert.equal(r.data.progress.linkedCommits, 1);
    assert.ok(r.data.progress.todoWithCode.some((t) => t.key === taskKeys.todo));
    assert.equal(r.data.progress.stalePulls[0].number, 7);
  });
});

describe('Gợi ý skill, plugin, công cụ hằng ngày', () => {
  test('PM chỉnh giờ và bật tắt; thành viên không chỉnh được; giờ phải hợp lệ', async () => {
    assert.equal((await member.req('PATCH', `/api/projects/${pid}/agent/settings`, { daily: true })).status, 403);
    assert.equal((await pm.req('PATCH', `/api/projects/${pid}/agent/settings`, { dailyTime: '25:00' })).status, 400);
    const r = await pm.req('PATCH', `/api/projects/${pid}/agent/settings`, { daily: true, dailyTime: '09:30' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.data.settings.daily, r.data.settings.dailyTime], [true, '09:30']);
  });

  test('chạy thủ công: ứng viên lấy từ MCP Registry và npm, link đều có thật', async () => {
    const before = hits.length;
    const r = await pm.req('POST', `/api/projects/${pid}/agent/suggest`, {});
    assert.equal(r.status, 201);
    const urls = r.data.run.items.map((i) => i.url);
    assert.ok(urls.length > 0);
    assert.ok(urls.every((u) => u.startsWith('https://mcp.example/') || u.startsWith('https://www.npmjs.com/')));
    const searched = hits.slice(before).map((h) => h.url);
    assert.ok(searched.some((u) => u.startsWith('/registry/v0/servers')) && searched.some((u) => u.startsWith('/npm/search')));
    assert.ok(!searched.some((u) => /contents|readme|git\/trees/.test(u)), 'không đọc code');
    await reset();
  });

  test('chạy theo giờ đã đặt, mỗi ngày một lần kể cả hai server chạy cùng lúc', async () => {
    await db.prisma.notification.deleteMany({ where: { type: 'agent' } });
    const early = new Date('2026-11-09T02:00:00Z'); // 9:00 tại Việt Nam, trước 09:30
    assert.equal((await runDailySuggestions(early)).ran, 0);
    const later = new Date('2026-11-09T03:00:00Z'); // 10:00
    const results = await Promise.all([runDailySuggestions(later), runDailySuggestions(later)]);
    assert.equal(results.reduce((sum, r) => sum + r.ran, 0), 1);
    const runs = await db.prisma.agentRun.findMany({ where: { project: pid, kind: 'suggest' } });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'done', runs[0].error ?? '');
    assert.equal(await db.prisma.notification.count({ where: { type: 'agent', project: pid } }), 1);
    await reset();
  });

  test('tắt thì không chạy; không gợi ý lại việc đã có', async () => {
    await pm.req('PATCH', `/api/projects/${pid}/agent/settings`, { daily: false });
    assert.equal((await runDailySuggestions(new Date('2026-11-10T05:00:00Z'))).ran, 0);
    const first = await pm.req('POST', `/api/projects/${pid}/agent/suggest`, {});
    const second = await pm.req('POST', `/api/projects/${pid}/agent/suggest`, {});
    const titles = new Set(first.data.run.items.map((i) => i.title));
    assert.ok(!second.data.run.items.some((i) => titles.has(i.title)));
    await reset();
  });

  test('bỏ gợi ý có link không nằm trong danh sách ứng viên', () => {
    const candidates = [{ name: 'a', description: '', url: 'https://www.npmjs.com/package/a', source: 'npm' }];
    const parsed = validateAiResult('suggest', { summary: 'ok', suggestions: [
      { title: 'Dùng a', kind: 'library', detail: 'x', url: 'https://www.npmjs.com/package/a' },
      { title: 'Dùng b tự nghĩ ra', kind: 'library', detail: 'x', url: 'https://b.example' },
    ] }, { stage: 'pick', candidates });
    assert.deepEqual(parsed.suggestions.map((s) => s.title), ['Dùng a']);
  });
});

describe('Token và MCP API cho agent trên máy', () => {
  let token;
  test('token chỉ hiện một lần, database chỉ giữ hash', async () => {
    assert.equal((await pm.req('POST', '/api/agent-tokens', { name: 'Claude Code', days: 365 })).status, 400);
    const r = await pm.req('POST', '/api/agent-tokens', { name: 'Claude Code', days: 30 });
    assert.equal(r.status, 201);
    token = r.data.token;
    assert.match(token, /^tfp_/);
    assert.ok(r.data.mcp.serverPath.endsWith('index.js'));
    const list = await pm.req('GET', '/api/agent-tokens');
    assert.ok(!JSON.stringify(list.data).includes(token));
    const row = await db.prisma.agentToken.findFirst({ where: { name: 'Claude Code' } });
    assert.ok(!row.tokenHash.includes(token.slice(4)));
  });

  test('token chỉ dùng được cho MCP API, không thay được đăng nhập', async () => {
    const agent = agentClient(token);
    assert.equal((await agent.req('GET', '/api/mcp/projects')).status, 200);
    assert.equal((await agent.req('GET', `/api/projects/${pid}/repo`)).status, 401);
    const unknown = await agent.req('POST', '/api/mcp/khong-co', {});
    assert.deepEqual([unknown.status, unknown.data.error], [404, 'Không tìm thấy API cho agent'], 'không rơi xuống route cần đăng nhập');
    assert.equal((await agentClient('tfp_sai').req('GET', '/api/mcp/projects')).status, 401);
    assert.equal((await new Client().req('GET', '/api/mcp/projects')).status, 401);
  });

  test('agent đọc dự án và công việc theo đúng quyền của người tạo token', async () => {
    const agent = agentClient(token);
    const projects = await agent.req('GET', '/api/mcp/projects');
    assert.ok(projects.data.projects.some((p) => p.projectId === pid));
    const tasks = await agent.req('GET', `/api/mcp/projects/${pid}/tasks?status=todo`);
    assert.ok(tasks.data.tasks.length > 0 && tasks.data.tasks.every((t) => t.status === 'todo'));
    const detail = await agent.req('GET', `/api/mcp/projects/${pid}/tasks/${taskKeys.todo}`);
    assert.equal(detail.data.task.key, taskKeys.todo);
    const { data } = await outsider.req('POST', '/api/agent-tokens', { name: 'Người ngoài', days: 7 });
    assert.equal((await agentClient(data.token).req('GET', `/api/mcp/projects/${pid}/tasks`)).status, 404);
  });

  test('báo cáo từ agent vào tab Agent, che bí mật, PM duyệt mới thành việc', async () => {
    const agent = agentClient(token);
    const r = await agent.req('POST', `/api/mcp/projects/${pid}/reports`, {
      kind: 'security', title: 'Quét bảo mật', summary: 'Đã đọc toàn bộ repo', agent: 'Claude Code',
      items: [
        { title: 'Lộ token', severity: 'critical', file: 'src/a.js', line: 3, detail: `Token ${SECRET} viết thẳng trong code` },
        { title: '', detail: 'thiếu tiêu đề' },
      ],
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.dropped, 1);
    const run = await db.prisma.agentRun.findUnique({ where: { id: r.data.run._id } });
    assert.deepEqual([run.source, run.agentName, run.items[0].severity], ['mcp', 'Claude Code', 'high']);
    assert.ok(!JSON.stringify(run).includes(SECRET), 'không lưu giá trị bí mật');
    const url = `/api/agent/runs/${run.id}/items/${run.items[0].key}/accept`;
    assert.equal((await member.req('POST', url)).status, 403);
    assert.equal((await pm.req('POST', url)).status, 200);
    const task = await db.prisma.task.findFirst({ where: { aiDraftItem: `agent:${run.id}:${run.items[0].key}` } });
    assert.match(task.description, /Claude Code/);
    await reset();
  });

  test('hỏi đáp: tổng quan và tìm kiếm dùng đúng nguồn của dự án', async () => {
    const agent = agentClient(token);
    const overview = (await agent.req('GET', `/api/mcp/projects/${pid}/overview`)).data;
    assert.equal(overview.project.projectId, pid);
    assert.ok(overview.members.length > 0 && overview.members.every((m) => m.memberId && m.name));
    assert.deepEqual(overview.you, { canWrite: true, canManage: true });
    const { todo, in_progress: doing, review, done } = overview.tasks;
    assert.equal(todo + doing + review + done, await db.prisma.task.count({ where: { project: pid, deletedAt: null } }));
    const found = (await agent.req('GET', `/api/mcp/projects/${pid}/search?q=${taskKeys.todo}`)).data;
    assert.equal(found.results[0].key, taskKeys.todo);
    const none = (await agent.req('GET', `/api/mcp/projects/${pid}/search?q=zzzkhongcogi`)).data;
    assert.deepEqual(none.results, []);
    assert.match(none.note, /không tự suy đoán/);
    const other = await db.prisma.task.findFirst({ where: { project: { not: pid }, deletedAt: null } });
    const leaked = (await agent.req('GET', `/api/mcp/projects/${pid}/search?q=${other.key}`)).data.results;
    assert.ok(leaked.every((r) => r.key !== other.key), 'không trả dữ liệu của dự án khác');
    const { data } = await outsider.req('POST', '/api/agent-tokens', { name: 'Ngoài 2', days: 7 });
    assert.equal((await agentClient(data.token).req('GET', `/api/mcp/projects/${pid}/search?q=${taskKeys.todo}`)).status, 404);
  });

  test('lưu câu trả lời của agent vào Hỏi đáp: giữ nguồn có thật, đánh lại số, che bí mật', async () => {
    const agent = agentClient(token);
    const url = `/api/mcp/projects/${pid}/answers`;
    const found = (await agent.req('GET', `/api/mcp/projects/${pid}/search?q=${taskKeys.todo}`)).data.results[0];
    assert.match(found.ref, /^task:/);
    const other = await db.prisma.task.findFirst({ where: { project: { not: pid }, deletedAt: null } });
    const r = await agent.req('POST', url, {
      question: `Ai làm ${taskKeys.todo}?`, agent: 'Claude Code',
      answer: `Theo [1] thì việc đang chờ [2]. Khóa ${SECRET} không được lưu. Thêm [3].`,
      citations: [{ ref: `task:${other.id}` }, { ref: found.ref, excerpt: found.text.slice(0, 20) }, { ref: found.ref }],
    });
    assert.equal(r.status, 201);
    assert.deepEqual([r.data.citations, r.data.dropped], [1, 2]);
    const conv = (await pm.req('GET', `/api/ai/conversations/${r.data.conversationId}`)).data.conversation;
    const reply = conv.messages[1];
    assert.equal(reply.agent, 'Claude Code');
    assert.equal(reply.content.includes(SECRET), false);
    assert.match(reply.content, /^Theo  thì việc đang chờ \[1\]\./);
    assert.deepEqual(reply.citations.map((c) => [c.n, c.kind, c.available, c.excerpt]), [[1, 'task', true, found.text.slice(0, 20)]]);
    assert.equal(reply.sourceState, 'current');
    const list = (await pm.req('GET', `/api/projects/${pid}/ai/conversations`)).data.conversations;
    assert.deepEqual([list[0]._id, list[0].agent, list[0].count], [r.data.conversationId, 'Claude Code', 2]);
    const next = await agent.req('POST', url, { question: 'Còn gì nữa không?', answer: 'Không có thêm.', conversationId: r.data.conversationId });
    assert.equal(next.data.conversationId, r.data.conversationId);
    assert.equal((await pm.req('GET', `/api/ai/conversations/${r.data.conversationId}`)).data.conversation.messages.length, 4);
    assert.equal((await member.req('GET', `/api/ai/conversations/${r.data.conversationId}`)).status, 404, 'chỉ người tạo token thấy');
    const mine = await member.req('POST', '/api/agent-tokens', { name: 'Máy thành viên 2', days: 7 });
    assert.equal((await agentClient(mine.data.token).req('POST', url, { question: 'Hỏi gì?', answer: 'x', conversationId: r.data.conversationId })).status, 404, 'không nối vào cuộc của người khác');
    assert.equal((await agentClient(mine.data.token).req('POST', url, { question: 'Hỏi gì?', answer: 'Trả lời' })).status, 201, 'thành viên lưu được cuộc của mình');
    assert.equal((await agent.req('POST', url, { question: 'ab', answer: 'x' })).status, 400);
  });

  test('mỗi bình luận và mỗi đoạn tài liệu có ref riêng để trích dẫn không nhầm', async () => {
    const agent = agentClient(token);
    const task = await db.prisma.task.findFirst({ where: { project: pid, key: taskKeys.todo } });
    const pmUser = await db.prisma.projectMember.findFirst({ where: { project: pid, role: 'pm' } });
    await db.prisma.comment.createMany({ data: ['Bình luận thứ nhất về chimcanhcut', 'Bình luận thứ hai về chimcanhcut'].map((body) => ({ project: pid, task: task.id, author: pmUser.user, body })) });
    const found = (await agent.req('GET', `/api/mcp/projects/${pid}/search?q=chimcanhcut`)).data.results.filter((r) => r.kind === 'comment');
    assert.equal(found.length, 2);
    assert.notEqual(found[0].ref, found[1].ref);
    const second = found.find((r) => r.text.includes('thứ hai'));
    const r = await agent.req('POST', `/api/mcp/projects/${pid}/answers`, { question: 'Bình luận nói gì?', answer: 'Xem [1].', citations: [{ ref: second.ref }] });
    const reply = (await pm.req('GET', `/api/ai/conversations/${r.data.conversationId}`)).data.conversation.messages[1];
    assert.deepEqual([reply.citations[0].kind, reply.citations[0].refId, reply.citations[0].available], ['comment', task.id, true]);
    assert.match(reply.citations[0].excerpt, /thứ hai/);
    await db.prisma.comment.deleteMany({ where: { body: { contains: 'chimcanhcut' } } });
  });

  const planItem = (patch = {}) => ({ title: 'Thiết kế màn hình', description: 'Vẽ wireframe', acceptanceCriteria: ['Có bản vẽ được duyệt'], estimateHours: 4, ...patch });

  test('kế hoạch từ agent thành bản nháp; chỉ PM gửi được và PM duyệt trên web mới tạo việc', async () => {
    const agent = agentClient(token);
    const url = `/api/mcp/projects/${pid}/plans`;
    const mine = await member.req('POST', '/api/agent-tokens', { name: 'Máy thành viên', days: 7 });
    assert.equal((await agentClient(mine.data.token).req('POST', url, { goal: 'Làm trang chủ', items: [planItem()] })).status, 403);
    const before = await db.prisma.task.count({ where: { project: pid } });
    const r = await agent.req('POST', url, { goal: 'Làm trang chủ mới', maxHours: 10, agent: 'Claude Code', items: [planItem(), planItem({ title: 'Dựng giao diện', priority: 'high' })] });
    assert.equal(r.status, 201);
    assert.match(r.data.message, /Chưa có công việc nào được tạo/);
    assert.equal(await db.prisma.task.count({ where: { project: pid } }), before);
    const list = (await pm.req('GET', `/api/projects/${pid}/ai/drafts?type=plan`)).data.drafts;
    assert.deepEqual([list[0]._id, list[0].agent, list[0].count], [r.data.draft._id, 'Claude Code', 2]);
    assert.equal((await member.req('GET', `/api/ai/drafts/${r.data.draft._id}`)).status, 404);
    const draft = (await pm.req('GET', `/api/ai/drafts/${r.data.draft._id}`)).data.draft;
    assert.ok(draft.items.every((it) => it.assignee === null && it.selected));
    const approved = await pm.req('POST', `/api/ai/drafts/${draft._id}/approve`, { version: draft.version });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.created.length, 2);
    const task = await db.prisma.task.findUnique({ where: { id: approved.data.created[0]._id } });
    assert.equal(task.source, 'ai_planner');
    await db.prisma.task.deleteMany({ where: { id: { in: approved.data.created.map((t) => t._id) } } });
  });

  test('kế hoạch sai bị từ chối kèm lý do để agent sửa', async () => {
    const agent = agentClient(token);
    const send = (body) => agent.req('POST', `/api/mcp/projects/${pid}/plans`, { goal: 'Làm trang chủ', ...body });
    const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
    for (const [body, pattern] of [
      [{ items: [] }, /ít nhất một công việc/],
      [{ items: [planItem({ acceptanceCriteria: [] })] }, /tiêu chí nghiệm thu/],
      [{ maxHours: 5, items: [planItem(), planItem()] }, /vượt giới hạn 5 giờ/],
      [{ deadline: '2020-01-01', items: [planItem()] }, /đã qua/],
      [{ deadline: soon, items: [planItem({ dueDate: later })] }, /vượt hạn hoàn thành/],
      [{ items: [planItem({ dueDate: 'mai' })] }, /YYYY-MM-DD/],
      [{ items: [planItem({ assignee: 'ai-do' })] }, /./],
    ]) {
      const r = await send(body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match(JSON.stringify(r.data), pattern);
    }
    assert.equal((await send({ deadline: later, items: [planItem({ dueDate: soon })] })).status, 201);
  });

  test('việc từ biên bản họp: trích đoạn phải có thật, người nhận phải là thành viên', async () => {
    const agent = agentClient(token);
    const url = `/api/mcp/projects/${pid}/meetings`;
    const text = 'Họp Sprint.\nThuận: mình sẽ xong API đăng nhập trước thứ sáu.\nMai: cần kiểm thử thanh toán.';
    const members = (await agent.req('GET', `/api/mcp/projects/${pid}/overview`)).data.members;
    const stranger = await db.prisma.user.findFirst({ where: { email: 'nguoi.ngoai@example.test' } });
    const bad = await agent.req('POST', url, { title: 'Họp Sprint', text, items: [{ title: 'Viết tài liệu', excerpt: 'Câu này không có trong biên bản' }] });
    assert.equal(bad.status, 400);
    assert.match(bad.data.error, /nguyên văn/);
    const r = await agent.req('POST', url, { title: 'Họp Sprint', text, agent: 'Antigravity', items: [
      { title: 'Xong API đăng nhập', excerpt: 'Thuận: mình sẽ xong API đăng nhập trước thứ sáu.', assignee: members[0].memberId, priority: 'high' },
      { title: 'Kiểm thử thanh toán', excerpt: 'Mai: cần kiểm thử thanh toán.', assignee: stranger.id },
    ] });
    assert.equal(r.status, 201);
    assert.match(r.data.message, /1 việc có assignee không phải thành viên/);
    const draft = (await pm.req('GET', `/api/ai/drafts/${r.data.draft._id}`)).data.draft;
    assert.equal(draft.input.agent, 'Antigravity');
    assert.deepEqual(draft.items.map((it) => it.assignee?._id ?? null), [members[0].memberId, null]);
    assert.deepEqual(draft.items[0].sourceSpan, { start: text.indexOf('Thuận'), end: text.indexOf('Thuận') + draft.items[0].excerpt.length });
    const approved = await pm.req('POST', `/api/ai/drafts/${draft._id}/approve`, { version: draft.version });
    assert.equal(approved.status, 200);
    const tasks = await db.prisma.task.findMany({ where: { id: { in: approved.data.created.map((t) => t._id) } }, orderBy: { number: 'asc' } });
    assert.deepEqual(tasks.map((t) => [t.source, t.assignee]), [['ai_meeting', members[0].memberId], ['ai_meeting', null]]);
    assert.match(tasks[0].description, /Trích biên bản/);
    await db.prisma.task.deleteMany({ where: { id: { in: tasks.map((t) => t.id) } } });
  });

  test('giao việc từ web cho agent trên máy: cần runner bật, đúng agent, đúng quyền', async () => {
    const agent = agentClient(token);
    const jobs = `/api/projects/${pid}/agent/jobs`;
    const plan = { kind: 'plan', agent: 'antigravity', input: { goal: 'Làm trang liên hệ', maxHours: 10 } };
    assert.equal((await pm.req('GET', '/api/agent/runner')).data.runner.online, false);
    const offline = await pm.req('POST', jobs, plan);
    assert.deepEqual([offline.status, offline.data.details?.code], [409, 'RUNNER_OFFLINE']);
    assert.equal((await agent.req('POST', '/api/mcp/runner/poll', { agents: ['claude'] })).data.job, null);
    assert.deepEqual((await pm.req('GET', '/api/agent/runner')).data.runner.agents, ['claude']);
    assert.equal((await pm.req('POST', jobs, plan)).data.details.code, 'AGENT_UNAVAILABLE');
    assert.equal((await agent.req('POST', '/api/mcp/runner/poll', { agents: ['claude', 'antigravity', 'la'] })).status, 400);
    await agent.req('POST', '/api/mcp/runner/poll', { agents: ['claude', 'antigravity'] });
    assert.equal((await member.req('POST', jobs, plan)).status, 403, 'thành viên không lập kế hoạch');
    assert.equal((await member.req('POST', jobs, { kind: 'qa', agent: 'claude', input: { question: 'Ai làm gì?' } })).data.details.code, 'RUNNER_OFFLINE', 'runner của PM không phục vụ người khác');
    assert.equal((await pm.req('POST', jobs, { ...plan, input: { goal: 'x' } })).status, 400);
    assert.equal((await pm.req('POST', jobs, { ...plan, input: { goal: 'Làm trang liên hệ', lenh: 'rm -rf' } })).status, 400, 'không nhận trường lạ');
  });

  test('việc lập kế hoạch: runner nhận một lần, agent lấy đề bài, giới hạn của người dùng thắng lời agent', async () => {
    const agent = agentClient(token);
    await agent.req('POST', '/api/mcp/runner/poll', { agents: ['antigravity'] });
    const created = await pm.req('POST', `/api/projects/${pid}/agent/jobs`, { kind: 'plan', agent: 'antigravity', input: { goal: 'Làm trang liên hệ', maxHours: 10 } });
    assert.equal(created.status, 201);
    const id = created.data.job._id;
    assert.equal((await agent.req('POST', '/api/mcp/runner/poll', { agents: ['antigravity'], claim: false })).data.job, null, 'báo còn sống thì không nhận việc');
    const claimed = (await agent.req('POST', '/api/mcp/runner/poll', { agents: ['antigravity'] })).data.job;
    assert.deepEqual(claimed, { jobId: id, kind: 'plan', agent: 'antigravity', projectId: pid, source: 'none', repo: null, branch: null }, 'runner không nhận nội dung người dùng nhập');
    assert.equal((await agent.req('POST', '/api/mcp/runner/poll', { agents: ['antigravity'] })).data.job, null);
    assert.equal((await pm.req('GET', `/api/agent/jobs/${id}`)).data.job.status, 'running');
    const brief = (await agent.req('GET', `/api/mcp/runner/jobs/${id}`)).data;
    assert.deepEqual([brief.job.kind, brief.job.projectId, brief.job.input.goal, brief.job.input.maxHours], ['plan', pid, 'Làm trang liên hệ', 10]);
    const other = await member.req('POST', '/api/agent-tokens', { name: 'Máy thành viên 3', days: 7 });
    assert.equal((await agentClient(other.data.token).req('GET', `/api/mcp/runner/jobs/${id}`)).status, 404, 'người khác không đọc được việc');
    const url = `/api/mcp/projects/${pid}/plans`;
    const tooMuch = await agent.req('POST', url, { jobId: id, goal: 'Mục tiêu agent tự đổi', maxHours: 500, items: [planItem({ estimateHours: 20 })] });
    assert.equal(tooMuch.status, 400);
    assert.match(tooMuch.data.error, /vượt giới hạn 10 giờ/);
    assert.equal((await agent.req('POST', `/api/mcp/projects/${pid}/meetings`, { jobId: id, items: [] })).status, 400, 'sai loại việc');
    const sent = await agent.req('POST', url, { jobId: id, agent: 'Antigravity', items: [planItem()] });
    assert.equal(sent.status, 201);
    const job = (await pm.req('GET', `/api/agent/jobs/${id}`)).data.job;
    assert.deepEqual([job.status, job.resultType, job.resultId], ['done', 'draft', sent.data.draft._id]);
    const draft = (await pm.req('GET', `/api/ai/drafts/${job.resultId}`)).data.draft;
    assert.deepEqual([draft.input.goal, draft.input.maxHours, draft.input.agent], ['Làm trang liên hệ', 10, 'Antigravity']);
    assert.equal((await agent.req('POST', url, { jobId: id, items: [planItem()] })).status, 400, 'việc xong rồi không nhận thêm kết quả');
    assert.equal((await agent.req('POST', `/api/mcp/runner/jobs/${id}/finish`, { ok: true })).data.job.status, 'done');
  });

  test('việc hỏi đáp và biên bản họp: câu hỏi, biên bản lấy từ web; agent thoát mà không gửi thì báo lỗi; hủy được', async () => {
    const agent = agentClient(token);
    const poll = () => agent.req('POST', '/api/mcp/runner/poll', { agents: ['claude'] });
    const jobs = `/api/projects/${pid}/agent/jobs`;
    await poll();
    const qa = (await pm.req('POST', jobs, { kind: 'qa', agent: 'claude', input: { question: `Ai làm ${taskKeys.todo}?` } })).data.job;
    await poll();
    const saved = await agent.req('POST', `/api/mcp/projects/${pid}/answers`, { jobId: qa._id, question: 'Câu hỏi agent bịa', answer: 'Chưa ghi nhận.', agent: 'Claude Code' });
    assert.equal(saved.status, 201);
    const done = (await pm.req('GET', `/api/agent/jobs/${qa._id}`)).data.job;
    assert.deepEqual([done.status, done.resultType, done.resultId], ['done', 'conversation', saved.data.conversationId]);
    const conv = (await pm.req('GET', `/api/ai/conversations/${done.resultId}`)).data.conversation;
    assert.equal(conv.messages[0].content, `Ai làm ${taskKeys.todo}?`);

    const text = 'Thuận: mình sẽ viết tài liệu API trong tuần này.';
    const meeting = (await pm.req('POST', jobs, { kind: 'meeting', agent: 'claude', input: { title: 'Họp tuần', text } })).data.job;
    await poll();
    const wrong = await agent.req('POST', `/api/mcp/projects/${pid}/meetings`, { jobId: meeting._id, text: 'Biên bản agent tự viết: giao hết cho Mai.', items: [{ title: 'Giao hết', excerpt: 'giao hết cho Mai' }] });
    assert.equal(wrong.status, 400, 'trích đoạn phải có trong biên bản người dùng nhập');
    const failed = await agent.req('POST', `/api/mcp/runner/jobs/${meeting._id}/finish`, { ok: true, output: `Tôi không làm được. Khóa ${SECRET}` });
    assert.equal(failed.data.job.status, 'failed');
    const shown = (await pm.req('GET', `/api/agent/jobs/${meeting._id}`)).data.job;
    assert.match(shown.error, /không gửi kết quả/);
    assert.ok(!shown.error.includes(SECRET));

    const queued = (await pm.req('POST', jobs, { kind: 'meeting', agent: 'claude', input: { title: 'Họp tuần', text } })).data.job;
    assert.equal((await member.req('POST', `/api/agent/jobs/${queued._id}/cancel`)).status, 404);
    assert.equal((await pm.req('POST', `/api/agent/jobs/${queued._id}/cancel`)).data.job.status, 'cancelled');
    assert.equal((await poll()).data.job, null, 'việc đã hủy không được giao');
    await db.prisma.agentJob.updateMany({ where: { id: queued._id }, data: { status: 'queued', createdAt: new Date(Date.now() - 4 * 60000) } });
    assert.equal((await pm.req('GET', `/api/agent/jobs/${queued._id}`)).data.job.status, 'failed', 'chờ quá lâu thì đóng lại');
  });

  test('nguồn code: tự đoán theo câu chữ, GitHub cần repo đã kết nối, runner chỉ nhận đường dẫn công khai', async () => {
    const agent = agentClient(token);
    const poll = () => agent.req('POST', '/api/mcp/runner/poll', { agents: ['claude'] });
    const jobs = `/api/projects/${pid}/agent/jobs`;
    await db.prisma.repoConnection.deleteMany({ where: { project: pid } });
    await poll();
    const noRepo = await pm.req('POST', jobs, { kind: 'qa', agent: 'claude', input: { question: 'Đọc dự án trên GitHub rồi tick việc đã xong' } });
    assert.equal(noRepo.status, 400);
    assert.match(noRepo.data.error, /chưa kết nối repo/);
    assert.equal((await pm.req('POST', jobs, { kind: 'qa', agent: 'claude', input: { question: 'Hỏi gì đó', source: 'ftp' } })).status, 400);
    const local = (await pm.req('POST', jobs, { kind: 'qa', agent: 'claude', input: { question: 'Đọc code trên máy xem xong chưa' } })).data.job;
    assert.equal(local.source, 'local');
    const claimed = (await poll()).data.job;
    assert.deepEqual([claimed.jobId, claimed.source, claimed.repo], [local._id, 'local', null]);
    await pm.req('POST', `/api/agent/jobs/${local._id}/cancel`);
    assert.equal((await connect()).status, 200);
    try {
      const gh = (await pm.req('POST', jobs, { kind: 'plan', agent: 'claude', input: { goal: 'Làm tiếp phần còn thiếu trong repo', source: 'auto' } })).data.job;
      assert.equal(gh.source, 'github');
      const next = (await poll()).data.job;
      assert.deepEqual([next.source, next.branch], ['github', 'main']);
      assert.match(next.repo, /^https:\/\/.+\/acme\/app$/);
      await pm.req('POST', `/api/agent/jobs/${gh._id}/cancel`);
    } finally {
      await db.prisma.repoConnection.deleteMany({ where: { project: pid } });
    }
  });

  test('agent tick hoàn thành: theo luật đổi trạng thái của web, ghi căn cứ thành bình luận', async () => {
    const agent = agentClient(token);
    await agent.req('POST', '/api/mcp/runner/poll', { agents: ['claude'] });
    const job = (await pm.req('POST', `/api/projects/${pid}/agent/jobs`, { kind: 'qa', agent: 'claude', input: { question: 'Tick các việc đã xong', source: 'none' } })).data.job;
    await agent.req('POST', '/api/mcp/runner/poll', { agents: ['claude'] });
    const url = `/api/mcp/projects/${pid}/tasks/complete`;
    assert.equal((await agent.req('POST', url, { jobId: job._id, tasks: [{ taskId: taskKeys.todo, evidence: 'x' }] })).status, 400, 'phải có căn cứ');
    const r = await agent.req('POST', url, { jobId: job._id, agent: 'Claude Code', tasks: [{ taskId: taskKeys.todo, evidence: `src/app.js đã có chức năng. Khóa ${SECRET}` }, { taskId: 'ZZ-999', evidence: 'không có việc này' }] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.results.map((x) => x.ok), [true, false], JSON.stringify(r.data.results));
    const task = await db.prisma.task.findFirst({ where: { project: pid, key: taskKeys.todo } });
    assert.equal(task.status, 'done');
    const comment = await db.prisma.comment.findFirst({ where: { task: task.id }, orderBy: { createdAt: 'desc' } });
    assert.match(comment.body, /\[Claude Code\] Chuyển sang Hoàn thành/);
    assert.ok(!comment.body.includes(SECRET), 'che bí mật trong căn cứ');
    const memberAgent = agentClient((await member.req('POST', '/api/agent-tokens', { name: 'Máy thành viên tick', days: 7 })).data.token);
    const other = await db.prisma.task.findFirst({ where: { project: pid, status: 'todo', deletedAt: null, id: { not: task.id } } });
    const byMember = await memberAgent.req('POST', url, { tasks: [{ taskId: other.key, evidence: 'src/x.js đã có' }] });
    assert.ok(['review', undefined].includes(byMember.data.results[0].status), JSON.stringify(byMember.data));
    assert.notEqual((await db.prisma.task.findUnique({ where: { id: other.id } })).status, 'done', 'thành viên không tự Hoàn thành được');
    await db.prisma.task.update({ where: { id: other.id }, data: { status: 'todo', reviewSince: null } });
    const again = await agent.req('POST', url, { jobId: job._id, tasks: [{ taskId: taskKeys.todo, evidence: 'gọi lại lần hai' }] });
    assert.equal(again.data.results[0].already, true);
    const plan = (await pm.req('POST', `/api/projects/${pid}/agent/jobs`, { kind: 'plan', agent: 'claude', input: { goal: 'Kế hoạch bất kỳ', source: 'none' } })).data.job;
    await agent.req('POST', '/api/mcp/runner/poll', { agents: ['claude'] });
    assert.equal((await agent.req('POST', url, { jobId: plan._id, tasks: [{ taskId: taskKeys.todo, evidence: 'việc lập kế hoạch' }] })).status, 400, 'chỉ việc hỏi đáp được tick');
    await db.prisma.task.update({ where: { id: task.id }, data: { status: 'todo', completedAt: null, progressPct: 0 } });
    await pm.req('POST', `/api/agent/jobs/${plan._id}/cancel`);
    await pm.req('POST', `/api/agent/jobs/${job._id}/cancel`);
  });

  test('ngắt kết nối từ web: runner phiên đó nhận lệnh dừng, việc chờ bị hủy, phiên mới chạy lại được', async () => {
    const agent = agentClient(token);
    const poll = (session) => agent.req('POST', '/api/mcp/runner/poll', { agents: ['claude'], session });
    await poll('phien-cu-12345678');
    assert.equal((await pm.req('GET', '/api/agent/runner')).data.runner.online, true);
    const job = (await pm.req('POST', `/api/projects/${pid}/agent/jobs`, { kind: 'qa', agent: 'claude', input: { question: 'Ai làm gì?' } })).data.job;
    const off = await pm.req('POST', '/api/agent/runner/disconnect');
    assert.equal(off.data.runner.online, false);
    assert.equal((await pm.req('GET', `/api/agent/jobs/${job._id}`)).data.job.status, 'cancelled');
    const stopped = (await poll('phien-cu-12345678')).data;
    assert.deepEqual([stopped.stop, stopped.job], [true, null]);
    assert.equal((await pm.req('GET', '/api/agent/runner')).data.runner.online, false, 'phiên đã ngắt không được tính là đang bật');
    assert.equal((await poll('phien-moi-87654321')).data.stop, undefined);
    assert.equal((await pm.req('GET', '/api/agent/runner')).data.runner.online, true);
    assert.equal((await poll('bad session!')).status, 400);
  });

  test('thu hồi hoặc hết hạn thì token mất hiệu lực ngay', async () => {
    const { data } = await pm.req('POST', '/api/agent-tokens', { name: 'Tạm', days: 7 });
    await db.prisma.agentToken.update({ where: { id: data.record._id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await agentClient(data.token).req('GET', '/api/mcp/projects')).status, 401);
    const list = await pm.req('GET', '/api/agent-tokens');
    const id = list.data.tokens.find((t) => t.name === 'Claude Code')._id;
    await pm.req('DELETE', `/api/agent-tokens/${id}`);
    assert.equal((await agentClient(token).req('GET', '/api/mcp/projects')).status, 401);
  });
});

test('báo cáo agent: mục sai dạng bị bỏ, mức độ được chuẩn hóa', () => {
  const r = validateAgentReport({ kind: 'review', title: 't', summary: 's', items: [{ title: 'A', severity: 'CRITICAL', detail: 'd', line: '12' }, 'rác', { title: 'B' }] });
  assert.deepEqual(r.items.map((i) => [i.title, i.severity, i.line]), [['A', 'high', 12]]);
  assert.equal(r.dropped, 2);
});
