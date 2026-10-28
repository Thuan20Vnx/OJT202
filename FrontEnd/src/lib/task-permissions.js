export function taskActions(task, project, me) {
  const role = project?.projectRole;
  const active = project?.status === 'active';
  const canEdit = active && role === 'pm';
  const own = (task.assignee?._id || task.assignee) === me?._id;
  const canUpdateProgress = active && (canEdit || (role === 'member' && own && task.status !== 'done'));
  const allowedStatuses = !canUpdateProgress ? [] : canEdit ? ['todo', 'in_progress', 'review', ...(task.status === 'review' || task.status === 'done' ? ['done'] : [])]
    : ({ todo: ['todo', 'in_progress'], in_progress: ['todo', 'in_progress', 'review'], review: ['in_progress', 'review'] }[task.status] || []);
  return { canEdit, canUpdateProgress, allowedStatuses };
}
