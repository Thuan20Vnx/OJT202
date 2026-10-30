import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { smtpSandbox } from '../../BackEnd/test/helpers/smtp.js';

// Isolated DB/uploads: this suite never uses DATABASE_URL or the developer's stored files.
process.env.NODE_ENV = 'test';
process.env.MAIL_MODE = 'outbox';
process.env.DATABASE_URL = '';
const uploads = await fs.mkdtemp(path.join(os.tmpdir(), 'taskflow-sprint1-'));
process.env.UPLOAD_DIR = uploads;
process.env.ANTHROPIC_API_KEY = '';
const { createApp: createAiApp } = await import('../../AIService/src/app.js');
const aiServer = http.createServer(createAiApp());
await new Promise((resolve) => aiServer.listen(0, '127.0.0.1', resolve));
process.env.AI_SERVICE_URL = `http://127.0.0.1:${aiServer.address().port}`;
const db = await import('../../BackEnd/src/db.js');
const { config } = await import('../../BackEnd/src/config.js');
const { createApp } = await import('../../BackEnd/src/app.js');
const { initRealtime } = await import('../../BackEnd/src/services/realtime.js');
const { seedDemo, DEMO_PASSWORD } = await import('../../BackEnd/src/seed.js');
let server, realtime, browser, base, seed;
const errors = [];
const artifacts = path.resolve('.data/e2e');

before(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  await db.connectDb({ ephemeral: true });
  seed = await seedDemo();
  server = http.createServer(createApp());
  realtime = initRealtime(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  config.clientUrl = base;
  const channel = process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
  browser = await chromium.launch({ channel, headless: true });
});

after(async () => {
  await browser?.close();
  await new Promise((r) => aiServer.close(r));
  if (realtime) await new Promise((r) => realtime.close(r));
  if (server?.listening) await new Promise((r) => server.close(r));
  await db.disconnectDb();
  await fs.rm(uploads, { recursive: true, force: true });
});

