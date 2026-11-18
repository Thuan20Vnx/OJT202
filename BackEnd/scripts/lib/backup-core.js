// Sao lưu / khôi phục TaskFlow: database PostgreSQL (pg_dump định dạng custom, chỉ schema public)
// và các tệp tài liệu (UPLOAD_DIR hoặc Supabase Storage) được bảng documents tham chiếu.
// Mọi tệp trong bản sao lưu có SHA-256 trong manifest.json; khôi phục kiểm checksum trước khi ghi gì.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { config } from '../../src/config.js';
import { readFile, saveFile } from '../../src/services/storage.js';

const run = promisify(execFile);
export const MANIFEST = 'manifest.json';
const DUMP = 'database.dump';
const FILES = 'files';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const sha256File = (file) => new Promise((resolve, reject) => {
  const h = createHash('sha256');
  fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
});

/** Chuỗi kết nối mặc định của PostgreSQL nhúng khi DATABASE_URL trống (server dev phải đang chạy). */
export const embeddedUrl = () => `postgresql://taskflow:taskflow@localhost:${config.pgPort}/taskflow`;

/** Tách URL kiểu Prisma thành biến môi trường libpq: mật khẩu không nằm trên dòng lệnh, bỏ tham số riêng của Prisma. */
export function pgEnv(url) {
  const u = new URL(url);
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('Chuỗi kết nối phải là postgresql://');
  const env = {
    PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: decodeURIComponent(u.pathname.slice(1)) || 'postgres',
  };
  const ssl = u.searchParams.get('sslmode');
  if (ssl) env.PGSSLMODE = ssl;
  return env;
}

/** Mô tả nguồn không lộ mật khẩu/tên người dùng. */
export const describe = (url) => { const u = new URL(url); return `${u.hostname}:${u.port || 5432}/${u.pathname.slice(1)}`; };

/** Prisma cần URL không có tham số libpq lạ; giữ sslmode, đặt 1 kết nối. */
function prismaFor(url) {
  const u = new URL(url);
  for (const key of [...u.searchParams.keys()]) if (!['sslmode', 'pgbouncer', 'schema'].includes(key)) u.searchParams.delete(key);
  u.searchParams.set('connection_limit', '1');
  return new PrismaClient({ datasourceUrl: u.toString() });
}

/** Tìm pg_dump/pg_restore: PG_BIN → PATH → C:\Program Files\PostgreSQL\<bản mới nhất>\bin. */
export async function findPgTool(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const candidates = [];
  if (process.env.PG_BIN) {
    // Đã chỉ định rõ thì không lặng lẽ dùng bản khác (có thể cũ hơn server).
    const file = path.join(process.env.PG_BIN, exe);
    if (!fs.existsSync(file)) throw new Error(`PG_BIN=${process.env.PG_BIN} không có ${exe}`);
    candidates.push(file);
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) if (dir) candidates.push(path.join(dir, exe));
  if (process.platform === 'win32') {
    const base = 'C:\\Program Files\\PostgreSQL';
    if (fs.existsSync(base)) for (const v of fs.readdirSync(base).filter((d) => /^\d+$/.test(d)).sort((a, b) => b - a)) candidates.push(path.join(base, v, 'bin', exe));
  }
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const { stdout } = await run(file, ['--version'], { windowsHide: true });
    const major = Number(/(\d+)(?:\.\d+)?/.exec(stdout)?.[1]);
    if (major) return { file, major, version: stdout.trim() };
  }
  throw new Error(`Không tìm thấy ${name}. Cài PostgreSQL client (cùng hoặc mới hơn bản server) hoặc đặt PG_BIN trỏ tới thư mục bin.`);
}

/** Đếm dòng từng bảng trong schema public (dùng để đối chiếu sau khi khôi phục). */
export const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;
export async function tableCounts(db, schema = 'public') {
  if (!SCHEMA_RE.test(schema)) throw new Error('Tên schema không hợp lệ');
  const tables = await db.$queryRaw`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ${schema} AND table_type = 'BASE TABLE' ORDER BY table_name`;
  const counts = {};
  for (const { name } of tables) {
    const [{ n }] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${schema}"."${name.replaceAll('"', '""')}"`);
    counts[name] = n;
  }
  return counts;
}

async function serverMajor(db) {
  const [{ v }] = await db.$queryRaw`SELECT current_setting('server_version_num')::int AS v`;
  return Math.floor(v / 10000);
}

