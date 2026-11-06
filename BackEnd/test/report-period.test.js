import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportPeriod } from '../src/services/ai/report-period.js';

test('U022: calendar date aliases and canonical timestamps share a half-open interval', () => {
  const alias = reportPeriod({ from: '2026-11-08', to: '2026-11-08' });
  assert.equal(alias.from.toISOString(), '2026-11-07T17:00:00.000Z');
  assert.equal(alias.to.toISOString(), '2026-11-08T17:00:00.000Z');
  const canonical = reportPeriod({ period_start: alias.from.toISOString(), period_end: alias.to.toISOString() });
  assert.deepEqual(canonical, { ...alias, from: new Date(alias.from), to: new Date(alias.to) });
});
test('U022: DST report days have 23/25 hours in project timezone', () => {
  for (const [day, hours] of [['2026-03-08', 23], ['2026-11-01', 25]]) {
    const period = reportPeriod({ from: day, to: day }, 'America/New_York');
    assert.equal((period.to - period.from) / 3600000, hours);
  }
});
test('U022: empty/reversed/invalid intervals fail; explicit offsets stay exact', () => {
  for (const [start, end] of [['2026-02-30', '2026-03-01'], ['2026-11-08', '2026-11-08'], ['2026-11-09', '2026-11-08']]) {
    assert.throws(() => reportPeriod({ period_start: start, period_end: end }));
  }
  const p = reportPeriod({ from: '2026-11-08T00:00:00+09:00', to: '2026-11-09T00:00:00+09:00' });
  assert.equal(p.to.toISOString(), '2026-11-08T15:00:00.000Z');
});
