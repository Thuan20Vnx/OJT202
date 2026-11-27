// Che bí mật trong câu trả lời/báo cáo agent trước khi lưu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MASK, redactSecrets } from '../src/services/repo/secrets.js';

test('che cả khối khóa riêng PEM, không chỉ dòng BEGIN', () => {
  const { text, hits } = redactSecrets('trước\n-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nabcdef\n-----END RSA PRIVATE KEY-----\nsau');
  assert.equal(text, `trước\n${MASK}\nsau`);
  assert.deepEqual(hits, [{ type: 'Khóa riêng', severity: 'high', line: 2 }]);
  // Thiếu dòng END: che tới hết văn bản.
  assert.equal(redactSecrets('-----BEGIN PRIVATE KEY-----\nMIIabc\nxyz').text, MASK);
  // ...nhưng không nuốt phần văn bản thường phía sau
  assert.equal(redactSecrets('-----BEGIN PRIVATE KEY-----\nMIIabc\ndòng chữ tiếp theo').text, `${MASK}\ndòng chữ tiếp theo`);
});

test('che giá trị bí mật có hoặc không có ngoặc, bỏ qua giá trị mẫu', () => {
  assert.equal(redactSecrets('password=unquotedsecret99 tiếp').text, `password=${MASK} tiếp`);
  assert.equal(redactSecrets('password="supersecret123"').text, `password="${MASK}"`);
  for (const sample of ['password: your-password', 'api_key=${API_KEY}', 'secret: process.env.SECRET', 'token: changeme12345'])
    assert.equal(redactSecrets(sample).text, sample);
  assert.equal(redactSecrets('AKIAABCDEFGHIJKLMNOP').text, MASK);
});
