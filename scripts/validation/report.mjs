const cell = (value) => value == null ? 'Chưa có' : String(value).replace(/[|<>\r\n]/g, ' ');
const ms = (value) => value == null ? 'Chưa có' : value.toFixed(2);
export function evaluationMarkdown(run) {
  const lines = [
    '# Kết quả chạy đánh giá TaskFlow', '',
    `Run: ${cell(run.runId)}. Bộ đề: ${cell(run.pack.version)} (${cell(run.pack.split)}).`,
    `Provider: ${cell(run.provider)}. Revision: ${cell(run.build.revision)}.`,
    `Source SHA-256: ${cell(run.build.sourceHash)}.`,
    `Prompt SHA-256: ${cell(run.build.promptHash)}. Dataset SHA-256: ${cell(run.dataset.hash)}.`, '',
    `Kỹ thuật: ${cell(run.technicalStatus)}. Nghiệm thu: ${cell(run.acceptanceStatus)}.`,
    'Kết quả development không thay thế bộ nghiệm thu giữ kín hoặc điểm hai người chấm.', '',
    '| Nhóm ca | Đạt | Mẫu số đã chạy |', '| --- | ---: | ---: |',
    ...Object.entries(run.groups).map(([name, row]) => `| ${cell(name)} | ${row.numerator} | ${row.denominator} |`), '',
    '| Feature | Request | Lỗi HTTP/mạng | p50 (ms) | p95 (ms) |', '| --- | ---: | ---: | ---: | ---: |',
    ...Object.entries(run.benchmarks).map(([name, row]) => `| ${cell(name)} | ${row.requests} | ${row.errors} | ${ms(row.p50Ms)} | ${ms(row.p95Ms)} |`), '',
    'Thời gian đo từ trước fetch đến sau đọc/parse response, gồm xử lý API, queue, retrieval và retry; giữ cả request lỗi. Chưa phải phép thử core API với 50 user ảo.',
    `Cấu hình: ${cell(run.environment.platform)}/${cell(run.environment.arch)}, ${cell(run.environment.cpu)}, Node ${cell(run.build.node)}, concurrency=${run.environment.concurrency}.`,
    `Chi phí: chưa xác định. ${cell(run.costReason)}.`, '',
    '## Phần còn thiếu', '', ...run.pending.map((item) => `- ${cell(item)}`), '',
    '## Ca thất bại', '',
    ...(run.records.some((row) => !row.passed) ? run.records.filter((row) => !row.passed).map((row) => `- ${cell(row.caseId)}: ${cell(row.failures.join('; '))}`) : ['Không có ca kỹ thuật thất bại trong bộ đã chạy.']), '',
    'Output gốc, cấu hình, token đã biết/chưa biết và từng attempt được giữ trong [ai-run.json](ai-run.json). Không suy ra độ chính xác hoặc latency của provider trả phí từ run local.', '',
  ];
  return lines.join('\n');
}
