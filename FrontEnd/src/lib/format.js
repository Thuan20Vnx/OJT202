import { BUSINESS_TIMEZONE, dates, timeZone, zoned } from './dates.js';

export const STATUS = {
  todo: { label: 'Cần làm', short: 'To Do', dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600 border-slate-200' },
  in_progress: { label: 'Đang thực hiện', short: 'In Progress', dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  review: { label: 'Đang kiểm duyệt', short: 'Review', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  done: { label: 'Hoàn thành', short: 'Done', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};
export const STATUS_ORDER = ['todo', 'in_progress', 'review', 'done'];

export const PRIORITY = {
  high: { label: 'Cao', icon: 'flag', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  medium: { label: 'Trung bình', icon: 'horizontal_rule', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  low: { label: 'Thấp', icon: 'south', chip: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export const ROLE = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };

export const PROJECT_COLOR = {
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  slate: 'bg-slate-400',
  cyan: 'bg-cyan-500',
};

const DAY = 86400000;
export const sod = (d = new Date()) => dates.startOfDay(d, timeZone());

export function fmtDate(d, opts = {}) {
  if (!d) return '';
  const date = opts.timeZone ? dates.zoned(d, opts.timeZone) : zoned(d);
  return `${String(date.getDate()).padStart(2, '0')} Th${String(date.getMonth() + 1).padStart(2, '0')}${opts.year ? ` ${date.getFullYear()}` : ''}`;
}
export const fmtProjectDate = (d, opts = {}) => fmtDate(d, { ...opts, timeZone: BUSINESS_TIMEZONE });
export const fmtDateTime = (d) => (d ? `${fmtDate(d)} ${fmtTime(d)}` : '');
export const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('vi-VN', { timeZone: timeZone(), hour: '2-digit', minute: '2-digit' }) : '');
export const isoDate = (d) => {
  if (!d) return '';
  return dates.dateKey(d, timeZone());
};

export function dueInfo(dueDate, status) {
  if (!dueDate) return null;
  const days = Math.round((sod(dueDate) - sod()) / DAY);
  if (status === 'done') return { text: fmtDate(dueDate), tone: 'muted', days };
  if (new Date(dueDate).getTime() < Date.now()) return { text: days < 0 ? `Quá hạn ${-days} ngày` : 'Đã quá hạn hôm nay', tone: 'danger', days };
  if (days === 0) return { text: `${fmtDate(dueDate)} (Hôm nay)`, tone: 'warn', days };
  if (days === 1) return { text: 'Ngày mai', tone: 'warn', days };
  return { text: fmtDate(dueDate), tone: 'normal', days };
}

export function timeAgo(d) {
  if (!d) return '';
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 2 * 86400) return 'Hôm qua';
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} ngày trước`;
  return fmtDate(d, { year: true });
}

export function dayGroup(d) {
  const days = Math.round((sod() - sod(d)) / DAY);
  if (days <= 0) return 'Hôm nay';
  if (days === 1) return 'Hôm qua';
  if (days < 7) return 'Tuần này';
  return 'Trước đó';
}

export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export const fileSize = (n = 0) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

export function fileIcon(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return { icon: 'picture_as_pdf', color: 'text-rose-500 bg-rose-50' };
  if (['png', 'jpg', 'jpeg'].includes(ext)) return { icon: 'image', color: 'text-purple-500 bg-purple-50' };
  return { icon: 'description', color: 'text-blue-600 bg-blue-50' };
}

export function parseUA(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Trình duyệt';
  const os = /iPhone|iPad/.test(ua)
    ? 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'thiết bị';
  return { browser, os, icon: /iPhone|Android/.test(ua) ? 'smartphone' : 'computer' };
}
