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
  databaseUrl: env.DATABASE_URL || '',
  pgPort: Number(env.PG_EMBEDDED_PORT || 54329),
  seedDemo: (env.SEED_DEMO ?? 'true') !== 'false',
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
    apiKey: env.ANTHROPIC_API_KEY || '',
    model: env.AI_MODEL || 'claude-opus-5-5',
    timeoutMs: Number(env.AI_TIMEOUT_MS || 30000),
  },
};

if (config.isProd && config.jwtSecret === 'change-me-dev-only-secret') {
  throw new Error('JWT_SECRET phải được đặt khi chạy production');
}
