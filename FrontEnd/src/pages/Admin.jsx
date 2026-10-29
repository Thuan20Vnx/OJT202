import { t as tr, useI18n } from '../lib/i18n.js';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Avatar, Dropdown, Field, Icon, MenuItem, Modal, Notice, PageHeader, PageLoader, Pagination, Select, Spinner, StatCard, Tabs } from '../components/ui.jsx';
import { api, qs } from '../lib/api.js';
import { useApp, useLoad, useToast } from '../lib/app.jsx';
import { fmtDate, timeAgo } from '../lib/format.js';

const ACTION_VI = { get lock() { return tr("Khóa tài khoản"); }, get unlock() { return tr("Mở khóa"); }, get force_logout() { return tr("Buộc đăng xuất"); } };

export default function Admin() {
  useI18n();
  const { me } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState('users');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [locking, setLocking] = useState(null);
  const stats = useLoad(() => api.get('/admin/stats'), []);
  const users = useLoad(() => api.get(`/admin/users${qs({ status, search, page })}`), [status, search, page]);
  const wss = useLoad(() => (tab === 'workspaces' ? api.get('/admin/workspaces') : Promise.resolve(null)), [tab]);
  const audit = useLoad(() => (tab === 'audit' ? api.get('/admin/audit') : Promise.resolve(null)), [tab]);
  if (!me?.isSystemAdmin) return <Navigate to="/overview" replace />;

  const act = async (u, action) => {
    try {
      await api.post(`/admin/users/${u._id}/${action}`);
      toast(action === 'unlock' ? tr("Đã mở khóa {0}", [u.name]) : tr("Đã buộc {0} đăng xuất khỏi mọi thiết bị", [u.name]));
      users.reload();
      stats.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const s = stats.data;

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader
        title={tr("Quản trị hệ thống")}
        badge={<span className="chip border-purple-200 bg-purple-50 text-purple-700">System Admin</span>}
        subtitle={
          <span className="flex items-center gap-1">
            <Icon name="shield" size={16} className="text-blue-600" />{tr(" Quản lý tài khoản trên toàn nền tảng. Bạn không có quyền xem nội dung dự án của các workspace.")}</span>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={tr("Tổng người dùng")} value={s?.users ?? '–'} icon="group" />
        <StatCard label={tr("Đang hoạt động")} value={s?.active ?? '–'} icon="check_circle" tone="green" />
        <StatCard label={tr("Đã khóa")} value={s?.locked ?? '–'} icon="block" tone="red" />
        <StatCard label="Workspace" value={s?.workspaces ?? '–'} icon="workspaces" tone="purple" />
      </div>
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'users', label: tr("Người dùng"), count: s?.users },
          { value: 'workspaces', label: 'Workspace' },
          { value: 'policy', label: tr("Chính sách truy cập") },
          { value: 'audit', label: tr("Nhật ký quản trị") },
        ]}
      />
      {tab === 'users' && (
        <div className="card">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <div className="relative flex-1">
              <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input h-9 pl-8 text-body-sm" placeholder={tr("Tìm theo tên hoặc email")} value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
            </div>
            <Select className="input h-9 w-auto text-body-sm" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
              <option value="">{tr("Tất cả trạng thái")}</option>
              <option value="active">{tr("Đang hoạt động")}</option>
              <option value="locked">{tr("Đã khóa")}</option>
            </Select>
          </div>
          {users.loading && !users.data ? (
            <PageLoader />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-100">
                  <tr>
                    {[tr("Người dùng"), tr("Số workspace"), tr("Ngày tạo"), tr("Đăng nhập gần nhất"), tr("Trạng thái"), ''].map((h) => (
                      <th key={h} className="table-th">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.data.users.map((u) => (
                    <tr key={u._id} className="hover:bg-slate-50">
                      <td className="table-td">
                        <div className="flex items-center gap-2.5">
                          <Avatar user={u} size={32} />
                          <div>
                            <p className="font-semibold text-slate-900">
                              {u.name} {u.isSystemAdmin && <span className="chip ml-1 border-purple-200 bg-purple-50 text-purple-700">Admin</span>}
                            </p>
                            <p className="text-label-md font-normal text-slate-500">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="table-td">
                        <span className="chip border-slate-200 bg-slate-50 text-slate-600">{u.workspaces} workspace</span>
                      </td>
                      <td className="table-td whitespace-nowrap text-slate-500">{fmtDate(u.createdAt, { year: true })}</td>
                      <td className="table-td whitespace-nowrap text-slate-500">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : tr("Chưa đăng nhập")}</td>
                      <td className="table-td">
                        {u.locked ? (
                          <span className="chip border-rose-200 bg-rose-50 text-rose-700" title={tr("Khóa lúc {0}", [fmtDate(u.locked.at)])}>
                            <Icon name="lock" size={12} />{tr(" Đã khóa – ")}{u.locked.reason}
                          </span>
                        ) : (
                          <span className="chip border-emerald-200 bg-emerald-50 text-emerald-700">{tr("Đang hoạt động")}</span>
                        )}
                      </td>
                      <td className="table-td text-right">
                        {u._id !== me._id && (
                          <Dropdown trigger={<button className="icon-btn h-8 w-8"><Icon name="more_vert" /></button>}>
                            {u.locked ? (
                              <MenuItem icon="lock_open" onClick={() => act(u, 'unlock')}>{tr("Mở khóa")}</MenuItem>
                            ) : (
                              <MenuItem icon="lock" danger onClick={() => setLocking(u)}>{tr("Khóa tài khoản")}</MenuItem>
                            )}
                            <MenuItem icon="logout" onClick={() => act(u, 'logout')}>{tr("Buộc đăng xuất")}</MenuItem>
                          </Dropdown>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={page} total={users.data.total} limit={users.data.limit} onPage={setPage} />
            </div>
          )}
        </div>
      )}
      {tab === 'workspaces' && (
        <div className="card overflow-x-auto">
          {!wss.data ? (
            <PageLoader />
          ) : (
            <table className="w-full">
              <thead className="border-b border-slate-100">
                <tr>
                  {['Workspace', 'Owner', tr("Thành viên"), tr("Gói"), tr("Ngày tạo")].map((h) => (
                    <th key={h} className="table-th">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {wss.data.workspaces.map((w) => (
                  <tr key={w._id}>
                    <td className="table-td font-semibold text-slate-900">
                      {w.name} <span className="font-normal text-slate-400">/{w.slug}</span>
                    </td>
                    <td className="table-td">{w.owner?.name}</td>
                    <td className="table-td">{w.members}</td>
                    <td className="table-td">{w.plan}</td>
                    <td className="table-td text-slate-500">{fmtDate(w.createdAt, { year: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="border-t border-slate-100 px-4 py-2.5 text-label-md font-normal text-slate-500">{tr("Chỉ hiển thị siêu dữ liệu. Nội dung dự án và công việc không truy cập được từ trang quản trị.")}</p>
        </div>
      )}
      {tab === 'policy' && (
        <div className="card space-y-3 p-5 text-body-sm text-slate-700">
          {[
            ['visibility_off', tr("System Admin không mặc định đọc nội dung dự án riêng của workspace.")],
            ['lock', tr("Khóa tài khoản chặn mọi phiên đăng nhập ngay lập tức và bắt buộc ghi lý do.")],
            ['history', tr("Mọi hành động quản trị đều được ghi vào nhật ký quản trị (không thể xóa).")],
            ['key', tr("Phiên đăng nhập dùng cookie HttpOnly, refresh token xoay vòng; dùng lại token cũ sẽ thu hồi cả chuỗi phiên.")],
          ].map(([i, t]) => (
            <p key={t} className="flex items-start gap-2">
              <Icon name={i} size={18} className="text-blue-600" /> {t}
            </p>
          ))}
        </div>
      )}
      {tab === 'audit' && (
        <div className="card">
          {!audit.data ? (
            <PageLoader />
          ) : (
            <div className="divide-y divide-slate-100">
              {audit.data.items.map((a) => (
                <div key={a._id} className="flex items-center gap-3 px-4 py-3 text-body-sm">
                  <Avatar user={a.admin} size={26} />
                  <p className="flex-1 text-slate-600">
                    <b className="text-slate-800">{a.admin?.name}</b> · {ACTION_VI[a.action] || a.action} <b className="text-slate-800">{a.targetUser?.name}</b>
                    {a.reason && <span className="text-slate-500">{tr(" – lý do: ")}{a.reason}</span>}
                    {a.note && <span className="text-slate-400"> ({a.note})</span>}
                  </p>
                  <span className="text-label-md font-normal text-slate-400">{timeAgo(a.createdAt)}</span>
                </div>
              ))}
              {!audit.data.items.length && <p className="p-6 text-center text-body-sm text-slate-400">{tr("Chưa có hành động quản trị")}</p>}
            </div>
          )}
        </div>
      )}
      <LockModal user={locking} reasons={users.data?.reasons || []} onClose={() => setLocking(null)} onDone={() => (users.reload(), stats.reload())} />
    </div>
  );
}

function LockModal({ user, reasons, onClose, onDone }) {
  useI18n();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/users/${user._id}/lock`, { reason, note });
      toast(tr("Đã khóa tài khoản {0}", [user.name]));
      setReason('');
      setNote('');
      onDone();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={tr("Khóa tài khoản người dùng")}
      subtitle={tr("Chặn quyền truy cập trên toàn hệ thống")}
      icon="lock"
      footer={
        <>
          <button className="btn-outline" onClick={onClose}>{tr("Hủy")}</button>
          <button className="btn-danger" onClick={submit} disabled={busy || !reason}>
            {busy ? <Spinner /> : <Icon name="lock" size={16} />}{tr(" Khóa tài khoản")}</button>
        </>
      }
    >
      {user && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
            <Avatar user={user} size={36} />
            <div>
              <p className="font-semibold text-slate-900">{user.name}</p>
              <p className="text-label-md font-normal text-slate-500">{user.email}</p>
            </div>
          </div>
          <Field label={tr("Lý do khóa")} required>
            <Select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">{tr("Chọn lý do…")}</option>
              {reasons.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Ghi chú nội bộ")}>
            <textarea className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("Mô tả ngắn về vi phạm…")} />
          </Field>
          <Notice tone="warn">{tr("Mọi phiên đăng nhập của người dùng sẽ bị chặn ngay lập tức. Hành động này được ghi vào nhật ký quản trị.")}</Notice>
        </div>
      )}
    </Modal>
  );
}
