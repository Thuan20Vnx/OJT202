import { config } from '../config.js';
import { isUniqueError, prisma } from '../db.js';
import { withWorkspaceLock } from './membership.js';
import { sendMail } from './mailer.js';
import { emitUser } from './realtime.js';
import { removeFile } from './storage.js';

/** Owner yêu cầu xóa → workspace chỉ đọc trong 24 giờ (Owner hủy được) → job xóa hẳn. */
export const DELETION_DELAY_MS = 24 * 3600 * 1000;
export const REMINDER_BEFORE_MS = 3600 * 1000;

const fmt = (d) => new Date(d).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

/** Người nhận: Owner, Admin, Member. Không báo Viewer và Giảng viên; bỏ tài khoản bị khóa. */
export async function deletionRecipients(workspace, db = prisma) {
  const rows = await db.membership.findMany({
    where: { workspace, role: { in: ['owner', 'admin', 'member'] }, isMentor: false, userRef: { isLocked: false } },
    select: { user: true, userRef: { select: { email: true } } },
  });
  return rows.map((r) => ({ id: r.user, email: r.userRef.email }));
}

const MESSAGES = {
  scheduled: (ws, by) => ({
    subject: `Workspace "${ws.name}" sẽ bị xóa sau 24 giờ`,
    text: `${by} đã yêu cầu xóa workspace "${ws.name}". Workspace sẽ bị xóa vĩnh viễn lúc ${fmt(ws.deletionScheduledAt)} (giờ Việt Nam). Từ bây giờ workspace chỉ đọc: bạn vẫn xem và tải dữ liệu về được. Owner có thể hủy xóa trước thời điểm đó.`,
  }),
  reminder: (ws) => ({
    subject: `Còn khoảng 1 giờ nữa workspace "${ws.name}" bị xóa`,
    text: `Workspace "${ws.name}" sẽ bị xóa vĩnh viễn lúc ${fmt(ws.deletionScheduledAt)} (giờ Việt Nam). Hãy tải về dữ liệu bạn cần giữ trước thời điểm này.`,
  }),
  cancelled: (ws, by) => ({
    subject: `Đã hủy xóa workspace "${ws.name}"`,
    text: `${by} đã hủy yêu cầu xóa workspace "${ws.name}". Workspace hoạt động bình thường trở lại.`,
  }),
  deleted: (ws) => ({
    subject: `Workspace "${ws.name}" đã bị xóa`,
    text: `Workspace "${ws.name}" đã được xóa vĩnh viễn theo yêu cầu của Owner.`,
  }),
};

/**
 * Thông báo trong app + email cho từng người nhận. Email luôn gửi (không phụ thuộc tùy chọn email của Hồ sơ)
 * vì đây là thay đổi ảnh hưởng tới toàn bộ dữ liệu. dedupeKey theo (workspace, loại, thời điểm hẹn) nên job chạy lại không gửi trùng.
 */
export async function announceDeletion(ws, kind, { by = 'Owner', actor = null, recipients } = {}) {
  const list = recipients ?? (await deletionRecipients(ws.id));
  const { subject, text } = MESSAGES[kind](ws, by);
  const stamp = ws.deletionScheduledAt ? new Date(ws.deletionScheduledAt).toISOString() : 'none';
  const dedupeKey = `workspace-deletion:${kind}:${ws.id}:${kind === 'cancelled' ? Date.now() : stamp}`;
  // Workspace đã xóa thì thông báo không gắn workspace (nếu gắn sẽ bị xóa theo).
  const workspace = kind === 'deleted' ? null : ws.id;
  let sent = 0;
  for (const r of list) {
    try {
      const n = await prisma.notification.create({ data: { user: r.id, actor, type: 'workspace', workspace, text, dedupeKey } });
      emitUser(r.id, 'notification:new', { id: n.id, type: n.type, text: n.text, workspace: n.workspace, project: null }).catch(() => {});
    } catch (e) {
      if (isUniqueError(e)) continue; // đã gửi ở lần chạy trước
      throw e;
    }
    sent++;
    sendMail({ to: r.email, subject, text, link: config.clientUrl }).catch((e) => console.warn('[workspace-deletion] Không gửi được email:', e.message));
  }
  for (const r of list) emitUser(r.id, 'workspace:changed', { workspace: ws.id, kind }).catch(() => {});
  return sent;
}

/** Xóa hẳn một workspace đã tới hạn. Kiểm tra lại trong khóa: Owner vừa hủy thì không xóa. */
export async function purgeWorkspace(workspaceId, now = new Date()) {
  const result = await withWorkspaceLock(workspaceId, async (tx) => {
    const ws = await tx.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws?.deletionScheduledAt || ws.deletionScheduledAt > now) return null;
    const [recipients, files] = await Promise.all([
      deletionRecipients(ws.id, tx),
      tx.document.findMany({ where: { workspace: ws.id, storageKey: { not: null } }, select: { storageKey: true } }),
    ]);
    const members = await tx.membership.findMany({ where: { workspace: ws.id }, select: { user: true } });
    // Các bảng con (dự án, việc, tài liệu, thông báo, nhật ký…) đều ON DELETE CASCADE theo workspace.
    await tx.workspace.delete({ where: { id: ws.id } });
    return { ws, recipients, files, members };
  });
  if (!result) return false;
  await Promise.all(result.files.map((f) => removeFile(f.storageKey).catch(() => {})));
  await announceDeletion(result.ws, 'deleted', { recipients: result.recipients });
  for (const m of result.members) emitUser(m.user, 'workspace:changed', { workspace: workspaceId, kind: 'deleted' }).catch(() => {});
  console.log(`[workspace-deletion] Đã xóa workspace ${workspaceId}`);
  return true;
}

/** Job: nhắc trước ~1 giờ và xóa các workspace đã tới hạn. */
export async function runWorkspaceDeletions(now = new Date()) {
  const soon = await prisma.workspace.findMany({ where: { deletionScheduledAt: { gt: now, lte: new Date(now.getTime() + REMINDER_BEFORE_MS) } } });
  for (const ws of soon) await announceDeletion(ws, 'reminder');
  const due = await prisma.workspace.findMany({ where: { deletionScheduledAt: { lte: now } }, select: { id: true } });
  let deleted = 0;
  for (const ws of due) if (await purgeWorkspace(ws.id, now)) deleted++;
  return { reminded: soon.length, deleted };
}
