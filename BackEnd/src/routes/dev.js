import { Router } from 'express';
import { prisma } from '../db.js';

/** Hộp thư dev – CHỈ mount khi không chạy production. Xem link xác minh / đặt lại mật khẩu / lời mời. */
const router = Router();

router.get('/outbox', async (_req, res) => {
  const mails = await prisma.outbox.findMany({ orderBy: { createdAt: 'desc' }, take: 30 });
  res.json({ mails });
});

export default router;
