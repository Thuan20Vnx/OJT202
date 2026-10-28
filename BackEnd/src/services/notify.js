import { isUniqueError, prisma } from '../db.js';
import { emitUser } from './realtime.js';

/**
 * Tạo thông báo. dedupeKey + ràng buộc UNIQUE (user, dedupeKey) đảm bảo cùng một sự kiện không gửi trùng.
 * Tôn trọng tùy chọn bật/tắt của người nhận. Không thông báo cho chính người thực hiện.
 */
export async function notify({ user, actor, type, dedupeKey, ...rest }) {
  if (!user || (actor && actor === user)) return null;
  if (rest.project) {
    const permitted = await prisma.projectMember.findFirst({ where: { project: rest.project, user, projectRef: { workspaceRef: { memberships: { some: { user } } } }, userRef: { isLocked: false } } });
    if (!permitted) return null;
  }
  const pref = await prisma.notificationPref.findUnique({ where: { user } });
  if (pref && pref[type] === false) return null;
  try {
    const n = await prisma.notification.create({ data: { user, actor, type, dedupeKey, ...rest } });
    emitUser(user, 'notification:new', { id: n.id, type, text: n.text });
    return n;
  } catch (e) {
    if (isUniqueError(e)) return null; // đã gửi trước đó
    throw e;
  }
}
