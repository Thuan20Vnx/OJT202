import { Router } from 'express';
import { z } from 'zod';
import { USER, isId, nextSeq, populate, populateAll, prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { assertManage, middlewareProject, projectAccess } from '../middleware/access.js';
import { logActivityIn } from '../services/activity.js';
import { withWorkspaceLock } from '../services/membership.js';
import { runAi, usageToday } from '../services/ai/gateway.js';
import { annotateConversation, collectSources, reportSourceRevision, sourceFingerprint } from '../services/ai/qa.js';
import { buildReportData } from '../services/ai/report.js';
import { notify } from '../services/notify.js';
import { emitProject } from '../services/realtime.js';
import { badRequest, conflict, notFound, parse } from '../utils/http.js';
import { randomToken } from '../utils/security.js';
import { BUSINESS_TIMEZONE, isDateInput, parseDate } from '../utils/dates.js';

const router = Router();
router.use(requireAuth);

/** Đưa về dạng JSON thuần (Date => chuỗi ISO) trước khi lưu vào cột JSONB */
const plainJson = (v) => JSON.parse(JSON.stringify(v));

async function projectMembers(project) {
  const users = await prisma.user.findMany({ where: { id: { in: project.members } }, select: USER });
  const ms = await prisma.membership.findMany({ where: { workspace: project.workspace, user: { in: project.members } } });
  return users.filter((u) => ms.some((m) => m.user === u.id && m.role !== 'viewer')).map((u) => ({ ...u, jobTitle: ms.find((m) => m.user === u.id)?.title || u.title }));
}

router.get('/projects/:projectId/ai/usage', middlewareProject(), async (req, res) => {
  const ws = await prisma.workspace.findUnique({ where: { id: req.pa.project.workspace }, select: { id: true, ai: true } });
  res.json({ used: await usageToday(ws.id), limit: ws.ai.dailyLimit, enabled: ws.ai.enabled, features: ws.ai.features });
});

// ===================== LẬP KẾ HOẠCH =====================
const loadDraft = async (id) => populate(await prisma.aiDraft.findUnique({ where: { id } }), 'items.assignee', 'user', USER);

/** Bản nháp của chính người dùng (người khác nhận 404) */
async function ownDraft(req, db = prisma) {
  const draft = isId(req.params.id) ? await db.aiDraft.findUnique({ where: { id: req.params.id } }) : null;
  if (!draft || draft.user !== req.user.id) throw notFound('Không tìm thấy bản nháp');
  return draft;
}

router.get('/projects/:projectId/ai/drafts', middlewareProject(), async (req, res) => {
  const type = req.query.type === 'meeting' ? 'meeting' : 'plan';
  const drafts = await prisma.aiDraft.findMany({ where: { project: req.pa.project.id, user: req.user.id, type }, orderBy: { createdAt: 'desc' }, take: 10 });
  res.json({ drafts: drafts.map((d) => ({ id: d.id, title: d.title, status: d.status, createdAt: d.createdAt, count: d.items.length })) });
});

router.get('/ai/drafts/:id', async (req, res) => {
  const draft = await ownDraft(req);
  await projectAccess(req.user.id, draft.project);
  res.json({ draft: await loadDraft(draft.id) });
});

async function createDraft(req, type, title, input, items) {
  const draft = await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    assertManage(await projectAccess(req.user.id, req.pa.project.id, tx));
    return tx.aiDraft.create({
      data: {
        workspace: req.pa.project.workspace,
        project: req.pa.project.id,
        user: req.user.id,
        type,
        title,
        input,
        items: plainJson(
          items.map((it) => ({
            ...it,
            dueDate: it.dueDate && isDateInput(it.dueDate) ? parseDate(it.dueDate, req.user.timezone, true) : null,
            key: randomToken(8),
            selected: true,
          })),
        ),
      },
    });
  });
  return loadDraft(draft.id);
}

