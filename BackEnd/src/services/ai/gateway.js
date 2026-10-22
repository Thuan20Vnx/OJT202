import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { HttpError } from '../../utils/http.js';
import { startOfDay } from '../metrics.js';

const headers = () => ({ 'content-type': 'application/json', ...(config.ai.serviceKey && { 'x-ai-service-key': config.ai.serviceKey }) });

/** Gọi AIService: POST /v1/<feature> => { result, inputTokens, outputTokens, model, provider } */
async function callAiService(feature, payload, signal) {
  const res = await fetch(`${config.ai.serviceUrl}/v1/${feature}`, { method: 'POST', headers: headers(), body: JSON.stringify(payload), signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ? `${data.error}${data.detail ? `: ${data.detail}` : ''}` : `AIService trả mã ${res.status}`), { model: data.model });
  return data;
}

/** Nhà cung cấp AI đang dùng (hiển thị ở Cài đặt AI); null khi không kết nối được AIService */
export async function aiServiceInfo() {
  try {
    const res = await fetch(`${config.ai.serviceUrl}/v1/info`, { headers: headers(), signal: AbortSignal.timeout(2000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
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
 * Cổng AI: kiểm tra bật/tắt + hạn mức theo workspace/ngày, gọi AIService với timeout và thử lại tối đa 1 lần,
 * ghi token/độ trễ/model/trạng thái. Lỗi AI chỉ trả lỗi cho tính năng AI, không ảnh hưởng CRUD.
 *
 * feature: planner | meeting | qa | report | risk; payload: dữ liệu đã lọc quyền gửi sang AIService.
 */
export async function runAi({ workspaceId, userId, feature, payload }) {
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

  const timeoutMs = Math.min(config.ai.timeoutMs, (ws.ai?.timeoutSec ?? 30) * 1000);
  const started = Date.now();
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const out = await withTimeout((signal) => callAiService(feature, payload, signal), timeoutMs);
      const latencyMs = Date.now() - started;
      await log({ model: out.model, status: attempt > 1 ? 'retried_success' : 'success', inputTokens: out.inputTokens || 0, outputTokens: out.outputTokens || 0, latencyMs });
      return { ...out.result, _meta: { model: out.model, provider: out.provider, latencyMs } };
    } catch (e) {
      if (e instanceof Timeout && attempt < 2) continue; // thử lại tối đa 1 lần
      await log({ model: e.model || '-', status: e instanceof Timeout ? 'timeout' : 'error', latencyMs: Date.now() - started, error: String(e.message).slice(0, 300) });
      console.error(`[ai] ${feature} lỗi:`, e.message);
      throw new HttpError(503, 'AI đang bận, vui lòng thử lại sau. Các chức năng khác vẫn hoạt động bình thường.', { code: 'AI_UNAVAILABLE' });
    }
  }
}
