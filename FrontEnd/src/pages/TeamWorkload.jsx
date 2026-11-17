import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp, useLoad } from '../lib/app.jsx';
import { hoursText, WORK_TYPES } from '../lib/delivery.js';
import { Avatar, Empty, ErrorBox, PageHeader, PageLoader, Pagination, StatusChip } from '../components/ui.jsx';
import ScheduleComparison from '../components/ScheduleComparison.jsx';
import { t as tr, useI18n } from '../lib/i18n.js';

export default function TeamWorkload() {
  useI18n();
  const { wsId, setProjectId } = useApp();
  const navigate = useNavigate();
  const [week, setWeek] = useState('');
  const [selected, setSelected] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useLoad(() => wsId ? api.get(`/workspaces/${wsId}/team-workload${week ? `?week=${week}` : ''}`) : Promise.resolve(null), [wsId, week]);
  const person = data?.people.find((p) => p.user._id === selected) || data?.people[0];
  return <div className="space-y-5 p-4 lg:p-6">
    <PageHeader title={tr("Tải công việc thành viên")} subtitle={tr("Tổng hợp theo workspace và tuần. Chỉ tính effort còn lại ở task lá, gồm việc quá hạn chuyển sang tuần này; capacity chỉ tính một lần cho mỗi người.")} />
    <label className="block max-w-xs text-body-sm">{tr("Tuần bắt đầu (thứ Hai)")}<input type="date" className="input mt-1" value={week || data?.week || ''} onChange={(e) => { setWeek(e.target.value); setPage(1); }} /></label>
    {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <PageLoader /> : data && <>
      <p className="rounded-lg bg-amber-50 p-3 text-body-sm text-amber-900">{tr("Chỉ tổng hợp dự án bạn có quyền xem; không phải tổng tải toàn công ty nếu còn dự án ngoài quyền.")} {tr("Task chưa có hạn cần bổ sung kế hoạch trước khi đánh giá đủ tải.")}</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{data.people.map((p) => <button key={p.user._id} onClick={() => { setSelected(p.user._id); setPage(1); }} className={`card p-4 text-left ${person?.user._id === p.user._id ? 'ring-2 ring-blue-500' : ''}`}>
        <div className="flex items-center gap-2"><Avatar user={p.user} size={32} /><span className="flex-1 font-semibold">{p.user.name}</span><strong className={`text-right tabular-nums ${p.overloaded ? 'text-rose-700' : 'text-blue-700'}`}>{p.loadPct == null ? tr('Không có capacity') : `${p.loadPct}%`}</strong></div>
        <p className="mt-3 text-right text-body-sm tabular-nums">{tr("{0} h còn lại / {1} h khả dụng", [hoursText(p.remainingHours), hoursText(p.available)])}</p>
        <p className="mt-1 text-right text-label-md text-slate-500">{tr("{0} h đã ghi tuần này · {1} việc chưa có hạn", [hoursText(p.loggedHours), p.noDueCount])}</p>
        {p.absences?.map((a) => <p key={`${a.startDate}-${a.title}`} className="mt-2 rounded bg-amber-50 px-2 py-1 text-body-sm text-amber-900">{tr('Vắng')} {new Date(a.startDate).toLocaleDateString('vi-VN', { timeZone: 'UTC' })} – {new Date(a.endDate).toLocaleDateString('vi-VN', { timeZone: 'UTC' })}: {a.title}</p>)}
        {p.missingEffortCount > 0 && <p className="mt-2 text-body-sm text-amber-800">{tr("{0} việc chưa ước lượng; tải hiển thị mới là phần đã biết.", [p.missingEffortCount])}</p>}
      </button>)}</div>
      {!person && <Empty title={tr("Chưa có thành viên trong các dự án bạn được xem")} />}
      {person && <section className="card space-y-4 p-4"><h2 className="font-semibold">{tr("Công việc của {0}", [person.user.name])}</h2><div className="flex flex-wrap gap-2">{person.roleByProject.map((p) => <span key={p._id || p.id} className="chip bg-slate-50">{p.name}: {({ pm: 'PM', member: tr('Thành viên'), viewer: tr('Chỉ xem') })[p.role] || p.role}</span>)}</div>
        {person.tasks.slice((page - 1) * 20, page * 20).map((t) => <div key={t._id} className="grid gap-3 border-t border-slate-100 pt-4 lg:grid-cols-2"><div><button className="text-left font-semibold text-blue-700 hover:underline" onClick={() => { setProjectId(t.project); navigate(`?task=${t._id}`); }}>{t.key} · {t.title}</button><p className="my-2 text-body-sm text-slate-500">{t.projectName} · {tr(WORK_TYPES[t.workType] || "Chưa phân loại")}</p><StatusChip status={t.status} /><p className="mt-2 text-right text-body-sm tabular-nums">{tr("{0}% tiến độ · {1} h còn lại của người này", [t.progressPct, hoursText(t.remainingHours)])}</p></div><ScheduleComparison task={t} /></div>)}
        <Pagination page={page} total={person.tasks.length} limit={20} onPage={setPage} />
      </section>}
    </>}
  </div>;
}
