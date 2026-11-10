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
    assert.deepEqual(tools, ['get_task', 'list_projects', 'list_tasks', 'project_overview', 'repo_progress', 'save_answer', 'search_project', 'submit_meeting_notes', 'submit_plan', 'submit_report']);
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

test('thiếu hoặc sai token thì báo lỗi dễ hiểu, không làm hỏng phiên', async () => {
  const noToken = await connectMcp({ TASKFLOW_URL: base, TASKFLOW_TOKEN: '' });
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
