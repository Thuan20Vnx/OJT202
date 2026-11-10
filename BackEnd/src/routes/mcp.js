import { Router } from 'express';
import { z } from 'zod';
import { USER, isId, prisma } from '../db.js';
import { assertManage, assertWrite, middlewareProject, projectAccess } from '../middleware/access.js';
import { answerLimit, reportLimit, requireAgentToken } from '../services/agent-tokens.js';
import { validateAgentAnswer, validateAgentMeeting, validateAgentPlan, validateAgentReport } from '../services/ai/contracts.js';
import { createAiDraft, projectMembers } from '../services/ai/drafts.js';
import { collectSources, sourceFingerprint } from '../services/ai/qa.js';
import { connectionOf, makeItems, repoProgress } from '../services/repo/agent.js';
import { redactSecrets } from '../services/repo/secrets.js';
import { emitProject } from '../services/realtime.js';
import { badRequest, notFound, parse } from '../utils/http.js';

/**
 * API cho MCP server chạy trên máy người dùng (gói taskflow/mcp). Xác thực bằng token agent,
 * mang đúng quyền của người tạo token. Agent chỉ đọc và gửi bản nháp (báo cáo, kế hoạch, việc từ biên bản họp);
 * tạo việc vẫn do PM duyệt trên web.
 */
const router = Router();
router.use(requireAgentToken);

const taskSelect = { id: true, key: true, title: true, status: true, priority: true, dueDate: true, labels: true, sprint: true, progressPct: true, assigneeRef: { select: { name: true, email: true } } };

router.get('/me', async (req, res) => {
  res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email }, token: { name: req.agentToken.name, expiresAt: req.agentToken.expiresAt } });
});

