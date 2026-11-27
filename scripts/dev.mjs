// Chạy song song AIService (5000), BackEnd API (4000) và FrontEnd web (5173) cho môi trường phát triển.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const SERVICES = [
  ['ai', 'AIService', '\x1b[33m'],
  ['api', 'BackEnd', '\x1b[36m'],
  ['web', 'FrontEnd', '\x1b[35m'],
];

const npmCli = process.env.npm_execpath;
const npmCommand = npmCli ? process.execPath : npm;
const npmArgs = (args) => npmCli ? [npmCli, ...args] : args;
const options = { shell: !npmCli && process.platform === 'win32' };
const run = promisify(execFile);
const checks = await Promise.allSettled(
  SERVICES.map(([, dir]) => run(npmCommand, npmArgs(['--prefix', dir, 'ls', '--depth=0']), options)),
);
const failed = checks.flatMap((result, index) => result.status === 'rejected' ? [SERVICES[index][1]] : []);
if (failed.length) {
  console.error(`[dev] Kiểm tra dependency thất bại ở ${failed.join(', ')}. Dừng các phiên dev đang chạy, chạy npm run setup rồi thử lại npm run dev.`);
  process.exit(1);
}

const procs = SERVICES.map(([name, dir, color]) => {
  const p = spawn(npmCommand, npmArgs(['--prefix', dir, 'run', 'dev']), { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `${color}[${name}]\x1b[0m`;
  for (const s of [p.stdout, p.stderr]) s.on('data', (d) => process.stdout.write(String(d).replace(/^/gm, `${tag} `)));
  p.on('exit', (code) => {
    console.log(`${tag} đã dừng (mã ${code})`);
    procs.forEach((x) => x.kill());
    process.exit(code ?? 0);
  });
  return p;
});
process.on('SIGINT', () => procs.forEach((p) => p.kill()));
