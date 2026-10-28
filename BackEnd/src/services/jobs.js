import { prisma } from '../db.js';
import { notify } from './notify.js';

/** Nhắc hạn trước 24 giờ + báo quá hạn. dedupeKey theo (task, hạn) nên chạy nhiều lần không gửi trùng. */
export async function runDueReminders(now = new Date()) {
  const soon = new Date(now.getTime() + 24 * 3600 * 1000);
  const select = { id: true, key: true, title: true, assignee: true, dueDate: true, workspace: true, project: true };
  const active = { status: { not: 'done' }, assignee: { not: null }, projectRef: { status: 'active' } };
  const dueSoon = await prisma.task.findMany({ where: { ...active, dueDate: { gt: now, lte: soon } }, select });
  for (const t of dueSoon) {
    await notify({
      user: t.assignee,
      type: 'due_soon',
      workspace: t.workspace,
      project: t.project,
      task: t.id,
      text: `Nhắc hạn: ${t.key} ${t.title} đến hạn trong 24 giờ`,
      dedupeKey: `due:${t.id}:${t.dueDate.toISOString()}`,
    });
  }
  const overdue = await prisma.task.findMany({ where: { ...active, dueDate: { lt: now } }, select });
  for (const t of overdue) {
    await notify({
      user: t.assignee,
      type: 'overdue',
      workspace: t.workspace,
      project: t.project,
      task: t.id,
      text: `${t.key} ${t.title} đã quá hạn`,
      dedupeKey: `overdue:${t.id}:${t.dueDate.toISOString()}`,
    });
  }
  return { dueSoon: dueSoon.length, overdue: overdue.length };
}

export function startJobs() {
  const tick = () => runDueReminders().catch((e) => console.error('[jobs]', e.message));
  setTimeout(tick, 5000);
  return setInterval(tick, 10 * 60 * 1000);
}
