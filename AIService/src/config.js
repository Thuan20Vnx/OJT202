import 'dotenv/config';

const env = process.env;

export const config = {
  port: Number(env.PORT || 5000),
  isProd: env.NODE_ENV === 'production',
  // Khóa dùng chung với BackEnd (header x-ai-service-key). Để trống khi phát triển => không kiểm tra.
  serviceKey: env.AI_SERVICE_KEY || '',
  // Không cấu hình nhà cung cấp nào => dùng bộ AI nội bộ (quy tắc, không gọi mạng)
  gemini: { apiKey: env.GEMINI_API_KEY || '', model: env.GEMINI_MODEL || 'gemini-3.6-flash' },
  // Dự phòng khi nhà cung cấp trước lỗi hoặc hết hạn mức; cả ba dùng giao thức chat completions của OpenAI.
  groq: { apiKey: env.GROQ_API_KEY || '', model: env.GROQ_MODEL || 'llama-3.3-70b-versatile', baseUrl: env.GROQ_URL || 'https://api.groq.com/openai/v1' },
  openrouter: { apiKey: env.OPENROUTER_API_KEY || '', model: env.OPENROUTER_MODEL || 'openrouter/free', baseUrl: env.OPENROUTER_URL || 'https://openrouter.ai/api/v1' },
  // Model chạy trên máy (Ollama): bật khi đặt OLLAMA_MODEL, không cần khóa, không giới hạn lượt.
  ollama: { apiKey: '', model: env.OLLAMA_MODEL || '', baseUrl: env.OLLAMA_URL || 'http://localhost:11434/v1' },
  providerOrder: (env.AI_PROVIDER_ORDER || 'gemini,groq,openrouter,ollama').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean),
  // Thời gian tối đa chờ một nhà cung cấp trước khi chuyển sang cái kế (cái cuối chuỗi chờ theo BackEnd).
  providerTimeoutMs: Number(env.AI_PROVIDER_TIMEOUT_MS || 12000),
};

export const LOCAL_MODEL = 'taskflow-local-rules';

if (config.isProd && !config.serviceKey) {
  throw new Error('AI_SERVICE_KEY phải được đặt khi chạy production');
}
