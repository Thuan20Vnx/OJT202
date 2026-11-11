import { t as tr, useI18n } from '../../lib/i18n.js';
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

export const SPECIALTY = {
  leader: { get label() { return tr('Nhóm trưởng'); } },
  developer: { get label() { return tr('Lập trình'); } },
  tester: { get label() { return tr('Kiểm thử'); } },
  ba: { get label() { return tr('Phân tích (BA)'); } },
  designer: { get label() { return tr('Thiết kế'); } },
  devops: { get label() { return tr('DevOps'); } },
  documentation: { get label() { return tr('Tài liệu'); } },
};
const MENTOR_CHIP = 'border-amber-200 bg-amber-50 text-amber-800';
// Giảng viên có quyền Viewer cộng thêm bình luận; ô chọn gộp chung thành một lựa chọn cho dễ hiểu.
const roleValue = (m) => (m.isMentor ? 'mentor' : m.role);
const rolePayload = (value) => (value === 'mentor' ? { isMentor: true } : { role: value, isMentor: false });
const roleName = (value) => (value === 'mentor' ? tr('Giảng viên') : ROLE[value]);

/** Một người giữ nhiều vai trò chuyên môn cùng lúc; đây là nhãn công việc, không ảnh hưởng quyền. */
function SpecialtyCell({ member, editable, onChange }) {
  const chips = member.specialties.map((key) => (
    <span key={key} className="chip border-slate-200 bg-white text-slate-600">{SPECIALTY[key]?.label || key}</span>
  ));
  if (!editable) return <div className="flex flex-wrap gap-1">{chips}{!chips.length && <span className="text-slate-300">—</span>}</div>;
  return (
    <Dropdown trigger={
      <button type="button" aria-label={tr('Sửa vai trò chuyên môn của {0}', [member.user.name])} className="flex min-h-8 flex-wrap items-center gap-1 rounded-md p-0.5 text-left hover:bg-slate-100">
        {chips}{!chips.length && <span className="px-1 text-label-md font-normal text-slate-400">{tr('+ Thêm vai trò')}</span>}
      </button>
    }>
      {Object.entries(SPECIALTY).map(([key, { label }]) => {
        const on = member.specialties.includes(key);
        return (
          <MenuItem key={key} icon={on ? 'check_box' : 'check_box_outline_blank'} onClick={() => onChange(on ? member.specialties.filter((x) => x !== key) : [...member.specialties, key])}>{label}</MenuItem>
        );
      })}
    </Dropdown>
  );
}

const getPermissionMatrix = () => [
  [tr('Quản lý Member/Viewer'), [1, 1, 0, 0]],
  [tr('Quản lý Owner/Admin'), [1, 0, 0, 0]],
  [tr('Tạo dự án'), [1, 1, 0, 0]],
];

