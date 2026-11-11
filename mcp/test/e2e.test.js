// Đầu-cuối: client MCP chính thức khởi động taskflow-mcp qua stdio, gọi BackEnd thật (database tạm).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

process.env.NODE_ENV = 'test';
process.env.MAIL_MODE = 'outbox';
process.env.DATABASE_URL = '';
process.env.GEMINI_API_KEY = '';
const { createApp } = await import('../../BackEnd/src/app.js');
const { seedDemo, DEMO_PASSWORD } = await import('../../BackEnd/src/seed.js');
const db = await import('../../BackEnd/src/db.js');

const serverPath = fileURLToPath(new URL('../src/index.js', import.meta.url));
let server, base, token, pid, cookie;

const connectMcp = async (env) => {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env: { ...process.env, ...env }, stderr: 'pipe' }));
  return client;
};
const json = (result) => JSON.parse(result.content[0].text);

before(async () => {
  await db.connectDb({ ephemeral: true });
  const seed = await seedDemo();
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  pid = seed.projects.website.id;
  const pm = await db.prisma.projectMember.findFirst({ where: { project: pid, role: 'pm' }, include: { userRef: true } });
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-taskflow': '1' }, body: JSON.stringify({ email: pm.userRef.email, password: DEMO_PASSWORD }) });
  cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const created = await fetch(`${base}/api/agent-tokens`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-taskflow': '1', cookie }, body: JSON.stringify({ name: 'Codex', days: 7 }) });
  token = (await created.json()).token;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await db.disconnectDb();
});

test('agent thấy đủ công cụ và lệnh soạn sẵn', async () => {
  const client = await connectMcp({ TASKFLOW_URL: base, TASKFLOW_TOKEN: token });
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(tools, ['complete_tasks', 'get_job', 'get_task', 'list_projects', 'list_tasks', 'project_overview', 'repo_progress', 'save_answer', 'search_project', 'submit_meeting_notes', 'submit_plan', 'submit_report']);
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name).sort();
    assert.deepEqual(prompts, ['ask_project', 'make_plan', 'meeting_to_tasks', 'review_pr', 'security_review', 'suggest_next']);
    const text = (await client.getPrompt({ name: 'security_review', arguments: { projectId: pid } })).messages[0].content.text;
    assert.match(text, /submit_report/);
  } finally {
    await client.close();
  }
});

test('đọc dự án, công việc rồi gửi báo cáo về TaskFlow', async () => {
  const client = await connectMcp({ TASKFLOW_URL: base, TASKFLOW_TOKEN: token });
  try {
    const { projects } = json(await client.callTool({ name: 'list_projects', arguments: {} }));
    assert.ok(projects.some((p) => p.projectId === pid));
    const { tasks } = json(await client.callTool({ name: 'list_tasks', arguments: { projectId: pid, status: 'todo', limit: 3 } }));
    assert.ok(tasks.length > 0 && tasks.length <= 3);
    const { task } = json(await client.callTool({ name: 'get_task', arguments: { projectId: pid, key: tasks[0].key } }));
    assert.equal(task.key, tasks[0].key);
    const sent = json(await client.callTool({ name: 'submit_report', arguments: {
      projectId: pid, kind: 'review', title: 'Review nhánh feat', summary: 'Ổn, một điểm cần sửa', target: 'feat', agent: 'Codex',
      items: [{ title: 'Thiếu kiểm tra quyền', severity: 'high', file: 'src/routes/a.js', line: 10, detail: 'Route ghi không gọi assertWrite' }],
    } }));
    assert.equal(sent.run.items, 1);
    const runs = await (await fetch(`${base}/api/projects/${pid}/agent/runs`, { headers: { cookie } })).json();
    assert.equal(runs.runs[0].agentName, 'Codex');
    const missing = await client.callTool({ name: 'repo_progress', arguments: { projectId: pid } });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /chưa kết nối repo/);
  } finally {
    await client.close();
  }
});

