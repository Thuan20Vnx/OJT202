import { useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useApp, useLoad, useToast } from '../lib/app.jsx';
import { useLatestRequest, useProjectInfo, useSocketEvent } from '../lib/hooks.js';
import { Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Pagination } from '../components/ui.jsx';

const localDate = (value) => { if (!value) return ''; const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
export default function Meetings() {
  const { project, me, canManageProject } = useApp();
  const info = useProjectInfo(project?._id);
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useLoad(() => project ? api.get(`/projects/${project._id}/meetings?page=${page}&limit=20`) : Promise.resolve(null), [project?._id, page]);
  useSocketEvent('meetings:changed', reload, [reload]);
  if (!project) return <Empty title="Chọn dự án để xem lịch họp" />;
  return <MeetingList key={project._id} {...{ project, me, canManageProject, info, data, loading, error, reload, page, setPage }} />;
}

function MeetingList({ project, me, canManageProject, info, data, loading, error, reload, page, setPage }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const pending = useRef(false);
  const begin = useLatestRequest();
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const open = (m) => { setFailure(''); setForm(m ? { ...m, startAt: localDate(m.startAt), endAt: localDate(m.endAt), participants: [...new Set([...m.participants.map((p) => p.user), me._id])] } : { title: '', agenda: '', location: '', startAt: '', endAt: '', participants: [me._id] }); };
  const run = async (action) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setFailure('');
    const current = begin();
    try { await action(); if (current()) { setForm(null); reload(); toast('Đã cập nhật lịch họp'); } }
    catch (e) { if (current()) { setFailure(e.message); toast(e.message, 'error'); } }
    finally { pending.current = false; if (current()) setBusy(false); }
  };
  const members = info?.project?.members || [];
  return <div className="space-y-5 p-4 lg:p-6">
    <PageHeader title="Lịch họp" subtitle={`${project.name} · Kiểm tra trùng lịch của người tham gia trên các dự án.`} actions={data?.canWrite && <button className="btn-primary" onClick={() => open(null)}>Đặt lịch họp</button>} />
    {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <PageLoader /> : <>
      {!data?.meetings.length && <Empty title="Chưa có lịch họp" />}
      {data?.meetings.map((m) => <article key={m._id} className="card space-y-3 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{m.title}</h2><p className="text-body-sm text-slate-500">{new Date(m.startAt).toLocaleString()} → {new Date(m.endAt).toLocaleString()}</p></div><span className={`chip ${m.status === 'cancelled' ? 'bg-slate-100' : 'bg-blue-50 text-blue-700'}`}>{m.status === 'cancelled' ? 'Đã hủy' : new Date(m.endAt) < new Date() ? 'Đã qua' : 'Đã đặt'}</span></div>
        {m.agenda && <p className="whitespace-pre-wrap text-body-sm">{m.agenda}</p>}<p className="text-body-sm text-slate-500">{m.location || 'Chưa có địa điểm / đường dẫn'} · {m.participants.map((p) => p.userRef.name).join(', ')}</p>
        {data.canWrite && m.status === 'scheduled' && (canManageProject || m.creator === me._id) && <div className="flex gap-2"><button className="btn-secondary" disabled={busy} onClick={() => open(m)}>Đổi lịch</button><button className="btn-secondary text-rose-700" disabled={busy} onClick={() => run(() => api.post(`/projects/${project._id}/meetings/${m._id}/cancel`, { version: m.version }))}>Hủy lịch</button></div>}
      </article>)}
      {data && <Pagination page={page} total={data.total} limit={20} onPage={setPage} />}
    </>}
    <Modal open={!!form} title={form?._id ? 'Đổi lịch họp' : 'Đặt lịch họp'} onClose={() => { if (!busy) setForm(null); }}>
      {form && <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); const payload = { title: form.title, agenda: form.agenda, location: form.location, startAt: new Date(form.startAt).toISOString(), endAt: new Date(form.endAt).toISOString(), participants: form.participants, ...(form._id ? { version: form.version } : {}) }; run(() => form._id ? api.put(`/projects/${project._id}/meetings/${form._id}`, payload) : api.post(`/projects/${project._id}/meetings`, payload)); }}>
        <Field label="Tên cuộc họp"><input required maxLength={200} className="input" value={form.title} onChange={set('title')} /></Field>
        <Field label="Nội dung"><textarea maxLength={4000} className="input" value={form.agenda} onChange={set('agenda')} /></Field>
        <Field label="Địa điểm / đường dẫn"><input maxLength={500} className="input" value={form.location} onChange={set('location')} /></Field>
        <p className="text-label-md text-slate-500">Nhập và hiển thị theo múi giờ thiết bị: {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
        <Field label="Bắt đầu họp"><input required type="datetime-local" className="input" value={form.startAt} onChange={set('startAt')} /></Field>
        <Field label="Kết thúc họp"><input required type="datetime-local" className="input" value={form.endAt} onChange={set('endAt')} /></Field>
        <fieldset className="space-y-2"><legend className="mb-2 text-body-sm font-semibold">Người tham gia (tối đa 20, gồm người đặt)</legend>{members.map((u) => <label key={u._id} className="flex items-center gap-2 text-body-sm"><input type="checkbox" checked={form.participants.includes(u._id)} disabled={u._id === me._id} onChange={(e) => setForm((f) => ({ ...f, participants: e.target.checked ? [...f.participants, u._id] : f.participants.filter((id) => id !== u._id) }))} />{u.name}</label>)}</fieldset>
        {failure && <p role="alert" className="text-body-sm text-rose-700">{failure} Bản nháp vẫn được giữ; chọn lại giờ hoặc đóng và mở lại để tải phiên bản mới.</p>}
        <button disabled={busy || !info} className="btn-primary">{busy ? 'Đang lưu…' : 'Lưu lịch họp'}</button>
      </form>}
    </Modal>
  </div>;
}
