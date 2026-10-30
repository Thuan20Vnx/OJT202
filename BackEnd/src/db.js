import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from './config.js';

/** Client Prisma dùng chung (live binding – được gán trong connectDb). */
export let prisma = null;
let embedded = null;

const PG_USER = 'taskflow';
const PG_PASSWORD = 'taskflow';
const DB_NAME = 'taskflow';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function canConnect(pg) {
  const c = pg.getPgClient('postgres', 'localhost');
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}

/**
 * PostgreSQL nhúng (gói embedded-postgres – binary PostgreSQL thật) cho môi trường phát triển/test.
 * Dữ liệu dev lưu ở server/.data/pg; bản ephemeral dùng thư mục tạm và bị xóa khi dừng.
 */
async function startEmbedded(ephemeral) {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const port = ephemeral ? await freePort() : config.pgPort;
  const databaseDir = ephemeral ? fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-pg-')) : path.join(config.dataDir, 'pg');
  const pg = new EmbeddedPostgres({
    databaseDir,
    port,
    user: PG_USER,
    password: PG_PASSWORD,
    persistent: !ephemeral,
    // UTF-8 + bộ locale builtin của PostgreSQL 17: so khớp không phân biệt hoa thường đúng với tiếng Việt
    initdbFlags: ['--encoding=UTF8', '--locale-provider=builtin', '--builtin-locale=C.UTF-8', '--locale=C'],
    onLog: () => {},
    onError: (e) => {
      if (!config.isTest) console.error('[db]', String(e?.message || e).trim());
    },
  });
  // node --watch có thể khởi động lại API trong khi PostgreSQL nhúng của lần trước vẫn chạy => dùng lại
  if (!ephemeral && (await canConnect(pg))) {
    console.log(`[db] Dùng lại PostgreSQL nhúng đang chạy ở cổng ${port}`);
  } else {
    if (!fs.existsSync(path.join(databaseDir, 'PG_VERSION'))) await pg.initialise();
    if (process.platform === 'win32') {
      // pg_ctl starts PostgreSQL with a restricted Windows token, including when
      // a terminal is elevated. Starting postgres.exe directly refuses that case.
      const { postgres } = await import('@embedded-postgres/windows-x64');
      const ctl = path.join(path.dirname(postgres), 'pg_ctl.exe');
      const runCtl = (args) => promisify(execFile)(ctl, args, { windowsHide: true, timeout: 40000 });
      await runCtl(['start', '-D', databaseDir, '-l', path.join(databaseDir, 'server.log'), '-o', `-p ${port}`, '-w', '-t', '30']);
      embedded = {
        async stop() {
          await runCtl(['stop', '-D', databaseDir, '-m', 'fast', '-w', '-t', '30']);
          // Only ephemeral directories created above may be removed.
          if (ephemeral && path.dirname(databaseDir) === os.tmpdir() && path.basename(databaseDir).startsWith('taskflow-pg-')) {
            await fs.promises.rm(databaseDir, { recursive: true, force: true });
          }
        },
      };
    } else {
      await pg.start();
      embedded = pg;
    }
  }
  const c = pg.getPgClient('postgres', 'localhost');
  await c.connect();
  const exists = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
  if (!exists.rowCount) await c.query(`CREATE DATABASE ${DB_NAME}`);
  await c.end();
  if (!config.isTest) console.log(`[db] Dùng PostgreSQL nhúng tại localhost:${port}${ephemeral ? ' (tạm thời)' : ` – dữ liệu ở ${databaseDir}`}`);
  return `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${port}/${DB_NAME}`;
}

