import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';

export const debugRouter = Router();

debugRouter.get('/debug/cookies', (req, res) => {
  res.json({ cookies: req.cookies });
});

debugRouter.get('/debug/whoami', requireAdmin, (req: any, res) => {
  res.json({ admin: req.admin });
});