import { populate, prisma } from '../../db.js';
import { projectOverview, riskAlerts, startOfDay } from '../metrics.js';
import { estimateTokens, parseJson } from './gateway.js';

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

function localNarrative(project, data, from, to) {
  const { stats, risks } = data;
  const summary = `Trong giai đoạn ${fmt(from)} – ${fmt(to)}, ${project.name} hoàn thành ${stats.done} công việc; tiến độ chung đạt ${stats.progressPct}% (${stats.doneTotal}/${stats.totalTasks}). Hiện có ${stats.overdue} việc quá hạn và ${stats.blocked} việc đang bị chặn.`;
  const suggestions = risks.slice(0, 3).map((r) => `• ${r.title}: ${r.type === 'overload' ? 'cân nhắc giao lại bớt việc' : r.type === 'blocked' || r.type === 'overdue' ? 'ưu tiên gỡ việc đang chặn' : 'theo dõi sát tiến độ'}.`);
  return { summary, suggestions: suggestions.length ? suggestions.join('\n') : '• Duy trì nhịp độ hiện tại, chưa phát hiện rủi ro theo quy tắc.' };
}

export async function writeNarrative(llm, project, data, from, to, signal) {
  if (!llm) {
    const n = localNarrative(project, data, from, to);
    return { ...n, inputTokens: 300, outputTokens: estimateTokens(n.summary + n.suggestions) };
  }
  const facts = JSON.stringify({ stats: data.stats, sections: data.sections.map((s) => ({ title: s.title, body: s.body })), risks: data.risks.map((r) => r.title) });
  const out = await llm.complete({
    system: 'Bạn viết báo cáo tiến độ dự án bằng tiếng Việt. Chỉ dùng số liệu được cung cấp, không bịa thêm số liệu hay công việc.',
    prompt: `Dự án: ${project.name}. Khoảng ngày ${fmt(from)} – ${fmt(to)}.\nDữ kiện (đã tính từ DB): ${facts}\n\nTrả JSON {"summary": "2-3 câu tóm tắt", "suggestions": "2-3 gạch đầu dòng bắt đầu bằng •, mỗi dòng nhắc mã công việc liên quan"}`,
    maxTokens: 800,
    signal,
  });
  const j = parseJson(out.text);
  return { summary: String(j.summary || ''), suggestions: String(j.suggestions || ''), inputTokens: out.inputTokens, outputTokens: out.outputTokens };
}
