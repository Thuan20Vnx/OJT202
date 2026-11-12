import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = 'gemini-key';
process.env.GEMINI_MODEL = 'gemini-test';
process.env.GROQ_API_KEY = 'groq-key';
process.env.GROQ_MODEL = 'groq-test';
process.env.OPENROUTER_API_KEY = '';
process.env.OLLAMA_MODEL = 'ollama-test';
process.env.OLLAMA_URL = 'http://ollama.test/v1/';
process.env.AI_PROVIDER_ORDER = 'gemini, groq, openrouter, ollama, khong-co';
process.env.AI_PROVIDER_TIMEOUT_MS = '40';
const { getLlm, parseJson, providerChain } = await import('../src/llm.js');
const { createApp, providerInfo } = await import('../src/app.js');
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
const geminiOk = (text) => reply({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] });
const chatOk = (content, usage) => reply({ choices: [{ finish_reason: 'stop', message: { content } }], usage });
const host = (url) => new URL(url).host;

test('chuỗi nhà cung cấp chỉ gồm cái đã cấu hình, đúng thứ tự và không lộ khóa', () => {
  assert.deepEqual(providerChain().map((p) => p.id), ['gemini', 'groq', 'ollama']);
  const info = providerInfo();
  assert.deepEqual(info, { type: 'gemini', model: 'gemini-test', chain: [{ type: 'gemini', model: 'gemini-test' }, { type: 'groq', model: 'groq-test' }, { type: 'ollama', model: 'ollama-test' }] });
  assert.ok(!JSON.stringify(info).includes('key'));
});

test('Gemini hết hạn mức thì chuyển ngay sang Groq, không chờ thử lại', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ host: host(url), url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return host(url).includes('googleapis') ? reply({}, 429) : chatOk('<think>nghĩ</think>Xin chào', { prompt_tokens: 12, completion_tokens: 3 });
  };
  const llm = await getLlm();
  const started = Date.now();
  const out = await llm.complete({ system: 'Hệ thống', prompt: 'Câu hỏi', maxTokens: 50, json: true });
  assert.ok(Date.now() - started < 1500, 'không được chờ 2 giây thử lại khi còn nhà cung cấp dự phòng');
  assert.deepEqual(out, { text: 'Xin chào', inputTokens: 12, outputTokens: 3 });
  assert.deepEqual(calls.map((c) => c.host), ['generativelanguage.googleapis.com', 'api.groq.com']);
  assert.equal(calls[1].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(calls[1].headers.authorization, 'Bearer groq-key');
  assert.deepEqual(calls[1].body, { model: 'groq-test', messages: [{ role: 'system', content: 'Hệ thống' }, { role: 'user', content: 'Câu hỏi' }], max_tokens: 50 });
  assert.deepEqual(llm.used, { provider: 'groq', model: 'groq-test' });
});

test('nhà cung cấp treo bị cắt theo AI_PROVIDER_TIMEOUT_MS rồi chuyển tiếp; Ollama không gửi khóa', async () => {
  const calls = [];
  globalThis.fetch = (url, init) => {
    calls.push({ host: host(url), headers: init.headers });
    if (host(url) !== 'ollama.test') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    return Promise.resolve(chatOk('từ máy'));
  };
  const llm = await getLlm();
  const out = await llm.complete({ system: 's', prompt: 'p' });
  assert.equal(out.text, 'từ máy');
  assert.ok(out.inputTokens > 0 && out.outputTokens > 0, 'thiếu usage thì ước lượng');
  assert.deepEqual(calls.map((c) => c.host), ['generativelanguage.googleapis.com', 'api.groq.com', 'ollama.test']);
  assert.equal(calls[2].headers.authorization, undefined);
  assert.equal(llm.used.provider, 'ollama');
});

test('mọi nhà cung cấp đều lỗi: báo lỗi của cái cuối, cái cuối có thử lại', async () => {
  let ollama = 0;
  globalThis.fetch = async (url) => {
    if (host(url) === 'ollama.test') ollama += 1;
    return reply({}, host(url) === 'ollama.test' && ollama > 1 ? 500 : 503);
  };
  const llm = await getLlm();
  await assert.rejects(llm.complete({ system: 's', prompt: 'p' }), (e) => e.diagnostic === 'OLLAMA_HTTP_500');
  assert.equal(ollama, 2);
  assert.equal(llm.used, null);
});

test('BackEnd hủy yêu cầu thì dừng hẳn, không thử nhà cung cấp kế', async () => {
  const ctrl = new AbortController();
  const hosts = [];
  globalThis.fetch = (url, init) => {
    hosts.push(host(url));
    queueMicrotask(() => ctrl.abort());
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  };
  const llm = await getLlm();
  await assert.rejects(llm.complete({ system: 's', prompt: 'p', signal: ctrl.signal }));
  assert.deepEqual(hosts, ['generativelanguage.googleapis.com']);
});

test('câu trả lời bị cắt hoặc rỗng từ nhà cung cấp dự phòng là lỗi', async () => {
  globalThis.fetch = async (url) => (host(url) === 'ollama.test' ? reply({ choices: [{ finish_reason: 'length', message: { content: '{"cut' } }] }) : reply({}, 500));
  await assert.rejects((await getLlm()).complete({ system: 's', prompt: 'p' }), (e) => e.diagnostic === 'OLLAMA_LENGTH');
});

test('parseJson chịu được lời dẫn và lời kết quanh khối JSON', () => {
  assert.deepEqual(parseJson('Đây là kết quả:\n[{"a":1}]\nHy vọng giúp được bạn.'), [{ a: 1 }]);
  assert.deepEqual(parseJson('```json\n{"a":[1,2]}\n```'), { a: [1, 2] });
  assert.throws(() => parseJson('không có json'));
});

test('API trả đúng nhà cung cấp đã thực sự trả lời', async () => {
  globalThis.fetch = async (url) => (host(url).includes('googleapis') ? reply({}, 429) : chatOk('Diễn giải rủi ro'));
  const server = createApp().listen(0);
  try {
    const res = await realFetch(`http://127.0.0.1:${server.address().port}/v1/risk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ alert: { rule: 'r', title: 't', explanation: 'e', tasks: [] } }) });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.provider, 'groq');
    assert.equal(data.model, 'groq-test');
  } finally {
    server.close();
  }
});
