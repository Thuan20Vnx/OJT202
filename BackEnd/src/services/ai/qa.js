import { populate, prisma } from '../../db.js';
import { createHash } from 'node:crypto';
import { BUSINESS_TIMEZONE } from '../../utils/dates.js';

export const sourceFingerprint = (sources) =>
  createHash('sha256')
    .update(JSON.stringify(sources.map((s) => JSON.stringify(s)).sort()))
    .digest('hex');

export function annotateConversation(conversation, sources) {
  const revision = sourceFingerprint(sources);
  const refs = new Set(sources.map((s) => `${s.kind}:${s.refId}`));
  return {
    ...conversation,
    messages: conversation.messages.map((m) =>
      m.role !== 'assistant'
        ? m
        : {
            ...m,
            sourceState: !m.sourceRevision ? 'unknown' : m.sourceRevision === revision ? 'current' : 'changed',
            citations: (m.citations || []).map((c) => ({ ...c, available: refs.has(`${c.kind}:${c.refId}`) })),
          },
    ),
  };
}

const STATUS_VI = { todo: 'Cần làm', in_progress: 'Đang thực hiện', review: 'Đang kiểm duyệt', done: 'Hoàn thành' };

/**
 * Thu thập nguồn cho Hỏi đáp (gửi sang AIService để tìm kiếm + trả lời):
 * CHỈ trong dự án người dùng đã được kiểm quyền (projectId truyền vào sau projectAccess).
 * Tài liệu ảnh scan không được đọc (không OCR).
 */
export async function collectSources(projectId) {
  const [tasks, comments, docs] = await Promise.all([
    prisma.task.findMany({ where: { deletedAt: null, project: projectId } }),
    prisma.comment.findMany({ where: { project: projectId, taskRef: { deletedAt: null } } }),
    prisma.document.findMany({ where: { project: projectId, isScan: false, OR: [{ kind: 'doc' }, { mime: 'text/plain' }] } }),
  ]);
  await Promise.all([
    populate(tasks, 'assignee', 'user', { name: true }),
    populate(tasks, 'blockedBy', 'task', { key: true, title: true, status: true }),
    populate(comments, 'author', 'user', { name: true }),
    populate(comments, 'task', 'task', { key: true, title: true }),
  ]);
  const sources = [];
  for (const t of tasks) {
    const facts = [
      `${t.key} ${t.title}.`,
      `Trạng thái: ${STATUS_VI[t.status]}.`,
      `Người phụ trách: ${t.assignee?.name || 'chưa giao'}.`,
      t.dueDate ? `Hạn chót (${BUSINESS_TIMEZONE}): ${new Date(t.dueDate).toLocaleString('vi-VN', { timeZone: BUSINESS_TIMEZONE })}.` : 'Chưa có hạn chót.',
      (t.blockedBy || []).length ? `Bị chặn bởi: ${t.blockedBy.map((b) => `${b.key} ${b.title} (${STATUS_VI[b.status]})`).join(', ')}.` : '',
      t.description,
      (t.acceptanceCriteria || []).join('. '),
    ]
      .filter(Boolean)
      .join(' ');
    sources.push({ kind: 'task', refId: t.id, label: `${t.key} · Mô tả công việc`, text: facts, key: t.key, version: t.version, updatedAt: t.updatedAt });
  }
  for (const c of comments) {
    if (!c.task) continue;
    sources.push({
      kind: 'comment',
      refId: c.task.id,
      label: `${c.task.key} · Bình luận của ${c.author?.name}`,
      text: c.body,
      key: c.task.key,
      sourceId: c.id,
      updatedAt: c.updatedAt,
    });
  }
  for (const d of docs) {
    const paras = String(d.content || '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    paras.forEach((p, i) => sources.push({ kind: 'document', refId: d.id, label: `${d.name} · đoạn ${i + 1}`, text: p, version: d.version }));
  }
  return sources;
}

export async function reportSourceRevision(projectId) {
  const [sources, project] = await Promise.all([collectSources(projectId), prisma.project.findUnique({ where: { id: projectId } })]);
  const memberships = await prisma.membership.findMany({ where: { workspace: project.workspace }, orderBy: { id: 'asc' } });
  return sourceFingerprint([...sources, { project, memberships }]);
}
