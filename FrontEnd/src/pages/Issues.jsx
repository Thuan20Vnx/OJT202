import { useState } from 'react';
import { Avatar, Empty, ErrorBox, Field, Icon, Modal, PageHeader, PageLoader, Select } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useApp, useLoad, useToast } from '../lib/app.jsx';
import { fmtProjectDate as fmtDate, timeAgo } from '../lib/format.js';
import { useProjectInfo, useSocketEvent } from '../lib/hooks.js';
import { t as tr, useI18n } from '../lib/i18n.js';

export const ISSUE_TYPE = {
  technical: { get label() { return tr('Kỹ thuật'); }, icon: 'bug_report' },
  absence: { get label() { return tr('Ốm / vắng mặt'); }, icon: 'sick' },
  scope: { get label() { return tr('Thay đổi yêu cầu'); }, icon: 'swap_horiz' },
  external: { get label() { return tr('Phụ thuộc bên ngoài'); }, icon: 'link' },
  other: { get label() { return tr('Khác'); }, icon: 'more_horiz' },
};
const SEVERITY = {
  low: { get label() { return tr('Thấp'); }, chip: 'border-slate-200 bg-slate-50 text-slate-600' },
  medium: { get label() { return tr('Trung bình'); }, chip: 'border-blue-200 bg-blue-50 text-blue-700' },
  high: { get label() { return tr('Cao'); }, chip: 'border-amber-200 bg-amber-50 text-amber-700' },
  critical: { get label() { return tr('Nghiêm trọng'); }, chip: 'border-rose-200 bg-rose-50 text-rose-700' },
};
const BLANK = { title: '', type: 'technical', severity: 'medium', cause: '', action: '', owner: '', affectedUser: '', startDate: '', endDate: '' };

