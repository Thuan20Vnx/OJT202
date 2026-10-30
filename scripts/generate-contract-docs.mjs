import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

// Chạy từ repository root; chỉ đọc source và ghi tài liệu, không kết nối DB.
const out = path.resolve('docs/design');
await fs.mkdir(out, { recursive: true });
const files = { auth: '/auth', me: '/me', workspaces: '/workspaces', capacity: '/workspaces', notifications: '/notifications', admin: '/admin', dev: '/dev', projects: '', tasks: '', documents: '', dashboard: '', ai: '' };
const paths = {};
const manifest = {};
for (const dir of ['FrontEnd/src', 'BackEnd/src', 'AIService/src', 'shared', 'BackEnd/prisma']) {
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
    paths[url][method] = { operationId: `${file}_${method}_${route.replace(/\W+/g, '_')}`, tags: [file], summary: `${method.toUpperCase()} ${url}`, description: `Contract tuyến từ source. Xem schema validation tại handler; không suy diễn trường chưa mô tả.${file === 'dev' ? ' Chỉ đăng ký ngoài production.' : ''}`, 'x-source': `${source}:${text.slice(0, routes[i].index).split('\n').length}`, parameters, responses, ...(file === 'auth' ? { security: [] } : {}) };
  }
}
const object = (properties, required = []) => ({ type: 'object', properties, required });
const str = { type: 'string' };
const version = { type: 'integer', minimum: 1 };
const sourceVersion = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const draftItem = { ...object({
  key: { type: 'string', minLength: 1, maxLength: 100 }, title: { type: 'string', minLength: 1, maxLength: 200 },
  description: { type: 'string', maxLength: 2000 }, acceptanceCriteria: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 300 } },
  estimateHours: { type: ['number', 'null'], minimum: 0, maximum: 1000 }, priority: { enum: ['low', 'medium', 'high'] },
  assignee: { type: ['string', 'null'], format: 'uuid' }, dueDate: { type: ['string', 'null'] }, selected: { type: 'boolean' },
}, ['key']), additionalProperties: false };
const taskFields = { title: { type: 'string', maxLength: 200 }, description: str, assignee: { type: ['string', 'null'] }, priority: { enum: ['low', 'medium', 'high'] }, dueDate: { type: ['string', 'null'] }, estimateHours: { type: ['number', 'null'], minimum: 0 }, remainingHours: { type: ['number', 'null'], minimum: 0 } };
const bodies = {
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
for (const [key, schema] of Object.entries(bodies)) {
  const [route, method] = key.split(':');
  if (!paths[route]?.[method]) throw new Error(`Contract thiếu route ${key}`);
  paths[route][method].requestBody = { required: true, content: { 'application/json': { schema } } };
}
paths['/projects/{projectId}/ai/sources'].get.responses['200'] = { description: 'Thống kê nguồn được đọc trực tiếp, không trả nội dung.', content: { 'application/json': { schema: object({ tasks: { type: 'integer' }, documents: { type: 'integer' }, retrieval: { const: 'live' }, latestTaskAt: { type: ['string', 'null'], format: 'date-time' }, latestDocumentAt: { type: ['string', 'null'], format: 'date-time' } }, ['tasks', 'documents', 'retrieval']) } } };
paths['/health'] = { get: { operationId: 'health', security: [], responses: { 200: { description: 'Process HTTP hoạt động; không phải readiness DB/AI.' } } } };
const schemaSource = await fs.readFile('BackEnd/prisma/schema.prisma', 'utf8');
paths['/tasks/{id}'].delete.parameters.push({ in: 'query', name: 'impact', required: false, schema: { type: 'string', pattern: '^[a-f0-9]{64}$' }, description: 'Token từ deletion-preview; 409 DELETE_CHANGED nếu phạm vi đã đổi trước khi xác nhận.' });
paths['/tasks/{id}'].delete.parameters.push({ in: 'query', name: 'confirm', required: false, schema: { type: 'string', enum: ['true'] }, description: 'Bắt buộc xác nhận khi có task con; UI luôn dùng preview và impact.' });
paths['/tasks/{id}/deletion-preview'].get.responses['200'] = { description: 'Chỉ PM. Preview task cha/con, số liên kết phụ thuộc bị gỡ, số tệp được giữ và impactToken; không thay đổi DB.' };
paths['/workspaces/{wsId}/members/{userId}/capacity/{week}'].get.description = 'Tuần là ngày thứ Hai YYYY-MM-DD, lưu DATE. Chưa có override thì trả weeklyHours mặc định và version=0. Workspace membership bắt buộc.';
paths['/workspaces/{wsId}/members/{userId}/capacity/{week}'].patch.description = 'Owner quản mọi membership; Admin chỉ Member/Viewer. Khóa workspace, CAS version, audit cùng transaction. Chỉ thay tuần được chọn; 409 trả capacity hiện tại.';
for (const p of paths['/workspaces/{wsId}/members/{userId}/capacity/{week}'].get.parameters) if (p.name === 'week') p.schema = { type: 'string', format: 'date' };
paths['/workspaces/{wsId}/activity.csv'].get.responses['200'] = { description: 'CSV theo đúng quyền và bộ lọc ngày, chống formula injection. Vượt 10.000 bản ghi trả 400 để thu hẹp bộ lọc; không xuất thiếu âm thầm.', content: { 'text/csv': { schema: { type: 'string' } } } };
const query = (name, schema, description) => ({ in: 'query', name, required: false, schema, ...(description && { description }) });
paths['/projects/{projectId}/risks/resolve'].delete.parameters.push({ ...query('key', str), required: true }, { ...query('sourceVersion', sourceVersion), required: true });
paths['/projects/{projectId}/risks/resolve'].post.description = 'Project PM/Member active. Lý do trim 3–1000 ký tự và sourceVersion bắt buộc. Khóa workspace, kiểm lại ACL/nguồn; stale 409 RISK_SOURCES_CHANGED; request lặp cùng nguồn không nhân audit. Snapshot/lý do lưu cùng transaction. Nguồn hoặc ngưỡng thay đổi thì cảnh báo xuất hiện lại.';
paths['/projects/{projectId}/risks'].get.responses['200'] = { description: 'open: key/type/severity/rule/title/explanation/tasks/owner/sourceVersion/snapshot/generatedAt. resolved: tối đa 10 lần xử lý gần đây kèm reason/sourceVersion/snapshot/current. rulesVersion tăng khi ngưỡng thay đổi; engineVersion định danh bộ quy tắc. Mọi nguồn trong phạm vi dự án được đọc.' };
paths['/ai/drafts/{id}'].patch.description = 'Chỉ chủ nháp đang là PM active. version bắt buộc; khóa workspace và trả 409 AI_DRAFT_CHANGED nếu tab cũ. Không chấp nhận key thiếu/trùng hoặc sửa excerpt; người nhận phải có ProjectRole/WorkspaceRole làm việc. Thành công tăng version và trả draft mới.';
paths['/ai/drafts/{id}/approve'].post.description = 'Chỉ chủ nháp đang là PM active. version bắt buộc; nháp còn mở phải khớp. Kiểm tổng giờ, hạn và số người đã chọn; transaction tạo task/AC/remainingHours, audit, tăng version. UNIQUE(project,aiDraftItem) + lock bảo đảm duyệt lặp không tạo trùng; nháp approved trả lại kết quả đã duyệt, kể cả retry version cũ. Response có draft/created.';
paths['/ai/drafts/{id}/discard'].post.description = 'Chỉ chủ nháp đang là PM active. version bắt buộc cho nháp còn mở; stale 409; không được hủy bản đã duyệt; hủy lặp là idempotent.';
paths['/projects/{projectId}/ai/plan'].post.description = 'Chỉ PM active. AI trả 5–15 mục đủ title/description/AC/estimate; server kiểm schema và giới hạn trước lưu nháp. Không có deadline thì không tự đặt. Người nhận mặc định trống để PM chọn. Chưa tạo task/notification trước approve.';
paths['/projects/{projectId}/ai/reports'].post.description = 'Chỉ PM active. Số liệu DB chốt tại generatedAt (legacy có thể null), AI chỉ viết diễn giải. Fingerprint gồm task/document/project/membership/capacity/risk resolutions; kiểm lại nguồn và quyền sau AI. Stats và generatedAt được giữ nguyên khi sửa nội dung báo cáo.';
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
const spec = { openapi: '3.1.0', info: { title: 'TaskFlow API — inventory và contract luồng chính', version: '2026-10-30', description: 'Base /api. Cookie HttpOnly tf_at; refresh tf_rt. UUID nội bộ id được serialize thành _id. Inventory bao phủ tuyến REST được khai báo trực tiếp; request/response chi tiết mới đặc tả các luồng chính, xem x-source cho phần còn lại. Các response lỗi chung là khả năng, không phải mọi endpoint đều trả mọi mã.' }, servers: [{ url: '/api' }], security: [{ cookieAuth: [] }], paths, components: { securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'tf_at' } }, schemas: { Error: object({ error: str, details: { type: 'object', additionalProperties: true } }, ['error']) } } };
await fs.writeFile(path.join(out, 'openapi.json'), JSON.stringify(spec, null, 2) + '\n');
const models = [...schemaSource.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)];
let erd = '# ERD và từ điển dữ liệu\n\nVersion 2026-10-30. Sinh từ `BackEnd/prisma/schema.prisma`; SQL migration là nguồn triển khai. Mảng UUID và JSONB không tự tạo FK; quan hệ bên dưới chỉ lấy từ `@relation(fields:...)` thật.\n\n```mermaid\nerDiagram\n';
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
