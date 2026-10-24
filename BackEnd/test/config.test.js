import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
function boot(extra = {}, code = "const {config} = await import('./src/config.js'); console.log(JSON.stringify({seedDemo: config.seedDemo}));") {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    JWT_SECRET: 'test-only-32-characters-not-a-real-secret',
    AI_SERVICE_KEY: 'local-test-service-key',
    DOTENV_CONFIG_PATH: '__no_env_file_for_config_tests__',
    ...extra,
  };
  if (extra.SEED_DEMO === undefined) delete env.SEED_DEMO;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd, env, encoding: 'utf8' });
}

test('production never seeds public demo accounts, including explicit seed command', () => {
  const defaults = boot();
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.ok(defaults.stdout.includes('"seedDemo":false'));
  const enabled = boot({ SEED_DEMO: 'true' });
  assert.equal(enabled.status, 1);
  assert.ok(enabled.stderr.includes('Không được bật SEED_DEMO'));
  const direct = boot({ SEED_DEMO: 'false' }, "const {seedDemo} = await import('./src/seed.js'); await seedDemo();");
  assert.equal(direct.status, 1);
  assert.ok(direct.stderr.includes('Không được tạo tài khoản demo'));
});

test('production refuses default and short signing secrets', () => {
  for (const secret of ['short-secret', 'change-me-dev-only-secret']) {
    const result = boot({ JWT_SECRET: secret });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('JWT_SECRET production'));
  }
});
