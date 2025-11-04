// apps/server/src/routes/adminSecurity.ts
import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { prisma } from '../lib/prisma.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

type PendingStage = '2fa_setup';

function signTemp(payload: object, minutes = 10) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: `${minutes}m` });
}

// GET /admin/settings/security — show 2FA status
router.get('/settings/security', async (req: any, res: Response) => {
  const adminId = req.admin?.sub as string | undefined;
  if (!adminId) return res.redirect('/auth/admin/login');

  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId },
    select: { email: true, twoFactorEnabled: true, totpSecret: true },
  });

  const enabled = !!(admin?.twoFactorEnabled && admin?.totpSecret);

  return res.render('admin-settings-security', {
    title: 'Security',
    twoFactorEnabled: enabled,
    email: admin?.email || '',
  });
});

// POST /admin/settings/security/start — begin 2FA setup (renders the QR page)
router.post('/settings/security/start', async (req: any, res: Response) => {
  const adminId = req.admin?.sub as string | undefined;
  if (!adminId) return res.redirect('/auth/admin/login');

  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId },
    select: { email: true },
  });

  const secret = speakeasy.generateSecret({
    name: `Payments Admin (${admin?.email || adminId})`,
  });

  const otpauth = secret.otpauth_url!;
  const qrDataUrl = await QRCode.toDataURL(otpauth);

  const token = signTemp({
    adminId,
    stage: '2fa_setup' as PendingStage,
    secretBase32: secret.base32,
    issuer: 'Payments Admin',
    accountLabel: admin?.email || adminId,
  });

  return res.render('auth-2fa-setup', {
    token,
    qrDataUrl,
    secretBase32: secret.base32,
    accountLabel: admin?.email || adminId,
    error: '',
  });
});

// POST /admin/settings/security/disable — turn off 2FA
router.post('/settings/security/disable', async (req: any, res: Response) => {
  const adminId = req.admin?.sub as string | undefined;
  if (!adminId) return res.redirect('/auth/admin/login');

  await prisma.adminUser.update({
    where: { id: adminId },
    data: { twoFactorEnabled: false, totpSecret: null },
  });

  return res.redirect('/admin/settings/security');
});

export const adminSecurityRouter = router;