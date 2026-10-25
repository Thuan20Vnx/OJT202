// Isolated, disposable UI fixture. Never reads the configured development DB.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.CLIENT_URL = 'http://localhost:4179';
const uploads = await fs.mkdtemp(path.join(os.tmpdir(), 'taskflow-review-uploads-'));
process.env.UPLOAD_DIR = uploads;
const { connectDb, disconnectDb } = await import('../BackEnd/src/db.js');
const db = await import('../BackEnd/src/db.js');
const { seedDemo } = await import('../BackEnd/src/seed.js');
const { createApp } = await import('../BackEnd/src/app.js');
const { initRealtime } = await import('../BackEnd/src/services/realtime.js');
await connectDb({ ephemeral: true });
const seed = await seedDemo();
const edgeCases = process.argv.includes('--edge-cases');
if (edgeCases) {
  await db.prisma.notification.deleteMany({ where: { user: seed.users.maianh.id, workspace: seed.workspace.id } });
  await db.prisma.notification.createMany({ data: Array.from({ length: 61 }, (_, i) => ({
    user: seed.users.maianh.id, workspace: seed.workspace.id, project: seed.projects.website.id,
    type: 'assigned', text: `Phân trang kiểm thử ${String(i + 1).padStart(2, '0')}`,
    dedupeKey: `review-page-${i}`, createdAt: new Date(),
  })) });
}
await db.prisma.workspace.create({ data: { name: 'Workspace kiểm thử trống', slug: 'review-empty', owner: seed.users.maianh.id, memberships: { create: { user: seed.users.maianh.id, role: 'owner' } } } });
await db.prisma.task.create({ data: {
  workspace: seed.workspace.id, project: seed.projects.website.id, creator: seed.users.maianh.id,
  assignee: seed.users.nhu.id, number: 990, key: 'QA-990', title: 'Kiểm thử chờ duyệt', status: 'review',
} });
const content = 'Dữ liệu kiểm thử bảo toàn tài liệu. '.repeat(1000) + 'DẤU CUỐI KHÔNG ĐƯỢC MẤT';
const doc = await db.prisma.document.create({ data: {
  workspace: seed.workspace.id, project: seed.projects.website.id, kind: 'doc', name: 'Kiểm thử tài liệu dài.txt',
  content, size: Buffer.byteLength(content), uploadedBy: seed.users.maianh.id,
  revisions: { create: { version: 1, content, author: seed.users.maianh.id } },
} });
const app = createApp();
const injected = new Set();
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  // Fault injection chỉ có trong fixture DB tạm và chỉ lỗi một lần để kiểm tra thử lại.
  const fault = pathname.endsWith('/activity.csv') ? 'csv' : pathname.endsWith('/activity') ? 'activity' : null;
  if (edgeCases && req.method === 'GET' && fault && !injected.has(fault)) {
    injected.add(fault);
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `Lỗi kiểm thử ${fault}: vui lòng thử lại` }));
    return;
  }
  app(req, res);
});
const io = initRealtime(server);
await new Promise((resolve) => server.listen(4179, '127.0.0.1', resolve));
console.log(JSON.stringify({ url: 'http://localhost:4179', document: doc.id, characters: content.length }));
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  await new Promise((resolve) => io.close(resolve));
  server.closeAllConnections();
  await disconnectDb();
  if (path.dirname(uploads) === os.tmpdir() && path.basename(uploads).startsWith('taskflow-review-uploads-')) await fs.rm(uploads, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.stdin.on('data', (input) => { if (String(input).trim() === 'stop') stop(); });
// Automatic cleanup even when the invoking terminal cannot deliver SIGINT.
setTimeout(stop, 20 * 60 * 1000);
