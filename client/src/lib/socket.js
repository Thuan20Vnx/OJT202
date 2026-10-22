import { io } from 'socket.io-client';

let socket = null;
let currentProject = null;

export function getSocket() {
  if (!socket) {
    socket = io({ path: '/socket.io', withCredentials: true, autoConnect: true, reconnection: true });
    // Kết nối lại => vào lại phòng dự án; trang sẽ tự tải lại dữ liệu từ DB qua sự kiện "resync"
    socket.on('connect', () => {
      if (currentProject) socket.emit('project:join', currentProject);
      window.dispatchEvent(new CustomEvent('tf:resync'));
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
