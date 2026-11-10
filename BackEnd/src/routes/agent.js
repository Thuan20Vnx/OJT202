import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { isId, nextSeq, prisma } from '../db.js';
import { assertActiveSession, requireAuth } from '../middleware/auth.js';
import { assertManage, middlewareProject, projectAccess } from '../middleware/access.js';
import { logActivity, logActivityIn } from '../services/activity.js';
import { createAgentToken, listAgentTokens, revokeAgentToken } from '../services/agent-tokens.js';
import { withWorkspaceLock } from '../services/membership.js';
import { emitProject } from '../services/realtime.js';
import { encryptToken, parseRepoUrl, repoClient } from '../services/repo/client.js';
import { buildDiscovery, connectionOf, repoProgress } from '../services/repo/agent.js';
import { badRequest, notFound, parse } from '../utils/http.js';

const router = Router();
router.use(requireAuth);

const webUrl = (c) => `${c.baseUrl}/${c.repoPath}`;
const publicConnection = (c) => c && { provider: c.provider, repoPath: c.repoPath, webUrl: webUrl(c), defaultBranch: c.defaultBranch, hasToken: !!c.tokenEnc, updatedAt: c.updatedAt };
const hideClaim = { claimKey: true };
const settingsOf = (p) => ({ daily: p.agentDaily, dailyTime: p.agentDailyTime, timezone: p.timezone });

// ===================== KẾT NỐI REPO (chỉ metadata) =====================
router.get('/projects/:projectId/repo', middlewareProject(), async (req, res) => {
  const conn = await prisma.repoConnection.findUnique({ where: { project: req.pa.project.id } });
  res.json({ connection: publicConnection(conn), settings: settingsOf(req.pa.project), canManage: req.pa.canManage, canWrite: req.pa.canWrite });
});

router.put('/projects/:projectId/repo', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  const body = parse(z.object({
    provider: z.enum(['github', 'gitlab']),
    url: z.string().trim().min(1, 'Nhập đường dẫn repo').max(500),
    token: z.string().trim().max(500).optional(),
  }).strict(), req.body);
  const project = req.pa.project;
  const { baseUrl, repoPath } = parseRepoUrl(body.provider, body.url);
  const current = await prisma.repoConnection.findUnique({ where: { project: project.id } });
  // Đổi repo mà không nhập token mới thì bỏ token cũ, tránh gửi token sang repo hoặc máy chủ khác.
  const sameRepo = current && current.provider === body.provider && current.baseUrl === baseUrl && current.repoPath === repoPath;
  const tokenEnc = body.token ? encryptToken(body.token) : sameRepo ? current.tokenEnc : null;
  const info = await repoClient({ provider: body.provider, baseUrl, repoPath, tokenEnc, defaultBranch: 'main' }).info();
  if (!info) throw badRequest('Không tìm thấy repo. Repo riêng tư thì cần nhập token có quyền đọc.');
  const data = { provider: body.provider, baseUrl, repoPath, tokenEnc, defaultBranch: info.defaultBranch };
  const conn = await prisma.repoConnection.upsert({
    where: { project: project.id },
    update: data,
    create: { ...data, workspace: project.workspace, project: project.id, createdBy: req.user.id },
  });
  await logActivity({ workspace: project.workspace, project: project.id, actor: req.user.id, action: 'Kết nối repo', entityType: 'ai', entityLabel: `${body.provider}: ${repoPath}` });
  res.json({ connection: publicConnection(conn) });
});

router.delete('/projects/:projectId/repo', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  const { count } = await prisma.repoConnection.deleteMany({ where: { project: req.pa.project.id } });
  if (count) await logActivity({ workspace: req.pa.project.workspace, project: req.pa.project.id, actor: req.user.id, action: 'Ngắt kết nối repo', entityType: 'ai', entityLabel: req.pa.project.name });
  res.json({ ok: true });
});

router.get('/projects/:projectId/repo/progress', middlewareProject(), async (req, res) => {
  res.json({ progress: await repoProgress(await connectionOf(req.pa.project.id), req.pa.project) });
});

// ===================== GỢI Ý HẰNG NGÀY =====================
router.patch('/projects/:projectId/agent/settings', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  const body = parse(z.object({
    daily: z.boolean().optional(),
    dailyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ phải có dạng HH:MM, ví dụ 08:00').optional(),
  }).strict(), req.body);
  const project = await prisma.project.update({
    where: { id: req.pa.project.id },
    data: { ...(body.daily !== undefined && { agentDaily: body.daily }), ...(body.dailyTime && { agentDailyTime: body.dailyTime }) },
  });
  await logActivity({ workspace: project.workspace, project: project.id, actor: req.user.id, action: 'Cập nhật gợi ý hằng ngày của Agent', entityType: 'ai', entityLabel: project.name, after: project.agentDaily ? `Bật, ${project.agentDailyTime}` : 'Tắt' });
  res.json({ settings: settingsOf(project) });
});

