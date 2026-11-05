// Kiểm tra CHỈ ĐỌC database trong DATABASE_URL: tài khoản còn dùng mật khẩu demo công khai và migration đã áp.
// Chạy: node scripts/check-demo-accounts.js  (không chạy migration, không in mật khẩu hay chuỗi kết nối)
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const DEMO_PASSWORD = 'TaskFlow@2026'; // giống src/seed.js

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL trống: không có database nào để kiểm tra.');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const { users, migrations } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return {
      users: await tx.$queryRaw`SELECT email, "passwordHash", "isSystemAdmin", "isLocked", "lastLoginAt" FROM users`,
      migrations: await tx.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`,
    };
  });
  const demo = [];
  for (const user of users) if (await bcrypt.compare(DEMO_PASSWORD, user.passwordHash)) demo.push(user);

  console.log(`Tổng tài khoản: ${users.length}`);
  console.log(`Còn dùng mật khẩu demo: ${demo.length}`);
  for (const u of demo) {
    const flags = [u.isSystemAdmin && 'SYSTEM ADMIN', u.isLocked && 'đã khóa'].filter(Boolean).join(', ');
    console.log(`  - ${u.email}${flags ? ` [${flags}]` : ''}, đăng nhập gần nhất: ${u.lastLoginAt?.toISOString() ?? 'chưa'}`);
  }
  console.log(`Migration đã áp: ${migrations.length}, mới nhất: ${migrations.at(-1)?.migration_name ?? 'không có'}`);
} finally {
  await prisma.$disconnect();
}
