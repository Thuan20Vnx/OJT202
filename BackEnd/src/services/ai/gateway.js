import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { HttpError } from '../../utils/http.js';
import { startOfDay } from '../metrics.js';
import { withWorkspaceLock } from '../membership.js';
import { validateAiResult } from './contracts.js';

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

function attemptRecord(number, startedAt, status, response) {
  const known = response && [response.inputTokens, response.outputTokens].every((value) => Number.isSafeInteger(value) && value >= 0);
  return {
    number, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), status,
    model: response?.model ?? null, provider: response?.provider ?? null,
    inputTokens: known ? response.inputTokens : null, outputTokens: known ? response.outputTokens : null,
  };
}
const attemptUsage = (attempts) => ({
  inputTokens: attempts.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0),
  outputTokens: attempts.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0),
  usageComplete: attempts.every((item) => item.inputTokens !== null && item.outputTokens !== null),
});

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
  const queuedAt = new Date();
  const started = performance.now();
  // Giữ chỗ trong transaction ngắn; không giữ khóa trong lúc đợi dịch vụ AI.
  const { ws, call } = await withWorkspaceLock(workspaceId, async (tx) => {
    const ws = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const used = await tx.aiCall.count({ where: { workspace: workspaceId, createdAt: { gte: startOfDay() }, status: { notIn: ['quota_exceeded', 'disabled'] } } });
    const status = !ws.ai?.enabled || ws.ai?.features?.[feature] === false ? 'disabled' : used >= (ws.ai?.dailyLimit ?? 50) ? 'quota_exceeded' : 'pending';
    const call = await tx.aiCall.create({ data: { workspace: workspaceId, user: userId, feature, status, model: '-', queuedAt } });
    return { ws, call };
  });
  const log = (data) => prisma.aiCall.update({ where: { id: call.id }, data });
  if (call.status === 'disabled') {
    await log({ finishedAt: new Date(), latencyMs: Math.round(performance.now() - started), usageComplete: true });
    throw new HttpError(403, `Tính năng "${FEATURE_VI[feature]}" đang tắt trong cài đặt workspace`, { code: 'AI_DISABLED' });
  }
  if (call.status === 'quota_exceeded') {
    await log({ finishedAt: new Date(), latencyMs: Math.round(performance.now() - started), usageComplete: true });
    throw new HttpError(429, `Đã dùng hết ${ws.ai.dailyLimit} lượt AI hôm nay. Hạn mức đặt lại lúc 00:00.`, { code: 'AI_QUOTA' });
  }

  const timeoutMs = Math.min(config.ai.timeoutMs, (ws.ai?.timeoutSec ?? 30) * 1000);
  const attempts = [];
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const attemptStartedAt = new Date();
    let response;
    let result;
    try {
      response = await withTimeout((signal) => callAiService(feature, payload, signal), timeoutMs);
      result = validateAiResult(feature, response.result, payload);
    } catch (e) {
      attempts.push(attemptRecord(attempt, attemptStartedAt, e instanceof Timeout ? 'timeout' : 'error', response));
      if (e instanceof Timeout && attempt < 2) continue; // thử lại tối đa 1 lần
      await log({
        model: response?.model ?? e.model ?? '-', provider: response?.provider ?? null,
        status: e instanceof Timeout ? 'timeout' : 'error', latencyMs: Math.round(performance.now() - started),
        finishedAt: new Date(), attempts, ...attemptUsage(attempts), error: String(e.message).slice(0, 300),
      });
      console.error(`[ai] ${feature} lỗi:`, e.message);
      throw new HttpError(503, 'AI đang bận, vui lòng thử lại sau. Các chức năng khác vẫn hoạt động bình thường.', { code: 'AI_UNAVAILABLE' });
    }
    // A persistence failure must not be misreported as a second provider attempt.
    attempts.push(attemptRecord(attempt, attemptStartedAt, 'success', response));
    const latencyMs = Math.round(performance.now() - started);
    const usage = attemptUsage(attempts);
    await log({ model: response.model, provider: response.provider ?? null, status: attempt > 1 ? 'retried_success' : 'success', latencyMs, finishedAt: new Date(), attempts, ...usage });
    return { ...result, _meta: { callId: call.id, model: response.model, provider: response.provider, latencyMs, attemptCount: attempt, usageComplete: usage.usageComplete } };
  }
}