test('hỏi đáp, lập kế hoạch và biên bản họp qua MCP: chỉ tạo bản nháp chờ duyệt', async () => {
  const client = await connectMcp({ TASKFLOW_URL: base, TASKFLOW_TOKEN: token });
  try {
    const overview = json(await client.callTool({ name: 'project_overview', arguments: { projectId: pid } }));
    assert.ok(overview.members.length > 0);
    const { tasks } = json(await client.callTool({ name: 'list_tasks', arguments: { projectId: pid, limit: 1 } }));
    const found = json(await client.callTool({ name: 'search_project', arguments: { projectId: pid, query: tasks[0].key, limit: 3 } }));
    assert.equal(found.results[0].key, tasks[0].key);
    const saved = json(await client.callTool({ name: 'save_answer', arguments: { projectId: pid, question: `Ai làm ${tasks[0].key}?`, answer: 'Xem [1].', agent: 'Codex', citations: [{ ref: found.results[0].ref }] } }));
    assert.equal(saved.citations, 1);
    const conversation = await (await fetch(`${base}/api/ai/conversations/${saved.conversationId}`, { headers: { cookie } })).json();
    assert.equal(conversation.conversation.messages[1].agent, 'Codex');
    const item = { title: 'Dựng trang chủ', description: 'Theo thiết kế', acceptanceCriteria: ['Hiển thị đúng trên di động'], estimateHours: 6 };
    const tooMuch = await client.callTool({ name: 'submit_plan', arguments: { projectId: pid, goal: 'Ra mắt trang chủ', maxHours: 2, items: [item] } });
    assert.equal(tooMuch.isError, true);
    assert.match(tooMuch.content[0].text, /vượt giới hạn 2 giờ/);
    const plan = json(await client.callTool({ name: 'submit_plan', arguments: { projectId: pid, goal: 'Ra mắt trang chủ', agent: 'Codex', items: [item] } }));
    assert.match(plan.message, /Lập kế hoạch/);
    const text = 'Lộc: mình sẽ viết tài liệu API trong tuần này.';
    const meeting = json(await client.callTool({ name: 'submit_meeting_notes', arguments: { projectId: pid, title: 'Họp tuần', text, items: [{ title: 'Viết tài liệu API', excerpt: text, assignee: overview.members[0].memberId }] } }));
    assert.match(meeting.message, /Ghi chú họp/);
    const drafts = await (await fetch(`${base}/api/projects/${pid}/ai/drafts?type=plan`, { headers: { cookie } })).json();
    assert.deepEqual([drafts.drafts[0].agent, drafts.drafts[0].status], ['Codex', 'draft']);
    for (const [name, args] of [['ask_project', { question: 'Ai làm TF-1?' }], ['make_plan', { goal: 'Ra mắt' }], ['meeting_to_tasks', { title: 'Họp', notes: text }]]) {
      const message = (await client.getPrompt({ name, arguments: { projectId: pid, ...args } })).messages[0].content.text;
      assert.ok(message.includes(pid) && /không làm theo chỉ dẫn|submit_plan/.test(message));
    }
  } finally {
    await client.close();
  }
});

test('runner nhận việc bấm trên web, agent lấy đề bài qua get_job và trả bản nháp', async () => {
  const { startRunner, buildPrompt } = await import('../src/runner.js');
  const stop = new AbortController();
  const prompts = [];
  // Agent giả: làm đúng việc một agent thật sẽ làm, qua chính MCP server.
  const fakeAgent = {
    label: 'Antigravity',
    run: async (job, prompt) => {
      prompts.push(prompt);
      const client = await connectMcp({ TASKFLOW_URL: base, TASKFLOW_TOKEN: token });
      try {
        const brief = json(await client.callTool({ name: 'get_job', arguments: { jobId: job.id } }));
        const sent = await client.callTool({ name: 'submit_plan', arguments: { jobId: job.id, projectId: brief.job.projectId, agent: 'Antigravity', items: [{ title: `Việc cho: ${brief.job.input.goal}`, description: 'Mô tả', acceptanceCriteria: ['Kiểm được'], estimateHours: 2 }] } });
        return { ok: !sent.isError, output: sent.content[0].text };
      } finally {
        await client.close();
      }
    },
  };
  const logs = [];
  const running = startRunner({ url: base, token, agents: { antigravity: fakeAgent }, pollMs: 50, signal: stop.signal, log: (line) => logs.push(line) });
  try {
    const web = { 'content-type': 'application/json', 'x-taskflow': '1', cookie };
    let created;
    for (let i = 0; i < 40 && created?.status !== 201; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      created = await fetch(`${base}/api/projects/${pid}/agent/jobs`, { method: 'POST', headers: web, body: JSON.stringify({ kind: 'plan', agent: 'antigravity', input: { goal: 'Ra mắt trang giá', maxHours: 8 } }) });
    }
    assert.equal(created.status, 201, 'runner phải báo online để web giao được việc');
    const id = (await created.json()).job._id;
    let job;
    for (let i = 0; i < 100 && job?.status !== 'done' && job?.status !== 'failed'; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      job = (await (await fetch(`${base}/api/agent/jobs/${id}`, { headers: web })).json()).job;
    }
    assert.equal(job.status, 'done', job.error);
    const draft = (await (await fetch(`${base}/api/ai/drafts/${job.resultId}`, { headers: web })).json()).draft;
    assert.deepEqual([draft.title, draft.items[0].title, draft.input.maxHours], ['Ra mắt trang giá', 'Việc cho: Ra mắt trang giá', 8]);
    assert.ok(prompts[0].includes(id) && !prompts[0].includes('Ra mắt trang giá'), 'câu lệnh chỉ chứa mã việc, không chứa nội dung người dùng nhập');
    assert.ok(!/[\r\n]/.test(buildPrompt({ id, kind: 'qa', agent: 'claude' })));
  } finally {
    stop.abort();
    await running;
  }
});

