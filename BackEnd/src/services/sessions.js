import { prisma } from '../db.js';

/** Cùng khóa với refresh: tạo/thu hồi phiên và đổi mật khẩu không vượt qua nhau. */
export function withUserLock(userId, action) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      return action(tx);
    },
    { maxWait: 10000, timeout: 15000 },
  );
}
