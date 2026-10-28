import { Server } from 'socket.io';
import { parseCookie } from 'cookie';
import { config } from '../config.js';
import { ACCESS_COOKIE, authenticate } from '../middleware/auth.js';
import { projectAccess } from '../middleware/access.js';
import { toApi } from './serialize.js';

let io = null;

export function initRealtime(httpServer) {
  io = new Server(httpServer, { cors: { origin: config.clientUrl, credentials: true }, path: '/socket.io' });

  io.use(async (socket, next) => {
    const cookies = parseCookie(socket.handshake.headers.cookie || '');
    const auth = await authenticate(cookies[ACCESS_COOKIE]).catch(() => null);
    if (!auth) return next(new Error('unauthorized'));
    socket.data.user = auth.user;
    socket.data.token = cookies[ACCESS_COOKIE];
    socket.data.accessRevision = 0;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.user.id;
    socket.join(`user:${userId}`);

    // Vào phòng dự án chỉ khi có quyền đọc dự án
    socket.on('project:join', async (projectId, ack) => {
      try {
        const revision = socket.data.accessRevision;
        if (!(await authenticate(socket.data.token))) return socket.disconnect(true);
        await projectAccess(userId, projectId);
        if (!socket.connected || revision !== socket.data.accessRevision) return ack?.({ ok: false });
        for (const room of socket.rooms) if (room.startsWith('project:')) socket.leave(room);
        socket.join(`project:${projectId}`);
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false });
      }
    });
  });
  return io;
}

export async function emitProject(projectId, event, payload) {
  if (!io) return;
  // Không chỉ tin vào membership của phòng lúc join: kiểm lại trước mỗi lần gửi.
  const sockets = [...io.sockets.sockets.values()].filter((s) => s.rooms.has(`project:${projectId}`));
  await Promise.all(
    sockets.map(async (s) => {
      const revision = s.data.accessRevision;
      try {
        if (!(await authenticate(s.data.token))) return s.disconnect(true);
        await projectAccess(s.data.user.id, projectId);
        if (s.connected && revision === s.data.accessRevision && s.rooms.has(`project:${projectId}`)) s.emit(event, toApi(payload));
      } catch {
        s.leave(`project:${projectId}`);
      }
    }),
  );
}

export async function emitUser(userId, event, payload, projectId) {
  if (!io) return;
  const sockets = [...io.sockets.sockets.values()].filter((s) => s.data.user.id === userId);
  await Promise.all(
    sockets.map(async (s) => {
      const revision = s.data.accessRevision;
      try {
        if (!(await authenticate(s.data.token))) return s.disconnect(true);
        if (projectId) await projectAccess(userId, projectId);
        if (s.connected && revision === s.data.accessRevision) s.emit(event, toApi(payload));
      } catch {
        /* Không gửi nội dung sau khi quyền đã bị thu hồi. */
      }
    }),
  );
}

/** Gọi SAU commit; xóa cả phòng mà Admin từng vào nhưng không được gán trực tiếp. */
export async function refreshUserAccess(userId) {
  if (!io) return;
  const sockets = [...io.sockets.sockets.values()].filter((s) => s.data.user.id === userId);
  for (const s of sockets) {
    s.data.accessRevision++;
    for (const room of [...s.rooms]) {
      if (!room.startsWith('project:')) continue;
      try {
        await projectAccess(userId, room.slice('project:'.length));
      } catch {
        await s.leave(room);
      }
    }
    s.emit('access:changed');
  }
}

/** Thu hồi quyền có hiệu lực ngay: đẩy user khỏi phòng dự án. */
export async function kickFromProject(userId, projectId) {
  if (!io) return;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  for (const s of sockets) {
    s.data.accessRevision++;
    await s.leave(`project:${projectId}`);
  }
}

export async function disconnectUser(userId) {
  if (!io) return;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  for (const s of sockets) s.disconnect(true);
}
