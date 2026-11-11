// Cài đặt runner chạy nền: lưu cấu hình, tự chạy ẩn khi đăng nhập Windows và đăng ký đường dẫn taskflow://
// để nút "Bật agent" trên web gọi được. Người dùng tự chạy lệnh cài; mọi thay đổi chỉ nằm trong tài khoản của họ
// (thư mục ~/.taskflow và HKEY_CURRENT_USER), gỡ bằng lệnh uninstall.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER_PATH = fileURLToPath(new URL('./runner.js', import.meta.url));
const SERVER_PATH = fileURLToPath(new URL('./index.js', import.meta.url));
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'TaskFlowAgent';
const PROTOCOL_KEY = 'HKCU\\Software\\Classes\\taskflow';
const MAX_LOG_BYTES = 1024 * 1024;

export const paths = (env = process.env) => {
  const home = env.TASKFLOW_HOME || path.join(os.homedir(), '.taskflow');
  return { home, config: path.join(home, 'runner.json'), pid: path.join(home, 'runner.pid'), log: path.join(home, 'runner.log'), launcher: path.join(home, 'start-agent.vbs') };
};

export const antigravityConfigPath = (env = process.env) => env.TASKFLOW_AGY_CONFIG || path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');

/**
 * Đặt mục "taskflow" trong cấu hình MCP chung của Antigravity trỏ tới server này, KHÔNG kèm token:
 * server tự đọc token của runner, nên cài lại với token mới là Antigravity dùng theo ngay. Các server khác giữ nguyên.
 */
export function syncAntigravity(env = process.env) {
  const file = antigravityConfigPath(env);
  if (!existsSync(path.dirname(file))) return { changed: false, reason: 'not-installed' };
  let config = {};
  if (existsSync(file)) {
    try {
      config = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return { changed: false, reason: 'unreadable' };
    }
    if (!existsSync(`${file}.bak-taskflow`)) writeFileSync(`${file}.bak-taskflow`, readFileSync(file));
  }
  const entry = { command: process.execPath, args: [SERVER_PATH] };
  config.mcpServers = { ...config.mcpServers, taskflow: entry };
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return { changed: true, file };
}

