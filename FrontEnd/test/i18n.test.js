import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { t, setLanguage, getLanguage, translateError } from '../src/lib/i18n.js';
import { STATUS, PRIORITY, fmtDate } from '../src/lib/format.js';
import { api, ApiError } from '../src/lib/api.js';
import { AppCtx } from '../src/lib/app.jsx';
import CreateTaskModal from '../src/components/CreateTaskModal.jsx';

afterEach(() => setLanguage('vi'));

test('switches catalogs and dates at runtime, preserving interpolation values', () => {
  assert.equal(STATUS.todo.label, 'Cần làm');
  setLanguage('en');
  assert.equal(STATUS.todo.label, 'To do');
  assert.equal(PRIORITY.high.label, 'High');
  assert.equal(fmtDate('2026-10-28T12:00:00Z', { year: true, timeZone: 'Asia/Ho_Chi_Minh' }), '28 Oct 2026');
  assert.equal(t('{0} · cột {1}', ['Dự án của Như', STATUS.todo.label]), 'Dự án của Như · To do column');
  assert.equal(t('Tên riêng không có trong từ điển'), 'Tên riêng không có trong từ điển');
  setLanguage('vi');
  assert.equal(STATUS.todo.label, 'Cần làm');
});

test('stores preference and updates document language', (context) => {
  const values = new Map();
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem: (key, value) => values.set(key, value) } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: {} } });
  context.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else delete globalThis.localStorage;
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;
  });
  setLanguage('en');
  assert.equal(getLanguage(), 'en');
  assert.equal(values.get('tf_language'), 'en');
  assert.equal(document.documentElement.lang, 'en');
});

test('translates server validation and risk templates without translating task titles', () => {
  setLanguage('en');
  const error = new ApiError(400, 'Không tìm thấy công việc', { fields: { title: 'Cần làm' } });
  assert.equal(error.message, 'Task not found');
  assert.equal(error.fields.title, 'To do');
  assert.equal(translateError('TF-98 Cấu hình hệ thống quá hạn 2 ngày'), 'TF-98 Cấu hình hệ thống is 2 days overdue');
  assert.equal(translateError('Unrecognized response'), 'Unrecognized response');
});

test('changing language updates the actual task form without losing its draft', async (context) => {
  globalThis.window = new EventTarget();
  context.mock.method(api, 'get', async () => ({ project: { _id: 'p', name: 'Dự án của Như', status: 'active', projectRole: 'pm', members: [] }, access: { canManage: true } }));
  let tree;
  await act(async () => { tree = create(React.createElement(MemoryRouter, null, React.createElement(AppCtx.Provider, {
    value: { project: { _id: 'p', name: 'Dự án của Như', status: 'active' }, me: { _id: 'me' }, canManageProject: true, canWriteProject: true },
  }, React.createElement(CreateTaskModal, { open: true, onClose() {} })))); });
  try {
    const title = () => tree.root.findAllByType('input').find(node => node.props.maxLength === 200);
    await act(() => title().props.onChange({ target: { value: 'Bản nháp của Như' } }));
    await act(() => setLanguage('en'));
    assert.equal(title().props.value, 'Bản nháp của Như');
    assert.equal(title().props.placeholder, 'Example: Design the Notifications screen');
    assert.ok(JSON.stringify(tree.toJSON()).includes('Create task'));
    await act(() => setLanguage('vi'));
    assert.equal(title().props.value, 'Bản nháp của Như');
  } finally { await act(() => tree.unmount()); }
});