router.get('/projects', async (req, res) => {
  const projects = await prisma.project.findMany({
    where: { memberships: { some: { user: req.user.id } }, workspaceRef: { memberships: { some: { user: req.user.id } } } },
    select: { id: true, name: true, keyPrefix: true, status: true, description: true, workspaceRef: { select: { name: true } }, repoConnection: { select: { provider: true, baseUrl: true, repoPath: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  res.json({
    projects: projects.map(({ workspaceRef, repoConnection: repo, ...p }) => ({ projectId: p.id, ...p, workspace: workspaceRef.name, repo: repo ? `${repo.baseUrl}/${repo.repoPath}` : null })),
  });
});

router.get('/projects/:projectId/tasks', middlewareProject(), async (req, res) => {
  const query = parse(z.object({
    status: z.enum(['todo', 'in_progress', 'review', 'done']).optional(),
    mine: z.enum(['true', 'false']).optional(),
    q: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  }), req.query);
  const tasks = await prisma.task.findMany({
    where: {
      project: req.pa.project.id, deletedAt: null,
      ...(query.status && { status: query.status }),
      ...(query.mine === 'true' && { assignee: req.user.id }),
      ...(query.q && { OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { key: { equals: query.q.toUpperCase() } }] }),
    },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    take: query.limit,
    select: taskSelect,
  });
  res.json({ tasks: tasks.map(({ assigneeRef, ...t }) => ({ ...t, assignee: assigneeRef?.name ?? null })) });
});

router.get('/projects/:projectId/tasks/:key', middlewareProject(), async (req, res) => {
  const where = isId(req.params.key) ? { id: req.params.key } : { key: req.params.key.toUpperCase() };
  const task = await prisma.task.findFirst({
    where: { ...where, project: req.pa.project.id, deletedAt: null },
    select: { ...taskSelect, description: true, acceptanceCriteria: true, estimateHours: true, spentHours: true, blockedBy: true, checklistItems: { select: { title: true, isDone: true }, orderBy: { position: 'asc' } }, comments: { where: { deletedAt: null }, select: { body: true, createdAt: true, authorRef: { select: USER } }, orderBy: { createdAt: 'desc' }, take: 10 } },
  });
  if (!task) throw notFound('Không tìm thấy công việc');
  const { assigneeRef, comments, ...rest } = task;
  res.json({ task: { ...rest, assignee: assigneeRef?.name ?? null, comments: comments.map((c) => ({ author: c.authorRef?.name ?? null, body: c.body, createdAt: c.createdAt })) } });
});

router.get('/projects/:projectId/repo-progress', middlewareProject(), async (req, res) => {
  res.json({ progress: await repoProgress(await connectionOf(req.pa.project.id), req.pa.project) });
});

/** Agent gửi kết quả (review, quét bảo mật, gợi ý). Bí mật lỡ dán vào báo cáo được che trước khi lưu. */
router.post('/projects/:projectId/reports', middlewareProject(), async (req, res) => {
  assertWrite(req.pa);
  await reportLimit(req.agentToken.id);
  const report = validateAgentReport(req.body);
  const clean = (value) => (typeof value === 'string' ? redactSecrets(value).text : value);
  const items = report.items.map((item) => Object.fromEntries(Object.entries(item).map(([k, v]) => [k, clean(v)])));
  const project = req.pa.project;
  // Quyền có thể đổi giữa lúc kiểm tra và lúc lưu: kiểm lại ngay trước khi ghi.
  assertWrite(await projectAccess(req.user.id, project.id));
  const run = await prisma.agentRun.create({
    data: {
      workspace: project.workspace, project: project.id, user: req.user.id, kind: report.kind, source: 'mcp',
      agentName: (report.agent || req.agentToken.name).slice(0, 80), title: clean(report.title), summary: clean(report.summary), target: report.target ? clean(report.target) : null, items: makeItems(items),
    },
    omit: { claimKey: true },
  });
  emitProject(project.id, 'agent:run', { id: run.id });
  res.status(201).json({ run: { id: run.id, kind: run.kind, items: run.items.length }, dropped: report.dropped, message: `Đã gửi báo cáo vào tab Agent của dự án${report.dropped ? `; bỏ ${report.dropped} mục sai định dạng (cần title và detail)` : ''}. PM duyệt từng mục để tạo công việc.` });
});

// ===================== HỎI ĐÁP DỰ ÁN =====================
router.get('/projects/:projectId/overview', middlewareProject(), async (req, res) => {
  const project = req.pa.project;
  const [members, roles, byStatus, overdue] = await Promise.all([
    projectMembers(project),
    prisma.projectMember.findMany({ where: { project: project.id }, select: { user: true, role: true } }),
    prisma.task.groupBy({ by: ['status'], where: { project: project.id, deletedAt: null }, _count: true }),
    prisma.task.count({ where: { project: project.id, deletedAt: null, status: { not: 'done' }, dueDate: { lt: new Date() } } }),
  ]);
  res.json({
    project: { projectId: project.id, name: project.name, keyPrefix: project.keyPrefix, status: project.status, description: project.description, timezone: project.timezone, sprint: project.sprint },
    // memberId dùng cho trường assignee khi gửi việc từ biên bản họp (đặt tên riêng vì API đổi id thành _id)
    members: members.map((m) => ({ memberId: m.id, name: m.name, jobTitle: m.jobTitle || null, role: roles.find((r) => r.user === m.id)?.role ?? null })),
    tasks: { ...Object.fromEntries(['todo', 'in_progress', 'review', 'done'].map((status) => [status, byStatus.find((row) => row.status === status)?._count ?? 0])), overdue },
    you: { canWrite: req.pa.canWrite, canManage: req.pa.canManage },
  });
});

/**
 * Mã riêng cho từng nguồn để agent trích dẫn: nhiều bình luận cùng việc và nhiều đoạn cùng tài liệu
 * có chung refId, nên bình luận dùng id bình luận, đoạn tài liệu thêm số thứ tự đoạn.
 */
function withRefs(sources) {
  const parts = new Map();
  return sources.map((source) => {
    if (source.kind === 'comment') return { ref: `comment:${source.sourceId}`, source };
    if (source.kind !== 'document') return { ref: `${source.kind}:${source.refId}`, source };
    const part = (parts.get(source.refId) || 0) + 1;
    parts.set(source.refId, part);
    return { ref: `document:${source.refId}:${part}`, source };
  });
}

const words = (value) => String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1);

/** Tìm trong công việc, bình luận và tài liệu văn bản của dự án: cùng bộ nguồn với Hỏi đáp trên web. */
router.get('/projects/:projectId/search', middlewareProject(), async (req, res) => {
  const query = parse(z.object({ q: z.string().trim().min(2, 'Từ khóa quá ngắn').max(300), limit: z.coerce.number().int().min(1).max(20).default(8) }), req.query);
  const wanted = [...new Set(words(query.q))];
  const keys = (query.q.match(/[A-Za-z]{2,5}-\d+/g) || []).map((key) => key.toUpperCase());
  const sources = await collectSources(req.pa.project.id);
  const results = withRefs(sources)
    .map(({ ref, source }) => {
      const found = new Set(words(`${source.label} ${source.text}`));
      return { ref, source, score: wanted.filter((word) => found.has(word)).length + (source.key && keys.includes(source.key) ? 5 : 0) };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.source.updatedAt) - new Date(a.source.updatedAt))
    .slice(0, query.limit)
    // ref: mã nguồn để trích dẫn khi lưu câu trả lời bằng save_answer
    .map(({ ref, source, score }) => ({ ref, kind: source.kind, label: source.label, key: source.key ?? null, text: source.text.slice(0, 2000), updatedAt: source.updatedAt, score }));
  res.json({ results, searched: sources.length, note: results.length ? undefined : 'Không tìm thấy nguồn khớp. Thử từ khóa khác; nếu vẫn không có thì nói rõ là dự án chưa ghi nhận thông tin này, không tự suy đoán.' });
});

/**
 * Lưu câu trả lời agent đã viết vào Hỏi đáp dự án trên web (lịch sử của người tạo token).
 * TaskFlow không chấm nội dung, chỉ giữ trích dẫn trỏ tới nguồn có thật trong dự án và che bí mật.
 */
router.post('/projects/:projectId/answers', middlewareProject(), async (req, res) => {
  assertWrite(req.pa);
  await answerLimit(req.agentToken.id);
  const body = validateAgentAnswer(req.body);
  const project = req.pa.project;
  const existing = body.conversationId ? await prisma.aiConversation.findFirst({ where: { id: body.conversationId, user: req.user.id, project: project.id } }) : null;
  if (body.conversationId && !existing) throw notFound('Không tìm thấy cuộc hỏi đáp để nối tiếp');
  const sources = await collectSources(project.id);
  const byRef = new Map(withRefs(sources).map(({ ref, source }) => [ref, source]));
  const used = new Set();
  // Trích dẫn [n] trong câu trả lời đánh số theo thứ tự mảng citations; nguồn không có thật bị bỏ cùng số của nó.
  const kept = [];
  const renumber = new Map();
  body.citations.forEach((citation, index) => {
    const source = byRef.get(citation.ref);
    if (!source || used.has(citation.ref)) return;
    used.add(citation.ref);
    const quoted = citation.excerpt && source.text.includes(citation.excerpt);
    const n = kept.length + 1;
    renumber.set(index + 1, n);
    // kind/refId giữ như trích dẫn của AI trên web để nút mở nguồn và cảnh báo nguồn đổi chạy như cũ.
    kept.push({ n, kind: source.kind, refId: source.refId, label: source.label, excerpt: quoted ? citation.excerpt : source.text.slice(0, 140) });
  });
  const clean = (value) => redactSecrets(value).text;
  const content = clean(body.answer).replace(/\[(\d+)\]/g, (_m, n) => (renumber.has(Number(n)) ? `[${renumber.get(Number(n))}]` : ''));
  const agent = (body.agent || req.agentToken.name).slice(0, 80);
  // Quyền có thể đổi trong lúc xử lý: kiểm lại ngay trước khi ghi.
  assertWrite(await projectAccess(req.user.id, project.id));
  const now = new Date().toISOString();
  const messages = [
    ...(existing?.messages || []),
    { role: 'user', content: clean(body.question), createdAt: now, agent },
    { role: 'assistant', content, refused: false, citations: kept, sourceRevision: sourceFingerprint(sources), createdAt: now, agent },
  ];
  if (messages.length > 200) throw badRequest('Cuộc hỏi đáp đã quá dài, hãy bắt đầu cuộc mới (bỏ conversationId)');
  const conversation = existing
    ? await prisma.aiConversation.update({ where: { id: existing.id }, data: { messages } })
    : await prisma.aiConversation.create({ data: { workspace: project.workspace, project: project.id, user: req.user.id, title: clean(body.question).slice(0, 80), messages } });
  const dropped = body.citations.length - kept.length;
  res.status(201).json({
    conversationId: conversation.id,
    citations: kept.length,
    dropped,
    message: `Đã lưu vào TaskFlow › Trợ lý AI › Hỏi đáp dự án › Lịch sử hỏi đáp${dropped ? `; bỏ ${dropped} trích dẫn không có trong dự án (ref phải lấy từ search_project)` : ''}. Muốn hỏi tiếp trong cùng cuộc thì gửi kèm conversationId này.`,
  });
});

// ===================== BẢN NHÁP KẾ HOẠCH / BIÊN BẢN HỌP =====================
const draftReply = (res, draft, where, extra = '') => res.status(201).json({
  draft: { id: draft.id, type: draft.type, title: draft.title, items: draft.items.length },
  message: `Đã lưu bản nháp ${draft.items.length} công việc. Chưa có công việc nào được tạo: PM mở TaskFlow › Trợ lý AI › ${where} › Lịch sử gần đây để sửa và duyệt.${extra}`,
});

/** Agent soạn kế hoạch => bản nháp của người tạo token, hiện ở màn Lập kế hoạch giống kế hoạch AI trên web. */
router.post('/projects/:projectId/plans', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  await reportLimit(req.agentToken.id);
  const { items, agent, ...plan } = validateAgentPlan(req.body, req.user.timezone);
  const input = { ...plan, timezone: req.user.timezone, agent: (agent || req.agentToken.name).slice(0, 80) };
  draftReply(res, await createAiDraft({ project: req.pa.project, user: req.user, type: 'plan', title: plan.goal.slice(0, 120), input, items }), 'Lập kế hoạch');
});

/** Agent rút việc cần làm từ biên bản họp => bản nháp ở màn Ghi chú họp. */
router.post('/projects/:projectId/meetings', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  await reportLimit(req.agentToken.id);
  const meeting = validateAgentMeeting(req.body);
  const eligible = new Set((await projectMembers(req.pa.project)).map((m) => m.id));
  const unknown = meeting.items.filter((item) => item.assignee && !eligible.has(item.assignee)).length;
  const items = meeting.items.map((item) => ({ ...item, assignee: eligible.has(item.assignee) ? item.assignee : null }));
  const input = { title: meeting.title, text: meeting.text, agent: (meeting.agent || req.agentToken.name).slice(0, 80) };
  const draft = await createAiDraft({ project: req.pa.project, user: req.user, type: 'meeting', title: meeting.title, input, items });
  draftReply(res, draft, 'Ghi chú họp', unknown ? ` ${unknown} việc có assignee không phải thành viên làm việc của dự án nên để trống người nhận.` : '');
});

export default router;
