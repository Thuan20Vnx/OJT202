import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { LocalClient } from './http.mjs';
import { hash, requireValue } from './core.mjs';

/** Database isolation is mandatory; a paid AI provider needs explicit caller opt-in. */
export async function startFixture({ production = false, build = null, provider = 'local', requestLimit = 2000 } = {}) {
  requireValue(['local', 'configured'].includes(provider), 'Provider must be local or configured');
  const apiKey = provider === 'configured' ? process.env.GEMINI_API_KEY : '';
  requireValue(provider === 'local' || apiKey, 'Configured provider needs an explicit GEMINI_API_KEY');
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: '', MAIL_MODE: 'outbox', GEMINI_API_KEY: apiKey ?? '', AI_SERVICE_KEY: randomBytes(24).toString('hex') });
  const uploads = await fs.mkdtemp(path.join(os.tmpdir(), 'taskflow-sprint4-'));
  process.env.UPLOAD_DIR = uploads;
  let ai, server, io, db;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      if (io) await new Promise((resolve) => io.close(resolve));
      for (const service of [server, ai]) if (service?.listening) { service.closeAllConnections(); await new Promise((resolve) => service.close(resolve)); }
    } finally {
      try { await db?.disconnectDb(); }
      finally {
        if (path.dirname(uploads) === os.tmpdir() && path.basename(uploads).startsWith('taskflow-sprint4-')) await fs.rm(uploads, { recursive: true, force: true });
      }
    }
  };
  try {
    const { createApp: aiApp, providerInfo } = await import('../../AIService/src/app.js');
    ai = http.createServer(aiApp());
    await new Promise((resolve) => ai.listen(0, '127.0.0.1', resolve));
    process.env.AI_SERVICE_URL = `http://127.0.0.1:${ai.address().port}`;
    db = await import('../../BackEnd/src/db.js');
    const { config } = await import('../../BackEnd/src/config.js');
    config.databaseUrl = '';
    config.uploadDir = uploads;
    // Never reuse developer/cloud storage for a disposable validation fixture.
    config.storage = { url: '', serviceKey: '', bucket: 'validation-local' };
    config.isProd = false;
    await db.connectDb({ ephemeral: true });
    const { seedDemo, DEMO_PASSWORD } = await import('../../BackEnd/src/seed.js');
    const seed = await seedDemo();
    config.ai.serviceUrl = process.env.AI_SERVICE_URL;
    config.isProd = production;
    config.release = build ? { revision: build.revision, sourceHash: build.sourceHash } : { revision: null, sourceHash: null };
    server = http.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    config.clientUrl = base;
    const { createApp } = await import('../../BackEnd/src/app.js');
    server.on('request', createApp());
    const { initRealtime } = await import('../../BackEnd/src/services/realtime.js');
    io = initRealtime(server);
    const actors = {};
    for (const [role, email] of Object.entries({ pm: 'mai.anh@nhom24.edu.vn', member: 'nhu@nhom24.edu.vn', viewer: 'khanh.linh@nhom24.edu.vn', outsider: 'dat@nhom24.edu.vn' })) {
      actors[role] = new LocalClient(base);
      const result = await actors[role].request('POST', '/api/auth/login', { email, password: DEMO_PASSWORD });
      requireValue(result.status === 200, `Fixture login ${role} failed`);
    }
    const ws = (await actors.pm.request('POST', '/api/workspaces', { name: 'Sprint 4 - isolated validation' })).data.workspace._id;
    for (const [key, role] of [['nhu', 'member'], ['linh', 'viewer']]) await db.prisma.membership.create({ data: { workspace: ws, user: seed.users[key].id, role, weeklyHours: 0 } });
    const project = (await actors.pm.request('POST', `/api/workspaces/${ws}/projects`, { name: 'Evaluation fixture v1', keyPrefix: 'EVAL', members: [seed.users.nhu.id, seed.users.linh.id] })).data.project._id;
    const projectRow = await db.prisma.project.findUnique({ where: { id: project } });
    await db.prisma.project.update({ where: { id: project }, data: { riskRules: { ...projectRow.riskRules, dueSoon: false } } });
    await db.prisma.workspace.update({ where: { id: ws }, data: { ai: { enabled: true, dailyLimit: requestLimit, timeoutSec: 30, features: { planner: true, report: true, qa: true, risk: true, meeting: false } } } });
    const now = new Date(), day = 86400000;
    const rows = [
      { title: 'API lịch họp có mã xác nhận EV123', description: 'Mã xác nhận của API lịch họp là EV123.', status: 'todo', dueDate: new Date(now - 2 * day), assignee: seed.users.nhu.id, estimateHours: 4, remainingHours: 4 },
      { title: 'Giao diện đang chờ API', status: 'todo', dueDate: new Date(now.getTime() + day), estimateHours: 2 },
      { title: 'Tài liệu đã hoàn thành', status: 'done', completedAt: now, remainingHours: 0 },
      { title: 'Kiểm thử chưa có hạn', status: 'in_progress' },
    ];
    const tasks = [];
    for (const row of rows) {
      const number = await db.nextSeq(`task:${project}`);
      tasks.push(await db.prisma.task.create({ data: { ...row, workspace: ws, project, number, key: `EVAL-${number}`, creator: seed.users.maianh.id } }));
    }
    await db.prisma.task.update({ where: { id: tasks[1].id }, data: { blockedBy: [tasks[0].id] } });
    const baseline = await db.prisma.task.findMany({ where: { project }, orderBy: { number: 'asc' } });
    const prepareScenario = async (scenario = 'standard') => {
      for (const task of baseline) {
        const { status, dueDate, remainingHours, completedAt, blockedBy, parent } = task;
        await db.prisma.task.update({ where: { id: task.id }, data: { status, dueDate, remainingHours, completedAt, blockedBy, parent, deletedAt: null } });
      }
      await db.prisma.membership.update({ where: { workspace_user: { workspace: ws, user: seed.users.nhu.id } }, data: { weeklyHours: scenario === 'available-capacity' ? 40 : 0 } });
      if (scenario === 'empty') await db.prisma.task.updateMany({ where: { project }, data: { deletedAt: new Date() } });
      if (scenario === 'done') await db.prisma.task.updateMany({ where: { project }, data: { status: 'done', completedAt: now, remainingHours: 0 } });
      if (scenario === 'no-deadline') await db.prisma.task.updateMany({ where: { project }, data: { dueDate: null } });
      if (scenario === 'reopened') await db.prisma.task.update({ where: { id: tasks[2].id }, data: { status: 'in_progress', completedAt: null } });
      if (scenario === 'no-dependency') await db.prisma.task.update({ where: { id: tasks[1].id }, data: { blockedBy: [] } });
      if (scenario === 'parent-child') await db.prisma.task.update({ where: { id: tasks[1].id }, data: { parent: tasks[0].id, blockedBy: [] } });
      if (scenario === 'blocker-done') await db.prisma.task.update({ where: { id: tasks[0].id }, data: { status: 'done', completedAt: now, remainingHours: 0 } });
    };
    const risks = await actors.pm.request('GET', `/api/projects/${project}/risks`);
    const riskKey = risks.data.open.find((alert) => alert.type === 'overdue').key;
    const existingCount = await db.prisma.task.count();
    for (let i = existingCount; i < 50; i++) {
      const number = await db.nextSeq(`task:${seed.projects.website.id}`);
      await db.prisma.task.create({ data: { workspace: seed.workspace.id, project: seed.projects.website.id, creator: seed.users.maianh.id, number, key: `TF-${number}`, title: `UAT dataset ${i + 1}` } });
    }
    requireValue(await db.prisma.workspace.count() >= 2 && await db.prisma.project.count() >= 3 && await db.prisma.task.count() >= 50, 'Demo dataset must contain 2 workspaces, 3 projects and 50 tasks');
    return { base, actors, project, workspace: ws, provider: providerInfo().type, variables: { project, riskKey }, seed, db, close, prepareScenario, dataset: { version: 'taskflow-evaluation-fixture-v2', hash: hash({ tasks: baseline, weeklyCapacity: 0, riskRules: { ...projectRow.riskRules, dueSoon: false } }), clock: now.toISOString(), taskCount: 4, expectedStats: { done: 1, overdue: 1, blocked: 1, totalTasks: 4, doneTotal: 1, progressPct: 25 } } };
  } catch (error) { await close(); throw error; }
}