router.post('/projects/:projectId/ai/plan', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  const body = parse(
    z.object({
      goal: z.string().trim().min(5, 'Mục tiêu quá ngắn').max(2000),
      deadline: z.string().nullable().optional(),
      people: z.number().int().min(1).max(50).nullable().optional(),
      maxHours: z.number().min(1).max(5000).nullable().optional(),
    }),
    req.body,
  );
  if (body.deadline && !isDateInput(body.deadline)) throw badRequest('Hạn hoàn thành không hợp lệ');
  const deadline = body.deadline ? parseDate(body.deadline, req.user.timezone, true) : null;
  if (deadline && deadline.getTime() < Date.now()) throw badRequest('Hạn hoàn thành kế hoạch đã qua');
  const members = await projectMembers(req.pa.project);
  const out = await runAi({
    workspaceId: req.pa.project.workspace,
    userId: req.user.id,
    feature: 'planner',
    payload: { goal: body.goal, deadline: deadline?.toISOString() ?? null, people: body.people ?? null, maxHours: body.maxHours ?? null, members, timezone: req.user.timezone },
  });
  const draft = await createDraft(req, 'plan', body.goal.slice(0, 120), { ...body, deadline: deadline?.toISOString() ?? null, timezone: req.user.timezone }, out.items);
  res.status(201).json({ draft, meta: out._meta });
});

