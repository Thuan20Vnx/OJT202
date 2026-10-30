import { t as tr, useI18n } from '../lib/i18n.js';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar, AvatarStack, Dropdown, Empty, ErrorBox, Field, Icon, MenuItem, Modal, PageHeader, PageLoader, Progress, Spinner } from '../components/ui.jsx';
import { api, qs } from '../lib/api.js';
import { useApp, useLoad, useToast } from '../lib/app.jsx';
import { PROJECT_COLOR } from '../lib/format.js';
import { dates } from '../lib/dates.js';
const isoDate = (d) => (d ? dates.dateKey(d) : '');
const fmtDate = (d) => (d ? dates.zoned(d).toLocaleDateString('vi-VN') : '');
import { invalidateProject } from '../lib/hooks.js';

const COLORS = ['blue', 'purple', 'emerald', 'amber', 'rose'];

export default function Projects() {
  useI18n();
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
      toast(restore ? tr("Đã khôi phục {0}", [p.name]) : tr("Đã lưu trữ {0} (chỉ đọc)", [p.name]));
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
  const canCreate = ['owner', 'admin'].includes(role);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader
        title={tr("Dự án")}
        subtitle={tr("{0} dự án đang hoạt động · {1} đã lưu trữ", [c.active ?? 0, c.archived ?? 0])}
        actions={
          <>
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
              {[
                ['grid', 'grid_view', tr("Lưới")],
                ['list', 'view_list', tr("Danh sách")],
              ].map(([v, icon, l]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-label-md ${view === v ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-500'}`}
                >
                  <Icon name={icon} size={16} /> {l}
                </button>
              ))}
            </div>
            {canCreate && (
              <button className="btn-primary" onClick={() => setEditing('new')}>
                <Icon name="add" size={16} />{tr(" Tạo dự án")}</button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[
          ['active', tr("Đang hoạt động ({0})", [c.active ?? 0])],
          ['archived', tr("Đã lưu trữ ({0})", [c.archived ?? 0])],
          ['all', tr("Tất cả")],
        ].map(([v, l]) => (
          <button key={v} className={`pill-tab ${tab === v ? 'pill-tab-active' : ''}`} onClick={() => setTab(v)}>
            {l}
          </button>
        ))}
        <div className="relative ml-auto">
          <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input h-8 w-56 pl-8 text-body-sm" placeholder={tr("Tìm dự án")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <PageLoader />
      ) : !data?.projects.length ? (
        <div className="card">
          <Empty
            icon="folder_open"
            title={tr("Chưa có dự án")}
            action={
              canCreate && (
                <button className="btn-primary" onClick={() => setEditing('new')}>{tr("Tạo dự án")}</button>
              )
            }
          />
        </div>
      ) : (
        <div className={view === 'grid' ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-3' : 'space-y-2'}>
          {data.projects.map((p) => {
            const pct = p.stats.total ? Math.round((p.stats.done / p.stats.total) * 100) : 0;
            const archived = p.status === 'archived';
            const isManager = p.projectRole === 'pm' && role !== 'viewer';
            return (
              <div key={p._id} className={`card p-4 transition-shadow hover:shadow-card ${archived ? 'opacity-75' : ''} ${view === 'list' ? 'flex items-center gap-4' : ''}`}>
                <div className={view === 'list' ? 'min-w-0 flex-1' : ''}>
                  <div className="flex items-start justify-between gap-2">
                    <button className="flex min-w-0 items-center gap-2 text-left" onClick={() => open(p)}>
                      <span className={`h-3 w-3 shrink-0 rounded-full ${PROJECT_COLOR[p.color]}`} />
                      <span className="truncate text-headline-sm text-slate-900 hover:text-blue-700">{p.name}</span>
                      {archived && <span className="chip border-slate-200 bg-slate-100 text-slate-500">{tr("Chỉ đọc")}</span>}
                    </button>
                    {isManager && (
                      <Dropdown trigger={<button aria-label={tr("Thao tác dự án {0}", [p.name])} className="icon-btn h-7 w-7"><Icon name="more_horiz" /></button>}>
                        {!archived && (
                          <MenuItem icon="edit" onClick={() => setEditing(p)}>{tr("Sửa dự án")}</MenuItem>
                        )}
                        {!archived && (
                          <MenuItem icon="group" onClick={() => setEditing(p)}>{tr("Quản lý thành viên")}</MenuItem>
                        )}
                        <MenuItem icon={archived ? 'unarchive' : 'archive'} onClick={() => archive(p, archived)}>
                          {archived ? tr("Khôi phục") : tr("Lưu trữ")}
                        </MenuItem>
                      </Dropdown>
                    )}
                  </div>
                  {view === 'grid' && <p className="mt-1 line-clamp-2 min-h-[36px] text-body-sm text-slate-500">{p.description || tr("Chưa có mô tả")}</p>}
                </div>
                <div className={view === 'list' ? 'w-64' : 'mt-3'}>
                  <div className="mb-1 flex justify-between text-label-md font-normal text-slate-500">
                    <span>
                      {pct}% · {p.stats.done}/{p.stats.total}{tr(" việc")}</span>
                    {p.stats.overdue > 0 && <span className="font-semibold text-rose-600">{p.stats.overdue}{tr(" quá hạn")}</span>}
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
                    <Avatar user={p.manager} size={18} />{tr(" Quản lý: ")}{p.manager.name}
                  </p>
                )}
                {archived && isManager && (
                  <button className="btn-outline btn-sm mt-3 w-full" onClick={() => archive(p, true)}>
                    <Icon name="unarchive" size={16} />{tr(" Khôi phục")}</button>
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
  useI18n();
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
        ? { name: project.name, description: project.description, color: project.color, startDate: isoDate(project.startDate), endDate: isoDate(project.endDate), members: project.members.map((m) => m._id), manager: project.manager?._id, memberRoles: project.memberRoles || {} }
        : { name: '', description: '', color: 'blue', startDate: '', endDate: '', members: meId ? [meId] : [], memberRoles: {} },
    );
  }, [open, project, meId]);
  const dateError = f.startDate && f.endDate && f.endDate < f.startDate ? tr("Ngày kết thúc không được trước ngày bắt đầu") : '';
  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const body = { ...f, startDate: f.startDate || null, endDate: f.endDate || null };
      const { project: p } = project ? await api.patch(`/projects/${project._id}`, body) : await api.post(`/workspaces/${wsId}/projects`, body);
      toast(project ? tr("Đã cập nhật dự án") : tr("Đã tạo dự án {0}", [p.name]));
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
      title={project ? tr("Sửa dự án") : tr("Tạo dự án mới")}
      icon="create_new_folder"
      footer={
        <>
          <button className="btn-outline" onClick={onClose}>{tr("Hủy")}</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !f.name?.trim() || !!dateError}>
            {busy && <Spinner />}
            {project ? tr("Lưu thay đổi") : tr("Tạo dự án")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={tr("Tên dự án")} required error={errors.name}>
          <input className="input" value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={tr("Hệ thống CRM Khách hàng")} />
        </Field>
        <Field label={tr("Mô tả dự án")}>
          <textarea
            className="textarea"
            rows={2}
            value={f.description || ''}
            onChange={(e) => setF({ ...f, description: e.target.value })}
            placeholder={tr("Mô tả ngắn gọn mục tiêu của dự án...")}
          />
        </Field>
        <div>
          <span className="label">{tr("Màu nhận diện")}</span>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setF({ ...f, color: c })}
                className={`flex h-7 w-7 items-center justify-center rounded-full ${PROJECT_COLOR[c]} ${f.color === c ? 'ring-2 ring-slate-900 ring-offset-2' : ''}`}
              >
                {f.color === c && <Icon name="check" size={16} className="text-white" />}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr("Ngày bắt đầu")}>
            <input type="date" className="input" value={f.startDate || ''} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </Field>
          <Field label={tr("Ngày kết thúc")} error={dateError || errors.endDate}>
            <input type="date" className={`input ${dateError ? 'input-error' : ''}`} value={f.endDate || ''} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </Field>
        </div>
        {project && (
          <Field label={tr("Chuyển giao PM")} error={errors.manager}>
            <select className="input" value={f.manager || ''} onChange={(e) => setF({ ...f, manager: e.target.value })}>
              {sel.filter((m) => m.role !== 'viewer').map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
            </select>
            <p className="mt-1 text-body-sm text-slate-500">{tr("Chọn PM thay thế trước khi gỡ PM hiện tại. PM cũ trở thành Member sau khi lưu.")}</p>
          </Field>
        )}
        <div>
          <span className="label">{tr("Thành viên được gán")}</span>
          <div className="rounded-lg border border-slate-200 p-2">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {sel.map((m) => (
                <span key={m._id} className="chip min-h-7 h-auto border-slate-200 bg-slate-50 pl-1 text-slate-700">
                  <Avatar user={m} size={20} /> {m.name}
                  <select aria-label={tr("Vai trò dự án của {0}", [m.name])} className="rounded border-slate-200 py-0 pl-1 pr-6 text-label-sm" disabled={m.role === 'viewer' || m._id === (f.manager || meId)} value={m._id === (f.manager || meId) ? 'pm' : f.memberRoles?.[m._id] || (m.role === 'viewer' ? 'viewer' : 'member')} onChange={(e) => setF({ ...f, memberRoles: { ...f.memberRoles, [m._id]: e.target.value } })}>
                    <option value="pm">PM</option><option value="member">Member</option><option value="viewer">Viewer</option>
                  </select>
                  <button aria-label={tr("Gỡ {0} khỏi dự án", [m.name])} onClick={() => toggle(m._id)}>
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
            </div>
            <input className="input h-8 text-body-sm" placeholder={tr("+ Thêm thành viên...")} value={q} onChange={(e) => setQ(e.target.value)} />
            {q && (
              <div className="mt-1 max-h-40 overflow-y-auto">
                {options.map((m) => (
                  <button
                    key={m._id}
                    onClick={() => (toggle(m._id), setQ(''))}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-body-sm hover:bg-slate-50"
                  >
                    <Avatar user={m} size={20} /> {m.name} <span className="text-label-sm text-slate-400">{m.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-label-md font-normal text-slate-500">
            <Icon name="lock" size={14} />{tr(" Chỉ thành viên được gán mới có thể xem và truy cập dự án này.")}</p>
        </div>
      </div>
    </Modal>
  );
}
