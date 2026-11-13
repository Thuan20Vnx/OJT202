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
  await db.prisma.aiReport.create({ data: {
    workspace: seed.workspace.id, project: seed.projects.website.id, user: seed.users.maianh.id,
    title: 'Historical report before period migration', from: new Date('2026-10-01T17:00:00Z'), to: new Date('2026-10-08T16:59:59.999Z'),
    generatedAt: new Date('2026-10-09T03:00:00Z'), stats: { done: 7, overdue: 2 },
  } });
  const historicReports = await db.prisma.aiReport.findMany({ select: { id: true, stats: true, from: true, to: true, generatedAt: true } });
  assert.ok(historicReports.length, 'upgrade includes an existing report snapshot');
  await db.prisma.$executeRawUnsafe('ALTER TABLE projects DROP COLUMN timezone');
  await db.prisma.$executeRawUnsafe('ALTER TABLE ai_reports DROP COLUMN timezone, DROP COLUMN "periodConvention"');
  await db.prisma.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = '20261106090000_report_period_timezone'`;
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
  await db.prisma.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = '20261113090000_acceptance_criteria_text_final'`;
  const checklistData = await db.prisma.checklistItem.findMany({ orderBy: [{ task: 'asc' }, { position: 'asc' }] });
  const parents = new Map((await db.prisma.$queryRaw`SELECT id, parent_task_id FROM tasks`).map((row) => [row.id, row.parent_task_id]));
  assert.ok(checklistData.length > 0, 'upgrade fixture includes populated checklists');
  const [{ legacyColumn }] = await db.prisma.$queryRaw`SELECT count(*)::int AS "legacyColumn" FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'checklist'`;
  assert.equal(legacyColumn, 0, 'DB mới khớp schema: không còn cột tasks.checklist');
  await db.prisma.$executeRawUnsafe(`ALTER TABLE tasks ADD COLUMN checklist JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.prisma.$executeRawUnsafe(`UPDATE tasks t SET checklist = (SELECT jsonb_agg(jsonb_build_object('text', c.title, 'done', c.is_done) ORDER BY c.position) FROM checklist_items c WHERE c.task_id = t.id) WHERE EXISTS (SELECT 1 FROM checklist_items c WHERE c.task_id = t.id)`);
  await db.prisma.$executeRawUnsafe('DROP TABLE checklist_items');
  await db.prisma.$executeRawUnsafe('ALTER TABLE tasks RENAME COLUMN parent_task_id TO parent_id');
  await db.prisma.$executeRawUnsafe('ALTER TABLE tasks RENAME CONSTRAINT tasks_parent_task_id_fkey TO tasks_parent_id_fkey');
  await db.prisma.$executeRawUnsafe('ALTER INDEX tasks_parent_task_id_idx RENAME TO tasks_parent_id_idx');
  await db.prisma.$executeRawUnsafe('DROP INDEX tasks_project_status_due_idx');
  await db.prisma.$executeRawUnsafe('DROP INDEX tasks_workspace_assignee_due_idx');
  await db.prisma.$executeRawUnsafe('ALTER TABLE comments DROP COLUMN deleted_at');
  await db.prisma.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = '20261102090000_sprint2_checklist_search'`;
  // Restore only the old schema inside this test's isolated, disposable database.
  await db.prisma.$executeRawUnsafe('DROP TABLE project_members');
  await db.prisma.$executeRawUnsafe('DROP TYPE "ProjectRole"');
  await db.prisma.$executeRawUnsafe('ALTER TABLE tasks DROP COLUMN "remainingHours"');
  await db.prisma.$executeRawUnsafe('ALTER TABLE tasks DROP COLUMN deleted_at');
  await db.prisma.$executeRawUnsafe('ALTER TABLE tasks DROP COLUMN "plannedStartDate", DROP COLUMN "actualStartDate", DROP COLUMN "actualEndDate"');
  await db.prisma.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = '20261030090000_task_timeline'`;
  await db.prisma.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = '20261029090000_task_soft_delete'`;
  await db.prisma.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = '20261028090000_project_roles'`;
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  await promisify(execFile)(process.execPath, [cli, 'migrate', 'deploy'], {
    cwd: config.root,
    env: { ...process.env, DATABASE_URL: `postgresql://taskflow:taskflow@localhost:${port}/taskflow` },
  });
  const website = await db.prisma.project.findUnique({ where: { id: seed.projects.website.id }, include: { memberships: true } });
  assert.equal(website.manager, seed.users.maianh.id);
  assert.equal(website.timezone, 'Asia/Ho_Chi_Minh');
  for (const historic of historicReports) {
    const report = await db.prisma.aiReport.findUniqueOrThrow({ where: { id: historic.id } });
    assert.equal(report.periodConvention, 'legacy-inclusive');
    assert.equal(report.timezone, null);
    for (const key of ['stats', 'from', 'to', 'generatedAt']) assert.deepEqual(report[key], historic[key], `preserve historical ${key}`);
  }
  assert.equal(website.memberships.find((m) => m.user === seed.users.maianh.id).role, 'pm');
  assert.equal(website.memberships.find((m) => m.user === seed.users.linh.id).role, 'viewer');
  assert.deepEqual(website.members.sort(), website.memberships.map((m) => m.user).sort());
  for (const task of await db.prisma.task.findMany()) {
    assert.equal(task.acceptanceCriteria, originalCriteria.get(task.id), 'migration giữ nguyên nội dung AC khi đổi array sang TEXT');
    assert.equal(task.deletedAt, null, 'migration preserves all existing tasks as active');
    assert.equal(task.plannedStartDate, null, 'không suy diễn ngày bắt đầu kế hoạch');
    assert.equal(task.actualStartDate, null, 'không suy diễn ngày bắt đầu thực tế');
    assert.equal(task.actualEndDate?.toISOString() ?? null, task.status === 'done' ? task.completedAt?.toISOString() ?? null : null);
    assert.equal(task.remainingHours, task.status === 'done' ? 0 : task.estimateHours == null ? null : Math.max(0, task.estimateHours - task.spentHours));
    assert.equal(typeof task.acceptanceCriteria, 'string');
  }
  const [column] = await db.prisma.$queryRaw`SELECT data_type FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'acceptance_criteria'`;
  assert.equal(column.data_type, 'text');
  const migratedChecklist = await db.prisma.checklistItem.findMany({ orderBy: [{ task: 'asc' }, { position: 'asc' }] });
  const values = (rows) => rows.map(({ task, title, isDone, position }) => ({ task, title, isDone, position }));
  assert.deepEqual(values(migratedChecklist), values(checklistData), 'Sprint 2 preserves checklist text, completion and order');
  for (const task of await db.prisma.task.findMany()) assert.equal(task.parent, parents.get(task.id));
  assert.equal(await db.prisma.comment.count({ where: { deletedAt: { not: null } } }), 0);
  const indexes = await db.prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE tablename = 'tasks'`;
  for (const name of ['tasks_project_status_due_idx', 'tasks_workspace_assignee_due_idx', 'tasks_parent_task_id_idx']) assert.ok(indexes.some((i) => i.indexname === name));
  assert.equal(await db.prisma.projectMember.count({ where: { project: seed.projects.mobile.id, user: seed.users.hoanganh.id } }), 0, 'không tự thêm Admin vào project private');

  // DB đã chạy 20261110100000_task_checklist_json: cột JSONB bị thêm lại. Task chưa có checklist_items mang dữ liệu
  // cũ phải được chuyển; task đã có checklist_items không bị nhân bản; sau đó cột bị xóa.
  const [withItems, withoutItems] = await Promise.all([
    db.prisma.task.findFirstOrThrow({ where: { checklistItems: { some: {} } }, include: { checklistItems: true } }),
    db.prisma.task.findFirstOrThrow({ where: { checklistItems: { none: {} } } }),
  ]);
  await db.prisma.$executeRawUnsafe(`ALTER TABLE tasks ADD COLUMN checklist JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.prisma.$executeRaw`UPDATE tasks SET checklist = '[{"text":"Không được nhân bản","done":true}]'::jsonb WHERE id = ${withItems.id}::uuid`;
  await db.prisma.$executeRaw`UPDATE tasks SET checklist = '[{"text":"Mục cũ một","done":true},{"text":"  ","done":false},{"text":"Mục cũ hai"}]'::jsonb WHERE id = ${withoutItems.id}::uuid`;
  await db.prisma.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = '20261113100000_drop_legacy_task_checklist'`;
  await promisify(execFile)(process.execPath, [cli, 'migrate', 'deploy'], {
    cwd: config.root,
    env: { ...process.env, DATABASE_URL: `postgresql://taskflow:taskflow@localhost:${port}/taskflow` },
  });
  const [{ dropped }] = await db.prisma.$queryRaw`SELECT count(*)::int AS dropped FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'checklist'`;
  assert.equal(dropped, 0, 'cột checklist thừa đã bị xóa');
  const kept = await db.prisma.checklistItem.findMany({ where: { task: withItems.id }, orderBy: { position: 'asc' } });
  assert.deepEqual(values(kept), values(withItems.checklistItems.sort((a, b) => a.position - b.position)), 'không nhân bản checklist đã có');
  const moved = await db.prisma.checklistItem.findMany({ where: { task: withoutItems.id }, orderBy: { position: 'asc' } });
  assert.deepEqual(moved.map(({ title, isDone }) => ({ title, isDone })), [{ title: 'Mục cũ một', isDone: true }, { title: 'Mục cũ hai', isDone: false }], 'chuyển dữ liệu cũ, bỏ mục rỗng');
});
