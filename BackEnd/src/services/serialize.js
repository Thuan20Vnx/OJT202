export const publicUser = (u) =>
  u && {
    id: u.id,
    name: u.name,
    email: u.email,
    title: u.title,
  };

export const meUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  title: u.title,
  emailVerified: u.emailVerified,
  timezone: u.timezone,
  language: u.language,
  isSystemAdmin: !!u.isSystemAdmin,
});

/**
 * Hợp đồng API: mọi bản ghi trả về cho client dùng khóa `_id` (giữ nguyên từ phiên bản đầu).
 * Trong server và database khóa là `id`; đổi tên tại một chỗ khi tuần tự hóa JSON (HTTP + Socket.io).
 */
export function apiReplacer(_key, value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'id' in value && !('_id' in value)) {
    const { id, ...rest } = value;
    return { _id: id, ...rest };
  }
  return value;
}

export const toApi = (payload) => JSON.parse(JSON.stringify(payload, apiReplacer));
