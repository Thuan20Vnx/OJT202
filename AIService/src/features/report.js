import { estimateTokens, parseJson } from '../llm.js';
import { BUSINESS_TIMEZONE } from '../dates.js';

const fmt = (d) => {
  return new Intl.DateTimeFormat('en-GB', { timeZone: BUSINESS_TIMEZONE, day: '2-digit', month: '2-digit' }).format(new Date(d));
};

/** Phần chữ của báo cáo tiến độ: số liệu đã tính sẵn ở BackEnd (từ DB), ở đây chỉ viết tóm tắt & đề xuất. */
function localNarrative(project, data, from, to) {
  const { stats, risks } = data;
  const summary = `Trong giai đoạn ${fmt(from)} – ${fmt(to)}, ${project.name} hoàn thành ${stats.done} công việc; tiến độ chung đạt ${stats.progressPct}% (${stats.doneTotal}/${stats.totalTasks}). Hiện có ${stats.overdue} việc quá hạn và ${stats.blocked} việc đang bị chặn.`;
  const suggestions = risks
    .slice(0, 3)
    .map(
      (r) =>
        `• ${r.title}: ${r.type === 'overload' ? 'cân nhắc giao lại bớt việc' : r.type === 'blocked' || r.type === 'overdue' ? 'ưu tiên gỡ việc đang chặn' : 'theo dõi sát tiến độ'}.`,
    );
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
