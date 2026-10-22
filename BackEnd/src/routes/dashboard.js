import { Router } from 'express';
import { z } from 'zod';
import { USER, populate, prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { middlewareProject } from '../middleware/access.js';
import { logActivity } from '../services/activity.js';
import { runAi } from '../services/ai/gateway.js';
import { projectOverview, riskAlerts, workload } from '../services/metrics.js';
import { forbidden, notFound, parse } from '../utils/http.js';
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
    ...ov.tasks.map((t) => [t.key, t.title, t.status, t.priority, t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : '', t.completedAt ? new Date(t.completedAt).toISOString() : '']),
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
  if (!req.pa.canWrite) throw forbidden();
  const body = parse(z.object({ key: z.string().min(1), title: z.string().max(300).default('') }), req.body);
  const data = { title: body.title, resolvedBy: req.user.id };
  await Promise.all([
    prisma.riskResolution.upsert({ where: { project_key: { project: req.pa.project.id, key: body.key } }, create: { project: req.pa.project.id, key: body.key, ...data }, update: data }),
    logActivity({
    workspace: req.pa.project.workspace,
    project: req.pa.project.id,
    actor: req.user.id,
    action: 'Xử lý cảnh báo rủi ro',
    entityType: 'project',
    entityId: req.pa.project.id,
      entityLabel: body.title,
    }),
  ]);
  res.json({ ok: true });
});

router.delete('/projects/:projectId/risks/resolve', middlewareProject(), async (req, res) => {
  if (!req.pa.canWrite) throw forbidden();
  await prisma.riskResolution.deleteMany({ where: { project: req.pa.project.id, key: String(req.query.key || '') } });
  res.json({ ok: true });
});

// AI chỉ DIỄN GIẢI cảnh báo đã xác định bằng quy tắc
router.post('/projects/:projectId/risks/explain', middlewareProject(), async (req, res) => {
  const { key } = parse(z.object({ key: z.string().min(1) }), req.body);
  const { open } = await riskAlerts(req.pa.project.id, { project: req.pa.project });
  const alert = open.find((a) => a.key === key);
  if (!alert) throw notFound('Cảnh báo không còn tồn tại');
  const out = await runAi({
    workspaceId: req.pa.project.workspace,
    userId: req.user.id,
    feature: 'risk',
    payload: { alert: { rule: alert.rule, title: alert.title, explanation: alert.explanation, tasks: alert.tasks.map(({ key, title }) => ({ key, title })) } },
  });
  res.json(out);
});

export default router;