router.post('/projects/:projectId/agent/suggest', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  const project = req.pa.project;
  const out = await buildDiscovery(project, req.user.id);
  // Quyền có thể bị thu hồi trong lúc AI chạy: kiểm tra lại rồi mới lưu.
  assertManage(await projectAccess(req.user.id, project.id));
  const run = await prisma.agentRun.create({
    data: { workspace: project.workspace, project: project.id, user: req.user.id, kind: 'suggest', title: 'Gợi ý skill, plugin và công cụ', target: out.queries.join(', ').slice(0, 200), summary: out.summary, items: out.items, model: out.model },
    omit: hideClaim,
  });
  res.status(201).json({ run });
});

router.get('/projects/:projectId/agent/runs', middlewareProject(), async (req, res) => {
  const runs = await prisma.agentRun.findMany({ where: { project: req.pa.project.id, status: { not: 'running' } }, orderBy: { createdAt: 'desc' }, take: 20, omit: hideClaim });
  res.json({ runs });
});

async function findRun(req, db = prisma) {
  const run = isId(req.params.id) ? await db.agentRun.findUnique({ where: { id: req.params.id } }) : null;
  if (!run) throw notFound('Không tìm thấy kết quả của agent');
  return run;
}
const publicRun = ({ claimKey: _key, ...run }) => run;

function itemDescription(item, run) {
  const place = item.file ? `Vị trí: ${item.file}${item.line ? `:${item.line}` : ''}` : '';
  const from = run.source === 'mcp' ? `Tạo từ báo cáo của ${run.agentName || 'agent trên máy'}.` : 'Tạo từ gợi ý hằng ngày của Agent.';
  return [item.detail, item.suggestion && `Cách sửa: ${item.suggestion}`, item.url && `Liên kết: ${item.url}`, item.evidence && `Căn cứ: ${item.evidence}`, place, from].filter(Boolean).join('\n\n');
}

/** Tạo việc từ phát hiện/gợi ý. Idempotent nhờ UNIQUE (project, aiDraftItem). */
router.post('/agent/runs/:id/items/:key/accept', async (req, res) => {
  const initial = await findRun(req);
  const result = await withWorkspaceLock(initial.workspace, async (tx) => {
    await assertActiveSession(req, tx, true);
    const run = await findRun(req, tx);
    const { project } = await projectAccess(req.user.id, run.project, tx).then((access) => (assertManage(access), access));
    const item = run.items.find((x) => x.key === req.params.key);
    if (!item) throw notFound('Không tìm thấy mục này');
    if (item.state === 'dismissed') throw badRequest('Mục này đã bị bỏ qua');
    if (item.createdTask) return { run, project, created: false };
    const number = await nextSeq(`task:${project.id}`, tx);
    const task = await tx.task.create({
      data: {
        workspace: project.workspace, project: project.id, number, key: `${project.keyPrefix}-${number}`, title: item.title.slice(0, 200),
        description: itemDescription(item, run), priority: item.severity || 'medium', creator: req.user.id, sprint: project.sprint?.name || '', order: Date.now(), source: 'ai_agent', aiDraftItem: `agent:${run.id}:${item.key}`,
      },
    });
    Object.assign(item, { state: 'accepted', createdTask: task.id, taskKey: task.key });
    const updated = await tx.agentRun.update({ where: { id: run.id }, data: { items: run.items } });
    await logActivityIn(tx, { workspace: project.workspace, project: project.id, actor: req.user.id, action: 'Tạo công việc từ Agent', entityType: 'task', entityId: task.id, entityLabel: `${task.key} ${task.title}` });
    return { run: updated, project, created: true };
  });
  if (result.created) emitProject(result.project.id, 'board:refresh', {});
  res.json({ run: publicRun(result.run) });
});

router.post('/agent/runs/:id/items/:key/dismiss', async (req, res) => {
  const initial = await findRun(req);
  const run = await withWorkspaceLock(initial.workspace, async (tx) => {
    await assertActiveSession(req, tx, true);
    const current = await findRun(req, tx);
    assertManage(await projectAccess(req.user.id, current.project, tx));
    const item = current.items.find((x) => x.key === req.params.key);
    if (!item) throw notFound('Không tìm thấy mục này');
    if (item.state === 'accepted') throw badRequest('Mục này đã được tạo thành công việc');
    item.state = 'dismissed';
    return tx.agentRun.update({ where: { id: current.id }, data: { items: current.items } });
  });
  res.json({ run: publicRun(run) });
});

// ===================== TOKEN CHO AGENT TRÊN MÁY =====================
/** Thông tin để giao diện dựng sẵn cấu hình MCP cho Claude Code, Codex, Antigravity. */
const mcpInfo = (req) => ({ serverPath: path.resolve(config.root, '../mcp/src/index.js'), apiUrl: `${req.protocol}://${req.get('host')}` });

router.get('/agent-tokens', async (req, res) => {
  res.json({ tokens: await listAgentTokens(req.user.id), mcp: mcpInfo(req) });
});

router.post('/agent-tokens', async (req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(1, 'Đặt tên cho token, ví dụ "Claude Code trên laptop"').max(80), days: z.union([z.literal(7), z.literal(30), z.literal(90)]) }).strict(), req.body);
  const { token, record } = await createAgentToken(req.user.id, body);
  res.status(201).json({ token, record, mcp: mcpInfo(req) });
});

router.delete('/agent-tokens/:id', async (req, res) => {
  if (isId(req.params.id)) await revokeAgentToken(req.user.id, req.params.id);
  res.json({ ok: true });
});

export default router;
