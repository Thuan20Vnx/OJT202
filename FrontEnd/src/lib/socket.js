import { io } from 'socket.io-client';
import { api } from './api.js';

let socket = null;
let currentProject = null;

export function getSocket() {
  if (!socket) {
    socket = io({ path: '/socket.io', withCredentials: true, autoConnect: true, reconnection: true });
    const active = socket;
    let recovering = null;
    const recover = () => {
      recovering ||= api
        .get('/me')
        .then(() => {
          if (socket === active && !active.connected) active.connect();
        })
        .catch(() => {})
        .finally(() => {
          recovering = null;
        });
      return recovering;
    };
    // Kết nối lại => vào lại phòng dự án; trang sẽ tự tải lại dữ liệu từ DB qua sự kiện "resync"
    socket.on('connect', () => {
      if (currentProject) socket.emit('project:join', currentProject);
      window.dispatchEvent(new CustomEvent('tf:resync'));
    });
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        // Phiên hiện tại có thể vẫn hợp lệ khi người dùng thu hồi các phiên khác.
        window.dispatchEvent(new CustomEvent('tf:resync'));
        recover();
      }
    });
    socket.on('connect_error', (error) => {
      if (error.message === 'unauthorized') recover();
    });
  }
  return socket;
}

export function joinProject(projectId) {
  currentProject = projectId;
  const s = getSocket();
  if (s.connected && projectId) s.emit('project:join', projectId);
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
  currentProject = null;
}