/** Áp dụng các migration trong prisma/migrations (idempotent). */
async function migrate(url) {
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  await promisify(execFile)(process.execPath, [cli, 'migrate', 'deploy'], {
    cwd: config.root,
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
}

/**
 * Kết nối PostgreSQL. Có DATABASE_URL => dùng server PostgreSQL đó;
 * không có => tự chạy PostgreSQL nhúng. Luôn áp dụng migration trước khi phục vụ.
 */
export async function connectDb({ ephemeral = false } = {}) {
  const url = config.databaseUrl || (await startEmbedded(ephemeral));
  await migrate(url);
  prisma = new PrismaClient({
    datasourceUrl: url,
    omit: { user: { passwordHash: true } },
    // DB_DEBUG=1: phát sự kiện cho từng truy vấn để đo số truy vấn/độ trễ khi tối ưu
    ...(process.env.DB_DEBUG && { log: [{ emit: 'event', level: 'query' }] }),
  });
  await prisma.$connect();
  if (config.databaseUrl) {
    // DB ở xa (vd Supabase): mở sẵn vài kết nối để request đầu tiên không phải chờ bắt tay TLS
    await Promise.all(Array.from({ length: 4 }, () => prisma.$queryRaw`SELECT 1`));
    console.log('[db] Đã kết nối PostgreSQL');
  }
  return prisma;
}

export async function disconnectDb() {
  await prisma?.$disconnect();
  if (embedded) {
    await embedded.stop();
    embedded = null;
  }
}

// ---------- Tiện ích truy vấn ----------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (v) => typeof v === 'string' && UUID_RE.test(v);

/** Trường người dùng công khai khi nhúng vào kết quả */
export const USER = { id: true, name: true, email: true, title: true };

/**
 * Thay id bằng bản ghi tương ứng (tương tự populate): hỗ trợ id đơn, mảng id
 * và đường dẫn lồng trong JSON như 'items.assignee', 'sections.refs'.
 * Id không còn tồn tại => null (id đơn) hoặc bị loại (mảng).
 */
export async function populate(rows, pathStr, model, select, db = prisma) {
  const list = Array.isArray(rows) ? rows : [rows];
  const parts = pathStr.split('.');
  const key = parts.pop();
  const holders = [];
  const walk = (obj, i) => {
    if (!obj || typeof obj !== 'object') return;
    if (i === parts.length) return holders.push(obj);
    const v = obj[parts[i]];
    for (const x of Array.isArray(v) ? v : [v]) walk(x, i + 1);
  };
  for (const r of list) walk(r, 0);
  const ids = new Set();
  for (const h of holders) for (const v of [h[key]].flat()) if (isId(v)) ids.add(v);
  const found = ids.size ? await db[model].findMany({ where: { id: { in: [...ids] }, ...(model === 'task' && { deletedAt: null }) }, select: { ...select, id: true } }) : [];
  const byId = new Map(found.map((f) => [f.id, f]));
  for (const h of holders) {
    const v = h[key];
    if (Array.isArray(v)) h[key] = v.map((id) => (typeof id === 'string' ? byId.get(id) : id)).filter(Boolean);
    else if (typeof v === 'string') h[key] = byId.get(v) ?? null;
  }
  return rows;
}

/** Chạy song song nhiều populate trên cùng tập bản ghi: specs = [[path, model, select], …] */
export async function populateAll(rows, specs, db = prisma) {
  await Promise.all(specs.map(([p, model, select]) => populate(rows, p, model, select, db)));
  return rows;
}

/** Số thứ tự tăng dần nguyên tử (INSERT … ON CONFLICT) */
export async function nextSeq(name, db = prisma) {
  const [row] = await db.$queryRaw`
    INSERT INTO counters (name, seq) VALUES (${name}, 1)
    ON CONFLICT (name) DO UPDATE SET seq = counters.seq + 1
    RETURNING seq`;
  return row.seq;
}

/** Đếm theo nhóm, trả { [giá trị]: số lượng } */
export async function countBy(model, field, where) {
  const rows = await prisma[model].groupBy({ by: [field], where, _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r[field], r._count._all]));
}

/** Tổng/đã xong của công việc con theo công việc cha */
export async function subtaskCounts(parentIds, db = prisma) {
  if (!parentIds.length) return {};
  const rows = await db.task.groupBy({ by: ['parent', 'status'], where: { parent: { in: parentIds }, deletedAt: null }, _count: { _all: true } });
  const out = {};
  for (const r of rows) {
    const s = (out[r.parent] ||= { total: 0, done: 0 });
    s.total += r._count._all;
    if (r.status === 'done') s.done += r._count._all;
  }
  return out;
}

/** Giá trị cho cột JSON có thể NULL */
export const jsonOrNull = (v) => (v === undefined ? undefined : v === null ? Prisma.DbNull : v);

export const isUniqueError = (e) => e?.code === 'P2002';

/** Tìm kiếm chứa chuỗi, không phân biệt hoa thường */
export const ilike = (s) => ({ contains: String(s), mode: 'insensitive' });
