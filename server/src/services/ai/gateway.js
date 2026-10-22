import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { HttpError } from '../../utils/http.js';
import { startOfDay } from '../metrics.js';

let anthropic = null;
async function client() {
  if (!config.ai.apiKey) return null;
  if (!anthropic) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: config.ai.apiKey, maxRetries: 0 });
  }
  return anthropic;
}

/** LLM tối giản dùng chung. Trả null khi chưa cấu hình ANTHROPIC_API_KEY (dùng bộ AI nội bộ). */
export async function getLlm() {
  const c = await client();
  if (!c) return null;
  return {
    model: config.ai.model,
    async complete({ system, prompt, maxTokens = 2000, signal }) {
      const msg = await c.messages.create(
        { model: config.ai.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] },
        { signal },
      );
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
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

class Timeout extends Error {}

function withTimeout(fn, ms) {
  const ctrl = new AbortController();
  let timer;
  return Promise.race([
    fn(ctrl.signal),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new Timeout('timeout'));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const FEATURE_VI = { planner: 'Lập kế hoạch', report: 'Báo cáo tiến độ', qa: 'Hỏi đáp dự án', risk: 'Diễn giải rủi ro', meeting: 'Ghi chú họp' };

export async function usageToday(workspaceId) {
  return prisma.aiCall.count({ where: { workspace: workspaceId, createdAt: { gte: startOfDay() }, status: { notIn: ['quota_exceeded', 'disabled'] } } });
}

/**
 * Cổng AI: kiểm tra bật/tắt + hạn mức theo workspace/ngày, timeout có thử lại tối đa 1 lần,
 * ghi token/độ trễ/model/trạng thái. Lỗi AI chỉ trả lỗi cho tính năng AI, không ảnh hưởng CRUD.
 *
 * run(llm, signal) => { result, inputTokens?, outputTokens? }  (llm = null khi dùng AI nội bộ)
 */
export async function runAi({ workspaceId, userId, feature, run }) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  const log = (data) => prisma.aiCall.create({ data: { workspace: workspaceId, user: userId, feature, ...data } });
  if (!ws.ai?.enabled || ws.ai?.features?.[feature] === false) {
    await log({ status: 'disabled', model: '-' });
    throw new HttpError(403, `Tính năng "${FEATURE_VI[feature]}" đang tắt trong cài đặt workspace`, { code: 'AI_DISABLED' });
  }
  const used = await usageToday(workspaceId);
  if (used >= (ws.ai?.dailyLimit ?? 50)) {
    await log({ status: 'quota_exceeded', model: '-' });
    throw new HttpError(429, `Đã dùng hết ${ws.ai.dailyLimit} lượt AI hôm nay. Hạn mức đặt lại lúc 00:00.`, { code: 'AI_QUOTA' });
  }

  const llm = await getLlm();
  const model = llm ? llm.model : 'taskflow-local-rules';
  const timeoutMs = Math.min(config.ai.timeoutMs, (ws.ai?.timeoutSec ?? 30) * 1000);
  const started = Date.now();
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const out = await withTimeout((signal) => run(llm, signal), timeoutMs);
      await log({
        model,
        status: attempt > 1 ? 'retried_success' : 'success',
        inputTokens: out.inputTokens || 0,
        outputTokens: out.outputTokens || 0,
        latencyMs: Date.now() - started,
      });
      return { ...out.result, _meta: { model, provider: llm ? 'anthropic' : 'local', latencyMs: Date.now() - started } };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (e instanceof Timeout && attempt < 2) continue; // thử lại tối đa 1 lần
      await log({ model, status: e instanceof Timeout ? 'timeout' : 'error', latencyMs: Date.now() - started, error: String(e.message).slice(0, 300) });
      console.error(`[ai] ${feature} lỗi:`, e.message);
      throw new HttpError(503, 'AI đang bận, vui lòng thử lại sau. Các chức năng khác vẫn hoạt động bình thường.', { code: 'AI_UNAVAILABLE' });
    }
  }
}

export const estimateTokens = (s) => Math.ceil(String(s || '').length / 4);
