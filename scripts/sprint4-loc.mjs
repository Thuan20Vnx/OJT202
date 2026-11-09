import path from 'node:path';
import { buildIdentity, parseArgs, requireValue, writeJson } from './validation/core.mjs';
import { startFixture } from './validation/fixture.mjs';
import { emptyUat, prepareUatKit, rehearsalTemplate } from './validation/uat-kit.mjs';

const [command = 'prepare', ...args] = process.argv.slice(2);
requireValue(['prepare', 'serve', 'security'].includes(command), 'Use prepare, serve or security');
const options = parseArgs(args, ['out', 'minutes']);
const minutes = Number(options.minutes ?? 60);
requireValue(Number.isInteger(minutes) && minutes >= 1 && minutes <= 240, 'Minutes must be 1..240');
const out = path.resolve(options.out ?? `.data/sprint4-loc/${command}-${Date.now()}`);
const build = await buildIdentity();
let fixture, failed = false;
try {
  fixture = await startFixture({ build });
  const kit = await prepareUatKit(fixture, build);
  await writeJson(path.join(out, 'kit.json'), kit);
  await writeJson(path.join(out, 'uat-observations.json'), emptyUat(build));
  await writeJson(path.join(out, 'rehearsal.json'), rehearsalTemplate(build));
  console.log(JSON.stringify({ command, out, sourceHash: build.sourceHash, slots: kit.dataset.slots.length, tasks: kit.dataset.taskCount, humanAcceptance: 'pending' }));
  if (command === 'security') {
    const { securityMatrix } = await import('./validation/security-matrix.mjs');
    const result = await securityMatrix(fixture, kit, out);
    await writeJson(path.join(out, 'security.json'), result);
    console.log(JSON.stringify({ checks: result.records.length, failed: result.records.filter(row => !row.passed) }));
    failed = result.records.some(row => !row.passed);
  }
  if (command === 'serve') {
    console.log(`Isolated UAT: ${fixture.base}; expires in ${minutes} minutes. Public demo password: TaskFlow@2026. Ctrl+C stops and clears temporary data. No paid AI provider.`);
    await new Promise(resolve => {
      const finish = () => { clearTimeout(timer); process.off('SIGINT', finish); process.off('SIGTERM', finish); resolve(); };
      const timer = setTimeout(finish, minutes * 60000);
      process.once('SIGINT', finish); process.once('SIGTERM', finish);
    });
  }
} finally { await fixture?.close(); }
// Set the command verdict after all fixture cleanup has completed.
if (failed) process.exitCode = 1;
