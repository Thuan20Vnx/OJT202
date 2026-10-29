import { t as tr, useI18n } from '../lib/i18n.js';
import { useEffect, useRef, useState } from 'react';
import { PRIORITY, STATUS, initials } from '../lib/format.js';
import Select from './Select.jsx';

export const Icon = ({ name, className = '', fill = false, size }) => (
  (useI18n(), (<span className={`material-symbols-outlined ${fill ? 'icon-fill' : ''} ${className}`} style={size ? { fontSize: size } : undefined} aria-hidden="true">
    {name}
  </span>))
);

const AVATAR_TONES = ['bg-blue-100 text-blue-700', 'bg-emerald-100 text-emerald-700', 'bg-purple-100 text-purple-700', 'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700', 'bg-cyan-100 text-cyan-700', 'bg-indigo-100 text-indigo-700'];
const tone = (s = '') => AVATAR_TONES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];

export function Avatar({ user, size = 28, ring = false }) {
  useI18n();
  if (!user) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400" style={{ width: size, height: size }} title={tr("Chưa giao")}>
        <Icon name="person" size={size * 0.55} />
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold ${tone(user.name)} ${ring ? 'ring-2 ring-white' : ''}`}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38) }}
      title={user.name}
    >
      {initials(user.name)}
    </span>
  );
}

export function AvatarStack({ users = [], max = 4, size = 26 }) {
  useI18n();
  const shown = users.slice(0, max);
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((u) => (
        <Avatar key={u._id} user={u} size={size} ring />
      ))}
      {users.length > max && (
        <span className="inline-flex items-center justify-center rounded-full bg-slate-100 text-label-sm text-slate-600 ring-2 ring-white" style={{ width: size, height: size }}>
          +{users.length - max}
        </span>
      )}
    </div>
  );
}

export const StatusChip = ({ status }) => (
  (useI18n(), (<span className={`chip ${STATUS[status]?.chip}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${STATUS[status]?.dot}`} />
    {STATUS[status]?.label}
  </span>))
);

export const PriorityChip = ({ priority }) => (
  (useI18n(), (<span className={`chip ${PRIORITY[priority]?.chip}`}>
    <Icon name={PRIORITY[priority]?.icon} size={12} />
    {PRIORITY[priority]?.label}
  </span>))
);

export const Chip = ({ children, className = 'border-slate-200 bg-slate-50 text-slate-600', icon }) => (
  (useI18n(), (<span className={`chip ${className}`}>
    {icon && <Icon name={icon} size={12} />}
    {children}
  </span>))
);

export { Select };

/** Dấu tích thành công có hiệu ứng: vòng tròn bật ra, nét tích vẽ dần, vầng sáng lan tỏa */
export function SuccessCheck({ size = 64, tone = 'emerald' }) {
  useI18n();
  const tones = { emerald: ['bg-emerald-500', 'bg-emerald-400'], blue: ['bg-blue-600', 'bg-blue-400'] }[tone];
  return (
    <span className="relative mx-auto flex items-center justify-center" style={{ width: size, height: size }}>
      <span className={`success-ring absolute inset-0 rounded-full ${tones[1]}`} />
      <span className={`success-pop relative flex h-full w-full items-center justify-center rounded-full text-white shadow-lg ${tones[0]}`}>
        <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path className="success-check" d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    </span>
  );
}

export const Spinner = ({ className = '' }) => (useI18n(), (<span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />));

export const PageLoader = () => (
  (useI18n(), (<div role="status" aria-label={tr("Đang tải dữ liệu")} className="flex h-full min-h-[240px] items-center justify-center text-blue-600">
    <Spinner className="h-6 w-6" />
  </div>))
);

export function Empty({ icon = 'inbox', title, children, action }) {
  useI18n();
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Icon name={icon} size={26} />
      </span>
      <p className="text-label-lg font-semibold text-slate-800">{title}</p>
      {children && <p className="mt-1 max-w-sm text-body-sm text-slate-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  useI18n();
  if (!error) return null;
  return (
    <div role="alert" className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-body-sm text-rose-700">
      <Icon name="error" size={18} />
      <span className="flex-1">{error.message || String(error)}</span>
      {onRetry && (
        <button className="font-semibold underline" onClick={onRetry}>{tr("Thử lại")}</button>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', icon, children, className = '' }) {
  useI18n();
  const t = {
    info: 'border-blue-200 bg-blue-50 text-blue-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    danger: 'border-rose-200 bg-rose-50 text-rose-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  }[tone];
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-body-sm ${t} ${className}`}>
      <Icon name={icon || { info: 'info', warn: 'warning', danger: 'error', success: 'check_circle' }[tone]} size={18} className="mt-px shrink-0" />
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function Modal({ open, onClose, title, subtitle, icon, children, footer, width = 'max-w-lg', bodyClass = 'p-5' }) {
  useI18n();
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`animate-slide-in flex max-h-[92vh] w-full ${width} flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop`} role="dialog" aria-modal="true">
        {title && (
          <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
            {icon && (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Icon name={icon} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-headline-sm text-slate-900">{title}</h2>
              {subtitle && <p className="text-body-sm text-slate-500">{subtitle}</p>}
            </div>
            <button className="icon-btn -mr-2 -mt-1" onClick={onClose} aria-label={tr("Đóng")}>
              <Icon name="close" />
            </button>
          </div>
        )}
        <div className={`scroll-thin flex-1 overflow-y-auto ${bodyClass}`}>{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ open, title, children, confirmText = tr("Xác nhận"), danger, onConfirm, onClose, busy }) {
  useI18n();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      icon={danger ? 'warning' : 'help'}
      footer={
        <>
          <button className="btn-outline" onClick={onClose}>{tr("Hủy")}</button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy}>
            {busy && <Spinner />}
            {confirmText}
          </button>
        </>
      }
    >
      <div className="text-body-md text-slate-600">{children}</div>
    </Modal>
  );
}

