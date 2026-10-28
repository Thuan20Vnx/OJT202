import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download } from '../lib/api.js';
import { useApp, useToast } from '../lib/app.jsx';
import { PRIORITY, STATUS, dueInfo, fileIcon, fileSize, fmtDate, fmtDateTime, isoDate, timeAgo } from '../lib/format.js';
import { useProjectInfo, useSocketEvent } from '../lib/hooks.js';
import { MemberPicker } from './CreateTaskModal.jsx';
import { Avatar, Confirm, Dropdown, Icon, MenuItem, Notice, PageLoader, Progress, Spinner, StatusChip } from './ui.jsx';

function Section({ icon, title, right, children, tone = 'text-slate-500' }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className={`flex items-center gap-1.5 text-label-sm uppercase tracking-wider ${tone}`}>
          <Icon name={icon} size={16} />
          {title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function CommentBox({ members, onSend, initial = '', onCancel, autoFocus }) {
  const [text, setText] = useState(initial);
  const [suggest, setSuggest] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const onChange = (e) => {
    const v = e.target.value;
    setText(v);
    const m = v.slice(0, e.target.selectionStart).match(/@([^\s@]*)$/);
    setSuggest(m ? m[1].toLowerCase() : null);
  };
  const pick = (m) => {
    const pos = ref.current.selectionStart;
    const before = text.slice(0, pos).replace(/@([^\s@]*)$/, `@${m.name} `);
    setText(before + text.slice(pos));
    setSuggest(null);
    ref.current.focus();
  };
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await onSend(text);
      setText('');
    } finally {
      setBusy(false);
    }
  };
  const list = suggest !== null ? members.filter((m) => m.name.toLowerCase().includes(suggest)).slice(0, 6) : [];
  return (
    <div className="relative rounded-xl border border-slate-200 bg-white focus-within:border-blue-500">
      <textarea
        ref={ref}
        autoFocus={autoFocus}
        value={text}
        onChange={onChange}
        onKeyDown={(e) => (e.key === 'Enter' && (e.ctrlKey || e.metaKey) ? send() : null)}
        rows={2}
        className="w-full resize-none rounded-xl border-0 px-3 py-2 text-body-sm focus:ring-0"
        placeholder="Viết bình luận… gõ @ để nhắc tên thành viên"
      />
      {list.length > 0 && (
        <div className="absolute bottom-full left-2 z-10 mb-1 w-60 rounded-xl border border-slate-200 bg-white p-1 shadow-pop">
          {list.map((m) => (
            <button key={m._id} onMouseDown={(e) => (e.preventDefault(), pick(m))} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-body-sm hover:bg-slate-50">
              <Avatar user={m} size={20} />
              {m.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-2 py-1.5">
        <span className="mr-auto text-label-md font-normal text-slate-400">Ctrl + Enter để gửi</span>
        {onCancel && (
          <button className="btn-ghost btn-sm" onClick={onCancel}>
            Hủy
          </button>
        )}
        <button className="btn-primary btn-sm" onClick={send} disabled={busy || !text.trim()}>
          {busy ? <Spinner /> : <Icon name="send" size={16} />}
          Gửi
        </button>
      </div>
    </div>
  );
}

const renderBody = (body) =>
  body.split(/(@[\p{L}]+(?:\s[\p{L}]+)?)/u).map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} className="rounded bg-blue-50 px-1 font-semibold text-blue-700">
        {part}
      </span>
    ) : (
      part
    ),
  );

export default function TaskDetailModal({ taskId, onClose }) {
  const { me, wsId, setWsId, setProjectId } = useApp();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [comments, setComments] = useState([]);
  const [tab, setTab] = useState('comments');
  const [saving, setSaving] = useState(false);
  const [newSub, setNewSub] = useState('');
  const [newCheck, setNewCheck] = useState('');
  const [depOpen, setDepOpen] = useState(false);
  const [depOptions, setDepOptions] = useState([]);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [stale, setStale] = useState(false);
  const fileInput = useRef(null);
  const info = useProjectInfo(data?.task?.project);
  const members = info?.project?.members || [];

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/tasks/${taskId}`);
      setData(d);
      setForm({
        title: d.task.title,
        description: d.task.description,
        acceptanceCriteria: d.task.acceptanceCriteria || [],
        assignee: d.task.assignee?._id || '',
        dueDate: isoDate(d.task.dueDate),
        priority: d.task.priority,
        estimateHours: d.task.estimateHours ?? '',
        spentHours: d.task.spentHours ?? 0,
        remainingHours: d.task.remainingHours ?? '',
        labels: d.task.labels || [],
      });
      setDirty(false);
      setStale(false);
      const c = await api.get(`/tasks/${taskId}/comments`);
      setComments(c.comments);
    } catch (e) {
      setError(e);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (data?.task?.project) {
      if (data.task.workspace !== wsId) setWsId(data.task.workspace);
      setProjectId(data.task.project);
    }
  }, [data?.task?.project, data?.task?.workspace, wsId, setWsId, setProjectId]);

  // Realtime: người khác sửa => tải lại (hoặc báo nếu mình đang sửa dở)
  useSocketEvent(
    'task:changed',
    ({ task }) => {
      if (task._id !== taskId && task.parent !== taskId) return;
      if (task._id === taskId && task.version === data?.task?.version) return;
      if (dirty) setStale(true);
      else load();
    },
    [taskId, dirty, data?.task?.version, load],
  );
  useSocketEvent('comment:new', ({ taskId: t, comment }) => t === taskId && setComments((cs) => (cs.some((c) => c._id === comment._id) ? cs : [...cs, comment])), [taskId]);
  useSocketEvent('comment:updated', ({ comment }) => setComments((cs) => cs.map((c) => (c._id === comment._id ? comment : c))), []);
  useSocketEvent('comment:deleted', ({ commentId }) => setComments((cs) => cs.filter((c) => c._id !== commentId)), []);
  useSocketEvent('task:deleted', ({ taskId: t }) => t === taskId && onClose(), [taskId]);

  if (error) {
    return (
      <Shell onClose={onClose}>
        <div className="p-8">
          <Notice tone="danger">{error.status === 404 ? 'Không tìm thấy công việc hoặc bạn không có quyền xem.' : error.message}</Notice>
        </div>
      </Shell>
    );
  }
  if (!data || !form) {
    return (
      <Shell onClose={onClose}>
        <PageLoader />
      </Shell>
    );
  }

  const { task, subtasks, blocking, files, activity, access, parent } = data;
  const canWrite = access.canEdit;
  const allowedStatuses = access.allowedStatuses || [];
  const due = dueInfo(task.dueDate, task.status);
  const setF = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const patch = async (body) => {
    try {
      const { task: t } = await api.patch(`/tasks/${task._id}`, { ...body, version: task.version });
      setData((d) => ({ ...d, task: t }));
      return t;
    } catch (e) {
      if (e.status === 409) {
        toast('Công việc vừa được người khác cập nhật – đã tải lại dữ liệu mới nhất', 'info');
        await load();
      } else toast(e.message, 'error');
      throw e;
    }
  };

  const save = async () => {
    if (!form.title.trim()) return toast('Vui lòng nhập tên công việc', 'error');
    setSaving(true);
    try {
      await patch({
        title: form.title,
        description: form.description,
        acceptanceCriteria: form.acceptanceCriteria.filter((x) => x.trim()),
        assignee: form.assignee || null,
        dueDate: form.dueDate || null,
        priority: form.priority,
        estimateHours: form.estimateHours === '' ? null : Number(form.estimateHours),
        spentHours: Number(form.spentHours) || 0,
        remainingHours: form.remainingHours === '' ? null : Number(form.remainingHours),
        labels: form.labels,
      });
      setDirty(false);
      toast('Đã lưu thay đổi');
    } catch {
      /* đã báo lỗi */
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status) => {
    try { await patch({ status }); await load(); } catch { /* patch hiển thị lỗi */ }
  };

  const addSub = async () => {
    if (!newSub.trim()) return;
    try {
      await api.post(`/projects/${task.project}/tasks`, { title: newSub.trim(), parent: task._id, assignee: task.assignee?._id || null });
      setNewSub('');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const toggleSub = async (s) => {
    try {
      await api.patch(`/tasks/${s._id}`, { status: s.status === 'done' ? 'todo' : 'done', version: s.version });
      load();
    } catch (e) {
      toast(e.message, 'error');
      load();
    }
  };

  const saveChecklist = async (checklist) => {
    await patch({ checklist }).catch(() => {});
  };

  const openDeps = async () => {
    setDepOpen((o) => !o);
    if (!depOptions.length) {
      const d = await api.get(`/projects/${task.project}/tasks`);
      setDepOptions(d.tasks.filter((t) => t._id !== task._id));
    }
  };
  const addDep = async (id) => {
    try {
      const { task: t } = await api.post(`/tasks/${task._id}/dependencies`, { blockedBy: id });
      setData((d) => ({ ...d, task: t }));
      setDepOpen(false);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const removeDep = async (id) => {
    const { task: t } = await api.del(`/tasks/${task._id}/dependencies/${id}`);
    setData((d) => ({ ...d, task: t }));
  };

  const upload = async (list) => {
    if (!list?.length) return;
    const fd = new FormData();
    [...list].forEach((f) => fd.append('files', f));
    fd.append('task', task._id);
    try {
      await api.upload(`/projects/${task.project}/documents/upload`, fd);
      toast('Đã tải tệp lên');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const sendComment = async (body) => {
    try {
      const { comment } = await api.post(`/tasks/${task._id}/comments`, { body });
      setComments((cs) => (cs.some((c) => c._id === comment._id) ? cs : [...cs, comment]));
    } catch (e) {
      toast(e.message, 'error');
      throw e;
    }
  };
  const updateComment = async (id, body) => {
    const { comment } = await api.patch(`/comments/${id}`, { body });
    setComments((cs) => cs.map((c) => (c._id === id ? comment : c)));
    setEditing(null);
  };

  const remove = async (confirm) => {
    try {
      await api.del(`/tasks/${task._id}${confirm ? '?confirm=true' : ''}`);
      toast(`Đã xóa ${task.key}`);
      onClose();
    } catch (e) {
      if (e.details?.code === 'CONFIRM_REQUIRED') setConfirmDel(e.message);
      else toast(e.message, 'error');
    }
  };

  const subDone = subtasks.filter((s) => s.status === 'done').length;
  const blockers = (task.blockedBy || []).filter(Boolean);
  const openBlockers = blockers.filter((b) => b.status !== 'done');
  const checkDone = (task.checklist || []).filter((c) => c.done).length;

  return (
    <Shell onClose={onClose}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-6 py-3">
        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-label-md font-semibold text-slate-700">{task.key}</span>
        {parent && (
          <Link to={`?task=${parent._id}`} className="text-label-md text-slate-500 hover:text-blue-600">
            ↑ {parent.key}
          </Link>
        )}
        <Dropdown
          align="left"
          trigger={
            <button disabled={!allowedStatuses.length} aria-label="Đổi trạng thái công việc" className={`chip h-7 cursor-pointer px-2.5 ${STATUS[task.status].chip}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS[task.status].dot}`} />
              {STATUS[task.status].label}
              {!!allowedStatuses.length && <Icon name="expand_more" size={14} />}
            </button>
          }
        >
          {allowedStatuses.map((s) => (
            <MenuItem key={s} onClick={() => changeStatus(s)}>
              <span className={`h-2 w-2 rounded-full ${STATUS[s].dot}`} />
              {STATUS[s].label}
            </MenuItem>
          ))}
        </Dropdown>
        {task.isBlocked && (
          <span className="chip h-7 border-rose-200 bg-rose-50 px-2.5 text-rose-700">
            <Icon name="block" size={14} />
            Đang bị chặn
          </span>
        )}
        {!canWrite && <span className="chip h-7 border-slate-200 bg-slate-50 text-slate-500">{access.archived ? 'Dự án đã lưu trữ – chỉ xem' : access.canUpdateProgress ? 'Cập nhật trạng thái và giờ còn lại' : 'Chỉ xem'}</span>}
        <div className="ml-auto flex items-center gap-1">
          <button
            className="btn-ghost btn-sm"
            onClick={() => {
              navigator.clipboard?.writeText(`${window.location.origin}/board?task=${task._id}`);
              toast('Đã sao chép liên kết', 'info');
            }}
          >
            <Icon name="link" size={16} />
            Sao chép liên kết
          </button>
          {canWrite && (
            <Dropdown trigger={<button className="icon-btn"><Icon name="more_horiz" /></button>}>
              <MenuItem icon="delete" danger onClick={() => remove(false)}>
                Xóa công việc
              </MenuItem>
            </Dropdown>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="Đóng">
            <Icon name="close" />
          </button>
        </div>
      </div>
      {stale && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-body-sm text-amber-800">
          Công việc vừa được người khác cập nhật.{' '}
          <button className="font-semibold underline" onClick={load}>
            Tải lại
          </button>{' '}
          (thay đổi chưa lưu của bạn sẽ mất)
        </div>
      )}

      <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[1fr_320px]">
        {/* Cột chính */}
        <div className="scroll-thin space-y-6 overflow-y-auto px-6 py-5">
          <textarea
            value={form.title}
            disabled={!canWrite}
            onChange={(e) => setF('title', e.target.value)}
            rows={1}
            className="w-full resize-none border-0 bg-transparent p-0 text-headline-lg text-slate-900 focus:ring-0 disabled:text-slate-900"
          />

          <Section icon="notes" title="Mô tả công việc">
            <textarea
              disabled={!canWrite}
              className="textarea min-h-[100px] bg-slate-50/60"
              value={form.description}
              onChange={(e) => setF('description', e.target.value)}
              placeholder="Chưa có mô tả"
            />
            <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
              <p className="mb-1.5 text-label-md font-semibold text-slate-700">Tiêu chí nghiệm thu</p>
              {form.acceptanceCriteria.map((c, i) => (
                <div key={i} className="flex items-center gap-2 py-0.5">
                  <Icon name="check_circle" size={16} className="icon-fill text-blue-600" />
                  <input
                    disabled={!canWrite}
                    className="flex-1 border-0 bg-transparent p-0 text-body-sm focus:ring-0"
                    value={c}
                    onChange={(e) => setF('acceptanceCriteria', form.acceptanceCriteria.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  {canWrite && (
                    <button className="text-slate-300 hover:text-rose-500" onClick={() => setF('acceptanceCriteria', form.acceptanceCriteria.filter((_, j) => j !== i))}>
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </div>
              ))}
              {canWrite && (
                <button className="mt-1 text-label-md text-blue-600 hover:underline" onClick={() => setF('acceptanceCriteria', [...form.acceptanceCriteria, ''])}>
                  + Thêm tiêu chí
                </button>
              )}
            </div>
          </Section>

          {(blockers.length > 0 || blocking.length > 0 || canWrite) && (
            <Section
              icon="link"
              title="Phụ thuộc"
              tone={openBlockers.length ? 'text-rose-600' : 'text-slate-500'}
              right={
                canWrite && (
                  <div className="relative">
                    <button className="text-label-md text-blue-600 hover:underline" onClick={openDeps}>
                      + Thêm phụ thuộc
                    </button>
                    {depOpen && (
                      <div className="absolute right-0 z-20 mt-1 max-h-64 w-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-pop">
                        <p className="px-2 py-1 text-label-md font-normal text-slate-400">Công việc này bị chặn bởi…</p>
                        {depOptions.map((t) => (
                          <button key={t._id} onClick={() => addDep(t._id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-body-sm hover:bg-slate-50">
                            <span className="font-mono text-label-md text-slate-400">{t.key}</span>
                            <span className="truncate">{t.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              }
            >
              <div className="space-y-1.5">
                {blockers.map((b) => (
                  <div key={b._id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-body-sm ${b.status !== 'done' ? 'border-rose-200 bg-rose-50/60' : 'border-slate-200'}`}>
                    <span className="chip border-rose-200 bg-white text-rose-600">Bị chặn bởi</span>
                    <Link to={`?task=${b._id}`} className="font-semibold text-slate-800 hover:text-blue-600">
                      {b.key}
                    </Link>
                    <span className="flex-1 truncate text-slate-600">{b.title}</span>
                    <StatusChip status={b.status} />
                    {canWrite && (
                      <button className="text-slate-400 hover:text-rose-500" onClick={() => removeDep(b._id)} title="Gỡ phụ thuộc">
                        <Icon name="link_off" size={16} />
                      </button>
                    )}
                  </div>
                ))}
                {blocking.map((b) => (
                  <div key={b._id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-body-sm">
                    <span className="chip border-amber-200 bg-amber-50 text-amber-700">Đang chặn</span>
                    <Link to={`?task=${b._id}`} className="font-semibold text-slate-800 hover:text-blue-600">
                      {b.key}
                    </Link>
                    <span className="flex-1 truncate text-slate-600">{b.title}</span>
                    <StatusChip status={b.status} />
                  </div>
                ))}
                {!blockers.length && !blocking.length && <p className="text-body-sm text-slate-400">Chưa có phụ thuộc</p>}
              </div>
            </Section>
          )}

          {!task.parent && (
            <Section icon="account_tree" title={`Công việc con (${subDone}/${subtasks.length} hoàn thành)`} tone="text-blue-700" right={subtasks.length > 0 && <span className="text-label-md text-blue-600">{Math.round((subDone / subtasks.length) * 100)}%</span>}>
              {subtasks.length > 0 && <Progress value={(subDone / subtasks.length) * 100} className="mb-2" />}
              <div className="space-y-1.5">
                {subtasks.map((s) => (
                  <div key={s._id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-body-sm">
                    <input type="checkbox" disabled={!canWrite} className="form-checkbox h-4 w-4 rounded text-blue-600" checked={s.status === 'done'} onChange={() => toggleSub(s)} />
                    <Link to={`?task=${s._id}`} className={`flex-1 truncate ${s.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                      {s.title}
                    </Link>
                    {s.assignee && <span className="rounded-md bg-slate-100 px-1.5 text-label-md text-slate-600">{s.assignee.name}</span>}
                    {s.dueDate && <span className="text-label-md text-slate-500">{fmtDate(s.dueDate)}</span>}
                  </div>
                ))}
                {canWrite && (
                  <input className="input h-9" placeholder="+ Thêm công việc con rồi nhấn Enter (tối đa 1 cấp)" value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSub()} />
                )}
              </div>
            </Section>
          )}

          <Section icon="checklist" title={`Checklist (${checkDone}/${(task.checklist || []).length})`}>
            <div className="space-y-1">
              {(task.checklist || []).map((c, i) => (
                <label key={c._id || i} className="flex items-center gap-2 text-body-sm">
                  <input
                    type="checkbox"
                    disabled={!canWrite}
                    className="form-checkbox h-4 w-4 rounded text-blue-600"
                    checked={c.done}
                    onChange={() => saveChecklist(task.checklist.map((x, j) => ({ text: x.text, done: j === i ? !x.done : x.done })))}
                  />
                  <span className={`flex-1 ${c.done ? 'text-slate-400 line-through' : ''}`}>{c.text}</span>
                  {canWrite && (
                    <button type="button" className="text-slate-300 hover:text-rose-500" onClick={() => saveChecklist(task.checklist.filter((_, j) => j !== i).map(({ text, done }) => ({ text, done })))}>
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </label>
              ))}
              {canWrite && (
                <input
                  className="input h-8 text-body-sm"
                  placeholder="+ Thêm mục checklist"
                  value={newCheck}
                  onChange={(e) => setNewCheck(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newCheck.trim()) {
                      saveChecklist([...(task.checklist || []).map(({ text, done }) => ({ text, done })), { text: newCheck.trim(), done: false }]);
                      setNewCheck('');
                    }
                  }}
                />
              )}
            </div>
          </Section>

          <Section
            icon="attach_file"
            title={`Tệp đính kèm (${files.length})`}
            right={
              canWrite && (
                <button className="text-label-md text-blue-600 hover:underline" onClick={() => fileInput.current?.click()}>
                  + Tải tệp
                </button>
              )
            }
          >
            <input ref={fileInput} type="file" multiple hidden accept=".pdf,.txt,.png,.jpg,.jpeg" onChange={(e) => upload(e.target.files)} />
            <div
              className="grid gap-2 sm:grid-cols-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (canWrite) upload(e.dataTransfer.files);
              }}
            >
              {files.map((f) => {
                const ic = fileIcon(f.name);
                return (
                  <div key={f._id} className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${ic.color}`}>
                      <Icon name={ic.icon} size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-sm font-medium text-slate-800">{f.name}</p>
                      <p className="text-label-md font-normal text-slate-400">
                        {fileSize(f.size)} · {f.uploadedBy?.name}
                      </p>
                    </div>
                    <button className="icon-btn h-8 w-8" onClick={() => download(`/documents/${f._id}/download`, f.name)} title="Tải xuống">
                      <Icon name="download" size={18} />
                    </button>
                  </div>
                );
              })}
              {!files.length && <p className="text-body-sm text-slate-400">Kéo thả tệp vào đây · PDF, TXT, PNG, JPG – tối đa 10MB</p>}
            </div>
          </Section>

          <div>
            <div className="mb-3 flex gap-5 border-b border-slate-200">
              <button className={`tab ${tab === 'comments' ? 'tab-active' : ''}`} onClick={() => setTab('comments')}>
                Bình luận ({comments.length})
              </button>
              <button className={`tab ${tab === 'activity' ? 'tab-active' : ''}`} onClick={() => setTab('activity')}>
                Hoạt động
              </button>
            </div>
            {tab === 'comments' ? (
              <div className="space-y-4">
                {comments.map((c) => (
                  <div key={c._id} className="flex gap-3">
                    <Avatar user={c.author} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-body-sm">
                        <span className="font-semibold text-slate-900">{c.author?.name}</span>
                        <span className="text-label-md font-normal text-slate-400">
                          {timeAgo(c.createdAt)}
                          {c.editedAt && ' · đã sửa'}
                        </span>
                        {c.author?._id === me?._id && editing !== c._id && (
                          <span className="ml-auto flex gap-2 text-label-md">
                            <button className="text-slate-400 hover:text-blue-600" onClick={() => setEditing(c._id)}>
                              Sửa
                            </button>
                            <button
                              className="text-slate-400 hover:text-rose-600"
                              onClick={async () => {
                                await api.del(`/comments/${c._id}`);
                                setComments((cs) => cs.filter((x) => x._id !== c._id));
                              }}
                            >
                              Xóa
                            </button>
                          </span>
                        )}
                      </div>
                      {editing === c._id ? (
                        <div className="mt-1">
                          <CommentBox members={members} initial={c.body} autoFocus onCancel={() => setEditing(null)} onSend={(b) => updateComment(c._id, b)} />
                        </div>
                      ) : (
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-body-sm text-slate-700">{renderBody(c.body)}</p>
                      )}
                    </div>
                  </div>
                ))}
                {access.canWrite && <CommentBox members={members} onSend={sendComment} />}
              </div>
            ) : (
              <div className="space-y-3">
                {activity.map((a) => (
                  <div key={a._id} className="flex items-start gap-3 text-body-sm">
                    <Avatar user={a.actor} size={24} />
                    <p className="flex-1 text-slate-600">
                      <span className="font-semibold text-slate-800">{a.actor?.name}</span> {a.action.toLowerCase()}
                      {a.before != null && a.after != null && (
                        <>
                          : <span className="text-slate-400 line-through">{String(a.before)}</span> → <span className="font-semibold text-slate-800">{String(a.after)}</span>
                        </>
                      )}
                      <span className="block text-label-md font-normal text-slate-400">{fmtDateTime(a.createdAt)}</span>
                    </p>
                  </div>
                ))}
                {!activity.length && <p className="text-body-sm text-slate-400">Chưa có hoạt động</p>}
              </div>
            )}
          </div>
        </div>

        {/* Cột thuộc tính */}
        <aside className="scroll-thin space-y-4 overflow-y-auto border-l border-slate-100 bg-slate-50/60 px-5 py-5">
          <p className="section-label">Chi tiết thuộc tính</p>
          <Prop label="Người nhận">
            {canWrite ? <MemberPicker members={members} value={form.assignee} onChange={(v) => setF('assignee', v)} /> : <PersonLine user={task.assignee} />}
          </Prop>
          <Prop label="Người tạo">
            <PersonLine user={task.creator} />
          </Prop>
          <Prop label="Hạn chót">
            {canWrite ? <input type="date" className="input h-9" value={form.dueDate} onChange={(e) => setF('dueDate', e.target.value)} /> : <span>{task.dueDate ? fmtDate(task.dueDate, { year: true }) : 'Chưa đặt hạn'}</span>}
            {due && due.tone === 'danger' && <span className="mt-1 inline-block rounded-md bg-rose-100 px-2 py-0.5 text-label-sm text-rose-700">{due.text}</span>}
          </Prop>
          <Prop label="Độ ưu tiên">
            <div className="grid grid-cols-3 rounded-lg bg-slate-100 p-0.5">
              {['low', 'medium', 'high'].map((p) => (
                <button key={p} disabled={!canWrite} onClick={() => setF('priority', p)} className={`rounded-md py-1 text-label-md ${form.priority === p ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                  {PRIORITY[p].label}
                </button>
              ))}
            </div>
          </Prop>
          <Prop label="Ước lượng thời gian">
            <div className="flex items-center gap-2">
              <input type="number" min="0" disabled={!canWrite} className="input h-9" value={form.estimateHours} onChange={(e) => setF('estimateHours', e.target.value)} placeholder="Giờ" />
              <span className="text-body-sm text-slate-400">/</span>
              <input type="number" min="0" disabled={!canWrite} className="input h-9" value={form.spentHours} onChange={(e) => setF('spentHours', e.target.value)} title="Đã làm" />
            </div>
            {Number(form.estimateHours) > 0 && <Progress value={(Number(form.spentHours) / Number(form.estimateHours)) * 100} className="mt-2" />}
            <p className="mt-1 text-label-md font-normal text-slate-400">Ước lượng / Đã làm (giờ)</p>
          </Prop>
          <Prop label="Giờ còn lại">
            <input aria-label="Giờ còn lại" type="number" min="0" max="1000" disabled={!access.canUpdateProgress} className="input h-9" value={form.remainingHours} onChange={(e) => setF('remainingHours', e.target.value)} placeholder="Chưa ước lượng" />
            {!canWrite && access.canUpdateProgress && <button className="btn-outline btn-sm mt-2" disabled={saving || !dirty} onClick={async () => {
              setSaving(true);
              try { await patch({ remainingHours: form.remainingHours === '' ? null : Number(form.remainingHours) }); await load(); toast('Đã cập nhật giờ còn lại'); }
              catch { /* patch hiển thị lỗi */ }
              finally { setSaving(false); }
            }}>Lưu giờ còn lại</button>}
          </Prop>
          <Prop label="Nhãn">
            <div className="flex flex-wrap gap-1.5">
              {form.labels.map((l) => (
                <span key={l} className="chip border-slate-200 bg-white text-slate-600">
                  {l}
                  {canWrite && (
                    <button onClick={() => setF('labels', form.labels.filter((x) => x !== l))}>
                      <Icon name="close" size={12} />
                    </button>
                  )}
                </span>
              ))}
              {canWrite && (
                <input
                  className="input h-[22px] w-24 rounded-md px-2 text-label-md"
                  placeholder="+ Nhãn"
                  onKeyDown={(e) => {
                    const v = e.currentTarget.value.trim();
                    if (e.key === 'Enter' && v) {
                      if (!form.labels.includes(v)) setF('labels', [...form.labels, v]);
                      e.currentTarget.value = '';
                    }
                  }}
                />
              )}
            </div>
          </Prop>
          {task.sprint && (
            <Prop label="Sprint">
              <span className="rounded-md bg-blue-50 px-2 py-0.5 text-label-md text-blue-700">{task.sprint}</span>
            </Prop>
          )}
          <Prop label="Dự án">
            <span className="text-body-sm font-semibold text-blue-700">{info?.project?.name}</span>
          </Prop>
          {openBlockers.length > 0 && (
            <div className="rounded-xl border border-purple-200 bg-purple-50 p-3">
              <p className="flex items-center gap-1.5 text-label-md font-semibold text-purple-700">
                <Icon name="auto_awesome" size={16} /> Gợi ý từ Trợ lý AI
              </p>
              <p className="mt-1 text-body-sm text-purple-800">
                Công việc có nguy cơ trễ vì đang bị chặn bởi {openBlockers.map((b) => b.key).join(', ')}.
              </p>
              <Link to="/risks" onClick={onClose} className="mt-1 inline-block text-label-md font-semibold text-purple-700 underline">
                Xem giải thích chi tiết
              </Link>
            </div>
          )}
        </aside>
      </div>

      <div className="flex items-center gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-3 text-label-md font-normal text-slate-500">
        <span>
          Tạo lúc {fmtDate(task.createdAt)} bởi {task.creator?.name || '—'} · Cập nhật {timeAgo(task.updatedAt)}
        </span>
        {canWrite && (
          <span className="ml-auto flex gap-2">
            <button className="btn-outline" onClick={load} disabled={!dirty}>
              Hủy
            </button>
            <button className="btn-primary" onClick={save} disabled={!dirty || saving}>
              {saving && <Spinner />}
              Lưu thay đổi
            </button>
          </span>
        )}
      </div>
      <Confirm open={!!confirmDel} title="Xóa công việc cha?" danger confirmText="Xóa tất cả" onClose={() => setConfirmDel(null)} onConfirm={() => (setConfirmDel(null), remove(true))}>
        {confirmDel}
      </Confirm>
    </Shell>
  );
}

const Prop = ({ label, children }) => (
  <div>
    <p className="mb-1 text-label-md font-normal text-slate-500">{label}</p>
    {children}
  </div>
);

const PersonLine = ({ user }) => (
  <span className="flex items-center gap-2 text-body-sm text-slate-800">
    <Avatar user={user} size={22} />
    {user?.name || 'Chưa giao'}
  </span>
);

function Shell({ children, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Chi tiết công việc" className="animate-slide-in flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop">{children}</div>
    </div>
  );
}
