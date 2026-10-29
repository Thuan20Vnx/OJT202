import { useEffect, useState } from 'react';
import { getSocket } from '../lib/socket.js';
import { t as tr, useI18n } from '../lib/i18n.js';

export default function ConnectionStatus() {
  useI18n();
  const [connected, setConnected] = useState(() => getSocket().connected);
  useEffect(() => {
    const socket = getSocket();
    const online = () => setConnected(true);
    const offline = () => setConnected(false);
    socket.on('connect', online);
    socket.on('disconnect', offline);
    socket.on('connect_error', offline);
    // Đồng bộ lại khi trở về tab, kể cả khi socket đang mất kết nối.
    const refresh = () => {
      if (document.visibilityState === 'visible') window.dispatchEvent(new CustomEvent('tf:resync'));
    };
    document.addEventListener('visibilitychange', refresh);
    const timer = setInterval(() => {
      if (!socket.connected && document.visibilityState === 'visible') refresh();
    }, 30000);
    return () => {
      socket.off('connect', online);
      socket.off('disconnect', offline);
      socket.off('connect_error', offline);
      document.removeEventListener('visibilitychange', refresh);
      clearInterval(timer);
    };
  }, []);
  if (connected) return null;
  return <div role="status" className="flex flex-wrap items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-body-sm text-amber-900">
    {tr("Đang kết nối lại cập nhật trực tiếp. Dữ liệu được tải lại mỗi 30 giây khi tab đang mở.")}
    <button className="font-semibold underline" onClick={() => window.dispatchEvent(new CustomEvent('tf:resync'))}>{tr("Tải lại ngay")}</button>
  </div>;
}
