import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useApp, useLoad, useToast } from '../lib/app.jsx';
import { useLatestRequest, useSocketEvent } from '../lib/hooks.js';
import { isoDate } from '../lib/format.js';
import { dates, timeZone } from '../lib/dates.js';
import { SEVERITIES, hoursText } from '../lib/delivery.js';
import { ErrorBox, Field, Pagination, Progress, Select, Spinner } from './ui.jsx';
import ScheduleComparison from './ScheduleComparison.jsx';

const initialLog = { hours: '', completed: '', nextStep: '', blockers: '', progressPct: 0, remainingHours: '' };

export default function TaskDelivery({ task, members, onSaved }) {
  const [open, setOpen] = useState(false);
  return <section className="rounded-xl border border-slate-200 bg-white p-4">
    <button type="button" className="flex w-full items-center justify-between text-left font-semibold text-slate-900" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
      Tiến độ & cộng tác <span aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    {!open && <p className="mt-1 text-body-sm text-slate-500">Kế hoạch/thực tế, phân bổ người làm, nhật ký effort và vấn đề.</p>}
    {open && <DeliveryPanel key={task._id} taskId={task._id} members={members} onSaved={onSaved} />}
  </section>;
}

function DeliveryPanel({ taskId, members, onSaved }) {
  const { me } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState('updates');
  const [date, setDate] = useState(() => dates.dateKey(new Date(), timeZone()));
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(initialLog);
  const [items, setItems] = useState([]);
  const [issue, setIssue] = useState({ title: '', severity: 'medium', cause: '', action: '', owner: '' });
  const [resolutions, setResolutions] = useState({});
  const [busy, setBusy] = useState(false);
  const lock = useRef(false), logDirty = useRef(false), allocationDirty = useRef(false);
  const base = useRef({ taskVersion: 0, updateVersion: 0, allocationVersion: 0 });
  const begin = useLatestRequest();
  const load = useLoad(() => api.get(`/tasks/${taskId}/delivery${qs({ date, page, limit: 10 })}`), [taskId, date, page]);
  useSocketEvent('board:refresh', () => load.reload(), [load.reload]);
  const data = load.data;
  useEffect(() => {
    if (!data) return;
    if (!logDirty.current) {
      base.current.taskVersion = data.taskVersion;
      base.current.updateVersion = data.ownUpdate?.version ?? 0;
      const own = data.ownUpdate;
      const ownAllocation = data.contributors.find((c) => c.user === me._id);
      setForm(own ? { hours: own.hours, completed: own.completed, nextStep: own.nextStep, blockers: own.blockers, progressPct: own.progressPct, remainingHours: ownAllocation?.remainingHours ?? data.task.remainingHours ?? '' } : { ...initialLog, progressPct: data.task.progressPct, remainingHours: ownAllocation?.remainingHours ?? data.task.remainingHours ?? '' });
    }
    if (!allocationDirty.current) { base.current.allocationVersion = data.taskVersion; setItems(data.contributors.map((c) => ({ user: c.user, responsibility: c.responsibility, plannedHours: String(c.plannedHours), remainingHours: String(c.remainingHours) }))); }
  }, [data, me._id]);
  const run = async (action, success, reset) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    const current = begin();
    try { await action(); if (!current()) return; if (reset === 'log') logDirty.current = false; if (reset === 'allocation') allocationDirty.current = false; load.reload(); onSaved?.(); toast(success); }
    catch (e) { if (current()) { toast(e.message, 'error'); if (e.status === 409) load.reload(); } }
    finally { lock.current = false; if (current()) setBusy(false); }
  };
  if (!data) return <div className="mt-3"><ErrorBox error={load.error} onRetry={load.reload} />{load.loading && <Spinner />}</div>;
  const task = data.task;
  const workers = members.filter((m) => m.role !== 'viewer' && m.projectRole !== 'viewer');
  const setLog = (key, value) => { logDirty.current = true; setForm((f) => ({ ...f, [key]: value })); };
  const setItem = (index, key, value) => { allocationDirty.current = true; setItems((rows) => rows.map((r, i) => i === index ? { ...r, [key]: value } : r)); };
  const canLog = !data.childCount && data.access.canUpdate && task.status !== 'done' && (!data.contributors.length || data.contributors.some((c) => c.user === me._id));
  const saveLog = () => {
    if (form.hours === '' || form.remainingHours === '') return toast('Nhập giờ đã làm và giờ còn lại; có thể nhập 0.', 'error');
    return run(() => api.put(`/tasks/${taskId}/daily-updates/${date}`, { ...form, hours: Number(form.hours), remainingHours: Number(form.remainingHours), progressPct: Number(form.progressPct), version: base.current.updateVersion, taskVersion: base.current.taskVersion }), 'Đã lưu nhật ký; tổng effort được tính lại', 'log');
  };
  const sum = items.reduce((s, i) => s + Number(i.plannedHours || 0), 0);
  return <div className="mt-4 space-y-4">
    <ErrorBox error={load.error} onRetry={load.reload} />
    <button type="button" className="text-label-md font-semibold text-blue-700 underline" disabled={busy} onClick={() => { logDirty.current = false; allocationDirty.current = false; load.reload(); }}>Bỏ bản nháp, tải dữ liệu mới</button>
    <ScheduleComparison task={task} />
    <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-body-sm sm:grid-cols-4">
      {[['Tiến độ task', `${task.progressPct}%`], ['Giờ ước lượng', task.estimateHours == null ? 'Chưa có' : hoursText(task.estimateHours)], ['Giờ đã làm', hoursText(task.spentHours)], ['Giờ còn lại', task.remainingHours == null ? 'Chưa có' : hoursText(task.remainingHours)]].map(([label, value]) => <div key={label}><p className="text-label-md text-slate-500">{label}</p><p className="text-right font-semibold tabular-nums text-slate-900">{value}</p></div>)}
    </div>
    <Progress value={task.progressPct} />
    <p className="text-label-md text-slate-500">Tiến độ được cập nhật trong nhật ký, không suy ra từ giờ đã làm. 100% vẫn cần PM duyệt Done. Tổng giờ gồm {hoursText(data.loggedHours)} giờ nhật ký và {hoursText(task.legacySpentHours)} giờ ghi nhận trước đây.</p>
    <div className="flex flex-wrap gap-2">{[['updates', 'Nhật ký hằng ngày'], ['allocation', 'Phân bổ effort'], ['issues', `Vấn đề (${data.issueTotal})`]].map(([key, label]) => <button type="button" key={key} className={`pill-tab ${tab === key ? 'pill-tab-active' : ''}`} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
    {tab === 'updates' && <>
      <Field label="Ngày làm việc"><input className="input" type="date" value={date} max={dates.dateKey(new Date(), timeZone())} onChange={(e) => { if (!e.target.value) return; logDirty.current = false; setDate(e.target.value); }} /></Field>
      {canLog ? <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Field label="Giờ đã làm trong ngày"><input className="input text-right tabular-nums" type="number" min="0" max="24" step="0.25" value={form.hours} onChange={(e) => setLog('hours', e.target.value)} /></Field>
          <Field label="Giờ còn lại của tôi"><input className="input text-right tabular-nums" type="number" min="0" max="1000" step="0.25" value={form.remainingHours} onChange={(e) => setLog('remainingHours', e.target.value)} /></Field>
          <Field label="Tiến độ task (%)"><input className="input text-right tabular-nums" type="number" min="0" max="100" value={form.progressPct} onChange={(e) => setLog('progressPct', e.target.value)} /></Field>
        </div>
        {[['completed', 'Đã làm được gì?'], ['nextStep', 'Việc tiếp theo'], ['blockers', 'Vướng mắc / nguyên nhân chậm']].map(([key, label]) => <Field key={key} label={label} required={key === 'completed'}><textarea className="textarea" rows={2} maxLength={2000} value={form[key]} onChange={(e) => setLog(key, e.target.value)} /></Field>)}
        <button type="button" className="btn-primary" disabled={busy || !form.completed.trim()} onClick={saveLog}>{busy && <Spinner />}Lưu nhật ký</button>
        <p className="text-label-md text-slate-500">Mỗi người có một bản ghi/task/ngày. Sửa bản ghi sẽ thay giờ cũ, không cộng trùng.</p>
      </div> : <p className="text-body-sm text-slate-500">Chỉ người được giao/cùng thực hiện mới ghi nhật ký khi task còn mở. Task có việc con: ghi effort ở việc con để tránh tính trùng.</p>}
      <div className="space-y-2">{data.updates.map((u) => <article key={u._id} className="rounded-lg border border-slate-200 p-3 text-body-sm">
        <p className="flex justify-between gap-2 font-semibold text-slate-800"><span>{u.userRef.name} · {u.workDate.slice(0, 10)}</span><span className="tabular-nums">{hoursText(u.hours)} giờ · {u.progressPct}%</span></p>
        <p className="mt-1 whitespace-pre-wrap break-words text-slate-700">{u.completed}</p>
        {u.nextStep && <p className="mt-1 whitespace-pre-wrap text-slate-600">Tiếp theo: {u.nextStep}</p>}
        {u.blockers && <p className="mt-1 whitespace-pre-wrap text-amber-700">Vướng mắc: {u.blockers}</p>}
      </article>)}{!data.updates.length && <p className="text-body-sm text-slate-500">Chưa có nhật ký.</p>}</div>
      <Pagination page={page} limit={10} total={data.total} onPage={setPage} />
    </>}
    {tab === 'allocation' && <>
      <p className="text-body-sm text-slate-600">Một người chịu trách nhiệm chính; mỗi người cùng làm có trách nhiệm và giờ riêng. Tổng giờ phân bổ trở thành ước lượng của task.</p>
      {items.map((item, i) => <div key={i} className="space-y-2 rounded-lg border border-slate-200 p-3">
        <Select aria-label={`Người thực hiện ${i + 1}`} className="input" disabled={!data.access.canManage || busy} value={item.user} onChange={(e) => setItem(i, 'user', e.target.value)}><option value="">Chọn thành viên</option>{workers.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</Select>
        <Field label={`Trách nhiệm ${i + 1}`}><input className="input" maxLength={300} disabled={!data.access.canManage || busy} value={item.responsibility} onChange={(e) => setItem(i, 'responsibility', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label={`Giờ phân bổ ${i + 1}`}><input className="input text-right" type="number" min="0.25" max="1000" step="0.25" disabled={!data.access.canManage || busy} value={item.plannedHours} onChange={(e) => setItem(i, 'plannedHours', e.target.value)} /></Field><Field label={`Giờ còn lại ${i + 1}`}><input className="input text-right" type="number" min="0" max="1000" step="0.25" disabled={!data.access.canManage || busy} value={item.remainingHours} onChange={(e) => setItem(i, 'remainingHours', e.target.value)} /></Field></div>
        <p className="text-right text-label-md text-slate-600">Phân bổ: {sum ? Math.round(Number(item.plannedHours || 0) / sum * 100) : 0}% · Đã ghi: {hoursText(data.effortByUser.find((r) => r.user === item.user)?.hours)} giờ</p>
        {data.access.canManage && <button type="button" disabled={busy} className="text-label-md text-rose-700" onClick={() => { allocationDirty.current = true; setItems(items.filter((_, index) => index !== i)); }}>Bỏ khỏi phân bổ</button>}
      </div>)}
      {!items.length && <p className="text-body-sm text-slate-500">Chưa chia effort; task đang tính cho người nhận chính.</p>}
      {data.access.canManage && <div className="flex flex-wrap gap-2"><button className="btn-outline" type="button" disabled={busy || items.length >= 20} onClick={() => { allocationDirty.current = true; setItems([...items, { user: '', responsibility: '', plannedHours: '', remainingHours: '' }]); }}>Thêm người thực hiện</button><button className="btn-primary" type="button" disabled={busy} onClick={() => {
        if (items.some((i) => !i.user || !i.responsibility.trim() || i.plannedHours === '' || i.remainingHours === '')) return toast('Nhập đủ người, trách nhiệm và giờ phân bổ.', 'error');
        run(() => api.put(`/tasks/${taskId}/contributors`, { version: base.current.allocationVersion, items: items.map((i) => ({ ...i, plannedHours: Number(i.plannedHours), remainingHours: Number(i.remainingHours) })) }), 'Đã lưu phân bổ', 'allocation');
      }}>Lưu phân bổ</button></div>}
    </>}
    {tab === 'issues' && <>
      {data.access.canWrite && <div className="space-y-2 rounded-lg bg-slate-50 p-3">
        <Field label="Tên vấn đề"><input className="input" maxLength={200} value={issue.title} onChange={(e) => setIssue({ ...issue, title: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Mức nghiêm trọng"><Select className="input" value={issue.severity} onChange={(e) => setIssue({ ...issue, severity: e.target.value })}>{Object.entries(SEVERITIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field><Field label="Người xử lý"><Select className="input" value={issue.owner} onChange={(e) => setIssue({ ...issue, owner: e.target.value })}><option value="">Chưa giao</option>{workers.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</Select></Field></div>
        <Field label="Nguyên nhân"><textarea className="textarea" rows={2} maxLength={2000} value={issue.cause} onChange={(e) => setIssue({ ...issue, cause: e.target.value })} /></Field>
        <Field label="Hướng xử lý"><textarea className="textarea" rows={2} maxLength={2000} value={issue.action} onChange={(e) => setIssue({ ...issue, action: e.target.value })} /></Field>
        <button type="button" className="btn-primary" disabled={busy || !issue.title.trim() || !issue.cause.trim() || !issue.action.trim()} onClick={() => run(async () => { await api.post(`/tasks/${taskId}/issues`, { ...issue, owner: issue.owner || null }); setIssue({ title: '', severity: 'medium', cause: '', action: '', owner: '' }); }, 'Đã ghi nhận vấn đề')}>Ghi nhận vấn đề</button>
      </div>}
      {data.issues.map((i) => <article key={i._id} className="rounded-lg border border-slate-200 p-3 text-body-sm">
        <h4 className="font-semibold text-slate-900">{i.title} · {SEVERITIES[i.severity]} · {i.status === 'open' ? 'Đang mở' : 'Đã xử lý'}</h4>
        <p className="mt-1 text-slate-600">Người xử lý: {i.ownerRef?.name || 'Chưa giao'} · Báo bởi {i.reporterRef.name}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-slate-700">Nguyên nhân: {i.cause}</p><p className="whitespace-pre-wrap break-words text-slate-700">Hướng xử lý: {i.action}</p>
        {i.resolution && <p className="mt-1 whitespace-pre-wrap text-emerald-700">Kết quả: {i.resolution}</p>}
        {data.access.canWrite && (data.access.canManage || i.owner === me._id || i.reporter === me._id) && <div className="mt-2 space-y-2"><label className="block text-label-md text-slate-600">{`Kết quả xử lý ${i.title}`}<input className="input mt-1" maxLength={2000} value={resolutions[i._id] ?? i.resolution} onChange={(e) => setResolutions({ ...resolutions, [i._id]: e.target.value })} /></label><button type="button" className="btn-outline btn-sm" disabled={busy || (i.status === 'open' && !(resolutions[i._id] ?? i.resolution).trim())} onClick={() => run(() => api.patch(`/tasks/${taskId}/issues/${i._id}`, { version: i.version, status: i.status === 'open' ? 'resolved' : 'open', resolution: resolutions[i._id] ?? i.resolution }), 'Đã cập nhật vấn đề')}>{i.status === 'open' ? 'Đóng vấn đề' : 'Mở lại vấn đề'}</button></div>}
      </article>)}
      {!data.issues.length && <p className="text-body-sm text-slate-500">Chưa có vấn đề được ghi nhận.</p>}
      {data.issueTotal > data.issues.length && <p className="text-label-md text-amber-700">Đang hiển thị 100 vấn đề gần nhất, ưu tiên vấn đề đang mở.</p>}
    </>}
  </div>;
}
