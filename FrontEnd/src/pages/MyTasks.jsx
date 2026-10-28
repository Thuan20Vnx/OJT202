import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Empty, ErrorBox, Icon, PageHeader, PageLoader, Pagination, PriorityChip, Select, StatCard, StatusChip } from '../components/ui.jsx';
import { api, qs } from '../lib/api.js';
import { useApp, useLoad, useToast } from '../lib/app.jsx';
import { PROJECT_COLOR, STATUS, STATUS_ORDER, dueInfo, sod } from '../lib/format.js';
import { useSocketEvent } from '../lib/hooks.js';
import { dates, timeZone } from '../lib/dates.js';
import { taskActions } from '../lib/task-actions.js';

const DEFAULT = { assignee: 'me', status: '', priority: '', due: '', project: '', search: '' };

function group(task) {
  if (!task.dueDate) return 'Không có hạn';
  const days = Math.round((sod(task.dueDate) - sod()) / 86400000);
  if (task.status !== 'done' && new Date(task.dueDate).getTime() < Date.now()) return 'Quá hạn';
  if (days === 0) return 'Hôm nay';
  if (days >= 0 && new Date(task.dueDate) < dates.weekRange(new Date(), timeZone()).end) return 'Tuần này';
  return 'Sau này';
}
const GROUPS = ['Quá hạn', 'Hôm nay', 'Tuần này', 'Sau này', 'Không có hạn'];