const itemPatch = z.object({
  key: z.string(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  acceptanceCriteria: z.array(z.string().max(300)).optional(),
  estimateHours: z.number().min(0).max(1000).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  assignee: z.string().nullable().optional(),
  dueDate: z
    .string()
    .refine((s) => !s || isDateInput(s), 'Ngày không hợp lệ; thời điểm phải có múi giờ')
    .nullable()
    .optional(),
  selected: z.boolean().optional(),
});

router.patch('/ai/drafts/:id', async (req, res) => {
  const initial = await ownDraft(req);
  const body = parse(z.object({ items: z.array(itemPatch).optional(), removeKeys: z.array(z.string()).optional() }), req.body);
  await withWorkspaceLock(initial.workspace, async (tx) => {
    const draft = await ownDraft(req, tx);
    const access = await projectAccess(req.user.id, draft.project, tx);
    assertManage(access);
    if (draft.status !== 'draft') throw badRequest('Bản nháp đã được duyệt hoặc hủy');
    let items = draft.items;
    for (const p of body.items || []) {
      const it = items.find((x) => x.key === p.key);
      if (!it) continue;
      if (p.assignee && !access.project.members.includes(p.assignee)) throw badRequest('Người nhận phải là thành viên dự án');
      if (p.assignee) {
        const member = await tx.membership.findUnique({ where: { workspace_user: { workspace: initial.workspace, user: p.assignee } } });
        if (!member || member.role === 'viewer') throw badRequest('Người nhận phải có quyền làm việc trong dự án');
      }
      Object.assign(it, {
        ...p,
        dueDate: p.dueDate === undefined ? it.dueDate : p.dueDate ? parseDate(p.dueDate, req.user.timezone, true).toISOString() : null,
        assignee: p.assignee === undefined ? it.assignee : p.assignee || null,
      });
    }
    if (body.removeKeys) items = items.filter((x) => !body.removeKeys.includes(x.key));
    await tx.aiDraft.update({ where: { id: draft.id }, data: { items } });
  });
  res.json({ draft: await loadDraft(initial.id) });
});

router.post('/ai/drafts/:id/discard', async (req, res) => {
  const initial = await ownDraft(req);
  await withWorkspaceLock(initial.workspace, async (tx) => {
    const draft = await ownDraft(req, tx);
    assertManage(await projectAccess(req.user.id, draft.project, tx));
    if (draft.status === 'draft') await tx.aiDraft.update({ where: { id: draft.id }, data: { status: 'discarded' } });
  });
  res.json({ ok: true });
});

/**
 * Duyệt bản nháp => tạo công việc thật. Idempotent: mỗi item có aiDraftItem duy nhất
 * (UNIQUE project + aiDraftItem), bấm duyệt nhiều lần hoặc song song không tạo trùng.
 */
router.post('/ai/drafts/:id/approve', async (req, res) => {
  const initial = await ownDraft(req);
  const { project, created, newTasks } = await withWorkspaceLock(initial.workspace, async (tx) => {
    const draft = await ownDraft(req, tx);
    const access = await projectAccess(req.user.id, draft.project, tx);
    assertManage(access);
    if (draft.status === 'discarded') throw badRequest('Bản nháp đã bị hủy');
    if (draft.status === 'draft') {
      const selected = draft.items.filter((x) => x.selected);
      if (!selected.length) throw badRequest('Chọn ít nhất một công việc để duyệt');
      if (draft.type === 'plan') {
        const total = selected.reduce((sum, it) => sum + (it.estimateHours ?? 0), 0);
        if (draft.input?.maxHours != null && total > draft.input.maxHours + 1e-9) throw badRequest(`Tổng giờ đã chọn vượt giới hạn ${draft.input.maxHours} giờ của kế hoạch`);
        const limit = draft.input?.deadline ? parseDate(draft.input.deadline, draft.input.timezone || req.user.timezone, true) : null;
        if (limit && selected.some((it) => it.dueDate && parseDate(it.dueDate, req.user.timezone, true) > limit))
          throw badRequest('Có công việc vượt hạn hoàn thành kế hoạch; hãy sửa hạn trước khi duyệt');
      }
    }
    const project = access.project;
    const created = [];
    const newTasks = [];
    const members = await tx.membership.findMany({ where: { workspace: project.workspace, user: { in: project.members }, role: { not: 'viewer' } }, select: { user: true } });
    const projectMembers = await tx.projectMember.findMany({ where: { project: project.id, role: { not: 'viewer' } }, select: { user: true } });
    const eligible = new Set(projectMembers.map((m) => m.user).filter((id) => members.some((m) => m.user === id)));
    const findCreated = async (aiDraftItem) => (await tx.task.findUnique({ where: { project_aiDraftItem: { project: project.id, aiDraftItem } }, select: { id: true } }))?.id;
    for (const it of draft.items.filter((x) => x.selected)) {
      if (it.createdTask) {
        created.push(it.createdTask);
        continue;
      }
      const aiDraftItem = `${draft.id}:${it.key}`;
      const existing = await findCreated(aiDraftItem);
      if (existing) {
        it.createdTask = existing;
        created.push(existing);
        continue;
      }
      const number = await nextSeq(`task:${project.id}`, tx);
      const task = await tx.task.create({
        data: {
          workspace: project.workspace,
          project: project.id,
          number,
          key: `${project.keyPrefix}-${number}`,
          title: it.title,
          description: [it.description, it.excerpt ? `Trích biên bản: “${it.excerpt}”` : ''].filter(Boolean).join('\n\n'),
          acceptanceCriteria: it.acceptanceCriteria || [],
          estimateHours: it.estimateHours ?? null,
          remainingHours: it.estimateHours ?? null,
          priority: it.priority || 'medium',
          assignee: eligible.has(it.assignee) ? it.assignee : null,
          dueDate: it.dueDate ? parseDate(it.dueDate, req.user.timezone, true) : null,
          creator: req.user.id,
          sprint: project.sprint?.name || '',
          order: Date.now() + created.length,
          source: draft.type === 'meeting' ? 'ai_meeting' : 'ai_planner',
          aiDraftItem,
        },
      });
      it.createdTask = task.id;
      created.push(task.id);
      newTasks.push(task);
      await logActivityIn(tx, {
        workspace: task.workspace,
        project: task.project,
        actor: req.user.id,
        action: 'Tạo công việc từ AI',
        entityType: 'task',
        entityId: task.id,
        entityLabel: `${task.key} ${task.title}`,
      });
    }
    const first = draft.status !== 'approved';
    await tx.aiDraft.update({ where: { id: draft.id }, data: { items: draft.items, status: 'approved', approvedAt: draft.approvedAt || new Date() } });
    if (first) {
      await logActivityIn(tx, {
        workspace: project.workspace,
        project: project.id,
        actor: req.user.id,
        action: draft.type === 'meeting' ? 'Tạo việc từ biên bản họp' : 'Duyệt kế hoạch AI',
        entityType: 'ai',
        entityId: draft.id,
        entityLabel: draft.title,
        after: `${created.length} công việc`,
      });
    }
    return { project, created, newTasks };
  });
  for (const task of newTasks) {
    if (task.assignee)
      await notify({
        user: task.assignee,
        actor: req.user.id,
        type: 'assigned',
        workspace: task.workspace,
        project: task.project,
        task: task.id,
        text: `${req.user.name} đã giao cho bạn ${task.key} ${task.title}`,
        dedupeKey: `assigned:${task.id}:${task.assignee}`,
      });
  }
  emitProject(project.id, 'board:refresh', {});
  const tasks = await prisma.task.findMany({ where: { id: { in: created } }, select: { id: true, key: true, title: true, status: true, assignee: true } });
  res.json({ ok: true, created: tasks });
});

// ===================== GHI CHÚ HỌP =====================
router.post('/projects/:projectId/ai/meeting', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  const body = parse(z.object({ title: z.string().trim().min(1, 'Nhập tên cuộc họp').max(200), text: z.string().trim().min(10, 'Biên bản quá ngắn').max(30000) }), req.body);
  const members = await projectMembers(req.pa.project);
  const out = await runAi({ workspaceId: req.pa.project.workspace, userId: req.user.id, feature: 'meeting', payload: { text: body.text, members, timezone: req.user.timezone } });
  const draft = await createDraft(req, 'meeting', body.title, body, out.items);
  res.status(201).json({ draft, meta: out._meta });
});

