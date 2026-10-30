import { populate, prisma } from '../../db.js';
import { projectOverview, riskAlerts } from '../metrics.js';
import { BUSINESS_TIMEZONE } from '../../utils/dates.js';

const fmt = (d) => {
  return new Date(d).toLocaleDateString('vi-VN', { timeZone: BUSINESS_TIMEZONE, day: '2-digit', month: '2-digit' });
};
const line = (t, extra = '') => `${t.key} ${t.title}${extra ? ` – ${extra}` : ''}`;

/**
 * Báo cáo tiến độ: MỌI con số tính bằng truy vấn DB; AI (nếu có) chỉ viết phần tóm tắt & đề xuất.
 * Mỗi mục đính kèm refs = công việc nguồn.
 */
export async function buildReportData(projectId, from, to, project, now = new Date()) {
  const end = to; // API supplies an inclusive end instant; never extend a timestamp by 24h.
  const [ov, done, risks] = await Promise.all([
    projectOverview(projectId, { project, now }),
    prisma.task
      .findMany({ where: { deletedAt: null, project: projectId, parent: null, status: 'done', completedAt: { gte: from, lte: end } } })
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
        ? done.map((t) => `• ${line(t, `${t.assignee?.name || 'chưa giao'} · xong ${fmt(t.completedAt)}`)}`).join('\n')
        : 'Chưa có công việc hoàn thành trong khoảng thời gian này.',
      refs: done.map((t) => t.id),
    },
    {
      key: 'late',
      title: `Đang chậm (${late.length} việc)`,
      body: late.length
        ? late
            .map((t) => {
              const hours = Math.max(1, Math.ceil((now - new Date(t.dueDate)) / 3600000));
              return `• ${line(t, hours >= 24 ? `quá hạn ${Math.floor(hours / 24)} ngày` : `quá hạn dưới 24 giờ`)}`;
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
      refs: blocked.map((t) => t.id),
    },
  ];
  const sourceTasks = [...new Set([...done, ...late, ...blocked].map((t) => t.id))];
  return { ov, stats, sections, sourceTasks, risks: risks.open, generatedAt: now };
}
