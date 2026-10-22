// Chạy song song AIService (5000), BackEnd API (4000) và FrontEnd web (5173) cho môi trường phát triển.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const SERVICES = [
  ['ai', 'AIService', '\x1b[33m'],
  ['api', 'BackEnd', '\x1b[36m'],
  ['web', 'FrontEnd', '\x1b[35m'],
];
const procs = SERVICES.map(([name, dir, color]) => {
  const p = spawn(npm, ['--prefix', dir, 'run', 'dev'], { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
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
