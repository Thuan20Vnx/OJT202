import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { csrfGuard } from './middleware/auth.js';
import { errorHandler } from './utils/http.js';
import { apiReplacer } from './services/serialize.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import workspaceRoutes from './routes/workspaces.js';
import projectRoutes from './routes/projects.js';
import taskRoutes from './routes/tasks.js';
import documentRoutes from './routes/documents.js';
import notificationRoutes from './routes/notifications.js';
import dashboardRoutes from './routes/dashboard.js';
import aiRoutes from './routes/ai.js';
import adminRoutes from './routes/admin.js';
import devRoutes from './routes/dev.js';

export function createApp(): express.Express {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.set('json replacer', apiReplacer);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: config.clientUrl, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  api.use(csrfGuard);
  api.use('/auth', authRoutes);
  api.use('/me', meRoutes);
  api.use('/workspaces', workspaceRoutes);
  api.use('/notifications', notificationRoutes);
  api.use('/admin', adminRoutes);
  if (!config.isProd) api.use('/dev', devRoutes);
  api.use(projectRoutes, taskRoutes, documentRoutes, dashboardRoutes, aiRoutes);
  api.use((_req, res) => res.status(404).json({ error: 'Không tìm thấy API' }));
  // Both paths share handlers, access checks and rate-limit state.
  app.use('/api/v1', api);
  app.use('/api', api);

  // Production: phục vụ bản build của client
  const dist = path.resolve(config.root, '../FrontEnd/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
