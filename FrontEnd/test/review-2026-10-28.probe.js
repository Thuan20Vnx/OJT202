// Review probes, run explicitly; not part of the normal *.test.js suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../src/lib/api.js';
import { AppCtx } from '../src/lib/app.jsx';
import { getSocket, closeSocket } from '../src/lib/socket.js';
import TaskDetailModal from '../src/components/TaskDetailModal.jsx';

const task = (version) => ({ _id: 'task', project: 'project', key: 'TF-1', title: 'Original', description: '', status: 'todo', priority: 'medium', version, blockedBy: [], checklist: [], labels: [], createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z' });
const response = (version) => ({ task: task(version), subtasks: [], blocking: [], files: [], activity: [], access: { canWrite: true, canManage: true } });

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
      value: { me: { _id: 'owner' }, setProjectId() {} },
    }, React.createElement(TaskDetailModal, { taskId: 'task', onClose() {} }))));
  });
  await act(async () => getSocket().emitEvent(['task:changed', { task: task(2) }]));
  assert.equal(reads, 2);
  await act(async () => tree.root.findAllByType('textarea')[0].props.onChange({ target: { value: 'My unsaved edit' } }));
  assert.equal(tree.root.findAllByType('textarea')[0].props.value, 'My unsaved edit');
  await act(async () => resolveReload(response(2)));
  assert.equal(tree.root.findAllByType('textarea')[0].props.value, 'My unsaved edit');
});
