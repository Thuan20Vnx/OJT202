const KNOWN = [
  ['Khóa AWS', /\bAKIA[0-9A-Z]{16}\b/g],
  ['Token GitHub', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g],
  ['Token GitLab', /\bglpat-[A-Za-z0-9_-]{16,}\b/g],
  ['Khóa Google', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ['Khóa API', /\bsk-[A-Za-z0-9_-]{24,}\b/g],
  ['Khóa riêng', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g],
];
const ASSIGNED = /((?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)["']?\s*[:=]\s*)(["'])([^"'\s]{8,})\2/gi;
// Giá trị không có ngoặc (password=abc12345, token: abc12345): dừng ở khoảng trắng/dấu phân cách.
const ASSIGNED_BARE = /((?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*)([^"'\s,;)}\]]{8,})/gi;
// Cả khối PEM (thân base64 nằm ở các dòng sau dòng BEGIN), xử lý trước khi tách dòng.
const PEM_BLOCK = /-----BEGIN ((?:[A-Z]+ )*)PRIVATE KEY-----[\s\S]*?(?:-----END \1PRIVATE KEY-----|$)/g;
const PLACEHOLDER = /^(?:change-?me|your|example|xxx|test|dummy|placeholder|<|\$\{|process\.env)/i;
export const MASK = '[ĐÃ ẨN]';

/** Che bí mật trước khi gửi cho AI. Chỉ trả vị trí và loại, không bao giờ giữ giá trị. */
export function redactSecrets(text, { addedLinesOnly = false } = {}) {
  const hits = [];
  const source = String(text).replace(PEM_BLOCK, (_block, _kind, offset, all) => {
    hits.push({ type: 'Khóa riêng', severity: 'high', line: addedLinesOnly ? null : all.slice(0, offset).split('\n').length });
    return MASK;
  });
  const lines = source.split('\n').map((line, index) => {
    let out = line;
    const report = (type, severity) => {
      if (!addedLinesOnly || line.startsWith('+')) hits.push({ type, severity, line: addedLinesOnly ? null : index + 1 });
    };
    for (const [type, re] of KNOWN) {
      out = out.replace(re, () => {
        report(type, 'high');
        return MASK;
      });
    }
    out = out.replace(ASSIGNED, (match, prefix, quote, value) => {
      if (PLACEHOLDER.test(value)) return match;
      report('Giá trị bí mật viết thẳng trong code', 'medium');
      return `${prefix}${quote}${MASK}${quote}`;
    });
    out = out.replace(ASSIGNED_BARE, (match, prefix, value) => {
      if (PLACEHOLDER.test(value) || value.startsWith('[')) return match;
      report('Giá trị bí mật viết thẳng trong code', 'medium');
      return `${prefix}${MASK}`;
    });
    return out;
  });
  return { text: lines.join('\n'), hits };
}

export const secretFinding = (file, hit) => ({
  title: `Lộ thông tin bí mật: ${hit.type}`, severity: hit.severity, file, line: hit.line,
  detail: 'Phát hiện bằng bộ quét của TaskFlow. Giá trị đã được che và không gửi cho AI.',
  suggestion: 'Nếu đây là giá trị dùng thật: thu hồi, chuyển sang biến môi trường và xóa khỏi lịch sử git. Nếu chỉ dùng cho môi trường cục bộ thì có thể bỏ qua.',
});