/** Đặt nơi lưu tệp cho storage.js: 'local' dùng thư mục, 'supabase' dùng biến môi trường SUPABASE_*. */
export function useStorage(target) {
  if (!target || target.mode === 'env') return config.storage.url && config.storage.serviceKey ? 'supabase' : 'local';
  if (target.mode === 'local') {
    config.storage = { ...config.storage, url: '', serviceKey: '' };
    config.uploadDir = path.resolve(target.dir);
    return 'local';
  }
  if (target.mode === 'supabase') {
    config.storage = { url: target.url, serviceKey: target.serviceKey, bucket: target.bucket };
    return 'supabase';
  }
  throw new Error('Chế độ lưu tệp không hợp lệ');
}

/**
 * Sao lưu database + tệp vào thư mục mới `out`. Chỉ ĐỌC nguồn.
 * Trả về manifest (có backupHash = SHA-256 của danh sách tệp + checksum).
 */
export async function backup({ url, out, storage, schema = 'public', includeFiles = true, log = () => {} }) {
  if (!SCHEMA_RE.test(schema)) throw new Error('Tên schema không hợp lệ');
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error(`Thư mục đích đã có dữ liệu: ${out}`);
  const created = !fs.existsSync(out);
  fs.mkdirSync(path.join(out, FILES), { recursive: true });
  const db = prismaFor(url);
  try {
    const major = await serverMajor(db);
    const pgDump = await findPgTool('pg_dump');
    if (pgDump.major < major) throw new Error(`pg_dump ${pgDump.major} cũ hơn server PostgreSQL ${major}`);
    const startedAt = new Date();
    log(`Đang dump database ${describe(url)} bằng ${pgDump.version}`);
    // Số đếm, migration, danh sách tệp và pg_dump cùng đọc MỘT snapshot (pg_export_snapshot + --snapshot),
    // nên database đang có người ghi (job nhắc hạn, rate_counters) cũng không làm lệch số khi khôi phục.
    const { before, migrations, keys } = await db.$transaction(async (tx) => {
      const [{ id }] = await tx.$queryRaw`SELECT pg_export_snapshot() AS id`;
      const before = await tableCounts(tx, schema);
      const migrations = (await tx.$queryRawUnsafe(`SELECT migration_name FROM "${schema}"._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`)).map((r) => r.migration_name);
      const keys = includeFiles ? (await tx.$queryRawUnsafe(`SELECT DISTINCT "storageKey" AS key FROM "${schema}".documents WHERE "storageKey" IS NOT NULL ORDER BY 1`)).map((r) => r.key) : [];
      await run(pgDump.file, ['--format=custom', `--schema=${schema}`, `--snapshot=${id}`, '--no-owner', '--no-privileges', '--compress=6', `--file=${path.join(out, DUMP)}`], {
        env: { ...process.env, ...pgEnv(url) }, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      });
      return { before, migrations, keys };
    }, { isolationLevel: 'RepeatableRead', maxWait: 30_000, timeout: 6 * 3600_000 });
    const files = { [DUMP]: await sha256File(path.join(out, DUMP)) };
    let storageMode = null, missing = [];
    if (includeFiles) {
      storageMode = useStorage(storage);
      log(`Đang chép ${keys.length} tệp từ ${storageMode === 'supabase' ? 'Supabase Storage' : 'UPLOAD_DIR'}`);
      for (const key of keys) {
        const name = path.basename(key);
        try {
          const bytes = await readFile(name);
          fs.writeFileSync(path.join(out, FILES, name), bytes);
          files[`${FILES}/${name}`] = sha256(bytes);
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
          missing.push(name);
        }
      }
    }
    const manifest = {
      schemaVersion: 1, kind: 'taskflow-backup', createdAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
      source: { database: describe(url), schema, serverMajor: major, tool: pgDump.version },
      migrations, tables: before, storage: storageMode, missingFiles: missing, files,
    };
    manifest.backupHash = sha256(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));
    fs.writeFileSync(path.join(out, MANIFEST), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    return manifest;
  } catch (error) {
    // Không để lại thư mục dở dang (chạy lại với cùng --out sẽ bị từ chối vì "đã có dữ liệu").
    // Thư mục có sẵn (trống) thì chỉ xóa những gì lệnh này tạo ra.
    if (created) fs.rmSync(out, { recursive: true, force: true });
    else for (const name of [FILES, DUMP, MANIFEST]) fs.rmSync(path.join(out, name), { recursive: true, force: true });
    throw error;
  } finally {
    await db.$disconnect();
  }
}

