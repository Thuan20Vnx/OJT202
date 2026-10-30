import { t as tr, useI18n } from '../../lib/i18n.js';
import { useState } from 'react';
import { Field, Notice, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useApp, useToast } from '../../lib/app.jsx';
import { ROLE, fmtDate } from '../../lib/format.js';

export default function General() {
  useI18n();
  const { ws, role, reloadWorkspace, loadMe } = useApp();
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
          <Notice>{tr("Chỉ Owner/Admin được sửa thông tin workspace.")}</Notice>
        )}
      </div>
      <div className="card space-y-2 p-5 text-body-sm">
        {[
          [tr("Gói"), ws.workspace.plan],
          [tr("Quy mô"), tr("{0} người", [ws.workspace.size])],
          [tr("Vai trò của bạn"), ROLE[role]],
          [tr("Ngày tạo"), fmtDate(ws.workspace.createdAt, { year: true })],
          [tr("Số dự án"), ws.projects.length],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <span className="text-slate-500">{k}</span>
            <span className="font-medium text-slate-800">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
