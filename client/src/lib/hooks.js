import { useEffect, useState } from 'react';
import { api } from './api.js';
import { getSocket } from './socket.js';

const cache = new Map();

/** Thông tin dự án + thành viên (có cache ngắn hạn). */
export function useProjectInfo(projectId) {
  const [info, setInfo] = useState(() => cache.get(projectId)?.data || null);
  useEffect(() => {
    if (!projectId) return setInfo(null);
    const hit = cache.get(projectId);
    if (hit && Date.now() - hit.at < 30000) return setInfo(hit.data);
    let alive = true;
    api
      .get(`/projects/${projectId}`)
      .then((d) => {
        cache.set(projectId, { data: d, at: Date.now() });
        if (alive) setInfo(d);
      })
      .catch(() => alive && setInfo(null));
    return () => {
      alive = false;
    };
  }, [projectId]);
  return info;
}
export const invalidateProject = (id) => cache.delete(id);

/** Lắng nghe sự kiện realtime trong lúc component còn hiển thị */
export function useSocketEvent(event, handler, deps = []) {
  useEffect(() => {
    const s = getSocket();
    s.on(event, handler);
    return () => s.off(event, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
}
