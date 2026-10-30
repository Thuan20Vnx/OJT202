import { z } from 'zod';

const text = (max) => z.string().max(max).refine((value) => !value.includes('\u0000'));
const common = z.object({
  title: text(200).trim().min(1), description: text(2000).optional(),
  acceptanceCriteria: z.array(text(300).trim().min(1)).max(20).optional(),
  estimateHours: z.number().min(0).max(1000).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(), assignee: z.uuid().nullish(),
  dueDate: z.iso.datetime({ offset: true }).nullish(), excerpt: text(30000).optional(),
});

/** An internal HTTP response is still untrusted input, including with a configured provider. */
export function validateAiResult(feature, result, payload) {
  if (feature === 'planner') {
    const parsed = z.object({ items: z.array(common.extend({
      description: text(2000).trim().min(1), acceptanceCriteria: z.array(text(300).trim().min(1)).min(1).max(8),
      estimateHours: z.number().positive().max(1000),
    })).min(5).max(15) }).parse(result);
    if (payload.maxHours != null && parsed.items.reduce((sum, item) => sum + item.estimateHours, 0) > payload.maxHours + 1e-9) throw new Error('AI trả kế hoạch vượt tổng giờ tối đa');
    if (parsed.items.some((item) => item.dueDate && (!payload.deadline || new Date(item.dueDate) > new Date(payload.deadline) || new Date(item.dueDate) < new Date()))) throw new Error('AI trả hạn không thuộc kế hoạch');
    return parsed;
  }
  if (feature === 'meeting') {
    const parsed = z.object({ items: z.array(common.extend({ excerpt: text(30000).trim().min(1) })).max(20) }).parse(result);
    if (parsed.items.some((item) => !payload.text.includes(item.excerpt))) throw new Error('Trích đoạn AI không tồn tại trong biên bản gốc');
    return parsed;
  }
  return result;
}
