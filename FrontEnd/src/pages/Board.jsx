import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CreateTaskModal from '../components/CreateTaskModal.jsx';
import { Avatar, AvatarStack, Empty, ErrorBox, Icon, PageLoader, PriorityChip, Progress, Select } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useApp, useLoad, useToast } from '../lib/app.jsx';
import { STATUS, STATUS_ORDER, dueInfo, fmtDate } from '../lib/format.js';
import { useProjectInfo, useSocketEvent } from '../lib/hooks.js';
import { taskActions } from '../lib/task-permissions.js';

export function TaskCard({ task, draggable, onDragStart, onOpen, statuses = [], onMove, busy }) {
  const due = dueInfo(task.dueDate, task.status);
  const done = task.status === 'done';
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onOpen}
      role="group"
      aria-label={`${task.key} ${task.title}`}
      className={`group cursor-pointer rounded-lg border bg-white p-3 transition-all hover:border-slate-300 hover:shadow-card ${task.isBlocked ? 'border-rose-200' : 'border-slate-200'} ${draggable ? 'active:rotate-1 active:shadow-drag' : ''}`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 font-mono text-label-sm text-slate-400">
          {done && <Icon name="check_circle" size={14} fill className="text-emerald-500" />}
          {task.key}
        </span>
        <div className="flex items-center gap-1">
          {task.isBlocked && (
            <span className="chip border-rose-200 bg-rose-50 text-rose-700">
              <Icon name="block" size={12} /> Đang bị chặn
            </span>
          )}
          <PriorityChip priority={task.priority} />
        </div>
      </div>
      <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className={`w-full text-left text-body-md font-medium leading-snug focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${done ? 'text-slate-500' : 'text-slate-900'}`} aria-label={`Mở ${task.key}: ${task.title}`}>{task.title}</button>
      {task.isBlocked && (
        <p className="mt-1.5 flex items-start gap-1 rounded-md bg-rose-50 px-2 py-1 text-label-md font-normal text-rose-700">
          <Icon name="warning" size={14} className="mt-px" />
          Chờ {task.blockedBy.filter((b) => b && b.status !== 'done').map((b) => b.key).join(', ')}
        </p>
      )}
      {task.labels?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.slice(0, 2).map((l) => (
            <span key={l} className="chip border-slate-200 bg-slate-50 text-slate-500">
              {l}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-3 text-label-md font-normal text-slate-500">
        {task.subtasks?.total > 0 && (
          <span className="flex items-center gap-1" title="Công việc con">
            <Icon name={task.subtasks.done === task.subtasks.total ? 'task_alt' : 'checklist'} size={15} />
            {task.subtasks.done}/{task.subtasks.total}
          </span>
        )}
        {task.commentCount > 0 && (
          <span className="flex items-center gap-1">
            <Icon name="chat_bubble_outline" size={15} />
            {task.commentCount}
          </span>
        )}
        {task.fileCount > 0 && (
          <span className="flex items-center gap-1">
            <Icon name="attach_file" size={15} />
            {task.fileCount}
          </span>
        )}
        {due && (
          <span className={`flex items-center gap-1 ${due.tone === 'danger' ? 'font-semibold text-rose-600' : due.tone === 'warn' ? 'text-amber-600' : ''}`}>
            <Icon name="event" size={15} />
            {due.tone === 'danger' && due.days < 0 ? fmtDate(task.dueDate) : due.text}
          </span>
        )}
        <span className="ml-auto">
          <Avatar user={task.assignee} size={24} />
        </span>
      </div>
      {statuses.length > 1 && (
        <div className="mt-3" onClick={(e) => e.stopPropagation()} onDragStart={(e) => e.preventDefault()}>
          <label className="text-label-md text-slate-500">
            Đổi trạng thái
            <select aria-label={`Trạng thái ${task.key}`} className="input mt-1 h-8 text-body-sm" value={task.status} disabled={busy} onChange={(e) => onMove(e.target.value)}>
              {statuses.map((status) => <option key={status} value={status}>{STATUS[status].label}</option>)}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

export default function Board() {
  const { project, canWriteProject, canManageProject, role, me } = useApp();
  const info = useProjectInfo(project?._id);
  const toast = useToast();
  const navigate = useNavigate();
  const [filter, setFilter] = useState({ assignee: '', priority: '', search: '' });
  const [over, setOver] = useState(null);
  const [drag, setDrag] = useState(null);
  const [creating, setCreating] = useState(null);
  const pendingMoves = useRef(new Set());
  const [moving, setMoving] = useState(new Set());
  const { data, error, loading, reload, setData } = useLoad(() => (project ? api.get(`/projects/${project._id}/tasks`) : Promise.resolve({ tasks: [] })), [project?._id]);

  // Realtime đồng bộ giữa các thành viên
  useSocketEvent(
    'task:changed',
    ({ task }) => {
      if (task.project !== project?._id || task.parent) return;
      setData((d) => {
        if (!d) return d;
        const exists = d.tasks.some((t) => t._id === task._id);
        return { tasks: exists ? d.tasks.map((t) => (t._id === task._id ? task : t)) : [...d.tasks, task] };
      });
    },
    [project?._id],
  );
  useSocketEvent('task:deleted', ({ taskId }) => setData((d) => d && { tasks: d.tasks.filter((t) => t._id !== taskId) }), []);
  useSocketEvent('board:refresh', () => reload(), [reload]);

  const tasks = useMemo(() => {
    let list = data?.tasks || [];
    if (filter.assignee) list = list.filter((t) => (filter.assignee === 'none' ? !t.assignee : t.assignee?._id === filter.assignee));
    if (filter.priority) list = list.filter((t) => t.priority === filter.priority);
    if (filter.search) {
      const s = filter.search.toLowerCase();
      list = list.filter((t) => t.title.toLowerCase().includes(s) || t.key.toLowerCase().includes(s));
    }
    return list;
  }, [data, filter]);

  if (!project) return <Empty icon="folder_off" title="Chưa có dự án" action={<button className="btn-primary" onClick={() => navigate('/projects?new=1')}>Tạo dự án</button>} />;

  const canDrag = canWriteProject && role !== 'viewer';
  const cols = STATUS_ORDER.map((s) => ({ status: s, tasks: tasks.filter((t) => t.status === s).sort((a, b) => a.order - b.order) }));
  const all = data?.tasks || [];
  const doneCount = all.filter((t) => t.status === 'done').length;
  const sprint = info?.project?.sprint;
  const daysLeft = sprint?.end ? Math.max(0, Math.ceil((new Date(sprint.end) - Date.now()) / 86400000)) : null;

  const moveTask = async (taskId, status, index) => {
    setOver(null);
    const task = all.find((t) => t._id === taskId);
    setDrag(null);
    if (!task || pendingMoves.current.has(taskId)) return;
    if (!taskActions(task, project, me).allowedStatuses.includes(status)) {
      toast('Bạn chỉ chuyển được việc mình nhận đến Review. PM duyệt Done hoặc mở lại.', 'error');
      return;
    }
    const col = cols.find((c) => c.status === status).tasks.filter((t) => t._id !== task._id);
    index ??= col.length;
    const before = col[index - 1]?.order ?? (col[0] ? col[0].order - 1000 : Date.now());
    const after = col[index]?.order ?? before + 2000;
    const order = (before + after) / 2;
    if (task.status === status && Math.abs(task.order - order) < 0.001) return;
    pendingMoves.current.add(taskId);
    setMoving(new Set(pendingMoves.current));
    setData((d) => ({ tasks: d.tasks.map((t) => (t._id === task._id ? { ...t, status, order } : t)) })); // lạc quan
    try {
      const { task: saved } = await api.post(`/tasks/${task._id}/move`, { status, order, version: task.version });
      setData((d) => d && ({ tasks: d.tasks.map((t) => (t._id === saved._id && t.version <= saved.version ? saved : t)) }));
    } catch (e) {
      // Keep other moves and newer realtime versions when rolling back this task.
      setData((d) => d && ({ tasks: d.tasks.map((t) => t._id === taskId && t.version === task.version ? task : t) }));
      toast(e.message, e.status === 409 ? 'info' : 'error');
      if ([403, 404, 409].includes(e.status)) reload();
    } finally {
      pendingMoves.current.delete(taskId);
      setMoving(new Set(pendingMoves.current));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-headline-md text-slate-900">{sprint?.name ? `${sprint.name}: ${project.name}` : project.name}</h1>
              {project.status === 'archived' ? (
                <span className="chip border-slate-200 bg-slate-100 text-slate-500">Đã lưu trữ – chỉ đọc</span>
              ) : (
                <span className="chip border-emerald-200 bg-emerald-50 text-emerald-700">
                  <Icon name="schedule" size={12} /> Đang diễn ra
                </span>
              )}
            </div>
            {sprint?.goal && <p className="mt-0.5 text-body-sm text-slate-500">Mục tiêu: {sprint.goal}</p>}
          </div>
          <div className="flex items-center gap-6">
            <div className="w-56">
              <div className="mb-1 flex justify-between text-label-md font-normal text-slate-500">
                <span>Tiến độ</span>
                <span className="font-semibold text-slate-800">
                  {all.length ? Math.round((doneCount / all.length) * 100) : 0}% ({doneCount}/{all.length})
                </span>
              </div>
              <Progress value={all.length ? (doneCount / all.length) * 100 : 0} />
            </div>
            {daysLeft != null && (
              <span className="flex items-center gap-1 text-body-sm text-slate-500">
                <Icon name="event" size={16} /> Còn {daysLeft} ngày (kết thúc {fmtDate(sprint.end)})
              </span>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <span className="flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-label-md font-semibold text-blue-700 shadow-sm">
              <Icon name="view_kanban" size={16} /> Bảng Kanban
            </span>
            <button onClick={() => navigate('/my-tasks')} className="flex items-center gap-1.5 px-2.5 py-1 text-label-md text-slate-500 hover:text-slate-800">
              <Icon name="format_list_bulleted" size={16} /> Danh sách
            </button>
            <button onClick={() => navigate('/calendar')} className="flex items-center gap-1.5 px-2.5 py-1 text-label-md text-slate-500 hover:text-slate-800">
              <Icon name="calendar_month" size={16} /> Lịch
            </button>
          </div>
          <div className="relative">
            <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input h-8 w-48 pl-8 text-body-sm" placeholder="Lọc theo tên, mã..." value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} />
          </div>
          <Select className="input h-8 w-auto py-0 text-body-sm" value={filter.assignee} onChange={(e) => setFilter({ ...filter, assignee: e.target.value })}>
            <option value="">Mọi người nhận</option>
            <option value="none">Chưa giao</option>
            {(info?.project?.members || []).map((m) => (
              <option key={m._id} value={m._id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Select className="input h-8 w-auto py-0 text-body-sm" value={filter.priority} onChange={(e) => setFilter({ ...filter, priority: e.target.value })}>
            <option value="">Mọi ưu tiên</option>
            <option value="high">Cao</option>
            <option value="medium">Trung bình</option>
            <option value="low">Thấp</option>
          </Select>
          {(filter.assignee || filter.priority || filter.search) && (
            <button className="btn-ghost btn-sm" onClick={() => setFilter({ assignee: '', priority: '', search: '' })}>
              Đặt lại
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <AvatarStack users={info?.project?.members || []} />
            {!canDrag && <span className="text-label-md font-normal text-slate-400">{role === 'viewer' ? 'Viewer chỉ xem, không kéo thả' : 'Chỉ đọc'}</span>}
          </div>
        </div>
      </div>
      {error && (
        <div className="p-4">
          <ErrorBox error={error} onRetry={reload} />
        </div>
      )}
      {loading && !data ? (
        <PageLoader />
      ) : (
        <div className="scroll-thin flex flex-1 gap-4 overflow-x-auto p-6">
          {cols.map((col) => (
            <div
              key={col.status}
              onDragOver={(e) => {
                if (!canDrag) return;
                e.preventDefault();
                setOver(col.status);
              }}
              onDragLeave={() => setOver((o) => (o === col.status ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const cards = [...e.currentTarget.querySelectorAll('[data-card]')];
                const idx = cards.findIndex((c) => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
                moveTask(drag, col.status, idx === -1 ? col.tasks.filter((t) => t._id !== drag).length : idx);
              }}
              className={`flex w-[300px] min-w-[280px] shrink-0 flex-col rounded-xl border bg-slate-100/70 p-3 transition-colors ${over === col.status ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200'}`}
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="flex items-center gap-2 whitespace-nowrap text-label-lg font-semibold text-slate-800" title={STATUS[col.status].short}>
                  <span className={`h-2 w-2 rounded-full ${STATUS[col.status].dot}`} />
                  {STATUS[col.status].label}
                  <span className="rounded-full bg-slate-200 px-2 text-label-sm text-slate-600">{col.tasks.length}</span>
                </span>
                {canManageProject && col.status !== 'done' && (
                  <button className="icon-btn h-7 w-7" onClick={() => setCreating(col.status)} title="Thêm công việc">
                    <Icon name="add" size={18} />
                  </button>
                )}
              </div>
              <div className="scroll-thin flex-1 space-y-2.5 overflow-y-auto">
                {col.tasks.map((t) => (
                  <div key={t._id} data-card className={drag === t._id ? 'opacity-40' : ''}>
                    <TaskCard
                      task={t}
                      draggable={canDrag && !moving.has(t._id) && taskActions(t, project, me).canUpdateProgress}
                      statuses={canDrag ? taskActions(t, project, me).allowedStatuses : []}
                      busy={moving.has(t._id)}
                      onMove={(status) => moveTask(t._id, status)}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        setDrag(t._id);
                      }}
                      onOpen={() => navigate({ search: `?task=${t._id}` })}
                    />
                  </div>
                ))}
                {!col.tasks.length && <p className="rounded-lg border border-dashed border-slate-300 py-6 text-center text-body-sm text-slate-400">Kéo thẻ vào đây</p>}
              </div>
              {canManageProject && col.status !== 'done' && (
                <button onClick={() => setCreating(col.status)} className="mt-2 flex items-center justify-center gap-1 rounded-lg py-1.5 text-label-md text-slate-500 hover:bg-white hover:text-slate-800">
                  <Icon name="add" size={16} /> Thêm công việc
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <CreateTaskModal open={!!creating} defaultStatus={creating || 'todo'} onClose={() => setCreating(null)} onCreated={() => reload()} />
    </div>
  );
}
