import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const env = process.env;

export const config = {
  root,
  port: Number(env.PORT || 4000),
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  clientUrl: env.CLIENT_URL || 'http://localhost:5173',
  trustProxy: env.TRUST_PROXY?.trim()
    ? env.TRUST_PROXY.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : false,
  databaseUrl: env.DATABASE_URL || '',
  pgPort: Number(env.PG_EMBEDDED_PORT || 54329),
  seedDemo: (env.SEED_DEMO ?? (env.NODE_ENV === 'production' ? 'false' : 'true')) !== 'false',
  jwtSecret: env.JWT_SECRET || 'change-me-dev-only-secret',
  accessTtlSec: 15 * 60,
  refreshTtlSec: 30 * 24 * 3600,
  verifyTtlMs: 24 * 3600 * 1000,
  resetTtlMs: 30 * 60 * 1000,
  inviteTtlMs: 72 * 3600 * 1000,
  uploadDir: path.resolve(root, env.UPLOAD_DIR || './.data/uploads'),
  dataDir: path.resolve(root, './.data'),
  maxUploadBytes: 10 * 1024 * 1024,
  ai: {
    // AIService (thư mục AIService) – BackEnd gọi qua HTTP, khóa dùng chung đặt giống bên AIService
    serviceUrl: (env.AI_SERVICE_URL || 'http://localhost:5000').replace(/\/+$/, ''),
    serviceKey: env.AI_SERVICE_KEY || '',
    timeoutMs: Number(env.AI_TIMEOUT_MS || 30000),
  },
};

if (config.isProd && (config.jwtSecret === 'change-me-dev-only-secret' || config.jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET production phải có ít nhất 32 ký tự ngẫu nhiên');
}
if (config.isProd && config.seedDemo) {
  throw new Error('Không được bật SEED_DEMO trong production vì tài khoản demo có mật khẩu công khai');
}
if (config.isProd && !config.ai.serviceKey) {
  throw new Error('AI_SERVICE_KEY phải được đặt khi chạy production');
}
