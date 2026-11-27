import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { notFound } from '../../utils/http.js';
import { randomToken } from '../../utils/security.js';
import { runAi } from '../ai/gateway.js';
import { notify } from '../notify.js';
import { repoClient } from './client.js';

const DAY = 86400000;
// Gemini cần thời gian chọn lọc giữa nhiều ứng viên; vẫn giữ trần để job không treo lâu.
export const AGENT_MIN_TIMEOUT_MS = 60000;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const makeItems = (list) => list.map((item) => ({ ...item, key: randomToken(8), state: 'open' }));
const normalize = (s) => s.trim().toLowerCase();

export async function connectionOf(projectId) {
  const conn = await prisma.repoConnection.findUnique({ where: { project: projectId } });
  if (!conn) throw notFound('Dự án chưa kết nối repo');
  return conn;
}

/** Đối chiếu repo với bảng công việc bằng code thường: chỉ dùng metadata, không tốn lượt AI. */
export async function repoProgress(conn, project, now = new Date()) {
  const git = repoClient(conn);
  const since = new Date(now.getTime() - 30 * DAY);
  const [commits, pulls, tasks] = await Promise.all([
    git.commits(since),
    git.pulls(),
    prisma.task.findMany({ where: { project: project.id, deletedAt: null }, select: { id: true, key: true, title: true, status: true, dueDate: true, completedAt: true, updatedAt: true } }),
  ]);
  const byKey = new Map(tasks.map((t) => [t.key.toUpperCase(), t]));
  const pattern = new RegExp(`\\b${escapeRegExp(project.keyPrefix)}-\\d+\\b`, 'gi');
  const keysIn = (text) => [...new Set((String(text).match(pattern) || []).map((k) => k.toUpperCase()))].filter((k) => byKey.has(k));
  const commitKeys = new Set();
  let linkedCommits = 0;
  for (const commit of commits) {
    const keys = keysIn(commit.message);
    if (keys.length) linkedCommits += 1;
    keys.forEach((k) => commitKeys.add(k));
  }
  const merged = new Set();
  const open = new Set();
  for (const pull of pulls) {
    const keys = keysIn(`${pull.title} ${pull.head} ${pull.body}`);
    if (pull.state === 'merged') keys.forEach((k) => merged.add(k));
    if (pull.state === 'open') keys.forEach((k) => open.add(k));
  }
  const brief = (t) => ({ id: t.id, key: t.key, title: t.title });
  const usesKeys = commitKeys.size + merged.size + open.size > 0;
  const staleDays = Math.max(1, project.riskRules?.reviewStaleDays ?? 3);
  const openPulls = pulls.filter((p) => p.state === 'open').map((p) => ({ number: p.number, title: p.title, author: p.author, draft: p.draft, url: p.url, updatedAt: p.updatedAt, ageDays: Math.floor((now - new Date(p.updatedAt)) / DAY) }));
  return {
    usesKeys,
    linkedCommits,
    commits: commits.slice(0, 30).map(({ message: _message, ...commit }) => commit),
    openPulls,
    stalePulls: openPulls.filter((p) => !p.draft && p.ageDays >= staleDays).slice(0, 20),
    // Repo chưa ghi mã việc thì không đối chiếu được: để trống thay vì báo sai hàng loạt.
    doneNoMerge: usesKeys ? tasks.filter((t) => t.status === 'done' && new Date(t.completedAt || t.updatedAt) >= since && !merged.has(t.key.toUpperCase()) && !commitKeys.has(t.key.toUpperCase())).slice(0, 20).map(brief) : [],
    todoWithCode: tasks.filter((t) => t.status === 'todo' && (commitKeys.has(t.key.toUpperCase()) || open.has(t.key.toUpperCase()))).slice(0, 20).map(brief),
    overdue: tasks.filter((t) => t.status !== 'done' && t.dueDate && new Date(t.dueDate) < now).slice(0, 20).map(brief),
    stats: { total: tasks.length, todo: tasks.filter((t) => t.status === 'todo').length, inProgress: tasks.filter((t) => t.status === 'in_progress').length, review: tasks.filter((t) => t.status === 'review').length, done: tasks.filter((t) => t.status === 'done').length },
  };
}

// ===================== TÌM SKILL / PLUGIN / CÔNG CỤ =====================
const https = (value) => typeof value === 'string' && /^https:\/\//.test(value);

