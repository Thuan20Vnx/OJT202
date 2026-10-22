import { fold } from '../text.js';
import { estimateTokens, parseJson } from '../llm.js';

const DAY = 86400000;

/** Gợi ý người nhận theo chức danh (title) của thành viên dự án. */
function suggestAssignee(kind, members, idx) {
  const want = {
    design: ['ui', 'ux', 'design', 'frontend'],
    backend: ['backend', 'database', 'api', 'full'],
    frontend: ['frontend', 'ui', 'full'],
    test: ['qa', 'test', 'devops'],
    security: ['qa', 'devops', 'backend'],
    docs: ['ui', 'ux', 'pm', 'product'],
    research: ['tech', 'lead', 'backend', 'pm'],
    ai: ['ai', 'full'],
    deploy: ['devops', 'qa'],
  }[kind] || [];
  const match = members.find((m) => want.some((w) => fold(m.jobTitle || '').includes(w)));
  return match?.id || (members.length ? members[idx % members.length].id : undefined);
}

function subjectOf(goal) {
  return goal
    .replace(/^(hoàn thiện|hoàn thành|xây dựng|làm|phát triển|triển khai|thiết kế|tạo)\s+/i, '')
    .replace(/\s+cho\s+.*$/i, '')
    .trim();
}

/** Bộ lập kế hoạch nội bộ (không gọi mạng): phân rã theo mẫu quy trình phát triển phần mềm. */
export function localPlan({ goal, maxHours, people, deadline, members }) {
  const g = fold(goal);
  const subject = subjectOf(goal) || goal;
  const isPayment = /thanh toan|vnpay|momo|payment|checkout/.test(g);
  const providers = ['VNPay', 'Momo', 'ZaloPay', 'Stripe'].filter((p) => g.includes(fold(p)));
  const isAi = /\bai\b|tri tue|chatbot|rag|goi y/.test(g);
  const isMobile = /mobile|di dong|ios|android/.test(g);

  const steps = [
    { kind: 'research', w: 1, title: isPayment ? `Nghiên cứu tài liệu API ${providers[0] || 'cổng thanh toán'} sandbox` : `Làm rõ yêu cầu và phạm vi: ${subject}`, ac: ['Có ghi chú yêu cầu được nhóm duyệt', 'Xác định rõ ngoài phạm vi'] },
    { kind: 'design', w: 1.4, title: isPayment ? 'Thiết kế màn hình chọn phương thức thanh toán' : `Thiết kế giao diện ${isMobile ? 'mobile ' : ''}cho ${subject}`, ac: ['Đủ trạng thái loading, lỗi, rỗng', isMobile ? 'Đúng kích thước màn hình di động' : 'Tương thích responsive'] },
    { kind: 'backend', w: 1.2, title: 'Thiết kế dữ liệu và đặc tả API', ac: ['Có schema dữ liệu', 'Có đặc tả request/response'] },
    { kind: 'backend', w: 1.7, title: isPayment ? 'Xây dựng API tạo giao dịch & xác minh chữ ký' : `Xây dựng API cho ${subject}`, ac: ['Kiểm tra quyền truy cập', 'Validate dữ liệu đầu vào'] },
    { kind: 'frontend', w: 1.5, title: `Xây dựng giao diện và kết nối API`, ac: ['Hiển thị lỗi thân thiện', 'Không mất dữ liệu khi lỗi mạng'] },
  ];
  if (isPayment) {
    steps.push({ kind: 'backend', w: 1.4, title: 'Xử lý callback/IPN và cập nhật trạng thái đơn', ac: ['Callback trùng không xử lý hai lần', 'Ghi log giao dịch'] });
    for (const p of providers.slice(1)) steps.push({ kind: 'backend', w: 1.3, title: `Tích hợp ${p}`, ac: [`Thanh toán thành công trên ${p} sandbox`] });
  }
  if (isAi) steps.push({ kind: 'ai', w: 1.6, title: 'Xây dựng luồng AI và bộ đề đánh giá', ac: ['Có baseline so sánh', 'Có xử lý khi AI lỗi'] });
  steps.push({ kind: 'test', w: 1.1, title: isPayment ? 'Viết test tích hợp thanh toán' : 'Viết test tự động cho luồng chính', ac: ['Test chạy trong CI', 'Bao phủ ca lỗi chính'] });
  if (isPayment || /bao mat|dang nhap|xac thuc|auth/.test(g)) steps.push({ kind: 'security', w: 1, title: isPayment ? 'Kiểm thử bảo mật dữ liệu thanh toán' : 'Kiểm thử bảo mật và phân quyền', ac: ['Không lộ dữ liệu nhạy cảm', 'Không truy cập chéo nhóm'] });
  steps.push({ kind: 'docs', w: 0.6, title: 'Viết tài liệu hướng dẫn cấu hình và sử dụng', ac: ['Có hướng dẫn cài đặt'] });
  steps.push({ kind: 'deploy', w: 0.6, title: 'Demo nội bộ và nghiệm thu', ac: ['Demo end-to-end trên staging'] });

  const items = steps.slice(0, 15);
  const budget = maxHours || items.length * 6;
  const totalW = items.reduce((s, x) => s + x.w, 0);
  const team = members.slice(0, Math.max(1, people || members.length));
  const now = Date.now();
  // Làm tròn giờ nhưng không vượt tổng giờ tối đa
  const hours = items.map((s) => Math.max(1, Math.round((budget * s.w) / totalW)));
  while (maxHours && hours.reduce((a, b) => a + b, 0) > budget && Math.max(...hours) > 1) hours[hours.indexOf(Math.max(...hours))] -= 1;
  return items.map((s, i) => {
    const due = deadline ? new Date(now + ((deadline - now) * (i + 1)) / items.length) : null;
    return {
      title: s.title,
      description: `Thuộc mục tiêu: ${goal}`,
      acceptanceCriteria: s.ac,
      estimateHours: hours[i],
      priority: i < 4 ? 'high' : i < items.length - 2 ? 'medium' : 'low',
      assignee: suggestAssignee(s.kind, team, i),
      dueDate: due ? new Date(Math.floor(due.getTime() / DAY) * DAY) : null, // không có hạn => để trống
    };
  });
}

