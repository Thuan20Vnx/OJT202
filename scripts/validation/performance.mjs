// U031 – đo hiệu năng và độ bền dữ liệu trên database tạm (không bao giờ dùng DATABASE_URL thật).
// 1. Dựng dữ liệu: 50 người dùng ảo, 20 dự án, 10.000 task, bình luận, tệp đính kèm.
// 2. 50 người dùng đăng nhập thật rồi chạy song song chuỗi thao tác đọc (+ 1 bình luận mỗi vòng).
// 3. Ghi mọi câu SQL Prisma phát ra, EXPLAIN ANALYZE các câu chậm nhất trên đúng dữ liệu đó.
// 4. Sao lưu (pg_dump + tệp) → khôi phục vào database mới cùng cluster → đối chiếu số dòng và checksum tệp.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startFixture } from './fixture.mjs';
import { Worker } from 'node:worker_threads';
import { quantile, requireValue } from './core.mjs';

// bcryptjs là thư viện của BackEnd, không cài ở thư mục gốc.
const bcrypt = createRequire(new URL('../../BackEnd/package.json', import.meta.url))('bcryptjs');
const pick = (rows, i) => rows[i % rows.length];
const WORDS = ['API', 'giao diện', 'kiểm thử', 'tài liệu', 'báo cáo', 'database', 'đăng nhập', 'thông báo', 'lịch họp', 'phân quyền'];

function stats(samples) {
  const ms = samples.map((s) => s.ms);
  return {
    requests: samples.length,
    errors: samples.filter((s) => s.status < 200 || s.status >= 300).length,
    p50Ms: round(quantile(ms, 0.5)), p95Ms: round(quantile(ms, 0.95)), p99Ms: round(quantile(ms, 0.99)), maxMs: round(Math.max(...ms)),
  };
}
// Mã dự án chỉ gồm 2–5 chữ cái: PA, PB, …, PZ, PAA…
const prefix = (p) => `P${p < 26 ? String.fromCharCode(65 + p) : String.fromCharCode(65 + Math.floor(p / 26) - 1) + String.fromCharCode(65 + (p % 26))}`;
const round = (n) => (n == null ? null : Math.round(n * 10) / 10);

/** Thay $1.. bằng literal (chỉ dữ liệu test do chính script tạo) để EXPLAIN đúng câu Prisma đã chạy. */
function inline(sql, params) {
  const lit = (v) => {
    if (v === null) return 'NULL';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return `ARRAY[${v.map(lit).join(',')}]`;
    return `'${String(v).replaceAll("'", "''")}'`;
  };
  return sql.replace(/\$(\d+)/g, (_, n) => lit(params[Number(n) - 1]));
}

/**
 * `remoteUrl` (tùy chọn): database thật (vd Supabase) – mọi bảng thử nằm trong schema riêng `schema`
 * (phải bắt đầu bằng perf_), schema đó phải chưa tồn tại và LUÔN bị xóa khi kết thúc; schema public không bị đụng.
 */
