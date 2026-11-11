import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const db = await import('../../../../BackEnd/src/db.js');
const { buildReportData } = await import('../../../../BackEnd/src/services/ai/report.js');
let project;
before(async () => {
  await db.connectDb({ ephemeral: true });
  const user = await db.prisma.user.create({ data: { name: 'Review', email: 'review@example.test', passwordHash: 'not-a-login' } });
  const workspace = await db.prisma.workspace.create({ data: { name: 'Isolated review', slug: 'isolated-review', owner: user.id } });
  project = await db.prisma.project.create({ data: { workspace: workspace.id, name: 'Report boundary', riskRules: { overload: false } } });
  await db.prisma.task.create({ data: { workspace: workspace.id, project: project.id, number: 1, key: 'REV-1', title: 'Exactly at boundary', status: 'done', completedAt: new Date('2026-11-08T17:00:00.000Z') } });
});
after(async () => { await db.disconnectDb(); });
test('Review U022: adjacent half-open periods must count a boundary task once (Process B255)', async () => {
  const start = new Date('2026-11-01T17:00:00.000Z');
  const boundary = new Date('2026-11-08T17:00:00.000Z');
  const end = new Date('2026-11-15T17:00:00.000Z');
  const now = new Date('2026-11-16T05:00:00.000Z');
  const first = await buildReportData(project.id, start, boundary, project, now);
  const second = await buildReportData(project.id, boundary, end, project, now);
  console.log(JSON.stringify({ firstPeriod: first.stats.done, secondPeriod: second.stats.done, expected: [0, 1] }));
  assert.deepEqual([first.stats.done, second.stats.done], [0, 1]);
});