async function context() {
  const ctx = await browser.newContext({ baseURL: base, viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  // Fonts/icons are decorative; the workflow must run without external network services.
  await ctx.route('**/*', (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
  return { ctx, page };
}

async function login(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email công việc').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(DEMO_PASSWORD);
  await page.locator('form').getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function status(page, name) {
  await page.getByRole('button', { name: 'Đổi trạng thái công việc' }).click();
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đổi trạng thái công việc' })).toContainText(name);
}

test('Như Sprint 2–4: My Tasks, comment retry/mention, nguồn tài liệu AI, capacity và responsive', { timeout: 120000 }, async () => {
  const owner = await context();
  const { page, ctx } = owner;
  try {
    await login(page, 'mai.anh@nhom24.edu.vn');
    const headers = { 'x-taskflow': '1' };
    const made = await ctx.request.post(`/api/workspaces/${seed.workspace.id}/projects`, { headers, data: { name: 'Như nghiệm chứng các sprint', keyPrefix: 'NHU', members: [seed.users.nhu.id] } });
    assert.equal(made.status(), 201);
    const project = (await made.json()).project;
    await page.evaluate(({ ws, project }) => { localStorage.setItem('tf_ws', ws); localStorage.setItem('tf_project', project); }, { ws: seed.workspace.id, project: project._id });
    const taskRes = await ctx.request.post(`/api/projects/${project._id}/tasks`, { headers, data: { title: 'Nhu kiểm thử tương tác', assignee: seed.users.maianh.id, estimateHours: 8 } });
    assert.equal(taskRes.status(), 201);
    const task = (await taskRes.json()).task;
    await page.goto('/my-tasks');
    await page.getByRole('textbox', { name: 'Tìm công việc', exact: true }).fill('Nhu kiểm thử');
    await expect(page.getByRole('button', { name: task.title, exact: true })).toBeVisible();
    await page.getByRole('button', { name: task.title, exact: true }).click();
    const comment = page.getByRole('textbox', { name: 'Nội dung bình luận' });
    await expect(comment).toBeVisible();
    await comment.fill('@Như');
    await comment.press('ArrowDown');
    await comment.press('Enter');
    await expect(comment).toHaveValue(/@.*Như /);
    await page.route(`**/api/tasks/${task._id}/comments`, (route) => route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Lỗi gửi để thử lại' }) }) : route.continue());
    await comment.fill('Bình luận cần giữ khi lỗi');
    await comment.press('Control+Enter');
    await expect(page.getByRole('alert').filter({ hasText: 'Lỗi gửi để thử lại' })).toBeVisible();
    await expect(comment).toHaveValue('Bình luận cần giữ khi lỗi');
    await page.unroute(`**/api/tasks/${task._id}/comments`);
    await comment.press('Control+Enter');
    await expect(comment).toHaveValue('');
    await expect(page.getByText('Bình luận cần giữ khi lỗi', { exact: true })).toBeVisible();

    const docRes = await ctx.request.post(`/api/projects/${project._id}/documents`, { headers, data: { name: 'Quy trình Sao Bắc', content: 'Mã nghiệm thu Sao Bắc là ORION742. Nhóm Sao Bắc chốt nghiệm thu vào thứ Sáu.' } });
    assert.equal(docRes.status(), 201);
    const doc = (await docRes.json()).document;
    await page.goto('/ai/qa');
    await expect(page.getByText('Nguồn được đọc trực tiếp khi hỏi; chưa có chỉ mục tìm kiếm nền.')).toBeVisible();
    await page.getByRole('textbox', { name: 'Câu hỏi về dự án' }).fill('Mã nghiệm thu Sao Bắc là gì?');
    await page.getByRole('button', { name: 'Gửi', exact: true }).click();
    await expect(page.getByRole('button').filter({ hasText: `${doc.name} · đoạn 1` })).toBeVisible();
    await page.screenshot({ path: path.join(artifacts, 'nhu-qa-citation.png'), fullPage: true });
    await page.getByRole('button').filter({ hasText: `${doc.name} · đoạn 1` }).click();
    await expect(page).toHaveURL(new RegExp(`document=${doc._id}`));
    await expect(page.getByText('Trích đoạn nội dung', { exact: true })).toBeVisible();
    await expect(page.getByText(/Mã nghiệm thu Sao Bắc là ORION742/)).toBeVisible();
    await page.goto('/overview');
    await page.getByRole('button', { name: 'Chỉnh giờ khả dụng' }).first().click();
    const hours = page.getByRole('spinbutton', { name: /Giờ khả dụng/ });
    await hours.fill('0');
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: /Giờ khả dụng/ })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/my-tasks');
    await expect(page.getByRole('button', { name: task.title, exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: path.join(artifacts, 'nhu-my-tasks-mobile.png'), fullPage: true });
    await page.goto('/documents');
    await expect(page.getByRole('button', { name: doc.name, exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(artifacts, 'nhu-documents-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('Như U031: My Tasks phân trang trên dataset 10.000 task', { timeout: 120000 }, async () => {
  const { ctx, page } = await context();
  try {
    await login(page, 'mai.anh@nhom24.edu.vn');
    const result = await ctx.request.post(`/api/workspaces/${seed.workspace.id}/projects`, { headers: { 'x-taskflow': '1' }, data: { name: 'Dataset UI 10000', keyPrefix: 'BIG' } });
    assert.equal(result.status(), 201);
    const project = (await result.json()).project;
    for (let batch = 0; batch < 10; batch++) {
      await db.prisma.task.createMany({ data: Array.from({ length: 1000 }, (_, i) => {
        const number = batch * 1000 + i + 1;
        return { workspace: seed.workspace.id, project: project._id, number, key: `BIG-${number}`, title: `Dataset lớn ${number}`, assignee: seed.users.maianh.id, creator: seed.users.maianh.id };
      }) });
    }
    await page.goto('/my-tasks');
    await page.getByRole('textbox', { name: 'Tìm công việc', exact: true }).fill('Dataset lớn');
    await expect(page.getByRole('button', { name: /^Dataset lớn \d+$/ })).toHaveCount(20);
    await expect(page.getByText(/trên 10000/)).toBeVisible();
    await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Dataset lớn \d+$/ })).toHaveCount(20);
    await expect(page.getByText(/21–40/)).toBeVisible();
    await page.screenshot({ path: path.join(artifacts, 'nhu-my-tasks-10000.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('U003/U007/U009: SMTP register/invite → task → remaining hours → Review/Done → realtime draft', { timeout: 90000 }, async (t) => {
  const { messages } = await smtpSandbox(t, config);
  const owner = await context();
  const member = await context();
  try {
    const page = owner.page;
    await page.goto('/register');
    await page.getByLabel('Họ và tên').fill('Hoàng Anh E2E');
    await page.getByLabel('Email công việc').fill('hoanganh.e2e@example.test');
    await page.locator('input[autocomplete="new-password"]').fill(DEMO_PASSWORD);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
    await expect(page.getByText('Đăng ký thành công!', { exact: true })).toBeVisible();
    const verificationToken = messages.at(-1).raw.match(/verify-email\?token=([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(verificationToken, 'verification email received through SMTP');
    await page.goto(`/verify-email?token=${verificationToken}`);
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10000 });
    await page.getByLabel('Tên workspace').fill('Sprint 1 Hoàng Anh');
    await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await page.getByRole('button', { name: 'Bỏ qua bước này', exact: true }).click();
    await page.getByLabel('Tên dự án').fill('Review mentor Sprint 1');
    await page.getByRole('button', { name: 'Vào workspace', exact: true }).click();
    await expect(page).toHaveURL(/\/board/);
    const project = await db.prisma.project.findFirst({ where: { name: 'Review mentor Sprint 1' } });

    // A second real account accepts the workspace invitation, then PM adds it to the project.
    await login(member.page, 'nhu@nhom24.edu.vn');
    assert.equal((await owner.ctx.request.post(`/api/workspaces/${project.workspace}/invites`, { headers: { 'x-taskflow': '1' }, data: { emails: ['nhu@nhom24.edu.vn'], role: 'member' } })).status(), 201);
    const token = messages.at(-1).raw.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(token, 'invitation email received through SMTP');
    assert.equal((await member.ctx.request.post(`/api/me/invites/${token}/accept`, { headers: { 'x-taskflow': '1' }, data: {} })).status(), 200);
    assert.equal((await owner.ctx.request.post(`/api/projects/${project.id}/members`, { headers: { 'x-taskflow': '1' }, data: { user: seed.users.nhu.id, role: 'member' } })).status(), 200);
    // A fresh load refreshes the project-member cache used by the assignee picker.
    await page.reload();
    await page.getByRole('button', { name: 'Tạo công việc', exact: true }).click();
    const create = page.getByRole('dialog');
    await create.getByLabel('Tên công việc').fill('Kiểm thử workflow Sprint 1');
    await create.getByRole('button', { name: 'Chọn người nhận' }).click();
    await create.getByRole('button', { name: /Như/ }).click();
    await create.getByRole('button', { name: 'Tạo công việc', exact: true }).click();
    await expect(create).not.toBeVisible();
    await expect(page.getByText('Kiểm thử workflow Sprint 1', { exact: true })).toBeVisible();
    const task = await db.prisma.task.findFirst({ where: { project: project.id, title: 'Kiểm thử workflow Sprint 1' } });

    await member.page.goto(`/board?task=${task.id}`);
    await expect(member.page.getByRole('dialog', { name: 'Chi tiết công việc' })).toBeVisible();
    await status(member.page, 'Đang thực hiện');
    await member.page.getByLabel('Giờ còn lại').fill('2.5');
    await member.page.getByRole('button', { name: 'Lưu giờ còn lại', exact: true }).click();
    await expect.poll(async () => (await db.prisma.task.findUnique({ where: { id: task.id } })).remainingHours).toBe(2.5);
    await expect(member.page.getByRole('button', { name: 'Lưu giờ còn lại', exact: true })).toBeDisabled();
    await status(member.page, 'Đang kiểm duyệt');
    await member.page.getByRole('button', { name: 'Đổi trạng thái công việc' }).click();
    await expect(member.page.getByRole('button', { name: 'Hoàn thành', exact: true })).toHaveCount(0);
    await member.page.getByRole('button', { name: 'Đổi trạng thái công việc' }).click();
    await member.page.getByRole('button', { name: 'Đóng', exact: true }).click();
    await expect(member.page.getByRole('button', { name: 'Tạo công việc', exact: true })).toBeDisabled();

    await page.goto(`/board?task=${task.id}`);
    await status(page, 'Hoàn thành');
    await expect.poll(async () => (await db.prisma.task.findUnique({ where: { id: task.id } })).completedAt).not.toBeNull();
    await status(page, 'Đang thực hiện');
    assert.equal((await db.prisma.task.findUnique({ where: { id: task.id } })).completedAt, null);
    const title = page.getByRole('dialog').locator('textarea').first();
    await title.fill('Bản nháp chưa lưu của Lộc');
    const currentTask = await db.prisma.task.findUnique({ where: { id: task.id } });
    assert.equal((await owner.ctx.request.patch(`/api/tasks/${task.id}`, { headers: { 'x-taskflow': '1' },
      data: { description: 'Server updated while editing', version: currentTask.version } })).status(), 200);
    await expect(page.getByText('Công việc vừa được người khác cập nhật.', { exact: false })).toBeVisible();
    await expect(title).toHaveValue('Bản nháp chưa lưu của Lộc');
    await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await expect(title).toHaveValue('Bản nháp chưa lưu của Lộc');
    await page.getByRole('button', { name: 'Tải lại', exact: true }).click();
    await expect(title).toHaveValue('Kiểm thử workflow Sprint 1');
    await page.getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.reload();
    await expect(page.getByText('Kiểm thử workflow Sprint 1', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(artifacts, 'sprint1-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator('aside')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Mở/đóng menu' })).toHaveAttribute('aria-expanded', 'false');
    await page.screenshot({ path: path.join(artifacts, 'sprint1-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1366, height: 900 });
    const disposableResponse = await owner.ctx.request.post(`/api/projects/${project.id}/tasks`, {
      headers: { 'x-taskflow': '1' }, data: { title: 'Xóa mềm qua giao diện' },
    });
    assert.equal(disposableResponse.status(), 201);
    const disposable = (await disposableResponse.json()).task;
    await page.goto(`/board?task=${disposable._id}`);
    await page.getByRole('button', { name: 'Thao tác công việc', exact: true }).click();
    await page.getByRole('button', { name: 'Xóa công việc', exact: true }).click();
    await page.getByRole('button', { name: 'Xóa tất cả', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Chi tiết công việc' })).not.toBeVisible();
    assert.ok((await db.prisma.task.findUnique({ where: { id: disposable._id } })).deletedAt);
    await page.reload();
    await expect(page.getByText('Xóa mềm qua giao diện', { exact: true })).toHaveCount(0);
    await page.goto('/projects');
    await page.getByRole('button', { name: 'Thao tác dự án Review mentor Sprint 1' }).click();
    await page.getByRole('button', { name: 'Sửa dự án', exact: true }).click();
    await page.getByLabel('Chuyển giao PM').selectOption(seed.users.nhu.id);
    await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await expect.poll(async () => (await db.prisma.project.findUnique({ where: { id: project.id } })).manager).toBe(seed.users.nhu.id);
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Thao tác dự án Review mentor Sprint 1' })).toHaveCount(0);
    await member.page.reload();
    await expect(member.page.getByRole('button', { name: 'Tạo công việc', exact: true })).toBeEnabled();
    assert.deepEqual(errors, []);
  } catch (e) {
    await owner.page.screenshot({ path: path.join(artifacts, 'sprint1-failure.png'), fullPage: true });
    throw e;
  } finally {
    await owner.ctx.close();
    await member.ctx.close();
  }
});

test('Như U009/U010: keyboard, API rollback, hai tab xung đột giữ draft và logout', { timeout: 90000 }, async () => {
  const owner = await context();
  try {
    const page = owner.page;
    await login(page, 'mai.anh@nhom24.edu.vn');
    const headers = { 'x-taskflow': '1' };
    const wsResponse = await owner.ctx.request.post('/api/workspaces', { headers, data: { name: 'Như keyboard regression' } });
    assert.equal(wsResponse.status(), 201);
    const ws = (await wsResponse.json()).workspace._id;
    const projectResponse = await owner.ctx.request.post(`/api/workspaces/${ws}/projects`, { headers, data: { name: 'Như Sprint 1' } });
    assert.equal(projectResponse.status(), 201);
    const project = (await projectResponse.json()).project;
    const created = await owner.ctx.request.post(`/api/projects/${project._id}/tasks`, { headers, data: { title: 'Như keyboard task', priority: 'high', dueDate: '2026-10-28' } });
    assert.equal(created.status(), 201);
    const task = (await created.json()).task;
    await page.goto(`/board?task=${task._id}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
    const select = page.getByRole('combobox', { name: `Trạng thái ${task.key}`, exact: true });
    await expect(select).toHaveValue('todo');
    await select.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await db.prisma.task.findUnique({ where: { id: task._id } })).status).toBe('in_progress');
    await page.reload();
    await expect(select).toHaveValue('in_progress');

    // Fault injection is restricted to this test's move endpoint.
    await page.route(`**/api/tasks/${task._id}/move`, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Lỗi move kiểm thử' }) }));
    await select.selectOption('review');
    await expect(page.getByText('Lỗi move kiểm thử', { exact: true })).toBeVisible();
    await expect(select).toHaveValue('in_progress');
    await page.unroute(`**/api/tasks/${task._id}/move`);

    const open = page.getByRole('button', { name: `Mở ${task.key}: Như keyboard task`, exact: true });
    await open.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Chi tiết công việc' });
    await expect(dialog).toBeVisible();
    const description = dialog.getByPlaceholder('Chưa có mô tả');
    await description.fill('Bản nháp Như chưa lưu');
    const second = await owner.ctx.newPage();
    await second.goto(`/board?task=${task._id}`);
    const other = second.getByRole('dialog', { name: 'Chi tiết công việc' });
    await other.getByPlaceholder('Chưa có mô tả').fill('Nội dung đã lưu từ tab khác');
    await other.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await expect.poll(async () => (await db.prisma.task.findUnique({ where: { id: task._id } })).description).toBe('Nội dung đã lưu từ tab khác');
    await expect(description).toHaveValue('Bản nháp Như chưa lưu');
    await dialog.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await expect(dialog.getByText(/thay đổi chưa lưu của bạn sẽ mất/)).toBeVisible();
    await expect(description).toHaveValue('Bản nháp Như chưa lưu');
    await dialog.getByRole('button', { name: 'Tải lại', exact: true }).click();
    await expect(description).toHaveValue('Nội dung đã lưu từ tab khác');
    await page.screenshot({ path: path.join(artifacts, 'nhu-task-detail.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(select).toBeVisible();
    await page.screenshot({ path: path.join(artifacts, 'nhu-keyboard-kanban.png'), fullPage: true });
    assert.equal((await owner.ctx.request.post('/api/auth/logout', { headers, data: {} })).status(), 200);
    await page.goto('/board');
    await expect(page).toHaveURL(/\/login/);
    assert.deepEqual(errors, []);
  } finally {
    await owner.ctx.close();
  }
});

test('Hoàng Anh Sprint 2: thông báo hai tab, mất mạng, capacity tuần, preview xóa và CSV', { timeout: 120000 }, async () => {
  const owner = await context();
  const member = await context();
  const headers = { 'x-taskflow': '1' };
  try {
    await login(owner.page, 'mai.anh@nhom24.edu.vn');
    await login(member.page, 'nhu@nhom24.edu.vn');
    const wsResponse = await owner.ctx.request.post('/api/workspaces', { headers, data: { name: 'Hoàng Anh Sprint 2' } });
    assert.equal(wsResponse.status(), 201);
    const ws = (await wsResponse.json()).workspace._id;
    await db.prisma.membership.create({ data: { workspace: ws, user: seed.users.nhu.id, role: 'member' } });
    const projectResponse = await owner.ctx.request.post(`/api/workspaces/${ws}/projects`, { headers, data: { name: 'Cộng tác Sprint 2', members: [seed.users.nhu.id] } });
    assert.equal(projectResponse.status(), 201);
    const project = (await projectResponse.json()).project;
    const make = async (fields) => {
      const response = await owner.ctx.request.post(`/api/projects/${project._id}/tasks`, { headers, data: fields });
      assert.equal(response.status(), 201);
      return (await response.json()).task;
    };
    const parent = await make({ title: 'Sprint 2 parent', assignee: seed.users.nhu.id, estimateHours: 20, dueDate: new Date().toISOString() });
    const child = await make({ title: 'Sprint 2 child', parent: parent._id, assignee: seed.users.nhu.id, estimateHours: 2, dueDate: new Date().toISOString() });
    const dependent = await make({ title: 'Sprint 2 dependent', blockedBy: [child._id] });
    const docResponse = await owner.ctx.request.post(`/api/projects/${project._id}/documents`, { headers, data: { name: 'Sprint 2 retained file', content: 'Giữ lại tài liệu khi xóa cây công việc.', task: parent._id } });
    assert.equal(docResponse.status(), 201);
    const doc = (await docResponse.json()).document;
    for (const page of [owner.page, member.page]) {
      await page.evaluate(({ ws, project }) => { localStorage.setItem('tf_ws', ws); localStorage.setItem('tf_project', project); }, { ws, project: project._id });
    }
    await member.page.goto('/notifications');
    const second = await member.ctx.newPage();
    await second.goto('/notifications');
    const readAll = member.page.getByRole('button', { name: 'Đánh dấu tất cả đã đọc', exact: true });
    await expect(readAll).toBeEnabled();
    await member.page.getByRole('switch', { name: 'Nhắc trước hạn chót 24 giờ', exact: true }).click();
    await expect.poll(async () => (await db.prisma.notificationPref.findUnique({ where: { user: seed.users.nhu.id } })).due_soon).toBe(false);
    await readAll.click();
    await expect(second.getByRole('button', { name: 'Đánh dấu tất cả đã đọc', exact: true })).toBeDisabled();
    await member.page.screenshot({ path: path.join(artifacts, 'hoanganh-sprint2-notifications.png'), fullPage: true });
    await member.page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await member.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await member.page.screenshot({ path: path.join(artifacts, 'hoanganh-sprint2-notifications-mobile.png'), fullPage: true });
    await member.page.setViewportSize({ width: 1366, height: 900 });
    await member.ctx.setOffline(true);
    await expect(member.page.getByRole('status').filter({ hasText: 'Đang kết nối lại cập nhật trực tiếp.' })).toBeVisible({ timeout: 15000 });
    await member.ctx.setOffline(false);
    await expect(member.page.getByRole('button', { name: 'Tải lại ngay', exact: true })).toHaveCount(0, { timeout: 15000 });
    assert.equal((await member.ctx.request.get(`/api/documents/${doc._id}/download`)).status(), 200);

    await owner.page.goto('/overview');
    await owner.page.getByRole('button', { name: 'Chỉnh giờ khả dụng', exact: true }).nth(1).click();
    await owner.page.getByRole('spinbutton', { name: `Giờ khả dụng ${seed.users.nhu.name}`, exact: true }).fill('0');
    await owner.page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(owner.page.getByRole('spinbutton', { name: /Giờ khả dụng/ })).toHaveCount(0);
    const overview = await (await owner.ctx.request.get(`/api/projects/${project._id}/overview`)).json();
    const load = overview.workload.find((w) => w.user._id === seed.users.nhu.id);
    assert.equal(load.hours, 2, 'task cha không được tính lặp');
    assert.equal(load.available, 0);
    assert.equal(load.capacitySource, 'week');
    await owner.page.screenshot({ path: path.join(artifacts, 'hoanganh-sprint2-weekly-capacity.png'), fullPage: true });

    await owner.page.goto(`/board?task=${parent._id}`);
    await owner.page.getByRole('button', { name: 'Thao tác công việc', exact: true }).click();
    await owner.page.getByRole('button', { name: 'Xóa công việc', exact: true }).click();
    const preview = owner.page.getByRole('dialog').last();
    await expect(preview.getByText(/Xóa 2 công việc/)).toBeVisible();
    const late = await make({ title: 'Task con vừa được thêm', parent: parent._id });
    await preview.getByRole('button', { name: 'Xóa tất cả', exact: true }).click();
    await expect(preview.getByText(late.title, { exact: false })).toBeVisible();
    await owner.page.screenshot({ path: path.join(artifacts, 'hoanganh-sprint2-delete-preview.png'), fullPage: true });
    await preview.getByRole('button', { name: 'Xóa tất cả', exact: true }).click();
    await expect(owner.page.getByRole('dialog', { name: 'Chi tiết công việc', exact: true })).toHaveCount(0);
    assert.equal((await db.prisma.document.findUnique({ where: { id: doc._id } })).task, null);
    assert.deepEqual((await db.prisma.task.findUnique({ where: { id: dependent._id } })).blockedBy, []);

    await owner.page.goto('/settings/activity');
    await expect(owner.page.getByRole('button', { name: 'Xuất CSV', exact: true })).toBeVisible();
    await owner.page.getByRole('button', { name: 'Xuất CSV', exact: true }).click();
    const exportModal = owner.page.getByRole('dialog', { name: 'Xuất nhật ký ra CSV', exact: true });
    const exportButton = exportModal.getByRole('button', { name: 'Xuất CSV', exact: true });
    await expect(exportButton).toBeEnabled();
    const [csv] = await Promise.all([owner.page.waitForEvent('download', { timeout: 10000 }), exportButton.click()]);
    assert.match(await fs.readFile(await csv.path(), 'utf8'), /Xóa công việc/);
    await owner.page.screenshot({ path: path.join(artifacts, 'hoanganh-sprint2-activity.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } catch (error) {
    await owner.page.screenshot({ path: path.join(artifacts, 'hoanganh-sprint2-failure.png'), fullPage: true });
    await fs.writeFile(path.join(artifacts, 'hoanganh-sprint2-failure.txt'), await owner.page.locator('body').innerText());
    throw error;
  } finally { await owner.ctx.close(); await member.ctx.close(); }
});

test('Hoàng Anh Sprint 3: planner hai tab, duyệt một lần, lý do xử lý rủi ro và biên bản có nguồn', { timeout: 120000 }, async () => {
  const { ctx, page } = await context();
  try {
    await login(page, 'mai.anh@nhom24.edu.vn');
    const headers = { 'x-taskflow': '1' };
    const wsResponse = await ctx.request.post('/api/workspaces', { headers, data: { name: 'Hoàng Anh Sprint 3 E2E' } });
    assert.equal(wsResponse.status(), 201);
    const ws = (await wsResponse.json()).workspace._id;
    const projectResponse = await ctx.request.post(`/api/workspaces/${ws}/projects`, { headers, data: { name: 'Hoàng Anh AI có duyệt', keyPrefix: 'HAAI' } });
    assert.equal(projectResponse.status(), 201);
    const project = (await projectResponse.json()).project;
    await page.evaluate(({ ws, pid }) => { localStorage.setItem('tf_ws', ws); localStorage.setItem('tf_project', pid); }, { ws, pid: project._id });
    await page.goto('/ai/planner');
    const goal = 'Xây dựng quản lý công việc Sprint 3';
    await page.getByRole('textbox', { name: 'Mục tiêu kế hoạch', exact: true }).fill(goal);
    const [generated] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/projects/${project._id}/ai/plan`) && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Tạo kế hoạch nháp', exact: true }).click(),
    ]);
    assert.equal(generated.status(), 201);
    const draft = (await generated.json()).draft;
    assert.equal(await db.prisma.task.count({ where: { project: project._id } }), 0);
    await page.getByTitle('Sửa', { exact: true }).first().click();
    await page.getByLabel('Tên công việc', { exact: true }).fill('Nội dung Hoàng Anh chưa lưu');
    const second = await ctx.newPage();
    second.on('pageerror', (e) => errors.push(e.message));
    await second.goto('/ai/planner');
    await second.getByRole('button').filter({ hasText: goal }).click();
    await second.getByTitle('Sửa', { exact: true }).first().click();
    await second.getByLabel('Tên công việc', { exact: true }).fill('Đã sửa từ tab hai');
    await second.getByRole('button', { name: 'Lưu sửa', exact: true }).click();
    await expect(second.getByText('Đã sửa từ tab hai', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Lưu sửa', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Tải bản mới', exact: true })).toBeVisible();
    await expect(page.getByLabel('Tên công việc', { exact: true })).toHaveValue('Nội dung Hoàng Anh chưa lưu');
    await page.getByRole('button', { name: 'Tải bản mới', exact: true }).click();
    await page.getByTitle('Sửa', { exact: true }).first().click();
    await page.getByLabel('Tên công việc', { exact: true }).fill('Hoàng Anh duyệt công việc có AC');
    await page.getByRole('button', { name: 'Chọn người nhận', exact: true }).click();
    await page.getByRole('button', { name: /Mai Anh/ }).last().click();
    await page.getByRole('button', { name: 'Lưu sửa', exact: true }).click();
    await expect(page.getByText('Hoàng Anh duyệt công việc có AC', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Duyệt & tạo/ })).toBeEnabled();
    await page.locator('#main-content').evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: path.join(artifacts, 'hoang-anh-sprint3-planner.png'), fullPage: true });
    await page.getByRole('button', { name: /Duyệt & tạo/ }).click();
    await expect(page.getByText('Đã duyệt – đã tạo công việc', { exact: true })).toBeVisible();
    const retry = await ctx.request.post(`/api/ai/drafts/${draft._id}/approve`, { headers, data: { version: 3 } });
    assert.equal(retry.status(), 200);
    assert.equal(await db.prisma.task.count({ where: { project: project._id } }), draft.items.length);
    assert.equal(await db.prisma.task.count({ where: { project: project._id, assignee: seed.users.maianh.id } }), 1);
    await second.close();

    const created = await ctx.request.post(`/api/projects/${project._id}/tasks`, { headers, data: { title: 'Nguồn cảnh báo Sprint 3', dueDate: new Date(Date.now() - 2 * 86400000).toISOString() } });
    assert.equal(created.status(), 201);
    const task = (await created.json()).task;
    await page.goto('/risks');
    await page.getByRole('button', { name: 'Diễn giải bằng AI' }).click();
    await expect(page.getByText('· Diễn giải bởi AI', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Đã xử lý', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Xử lý cảnh báo rủi ro' });
    await expect(modal.getByRole('button', { name: 'Xác nhận xử lý', exact: true })).toBeDisabled();
    await modal.getByLabel('Lý do xử lý', { exact: true }).fill('Đã họp và thống nhất phương án xử lý');
    await modal.getByRole('button', { name: 'Xác nhận xử lý', exact: true }).click();
    await expect(modal).not.toBeVisible();
    await expect(page.getByText('Đã họp và thống nhất phương án xử lý', { exact: true })).toBeVisible();
    const changed = await ctx.request.patch(`/api/tasks/${task._id}`, { headers, data: { version: task.version, title: 'Nguồn cảnh báo đã thay đổi Sprint 3' } });
    assert.equal(changed.status(), 200);
    await expect(page.getByRole('button', { name: 'Đã xử lý', exact: true })).toBeVisible();
    await expect(page.getByText('Nguồn đã thay đổi hoặc cảnh báo không còn áp dụng', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(artifacts, 'hoang-anh-sprint3-risks.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    const menu = page.getByRole('button', { name: 'Mở/đóng menu', exact: true });
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('aside')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Cảnh báo rủi ro', exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: path.join(artifacts, 'hoang-anh-sprint3-risks-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1366, height: 900 });

    await page.goto('/ai/meeting');
    await page.getByLabel('Tên cuộc họp', { exact: true }).fill('Hoàng Anh kiểm tra action items');
    await page.getByLabel('Biên bản / ghi chú họp (dán văn bản)', { exact: true }).fill('Cần ai đó kiểm thử API.\nMai Anh: mình sẽ viết tài liệu ngày 2099-02-15\nMai Anh: Không cần triển khai thanh toán nữa, hủy công việc này.');
    await page.getByRole('button', { name: 'Trích action items', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Action items nháp.*2/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chưa rõ người phụ trách', exact: true })).toHaveCount(1);
    await page.screenshot({ path: path.join(artifacts, 'hoang-anh-sprint3-meeting.png'), fullPage: true });
    await page.getByRole('button', { name: /Duyệt & tạo/ }).click();
    await expect(page.getByText('Đã duyệt – đã tạo công việc', { exact: true })).toBeVisible();
    assert.equal(await db.prisma.task.count({ where: { project: project._id } }), draft.items.length + 3);
    assert.deepEqual(errors, []);
  } catch (e) {
    await page.screenshot({ path: path.join(artifacts, 'hoang-anh-sprint3-failure.png'), fullPage: true });
    throw e;
  } finally { await ctx.close(); }
});

test('SMTP bị từ chối: màn hình cho gửi lại, không báo thư đã gửi thành công', { timeout: 30000 }, async (t) => {
  const { messages, state } = await smtpSandbox(t, config);
  const user = await context();
  try {
    state.reject = true;
    await user.page.goto('/register');
    await user.page.getByLabel('Họ và tên').fill('SMTP Retry E2E');
    await user.page.getByLabel('Email công việc').fill('smtp.retry.e2e@example.test');
    await user.page.locator('input[autocomplete="new-password"]').fill(DEMO_PASSWORD);
    await user.page.getByRole('checkbox').check();
    await user.page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
    await expect(user.page.getByText('Tài khoản đang chờ xác minh', { exact: true })).toBeVisible();
    await expect(user.page.getByText('Đăng ký thành công!', { exact: true })).toHaveCount(0);
    assert.equal(messages.length, 0);
    state.reject = false;
    await user.page.getByRole('button', { name: 'Gửi lại email', exact: true }).click();
    await expect(user.page.getByText('Đã yêu cầu gửi lại email xác minh.', { exact: false })).toBeVisible();
    assert.equal(messages.length, 1);
    const token = messages[0].raw.match(/verify-email\?token=([A-Za-z0-9_-]+)/)?.[1];
    await user.page.goto(`/verify-email?token=${token}`);
    await expect(user.page).toHaveURL(/\/onboarding/, { timeout: 10000 });
  } finally { await user.ctx.close(); }
});
