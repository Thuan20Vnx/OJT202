// Chẩn đoán U031 (npm run validate:queries [-- --target supabase]): với 1 người dùng, gọi lần lượt từng endpoint và đếm số câu SQL + thời gian.
// Trên DB ở xa, (thời gian / RTT) ≈ số chặng truy vấn nối tiếp – thứ cần giảm.
import { startFixture } from './fixture.mjs';

export async function queryProfile({ build, databaseUrl = '', rounds = 5, log = () => {} }) {
  process.env.DB_DEBUG = '1';
  const fixture = await startFixture({ build, databaseUrl });
  const { db, actors, project, workspace } = fixture;
  let count = 0, sqlMs = 0, trace = [], t0 = 0;
  db.prisma.$on('query', (e) => { count++; sqlMs += e.duration; trace.push(`+${String(Math.round(performance.now() - t0 - e.duration)).padStart(4)}ms ${String(Math.round(e.duration)).padStart(3)}ms ` + e.query.replace(/SELECT .*? FROM/s, 'SELECT … FROM').replace(/\s+/g, ' ').slice(0, 110)); });
  try {
    const task = (await db.prisma.task.findFirst({ where: { project }, orderBy: { number: 'asc' } })).id;
    const rtt = [];
    for (let i = 0; i < 10; i++) { const s = performance.now(); await db.prisma.$queryRaw`SELECT 1`; rtt.push(performance.now() - s); }
    rtt.sort((a, b) => a - b);
    const routes = {
      'GET /me': ['GET', '/api/me'], 'GET my-tasks': ['GET', `/api/workspaces/${workspace}/my-tasks?limit=20`], 'GET projects': ['GET', `/api/workspaces/${workspace}/projects`],
      'GET board': ['GET', `/api/projects/${project}/tasks`], 'GET overview': ['GET', `/api/projects/${project}/overview`], 'GET task': ['GET', `/api/tasks/${task}`],
      'GET comments': ['GET', `/api/tasks/${task}/comments`], 'GET search': ['GET', `/api/projects/${project}/tasks?search=API`], 'GET notifications': ['GET', '/api/notifications'],
      'POST comment': ['POST', `/api/tasks/${task}/comments`, { body: 'đo truy vấn' }],
    };
    const result = {};
    for (const [label, [method, route, body]] of Object.entries(routes)) {
      const ms = [], qs = [];
      for (let i = 0; i < rounds; i++) {
        count = 0; trace = []; t0 = performance.now();
        const r = await actors.member.request(method, route, body);
        if (r.status >= 300) throw new Error(`${label}: ${r.status}`);
        ms.push(r.elapsedMs); qs.push(count);
      }
      ms.sort((a, b) => a - b);
      result[label] = { queries: Math.max(...qs), medianMs: Math.round(ms[Math.floor(rounds / 2)]), roundTrips: Math.round(ms[Math.floor(rounds / 2)] / rtt[5]) };
      if (process.env.QP_TRACE && (!process.env.QP_ONLY || process.env.QP_ONLY.split(',').includes(label))) for (const q of trace.sort()) log(`      ${q}`);
      log(`${label.padEnd(18)} ${String(result[label].queries).padStart(3)} câu SQL, ${String(result[label].medianMs).padStart(5)} ms, ≈${result[label].roundTrips} chặng`);
    }
    return { rttMs: Math.round(rtt[5] * 10) / 10, endpoints: result };
  } finally { await fixture.close(); }
}
