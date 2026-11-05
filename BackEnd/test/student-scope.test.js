import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.MAIL_MODE = 'outbox';
process.env.PG_EMBEDDED_PORT = '54343';

const { config } = await import('../src/config.js');
const db = await import('../src/db.js');
const { createApp } = await import('../src/app.ts');

let server;
let base;
const PASSWORD = 'Matkhau123';

class Client {
  cookies = {};
  async req(method, path, body) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-taskflow': '1', cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      this.cookies[pair.slice(0, i)] = pair.slice(i + 1);
    }
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* CSV */ }
    return { status: res.status, data };
  }
  get = (p) => this.req('GET', p);
  post = (p, b = {}) => this.req('POST', p, b);
  patch = (p, b) => this.req('PATCH', p, b);
  del = (p) => this.req('DELETE', p);
}

let seq = 0;
async function user(name) {
  const email = `${name.toLowerCase()}${++seq}@scope.test`;
  const c = new Client();
  const r = await c.post('/auth/register', { name, email, password: PASSWORD, acceptTerms: true });
  assert.equal(r.status, 201);
  await db.prisma.user.update({ where: { email }, data: { emailVerified: true } });
  assert.equal((await c.post('/auth/login', { email, password: PASSWORD })).status, 200);
  c.email = email;
  c.id = (await c.get('/me')).data.user._id;
  return c;
}

/** Owner + workspace + dự án, các thành viên khác được thêm trực tiếp vào DB. */
async function team(extra = []) {
  const owner = await user('Owner');
  const ws = (await owner.post('/workspaces', { name: `Nhóm ${++seq}` })).data.workspace;
  const others = [];
  for (const name of extra) {
    const c = await user(name);
    await db.prisma.membership.create({ data: { workspace: ws._id, user: c.id, role: 'member' } });
    others.push(c);
  }
  const project = (await owner.post(`/workspaces/${ws._id}/projects`, { name: 'Đồ án', members: others.map((o) => o.id) })).data.project;
  return { owner, ws, project, others };
}

before(async () => {
  await db.connectDb({ ephemeral: true });
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.disconnectDb();
});

