import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { buildReportData } from '../../src/services/ai/report.js';
import { collectSources } from '../../src/services/ai/qa.js';
import { riskAlerts, workload } from '../../src/services/metrics.js';
import { config } from '../../src/config.js';

// Fixed development fixtures. They do not substitute for independent human acceptance.
export function locSprint3({ fixture, db, Client, seed, socketFor, join }) {
  const now = new Date('2026-11-05T05:00:00.000Z');
  const from = new Date('2026-11-01T17:00:00.000Z');
  const to = new Date('2026-11-08T17:00:00.000Z');
  const ago = new Date(now.getTime() - 86400000);
  const later = new Date(now.getTime() + 86400000);
  const done = (at) => ({ status: 'done', completedAt: at, remainingHours: 0 });
  async function dataset(records) {
    const f = await fixture();
    const ids = [];
    for (const [i, record] of records.entries()) {
      const { parentIndex, blockerIndex, ...data } = record;
      const task = await db.prisma.task.create({ data: {
        workspace: f.ws, project: f.pid, number: i + 1, key: `LS-${i + 1}`, title: `Nguồn ${i + 1}`,
        creator: seed().users.maianh.id, assignee: seed().users.nhu.id,
        ...data, ...(parentIndex != null && { parent: ids[parentIndex] }), ...(blockerIndex != null && { blockedBy: [ids[blockerIndex]] }),
      } });
      ids.push(task.id);
    }
    return { ...f, ids, project: await db.prisma.project.findUnique({ where: { id: f.pid } }) };
  }
  const reports = [
    ['R01 empty', [], [0, 0, 0, 0, 0, 0]],
    ['R02 todo', [{}], [0, 0, 0, 1, 0, 0]],
    ['R03 in progress', [{ status: 'in_progress' }], [0, 0, 0, 1, 0, 0]],
    ['R04 Review is not Done', [{ status: 'review' }], [0, 0, 0, 1, 0, 0]],
    ['R05 completed at start', [done(from)], [1, 0, 0, 1, 1, 100]],
    ['R06 completed before start', [done(new Date(from - 1))], [0, 0, 0, 1, 1, 100]],
    ['R07 completed at exclusive end', [done(to)], [0, 0, 0, 1, 1, 100]],
    ['R08 completed last millisecond', [done(new Date(to.getTime() - 1))], [1, 0, 0, 1, 1, 100]],
    ['R09 deleted Done', [{ ...done(now), deletedAt: now }], [0, 0, 0, 0, 0, 0]],
    ['R10 child not double counted', [{}, { ...done(now), parentIndex: 0 }], [0, 0, 0, 1, 0, 0]],
    ['R11 reopened', [{ status: 'in_progress', completedAt: null }], [0, 0, 0, 1, 0, 0]],
    ['R12 overdue at generated time', [{ dueDate: ago }], [0, 1, 0, 1, 0, 0]],
    ['R13 exactly deadline', [{ dueDate: now }], [0, 0, 0, 1, 0, 0]],
    ['R14 future deadline', [{ dueDate: later }], [0, 0, 0, 1, 0, 0]],
    ['R15 Done not overdue', [{ ...done(now), dueDate: ago }], [1, 0, 0, 1, 1, 100]],
    ['R16 blocked by unfinished', [{}, { blockerIndex: 0 }], [0, 0, 1, 2, 0, 0]],
    ['R17 blocker Done', [done(now), { blockerIndex: 0 }], [1, 0, 0, 2, 1, 50]],
    ['R18 deleted blocker', [{ deletedAt: now }, { blockerIndex: 0 }], [0, 0, 0, 1, 0, 0]],
    ['R19 mixed', [done(now), { dueDate: ago }, { blockerIndex: 1 }], [1, 1, 1, 3, 1, 33]],
    ['R20 no completion timestamp', [{ status: 'done' }], [0, 0, 0, 1, 1, 100]],
  ];
  describe('Lộc Sprint 3: 20 report snapshots', () => {
    for (const [name, records, expected] of reports) test(name, async () => {
      const f = await dataset(records);
      const r = await buildReportData(f.pid, from, to, f.project, now);
      const s = r.stats;
      assert.deepEqual([s.done, s.overdue, s.blocked, s.totalTasks, s.doneTotal, s.progressPct], expected);
      assert.equal(r.generatedAt.toISOString(), now.toISOString());
      for (const section of r.sections) for (const id of section.refs) assert.ok(r.sourceTasks.includes(id));
      for (const id of r.sourceTasks) assert.equal((await f.owner.get(`/tasks/${id}`)).status, 200);
    });
  });

  const riskCases = [
    ['K01 no due', [{}], {}, []],
    ['K02 Done', [{ ...done(now), dueDate: ago }], {}, []],
    ['K03 deleted', [{ dueDate: ago, deletedAt: now }], {}, []],
    ['K04 exactly deadline', [{ dueDate: now }], { overdueDays: 0 }, []],
    ['K05 one millisecond late', [{ dueDate: new Date(now - 1) }], { overdueDays: 0 }, ['overdue']],
    ['K06 below 1 day', [{ dueDate: new Date(ago.getTime() + 1) }], {}, []],
    ['K07 exactly 1 day', [{ dueDate: ago }], {}, ['overdue']],
    ['K08 rule off', [{ dueDate: ago }], { overdue: false }, []],
    ['K09 chain overdue', [{ dueDate: ago }, { blockerIndex: 0 }], { blockedByOverdue: true }, ['blocked', 'overdue']],
    ['K10 chain Done', [{ ...done(now), dueDate: ago }, { blockerIndex: 0 }], { blockedByOverdue: true }, []],
    ['K11 chain not overdue', [{ dueDate: now }, { blockerIndex: 0 }], { blockedByOverdue: true }, []],
    ['K12 zero capacity with work', [{ dueDate: now, remainingHours: 1 }], { overload: true }, ['overload'], 0],
    ['K13 zero capacity zero remaining', [{ dueDate: now, remainingHours: 0, estimateHours: 10 }], { overload: true }, [], 0],
    ['K14 exactly capacity', [{ dueDate: now, remainingHours: 10 }], { overload: true }, [], 10],
    ['K15 exceeds capacity', [{ dueDate: now, remainingHours: 10.01 }], { overload: true }, ['overload'], 10],
    ['K16 missing estimate flagged', [{ dueDate: now }], { overload: true }, [], 0],
    ['K17 weekly capacity absent uses explicit default', [{ dueDate: now, remainingHours: 21 }], { overload: true }, ['overload']],
    ['K18 parent ignored in workload', [{ dueDate: now, remainingHours: 100 }, { parentIndex: 0, dueDate: now, remainingHours: 2 }], { overload: true }, [], 2],
    ['K19 due in exactly 24h', [{ dueDate: later }], { dueSoon: true }, ['due_soon']],
    ['K20 due beyond 24h', [{ dueDate: new Date(later.getTime() + 1) }], { dueSoon: true }, []],
  ];
  describe('Lộc Sprint 3: 20 risk boundaries', () => {
    for (const [name, records, overrides, expected, capacity] of riskCases) test(name, async () => {
      const f = await dataset(records);
      await db.prisma.project.update({ where: { id: f.pid }, data: { riskRules: { overdueDays: 1, overdue: true, blockedByOverdue: false, overload: false, dueSoon: false, ...overrides } } });
      if (capacity != null) await db.prisma.membership.update({ where: { workspace_user: { workspace: f.ws, user: seed().users.nhu.id } }, data: { weeklyHours: capacity } });
      const result = await riskAlerts(f.pid, { now });
      assert.deepEqual(result.open.map((r) => r.type).sort(), [...expected].sort());
      for (const r of result.open) {
        assert.ok(r.rule && r.explanation && r.tasks.length && r.snapshot.tasks.length);
        assert.match(r.sourceVersion, /^[a-f0-9]{64}$/);
        for (const ref of r.tasks) assert.ok(f.ids.includes(ref.id));
      }
      if (name.startsWith('K16')) assert.equal((await workload(f.pid, null, now)).find((w) => w.user.id === seed().users.nhu.id).missingEstimates, 1);
      if (name.startsWith('K17')) assert.equal(result.open[0].snapshot.capacity.source, 'default');
    });
  });

  async function fakeAi(t, handler) {
    const previous = config.ai.serviceUrl;
    const server = http.createServer(handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    config.ai.serviceUrl = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => { config.ai.serviceUrl = previous; server.closeAllConnections(); await new Promise((r) => server.close(r)); });
  }
  const reply = (res, result) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ result, model: 'fixture', provider: 'test' })); };
  describe('Lộc Sprint 3: meeting, report, admin security', () => {
    test('U022: API half-open boundaries, project timezone, DST and immutable old reports', async () => {
      const boundary = new Date('2026-11-08T17:00:00Z');
      const f = await dataset([done(boundary)]);
      const post = (period) => f.owner.post(`/projects/${f.pid}/ai/reports`, period);
      const first = await post({ period_start: '2026-11-01T17:00:00Z', period_end: boundary.toISOString() });
      const second = await post({ period_start: boundary.toISOString(), period_end: '2026-11-15T17:00:00Z' });
      assert.equal(first.status, 201, JSON.stringify(first.data));
      assert.equal(second.status, 201, JSON.stringify(second.data));
      assert.deepEqual([first.data.report.stats.done, second.data.report.stats.done], [0, 1]);
      assert.equal(first.data.report.period_end, boundary.toISOString());
      assert.equal((await post({ period_start: '2026-11-08', period_end: '2026-11-08' })).status, 400);
      assert.equal((await post({ from: '2026-11-01', to: '2026-11-02', period_end: '2026-11-03' })).status, 400);
      assert.equal((await f.owner.patch(`/projects/${f.pid}`, { timezone: 'Mars/Olympus' })).status, 400);
      assert.equal((await f.member.patch(`/projects/${f.pid}`, { timezone: 'Asia/Tokyo' })).status, 403);
      assert.equal((await f.owner.patch(`/projects/${f.pid}`, { timezone: 'America/New_York' })).status, 200);
      const dst = await post({ from: '2026-03-08', to: '2026-03-08' });
      assert.equal(dst.status, 201, JSON.stringify(dst.data));
      assert.equal(dst.data.report.timezone, 'America/New_York');
      assert.equal((new Date(dst.data.report.to) - new Date(dst.data.report.from)) / 3600000, 23);
      const old = (await f.owner.get(`/ai/reports/${first.data.report._id}`)).data.report;
      assert.equal(old.timezone, 'Asia/Ho_Chi_Minh');
      assert.deepEqual(old.stats, first.data.report.stats);
      assert.equal(old.to, first.data.report.to);
      assert.equal(old.sourceState, 'changed');
    });
    test('U022: số ngày quá hạn chỉ tăng khi đủ 24 giờ', async () => {
      const f = await dataset([86400000 - 1, 86400000, 2 * 86400000 - 1, 2 * 86400000].map((ms) => ({ dueDate: new Date(now - ms) })));
      const r = await buildReportData(f.pid, from, to, f.project, now);
      const lines = r.sections.find((section) => section.key === 'late').body.split('\n');
      assert.deepEqual(lines.map((line) => line.slice(line.indexOf('quá hạn'))), ['quá hạn dưới 24 giờ', 'quá hạn 1 ngày', 'quá hạn 1 ngày', 'quá hạn 2 ngày']);
    });

    test('U022: không đưa task của dự án khác vào dependency, AI, chi tiết hoặc lịch sử báo cáo', async (t) => {
      const other = await dataset([{ key: 'PRIVATE-101', title: 'Nội dung riêng của dự án khác' }]);
      const f = await dataset([{}, { parentIndex: 0 }, { blockedBy: [other.ids[0]] }]);
      await db.prisma.task.update({ where: { id: f.ids[0] }, data: { blockedBy: [f.ids[1], other.ids[0]] } });
      const r = await buildReportData(f.pid, from, to, f.project, now);
      assert.equal(r.stats.blocked, 1);
      assert.deepEqual(r.sections.find((s) => s.key === 'blocked').refs, [f.ids[0], f.ids[1]]);
      assert.ok(r.sourceTasks.includes(f.ids[1]));
      let aiInput = '';
      await fakeAi(t, async (req, res) => {
        for await (const chunk of req) aiInput += chunk;
        reply(res, { summary: 'Báo cáo', suggestions: 'Kiểm tra tiến độ.' });
      });
      const created = await f.owner.post(`/projects/${f.pid}/ai/reports`, { from: '2026-11-02', to: '2026-11-08' });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      assert.ok(aiInput.includes('LS-2'));
      const id = created.data.report._id;
      await db.prisma.aiReport.update({ where: { id }, data: {
        sourceTasks: [f.ids[0], other.ids[0]], sections: [{ key: 'legacy', title: 'Nguồn', body: '', refs: [other.ids[0], f.ids[0], { id: other.ids[0], title: 'PRIVATE-101' }] }],
      } });
      const detail = await f.owner.get(`/ai/reports/${id}`);
      const list = await f.owner.get(`/projects/${f.pid}/ai/reports`);
      assert.equal(detail.status, 200);
      assert.equal(list.status, 200);
      assert.equal(detail.data.report.missingSources, 1);
      assert.deepEqual(detail.data.report.sections[0].refs.map((task) => task._id), [f.ids[0]]);
      assert.deepEqual(list.data.reports.find((report) => report._id === id).sourceTasks, [f.ids[0]]);
      const task = await f.owner.get(`/tasks/${f.ids[0]}`);
      assert.equal(task.status, 200);
      const qaSources = await collectSources(f.pid);
      assert.ok(qaSources.find((s) => s.refId === f.ids[0]).text.includes('LS-2'));
      for (const data of [r, aiInput, created.data, detail.data, list.data, task.data, qaSources]) {
        const json = JSON.stringify(data);
        assert.ok(!json.includes(other.ids[0]) && !json.includes('PRIVATE-101') && !json.includes('Nội dung riêng của dự án khác'));
      }
    });

    test('U026: cảnh báo vượt ngưỡng 80% chỉ dẫn tới task còn đóng góp giờ', async () => {
      const f = await dataset([{ remainingHours: 9, dueDate: ago }, { remainingHours: 0, dueDate: now }, { dueDate: now }]);
      await db.prisma.membership.update({ where: { workspace_user: { workspace: f.ws, user: seed().users.nhu.id } }, data: { weeklyHours: 10 } });
      f.project.riskRules = { overloadPct: 80 };
      const alert = (await riskAlerts(f.pid, { now, project: f.project })).open.find((a) => a.type === 'overload');
      assert.match(alert.explanation, /9 giờ, vượt ngưỡng 80% của 10 giờ/);
      assert.deepEqual(alert.tasks.map((t) => t.id), [f.ids[0]]);
      assert.deepEqual(alert.snapshot.tasks.map((t) => t.id), [f.ids[0]]);
    });

    test('U028: gửi đồng thời và thử lại khóa/mở khóa chỉ ghi audit khi đổi trạng thái', async () => {
      const system = await new Client().login('admin@taskflow.local');
      const uid = seed().users.nhu.id;
      const auditCount = (action) => db.prisma.adminAudit.count({ where: { targetUser: uid, action } });
      const before = await Promise.all([auditCount('lock'), auditCount('unlock')]);
      const route = `/admin/users/${uid}`;
      try {
        const lock = () => system.post(`${route}/lock`, { reason: 'Khác', note: 'Lý do ban đầu' });
        assert.deepEqual((await Promise.all([lock(), lock()])).map((r) => r.status), [200, 200]);
        assert.equal((await system.post(`${route}/lock`, { reason: 'Spam lời mời' })).status, 200);
        const user = await db.prisma.user.findUnique({ where: { id: uid } });
        assert.deepEqual([user.lockReason, user.lockNote], ['Khác', 'Lý do ban đầu']);
        assert.equal(await auditCount('lock'), before[0] + 1);
      } finally {
        const unlock = () => system.post(`${route}/unlock`);
        assert.deepEqual((await Promise.all([unlock(), unlock()])).map((r) => r.status), [200, 200]);
      }
      assert.equal(await auditCount('unlock'), before[1] + 1);
    });
    for (const status of [429, 500, 503]) test(`U023 review: upstream ${status} không lộ secret trong response/log và CRUD vẫn chạy`, async (t) => {
      const f = await fixture();
      const secret = 'sk-fixture-secret-never-log';
      let calls = 0;
      const logged = [];
      t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
      await fakeAi(t, (req, res) => { calls++; req.resume(); res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: secret, detail: secret, model: secret })); });
      const result = await f.owner.post(`/projects/${f.pid}/ai/meeting`, { title: 'Họp', text: 'Như: mình sẽ kiểm thử API.' });
      assert.equal(result.status, 503);
      assert.equal(calls, 1);
      const log = await db.prisma.aiCall.findFirst({ where: { workspace: f.ws } });
      assert.equal(log.error, `AI_UPSTREAM_HTTP_${status}`);
      assert.ok(log.latencyMs >= 0 && log.latencyMs < 60000, 'latency uses one monotonic clock');
      assert.equal(log.attempts.length, 1);
      assert.ok(log.finishedAt);
      assert.ok(!JSON.stringify([result, log, logged]).includes(secret));
      assert.equal((await f.owner.post(`/projects/${f.pid}/tasks`, { title: 'CRUD độc lập' })).status, 201);
    });

    test('U022: provider bịa hoàn thành không thay số liệu; snapshot giữ nguyên sau reopen và revoke chặn nguồn', async (t) => {
      const f = await dataset([done(now)]);
      await fakeAi(t, (req, res) => { req.resume(); reply(res, { summary: 'Đã hoàn thành 9999 việc BỊA', suggestions: 'Kiểm tra dữ liệu.' }); });
      const result = await f.owner.post(`/projects/${f.pid}/ai/reports`, { from: '2026-11-02', to: '2026-11-08' });
      assert.equal(result.status, 201, JSON.stringify(result.data));
      const report = result.data.report;
      assert.equal(report.stats.done, 1);
      assert.ok(!JSON.stringify(report).includes('9999'));
      assert.equal(report.sections.find((s) => s.key === 'summary').refs[0]._id, f.ids[0]);
      assert.equal((await f.owner.patch(`/ai/reports/${report._id}`, { share: true })).status, 200);
      assert.equal((await f.member.get(`/ai/reports/${report._id}`)).status, 200);
      await db.prisma.task.update({ where: { id: f.ids[0] }, data: { status: 'in_progress', completedAt: null, version: { increment: 1 } } });
      const saved = (await f.owner.get(`/ai/reports/${report._id}`)).data.report;
      assert.equal(saved.sourceState, 'changed');
      assert.deepEqual(saved.stats, report.stats);
      assert.equal(saved.generatedAt, report.generatedAt);
      await f.owner.patch(`/projects/${f.pid}`, { members: [seed().users.maianh.id] });
      assert.equal((await f.member.get(`/ai/reports/${report._id}`)).status, 404);
      assert.equal((await f.member.get(`/tasks/${f.ids[0]}`)).status, 404);
    });

    test('U027: nguồn bất biến, sửa preview, duyệt đồng thời một lần và từ chối nguồn bị sửa', async () => {
      const f = await fixture();
      const input = { title: 'Sprint 3', text: 'Như: mình sẽ viết API ngày 15/11/2026.' };
      const response = await f.owner.post(`/projects/${f.pid}/ai/meeting`, input);
      assert.equal(response.status, 201, JSON.stringify(response.data));
      const draft = response.data.draft;
      const item = draft.items[0];
      assert.equal(draft.input.text.slice(item.sourceSpan.start, item.sourceSpan.end), item.excerpt);
      assert.equal(draft.input.sourceHash, createHash('sha256').update(input.text).digest('hex'));
      assert.equal((await f.owner.patch(`/ai/drafts/${draft._id}`, { version: 1, items: [{ key: item.key, excerpt: 'Nguồn giả' }] })).status, 400);
      const edit = await f.owner.patch(`/ai/drafts/${draft._id}`, { version: 1, items: [{ key: item.key, title: 'API sau review' }] });
      assert.equal(edit.status, 200);
      const approvals = await Promise.all([1, 2].map(() => f.owner.post(`/ai/drafts/${draft._id}/approve`, { version: 2 })));
      assert.deepEqual(approvals.map((r) => r.status), [200, 200]);
      assert.equal(approvals[0].data.created[0]._id, approvals[1].data.created[0]._id);
      const task = await db.prisma.task.findFirst({ where: { project: f.pid } });
      assert.equal(task.title, 'API sau review');
      assert.equal(task.source, 'ai_meeting');
      assert.ok(task.description.includes(item.excerpt));
      assert.equal(await db.prisma.task.count({ where: { project: f.pid } }), 1);
      const next = (await f.owner.post(`/projects/${f.pid}/ai/meeting`, input)).data.draft;
      await db.prisma.aiDraft.update({ where: { id: next._id }, data: { input: { ...next.input, text: 'Nguồn đã bị đổi' } } });
      assert.equal((await f.owner.post(`/ai/drafts/${next._id}/approve`, { version: 1 })).status, 409);
      assert.equal(await db.prisma.task.count({ where: { project: f.pid } }), 1);
    });

    for (const action of ['lock', 'logout']) for (const feature of ['meeting', 'reports', 'ask', 'risk']) {
      test(`U028: ${action} khi ${feature} đang chạy chặn kết quả và ghi dữ liệu`, { timeout: 20000 }, async (t) => {
        const f = await dataset([{ dueDate: new Date(Date.now() - 2 * 86400000) }]);
        await f.owner.patch(`/projects/${f.pid}`, { manager: seed().users.nhu.id });
        const system = await new Client().login('admin@taskflow.local');
        const socket = await socketFor(f.member, t);
        assert.equal((await join(socket, f.pid)).ok, true);
        const disconnected = new Promise((resolve) => socket.once('disconnect', resolve));
        let release, arrive;
        const received = new Promise((r) => { arrive = r; });
        await fakeAi(t, (req, res) => { req.resume(); release = () => reply(res, { items: [], summary: 'Bí mật cũ', suggestions: '', content: 'Bí mật cũ', citations: [], explanation: 'Bí mật cũ' }); arrive(); });
        const routes = { meeting: ['ai/meeting', { title: 'Họp', text: 'Biên bản kiểm thử quyền' }], reports: ['ai/reports', { from: '2026-11-01', to: '2026-11-08' }], ask: ['ai/ask', { question: 'Tình hình dự án?' }], risk: ['risks/explain', { key: (await riskAlerts(f.pid)).open[0].key }] };
        const [route, body] = routes[feature];
        const pending = f.member.post(`/projects/${f.pid}/${route}`, body);
        await received;
        try {
          assert.equal((await system.post(`/admin/users/${seed().users.nhu.id}/${action}`, action === 'lock' ? { reason: 'Khác', note: 'Regression Sprint 3' } : {})).status, 200);
        } finally { release(); }
        const result = await pending;
        await disconnected;
        assert.equal(socket.connected, false);
        if (action === 'lock') await system.post(`/admin/users/${seed().users.nhu.id}/unlock`);
        assert.equal(result.status, 401, JSON.stringify(result.data));
        assert.ok(!JSON.stringify(result.data).includes('Bí mật cũ'));
        assert.equal(await db.prisma.aiDraft.count({ where: { project: f.pid } }), 0);
        assert.equal(await db.prisma.aiReport.count({ where: { project: f.pid } }), 0);
        assert.equal(await db.prisma.aiConversation.count({ where: { project: f.pid } }), 0);
        assert.equal((await f.member.get(`/projects/${f.pid}`)).status, 401);
      });
    }

    test('U028: khóa Owner giữ membership; unlock không hồi sinh phiên; không mass assign role; audit atomic', async (t) => {
      const f = await fixture();
      const system = await new Client().login('admin@taskflow.local');
      const uid = seed().users.maianh.id;
      assert.equal((await f.owner.post(`/admin/users/${uid}/lock`, { reason: 'Khác' })).status, 403);
      assert.equal((await f.owner.patch('/me', { isSystemAdmin: true })).status, 400);
      assert.equal((await system.get(`/projects/${f.pid}`)).status, 404);
      assert.equal((await system.post(`/admin/users/${uid}/lock`, { reason: 'Khác', isSystemAdmin: true })).status, 400);
      const original = db.prisma.$transaction;
      db.prisma.$transaction = (callback, options) => original.call(db.prisma, async (tx) => {
        tx.adminAudit.create = async () => { throw new Error('Loc Sprint3 simulated audit failure'); };
        return callback(tx);
      }, options);
      t.after(() => { db.prisma.$transaction = original; });
      try { assert.equal((await system.post(`/admin/users/${uid}/lock`, { reason: 'Khác' })).status, 500); }
      finally { db.prisma.$transaction = original; }
      assert.equal((await f.owner.get(`/projects/${f.pid}`)).status, 200);
      assert.equal((await system.post(`/admin/users/${uid}/lock`, { reason: 'Khác' })).status, 200);
      assert.equal((await f.owner.get(`/projects/${f.pid}`)).status, 401);
      assert.equal((await db.prisma.membership.findUnique({ where: { workspace_user: { workspace: f.ws, user: uid } } })).role, 'owner');
      assert.equal((await system.post(`/admin/users/${uid}/unlock`)).status, 200);
      assert.equal((await f.owner.get(`/projects/${f.pid}`)).status, 401);
      assert.equal((await (await new Client().login('mai.anh@nhom24.edu.vn')).get(`/projects/${f.pid}`)).status, 200);
    });
  });
}
