import assert from 'node:assert/strict';
import { fold } from '../../AIService/src/text.js';

// Development assertions, not independent semantic scores. Keep the published
// expected facts unchanged; human graders still assess unsupported claims.
const facts = {
  '01': [/\ban\b/], '02': [/can lam/], '03': [/17:00/, /10\/11\/2026/], '04': [/chua co han chot/], '05': [/chua giao/],
  '06': [/reg204/], '07': [/409/], '08': [/email hop le/, /dang ky/, /trung.*409/], '09': [/ho ten/, /email/], '10': [/da giu cho/],
  '11': [/dev-1/, /api dang ky/], '12': [/dev-1/, /dang thuc hien/], '13': [/\/huong-dan/], '14': [/ma qr/], '15': [/80 phien/],
  '16': [/load-result\.txt/], '17': [/24 gio/], '18': [/nhac lich tham du/], '19': [/quet qr/], '20': [/ma khong hop le/],
  '21': [/viewer chi xem/, /khong tao yeu cau ai/], '22': [/1 den 5/, /tuy chon/], '23': [/\/thong-bao/],
  '24': [/csv utf-8/, /ho ten/, /email/, /trang thai diem danh/], '25': [/09:00/, /20\/11\/2026/, /phong sen/],
  '26': [/18:00/, /18\/11\/2026/, /120/], '27': [/\/huy-dang-ky/, /truoc han/, /18:00/, /18\/11\/2026/],
  '28': [/\blan\b/, /hotro@example\.test/], '29': [/csv utf-8/, /2 mb/], '30': [/14 ngay/], '31': [/xanh duong/],
  '32': [/\b10\b/], '38': [/\b3\b/], '39': [/dev-1/, /cung/],
};
const sets = { '33': ['DEV-3', 'DEV-8'], '34': ['DEV-4', 'DEV-10'], '35': ['DEV-5', 'DEV-9'], '36': ['DEV-4', 'DEV-7'], '37': ['DEV-2', 'DEV-6'], '38': ['DEV-1', 'DEV-4', 'DEV-8'], '40': ['DEV-6'] };
export function checkAnswerFacts(id, answer) {
  assert.ok(answer, 'missing assistant answer');
  assert.equal(answer.refused, false, 'unexpected refusal');
  assert.ok(answer.citations?.length, 'missing citations');
  const n = id.slice(-2), text = fold(answer.content);
  for (const pattern of facts[n] || []) assert.match(text, pattern);
  if (sets[n]) {
    const found = [...new Set(answer.content.match(/DEV-\d+/g) || [])].sort();
    assert.deepEqual(found, [...sets[n]].sort(), 'complete task set');
  }
}
