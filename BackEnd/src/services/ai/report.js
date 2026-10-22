import { populate, prisma } from '../../db.js';
import { projectOverview, riskAlerts, startOfDay } from '../metrics.js';

const fmt = (d) => {
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}`;
};
const line = (t, extra = '') => `${t.key} ${t.title}${extra ? ` – ${extra}` : ''}`;

/**
 * Báo cáo tiến độ: MỌI con số tính bằng truy vấn DB; AI (nếu có) chỉ viết phần tóm tắt & đề xuất.
 * Mỗi mục đính kèm refs = công việc nguồn.
 */
export async function buildReportData(projectId, from, to, project) {
  const end = new Date(to.getTime() + 86400000 - 1);
  const [ov, done, risks] = await Promise.all([
    projectOverview(projectId, { project }),
    prisma.task
      .findMany({ where: { project: projectId, parent: null, status: 'done', completedAt: { gte: from, lte: end } } })
      .then((r) => populate(r, 'assignee', 'user', { name: true })),
    riskAlerts(projectId, { project }),
  ]);
  const sod = startOfDay();
  const soon = new Date(Date.now() + 86400000);
  const late = ov.tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < soon);
  const blocked = ov.blocked;
  const stats = {
    done: done.length,
    overdue: ov.overdue.length,
    blocked: blocked.length,
    progressPct: ov.progressPct,
    totalTasks: ov.total,
    doneTotal: ov.done,
  };
  const sections = [
    {
      key: 'done',
      title: `Đã hoàn thành (${done.length} việc)`,
      body: done.length ? done.map((t) => `• ${line(t, `${t.assignee?.name || 'chưa giao'} · xong ${fmt(t.completedAt)}`)}`).join('\n') : 'Chưa có công việc hoàn thành trong khoảng thời gian này.',
      refs: done.map((t) => t.id),
    },
    {
      key: 'late',
      title: `Đang chậm (${late.length} việc)`,
      body: late.length
        ? late
            .map((t) => {
              const days = Math.floor((sod - startOfDay(t.dueDate)) / 86400000);
              return `• ${line(t, days > 0 ? `quá hạn ${days} ngày` : 'đến hạn trong 24 giờ')}`;
            })
            .join('\n')
        : 'Không có công việc chậm.',
      refs: late.map((t) => t.id),
    },
    {
      key: 'blocked',
      title: `Đang bị chặn (${blocked.length} việc)`,
      body: blocked.length
        ? blocked.map((t) => `• ${line(t, `bị chặn bởi ${(t.blockedBy || []).filter((b) => b.status !== 'done').map((b) => b.key).join(', ')}`)}`).join('\n')
        : 'Không có công việc bị chặn.',
      refs: blocked.map((t) => t.id),
    },
  ];
  const sourceTasks = [...new Set([...done, ...late, ...blocked].map((t) => t.id))];
  return { ov, stats, sections, sourceTasks, risks: risks.open };
}
