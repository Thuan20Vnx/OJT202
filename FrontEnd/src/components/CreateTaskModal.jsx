import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp, useToast } from '../lib/app.jsx';
import { PRIORITY, STATUS, STATUS_ORDER } from '../lib/format.js';
import { useProjectInfo } from '../lib/hooks.js';
import { Avatar, Field, Icon, Modal, Select, Spinner } from './ui.jsx';

const empty = (status = 'todo') => ({
  title: '',
  description: '',
  acceptanceCriteria: [],
  subtasks: [],
  status,
  assignee: '',
  dueDate: '',
  priority: 'medium',
  estimateHours: '',
  labels: [],
});

export function MemberPicker({ members = [], value, onChange, placeholder = 'Chưa giao', allowEmpty = true }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const sel = members.find((m) => m._id === value);
  const list = members.filter((m) => m.role !== 'viewer' && m.projectRole !== 'viewer' && m.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-label="Chọn người nhận" onClick={() => setOpen((o) => !o)} className="input flex items-center justify-between gap-2 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <Avatar user={sel} size={22} />
          <span className={`truncate ${sel ? 'text-slate-800' : 'text-slate-400'}`}>{sel ? sel.name : placeholder}</span>
        </span>
        <Icon name="expand_more" className="text-slate-400" />
      </button>
      {open && (
        <div className="animate-slide-in absolute left-0 right-0 z-50 mt-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-pop">
          <div className="relative mb-1">
            <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input autoFocus className="input h-8 pl-8 text-body-sm" placeholder="Tìm thành viên..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="scroll-thin max-h-56 overflow-y-auto">
            {allowEmpty && (
              <button type="button" onClick={() => (onChange(''), setOpen(false))} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-body-sm text-slate-500 hover:bg-slate-50">
                <Avatar user={null} size={22} /> Chưa giao
              </button>
            )}
            {list.map((m) => (
              <button
                type="button"
                key={m._id}
                onClick={() => (onChange(m._id), setOpen(false))}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-body-sm hover:bg-slate-50 ${m._id === value ? 'bg-blue-50' : ''}`}
              >
                <Avatar user={m} size={22} />
                <span className="flex-1 truncate text-slate-800">{m.name}</span>
                <span className="text-label-sm text-slate-400">{m.jobTitle}</span>
              </button>
            ))}
          </div>
          <p className="mt-1 border-t border-slate-100 px-2 pt-1.5 text-label-md font-normal text-slate-400">Chỉ thành viên của dự án mới được giao</p>
        </div>
      )}
    </div>
  );
}

export default function CreateTaskModal({ open, onClose, defaultStatus, projectId: forcedProject, onCreated }) {
  const { project, me } = useApp();
  const pid = forcedProject || project?._id;
  const info = useProjectInfo(open ? pid : null);
  const toast = useToast();
  const [f, setF] = useState(empty(defaultStatus));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [newCrit, setNewCrit] = useState('');
  const [newSub, setNewSub] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const files = useRef(null);
  const [picked, setPicked] = useState([]);

  useEffect(() => {
    if (open) {
      setF(empty(defaultStatus));
      setErrors({});
      setPicked([]);
    }
  }, [open, defaultStatus]);

  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));

  const submit = async () => {
    if (!f.title.trim()) return setErrors({ title: 'Vui lòng nhập tên công việc' });
    setBusy(true);
    setErrors({});
    try {
      const { task } = await api.post(`/projects/${pid}/tasks`, {
        title: f.title,
        description: f.description,
        acceptanceCriteria: f.acceptanceCriteria,
        status: f.status,
        priority: f.priority,
        assignee: f.assignee || null,
        dueDate: f.dueDate || null, // để trống => không có hạn chót
        estimateHours: f.estimateHours === '' ? null : Number(f.estimateHours),
        labels: f.labels,
      });
      for (const title of f.subtasks) await api.post(`/projects/${pid}/tasks`, { title, parent: task._id, assignee: f.assignee || null });
      if (picked.length) {
        const fd = new FormData();
        picked.forEach((p) => fd.append('files', p));
        fd.append('task', task._id);
        await api.upload(`/projects/${pid}/documents/upload`, fd).catch((e) => toast(e.message, 'error'));
      }
      toast(`Đã tạo ${task.key}`);
      onCreated?.(task);
      if (more) {
        setF(empty(f.status));
        setPicked([]);
      } else onClose();
    } catch (e) {
      setErrors(e.fields || {});
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const members = info?.project?.members || [];
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-5xl"
      bodyClass="p-0"
      title={
        <span className="flex items-center gap-2">
          Tạo công việc mới <span className="rounded-md bg-blue-100 px-1.5 py-0.5 text-label-sm text-blue-700">Mới</span>
        </span>
      }
      subtitle={`${info?.project?.name || project?.name || ''} · cột ${STATUS[f.status].label}`}
      footer={
        <>
          <label className="mr-auto flex items-center gap-2 text-body-sm text-slate-600">
            <input type="checkbox" className="form-checkbox rounded text-blue-600" checked={more} onChange={(e) => setMore(e.target.checked)} />
            Tạo tiếp công việc khác
          </label>
          <button className="btn-outline" onClick={onClose}>
            Hủy
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <Icon name="add" size={16} />}
            Tạo công việc
          </button>
        </>
      }
    >
      <div className="grid md:grid-cols-[1fr_320px]">
        <div className="space-y-5 p-5">
          <Field label="Tên công việc" required error={errors.title}>
            <input autoFocus className={`input ${errors.title ? 'input-error' : ''}`} value={f.title} onChange={set('title')} placeholder="Ví dụ: Thiết kế màn hình Thông báo" maxLength={200} />
          </Field>
          <Field label="Mô tả">
            <textarea className="textarea min-h-[110px]" value={f.description} onChange={set('description')} placeholder="Nhập mô tả chi tiết yêu cầu, ngữ cảnh kỹ thuật hoặc mục tiêu công việc..." />
          </Field>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="label mb-0 flex items-center gap-1.5">
                <Icon name="verified" size={16} className="text-emerald-500" />
                Tiêu chí nghiệm thu
              </span>
            </div>
            <div className="space-y-1.5">
              {f.acceptanceCriteria.map((c, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-body-sm">
                  <Icon name="check_circle" size={16} className="text-emerald-500" />
                  <span className="flex-1">{c}</span>
                  <button className="text-slate-400 hover:text-rose-500" onClick={() => set('acceptanceCriteria')(f.acceptanceCriteria.filter((_, j) => j !== i))}>
                    <Icon name="close" size={16} />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input className="input h-9" placeholder="Thêm tiêu chí rồi nhấn Enter" value={newCrit} onChange={(e) => setNewCrit(e.target.value)} onKeyDown={(e) => {
                  if (e.key === 'Enter' && newCrit.trim()) {
                    set('acceptanceCriteria')([...f.acceptanceCriteria, newCrit.trim()]);
                    setNewCrit('');
                  }
                }} />
              </div>
            </div>
          </div>
          <div>
            <span className="label flex items-center gap-1.5">
              <Icon name="account_tree" size={16} className="text-blue-600" />
              Công việc con (tùy chọn)
            </span>
            <div className="space-y-1.5">
              {f.subtasks.map((s, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-body-sm">
                  <span className="h-4 w-4 rounded border border-slate-300" />
                  <span className="flex-1">{s}</span>
                  <button className="text-slate-400 hover:text-rose-500" onClick={() => set('subtasks')(f.subtasks.filter((_, j) => j !== i))}>
                    <Icon name="delete" size={16} />
                  </button>
                </div>
              ))}
              <input className="input h-9" placeholder="+ Thêm công việc con rồi nhấn Enter" value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => {
                if (e.key === 'Enter' && newSub.trim()) {
                  set('subtasks')([...f.subtasks, newSub.trim()]);
                  setNewSub('');
                }
              }} />
            </div>
          </div>
          <div>
            <span className="label flex items-center gap-1.5">
              <Icon name="attach_file" size={16} />
              Tệp đính kèm
            </span>
            <button type="button" onClick={() => files.current?.click()} className="flex w-full flex-col items-center rounded-xl border-2 border-dashed border-slate-200 px-4 py-5 text-body-sm text-slate-500 hover:border-blue-300 hover:bg-blue-50/40">
              <Icon name="cloud_upload" size={26} className="text-slate-400" />
              <span>
                Kéo thả hoặc <span className="font-semibold text-blue-600">duyệt tệp</span> từ máy tính
              </span>
              <span className="text-label-md font-normal text-slate-400">PDF, TXT, PNG, JPG – tối đa 10MB</span>
            </button>
            <input ref={files} type="file" multiple hidden accept=".pdf,.txt,.png,.jpg,.jpeg" onChange={(e) => setPicked([...e.target.files])} />
            {picked.map((p) => (
              <p key={p.name} className="mt-1 text-body-sm text-slate-600">
                <Icon name="description" size={14} /> {p.name}
              </p>
            ))}
          </div>
        </div>
        <div className="space-y-4 border-l border-slate-100 bg-slate-50/60 p-5">
          <p className="section-label">Chi tiết thuộc tính</p>
          <Field label="Trạng thái">
            <Select className="input" value={f.status} onChange={set('status')}>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS[s].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Người nhận" error={errors.assignee}>
            <MemberPicker members={members} value={f.assignee} onChange={set('assignee')} />
          </Field>
          <Field label="Hạn chót" hint="Không đặt hạn thì công việc sẽ không có hạn chót">
            <input type="date" className="input" value={f.dueDate} onChange={set('dueDate')} />
          </Field>
          <div>
            <span className="label">Mức độ ưu tiên</span>
            <div className="grid grid-cols-3 rounded-lg bg-slate-100 p-0.5">
              {['low', 'medium', 'high'].map((p) => (
                <button key={p} type="button" onClick={() => set('priority')(p)} className={`rounded-md py-1.5 text-label-md ${f.priority === p ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                  {PRIORITY[p].label}
                </button>
              ))}
            </div>
          </div>
          <Field label="Giờ ước lượng">
            <input type="number" min="0" className="input" value={f.estimateHours} onChange={set('estimateHours')} placeholder="vd 8" />
          </Field>
          <div>
            <span className="label">Nhãn</span>
            <div className="flex flex-wrap gap-1.5">
              {f.labels.map((l) => (
                <span key={l} className="chip border-slate-200 bg-white text-slate-600">
                  {l}
                  <button onClick={() => set('labels')(f.labels.filter((x) => x !== l))}>
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
              <input className="input h-[22px] w-28 rounded-md px-2 text-label-md" placeholder="+ Thêm nhãn" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => {
                if (e.key === 'Enter' && newLabel.trim()) {
                  if (!f.labels.includes(newLabel.trim())) set('labels')([...f.labels, newLabel.trim()]);
                  setNewLabel('');
                }
              }} />
            </div>
          </div>
          {info?.project?.sprint?.name && (
            <div className="flex items-center justify-between text-body-sm">
              <span className="text-slate-500">Sprint</span>
              <span className="rounded-md bg-blue-50 px-2 py-0.5 text-label-md text-blue-700">{info.project.sprint.name}</span>
            </div>
          )}
          <div className="rounded-xl border border-purple-200 bg-purple-50 p-3">
            <p className="flex items-center gap-1.5 text-label-md font-semibold text-purple-700">
              <Icon name="auto_awesome" size={16} /> Gợi ý từ Trợ lý AI
            </p>
            <p className="mt-1 text-body-sm text-purple-800">Tạo nhanh nhiều công việc từ một mục tiêu.</p>
            <Link to="/ai" onClick={onClose} className="mt-1 inline-block text-label-md font-semibold text-purple-700 underline">
              Mở Lập kế hoạch
            </Link>
          </div>
          {me && <p className="text-label-md font-normal text-slate-400">Người tạo: {me.name}</p>}
        </div>
      </div>
    </Modal>
  );
}
