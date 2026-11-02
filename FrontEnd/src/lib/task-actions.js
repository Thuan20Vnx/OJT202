import { t as tr } from './i18n.js';
// Match the server's Review -> Done approval rule, including archived projects.
export function taskActions(task) {
  const canWrite = task.permissions ? task.permissions.canUpdateProgress : task.access?.canWrite === true;
  const canApprove = canWrite && task.access?.canManage === true;
  const allowed = task.permissions?.allowedStatuses;
  const nextStatus = allowed ? (task.status === 'todo' ? 'in_progress' : task.status === 'in_progress' ? 'review' : task.status === 'review' ? 'done' : 'todo') : !canWrite ? null : task.status === 'done' ? 'todo' : task.status === 'review' ? (canApprove ? 'done' : null) : 'review';
  return {
    canWrite,
    nextStatus: allowed && !allowed.includes(nextStatus) ? null : nextStatus,
    label: !canWrite ? tr("Chỉ xem") : task.status === 'todo' && allowed ? tr("Bắt đầu công việc") : task.status === 'done' ? tr("Mở lại công việc") : task.status === 'review' ? (canApprove ? tr("Duyệt hoàn thành") : tr("Chờ PM duyệt")) : tr("Gửi kiểm duyệt"),
    statuses: allowed || ['todo', 'in_progress', 'review', 'done'].filter((s) => s !== 'done' || task.status === 'done' || (canApprove && task.status === 'review')),
  };
}
