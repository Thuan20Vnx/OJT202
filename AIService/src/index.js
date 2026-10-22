import { config } from './config.js';
import { createApp, providerInfo } from './app.js';

const server = createApp().listen(config.port, () => {
  const p = providerInfo();
  console.log(`[ai-service] TaskFlow AIService chạy tại http://localhost:${config.port}`);
  console.log(p.type === 'anthropic' ? `[ai-service] Dùng Anthropic Claude (${p.model})` : '[ai-service] Chưa có ANTHROPIC_API_KEY → dùng bộ AI nội bộ (quy tắc)');
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
