import { Router } from 'express';
import { z } from 'zod';
import { isId, prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { atLeast, middlewareWorkspace, workspaceAccess } from '../middleware/access.js';
import { logActivityIn } from '../services/activity.js';
import { capacityWeek } from '../services/capacity.js';
import { withWorkspaceLock } from '../services/membership.js';
import { emitProject } from '../services/realtime.js';
import { conflict, forbidden, notFound, parse } from '../utils/http.js';

const router = Router();
router.use(requireAuth);

router.get('/:wsId/members/:userId/capacity/:week', middlewareWorkspace(), async (req, res) => {
  const weekStart = capacityWeek(req.params.week);
  const workspace = req.ws.workspace.id;
  const user = req.params.userId;
  const member = isId(user) ? await prisma.membership.findUnique({ where: { workspace_user: { workspace, user } } }) : null;
  if (!member) throw notFound('Không tìm thấy thành viên');
  const capacity = await prisma.weeklyCapacity.findUnique({ where: { workspace_user_weekStart: { workspace, user, weekStart } } });
  res.json({ capacity: capacity ?? { workspace, user, weekStart, hours: member.weeklyHours, version: 0 }, source: capacity ? 'week' : 'default' });
});

router.patch('/:wsId/members/:userId/capacity/:week', middlewareWorkspace('wsId', 'admin'), async (req, res) => {
  const weekStart = capacityWeek(req.params.week);
  const body = parse(z.object({ hours: z.number().finite().min(0).max(80), version: z.number().int().min(0).max(2147483646) }).strict(), req.body);
  const workspace = req.ws.workspace.id;
  const user = req.params.userId;
  const result = await withWorkspaceLock(workspace, async (tx) => {
    const actor = await workspaceAccess(req.user.id, workspace, tx);
    if (!atLeast(actor.role, 'admin')) throw forbidden();
    const member = isId(user) ? await tx.membership.findUnique({ where: { workspace_user: { workspace, user } }, include: { userRef: { select: { name: true } } } }) : null;
    if (!member) throw notFound('Không tìm thấy thành viên');
    if (['owner', 'admin'].includes(member.role) && actor.role !== 'owner') throw forbidden('Chỉ Owner mới quản lý được Owner/Admin');
    const key = { workspace_user_weekStart: { workspace, user, weekStart } };
    const previous = await tx.weeklyCapacity.findUnique({ where: key });
    if ((previous?.version ?? 0) !== body.version) throw conflict('Giờ khả dụng đã thay đổi. Hãy tải lại trước khi lưu.', { capacity: previous });
    const capacity = previous
      ? await tx.weeklyCapacity.update({ where: key, data: { hours: body.hours, version: { increment: 1 } } })
      : await tx.weeklyCapacity.create({ data: { workspace, user, weekStart, hours: body.hours } });
    await logActivityIn(tx, {
      workspace, actor: req.user.id, action: 'Cập nhật giờ khả dụng theo tuần', entityType: 'member', entityId: user,
      entityLabel: member.userRef.name,
      field: 'weeklyCapacity', before: { week: req.params.week, hours: previous?.hours ?? member.weeklyHours },
      after: { week: req.params.week, hours: capacity.hours, version: capacity.version },
    });
    // Notify only projects this user belongs to. No roster/project data is returned to the caller.
    const projects = await tx.projectMember.findMany({ where: { user, projectRef: { workspace } }, select: { project: true } });
    return { capacity, projects };
  });
  await Promise.all(result.projects.map((p) => emitProject(p.project, 'board:refresh', {})));
  res.json({ capacity: result.capacity });
});

export default router;
