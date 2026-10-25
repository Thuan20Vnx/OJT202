import { isUniqueError, prisma } from '../db.js';
import { emitUser } from './realtime.js';

/**
 * Tạo thông báo. dedupeKey + ràng buộc UNIQUE (user, dedupeKey) đảm bảo cùng một sự kiện không gửi trùng.
 * Tôn trọng tùy chọn bật/tắt của người nhận. Không thông báo cho chính người thực hiện.
 */
export async function notify({ user, actor, type, dedupeKey, ...rest }) {
  if (!user || (actor && actor === user)) return null;
  const pref = await prisma.notificationPref.findUnique({ where: { user } });
  // Một tùy chọn nhắc hạn điều khiển cả sắp hạn và quá hạn.
  // Giữ mặc định của NotificationPref ngay cả khi người dùng chưa mở cài đặt.
  const preference = type === 'overdue' ? 'due_soon' : type;
  if ((pref?.[preference] ?? (preference !== 'comment')) === false) return null;
  try {
    const n = await prisma.notification.create({ data: { user, actor, type, dedupeKey, ...rest } });
    emitUser(user, 'notification:new', { id: n.id, type, text: n.text }, rest.project);
    return n;
  } catch (e) {
    if (isUniqueError(e)) return null; // đã gửi trước đó
    throw e;
  }
}
