// Worker tạo tải U031: mỗi người dùng ảo đăng nhập bằng tài khoản riêng rồi lặp chuỗi thao tác của một thành viên.
// Chạy trong luồng riêng để thời gian đo không bị event loop của API (cùng tiến trình) làm sai lệch.
import { parentPort, workerData } from 'node:worker_threads';
import { LocalClient } from './http.mjs';

const { base, ws, plan, password, iterations, thinkMs, words } = workerData;
const pick = (rows, i) => rows[i % rows.length];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const samples = [];

async function call(client, label, method, route, body) {
  const r = await client.request(method, route, body);
  samples.push({ label, method, status: r.status, ms: r.elapsedMs });
  return r;
}

// Pha 1: đăng nhập tuần tự (bcrypt tốn CPU, không thuộc phép đo đọc). Pha 2: chờ lệnh 'start' rồi chạy tải.
async function login(u) {
  const client = new LocalClient(base);
  const r = await client.request('POST', '/api/auth/login', { email: u.email, password });
  if (r.status !== 200) throw new Error(`Đăng nhập ${u.email} thất bại: ${r.status}`);
  return client;
}

async function user(u, v, client) {
  await sleep(Math.random() * 500); // không để 50 người bấm cùng một mili giây
  const think = () => sleep(thinkMs[0] + Math.random() * (thinkMs[1] - thinkMs[0]));
  for (let it = 0; it < iterations; it++) {
    const project = pick(u.projects, it + v), task = pick(u.tasks, it * 37 + v * 11);
    await call(client, 'GET /me', 'GET', '/api/me'); await think();
    await call(client, 'GET my-tasks', 'GET', `/api/workspaces/${ws}/my-tasks?limit=20`); await think();
    await call(client, 'GET projects', 'GET', `/api/workspaces/${ws}/projects`); await think();
    await call(client, 'GET board', 'GET', `/api/projects/${project}/tasks`); await think();
    await call(client, 'GET overview', 'GET', `/api/projects/${project}/overview`); await think();
    await call(client, 'GET task', 'GET', `/api/tasks/${task}`); await think();
    await call(client, 'GET comments', 'GET', `/api/tasks/${task}/comments`); await think();
    await call(client, 'GET search', 'GET', `/api/projects/${project}/tasks?search=${encodeURIComponent(pick(words, it + v))}`); await think();
    await call(client, 'GET notifications', 'GET', '/api/notifications'); await think();
    await call(client, 'POST comment', 'POST', `/api/tasks/${task}/comments`, { body: `Người dùng ảo ${v + 1} cập nhật vòng ${it + 1}` }); await think();
  }
}

try {
  const clients = [];
  for (const u of plan) clients.push(await login(u));
  parentPort.postMessage({ ready: true });
  await new Promise((resolve) => parentPort.once('message', resolve));
  await Promise.all(plan.map((u, v) => user(u, v, clients[v])));
  parentPort.postMessage({ samples });
} catch (e) {
  parentPort.postMessage({ error: e.message });
}