/** Kiểm tất cả checksum của một bản sao lưu; ném lỗi nếu thiếu/sai tệp. */
export async function verifyBackup(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
  if (manifest.kind !== 'taskflow-backup' || manifest.schemaVersion !== 1) throw new Error('manifest.json không phải bản sao lưu TaskFlow');
  for (const [rel, expected] of Object.entries(manifest.files)) {
    if (rel.split(/[\\/]/).includes('..') || path.isAbsolute(rel)) throw new Error(`Đường dẫn không hợp lệ trong manifest: ${rel}`);
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) throw new Error(`Thiếu tệp ${rel}`);
    if ((await sha256File(file)) !== expected) throw new Error(`Sai checksum: ${rel}`);
  }
  const hash = sha256(JSON.stringify(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b))));
  if (hash !== manifest.backupHash) throw new Error('backupHash không khớp danh sách tệp');
  return manifest;
}

/**
 * Khôi phục vào database `url` (phải là database được chỉ định rõ). `clean` cho phép ghi đè database đang có dữ liệu.
 * Sau khi khôi phục, đếm lại từng bảng và so với manifest; tệp được ghi vào nơi lưu `storage`.
 */
export async function restore({ from, url, storage, clean = false, includeFiles = true, log = () => {} }) {
  const manifest = await verifyBackup(from);
  const schema = manifest.source.schema ?? 'public';
  if (!SCHEMA_RE.test(schema)) throw new Error('Tên schema trong manifest không hợp lệ');
  const db = prismaFor(url);
  try {
    const major = await serverMajor(db);
    const pgRestore = await findPgTool('pg_restore');
    if (pgRestore.major < manifest.source.serverMajor) throw new Error(`pg_restore ${pgRestore.major} cũ hơn bản dump (PostgreSQL ${manifest.source.serverMajor})`);
    const [{ n }] = await db.$queryRaw`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = ${schema} AND table_type = 'BASE TABLE'`;
    if (n > 0 && !clean) throw new Error(`Database đích ${describe(url)} đã có ${n} bảng. Thêm --clean nếu chắc chắn muốn ghi đè.`);
    log(`Đang khôi phục vào ${describe(url)} (PostgreSQL ${major})`);
    const env = { ...process.env, ...pgEnv(url) };
    // pg_dump --schema=public có lệnh CREATE SCHEMA public; database mới (và Supabase) đã có schema này,
    // nên bỏ mục SCHEMA/COMMENT của chính schema khỏi danh sách khôi phục (cũng để --clean không xóa schema).
    const { stdout: toc } = await run(pgRestore.file, ['--list', path.join(from, DUMP)], { env, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    const listFile = path.join(os.tmpdir(), `taskflow-restore-${process.pid}-${Date.now()}.list`);
    fs.writeFileSync(listFile, toc.split(/\r?\n/).filter((l) => !/ (SCHEMA|COMMENT) - (SCHEMA )?public( |$)/.test(l)).join('\n'));
    try {
      await run(pgRestore.file, ['--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction', ...(n > 0 ? ['--clean', '--if-exists'] : []), `--use-list=${listFile}`, `--dbname=${env.PGDATABASE}`, path.join(from, DUMP)], {
        env, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      });
    } finally {
      fs.rmSync(listFile, { force: true });
    }
    const after = await tableCounts(db, schema);
    const mismatched = Object.keys({ ...manifest.tables, ...after }).filter((t) => manifest.tables[t] !== after[t]);
    let restoredFiles = 0;
    if (includeFiles && manifest.storage) {
      const mode = useStorage(storage);
      if (mode === 'local') fs.mkdirSync(config.uploadDir, { recursive: true });
      for (const rel of Object.keys(manifest.files).filter((f) => f.startsWith(`${FILES}/`))) {
        const name = rel.slice(FILES.length + 1);
        try { await saveFile(name, fs.readFileSync(path.join(from, rel)), 'application/octet-stream'); }
        catch (e) {
          // Supabase không ghi đè khi x-upsert=false: tệp đã có cùng tên thì kiểm nội dung giống bản sao lưu.
          const existing = await readFile(name).catch(() => null);
          if (!existing || sha256(existing) !== manifest.files[rel]) throw e;
        }
        const back = await readFile(name);
        if (sha256(back) !== manifest.files[rel]) throw new Error(`Tệp ${name} sau khi khôi phục sai checksum`);
        restoredFiles++;
      }
    }
    return { manifest, tables: after, mismatched, restoredFiles, verified: mismatched.length === 0 };
  } finally {
    await db.$disconnect();
  }
}
