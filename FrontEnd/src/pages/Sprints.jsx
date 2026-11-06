import { useState } from 'react';
import { Burndown } from '../components/charts.jsx';
import { Confirm, Empty, ErrorBox, Field, Icon, Modal, PageHeader, PageLoader, Progress, Select, StatusChip } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useApp, useLoad, useToast } from '../lib/app.jsx';
import { fmtProjectDate as fmtDate } from '../lib/format.js';
import { useSocketEvent } from '../lib/hooks.js';
import { t as tr, useI18n } from '../lib/i18n.js';

const STATE = {
  active: { get label() { return tr('Đang chạy'); }, chip: 'border-blue-200 bg-blue-50 text-blue-700' },
  planned: { get label() { return tr('Chưa chạy'); }, chip: 'border-slate-200 bg-slate-50 text-slate-600' },
  closed: { get label() { return tr('Đã đóng'); }, chip: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
};
const isoDate = (d) => (d ? new Date(d).toLocaleDateString('en-CA') : '');

function TaskRows({ tasks, selected, onToggle, canManage }) {
  return (
    <ul className="divide-y divide-slate-100">
      {tasks.map((t) => (
        <li key={t._id} className="flex items-center gap-3 py-2 text-body-sm">
          {canManage && t.status !== 'done' && (
            <input type="checkbox" aria-label={tr('Chọn {0}', [t.key])} checked={selected.has(t._id)} onChange={() => onToggle(t._id)} />
          )}
          <span className="w-16 shrink-0 font-semibold text-slate-500">{t.key}</span>
          <span className="min-w-0 flex-1 truncate text-slate-800">{t.title}</span>
          <span className="hidden text-right tabular-nums text-slate-500 sm:block">{t.estimateHours != null ? `${t.estimateHours} h` : '—'}</span>
          <StatusChip status={t.status} />
        </li>
      ))}
      {!tasks.length && <li className="py-3 text-body-sm text-slate-400">{tr('Chưa có công việc')}</li>}
    </ul>
  );
}

export default function Sprints() {
  useI18n();
  const { project } = useApp();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => (project ? api.get(`/projects/${project._id}/sprints`) : Promise.resolve(null)), [project?._id]);
  useSocketEvent('sprints:changed', () => reload(), [reload]);
  useSocketEvent('board:refresh', () => reload(), [reload]);
  const [form, setForm] = useState(null);
  const [closing, setClosing] = useState(null);
  const [moveTo, setMoveTo] = useState('');
  const [removing, setRemoving] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [target, setTarget] = useState('');
  const [open, setOpen] = useState({});
  const [busy, setBusy] = useState(false);

  if (!project) return <Empty icon="folder_off" title={tr('Chọn dự án để xem Sprint')} />;
  if (loading && !data) return <PageLoader />;
  if (error) return <div className="p-6"><ErrorBox error={error} onRetry={reload} /></div>;

  const canManage = data.access.canManage;
  const run = async (action, message) => {
    if (busy) return false;
    setBusy(true);
    try {
      await action();
      if (message) toast(message);
      reload();
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const base = `/projects/${project._id}/sprints`;
  const toggle = (id) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const save = async (e) => {
    e.preventDefault();
    const body = { name: form.name, goal: form.goal, start: form.start || null, end: form.end || null };
    const ok = await run(() => (form._id ? api.patch(`${base}/${form._id}`, { ...body, version: form.version }) : api.post(base, body)), tr('Đã lưu Sprint'));
    if (ok) setForm(null);
  };
  const assign = async () => {
    const ok = await run(() => api.post(`${base}/assign`, { tasks: [...selected], sprint: target || null }), tr('Đã chuyển {0} công việc', [selected.size]));
    if (ok) setSelected(new Set());
  };
  const close = async () => {
    const ok = await run(() => api.post(`${base}/${closing._id}/close`, { version: closing.version, moveTo: moveTo || null }), tr('Đã đóng {0}', [closing.name]));
    if (ok) { setClosing(null); setMoveTo(''); }
  };
  const openSprints = data.sprints.filter((s) => s.status !== 'closed');
  const order = { active: 0, planned: 1, closed: 2 };
  const sprints = [...data.sprints].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 lg:p-6">
      <PageHeader
        title={tr('Sprint & Backlog')}
        subtitle={`${project.name} · ${tr('Mỗi lúc một Sprint chạy; Sprint đã đóng vẫn giữ số liệu và burndown để xem lại.')}`}
        actions={canManage && <button className="btn-primary" onClick={() => setForm({ name: '', goal: '', start: '', end: '' })}><Icon name="add" size={16} />{tr(' Tạo Sprint')}</button>}
      />
      {canManage && selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-body-sm">
          <span className="font-semibold text-blue-800">{tr('Đã chọn {0} việc', [selected.size])}</span>
          <Select className="input h-8 w-auto py-0 text-body-sm" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{tr('Về Backlog')}</option>
            {openSprints.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </Select>
          <button className="btn-primary btn-sm" disabled={busy} onClick={assign}>{tr('Chuyển')}</button>
          <button className="btn-outline btn-sm" onClick={() => setSelected(new Set())}>{tr('Bỏ chọn')}</button>
        </div>
      )}
      {sprints.map((s) => {
        const expanded = open[s._id] ?? s.status === 'active';
        const pct = s.stats.total ? Math.round((s.stats.done / s.stats.total) * 100) : 0;
        return (
          <section key={s._id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex flex-wrap items-center gap-2 text-headline-sm text-slate-900">{s.name}<span className={`chip ${STATE[s.status].chip}`}>{STATE[s.status].label}</span></h2>
                <p className="text-label-md font-normal text-slate-500">{s.start ? fmtDate(s.start) : '—'} → {s.end ? fmtDate(s.end) : '—'}{s.goal ? ` · ${s.goal}` : ''}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canManage && s.status === 'planned' && <button className="btn-primary btn-sm" disabled={busy} onClick={() => run(() => api.post(`${base}/${s._id}/start`, { version: s.version }), tr('Đã bắt đầu {0}', [s.name]))}>{tr('Bắt đầu')}</button>}
                {canManage && s.status === 'active' && <button className="btn-outline btn-sm" onClick={() => setClosing(s)}>{tr('Đóng Sprint')}</button>}
                {canManage && s.status !== 'closed' && <button className="btn-outline btn-sm" onClick={() => setForm({ ...s, start: isoDate(s.start), end: isoDate(s.end) })}>{tr('Sửa')}</button>}
                {canManage && s.status === 'planned' && <button className="btn-outline btn-sm" onClick={() => setRemoving(s)}>{tr('Xóa')}</button>}
                <button className="btn-outline btn-sm" aria-expanded={expanded} onClick={() => setOpen((o) => ({ ...o, [s._id]: !expanded }))}>{expanded ? tr('Thu gọn') : tr('Chi tiết')}</button>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Progress value={pct} className="flex-1" />
              <span className="whitespace-nowrap text-right text-label-md tabular-nums text-slate-600">{tr('{0}/{1} việc · {2}/{3} giờ', [s.stats.done, s.stats.total, s.stats.doneHours, s.stats.hours])}</span>
            </div>
            {expanded && (
              <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_1fr]">
                <TaskRows tasks={s.tasks} selected={selected} onToggle={toggle} canManage={canManage} />
                {s.burndown ? <Burndown days={s.burndown.days} /> : <p className="text-body-sm text-slate-400">{tr('Đặt ngày bắt đầu và kết thúc để có biểu đồ burndown.')}</p>}
              </div>
            )}
          </section>
        );
      })}
      {!sprints.length && <Empty icon="sprint" title={tr('Chưa có Sprint nào')} />}
      <section className="card p-4">
        <h2 className="text-headline-sm text-slate-900">{tr('Backlog')} <span className="font-normal text-slate-400">({data.backlog.length})</span></h2>
        <p className="mb-2 text-label-md font-normal text-slate-500">{tr('Việc chưa xếp vào Sprint nào. Chọn rồi chuyển vào Sprint ở thanh phía trên.')}</p>
        <TaskRows tasks={data.backlog} selected={selected} onToggle={toggle} canManage={canManage} />
      </section>

      <Modal open={!!form} title={form?._id ? tr('Sửa Sprint') : tr('Tạo Sprint')} onClose={() => setForm(null)}>
        {form && (
          <form className="space-y-4" onSubmit={save}>
            <Field label={tr('Tên Sprint')} required><input required maxLength={60} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sprint 3" /></Field>
            <Field label={tr('Mục tiêu')}><textarea maxLength={300} className="input" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr('Ngày bắt đầu')}><input type="date" className="input" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field>
              <Field label={tr('Ngày kết thúc')}><input type="date" className="input" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Field>
            </div>
            <button className="btn-primary" disabled={busy}>{tr('Lưu Sprint')}</button>
          </form>
        )}
      </Modal>
      <Confirm open={!!closing} title={tr('Đóng {0}?', [closing?.name])} confirmText={tr('Đóng Sprint')} onClose={() => setClosing(null)} onConfirm={close}>
        <p className="mb-3">{tr('Việc đã xong ở lại Sprint này. Việc chưa xong sẽ chuyển sang:')}</p>
        <Select className="input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
          <option value="">{tr('Backlog')}</option>
          {data.sprints.filter((s) => s.status === 'planned').map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
        </Select>
      </Confirm>
      <Confirm open={!!removing} danger title={tr('Xóa {0}?', [removing?.name])} confirmText={tr('Xóa')} onClose={() => setRemoving(null)} onConfirm={async () => { await run(() => api.del(`${base}/${removing._id}`), tr('Đã xóa Sprint')); setRemoving(null); }}>
        {tr('Các việc trong Sprint này sẽ trở về Backlog.')}
      </Confirm>
    </div>
  );
}
