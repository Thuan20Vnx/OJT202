import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// U034-T1: OpenAPI phải khớp build. Mỗi tuyến khai báo trong BackEnd/src/routes đều phải có trong
// docs/design/openapi.json (x-source trỏ đúng file). Thêm/bớt route mà quên chạy generate-contract-docs sẽ fail.
const root = path.resolve(import.meta.dirname, '../../..');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'docs/design/openapi.json'), 'utf8'));
const routesDir = path.join(root, 'BackEnd/src/routes');

test('OpenAPI liệt kê đủ mọi tuyến của từng file route', () => {
  const documented = {};
  // Đếm theo x-source (file:dòng) vì alias như /tasks, /me/tasks nhân bản tag của route gốc.
  for (const ops of Object.values(spec.paths)) for (const op of Object.values(ops)) {
    const tag = /^BackEnd\/src\/routes\/(\w+)\.js:\d+$/.exec(op['x-source'] || '')?.[1];
    if (tag) documented[tag] = (documented[tag] || 0) + 1;
  }
  const missing = [];
  for (const file of fs.readdirSync(routesDir).filter((name) => name.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(routesDir, file), 'utf8');
    const declared = [...text.matchAll(/router\.(get|post|patch|put|delete)\('/g)].length;
    const tag = file.replace(/\.js$/, '');
    if (declared !== (documented[tag] || 0)) missing.push(`${file}: source ${declared}, openapi ${documented[tag] || 0}`);
  }
  assert.deepEqual(missing, [], 'Chạy node scripts/generate-contract-docs.mjs và thêm file route mới vào bảng files của script');
});

test('API agent /mcp dùng Bearer token agent, không dùng cookie', () => {
  const mcp = Object.entries(spec.paths).filter(([url]) => url.startsWith('/mcp/'));
  assert.ok(mcp.length > 0);
  for (const [url, ops] of mcp) for (const op of Object.values(ops)) assert.deepEqual(op.security, [{ agentToken: [] }], url);
  assert.equal(spec.components.securitySchemes.agentToken.scheme, 'bearer');
});
