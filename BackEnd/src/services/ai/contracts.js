import { z } from 'zod';
import { isDateInput, parseDate } from '../../utils/dates.js';
import { badRequest, parse } from '../../utils/http.js';

const text = (max) => z.string().max(max).refine((value) => !value.includes('\u0000'));
const common = z.object({
  title: text(200).trim().min(1), description: text(2000).optional(),
  acceptanceCriteria: z.array(text(300).trim().min(1)).max(20).optional(),
  estimateHours: z.number().min(0).max(1000).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(), assignee: z.uuid().nullish(),
  dueDate: z.iso.datetime({ offset: true }).nullish(), excerpt: text(30000).optional(),
});

const clipped = (max) => z.string().refine((value) => !value.includes('\u0000')).transform((value) => value.trim().slice(0, max)).refine(Boolean);
const finding = z.object({ title: clipped(200), severity: z.enum(['low', 'medium', 'high']), file: z.string().max(1000).nullish(), line: z.number().int().positive().nullish(), detail: clipped(2000), suggestion: clipped(2000).optional() });
const SEVERITY = { critical: 'high', high: 'high', medium: 'medium', moderate: 'medium', low: 'low', info: 'low', informational: 'low' };
const normalizeFinding = (raw) => (raw && typeof raw === 'object' ? { ...raw, severity: SEVERITY[String(raw.severity).toLowerCase()] ?? 'medium', line: Number(raw.line) > 0 && Number.isInteger(Number(raw.line)) ? Number(raw.line) : null, suggestion: raw.suggestion || undefined } : raw);
// Một mục AI viết sai dạng chỉ làm mất mục đó, không làm hỏng cả lần chạy đã tốn lượt.
const lenient = (schema, max, normalize = (raw) => raw) => z.array(z.unknown()).transform((list) => list.flatMap((raw) => {
  const item = schema.safeParse(normalize(raw));
  return item.success ? [item.data] : [];
}).slice(0, max));
const httpsUrl = z.string().max(500).refine((value) => /^https:\/\//.test(value));
const suggestion = z.object({ title: clipped(200), kind: z.enum(['mcp', 'library', 'skill', 'tool']).catch('tool'), detail: clipped(2000), url: httpsUrl, evidence: clipped(500).nullish().catch(undefined) });
const reportItem = finding.extend({
  severity: z.enum(['low', 'medium', 'high']).optional(), detail: clipped(4000), kind: z.enum(['feature', 'issue', 'mcp', 'library', 'skill', 'tool']).optional().catch(undefined),
  evidence: clipped(500).nullish().catch(undefined), url: httpsUrl.optional().catch(undefined),
});
const normalizeReportItem = (raw) => (raw && typeof raw === 'object' ? { ...normalizeFinding(raw), severity: raw.severity == null ? undefined : SEVERITY[String(raw.severity).toLowerCase()] ?? 'medium' } : raw);

/** Báo cáo do agent trên máy gửi qua MCP: dữ liệu ngoài, kiểm như kết quả AI. Mục sai dạng bị bỏ và được đếm lại. */
export function validateAgentReport(body) {
  const report = parse(z.object({
    kind: z.enum(['review', 'security', 'suggest']), title: clipped(300), summary: clipped(8000),
    target: z.string().trim().max(200).optional(), agent: z.string().trim().max(80).optional(), items: z.array(z.unknown()).max(100).default([]),
  }), body);
  const items = report.items.flatMap((raw) => {
    const item = reportItem.safeParse(normalizeReportItem(raw));
    return item.success ? [item.data] : [];
  });
  return { ...report, items, dropped: report.items.length - items.length };
}

/** Mỗi việc rút từ biên bản phải trỏ đúng một đoạn có thật trong văn bản gốc; ghi lại vị trí để lúc duyệt đối chiếu. */
function locateExcerpts(items, text) {
  const seen = new Set();
  for (const item of items) {
    const start = item.sourceSpan?.start ?? text.indexOf(item.excerpt);
    const end = item.sourceSpan?.end ?? start + item.excerpt.length;
    if (start < 0 || end > text.length || text.slice(start, end) !== item.excerpt)
      throw new Error('Trích đoạn AI không tồn tại trong biên bản gốc');
    if (!item.sourceSpan && text.indexOf(item.excerpt, start + 1) !== -1)
      throw new Error('Trích đoạn AI trùng nhiều vị trí và thiếu vị trí nguồn');
    const key = JSON.stringify([start, end, item.title.toLowerCase()]);
    if (seen.has(key)) throw new Error('Công việc AI trùng tiêu đề và vị trí nguồn');
    seen.add(key);
    // Zero-based UTF-16 offsets, [start,end), against the immutable draft input.text.
    item.sourceSpan = { start, end };
  }
}

const agentName = z.string().trim().max(80).optional();
const dateInput = z.string().refine(isDateInput, 'Ngày phải có dạng YYYY-MM-DD hoặc ISO kèm múi giờ').nullish();
const draftItem = z.object({
  title: text(200).trim().min(1), description: text(2000).trim().min(1, 'Mỗi việc cần mô tả'),
  acceptanceCriteria: z.array(text(300).trim().min(1)).min(1, 'Mỗi việc cần ít nhất một tiêu chí nghiệm thu').max(8),
  estimateHours: z.number().positive().max(1000), priority: z.enum(['low', 'medium', 'high']).default('medium'), dueDate: dateInput,
}).strict();

/**
 * Kế hoạch do agent trên máy soạn (MCP). Sai là từ chối cả bản và nói rõ lý do để agent sửa rồi gửi lại:
 * khác kết quả AI trên web, agent còn ngữ cảnh để chữa.
 */
export function validateAgentPlan(body, timezone, now = new Date()) {
  const plan = parse(z.object({
    goal: text(2000).trim().min(5, 'Mục tiêu quá ngắn'), deadline: dateInput, people: z.number().int().min(1).max(50).nullish(), maxHours: z.number().min(1).max(5000).nullish(),
    agent: agentName, items: z.array(draftItem).min(1, 'Kế hoạch cần ít nhất một công việc').max(15),
  }).strict(), body);
  const deadline = plan.deadline ? parseDate(plan.deadline, timezone, true) : null;
  if (deadline && deadline < now) throw badRequest('Hạn hoàn thành kế hoạch đã qua');
  const total = plan.items.reduce((sum, item) => sum + item.estimateHours, 0);
  if (plan.maxHours != null && total > plan.maxHours + 1e-9) throw badRequest(`Tổng ước lượng ${total} giờ vượt giới hạn ${plan.maxHours} giờ của kế hoạch`);
  for (const item of plan.items) {
    if (!item.dueDate) continue;
    const due = parseDate(item.dueDate, timezone, true);
    if (due < now) throw badRequest(`Hạn của "${item.title}" đã qua`);
    if (deadline && due > deadline) throw badRequest(`Hạn của "${item.title}" vượt hạn hoàn thành kế hoạch`);
  }
  return { ...plan, deadline: deadline?.toISOString() ?? null, people: plan.people ?? null, maxHours: plan.maxHours ?? null };
}

/** Việc cần làm agent rút từ biên bản họp (MCP): mỗi việc phải kèm trích đoạn nguyên văn có trong biên bản. */
export function validateAgentMeeting(body) {
  const meeting = parse(z.object({
    title: text(200).trim().min(1, 'Nhập tên cuộc họp'), text: text(30000).trim().min(10, 'Biên bản quá ngắn'), agent: agentName,
    items: z.array(z.object({
      title: text(200).trim().min(1), description: text(2000).optional(), priority: z.enum(['low', 'medium', 'high']).default('medium'),
      assignee: z.uuid().nullish(), dueDate: dateInput, excerpt: text(30000).trim().min(1, 'Mỗi việc cần trích đoạn nguyên văn từ biên bản'),
    }).strict()).min(1, 'Cần ít nhất một việc cần làm').max(20),
  }).strict(), body);
  try {
    locateExcerpts(meeting.items, meeting.text);
  } catch (e) {
    throw badRequest(`${e.message.replaceAll('AI', 'agent')}. Trích đoạn (excerpt) phải chép nguyên văn một đoạn chỉ xuất hiện một lần trong biên bản.`);
  }
  return meeting;
}

/** Câu trả lời agent muốn lưu vào Hỏi đáp: nguồn trích dẫn là mã `ref` lấy từ search_project. */
export function validateAgentAnswer(body) {
  return parse(z.object({
    question: text(1000).trim().min(3, 'Câu hỏi quá ngắn'),
    answer: text(8000).trim().min(1, 'Thiếu câu trả lời'),
    citations: z.array(z.object({ ref: z.string().max(200), excerpt: text(500).trim().optional() }).strict()).max(10).default([]),
    conversationId: z.uuid().optional(),
    agent: agentName,
  }).strict(), body);
}

/** An internal HTTP response is still untrusted input, including with a configured provider. */
export function validateAiResult(feature, result, payload) {
  if (feature === 'planner') {
    const parsed = z.object({ items: z.array(common.extend({
      description: text(2000).trim().min(1), acceptanceCriteria: z.array(text(300).trim().min(1)).min(1).max(8),
      estimateHours: z.number().positive().max(1000),
    })).min(5).max(15) }).parse(result);
    if (payload.maxHours != null && parsed.items.reduce((sum, item) => sum + item.estimateHours, 0) > payload.maxHours + 1e-9) throw new Error('AI trả kế hoạch vượt tổng giờ tối đa');
    if (parsed.items.some((item) => item.dueDate && (!payload.deadline || new Date(item.dueDate) > new Date(payload.deadline) || new Date(item.dueDate) < new Date()))) throw new Error('AI trả hạn không thuộc kế hoạch');
    return parsed;
  }
  if (feature === 'meeting') {
    const span = z.object({ start: z.number().int().min(0), end: z.number().int().min(1) }).strict();
    const parsed = z.object({ items: z.array(common.extend({ excerpt: text(30000).trim().min(1), sourceSpan: span.optional() })).max(20) }).parse(result);
    locateExcerpts(parsed.items, payload.text);
    return parsed;
  }
  if (feature === 'suggest' && payload.stage === 'queries') return z.object({ queries: lenient(clipped(80), 5) }).parse(result);
  if (feature === 'suggest') {
    const parsed = z.object({ summary: clipped(2000), suggestions: lenient(suggestion, 6) }).parse(result);
    // Chỉ giữ gợi ý trỏ tới ứng viên TaskFlow đã tra được: AI không được tự nghĩ ra tên hay đường link.
    const urls = new Set(payload.candidates.map((c) => c.url));
    parsed.suggestions = parsed.suggestions.filter((item) => urls.has(item.url));
    return parsed;
  }
  if (feature === 'report') return z.object({ summary: text(20000), suggestions: text(20000) }).parse(result);
  return result;
}
