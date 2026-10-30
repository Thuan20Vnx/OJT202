import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { api } from '../src/lib/api.js';
import { AppCtx } from '../src/lib/app.jsx';
import { closeSocket } from '../src/lib/socket.js';
import Overview from '../src/pages/Overview.jsx';

afterEach(() => closeSocket());

const text = (node) => typeof node === 'string' ? node : (node.children || []).map(text).join('');

test('overview shows overdue tasks and overload, and opens an overdue task', async (t) => {
  globalThis.window = new EventTarget();
  t.mock.method(api, 'get', async () => ({
    kpis: { total: 1, done: 0, progressPct: 0, overdue: 1, blocked: 0, velocity: { last7: 0, prev7: 0 } },
    sprint: null,
    burndown: null,
    byStatus: { todo: 1, in_progress: 0, review: 0, done: 0 },
    overdue: [{ _id: 'task-overdue', key: 'TF-OVER', title: 'Việc cần xử lý', status: 'todo', dueDate: '2000-01-01T00:00:00.000Z' }],
    workload: [{ user: { _id: 'member', name: 'An' }, role: 'member', projectRole: 'member', jobTitle: 'Dev', hours: 10, available: 8, pct: 125, overloaded: true, missingEstimates: 0, missingDeadlines: 0 }],
    risks: [],
    riskCount: 0,
    recent: [],
  }));
  function LocationProbe() {
    const location = useLocation();
    return React.createElement('span', { id: 'location' }, `${location.pathname}${location.search}`);
  }
  const element = React.createElement(MemoryRouter, { initialEntries: ['/overview'] },
    React.createElement(AppCtx.Provider, {
      value: { project: { _id: 'project', name: 'Project', status: 'archived' }, wsId: 'workspace', role: 'member' },
    }, React.createElement(React.Fragment, null, React.createElement(Overview), React.createElement(LocationProbe))));
  let tree;
  await act(async () => { tree = create(element); });
  t.after(() => act(() => tree.unmount()));

  assert.match(text(tree.root), /Công việc quá hạn/);
  assert.match(text(tree.root), /TF-OVER/);
  assert.match(text(tree.root), /Quá tải/);

  const overdueTask = tree.root.findAllByType('button').find((button) => text(button).includes('TF-OVER'));
  assert.ok(overdueTask);
  await act(async () => overdueTask.props.onClick());
  assert.equal(tree.root.findByProps({ id: 'location' }).children.join(''), '/overview?task=task-overdue');
});
