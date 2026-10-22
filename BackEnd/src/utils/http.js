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

/** Validate body/query bằng zod, trả lỗi 400 với thông điệp tiếng Việt từng trường. */
export function parse(schema, data) {
  try {
    return schema.parse(data);
  } catch (e) {
    if (e instanceof ZodError) {
      const fields = {};
      for (const issue of e.issues) fields[issue.path.join('.') || '_'] = issue.message;
      throw badRequest(Object.values(fields)[0] || 'Dữ liệu không hợp lệ', { fields });
    }
    throw e;
  }
}

export function errorHandler(err, req, res, _next) {
  if (err?.name === 'MulterError') {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Tệp vượt quá 10MB' : 'Tải tệp thất bại';
    return res.status(400).json({ error: msg });
  }
  // Prisma: id sai định dạng uuid (P2023) hoặc bản ghi không còn (P2025) => 404; vi phạm UNIQUE => 409
  if (err?.code === 'P2023' || err?.code === 'P2025') return res.status(404).json({ error: 'Không tìm thấy' });
  if (err?.code === 'P2002') return res.status(409).json({ error: 'Dữ liệu bị trùng', details: { fields: err.meta?.target } });
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: status >= 500 ? 'Đã có lỗi xảy ra, vui lòng thử lại' : err.message, details: err.details });
}
