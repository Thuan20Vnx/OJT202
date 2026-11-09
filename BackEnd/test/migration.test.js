import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const db = await import('../src/db.js');
const { seedDemo } = await import('../src/seed.js');
const { config } = await import('../src/config.js');
after(() => db.disconnectDb());

test('migration nâng dữ liệu project cũ, giữ member/Viewer, PM và giờ còn lại', async () => {
  await db.connectDb({ ephemeral: true });
  const seed = await seedDemo();
  const taskColumns = await db.prisma.$queryRaw`
    SELECT column_name, udt_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'tasks'`;
  assert.ok(taskColumns.some(({ column_name }) => column_name === 'acceptance_criteria'));
  assert.ok(!taskColumns.some(({ column_name }) => column_name === 'acceptanceCriteria'));
  assert.equal(taskColumns.find(({ column_name }) => column_name === 'acceptance_criteria').udt_name, '_text');
  assert.ok(taskColumns.some(({ column_name }) => column_name === 'parent_task_id'));
  assert.ok(!taskColumns.some(({ column_name }) => column_name === 'parent_id'));
  assert.ok(taskColumns.some(({ column_name }) => column_name === 'checklist'));
  await db.prisma.task.findMany({ take: 1, select: { acceptanceCriteria: true, parent: true, checklist: true } });
  const criteriaTask = await db.prisma.task.findFirst({
    where: { project: seed.projects.website.id, acceptanceCriteria: { isEmpty: false } },
    select: { id: true, acceptanceCriteria: true },
  });
  assert.ok(criteriaTask?.acceptanceCriteria.length);
  const [{ port }] = await db.prisma.$queryRaw`SELECT inet_server_port() AS port`;
  assert.ok(port > 0);
  // Restore only the old schema inside this test's isolated, disposable database.
  await db.prisma.$executeRawUnsafe('DROP TABLE project_members');
  await db.prisma.$executeRawUnsafe('DROP TYPE "ProjectRole"');
  await db.prisma.$executeRawUnsafe('ALTER TABLE tasks DROP COLUMN "remainingHours"');
  await db.prisma.$executeRawUnsafe('ALTER TABLE tasks DROP COLUMN deleted_at');
  await db.prisma.$executeRawUnsafe('ALTER TABLE tasks DROP COLUMN checklist');
  await db.prisma.$executeRawUnsafe(`ALTER TABLE tasks ALTER COLUMN acceptance_criteria DROP DEFAULT`);
  await db.prisma.$executeRawUnsafe(`ALTER TABLE tasks ALTER COLUMN acceptance_criteria TYPE TEXT USING array_to_string(acceptance_criteria, E'\\n')`);
  await db.prisma.$executeRawUnsafe(`ALTER TABLE tasks ALTER COLUMN acceptance_criteria SET DEFAULT ''`);
  await db.prisma.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = '20261110100000_task_checklist_json'`;
  await db.prisma.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = '20261110103000_acceptance_criteria_array'`;
  await db.prisma.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = '20261029090000_task_soft_delete'`;
  await db.prisma.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = '20261028090000_project_roles'`;
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  await promisify(execFile)(process.execPath, [cli, 'migrate', 'deploy'], {
    cwd: config.root,
    env: { ...process.env, DATABASE_URL: `postgresql://taskflow:taskflow@localhost:${port}/taskflow` },
  });
  const website = await db.prisma.project.findUnique({ where: { id: seed.projects.website.id }, include: { memberships: true } });
  assert.equal(website.manager, seed.users.maianh.id);
  assert.equal(website.memberships.find((m) => m.user === seed.users.maianh.id).role, 'pm');
  assert.equal(website.memberships.find((m) => m.user === seed.users.linh.id).role, 'viewer');
  assert.deepEqual(website.members.sort(), website.memberships.map((m) => m.user).sort());
  assert.deepEqual((await db.prisma.task.findUnique({ where: { id: criteriaTask.id }, select: { acceptanceCriteria: true } })).acceptanceCriteria, criteriaTask.acceptanceCriteria);
  for (const task of await db.prisma.task.findMany()) {
    assert.equal(task.deletedAt, null, 'migration preserves all existing tasks as active');
    assert.equal(task.remainingHours, task.status === 'done' ? 0 : task.estimateHours == null ? null : Math.max(0, task.estimateHours - task.spentHours));
    assert.ok(Array.isArray(task.acceptanceCriteria));
  }
  assert.equal(await db.prisma.projectMember.count({ where: { project: seed.projects.mobile.id, user: seed.users.hoanganh.id } }), 0, 'không tự thêm Admin vào project private');
});
