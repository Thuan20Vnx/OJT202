import { unassignTasks } from './membership.js';
import { badRequest, forbidden, notFound } from '../utils/http.js';

/** Serialize project/PM/member changes on the project row, including competing PM removals. */
export async function lockProject(tx, projectId, actor, { allowArchived = false } = {}) {
  await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
  const project = await tx.project.findUnique({ where: { id: projectId }, include: { memberships: true } });
  if (!project) throw notFound('Không tìm thấy dự án');
  const ws = await tx.membership.findUnique({ where: { workspace_user: { workspace: project.workspace, user: actor } } });
  const mine = project.memberships.find((m) => m.user === actor);
  if (!ws || !mine) throw notFound('Không tìm thấy dự án');
  if (ws.role === 'viewer' || mine.role !== 'pm') throw forbidden('Chỉ PM được quản lý dự án');
  if (!allowArchived && project.status === 'archived') throw forbidden('Dự án đã lưu trữ, chỉ được xem');
  return project;
}

/** Replace a project's roster atomically; compatibility fields and audit never diverge. */
export async function saveProjectMembers(tx, project, roster, manager = project.manager, actor = project.createdBy) {
  const ids = roster.map((m) => m.user);
  if (new Set(ids).size !== ids.length) throw badRequest('Thành viên dự án bị trùng');
  const memberships = await tx.membership.findMany({ where: { workspace: project.workspace, user: { in: ids } }, include: { userRef: { select: { isLocked: true } } } });
  if (memberships.length !== ids.length) throw badRequest('Thành viên phải thuộc workspace của dự án');
  for (const row of roster) {
    const ws = memberships.find((m) => m.user === row.user);
    if (ws.role === 'viewer' && row.role !== 'viewer') throw badRequest('Workspace Viewer chỉ có thể là Project Viewer');
    if (row.role === 'pm' && ws.userRef.isLocked) throw badRequest('Không thể giao PM cho tài khoản đã khóa');
  }
  const pms = roster.filter((m) => m.role === 'pm');
  if (!pms.length) throw badRequest('Phải chuyển giao PM trước khi gỡ hoặc hạ quyền PM cuối cùng');
  const primary = pms.some((m) => m.user === manager) ? manager : pms[0].user;
  const removed = project.memberships.filter((m) => !ids.includes(m.user)).map((m) => m.user);
  const viewers = roster.filter((m) => m.role === 'viewer').map((m) => m.user);
  await tx.projectMember.deleteMany({ where: { project: project.id } });
  await tx.projectMember.createMany({ data: roster.map((m) => ({ project: project.id, ...m })) });
  await unassignTasks(tx, { workspace: project.workspace, project: project.id, users: [...removed, ...viewers], actor });
  return tx.project.update({ where: { id: project.id }, data: { members: ids, manager: primary } });
}

export async function projectAudit(tx, project, actor, action, before, after) {
  await tx.activity.create({ data: { workspace: project.workspace, project: project.id, actor, action, entityType: 'project', entityId: project.id, entityLabel: project.name, before, after } });
}
