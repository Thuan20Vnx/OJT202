// U031: sao lưu/khôi phục (pg_dump + tệp) và khóa workspace chia sẻ cho bình luận.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const db = await import('../src/db.js');
const { seedDemo } = await import('../src/seed.js');
const { config } = await import('../src/config.js');
const { backup, describe, findPgTool, pgEnv, restore, verifyBackup } = await import('../scripts/lib/backup-core.js');
const { withWorkspaceLock } = await import('../src/services/membership.js');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-backup-test-'));
let seed;
before(async () => {
  config.uploadDir = path.join(work, 'uploads');
  fs.mkdirSync(config.uploadDir);
  config.storage = { url: '', serviceKey: '', bucket: 'test' };
  await db.connectDb({ ephemeral: true });
  seed = await seedDemo();
});
after(async () => {
  await db.disconnectDb();
  fs.rmSync(work, { recursive: true, force: true });
});

test('pgEnv tách URL Prisma thành biến libpq, bỏ tham số riêng của Prisma; describe không lộ thông tin đăng nhập', () => {
  const env = pgEnv('postgresql://user.ref:p%40ss%3Aword@aws-0.pooler.supabase.com:5432/postgres?sslmode=require&connection_limit=10&pgbouncer=true');
  assert.deepEqual(env, { PGHOST: 'aws-0.pooler.supabase.com', PGPORT: '5432', PGUSER: 'user.ref', PGPASSWORD: 'p@ss:word', PGDATABASE: 'postgres', PGSSLMODE: 'require' });
  assert.equal(describe('postgresql://u:secret@h:6543/db'), 'h:6543/db');
  assert.throws(() => pgEnv('mysql://h/db'), /postgresql/);
});

test('khóa chia sẻ: hai bình luận không chờ nhau nhưng vẫn chờ thao tác đổi quyền (FOR UPDATE)', async () => {
  const ws = seed.workspace.id;
  let release;
  const holding = new Promise((r) => { release = r; });
  let entered;
  const entering = new Promise((r) => { entered = r; });
  const first = withWorkspaceLock(ws, async () => { entered(); await holding; }, { shared: true });
  await entering;
  // Khóa chia sẻ thứ hai vào ngay cả khi khóa đầu chưa nhả.
  const second = await Promise.race([withWorkspaceLock(ws, async () => 'vào được', { shared: true }), new Promise((r) => setTimeout(() => r('bị chặn'), 3000))]);
  assert.equal(second, 'vào được');
  // Khóa độc quyền phải đợi khóa chia sẻ.
  let exclusiveDone = false;
  const exclusive = withWorkspaceLock(ws, async () => { exclusiveDone = true; });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(exclusiveDone, false, 'FOR UPDATE không được chạy khi còn khóa chia sẻ');
  release();
  await first;
  await exclusive;
  assert.equal(exclusiveDone, true);
});

test('sao lưu → khôi phục vào database mới: số dòng từng bảng và tệp khớp; sửa tệp sao lưu bị phát hiện', async (t) => {
  const [{ major }] = await db.prisma.$queryRaw`SELECT (current_setting('server_version_num')::int / 10000) AS major`;
  let tools;
  try { tools = [await findPgTool('pg_dump'), await findPgTool('pg_restore')]; } catch { /* không cài client */ }
  if (!tools || tools.some((x) => x.major < major)) return t.skip(`Cần pg_dump/pg_restore >= ${major} (đặt PG_BIN)`);

  const key = `backup-test-${Date.now()}.txt`;
  fs.writeFileSync(path.join(config.uploadDir, key), 'nội dung tệp đính kèm');
  await db.prisma.document.create({ data: { workspace: seed.workspace.id, project: seed.projects.website.id, kind: 'file', name: 'a.txt', mime: 'text/plain', size: 10, storageKey: key, uploadedBy: seed.users.maianh.id } });
  const [{ port }] = await db.prisma.$queryRaw`SELECT inet_server_port() AS port`;
  const url = (name) => `postgresql://taskflow:taskflow@127.0.0.1:${port}/${name}`;

  // Lỗi kết nối không để lại thư mục dở dang, chạy lại cùng --out được.
  const failed = path.join(work, 'failed');
  await assert.rejects(backup({ url: `postgresql://x:y@127.0.0.1:1/none`, out: failed }));
  assert.equal(fs.existsSync(failed), false);

  // Có người ghi trong lúc sao lưu (như job nhắc hạn, rate_counters): số đếm phải cùng snapshot với bản dump.
  const out = path.join(work, 'backup');
  let writing = true, written = 0;
  const writer = (async () => {
    while (writing) {
      await db.prisma.$executeRawUnsafe(`INSERT INTO rate_counters(key, count) VALUES ('backup-race-${written++}', 1)`);
      await new Promise((r) => setTimeout(r, 5));
    }
  })();
  const manifest = await backup({ url: url('taskflow'), out, storage: { mode: 'local', dir: config.uploadDir } }).finally(() => { writing = false; });
  await writer;
  assert.ok(written > 0);
  assert.ok(manifest.tables.tasks > 0 && manifest.migrations.length > 0);
  assert.ok(manifest.files[`files/${key}`], 'tệp được documents tham chiếu nằm trong bản sao lưu');
  await assert.rejects(backup({ url: url('taskflow'), out }), /đã có dữ liệu/, 'không ghi đè bản sao lưu cũ');

  await db.prisma.$executeRawUnsafe('CREATE DATABASE restore_test');
  const restored = await restore({ from: out, url: url('restore_test'), storage: { mode: 'local', dir: path.join(work, 'restored-files') } });
  assert.equal(restored.verified, true, `bảng lệch: ${restored.mismatched}`);
  assert.equal(fs.readFileSync(path.join(work, 'restored-files', key), 'utf8'), 'nội dung tệp đính kèm');
  await assert.rejects(restore({ from: out, url: url('restore_test') }), /--clean/, 'database đích có dữ liệu thì phải bật clean');

  fs.appendFileSync(path.join(out, 'files', key), 'x');
  await assert.rejects(verifyBackup(out), /checksum/);
});
