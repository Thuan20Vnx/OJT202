import { t as tr, useI18n } from '../../lib/i18n.js';
import { useState } from 'react';
import { Field, Modal, Notice, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useApp, useToast } from '../../lib/app.jsx';
import { ROLE, fmtDate, fmtDateTime } from '../../lib/format.js';

export default function General() {
  useI18n();
  const { ws, role, realRole, reloadWorkspace, loadMe } = useApp();
  const toast = useToast();
  const [name, setName] = useState(ws.workspace.name);
  const [busy, setBusy] = useState(false);
  const isAdmin = ['owner', 'admin'].includes(role);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/workspaces/${ws.workspace._id}`, { name });
      await Promise.all([reloadWorkspace(), loadMe()]);
      toast(tr("Đã lưu thông tin workspace"));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="card space-y-4 p-5">
        <Field label={tr("Tên workspace")}>
          <input className="input" value={name} disabled={!isAdmin} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={tr("Địa chỉ")}>
          <input className="input" value={`taskflow.app/${ws.workspace.slug}`} disabled />
        </Field>
        {isAdmin ? (
          <button className="btn-primary" onClick={save} disabled={busy || !name.trim() || name === ws.workspace.name}>
            {busy && <Spinner />}{tr("Lưu thay đổi")}</button>
        ) : (
          <Notice>{ws.workspace.deletionScheduledAt ? tr("Workspace đang chờ xóa nên chỉ được xem.") : tr("Chỉ Owner/Admin được sửa thông tin workspace.")}</Notice>
        )}
      </div>
      <div className="card space-y-2 p-5 text-body-sm">
        {[
          [tr("Gói"), ws.workspace.plan],
          [tr("Quy mô"), tr("{0} người", [ws.workspace.size])],
          [tr("Vai trò của bạn"), ROLE[realRole || role]],
          [tr("Ngày tạo"), fmtDate(ws.workspace.createdAt, { year: true })],
          [tr("Số dự án"), ws.projects.length],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <span className="text-slate-500">{k}</span>
            <span className="font-medium text-slate-800">{v}</span>
          </div>
        ))}
      </div>
      {realRole === 'owner' && <DangerZone />}
    </div>
  );
}

/** Chỉ Owner: hẹn xóa workspace sau 24 giờ (gõ lại tên để xác nhận). Trong thời gian chờ, hủy ở dải cảnh báo đầu trang. */
function DangerZone() {
  useI18n();
  const { ws, reloadWorkspace } = useApp();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pending = ws.workspace.deletionScheduledAt;
  const close = () => { if (!busy) { setOpen(false); setTyped(''); setError(null); } };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/workspaces/${ws.workspace._id}/deletion`, { name: typed });
      await reloadWorkspace();
      setOpen(false);
      setTyped('');
      toast(tr('Đã hẹn xóa workspace sau 24 giờ và báo cho các thành viên'));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card border-rose-200 p-5 lg:col-span-2">
      <p className="text-label-lg font-semibold text-rose-700">{tr('Xóa workspace')}</p>
      {pending ? (
        <p className="mt-1 text-body-sm text-slate-600">{tr('Đã hẹn xóa lúc {0}. Bấm "Hủy xóa" ở dải cảnh báo đầu trang để giữ lại workspace.', [fmtDateTime(pending)])}</p>
      ) : (
        <>
          <p className="mt-1 text-body-sm text-slate-600">{tr('Xóa toàn bộ dự án, công việc, tài liệu và tệp của workspace. Workspace bị xóa sau 24 giờ; trong thời gian đó mọi người chỉ xem và tải dữ liệu về được, bạn hủy được bất cứ lúc nào. Owner, Admin và Member được báo trong app và qua email.')}</p>
          <button className="btn-danger mt-3" onClick={() => setOpen(true)}>{tr('Xóa workspace…')}</button>
        </>
      )}
      <Modal
        open={open}
        onClose={close}
        title={tr('Xóa workspace "{0}"?', [ws.workspace.name])}
        icon="warning"
        footer={
          <>
            <button className="btn-outline" onClick={close}>{tr('Hủy')}</button>
            <button className="btn-danger" form="delete-workspace" disabled={busy || typed.trim() !== ws.workspace.name}>{busy && <Spinner />}{tr('Hẹn xóa sau 24 giờ')}</button>
          </>
        }
      >
        <form id="delete-workspace" onSubmit={submit} className="space-y-3 text-body-sm text-slate-600">
          <p>{tr('Sau 24 giờ, mọi dữ liệu của workspace bị xóa vĩnh viễn và không khôi phục được. Từ lúc hẹn, workspace chỉ đọc.')}</p>
          <Field label={tr('Gõ lại tên workspace để xác nhận')} error={error?.message}>
            <input className="input" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={ws.workspace.name} spellCheck={false} />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
