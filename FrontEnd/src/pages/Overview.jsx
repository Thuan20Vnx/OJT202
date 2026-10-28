import { Link, useNavigate } from 'react-router-dom';
import { Burndown, Donut } from '../components/charts.jsx';
import { Avatar, Empty, ErrorBox, Icon, PageHeader, PageLoader, PriorityChip, Progress, StatCard, StatusChip } from '../components/ui.jsx';
import { api, download } from '../lib/api.js';
import { useApp, useLoad } from '../lib/app.jsx';
import { fmtProjectDate as fmtDate, timeAgo } from '../lib/format.js';
import { useSocketEvent } from '../lib/hooks.js';

export const SEVERITY = {
  critical: { label: 'Nghiêm trọng', chip: 'border-rose-200 bg-rose-50 text-rose-700', icon: 'error', card: 'border-rose-200 bg-rose-50/40' },
  warning: { label: 'Cảnh báo', chip: 'border-amber-200 bg-amber-50 text-amber-700', icon: 'warning', card: 'border-amber-200 bg-amber-50/40' },
};

export default function Overview() {
  const { project } = useApp();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useLoad(() => (project ? api.get(`/projects/${project._id}/overview`) : Promise.resolve(null)), [project?._id]);
  useSocketEvent('task:changed', () => reload(), [reload]);
  useSocketEvent('risks:changed', () => reload(), [reload]);

  if (!project)
    return (
      <Empty
        icon="folder_off"
        title="Chưa có dự án"
        action={
          <button className="btn-primary" onClick={() => navigate('/projects?new=1')}>
            Tạo dự án
          </button>
        }
      />
    );
  if (loading && !data) return <PageLoader />;
  if (error)
    return (
      <div className="p-6">
        <ErrorBox error={error} onRetry={reload} />
      </div>
    );
  const k = data.kpis;
  const sprint = data.sprint;
  const trend = k.velocity.last7 - k.velocity.prev7;
  const activeWorkload = data.workload.filter((w) => w.role !== 'viewer');
  const overloadedCount = activeWorkload.filter((w) => w.overloaded).length;

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader
        title="Tổng quan dự án"
        subtitle={`${project.name}${sprint?.name ? ` · ${sprint.name}` : ''}${data.burndown ? ` · Còn ${data.burndown.daysLeft} ngày` : ''}`}
        actions={
          <>
            <Link to="/risks" className="btn-outline">
              <Icon name="warning" size={16} className="text-amber-500" /> Cảnh báo rủi ro ({data.riskCount})
            </Link>
            <button className="btn-outline" onClick={() => download(`/projects/${project._id}/overview.csv`, 'tong-quan-du-an.csv')}>
              <Icon name="download" size={16} /> Xuất CSV
            </button>
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Tiến độ" value={`${k.done}/${k.total}`} sub={`${k.progressPct}% công việc hoàn thành`} icon="donut_large" tone="blue">
          <Progress value={k.progressPct} className="mt-2" />
        </StatCard>
        <StatCard
          label="Quá hạn"
          value={k.overdue}
          sub={k.overdue ? 'Xem danh sách cần xử lý' : 'Không có việc quá hạn'}
          icon="event_busy"
          tone="red"
          onClick={() => document.getElementById('overdue-tasks')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
        <StatCard label="Đang bị chặn" value={k.blocked} sub="Chờ công việc khác" icon="block" tone="amber" onClick={() => navigate('/risks')} />
        <StatCard
          label="Tốc độ hoàn thành"
          value={`${k.velocity.last7} việc/tuần`}
          sub={
            <span className={trend > 0 ? 'text-emerald-600' : trend < 0 ? 'text-rose-600' : ''}>
              {trend > 0 ? '▲' : trend < 0 ? '▼' : '='} {Math.abs(trend)} so với tuần trước
            </span>
          }
          icon="speed"
          tone="green"
        />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-headline-sm text-slate-900">Burndown {sprint?.name || 'Sprint'}</h2>
              {sprint?.start && (
                <p className="text-label-md font-normal text-slate-500">
                  Số việc còn lại · {fmtDate(sprint.start)} → {fmtDate(sprint.end)}
                </p>
              )}
            </div>
          </div>
          <Burndown days={data.burndown?.days || []} />
          {data.burndown?.sampled && <p className="mt-2 text-label-sm text-slate-500">Khoảng Sprint dài: biểu đồ hiển thị các mốc lấy mẫu, giữ đủ ngày đầu và ngày cuối.</p>}
        </div>
        <div className="card p-5">
          <h2 className="mb-1 text-headline-sm text-slate-900">Phân bố trạng thái</h2>
          <p className="mb-4 text-label-md font-normal text-slate-500">Tổng {k.total} công việc (không tính việc con)</p>
          <Donut
            segments={[
              { label: 'Cần làm', value: data.byStatus.todo, color: '#64748b' },
              { label: 'Đang thực hiện', value: data.byStatus.in_progress, color: '#3b82f6' },
              { label: 'Đang kiểm duyệt', value: data.byStatus.review, color: '#f59e0b' },
              { label: 'Hoàn thành', value: data.byStatus.done, color: '#10b981' },
            ]}
            center={
              <>
                <span className="text-headline-lg text-slate-900">{k.progressPct}%</span>
                <span className="text-label-md font-normal text-slate-500">hoàn thành</span>
              </>
            }
          />
        </div>
      </div>

      <section id="overdue-tasks" className="card mb-5 scroll-mt-4 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-headline-sm text-slate-900">Công việc quá hạn</h2>
            <p className="text-label-md font-normal text-slate-500">Các công việc chưa hoàn thành và đã qua hạn chót</p>
          </div>
          <span className={`chip ${k.overdue ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {k.overdue} công việc
          </span>
        </div>
        {data.overdue.length ? (
          <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {data.overdue.map((task) => (
              <button
                key={task._id}
                onClick={() => navigate({ search: `?task=${task._id}` })}
                className="flex w-full flex-wrap items-center gap-3 py-3 text-left transition-colors hover:bg-rose-50/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-semibold text-slate-900">
                    <span className="mr-2 font-mono text-rose-700">{task.key}</span>
                    {task.title}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-label-md text-slate-500">
                    <span>Hạn {fmtDate(task.dueDate, { year: true })}</span>
                    <span>·</span>
                    <span>{task.assignee?.name || 'Chưa giao'}</span>
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <PriorityChip priority={task.priority} />
                  <StatusChip status={task.status} />
                  <Icon name="chevron_right" size={18} className="text-slate-400" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <Empty icon="event_available" title="Không có công việc quá hạn">
            Các công việc chưa hoàn thành đều còn trong hạn.
          </Empty>
        )}
      </section>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-headline-sm text-slate-900">Tải công việc tuần này</h2>
            <span className={`chip ${overloadedCount ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
              {overloadedCount} người quá tải
            </span>
          </div>
          <p className="mb-4 text-label-md font-normal text-slate-500">Giờ ước lượng chưa xong (đến hạn trong tuần hoặc đã quá hạn) / giờ khả dụng</p>
          <div className="space-y-3">
            {activeWorkload.length ? (
              activeWorkload.map((w) => {
                const over = w.overloaded;
                return (
                  <div key={w.user._id} className="flex items-center gap-3">
                    <Avatar user={w.user} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center justify-between text-body-sm">
                        <span className="truncate font-medium text-slate-800">
                          {w.user.name} <span className="font-normal text-slate-400">{w.jobTitle}</span>
                        </span>
                        <span className={`whitespace-nowrap ${over ? 'font-semibold text-rose-600' : 'text-slate-600'}`}>
                          {Math.round(w.hours * 10) / 10}/{w.available} giờ · {w.pct == null ? 'Không có giờ khả dụng' : `${w.pct}%`}
                          {over && ' · Quá tải'}
                        </span>
                      </div>
                      <Progress value={w.pct == null ? 100 : Math.min(100, w.pct)} tone={over ? 'bg-rose-500' : w.pct >= 80 ? 'bg-amber-500' : 'bg-blue-600'} height="h-2" />
                      {w.missingEstimates > 0 && <p className="mt-1 text-label-md text-amber-700">{w.missingEstimates} công việc chưa có ước lượng, chưa tính đủ tải.</p>}
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="py-4 text-center text-body-sm text-slate-400">Chưa có thành viên được phân công trong dự án.</p>
            )}
          </div>
          <p className="mt-4 flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-label-md font-normal text-slate-500">
            <Icon name="info" size={14} className="mt-px" />
            Tải = giờ ước lượng chưa xong đến hạn trong tuần hoặc đã quá hạn / giờ khả dụng. Không dùng để xếp hạng cá nhân.
          </p>
        </div>
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-headline-sm text-slate-900">Cảnh báo rủi ro</h2>
            <span className="chip border-rose-200 bg-rose-50 text-rose-700">{data.riskCount} cảnh báo</span>
          </div>
          <div className="space-y-3">
            {data.risks.map((r) => (
              <div key={r.key} className={`rounded-xl border p-3 ${SEVERITY[r.severity].card}`}>
                <div className="flex items-start gap-2">
                  <span className={`chip ${SEVERITY[r.severity].chip}`}>
                    <Icon name={SEVERITY[r.severity].icon} size={12} />
                    {SEVERITY[r.severity].label}
                  </span>
                  <p className="flex-1 text-body-sm font-semibold text-slate-900">{r.title}</p>
                </div>
                <p className="mt-1.5 text-body-sm text-slate-600">{r.explanation}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {r.tasks.slice(0, 4).map((t) => (
                    <button
                      key={t._id}
                      onClick={() => navigate({ search: `?task=${t._id}` })}
                      className="chip border-slate-200 bg-white font-mono text-blue-700 hover:border-blue-300"
                    >
                      {t.key}
                    </button>
                  ))}
                  <Link to="/risks" className="ml-auto text-label-md font-semibold text-blue-600">
                    Xem việc
                  </Link>
                </div>
              </div>
            ))}
            {!data.risks.length && (
              <Empty icon="verified" title="Chưa phát hiện rủi ro">
                Các quy tắc cảnh báo chưa bị kích hoạt.
              </Empty>
            )}
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-headline-sm text-slate-900">Hoạt động gần đây</h2>
          <Link to="/settings/activity" className="text-label-md font-semibold text-blue-600">
            Xem nhật ký hoạt động
          </Link>
        </div>
        <div className="divide-y divide-slate-100">
          {data.recent.map((a) => (
            <div key={a._id} className="flex items-center gap-3 py-2.5 text-body-sm">
              <Avatar user={a.actor} size={26} />
              <p className="flex-1 text-slate-600">
                <b className="text-slate-800">{a.actor?.name}</b> {a.action.toLowerCase()} <span className="text-slate-800">{a.entityLabel}</span>
                {a.after != null && typeof a.after !== 'object' && <span className="text-slate-500"> → {String(a.after)}</span>}
              </p>
              <span className="whitespace-nowrap text-label-md font-normal text-slate-400">{timeAgo(a.createdAt)}</span>
            </div>
          ))}
          {!data.recent.length && <p className="py-4 text-body-sm text-slate-400">Chưa có hoạt động</p>}
        </div>
      </div>
    </div>
  );
}