export function Field({ label, required, error, hint, children, className = '' }) {
  useI18n();
  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="label">
          {label}
          {required && <span className="text-rose-500"> *</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="field-error">
          <Icon name="error" size={14} />
          {error}
        </span>
      ) : (
        hint && <span className="mt-1 block text-label-md font-normal text-slate-400">{hint}</span>
      )}
    </label>
  );
}

export function Toggle({ checked, onChange, disabled, label }) {
  useI18n();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

export function Progress({ value, className = '', tone = 'bg-blue-600', height = 'h-1.5' }) {
  useI18n();
  return (
    <div className={`w-full overflow-hidden rounded-full bg-slate-100 ${height} ${className}`}>
      <div className={`h-full rounded-full ${tone} transition-all`} style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
    </div>
  );
}

export function Pagination({ page, total, limit, onPage, onLimit }) {
  useI18n();
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total ? (page - 1) * limit + 1 : 0;
  const to = Math.min(total, page * limit);
  const nums = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) nums.push(i);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-body-sm text-slate-500">
      <span>{tr("Hiển thị ")}{from}–{to}{tr(" trên ")}{total}
      </span>
      <div className="flex items-center gap-1">
        {onLimit && (
          <Select className="input mr-2 h-8 w-auto py-0 text-body-sm" value={limit} onChange={(e) => onLimit(Number(e.target.value))}>
            {[10, 20, 50].map((n) => (
              <option key={n} value={n}>
                {n} / trang
              </option>
            ))}
          </Select>
        )}
        <button className="icon-btn h-8 w-8" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={tr("Trang trước")}>
          <Icon name="chevron_left" />
        </button>
        {nums.map((n) => (
          <button key={n} onClick={() => onPage(n)} className={`h-8 min-w-8 rounded-lg px-2 text-label-md ${n === page ? 'bg-blue-600 font-semibold text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            {n}
          </button>
        ))}
        <button className="icon-btn h-8 w-8" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Trang sau">
          <Icon name="chevron_right" />
        </button>
      </div>
    </div>
  );
}

export function PageHeader({ title, icon, subtitle, badge, actions, children }) {
  useI18n();
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {icon && <Icon name={icon} className="text-purple-500" size={24} />}
            <h1 className="text-headline-lg text-slate-900">{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="mt-0.5 text-body-sm text-slate-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className = '' }) {
  useI18n();
  return (
    <div className={`flex gap-6 overflow-x-auto border-b border-slate-200 ${className}`}>
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)} className={`tab ${value === t.value ? 'tab-active' : ''}`}>
          {t.icon && <Icon name={t.icon} size={18} />}
          {t.label}
          {t.count != null && <span className={`rounded-full px-1.5 text-label-sm ${value === t.value ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Dropdown đơn giản đóng khi bấm ra ngoài */
export function Dropdown({ trigger, children, align = 'right', width = 'w-56' }) {
  useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          className={`animate-pop-in absolute z-50 mt-1.5 ${width} ${align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'} rounded-lg border border-slate-200 bg-white p-1 shadow-pop`}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export const MenuItem = ({ icon, children, onClick, danger, disabled }) => (
  (useI18n(), (<button
    disabled={disabled}
    onClick={onClick}
    className={`flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-body-sm transition-colors disabled:opacity-40 ${danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-100'}`}
  >
    {icon && <Icon name={icon} size={18} />}
    {children}
  </button>))
);

export function StatCard({ label, value, sub, icon, tone = 'blue', onClick, active, children }) {
  useI18n();
  const tones = {
    blue: 'bg-blue-50 text-blue-600',
    red: 'bg-rose-50 text-rose-600',
    amber: 'bg-amber-50 text-amber-600',
    green: 'bg-emerald-50 text-emerald-600',
    purple: 'bg-purple-50 text-purple-600',
    slate: 'bg-slate-100 text-slate-600',
  };
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`card p-4 text-left transition-all ${onClick ? 'hover:border-blue-200 hover:shadow-card' : ''} ${active ? 'border-blue-300 ring-2 ring-blue-100' : ''}`}>
      <div className="flex items-start justify-between">
        <span className="section-label">{label}</span>
        {icon && (
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`}>
            <Icon name={icon} size={18} />
          </span>
        )}
      </div>
      <div className="mt-1 text-headline-lg text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-label-md font-normal text-slate-500">{sub}</div>}
      {children}
    </Tag>
  );
}
