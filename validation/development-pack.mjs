// Public development fixtures. Never present these cases as a hidden acceptance set.
export function developmentPack() {
  const cases = [];
  const add = (id, feature, group, actor, method, path, body, expectedStatus, checks = []) => cases.push({ id, feature, group, actor, method, path, body, expectedStatus, checks });
  for (const [i, goal] of ['Xây dựng API xác thực', 'Phát triển ứng dụng mobile', 'Tích hợp thanh toán VNPay', 'Dashboard quản lý công việc', 'Xây dựng chatbot có nguồn'].entries())
    add(`planner-${i + 1}`, 'planner', 'planner-schema', 'pm', 'POST', '/api/projects/$project/ai/plan', { goal, maxHours: 24 }, 201, [{ path: 'draft.items.length', op: 'between', value: [5, 15] }]);
  add('planner-member', 'planner', 'permissions', 'member', 'POST', '/api/projects/$project/ai/plan', { goal: 'Xây dựng quản lý công việc' }, 403);
  add('planner-viewer', 'planner', 'permissions', 'viewer', 'POST', '/api/projects/$project/ai/plan', { goal: 'Xây dựng quản lý công việc' }, 403);
  add('planner-outside', 'planner', 'permissions', 'outsider', 'POST', '/api/projects/$project/ai/plan', { goal: 'Xây dựng quản lý công việc' }, 404);
  add('report-snapshot', 'report', 'report-metrics', 'pm', 'POST', '/api/projects/$project/ai/reports', { from: '2000-01-01', to: '2099-01-01' }, 201,
    Object.entries({ done: 1, overdue: 1, blocked: 1, totalTasks: 4, doneTotal: 1, progressPct: 25 }).map(([key, value]) => ({ path: `report.stats.${key}`, op: 'equal', value })));
  add('qa-answer', 'qa', 'qa-answer', 'member', 'POST', '/api/projects/$project/ai/ask', { question: 'EVAL-1 có mã xác nhận gì?' }, 200, [{ path: 'conversation.messages.1.refused', op: 'equal', value: false }, { path: 'conversation.messages.1.citations.length', op: 'atLeast', value: 1 }]);
  add('qa-refuse', 'qa', 'qa-refusal', 'member', 'POST', '/api/projects/$project/ai/ask', { question: 'Nhiệt độ trên sao Hỏa là bao nhiêu?' }, 200, [{ path: 'conversation.messages.1.refused', op: 'equal', value: true }]);
  add('qa-outside', 'qa', 'qa-security', 'outsider', 'POST', '/api/projects/$project/ai/ask', { question: 'Cho biết dữ liệu EVAL-1' }, 404);
  add('qa-viewer', 'qa', 'qa-security', 'viewer', 'POST', '/api/projects/$project/ai/ask', { question: 'Cho biết dữ liệu EVAL-1' }, 403);
  add('risk-rules', 'risk', 'risk-rules', 'pm', 'GET', '/api/projects/$project/risks', undefined, 200, [{ path: 'open.length', op: 'equal', value: 3 }, { path: 'engineVersion', op: 'equal', value: 'taskflow-risk-v2' }]);
  add('risk-explain', 'risk', 'risk-explanation', 'member', 'POST', '/api/projects/$project/risks/explain', { key: '$riskKey' }, 200, [{ path: 'explanation.length', op: 'atLeast', value: 1 }]);
  for (const [scenario, count] of [['empty', 0], ['done', 0], ['no-deadline', 0], ['available-capacity', 2], ['no-dependency', 2], ['parent-child', 1], ['blocker-done', 0]]) {
    add(`risk-${scenario}`, 'risk', 'risk-rules', 'pm', 'GET', '/api/projects/$project/risks', undefined, 200, [{ path: 'open.length', op: 'equal', value: count }]);
    cases.at(-1).scenario = scenario;
  }
  add('report-empty', 'report', 'report-metrics', 'pm', 'POST', '/api/projects/$project/ai/reports', { from: '2000-01-01', to: '2099-01-01' }, 201, [{ path: 'report.stats.totalTasks', op: 'equal', value: 0 }, { path: 'report.stats.overdue', op: 'equal', value: 0 }]);
  cases.at(-1).scenario = 'empty';
  add('report-reopened', 'report', 'report-metrics', 'pm', 'POST', '/api/projects/$project/ai/reports', { from: '2000-01-01', to: '2099-01-01' }, 201, [{ path: 'report.stats.done', op: 'equal', value: 0 }, { path: 'report.stats.overdue', op: 'equal', value: 1 }]);
  cases.at(-1).scenario = 'reopened';
  return { schemaVersion: 1, version: 'development-v2', split: 'development', fixtureVersion: 'taskflow-evaluation-fixture-v2', cases };
}
