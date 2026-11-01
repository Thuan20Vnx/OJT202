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
  const [{ port }] = await db.prisma.$queryRaw`SELECT inet_server_port() AS port`;
  assert.ok(port > 0);
  const sample = await db.prisma.task.findFirstOrThrow();
  const originalCriteria = new Map((await db.prisma.task.findMany()).map((task) => [task.id, task.acceptanceCriteria]));
  await db.prisma.$executeRawUnsafe('ALTER TABLE tasks RENAME COLUMN acceptance_criteria TO "acceptanceCriteria"');
  await db.prisma.$executeRawUnsafe('ALTER TABLE tasks ALTER COLUMN "acceptanceCriteria" DROP DEFAULT');
  await db.prisma.$executeRawUnsafe(`ALTER TABLE tasks ALTER COLUMN "acceptanceCriteria" TYPE TEXT[] USING CASE WHEN "acceptanceCriteria" = '' THEN ARRAY[]::TEXT[] ELSE ARRAY["acceptanceCriteria"] END`);
  await db.prisma.$executeRawUnsafe('ALTER TABLE tasks ALTER COLUMN "acceptanceCriteria" SET DEFAULT ARRAY[]::TEXT[]');
  await db.prisma.$executeRaw`UPDATE tasks SET "acceptanceCriteria" = ARRAY['Dòng một, có dấu', 'Dòng hai', '']::TEXT[] WHERE id = ${sample.id}::uuid`;
  originalCriteria.set(sample.id, 'Dòng một, có dấu\nDòng hai\n');
  await db.prisma.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = '20261101090000_acceptance_criteria_text'`;
  // Restore only the old schema inside this test's isolated, disposable database.
  await db.prisma.$executeRawUnsafe('DROP TABLE project_members');
  await db.prisma.$executeRawUnsafe('DROP TYPE "ProjectRole"');
  await db.prisma.$executeRawUnsafe('ALTER TABLE tasks DROP COLUMN "remainingHours"');
  await db.prisma.$executeRawUnsafe('ALTER TABLE tasks DROP COLUMN deleted_at');
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
  for (const task of await db.prisma.task.findMany()) {
    assert.equal(task.acceptanceCriteria, originalCriteria.get(task.id), 'migration giữ nguyên nội dung AC khi đổi array sang TEXT');
    assert.equal(task.deletedAt, null, 'migration preserves all existing tasks as active');
    assert.equal(task.remainingHours, task.status === 'done' ? 0 : task.estimateHours == null ? null : Math.max(0, task.estimateHours - task.spentHours));
  }
  const [column] = await db.prisma.$queryRaw`SELECT data_type FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'acceptance_criteria'`;
  assert.equal(column.data_type, 'text');
  assert.equal(await db.prisma.projectMember.count({ where: { project: seed.projects.mobile.id, user: seed.users.hoanganh.id } }), 0, 'không tự thêm Admin vào project private');
});
