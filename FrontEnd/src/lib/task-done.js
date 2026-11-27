import { t as tr } from './i18n.js';

/** Việc con / mục checklist chưa xong của một việc (dùng để hỏi lại trước khi chuyển sang Hoàn thành). */
export function unfinishedWork(task, subtasks) {
  const subs = Array.isArray(subtasks)
    ? subtasks.filter((s) => s.status !== 'done').length
    : Math.max(0, (task?.subtasks?.total || 0) - (task?.subtasks?.done || 0));
  const checks = (task?.checklist || []).filter((c) => !c.done).length;
  return { subs, checks, any: subs + checks > 0 };
}

export function unfinishedText({ subs, checks }) {
  return [subs && tr('{0} việc con chưa xong', [subs]), checks && tr('{0} mục checklist chưa tick', [checks])].filter(Boolean).join(tr(' và '));
}
