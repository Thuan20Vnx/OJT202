import { isId, prisma } from '../db.js';
import { badRequest, conflict, notFound } from '../utils/http.js';
import { redactSecrets } from './repo/secrets.js';

/**
 * Hàng đợi việc cho agent trên máy. Người dùng bấm trên web => việc vào hàng đợi => runner (taskflow-runner)
 * trên máy của CHÍNH người đó nhận, gọi Antigravity / Claude Code / Codex => agent trả kết quả qua MCP.
 * Web chỉ gửi được ba loại việc cố định kèm nội dung người dùng nhập, không gửi được lệnh tùy ý.
 */
export const JOB_AGENTS = ['antigravity', 'claude', 'codex'];
// Runner hỏi việc vài giây một lần: quá ngưỡng này coi như đã tắt.
export const RUNNER_ONLINE_MS = 20000;
const QUEUE_TTL_MS = 3 * 60000;
const RUN_TTL_MS = 10 * 60000;
const MAX_PENDING = 3;

export const publicJob = (job) => ({ id: job.id, kind: job.kind, agent: job.agent, source: job.input?.source ?? null, status: job.status, resultType: job.resultType, resultId: job.resultId, error: job.error, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt });

/** Runner của người dùng có đang bật không, và máy đó có những agent nào. */
export async function runnerStatus(userId, now = new Date()) {
  const tokens = await prisma.agentToken.findMany({ where: { user: userId, revokedAt: null, expiresAt: { gt: now }, runnerSeenAt: { not: null } }, select: { runnerSeenAt: true, runnerAgents: true }, orderBy: { runnerSeenAt: 'desc' } });
  const live = tokens.filter((token) => now - token.runnerSeenAt < RUNNER_ONLINE_MS);
  return { online: live.length > 0, agents: JOB_AGENTS.filter((agent) => live.some((token) => token.runnerAgents.includes(agent))), lastSeenAt: tokens[0]?.runnerSeenAt ?? null };
}

/** Việc treo quá lâu (runner tắt giữa chừng, agent đứng) được đóng lại để web không chờ mãi. */
async function expireStale(userId, now = new Date()) {
  const finishedAt = now;
  await prisma.agentJob.updateMany({ where: { user: userId, status: 'queued', createdAt: { lt: new Date(now - QUEUE_TTL_MS) } }, data: { status: 'failed', finishedAt, error: 'Agent trên máy không nhận việc. Kiểm tra runner còn chạy không rồi thử lại.' } });
  await prisma.agentJob.updateMany({ where: { user: userId, status: 'running', startedAt: { lt: new Date(now - RUN_TTL_MS) } }, data: { status: 'failed', finishedAt, error: 'Agent chạy quá 10 phút mà chưa gửi kết quả.' } });
}

export async function createJob({ project, userId, kind, agent, input }) {
  await expireStale(userId);
  const runner = await runnerStatus(userId);
  if (!runner.online) throw conflict('Agent trên máy chưa bật. Mở terminal trong thư mục dự án và chạy "npm run agent".', { code: 'RUNNER_OFFLINE' });
  if (!runner.agents.includes(agent)) throw conflict('Máy đang chạy runner chưa cài agent này. Hãy chọn agent khác.', { code: 'AGENT_UNAVAILABLE' });
  const pending = await prisma.agentJob.count({ where: { user: userId, status: { in: ['queued', 'running'] } } });
  if (pending >= MAX_PENDING) throw conflict(`Đang có ${pending} việc chờ agent xử lý. Đợi xong hoặc hủy bớt rồi thử lại.`, { code: 'AGENT_BUSY' });
  return prisma.agentJob.create({ data: { workspace: project.workspace, project: project.id, user: userId, kind, agent, input } });
}

export async function getJob(userId, id) {
  await expireStale(userId);
  const job = isId(id) ? await prisma.agentJob.findFirst({ where: { id, user: userId } }) : null;
  if (!job) throw notFound('Không tìm thấy việc của agent');
  return job;
}

export async function cancelJob(userId, id) {
  await prisma.agentJob.updateMany({ where: { id: (await getJob(userId, id)).id, status: { in: ['queued', 'running'] } }, data: { status: 'cancelled', finishedAt: new Date() } });
  return getJob(userId, id);
}

/**
 * Người dùng bấm "Ngắt kết nối" trên web: các runner đang chạy bằng token của họ nhận lệnh dừng ở lần hỏi việc kế tiếp,
 * việc đang chờ hoặc đang chạy bị hủy. Bật lại (nút Bật agent hoặc đăng nhập Windows) là phiên mới nên chạy bình thường.
 */