export default function MyTasks() {
  const { wsId, me, projects, setProjectId } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [f, setF] = useState(DEFAULT);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [collapsed, setCollapsed] = useState({});
  const { data, error, loading, reload } = useLoad(
    () => api.get(`/workspaces/${wsId}/my-tasks${qs({ ...f, includeDone: f.status.includes('done') ? 'true' : '', page, limit })}`),
    [wsId, JSON.stringify(f), page, limit],
  );
  useSocketEvent('task:changed', () => reload(), [reload]);

  const set = (k, v) => {
    setF((s) => ({ ...s, [k]: v }));
    setPage(1);
  };
  const active = Object.entries(f).filter(([k, v]) => v && !(k === 'assignee' && v === 'me'));
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';

  const toggleDone = async (t) => {
    const { nextStatus } = taskActions(t);
    if (!nextStatus) return;
    try {
      await api.patch(`/tasks/${t._id}`, { status: nextStatus, version: t.version });
      reload();
    } catch (e) {
      toast(e.message, 'error');
      reload();
    }
  };
  const setStatus = async (t, status) => {
    try {
      await api.patch(`/tasks/${t._id}`, { status, version: t.version });
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const items = data?.items || [];
  const s = data?.summary || {};
  const byGroup = GROUPS.map((g) => ({ g, items: items.filter((t) => group(t) === g) })).filter((x) => x.items.length);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader
        title={`${greet}, ${me?.name || ''} 👋`}
        subtitle={
          <>
            Bạn có <b className="text-blue-700">{s.actionable ?? '–'} việc</b> cần xử lý hôm nay.
          </>
        }
        actions={
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            <span className="flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1 text-label-md font-semibold text-blue-700">
              <Icon name="format_list_bulleted" size={16} /> Danh sách
            </span>
            <button onClick={() => navigate('/board')} className="flex items-center gap-1.5 px-2.5 py-1 text-label-md text-slate-500 hover:text-slate-800">
              <Icon name="view_kanban" size={16} /> Bảng
            </button>
          </div>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Hôm nay"
          value={s.today ?? '–'}
          sub="Việc đến hạn trong ngày"
          icon="today"
          tone="blue"
          active={f.due === 'today'}
          onClick={() => set('due', f.due === 'today' ? '' : 'today')}
        />
        <StatCard
          label="Quá hạn"
          value={s.overdue ?? '–'}
          sub="Cần xử lý ngay"
          icon="error"
          tone="red"
          active={f.due === 'overdue'}
          onClick={() => set('due', f.due === 'overdue' ? '' : 'overdue')}
        />
        <StatCard
          label="Sắp đến hạn"
          value={s.upcoming ?? '–'}
          sub="Từ nay đến cuối tuần"
          icon="schedule"
          tone="amber"
          active={f.due === 'week'}
          onClick={() => set('due', f.due === 'week' ? '' : 'week')}
        />
        <StatCard
          label="Hoàn thành"
          value={s.doneWeek ?? '–'}
          sub="Trong 7 ngày qua"
          icon="task_alt"
          tone="green"
          active={f.status === 'done'}
          onClick={() => set('status', f.status === 'done' ? '' : 'done')}
        />
      </div>

      <div className="card mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input h-9 pl-8 text-body-sm" placeholder="Tìm theo tên hoặc mã công việc (TF-...)" value={f.search} onChange={(e) => set('search', e.target.value)} />
          </div>
          <Select className="input h-9 w-auto text-body-sm" value={f.assignee} onChange={(e) => set('assignee', e.target.value)}>
            <option value="me">Giao cho: Tôi</option>
            <option value="all">Giao cho: Tất cả</option>
            <option value="unassigned">Chưa giao</option>
          </Select>
          <Select className="input h-9 w-auto text-body-sm" value={f.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">Trạng thái: Chưa xong</option>
            {STATUS_ORDER.map((st) => (
              <option key={st} value={st}>
                {STATUS[st].label}
              </option>
            ))}
          </Select>
          <Select className="input h-9 w-auto text-body-sm" value={f.priority} onChange={(e) => set('priority', e.target.value)}>
            <option value="">Ưu tiên: Tất cả</option>
            <option value="high">Cao</option>
            <option value="medium">Trung bình</option>
            <option value="low">Thấp</option>
          </Select>
          <Select className="input h-9 w-auto text-body-sm" value={f.due} onChange={(e) => set('due', e.target.value)}>
            <option value="">Hạn chót: Tất cả</option>
            <option value="today">Hôm nay</option>
            <option value="week">7 ngày tới</option>
            <option value="overdue">Quá hạn</option>
            <option value="none">Không có hạn</option>
          </Select>
          <Select className="input h-9 w-auto text-body-sm" value={f.project} onChange={(e) => set('project', e.target.value)}>
            <option value="">Dự án: Tất cả</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        {active.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-label-md font-normal text-slate-500">
            Đang áp dụng:
            {active.map(([k, v]) => (
              <span key={k} className="chip border-blue-200 bg-blue-50 text-blue-700">
                {{ assignee: 'Người nhận', status: 'Trạng thái', priority: 'Ưu tiên', due: 'Hạn', project: 'Dự án', search: 'Tìm' }[k]}:{' '}
                {k === 'project' ? projects.find((p) => p._id === v)?.name : k === 'status' ? STATUS[v]?.label : v}
                <button onClick={() => set(k, k === 'assignee' ? 'me' : '')}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
            <button className="ml-1 font-semibold text-blue-600 hover:underline" onClick={() => (setF(DEFAULT), setPage(1))}>
              Đặt lại bộ lọc
            </button>
          </div>
        )}
      </div>

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <PageLoader />
      ) : !items.length ? (
        <div className="card">
          <Empty
            icon="filter_alt_off"
            title="Không có công việc nào khớp bộ lọc"
            action={
              <button className="btn-outline" onClick={() => setF(DEFAULT)}>
                Đặt lại bộ lọc
              </button>
            }
          >
            Thử bỏ bớt điều kiện lọc hoặc chọn “Giao cho: Tất cả”.
          </Empty>
        </div>
      ) : (
        <div className="space-y-4">
          {byGroup.map(({ g, items: list }) => (
            <div key={g} className="card overflow-hidden">
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [g]: !c[g] }))}
                className="flex w-full items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 text-left"
              >
                <Icon name={collapsed[g] ? 'chevron_right' : 'expand_more'} size={18} className="text-slate-400" />
                <span className={`text-label-lg font-semibold ${g === 'Quá hạn' ? 'text-rose-600' : 'text-slate-800'}`}>{g}</span>
                <span className="rounded-full bg-slate-200 px-2 text-label-sm text-slate-600">{list.length}</span>
              </button>
              {!collapsed[g] && (
                <div className="divide-y divide-slate-100">
                  {list.map((t) => {
                    const actions = taskActions(t);
                    const due = dueInfo(t.dueDate, t.status);
                    const blocked = (t.blockedBy || []).some((b) => b && b.status !== 'done');
                    return (
                      <div key={t._id} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                        <input type="checkbox" aria-label={`${actions.label} ${t.key}`} title={actions.label} className="form-checkbox h-4 w-4 rounded text-blue-600" checked={t.status === 'done'} disabled={!actions.nextStatus} onChange={() => toggleDone(t)} />
                        <span className="w-16 shrink-0 font-mono text-label-md text-slate-400">{t.key}</span>
                        <button
                          className="min-w-0 flex-1 truncate text-left text-body-md text-slate-900 hover:text-blue-700"
                          onClick={() => {
                            setProjectId(t.project._id);
                            navigate({ search: `?task=${t._id}` });
                          }}
                          title={t.title}
                        >
                          {t.title}
                        </button>
                        {blocked && (
                          <span className="chip border-rose-200 bg-rose-50 text-rose-700">
                            <Icon name="block" size={12} /> Đang bị chặn
                          </span>
                        )}
                        <span className="hidden items-center gap-1.5 whitespace-nowrap text-label-md text-slate-600 lg:flex">
                          <span className={`h-2 w-2 rounded-full ${PROJECT_COLOR[t.project?.color]}`} />
                          {t.project?.name}
                        </span>
                        <span className="hidden md:inline-flex">
                          <StatusChip status={t.status} />
                        </span>
                        <PriorityChip priority={t.priority} />
                        <span
                          className={`hidden w-28 whitespace-nowrap text-right text-label-md sm:block ${due?.tone === 'danger' ? 'font-semibold text-rose-600' : 'text-slate-500'}`}
                        >
                          {due ? due.text : 'Không có hạn'}
                        </span>
                        <span className="hidden w-12 text-label-md font-normal text-slate-500 xl:block">{t.subtasks.total ? `${t.subtasks.done}/${t.subtasks.total}` : ''}</span>
                        <span className="hidden w-8 items-center gap-0.5 text-label-md font-normal text-slate-400 xl:flex">
                          {t.commentCount > 0 && (
                            <>
                              <Icon name="chat_bubble_outline" size={14} />
                              {t.commentCount}
                            </>
                          )}
                        </span>
                        <Avatar user={t.assignee} size={24} />
                        {t.permissions?.canUpdateProgress && (
                          <Select className="input hidden h-7 w-32 py-0 text-label-md group-hover:inline-flex" value={t.status} onChange={(e) => setStatus(t, e.target.value)} title="Đổi trạng thái nhanh">
                            {(t.permissions.allowedStatuses || []).map((st) => (
                              <option key={st} value={st}>
                                {STATUS[st].label}
                              </option>
                            ))}
                          </Select>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          <div className="card">
            <Pagination page={page} total={data.total} limit={limit} onPage={setPage} onLimit={(n) => (setLimit(n), setPage(1))} />
          </div>
        </div>
      )}
    </div>
  );
}
