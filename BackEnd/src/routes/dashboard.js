import { Router } from 'express';
import { z } from 'zod';
import { USER, populate, prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { assertWrite, middlewareProject, projectAccess } from '../middleware/access.js';
import { logActivityIn } from '../services/activity.js';
import { withWorkspaceLock } from '../services/membership.js';
import { emitProject } from '../services/realtime.js';
import { runAi } from '../services/ai/gateway.js';
import { projectOverview, riskAlerts, workload } from '../services/metrics.js';
import { conflict, notFound, parse } from '../utils/http.js';
import { dateKey } from '../utils/dates.js';
import { toCsv } from '../utils/security.js';

const router = Router();
router.use(requireAuth);

const brief = (t) => ({ id: t.id, key: t.key, title: t.title, status: t.status, dueDate: t.dueDate, priority: t.priority });

router.get('/projects/:projectId/overview', middlewareProject(), async (req, res) => {
  const { project } = req.pa;
  const id = project.id;
  // Tải tuần dùng chung cho thẻ "Khối lượng" và quy tắc quá tải của cảnh báo rủi ro
  const loadP = workload(id, project);
  const [ov, load, risks, recent] = await Promise.all([
    projectOverview(id, { project }),
    loadP,
    riskAlerts(id, { project, load: loadP }),
    prisma.activity.findMany({ where: { project: id }, orderBy: { createdAt: 'desc' }, take: 6 }).then((r) => populate(r, 'actor', 'user', USER)),
  ]);
  await populate(ov.overdue, 'assignee', 'user', { name: true, title: true });
  res.json({
    kpis: {
      total: ov.total,
      done: ov.done,
      progressPct: ov.progressPct,
      overdue: ov.overdue.length,
      blocked: ov.blocked.length,
      velocity: ov.velocity,
    },
    overdue: ov.overdue.map((t) => ({ ...brief(t), assignee: t.assignee })),
    blocked: ov.blocked.map(brief),
    byStatus: ov.byStatus,
    burndown: ov.burndown,
    sprint: ov.project.sprint,
    workload: load.map(({ tasks, taskIds, ...w }) => w),
    risks: risks.open.slice(0, 3),
    riskCount: risks.open.length,
    recent,
  });
});

router.get('/projects/:projectId/overview.csv', middlewareProject(), async (req, res) => {
  const ov = await projectOverview(req.pa.project.id, { project: req.pa.project });
  const rows = [
    ['Mã', 'Tên công việc', 'Trạng thái', 'Ưu tiên', 'Hạn chót', 'Hoàn thành lúc'],
    ...ov.tasks.map((t) => [t.key, t.title, t.status, t.priority, t.dueDate ? dateKey(t.dueDate) : '', t.completedAt ? new Date(t.completedAt).toISOString() : '']),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="tong-quan-du-an.csv"');
  res.send(toCsv(rows));
});

router.get('/projects/:projectId/risks', middlewareProject(), async (req, res) => {
  const data = await riskAlerts(req.pa.project.id, { project: req.pa.project });
  res.json({ ...data, access: { canManage: req.pa.canManage, canWrite: req.pa.canWrite } });
});

router.post('/projects/:projectId/risks/resolve', middlewareProject(), async (req, res) => {
  assertWrite(req.pa);
  const { key, sourceVersion, reason } = parse(z.object({
    key: z.string().min(1).max(100000), sourceVersion: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().trim().min(3, 'Nhập lý do xử lý cảnh báo (ít nhất 3 ký tự)').max(1000), title: z.string().max(300).optional(),
  }).strict(), req.body);
  await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const access = await projectAccess(req.user.id, req.pa.project.id, tx);
    assertWrite(access);
    const previous = await tx.riskResolution.findUnique({ where: { project_key: { project: access.project.id, key } } });
    const { open } = await riskAlerts(access.project.id, { project: access.project, db: tx });
    const alert = open.find((a) => a.key === key);
    if (!alert && previous?.sourceVersion === sourceVersion && previous.reason?.trim()) return;
    if (!alert) throw notFound('Cảnh báo không còn tồn tại');
    if (alert.sourceVersion !== sourceVersion) throw conflict('Nguồn cảnh báo đã thay đổi. Hãy tải lại và xem xét trước khi xử lý.', { code: 'RISK_SOURCES_CHANGED' });
    const data = { title: alert.title, sourceVersion, reason, snapshot: alert.snapshot, resolvedBy: req.user.id };
    await tx.riskResolution.upsert({ where: { project_key: { project: access.project.id, key } }, create: { project: access.project.id, key, ...data }, update: data });
    await logActivityIn(tx, {
      workspace: access.project.workspace,
      project: access.project.id,
      actor: req.user.id,
      action: 'Xử lý cảnh báo rủi ro',
      entityType: 'project',
      entityId: access.project.id,
      entityLabel: alert.title,
      before: previous ? JSON.stringify({ sourceVersion: previous.sourceVersion, reason: previous.reason }) : null,
      after: JSON.stringify({ sourceVersion, reason, snapshot: alert.snapshot }),
    });
  });
  await emitProject(req.pa.project.id, 'risks:changed', {});
  res.json({ ok: true });
});

