import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

// Isolated DB/uploads: this suite never uses DATABASE_URL or the developer's stored files.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const uploads = await fs.mkdtemp(path.join(os.tmpdir(), 'taskflow-sprint1-'));
process.env.UPLOAD_DIR = uploads;
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

test('U012-T3: register → verify → workspace → project → task → Member Review → PM Done/reopen', { timeout: 90000 }, async () => {
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
    const verification = await db.prisma.outbox.findFirst({ where: { to: 'hoanganh.e2e@example.test' }, orderBy: { createdAt: 'desc' } });
    await page.goto(new URL(verification.link).pathname + new URL(verification.link).search);
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
    const invite = await db.prisma.outbox.findFirst({ where: { to: 'nhu@nhom24.edu.vn' }, orderBy: { createdAt: 'desc' } });
    const token = new URL(invite.link).pathname.split('/').at(-1);
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
    await page.getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.reload();
    await expect(page.getByText('Kiểm thử workflow Sprint 1', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(artifacts, 'sprint1-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator('aside')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Mở/đóng menu' })).toHaveAttribute('aria-expanded', 'false');
    await page.screenshot({ path: path.join(artifacts, 'sprint1-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1366, height: 900 });
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
