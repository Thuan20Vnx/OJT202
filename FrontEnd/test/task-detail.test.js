// Regressions promoted from the 28/10 review probe into the standard test suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../src/lib/api.js';
import { AppCtx } from '../src/lib/app.jsx';
import { getSocket, closeSocket } from '../src/lib/socket.js';
import TaskDetailModal from '../src/components/TaskDetailModal.jsx';

const task = (version) => ({ _id: 'task', workspace: 'workspace', project: 'project', key: 'TF-1', title: 'Original', description: '', status: 'todo', priority: 'medium', version, blockedBy: [], checklist: [], labels: [], createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z' });
const response = (version) => ({ task: task(version), subtasks: [], blocking: [], files: [], activity: [], access: { canEdit: true, canWrite: true, canManage: true, canUpdateProgress: true } });

test('P2: a pending realtime reload must preserve edits started while it was loading', async (t) => {
  globalThis.window = new EventTarget();
  let resolveReload, reads = 0;
  const pending = new Promise((resolve) => { resolveReload = resolve; });
  t.mock.method(api, 'get', async (url) => {
    if (url === '/tasks/task') return ++reads === 1 ? response(1) : pending;
    if (url.endsWith('/comments')) return { comments: [] };
    return { project: { name: 'P', members: [] }, access: { canWrite: true } };
  });
  let tree;
  t.after(async () => { await act(() => tree?.unmount()); closeSocket(); });
  await act(async () => {
    tree = create(React.createElement(MemoryRouter, null, React.createElement(AppCtx.Provider, {
      value: { me: { _id: 'owner' }, wsId: 'workspace', setWsId() {}, setProjectId() {} },
    }, React.createElement(TaskDetailModal, { taskId: 'task', onClose() {} }))));
  });
  await act(async () => getSocket().emitEvent(['task:changed', { task: task(2) }]));
  assert.equal(reads, 2);
  await act(async () => tree.root.findAllByType('textarea')[0].props.onChange({ target: { value: 'My unsaved edit' } }));
  assert.equal(tree.root.findAllByType('textarea')[0].props.value, 'My unsaved edit');
  await act(async () => resolveReload(response(2)));
  assert.equal(tree.root.findAllByType('textarea')[0].props.value, 'My unsaved edit');
  let submitted;
  t.mock.method(api, 'patch', async (_url, body) => {
    submitted = body;
    throw Object.assign(new Error('Conflict'), { status: 409 });
  });
  const save = tree.root.findAllByType('button').find((b) => b.children.includes('Lưu thay đổi'));
  assert.ok(save);
  await act(async () => save.props.onClick());
  assert.equal(submitted.version, 1, 'draft retains its original server version');
  assert.equal(tree.root.findAllByType('textarea')[0].props.value, 'My unsaved edit', '409 must preserve the draft too');
});

test('out-of-order realtime responses cannot replace the newest task', async (t) => {
  globalThis.window = new EventTarget();
  let reads = 0, resolveOld, resolveNew;
  const old = new Promise((r) => { resolveOld = r; });
  const latest = new Promise((r) => { resolveNew = r; });
  t.mock.method(api, 'get', async (url) => {
    if (url === '/tasks/task') return ++reads === 1 ? response(1) : reads === 2 ? old : latest;
    if (url.endsWith('/comments')) return { comments: [] };
    return { project: { name: 'P', members: [] }, access: { canWrite: true } };
  });
  let tree;
  t.after(async () => { await act(() => tree?.unmount()); closeSocket(); });
  await act(async () => {
    tree = create(React.createElement(MemoryRouter, null, React.createElement(AppCtx.Provider, {
      value: { me: { _id: 'owner' }, wsId: 'workspace', setWsId() {}, setProjectId() {} },
    }, React.createElement(TaskDetailModal, { taskId: 'task', onClose() {} }))));
  });
  await act(async () => getSocket().emitEvent(['task:changed', { task: task(2) }]));
  await act(async () => getSocket().emitEvent(['task:changed', { task: task(3) }]));
  const newest = response(3);
  newest.task.title = 'Newest';
  await act(async () => resolveNew(newest));
  await act(async () => resolveOld(response(2)));
  assert.equal(tree.root.findAllByType('textarea')[0].props.value, 'Newest');
});

test('explicit reload discards the old draft but keeps edits started during the reload', async (t) => {
  globalThis.window = new EventTarget();
  let reads = 0, finish;
  const pending = new Promise((r) => { finish = r; });
  t.mock.method(api, 'get', async (url) => {
    if (url === '/tasks/task') return ++reads < 3 ? response(reads) : pending;
    if (url.endsWith('/comments')) return { comments: [] };
    return { project: { name: 'P', members: [] }, access: { canWrite: true } };
  });
  let tree;
  t.after(async () => { await act(() => tree?.unmount()); closeSocket(); });
  await act(async () => {
    tree = create(React.createElement(MemoryRouter, null, React.createElement(AppCtx.Provider, {
      value: { me: { _id: 'owner' }, wsId: 'workspace', setWsId() {}, setProjectId() {} },
    }, React.createElement(TaskDetailModal, { taskId: 'task', onClose() {} }))));
  });
  const edit = (value) => tree.root.findAllByType('textarea')[0].props.onChange({ target: { value } });
  const cancel = () => tree.root.findAllByType('button').find((b) => b.children.includes('Hủy'));
  await act(async () => edit('Discard me'));
  assert.ok(cancel());
  await act(async () => cancel().props.onClick());
  assert.equal(tree.root.findAllByType('textarea')[0].props.value, 'Original');
  await act(async () => edit('Old draft'));
  await act(async () => { cancel().props.onClick(); });
  await act(async () => edit('Typed during reload'));
  await act(async () => finish(response(3)));
  assert.equal(tree.root.findAllByType('textarea')[0].props.value, 'Typed during reload');
});