router.delete('/projects/:projectId/risks/resolve', middlewareProject(), async (req, res) => {
  assertWrite(req.pa);
  const { key, sourceVersion } = parse(z.object({ key: z.string().min(1).max(100000), sourceVersion: z.string().regex(/^[a-f0-9]{64}$/) }), req.query);
  await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const access = await projectAccess(req.user.id, req.pa.project.id, tx);
    assertWrite(access);
    const current = await tx.riskResolution.findUnique({ where: { project_key: { project: access.project.id, key } } });
    if (current && current.sourceVersion !== sourceVersion) throw conflict('Lần xử lý cảnh báo đã thay đổi. Vui lòng tải lại.', { code: 'RISK_SOURCES_CHANGED' });
    const { count } = await tx.riskResolution.deleteMany({ where: { project: access.project.id, key, sourceVersion } });
    if (count)
      await logActivityIn(tx, {
        workspace: access.project.workspace,
        project: access.project.id,
        actor: req.user.id,
        action: 'Mở lại cảnh báo rủi ro',
        entityType: 'project',
        entityId: access.project.id,
        entityLabel: current.title,
        before: JSON.stringify({ sourceVersion, reason: current.reason }),
      });
  });
  await emitProject(req.pa.project.id, 'risks:changed', {});
  res.json({ ok: true });
});

// AI chỉ DIỄN GIẢI cảnh báo đã xác định bằng quy tắc
router.post('/projects/:projectId/risks/explain', middlewareProject(), async (req, res) => {
  const { key } = parse(z.object({ key: z.string().min(1) }), req.body);
  const now = new Date();
  const { open } = await riskAlerts(req.pa.project.id, { project: req.pa.project, now });
  const alert = open.find((a) => a.key === key);
  if (!alert) throw notFound('Cảnh báo không còn tồn tại');
  const out = await runAi({
    workspaceId: req.pa.project.workspace,
    userId: req.user.id,
    feature: 'risk',
    payload: { alert: { rule: alert.rule, title: alert.title, explanation: alert.explanation, tasks: alert.tasks.map(({ key, title }) => ({ key, title })) } },
  });
  await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const access = await projectAccess(req.user.id, req.pa.project.id, tx);
    const current = (await riskAlerts(access.project.id, { project: access.project, now, db: tx })).open.find((a) => a.key === key);
    if (!current || current.sourceVersion !== alert.sourceVersion)
      throw conflict('Cảnh báo đã thay đổi trong lúc AI diễn giải. Vui lòng tải lại.', { code: 'AI_SOURCES_CHANGED' });
  });
  res.json({ ...out, sourceVersion: alert.sourceVersion });
});

export default router;
