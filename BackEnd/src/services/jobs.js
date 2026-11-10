import { prisma } from '../db.js';
import { notify } from './notify.js';
import { purgeRateCounters } from './throttle.js';
import { runDailySuggestions } from './repo/agent.js';

/** Bỏ qua việc đã nhắc: job chạy 10 phút/lần, nếu INSERT lại thì Postgres ghi lỗi 23505 cho từng việc. */
async function remindOnce(tasks, type, prefix, text) {
  const keyOf = (t) => `${prefix}:${t.id}:${t.dueDate.toISOString()}`;
  const sent = await prisma.notification.findMany({ where: { dedupeKey: { in: tasks.map(keyOf) } }, select: { user: true, dedupeKey: true } });
  const done = new Set(sent.map((n) => `${n.user}|${n.dedupeKey}`));
  for (const t of tasks) {
    const dedupeKey = keyOf(t);
    if (done.has(`${t.assignee}|${dedupeKey}`)) continue;
    await notify({ user: t.assignee, type, workspace: t.workspace, project: t.project, task: t.id, text: text(t), dedupeKey });
  }
}

/** Nhắc hạn trước 24 giờ + báo quá hạn. dedupeKey theo (task, hạn) nên chạy nhiều lần không gửi trùng. */
export async function runDueReminders(now = new Date()) {
  const soon = new Date(now.getTime() + 24 * 3600 * 1000);
  const select = { id: true, key: true, title: true, assignee: true, dueDate: true, workspace: true, project: true };
  const active = { status: { not: 'done' }, assignee: { not: null }, projectRef: { status: 'active' } };
  const dueSoon = await prisma.task.findMany({ where: { deletedAt: null, ...active, dueDate: { gt: now, lte: soon } }, select });
  await remindOnce(dueSoon, 'due_soon', 'due', (t) => `Nhắc hạn: ${t.key} ${t.title} đến hạn trong 24 giờ`);
  const overdue = await prisma.task.findMany({ where: { deletedAt: null, ...active, dueDate: { lt: now } }, select });
  await remindOnce(overdue, 'overdue', 'overdue', (t) => `${t.key} ${t.title} đã quá hạn`);
  return { dueSoon: dueSoon.length, overdue: overdue.length };
}

export function startJobs() {
  const tick = () => Promise.all([runDueReminders(), purgeRateCounters(), runDailySuggestions()]).catch((e) => console.error('[jobs]', e.message));
  setTimeout(tick, 5000);
  return setInterval(tick, 10 * 60 * 1000);
}
