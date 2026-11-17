import { isId, prisma } from '../db.js';
import { badRequest, forbidden, notFound } from '../utils/http.js';

export const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 };
export const atLeast = (role, min) => ROLE_RANK[role] >= ROLE_RANK[min];

// Kèm membership của user trong workspace của dự án – lấy cùng dự án bằng một câu JOIN
const withMembership = (userId) => ({
  workspaceRef: { select: { deletionScheduledAt: true, memberships: { where: { user: userId }, take: 1 } } },
  memberships: { where: { user: userId }, take: 1 },
});

/** Trả về membership của user trong workspace, hoặc ném 404 (không lộ sự tồn tại của workspace khác). */
export async function workspaceAccess(userId, workspaceId, db = prisma) {
  if (!isId(workspaceId)) throw notFound('Không tìm thấy workspace');
  const found = await db.membership.findUnique({ where: { workspace_user: { workspace: workspaceId, user: userId } }, include: { workspaceRef: true } });
  if (!found) throw notFound('Không tìm thấy workspace');
  const { workspaceRef: workspace, ...membership } = found;
  return { workspace, membership, role: membership.role };
}

/**
 * Dự án private: phải có cả workspace membership và project membership.
 * Trả thêm canWrite: Viewer không ghi; dự án lưu trữ chỉ đọc.
 */
function checkProject(found, userId) {
  if (!found) throw notFound('Không tìm thấy dự án');
  const { workspaceRef, memberships, ...project } = found;
  const membership = workspaceRef.memberships[0];
  if (!membership) throw notFound('Không tìm thấy dự án');
  if (!memberships.length) throw notFound('Không tìm thấy dự án');
  const projectRole = membership.role === 'viewer' ? 'viewer' : memberships[0].role;
  // Workspace đang chờ xóa: mọi dự án chỉ đọc như khi lưu trữ.
  const pendingDeletion = !!workspaceRef.deletionScheduledAt;
  const readOnly = project.status === 'archived' || pendingDeletion;
  const canWrite = projectRole !== 'viewer' && !readOnly;
  const canManage = !readOnly && projectRole === 'pm';
  // Giảng viên chỉ xem như Viewer nhưng được góp ý bằng bình luận.
  const canComment = canWrite || (membership.isMentor && !readOnly);
  // Hỏi đáp chỉ lưu vào lịch sử riêng của người hỏi nên Viewer/Giảng viên cũng được hỏi (khi dự án không chỉ đọc).
  const canAsk = !readOnly;
  return { project, membership, projectRole, role: projectRole === 'viewer' ? 'viewer' : membership.role, canWrite, canManage, canComment, canAsk, pendingDeletion };
}

export async function projectAccess(userId, projectId, db = prisma) {
  if (!isId(projectId)) throw notFound('Không tìm thấy dự án');
  return checkProject(await db.project.findUnique({ where: { id: projectId }, include: withMembership(userId) }), userId);
}

/** Công việc + dự án + membership trong một truy vấn */
export async function taskAccess(userId, taskId, db = prisma) {
  if (!isId(taskId)) throw notFound('Không tìm thấy công việc');
  const found = await db.task.findUnique({ where: { deletedAt: null, id: taskId }, include: { contributors: true, projectRef: { include: withMembership(userId) } } });
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

export const PENDING_DELETION_MSG = 'Workspace đang chờ xóa nên chỉ được xem và tải dữ liệu về';
const readOnlyMessage = (access) => (access.pendingDeletion ? PENDING_DELETION_MSG : access.project?.status === 'archived' ? 'Dự án đã lưu trữ, chỉ được xem' : null);

export function assertWrite(access, msg) {
  if (!access.canWrite) throw forbidden(readOnlyMessage(access) || msg || 'Viewer chỉ được xem');
}

export function assertComment(access) {
  if (!access.canComment) throw forbidden(readOnlyMessage(access) || 'Viewer chỉ được xem');
}

export function assertAsk(access) {
  if (!access.canAsk) throw forbidden(readOnlyMessage(access) || 'Không được hỏi đáp trong dự án này');
}

export function assertManage(access) {
  if (!access.canManage) throw forbidden(readOnlyMessage(access) || 'Chỉ PM được thực hiện thao tác này');
}

/** Thao tác ghi cấp workspace (thành viên, lời mời, cài đặt, tạo dự án…) bị chặn khi workspace đang chờ xóa. */
export function assertWorkspaceWritable(workspace) {
  if (workspace?.deletionScheduledAt) throw forbidden(PENDING_DELETION_MSG);
}

// Dùng chung cho API và các view Kanban/list/detail; quyền ghi nội dung khác quyền đổi trạng thái.
export function taskPermissions(access, userId, task = access.task) {
  const canUpdate = access.canWrite && (access.projectRole === 'pm' || ((task.assignee === userId || task.contributors?.some((c) => c.user === userId)) && task.status !== 'done'));
  const allowedStatuses = !canUpdate ? [] : access.projectRole === 'pm'
    ? ['todo', 'in_progress', 'review', ...(task.status === 'review' || task.status === 'done' ? ['done'] : [])]
    : ({ todo: ['todo', 'in_progress', 'review'], in_progress: ['todo', 'in_progress', 'review'], review: ['in_progress', 'review'] }[task.status] || []);
  return { canEdit: access.canManage, canUpdateProgress: canUpdate, allowedStatuses };
}

/** Điều kiện lọc dự án user được đọc trong một workspace (dùng lồng vào truy vấn khác, không tốn thêm lượt). */
export function readableProjectsWhere(userId, workspaceId, role) {
  return { workspace: workspaceId, memberships: { some: { user: userId } } };
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
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) assertWorkspaceWritable(access.workspace);
    req.ws = access;
    next();
  };
}

export function middlewareProject(param = 'projectId') {
  return async (req, _res, next) => {
    req.pa = await projectAccess(req.user.id, req.params[param]);
    if (req.pa.pendingDeletion && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) throw forbidden(PENDING_DELETION_MSG);
    next();
  };
}

export function assertTaskStatus(access, nextStatus, previousStatus = null) {
  if (nextStatus !== 'done' || previousStatus === 'done') return;
  if (!access.canManage) throw forbidden('Chỉ PM được duyệt hoàn thành');
  if (previousStatus !== 'review') throw badRequest('Công việc phải ở trạng thái kiểm duyệt trước khi hoàn thành');
}
