import crypto from 'node:crypto';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Chuẩn hóa văn bản người dùng: bỏ thẻ HTML để nội dung độc hại không thực thi khi hiển thị. */
export function plainText(input = '', max = 5000) {
  return String(input)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .slice(0, max)
    .trim();
}

/** Chống chèn công thức khi mở CSV bằng Excel (CSV/formula injection). */
export function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

export function slugify(input) {
  return (
    String(input)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/gi, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace'
  );
}

export function passwordIssues(pw = '') {
  const issues = [];
  if (pw.length < 8) issues.push('ít nhất 8 ký tự');
  if (Buffer.byteLength(pw, 'utf8') > 72) issues.push('tối đa 72 byte UTF-8 (ký tự có dấu có thể chiếm nhiều byte)');
  if (!/[A-Z]/.test(pw)) issues.push('có chữ hoa');
  if (!/[0-9]/.test(pw)) issues.push('có số');
  return issues;
}
