import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotateConversation, sourceFingerprint } from '../src/services/ai/qa.js';

test('U025: citation thể hiện thời điểm/version nguồn hiện tại và phát hiện nguồn thay đổi', () => {
  const sources = [{ kind: 'document', refId: 'doc', version: 2, updatedAt: '2026-10-29T10:00:00Z', text: 'Nguồn' }];
  const conv = { messages: [{ role: 'assistant', sourceRevision: sourceFingerprint(sources), citations: [{ kind: 'document', refId: 'doc' }] }] };
  const result = annotateConversation(conv, sources).messages[0];
  assert.equal(result.sourceState, 'current');
  assert.equal(result.citations[0].available, true);
  assert.equal(result.citations[0].currentVersion, 2);
  assert.equal(result.citations[0].currentUpdatedAt, sources[0].updatedAt);
  const changed = annotateConversation(conv, [{ ...sources[0], version: 3 }]).messages[0];
  assert.equal(changed.sourceState, 'changed');
  assert.equal(changed.citations[0].currentVersion, 3);
  const gone = annotateConversation(conv, []).messages[0].citations[0];
  assert.equal(gone.available, false);
  assert.equal(gone.currentUpdatedAt, null);
});