export default function Issues() {
  useI18n();
  const { project, me } = useApp();
  const toast = useToast();
  const info = useProjectInfo(project?._id);
  const [status, setStatus] = useState('open');
  const [type, setType] = useState('');
  const query = new URLSearchParams({ ...(status && { status }), ...(type && { type }) }).toString();
  const { data, error, loading, reload } = useLoad(() => (project ? api.get(`/projects/${project._id}/issues?${query}`) : Promise.resolve(null)), [project?._id, query]);
  useSocketEvent('issues:changed', () => reload(), [reload]);
  const [form, setForm] = useState(null);
  const [resolving, setResolving] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!project) return <Empty icon="folder_off" title={tr('Chọn dự án để xem vấn đề')} />;
  if (loading && !data) return <PageLoader />;
  if (error) return <div className="p-6"><ErrorBox error={error} onRetry={reload} /></div>;

  const base = `/projects/${project._id}/issues`;
  const members = info?.project?.members || [];
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const run = async (action, message, done) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toast(message);
      done();
      reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const create = (e) => {
    e.preventDefault();
    const absent = form.type === 'absence';
    run(() => api.post(base, {
      title: form.title, type: form.type, severity: form.severity, cause: form.cause, action: form.action,
      owner: form.owner || null,
      affectedUser: absent ? form.affectedUser || null : null,
      startDate: absent ? form.startDate || null : null,
      endDate: absent ? form.endDate || null : null,
    }), tr('Đã ghi nhận vấn đề'), () => setForm(null));
  };
  const canUpdate = (i) => data.access.canManage || i.owner === me._id || i.reporter === me._id;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 lg:p-6">
      <PageHeader
        title={tr('Vấn đề của dự án')}
        subtitle={`${project.name} · ${tr('Ghi lại những gì làm chậm nhóm: lỗi kỹ thuật, thành viên ốm hoặc vắng, thay đổi yêu cầu…')}`}
        actions={data.access.canWrite && <button className="btn-primary" onClick={() => setForm({ ...BLANK })}><Icon name="add" size={16} />{tr(' Báo vấn đề')}</button>}
      />
      <div className="flex flex-wrap gap-2">
        <Select aria-label={tr('Trạng thái')} className="input h-8 w-auto py-0 text-body-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">{tr('Đang mở')}</option>
          <option value="resolved">{tr('Đã xử lý')}</option>
          <option value="">{tr('Tất cả')}</option>
        </Select>
        <Select aria-label={tr('Loại vấn đề')} className="input h-8 w-auto py-0 text-body-sm" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{tr('Mọi loại')}</option>
          {Object.entries(ISSUE_TYPE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </div>
      {!data.issues.length && <Empty icon="check_circle" title={tr('Không có vấn đề nào')} />}
      {data.issues.map((i) => (
        <article key={i._id} className="card space-y-2 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="flex items-center gap-1.5 font-semibold text-slate-900"><Icon name={ISSUE_TYPE[i.type]?.icon || 'flag'} size={18} className="text-slate-400" />{i.title}</h2>
              <p className="text-label-md font-normal text-slate-500">{ISSUE_TYPE[i.type]?.label} · {i.reporterRef?.name} · {timeAgo(i.createdAt)}{i.taskRef && !i.taskRef.deletedAt ? ` · ${i.taskRef.key}` : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`chip ${SEVERITY[i.severity]?.chip}`}>{SEVERITY[i.severity]?.label}</span>
              <span className={`chip ${i.status === 'open' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{i.status === 'open' ? tr('Đang mở') : tr('Đã xử lý')}</span>
            </div>
          </div>
          {i.affectedRef && (
            <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-body-sm text-amber-900">
              <Avatar user={i.affectedRef} size={20} /> {tr('{0} vắng từ {1} đến {2}', [i.affectedRef.name, fmtDate(i.startDate), fmtDate(i.endDate)])}
            </p>
          )}
          <p className="whitespace-pre-wrap text-body-sm text-slate-700"><b>{tr('Nguyên nhân: ')}</b>{i.cause}</p>
          <p className="whitespace-pre-wrap text-body-sm text-slate-700"><b>{tr('Hướng xử lý: ')}</b>{i.action}</p>
          {i.ownerRef && <p className="text-body-sm text-slate-500">{tr('Người xử lý: ')}{i.ownerRef.name}</p>}
          {i.resolution && <p className="whitespace-pre-wrap rounded-lg bg-emerald-50 px-3 py-2 text-body-sm text-emerald-900"><b>{tr('Kết quả: ')}</b>{i.resolution}</p>}
          {data.access.canWrite && canUpdate(i) && (
            i.status === 'open'
              ? <button className="btn-outline btn-sm" onClick={() => setResolving({ ...i, resolution: '' })}>{tr('Đánh dấu đã xử lý')}</button>
              : <button className="btn-outline btn-sm" disabled={busy} onClick={() => run(() => api.patch(`${base}/${i._id}`, { version: i.version, status: 'open', resolution: i.resolution }), tr('Đã mở lại vấn đề'), () => {})}>{tr('Mở lại')}</button>
          )}
        </article>
      ))}

      <Modal open={!!form} title={tr('Báo vấn đề')} onClose={() => setForm(null)}>
        {form && (
          <form className="space-y-4" onSubmit={create}>
            <Field label={tr('Tiêu đề')} required><input required maxLength={200} className="input" value={form.title} onChange={set('title')} placeholder={tr('vd: Bạn An bị ốm 3 ngày')} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr('Loại')}><Select className="input" value={form.type} onChange={set('type')}>{Object.entries(ISSUE_TYPE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
              <Field label={tr('Mức độ')}><Select className="input" value={form.severity} onChange={set('severity')}>{Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
            </div>
            {form.type === 'absence' && (
              <div className="grid gap-3 rounded-lg bg-amber-50 p-3 sm:grid-cols-3">
                <Field label={tr('Người vắng')} required>
                  <Select className="input" value={form.affectedUser} onChange={set('affectedUser')}>
                    <option value="">{tr('Chọn thành viên')}</option>
                    {members.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
                  </Select>
                </Field>
                <Field label={tr('Từ ngày')} required><input required type="date" className="input" value={form.startDate} onChange={set('startDate')} /></Field>
                <Field label={tr('Đến ngày')} required><input required type="date" className="input" value={form.endDate} onChange={set('endDate')} /></Field>
              </div>
            )}
            <Field label={tr('Nguyên nhân')} required><textarea required maxLength={2000} className="input" value={form.cause} onChange={set('cause')} /></Field>
            <Field label={tr('Hướng xử lý')} required><textarea required maxLength={2000} className="input" value={form.action} onChange={set('action')} /></Field>
            <Field label={tr('Người xử lý')}>
              <Select className="input" value={form.owner} onChange={set('owner')}>
                <option value="">{tr('Chưa chọn')}</option>
                {members.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
              </Select>
            </Field>
            <button className="btn-primary" disabled={busy}>{tr('Ghi nhận')}</button>
          </form>
        )}
      </Modal>
      <Modal open={!!resolving} title={tr('Kết quả xử lý')} onClose={() => setResolving(null)}>
        {resolving && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => api.patch(`${base}/${resolving._id}`, { version: resolving.version, status: 'resolved', resolution: resolving.resolution }), tr('Đã đóng vấn đề'), () => setResolving(null)); }}>
            <Field label={tr('Đã xử lý như thế nào?')} required><textarea required maxLength={2000} className="input" value={resolving.resolution} onChange={(e) => setResolving({ ...resolving, resolution: e.target.value })} /></Field>
            <button className="btn-primary" disabled={busy}>{tr('Đóng vấn đề')}</button>
          </form>
        )}
      </Modal>
    </div>
  );
}
