import { useCallback, useEffect, useRef } from 'react';
import { api } from './api.js';
import { useLoad } from './app.jsx';
import { getSocket } from './socket.js';

/** Quyền luôn được tải lại khi mở dự án hoặc nhận sự kiện resync. */
export function useProjectInfo(projectId) {
  const { data, loading, error, reload } = useLoad(() => projectId ? api.get(`/projects/${projectId}`) : Promise.resolve(null), [projectId]);
  useEffect(() => {
    const invalidate = (event) => { if (event.detail === projectId) reload(); };
    window.addEventListener('tf:project-invalidated', invalidate);
    return () => window.removeEventListener('tf:project-invalidated', invalidate);
  }, [projectId, reload]);
  return loading || error ? null : data;
}
export const invalidateProject = (id) => window.dispatchEvent(new CustomEvent('tf:project-invalidated', { detail: id }));

/** Chỉ thao tác mới nhất trên component còn mở được cập nhật giao diện. */
export function useLatestRequest() {
  const sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; sequence.current++; };
  }, []);
  return useCallback(() => {
    const id = ++sequence.current;
    return () => mounted.current && sequence.current === id;
  }, []);
}

/** Lắng nghe sự kiện realtime trong lúc component còn hiển thị */
export function useSocketEvent(event, handler, deps = []) {
  useEffect(() => {
    const s = getSocket();
    s.on(event, handler);
    return () => s.off(event, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
}
