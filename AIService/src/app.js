import express from 'express';
import { z } from 'zod';
import { LOCAL_MODEL, config } from './config.js';
import { getLlm } from './llm.js';
import { extractActions } from './features/meeting.js';
import { generatePlan } from './features/planner.js';
import { answer } from './features/qa.js';
import { writeNarrative } from './features/report.js';
import { explainRisk } from './features/risk.js';
import { BUSINESS_TIMEZONE, isDateInput, isTimeZone, parseDate } from './dates.js';

const member = z.object({ id: z.string(), name: z.string(), jobTitle: z.string().nullish(), title: z.string().nullish() }).passthrough();
const members = z.array(member).max(500);
const isoDate = z.string().refine(isDateInput, 'Ngày không hợp lệ');
const timezone = z.string().refine(isTimeZone, 'Múi giờ không hợp lệ').default(BUSINESS_TIMEZONE);

/**
 * Mỗi tính năng: schema đầu vào + hàm chạy (llm = null => bộ AI nội bộ).
 * Trả { result, inputTokens, outputTokens }; BackEnd lo hạn mức, quyền truy cập và ghi nhật ký gọi AI.
 */
const FEATURES = {
  planner: {
    schema: z.object({
      goal: z.string().min(1).max(2000),
      deadline: isoDate.nullish(),
      people: z.number().int().min(1).max(50).nullish(),
      maxHours: z.number().min(1).max(5000).nullish(),
      timezone,
      members,
    }),
    run: async (llm, b, signal) => {
      const r = await generatePlan(llm, { ...b, deadline: b.deadline ? parseDate(b.deadline, b.timezone, true) : null }, signal);
      return { result: { items: r.items }, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
    },
  },
  meeting: {
    schema: z.object({ text: z.string().min(1).max(30000), members, timezone }),
    run: async (llm, b, signal) => {
      const r = await extractActions(llm, b, signal);
      return { result: { items: r.items }, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
    },
  },
  qa: {
    schema: z.object({
      question: z.string().min(1).max(1000),
      projectName: z.string().max(200),
      sources: z.array(z.object({ kind: z.string(), refId: z.string(), label: z.string(), text: z.string(), key: z.string().optional() })).max(20000),
    }),
    run: async (llm, b, signal) => {
      const { inputTokens, outputTokens, ...result } = await answer(llm, b, signal);
      return { result, inputTokens, outputTokens };
    },
  },
  report: {
    schema: z.object({
      project: z.object({ name: z.string() }),
      data: z.object({
        stats: z.record(z.any()),
        sections: z.array(z.object({ title: z.string(), body: z.string() })),
        risks: z.array(z.object({ title: z.string(), type: z.string() })),
      }),
      from: isoDate,
      to: isoDate,
    }),
    run: async (llm, b, signal) => {
      const n = await writeNarrative(llm, b.project, b.data, new Date(b.from), new Date(b.to), signal);
      return { result: { summary: n.summary, suggestions: n.suggestions }, inputTokens: n.inputTokens, outputTokens: n.outputTokens };
    },
  },
  risk: {
    schema: z.object({
      alert: z.object({ rule: z.string(), title: z.string(), explanation: z.string(), tasks: z.array(z.object({ key: z.string(), title: z.string() })) }),
    }),
    run: async (llm, b, signal) => {
      const r = await explainRisk(llm, b.alert, signal);
      return { result: { explanation: r.explanation }, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
    },
  },
};

export const providerInfo = () => (config.apiKey ? { type: 'anthropic', model: config.model } : { type: 'local', model: LOCAL_MODEL });

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, ...providerInfo() }));

  // Chỉ BackEnd được gọi: kiểm tra khóa dùng chung
  app.use('/v1', (req, res, next) => {
    if (config.serviceKey && req.get('x-ai-service-key') !== config.serviceKey) return res.status(401).json({ error: 'Sai khóa AI service' });
    next();
  });

  app.get('/v1/info', (_req, res) => res.json(providerInfo()));

  for (const [name, feature] of Object.entries(FEATURES)) {
    app.post(`/v1/${name}`, async (req, res) => {
      const parsed = feature.schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Dữ liệu gửi AI không hợp lệ', details: parsed.error.issues.slice(0, 5) });
      if (name === 'planner' && parsed.data.deadline && parseDate(parsed.data.deadline, parsed.data.timezone, true).getTime() < Date.now())
        return res.status(400).json({ error: 'Hạn hoàn thành kế hoạch đã qua' });
      // BackEnd hết thời gian chờ và ngắt kết nối => hủy luôn lời gọi LLM đang chạy
      const ctrl = new AbortController();
      res.on('close', () => !res.writableEnded && ctrl.abort());
      const llm = await getLlm();
      const out = await feature.run(llm, parsed.data, ctrl.signal);
      res.json({ ...out, model: llm ? llm.model : LOCAL_MODEL, provider: llm ? 'anthropic' : 'local' });
    });
  }

  app.use((_req, res) => res.status(404).json({ error: 'Không tìm thấy API' }));
  // Lỗi khi gọi LLM / AI trả định dạng sai: BackEnd ghi nhật ký và báo "AI đang bận" cho người dùng
  app.use((err, _req, res, _next) => {
    console.error('[ai-service]', err.message);
    res.status(502).json({ error: 'AI xử lý thất bại', detail: String(err.message).slice(0, 300) });
  });
  return app;
}
