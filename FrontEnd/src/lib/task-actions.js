// Match the server's Review -> Done approval rule, including archived projects.
export function taskActions(task) {
  const canWrite = task.access?.canWrite === true;
  const canApprove = canWrite && task.access?.canManage === true;
  const nextStatus = !canWrite ? null : task.status === 'done' ? 'todo' : task.status === 'review' ? (canApprove ? 'done' : null) : 'review';
  return {
    canWrite,
    nextStatus,
    label: !canWrite ? 'Chỉ xem' : task.status === 'done' ? 'Mở lại công việc' : task.status === 'review' ? (canApprove ? 'Duyệt hoàn thành' : 'Chờ PM, Owner hoặc Admin duyệt') : 'Gửi kiểm duyệt',
    statuses: ['todo', 'in_progress', 'review', 'done'].filter((s) => s !== 'done' || task.status === 'done' || (canApprove && task.status === 'review')),
  };
}
