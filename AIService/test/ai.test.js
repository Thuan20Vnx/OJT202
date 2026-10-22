// Kiểm thử AIService: bộ AI nội bộ (không gọi mạng) + API HTTP mà BackEnd sử dụng.
// Chạy: npm test
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ANTHROPIC_API_KEY = '';
process.env.AI_SERVICE_KEY = 'khoa-test';

const { parseDue, localMeeting } = await import('../src/features/meeting.js');
const { localPlan } = await import('../src/features/planner.js');
const { answer } = await import('../src/features/qa.js');
const { createApp } = await import('../src/app.js');

const members = [
  { id: 'a', name: 'Thuận', jobTitle: 'Backend' },
  { id: 'b', name: 'Mai Anh', jobTitle: 'PM' },
  { id: 'c', name: 'Như', jobTitle: 'Frontend / UI/UX' },
];

let server;
let base;
const call = async (path, body, key = 'khoa-test') => {
  const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(key && { 'x-ai-service-key': key }) }, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
};

before(async () => {
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

describe('Bộ AI nội bộ', () => {
  test('ghi chú họp: không rõ người/hạn thì để trống', () => {
    const items = localMeeting('Thuận: mình sẽ xong API WebSocket trước thứ 6\nMai Anh: cần ai đó kiểm thử bảo mật thanh toán\nNhư: cập nhật wireframe Thông báo', members);
    assert.equal(items.length, 3);
    assert.equal(items[0].assignee, 'a');
    assert.ok(items[0].dueDate instanceof Date);
    assert.equal(items[1].assignee, undefined);
    assert.equal(items[1].dueDate, null);
    assert.equal(items[2].assignee, 'c');
    assert.equal(parseDue('kiểm thử bảo mật'), null);
  });

  test('lập kế hoạch: tổng giờ không vượt mức tối đa sau làm tròn, không tự đặt hạn', () => {
    for (const goal of ['Tích hợp thanh toán VNPay và Momo', 'Xây dựng đăng nhập OTP', 'Dashboard AI gợi ý', 'App mobile chấm công']) {
      for (const maxHours of [25, 40, 60, 100]) {
        const items = localPlan({ goal, maxHours, members, deadline: null });
        assert.ok(items.length >= 5 && items.length <= 15, goal);
        assert.ok(items.reduce((s, x) => s + x.estimateHours, 0) <= maxHours, `${goal} / ${maxHours}`);
        assert.ok(items.every((x) => x.dueDate === null));
      }
    }
  });

  test('hỏi đáp: có trích dẫn khi có nguồn, từ chối khi thiếu chứng cứ', async () => {
    const sources = [{ kind: 'task', refId: 't1', label: 'TF-103 · Mô tả', text: 'TF-103 API WebSocket. Bị chặn bởi: TF-98 Load Balancer.', key: 'TF-103' }];
    const ok = await answer(null, { question: 'TF-103 bị chặn bởi gì?', projectName: 'Website', sources });
    assert.equal(ok.refused, false);
    assert.equal(ok.citations[0].refId, 't1');
    const no = await answer(null, { question: 'Giá vé máy bay đi Paris?', projectName: 'Website', sources });
    assert.equal(no.refused, true);
    assert.equal(no.citations.length, 0);
  });
});

describe('API HTTP', () => {
  test('health + thông tin nhà cung cấp', async () => {
    const r = await fetch(`${base}/health`).then((x) => x.json());
    assert.equal(r.ok, true);
    assert.deepEqual((await call('/v1/info')).data, { type: 'local', model: 'taskflow-local-rules' });
  });

  test('sai / thiếu khóa dùng chung bị từ chối (401)', async () => {
    assert.equal((await call('/v1/info', undefined, 'sai')).status, 401);
    assert.equal((await call('/v1/planner', { goal: 'x', members }, null)).status, 401);
  });

  test('dữ liệu không hợp lệ (400)', async () => {
    assert.equal((await call('/v1/planner', { members })).status, 400);
    assert.equal((await call('/v1/qa', { question: 'x', projectName: 'p', sources: 'không phải mảng' })).status, 400);
  });

  test('/v1/planner trả bản nháp + token + model', async () => {
    const r = await call('/v1/planner', { goal: 'Tích hợp thanh toán VNPay', maxHours: 40, people: 2, deadline: null, members });
    assert.equal(r.status, 200);
    assert.ok(r.data.result.items.length >= 5);
    assert.ok(r.data.inputTokens > 0 && r.data.outputTokens > 0);
    assert.equal(r.data.provider, 'local');
  });

  test('/v1/meeting, /v1/qa, /v1/report, /v1/risk', async () => {
    const m = await call('/v1/meeting', { text: 'Như: cập nhật giao diện giỏ hàng ngày mai', members });
    assert.equal(m.data.result.items[0].assignee, 'c');
    assert.ok(m.data.result.items[0].dueDate);
    const q = await call('/v1/qa', { question: 'Thời tiết hôm nay?', projectName: 'P', sources: [] });
    assert.equal(q.data.result.refused, true);
    const rp = await call('/v1/report', {
      project: { name: 'Website' },
      data: { stats: { done: 3, overdue: 1, blocked: 1, progressPct: 40, totalTasks: 10, doneTotal: 4 }, sections: [], risks: [{ title: 'TF-98 quá hạn', type: 'overdue' }] },
      from: '2026-10-14',
      to: '2026-10-21',
    });
    assert.match(rp.data.result.summary, /Website hoàn thành 3 công việc/);
    assert.match(rp.data.result.suggestions, /TF-98/);
    const rk = await call('/v1/risk', { alert: { rule: 'Quá hạn ≥ 1 ngày', title: 'TF-98 quá hạn 2 ngày', explanation: 'Đang chặn TF-103.', tasks: [{ key: 'TF-98', title: 'LB' }] } });
    assert.equal(rk.data.result.explanation, 'Đang chặn TF-103.');
  });
});
