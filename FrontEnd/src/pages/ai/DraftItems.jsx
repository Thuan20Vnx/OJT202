import { useState } from 'react';
import { MemberPicker } from '../../components/CreateTaskModal.jsx';
import { Avatar, Icon, PriorityChip, Select, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useToast } from '../../lib/app.jsx';
import { PRIORITY, fmtDate, isoDate } from '../../lib/format.js';

/** Danh sách mục nháp dùng chung cho Lập kế hoạch & Ghi chú họp: sửa, chọn, xóa, duyệt. */
export default function DraftItems({ draft, setDraft, members, title, onApproved, onRegenerate, regenerating, showExcerpt, canManage = false }) {
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const readOnly = draft.status !== 'draft' || !canManage;
  const items = draft.items;
  const selected = items.filter((i) => i.selected);
  const hours = selected.reduce((s, i) => s + (i.estimateHours || 0), 0);

  const patch = async (body) => {
    try {
      const d = await api.patch(`/ai/drafts/${draft._id}`, body);
      setDraft(d.draft);
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  };
  const startEdit = (it) => {
    setEditing(it.key);
    setForm({
      title: it.title,
      description: it.description || '',
      estimateHours: it.estimateHours ?? '',
      priority: it.priority,
      assignee: it.assignee?._id || '',
      dueDate: isoDate(it.dueDate),
      acceptanceCriteria: (it.acceptanceCriteria || []).join('\n'),
    });
  };
  const saveEdit = async (key) => {
    const saved = await patch({
      items: [
        {
          key,
          title: form.title,
          description: form.description,
          estimateHours: form.estimateHours === '' ? null : Number(form.estimateHours),
          priority: form.priority,
          assignee: form.assignee || null,
          dueDate: form.dueDate === isoDate(items.find((it) => it.key === key)?.dueDate) ? (items.find((it) => it.key === key)?.dueDate ?? null) : form.dueDate || null,
          acceptanceCriteria: form.acceptanceCriteria
            .split('\n')
            .map((x) => x.trim())
            .filter(Boolean),
        },
      ],
    });
    if (saved) setEditing(null);
  };
  const approve = async () => {
    setBusy(true);
    try {
      const d = await api.post(`/ai/drafts/${draft._id}/approve`);
      toast(`Đã tạo ${d.created.length} công việc vào dự án`);
      setDraft({ ...draft, status: 'approved' });
      onApproved?.(d.created);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    await api.post(`/ai/drafts/${draft._id}/discard`);
    setDraft(null);
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="card mb-3 flex flex-wrap items-center gap-3 px-4 py-3">
        <h2 className="text-headline-sm text-slate-900">
          {title} ({items.length} việc)
        </h2>
        {readOnly ? (
          <span className="chip border-emerald-200 bg-emerald-50 text-emerald-700">
            {draft.status === 'approved' ? 'Đã duyệt – đã tạo công việc' : draft.status === 'discarded' ? 'Đã hủy' : 'Chỉ xem'}
          </span>
        ) : (
          <span className="chip border-amber-200 bg-amber-50 text-amber-700">● Nháp – chưa lưu vào dự án</span>
        )}
        {!readOnly && (
          <label className="ml-auto flex items-center gap-2 text-body-sm text-slate-600">
            <input
              type="checkbox"
              className="form-checkbox rounded text-blue-600"
              checked={selected.length === items.length && items.length > 0}
              onChange={(e) => patch({ items: items.map((i) => ({ key: i.key, selected: e.target.checked })) })}
            />
            Chọn tất cả
          </label>
        )}
        <span className="text-body-sm text-slate-600">
          Đã chọn{' '}
          <b>
            {selected.length}/{items.length}
          </b>
          {hours > 0 && (
            <>
              {' '}
              · <b className="text-blue-700">{Number(hours.toFixed(2))} giờ</b> ước lượng
            </>
          )}
        </span>
      </div>
      <div className="space-y-3 pb-24">
        {items.map((it) =>
          editing === it.key ? (
            <div key={it.key} className="card border-blue-300 p-4 ring-2 ring-blue-100">
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-label-sm uppercase tracking-wider text-blue-700">
                  <Icon name="edit_note" size={16} /> Chỉnh sửa công việc nháp
                </span>
                <div className="flex gap-2">
                  <button className="btn-outline btn-sm" onClick={() => setEditing(null)}>
                    Hủy
                  </button>
                  <button className="btn-primary btn-sm" onClick={() => saveEdit(it.key)}>
                    Lưu sửa
                  </button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="md:col-span-2">
                  <span className="label">Tên công việc</span>
                  <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </label>
                <label className="md:col-span-2">
                  <span className="label">Mô tả ngắn</span>
                  <textarea className="textarea" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </label>
                <label className="md:col-span-2">
                  <span className="label">Tiêu chí nghiệm thu (mỗi dòng một tiêu chí)</span>
                  <textarea className="textarea" rows={2} value={form.acceptanceCriteria} onChange={(e) => setForm({ ...form, acceptanceCriteria: e.target.value })} />
                </label>
                <div>
                  <span className="label">Người nhận</span>
                  <MemberPicker members={members} value={form.assignee} onChange={(v) => setForm({ ...form, assignee: v })} placeholder="Chọn người nhận" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label>
                    <span className="label">Giờ</span>
                    <input type="number" min="0" className="input" value={form.estimateHours} onChange={(e) => setForm({ ...form, estimateHours: e.target.value })} />
                  </label>
                  <label>
                    <span className="label">Ưu tiên</span>
                    <Select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                      {Object.entries(PRIORITY).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label>
                    <span className="label">Hạn</span>
                    <input type="date" className="input px-2" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
                  </label>
                </div>
              </div>
            </div>
          ) : (
            <div key={it.key} className={`card p-4 transition-opacity ${it.selected ? '' : 'opacity-60'}`}>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  className="form-checkbox mt-1 h-4 w-4 rounded text-blue-600"
                  checked={it.selected}
                  onChange={(e) => patch({ items: [{ key: it.key, selected: e.target.checked }] })}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-body-md font-semibold text-slate-900">{it.title}</p>
                    {!readOnly && (
                      <div className="flex shrink-0 gap-1">
                        <button className="icon-btn h-7 w-7" onClick={() => startEdit(it)} title="Sửa">
                          <Icon name="edit" size={16} />
                        </button>
                        <button className="icon-btn h-7 w-7 hover:text-rose-600" onClick={() => patch({ removeKeys: [it.key] })} title="Xóa khỏi nháp">
                          <Icon name="delete" size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                  {it.description && <p className="mt-0.5 text-body-sm text-slate-600">{it.description}</p>}
                  {showExcerpt && it.excerpt && <p className="mt-2 border-l-2 border-purple-300 bg-purple-50/50 py-1 pl-3 text-body-sm italic text-slate-600">“{it.excerpt}”</p>}
                  {it.acceptanceCriteria?.length > 0 && (
                    <p className="mt-2 rounded-lg bg-slate-50 px-3 py-1.5 text-label-md font-normal text-slate-600">
                      <b className="font-semibold">Tiêu chí nghiệm thu:</b> {it.acceptanceCriteria.map((c) => `• ${c}`).join(' ')}
                    </p>
                  )}
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {it.estimateHours != null && (
                      <span className="chip border-slate-200 bg-white text-slate-600">
                        <Icon name="schedule" size={12} /> {it.estimateHours} giờ
                      </span>
                    )}
                    <PriorityChip priority={it.priority} />
                    {it.dueDate ? (
                      <span className="chip border-slate-200 bg-white text-slate-600">
                        <Icon name="event" size={12} /> {fmtDate(it.dueDate)}
                      </span>
                    ) : (
                      <span className="chip border-amber-300 bg-amber-50 text-amber-700">
                        <Icon name="help" size={12} /> Chưa rõ hạn
                      </span>
                    )}
                    <span className="ml-auto">
                      {it.assignee ? (
                        <span className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-0.5 text-label-md">
                          <Avatar user={it.assignee} size={18} /> {it.assignee.name}
                        </span>
                      ) : (
                        <button disabled={readOnly} onClick={() => startEdit(it)} className="chip border-amber-300 bg-amber-50 text-amber-700">
                          <Icon name="person_add" size={12} /> Chưa rõ người phụ trách
                        </button>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ),
        )}
        {!items.length && <p className="card p-6 text-center text-body-sm text-slate-500">Bản nháp trống.</p>}
      </div>
      {!readOnly && (
        <div className="sticky bottom-0 -mx-1 mt-auto flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-pop">
          <span className="mr-auto flex items-center gap-1.5 text-label-md font-normal text-slate-500">
            <Icon name="info" size={14} /> Bấm duyệt nhiều lần không tạo trùng công việc.
          </span>
          <button className="btn border border-rose-200 text-rose-600 hover:bg-rose-50" onClick={discard}>
            Hủy bản nháp
          </button>
          {onRegenerate && (
            <button className="btn-outline" onClick={onRegenerate} disabled={regenerating}>
              {regenerating ? <Spinner /> : <Icon name="refresh" size={16} />} Tạo lại
            </button>
          )}
          <button className="btn-primary" onClick={approve} disabled={busy || !selected.length}>
            {busy ? <Spinner /> : <Icon name="check_circle" size={16} />}
            Duyệt & tạo {selected.length} công việc
          </button>
        </div>
      )}
    </div>
  );
}
