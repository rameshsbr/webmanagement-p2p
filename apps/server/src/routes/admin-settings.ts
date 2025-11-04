import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';

export const adminSettingsRouter = Router();

function getAdminIdFromCookie(req: any): string | null {
  try {
    const token = req.cookies?.admin_jwt;
    if (!token) return null;
    const secret = process.env.JWT_SECRET || 'changeme-super-secret';
    const p: any = jwt.verify(token, secret);
    return p?.sub || null;
  } catch { return null; }
}

adminSettingsRouter.get('/security', async (req, res) => {
  const adminId = getAdminIdFromCookie(req);
  if (!adminId) return res.redirect('/auth/admin/login');

  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!admin) return res.redirect('/auth/admin/login');

  return res.render('admin-settings-security', {
    title: 'Security',
    twoFactorEnabled: !!admin.twoFactorEnabled
  });
});
