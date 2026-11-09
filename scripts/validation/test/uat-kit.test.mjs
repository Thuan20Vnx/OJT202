import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyUat, rehearsalTemplate, UAT_SCENARIOS } from '../uat-kit.mjs';
import { assessUat } from '../uat.mjs';

test('UAT preparation cannot pass human acceptance without observations', () => {
  const build = { revision: 'test-revision', sourceHash: 'test-source' };
  const result = assessUat(emptyUat(build));
  assert.equal(result.status, 'pending'); assert.equal(result.completed, 0);
  assert.equal(result.success.rate, null); assert.equal(result.baseline.status, 'pending');
  assert.equal(rehearsalTemplate(build).durationMinutes, null);
  assert.deepEqual(UAT_SCENARIOS.map(row => row.id), ['S1', 'S2', 'S3', 'S4', 'S5']);
});
