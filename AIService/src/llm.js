import { config } from './config.js';

let anthropic = null;
async function client() {
  if (!config.apiKey) return null;
  if (!anthropic) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: config.apiKey, maxRetries: 0 });
  }
  return anthropic;
}

/** LLM tối giản dùng chung. Trả null khi chưa cấu hình ANTHROPIC_API_KEY (dùng bộ AI nội bộ). */
export async function getLlm() {
  const c = await client();
  if (!c) return null;
  return {
    model: config.model,
    async complete({ system, prompt, maxTokens = 2000, signal }) {
      const msg = await c.messages.create({ model: config.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }, { signal });
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return { text, inputTokens: msg.usage?.input_tokens || 0, outputTokens: msg.usage?.output_tokens || 0 };
    },
  };
}

export function parseJson(text) {
  const m = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (m ? m[1] : text).trim();
  const start = raw.search(/[[{]/);
  return JSON.parse(raw.slice(start));
}

export const estimateTokens = (s) => Math.ceil(String(s || '').length / 4);
