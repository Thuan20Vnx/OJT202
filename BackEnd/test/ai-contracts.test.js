import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAiResult } from '../src/services/ai/contracts.js';

const valid = { title: 'Viết API', description: 'API quản lý công việc', acceptanceCriteria: ['Có kiểm quyền'], estimateHours: 1, dueDate: null };
test('U021 gateway: từ chối HTTP AI sai shape, thiếu AC, NUL và vượt ngân sách', () => {
  for (const result of [null, {}, { items: [valid] }, { items: Array(16).fill(valid) }, { items: Array(5).fill({ ...valid, acceptanceCriteria: [] }) }, { items: Array(5).fill({ ...valid, title: 'NUL\u0000' }) }]) assert.throws(() => validateAiResult('planner', result, {}));
  assert.throws(() => validateAiResult('planner', { items: Array(5).fill(valid) }, { maxHours: 4.99 }));
  assert.equal(validateAiResult('planner', { items: Array(5).fill(valid) }, { maxHours: 5 }).items.length, 5);
});
test('U021 gateway: không nhận ngày AI tự đặt, ngày quá khứ hoặc vượt hạn kế hoạch', () => {
  for (const [dueDate, payload] of [
    ['2099-02-15T10:00:00Z', {}], ['2099-02-16T10:00:00Z', { deadline: '2099-02-15T10:00:00Z' }], ['2000-01-01T00:00:00Z', { deadline: '2099-02-15T10:00:00Z' }],
  ]) assert.throws(() => validateAiResult('planner', { items: Array(5).fill({ ...valid, dueDate }) }, payload));
});
test('U027 gateway: trích đoạn phải thuộc biên bản, giữ cả dấu và khoảng trắng', () => {
  const payload = { text: 'Mai Anh: mình sẽ viết API.' };
  const item = { title: 'Viết API', excerpt: payload.text };
  assert.equal(validateAiResult('meeting', { items: [item] }, payload).items.length, 1);
  assert.throws(() => validateAiResult('meeting', { items: [{ ...item, excerpt: 'Mai Anh sẽ deploy thanh toán.' }] }, payload));
});
