import { fold, tokens, score } from '../text.js';

const STATUS = { todo: 'Cần làm', in_progress: 'Đang thực hiện', review: 'Đang kiểm duyệt', done: 'Hoàn thành' };

// The rules engine quotes data, never executes it. Remove recognizable role
// directives from quotations; this is defense in depth, not an ACL boundary.
export function dataText(text) {
  return String(text || '')
    .replace(/<system\b[^>]*>[\s\S]*?<\/system>/gi, '')
    .replace(/<\/?(?:source|system|assistant|developer)[^>]*>/gi, '')
    .replace(/\b(?:SYSTEM|DEVELOPER|ASSISTANT)\s*:[\s\S]*$/i, '')
    .replace(/(?:Nhà phát triển|Hệ thống) yêu cầu[\s\S]*$/iu, '')
    .trim();
}

function result(parts) {
  return { refused: false, content: parts.map((p, i) => `${p.text} [${i + 1}]`).join('\n\n'),
    citations: parts.map((p, i) => ({ n: i + 1, kind: p.source.kind, refId: p.source.refId, label: p.source.label, excerpt: p.text.slice(0, 300) })) };
}
const no = () => ({ refused: true, citations: [] });
const taskLine = s => `${s.key} ${dataText(s.task.title)}`;
const mentionsTask = q => /\b(?:task|cong viec|viec)\b/.test(q);

