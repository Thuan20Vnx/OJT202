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
  clientUrl: env.CLIENT_URL || env.RENDER_EXTERNAL_URL || 'http://localhost:5173',
  release: { revision: /^[a-f0-9]{40}$/.test(env.RELEASE_SHA || '') ? env.RELEASE_SHA : null, sourceHash: /^[a-f0-9]{64}$/.test(env.RELEASE_SOURCE_HASH || '') ? env.RELEASE_SOURCE_HASH : null },
  // Số nguyên = số proxy phía trước app (Express đếm hop); còn lại là danh sách IP/CIDR tin cậy.
  trustProxy: /^\d+$/.test(env.TRUST_PROXY?.trim() || '')
    ? Number(env.TRUST_PROXY.trim())
    : env.TRUST_PROXY?.trim()
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
  otp: { ttlMs: 10 * 60 * 1000, maxAttempts: 5 },
  security: {
    // Khóa đăng nhập luôn bật. Các giới hạn spam tắt khi chạy test vì bộ test đăng ký hàng trăm tài khoản từ một IP.
    throttle: env.NODE_ENV !== 'test' && env.SECURITY_THROTTLE !== 'false',
    loginMaxFailures: 5,
    loginLockMinutes: 5,
    loginFailureWindowMinutes: 15,
    registerPerIpPerHour: Number(env.REGISTER_PER_IP_PER_HOUR || 10),
    mailCooldownSec: 60,
    mailPerEmailPerHour: 5,
    mailPerIpPerHour: 20,
    invitesPerUserPerHour: 50,
  },
  google: { clientId: env.GOOGLE_CLIENT_ID || '' },
  inviteTtlMs: 72 * 3600 * 1000,
  uploadDir: path.resolve(root, env.UPLOAD_DIR || './.data/uploads'),
  dataDir: path.resolve(root, './.data'),
  maxUploadBytes: 10 * 1024 * 1024,
  mail: {
    mode: env.MAIL_MODE || (env.NODE_ENV === 'production' ? 'smtp' : 'outbox'),
    host: env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(env.SMTP_PORT || 465),
    secure: env.SMTP_SECURE !== 'false',
    requireTLS: env.SMTP_REQUIRE_TLS !== 'false',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || env.SMTP_USER || '',
    gmail: {
      clientId: env.GMAIL_CLIENT_ID || '',
      clientSecret: env.GMAIL_CLIENT_SECRET || '',
      refreshToken: env.GMAIL_REFRESH_TOKEN || '',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      sendUrl: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    },
  },
  storage: {
    url: (env.SUPABASE_URL || '').replace(/\/+$/, ''),
    serviceKey: env.SUPABASE_SERVICE_KEY || '',
    bucket: env.SUPABASE_BUCKET || 'taskflow-uploads',
  },
  repo: {
    // Chỉ bật khi GitLab tự host nằm trong mạng nội bộ; mặc định chặn địa chỉ riêng để tránh SSRF.
    allowPrivateHosts: env.REPO_ALLOW_PRIVATE_HOST === 'true',
    githubApi: (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''),
  },
  agent: {
    // Nguồn tra cứu công cụ cho gợi ý hằng ngày (công khai, miễn phí); đổi được để test bằng server giả.
    mcpRegistryUrl: (env.MCP_REGISTRY_URL || 'https://registry.modelcontextprotocol.io').replace(/\/+$/, ''),
    npmSearchUrl: env.NPM_SEARCH_URL || 'https://registry.npmjs.org/-/v1/search',
  },
  ai: {
    // AIService (thư mục AIService) – BackEnd gọi qua HTTP, khóa dùng chung đặt giống bên AIService
    serviceUrl: (env.AI_SERVICE_URL || 'http://localhost:5000').replace(/\/+$/, ''),
    serviceKey: env.AI_SERVICE_KEY || '',
    timeoutMs: Number(env.AI_TIMEOUT_MS || 30000),
    // Thời gian chờ tối thiểu theo tính năng, thắng cả AI_TIMEOUT_MS lẫn cài đặt workspace: model miễn phí
    // (Gemini Flash có bước suy luận) thường mất 20–40 giây cho kế hoạch và hỏi đáp, chờ 30 giây là hay báo "AI đang bận".
    featureMinTimeoutMs: { planner: 90000, qa: 60000, meeting: 60000, report: 60000 },
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
