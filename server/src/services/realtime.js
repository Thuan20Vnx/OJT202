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
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.user.id;
    socket.join(`user:${userId}`);

    // Vào phòng dự án chỉ khi có quyền đọc dự án
    socket.on('project:join', async (projectId, ack) => {
      try {
        await projectAccess(userId, projectId);
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

export function emitProject(projectId, event, payload) {
  io?.to(`project:${projectId}`).emit(event, toApi(payload));
}

export function emitUser(userId, event, payload) {
  io?.to(`user:${userId}`).emit(event, toApi(payload));
}

/** Thu hồi quyền có hiệu lực ngay: đẩy user khỏi phòng dự án. */
export async function kickFromProject(userId, projectId) {
  if (!io) return;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  for (const s of sockets) s.leave(`project:${projectId}`);
}

export async function disconnectUser(userId) {
  if (!io) return;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  for (const s of sockets) s.disconnect(true);
}
