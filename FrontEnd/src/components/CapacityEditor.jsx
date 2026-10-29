import { useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { t as tr, useI18n } from '../lib/i18n.js';

export default function CapacityEditor({ workspaceId, member, onSaved }) {
  useI18n();
  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState(String(member.available));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const save = async () => {
    if (lock.current) return;
    const value = Number(hours);
    if (!hours.trim() || !Number.isFinite(value) || value < 0 || value > 80) {
      setError(tr("Nhập giờ khả dụng từ 0 đến 80."));
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/workspaces/${workspaceId}/members/${member.user._id}`, { weeklyHours: value });
      setEditing(false);
      onSaved();
    } catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); }
  };
  if (!editing) return <button className="mt-1 text-label-md font-semibold text-blue-700 underline" onClick={() => { setHours(String(member.available)); setError(null); setEditing(true); }}>{tr("Chỉnh giờ khả dụng")}</button>;
  return <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
    <label className="text-label-md text-slate-700">{tr("Giờ/tuần")}
      <input aria-label={`${tr("Giờ khả dụng")} ${member.user.name}`} className="input ml-2 w-20" type="number" min="0" max="80" step="0.5" disabled={busy} value={hours} onChange={(e) => setHours(e.target.value)} />
    </label>
    <button className="btn-primary btn-sm" disabled={busy} type="submit">{tr("Lưu")}</button>
    <button className="btn-outline btn-sm" disabled={busy} type="button" onClick={() => setEditing(false)}>{tr("Hủy")}</button>
    {error && <p role="alert" className="w-full text-body-sm text-rose-700">{error}</p>}
  </form>;
}
