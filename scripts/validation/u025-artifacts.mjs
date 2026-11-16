import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dataset, pack } from '../../validation/u025/development.mjs';
import { ROOT, hash, buildIdentity, writeJson } from './core.mjs';

const folder = path.join(ROOT, 'docs/sprint3-loc/u025-t0');
const counts = { 'qa-answer': 40, 'qa-refusal': 10, 'qa-security': 20 };
const read = async name => JSON.parse(await fs.readFile(path.join(folder, name), 'utf8'));
const sources = [...dataset.tasks, ...dataset.documents, ...dataset.comments];
function checkSpec(data, spec) {
  assert.equal(spec.split, 'development');
  assert.equal(spec.acceptanceEligible, false);
  assert.equal(data.split, 'development');
  assert.equal(spec.fixtureVersion, data.version);
  assert.equal(spec.cases.length, 70);
  assert.equal(new Set(spec.cases.map(c => c.id)).size, 70);
  assert.equal(new Set(sources.map(s => s.id)).size, sources.length);
  for (const [group, n] of Object.entries(counts)) assert.equal(spec.cases.filter(c => c.group === group).length, n);
  assert.equal(new Set(spec.cases.map(c => hash({ input: c.input, actor: c.actor, preconditions: c.preconditions, steps: c.steps }))).size, 70);
  const ids = new Set(sources.map(s => s.id));
  for (const c of spec.cases) {
    assert.ok(data.actors[c.actor] && data.projects.some(p => p.id === c.project));
    assert.ok(c.preconditions.length && c.steps.length && c.input.question.trim());
    assert.ok(c.expected);
    for (const id of [...(c.expected.sourceIds ?? []), ...(c.expected.protectedSourceIds ?? [])]) assert.ok(ids.has(id), `${c.id}: unknown source ${id}`);
    if (c.group === 'qa-answer') {
      assert.ok(c.expected.requiredFacts.length && c.expected.sourceIds.length && c.expected.citationRequired);
      assert.equal(c.expected.refused, false);
    }
    if (c.group === 'qa-refusal') assert.ok(c.expected.refused && c.expected.reason);
    if (c.group === 'qa-security') assert.ok(c.expected.noLeak && c.expected.requiredBehavior.length && c.evidenceRequired.length);
  }
  // Independently recompute the aggregate answer keys from the public source snapshot.
  const active = data.tasks.filter(t => t.project === 'P-A' && !t.deletedAt);
  assert.equal(active.length, 10);
  for (const [test, expected] of [
    [t => t.status === 'done', ['DEV-3', 'DEV-8']],
    [t => t.status === 'review', ['DEV-4', 'DEV-10']],
    [t => t.assignee === null, ['DEV-5', 'DEV-9']],
    [t => t.dueDate === null, ['DEV-4', 'DEV-7']],
    [t => t.assignee === 'Bình', ['DEV-2', 'DEV-6']],
    [t => t.assignee === 'An', ['DEV-1', 'DEV-4', 'DEV-8']],
    [t => t.status !== 'done' && t.dueDate && Date.parse(t.dueDate) < Date.parse(data.clock), ['DEV-6']],
  ]) assert.deepEqual(active.filter(test).map(t => t.id), expected);
}
const binding = () => ({ runId: null, runHash: null, packHash: hash(pack), datasetHash: hash(dataset), build: null, provider: null, model: null, promptHash: null, sourceIdMap: null });
const gradeRows = () => pack.cases.map(c => ({ caseId: c.id, group: c.group, criteria: null, citations: [], reason: null, gradedAt: null }));
const artifacts = {
  'development-dataset.json': dataset,
  'development-cases.json': pack,
  'development-observations.template.json': { schemaVersion: 1, kind: 'u025-observations-template', split: 'development', ...binding(), operator: null,
    records: pack.cases.map(c => ({ caseId: c.id, input: c.input, startedAt: null, status: 'not-run', steps: [], output: null, outputHash: null, error: null, sourceSnapshots: [], citationOpenEvidence: [], technicalPassed: null })) },
  'grader-1.template.json': { schemaVersion: 1, kind: 'u025-independent-grade-template', split: 'development', ...binding(), rubricVersion: 'u025-rubric-v1', reviewer: null, independentSubmittedAt: null, ratings: gradeRows() },
  'grader-2.template.json': { schemaVersion: 1, kind: 'u025-independent-grade-template', split: 'development', ...binding(), rubricVersion: 'u025-rubric-v1', reviewer: null, independentSubmittedAt: null, ratings: gradeRows() },
  'adjudication.template.json': { schemaVersion: 1, kind: 'u025-adjudication-template', split: 'development', ...binding(), adjudicator: null, originalGradeHashes: [null, null], decisions: [],
    summary: { status: 'pending', doubleGraded: 0, agreements: null, agreementRate: null, disagreements: [], missing: pack.cases.map(c => c.id),
      qaCorrect: { numerator: null, denominator: 40, target: 32 }, qaRefusal: { numerator: null, denominator: 10, target: 9 },
      qaLeaks: { numerator: null, denominator: 20, target: 0 }, citations: { supported: null, total: null, rate: null, target: 0.9 } } },
  'acceptance-handoff.template.json': { schemaVersion: 1, kind: 'u025-private-handoff-template', status: 'pending-custodian', expectedCounts: counts,
    custodian: null, acceptanceVersion: null, caseMetadata: [], packCanonicalSha256: null, answerKeyCanonicalSha256: null,
    datasetVersion: null, datasetCanonicalSha256: null, rubricVersion: null, rubricSha256: null,
    frozenAt: null, frozenBy: null, commitmentReceipt: null, promptTuningStartedAt: null, frozenBeforeTuningEvidence: null,
    accessPolicyEvidence: null, authorizedGraders: [], accessAuditEvidence: null, overlapReviewEvidence: null,
    privateStorageReference: null, mutationHistory: [], executionAdapterVersion: null, executionPreflightEvidence: null,
    build: null, promptHash: null, provider: null, model: null, runId: null, runHash: null,
    operator: null, reviewers: [], adjudicator: null, originalRatingsEvidence: [], adjudicationEvidence: null,
    acceptancePassed: null, note: 'No hidden questions, answers, outputs, signatures or historical freeze claims have been fabricated. Metadata and commitments must be supplied by the custodian.' },
};