// ===================== BÁO CÁO TIẾN ĐỘ =====================
async function loadReport(id) {
  const report = await prisma.aiReport.findUnique({ where: { id } });
  if (!report) return null;
  const revision = await reportSourceRevision(report.project);
  report.sourceState = !report.sourceRevision ? 'unknown' : report.sourceRevision === revision ? 'current' : 'changed';
  const expectedSources = report.sourceTasks.length;
  await populateAll(report, [
    ['sections.refs', 'task', { key: true, title: true, status: true }],
    ['sourceTasks', 'task', { key: true, title: true, status: true }],
    ['user', 'user', USER],
  ]);
  report.missingSources = expectedSources - report.sourceTasks.length;
  return report;
}

router.get('/projects/:projectId/ai/reports', middlewareProject(), async (req, res) => {
  const reports = await prisma.aiReport.findMany({
    where: { project: req.pa.project.id, OR: [{ user: req.user.id }, { status: 'shared' }] },
    omit: { sections: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  await populate(reports, 'user', 'user', USER);
  res.json({ reports });
});

router.get('/ai/reports/:id', async (req, res) => {
  const report = isId(req.params.id) ? await loadReport(req.params.id) : null;
  if (!report) throw notFound('Không tìm thấy báo cáo');
  await projectAccess(req.user.id, report.project);
  if (report.status !== 'shared' && report.user?.id !== req.user.id) throw notFound('Không tìm thấy báo cáo');
  res.json({ report });
});

router.post('/projects/:projectId/ai/reports', middlewareProject(), async (req, res) => {
  assertManage(req.pa);
  const body = parse(z.object({ from: z.string(), to: z.string(), template: z.enum(['week', 'sprint', 'lecturer']).default('week') }), req.body);
  if (!isDateInput(body.from) || !isDateInput(body.to)) throw badRequest('Khoảng ngày không hợp lệ');
  const from = parseDate(body.from);
  const to = parseDate(body.to, BUSINESS_TIMEZONE, true);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) throw badRequest('Khoảng ngày không hợp lệ');
  const project = req.pa.project;
  const revision = await reportSourceRevision(project.id);
  const data = await buildReportData(project.id, from, to, project);
  // AIService chỉ viết tóm tắt & đề xuất từ số liệu đã tính sẵn bằng truy vấn DB
  const narrative = await runAi({
    workspaceId: project.workspace,
    userId: req.user.id,
    feature: 'report',
    payload: {
      project: { name: project.name },
      data: { stats: data.stats, sections: data.sections.map(({ title, body }) => ({ title, body })), risks: data.risks.map(({ title, type }) => ({ title, type })) },
      from: from.toISOString(),
      to: to.toISOString(),
    },
  });
  const tpl = { week: 'Báo cáo tiến độ tuần', sprint: 'Báo cáo Sprint', lecturer: 'Báo cáo cho giảng viên' }[body.template];
  const fmt = (d) => d.toLocaleDateString('vi-VN', { timeZone: BUSINESS_TIMEZONE, day: '2-digit', month: '2-digit' });
  const report = await withWorkspaceLock(project.workspace, async (tx) => {
    assertManage(await projectAccess(req.user.id, project.id, tx));
    if ((await reportSourceRevision(project.id)) !== revision) throw conflict('Nguồn dự án đã thay đổi trong lúc tạo báo cáo. Vui lòng tạo lại.', { code: 'AI_SOURCES_CHANGED' });
    return tx.aiReport.create({
      data: {
        workspace: project.workspace,
        project: project.id,
        user: req.user.id,
        title: `${tpl} ${fmt(from)}–${fmt(to)} – ${project.name}`,
        template: body.template,
        from,
        to,
        sourceRevision: revision,
        stats: data.stats,
        sections: [
          { key: 'summary', title: 'Tóm tắt', body: narrative.summary, refs: [], aiSuggested: true },
          ...data.sections,
          { key: 'suggestions', title: 'Đề xuất', body: narrative.suggestions, refs: data.risks.flatMap((r) => r.tasks.map((t) => t.id)).slice(0, 10), aiSuggested: true },
        ],
        sourceTasks: data.sourceTasks,
      },
    });
  });
  res.status(201).json({ report: await loadReport(report.id), meta: narrative._meta });
});

router.patch('/ai/reports/:id', async (req, res) => {
  const found = isId(req.params.id) ? await prisma.aiReport.findUnique({ where: { id: req.params.id } }) : null;
  if (!found || found.user !== req.user.id) throw notFound('Không tìm thấy báo cáo');
  await withWorkspaceLock(found.workspace, async (tx) => {
    assertManage(await projectAccess(req.user.id, found.project, tx));
    const report = await tx.aiReport.findUniqueOrThrow({ where: { id: found.id } });
    const body = parse(
      z.object({
        title: z.string().trim().min(1).max(200).optional(),
        sections: z.array(z.object({ key: z.string(), title: z.string().max(200).optional(), body: z.string().max(20000).optional() })).optional(),
        removeKeys: z.array(z.string()).optional(),
        share: z.boolean().optional(),
      }),
      req.body,
    );
    const data = {};
    if (body.title) data.title = body.title;
    let sections = report.sections;
    for (const s of body.sections || []) {
      const sec = sections.find((x) => x.key === s.key);
      if (sec) Object.assign(sec, s);
    }
    if (body.removeKeys) sections = sections.filter((s) => !body.removeKeys.includes(s.key));
    data.sections = sections;
    if (body.share && report.status !== 'shared') {
      Object.assign(data, { status: 'shared', sharedAt: new Date() });
      await logActivityIn(tx, {
        workspace: report.workspace,
        project: report.project,
        actor: req.user.id,
        action: 'Chia sẻ báo cáo',
        entityType: 'ai',
        entityId: report.id,
        entityLabel: data.title || report.title,
      });
    }
    await tx.aiReport.update({ where: { id: report.id }, data });
  });
  res.json({ report: await loadReport(found.id) });
});

router.delete('/ai/reports/:id', async (req, res) => {
  const report = isId(req.params.id) ? await prisma.aiReport.findFirst({ where: { id: req.params.id, user: req.user.id } }) : null;
  if (report)
    await withWorkspaceLock(report.workspace, async (tx) => {
      assertManage(await projectAccess(req.user.id, report.project, tx));
      await tx.aiReport.deleteMany({ where: { id: report.id, user: req.user.id, status: 'draft' } });
    });
  res.json({ ok: true });
});

// ===================== HỎI ĐÁP DỰ ÁN =====================
router.get('/projects/:projectId/ai/conversations', middlewareProject(), async (req, res) => {
  const convs = await prisma.aiConversation.findMany({ where: { project: req.pa.project.id, user: req.user.id }, orderBy: { updatedAt: 'desc' }, take: 20 });
  res.json({ conversations: convs.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, count: c.messages.length })) });
});