describe('Bảo mật đăng nhập và chống spam', () => {
  test('sai mật khẩu 5 lần thì khóa 5 phút, kể cả nhập đúng; hết khóa đăng nhập lại được', async () => {
    const c = await user('Lock');
    const anon = new Client();
    for (let i = 1; i <= 4; i++) {
      const r = await anon.post('/auth/login', { email: c.email, password: 'SaiMatKhau1' });
      assert.equal(r.status, 401);
      assert.equal(r.data.details.attemptsLeft, 5 - i);
    }
    const fifth = await anon.post('/auth/login', { email: c.email, password: 'SaiMatKhau1' });
    assert.equal(fifth.status, 429);
    assert.equal(fifth.data.details.code, 'LOGIN_LOCKED');
    const blocked = await anon.post('/auth/login', { email: c.email, password: PASSWORD });
    assert.equal(blocked.status, 429, 'đang khóa thì mật khẩu đúng cũng bị từ chối');
    assert.ok(blocked.data.details.retryAfterSec > 0 && blocked.data.details.retryAfterSec <= 300);
    // Giả lập đã qua 5 phút
    await db.prisma.rateCounter.updateMany({ where: { lockedUntil: { not: null } }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    assert.equal((await anon.post('/auth/login', { email: c.email, password: PASSWORD })).status, 200);
  });

  test('đăng nhập đúng xóa bộ đếm sai; email không tồn tại bị khóa y hệt nên không dò được', async () => {
    const c = await user('Reset');
    const anon = new Client();
    for (let i = 0; i < 4; i++) await anon.post('/auth/login', { email: c.email, password: 'SaiMatKhau1' });
    assert.equal((await anon.post('/auth/login', { email: c.email, password: PASSWORD })).status, 200);
    assert.equal((await anon.post('/auth/login', { email: c.email, password: 'SaiMatKhau1' })).data.details.attemptsLeft, 4);
    const ghost = 'khongtontai@scope.test';
    for (let i = 0; i < 4; i++) assert.equal((await anon.post('/auth/login', { email: ghost, password: 'SaiMatKhau1' })).status, 401);
    assert.equal((await anon.post('/auth/login', { email: ghost, password: 'SaiMatKhau1' })).status, 429);
  });

  test('giới hạn đăng ký theo IP, thời gian chờ gửi email, lời mời và bẫy bot', async () => {
    const anon = new Client();
    const trap = await anon.post('/auth/register', { name: 'Bot', email: 'bot@scope.test', password: PASSWORD, acceptTerms: true, website: 'http://spam' });
    assert.equal(trap.status, 201);
    assert.equal(await db.prisma.user.count({ where: { email: 'bot@scope.test' } }), 0, 'bot không tạo được tài khoản');

    const inviter = await team();
    config.security.throttle = true;
    const saved = config.security.registerPerIpPerHour;
    try {
      config.security.registerPerIpPerHour = 2;
      const reg = (i) => anon.post('/auth/register', { name: 'Spam', email: `spam${i}@scope.test`, password: PASSWORD, acceptTerms: true });
      assert.equal((await reg(1)).status, 201);
      assert.equal((await reg(2)).status, 201);
      const third = await reg(3);
      assert.equal(third.status, 429);
      assert.equal(third.data.details.code, 'RATE_LIMITED');

      const count = () => db.prisma.outbox.count({ where: { to: 'spam1@scope.test' } });
      const before = await count();
      assert.equal((await anon.post('/auth/resend-verification', { email: 'spam1@scope.test' })).status, 200);
      assert.equal(await count(), before + 1);
      assert.equal((await anon.post('/auth/resend-verification', { email: 'spam1@scope.test' })).status, 200, 'vẫn trả OK để không lộ thông tin');
      assert.equal(await count(), before + 1, 'trong 60 giây không gửi thêm thư');

      const emails = Array.from({ length: 20 }, (_, i) => `moi${i}@scope.test`);
      const url = `/workspaces/${inviter.ws._id}/invites`;
      for (let i = 0; i < 2; i++) assert.equal((await inviter.owner.post(url, { emails })).status, 201);
      assert.equal((await inviter.owner.post(url, { emails })).status, 429, 'quá 50 lời mời một giờ');
    } finally {
      config.security.throttle = false;
      config.security.registerPerIpPerHour = saved;
    }
  });
});

describe('Vai trò', () => {
  test('một người giữ nhiều vai trò chuyên môn; đổi hàng loạt là tất cả hoặc không ai', async () => {
    const { owner, ws, others: [a, b] } = await team(['An', 'Binh']);
    const url = `/workspaces/${ws._id}/members`;
    const single = await owner.patch(`${url}/${a.id}`, { specialties: ['developer', 'tester'] });
    assert.deepEqual(single.data.member.specialties, ['developer', 'tester']);
    assert.equal(single.data.member.role, 'member', 'vai trò chuyên môn không đổi quyền');

    const bulk = await owner.post(`${url}/bulk`, { users: [a.id, b.id], role: 'viewer', addSpecialties: ['ba'], removeSpecialties: ['tester'] });
    assert.equal(bulk.status, 200);
    assert.equal(bulk.data.updated, 2);
    const list = (await owner.get(url)).data.members;
    const of = (u) => list.find((m) => m.user._id === u.id);
    assert.deepEqual(of(a).specialties.sort(), ['ba', 'developer']);
    assert.equal(of(b).role, 'viewer');

    // Hạ cả Owner duy nhất ⇒ toàn bộ lô bị hoàn tác
    const fail = await owner.post(`${url}/bulk`, { users: [a.id, owner.id], role: 'member' });
    assert.equal(fail.status, 400);
    assert.equal((await owner.get(url)).data.members.find((m) => m.user._id === a.id).role, 'viewer', 'không đổi một phần');
    assert.equal((await owner.post(`${url}/bulk`, { users: [a.id] })).status, 400, 'phải có thay đổi');
    assert.equal((await owner.post(`${url}/bulk`, { users: [a.id], addSpecialties: ['hacker'] })).status, 400);
  });

  test('Admin không đổi hàng loạt được Owner/Admin, Member không gọi được', async () => {
    const { owner, ws, others: [admin, m] } = await team(['Admin', 'Mem']);
    await owner.patch(`/workspaces/${ws._id}/members/${admin.id}`, { role: 'admin' });
    const url = `/workspaces/${ws._id}/members/bulk`;
    assert.equal((await admin.post(url, { users: [owner.id], addSpecialties: ['ba'] })).status, 403);
    assert.equal((await admin.post(url, { users: [m.id], role: 'admin' })).status, 403);
    assert.equal((await m.post(url, { users: [m.id], role: 'owner' })).status, 403);
    assert.equal((await admin.post(url, { users: [m.id], addSpecialties: ['tester'] })).status, 200);
  });

  test('giảng viên xem mọi dự án kể cả dự án mới, được bình luận, không sửa được việc', async () => {
    const { owner, ws, project } = await team();
    const lecturer = await user('Lecturer');
    await db.prisma.membership.create({ data: { workspace: ws._id, user: lecturer.id, role: 'member' } });
    const set = await owner.patch(`/workspaces/${ws._id}/members/${lecturer.id}`, { isMentor: true });
    assert.equal(set.data.member.role, 'viewer');
    assert.equal((await lecturer.get(`/projects/${project._id}`)).status, 200);
    const later = (await owner.post(`/workspaces/${ws._id}/projects`, { name: 'Dự án sau' })).data.project;
    assert.equal((await lecturer.get(`/projects/${later._id}`)).status, 200);

    const task = (await owner.post(`/projects/${project._id}/tasks`, { title: 'Viết SRS' })).data.task;
    const detail = (await lecturer.get(`/tasks/${task._id}`)).data;
    assert.equal(detail.access.canComment, true);
    assert.equal(detail.access.canWrite, false);
    assert.equal((await lecturer.post(`/tasks/${task._id}/comments`, { body: 'Bổ sung use case' })).status, 201);
    assert.equal((await lecturer.patch(`/tasks/${task._id}`, { title: 'Sửa', version: task.version })).status, 403);
    assert.equal((await lecturer.post(`/projects/${project._id}/tasks`, { title: 'Mới' })).status, 403);

    const mentoring = (await lecturer.get('/me/mentoring')).data;
    assert.equal(mentoring.groups.length, 1);
    assert.equal(mentoring.groups[0].projects.length, 2);
    assert.equal(mentoring.groups[0].projects.find((p) => p._id === project._id).total, 1);
    assert.equal((await lecturer.get('/me')).data.workspaces[0].isMentor, true);
    assert.deepEqual((await owner.get('/me/mentoring')).data.groups, [], 'không phải giảng viên thì danh sách rỗng');

    // Viewer thường không bình luận được
    const viewer = await user('Viewer');
    await db.prisma.membership.create({ data: { workspace: ws._id, user: viewer.id, role: 'viewer' } });
    await db.prisma.projectMember.create({ data: { project: project._id, user: viewer.id, role: 'viewer' } });
    assert.equal((await viewer.post(`/tasks/${task._id}/comments`, { body: 'x' })).status, 403);
  });
});

describe('Giao việc nhiều người và nhãn', () => {
  test('tạo việc với người cùng làm: chia đều giờ, đúng tổng, cần người chính và ước lượng', async () => {
    const { owner, project, others: [a, b, c] } = await team(['An', 'Binh', 'Chi']);
    const url = `/projects/${project._id}/tasks`;
    assert.equal((await owner.post(url, { title: 'X', collaborators: [b.id] })).status, 400);
    assert.equal((await owner.post(url, { title: 'X', assignee: a.id, collaborators: [b.id] })).status, 400);
    const r = await owner.post(url, { title: 'X', assignee: a.id, collaborators: [b.id, c.id, a.id], estimateHours: 10 });
    assert.equal(r.status, 201);
    const hours = r.data.task.contributors.map((x) => x.plannedHours);
    assert.equal(hours.length, 3);
    assert.equal(Math.round(hours.reduce((s, h) => s + h, 0) * 100) / 100, 10);
    // Người cùng làm được cập nhật tiến độ việc đó
    assert.equal(r.data.task.assignee._id, a.id);
    const asB = (await b.get(`/tasks/${r.data.task._id}`)).data.access;
    assert.equal(asB.canUpdateProgress, true);
    const outsider = await user('Ngoai');
    assert.equal((await owner.post(url, { title: 'Y', assignee: a.id, collaborators: [outsider.id], estimateHours: 2 })).status, 400);
  });

  test('nhãn theo danh mục: không tách vì khác hoa thường, đổi tên/xóa cập nhật việc, có thống kê', async () => {
    const { owner, project, others: [a] } = await team(['An']);
    const url = `/projects/${project._id}`;
    assert.equal((await owner.post(`${url}/labels`, { name: 'Backend' })).status, 201);
    assert.equal((await owner.post(`${url}/labels`, { name: 'backend' })).data.name, 'Backend');
    assert.equal((await a.post(`${url}/labels`, { name: 'Lậu' })).status, 403);
    const t1 = (await owner.post(`${url}/tasks`, { title: 'A', labels: ['BACKEND', 'Bug'] })).data.task;
    assert.deepEqual(t1.labels, ['Backend', 'Bug']);
    assert.deepEqual((await owner.get(`${url}/labels`)).data.labels, ['Backend', 'Bug'], 'nhãn mới tự vào danh mục');
    await owner.post(`${url}/tasks`, { title: 'B', labels: ['Bug'] });
    await owner.post(`${url}/tasks`, { title: 'C' });
    const stats = (await owner.get(`${url}/overview`)).data.labels;
    assert.deepEqual(stats.rows.map((l) => [l.name, l.total]), [['Bug', 2], ['Backend', 1]]);
    assert.equal(stats.unlabeled, 1);
    assert.equal((await owner.patch(`${url}/labels/Bug`, { name: 'Lỗi' })).status, 200);
    assert.deepEqual((await owner.get(`/tasks/${t1._id}`)).data.task.labels.sort(), ['Backend', 'Lỗi']);
    assert.equal((await owner.del(`${url}/labels/Backend`)).status, 200);
    assert.deepEqual((await owner.get(`/tasks/${t1._id}`)).data.task.labels, ['Lỗi']);
    const filtered = (await owner.get(`${url}/tasks?label=${encodeURIComponent('Lỗi')}`)).data.tasks;
    assert.equal(filtered.length, 2);
  });
});

describe('Sprint, tiến độ, vấn đề, đóng góp', () => {
  test('nhiều Sprint: chỉ một Sprint chạy, đóng Sprint chuyển việc dở, giữ lịch sử', async () => {
    const { owner, project, others: [a] } = await team(['An']);
    const url = `/projects/${project._id}/sprints`;
    const s1 = (await owner.post(url, { name: 'Sprint 1', start: '2026-11-02', end: '2026-11-15' })).data.sprint;
    const s2 = (await owner.post(url, { name: 'Sprint 2', start: '2026-11-16', end: '2026-11-29' })).data.sprint;
    assert.equal((await owner.post(url, { name: 'sprint 1' })).status, 409);
    assert.equal((await a.post(url, { name: 'Lậu' })).status, 403);
    const noDates = (await owner.post(url, { name: 'Nháp' })).data.sprint;
    assert.equal((await owner.post(`${url}/${noDates._id}/start`, { version: noDates.version })).status, 400);
    const started = (await owner.post(`${url}/${s1._id}/start`, { version: s1.version })).data.sprint;
    assert.equal((await owner.post(`${url}/${s2._id}/start`, { version: s2.version })).status, 409, 'chỉ một Sprint chạy');
    assert.equal((await owner.get(`/projects/${project._id}`)).data.project.sprint.name, 'Sprint 1');

    const tasks = `/projects/${project._id}/tasks`;
    const inSprint = (await owner.post(tasks, { title: 'Trong Sprint', assignee: a.id })).data.task;
    assert.equal(inSprint.sprint, 'Sprint 1', 'việc mới mặc định vào Sprint đang chạy');
    const backlog = (await owner.post(tasks, { title: 'Backlog', sprint: '' })).data.task;
    const finished = (await owner.post(tasks, { title: 'Xong' })).data.task;
    await owner.patch(`/tasks/${finished._id}`, { status: 'review', version: finished.version });
    await owner.patch(`/tasks/${finished._id}`, { status: 'done', version: finished.version + 1 });

    let list = (await owner.get(url)).data;
    assert.deepEqual(list.backlog.map((t) => t._id), [backlog._id]);
    assert.equal(list.sprints.find((s) => s._id === s1._id).stats.total, 2);
    assert.ok(list.sprints.find((s) => s._id === s1._id).burndown, 'có burndown theo từng Sprint');
    assert.equal(list.sprints.find((s) => s._id === s1._id).burndown.total, 2, 'backlog không vào burndown');

    assert.equal((await owner.post(`${url}/assign`, { tasks: [backlog._id], sprint: s2._id })).data.moved, 1);
    const closed = await owner.post(`${url}/${s1._id}/close`, { version: started.version, moveTo: s2._id });
    assert.equal(closed.status, 200);
    assert.equal(closed.data.moved, 1, 'chỉ việc chưa xong được chuyển');
    list = (await owner.get(url)).data;
    assert.equal(list.sprints.find((s) => s._id === s1._id).stats.total, 1, 'việc đã xong ở lại Sprint cũ');
    assert.equal(list.sprints.find((s) => s._id === s2._id).stats.total, 2);
    assert.equal((await owner.get(`/projects/${project._id}`)).data.project.sprint.name, '');
    assert.equal((await owner.post(`${url}/assign`, { tasks: [backlog._id], sprint: s1._id })).status, 400, 'không xếp vào Sprint đã đóng');
    // Đổi tên Sprint cập nhật cả công việc
    const fresh = list.sprints.find((s) => s._id === s2._id);
    await owner.patch(`${url}/${s2._id}`, { name: 'Sprint Hai', version: fresh.version });
    assert.equal((await owner.get(`/tasks/${backlog._id}`)).data.task.sprint, 'Sprint Hai');
    // Sprint đã chạy không xóa được, Sprint chưa chạy xóa thì việc về backlog
    assert.equal((await owner.del(`${url}/${s1._id}`)).status, 400);
    assert.equal((await owner.del(`${url}/${s2._id}`)).status, 200);
    assert.equal((await owner.get(`/tasks/${backlog._id}`)).data.task.sprint, '');
  });

  test('tiến độ thực tế so với kế hoạch tính theo trọng số giờ, không đếm trùng việc cha', async () => {
    const { owner, project } = await team();
    const url = `/projects/${project._id}/tasks`;
    const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
    // 10 giờ, đã quá hạn nên kế hoạch 100%, thực tế 50%
    const late = (await owner.post(url, { title: 'Trễ', estimateHours: 10, plannedStartDate: iso(-10), dueDate: iso(-1) })).data.task;
    await db.prisma.task.update({ where: { id: late._id }, data: { progressPct: 50 } });
    // 10 giờ, đang ở giữa kỳ nên kế hoạch khoảng 50%, thực tế 0%
    await owner.post(url, { title: 'Giữa kỳ', estimateHours: 10, plannedStartDate: iso(-5), dueDate: iso(5) });
    // Chưa có hạn: không vào mốc kế hoạch
    await owner.post(url, { title: 'Chưa hạn', estimateHours: 10 });
    const { schedule } = (await owner.get(`/projects/${project._id}/overview`)).data;
    assert.equal(schedule.unscheduled, 1);
    assert.equal(schedule.plannedPct, 75);
    assert.equal(schedule.actualPct, 17);
    assert.equal(schedule.deltaPct, 25 - 75);
    // Có việc con thì việc cha không còn được tính
    await owner.post(url, { title: 'Con', parent: late._id, estimateHours: 1, dueDate: iso(30), plannedStartDate: iso(1) });
    const after2 = (await owner.get(`/projects/${project._id}/overview`)).data.schedule;
    assert.equal(after2.plannedPct, 45, 'việc cha 100% bị loại khỏi bình quân');
  });

  test('vấn đề cấp dự án: ốm không cần gắn việc, có trên trang tải, phân quyền đóng', async () => {
    const { owner, ws, project, others: [a, b] } = await team(['An', 'Binh']);
    const url = `/projects/${project._id}/issues`;
    const base2 = { title: 'An bị ốm', type: 'absence', severity: 'high', cause: 'Sốt', action: 'Bình làm thay' };
    assert.equal((await a.post(url, base2)).status, 400, 'vắng mặt cần người và khoảng ngày');
    const today = new Date().toISOString().slice(0, 10);
    const created = await a.post(url, { ...base2, affectedUser: a.id, startDate: today, endDate: today, owner: b.id });
    assert.equal(created.status, 201);
    assert.equal(created.data.issue.task, null);
    assert.equal(await db.prisma.notification.count({ where: { user: owner.id, dedupeKey: `issue:${created.data.issue._id}` } }), 1, 'PM được báo');
    const week = (await owner.get(`/workspaces/${ws._id}/team-workload`)).data.people.find((p) => p.user._id === a.id);
    assert.equal(week.absences.length, 1);

    const outsider = await user('Ngoai');
    assert.equal((await outsider.get(url)).status, 404);
    assert.equal((await a.post(url, { ...base2, type: 'technical', owner: outsider.id })).status, 400);
    const issue = (await owner.get(url)).data.issues[0];
    assert.equal(issue.affectedRef.name, 'An');
    const c = await user('Chi');
    await db.prisma.membership.create({ data: { workspace: ws._id, user: c.id, role: 'member' } });
    await owner.patch(`/projects/${project._id}`, { members: [owner.id, a.id, b.id, c.id] });
    assert.equal((await c.patch(`${url}/${issue._id}`, { version: issue.version, status: 'resolved', resolution: 'x' })).status, 403);
    assert.equal((await b.patch(`${url}/${issue._id}`, { version: issue.version, status: 'resolved', resolution: '' })).status, 400);
    assert.equal((await b.patch(`${url}/${issue._id}`, { version: issue.version, status: 'resolved', resolution: 'An đi làm lại' })).status, 200);
    assert.equal((await owner.get(`${url}?status=open`)).data.issues.length, 0);

    // Vấn đề tạo từ chi tiết công việc cũng hiện trong danh sách dự án
    const task = (await owner.post(`/projects/${project._id}/tasks`, { title: 'API' })).data.task;
    assert.equal((await owner.post(`/tasks/${task._id}/issues`, { title: 'Chờ API', severity: 'low', cause: 'Đối tác', action: 'Mock', owner: null })).status, 201);
    const all = (await owner.get(url)).data.issues;
    assert.equal(all.find((i) => i.title === 'Chờ API').taskRef.key, task.key);
  });

  test('bảng đóng góp tính theo từng người, lọc theo Sprint, CSV và không tính việc đã xóa', async () => {
    const { owner, project, others: [a, b] } = await team(['An', 'Binh']);
    const url = `/projects/${project._id}`;
    const sprint = (await owner.post(`${url}/sprints`, { name: 'S1', start: '2026-11-02', end: '2026-11-15' })).data.sprint;
    await owner.post(`${url}/sprints/${sprint._id}/start`, { version: sprint.version });
    const t = (await owner.post(`${url}/tasks`, { title: 'Chung', assignee: a.id, collaborators: [b.id], estimateHours: 8 })).data.task;
    const day = new Date().toISOString().slice(0, 10);
    const full = (await a.get(`/tasks/${t._id}`)).data.task;
    const log = await a.req('PUT', `/tasks/${t._id}/daily-updates/${day}`, { version: 0, taskVersion: full.version, hours: 3, completed: 'Làm API', nextStep: '', blockers: '', progressPct: 40, remainingHours: 1 });
    assert.equal(log.status, 200, JSON.stringify(log.data));
    await owner.post(`${url}/tasks`, { title: 'Ngoài Sprint', assignee: b.id, sprint: '' });
    const gone = (await owner.post(`${url}/tasks`, { title: 'Đã xóa', assignee: b.id })).data.task;
    await owner.del(`/tasks/${gone._id}`);
    await a.post(`/tasks/${t._id}/comments`, { body: 'Xong phần đầu' });

    const all = (await owner.get(`${url}/contributions`)).data;
    const row = (d, c) => d.rows.find((r) => r.user._id === c.id);
    assert.equal(row(all, a).assigned, 1);
    assert.equal(row(all, a).loggedHours, 3);
    assert.equal(row(all, a).sharePct, 100);
    assert.equal(row(all, a).comments, 1);
    assert.equal(row(all, a).plannedHours, 4);
    assert.equal(row(all, b).assigned, 2, 'người cùng làm cũng được tính, việc đã xóa thì không');
    const scoped = (await owner.get(`${url}/contributions?sprint=${sprint._id}`)).data;
    assert.equal(row(scoped, b).assigned, 1);
    assert.equal((await owner.get(`${url}/contributions?sprint=00000000-0000-0000-0000-000000000000`)).status, 404);
    const names = all.rows.map((r) => r.user.name);
    assert.deepEqual(names, [...names].sort((x, y) => x.localeCompare(y, 'vi')), 'sắp theo tên, không xếp hạng');
    const csv = await owner.get(`${url}/contributions.csv`);
    assert.equal(csv.status, 200);
    assert.match(csv.data, /Giờ đã ghi/);
    const outsider = await user('Ngoai');
    assert.equal((await outsider.get(`${url}/contributions`)).status, 404);
  });
});

describe('Tải tệp học tập', () => {
  test('nhận Word/Excel/PowerPoint/ZIP thật, chặn tệp đổi đuôi; không coi là ảnh scan', async () => {
    const { owner, project } = await team();
    const upload = async (name, bytes, type) => {
      const fd = new FormData();
      fd.append('files', new Blob([bytes], { type }), name);
      const res = await fetch(`${base}/api/projects/${project._id}/documents/upload`, {
        method: 'POST', body: fd,
        headers: { 'x-taskflow': '1', cookie: Object.entries(owner.cookies).map(([k, v]) => `${k}=${v}`).join('; ') },
      });
      return { status: res.status, data: await res.json() };
    };
    const zipBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(30)]);
    const word = await upload('SRS.docx', zipBytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(word.status, 201, JSON.stringify(word.data));
    assert.equal(word.data.documents[0].isScan, false);
    assert.equal((await upload('code.zip', zipBytes, 'application/x-zip-compressed')).status, 201);
    assert.equal((await upload('slide.pptx', zipBytes, 'application/octet-stream')).status, 201);
    assert.equal((await upload('virus.docx', Buffer.from('MZ-not-a-zip'), 'application/octet-stream')).status, 400);
    assert.equal((await upload('run.exe', Buffer.from('MZ'), 'application/octet-stream')).status, 400);
  });
});
