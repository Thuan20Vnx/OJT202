import { t as tr, useI18n } from '../../lib/i18n.js';
import { useRef, useState } from 'react';
import { Avatar, Empty, ErrorBox, Icon, PageLoader } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useApp, useLoad, useToast } from '../../lib/app.jsx';
import { ROLE, timeAgo } from '../../lib/format.js';
import { InviteModal } from './Members.jsx';

const hoursLeft = (d) => Math.max(0, Math.round((new Date(d) - Date.now()) / 3600000));

export default function Invites() {
  useI18n();
  const { ws, role } = useApp();
  const toast = useToast();
  const [inviting, setInviting] = useState(false);
  const { data, loading, error, reload } = useLoad(() => api.get(`/workspaces/${ws.workspace._id}/invites`), [ws.workspace._id]);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const change = async (i, resend) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setActionError(null);
    try {
      const url = `/workspaces/${ws.workspace._id}/invites/${i._id}`;
      if (resend) await api.post(`${url}/resend`);
      else await api.del(url);
      toast(resend ? tr("Đã gửi lại lời mời tới {0}", [i.email]) : tr("Đã hủy lời mời"));
      await reload();
    } catch (e) {
      setActionError(e);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <ErrorBox error={actionError} />
      <div className="flex items-center justify-between border-b border-slate-100 p-3">
        <p className="text-label-lg font-semibold text-slate-800">{data.invites.length}{tr(" lời mời đang chờ")}</p>
        <button className="btn-primary" onClick={() => setInviting(true)}>
          <Icon name="person_add" size={16} />{tr(" Mời thành viên")}</button>
      </div>
      {!data.invites.length ? (
        <Empty icon="mark_email_read" title={tr("Không có lời mời đang chờ")} />
      ) : (
        <table className="w-full">
          <thead className="border-b border-slate-100">
            <tr>
              <th className="table-th">Email</th>
              <th className="table-th">{tr("Vai trò")}</th>
              <th className="table-th">{tr("Người mời")}</th>
              <th className="table-th">{tr("Hết hạn")}</th>
              <th className="table-th text-right">{tr("Thao tác")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.invites.map((i) => (
              <tr key={i._id}>
                <td className="table-td font-medium text-slate-900">{i.email}</td>
                <td className="table-td">{ROLE[i.role]}</td>
                <td className="table-td">
                  <span className="flex items-center gap-2">
                    <Avatar user={i.invitedBy} size={22} /> {i.invitedBy?.name} · <span className="text-slate-400">{timeAgo(i.createdAt)}</span>
                  </span>
                </td>
                <td className="table-td">
                  <span className={`chip ${hoursLeft(i.expiresAt) < 12 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>{tr("Hết hạn sau ")}{hoursLeft(i.expiresAt)}{tr(" giờ")}</span>
                </td>
                <td className="table-td text-right">
                  <button className="btn-ghost btn-sm" disabled={busy || (i.role === 'admin' && role !== 'owner')} onClick={() => change(i, true)}>{tr("Gửi lại")}</button>
                  <button className="btn-ghost btn-sm text-rose-600" disabled={busy || (i.role === 'admin' && role !== 'owner')} onClick={() => change(i, false)}>{tr("Hủy lời mời")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <InviteModal open={inviting} onClose={() => setInviting(false)} onDone={reload} />
    </div>
  );
}