export async function performanceRun({ build, users = 50, projects = 20, tasks = 10000, iterations = 6, thinkMs = [1000, 3000], remoteUrl = '', schema = 'perf_u031', log = () => {} }) {
  requireValue(users >= 1 && projects >= 1 && tasks >= projects, 'Tham số dữ liệu không hợp lệ');
  requireValue(!remoteUrl || /^perf_[a-z0-9_]{1,40}$/.test(schema), 'Schema đo phải có dạng perf_xxx');
  process.env.DB_DEBUG = '1'; // db.js bật sự kiện query để đo từng câu SQL
  let schemaUrl = '', dropSchema = async () => {};
  if (remoteUrl) {
    const { PrismaClient } = createRequire(new URL('../../BackEnd/package.json', import.meta.url))('@prisma/client');
    const admin = new PrismaClient({ datasourceUrl: withParams(remoteUrl, { connection_limit: '1' }) });
    const [{ exists }] = await admin.$queryRaw`SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = ${schema}) AS exists`;
    if (exists) { await admin.$disconnect(); throw new TypeError(`Schema ${schema} đã tồn tại – có thể do lần đo trước dừng giữa chừng. Kiểm tra rồi xóa thủ công: DROP SCHEMA ${schema} CASCADE`); }
    dropSchema = async () => {
      try { await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); log(`Đã xóa schema ${schema}`); }
      finally { await admin.$disconnect(); }
    };
    schemaUrl = withParams(remoteUrl, { schema });
  }
  let fixture;
  try { fixture = await startFixture({ build, databaseUrl: schemaUrl }); }
  catch (e) { await dropSchema(); throw e; }
  const { db, actors, seed, base } = fixture;
  const prisma = db.prisma;
  const queries = new Map();
  let recording = false;
  prisma.$on('query', (e) => {
    if (!recording) return;
    const row = queries.get(e.query) ?? { count: 0, totalMs: 0, maxMs: 0, params: e.params };
    row.count++; row.totalMs += e.duration;
    if (e.duration >= row.maxMs) { row.maxMs = e.duration; row.params = e.params; }
    queries.set(e.query, row);
  });
  try {
    // ---------- 1. Dữ liệu ----------
    const t0 = performance.now();
    const { DEMO_PASSWORD } = await import('../../BackEnd/src/seed.js');
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const ws = (await actors.pm.request('POST', '/api/workspaces', { name: 'U031 hiệu năng' })).data.workspace._id;
    await prisma.user.createMany({ data: Array.from({ length: users }, (_, i) => ({ name: `Người dùng ảo ${i + 1}`, email: `vu${i + 1}@perf.taskflow.test`, passwordHash, emailVerified: true })) });
    const vus = await prisma.user.findMany({ where: { email: { endsWith: '@perf.taskflow.test' } }, orderBy: { email: 'asc' } });
    await prisma.membership.createMany({ data: vus.map((u) => ({ workspace: ws, user: u.id, role: 'member', weeklyHours: 20 })) });
    // Mỗi người ở 2 dự án → mỗi dự án có PM + ~5 thành viên.
    const memberOf = (p) => vus.filter((_, i) => i % projects === p || (i + 7) % projects === p).map((u) => u.id);
    const projectIds = [];
    for (let p = 0; p < projects; p++) {
      const r = await actors.pm.request('POST', `/api/workspaces/${ws}/projects`, { name: `Dự án tải ${p + 1}`, keyPrefix: prefix(p), members: memberOf(p) });
      requireValue(r.status === 201 || r.status === 200, `Tạo dự án thất bại: ${r.status} ${JSON.stringify(r.data)}`);
      projectIds.push(r.data.project._id);
    }
    const day = 86400000, now = Date.now(), statuses = ['todo', 'todo', 'in_progress', 'review', 'done'], prios = ['low', 'medium', 'medium', 'high'];
    const perProject = Math.floor(tasks / projects);
    let created = 0;
    for (const [p, project] of projectIds.entries()) {
      const members = memberOf(p);
      const rows = Array.from({ length: perProject + (p < tasks % projects ? 1 : 0) }, (_, i) => {
        const status = pick(statuses, i * 7 + p);
        return {
          workspace: ws, project, number: i + 1, key: `${prefix(p)}-${i + 1}`, creator: seed.users.maianh.id,
          title: `${pick(WORDS, i + p)} – hạng mục ${i + 1} của dự án ${p + 1}`, description: `Mô tả công việc ${i + 1}: ${pick(WORDS, i * 3)} và ${pick(WORDS, i * 5 + 1)}.`,
          status, priority: pick(prios, i), assignee: i % 9 === 0 ? null : pick(members, i), order: i,
          dueDate: i % 6 === 0 ? null : new Date(now + ((i % 60) - 20) * day), estimateHours: 1 + (i % 8), remainingHours: status === 'done' ? 0 : 1 + (i % 8),
          labels: i % 4 === 0 ? ['backend'] : i % 4 === 1 ? ['frontend'] : [], completedAt: status === 'done' ? new Date(now - (i % 10) * day) : null,
        };
      });
      for (let i = 0; i < rows.length; i += 1000) await prisma.task.createMany({ data: rows.slice(i, i + 1000) });
      await prisma.$executeRaw`INSERT INTO counters (name, seq) VALUES (${`task:${project}`}, ${rows.length}) ON CONFLICT (name) DO UPDATE SET seq = EXCLUDED.seq`;
      created += rows.length;
    }
    // Phụ thuộc, việc con, bình luận, tệp: đủ để enrich/populate có dữ liệu thật.
    const all = await prisma.task.findMany({ where: { workspace: ws }, select: { id: true, project: true, number: true, assignee: true }, orderBy: [{ project: 'asc' }, { number: 'asc' }] });
    for (let i = 10; i < all.length; i += 25) await prisma.task.update({ where: { id: all[i].id }, data: { blockedBy: [all[i - 3].id] } });
    const comments = [];
    for (let i = 0; i < all.length; i += 2) comments.push({ task: all[i].id, project: all[i].project, author: all[i].assignee ?? seed.users.maianh.id, body: `Bình luận về ${pick(WORDS, i)} #${i}` });
    for (let i = 0; i < comments.length; i += 2000) await prisma.comment.createMany({ data: comments.slice(i, i + 2000) });
    const { config } = await import('../../BackEnd/src/config.js');
    const docs = [];
    for (let i = 0; i < 40; i++) {
      const key = `perf-${i}-${Date.now()}.txt`;
      const bytes = Buffer.from(`Tệp đính kèm thử nghiệm ${i}\n`.repeat(200 + i));
      fs.writeFileSync(path.join(config.uploadDir, key), bytes);
      docs.push({ workspace: ws, project: pick(all, i * 97).project, task: pick(all, i * 97).id, kind: 'file', name: `tai-lieu-${i}.txt`, mime: 'text/plain', size: bytes.length, storageKey: key, uploadedBy: seed.users.maianh.id });
    }
    await prisma.document.createMany({ data: docs });
    const taskCount = await prisma.task.count();
    log(`Dữ liệu: ${users} người dùng, ${projects} dự án, ${created} task dự án tải (tổng ${taskCount}), ${comments.length} bình luận, ${docs.length} tệp – ${Math.round(performance.now() - t0)} ms`);
    await prisma.$executeRawUnsafe('ANALYZE');

    // ---------- 2. Đăng nhập + tải ----------
    // Người dùng ảo chạy trong worker thread riêng: không tranh event loop với API đang được đo.
    const plan = vus.map((u) => {
      const mine = projectIds.filter((_, p) => memberOf(p).includes(u.id));
      return { email: u.email, projects: mine, tasks: all.filter((t) => mine.includes(t.project)).map((t) => t.id) };
    });
    let loadStart;
    const samples = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./load-worker.mjs', import.meta.url), { workerData: { base, ws, plan, password: DEMO_PASSWORD, iterations, thinkMs, words: WORDS } });
      worker.on('message', (m) => {
        if (m.error) reject(new Error(m.error));
        else if (m.ready) { recording = true; loadStart = performance.now(); worker.postMessage('start'); }
        else resolve(m.samples);
      });
      worker.once('error', reject);
      worker.once('exit', (code) => code && reject(new Error(`Worker tải thoát với mã ${code}`)));
    });
    const loadMs = performance.now() - loadStart;
    recording = false;
    const reads = samples.filter((s) => s.method === 'GET'), writes = samples.filter((s) => s.method !== 'GET');
    const byEndpoint = Object.fromEntries([...new Set(samples.map((s) => s.label))].map((l) => [l, stats(samples.filter((s) => s.label === l))]));
    log(`Tải: ${samples.length} request trong ${Math.round(loadMs / 1000)} s, p95 đọc ${stats(reads).p95Ms} ms, p95 ghi ${stats(writes).p95Ms} ms`);

    // ---------- 3. EXPLAIN các câu SQL nặng nhất ----------
    const top = [...queries.entries()].map(([sql, q]) => ({ sql, ...q, avgMs: q.totalMs / q.count })).sort((a, b) => b.totalMs - a.totalMs).slice(0, 8);
    const explains = [];
    for (const q of top) {
      let params = [];
      try { params = JSON.parse(q.params); } catch { /* Prisma đôi khi in params không phải JSON */ }
      const entry = { sql: q.sql.length > 600 ? `${q.sql.slice(0, 600)}…` : q.sql, calls: q.count, totalMs: round(q.totalMs), avgMs: round(q.avgMs), maxMs: round(q.maxMs) };
      try {
        const [row] = await prisma.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${inline(q.sql, params)}`);
        const plan = row['QUERY PLAN'][0];
        const nodes = [];
        (function walk(n) { nodes.push(n); for (const c of n.Plans ?? []) walk(c); })(plan.Plan);
        Object.assign(entry, {
          executionMs: round(plan['Execution Time']),
          scans: nodes.filter((n) => /Scan/.test(n['Node Type'])).map((n) => `${n['Node Type']}${n['Index Name'] ? ` (${n['Index Name']})` : ''}${n['Relation Name'] ? ` on ${n['Relation Name']}` : ''}`),
          seqScanRows: nodes.filter((n) => n['Node Type'] === 'Seq Scan').reduce((a, n) => a + (n['Actual Rows'] ?? 0) + (n['Rows Removed by Filter'] ?? 0), 0),
        });
      } catch (e) { entry.explainError = e.message.split('\n')[0].slice(0, 200); }
      explains.push(entry);
    }

    // ---------- 4. Sao lưu → khôi phục ----------
    // Nhúng: khôi phục vào database mới cùng cluster. Từ xa: dump schema đo → xóa schema → khôi phục lại → đối chiếu.
    const { backup, restore } = await import('../../BackEnd/scripts/lib/backup-core.js');
    const [{ port, dbname }] = await prisma.$queryRaw`SELECT inet_server_port() AS port, current_database() AS dbname`;
    const srcUrl = remoteUrl ? schemaUrl : `postgresql://taskflow:taskflow@127.0.0.1:${port}/${dbname}`;
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-u031-'));
    try {
      const b0 = performance.now();
      const manifest = await backup({ url: srcUrl, out: path.join(work, 'backup'), schema: remoteUrl ? schema : 'public', storage: { mode: 'local', dir: config.uploadDir } });
      const backupMs = performance.now() - b0;
      const [{ version: pgVersion }] = await prisma.$queryRaw`SELECT version()`;
      let target;
      if (remoteUrl) {
        await prisma.$disconnect(); // nhả kết nối của API trước khi xóa schema
        const { PrismaClient } = createRequire(new URL('../../BackEnd/package.json', import.meta.url))('@prisma/client');
        const drop = new PrismaClient({ datasourceUrl: withParams(remoteUrl, { connection_limit: '1' }) });
        try { await drop.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); } finally { await drop.$disconnect(); }
        target = remoteUrl;
      } else {
        await prisma.$executeRawUnsafe('CREATE DATABASE taskflow_restore_check');
        target = `postgresql://taskflow:taskflow@127.0.0.1:${port}/taskflow_restore_check`;
      }
      const r0 = performance.now();
      const restored = await restore({ from: path.join(work, 'backup'), url: target, storage: { mode: 'local', dir: path.join(work, 'uploads-restored') } });
      const restoreMs = performance.now() - r0;
      const dumpBytes = fs.statSync(path.join(work, 'backup', 'database.dump')).size;
      const fileCount = Object.keys(manifest.files).length - 1;
      log(`Sao lưu ${Math.round(backupMs)} ms (${Math.round(dumpBytes / 1024)} KB, ${fileCount} tệp), khôi phục ${Math.round(restoreMs)} ms, khớp: ${restored.verified}`);
      const cpus = os.cpus();
      const where = remoteUrl ? `${new URL(remoteUrl).hostname} (schema ${schema}); API + client trên máy, DB qua Internet` : '(nhúng, cùng máy); API + DB + client cùng máy qua loopback';
      return {
        schemaVersion: 1, kind: 'performance-restore', build, createdAt: new Date().toISOString(),
        environment: `${os.type()} ${os.release()} ${os.arch()}; ${cpus.length}× ${cpus[0]?.model?.trim()}; RAM ${Math.round(os.totalmem() / 2 ** 30)} GB; Node ${process.version}; ${pgVersion.split(',')[0]} ${where}`,
        method: { virtualUsers: users, loginsExcluded: 'đăng nhập xong trước khi bắt đầu đo', iterationsPerUser: iterations, thinkTimeMs: thinkMs, requestsPerIteration: 10, readEndpoints: Object.keys(byEndpoint).filter((l) => l.startsWith('GET')), note: 'Mỗi người dùng ảo đăng nhập bằng tài khoản riêng, chỉ đọc dự án mình tham gia; đo từ trước fetch đến khi đọc xong body.' },
        dataset: { users, projects, taskCount, projectTasks: created, comments: comments.length, files: docs.length, tasksPerProject: perProject },
        virtualUsers: users, taskCount, readRequests: reads.length, writeRequests: writes.length,
        p95Ms: stats(reads).p95Ms, reads: stats(reads), writes: stats(writes), byEndpoint, durationSec: round(loadMs / 1000), throughputRps: round(samples.length / (loadMs / 1000)),
        explains,
        backup: { durationMs: Math.round(backupMs), dumpBytes, files: fileCount, tables: Object.keys(manifest.tables).length, rows: Object.values(manifest.tables).reduce((a, b) => a + b, 0), migrations: manifest.migrations.length },
        restore: { durationMs: Math.round(restoreMs), files: restored.restoredFiles, mismatchedTables: restored.mismatched, target: remoteUrl ? `xóa schema ${schema} rồi khôi phục lại trên cùng database` : 'database mới trong cùng cluster + thư mục tệp mới' },
        backupHash: manifest.backupHash, restoreVerified: restored.verified && restored.restoredFiles === fileCount,
      };
    } finally {
      if (path.dirname(work) === os.tmpdir() && path.basename(work).startsWith('taskflow-u031-')) fs.rmSync(work, { recursive: true, force: true });
    }
  } finally {
    await fixture.close();
    await dropSchema();
  }
}

function withParams(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}
