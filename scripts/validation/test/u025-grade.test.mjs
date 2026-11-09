import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessU025 } from '../u025-grade.mjs';
import { hash } from '../core.mjs';

// Synthetic unit-test inputs only; these are not project acceptance grades.
function fixture() {
  const evidence = Array.from({ length: 70 }, (_, i) => ({ caseId: `SYNTH-${i}`, citationOpenEvidence: [{ step: 0, index: 0, citation: { refId: `source-${i}` }, status: 200 }] }));
  const run = { split: 'development', acceptanceEligible: false, operator: 'synthetic-operator', packHash: 'synthetic-pack', datasetHash: 'synthetic-data', records: evidence.map((e, i) => ({ caseId: e.caseId, group: i < 40 ? 'qa-answer' : i < 50 ? 'qa-refusal' : 'qa-security', technicalPassed: true, evidenceHash: hash(e) })) };
  run.runHash = hash(run);
  const grades = [1, 2].map(i => ({ runHash: run.runHash, packHash: run.packHash, datasetHash: run.datasetHash, reviewer: `synthetic-reviewer-${i}`, independentSubmittedAt: '2026-01-01T00:00:00Z', ratings: run.records.map((r, j) => ({ caseId: r.caseId,
    criteria: { correct: true, noLeak: true, factsComplete: true, noUnsupportedClaims: true, hasRequiredCitations: true, refusalAppropriate: true, behaviorSatisfied: true, supported: 1, total: 1 },
    citations: [{ step: 0, index: 0, refId: `source-${j}`, supportsClaim: true, openedAsActor: true, correct: true, reason: 'synthetic assertion', openEvidenceRef: 'synthetic-response' }],
    reason: 'synthetic assertion', gradedAt: '2026-01-01T00:00:00Z' })) }));
  return { run, evidence, grades };
}
test('U025 grading includes security/refusal citations, never promotes development to acceptance', () => {
  const f = fixture();
  let r = assessU025(f.run, f.evidence, f.grades);
  assert.equal(r.status, 'development-passed'); assert.equal(r.acceptanceEligible, false); assert.equal(r.citations.total, 70);
  for (const g of f.grades) for (const row of g.ratings.slice(50)) { row.criteria.supported = 0; row.citations[0].supportsClaim = false; row.citations[0].correct = false; }
  r = assessU025(f.run, f.evidence, f.grades);
  assert.equal(r.citations.supported, 50); assert.equal(r.status, 'development-failed');
});
test('U025 grading separates double-grade coverage from agreement; blank scores remain null', () => {
  const f = fixture(); f.grades[1].ratings.splice(1);
  const r = assessU025(f.run, f.evidence, f.grades);
  assert.equal(r.doubleGraded, 1); assert.equal(r.agreementRate, 1); assert.equal(r.coverage, 1 / 70);
  assert.equal(r.status, 'pending'); assert.equal(r.qaCorrect.numerator, null); assert.equal(r.missing.length, 69);
});
test('U025 grading refuses tampered evidence and self-grading', () => {
  const f = fixture(); f.evidence[0].citationOpenEvidence[0].status = 404;
  assert.throws(() => assessU025(f.run, f.evidence, f.grades), /Evidence hash/);
  const g = fixture(); g.grades[0].reviewer = g.run.operator;
  assert.throws(() => assessU025(g.run, g.evidence, g.grades), /Operator/);
});
test('U025 grading leaves disagreements pending without bound third-person adjudication', () => {
  const f = fixture(); f.grades[1].ratings[0].criteria.correct = false;
  const r = assessU025(f.run, f.evidence, f.grades);
  assert.equal(r.status, 'pending'); assert.deepEqual(r.unresolved, ['SYNTH-0']); assert.equal(r.agreementRate, 69 / 70);
});
test('U025 grading rejects omitted/duplicate citations, not merely plausible totals', () => {
  const f = fixture(); f.grades[0].ratings[45].citations = []; f.grades[0].ratings[45].criteria.total = 0;
  const r = assessU025(f.run, f.evidence, f.grades);
  assert.equal(r.status, 'pending'); assert.deepEqual(r.missing, ['SYNTH-45']);
});
