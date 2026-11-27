// Cài đặt runner chạy nền: chỉ thử phần ghi tệp trong thư mục tạm, không đụng registry của máy chạy test.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { acquireLock, install, launcherScript, loadSavedConfig, parseArgs, paths, registryPlan, runningPid, status, uninstall } from '../src/setup.js';

const home = mkdtempSync(path.join(os.tmpdir(), 'taskflow-setup-test-'));
const env = { TASKFLOW_HOME: path.join(home, 'cfg'), TASKFLOW_SKIP_SYSTEM: '1', TASKFLOW_AGY_CONFIG: path.join(home, 'gemini', 'mcp_config.json') };
const quiet = { env, print: () => {} };
after(() => rmSync(home, { recursive: true, force: true }));

test('đọc tham số dòng lệnh, kể cả đường dẫn có dấu cách', () => {
  assert.deepEqual(parseArgs(['--url', 'http://a', '--token=tfp_x', '--dir', 'C:/Dự án/x y', 'thừa']), { url: 'http://a', token: 'tfp_x', dir: 'C:/Dự án/x y' });
});

test('cài: từ chối khi thiếu token hoặc thư mục không tồn tại', () => {
  assert.throws(() => install({ url: 'http://a' }, quiet), /--token/);
  assert.throws(() => install({ token: 'tfp_x', dir: path.join(home, 'khong-co') }, quiet), /Không tìm thấy thư mục/);
  assert.equal(existsSync(paths(env).config), false);
});

test('cài: lưu cấu hình và tệp khởi chạy ẩn đọc được đường dẫn có dấu', () => {
  const lines = [];
  const result = install({ url: 'http://localhost:4000/', token: 'tfp_x', dir: home }, { env, print: (line) => lines.push(line) });
  assert.equal(result.registered, false);
  assert.deepEqual(loadSavedConfig(env), { url: 'http://localhost:4000', token: 'tfp_x', dir: path.resolve(home) });
  const raw = readFileSync(paths(env).launcher);
  assert.deepEqual([raw[0], raw[1]], [0xff, 0xfe], 'UTF-16 có BOM');
  const script = raw.toString('utf16le');
  assert.match(script, /runner\.js"" --background", 0, False/);
  assert.ok(!lines.join('\n').includes('tfp_x'), 'không in token ra màn hình');
});

test('cài: mục taskflow của Antigravity trỏ về server này, bỏ token cũ, giữ server khác', () => {
  const file = env.TASKFLOW_AGY_CONFIG;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ mcpServers: { khac: { command: 'x' }, taskflow: { command: 'node', args: ['cu.js'], env: { TASKFLOW_TOKEN: 'tfp_cu' } } } }));
  install({ token: 'tfp_moi' }, quiet);
  const config = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(config.mcpServers.khac, { command: 'x' });
  assert.equal(config.mcpServers.taskflow.env, undefined, 'không ghi token vào cấu hình Antigravity');
  assert.match(config.mcpServers.taskflow.args[0], /index\.js$/);
  assert.match(readFileSync(`${file}.bak-taskflow`, 'utf8'), /tfp_cu/, 'giữ bản sao lưu');
});

test('tệp khởi chạy và registry không nhận tham số từ đường dẫn taskflow://', () => {
  const launcher = 'C:/Users/Nguyễn Văn A/.taskflow/start-agent.vbs';
  const plan = registryPlan(launcher);
  assert.equal(plan.length, 4);
  assert.ok(plan.every((args) => args[0] === 'add' && args[1].startsWith('HKCU\\')), 'chỉ ghi vào tài khoản người dùng');
  assert.ok(plan.every((args) => !args.join(' ').includes('%1')), 'không chuyển nội dung đường dẫn vào dòng lệnh');
  assert.equal(plan.at(-1).at(-2), `wscript.exe "${launcher}"`);
  assert.ok(!/WScript\.Arguments/i.test(launcherScript('C:/n o/node.exe', 'C:/r/runner.js')));
  assert.match(launcherScript('C:/n o/node.exe', 'C:/r/runner.js'), /"""C:\/n o\/node\.exe"" ""C:\/r\/runner\.js"" --background"/);
});

test('chỉ một runner nền; gỡ cài đặt xóa sạch cấu hình', () => {
  assert.equal(runningPid(env), null);
  assert.equal(acquireLock(env), true);
  assert.equal(runningPid(env), process.pid);
  assert.equal(acquireLock(env), false, 'tiến trình thứ hai không được chạy');
  const lines = [];
  status({ env, print: (line) => lines.push(line) });
  assert.match(lines.join('\n'), /đang bật/);
  rmSync(paths(env).pid);
  uninstall(quiet);
  assert.equal(existsSync(paths(env).home), false);
  assert.equal(loadSavedConfig(env), null);
});
