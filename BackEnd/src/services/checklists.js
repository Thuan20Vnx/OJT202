import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest } from '../utils/http.js';

export const checklistSchema = z.array(z.object({
  _id: z.uuid().optional(),
  text: z.string().trim().min(1).max(300),
  done: z.boolean().default(false),
}).strict()).max(50);

export async function checklistMap(taskIds, db = prisma) {
  if (!taskIds.length) return new Map();
  const rows = await db.checklistItem.findMany({ where: { task: { in: taskIds } }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
  const result = new Map(taskIds.map((id) => [id, []]));
  for (const row of rows) result.get(row.task).push({ _id: row.id, text: row.title, done: row.isDone });
  return result;
}

export async function readChecklist(taskId, db = prisma) {
  return (await checklistMap([taskId], db)).get(taskId);
}

// Called inside the workspace transaction, after task ACL and version checks.
// Old clients may omit IDs and replace the list; new clients preserve item identity.
export async function saveChecklist(taskId, items, db) {
  const existing = new Set((await readChecklist(taskId, db)).map((item) => item._id));
  const seen = new Set();
  const next = items.map((item) => {
    if (item._id && (!existing.has(item._id) || seen.has(item._id))) throw badRequest('Mục checklist không thuộc công việc hoặc bị trùng');
    const _id = item._id || randomUUID();
    seen.add(_id);
    return { _id, text: item.text, done: item.done };
  });
  await db.checklistItem.deleteMany({ where: { task: taskId, id: { notIn: [...seen] } } });
  for (const [position, item] of next.entries()) {
    const data = { title: item.text, isDone: item.done, position };
    if (existing.has(item._id)) await db.checklistItem.update({ where: { id: item._id }, data });
    else await db.checklistItem.create({ data: { id: item._id, task: taskId, ...data } });
  }
  return next;
}
