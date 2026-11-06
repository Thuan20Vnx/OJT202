import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessUat } from '../uat.mjs';
import { assessGrades } from '../grading.mjs';
import { assessRelease } from '../release.mjs';
import { quantile, median, hash, sourceHash, parseArgs } from '../core.mjs';
import { ACCEPTANCE_COUNTS, validatePack, checkOutput, latencySummary } from '../evaluation.mjs';
import { developmentPack } from '../../../validation/development-pack.mjs';
import { productionSmoke } from '../production-smoke.mjs';

const build = { revision: 'a'.repeat(40), sourceHash: 'b'.repeat(64), dirty: false };
// Synthetic observations below are unit-test inputs only, never UAT evidence.
function observedUat() {
  const participants = Array.from({ length: 6 }, (_, i) => ({ id: `P0${i + 1}`, relationship: i ? 'external' : 'developer', experience: 'new', order: i < 3 ? 'manual-first' : 'ai-first' }));
  return { schemaVersion: 1, build, participants, issues: [], retests: [], trials: participants.flatMap((p) => Array.from({ length: 5 }, (_, i) => ({ participant: p.id, scenario: `S${i + 1}`, success: true, assisted: false, durationMs: 1000, errors: 0, actual: 'Expected output observed', observer: 'test-observer', issueIds: [], build }))), comparisons: participants.map((p) => ({ participant: p.id, manualMs: 1000, aiMs: 700, manualErrors: 1, aiErrors: 1, manualQuality: 0.9, aiQuality: 0.9, manualDataset: p.order === 'manual-first' ? 'A' : 'B', aiDataset: p.order === 'manual-first' ? 'B' : 'A', rubricVersion: 'test-v1', build })) };
}
function gradedRun() {
  const records = Object.entries(ACCEPTANCE_COUNTS).flatMap(([group, count]) => Array.from({ length: count }, (_, i) => ({ caseId: `${group}-${i}`, group, passed: true, status: 200, data: group === 'planner-schema' ? { draft: { items: Array(5).fill({ title: 'Test only' }) } } : group === 'qa-answer' ? { conversation: { messages: [{ citations: [{}] }] } } : {} })));
  const run = { runId: 'test-run', build, pack: { hash: 'test-hash', split: 'acceptance' }, records, groups: Object.fromEntries(Object.entries(ACCEPTANCE_COUNTS).map(([key, count]) => [key, { numerator: count, denominator: count }])) };
  const reviewers = ['test-judge-a', 'test-judge-b'];
  const input = { schemaVersion: 1, runId: run.runId, packHash: run.pack.hash, build, operator: 'test-operator', reviewers, ratings: records.flatMap((row) => reviewers.map((reviewer) => ({ caseId: row.caseId, reviewer, reason: 'Synthetic test observation', criteria: { correct: true, noLeak: true, ...(row.group === 'planner-schema' && { constraintsRespected: true, tasks: Array.from({ length: 5 }, () => Array(5).fill(true)) }), ...(['qa-answer', 'report-metrics'].includes(row.group) && { supported: 1, total: 1 }) } }))), adjudications: [] };
  input.runHash = hash(run);
  return { run, input };
}
test('statistics: p95 keeps slow failures; even-sample median and missing values are explicit', () => {
  assert.equal(quantile([...Array(28).fill(10), 50000, 60000], 0.95), 50000);
  assert.equal(median([1, 4, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.throws(() => median([null, 0]));
  assert.equal(latencySummary([{ status: 503, elapsedMs: 50000 }]).errors, 1);
});
test('packs: duplicate cases, prototype paths, missing assertions and external routes fail closed', () => {
  const pack = developmentPack();
  assert.equal(validatePack(pack), pack);
  for (const mutate of [
    (p) => p.cases.push(p.cases[0]), (p) => { p.cases[0].path = 'https://other.invalid/api'; },
    (p) => { p.cases[0].checks[0].path = '__proto__.leak'; }, (p) => { p.split = 'acceptance'; },
  ]) { const copy = structuredClone(pack); mutate(copy); assert.throws(() => validatePack(copy)); }
  assert.ok(checkOutput({ status: 200, data: {} }, { expectedStatus: 200, checks: [{ path: 'missing', op: 'equal', value: null }] }).length);
  assert.equal(hash({ a: 1, b: 2 }), hash({ b: 2, a: 1 }));
  assert.equal(hash({ at: new Date('2026-11-03T00:00:00Z') }), hash({ at: '2026-11-03T00:00:00.000Z' }));
});
test('CLI rejects duplicate/missing options instead of overwriting run inputs', () => {
  assert.throws(() => parseArgs(['--out'], ['out']));
  assert.throws(() => parseArgs(['--out', 'a', '--out', 'b'], ['out']));
});
test('build identity survives Windows/Linux line endings without normalizing binary fixtures', () => {
  assert.equal(sourceHash(Buffer.from('a\r\nb\r\n'), 'app.ts'), sourceHash(Buffer.from('a\nb\n'), 'app.ts'));
  assert.notEqual(sourceHash(Buffer.from('a\r\n'), 'image.png'), sourceHash(Buffer.from('a\n'), 'image.png'));
  assert.throws(() => sourceHash(Buffer.from([0xff]), 'app.js'), /UTF-8/);
});
test('UAT: absent humans stay pending with denominator 30 and no invented completion rate', () => {
  const result = assessUat({ schemaVersion: 1, build, participants: [], trials: [], comparisons: [], issues: [], retests: [] });
  assert.equal(result.status, 'pending'); assert.equal(result.success.denominator, 30); assert.equal(result.success.rate, null); assert.equal(result.baseline.improvementPct, null);
});
test('UAT: assisted success does not count; duplicate trials and mixed builds are rejected', () => {
  const input = observedUat(); input.trials[0].assisted = true;
  assert.equal(assessUat(input).success.numerator, 29);
  input.trials.push(input.trials[0]); assert.throws(() => assessUat(input));
  const other = observedUat(); other.trials[0].build = { ...build, sourceHash: 'c'.repeat(64) }; assert.throws(() => assessUat(other));
});
test('UAT: 26/30 fails; baseline needs balanced crossover and preserved quality', () => {
  const input = observedUat();
  assert.equal(assessUat(input).baseline.status, 'passed');
  input.trials.slice(0, 4).forEach((row) => { row.success = false; });
  assert.equal(assessUat(input).status, 'failed');
  input.comparisons.forEach((row) => { row.aiQuality = 0.5; });
  assert.equal(assessUat(input).baseline.status, 'failed');
});
test('UAT: latest independent retest controls blocking issue, older pass cannot hide a new failure', () => {
  const input = observedUat();
  input.issues = [{ id: 'B1', reportedBy: 'observer', severity: 'high', description: 'Test blocker' }];
  input.retests = [{ issueId: 'B1', reviewer: 'independent', build, passed: true, notes: 'Test result', testedAt: '2026-11-01T01:00:00Z' }, { issueId: 'B1', reviewer: 'independent', build, passed: false, notes: 'Regression', testedAt: '2026-11-02T01:00:00Z' }];
  assert.equal(assessUat(input).status, 'failed');
  input.retests[0].reviewer = 'observer'; assert.throws(() => assessUat(input));
});
test('AI scores: missing judges have unknown quality; developer pack cannot become acceptance', () => {
  const { run, input } = gradedRun(); input.ratings = []; input.reviewers = [];
  const result = assessGrades(run, input);
  assert.equal(result.status, 'pending'); assert.equal(result.metrics.qaCorrect.numerator, null); assert.equal(result.metrics.qaCorrect.rate, null);
  const full = gradedRun(); full.run.pack.split = 'development'; full.input.runHash = hash(full.run); assert.equal(assessGrades(full.run, full.input).status, 'pending');
});
test('AI scores: both independent grades persist; disagreement needs a third adjudicator', () => {
  const { run, input } = gradedRun();
  const frozen = assessGrades(run, input);
  assert.equal(frozen.status, 'passed');
  assert.equal(frozen.ratings.length, input.ratings.length);
  assert.equal(frozen.finalGrades.length, run.records.length);
  input.ratings[0].criteria.correct = false;
  assert.equal(frozen.ratings[0].criteria.correct, true);
  assert.equal(assessGrades(run, input).status, 'pending');
  input.adjudications.push({ ...structuredClone(input.ratings[1]), reviewer: 'third-reviewer', reason: 'Independent reconciliation' });
  assert.equal(assessGrades(run, input).status, 'passed');
  assert.equal(input.ratings[0].criteria.correct, false);
  input.adjudications[0].reviewer = input.reviewers[0]; assert.throws(() => assessGrades(run, input));
});
test('AI scores: one wrong report metric or any leakage fails even if prose/refusal averages pass', () => {
  const { run, input } = gradedRun();
  run.records.find((r) => r.group === 'report-metrics').passed = false;
  input.runHash = hash(run);
  assert.equal(assessGrades(run, input).status, 'failed');
  const other = gradedRun(); const id = other.run.records.find((r) => r.group === 'qa-refusal').caseId;
  other.input.ratings.filter((r) => r.caseId === id).forEach((r) => { r.criteria.noLeak = false; });
  const result = assessGrades(other.run, other.input);
  assert.equal(result.metrics.qaRefusal.passed, true);
  assert.equal(result.metrics.noLeaks.passed, false); assert.equal(result.status, 'failed');
});
test('AI scores reject altered outputs even when run ID, pack and revision remain unchanged', () => {
  const { run, input } = gradedRun();
  run.records[0].data.draft.items[0].title = 'Changed after grading';
  assert.throws(() => assessGrades(run, input), /Outputs changed/);
});
test('release: missing gates, wrong build, empty AI rubric and localhost smoke cannot permit final tag', () => {
  const input = { schemaVersion: 1, build, operator: 'release-operator', knownIssues: [], evidence: {} };
  assert.equal(assessRelease(input).readyForFinal, false);
  input.evidence.U033 = { kind: 'production-smoke', build, mode: 'local-production', origin: 'http://localhost', status: 'passed', productionVerified: false, checks: [{ passed: true }] };
  assert.equal(assessRelease(input).gates.U033.status, 'failed');
  input.evidence.U032 = { ...assessUat(observedUat()), build: { ...build, sourceHash: 'wrong' } };
  assert.equal(assessRelease(input).gates.U032.status, 'failed');
  input.evidence.U029 = { kind: 'ai-quality', build, status: 'passed', split: 'acceptance', missing: [], metrics: {}, baseline: { status: 'passed' }, latency: Object.fromEntries(['planner', 'report', 'qa', 'risk'].map((name) => [name, { requests: 30, p95Ms: 1, errors: 0 }])) };
  assert.equal(assessRelease(input).gates.U029.status, 'failed');
});
test('release permits final only when every required gate passes on the same clean build', () => {
  const { run, input: scores } = gradedRun();
  const uat = assessUat(observedUat());
  const quality = { ...assessGrades(run, scores), baseline: uat.baseline, latency: Object.fromEntries(['planner', 'report', 'qa', 'risk'].map((name) => [name, { requests: 30, p95Ms: 100, errors: 0 }])) };
  const input = { schemaVersion: 1, operator: 'test-operator', build, knownIssues: [], evidence: {
    U029: quality,
    U030: { kind: 'security-regression', build, status: 'passed', openCriticalHigh: 0, checks: ['cross-tenant', 'idor', 'xss', 'token-reuse', 'upload', 'injection'].map((name) => ({ name, passed: true })) },
    U031: { kind: 'performance-restore', build, status: 'passed', virtualUsers: 50, taskCount: 10000, readRequests: 100, p95Ms: 799, restoreVerified: true, environment: 'test fixture', backupHash: 'test-backup' },
    U032: uat,
    U033: { kind: 'production-smoke', build, status: 'passed', mode: 'production', origin: 'https://example.test', productionVerified: true, checks: [{ passed: true }] },
    U034: { kind: 'independent-install', build, status: 'passed', installer: 'independent-member', documentationMatched: true, cleanInstall: true, logHash: 'test-log' },
    U035: { kind: 'demo-rehearsal', build, status: 'passed', durationMinutes: 11, collaborators: ['a', 'b'], approvalVerified: true, citationsVerified: true, fallbackLabelled: true, qualityRunId: quality.runId, uatBuildHash: build.sourceHash },
  } };
  assert.equal(assessRelease(input).tagAllowed, true);
  input.build = { ...build, dirty: true }; assert.equal(assessRelease(input).tagAllowed, false);
  input.build = build; input.evidence.U031.p95Ms = 800; assert.equal(assessRelease(input).tagAllowed, false);
});
test('production smoke refuses plaintext remote URL and credentials embedded in URL', async () => {
  await assert.rejects(productionSmoke({ url: 'http://example.com', expectedBuild: build }));
  await assert.rejects(productionSmoke({ url: 'https://user:secret@example.com', expectedBuild: build }));
});
