import { Router } from 'express';
import { USER, isId, populate, populateAll, prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const TAB_TYPES = { assigned: ['assigned'], mentioned: ['mentioned'], due: ['due_soon', 'overdue'] };

router.get('/', async (req, res) => {
  const permitted = { OR: [{ project: null }, { projectRef: { memberships: { some: { user: req.user.id } }, workspaceRef: { memberships: { some: { user: req.user.id } } } } }] };
  const where = { user: req.user.id, AND: [permitted] };
  const workspace = isId(req.query.workspace) ? req.query.workspace : undefined;
  if (workspace) where.workspace = workspace;
  if (isId(req.query.project)) where.project = req.query.project;
  if (req.query.tab === 'unread') where.readAt = null;
  else if (TAB_TYPES[req.query.tab]) where.type = { in: TAB_TYPES[req.query.tab] };
  const limit = Math.min(100, Number(req.query.limit) || 30);
  const before = req.query.before ? new Date(req.query.before) : null;
  if (before && !Number.isNaN(before.getTime())) where.createdAt = { lt: before };
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }).then((r) =>
      populateAll(r, [
        ['actor', 'user', USER],
        ['task', 'task', { key: true, title: true, status: true }],
        ['project', 'project', { name: true, color: true }],
      ]),
    ),
    prisma.notification.count({ where: { user: req.user.id, AND: [permitted], readAt: null, ...(workspace && { workspace }) } }),
  ]);
  res.json({ items, unread });
});

router.post('/:id/read', async (req, res) => {
  if (isId(req.params.id)) await prisma.notification.updateMany({ where: { id: req.params.id, user: req.user.id }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

router.post('/read-all', async (req, res) => {
  const where = { user: req.user.id, readAt: null };
  if (isId(req.body?.workspace)) where.workspace = req.body.workspace;
  const { count } = await prisma.notification.updateMany({ where, data: { readAt: new Date() } });
  res.json({ ok: true, updated: count });
});

export default router;
