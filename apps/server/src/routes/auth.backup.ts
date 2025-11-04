// apps/server/src/routes/auth.ts  (login + TOTP + logout)
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { prisma } from '../lib/prisma.js';
import { enforceTurnstile } from '../middleware/turnstile.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const SITE_KEY = process.env.TURNSTILE_SITE_KEY || '';

type PendingStage = '2fa_setup'|'2fa_verify';
function signTemp(payload: object, minutes = 10) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: `${minutes}m` });
}
function verifyTemp<T=any>(token: string) {
  return jwt.verify(token, JWT_SECRET) as T;
}

// Minimal "finalize login" that sets cookie; if you already have one, keep yours.
function finalizeLogin(res: express.Response, adminId: string) {
  const token = jwt.sign({ sub: adminId, role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  res.cookie('admin_jwt', token, { httpOnly: true, sameSite: 'lax' });
}

// --- Views ---
// GET login
router.get('/admin/login', (req, res) => {
  res.render('admin-login', { title: 'Admin Login', siteKey: SITE_KEY });
});

// POST login (password) + Turnstile
router.post('/admin/login', enforceTurnstile, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).render('admin-login', { title: 'Admin Login', siteKey: SITE_KEY, error: 'Missing email or password.' });
  }
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin) {
    return res.status(401).render('admin-login', { title: 'Admin Login', siteKey: SITE_KEY, error: 'Invalid credentials.' });
  }
  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) {
    return res.status(401).render('admin-login', { title: 'Admin Login', siteKey: SITE_KEY, error: 'Invalid credentials.' });
  }

  // twoFactorEnabled flow
  if (admin.twoFactorEnabled && admin.totpSecret) {
    const token = signTemp({ adminId: admin.id, stage: '2fa_verify' as PendingStage });
    return res.render('auth-2fa-verify', { token, error: null });
  }

  // First-time setup: create secret, don't persist until user confirms a valid code
  const secret = speakeasy.generateSecret({ name: `Payments Admin (${admin.email})` });
  const otpauth = secret.otpauth_url!;
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  const token = signTemp({
    adminId: admin.id,
    stage: '2fa_setup' as PendingStage,
    secretBase32: secret.base32,
    issuer: 'Payments Admin',
    accountLabel: admin.email
  });

  return res.render('auth-2fa-setup', {
    token,
    qrDataUrl,
    secretBase32: secret.base32,
    accountLabel: admin.email,
    error: null
  });
});

// POST /auth/2fa/setup  (enable and persist)
router.post('/2fa/setup', async (req, res) => {
  const { token, code } = req.body || {};
  if (!token || !code) return res.status(400).render('auth-2fa-setup', { token, qrDataUrl: null, secretBase32: '', accountLabel: '', error: 'Missing code.' });

  try {
    const payload = verifyTemp<{ adminId:string; stage:PendingStage; secretBase32:string; accountLabel:string }>(token);
    if (payload.stage !== '2fa_setup') throw new Error('bad stage');

    const ok = speakeasy.totp.verify({
      secret: payload.secretBase32,
      encoding: 'base32',
      token: code,
      window: 1
    });
    if (!ok) {
      // Re-render the same QR on error (rebuild otpauth/qr)
      const otpauth = speakeasy.otpauthURL({ secret: payload.secretBase32, label: `Payments Admin (${payload.accountLabel})`, issuer: 'Payments Admin' });
      const qrDataUrl = await QRCode.toDataURL(otpauth);
      return res.status(400).render('auth-2fa-setup', {
        token,
        qrDataUrl,
        secretBase32: payload.secretBase32,
        accountLabel: payload.accountLabel,
        error: 'Invalid or expired code.'
      });
    }

    await prisma.adminUser.update({
      where: { id: payload.adminId },
      data: { twoFactorEnabled: true, totpSecret: payload.secretBase32 }
    });
    finalizeLogin(res, payload.adminId);
    return res.redirect('/admin');
  } catch {
    return res.status(400).render('auth-2fa-setup', { token, qrDataUrl: null, secretBase32: '', accountLabel: '', error: 'Setup error.' });
  }
});

// POST /auth/2fa/verify  (on each login)
router.post('/2fa/verify', async (req, res) => {
  const { token, code } = req.body || {};
  if (!token || !code) return res.status(400).render('auth-2fa-verify', { token, error: 'Missing code.' });

  try {
    const payload = verifyTemp<{ adminId:string; stage:PendingStage }>(token);
    if (payload.stage !== '2fa_verify') throw new Error('bad stage');

    const admin = await prisma.adminUser.findUnique({ where: { id: payload.adminId } });
    if (!admin || !admin.totpSecret) {
      return res.status(400).render('auth-2fa-verify', { token, error: '2FA not set up.' });
    }
    const ok = speakeasy.totp.verify({
      secret: admin.totpSecret,
      encoding: 'base32',
      token: code,
      window: 1
    });
    if (!ok) {
      return res.status(400).render('auth-2fa-verify', { token, error: 'Invalid or expired code.' });
    }
    finalizeLogin(res, admin.id);
    return res.redirect('/admin');
  } catch {
    return res.status(400).render('auth-2fa-verify', { token, error: 'Verification error.' });
  }
});

// GET /auth/logout
router.get('/logout', (req, res) => {
  try {
    res.clearCookie('admin_jwt', { httpOnly: true, sameSite: 'lax' });
    res.clearCookie('session'); // in case older cookie name
  } catch {}
  res.redirect('/auth/admin/login');
});

export { router as authRouter };
