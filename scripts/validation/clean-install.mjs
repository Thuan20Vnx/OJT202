import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, buildIdentity, hash, requireValue } from './core.mjs';

export async function cleanInstall() {
  const build = await buildIdentity();
  const npmCli = process.env.npm_execpath;
  requireValue(npmCli?.endsWith('npm-cli.js'), 'Run clean-install through npm run validate:install');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taskflow-clean-install-'));
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
  const steps = [];
  try {
    for (const file of files) {
      requireValue(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..') && !file.split(/[\\/]/).some((part) => ['node_modules', '.git', '.data', 'dist', '.env'].includes(part)), `Unsafe install snapshot path: ${file}`);
      const destination = path.join(directory, file);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(path.join(ROOT, file), destination);
    }
    for (const args of [['ci'], ['--prefix', 'BackEnd', 'ci'], ['--prefix', 'AIService', 'ci'], ['--prefix', 'FrontEnd', 'ci'], ['run', 'build'], ['run', 'test:validation']]) {
      const started = performance.now();
      try {
        const result = await promisify(execFile)(process.execPath, [npmCli, ...args], { cwd: directory, windowsHide: true, timeout: 180000, maxBuffer: 5 * 1024 * 1024, env: { ...process.env, DATABASE_URL: '', ANTHROPIC_API_KEY: '', NODE_ENV: 'test' } });
        steps.push({ command: `npm ${args.join(' ')}`, status: 'passed', elapsedMs: performance.now() - started, log: result.stdout + result.stderr });
      } catch (error) {
        steps.push({ command: `npm ${args.join(' ')}`, status: 'failed', elapsedMs: performance.now() - started, log: `${error.stdout ?? ''}${error.stderr ?? ''}`, code: error.code });
        break;
      }
    }
    const after = await buildIdentity();
    requireValue(after.sourceHash === build.sourceHash, 'Source changed while clean-install was running; rerun on a frozen build');
    return { schemaVersion: 1, kind: 'automated-clean-install', build, status: steps.length === 6 && steps.every((step) => step.status === 'passed') ? 'passed' : 'failed', fileCount: files.length, steps, logHash: hash(steps), independentInstaller: null, acceptanceStatus: 'pending', reason: 'Automated clean install does not replace installation by another team member' };
  } finally {
    if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('taskflow-clean-install-')) await fs.rm(directory, { recursive: true, force: true });
  }
}
