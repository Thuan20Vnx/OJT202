import { Router } from 'express';
import { badRequest, pagination } from '../utils/http.js';
import { USER, isId, populateAll, prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const TAB_TYPES = { assigned: ['assigned'], mentioned: ['mentioned'], due: ['due_soon', 'overdue'] };

router.get('/', async (req, res) => {
  // Thông báo cũ cũng có thể chứa tên/nội dung task: lọc bằng quyền HIỆN TẠI.
  const visible = {
    workspaceRef: { memberships: { some: { user: req.user.id } } },
    OR: [
      { project: null },
      { projectRef: { memberships: { some: { user: req.user.id } } } },
    ],
  };
  const where = { user: req.user.id, ...visible };
  const workspace = isId(req.query.workspace) ? req.query.workspace : undefined;
  if (workspace) where.workspace = workspace;
  if (isId(req.query.project)) where.project = req.query.project;
  if (req.query.tab === 'unread') where.readAt = null;
  else if (TAB_TYPES[req.query.tab]) where.type = { in: TAB_TYPES[req.query.tab] };
  const { limit } = pagination(req.query, 30);
  if (req.query.cursor !== undefined) {
    try {
      const cursor = req.query.cursor;
      if (req.query.before !== undefined || typeof cursor !== 'string' || cursor.length > 300 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
      const { at, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (typeof at !== 'string' || !isId(id)) throw new Error();
      const createdAt = new Date(at);
      if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== at) throw new Error();
      // ID là khóa phụ để không bỏ sót các thông báo có cùng millisecond.
      // AND giữ nguyên bộ lọc OR về quyền hiện tại ở trên.
      where.AND = [{ OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] }];
    } catch {
      throw badRequest('Mốc phân trang thông báo không hợp lệ');
    }
  } else if (req.query.before !== undefined) {
    const before = typeof req.query.before === 'string' ? new Date(req.query.before) : null;
    if (!before || !Number.isFinite(before.getTime())) throw badRequest('Ngày phân trang không hợp lệ');
    where.createdAt = { lt: before };
  }
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 }),
    prisma.notification.count({ where: { user: req.user.id, ...visible, readAt: null, ...(workspace && { workspace }) } }),
  ]);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = hasMore ? Buffer.from(JSON.stringify({ at: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null;
  const items = await populateAll(page, [
    ['actor', 'user', USER],
    ['task', 'task', { key: true, title: true, status: true }],
    ['project', 'project', { name: true, color: true }],
  ]);
  res.json({ items, unread, hasMore, nextCursor });
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