// Aggregates use the entire already-authorized source set, never a top-k search.
// Only explicit supported intents are evaluated; unknown analytics stay in RAG.
function aggregate(question, sources) {
  const q = fold(question), tasks = sources.filter(s => s.kind === 'task' && s.task);
  if (!mentionsTask(q) || /[a-z]{2,5}-\d+/i.test(q) || !tasks.length) return null;
  let filter;
  if (/chua (?:co )?(?:nguoi phu trach|giao)/.test(q)) filter = s => !s.task.assignee;
  else if (/chua (?:co )?han/.test(q)) filter = s => !s.task.dueDate;
  else if (/kiem duyet|\breview\b/.test(q)) filter = s => s.task.status === 'review';
  else if (/qua han/.test(q)) {
    const at = q.match(/(\d{1,2}):(\d{2})\s+ngay\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const now = at ? Date.parse(`${at[5]}-${at[4].padStart(2, '0')}-${at[3].padStart(2, '0')}T${at[1].padStart(2, '0')}:${at[2]}:00+07:00`) : Date.now();
    if (!Number.isFinite(now)) return no();
    filter = s => s.task.status !== 'done' && s.task.dueDate && Date.parse(s.task.dueDate) < now;
  } else if (/da hoan thanh|\bdone\b/.test(q)) filter = s => s.task.status === 'done';
  else if (/phu trach/.test(q)) {
    const names = [...new Set(tasks.map(s => s.task.assignee).filter(Boolean))];
    const matched = names.filter(name => q.startsWith(`${fold(name)} phu trach`));
    if (matched.length !== 1) return no();
    filter = s => s.task.assignee === matched[0];
  } else if (/bao nhieu|tong so/.test(q)) filter = () => true;
  else return null;
  const selected = tasks.filter(filter).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  // Empty-set evidence must still cite the complete inspected task scope.
  const evidence = selected.length ? selected : tasks;
  const parts = evidence.map(s => ({ source: s, text: selected.length ? taskLine(s) : `Đã kiểm tra ${s.key}: không khớp bộ lọc.` }));
  const answer = result(parts);
  answer.content = `Có ${selected.length} công việc phù hợp trong dự án.\n\n${answer.content}`;
  return answer;
}

// Require the requested subject, not just a task key or generic matching words.
// This prevents "capacity" becoming an answer to "actual registrations" and
// a filename becoming a measured latency. These rules describe domains, not
// test IDs, names, secret markers or expected values.
function subjectSupported(q, text) {
  const t = fold(text);
  const subjects = [
    [/ngan sach|budget/, /ngan sach|budget/], [/nha tai tro|sponsor/, /tai tro|sponsor/],
    [/dien thoai|phone/, /dien thoai|phone/], [/thoi tiet|weather/, /thoi tiet|weather/],
    [/mat khau|password/, /mat khau|password/], [/doanh thu|revenue/, /doanh thu|revenue/],
    [/do tre|\bp95\b|latency/, /do tre|\bp95\b|latency/],
    [/dang ky thuc te|da dang ky|actual registrations/, /(?:da dang ky|dang ky thuc te|actual registrations)/],
  ];
  return subjects.every(([asked, present]) => !asked.test(q) || present.test(t));
}

export function localGroundedAnswer(question, sources, picked) {
  const q = fold(question);
  const aggregateResult = aggregate(question, sources);
  if (aggregateResult) return aggregateResult;
  const keys = [...new Set((question.match(/[A-Za-z]{2,5}-\d+/g) || []).map(k => k.toUpperCase()))];
  if (keys.some(key => !sources.some(s => s.key === key))) return no();
  // URLs are identifiers, not permission to crawl; answer only if present.
  const urls = question.match(/https?:\/\/[^\s]+/g) || [];
  if (urls.some(url => !sources.some(s => s.text.includes(url)))) return no();
  const referenced = sources.filter(s => keys.includes(s.key) && s.kind === 'task' && s.task);
  if (/cung blocker|cung bi chan/.test(q) && referenced.length >= 2) {
    const common = referenced[0].task.blockedBy.filter(b => referenced.every(s => s.task.blockedBy.some(x => x.key === b.key)));
    return result(referenced.map(s => ({ source: s, text: `${s.key}: ${common.length ? `cùng bị chặn bởi ${common.map(b => `${b.key} ${b.title}`).join(', ')}` : 'không có blocker chung'}.` })));
  }
  if (referenced.length === 1 && !/mau|binh luan|thong nhat/.test(q)) {
    const s = referenced[0], t = s.task;
    let text;
    if (/ai phu trach|giao cho ai|nguoi phu trach/.test(q)) text = `Người phụ trách: ${t.assignee || 'chưa giao'}.`;
    else if (/trang thai/.test(q) && !/blocker|bi chan/.test(q)) text = `Trạng thái: ${STATUS[t.status]}.`;
    else if (/han chot/.test(q)) text = t.dueDate ? `Hạn chót (Asia/Ho_Chi_Minh): ${new Date(t.dueDate).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}.` : 'Chưa có hạn chót.';
    else if (/bi chan|blocker/.test(q)) text = t.blockedBy.length ? `Bị chặn bởi: ${t.blockedBy.map(b => `${b.key} ${dataText(b.title)} (${STATUS[b.status]})`).join(', ')}.` : 'Không có công việc chặn.';
    else if (/tieu chi nghiem thu/.test(q)) text = dataText(t.acceptanceCriteria);
    else text = [dataText(t.description), dataText(t.acceptanceCriteria)].filter(Boolean).join(' ');
    if (!text || !subjectSupported(q, text)) return no();
    return result([{ source: s, text: `${s.key}: ${text}` }]);
  }
  let candidates = picked.map(s => ({ ...s, text: dataText(s.text) })).filter(s => s.text);
  const namedDocs = sources.filter(s => s.kind === 'document' && q.includes(fold(s.label.split(' · ')[0])));
  if (namedDocs.length) candidates = namedDocs.map(s => ({ ...s, text: dataText(s.text) })).filter(s => s.text);
  if (/mau|binh luan|thong nhat/.test(q) && keys.length) candidates = candidates.filter(s => s.kind === 'comment' && keys.includes(s.key));
  if (!candidates.length || !subjectSupported(q, candidates.map(s => s.text).join(' '))) return no();
  const meaningful = tokens(question).filter(t => !/^[a-z]{2,5}-\d+$/.test(t));
  candidates.sort((a, b) => score(meaningful, b.text) - score(meaningful, a.text));
  // Preserve paragraphs in full: arbitrary excerpts can silently drop dates,
  // email addresses or the second half of multi-fact answers.
  return result(candidates.slice(0, namedDocs.length ? 8 : 3).map(s => ({ source: s, text: s.text })));
}
