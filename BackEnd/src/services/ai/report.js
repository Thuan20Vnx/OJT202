import { populate, prisma } from '../../db.js';
import { projectOverview, riskAlerts } from '../metrics.js';
import { BUSINESS_TIMEZONE } from '../../utils/dates.js';

const fmt = (d, timezone = BUSINESS_TIMEZONE) => {
  return new Date(d).toLocaleDateString('vi-VN', { timeZone: timezone, day: '2-digit', month: '2-digit' });
};
const line = (t, extra = '') => `${t.key} ${t.title}${extra ? ` – ${extra}` : ''}`;

/**
 * Báo cáo tiến độ: MỌI con số tính bằng truy vấn DB; AI (nếu có) chỉ viết phần tóm tắt & đề xuất.
 * Mỗi mục đính kèm refs = công việc nguồn.
 */
export async function buildReportData(projectId, from, to, project, now = new Date()) {
  const format = (d) => fmt(d, project.timezone);
  const [ov, done, risks] = await Promise.all([
    projectOverview(projectId, { project, now }),
    prisma.task
      .findMany({ where: { deletedAt: null, project: projectId, parent: null, status: 'done', completedAt: { gte: from, lt: to } } })
      .then((r) => populate(r, 'assignee', 'user', { name: true })),
    riskAlerts(projectId, { project, now }),
  ]);
  const late = ov.overdue;
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
      body: done.length
        ? done.map((t) => `• ${line(t, `${t.assignee?.name || 'chưa giao'} · xong ${format(t.completedAt)}`)}`).join('\n')
        : 'Chưa có công việc hoàn thành trong khoảng thời gian này.',
      refs: done.map((t) => t.id),
    },
    {
      key: 'late',
      title: `Đang chậm (${late.length} việc)`,
      body: late.length
        ? late
            .map((t) => {
              const days = Math.floor((now - new Date(t.dueDate)) / 86400000);
              return `• ${line(t, days ? `quá hạn ${days} ngày` : 'quá hạn dưới 24 giờ')}`;
            })
            .join('\n')
        : 'Không có công việc chậm.',
      refs: late.map((t) => t.id),
    },
    {
      key: 'blocked',
      title: `Đang bị chặn (${blocked.length} việc)`,
      body: blocked.length
        ? blocked
            .map(
              (t) =>
                `• ${line(
                  t,
                  `bị chặn bởi ${(t.blockedBy || [])
                    .filter((b) => b.status !== 'done')
                    .map((b) => b.key)
                    .join(', ')}`,
                )}`,
            )
            .join('\n')
        : 'Không có công việc bị chặn.',
      refs: [...new Set(blocked.flatMap((t) => [t.id, ...t.blockedBy.filter((b) => b.status !== 'done').map((b) => b.id)]))],
    },
  ];
  // Keep citations for the whole denominator, including on-time tasks, and risk suggestions.
  const sourceTasks = [...new Set([...ov.tasks.map((t) => t.id), ...sections.flatMap((s) => s.refs), ...risks.open.flatMap((r) => r.tasks.map((t) => t.id))])];
  // The provider cannot replace measured completion with an unsupported claim.
  const summary = `Trong giai đoạn ${format(from)} – ${format(new Date(to.getTime() - 1))}, ${project.name} hoàn thành ${stats.done} công việc; tiến độ chung đạt ${stats.progressPct}% (${stats.doneTotal}/${stats.totalTasks}). Tại thời điểm tạo báo cáo có ${stats.overdue} việc quá hạn và ${stats.blocked} việc đang bị chặn.`;
  return { ov, stats, summary, sections, sourceTasks, risks: risks.open, generatedAt: now };
}
