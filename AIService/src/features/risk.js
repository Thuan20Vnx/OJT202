import { estimateTokens } from '../llm.js';

/** AI chỉ DIỄN GIẢI cảnh báo đã xác định bằng quy tắc ở BackEnd – không dự đoán, không thêm số liệu. */
export async function explainRisk(llm, alert, signal) {
  if (!llm) return { explanation: alert.explanation, inputTokens: 80, outputTokens: estimateTokens(alert.explanation) };
  const out = await llm.complete({
    system: 'Bạn diễn giải cảnh báo rủi ro dự án bằng tiếng Việt trong 2 câu. Cảnh báo đã được xác định bằng quy tắc; KHÔNG dự đoán, KHÔNG thêm số liệu mới.',
    prompt: `Quy tắc: ${alert.rule}\nCảnh báo: ${alert.title}\nDữ kiện: ${alert.explanation}\nCông việc liên quan: ${alert.tasks.map((t) => `${t.key} ${t.title}`).join('; ')}`,
    maxTokens: 300,
    signal,
  });
  return { explanation: out.text.trim(), inputTokens: out.inputTokens, outputTokens: out.outputTokens };
}
