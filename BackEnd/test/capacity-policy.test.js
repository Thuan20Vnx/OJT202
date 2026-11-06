import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveCapacity } from '../src/services/capacity.js';
test('U026: missing capacity stays unknown; explicit defaults and zero remain distinct', () => {
  assert.deepEqual(effectiveCapacity(null, null), { available: null, capacitySource: 'missing', missingCapacity: true });
  assert.deepEqual(effectiveCapacity(undefined, 20), { available: 20, capacitySource: 'default', missingCapacity: false });
  assert.equal(effectiveCapacity(0, 20).available, 0);
  assert.equal(effectiveCapacity(undefined, 0).available, 0);
  assert.equal(effectiveCapacity(8, 20).capacitySource, 'week');
  assert.equal(effectiveCapacity(NaN, undefined).missingCapacity, true);
});
