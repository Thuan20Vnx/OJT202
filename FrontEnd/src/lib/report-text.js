import { t as tr } from './i18n.js';

/**
 * Nội dung tệp xuất của báo cáo (U022). Tệp rời khỏi app nên phải tự mang đủ căn cứ: trạng thái nháp/đã chia sẻ,
 * kỳ báo cáo, thời điểm chốt số liệu và mã công việc nguồn của từng mục; thiếu các dòng này thì không đối chiếu được.
 */
export function reportText(report, zone) {
  const timeZone = report.timezone || zone;
  const day = (d) => new Date(d).toLocaleDateString('vi-VN', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' });
  const start = report.period_start || report.from;
  const endValue = report.period_end || report.to;
  // Kỳ mới lưu dạng [start, end): ngày cuối là thời điểm ngay trước end.
  const end = report.periodConvention === 'exclusive-end' ? new Date(new Date(endValue).getTime() - 1) : endValue;
  const head = [
    report.title,
    tr('Trạng thái: {0}', [report.status === 'shared' ? tr('Đã chia sẻ nội bộ') : tr('Nháp – chưa chia sẻ')]),
    ...(start && endValue ? [tr('Kỳ báo cáo: {0} – {1} ({2})', [day(start), day(end), timeZone])] : []),
    ...(report.generatedAt ? [tr('Số liệu chốt lúc: {0}', [new Date(report.generatedAt).toLocaleString('vi-VN', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })])] : []),
  ];
  const sections = (report.sections || []).map((s) => {
    const keys = (s.refs || []).map((ref) => (typeof ref === 'string' ? ref : ref.key)).filter(Boolean);
    const label = s.aiSuggested ? ` (${tr('Gợi ý AI')})` : '';
    return `## ${s.title}${label}\n${s.body}${keys.length ? `\n${tr('Nguồn: {0}', [keys.join(', ')])}` : ''}`;
  });
  return `${head.join('\n')}\n\n${sections.join('\n\n')}\n`;
}
