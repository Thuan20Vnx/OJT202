import { finite, median, nonempty, requireValue, sameBuild, unique } from './core.mjs';

export function assessUat(input) {
  requireValue(input?.schemaVersion === 1 && nonempty(input.build?.sourceHash) && nonempty(input.build?.revision), 'UAT needs build identity');
  const { participants, trials, comparisons, issues, retests } = input;
  for (const [key, rows] of Object.entries({ participants, trials, comparisons, issues, retests })) requireValue(Array.isArray(rows), `${key} must be an array`);
  requireValue(participants.length <= 6, 'UAT has exactly six planned participants');
  unique(participants, (p) => p.id, 'participant');
  const ids = new Set(participants.map((p) => p.id));
  for (const p of participants) requireValue(/^P0[1-6]$/.test(p.id) && ['external', 'developer'].includes(p.relationship) && nonempty(p.experience) && ['manual-first', 'ai-first'].includes(p.order), 'Invalid anonymized participant');
  unique(trials, (row) => `${row.participant}:${row.scenario}`, 'UAT trial');
  unique(comparisons, (row) => row.participant, 'paired baseline');
  unique(issues, (row) => row.id, 'issue');
  const issueIds = new Set(issues.map((issue) => issue.id));
  for (const row of trials) {
    requireValue(ids.has(row.participant) && /^S[1-5]$/.test(row.scenario) && sameBuild(row.build, input.build), 'UAT trial participant/scenario/build mismatch');
    requireValue(typeof row.success === 'boolean' && typeof row.assisted === 'boolean' && finite(row.durationMs, 1) && Number.isInteger(row.errors) && row.errors >= 0 && nonempty(row.observer) && row.observer !== row.participant && nonempty(row.actual), 'Invalid UAT observation');
    requireValue(Array.isArray(row.issueIds) && row.issueIds.every((id) => issueIds.has(id)), 'Unknown UAT issue reference');
  }
  for (const issue of issues) requireValue(nonempty(issue.id) && nonempty(issue.reportedBy) && nonempty(issue.description) && ['critical', 'high', 'medium', 'low'].includes(issue.severity), 'Invalid issue');
  for (const row of retests) {
    const issue = issues.find((item) => item.id === row.issueId);
    requireValue(issue && sameBuild(row.build, input.build) && nonempty(row.reviewer) && row.reviewer !== issue.reportedBy && typeof row.passed === 'boolean' && nonempty(row.notes) && !Number.isNaN(Date.parse(row.testedAt)), 'Retest needs an independent reviewer, timestamp and the same build');
  }
  for (const row of comparisons) {
    const participant = participants.find((p) => p.id === row.participant);
    requireValue(participant && finite(row.manualMs, 1) && finite(row.aiMs, 1) && [row.manualErrors, row.aiErrors].every((n) => Number.isInteger(n) && n >= 0) && [row.manualQuality, row.aiQuality].every((n) => finite(n) && n <= 1), 'Invalid paired baseline');
    requireValue(nonempty(row.rubricVersion) && row.manualDataset === (participant.order === 'manual-first' ? 'A' : 'B') && row.aiDataset === (participant.order === 'manual-first' ? 'B' : 'A') && sameBuild(row.build, input.build), 'Baseline datasets/order/rubric/build mismatch');
  }
  requireValue(new Set(comparisons.map((row) => row.rubricVersion)).size <= 1, 'Both conditions must use the same rubric');
  const successes = trials.filter((row) => row.success && !row.assisted).length;
  const blocking = issues.filter((issue) => ['critical', 'high'].includes(issue.severity) && !retests.filter((row) => row.issueId === issue.id).sort((a, b) => Date.parse(b.testedAt) - Date.parse(a.testedAt))[0]?.passed);
  const complete = participants.length === 6 && trials.length === 30;
  const balanced = participants.filter((p) => p.order === 'manual-first').length === 3 && participants.filter((p) => p.order === 'ai-first').length === 3;
  const baselineComplete = comparisons.length === 6 && participants.length === 6 && balanced;
  const manualMedianMs = baselineComplete ? median(comparisons.map((row) => row.manualMs)) : null;
  const aiMedianMs = baselineComplete ? median(comparisons.map((row) => row.aiMs)) : null;
  const improvementPct = baselineComplete ? (manualMedianMs - aiMedianMs) / manualMedianMs * 100 : null;
  const qualityPreserved = baselineComplete ? median(comparisons.map((row) => row.aiQuality)) >= median(comparisons.map((row) => row.manualQuality)) && median(comparisons.map((row) => row.aiErrors)) <= median(comparisons.map((row) => row.manualErrors)) : null;
  return { schemaVersion: 1, kind: 'uat', build: input.build, status: blocking.length || complete && successes < 27 ? 'failed' : complete ? 'passed' : 'pending', participants: participants.length, externalParticipants: participants.filter((p) => p.relationship === 'external').length, completed: trials.length, success: { numerator: successes, denominator: 30, rate: complete ? successes / 30 : null }, medianTaskMs: trials.length ? median(trials.map((row) => row.durationMs)) : null, blockingIssues: blocking.map((issue) => issue.id), baseline: { status: !baselineComplete ? 'pending' : improvementPct >= 30 && qualityPreserved ? 'passed' : 'failed', pairs: comparisons.length, denominator: 6, balanced, manualMedianMs, aiMedianMs, improvementPct, qualityPreserved }, limitations: 'Six participants support conclusions within this project, not a market-wide claim.' };
}
