import { isId, jsonOrNull, prisma } from '../db.js';

const toRow = ({ before, after, entityId, ...entry }) => ({ ...entry, entityId: isId(entityId) ? entityId : null, before: jsonOrNull(before), after: jsonOrNull(after) });

/** Audit bắt buộc: lỗi ghi audit phải rollback cùng thay đổi nghiệp vụ. */
export async function logActivityIn(tx, ...entries) {
  if (entries.length) await tx.activity.createMany({ data: entries.map(toRow) });
}

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
  plannedStartDate: 'Cập nhật ngày bắt đầu kế hoạch',
  actualStartDate: 'Cập nhật ngày bắt đầu thực tế',
  actualEndDate: 'Cập nhật ngày kết thúc thực tế',
  priority: 'Đổi ưu tiên',
  title: 'Đổi tên',
  description: 'Cập nhật mô tả',
  acceptanceCriteria: 'Cập nhật tiêu chí nghiệm thu',
  estimateHours: 'Đổi ước lượng',
  remainingHours: 'Cập nhật thời gian còn lại',
  spentHours: 'Cập nhật thời gian đã làm',
  labels: 'Cập nhật nhãn',
  sprint: 'Chuyển sprint',
  checklist: 'Cập nhật checklist',
  order: 'Sắp xếp công việc',
};

const comparable = (v) => (v instanceof Date ? v.toISOString() : JSON.stringify(v ?? null));

/** So sánh trước/sau và ghi từng thay đổi chính của công việc. */
export async function logTaskChanges({ task, actor, before, after, labels = {} }, tx) {
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
  if (tx) await logActivityIn(tx, ...entries);
  else await logActivity(...entries);
}
