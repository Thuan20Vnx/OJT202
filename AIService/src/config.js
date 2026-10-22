import 'dotenv/config';

const env = process.env;

export const config = {
  port: Number(env.PORT || 5000),
  isProd: env.NODE_ENV === 'production',
  // Khóa dùng chung với BackEnd (header x-ai-service-key). Để trống khi phát triển => không kiểm tra.
  serviceKey: env.AI_SERVICE_KEY || '',
  // Để trống => dùng bộ AI nội bộ (quy tắc, không gọi mạng)
  apiKey: env.ANTHROPIC_API_KEY || '',
  model: env.AI_MODEL || 'claude-opus-5-5',
};

export const LOCAL_MODEL = 'taskflow-local-rules';

if (config.isProd && !config.serviceKey) {
  throw new Error('AI_SERVICE_KEY phải được đặt khi chạy production');
}
