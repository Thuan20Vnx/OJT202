import { isId, jsonOrNull, prisma } from '../db.js';

const toRow = ({ before, after, entityId, ...entry }) => ({ ...entry, entityId: isId(entityId) ? entityId : null, before: jsonOrNull(before), after: jsonOrNull(after) });

/** Ghi nhật ký hoạt động (chỉ thêm mới, nhiều dòng trong một câu lệnh). Không bao giờ làm hỏng thao tác chính nếu ghi log lỗi. */
export async function logActivity(...entries) {
  if (!entries.length) return;
  try {
    await prisma.activity.createMany({ data: entries.map(toRow) });
  } catch (e) {
    console.error('[activity] ghi log thất bại', e.message);
  }
}

const TASK_FIELDS = {
  status: 'Đổi trạng thái',
  assignee: 'Giao việc',
  dueDate: 'Cập nhật hạn chót',
  priority: 'Đổi ưu tiên',
  title: 'Đổi tên',
  estimateHours: 'Đổi ước lượng',
};

const comparable = (v) => (v instanceof Date ? v.toISOString() : String(v ?? null));

/** So sánh trước/sau và ghi từng thay đổi chính của công việc. */
export async function logTaskChanges({ task, actor, before, after, labels = {} }) {
  const entries = [];
  for (const [field, action] of Object.entries(TASK_FIELDS)) {
    const b = before[field] ?? null;
    const a = after[field] ?? null;
    if (comparable(b) === comparable(a)) continue;
    entries.push({
      workspace: task.workspace,
      project: task.project,
      actor,
      action,
      entityType: 'task',
      entityId: task.id,
      entityLabel: `${task.key} ${task.title}`,
      field,
      before: labels[field]?.(b) ?? b,
      after: labels[field]?.(a) ?? a,
    });
  }
  await logActivity(...entries);
}
