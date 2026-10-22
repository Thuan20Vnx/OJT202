import http from 'node:http';
import { config } from './config.js';
import { connectDb, disconnectDb } from './db.js';
import { createApp } from './app.js';
import { initRealtime } from './services/realtime.js';
import { startJobs } from './services/jobs.js';
import { seedDemo } from './seed.js';

async function main() {
  await connectDb();
  if (config.seedDemo) await seedDemo();
  const app = createApp();
  const server = http.createServer(app);
  initRealtime(server);
  const timer = startJobs();
  server.listen(config.port, () => {
    console.log(`[api] TaskFlow API chạy tại http://localhost:${config.port}`);
    if (!config.ai.apiKey) console.log('[ai] Chưa có ANTHROPIC_API_KEY → dùng bộ AI nội bộ (quy tắc)');
  });

  const shutdown = async () => {
    clearInterval(timer);
    server.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