export async function llmPlan(llm, input, signal) {
  const memberList = input.members.map((m) => `- id=${m.id}; tên=${m.name}; chức danh=${m.jobTitle || 'không rõ'}`).join('\n');
  const prompt = `Mục tiêu: ${input.goal}
Hạn hoàn thành: ${input.deadline ? input.deadline.toISOString().slice(0, 10) : 'KHÔNG CÓ (không được tự đặt hạn)'}
Số người tham gia: ${input.people || 'không giới hạn'}
Tổng giờ tối đa: ${input.maxHours || 'không giới hạn'}
Hôm nay: ${new Date().toISOString().slice(0, 10)}
Thành viên dự án:
${memberList}

Trả về DUY NHẤT một mảng JSON 5–15 phần tử, mỗi phần tử:
{"title": string, "description": string, "acceptanceCriteria": [string], "estimateHours": number, "priority": "low"|"medium"|"high", "assigneeId": string|null, "dueDate": "YYYY-MM-DD"|null}
Quy tắc: tổng estimateHours không vượt tổng giờ tối đa; assigneeId chỉ lấy từ danh sách thành viên; nếu không có hạn hoàn thành thì dueDate = null cho mọi việc; viết tiếng Việt, ngắn gọn.`;
  const out = await llm.complete({
    system: 'Bạn là trợ lý lập kế hoạch dự án phần mềm. Chỉ trả JSON hợp lệ, không giải thích.',
    prompt,
    maxTokens: 3000,
    signal,
  });
  const arr = parseJson(out.text);
  if (!Array.isArray(arr) || arr.length < 1) throw new Error('AI trả về định dạng không hợp lệ');
  const ids = new Set(input.members.map((m) => String(m.id)));
  const items = arr.slice(0, 15).map((x) => ({
    title: String(x.title || '').slice(0, 200),
    description: String(x.description || '').slice(0, 2000),
    acceptanceCriteria: (Array.isArray(x.acceptanceCriteria) ? x.acceptanceCriteria : []).map(String).slice(0, 8),
    estimateHours: Math.max(0, Number(x.estimateHours) || 0),
    priority: ['low', 'medium', 'high'].includes(x.priority) ? x.priority : 'medium',
    assignee: ids.has(String(x.assigneeId)) ? x.assigneeId : undefined,
    dueDate: input.deadline && x.dueDate && !Number.isNaN(Date.parse(x.dueDate)) ? new Date(x.dueDate) : null,
  }));
  return { items, inputTokens: out.inputTokens, outputTokens: out.outputTokens };
}

export async function generatePlan(llm, input, signal) {
  if (llm) return llmPlan(llm, input, signal);
  const items = localPlan(input);
  return { items, inputTokens: estimateTokens(input.goal) + 200, outputTokens: estimateTokens(JSON.stringify(items)) };
}
