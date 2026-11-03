import { hash, requireValue } from './core.mjs';

export async function productionSmoke({ url, expectedBuild, credentials, mode = 'production' }) {
  const base = new URL(url);
  requireValue(!base.username && !base.password && base.pathname === '/' && !base.search && !base.hash, 'Use an origin URL without credentials/path/query');
  requireValue(base.protocol === 'https:' || mode === 'local-production' && base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Production smoke requires HTTPS; HTTP is only allowed for an explicitly labelled loopback probe');
  const checks = [];
  const request = async (route, options = {}) => {
    const response = await fetch(new URL(route, base), { ...options, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const body = await response.text();
    return { status: response.status, headers: response.headers, body };
  };
  const check = (name, passed) => checks.push({ name, passed: Boolean(passed) });
  let observedBuild = null;
  try {
    const health = await request('/api/health');
    let parsed;
    try { parsed = JSON.parse(health.body); } catch { parsed = null; }
    observedBuild = parsed?.build ?? null;
    check('health-json', health.status === 200 && parsed?.ok === true && /application\/json/.test(health.headers.get('content-type') || ''));
    check('build-identity', Boolean(expectedBuild?.revision && expectedBuild?.sourceHash) && observedBuild?.revision === expectedBuild.revision && observedBuild?.sourceHash === expectedBuild.sourceHash);
    for (const route of ['/api/workspaces', '/api/__missing_smoke', '/api/dev/outbox']) {
      const result = await request(route);
      check(`private-json:${route}`, [401, 404].includes(result.status) && /application\/json/.test(result.headers.get('content-type') || ''));
    }
    const versioned = await request('/api/v1/health');
    check('versioned-api', versioned.status === 200 && /application\/json/.test(versioned.headers.get('content-type') || ''));
    const login = await request('/login'), reload = await request('/board');
    check('route-reload', login.status === 200 && reload.status === 200 && /text\/html/.test(login.headers.get('content-type') || '') && hash(login.body) === hash(reload.body));
    check('html-no-store', /no-store/.test(login.headers.get('cache-control') || ''));
    check('security-headers', login.headers.get('x-content-type-options') === 'nosniff' && /frame-ancestors 'self'|frame-ancestors 'none'/.test(login.headers.get('content-security-policy') || ''));
    const assets = [...login.body.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)].map((match) => new URL(match[1], base));
    check('build-assets-listed', assets.length > 0);
    for (const asset of assets) {
      requireValue(asset.origin === base.origin, 'Smoke will not fetch assets on a different origin');
      const response = await request(asset.pathname);
      check(`asset:${asset.pathname}`, response.status === 200 && (asset.pathname.endsWith('.css') ? /text\/css/ : /(?:java|ecma)script/).test(response.headers.get('content-type') || '') && /immutable/.test(response.headers.get('cache-control') || ''));
    }
    const missing = await request('/assets/__missing_smoke.js');
    check('missing-asset-404', missing.status === 404 && !/text\/html/.test(missing.headers.get('content-type') || ''));
    const foreign = await request('/api/auth/login', { method: 'POST', headers: { origin: 'https://untrusted.invalid', 'content-type': 'application/json', 'x-taskflow': '1' }, body: '{}' });
    check('foreign-origin-rejected', foreign.status === 403);
    const preflight = await request('/api/auth/login', { method: 'OPTIONS', headers: { origin: 'https://untrusted.invalid', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-taskflow,content-type' } });
    check('foreign-preflight-blocked', preflight.headers.get('access-control-allow-origin') !== 'https://untrusted.invalid');
    if (credentials) {
      // Only an explicitly supplied test account creates a session. No task data is modified.
      const signed = await request('/api/auth/login', { method: 'POST', headers: { origin: base.origin, 'content-type': 'application/json', 'x-taskflow': '1' }, body: JSON.stringify(credentials) });
      const cookies = signed.headers.getSetCookie();
      const access = cookies.find((value) => value.startsWith('tf_at=')), refresh = cookies.find((value) => value.startsWith('tf_rt='));
      check('secure-auth-cookies', signed.status === 200 && [access, refresh].every((value) => value && /;\s*HttpOnly/i.test(value) && /;\s*Secure/i.test(value) && /;\s*SameSite=Lax/i.test(value)) && /;\s*Path=\/(?:;|$)/i.test(access) && /;\s*Path=\/api\/auth(?:;|$)/i.test(refresh));
      if (signed.status === 200) {
        const cookie = cookies.map((value) => value.split(';')[0]).join('; ');
        const logout = await request('/api/auth/logout', { method: 'POST', headers: { cookie, origin: base.origin, 'x-taskflow': '1' } });
        check('session-cleanup', logout.status === 200);
      }
    } else checks.push({ name: 'secure-auth-cookies', passed: null, reason: 'Explicit test account not supplied' });
  } catch (error) { checks.push({ name: 'probe-execution', passed: false, reason: error.name }); }
  return { schemaVersion: 1, kind: 'production-smoke', mode, origin: base.origin, build: expectedBuild ?? null, observedBuild, checkedAt: new Date().toISOString(), checks, status: checks.some((item) => item.passed === false) ? 'failed' : checks.some((item) => item.passed === null) ? 'pending' : 'passed', productionVerified: mode === 'production' && checks.every((item) => item.passed === true) };
}
