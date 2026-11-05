import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/app.jsx';
import { t as tr, useI18n } from '../lib/i18n.js';
import { Icon } from './ui.jsx';

/** Chọn nhãn từ danh mục của dự án để số liệu thống kê không bị tách vì khác cách viết. */
export default function LabelPicker({ projectId, value = [], onChange, disabled = false, canCreate = false }) {
  useI18n();
  const toast = useToast();
  const [catalog, setCatalog] = useState([]);
  const [name, setName] = useState('');
  useEffect(() => {
    if (!projectId) return undefined;
    let active = true;
    Promise.resolve().then(() => api.get(`/projects/${projectId}/labels`)).then((d) => { if (active) setCatalog(d?.labels || []); }).catch(() => {});
    return () => { active = false; };
  }, [projectId]);
  // Nhãn cũ đã gắn trên công việc vẫn hiện dù đã bị xóa khỏi danh mục.
  const options = [...new Set([...catalog, ...value])].sort((a, b) => a.localeCompare(b, 'vi'));
  const toggle = (label) => onChange(value.includes(label) ? value.filter((x) => x !== label) : [...value, label]);
  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const created = await api.post(`/projects/${projectId}/labels`, { name: trimmed });
      setCatalog((list) => [...new Set([...list, created.name])]);
      if (!value.includes(created.name)) onChange([...value, created.name]);
      setName('');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={tr('Nhãn')}>
        {options.map((label) => {
          const on = value.includes(label);
          return (
            <button key={label} type="button" disabled={disabled} aria-pressed={on} onClick={() => toggle(label)} className={`chip transition-colors ${on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'} disabled:cursor-not-allowed`}>
              {on && <Icon name="check" size={12} />}{label}
            </button>
          );
        })}
        {!options.length && <span className="text-label-md font-normal text-slate-400">{tr('Dự án chưa có nhãn')}</span>}
      </div>
      {canCreate && !disabled && (
        <input
          className="input h-7 w-full rounded-md px-2 text-label-md"
          aria-label={tr('Tạo nhãn mới')}
          placeholder={tr('+ Tạo nhãn mới, nhấn Enter')}
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              create();
            }
          }}
        />
      )}
    </div>
  );
}