async function getJson(url) {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'TaskFlow' }, signal: AbortSignal.timeout(10000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** MCP Registry chính thức: MCP server cắm được vào agent. */
async function searchMcpRegistry(query) {
  const data = await getJson(`${config.agent.mcpRegistryUrl}/v0/servers?search=${encodeURIComponent(query)}&limit=5`);
  return (data?.servers || [])
    .map(({ server }) => ({ name: server?.name, description: server?.description || '', url: [server?.websiteUrl, server?.repository?.url].find(https), source: 'mcp' }))
    .filter((c) => c.name && c.url);
}

/** npm: thư viện và plugin cho dự án JavaScript/TypeScript. */
async function searchNpm(query) {
  const data = await getJson(`${config.agent.npmSearchUrl}?text=${encodeURIComponent(query)}&size=5`);
  return (data?.objects || [])
    .map(({ package: pkg }) => ({ name: pkg?.name, description: pkg?.description || '', url: [pkg?.links?.npm, pkg?.links?.homepage].find(https), source: 'npm' }))
    .filter((c) => c.name && c.url);
}

/** Bối cảnh dự án cho AI: chỉ metadata, không có nội dung code. */
async function discoveryContext(project, now) {
  const conn = await prisma.repoConnection.findUnique({ where: { project: project.id } });
  let repo = { languages: [], topics: [], repoDescription: '' };
  if (conn) {
    const git = repoClient(conn);
    const [info, languages] = await Promise.all([git.info().catch(() => null), git.languages().catch(() => [])]);
    repo = { languages: languages.slice(0, 8), topics: (info?.topics || []).slice(0, 10), repoDescription: (info?.description || '').slice(0, 500) };
  }
  const [tasks, past] = await Promise.all([
    prisma.task.findMany({ where: { project: project.id, deletedAt: null, status: { not: 'done' } }, orderBy: { updatedAt: 'desc' }, take: 40, select: { title: true, labels: true } }),
    prisma.agentRun.findMany({ where: { project: project.id, kind: 'suggest', createdAt: { gte: new Date(now.getTime() - 60 * DAY) } }, select: { items: true }, take: 60 }),
  ]);
  return {
    projectName: project.name,
    description: (project.description || '').slice(0, 1000),
    ...repo,
    openTasks: tasks.map((t) => t.title),
    labels: [...new Set(tasks.flatMap((t) => t.labels))].slice(0, 20),
    avoid: [...new Set(past.flatMap((run) => run.items.map((item) => item.title)))].slice(0, 200),
  };
}

/** Bỏ những đề xuất đã từng đưa ra: AI có thể lặp lại dù đã được dặn. */
export const freshSuggestions = (suggestions, avoid) => {
  const seen = new Set(avoid.map(normalize));
  return suggestions.filter((s) => !seen.has(normalize(s.title)) && seen.add(normalize(s.title)));
};

/**
 * Gợi ý hằng ngày: AI đặt từ khóa → TaskFlow tra MCP Registry + npm (nguồn thật, miễn phí)
 * → AI chọn và giải thích. Mọi đường link phải nằm trong kết quả tra, AI không tự nghĩ ra.
 */
export async function buildDiscovery(project, userId, now = new Date()) {
  const context = await discoveryContext(project, now);
  const call = (payload) => runAi({ workspaceId: project.workspace, userId, feature: 'suggest', payload, minTimeoutMs: AGENT_MIN_TIMEOUT_MS });
  const { queries } = await call({ stage: 'queries', context });
  const found = (await Promise.all(queries.flatMap((q) => [searchMcpRegistry(q), searchNpm(q)]))).flat();
  const candidates = [...new Map(found.map((c) => [c.url, c])).values()].slice(0, 40);
  if (!candidates.length) return { summary: `Chưa tìm được công cụ phù hợp cho các từ khóa: ${queries.join(', ')}.`, items: [], model: null, queries };
  const pick = await call({ stage: 'pick', context, candidates });
  return { summary: pick.summary, items: makeItems(freshSuggestions(pick.suggestions, context.avoid)), model: pick._meta.model, queries };
}

function localClock(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/**
 * Chạy theo giờ PM đặt cho từng dự án (múi giờ dự án). claimKey + ON CONFLICT DO NOTHING bảo đảm
 * mỗi dự án chỉ chạy một lần mỗi ngày dù nhiều server cùng dùng một database, và không ghi lỗi 23505.
 */
export async function runDailySuggestions(now = new Date()) {
  const projects = await prisma.project.findMany({ where: { agentDaily: true, status: 'active' }, include: { workspaceRef: { select: { ai: true } } } });
  let ran = 0;
  for (const { workspaceRef, ...project } of projects) {
    const { date, time } = localClock(now, project.timezone);
    if (time < project.agentDailyTime || !workspaceRef.ai?.enabled || workspaceRef.ai?.features?.suggest === false) continue;
    const claimKey = `daily:${project.id}:${date}`;
    const { count } = await prisma.agentRun.createMany({
      data: [{ workspace: project.workspace, project: project.id, kind: 'suggest', status: 'running', title: `Gợi ý ngày ${date}`, claimKey }],
      skipDuplicates: true,
    });
    if (!count) continue;
    ran += 1;
    const owner = project.manager ?? project.createdBy;
    try {
      const out = await buildDiscovery(project, owner, now);
      await prisma.agentRun.update({ where: { claimKey }, data: { status: 'done', summary: out.summary, items: out.items, model: out.model, target: out.queries.join(', ').slice(0, 200) } });
      if (out.items.length)
        await notify({ user: owner, type: 'agent', workspace: project.workspace, project: project.id, text: `Agent có ${out.items.length} gợi ý công cụ mới cho dự án ${project.name}`, dedupeKey: claimKey });
    } catch (e) {
      await prisma.agentRun.update({ where: { claimKey }, data: { status: 'failed', error: e.details?.code || e.code || 'AGENT_FAILED' } });
      console.error('[agent] gợi ý hằng ngày lỗi:', e.details?.code || e.code || 'AGENT_FAILED');
    }
  }
  return { ran };
}
