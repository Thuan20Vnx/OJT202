import { t as tr, getLanguage, useI18n } from '../lib/i18n.js';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Empty, ErrorBox, Icon, PageHeader, PageLoader, Select, StatusChip } from '../components/ui.jsx';
import { api, qs } from '../lib/api.js';
import { useApp, useLoad, useToast } from '../lib/app.jsx';
import { STATUS, STATUS_ORDER, fmtDate, isoDate, sod } from '../lib/format.js';
import { useProjectInfo, useSocketEvent } from '../lib/hooks.js';
import { addDays, deadline, zoned } from '../lib/dates.js';

const getDaysOfWeek = () => [tr("Thứ 2"), tr("Thứ 3"), tr("Thứ 4"), tr("Thứ 5"), tr("Thứ 6"), tr("Thứ 7"), tr("Chủ nhật")];
const DAY = 86400000;
const mondayOf = (d) => {
  const x = sod(d);
  return addDays(x, -((x.getDay() + 6) % 7));
};

export default function Calendar() {
  useI18n();
  const { project, me, canManageProject: canWriteProject } = useApp();
  const info = useProjectInfo(project?._id);
  const toast = useToast();
  const navigate = useNavigate();
  const [view, setView] = useState('month');
  const [cursor, setCursor] = useState(() => sod());
  useEffect(() => setCursor(sod()), [me.timezone]);
  const [filter, setFilter] = useState({ assignee: '', status: '' });
  const [pop, setPop] = useState(null);
  const [drag, setDrag] = useState(null);

  const range = useMemo(() => {
    if (view === 'week') {
      const start = mondayOf(cursor);
      return { start, days: 7 };
    }
    const first = zoned(cursor);
    first.setDate(1);
    const start = mondayOf(first);
    const last = zoned(first);
    last.setMonth(last.getMonth() + 1, 0);
    const days = Math.round((mondayOf(last).getTime() - start.getTime()) / DAY) + 7;
    return { start, days };
  }, [cursor, view, getLanguage()]);

  const { data, error, loading, reload } = useLoad(
    () =>
      project
        ? api.get(
            `/projects/${project._id}/calendar${qs({ from: range.start.toISOString(), to: new Date(addDays(range.start, range.days).getTime() - 1).toISOString(), ...filter })}`,
          )
        : Promise.resolve(null),
    [project?._id, range.start.getTime(), range.days, JSON.stringify(filter)],
  );
  useSocketEvent('task:changed', () => reload(), [reload]);

  if (!project) return <Empty icon="folder_off" title={tr("Chưa có dự án")} />;

  const byDay = {};
  for (const t of data?.tasks || []) (byDay[isoDate(t.dueDate)] ||= []).push(t);
  const today = isoDate(new Date());
  const sprintEnd = info?.project?.sprint?.end ? isoDate(info.project.sprint.end) : null;

  const move = (delta) => {
    const c = zoned(cursor);
    if (view === 'week') c.setDate(c.getDate() + 7 * delta);
    else c.setMonth(c.getMonth() + delta, 1);
    setCursor(c);
  };

  const reschedule = async (taskId, day) => {
    const t = data.tasks.find((x) => x._id === taskId);
    if (!t || isoDate(t.dueDate) === day) return;
    try {
      const due = deadline(day);
      await api.patch(`/tasks/${t._id}`, { dueDate: due, version: t.version });
      toast(tr("Đã dời hạn {0} sang {1}", [t.key, fmtDate(due)]));
      reload();
    } catch (e) {
      toast(e.message, 'error');
      reload();
    }
  };

  const deps = data?.dependencies || [];
  const blocked = deps.filter((d) => d.status !== 'done' && d.blockedBy.some((b) => b.status !== 'done'));
  // Chuỗi phụ thuộc: bắt đầu từ việc không bị chặn bởi ai trong danh sách
  const chains = [];
  for (const d of deps) {
    for (const b of d.blockedBy) {
      if (!deps.some((x) => x._id === b._id)) {
        const chain = [b, d];
        let cur = d;
        for (;;) {
          const nxt = deps.find((x) => x.blockedBy.some((y) => y._id === cur._id));
          if (!nxt || chain.some((c) => c._id === nxt._id)) break;
          chain.push(nxt);
          cur = nxt;
        }
        chains.push(chain);
      }
    }
  }

  const title = view === 'week' ? `${fmtDate(range.start)} – ${fmtDate(addDays(range.start, 6))}` : getLanguage() === 'en' ? cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : tr("Tháng {0}, {1}", [cursor.getMonth() + 1, cursor.getFullYear()]);

  return (
    <div className="p-6">
      <PageHeader
        title={tr("Lịch dự án")}
        subtitle={`${project.name}${info?.project?.sprint?.name ? ` · ${info.project.sprint.name} (${fmtDate(info.project.sprint.start)} – ${fmtDate(info.project.sprint.end)})` : ''}`}
        actions={
          <>
            <button className="btn-outline btn-sm" onClick={() => setCursor(sod())}>{tr("Hôm nay")}</button>
            <div className="flex items-center">
              <button className="icon-btn h-8 w-8" onClick={() => move(-1)} aria-label={tr("Trước")}>
                <Icon name="chevron_left" />
              </button>
              <span className="min-w-[130px] text-center text-label-lg font-semibold text-slate-800">{title}</span>
              <button className="icon-btn h-8 w-8" onClick={() => move(1)} aria-label="Sau">
                <Icon name="chevron_right" />
              </button>
            </div>
            <div className="flex rounded-lg bg-slate-100 p-0.5">
              {[
                ['month', tr("Tháng")],
                ['week', tr("Tuần")],
              ].map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded-md px-3 py-1 text-label-md ${view === v ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select className="input h-8 w-auto py-0 text-body-sm" value={filter.assignee} onChange={(e) => setFilter({ ...filter, assignee: e.target.value })}>
          <option value="">{tr("Tất cả thành viên")}</option>
          {(info?.project?.members || []).map((m) => (
            <option key={m._id} value={m._id}>
              {m.name}
            </option>
          ))}
        </Select>
        <Select className="input h-8 w-auto py-0 text-body-sm" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="">{tr("Mọi trạng thái")}</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS[s].label}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-label-md font-normal text-slate-500">
          {STATUS_ORDER.map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${STATUS[s].dot}`} />
              {STATUS[s].label}
            </span>
          ))}
          <span className="flex items-center gap-1 text-rose-600">
            <span className="h-2 w-2 rounded-full bg-rose-500" />{tr(" Quá hạn")}</span>
          <span className="flex items-center gap-1 text-rose-600">
            <Icon name="block" size={14} />{tr(" Đang bị chặn")}</span>
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {getDaysOfWeek().map((d) => (
              <div key={d} className="px-2 py-2 text-center text-label-md text-slate-500">
                {d}
              </div>
            ))}
          </div>
          {loading && !data ? (
            <PageLoader />
          ) : (
            <div className="grid grid-cols-7">
              {Array.from({ length: range.days }, (_, i) => {
                const date = addDays(range.start, i);
                const key = isoDate(date);
                const inMonth = view === 'week' || date.getMonth() === cursor.getMonth();
                const list = byDay[key] || [];
                const shown = list.slice(0, view === 'week' ? 12 : 3);
                return (
                  <div
                    key={key}
                    onDragOver={(e) => canWriteProject && e.preventDefault()}
                    onDrop={() => drag && reschedule(drag, key)}
                    className={`relative border-b border-r border-slate-100 p-1.5 ${view === 'week' ? 'min-h-[420px]' : 'min-h-[118px]'} ${inMonth ? 'bg-white' : 'bg-slate-50/70'}`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-label-md ${key === today ? 'bg-blue-600 font-bold text-white' : inMonth ? 'text-slate-700' : 'text-slate-300'}`}
                      >
                        {date.getDate()}
                      </span>
                      {key === today && <span className="text-label-sm text-blue-600">{tr("Hôm nay")}</span>}
                    </div>
                    {key === sprintEnd && <div className="mb-1 rounded bg-purple-100 px-1.5 py-0.5 text-label-sm text-purple-700">{tr("Kết thúc ")}{info.project.sprint.name}</div>}
                    <div className="space-y-1">
                      {shown.map((t) => {
                        const overdue = t.status !== 'done' && new Date(t.dueDate).getTime() < Date.now();
                        return (
                          <button
                            key={t._id}
                            draggable={canWriteProject}
                            onDragStart={() => setDrag(t._id)}
                            onClick={(e) => setPop({ task: t, x: e.clientX, y: e.clientY })}
                            className={`flex w-full items-center gap-1 rounded-md border px-1.5 py-1 text-left text-label-md transition-shadow hover:shadow-card ${
                              t.isBlocked ? 'border-rose-300 bg-rose-50' : overdue ? 'border-rose-200 bg-white' : 'border-slate-200 bg-white'
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${overdue ? 'bg-rose-500' : STATUS[t.status].dot}`} />
                            {t.isBlocked && <Icon name="block" size={12} className="text-rose-600" />}
                            <span className="shrink-0 font-mono text-slate-400">{t.key}</span>
                            <span className={`truncate ${t.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{t.title}</span>
                          </button>
                        );
                      })}
                      {list.length > shown.length && (
                        <button className="px-1 text-label-md text-blue-600 hover:underline" onClick={() => (setView('week'), setCursor(date))}>
                          +{list.length - shown.length}{tr(" việc khác")}</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="flex items-center gap-1.5 text-label-sm uppercase tracking-wider text-slate-500">
              <Icon name="account_tree" size={16} />{tr(" Phụ thuộc công việc")}</h2>
            <p className="mb-3 text-label-md font-normal text-slate-400">{tr("Theo dõi luồng chặn & điểm nghẽn")}</p>
            {!chains.length && <p className="text-body-sm text-slate-400">{tr("Chưa có phụ thuộc trong dự án.")}</p>}
            {chains.map((chain, ci) => (
              <div key={ci} className="mb-3 space-y-1">
                <p className="flex items-center justify-between text-label-md text-slate-600">{tr("Chuỗi nghẽn ")}{ci + 1}
                  {chain.filter((c) => c.status !== 'done').length > 1 && <span className="chip border-rose-200 bg-rose-50 text-rose-700">{tr("Đang chặn ")}{chain.length - 1}{tr(" việc")}</span>}
                </p>
                {chain.map((t, i) => {
                  const overdue = t.status !== 'done' && t.dueDate && new Date(t.dueDate).getTime() < Date.now();
                  return (
                    <div key={t._id}>
                      <button
                        onClick={() => navigate({ search: `?task=${t._id}` })}
                        className={`w-full rounded-lg border p-2.5 text-left transition-shadow hover:shadow-card ${overdue ? 'border-rose-300 bg-rose-50' : i > 0 && t.status !== 'done' ? 'border-amber-200 bg-amber-50/50' : 'border-slate-200'}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-label-md font-semibold text-slate-700">{t.key}</span>
                          {overdue ? <span className="chip border-rose-200 bg-white text-rose-600">{tr("Quá hạn")}</span> : <StatusChip status={t.status} />}
                        </div>
                        <p className="mt-0.5 truncate text-body-sm text-slate-800">{t.title}</p>
                      </button>
                      {i < chain.length - 1 && (
                        <div className="flex items-center justify-center py-0.5 text-label-sm text-rose-500">
                          <Icon name="south" size={14} />{tr(" đang chặn")}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="card p-4">
            <h3 className="mb-2 text-label-lg font-semibold text-slate-800">{tr("Việc bị chặn (")}{blocked.length})</h3>
            <div className="space-y-1.5">
              {blocked.map((t) => (
                <button
                  key={t._id}
                  onClick={() => navigate({ search: `?task=${t._id}` })}
                  className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-left text-body-sm hover:bg-slate-50"
                >
                  <span className="font-mono text-label-md text-rose-600">{t.key}</span>
                  <span className="flex-1 truncate">{t.title}</span>
                  <Icon name="chevron_right" size={16} className="text-slate-400" />
                </button>
              ))}
              {!blocked.length && <p className="text-body-sm text-slate-400">{tr("Không có việc nào bị chặn.")}</p>}
            </div>
            <p className="mt-3 text-label-md font-normal text-slate-400">{tr("Thêm phụ thuộc trong chi tiết công việc. Hệ thống chặn tự liên kết, liên kết khác dự án và vòng lặp.")}</p>
          </div>
        </div>
      </div>

      {pop && (
        <div className="fixed inset-0 z-50" onClick={() => setPop(null)}>
          <div
            className="animate-slide-in absolute w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-pop"
            style={{ left: Math.min(pop.x, window.innerWidth - 300), top: Math.min(pop.y + 8, window.innerHeight - 240) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-label-md text-slate-500">{pop.task.key}</span>
              <StatusChip status={pop.task.status} />
            </div>
            <p className="text-body-md font-semibold text-slate-900">{pop.task.title}</p>
            <div className="mt-2 space-y-1 text-body-sm text-slate-600">
              <p className="flex items-center gap-2">
                <Icon name="event" size={16} />{tr(" Hạn: ")}{fmtDate(pop.task.dueDate, { year: true })}
              </p>
              <p className="flex items-center gap-2">
                <Avatar user={pop.task.assignee} size={18} /> {pop.task.assignee?.name || tr("Chưa giao")}
              </p>
              {pop.task.isBlocked && (
                <p className="flex items-center gap-2 text-rose-600">
                  <Icon name="block" size={16} />{tr(" Bị chặn bởi")}{' '}
                  {pop.task.blockedBy
                    .filter((b) => b.status !== 'done')
                    .map((b) => b.key)
                    .join(', ')}
                </p>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <button className="btn-primary btn-sm flex-1" onClick={() => (navigate({ search: `?task=${pop.task._id}` }), setPop(null))}>{tr("Mở chi tiết")}</button>
              {canWriteProject && (
                <label className="btn-outline btn-sm relative flex-1 cursor-pointer">{tr("Đổi hạn")}<input
                    type="date"
                    className="absolute inset-0 cursor-pointer opacity-0"
                    defaultValue={isoDate(pop.task.dueDate)}
                    onChange={(e) => (reschedule(pop.task._id, e.target.value), setPop(null))}
                  />
                </label>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