async function verify() {
  checkSpec(await read('development-dataset.json'), await read('development-cases.json'));
  for (const [name, expected] of Object.entries(artifacts)) assert.deepEqual(await read(name), expected, `${name}: content differs from published template/source`);
  const manifest = await read('manifest.json');
  for (const [name, digest] of Object.entries(manifest.files)) assert.equal(hash(await fs.readFile(path.join(folder, name))), digest, `Hash mismatch: ${name}`);
  assert.equal(manifest.packCanonicalSha256, hash(pack));
  assert.equal(manifest.datasetCanonicalSha256, hash(dataset));
  assert.equal(manifest.split, 'development');
  assert.equal(manifest.acceptanceStatus, 'pending');
  return { schemaVersion: 1, kind: 'u025-artifact-verification', artifactStatus: 'passed', counts,
    uniqueCases: 70, templatesWithHumanResults: 0, applicationCasesExecuted: 0, providerCalls: 0,
    hiddenCasesReceived: 0, acceptanceStatus: 'pending', packCanonicalSha256: hash(pack), datasetCanonicalSha256: hash(dataset),
    checks: ['70 unique case IDs and distinct input/actor/precondition/step combinations', '40/10/20 group counts', 'source/actor/project references', 'concrete preconditions, steps and expected criteria', 'aggregate answer keys recomputed from dataset', 'generated JSON matches authored public source', 'SHA-256 for all listed artifacts', 'human scores/output/freeze evidence remain unfilled'] };
}

async function main() {
  const mode = process.argv[2];
  assert.ok(['prepare', 'verify'].includes(mode), 'Usage: node scripts/validation/u025-artifacts.mjs prepare|verify');
  checkSpec(dataset, pack);
  if (mode === 'prepare') {
    // Append-only publication: use a new version/directory for changes after review.
    for (const [name, value] of Object.entries(artifacts)) await writeJson(path.join(folder, name), value);
    const names = [...Object.keys(artifacts), 'README.md', 'RUBRIC.md', 'CUSTODIAN_HANDOFF.md'];
    const files = Object.fromEntries(await Promise.all(names.map(async name => [name, hash(await fs.readFile(path.join(folder, name)))])));
    await writeJson(path.join(folder, 'manifest.json'), { schemaVersion: 1, version: pack.version, split: 'development', createdAt: new Date().toISOString(),
      build: await buildIdentity(), counts, packCanonicalSha256: hash(pack), datasetCanonicalSha256: hash(dataset),
      fileHashAlgorithm: 'sha256-raw-bytes', objectHashAlgorithm: 'scripts/validation/core.mjs hash (sorted object keys, array order preserved)',
      acceptanceStatus: 'pending', frozenBeforeTuning: null, files });
    await writeJson(path.join(folder, 'verification.json'), await verify());
  }
  const result = await verify();
  assert.deepEqual(await read('verification.json'), result);
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
