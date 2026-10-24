// Kiểm thử AIService: bộ AI nội bộ (không gọi mạng) + API HTTP mà BackEnd sử dụng.
// Chạy: npm test
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.ANTHROPIC_API_KEY = '';
process.env.AI_SERVICE_KEY = 'khoa-test';

const { parseDue, localMeeting, extractActions } = await import('../src/features/meeting.js');
const { localPlan, llmPlan } = await import('../src/features/planner.js');
const { writeNarrative } = await import('../src/features/report.js');
const { parseDate, dateKey } = await import('../src/dates.js');
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
  const res = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(key && { 'x-ai-service-key': key }) },
    body: body && JSON.stringify(body),
  });
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
      for (const maxHours of [1, 1.25, 2, 5, 25, 40, 60, 100, 5000]) {
        const items = localPlan({ goal, maxHours, members, deadline: null });
        assert.ok(items.length >= 5 && items.length <= 15, goal);
        assert.ok(items.reduce((s, x) => s + x.estimateHours, 0) <= maxHours + 1e-9, `${goal} / ${maxHours}`);
        assert.ok(items.every((x) => x.estimateHours > 0 && x.estimateHours <= 1000));
        assert.ok(items.every((x) => x.dueDate === null));
      }
    }
  });

  test('biên bản: ISO không bị đọc nhầm, ngày sai/thiếu tháng để trống, cuối ngày đúng profile', () => {
    const now = new Date('2026-10-22T18:00:00Z');
    for (const text of ['hạn 2027-02-15', 'hạn 15/02/2027', 'hạn 15.02.27']) assert.equal(parseDue(text, now).toISOString(), '2027-02-15T16:59:59.999Z');
    for (const text of ['ngày 31/02/2027', 'ngày 2027-02-29', 'ngày 30/13/2027', 'ngày 15', 'kiểm thử bảo mật']) assert.equal(parseDue(text, now), null, text);
    assert.equal(parseDue('hôm nay', now).toISOString(), '2026-10-23T16:59:59.999Z');
    assert.equal(parseDue('hôm nay', now, 'America/New_York').toISOString(), '2026-10-23T03:59:59.999Z');
    assert.equal(parseDue('hạn 29/02/2028', now).toISOString(), '2028-02-29T16:59:59.999Z');
  });

  test('biên bản: ngày mai đi qua DST vẫn đúng cuối ngày, không phụ thuộc TZ máy', () => {
    const original = process.env.TZ;
    try {
      for (const zone of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
        process.env.TZ = zone;
        assert.equal(parseDue('ngày mai', new Date('2026-03-07T12:00:00Z'), 'America/New_York').toISOString(), '2026-03-09T03:59:59.999Z');
        assert.equal(parseDue('ngày mai', new Date('2026-10-31T12:00:00Z'), 'America/New_York').toISOString(), '2026-11-02T04:59:59.999Z');
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  test('tên thành viên chứa ký tự regex vẫn nhận đúng và không làm hỏng biên bản', () => {
    const items = localMeeting('Lộc (QA): mình sẽ kiểm thử API hôm nay', [{ id: 'loc', name: 'Lộc (QA)' }]);
    assert.equal(items[0].assignee, 'loc');
  });

  test('báo cáo dùng ngày dự án Việt Nam trên máy chủ UTC', async () => {
    const data = { stats: { done: 1, progressPct: 10, doneTotal: 1, totalTasks: 10, overdue: 0, blocked: 0 }, risks: [], sections: [] };
    const result = await writeNarrative(null, { name: 'P' }, data, new Date('2026-10-22T17:00:00Z'), new Date('2026-10-23T16:59:59.999Z'));
    assert.match(result.summary, /23\/10 – 23\/10/);
  });

  test('kế hoạch giữ cuối ngày và không vượt timestamp hạn cụ thể', () => {
    const deadline = parseDate('2099-02-15', 'America/New_York', true);
    const items = localPlan({ goal: 'Xây dựng đăng nhập', maxHours: 1, members, deadline, timezone: 'America/New_York' });
    assert.equal(items.at(-1).dueDate.getTime(), deadline.getTime());
    assert.ok(items.every((it) => it.dueDate <= deadline && it.dueDate > new Date()));
    assert.equal(dateKey(items.at(-1).dueDate, 'America/New_York'), '2099-02-15');
    const exact = new Date('2099-02-15T14:30:00Z');
    assert.equal(localPlan({ goal: 'Xây dựng đăng nhập', members, deadline: exact }).at(-1).dueDate.getTime(), exact.getTime());
  });

  test('provider không được trả kế hoạch quá giờ, giờ vô hạn hoặc hạn sai', async () => {
    const input = { goal: 'Xây dựng API', maxHours: 1, members, deadline: parseDate('2099-02-15', undefined, true) };
    const provider = (item) => ({ complete: async () => ({ text: JSON.stringify([item]), inputTokens: 1, outputTokens: 1 }) });
    const valid = { title: 'Viết API', estimateHours: 1, dueDate: '2099-02-15', assigneeId: 'a' };
    for (const patch of [
      { estimateHours: 2 },
      { estimateHours: -1 },
      { estimateHours: 'Infinity' },
      { dueDate: '2099-02-16' },
      { dueDate: '2099-02-29' },
      { dueDate: '2000-01-01' },
    ])
      await assert.rejects(llmPlan(provider({ ...valid, ...patch }), input));
    const result = await llmPlan(provider(valid), input);
    assert.equal(result.items[0].dueDate.getTime(), input.deadline.getTime());
    assert.equal(result.items[0].estimateHours, 1);
  });

  test('provider biên bản: ngày sai để trống, ngày hợp lệ đổi về cuối ngày profile', async () => {
    const llm = {
      complete: async () => ({
        text: JSON.stringify([
          { title: 'Sai ngày', dueDate: '2027-02-31', assigneeId: 'a' },
          { title: 'Đúng ngày', dueDate: '2027-02-15', assigneeId: 'ngoài-dự-án' },
        ]),
        inputTokens: 1,
        outputTokens: 1,
      }),
    };
    const { items } = await extractActions(llm, { text: 'Biên bản thử', members, timezone: 'America/New_York' });
    assert.equal(items[0].dueDate, null);
    assert.equal(items[1].dueDate.toISOString(), '2027-02-16T04:59:59.999Z');
    assert.equal(items[1].assignee, undefined);
  });

  test('provider biên bản sai cấu trúc hoặc thiếu tiêu đề không được tạo việc rỗng', async () => {
    for (const output of [{ items: [] }, [null], [{ title: '   ' }]]) {
      const llm = { complete: async () => ({ text: JSON.stringify(output), inputTokens: 1, outputTokens: 1 }) };
      await assert.rejects(extractActions(llm, { text: 'Biên bản thử', members }), /không hợp lệ|thiếu tiêu đề/);
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
    for (const patch of [{ deadline: '2099-02-31' }, { deadline: '2000-01-01' }, { timezone: 'not-a-zone' }, { maxHours: 0.1 }])
      assert.equal((await call('/v1/planner', { goal: 'Xây dựng API', members, ...patch })).status, 400);
    assert.equal((await call('/v1/meeting', { text: 'Biên bản', members, timezone: 'invalid' })).status, 400);
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
    const rk = await call('/v1/risk', {
      alert: { rule: 'Quá hạn ≥ 1 ngày', title: 'TF-98 quá hạn 2 ngày', explanation: 'Đang chặn TF-103.', tasks: [{ key: 'TF-98', title: 'LB' }] },
    });
    assert.equal(rk.data.result.explanation, 'Đang chặn TF-103.');
  });
});
