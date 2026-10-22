import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar, AvatarStack, Dropdown, Empty, ErrorBox, Field, Icon, MenuItem, Modal, PageHeader, PageLoader, Progress, Spinner } from '../components/ui.jsx';
import { api, qs } from '../lib/api.js';
import { useApp, useLoad, useToast } from '../lib/app.jsx';
import { PROJECT_COLOR, fmtDate, isoDate } from '../lib/format.js';
import { invalidateProject } from '../lib/hooks.js';

const COLORS = ['blue', 'purple', 'emerald', 'amber', 'rose'];

export default function Projects() {
  const { wsId, role, setProjectId, reloadWorkspace, me } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('active');
  const [search, setSearch] = useState('');
  const [view, setView] = useState('grid');
  const [editing, setEditing] = useState(null); // null | 'new' | project
  const { data, error, loading, reload } = useLoad(() => api.get(`/workspaces/${wsId}/projects${qs({ status: tab === 'all' ? '' : tab, search })}`), [wsId, tab, search]);
  const members = useLoad(() => api.get(`/workspaces/${wsId}/members`), [wsId]);

  useEffect(() => {
    if (params.get('new')) {
      setEditing('new');
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const archive = async (p, restore) => {
    try {
      await api.post(`/projects/${p._id}/${restore ? 'restore' : 'archive'}`);
      toast(restore ? `Đã khôi phục ${p.name}` : `Đã lưu trữ ${p.name} (chỉ đọc)`);
      invalidateProject(p._id);
      reload();
      reloadWorkspace();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const open = (p) => {
    setProjectId(p._id);
    navigate('/overview');
  };
  const c = data?.counts || {};
  const canCreate = role && role !== 'viewer';

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader
        title="Dự án"
        subtitle={`${c.active ?? 0} dự án đang hoạt động · ${c.archived ?? 0} đã lưu trữ`}
        actions={
          <>
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
              {[
                ['grid', 'grid_view', 'Lưới'],
                ['list', 'view_list', 'Danh sách'],
              ].map(([v, icon, l]) => (
                <button key={v} onClick={() => setView(v)} className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-label-md ${view === v ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-500'}`}>
                  <Icon name={icon} size={16} /> {l}
                </button>
              ))}
            </div>
            {canCreate && (
              <button className="btn-primary" onClick={() => setEditing('new')}>
                <Icon name="add" size={16} /> Tạo dự án
              </button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[
          ['active', `Đang hoạt động (${c.active ?? 0})`],
          ['archived', `Đã lưu trữ (${c.archived ?? 0})`],
          ['all', 'Tất cả'],
        ].map(([v, l]) => (
          <button key={v} className={`pill-tab ${tab === v ? 'pill-tab-active' : ''}`} onClick={() => setTab(v)}>
            {l}
          </button>
        ))}
        <div className="relative ml-auto">
          <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input h-8 w-56 pl-8 text-body-sm" placeholder="Tìm dự án" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <PageLoader />
      ) : !data?.projects.length ? (
        <div className="card">
          <Empty icon="folder_open" title="Chưa có dự án" action={canCreate && <button className="btn-primary" onClick={() => setEditing('new')}>Tạo dự án</button>} />
        </div>
      ) : (
        <div className={view === 'grid' ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-3' : 'space-y-2'}>
          {data.projects.map((p) => {
            const pct = p.stats.total ? Math.round((p.stats.done / p.stats.total) * 100) : 0;
            const archived = p.status === 'archived';
            const isManager = p.manager?._id === me?._id || ['owner', 'admin'].includes(role);
            return (
              <div key={p._id} className={`card p-4 transition-shadow hover:shadow-card ${archived ? 'opacity-75' : ''} ${view === 'list' ? 'flex items-center gap-4' : ''}`}>
                <div className={view === 'list' ? 'min-w-0 flex-1' : ''}>
                  <div className="flex items-start justify-between gap-2">
                    <button className="flex min-w-0 items-center gap-2 text-left" onClick={() => open(p)}>
                      <span className={`h-3 w-3 shrink-0 rounded-full ${PROJECT_COLOR[p.color]}`} />
                      <span className="truncate text-headline-sm text-slate-900 hover:text-blue-700">{p.name}</span>
                      {archived && <span className="chip border-slate-200 bg-slate-100 text-slate-500">Chỉ đọc</span>}
                    </button>
                    {isManager && (
                      <Dropdown trigger={<button className="icon-btn h-7 w-7"><Icon name="more_horiz" /></button>}>
                        {!archived && (
                          <MenuItem icon="edit" onClick={() => setEditing(p)}>
                            Sửa dự án
                          </MenuItem>
                        )}
                        {!archived && (
                          <MenuItem icon="group" onClick={() => setEditing(p)}>
                            Quản lý thành viên
                          </MenuItem>
                        )}
                        <MenuItem icon={archived ? 'unarchive' : 'archive'} onClick={() => archive(p, archived)}>
                          {archived ? 'Khôi phục' : 'Lưu trữ'}
                        </MenuItem>
                      </Dropdown>
                    )}
                  </div>
                  {view === 'grid' && <p className="mt-1 line-clamp-2 min-h-[36px] text-body-sm text-slate-500">{p.description || 'Chưa có mô tả'}</p>}
                </div>
                <div className={view === 'list' ? 'w-64' : 'mt-3'}>
                  <div className="mb-1 flex justify-between text-label-md font-normal text-slate-500">
                    <span>
                      {pct}% · {p.stats.done}/{p.stats.total} việc
                    </span>
                    {p.stats.overdue > 0 && <span className="font-semibold text-rose-600">{p.stats.overdue} quá hạn</span>}
                  </div>
                  <Progress value={pct} tone={archived ? 'bg-slate-400' : 'bg-blue-600'} />
                </div>
                <div className={`flex items-center justify-between ${view === 'list' ? 'w-72 gap-3' : 'mt-3'}`}>
                  <span className="flex items-center gap-1 text-label-md font-normal text-slate-500">
                    <Icon name="event" size={14} />
                    {p.startDate ? fmtDate(p.startDate) : '—'} – {p.endDate ? fmtDate(p.endDate, { year: true }) : '—'}
                  </span>
                  <AvatarStack users={p.members} max={3} size={24} />
                </div>
                {view === 'grid' && p.manager && (
                  <p className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2 text-label-md font-normal text-slate-500">
                    <Avatar user={p.manager} size={18} /> Quản lý: {p.manager.name}
                  </p>
                )}
                {archived && isManager && (
                  <button className="btn-outline btn-sm mt-3 w-full" onClick={() => archive(p, true)}>
                    <Icon name="unarchive" size={16} /> Khôi phục
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <ProjectModal
        open={!!editing}
        project={editing === 'new' ? null : editing}
        members={(members.data?.members || []).map((m) => ({ ...m.user, role: m.role }))}
        meId={me?._id}
        wsId={wsId}
        onClose={() => setEditing(null)}
        onSaved={async (p) => {
          invalidateProject(p._id);
          await reloadWorkspace();
          reload();
          if (editing === 'new') setProjectId(p._id);
        }}
      />
    </div>
  );
}

function ProjectModal({ open, project, members, meId, wsId, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(
      project
        ? { name: project.name, description: project.description, color: project.color, startDate: isoDate(project.startDate), endDate: isoDate(project.endDate), members: project.members.map((m) => m._id) }
        : { name: '', description: '', color: 'blue', startDate: '', endDate: '', members: meId ? [meId] : [] },
    );
  }, [open, project, meId]);
  const dateError = f.startDate && f.endDate && f.endDate < f.startDate ? 'Ngày kết thúc không được trước ngày bắt đầu' : '';
  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const body = { ...f, startDate: f.startDate || null, endDate: f.endDate || null };
      const { project: p } = project ? await api.patch(`/projects/${project._id}`, body) : await api.post(`/workspaces/${wsId}/projects`, body);
      toast(project ? 'Đã cập nhật dự án' : `Đã tạo dự án ${p.name}`);
      await onSaved(p);
      onClose();
    } catch (e) {
      setErrors(e.fields || {});
      if (!Object.keys(e.fields || {}).length) toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id) => setF((s) => ({ ...s, members: s.members.includes(id) ? s.members.filter((x) => x !== id) : [...s.members, id] }));
  const sel = members.filter((m) => f.members?.includes(m._id));
  const options = members.filter((m) => !f.members?.includes(m._id) && m.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? 'Sửa dự án' : 'Tạo dự án mới'}
      icon="create_new_folder"
      footer={
        <>
          <button className="btn-outline" onClick={onClose}>
            Hủy
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy || !f.name?.trim() || !!dateError}>
            {busy && <Spinner />}
            {project ? 'Lưu thay đổi' : 'Tạo dự án'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tên dự án" required error={errors.name}>
          <input className="input" value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Hệ thống CRM Khách hàng" />
        </Field>
        <Field label="Mô tả dự án">
          <textarea className="textarea" rows={2} value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Mô tả ngắn gọn mục tiêu của dự án..." />
        </Field>
        <div>
          <span className="label">Màu nhận diện</span>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setF({ ...f, color: c })} className={`flex h-7 w-7 items-center justify-center rounded-full ${PROJECT_COLOR[c]} ${f.color === c ? 'ring-2 ring-slate-900 ring-offset-2' : ''}`}>
                {f.color === c && <Icon name="check" size={16} className="text-white" />}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ngày bắt đầu">
            <input type="date" className="input" value={f.startDate || ''} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </Field>
          <Field label="Ngày kết thúc" error={dateError || errors.endDate}>
            <input type="date" className={`input ${dateError ? 'input-error' : ''}`} value={f.endDate || ''} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </Field>
        </div>
        <div>
          <span className="label">Thành viên được gán</span>
          <div className="rounded-lg border border-slate-200 p-2">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {sel.map((m) => (
                <span key={m._id} className="chip h-7 border-slate-200 bg-slate-50 pl-1 text-slate-700">
                  <Avatar user={m} size={20} /> {m.name}
                  <button onClick={() => toggle(m._id)}>
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
            </div>
            <input className="input h-8 text-body-sm" placeholder="+ Thêm thành viên..." value={q} onChange={(e) => setQ(e.target.value)} />
            {q && (
              <div className="mt-1 max-h-40 overflow-y-auto">
                {options.map((m) => (
                  <button key={m._id} onClick={() => (toggle(m._id), setQ(''))} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-body-sm hover:bg-slate-50">
                    <Avatar user={m} size={20} /> {m.name} <span className="text-label-sm text-slate-400">{m.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-label-md font-normal text-slate-500">
            <Icon name="lock" size={14} /> Chỉ thành viên được gán mới có thể xem và truy cập dự án này.
          </p>
        </div>
      </div>
    </Modal>
  );
}
