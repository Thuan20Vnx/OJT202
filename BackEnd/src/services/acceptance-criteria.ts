import { z } from 'zod';
import { badRequest } from '../utils/http.js';

export const acceptanceCriteriaSchema = z.union([
  z.string().max(10000),
  z.array(z.string().trim().min(1).max(300)).max(30).transform((items) => items.join('\n')),
]);

/** Canonical API field is text; the old camelCase array remains an input alias. */
export function normalizeTaskInput(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const body = input as Record<string, unknown>;
  if (Object.hasOwn(body, 'acceptance_criteria')) {
    if (Object.hasOwn(body, 'acceptanceCriteria')) throw badRequest('Chỉ gửi một trường tiêu chí nghiệm thu');
    if (typeof body.acceptance_criteria !== 'string') throw badRequest('Tiêu chí nghiệm thu phải là văn bản');
    const { acceptance_criteria, ...rest } = body;
    return { ...rest, acceptanceCriteria: acceptance_criteria };
  }
  if (Object.hasOwn(body, 'acceptanceCriteria') && !Array.isArray(body.acceptanceCriteria)) {
    throw badRequest('Dùng acceptance_criteria cho văn bản hoặc acceptanceCriteria cho danh sách');
  }
  return body;
}
