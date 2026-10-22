// Tiện ích xử lý tiếng Việt cho tìm kiếm & AI nội bộ

export function fold(s = '') {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

const STOP = new Set(
  'la va cua cho voi cac nhung mot trong khi thi de da dang se duoc bi co khong nao gi sao vi nay do the toi ban minh ai o tai ve ra vao len xuong hay hoac nhu nen rat cung moi neu ma con chua roi'.split(
    ' ',
  ),
);

export function tokens(s = '') {
  return fold(s)
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Điểm khớp đơn giản giữa câu hỏi và đoạn văn: số token chung, ưu tiên mã công việc. */
export function score(queryTokens, text) {
  const set = new Set(tokens(text));
  let s = 0;
  for (const t of queryTokens) {
    if (set.has(t)) s += /^[a-z]{2,4}-\d+$/.test(t) ? 5 : 1;
  }
  return s;
}

export function excerpt(text = '', queryTokens = [], len = 160) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= len) return clean;
  const f = fold(clean);
  let pos = 0;
  for (const t of queryTokens) {
    const i = f.indexOf(t);
    if (i >= 0) {
      pos = Math.max(0, i - 40);
      break;
    }
  }
  return (pos > 0 ? '…' : '') + clean.slice(pos, pos + len).trim() + (pos + len < clean.length ? '…' : '');
}

export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
