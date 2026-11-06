import { nonempty, requireValue, sameBuild } from './core.mjs';

export const RELEASE_GATES = ['U029', 'U030', 'U031', 'U032', 'U033', 'U034', 'U035'];
const qualityTargets = { plannerSchema: [20, 0.9], plannerUsableTasks: [null, 0.8], reportMetrics: [20, 1], reportClaims: [null, 0.9], qaCorrect: [40, 0.8], qaRefusal: [10, 0.9], qaSecurity: [20, 1], citations: [null, 0.9], riskRules: [20, 1], noLeaks: [null, 1] };
const qualityPassed = (metrics) => Object.entries(qualityTargets).every(([name, [denominator, target]]) => {
  const metric = metrics?.[name];
  return metric?.passed === true && Number.isInteger(metric.numerator) && Number.isInteger(metric.denominator) && metric.numerator >= 0 && metric.numerator <= metric.denominator && metric.denominator > 0 && (denominator == null || metric.denominator === denominator) && metric.numerator / metric.denominator >= target;
});
export function assessRelease(input) {
  requireValue(input?.schemaVersion === 1 && nonempty(input.build?.revision) && nonempty(input.build?.sourceHash) && nonempty(input.operator) && input.evidence && Array.isArray(input.knownIssues), 'Invalid release candidate');
  const gates = {};
  const decide = (id, kind, condition) => {
    const evidence = input.evidence[id];
    gates[id] = !evidence ? { status: 'pending', reason: 'Missing evidence' }
      : !sameBuild(evidence.build, input.build) || evidence.kind !== kind ? { status: 'failed', reason: 'Evidence kind/build mismatch' }
        : { status: evidence.status === 'passed' && condition(evidence) ? 'passed' : evidence.status === 'pending' ? 'pending' : 'failed', reason: 'Evidence assessed against required conditions' };
  };
  decide('U029', 'ai-quality', (e) => e.split === 'acceptance' && e.missing?.length === 0 && qualityPassed(e.metrics) && e.baseline?.status === 'passed' && ['planner', 'report', 'qa', 'risk'].every((feature) => e.latency?.[feature]?.requests >= 30 && e.latency[feature].p95Ms >= 0 && e.latency[feature].p95Ms <= 20000 && e.latency[feature].errors === 0));
  decide('U030', 'security-regression', (e) => ['cross-tenant', 'idor', 'xss', 'token-reuse', 'upload', 'injection'].every((name) => e.checks?.some((c) => c.name === name && c.passed === true)) && e.openCriticalHigh === 0);
  decide('U031', 'performance-restore', (e) => e.virtualUsers >= 50 && e.taskCount >= 10000 && e.readRequests >= 30 && typeof e.p95Ms === 'number' && e.p95Ms >= 0 && e.p95Ms < 800 && e.restoreVerified === true && nonempty(e.environment) && nonempty(e.backupHash));
  decide('U032', 'uat', (e) => e.completed === 30 && e.participants === 6 && e.success?.numerator >= 27 && e.success.numerator <= 30 && e.success.denominator === 30 && e.blockingIssues?.length === 0);
  decide('U033', 'production-smoke', (e) => e.productionVerified === true && e.mode === 'production' && /^https:\/\//.test(e.origin) && e.checks?.length > 0 && e.checks.every((c) => c.passed === true));
  decide('U034', 'independent-install', (e) => nonempty(e.installer) && e.installer !== input.operator && e.documentationMatched === true && e.cleanInstall === true && nonempty(e.logHash));
  decide('U035', 'demo-rehearsal', (e) => e.durationMinutes >= 10 && e.durationMinutes <= 12 && new Set(e.collaborators).size >= 2 && e.approvalVerified === true && e.citationsVerified === true && e.fallbackLabelled === true && e.qualityRunId === input.evidence.U029?.runId && e.uatBuildHash === input.build.sourceHash);
  for (const issue of input.knownIssues) requireValue(nonempty(issue.id) && nonempty(issue.description) && ['critical', 'high', 'medium', 'low'].includes(issue.severity) && typeof issue.resolved === 'boolean', 'Every known issue needs a severity and disposition');
  const blockers = input.knownIssues.filter((issue) => !issue.resolved && ['critical', 'high'].includes(issue.severity)).map((issue) => issue.id);
  const ready = input.build.dirty === false && RELEASE_GATES.every((id) => gates[id].status === 'passed') && !blockers.length;
  return { schemaVersion: 1, kind: 'release-readiness', build: input.build, gates, blockers, readyForFinal: ready, status: ready ? 'passed' : Object.values(gates).some((gate) => gate.status === 'failed') || blockers.length ? 'failed' : 'pending', tagAllowed: ready, pending: [...RELEASE_GATES.filter((id) => gates[id].status === 'pending'), ...(input.build.dirty !== false ? ['Clean release candidate build'] : [])] };
}
