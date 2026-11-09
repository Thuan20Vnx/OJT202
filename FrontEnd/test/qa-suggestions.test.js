import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../src/lib/api.js';
import { AppCtx } from '../src/lib/app.jsx';
import { closeSocket } from '../src/lib/socket.js';
import Qa from '../src/pages/ai/Qa.jsx';

beforeEach(() => { globalThis.window = new EventTarget(); });
afterEach(() => closeSocket());

const text = (node) => typeof node === 'string' ? node : (node.children || []).map(text).join('');
const button = (tree, label) => tree.root.findAllByType('button').find((node) => text(node).includes(label));

test('AI Q&A hiển thị và gửi gợi ý câu hỏi động từ nguồn của dự án', async (t) => {
  const question = 'Vì sao TF-24 đang bị chặn và cần xử lý việc nào trước?';
  t.mock.method(api, 'get', async (url) => {
    if (url === '/projects/project-1') return { access: { canWrite: true } };
    if (url.endsWith('/ai/conversations')) return { conversations: [] };
    if (url.endsWith('/ai/sources')) return { tasks: 2, documents: 1, suggestions: [question, 'Tóm tắt nội dung chính của tài liệu Kiến trúc'] };
    throw new Error(`Unexpected GET ${url}`);
  });
  const post = t.mock.method(api, 'post', async () => ({ conversation: { _id: 'conversation-1', messages: [] } }));
  let tree;
  await act(async () => {
    tree = create(
      React.createElement(MemoryRouter, {}, React.createElement(AppCtx.Provider, {
        value: { me: { id: 'member-1', name: 'Member' } },
      }, React.createElement(Qa, { project: { _id: 'project-1', name: 'Project' }, onUsage() {} }))),
    );
  });
  t.after(() => act(() => tree.unmount()));

  assert.ok(button(tree, question));
  assert.ok(button(tree, 'Kiến trúc'));
  await act(async () => button(tree, question).props.onClick());
  assert.equal(post.mock.calls[0].arguments[1].question, question);
});
