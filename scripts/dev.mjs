// Chạy song song API (4000) và web (5173) cho môi trường phát triển.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = [
  ['api', ['--prefix', 'server', 'run', 'dev']],
  ['web', ['--prefix', 'client', 'run', 'dev']],
].map(([name, args]) => {
  const p = spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = name === 'api' ? '\x1b[36m[api]\x1b[0m' : '\x1b[35m[web]\x1b[0m';
  for (const s of [p.stdout, p.stderr]) s.on('data', (d) => process.stdout.write(String(d).replace(/^/gm, `${tag} `)));
  p.on('exit', (code) => {
    console.log(`${tag} đã dừng (mã ${code})`);
    procs.forEach((x) => x.kill());
    process.exit(code ?? 0);
  });
  return p;
});
process.on('SIGINT', () => procs.forEach((p) => p.kill()));
