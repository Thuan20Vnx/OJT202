import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT, buildIdentity, hash, parseArgs, readJson, requireValue, sameBuild, writeJson } from './validation/core.mjs';
import { evaluate, validatePack } from './validation/evaluation.mjs';
import { assessGrades } from './validation/grading.mjs';
import { assessUat } from './validation/uat.mjs';
import { assessRelease } from './validation/release.mjs';
import { productionSmoke } from './validation/production-smoke.mjs';
import { evaluationMarkdown } from './validation/report.mjs';
import { developmentPack } from '../validation/development-pack.mjs';

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const runOptions = ['out', 'pack', 'expected-pack-hash', 'samples', 'provider', 'max-paid-requests'];
  const options = { identity: [], 'clean-install': ['out'], uat: ['input', 'out'], grade: ['input', 'run', 'uat', 'out'], release: ['input', 'out'], smoke: ['url', 'out'], evaluate: runOptions, local: runOptions, demo: ['out', 'failure'] };
  requireValue(Object.hasOwn(options, command), 'Command: identity | evaluate | uat | grade | smoke | release | demo | clean-install');
  const args = parseArgs(rest, options[command]);
  const build = await buildIdentity();
  const out = path.resolve(args.out ?? path.join(ROOT, '.data/validation', `${command}-${randomUUID()}`));
  const save = (name, value) => writeJson(path.join(out, `${name}.json`), value);
  if (command === 'identity') {
    console.log(JSON.stringify(build));
  } else if (command === 'clean-install') {
    const { cleanInstall } = await import('./validation/clean-install.mjs');
    const result = await cleanInstall();
    await save('clean-install', result);
    console.log(JSON.stringify({ out, status: result.status, acceptanceStatus: result.acceptanceStatus }));
    if (result.status === 'failed') process.exitCode = 1;
  } else if (command === 'uat') {
    requireValue(args.input, '--input is required');
    const result = assessUat(await readJson(args.input));
    await save('uat', result);
    console.log(JSON.stringify({ out, status: result.status, success: result.success, baseline: result.baseline }));
    if (result.status === 'failed') process.exitCode = 1;
  } else if (command === 'grade') {
    requireValue(args.input && args.run, '--input and --run are required');
    const run = await readJson(args.run);
    const result = assessGrades(run, await readJson(args.input));
    const uat = args.uat ? await readJson(args.uat) : null;
    if (uat) requireValue(uat.kind === 'uat' && sameBuild(uat.build, run.build), 'Baseline must come from the same UAT build');
    result.baseline = uat?.baseline ?? { status: 'pending' };
    result.latency = Object.fromEntries(Object.entries(run.benchmarks).map(([feature, data]) => [feature, { requests: data.requests, p50Ms: data.p50Ms, p95Ms: data.p95Ms, errors: data.errors }]));
    if (result.status === 'passed') result.status = result.baseline.status === 'pending' ? 'pending' : result.baseline.status === 'failed' || Object.values(result.latency).some((row) => row.requests < 30 || row.p95Ms > 20000 || row.errors) ? 'failed' : 'passed';
    await save('ai-quality', result);
    console.log(JSON.stringify({ out, status: result.status, missing: result.missing }));
    if (result.status === 'failed') process.exitCode = 1;
  } else if (command === 'release') {
    const input = args.input ? await readJson(args.input) : { schemaVersion: 1, build, operator: 'local-automation', knownIssues: [], evidence: {} };
    requireValue(input.build.sourceHash === build.sourceHash && input.build.revision === build.revision, 'Release evidence must describe the current source/build');
    input.build = build;
    if (args.input) {
      const resolved = {};
      for (const [gate, descriptor] of Object.entries(input.evidence)) {
        requireValue(typeof descriptor.path === 'string' && /^[a-f0-9]{64}$/.test(descriptor.sha256), `Evidence ${gate} requires a file path and frozen SHA-256`);
        const bytes = await fs.readFile(path.resolve(path.dirname(path.resolve(args.input)), descriptor.path));
        requireValue(hash(bytes) === descriptor.sha256, `Evidence ${gate} hash changed`);
        resolved[gate] = JSON.parse(bytes.toString('utf8'));
      }
      input.evidence = resolved;
    }
    const result = assessRelease(input);
    await save('release-readiness', result);
    console.log(JSON.stringify({ out, ...result }));
    if (!result.readyForFinal) process.exitCode = 2;
  } else if (command === 'smoke') {
    requireValue(args.url, '--url https://your-origin is required');
    const credentials = process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD ? { email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD } : undefined;
    const result = await productionSmoke({ url: args.url, expectedBuild: build, credentials });
    await save('production-smoke', result);
    console.log(JSON.stringify({ out, status: result.status, checks: result.checks }));
    if (result.status !== 'passed') process.exitCode = 2;
  } else if (['evaluate', 'local', 'demo'].includes(command)) {
    requireValue(['none', 'quota', 'offline'].includes(args.failure ?? 'none'), '--failure must be none, quota or offline');
    const pack = validatePack(args.pack ? await readJson(args.pack) : developmentPack());
    const samples = Number(args.samples ?? 30);
    requireValue(Number.isInteger(samples) && samples >= 1 && samples <= 100, '--samples must be 1..100');
    if (args.provider === 'configured') requireValue(Number.isInteger(Number(args['max-paid-requests'])) && Number(args['max-paid-requests']) >= pack.cases.length + 4 * samples && Number(args['max-paid-requests']) <= 10000, 'Configured provider requires an explicit --max-paid-requests covering the planned run (maximum 10000); provider billing limits must also be configured');
    if (pack.split === 'acceptance') {
      requireValue(args['expected-pack-hash'] === hash(pack), 'Acceptance pack must match the previously frozen hash');
      const relative = path.relative(ROOT, path.resolve(args.pack));
      requireValue(relative.startsWith(`..${path.sep}`) || relative.startsWith(`.data${path.sep}`), 'Keep hidden acceptance data outside tracked source');
    }
    const { startFixture } = await import('./validation/fixture.mjs');
    const fixture = await startFixture({ provider: args.provider ?? 'local', requestLimit: Number(args['max-paid-requests'] ?? 2000) });
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await fixture.close(); };
    if (command === 'demo') {
      if (args.failure === 'quota') {
        const ws = await fixture.db.prisma.workspace.findUnique({ where: { id: fixture.workspace } });
        await fixture.db.prisma.workspace.update({ where: { id: ws.id }, data: { ai: { ...ws.ai, dailyLimit: 0 } } });
      }
      if (args.failure === 'offline') { const { config } = await import('../BackEnd/src/config.js'); config.ai.serviceUrl = 'http://127.0.0.1:1'; }
      try { await save('demo-session', { schemaVersion: 1, kind: 'isolated-demo', build, dataset: fixture.dataset, failure: args.failure ?? 'none', base: fixture.base, production: false }); }
      catch (error) { await stop(); throw error; }
      console.log(JSON.stringify({ url: fixture.base, project: fixture.project, workspace: fixture.workspace, out, reset: 'Stop and restart; a new temporary DB is created', failure: args.failure ?? 'none' }));
      const finish = () => { stop().then(() => process.exit(0), () => process.exit(1)); };
      process.on('SIGINT', finish); process.on('SIGTERM', finish);
      process.stdin.on('data', (value) => { if (String(value).trim() === 'stop') finish(); });
      setTimeout(finish, 30 * 60 * 1000);
      return;
    }
    try {
      const result = await evaluate(fixture, pack, build, samples);
      await save('ai-run', result);
      await fs.writeFile(path.join(out, 'report.md'), evaluationMarkdown(result), { flag: 'wx', mode: 0o600 });
      await save('scores', { schemaVersion: 1, runId: result.runId, runHash: hash(result), packHash: result.pack.hash, build, operator: 'local-automation', reviewers: [], ratings: [], adjudications: [] });
      await save('uat-input', { schemaVersion: 1, build, participants: [], trials: [], comparisons: [], issues: [], retests: [] });
      await save('uat', assessUat({ schemaVersion: 1, build, participants: [], trials: [], comparisons: [], issues: [], retests: [] }));
      await save('release-readiness', assessRelease({ schemaVersion: 1, build, operator: 'local-automation', knownIssues: [], evidence: {} }));
      console.log(JSON.stringify({ out, technicalStatus: result.technicalStatus, acceptanceStatus: result.acceptanceStatus, cases: result.records.length, benchmarks: Object.fromEntries(Object.entries(result.benchmarks).map(([key, value]) => [key, { requests: value.requests, p95Ms: value.p95Ms, errors: value.errors }])) }));
      if (result.technicalStatus !== 'passed') process.exitCode = 1;
    } finally { await stop(); }
    if (command === 'local') {
      const preview = await startFixture({ production: true, build });
      try {
        const result = await productionSmoke({ url: preview.base, expectedBuild: build, mode: 'local-production', credentials: { email: 'mai.anh@nhom24.edu.vn', password: 'TaskFlow@2026' } });
        await save('local-production-smoke', result);
        console.log(JSON.stringify({ smoke: result.status, productionVerified: result.productionVerified, checks: result.checks }));
        if (result.status !== 'passed') process.exitCode = 1;
      } finally { await preview.close(); }
    }
  } else throw new Error('Command: evaluate | uat | grade | smoke | release | demo | clean-install');
}
main().catch((error) => { console.error(`[validation] ${error.message}`); process.exitCode = 1; });
