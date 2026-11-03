import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { csrfGuard, requireAuth } from './middleware/auth.js';
import { myTasksFromQuery } from './services/my-tasks.js';
import { errorHandler } from './utils/http.js';
import { apiReplacer } from './services/serialize.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import workspaceRoutes from './routes/workspaces.js';
import capacityRoutes from './routes/capacity.js';
import projectRoutes from './routes/projects.js';
import taskRoutes from './routes/tasks.js';
import documentRoutes from './routes/documents.js';
import notificationRoutes from './routes/notifications.js';
import dashboardRoutes from './routes/dashboard.js';
import aiRoutes from './routes/ai.js';
import adminRoutes from './routes/admin.js';
import devRoutes from './routes/dev.js';

export function createApp(options: { staticDir?: string } = {}): express.Express {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.set('json replacer', apiReplacer);
  const realtimeOrigin = new URL(config.clientUrl);
  realtimeOrigin.protocol = realtimeOrigin.protocol === 'https:' ? 'wss:' : 'ws:';
  app.use(helmet({ contentSecurityPolicy: config.isProd ? { directives: { connectSrc: ["'self'", realtimeOrigin.origin] } } : false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: config.clientUrl, credentials: true }));
  app.use((req, res, next) => {
    // Browser writes must originate from the configured frontend. Native clients
    // may omit Origin but still need the API's CSRF header and authentication.
    const origin = req.get('origin');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin && origin !== new URL(config.clientUrl).origin)
      return res.status(403).json({ error: 'Origin không được phép' });
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.get('/health', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ ok: true, time: new Date().toISOString(), build: config.release }); });
  api.use(csrfGuard);
  api.get(['/tasks', '/me/tasks'], requireAuth, myTasksFromQuery);
  api.use('/auth', authRoutes);
  api.use('/me', meRoutes);
  api.use('/workspaces', workspaceRoutes, capacityRoutes);
  api.use('/notifications', notificationRoutes);
  api.use('/admin', adminRoutes);
  if (!config.isProd) api.use('/dev', devRoutes);
  api.use(projectRoutes, taskRoutes, documentRoutes, dashboardRoutes, aiRoutes);
  api.use((_req, res) => res.status(404).json({ error: 'Không tìm thấy API' }));
  // Both paths share handlers, access checks and rate-limit state.
  app.use('/api/v1', api);
  app.use('/api', api);

  // Production: phục vụ bản build của client
  const dist = options.staticDir ?? path.resolve(config.root, '../FrontEnd/dist');
  if (fs.existsSync(dist)) {
    app.use('/assets', express.static(path.join(dist, 'assets'), { maxAge: '1y', immutable: true, index: false }));
    app.use('/assets', (_req, res) => res.status(404).type('text').send('Không tìm thấy asset'));
    app.use(express.static(dist, { index: false, maxAge: 0 }));
    app.get('/{*splat}', (req, res, next) => {
      if (path.extname(req.path)) return res.status(404).type('text').send('Không tìm thấy tệp');
      if (!req.accepts('html')) return next();
      res.setHeader('Cache-Control', 'no-store');
      return res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
