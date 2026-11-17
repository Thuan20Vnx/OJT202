import { useEffect, useState } from 'react';
import { t as tr, useI18n } from '../lib/i18n.js';
import { api } from '../lib/api.js';
import { useApp, useToast } from '../lib/app.jsx';
import { fmtDateTime } from '../lib/format.js';
import { useSocketEvent } from '../lib/hooks.js';
import { Confirm, Icon } from './ui.jsx';

const left = (at) => {
  const ms = Math.max(0, new Date(at).getTime() - Date.now());
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h ? tr('{0} giờ {1} phút', [h, m]) : tr('{0} phút', [m]);
};

/** Dải cảnh báo đầu trang khi workspace đang chờ xóa: đếm ngược, Owner hủy được. Cũng nghe sự kiện xóa/hủy từ server. */
export default function DeletionBanner() {
  useI18n();
  const { ws, wsId, realRole, pendingDeletion, reloadWorkspace, loadMe } = useApp();
  const toast = useToast();
  const [, tick] = useState(0);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!pendingDeletion) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [pendingDeletion]);
  useSocketEvent('workspace:changed', ({ workspace, kind }) => {
    if (kind === 'deleted') loadMe();
    else if (workspace === wsId) reloadWorkspace();
  }, [wsId]);
  if (!pendingDeletion || !ws) return null;
  const cancel = async () => {
    setBusy(true);
    try {
      await api.del(`/workspaces/${ws.workspace._id}/deletion`);
      await reloadWorkspace();
      setAsking(false);
      toast(tr('Đã hủy xóa workspace. Mọi thứ hoạt động bình thường trở lại.'));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rose-200 bg-rose-50 px-4 py-2 text-body-sm text-rose-800">
      <Icon name="delete_forever" size={18} className="shrink-0" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{tr('Workspace "{0}" sẽ bị xóa sau {1}', [ws.workspace.name, left(pendingDeletion)])}</span>
        <span className="text-rose-700">{tr(' (lúc {0}). Đang chỉ đọc: bạn vẫn xem và tải dữ liệu về được.', [fmtDateTime(pendingDeletion)])}</span>
      </p>
      {realRole === 'owner' && (
        <button className="btn-outline btn-sm border-rose-300 bg-white text-rose-700" onClick={() => setAsking(true)}>{tr('Hủy xóa')}</button>
      )}
      <Confirm open={asking} busy={busy} title={tr('Hủy xóa workspace?')} confirmText={tr('Hủy xóa')} onClose={() => setAsking(false)} onConfirm={cancel}>
        <p>{tr('Workspace sẽ hoạt động bình thường trở lại và mọi thành viên được báo đã hủy xóa.')}</p>
      </Confirm>
    </div>
  );
}
