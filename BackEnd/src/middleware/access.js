import { isId, prisma } from '../db.js';
import { badRequest, forbidden, notFound } from '../utils/http.js';

export const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 };
export const atLeast = (role, min) => ROLE_RANK[role] >= ROLE_RANK[min];

// Kèm membership của user trong workspace của dự án – lấy cùng dự án bằng một câu JOIN
const withMembership = (userId) => ({ workspaceRef: { select: { memberships: { where: { user: userId }, take: 1 } } } });

/** Trả về membership của user trong workspace, hoặc ném 404 (không lộ sự tồn tại của workspace khác). */
export async function workspaceAccess(userId, workspaceId, db = prisma) {
  if (!isId(workspaceId)) throw notFound('Không tìm thấy workspace');
  const found = await db.membership.findUnique({ where: { workspace_user: { workspace: workspaceId, user: userId } }, include: { workspaceRef: true } });
  if (!found) throw notFound('Không tìm thấy workspace');
  const { workspaceRef: workspace, ...membership } = found;
  return { workspace, membership, role: membership.role };
}

/**
 * Quyền đọc dự án: thành viên workspace VÀ (được gán vào dự án HOẶC là Owner/Admin).
 * Trả thêm canWrite: Viewer không ghi; dự án lưu trữ chỉ đọc.
 */
function checkProject(found, userId) {
  if (!found) throw notFound('Không tìm thấy dự án');
  const { workspaceRef, ...project } = found;
  const membership = workspaceRef.memberships[0];
  if (!membership) throw notFound('Không tìm thấy dự án');
  const assigned = project.members.includes(userId);
  if (!assigned && !atLeast(membership.role, 'admin')) throw notFound('Không tìm thấy dự án');
  const canWrite = membership.role !== 'viewer' && project.status !== 'archived';
  const canManage = canWrite && (atLeast(membership.role, 'admin') || project.manager === userId);
  return { project, membership, role: membership.role, canWrite, canManage };
}

export async function projectAccess(userId, projectId, db = prisma) {
  if (!isId(projectId)) throw notFound('Không tìm thấy dự án');
  return checkProject(await db.project.findUnique({ where: { id: projectId }, include: withMembership(userId) }), userId);
}

/** Công việc + dự án + membership trong một truy vấn */
export async function taskAccess(userId, taskId, db = prisma) {
  if (!isId(taskId)) throw notFound('Không tìm thấy công việc');
  const found = await db.task.findUnique({ where: { id: taskId }, include: { projectRef: { include: withMembership(userId) } } });
  if (!found) throw notFound('Không tìm thấy công việc');
  const { projectRef, ...task } = found;
  return { task, ...checkProject(projectRef, userId) };
}

/** Tài liệu + dự án + membership trong một truy vấn (kiểm quyền ở mỗi lần truy cập tài liệu) */
export async function documentAccess(userId, documentId, db = prisma) {
  const found = isId(documentId) ? await db.document.findUnique({ where: { id: documentId }, include: { projectRef: { include: withMembership(userId) } } }) : null;
  if (!found) throw notFound('Không tìm thấy tài liệu');
  const { projectRef, ...doc } = found;
  return { doc, access: checkProject(projectRef, userId) };
}

export function assertWrite(access, msg) {
  if (!access.canWrite) {
    throw forbidden(access.project?.status === 'archived' ? 'Dự án đã lưu trữ, chỉ được xem' : msg || 'Viewer chỉ được xem');
  }
}

export function assertManage(access) {
  assertWrite(access);
  if (!access.canManage) throw forbidden('Chỉ PM, Owner hoặc Admin được thực hiện thao tác này');
}

/** Done là quyết định duyệt của PM/Owner/Admin, luôn đi qua Review (kể cả API trực tiếp). */
export function assertTaskStatus(access, nextStatus, previousStatus = null) {
  if (nextStatus !== 'done' || previousStatus === 'done') return;
  if (!access.canManage) throw forbidden('Chỉ PM, Owner hoặc Admin được duyệt công việc hoàn thành');
  if (previousStatus !== 'review') throw badRequest('Công việc phải ở trạng thái Đang kiểm duyệt trước khi hoàn thành');
}

/** Điều kiện lọc dự án user được đọc trong một workspace (dùng lồng vào truy vấn khác, không tốn thêm lượt). */
export function readableProjectsWhere(userId, workspaceId, role) {
  const where = { workspace: workspaceId };
  if (!atLeast(role, 'admin')) where.members = { has: userId };
  return where;
}

/** Danh sách id dự án user được đọc trong một workspace. */
export async function readableProjectIds(userId, workspaceId, role) {
  const projects = await prisma.project.findMany({ where: readableProjectsWhere(userId, workspaceId, role), select: { id: true } });
  return projects.map((p) => p.id);
}

export function middlewareWorkspace(param = 'wsId', min = 'viewer') {
  return async (req, _res, next) => {
    const access = await workspaceAccess(req.user.id, req.params[param]);
    if (!atLeast(access.role, min)) throw forbidden();
    req.ws = access;
    next();
  };
}

export function middlewareProject(param = 'projectId') {
  return async (req, _res, next) => {
    req.pa = await projectAccess(req.user.id, req.params[param]);
    next();
  };
}
