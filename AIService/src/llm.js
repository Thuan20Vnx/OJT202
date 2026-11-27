import { setTimeout as sleep } from 'node:timers/promises';
import { config } from './config.js';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
// Token suy luận của Gemini tính chung vào giới hạn đầu ra: cần chừa thêm, nếu không câu trả lời bị cắt rỗng.
const THINKING_HEADROOM = 4000;
// Gói miễn phí hay trả 429/503 tạm thời khi quá tải: chờ rồi thử lại trước khi báo lỗi.
const RETRY_DELAYS_MS = [2000, 6000];

const fail = (id, code, message) => Object.assign(new Error(message), { diagnostic: `${id.toUpperCase()}_${code}` });

/** Gửi một lần; `retry` chỉ bật ở nhà cung cấp cuối chuỗi, các nhà cung cấp trước đó lỗi là chuyển ngay sang cái kế. */
async function post(id, url, headers, body, { signal, retry }) {
  const send = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  let res = await send();
  for (const delay of retry ? RETRY_DELAYS_MS : []) {
    if (res.status !== 429 && res.status !== 503) break;
    await sleep(delay, undefined, { signal });
    res = await send();
  }
  // Thân lỗi của nhà cung cấp có thể lặp lại nội dung đã gửi: chỉ giữ mã HTTP.
  if (!res.ok) throw fail(id, `HTTP_${res.status}`, `${id} HTTP ${res.status}`);
  return res.json();
}

const gemini = ({ apiKey, model }) => ({
  id: 'gemini',
  model,
  async complete({ system, prompt, maxTokens, json }, options) {
    const data = await post('gemini', `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': apiKey }, {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens + THINKING_HEADROOM,
        thinkingConfig: { thinkingLevel: 'low' },
        ...(json && { responseMimeType: 'application/json' }),
      },
    }, options);
    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts || [])
      .filter((part) => typeof part.text === 'string' && !part.thought)
      .map((part) => part.text)
      .join('');
    if (!text.trim() || (candidate.finishReason && candidate.finishReason !== 'STOP')) throw fail('gemini', candidate?.finishReason || 'EMPTY', `Gemini không trả đủ nội dung: ${candidate?.finishReason || 'EMPTY'}`);
    return { text, inputTokens: data.usageMetadata?.promptTokenCount || 0, outputTokens: (data.usageMetadata?.candidatesTokenCount || 0) + (data.usageMetadata?.thoughtsTokenCount || 0) };
  },
});

/** Groq, OpenRouter và Ollama cùng nói giao thức chat completions của OpenAI. */
const openAiCompatible = ({ id, baseUrl, apiKey, model }) => ({
  id,
  model,
  async complete({ system, prompt, maxTokens }, options) {
    // Không ép response_format: nhiều model miễn phí không hỗ trợ, và có tính năng cần mảng JSON chứ không phải đối tượng.
    const data = await post(id, `${baseUrl.replace(/\/+$/, '')}/chat/completions`, apiKey ? { authorization: `Bearer ${apiKey}` } : {}, {
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      max_tokens: maxTokens,
    }, options);
    const choice = data.choices?.[0];
    // Model suy luận mã nguồn mở có thể chèn phần nghĩ vào câu trả lời.
    const text = String(choice?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (!text || choice.finish_reason === 'length') throw fail(id, choice?.finish_reason === 'length' ? 'LENGTH' : 'EMPTY', `${id} không trả đủ nội dung`);
    return { text, inputTokens: data.usage?.prompt_tokens || estimateTokens(system + prompt), outputTokens: data.usage?.completion_tokens || estimateTokens(text) };
  },
});

const BUILDERS = {
  gemini: () => config.gemini.apiKey && gemini(config.gemini),
  groq: () => config.groq.apiKey && openAiCompatible({ id: 'groq', ...config.groq }),
  openrouter: () => config.openrouter.apiKey && openAiCompatible({ id: 'openrouter', ...config.openrouter }),
  // Ollama chạy trên máy nên không cần khóa: bật khi có tên model.
  ollama: () => config.ollama.model && openAiCompatible({ id: 'ollama', ...config.ollama }),
};

/** Các nhà cung cấp đã cấu hình, theo thứ tự ưu tiên AI_PROVIDER_ORDER. */
export const providerChain = () => config.providerOrder.flatMap((id) => BUILDERS[id]?.() || []);

/**
 * LLM dùng chung. Trả null khi chưa cấu hình nhà cung cấp nào (dùng bộ AI nội bộ).
 * Nhà cung cấp đầu lỗi hoặc hết hạn mức thì tự chuyển sang cái kế; `used` cho biết lần gọi gần nhất do ai trả lời.
 */
export async function getLlm() {
  const chain = providerChain();
  if (!chain.length) return null;
  const llm = {
    provider: chain[0].id,
    model: chain[0].model,
    used: null,
    async complete({ system, prompt, maxTokens = 2000, json = false, signal }) {
      for (const [index, provider] of chain.entries()) {
        const last = index === chain.length - 1;
        // Nhà cung cấp treo không được ăn hết thời gian chờ của BackEnd: giới hạn riêng để còn kịp chuyển sang cái kế.
        const limited = last ? signal : AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(config.providerTimeoutMs)]);
        try {
          const out = await provider.complete({ system, prompt, maxTokens, json }, { signal: limited, retry: last });
          llm.used = { provider: provider.id, model: provider.model };
          return out;
        } catch (e) {
          if (last || signal?.aborted) throw e;
          console.error('[ai-service]', `${e.diagnostic || `${provider.id.toUpperCase()}_${e.name === 'TimeoutError' ? 'TIMEOUT' : 'FAILED'}`} -> chuyển sang ${chain[index + 1].id}`);
        }
      }
    },
  };
  return llm;
}

export function parseJson(text) {
  const m = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (m ? m[1] : text).trim();
  const body = raw.slice(raw.search(/[[{]/));
  try {
    return JSON.parse(body);
  } catch (e) {
    // Model không có chế độ JSON hay viết thêm lời sau khối JSON: cắt tới dấu đóng cuối cùng rồi thử lại.
    const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
    if (end < 0 || end === body.length - 1) throw e;
    return JSON.parse(body.slice(0, end + 1));
  }
}

export const estimateTokens = (s) => Math.ceil(String(s || '').length / 4);
