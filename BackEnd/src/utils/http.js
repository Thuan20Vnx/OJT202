import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Bạn cần đăng nhập') => new HttpError(401, msg);
export const forbidden = (msg = 'Bạn không có quyền thực hiện thao tác này') => new HttpError(403, msg);
export const notFound = (msg = 'Không tìm thấy') => new HttpError(404, msg);
export const conflict = (msg, details) => new HttpError(409, msg, details);

export function pagination(query, defaultLimit = 20) {
  const positive = (value, fallback, field) => {
    if (value === undefined || value === '') return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw badRequest(`${field} phải là số nguyên dương`);
    return Number(value);
  };
  const page = positive(query.page, 1, 'Trang');
  const limit = Math.min(100, positive(query.limit, defaultLimit, 'Số bản ghi'));
  if ((page - 1) * limit > 2147483647) throw badRequest('Trang vượt phạm vi cho phép');
  return { page, limit };
}

/** Validate body/query bằng zod, trả lỗi 400 với thông điệp tiếng Việt từng trường. */
export function parse(schema, data) {
  try {
    const parsed = schema.parse(data);
    // PostgreSQL text and JSONB cannot store NUL. Check accepted fields before
    // any database work, including nested arrays such as task checklists.
    const pending = [[parsed, '']];
    while (pending.length) {
      const [value, path] = pending.pop();
      if (typeof value === 'string' && value.includes('\u0000')) {
        const message = 'Văn bản không được chứa ký tự NUL';
        throw badRequest(message, { fields: { [path || '_']: message } });
      }
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) pending.push([child, path ? `${path}.${key}` : key]);
      }
    }
    return parsed;
  } catch (e) {
    if (e instanceof ZodError) {
      const fields = {};
      for (const issue of e.issues) fields[issue.path.join('.') || '_'] = viMessage(issue);
      const [firstPath, firstMessage] = Object.entries(fields)[0] || [];
      // Câu mặc định (không gắn với ô nào trên form) thì nêu tên trường để người gọi API biết sai ở đâu.
      const generic = firstMessage && firstMessage !== e.issues[0]?.message && firstPath !== '_';
      throw badRequest(firstMessage ? (generic ? `${firstPath}: ${firstMessage}` : firstMessage) : 'Dữ liệu không hợp lệ', { fields });
    }
    throw e;
  }
}

/** Câu lỗi mặc định của zod là tiếng Anh; câu do code tự viết (tiếng Việt) thì giữ nguyên. */
function viMessage(issue) {
  if (!/^(Invalid|Too big|Too small|Unrecognized)/.test(issue.message)) return issue.message;
  const unit = issue.origin === 'string' ? ' ký tự' : issue.origin === 'array' || issue.origin === 'set' ? ' mục' : '';
  switch (issue.code) {
    case 'too_big': return `Tối đa ${issue.maximum}${unit}`;
    case 'too_small': return issue.origin === 'string' && Number(issue.minimum) === 1 ? 'Không được để trống' : `Tối thiểu ${issue.minimum}${unit}`;
    case 'invalid_type': return /received undefined/.test(issue.message) ? 'Thiếu dữ liệu bắt buộc' : 'Sai kiểu dữ liệu';
    case 'unrecognized_keys': return `Trường không được hỗ trợ: ${(issue.keys || []).join(', ')}`;
    case 'invalid_value': return 'Giá trị không hợp lệ';
    case 'invalid_format': return 'Sai định dạng';
    default: return 'Dữ liệu không hợp lệ';
  }
}

export function errorHandler(err, req, res, _next) {
  if (err?.name === 'MulterError') {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Tệp vượt quá 10MB' : 'Tải tệp thất bại';
    return res.status(400).json({ error: msg });
  }
  // busboy (bên dưới multer) ném Error thường khi body multipart hỏng/thiếu boundary: lỗi của request, không phải server.
  if (/^(Unexpected end of form|Multipart: Boundary not found|Malformed part header|Unexpected end of multipart data)/.test(err?.message || ''))
    return res.status(400).json({ error: 'Dữ liệu tải lên không hợp lệ' });
  // express.json: JSON hỏng
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Dữ liệu JSON không hợp lệ' });
  // Prisma: id sai định dạng uuid (P2023) hoặc bản ghi không còn (P2025) => 404; vi phạm UNIQUE => 409
  if (err?.code === 'P2023' || err?.code === 'P2025') return res.status(404).json({ error: 'Không tìm thấy' });
  if (err?.code === 'P2002') return res.status(409).json({ error: 'Dữ liệu bị trùng', details: { fields: err.meta?.target } });
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  // HttpError là câu báo do code chủ động viết (ví dụ AI đang bận); lỗi bất ngờ thì không lộ chi tiết.
  res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? 'Đã có lỗi xảy ra, vui lòng thử lại' : err.message, details: err.details });
}
