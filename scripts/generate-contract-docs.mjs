import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

// Chạy từ repository root; chỉ đọc source và ghi tài liệu, không kết nối DB.
const out = path.resolve('docs/design');
await fs.mkdir(out, { recursive: true });
const files = { auth: '/auth', me: '/me', workspaces: '/workspaces', capacity: '/workspaces', notifications: '/notifications', admin: '/admin', dev: '/dev', projects: '', tasks: '', documents: '', dashboard: '', ai: '', delivery: '', planning: '', agent: '', mcp: '/mcp' };
const paths = {};
const manifest = {};
for (const dir of ['FrontEnd/src', 'BackEnd/src', 'AIService/src', 'mcp/src', 'shared', 'BackEnd/prisma']) {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name).replaceAll('\\', '/');
    const content = await fs.readFile(file);
    manifest[file] = crypto.createHash('sha256').update(content).digest('hex');
  }
}
for (const [file, prefix] of Object.entries(files)) {
  const source = `BackEnd/src/routes/${file}.js`;
  const text = await fs.readFile(source, 'utf8');
  manifest[source] = crypto.createHash('sha256').update(text).digest('hex');
  const routes = [...text.matchAll(/router\.(get|post|patch|put|delete)\('([^']+)'/g)];
  for (let i = 0; i < routes.length; i++) {
    const [match, method, route] = routes[i];
    const url = (prefix + (route === '/' ? '' : route)).replace(/:([A-Za-z0-9_]+)/g, '{$1}') || '/';
    const body = text.slice(routes[i].index, routes[i + 1]?.index ?? text.length);
    const status = /res\.status\((\d+)\)/.exec(body)?.[1] || '200';
    const responses = { [status]: { description: 'Thành công. Payload cụ thể theo handler được dẫn trong x-source; endpoint CSV/download trả tệp.' } };
    for (const code of ['400', '401', '403', '404', '409', '429', '503']) responses[code] = { description: { 400: 'Dữ liệu không hợp lệ', 401: 'Chưa đăng nhập / phiên hết hạn', 403: 'Không đủ quyền / tính năng tắt', 404: 'Không tồn tại hoặc ngoài phạm vi quyền', 409: 'Xung đột phiên bản / nguồn thay đổi', 429: 'Rate limit / quota', 503: 'Dịch vụ tạm lỗi' }[code], content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
    const parameters = [...url.matchAll(/\{(\w+)\}/g)].map((m) => ({ in: 'path', name: m[1], required: true, schema: { type: 'string' } }));
    if (['post', 'patch', 'put', 'delete'].includes(method)) parameters.push({ in: 'header', name: 'x-taskflow', required: true, schema: { type: 'string', enum: ['1'] } });
    paths[url] ||= {};
    paths[url][method] = { operationId: `${file}_${method}_${route.replace(/\W+/g, '_')}`, tags: [file], summary: `${method.toUpperCase()} ${url}`, description: `Contract tuyến từ source. Xem schema validation tại handler; không suy diễn trường chưa mô tả.${file === 'dev' ? ' Chỉ đăng ký ngoài production.' : ''}`, 'x-source': `${source}:${text.slice(0, routes[i].index).split('\n').length}`, parameters, responses, ...(file === 'auth' ? { security: [] } : file === 'mcp' ? { security: [{ agentToken: [] }] } : {}) };
  }
}
const object = (properties, required = []) => ({ type: 'object', properties, required });
const str = { type: 'string' };
const version = { type: 'integer', minimum: 1 };
const checklistItem = { ...object({ _id: { type: 'string', format: 'uuid' }, text: { type: 'string', minLength: 1, maxLength: 300 }, done: { type: 'boolean' } }, ['text']), additionalProperties: false };
const sourceVersion = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const draftItem = { ...object({
  key: { type: 'string', minLength: 1, maxLength: 100 }, title: { type: 'string', minLength: 1, maxLength: 200 },
  description: { type: 'string', maxLength: 2000 }, acceptanceCriteria: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 300 } },
  estimateHours: { type: ['number', 'null'], minimum: 0, maximum: 1000 }, priority: { enum: ['low', 'medium', 'high'] },
  assignee: { type: ['string', 'null'], format: 'uuid' }, dueDate: { type: ['string', 'null'] }, selected: { type: 'boolean' },
}, ['key']), additionalProperties: false };
const taskFields = { acceptance_criteria: { type: 'string', maxLength: 10000, description: 'Tiêu chí nghiệm thu dạng văn bản nhiều dòng; chuỗi rỗng xóa nội dung. Không gửi đồng thời acceptanceCriteria.' }, acceptanceCriteria: { type: 'array', maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 300 }, deprecated: true, description: 'Alias cho client cũ, được ghép bằng xuống dòng khi lưu.' }, title: { type: 'string', maxLength: 200 }, description: str, assignee: { type: ['string', 'null'] }, priority: { enum: ['low', 'medium', 'high'] }, dueDate: { type: ['string', 'null'] }, estimateHours: { type: ['number', 'null'], minimum: 0 }, remainingHours: { type: ['number', 'null'], minimum: 0 } };
for (const field of ['plannedStartDate', 'actualStartDate', 'actualEndDate']) taskFields[field] = { type: ['string', 'null'], description: 'Ngày YYYY-MM-DD hoặc timestamp có múi giờ; actual không được ở ngày tương lai. Kết thúc không trước bắt đầu khi cả hai có giá trị.' };
taskFields.dueDate.description = 'Ngày kết thúc kế hoạch (hạn chót); giữ tên dueDate để tương thích lịch/nhắc hạn.';
const bodies = {
  '/auth/forgot-password:post': object({ email: { type: 'string', format: 'email' } }, ['email']),
  '/auth/reset-password:post': object({ token: str, password: str }, ['token', 'password']),
  '/me:patch': { ...object({ name: { type: 'string', minLength: 1, maxLength: 80 }, title: { type: 'string', maxLength: 60 }, timezone: { type: 'string', description: 'Valid IANA timezone' }, language: { enum: ['vi', 'en'] } }), additionalProperties: false },
  '/tasks/{id}/checklist:post': { ...object({ version, text: checklistItem.properties.text, done: { type: 'boolean', default: false } }, ['version', 'text']), additionalProperties: false },
  '/checklist/{id}:patch': { ...object({ version, text: checklistItem.properties.text, done: { type: 'boolean' } }, ['version']), additionalProperties: false, description: 'At least text or done is required.' },
  '/auth/google:post': object({ credential: { type: 'string', minLength: 20, maxLength: 4096 }, remember: { type: 'boolean' }, acceptTerms: { type: 'boolean', description: 'Bắt buộc true khi Google tạo tài khoản mới; tài khoản đã có không cần.' } }, ['credential']),
  '/ai/reports/{id}:patch': { ...object({ title: { type: 'string', minLength: 1, maxLength: 200 }, sections: { type: 'array', items: object({ key: str, title: { type: 'string', maxLength: 200 }, body: { type: 'string', maxLength: 20000 } }, ['key']) }, removeKeys: { type: 'array', items: str }, share: { type: 'boolean' } }), description: 'Chỉ người tạo là PM. Sửa được khi còn nháp; share=true là publish. Báo cáo đã chia sẻ là snapshot bất biến: sửa title/sections/removeKeys trả 409 REPORT_SHARED, share lặp là no-op.' },
  '/auth/login:post': object({ email: { type: 'string', format: 'email' }, password: str, remember: { type: 'boolean' } }, ['email', 'password']),
  '/projects/{projectId}/tasks:post': object(taskFields, ['title']),
  '/tasks/{id}:patch': object({ ...taskFields, version: { type: 'integer', minimum: 1 }, status: { enum: ['todo', 'in_progress', 'review', 'done'] } }, ['version']),
  '/tasks/{id}/comments:post': object({ body: str }, ['body']),
  '/workspaces/{wsId}/members/{userId}:patch': object({ role: { enum: ['owner', 'admin', 'member', 'viewer'] }, title: str, weeklyHours: { type: 'number', minimum: 0, maximum: 80 } }),
  '/workspaces/{wsId}/members/{userId}/capacity/{week}:patch': object({ hours: { type: 'number', minimum: 0, maximum: 80 }, version: { type: 'integer', minimum: 0 } }, ['hours', 'version']),
  '/projects/{projectId}/documents:post': object({ name: { type: 'string', minLength: 1, maxLength: 200 }, content: { type: 'string', maxLength: 200000 }, task: str }, ['name']),
  '/documents/{id}:patch': object({ name: { type: 'string', minLength: 1, maxLength: 200 }, content: { type: 'string', maxLength: 200000 }, restoreVersion: { type: 'integer', minimum: 1 }, version: { type: 'integer', minimum: 1 } }, ['version']),
  '/projects/{projectId}/ai/plan:post': object({ goal: { type: 'string', minLength: 5, maxLength: 2000 }, deadline: { type: ['string', 'null'] }, people: { type: ['integer', 'null'], minimum: 1, maximum: 50 }, maxHours: { type: ['number', 'null'], minimum: 1, maximum: 5000 } }, ['goal']),
  '/projects/{projectId}/ai/ask:post': object({ question: { type: 'string', minLength: 3, maxLength: 1000 }, conversation: str }, ['question']),
  '/ai/drafts/{id}:patch': { ...object({ version, items: { type: 'array', maxItems: 20, items: draftItem }, removeKeys: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 100 } } }, ['version']), additionalProperties: false },
  '/ai/drafts/{id}/approve:post': { ...object({ version }, ['version']), additionalProperties: false },
  '/ai/drafts/{id}/discard:post': { ...object({ version }, ['version']), additionalProperties: false },
  '/projects/{projectId}/risks/resolve:post': { ...object({ key: { type: 'string', minLength: 1, maxLength: 100000 }, sourceVersion, reason: { type: 'string', minLength: 3, maxLength: 1000 }, title: { type: 'string', maxLength: 300, description: 'Tương thích client cũ; server dùng tiêu đề cảnh báo thật.' } }, ['key', 'sourceVersion', 'reason']), additionalProperties: false },
};
taskFields.workType = { enum: ['unclassified', 'development', 'testing', 'database', 'design', 'documentation', 'devops', 'research'] };
bodies['/tasks/{id}:patch'].properties.workType = taskFields.workType;
bodies['/projects/{projectId}/tasks:post'].properties.workType = taskFields.workType;
const uuid = { type: 'string', format: 'uuid' };
const hours = { type: 'number', minimum: 0, maximum: 1000 };
const strictObject = (props, required) => ({ ...object(props, required), additionalProperties: false });
const meetingFields = { title: { type: 'string', minLength: 1, maxLength: 200 }, agenda: { type: 'string', maxLength: 4000 }, location: { type: 'string', maxLength: 500 }, startAt: { type: 'string', format: 'date-time' }, endAt: { type: 'string', format: 'date-time' }, participants: { type: 'array', minItems: 1, maxItems: 20, items: uuid } };
Object.assign(bodies, {
  '/tasks/{id}/contributors:put': strictObject({ version, items: { type: 'array', maxItems: 20, items: strictObject({ user: uuid, responsibility: { type: 'string', minLength: 1, maxLength: 300 }, plannedHours: { ...hours, exclusiveMinimum: 0 }, remainingHours: hours }, ['user', 'responsibility', 'plannedHours', 'remainingHours']) } }, ['version', 'items']),
  '/tasks/{id}/daily-updates/{date}:put': strictObject({ version: { type: 'integer', minimum: 0, description: '0 cho bản ghi mới; sửa gửi version của bản ghi' }, taskVersion: version, hours: { type: 'number', minimum: 0, maximum: 24 }, completed: { type: 'string', minLength: 1, maxLength: 2000 }, nextStep: { type: 'string', maxLength: 2000 }, blockers: { type: 'string', maxLength: 2000 }, progressPct: { type: 'integer', minimum: 0, maximum: 100 }, remainingHours: hours }, ['version', 'taskVersion', 'hours', 'completed', 'nextStep', 'blockers', 'progressPct', 'remainingHours']),
  '/tasks/{id}/issues:post': strictObject({ title: { type: 'string', minLength: 1, maxLength: 200 }, severity: { enum: ['low', 'medium', 'high', 'critical'] }, cause: { type: 'string', minLength: 1, maxLength: 2000 }, action: { type: 'string', minLength: 1, maxLength: 2000 }, owner: { type: ['string', 'null'], format: 'uuid' } }, ['title', 'severity', 'cause', 'action', 'owner']),
  '/tasks/{id}/issues/{issueId}:patch': strictObject({ version, status: { enum: ['open', 'resolved'] }, resolution: { type: 'string', maxLength: 2000, description: 'Bắt buộc có nội dung khi resolved' } }, ['version', 'status', 'resolution']),
  '/projects/{projectId}/meetings:post': strictObject(meetingFields, Object.keys(meetingFields)),
  '/projects/{projectId}/meetings/{meetingId}:put': strictObject({ ...meetingFields, version }, [...Object.keys(meetingFields), 'version']),
  '/projects/{projectId}/meetings/{meetingId}/cancel:post': strictObject({ version }, ['version']),
});
taskFields.checklist = { type: 'array', maxItems: 50, items: checklistItem, description: 'Stored in checklist_items; send existing _id to preserve identity. No IDs remains supported for old clients.' };
// The PATCH schema copies taskFields above, so include checklist explicitly there too.
bodies['/tasks/{id}:patch'].properties.checklist = taskFields.checklist;
for (const [key, schema] of Object.entries(bodies)) {
  const [route, method] = key.split(':');
  if (!paths[route]?.[method]) throw new Error(`Contract thiếu route ${key}`);
  paths[route][method].requestBody = { required: true, content: { 'application/json': { schema } } };
}
paths['/projects/{projectId}/ai/sources'].get.responses['200'] = { description: 'Thống kê nguồn được đọc trực tiếp, không trả nội dung.', content: { 'application/json': { schema: object({ tasks: { type: 'integer' }, documents: { type: 'integer' }, retrieval: { const: 'live' }, latestTaskAt: { type: ['string', 'null'], format: 'date-time' }, latestDocumentAt: { type: ['string', 'null'], format: 'date-time' }, suggestions: { type: 'array', maxItems: 3, items: str, description: 'Câu hỏi gợi ý dựng từ việc bị chặn, việc đang mở và tài liệu mới nhất của chính dự án.' } }, ['tasks', 'documents', 'retrieval', 'suggestions']) } } };
paths['/health'] = { get: { operationId: 'health', security: [], responses: { 200: { description: 'Liveness HTTP, không phải readiness DB/AI. Cache-Control: no-store. build.revision/sourceHash lấy từ RELEASE_SHA/RELEASE_SOURCE_HASH hợp lệ, null nếu chưa cấu hình; smoke production kiểm trùng với build được đo.' } } } };
const schemaSource = await fs.readFile('BackEnd/prisma/schema.prisma', 'utf8');
paths['/tasks/{id}'].delete.parameters.push({ in: 'query', name: 'impact', required: false, schema: { type: 'string', pattern: '^[a-f0-9]{64}$' }, description: 'Token từ deletion-preview; 409 DELETE_CHANGED nếu phạm vi đã đổi trước khi xác nhận.' });
paths['/tasks/{id}'].delete.parameters.push({ in: 'query', name: 'confirm', required: false, schema: { type: 'string', enum: ['true'] }, description: 'Bắt buộc xác nhận khi có task con; UI luôn dùng preview và impact.' });
paths['/tasks/{id}/deletion-preview'].get.responses['200'] = { description: 'Chỉ PM. Preview task cha/con, số liên kết phụ thuộc bị gỡ, số tệp được giữ và impactToken; không thay đổi DB.' };
paths['/workspaces/{wsId}/members/{userId}/capacity/{week}'].get.description = 'Tuần là ngày thứ Hai YYYY-MM-DD, lưu DATE. Chưa có override thì trả weeklyHours mặc định và version=0. Workspace membership bắt buộc.';
paths['/workspaces/{wsId}/members/{userId}/capacity/{week}'].patch.description = 'Owner quản mọi membership; Admin chỉ Member/Viewer. Khóa workspace, CAS version, audit cùng transaction. Chỉ thay tuần được chọn; 409 trả capacity hiện tại.';
for (const p of paths['/workspaces/{wsId}/members/{userId}/capacity/{week}'].get.parameters) if (p.name === 'week') p.schema = { type: 'string', format: 'date' };
paths['/workspaces/{wsId}/activity.csv'].get.responses['200'] = { description: 'CSV theo đúng quyền và bộ lọc ngày, chống formula injection. Vượt 10.000 bản ghi trả 400 để thu hẹp bộ lọc; không xuất thiếu âm thầm.', content: { 'text/csv': { schema: { type: 'string' } } } };
const query = (name, schema, description) => ({ in: 'query', name, required: false, schema, ...(description && { description }) });
const taskFilters = [
  query('assignee', str, 'me (default for My Tasks), all, unassigned, or UUID'),
  query('status', str, 'Comma-separated todo,in_progress,review,done'),
  query('priority', str, 'Comma-separated low,medium,high'),
  query('due', { enum: ['today', 'week', 'overdue', 'none'] }, 'Profile timezone; week starts today and ends at next Monday.'),
  query('search', { type: 'string', maxLength: 2000 }, 'Case-insensitive title, key, description'),
];
const myTasks = paths['/workspaces/{wsId}/my-tasks'].get;
myTasks.parameters.push(...taskFilters, query('project', str, 'Comma-separated project UUIDs'), query('includeDone', { enum: ['true', 'false'] }), query('page', { type: 'integer', minimum: 1 }), query('limit', { type: 'integer', minimum: 1, maximum: 100 }));
for (const url of ['/tasks', '/me/tasks']) paths[url] = { get: { ...structuredClone(myTasks), operationId: `my_tasks_${url.replaceAll('/', '_')}`, summary: `GET ${url}`, 'x-source': 'BackEnd/src/services/my-tasks.js', parameters: [...myTasks.parameters.filter((p) => p.in !== 'path'), { ...query('workspace', { type: 'string', format: 'uuid' }), required: true }], description: 'Canonical My Tasks alias; workspace required. Same project ACL, filters, pagination and summary as workspace route. Private/deleted tasks excluded.' } };
paths['/projects/{projectId}/tasks'].get.parameters.push(...taskFilters);
paths['/checklist/{id}'].delete.parameters.push({ ...query('version', version), required: true });
for (const route of ['/checklist/{id}', '/tasks/{id}/checklist']) for (const [method, operation] of Object.entries(paths[route])) operation.description = method === 'get' ? 'Readable project membership required. Returns items and task version.' : 'Project PM only, active project. Task version CAS; stale 409. Changes, task version and audit committed together. Response task includes checklist.';
paths['/comments/{id}'].delete.description = 'Author may delete own comment; project PM may hide others. Active writable project required. Soft-delete and audit in the same transaction; hidden comments excluded from reads/counts.';
paths['/projects/{projectId}/risks/resolve'].delete.parameters.push({ ...query('key', str), required: true }, { ...query('sourceVersion', sourceVersion), required: true });
paths['/projects/{projectId}/risks/explain'].post.description = 'Project PM/Member active. Viewer và dự án archived bị từ chối trước khi gọi AI hoặc ghi usage. Kiểm lại quyền ghi, phiên và sourceVersion sau AI; hạ quyền/archive trong lúc chờ không nhận output. Rule explanation và nguồn vẫn đọc được qua GET theo ACL.';
paths['/projects/{projectId}/risks/explain'].post.requestBody = { required: true, content: { 'application/json': { schema: object({ key: { type: 'string', minLength: 1 } }, ['key']) } } };
paths['/projects/{projectId}/risks/resolve'].post.description = 'Project PM/Member active. Lý do trim 3–1000 ký tự và sourceVersion bắt buộc. Khóa workspace, kiểm lại ACL/nguồn; stale 409 RISK_SOURCES_CHANGED; request lặp cùng nguồn không nhân audit. Snapshot/lý do lưu cùng transaction. Nguồn hoặc ngưỡng thay đổi thì cảnh báo xuất hiện lại.';
paths['/projects/{projectId}/risks'].get.responses['200'] = { description: 'open: key/type/severity/rule/title/explanation/tasks/owner/sourceVersion/snapshot/generatedAt. resolved: tối đa 10 lần xử lý gần đây kèm reason/sourceVersion/snapshot/current. rulesVersion tăng khi ngưỡng thay đổi; engineVersion định danh bộ quy tắc. Mọi nguồn trong phạm vi dự án được đọc.' };
paths['/ai/drafts/{id}'].patch.description = 'Chỉ chủ nháp đang là PM active. version bắt buộc; khóa workspace và trả 409 AI_DRAFT_CHANGED nếu tab cũ. Không chấp nhận key thiếu/trùng hoặc sửa excerpt; người nhận phải có ProjectRole/WorkspaceRole làm việc. Thành công tăng version và trả draft mới.';
paths['/ai/drafts/{id}/approve'].post.description = 'Chỉ chủ nháp đang là PM active. version bắt buộc; nháp còn mở phải khớp. Kiểm tổng giờ, hạn và số người đã chọn; transaction tạo task/AC/remainingHours, audit, tăng version. UNIQUE(project,aiDraftItem) + lock bảo đảm duyệt lặp không tạo trùng; nháp approved trả lại kết quả đã duyệt, kể cả retry version cũ. Response có draft/created.';
paths['/ai/drafts/{id}/discard'].post.description = 'Chỉ chủ nháp đang là PM active. version bắt buộc cho nháp còn mở; stale 409; không được hủy bản đã duyệt; hủy lặp là idempotent.';
paths['/projects/{projectId}/ai/plan'].post.description = 'Chỉ PM active. AI trả 5–15 mục đủ title/description/AC/estimate; server kiểm schema và giới hạn trước lưu nháp. Không có deadline thì không tự đặt. Người nhận mặc định trống để PM chọn. Chưa tạo task/notification trước approve.';
paths['/projects/{projectId}/ai/reports'].post.description = 'Chỉ PM active. Canonical period_start/period_end là khoảng [start,end), date-only hiểu là 00:00 theo project.timezone, timestamp có offset giữ nguyên instant. Alias from/to: ngày cuối date-only bao gồm hết ngày bằng cách chuyển sang 00:00 ngày tiếp theo; to timestamp là exclusive. Không trộn hai bộ trường. Response mới có from/to, period_start/period_end, timezone snapshot và periodConvention=exclusive-end. Báo cáo cũ giữ legacy-inclusive, không viết lại số liệu. Số liệu/tóm tắt định lượng từ DB tại generatedAt; AI chỉ cung cấp đề xuất có nhãn. Kiểm lại nguồn, quyền, phiên sau AI; stats/generatedAt/period/timezone bất biến khi sửa nội dung.';
paths['/projects/{projectId}/ai/reports'].post.requestBody = { required: true, content: { 'application/json': { schema: { oneOf: [
  { ...object({ period_start: str, period_end: str, template: { enum: ['week', 'sprint', 'lecturer'], default: 'week' } }, ['period_start', 'period_end']), additionalProperties: false },
  { ...object({ from: str, to: str, template: { enum: ['week', 'sprint', 'lecturer'], default: 'week' } }, ['from', 'to']), additionalProperties: false },
] } } } };
paths['/projects/{projectId}'].patch.description += ' timezone là IANA zone hợp lệ cho kỳ báo cáo (mặc định Asia/Ho_Chi_Minh); chỉ PM đang hoạt động sửa được. Không đổi kỳ/zone của snapshot cũ.';
paths['/projects/{projectId}/ai/meeting'].post.description = 'Chỉ PM active. title 1–200 ký tự, text 10–30.000 ký tự trim. Nguồn lưu tại draft.input.text cùng SHA-256 sourceHash và spanEncoding=utf-16; mỗi item có excerpt và sourceSpan {start,end} zero-based [start,end). Không suy đoán người khi trùng tên hoặc hạn khi nhiều ngày. Kiểm phiên/ACL sau AI, chỉ lưu nháp. Duyệt dùng chung CAS/transaction của planner; sourceSpan/excerpt không được sửa qua PATCH. Bản nháp cũ thiếu span được kiểm bằng excerpt nguyên văn.';
paths['/projects/{projectId}/ai/meeting'].post.requestBody = { required: true, content: { 'application/json': { schema: object({ title: { type: 'string', minLength: 1, maxLength: 200 }, text: { type: 'string', minLength: 10, maxLength: 30000 } }, ['title', 'text']) } } };
paths['/ai/drafts/{id}/approve'].post.description += ' Meeting kiểm hash nguồn và trích đoạn trước apply; người đã khóa/rời dự án/Viewer không nhận task. Kiểm lại phiên dưới user lock để sắp thứ tự với admin revoke.';
for (const action of ['lock', 'unlock', 'logout']) paths[`/admin/users/{id}/${action}`].post.description = 'System Admin còn phiên hoạt động. Khóa user theo thứ tự nhất quán, kiểm lại actor và phiên; thay đổi user/session + admin audit trong cùng transaction. Lock/logout thu hồi mọi phiên và ngắt socket sau commit. Unlock không khôi phục phiên cũ hoặc đổi membership. System Admin không mặc định có quyền đọc project. Lock cần reason hợp lệ, không tự khóa, không nhận trường cấp quyền.';
paths['/admin/users/{id}/lock'].post.requestBody = { required: true, content: { 'application/json': { schema: { ...object({ reason: { enum: ['Spam lời mời', 'Vi phạm điều khoản', 'Yêu cầu của chủ nhóm', 'Khác'] }, note: { type: 'string', maxLength: 500, default: '' } }, ['reason']), additionalProperties: false } } } };
const activityFilters = [
  query('from', str, 'Ngày hoặc timestamp có offset, theo timezone profile; không sau to.'),
  query('to', str, 'Date-only bao gồm đến cuối ngày profile.'),
  query('actor', { type: 'string', format: 'uuid' }), query('project', { type: 'string', format: 'uuid' }),
  query('entityType', { enum: ['task', 'project', 'member', 'file', 'workspace', 'comment', 'ai'] }),
  query('action', { type: 'string', maxLength: 200 }), query('search', { type: 'string', maxLength: 2000 }),
];
paths['/workspaces/{wsId}/activity'].get.parameters.push(...activityFilters, query('page', { type: 'integer', minimum: 1 }), query('limit', { type: 'integer', minimum: 1, maximum: 100 }));
paths['/workspaces/{wsId}/activity.csv'].get.parameters.push(...activityFilters, query('columns', str, 'Danh sách không trùng, ngăn bằng dấu phẩy: time,actor,action,entity,before,after,project.'));
paths['/projects/{projectId}/documents/upload'].post.requestBody = { required: true, content: { 'multipart/form-data': { schema: object({ files: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', format: 'binary' } }, task: { type: 'string', format: 'uuid' } }, ['files']) } } };
paths['/projects/{projectId}/documents/upload'].post.description = 'Project PM/Member, active. Tối đa 5 tệp PDF/TXT/PNG/JPG, mỗi tệp <=10MB; MIME/đuôi/chữ ký và UTF-8 cho TXT. Kiểm cả lô trước ghi; rollback DB và dọn tệp khi lỗi. Không OCR cho nguồn scan.';
paths['/tasks/{id}/dependencies'].post.requestBody = { required: true, content: { 'application/json': { schema: object({ blockedBy: { type: 'string', format: 'uuid' } }, ['blockedBy']) } } };
paths['/tasks/{id}/dependencies'].post.description = 'Chỉ PM active. Cùng project, không self-link/chu trình; khóa workspace và kiểm lại quyền. Thêm lặp là no-op, không tăng version/audit.';
manifest['BackEnd/prisma/schema.prisma'] = crypto.createHash('sha256').update(schemaSource).digest('hex');
paths['/workspaces/{wsId}/ai'].get.description = 'Thống kê AI theo workspace/ngày. p50LatencyMs/p95LatencyMs/latencySamples gồm các call đã kết thúc, kể cả lỗi và retry; legacy thiếu timestamp không giả làm mẫu mới. tokens là token đã biết, unknownUsageCalls biểu thị usage chưa đầy đủ.';
paths['/workspaces/{wsId}/ai/calls'].get.description = 'Chỉ Owner/Admin. Log có queuedAt/finishedAt/provider/attempts/usageComplete. latencyMs tính cả chờ workspace lock và retry; mỗi attempt giữ token null khi chưa biết, không được suy ra chi phí bằng 0. Dùng API phân trang cho export lớn.';
paths['/workspaces/{wsId}/ai/calls.csv'].get.description = 'Chỉ Owner/Admin; private,no-store; xuất token đã biết, provider, queue/finish, số attempt và usageComplete. Trên 10.000 bản ghi trả 400, không cắt âm thầm. CSV chống formula injection.';
const spec = { openapi: '3.1.0', info: { title: 'TaskFlow API — inventory và contract luồng chính', version: '2026-11-13', description: 'Base /api/v1; /api là alias tương thích. Cookie HttpOnly tf_at; refresh tf_rt. Riêng /mcp dùng Bearer token agent (agentToken). UUID nội bộ id được serialize thành _id. Inventory bao phủ tuyến REST được khai báo trực tiếp; request/response chi tiết mới đặc tả các luồng chính, xem x-source cho phần còn lại. Các response lỗi chung là khả năng, không phải mọi endpoint đều trả mọi mã.' }, servers: [{ url: '/api/v1' }, { url: '/api', description: 'Legacy alias' }], security: [{ cookieAuth: [] }], paths, components: { securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'tf_at' }, agentToken: { type: 'http', scheme: 'bearer', description: 'Token agent tfp_… tạo ở Trợ lý AI › Agent dự án; chỉ dùng cho /mcp, mang quyền project của người tạo, bị thu hồi khi đổi/đặt lại mật khẩu, khóa hoặc buộc đăng xuất. Không thay được cookie và ngược lại.' } }, schemas: { Error: object({ error: str, details: { type: 'object', additionalProperties: true } }, ['error']) } } };
await fs.writeFile(path.join(out, 'openapi.json'), JSON.stringify(spec, null, 2) + '\n');
const models = [...schemaSource.replaceAll('\r\n', '\n').matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)];
let erd = '# ERD và từ điển dữ liệu\n\nVersion 2026-11-13. Sinh từ `BackEnd/prisma/schema.prisma`; SQL migration là nguồn triển khai. Mảng UUID và JSONB không tự tạo FK; quan hệ bên dưới chỉ lấy từ `@relation(fields:...)` thật.\n\n```mermaid\nerDiagram\n';
for (const [, name, body] of models) {
  erd += `  ${name} {\n`;
  for (const line of body.split('\n')) {
    const f = /^\s+(\w+)\s+(String|Int|Float|Boolean|DateTime|Json|BigInt|Decimal)(\[\]|\?)?\s/.exec(line);
    if (f) erd += `    ${f[2]} ${f[1]}${line.includes('@id') ? ' PK' : ''}\n`;
  }
  erd += '  }\n';
}
for (const [, name, body] of models) for (const line of body.split('\n')) {
  const r = /^\s+\w+\s+(\w+)(\?)?\s+@relation\([^\n]*fields:\s*\[([^\]]+)\]/.exec(line);
  if (r) erd += `  ${r[1]} ${r[2] ? '|o' : '||'}--o{ ${name} : "${r[3]}"\n`;
}
erd += '```\n\n## Bảng và ràng buộc\n\n';
for (const [, name, body] of models) erd += `### ${name}\n\n\`\`\`prisma\nmodel ${name} {${body}\n}\n\`\`\`\n\n`;
await fs.writeFile(path.join(out, 'ERD.md'), erd);
await fs.writeFile(path.join(out, 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${Object.keys(paths).length} paths, ${models.length} models; docs/design updated.`);
