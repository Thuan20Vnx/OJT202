import { USER, populate, prisma } from '../../db.js';
import { assertManage, projectAccess } from '../../middleware/access.js';
import { withWorkspaceLock } from '../membership.js';
import { isDateInput, parseDate } from '../../utils/dates.js';
import { randomToken, sha256 } from '../../utils/security.js';

/** Đưa về dạng JSON thuần (Date => chuỗi ISO) trước khi lưu vào cột JSONB */
export const plainJson = (v) => JSON.parse(JSON.stringify(v));

export const loadDraft = async (id) => populate(await prisma.aiDraft.findUnique({ where: { id } }), 'items.assignee', 'user', USER);

/** Thành viên có quyền làm việc trong dự án (không tính viewer, tài khoản khóa). */
export async function projectMembers(project) {
  const users = await prisma.user.findMany({ where: { id: { in: project.members }, isLocked: false }, select: USER });
  const ms = await prisma.membership.findMany({ where: { workspace: project.workspace, user: { in: project.members } } });
  const pms = await prisma.projectMember.findMany({ where: { project: project.id, role: { not: 'viewer' } } });
  return users.filter((u) => pms.some((m) => m.user === u.id) && ms.some((m) => m.user === u.id && m.role !== 'viewer')).map((u) => ({ ...u, jobTitle: ms.find((m) => m.user === u.id)?.title || u.title }));
}

/**
 * Lưu bản nháp kế hoạch / biên bản họp của một người dùng. Dùng chung cho AI trên web và agent qua MCP:
 * dù nguồn nào, bản nháp chỉ thành công việc khi PM duyệt. `guard` chạy trong transaction để kiểm lại
 * phiên/token ngay trước khi ghi; quyền quản lý dự án luôn được kiểm lại ở đây.
 */
export async function createAiDraft({ project, user, type, title, input, items, guard }) {
  const draft = await withWorkspaceLock(project.workspace, async (tx) => {
    if (guard) await guard(tx);
    assertManage(await projectAccess(user.id, project.id, tx));
    return tx.aiDraft.create({
      data: {
        workspace: project.workspace,
        project: project.id,
        user: user.id,
        type,
        title,
        input: type === 'meeting' ? { ...input, sourceHash: sha256(input.text), spanEncoding: 'utf-16' } : input,
        items: plainJson(
          items.map((it) => ({
            ...it,
            // A suggested plan is not an assignment. The PM chooses recipients in the draft.
            ...(type === 'plan' && { assignee: null }),
            dueDate: it.dueDate && isDateInput(it.dueDate) ? parseDate(it.dueDate, user.timezone, true) : null,
            key: randomToken(8),
            selected: true,
          })),
        ),
      },
    });
  });
  return loadDraft(draft.id);
}
