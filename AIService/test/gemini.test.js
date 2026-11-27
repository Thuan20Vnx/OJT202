import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MODEL = 'gemini-test';
const { getLlm } = await import('../src/llm.js');
const { suggestTools } = await import('../src/features/agent.js');
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('gọi generateContent đúng model, khóa và đọc số token', async () => {
  let call;
  globalThis.fetch = async (url, init) => {
    call = { url, headers: init.headers, body: JSON.parse(init.body) };
    return reply({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'suy nghĩ', thought: true }, { text: 'Trả lời' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 3 } });
  };
  const llm = await getLlm();
  const out = await llm.complete({ system: 'Hệ thống', prompt: 'Câu hỏi', maxTokens: 100, json: true });
  assert.match(call.url, /\/models\/gemini-test:generateContent$/);
  assert.equal(call.headers['x-goog-api-key'], 'test-key');
  assert.equal(call.body.systemInstruction.parts[0].text, 'Hệ thống');
  assert.equal(call.body.generationConfig.responseMimeType, 'application/json');
  assert.ok(call.body.generationConfig.maxOutputTokens > 100, 'phải chừa chỗ cho token suy luận');
  assert.deepEqual(out, { text: 'Trả lời', inputTokens: 10, outputTokens: 7 });
});

test('báo lỗi khi câu trả lời bị cắt hoặc rỗng', async () => {
  const llm = await getLlm();
  globalThis.fetch = async () => reply({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"cut' }] } }] });
  await assert.rejects(llm.complete({ system: 's', prompt: 'p' }), /MAX_TOKENS/);
  globalThis.fetch = async () => reply({ candidates: [] });
  await assert.rejects(llm.complete({ system: 's', prompt: 'p' }), /EMPTY/);
});

test('tự thử lại khi Gemini báo quá tải tạm thời', async () => {
  const llm = await getLlm();
  let calls = 0;
  globalThis.fetch = async () => (++calls === 1 ? reply({}, 503) : reply({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }] }));
  assert.equal((await llm.complete({ system: 's', prompt: 'p' })).text, 'ok');
  assert.equal(calls, 2);
});

test('gợi ý công cụ nhận được cả khi Gemini bọc kết quả trong mảng', async () => {
  const context = { projectName: 'p', description: '', repoDescription: '', languages: ['JavaScript'], topics: [], openTasks: [], labels: [], avoid: [] };
  const candidates = [{ name: 'a', description: 'x', url: 'https://www.npmjs.com/package/a', source: 'npm' }];
  const items = [{ title: 'Dùng a', kind: 'library', detail: 'x', url: candidates[0].url }];
  const wrapped = { complete: async () => ({ text: JSON.stringify([{ summary: 'Tóm tắt', suggestions: items }]), inputTokens: 1, outputTokens: 1 }) };
  const picked = await suggestTools(wrapped, { stage: 'pick', context, candidates });
  assert.equal(picked.result.summary, 'Tóm tắt');
  assert.deepEqual(picked.result.suggestions, items);
  const bare = { complete: async () => ({ text: JSON.stringify(['github issues', 'postgres']), inputTokens: 1, outputTokens: 1 }) };
  assert.deepEqual((await suggestTools(bare, { stage: 'queries', context })).result.queries, ['github issues', 'postgres']);
  assert.deepEqual((await suggestTools(null, { stage: 'queries', context })).result.queries, ['JavaScript']);
});

test('lỗi HTTP chỉ giữ mã trạng thái, không lặp lại nội dung nhà cung cấp trả về', async () => {
  const llm = await getLlm();
  globalThis.fetch = async () => reply({ error: { message: 'bí mật trong prompt' } }, 400);
  await assert.rejects(llm.complete({ system: 's', prompt: 'p' }), (e) => e.message === 'gemini HTTP 400' && e.diagnostic === 'GEMINI_HTTP_400');
});