router.get('/ai/conversations/:id', async (req, res) => {
  const conv = isId(req.params.id) ? await prisma.aiConversation.findFirst({ where: { id: req.params.id, user: req.user.id } }) : null;
  if (!conv) throw notFound('Không tìm thấy cuộc hỏi đáp');
  await projectAccess(req.user.id, conv.project);
  res.json({ conversation: annotateConversation(conv, await collectSources(conv.project)) });
});

router.post('/projects/:projectId/ai/ask', middlewareProject(), async (req, res) => {
  const body = parse(z.object({ question: z.string().trim().min(3, 'Câu hỏi quá ngắn').max(1000), conversation: z.string().optional() }), req.body);
  const project = req.pa.project;
  const existing = isId(body.conversation) ? await prisma.aiConversation.findFirst({ where: { id: body.conversation, user: req.user.id, project: project.id } }) : null;
  // Lọc quyền TRƯỚC khi tìm kiếm: chỉ dữ liệu của dự án đã kiểm quyền
  const sources = await collectSources(project.id);
  const out = await runAi({ workspaceId: project.workspace, userId: req.user.id, feature: 'qa', payload: { question: body.question, projectName: project.name, sources } });
  // Kiểm lại quyền trước khi trả kết quả (phòng quyền bị thu hồi trong lúc AI chạy)
  const conversation = await withWorkspaceLock(project.workspace, async (tx) => {
    await projectAccess(req.user.id, project.id, tx);
    if (sourceFingerprint(sources) !== sourceFingerprint(await collectSources(project.id))) {
      throw conflict('Nguồn dự án đã thay đổi trong lúc AI trả lời. Vui lòng hỏi lại để dùng dữ liệu mới nhất.', { code: 'AI_SOURCES_CHANGED' });
    }
    const now = new Date().toISOString();
    const current = existing ? await tx.aiConversation.findUnique({ where: { id: existing.id } }) : null;
    if (existing && !current) throw conflict('Cuộc hỏi đáp đã bị xóa. Vui lòng tạo cuộc hỏi đáp mới.');
    const messages = [
      ...(current?.messages || []),
      { role: 'user', content: body.question, createdAt: now },
      plainJson({ role: 'assistant', content: out.content, refused: out.refused, citations: out.citations, sourceRevision: sourceFingerprint(sources), createdAt: now }),
    ];
    return current
      ? tx.aiConversation.update({ where: { id: current.id }, data: { messages } })
      : tx.aiConversation.create({ data: { workspace: project.workspace, project: project.id, user: req.user.id, title: body.question.slice(0, 80), messages } });
  });
  res.json({ conversation: annotateConversation(conversation, sources), meta: out._meta });
});

router.delete('/ai/conversations/:id', async (req, res) => {
  if (isId(req.params.id)) await prisma.aiConversation.deleteMany({ where: { id: req.params.id, user: req.user.id } });
  res.json({ ok: true });
});

export default router;
