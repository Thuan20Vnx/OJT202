import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.MAIL_MODE = 'outbox';
process.env.DATABASE_URL = '';
const { config } = await import('../src/config.js');

// Construct the application's actual auth router with its production limit.
// Invalid login bodies exercise validation without touching a database or SMTP.
// Load the unused mail adapter with test configuration before selecting the limit.
await import('../src/services/mailer.js');
config.isProd = true;
let createApp;
try {
  ({ createApp } = await import('../src/app.js'));
} finally {
  config.isProd = false;
}

const app = createApp();
app.set('trust proxy', false);
const server = http.createServer(app);
before(() => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
}));
after(() => server.listening && new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

test('U004-T3: auth production chặn request thứ 31; giả IP hoặc đổi alias API không vượt giới hạn', async () => {
  for (let i = 1; i <= 31; i++) {
    const prefix = i % 2 ? '/api/v1' : '/api';
    const response = await fetch(`http://127.0.0.1:${server.address().port}${prefix}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-taskflow': '1', ...(i > 1 && { 'x-forwarded-for': `198.51.100.${i}` }) },
      body: JSON.stringify({ email: 'invalid', password: '' }),
    });
    assert.equal(response.status, i <= 30 ? 400 : 429, `login request ${i}`);
    assert.equal(response.headers.get('ratelimit-limit'), '30');
    if (i === 31) assert.ok(Number(response.headers.get('retry-after')) > 0);
    await response.text();
  }
});
