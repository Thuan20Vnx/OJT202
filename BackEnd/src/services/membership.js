import { prisma } from '../db.js';

/**
 * Cùng khóa workspace cho thay đổi quyền, thành viên dự án và giao việc.
 * Đọc lại quyền SAU khi lấy khóa; tránh hai request cùng xóa Owner cuối hoặc
 * giao task cho người vừa bị gỡ. PostgreSQL tự nhả khóa khi commit/rollback.
 */
export function withWorkspaceLock(workspaceId, action) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
      return action(tx);
    },
    { maxWait: 10000, timeout: 15000 },
  );
}

/** Bỏ giao cả task cha/con, giữ lịch sử bằng audit trong cùng transaction. */
export async function unassignTasks(tx, { workspace, project, users, actor }) {
  if (!users.length) return 0;
  const tasks = await tx.task.findMany({
    where: { workspace, ...(project && { project }), assignee: { in: users } },
    select: { id: true, project: true, assignee: true, key: true, title: true },
  });
  if (!tasks.length) return 0;
  await tx.task.updateMany({ where: { id: { in: tasks.map((t) => t.id) } }, data: { assignee: null, version: { increment: 1 } } });
  await tx.activity.createMany({
    data: tasks.map((t) => ({
      workspace,
      project: t.project,
      actor,
      action: 'Bỏ giao việc khi thu hồi quyền',
      entityType: 'task',
      entityId: t.id,
      entityLabel: `${t.key} ${t.title}`,
      field: 'assignee',
      before: t.assignee,
      after: 'Chưa giao',
    })),
  });
  return tasks.length;
}