export async function disconnectRunner(userId) {
  const tokens = await prisma.agentToken.findMany({ where: { user: userId, runnerSeenAt: { not: null } }, select: { id: true, runnerSession: true } });
  for (const token of tokens) await prisma.agentToken.update({ where: { id: token.id }, data: { runnerSeenAt: null, runnerStop: token.runnerSession } });
  await prisma.agentJob.updateMany({ where: { user: userId, status: { in: ['queued', 'running'] } }, data: { status: 'cancelled', finishedAt: new Date() } });
  return runnerStatus(userId);
}

/** Runner bị ngắt từ web thì không ghi nhận còn sống nữa mà báo nó dừng. */
export const runnerStopped = (token, session) => !!session && token.runnerStop === session;

/** Runner báo còn sống và nhận việc cũ nhất đang chờ. Hai runner cùng hỏi thì chỉ một cái nhận được. */
export async function claimJob(token, agents, claim = true, session = null) {
  const known = JOB_AGENTS.filter((agent) => agents.includes(agent));
  await prisma.agentToken.update({ where: { id: token.id }, data: { runnerSeenAt: new Date(), runnerAgents: known, ...(session && { runnerSession: session }) } });
  // claim = false: runner đang bận chạy một việc, chỉ báo còn sống.
  if (!claim) return null;
  await expireStale(token.user);
  for (;;) {
    const next = await prisma.agentJob.findFirst({ where: { user: token.user, status: 'queued', agent: { in: known } }, orderBy: { createdAt: 'asc' } });
    if (!next) return null;
    const claimed = await prisma.agentJob.updateMany({ where: { id: next.id, status: 'queued' }, data: { status: 'running', startedAt: new Date() } });
    if (claimed.count) return { ...next, status: 'running' };
  }
}

/** Việc đang chạy của chính người dùng, đúng loại và đúng dự án: agent chỉ được trả kết quả cho việc như vậy. */
export async function runningJob(userId, id, { kind, projectId } = {}) {
  const job = isId(id) ? await prisma.agentJob.findFirst({ where: { id, user: userId } }) : null;
  if (!job) throw notFound('Không tìm thấy việc của agent (jobId)');
  if (job.status !== 'running') throw badRequest(job.status === 'cancelled' ? 'Người dùng đã hủy việc này, dừng lại.' : 'Việc này không còn chạy nên không nhận kết quả nữa.');
  if ((kind && job.kind !== kind) || (projectId && job.project !== projectId)) throw badRequest('jobId không khớp loại việc hoặc dự án');
  return job;
}

/** Kết quả đã về: việc xong ngay lúc này, không đợi tiến trình agent thoát. */
export const completeJob = (job, resultType, resultId) =>
  prisma.agentJob.updateMany({ where: { id: job.id, status: 'running' }, data: { status: 'done', resultType, resultId, finishedAt: new Date() } });

/** Tiến trình agent đã thoát. Chưa có kết quả thì việc hỏng; giữ lại đoạn cuối lời agent (đã che bí mật) để người dùng biết lý do. */
export async function finishJob(userId, id, { ok, output }) {
  const job = isId(id) ? await prisma.agentJob.findFirst({ where: { id, user: userId } }) : null;
  if (!job) throw notFound('Không tìm thấy việc của agent');
  if (job.status !== 'running') return job;
  const tail = redactSecrets(String(output || '').trim().slice(-600)).text;
  // Lỗi hay gặp ở chế độ không tương tác: agent gọi công cụ ngoài danh sách được phép nên bị dừng giữa chừng.
  const denied = /permission that headless mode cannot prompt/i.test(tail);
  // Agent nhận được việc nhưng MCP server của nó dùng token khác (thường là Antigravity giữ token cũ trong cấu hình riêng).
  const staleToken = /token agent không hợp lệ|token.*(không hợp lệ|hết hạn|thu hồi)/i.test(tail);
  const permission = /required the "([\w-]+)" permission/i.exec(tail)?.[1];
  const error = denied
    ? `Agent gọi một công cụ không được phép${permission ? ` (quyền "${permission}")` : ''} nên bị dừng trước khi gửi kết quả. Hãy bấm chạy lại; nếu vẫn lỗi, chọn agent khác bằng nút mũi tên.`
    : staleToken
    ? 'Agent trên máy đang dùng token TaskFlow cũ. Vào tab Agent dự án, tạo token mới rồi chạy lại lệnh cài đặt để đồng bộ token cho cả runner và Antigravity.'
    : `${ok ? 'Agent chạy xong nhưng không gửi kết quả về TaskFlow.' : 'Agent báo lỗi khi chạy.'}${tail ? ` Lời cuối của agent: ${tail}` : ''}`.slice(0, 1000);
  await prisma.agentJob.updateMany({ where: { id: job.id, status: 'running' }, data: { status: 'failed', finishedAt: new Date(), error } });
  return prisma.agentJob.findUnique({ where: { id: job.id } });
}
