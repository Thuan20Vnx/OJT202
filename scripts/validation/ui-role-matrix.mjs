// U030-T2 – kiểm giao diện theo vai trò trên trình duyệt thật (Edge/Chromium, database tạm):
// nút/ô nhập chỉ hiện khi API cho phép, nguồn trích dẫn AI chỉ trỏ tới dữ liệu được đọc,
// thông báo và đường link không lộ dữ liệu sau khi mất quyền hoặc với người ngoài.
// Kỳ vọng của từng ô lấy từ quy tắc phân quyền phía server (access.js), không lấy từ giao diện.
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROLES = ['pm', 'member', 'viewer', 'outsider'];
const EMAIL = { pm: 'mai.anh@nhom24.edu.vn', member: 'nhu@nhom24.edu.vn', viewer: 'khanh.linh@nhom24.edu.vn', outsider: 'dat@nhom24.edu.vn' };

export async function uiRoleMatrix(fixture, out) {
  const { DEMO_PASSWORD } = await import('../../BackEnd/src/seed.js');
  const { db, actors, project, workspace, seed } = fixture;
  const prisma = db.prisma;
  const records = [];
  const check = (id, surface, role, expected, actual, note) => records.push({ id, surface, role, expected, actual, passed: JSON.stringify(expected) === JSON.stringify(actual), ...(note && { note }) });

  // ---------- Dữ liệu ----------
  const secretTask = await prisma.task.findFirst({ where: { project, title: { contains: 'EV123' } } });
  const SECRET_A = 'EV123';
  // Dự án B: Như từng là thành viên, được nhắc tên, rồi bị gỡ khỏi dự án.
  const projectB = (await actors.pm.request('POST', `/api/workspaces/${workspace}/projects`, { name: 'Dự án kín U030', keyPrefix: 'KIN', members: [seed.users.nhu.id] })).data.project._id;
  const SECRET_B = 'ZX4471';
  const taskB = (await actors.pm.request('POST', `/api/projects/${projectB}/tasks`, { title: `Hồ sơ kín mã ${SECRET_B}` })).data.task._id;
  const mention = await actors.pm.request('POST', `/api/tasks/${taskB}/comments`, { body: `Như xem giúp mã ${SECRET_B}`, mentions: [seed.users.nhu.id] });
  const notifBefore = await prisma.notification.count({ where: { user: seed.users.nhu.id, project: projectB } });
  check('setup-mention-notification', 'notification', 'member', true, mention.status === 201 && notifBefore > 0);
  // Đối chứng dương: Như cũng được nhắc ở dự án A (vẫn là thành viên) – thông báo này PHẢI còn hiện.
  await actors.pm.request('POST', `/api/tasks/${secretTask.id}/comments`, { body: 'Như kiểm tra giúp lịch họp', mentions: [seed.users.nhu.id] });
  await prisma.projectMember.delete({ where: { project_user: { project: projectB, user: seed.users.nhu.id } } });
  // Hỏi đáp có nguồn trong dự án A (bộ luật nội bộ, không gọi dịch vụ AI ngoài).
  const ask = await actors.member.request('POST', `/api/projects/${project}/ai/ask`, { question: 'Mã xác nhận của API lịch họp là gì?' });
  const reply = ask.data?.conversation?.messages?.at(-1);
  const projectTaskIds = new Set((await prisma.task.findMany({ where: { project }, select: { id: true } })).map((t) => t.id));
  const projectDocIds = new Set((await prisma.document.findMany({ where: { project }, select: { id: true } })).map((d) => d.id));
  check('qa-citations-in-scope', 'ai-source', 'member', true, ask.status === 200 && reply?.citations?.length > 0 && reply.citations.every((c) => projectTaskIds.has(c.refId) || projectDocIds.has(c.refId)));

  // Quy tắc phía server: chỉ PM tạo/xóa việc; PM + thành viên bình luận; Owner/Admin mời người.
  const expect = {
    createTask: { pm: true, member: false, viewer: false },
    taskMenu: { pm: true, member: false, viewer: false },
    commentBox: { pm: true, member: true, viewer: false },
    invite: { pm: true, member: false, viewer: false },
  };

  let browser;
  const errors = {};
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined), headless: true });
    for (const role of ROLES) {
      const context = await browser.newContext({ baseURL: fixture.base, viewport: { width: 1366, height: 900 } });
      const page = await context.newPage();
      errors[role] = [];
      page.on('pageerror', (e) => errors[role].push(e.message));
      const bodyText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      const settle = async () => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(400); };
      try {
        await page.goto('/login');
        await page.getByLabel('Email công việc').fill(EMAIL[role]);
        await page.locator('input[autocomplete="current-password"]').fill(DEMO_PASSWORD);
        await page.locator('form').getByRole('button', { name: 'Đăng nhập', exact: true }).click();
        await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 });
        // Mọi vai trò (kể cả người ngoài) cùng "trỏ" vào workspace/dự án A như khi mở một link được chia sẻ.
        await page.evaluate(({ ws, p }) => { localStorage.setItem('tf_ws', ws); localStorage.setItem('tf_project', p); }, { ws: workspace, p: project });

        await page.goto('/board'); await settle();
        if (role === 'outsider') {
          check('board-no-leak', 'board', role, false, (await bodyText()).includes(SECRET_A));
        } else {
          const create = page.getByRole('button', { name: 'Tạo công việc', exact: true }).first();
          const enabled = (await create.count()) > 0 && (await create.isVisible()) && (await create.isEnabled());
          check('create-task-button', 'board', role, expect.createTask[role], enabled);
          check('board-shows-project', 'board', role, true, (await bodyText()).includes(SECRET_A));
        }

        await page.goto(`/board?task=${secretTask.id}`); await settle();
        if (role === 'outsider') {
          check('task-deeplink-no-leak', 'task', role, false, (await bodyText()).includes(SECRET_A));
        } else {
          await page.getByRole('dialog').first().waitFor({ timeout: 10000 });
          check('task-delete-menu', 'task', role, expect.taskMenu[role], (await page.getByRole('button', { name: 'Thao tác công việc' }).count()) > 0);
          check('comment-box', 'task', role, expect.commentBox[role], (await page.getByPlaceholder(/Viết bình luận/).count()) > 0);
          if (!expect.commentBox[role]) check('comment-readonly-reason', 'task', role, true, (await bodyText()).includes('không bình luận được'));
        }

        // Link tới việc của dự án B: chỉ PM còn quyền.
        await page.goto(`/board?task=${taskB}`); await settle();
        check('foreign-task-deeplink', 'task', role, role === 'pm', (await bodyText()).includes(SECRET_B));

        if (role !== 'outsider') {
          await page.goto('/settings/members'); await settle();
          check('invite-button', 'settings', role, expect.invite[role], (await page.getByRole('button', { name: /Mời thành viên/ }).count()) > 0);
        }

        await page.goto('/notifications'); await settle();
        if (role === 'member') check('notifications-control-visible', 'notification', role, true, (await bodyText()).includes(secretTask.key), 'thông báo ở dự án còn quyền vẫn hiện');
        check('notifications-after-removal', 'notification', role, false, role !== 'pm' && /ZX4471|KIN-\d/.test(await bodyText()), role === 'member' ? 'Như đã được nhắc tên ở dự án B rồi bị gỡ' : undefined);

        if (role === 'member' || role === 'pm') {
          await page.goto('/ai/qa'); await settle();
          const item = page.getByRole('button').filter({ hasText: 'Mã xác nhận của API lịch họp là gì?' }).first();
          const own = role === 'member';
          // Lịch sử hỏi đáp là riêng của từng người: PM không thấy câu hỏi của Như.
          check('qa-history-private', 'ai-source', role, own, (await item.count()) > 0);
          if (own) {
            await item.click(); await settle();
            const labels = await page.locator('p.section-label:has-text("Nguồn trích dẫn")').count();
            check('qa-citations-rendered', 'ai-source', role, true, labels > 0);
            check('qa-citation-count', 'ai-source', role, reply?.citations?.length ?? 0, await page.locator('p.section-label:has-text("Nguồn trích dẫn") + div button').count());
          }
        } else {
          await page.goto('/ai/qa'); await settle();
          check('qa-history-private', 'ai-source', role, false, (await bodyText()).includes('Mã xác nhận của API lịch họp là gì?'));
        }
        await page.screenshot({ path: path.join(out, `ui-${role}.png`), fullPage: true, animations: 'disabled' });
      } catch (e) {
        check('flow-completed', 'browser', role, true, false, e.message.split('\n')[0].slice(0, 300));
        await page.screenshot({ path: path.join(out, `ui-${role}-error.png`), fullPage: true }).catch(() => {});
      } finally {
        await context.close();
      }
      check('no-page-errors', 'browser', role, [], errors[role]);
    }
  } finally {
    await browser?.close();
  }
  return { schemaVersion: 1, kind: 'ui-role-matrix', build: fixture.build ?? null, createdAt: new Date().toISOString(), roles: ROLES, records, passed: records.every((r) => r.passed) };
}