export function loadSavedConfig(env = process.env) {
  try {
    const saved = JSON.parse(readFileSync(paths(env).config, 'utf8'));
    return saved.token ? saved : null;
  } catch {
    return null;
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** pid của runner nền đang chạy, hoặc null. */
export function runningPid(env = process.env) {
  try {
    const pid = Number(readFileSync(paths(env).pid, 'utf8'));
    return pid && alive(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Chỉ một runner nền cho mỗi tài khoản: bấm "Bật agent" nhiều lần không sinh ra nhiều tiến trình. */
export function acquireLock(env = process.env) {
  const p = paths(env);
  if (runningPid(env)) return false;
  mkdirSync(p.home, { recursive: true });
  writeFileSync(p.pid, String(process.pid));
  process.on('exit', () => {
    try {
      if (Number(readFileSync(p.pid, 'utf8')) === process.pid) rmSync(p.pid);
    } catch { /* tệp đã bị gỡ */ }
  });
  return true;
}

export function fileLogger(env = process.env) {
  const { home, log } = paths(env);
  mkdirSync(home, { recursive: true });
  return (message) => {
    try {
      if (existsSync(log) && statSync(log).size > MAX_LOG_BYTES) writeFileSync(log, '');
      appendFileSync(log, `${new Date().toISOString()} ${message}\n`);
    } catch { /* không ghi được nhật ký thì vẫn chạy */ }
  };
}

const vbs = (value) => `"${String(value).replaceAll('"', '""')}"`;

/**
 * Tệp khởi chạy ẩn (không hiện cửa sổ đen). Không nhận tham số: đường dẫn taskflow://... từ trình duyệt
 * không bao giờ đi vào dòng lệnh, nên trang web lạ chỉ có thể làm đúng một việc là bật runner.
 */
export const launcherScript = (nodePath = process.execPath, runnerPath = RUNNER_PATH) =>
  `' TaskFlow Agent: chạy runner ẩn. Tạo bởi "runner.js install", gỡ bằng "runner.js uninstall".
CreateObject("WScript.Shell").Run ${vbs(`"${nodePath}" "${runnerPath}" --background`)}, 0, False
`;

/** Các lệnh registry sẽ chạy khi cài (để kiểm thử và để in ra cho người dùng xem). */
export function registryPlan(launcher) {
  const command = `wscript.exe "${launcher}"`;
  return [
    ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', command, '/f'],
    ['add', PROTOCOL_KEY, '/ve', '/d', 'URL:TaskFlow Agent', '/f'],
    ['add', PROTOCOL_KEY, '/v', 'URL Protocol', '/d', '', '/f'],
    ['add', `${PROTOCOL_KEY}\\shell\\open\\command`, '/ve', '/d', command, '/f'],
  ];
}

const reg = (args) => spawnSync('reg', args, { windowsHide: true, encoding: 'utf8' });
const systemAllowed = (env) => process.platform === 'win32' && env.TASKFLOW_SKIP_SYSTEM !== '1';

export function startBackground(env = process.env) {
  if (runningPid(env)) return false;
  const { launcher } = paths(env);
  if (process.platform === 'win32' && existsSync(launcher)) spawn('wscript.exe', [launcher], { detached: true, stdio: 'ignore', windowsHide: true, env }).unref();
  else spawn(process.execPath, [RUNNER_PATH, '--background'], { detached: true, stdio: 'ignore', windowsHide: true, env }).unref();
  return true;
}

export function install({ url, token, dir }, { env = process.env, print = console.log } = {}) {
  if (!token) throw new Error('Thiếu --token. Tạo token ở TaskFlow › Trợ lý AI › Agent dự án.');
  const folder = dir ? path.resolve(dir) : null;
  if (folder && !(existsSync(folder) && statSync(folder).isDirectory())) throw new Error(`Không tìm thấy thư mục dự án: ${folder}`);
  const p = paths(env);
  mkdirSync(p.home, { recursive: true });
  writeFileSync(p.config, `${JSON.stringify({ url: (url || 'http://localhost:4000').replace(/\/+$/, ''), token, dir: folder }, null, 2)}\n`, { mode: 0o600 });
  print(`Đã lưu cấu hình vào ${p.config}`);
  const agy = syncAntigravity(env);
  if (agy.changed) print(`Đã cập nhật server "taskflow" của Antigravity (${agy.file}) để dùng chung token này. Bản cũ lưu ở ${agy.file}.bak-taskflow`);
  else if (agy.reason === 'unreadable') print('Không đọc được cấu hình MCP của Antigravity nên chưa cập nhật; Antigravity có thể vẫn dùng token cũ.');
  // wscript đọc được tệp UTF-16 có BOM: đường dẫn có dấu tiếng Việt vẫn chạy đúng.
  writeFileSync(p.launcher, `﻿${launcherScript()}`, 'utf16le');
  if (!systemAllowed(env)) {
    print(process.platform === 'win32' ? 'Bỏ qua đăng ký với Windows (TASKFLOW_SKIP_SYSTEM=1).' : 'Tự chạy khi đăng nhập và nút "Bật agent" hiện chỉ hỗ trợ Windows. Trên máy này hãy chạy "npm run agent".');
    return { registered: false };
  }
  for (const args of registryPlan(p.launcher)) {
    const done = reg(args);
    if (done.status !== 0) throw new Error(`Không ghi được registry (${args[1]}): ${String(done.stderr || done.error?.message || '').trim()}`);
  }
  print('Đã đăng ký: tự chạy ẩn khi đăng nhập Windows, và nút "Bật agent" trên web (taskflow://).');
  // Runner cũ đang chạy vẫn giữ token và code cũ: dừng rồi bật lại để dùng cấu hình vừa cài.
  const old = runningPid(env);
  if (old) {
    try { process.kill(old); } catch { /* đã tự thoát */ }
    rmSync(p.pid, { force: true });
  }
  startBackground(env);
  print(`${old ? 'Đã khởi động lại' : 'Đã bật'} agent chạy nền. Nhật ký: ${p.log}`);
  return { registered: true };
}

export function uninstall({ env = process.env, print = console.log } = {}) {
  const p = paths(env);
  const pid = runningPid(env);
  if (pid) {
    try {
      process.kill(pid);
      print('Đã dừng agent chạy nền.');
    } catch { /* tiến trình vừa tự thoát */ }
  }
  if (systemAllowed(env)) {
    reg(['delete', RUN_KEY, '/v', RUN_VALUE, '/f']);
    reg(['delete', PROTOCOL_KEY, '/f']);
    print('Đã gỡ đăng ký tự chạy và đường dẫn taskflow://.');
  }
  rmSync(p.home, { recursive: true, force: true });
  print(`Đã xóa ${p.home}`);
}

export function status({ env = process.env, print = console.log } = {}) {
  const p = paths(env);
  const saved = loadSavedConfig(env);
  print(saved ? `Cấu hình: ${saved.url}${saved.dir ? `, thư mục dự án ${saved.dir}` : ''}` : 'Chưa cài (chưa có cấu hình).');
  print(runningPid(env) ? `Agent chạy nền: đang bật (pid ${runningPid(env)}). Nhật ký: ${p.log}` : 'Agent chạy nền: đang tắt.');
  if (systemAllowed(env)) print(reg(['query', RUN_KEY, '/v', RUN_VALUE]).status === 0 ? 'Tự chạy khi đăng nhập Windows: có.' : 'Tự chạy khi đăng nhập Windows: không.');
  if (existsSync(p.log)) print(`Nhật ký gần nhất:\n${readFileSync(p.log, 'utf8').trim().split('\n').slice(-5).join('\n')}`);
}

/** `--url x --token y --dir "z"` => { url, token, dir } */
export function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(args[i]);
    if (!match) continue;
    out[match[1]] = match[2] ?? (args[i + 1] && !args[i + 1].startsWith('--') ? args[(i += 1)] : true);
  }
  return out;
}
