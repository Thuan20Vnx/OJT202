import os from 'node:os';
import { hash, nonempty, requireValue, quantile, unique } from './core.mjs';

const FEATURES = ['planner', 'report', 'qa', 'risk'];
export const ACCEPTANCE_COUNTS = { 'planner-schema': 20, 'report-metrics': 20, 'qa-answer': 40, 'qa-refusal': 10, 'qa-security': 20, 'risk-rules': 20 };
export function validatePack(pack) {
  requireValue(pack?.schemaVersion === 1 && nonempty(pack.version) && ['development', 'acceptance'].includes(pack.split), 'Invalid evaluation pack/version/split');
  requireValue(pack.fixtureVersion === 'taskflow-evaluation-fixture-v2' && Array.isArray(pack.cases) && pack.cases.length > 0 && pack.cases.length <= 500, 'Invalid fixture version or case count');
  unique(pack.cases, (c) => c.id, 'case ID');
  for (const c of pack.cases) {
    requireValue(nonempty(c.id) && FEATURES.includes(c.feature) && nonempty(c.group), 'Invalid case ID/feature/group');
    requireValue(['standard', 'empty', 'done', 'no-deadline', 'available-capacity', 'no-dependency', 'parent-child', 'blocker-done', 'reopened'].includes(c.scenario ?? 'standard'), 'Unknown fixture scenario');
    requireValue(['pm', 'member', 'viewer', 'outsider'].includes(c.actor) && ['GET', 'POST'].includes(c.method), `Invalid case actor/method: ${c.id}`);
    const route = c.path?.replaceAll('$project', 'fixture');
    requireValue(typeof route === 'string' && /^\/api\/projects\/fixture\/(ai\/(plan|reports|ask)|risks(\/explain)?)$/.test(route), `Unsupported evaluation route: ${c.id}`);
    requireValue(Number.isInteger(c.expectedStatus) && c.expectedStatus >= 200 && c.expectedStatus <= 599 && Array.isArray(c.checks), `Invalid expected result: ${c.id}`);
    for (const check of c.checks) {
      requireValue(nonempty(check.path) && check.path.split('.').every((part) => !['__proto__', 'constructor', 'prototype'].includes(part)) && ['equal', 'between', 'atLeast', 'excludes'].includes(check.op) && Object.hasOwn(check, 'value'), `Invalid assertion: ${c.id}`);
      if (check.op === 'between') requireValue(Array.isArray(check.value) && check.value.length === 2 && check.value.every(Number.isFinite) && check.value[0] <= check.value[1], 'Invalid bounds');
      if (check.op === 'atLeast') requireValue(Number.isFinite(check.value), 'Invalid numeric threshold');
      if (check.op === 'excludes') requireValue(nonempty(check.value), 'Invalid excluded evidence');
    }
    if (pack.split === 'acceptance' && c.expectedStatus < 300) requireValue(c.checks.length > 0, `Acceptance case needs assertions: ${c.id}`);
  }
  if (pack.split === 'acceptance') {
    requireValue(nonempty(pack.frozenBy) && !Number.isNaN(Date.parse(pack.frozenAt)) && Date.parse(pack.frozenAt) <= Date.now(), 'Acceptance pack needs valid freeze metadata');
    for (const [group, count] of Object.entries(ACCEPTANCE_COUNTS)) requireValue(pack.cases.filter((c) => c.group === group).length === count, `Acceptance denominator ${group} must be ${count}`);
  }
  return pack;
}
const substitute = (value, variables) => typeof value === 'string' ? value.replace(/\$(project|riskKey)\b/g, (_, key) => variables[key]) : Array.isArray(value) ? value.map((it) => substitute(it, variables)) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, variables)])) : value;
function getPath(value, route) {
  for (const part of route.split('.')) {
    if (value == null || !Object.hasOwn(Object(value), part)) return undefined;
    value = value[part];
  }
  return value;
}
export function checkOutput(result, testCase) {
  const failures = [];
  if (result.status !== testCase.expectedStatus) failures.push(`HTTP ${result.status}, expected ${testCase.expectedStatus}`);
  for (const check of testCase.checks) {
    const actual = getPath(result.data, check.path);
    const passed = actual === undefined ? false : check.op === 'equal' ? hash(actual) === hash(check.value)
      : check.op === 'atLeast' ? typeof actual === 'number' && actual >= check.value
        : check.op === 'between' ? typeof actual === 'number' && actual >= check.value[0] && actual <= check.value[1]
          : typeof actual === 'string' && !actual.includes(check.value);
    if (!passed) failures.push(`Assertion ${check.path} ${check.op} failed`);
  }
  return failures;
}
export function latencySummary(rows) {
  const values = rows.map((row) => row.elapsedMs);
  return { requests: rows.length, errors: rows.filter((row) => row.status === 0 || row.status >= 400).length, p50Ms: quantile(values, 0.5), p95Ms: quantile(values, 0.95), sampleTarget: 30, complete: rows.length >= 30, includesFailures: true };
}
export async function evaluate(fixture, pack, build, samples = 30) {
  validatePack(pack);
  requireValue(Number.isInteger(samples) && samples >= 1 && samples <= 100, 'Samples must be 1..100');
  const runId = `eval-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
  const records = [];
  const runCase = async (c) => {
    await fixture.prepareScenario(c.scenario);
    const before = await fixture.db.prisma.task.count({ where: { project: fixture.project } });
    const result = await fixture.actors[c.actor].request(c.method, substitute(c.path, fixture.variables), substitute(c.body, fixture.variables));
    const failures = checkOutput(result, c);
    if (c.feature === 'planner' && await fixture.db.prisma.task.count({ where: { project: fixture.project } }) !== before) failures.push('Planner wrote tasks before approval');
    return { caseId: c.id, group: c.group, feature: c.feature, input: c.body ?? null, ...result, failures, passed: failures.length === 0 };
  };
  for (const c of pack.cases) records.push(await runCase(c));
  const benchmarks = {};
  for (const feature of FEATURES) {
    const c = pack.cases.find((item) => item.feature === feature && item.method === 'POST' && item.expectedStatus < 300 && item.actor === 'pm')
      ?? pack.cases.find((item) => item.feature === feature && item.method === 'POST' && item.expectedStatus < 300);
    requireValue(c, `No AI benchmark case for ${feature}`);
    const rows = [];
    for (let i = 0; i < samples; i++) rows.push(await runCase(c));
    benchmarks[feature] = { ...latencySummary(rows), rows };
  }
  const calls = await fixture.db.prisma.aiCall.findMany({ where: { workspace: fixture.workspace }, orderBy: { createdAt: 'asc' }, select: { feature: true, status: true, model: true, provider: true, inputTokens: true, outputTokens: true, latencyMs: true, queuedAt: true, finishedAt: true, attempts: true, usageComplete: true } });
  const groups = Object.fromEntries([...new Set(pack.cases.map((c) => c.group))].map((group) => {
    const rows = records.filter((r) => r.group === group);
    return [group, { numerator: rows.filter((r) => r.passed).length, denominator: rows.length }];
  }));
  const environment = { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model ?? null, parallelism: os.availableParallelism(), memoryBytes: os.totalmem(), network: 'loopback HTTP', concurrency: 1, cache: 'Mixed application/database cache; no samples discarded', aiSettings: (await fixture.db.prisma.workspace.findUnique({ where: { id: fixture.workspace }, select: { ai: true } })).ai };
  return { schemaVersion: 1, kind: 'ai-evaluation', runId, build, pack: { version: pack.version, split: pack.split, hash: hash(pack), frozenAt: pack.frozenAt ?? null }, dataset: fixture.dataset, environment, provider: fixture.provider, cost: null, costReason: fixture.provider === 'local' ? 'Local provider; no paid model quality or cost claim' : 'Pricing not supplied; unknown token usage is not zero cost', groups, records, benchmarks, calls, technicalStatus: records.every((r) => r.passed) ? 'passed' : 'failed', acceptanceStatus: 'pending', pending: ['Independent human scoring', 'Manual/AI baseline with 6 participants', ...(pack.split !== 'acceptance' ? ['Hidden acceptance pack'] : [])] };
}
