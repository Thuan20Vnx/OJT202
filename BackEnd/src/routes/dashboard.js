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
  res.json({
    kpis: {
      total: ov.total,
      done: ov.done,
      progressPct: ov.progressPct,
      overdue: ov.overdue.length,
      blocked: ov.blocked.length,
      velocity: ov.velocity,
    },
    overdue: ov.overdue.map(brief),
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
  const { key } = parse(z.object({ key: z.string().min(1).max(100000), title: z.string().max(300).optional() }), req.body);
  await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const access = await projectAccess(req.user.id, req.pa.project.id, tx);
    assertWrite(access);
    if (await tx.riskResolution.findUnique({ where: { project_key: { project: access.project.id, key } } })) return;
    const { open } = await riskAlerts(access.project.id, { project: access.project });
    const alert = open.find((a) => a.key === key);
    if (!alert) throw notFound('Cảnh báo không còn tồn tại');
    await tx.riskResolution.create({ data: { project: access.project.id, key, title: alert.title, resolvedBy: req.user.id } });
    await logActivityIn(tx, {
      workspace: access.project.workspace,
      project: access.project.id,
      actor: req.user.id,
      action: 'Xử lý cảnh báo rủi ro',
      entityType: 'project',
      entityId: access.project.id,
      entityLabel: alert.title,
    });
  });
  await emitProject(req.pa.project.id, 'risks:changed', {});
  res.json({ ok: true });
});

router.delete('/projects/:projectId/risks/resolve', middlewareProject(), async (req, res) => {
  assertWrite(req.pa);
  await withWorkspaceLock(req.pa.project.workspace, async (tx) => {
    const access = await projectAccess(req.user.id, req.pa.project.id, tx);
    assertWrite(access);
    const { count } = await tx.riskResolution.deleteMany({ where: { project: access.project.id, key: String(req.query.key || '') } });
    if (count)
      await logActivityIn(tx, {
        workspace: access.project.workspace,
        project: access.project.id,
        actor: req.user.id,
        action: 'Mở lại cảnh báo rủi ro',
        entityType: 'project',
        entityId: access.project.id,
        entityLabel: String(req.query.key || ''),
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
    const current = (await riskAlerts(access.project.id, { project: access.project, now })).open.find((a) => a.key === key);
    if (!current || JSON.stringify(current) !== JSON.stringify(alert))
      throw conflict('Cảnh báo đã thay đổi trong lúc AI diễn giải. Vui lòng tải lại.', { code: 'AI_SOURCES_CHANGED' });
  });
  res.json(out);
});

export default router;
