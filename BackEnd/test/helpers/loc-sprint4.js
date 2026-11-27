import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { config } from '../../src/config.js';

export function locSprint4({ fixture, db, Client, seed, base }) {
  for (const operation of ['upload', 'download', 'content']) for (const change of ['logout', 'lock', 'project-revoke']) {
    test(`U030 Sprint 4: ${operation} rechecks ${change} after storage wait`, { timeout: 20000 }, async (t) => {
      const f = await fixture();
      const uid = seed().users.nhu.id;
      const system = await new Client().login('admin@taskflow.local');
      const original = config.storage;
      const objects = new Map();
      let arrive, release;
      const arrived = new Promise(resolve => { arrive = resolve; });
      const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const key = req.url.split('/').at(-1);
        if (req.method === 'DELETE') { objects.delete(key); return res.end('{}'); }
        if (req.method === 'POST') objects.set(key, Buffer.concat(chunks));
        release = () => res.end(req.method === 'GET' ? objects.get(key) : '{}');
        arrive();
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      config.storage = { url: `http://127.0.0.1:${server.address().port}`, serviceKey: 'sb_secret_ephemeral_fixture', bucket: 'test' };
      t.after(async () => {
        release?.(); config.storage = original;
        await db.prisma.user.update({ where: { id: uid }, data: { isLocked: false } });
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      });
      const secret = 'S4_PRIVATE_FILE_CONTENT';
      let route = `/projects/${f.pid}/documents/upload`, body, method = 'POST';
      if (operation === 'upload') {
        body = new FormData(); body.append('files', new Blob([secret], { type: 'text/plain' }), 'sprint4.txt');
      } else {
        objects.set('fixture.txt', Buffer.from(secret));
        const doc = await db.prisma.document.create({ data: { workspace: f.ws, project: f.pid, kind: 'file', name: 'fixture.txt', mime: 'text/plain', content: secret, storageKey: 'fixture.txt', uploadedBy: uid, version: 1 } });
        route = `/documents/${doc.id}/${operation}`; method = 'GET';
      }
      const before = await db.prisma.document.count({ where: { project: f.pid } });
      const pending = fetch(`${base()}${route}`, { method, headers: { 'x-taskflow': '1', cookie: Object.entries(f.member.cookies).map(([k,v]) => `${k}=${v}`).join('; ') }, body });
      await arrived;
      try {
        if (change === 'project-revoke') {
          assert.equal((await f.owner.patch(`/projects/${f.pid}`, { members: [seed().users.maianh.id] })).status, 200);
        } else {
          assert.equal((await system.post(`/admin/users/${uid}/${change}`, change === 'lock' ? { reason: 'Khác' } : {})).status, 200);
        }
      } finally { release(); }
      const response = await pending;
      assert.equal(response.status, change === 'project-revoke' ? 404 : 401);
      assert.ok(!(await response.text()).includes(secret));
      assert.equal(await db.prisma.document.count({ where: { project: f.pid } }), before);
      if (operation === 'upload') assert.equal(objects.size, 0, 'rollback removes the uncommitted object');
    });
  }
}