export function InviteModal({ open, onClose, onDone }) {
  useI18n();
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
    if (!/^\S+@\S+\.\S+$/.test(v)) return setErr(tr("“{0}” không phải email hợp lệ", [v]));
    if (!emails.includes(v)) setEmails([...emails, v]);
    setInput('');
    setErr('');
  };
  const submit = async () => {
    setBusy(true);
    try {
      const d = await api.post(`/workspaces/${ws.workspace._id}/invites`, { emails, ...(inviteRole === 'mentor' ? { role: 'viewer', mentor: true } : { role: inviteRole }), projects: sel });
      toast(tr("Đã gửi {0} lời mời{1}", [d.created.length, d.skipped.length ? tr(", bỏ qua {0} (đã là thành viên)", [d.skipped.length]) : '']));
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
      title={tr("Mời thành viên vào Workspace")}
      subtitle={tr("Gửi lời mời tham gia {0}", [ws.workspace.name])}
      icon="person_add"
      footer={
        <>
          <span className="mr-auto text-label-md font-normal text-slate-400">{tr("Đã chọn ")}{emails.length} email</span>
          <button className="btn-outline" onClick={onClose}>{tr("Hủy")}</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !emails.length}>
            {busy ? <Spinner /> : <Icon name="send" size={16} />}{tr("Gửi lời mời")}</button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={tr("Địa chỉ email thành viên")} required error={err}>
          <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 focus-within:border-blue-600">
            {emails.map((e) => (
              <span key={e} className="chip border-blue-200 bg-blue-50 text-blue-700">
                {e}
                <button onClick={() => setEmails(emails.filter((x) => x !== e))}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
            <input className="min-w-[160px] flex-1 border-0 p-0 text-body-sm focus:ring-0" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ',') && (e.preventDefault(), add())} onBlur={add} placeholder={tr("Nhập email rồi nhấn Enter...")} />
          </div>
        </Field>
        <div>
          <span className="label">{tr("Vai trò mặc định trong Workspace")}</span>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['member', tr('Thành viên (Member)'), tr('Khi được thêm vào dự án: nhận việc, cập nhật giờ còn lại và gửi Review. PM của dự án mới được tạo, giao và duyệt việc.')],
              ['viewer', tr('Khách xem (Viewer)'), tr('Chỉ xem nội dung dự án được cấp quyền, không thể chỉnh sửa hay kéo thả.')],
              ['mentor', tr('Giảng viên'), tr('Tự động xem mọi dự án đang hoạt động, được bình luận và theo dõi đóng góp; không sửa được công việc.')],
              ...(role === 'owner' ? [['admin', tr('Quản trị (Admin)'), tr('Quản lý Member/Viewer và tạo dự án. Chỉ truy cập dự án đã được thêm vào.')]] : []),
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
          <span className="label">{tr("Chỉ định dự án tham gia ngay")}</span>
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
        <Notice tone="warn">{tr("Lưu ý: Lời mời sẽ tự động hết hạn sau 72 giờ kể từ khi gửi email.")}</Notice>
      </div>
    </Modal>
  );
}

export default function Members() {
  useI18n();
  const { ws, role, me, reloadWorkspace } = useApp();
  const toast = useToast();
  const isAdmin = ['owner', 'admin'].includes(role);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [selected, setSelected] = useState([]);
  const [bulk, setBulk] = useState({ role: '', add: '', remove: '' });
  const [bulkBusy, setBulkBusy] = useState(false);
  const { data, error, loading, reload } = useLoad(() => api.get(`/workspaces/${ws.workspace._id}/members`), [ws.workspace._id]);
  if (loading && !data) return <PageLoader />;
  const members = data?.members || [];
  const owners = members.filter((m) => m.role === 'owner').length;
  const list = members.filter((m) => (!roleFilter || roleValue(m) === roleFilter) && (m.user.name + m.user.email).toLowerCase().includes(search.toLowerCase()));
  const canEdit = (m) => isAdmin && (role === 'owner' || !['owner', 'admin'].includes(m.role));
  const selectable = list.filter(canEdit);
  const allSelected = selectable.length > 0 && selectable.every((m) => selected.includes(m.user._id));
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const applyBulk = async () => {
    setBulkBusy(true);
    try {
      const d = await api.post(`/workspaces/${ws.workspace._id}/members/bulk`, {
        users: selected,
        ...(bulk.role && rolePayload(bulk.role)),
        ...(bulk.add && { addSpecialties: [bulk.add] }),
        ...(bulk.remove && { removeSpecialties: [bulk.remove] }),
      });
      toast(tr('Đã cập nhật {0} thành viên', [d.updated]));
      setSelected([]);
      setBulk({ role: '', add: '', remove: '' });
      reload();
      reloadWorkspace();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBulkBusy(false);
    }
  };
  const changeSpecialties = async (m, specialties) => {
    try {
      await api.patch(`/workspaces/${ws.workspace._id}/members/${m.user._id}`, { specialties });
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const count = (r) => members.filter((m) => m.role === r).length;

  const changeRole = async (m, r) => {
    try {
      await api.patch(`/workspaces/${ws.workspace._id}/members/${m.user._id}`, rolePayload(r));
      toast(tr("Đã đổi vai trò {0} thành {1}", [m.user.name, roleName(r)]));
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
      toast(tr("Đã gỡ {0} khỏi {1}", [m.user.name, p.name]));
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const remove = async () => {
    try {
      await api.del(`/workspaces/${ws.workspace._id}/members/${removing.user._id}`);
      toast(tr("Đã thu hồi quyền của {0} (hiệu lực ngay)", [removing.user.name]));
      setRemoving(null);
      reload();
      reloadWorkspace();
    } catch (e) {
      toast(e.message, 'error');
      setRemoving(null);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label={tr("Tổng thành viên")} value={`${members.length}/20`} icon="group" />
          <StatCard label="Owner / Admin" value={count('owner') + count('admin')} icon="shield_person" tone="purple" />
          <StatCard label="Member" value={count('member')} icon="person" tone="green" />
          <StatCard label="Viewer" value={count('viewer')} icon="visibility" tone="slate" />
        </div>
        <ErrorBox error={error} onRetry={reload} />
        <div className="card">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <div className="relative flex-1">
              <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input h-9 pl-8 text-body-sm" placeholder={tr("Tìm theo tên hoặc email")} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select className="input h-9 w-auto text-body-sm" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">{tr("Mọi vai trò")}</option>
              {Object.entries(ROLE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
              <option value="mentor">{tr('Giảng viên')}</option>
            </Select>
            {isAdmin && (
              <button className="btn-primary" onClick={() => setInviting(true)}>
                <Icon name="person_add" size={16} />{tr(" Mời thành viên")}</button>
            )}
          </div>
          {isAdmin && selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-blue-100 bg-blue-50 p-3 text-body-sm">
              <span className="font-semibold text-blue-800">{tr('Đã chọn {0} người', [selected.length])}</span>
              <Select aria-label={tr('Đổi quyền')} className="input h-8 w-auto py-0 text-body-sm" value={bulk.role} onChange={(e) => setBulk({ ...bulk, role: e.target.value })}>
                <option value="">{tr('Giữ nguyên quyền')}</option>
                {(role === 'owner' ? ['admin', 'member', 'viewer', 'mentor'] : ['member', 'viewer', 'mentor']).map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
              </Select>
              <Select aria-label={tr('Thêm vai trò chuyên môn')} className="input h-8 w-auto py-0 text-body-sm" value={bulk.add} onChange={(e) => setBulk({ ...bulk, add: e.target.value })}>
                <option value="">{tr('Thêm vai trò…')}</option>
                {Object.entries(SPECIALTY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </Select>
              <Select aria-label={tr('Bỏ vai trò chuyên môn')} className="input h-8 w-auto py-0 text-body-sm" value={bulk.remove} onChange={(e) => setBulk({ ...bulk, remove: e.target.value })}>
                <option value="">{tr('Bỏ vai trò…')}</option>
                {Object.entries(SPECIALTY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </Select>
              <button className="btn-primary btn-sm" disabled={bulkBusy || (!bulk.role && !bulk.add && !bulk.remove)} onClick={applyBulk}>{tr('Áp dụng')}</button>
              <button className="btn-outline btn-sm" onClick={() => setSelected([])}>{tr('Bỏ chọn')}</button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-100">
                <tr>
                  {isAdmin && (
                    <th className="table-th w-8">
                      <input type="checkbox" aria-label={tr('Chọn tất cả')} className="form-checkbox rounded text-blue-600" checked={allSelected} disabled={!selectable.length} onChange={() => setSelected(allSelected ? [] : selectable.map((m) => m.user._id))} />
                    </th>
                  )}
                  <th className="table-th">{tr("Thành viên")}</th>
                  <th className="table-th">{tr("Quyền")}</th>
                  <th className="table-th">{tr("Vai trò chuyên môn")}</th>
                  <th className="table-th">{tr("Dự án được gán")}</th>
                  <th className="table-th">{tr("Hoạt động gần nhất")}</th>
                  {isAdmin && <th className="table-th text-right">{tr("Thao tác")}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((m) => {
                  const lastOwner = m.role === 'owner' && owners <= 1;
                  const canEditRole = isAdmin && (role === 'owner' || !['owner', 'admin'].includes(m.role));
                  return (
                    <tr key={m._id} className="hover:bg-slate-50">
                      {isAdmin && (
                        <td className="table-td">
                          {canEdit(m) && <input type="checkbox" aria-label={tr('Chọn {0}', [m.user.name])} className="form-checkbox rounded text-blue-600" checked={selected.includes(m.user._id)} onChange={() => toggle(m.user._id)} />}
                        </td>
                      )}
                      <td className="table-td">
                        <div className="flex items-center gap-2.5">
                          <Avatar user={m.user} size={32} />
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900">
                              {m.user.name} {m.user._id === me._id && <span className="font-normal text-slate-400">{tr("(bạn)")}</span>}
                            </p>
                            <p className="truncate text-label-md font-normal text-slate-500">{m.user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="table-td">
                        {canEditRole && !lastOwner ? (
                          <Select className={`input h-8 w-36 py-0 text-label-md font-semibold ${m.isMentor ? MENTOR_CHIP : ROLE_CHIP[m.role]}`} value={roleValue(m)} onChange={(e) => changeRole(m, e.target.value)}>
                            {(role === 'owner' ? ['owner', 'admin', 'member', 'viewer', 'mentor'] : ['member', 'viewer', 'mentor']).map((r) => (
                              <option key={r} value={r}>
                                {roleName(r)}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <span className={`chip ${m.isMentor ? MENTOR_CHIP : ROLE_CHIP[m.role]}`} title={lastOwner ? tr("Không thể xóa hoặc hạ quyền Owner cuối cùng") : ''}>
                            {lastOwner && <Icon name="lock" size={12} />}
                            {roleName(roleValue(m))}
                          </span>
                        )}
                        {m.title && <p className="mt-0.5 text-label-md font-normal text-slate-400">{m.title}</p>}
                      </td>
                      <td className="table-td">
                        <SpecialtyCell member={m} editable={canEditRole} onChange={(next) => changeSpecialties(m, next)} />
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
                      <td className="table-td whitespace-nowrap text-slate-500">{m.lastActiveAt ? timeAgo(m.lastActiveAt) : tr("Chưa đăng nhập")}</td>
                      {isAdmin && (
                        <td className="table-td text-right">
                          {lastOwner || !canEditRole ? (
                            <span className="text-label-md font-normal text-slate-400" title={tr("Không thể xóa Owner cuối cùng")}>
                              <Icon name="lock" size={16} />
                            </span>
                          ) : (
                            <Dropdown trigger={<button className="icon-btn h-8 w-8"><Icon name="more_vert" /></button>}>
                              {m.projects.map((p) => (
                                <MenuItem key={p._id} icon="folder_off" onClick={() => removeFromProject(m, p)}>{tr("Gỡ khỏi ")}{p.name}
                                </MenuItem>
                              ))}
                              <MenuItem icon="person_remove" danger disabled={m.user._id === me._id} onClick={() => setRemoving(m)}>{tr("Thu hồi quyền (hiệu lực ngay)")}</MenuItem>
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
        <p className="section-label mb-3">{tr('Quyền trong workspace')}</p>
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-label-sm text-slate-400">
              <th className="pb-2 text-left font-semibold" />
              {['Owner', 'Admin', 'Member', 'Viewer'].map((r) => (
                <th key={r} className="px-1 pb-2 font-semibold">
                  {r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {getPermissionMatrix().map(([label, v]) => (
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
        <div className="mt-4 space-y-2 text-label-md font-normal text-slate-600">
          <p className="font-semibold text-slate-900">{tr('Quyền trong từng dự án')}</p>
          <p>{tr('Owner/Admin cũng cần được thêm vào dự án để xem nội dung.')}</p>
          <p><strong>PM:</strong> {tr('quản lý thành viên, tạo và giao việc, đặt ước lượng, duyệt Done và mở lại công việc.')}</p>
          <p><strong>Member:</strong> {tr('cập nhật giờ còn lại và trạng thái việc mình nhận đến Review; không tự duyệt Done.')}</p>
          <p><strong>Viewer:</strong> {tr('chỉ đọc. Workspace Viewer không được nâng thành PM/Member trong dự án.')}</p>
          <p>{tr('Dự án đã lưu trữ chỉ cho xem nội dung.')}</p>
        </div>
        <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-label-md font-normal text-blue-800">{tr('Lưu ý: Quyền Owner không thể bị xóa nếu là Owner cuối cùng. Thu hồi quyền có hiệu lực ngay lập tức.')}</p>
      </div>
      <InviteModal open={inviting} onClose={() => setInviting(false)} onDone={reload} />
      <Confirm open={!!removing} danger title={tr("Thu hồi quyền truy cập?")} confirmText={tr("Thu hồi quyền")} onClose={() => setRemoving(null)} onConfirm={remove}>
        {removing?.user.name}{tr(" sẽ bị gỡ khỏi workspace và mọi dự án, mất quyền truy cập ngay lập tức. Các công việc đang giao sẽ chuyển về Chưa giao; lịch sử được giữ lại. Nếu là PM, người này cũng được gỡ khỏi vai trò PM.")}</Confirm>
    </div>
  );
}
