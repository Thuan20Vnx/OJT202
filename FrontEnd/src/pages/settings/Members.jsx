import { useState } from 'react';
import { Avatar, Confirm, Dropdown, ErrorBox, Field, Icon, MenuItem, Modal, Notice, PageLoader, Select, Spinner, StatCard } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useApp, useLoad, useToast } from '../../lib/app.jsx';
import { PROJECT_COLOR, ROLE, timeAgo } from '../../lib/format.js';
import { invalidateProject } from '../../lib/hooks.js';

const ROLE_CHIP = {
  owner: 'border-purple-200 bg-purple-50 text-purple-700',
  admin: 'border-blue-200 bg-blue-50 text-blue-700',
  member: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  viewer: 'border-slate-200 bg-slate-50 text-slate-600',
};

const MATRIX = [
  ['Quản lý thành viên', [1, 1, 0, 0]],
  ['Tạo dự án', [1, 1, 1, 0]],
  ['Tạo & giao việc', [1, 1, 1, 0]],
  ['Kéo thả Kanban', [1, 1, 1, 0]],
  ['Bình luận', [1, 1, 1, 0]],
  ['Chỉ xem', [1, 1, 1, 1]],
];

export function InviteModal({ open, onClose, onDone }) {
  const { ws, role, projects } = useApp();
  const toast = useToast();
  const [emails, setEmails] = useState([]);
  const [input, setInput] = useState('');
  const [inviteRole, setRole] = useState('member');
  const [sel, setSel] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const add = () => {
    const v = input.trim().replace(/,$/, '');
    if (!v) return;
    if (!/^\S+@\S+\.\S+$/.test(v)) return setErr(`“${v}” không phải email hợp lệ`);
    if (!emails.includes(v)) setEmails([...emails, v]);
    setInput('');
    setErr('');
  };
  const submit = async () => {
    setBusy(true);
    try {
      const d = await api.post(`/workspaces/${ws.workspace._id}/invites`, { emails, role: inviteRole, projects: sel });
      toast(`Đã gửi ${d.created.length} lời mời${d.skipped.length ? `, bỏ qua ${d.skipped.length} (đã là thành viên)` : ''}`);
      setEmails([]);
      setSel([]);
      onDone?.();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mời thành viên vào Workspace"
      subtitle={`Gửi lời mời tham gia ${ws.workspace.name}`}
      icon="person_add"
      footer={
        <>
          <span className="mr-auto text-label-md font-normal text-slate-400">Đã chọn {emails.length} email</span>
          <button className="btn-outline" onClick={onClose}>
            Hủy
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy || !emails.length}>
            {busy ? <Spinner /> : <Icon name="send" size={16} />}
            Gửi lời mời
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Địa chỉ email thành viên" required error={err}>
          <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 focus-within:border-blue-600">
            {emails.map((e) => (
              <span key={e} className="chip border-blue-200 bg-blue-50 text-blue-700">
                {e}
                <button onClick={() => setEmails(emails.filter((x) => x !== e))}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
            <input className="min-w-[160px] flex-1 border-0 p-0 text-body-sm focus:ring-0" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ',') && (e.preventDefault(), add())} onBlur={add} placeholder="Nhập email rồi nhấn Enter..." />
          </div>
        </Field>
        <div>
          <span className="label">Vai trò mặc định trong Workspace</span>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['member', 'Thành viên (Member)', 'Được tạo & nhận việc, kéo thả Kanban, bình luận và tải tài liệu.'],
              ['viewer', 'Khách xem (Viewer)', 'Chỉ có quyền xem nội dung, không thể chỉnh sửa hay kéo thả.'],
              ...(role === 'owner' ? [['admin', 'Quản trị (Admin)', 'Quản lý thành viên, dự án và cài đặt workspace.']] : []),
            ].map(([v, t, d]) => (
              <button key={v} type="button" onClick={() => setRole(v)} className={`rounded-xl border p-3 text-left ${inviteRole === v ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-slate-200 hover:bg-slate-50'}`}>
                <p className="flex items-center justify-between text-label-lg font-semibold text-slate-900">
                  {t} {inviteRole === v && <Icon name="check_circle" size={18} fill className="text-blue-600" />}
                </p>
                <p className="mt-0.5 text-label-md font-normal text-slate-500">{d}</p>
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="label">Chỉ định dự án tham gia ngay</span>
          <div className="space-y-1.5 rounded-lg border border-slate-200 p-2.5">
            {projects
              .filter((p) => p.status === 'active')
              .map((p) => (
                <label key={p._id} className="flex items-center gap-2 text-body-sm">
                  <input type="checkbox" className="form-checkbox rounded text-blue-600" checked={sel.includes(p._id)} onChange={() => setSel(sel.includes(p._id) ? sel.filter((x) => x !== p._id) : [...sel, p._id])} />
                  <span className={`h-2 w-2 rounded-full ${PROJECT_COLOR[p.color]}`} />
                  {p.name}
                </label>
              ))}
          </div>
        </div>
        <Notice tone="warn">Lưu ý: Lời mời sẽ tự động hết hạn sau 72 giờ kể từ khi gửi email.</Notice>
      </div>
    </Modal>
  );
}

export default function Members() {
  const { ws, role, me, reloadWorkspace } = useApp();
  const toast = useToast();
  const isAdmin = ['owner', 'admin'].includes(role);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState(null);
  const { data, error, loading, reload } = useLoad(() => api.get(`/workspaces/${ws.workspace._id}/members`), [ws.workspace._id]);
  if (loading && !data) return <PageLoader />;
  const members = data?.members || [];
  const owners = members.filter((m) => m.role === 'owner').length;
  const list = members.filter((m) => (!roleFilter || m.role === roleFilter) && (m.user.name + m.user.email).toLowerCase().includes(search.toLowerCase()));
  const count = (r) => members.filter((m) => m.role === r).length;

  const changeRole = async (m, r) => {
    try {
      await api.patch(`/workspaces/${ws.workspace._id}/members/${m.user._id}`, { role: r });
      toast(`Đã đổi vai trò ${m.user.name} thành ${ROLE[r]}`);
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const removeFromProject = async (m, p) => {
    try {
      const full = await api.get(`/projects/${p._id}`);
      await api.patch(`/projects/${p._id}`, { members: full.project.members.map((x) => x._id).filter((id) => id !== m.user._id) });
      invalidateProject(p._id);
      toast(`Đã gỡ ${m.user.name} khỏi ${p.name}`);
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const remove = async () => {
    try {
      await api.del(`/workspaces/${ws.workspace._id}/members/${removing.user._id}`);
      toast(`Đã thu hồi quyền của ${removing.user.name} (hiệu lực ngay)`);
      setRemoving(null);
      reload();
      reloadWorkspace();
    } catch (e) {
      toast(e.message, 'error');
      setRemoving(null);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Tổng thành viên" value={`${members.length}/20`} icon="group" />
          <StatCard label="Owner / Admin" value={count('owner') + count('admin')} icon="shield_person" tone="purple" />
          <StatCard label="Member" value={count('member')} icon="person" tone="green" />
          <StatCard label="Viewer" value={count('viewer')} icon="visibility" tone="slate" />
        </div>
        <ErrorBox error={error} onRetry={reload} />
        <div className="card">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <div className="relative flex-1">
              <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input h-9 pl-8 text-body-sm" placeholder="Tìm theo tên hoặc email" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select className="input h-9 w-auto text-body-sm" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">Mọi vai trò</option>
              {Object.entries(ROLE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            {isAdmin && (
              <button className="btn-primary" onClick={() => setInviting(true)}>
                <Icon name="person_add" size={16} /> Mời thành viên
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-100">
                <tr>
                  <th className="table-th">Thành viên</th>
                  <th className="table-th">Vai trò</th>
                  <th className="table-th">Dự án được gán</th>
                  <th className="table-th">Hoạt động gần nhất</th>
                  {isAdmin && <th className="table-th text-right">Thao tác</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((m) => {
                  const lastOwner = m.role === 'owner' && owners <= 1;
                  const canEditRole = isAdmin && (role === 'owner' || !['owner', 'admin'].includes(m.role));
                  return (
                    <tr key={m._id} className="hover:bg-slate-50">
                      <td className="table-td">
                        <div className="flex items-center gap-2.5">
                          <Avatar user={m.user} size={32} />
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900">
                              {m.user.name} {m.user._id === me._id && <span className="font-normal text-slate-400">(bạn)</span>}
                            </p>
                            <p className="truncate text-label-md font-normal text-slate-500">{m.user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="table-td">
                        {canEditRole && !lastOwner ? (
                          <Select className={`input h-8 w-36 py-0 text-label-md font-semibold ${ROLE_CHIP[m.role]}`} value={m.role} onChange={(e) => changeRole(m, e.target.value)}>
                            {(role === 'owner' ? ['owner', 'admin', 'member', 'viewer'] : ['member', 'viewer']).map((r) => (
                              <option key={r} value={r}>
                                {ROLE[r]}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <span className={`chip ${ROLE_CHIP[m.role]}`} title={lastOwner ? 'Không thể xóa hoặc hạ quyền Owner cuối cùng' : ''}>
                            {lastOwner && <Icon name="lock" size={12} />}
                            {ROLE[m.role]}
                          </span>
                        )}
                        {m.title && <p className="mt-0.5 text-label-md font-normal text-slate-400">{m.title}</p>}
                      </td>
                      <td className="table-td">
                        <div className="flex flex-wrap gap-1">
                          {m.projects.map((p) => (
                            <span key={p._id} className="chip border-slate-200 bg-white text-slate-600">
                              <span className={`h-1.5 w-1.5 rounded-full ${PROJECT_COLOR[p.color]}`} />
                              {p.name}
                            </span>
                          ))}
                          {!m.projects.length && <span className="text-slate-300">—</span>}
                        </div>
                      </td>
                      <td className="table-td whitespace-nowrap text-slate-500">{m.lastActiveAt ? timeAgo(m.lastActiveAt) : 'Chưa đăng nhập'}</td>
                      {isAdmin && (
                        <td className="table-td text-right">
                          {lastOwner || !canEditRole ? (
                            <span className="text-label-md font-normal text-slate-400" title="Không thể xóa Owner cuối cùng">
                              <Icon name="lock" size={16} />
                            </span>
                          ) : (
                            <Dropdown trigger={<button className="icon-btn h-8 w-8"><Icon name="more_vert" /></button>}>
                              {m.projects.map((p) => (
                                <MenuItem key={p._id} icon="folder_off" onClick={() => removeFromProject(m, p)}>
                                  Gỡ khỏi {p.name}
                                </MenuItem>
                              ))}
                              <MenuItem icon="person_remove" danger disabled={m.user._id === me._id} onClick={() => setRemoving(m)}>
                                Thu hồi quyền (hiệu lực ngay)
                              </MenuItem>
                            </Dropdown>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="card h-fit p-4">
        <p className="section-label mb-3">Ma trận quyền</p>
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-label-sm text-slate-400">
              <th className="pb-2 text-left font-semibold" />
              {['Owner', 'Admin', 'Member', 'Viewer'].map((r) => (
                <th key={r} className="pb-2 font-semibold">
                  {r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX.map(([label, v]) => (
              <tr key={label} className="border-t border-slate-100">
                <td className="py-2 text-slate-700">{label}</td>
                {v.map((ok, i) => (
                  <td key={i} className="text-center">
                    {ok ? <Icon name="check_circle" size={16} fill className="text-emerald-500" /> : <Icon name="remove" size={16} className="text-slate-300" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-label-md font-normal text-blue-800">Lưu ý: Quyền Owner không thể bị xóa nếu là Owner cuối cùng. Thu hồi quyền có hiệu lực ngay lập tức.</p>
      </div>
      <InviteModal open={inviting} onClose={() => setInviting(false)} onDone={reload} />
      <Confirm open={!!removing} danger title="Thu hồi quyền truy cập?" confirmText="Thu hồi quyền" onClose={() => setRemoving(null)} onConfirm={remove}>
        {removing?.user.name} sẽ bị gỡ khỏi workspace và mọi dự án, mất quyền truy cập ngay lập tức. Các công việc đang giao sẽ chuyển về Chưa giao; lịch sử được giữ lại. Nếu là PM, người này cũng được gỡ khỏi vai trò PM.
      </Confirm>
    </div>
  );
}