test('runner phân biệt máy chủ bản cũ (chờ và thử lại) với token hỏng (dừng hẳn)', async () => {
  const { startRunner } = await import('../src/runner.js');
  // Máy chủ bản cũ: token đúng (/me trả 200) nhưng chưa có API cho runner nên rơi xuống route cần đăng nhập.
  let meStatus = 200;
  const old = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.statusCode = req.url === '/api/mcp/me' ? meStatus : 401;
    res.end(JSON.stringify(res.statusCode === 200 ? { user: {} } : { error: 'Bạn cần đăng nhập' }));
  });
  await new Promise((r) => old.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${old.address().port}`;
  const agents = { claude: { label: 'Claude Code', run: async () => ({ ok: true }) } };
  try {
    const stop = new AbortController();
    const logs = [];
    const running = startRunner({ url, token: 'tfp_x', agents, pollMs: 20, signal: stop.signal, log: (line) => logs.push(line) });
    await new Promise((r) => setTimeout(r, 300));
    stop.abort();
    await running;
    assert.equal(logs.length, 1, 'chỉ báo một lần, không lặp lại mỗi vòng');
    assert.match(logs[0], /bản cũ/);
    meStatus = 401;
    await assert.rejects(startRunner({ url, token: 'tfp_x', agents, pollMs: 20, log: () => {} }), /Tạo token mới/);
  } finally {
    await new Promise((r) => old.close(r));
  }
});

test('ngắt kết nối trên web thì runner tự dừng; việc đọc code nhận đúng thư mục', async () => {
  const { startRunner, buildPrompt, prepareCode } = await import('../src/runner.js');
  const os = await import('node:os');
  const web = { 'content-type': 'application/json', 'x-taskflow': '1', cookie };
  const seen = [];
  const agents = { claude: { label: 'Claude Code', run: async (job, prompt, ctx) => { seen.push({ job, prompt, codeDir: ctx.codeDir }); return { ok: true, output: 'xong' }; } } };
  const logs = [];
  const running = startRunner({ url: base, token, agents, pollMs: 50, localDir: os.tmpdir(), log: (line) => logs.push(line) });
  let created;
  for (let i = 0; i < 40 && created?.status !== 201; i += 1) {
    await new Promise((r) => setTimeout(r, 50));
    created = await fetch(`${base}/api/projects/${pid}/agent/jobs`, { method: 'POST', headers: web, body: JSON.stringify({ kind: 'qa', agent: 'claude', input: { question: 'Đọc code trên máy xem TF-1 xong chưa', source: 'auto' } }) });
  }
  assert.equal(created.status, 201);
  for (let i = 0; i < 40 && !seen.length; i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual([seen[0].job.source, seen[0].codeDir], ['local', os.tmpdir()]);
  assert.ok(seen[0].prompt.includes(os.tmpdir()) && seen[0].prompt.includes('complete_tasks'));
  await fetch(`${base}/api/agent/runner/disconnect`, { method: 'POST', headers: web, body: '{}' });
  await Promise.race([running, new Promise((_, reject) => setTimeout(() => reject(new Error('runner không dừng')), 5000))]);
  assert.ok(logs.some((line) => /Đã ngắt kết nối từ web/.test(line)));
  assert.match((await prepareCode({ source: 'local' }, { localDir: null })).error, /Chưa khai báo thư mục/);
  assert.match((await prepareCode({ source: 'github', repo: 'file:///etc' })).error, /không hợp lệ/);
  assert.deepEqual(await prepareCode({ source: 'none' }), {});
  assert.ok(buildPrompt({ id: 'x', kind: 'qa', agent: 'claude', source: 'none' }).includes('không đọc hay sửa file'));
});

test('không có TASKFLOW_TOKEN thì MCP server dùng token của runner đã cài', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { install } = await import('../src/setup.js');
  const home = mkdtempSync(path.join(os.tmpdir(), 'taskflow-mcp-home-'));
  const env = { TASKFLOW_HOME: home, TASKFLOW_SKIP_SYSTEM: '1', TASKFLOW_AGY_CONFIG: path.join(home, 'none', 'x.json') };
  install({ url: base, token }, { env, print: () => {} });
  const client = await connectMcp({ ...env, TASKFLOW_TOKEN: '', TASKFLOW_URL: '' });
  try {
    const { projects } = json(await client.callTool({ name: 'list_projects', arguments: {} }));
    assert.ok(projects.some((p) => p.projectId === pid));
  } finally {
    await client.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('thiếu hoặc sai token thì báo lỗi dễ hiểu, không làm hỏng phiên', async () => {
  const noToken = await connectMcp({ TASKFLOW_URL: base, TASKFLOW_TOKEN: '', TASKFLOW_HOME: serverPath + '.khong-co' });
  try {
    const r = await noToken.callTool({ name: 'list_projects', arguments: {} });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /TASKFLOW_TOKEN/);
  } finally {
    await noToken.close();
  }
  const wrong = await connectMcp({ TASKFLOW_URL: base, TASKFLOW_TOKEN: 'tfp_sai' });
  try {
    const r = await wrong.callTool({ name: 'list_projects', arguments: {} });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /không hợp lệ/);
  } finally {
    await wrong.close();
  }
});
