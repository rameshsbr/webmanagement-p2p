// apps/server/src/routes/auth.ts
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { prisma } from '../lib/prisma.js';
import { enforceTurnstile } from '../middleware/turnstile.js';

const router = express.Router();

const JWT_SECRET   = process.env.JWT_SECRET || 'dev-secret';
const SITE_KEY     = process.env.TURNSTILE_SITE_KEY || '';
const ADMIN_DEBUG  = process.env.ADMIN_DEBUG === '1';

const DEMO_EMAIL    = process.env.ADMIN_DEMO_EMAIL || 'admin@example.com';
const DEMO_PASSWORD = process.env.ADMIN_DEMO_PASSWORD || 'demo123';

const IS_LOCAL =
  !process.env.NODE_ENV ||
  process.env.NODE_ENV === 'development' ||
  (process.env.BASE_URL || '').startsWith('http://localhost');

function log(...args: any[]) { if (ADMIN_DEBUG) console.log('[AUTH]', ...args); }

type PendingStage = '2fa_setup'|'2fa_verify';

function signTemp(payload: object, minutes = 10) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: `${minutes}m` });
}
function verifyTemp<T = any>(token: string) {
  return jwt.verify(token, JWT_SECRET) as T;
}

function getIp(req: any): string {
  const xf = (req.headers['x-forwarded-for'] || '') as string;
  if (xf) return xf.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

async function recordLogin(opts: { adminId?: string | null; email?: string | null; success: boolean; req: any }) {
  try {
    await prisma.adminLoginLog.create({
      data: {
        adminId: opts.adminId || null,
        email: opts.email || null,
        success: opts.success,
        ip: getIp(opts.req),
        userAgent: (opts.req.headers['user-agent'] as string) || null,
      },
    });
  } catch {}
}

/** ADMIN cookies */
function finalizeLogin(
  res: express.Response,
  admin: { id: string; role?: string; canViewUsers?: boolean }
) {
  const role = String(admin.role || 'ADMIN').toUpperCase();
  const tokenPayload: any = { sub: admin.id, role };
  if (typeof admin.canViewUsers === 'boolean') {
    tokenPayload.canViewUsers = admin.canViewUsers;
  }
  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });
  const base = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 8 * 60 * 60 * 1000,
    secure: !IS_LOCAL,
  };
  res.cookie('admin_jwt', token, base);
  res.cookie('admin',     token, base);
  res.cookie('session',   token, base);
  res.cookie('token',     token, base);
}

/** MERCHANT cookies (separate name; includes merchantId for portal) */
function setMerchantCookie(
  res: express.Response,
  payload: { sub: string; merchantId: string; email?: string | null; canViewUsers?: boolean }
) {
  const tokenPayload: any = {
    sub: payload.sub,
    merchantId: payload.merchantId,
    email: payload.email,
    merchantUserId: payload.sub,
  };
  if (typeof payload.canViewUsers === 'boolean') {
    tokenPayload.canViewUsers = payload.canViewUsers;
  }
  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });
  const base = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 8 * 60 * 60 * 1000, secure: !IS_LOCAL };
  // back-compat: set both names
  res.cookie('merchant_jwt', token, base);
  res.cookie('merchant',     token, base);
}

// ─────────────────────────────────────────────────────────────
// Helpers for admin 2FA
// ─────────────────────────────────────────────────────────────
router.use('/2fa/verify', (req: any, _res, next) => {
  const hasBodyToken = req.body && (req.body.token || req.body.t);
  if (!hasBodyToken && req.cookies?.pre2fa) {
    req.body = req.body || {};
    req.body.token = req.cookies.pre2fa;
  }
  next();
});

// Merchant 2FA verify: allow reading token from cookie too
router.use('/merchant/2fa/verify', (req: any, _res, next) => {
  const hasBodyToken = req.body && (req.body.token || req.body.t);
  if (!hasBodyToken && req.cookies?.m_pre2fa) {
    req.body = req.body || {};
    req.body.token = req.cookies.m_pre2fa;
  }
  next();
});

router.get('/whoami', (req, res) => {
  const c = req.cookies || {};
  const t = (c.admin_jwt || c.admin || c.session || c.token) as string | undefined;
  if (!t) return res.json({ ok: false, reason: 'no-cookie' });
  try {
    const p = jwt.verify(t, JWT_SECRET);
    return res.json({ ok: true, payload: p });
  } catch (e: any) {
    return res.json({ ok: false, reason: e?.name || 'verify-failed', message: e?.message || '' });
  }
});

// ─────────────────────────────────────────────────────────────
// ADMIN LOGIN
// ─────────────────────────────────────────────────────────────
router.get('/admin/login', (_req, res) => {
  res.render('admin-login', { title: 'Admin Login', siteKey: SITE_KEY });
});

router.post('/admin/login', enforceTurnstile, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).render('admin-login', { title: 'Admin Login', siteKey: SITE_KEY, error: 'Missing email or password.' });
  }

  if (ADMIN_DEBUG && email === DEMO_EMAIL && password === DEMO_PASSWORD) {
    finalizeLogin(res, { id: 'dev-admin', role: 'ADMIN', canViewUsers: true });
    await recordLogin({ adminId: null, email, success: true, req });
    return res.redirect('/admin');
  }

  let admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin) {
    const count = await prisma.adminUser.count();
    if (ADMIN_DEBUG && count === 0) {
      const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
      admin = await prisma.adminUser.create({
        data: { email: DEMO_EMAIL, passwordHash, role: 'ADMIN', twoFactorEnabled: false, active: true },
      });
      if (admin.email !== email) admin = null;
    }
  }

  if (!admin) {
    await recordLogin({ adminId: null, email, success: false, req });
    return res.status(401).render('admin-login', { title: 'Admin Login', siteKey: SITE_KEY, error: 'Invalid credentials.' });
  }
  if (!admin.active) {
    await recordLogin({ adminId: admin.id, email: admin.email, success: false, req });
    return res.status(403).render('admin-login', { title: 'Admin Login', siteKey: SITE_KEY, error: 'Account disabled.' });
  }

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) {
    await recordLogin({ adminId: admin.id, email: admin.email, success: false, req });
    return res.status(401).render('admin-login', { title: 'Admin Login', siteKey: SITE_KEY, error: 'Invalid credentials.' });
  }

  if (admin.twoFactorEnabled && admin.totpSecret) {
    const token = signTemp({ adminId: admin.id, stage: '2fa_verify' as PendingStage, kind: 'admin', redirectTo: '/admin' });
    res.cookie('pre2fa', token, { httpOnly: true, sameSite: 'lax', path: '/auth', secure: !IS_LOCAL });
    return res.render('auth-2fa-verify', { token, error: '', mode: 'admin' });
  }

  const secret = speakeasy.generateSecret({ name: `Payments Admin (${admin.email})` });
  const otpauth = secret.otpauth_url!;
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  const token = signTemp({
    adminId: admin.id,
    stage: '2fa_setup' as PendingStage,
    secretBase32: secret.base32,
    issuer: 'Payments Admin',
    accountLabel: admin.email,
    kind: 'admin',
    redirectTo: '/admin',
  });
  return res.render('auth-2fa-setup', { token, qrDataUrl, secretBase32: secret.base32, accountLabel: admin.email, error: '', mode: 'admin' });
});

router.post('/2fa/setup', async (req, res) => {
  const rawToken = req.body?.token;
  const code = String(req.body?.code || '').replace(/\s+/g, '');
  if (!rawToken || !code) {
    const tokenVal = Array.isArray(rawToken) ? rawToken[0] : rawToken;
    let mode: 'admin' | 'super' = 'admin';
    let secretBase32 = '';
    let accountLabel = '';
    let issuer = '';
    if (tokenVal) {
      try {
        const decoded: any = jwt.decode(tokenVal);
        if (decoded?.kind === 'super') mode = 'super';
        secretBase32 = decoded?.secretBase32 || '';
        accountLabel = decoded?.accountLabel || '';
        issuer = decoded?.issuer || '';
      } catch {}
    }
    let qrDataUrl: string | null = null;
    if (secretBase32 && accountLabel) {
      const fallbackIssuer = mode === 'super' ? 'Super Admin' : 'Payments Admin';
      const otpauth = speakeasy.otpauthURL({ secret: secretBase32, label: `${issuer || fallbackIssuer} (${accountLabel})`, issuer: issuer || fallbackIssuer });
      qrDataUrl = await QRCode.toDataURL(otpauth);
    }
    return res.status(400).render('auth-2fa-setup', {
      token: tokenVal || '',
      qrDataUrl,
      secretBase32,
      accountLabel,
      error: 'Missing code.',
      mode,
    });
  }

  try {
    const payload = verifyTemp<{
      adminId: string;
      stage: PendingStage;
      secretBase32: string;
      accountLabel: string;
      redirectTo?: string;
      kind?: 'admin' | 'super';
      issuer?: string;
    }>(
      Array.isArray(rawToken) ? rawToken[0] : rawToken
    );
    if (payload.stage !== '2fa_setup') throw new Error('bad-stage');

    const kind = payload.kind === 'super' ? 'super' : 'admin';
    const mode = kind === 'super' ? 'super' : 'admin';
    const issuer = payload.issuer || (kind === 'super' ? 'Super Admin' : 'Payments Admin');

    const ok = speakeasy.totp.verify({ secret: payload.secretBase32, encoding: 'base32', token: code, window: 2 });
    if (!ok) {
      const otpauth = speakeasy.otpauthURL({ secret: payload.secretBase32, label: `${issuer} (${payload.accountLabel})`, issuer });
      const qrDataUrl = await QRCode.toDataURL(otpauth);
      return res.status(400).render('auth-2fa-setup', { token: rawToken, qrDataUrl, secretBase32: payload.secretBase32, accountLabel: payload.accountLabel, error: 'Invalid or expired code.', mode });
    }

    const update = kind === 'super'
      ? { superTwoFactorEnabled: true, superTotpSecret: payload.secretBase32, lastLoginAt: new Date() }
      : { twoFactorEnabled: true, totpSecret: payload.secretBase32, lastLoginAt: new Date() };

    await prisma.adminUser.update({
      where: { id: payload.adminId },
      data: update,
    });

    const fresh = await prisma.adminUser.findUnique({
      where: { id: payload.adminId },
      select: { id: true, role: true, canViewUserDirectory: true },
    });
    if (fresh) {
      finalizeLogin(res, {
        id: fresh.id,
        role: fresh.role,
        canViewUsers: fresh.canViewUserDirectory !== false,
      });
    }
    await recordLogin({ adminId: payload.adminId, email: null, success: true, req });
    res.clearCookie('pre2fa', { path: '/auth' });
    const fallback = kind === 'super' ? '/superadmin' : '/admin';
    return res.redirect(payload.redirectTo || fallback);
  } catch {
    let mode: 'admin' | 'super' = 'admin';
    try {
      const decoded: any = jwt.decode(Array.isArray(rawToken) ? rawToken[0] : rawToken);
      if (decoded?.kind === 'super') mode = 'super';
    } catch {}
    return res.status(400).render('auth-2fa-setup', { token: rawToken, qrDataUrl: null, secretBase32: '', accountLabel: '', error: 'Setup error.', mode });
  }
});

router.post('/2fa/verify', async (req, res) => {
  const rawToken = req.body?.token;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  const code = String(req.body?.code || '').replace(/\s+/g, '');

  if (!token || !code) {
    let mode: 'admin' | 'super' = 'admin';
    if (token) {
      try {
        const decoded: any = jwt.decode(token);
        if (decoded?.kind === 'super') mode = 'super';
      } catch {}
    }
    return res.status(400).render('auth-2fa-verify', { token: token || '', error: 'Missing code.', mode });
  }

  try {
    const payload = verifyTemp<{ adminId:string; stage:PendingStage; redirectTo?: string; kind?: 'admin' | 'super' }>(token);
    if (payload.stage !== '2fa_verify') throw new Error('bad-stage');

    const kind = payload.kind === 'super' ? 'super' : 'admin';
    const mode = kind === 'super' ? 'super' : 'admin';

    const admin = await prisma.adminUser.findUnique({ where: { id: payload.adminId } });
    const secret = kind === 'super' ? admin?.superTotpSecret : admin?.totpSecret;
    if (!admin || !secret) {
      return res.status(400).render('auth-2fa-verify', { token, error: '2FA not set up.', mode });
    }

    const ok = speakeasy.totp.verify({ secret, encoding: 'base32', token: code, window: 2 });
    if (!ok) {
      await recordLogin({ adminId: admin.id, email: admin.email, success: false, req });
      return res.status(400).render('auth-2fa-verify', { token, error: 'Invalid or expired code. Ensure your phone time is automatic.', mode });
    }

    await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    finalizeLogin(res, {
      id: admin.id,
      role: admin.role,
      canViewUsers: admin.canViewUserDirectory !== false,
    });
    await recordLogin({ adminId: admin.id, email: admin.email, success: true, req });
    res.clearCookie('pre2fa', { path: '/auth' });
    const fallback = kind === 'super' ? '/superadmin' : '/admin';
    return res.redirect(302, payload.redirectTo || fallback);
  } catch (e: any) {
    const name = e?.name || '';
    if (name === 'TokenExpiredError' || name === 'JsonWebTokenError') {
      res.clearCookie('pre2fa', { path: '/auth' });
      let decoded: any = null;
      try { decoded = jwt.decode(token); } catch {}
      const kind = decoded?.kind === 'super' ? 'super' : 'admin';
      const loginPath = kind === 'super' ? '/auth/super/login' : '/auth/admin/login';
      return res.redirect(`${loginPath}?reason=pre2fa-expired`);
    }
    let mode: 'admin' | 'super' = 'admin';
    try {
      const decoded: any = jwt.decode(token);
      if (decoded?.kind === 'super') mode = 'super';
    } catch {}
    return res.status(400).render('auth-2fa-verify', { token, error: 'Verification error.', mode });
  }
});

// ─────────────────────────────────────────────────────────────
// SUPER ADMIN LOGIN (redirects to /superadmin)
// ─────────────────────────────────────────────────────────────
router.get('/super/login', (_req, res) => {
  res.render('superadmin-login', { title: 'Super Admin Login', siteKey: SITE_KEY });
});

router.post('/super/login', enforceTurnstile, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).render('superadmin-login', { title: 'Super Admin Login', siteKey: SITE_KEY, error: 'Missing email or password.' });
  }

  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin || !admin.active || String(admin.role).toUpperCase() !== 'SUPER') {
    await recordLogin({ adminId: admin?.id || null, email, success: false, req });
    return res.status(401).render('superadmin-login', { title: 'Super Admin Login', siteKey: SITE_KEY, error: 'Invalid credentials.' });
  }

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) {
    await recordLogin({ adminId: admin.id, email: admin.email, success: false, req });
    return res.status(401).render('superadmin-login', { title: 'Super Admin Login', siteKey: SITE_KEY, error: 'Invalid credentials.' });
  }

  if (admin.superTwoFactorEnabled && admin.superTotpSecret) {
    const token = signTemp({ adminId: admin.id, stage: '2fa_verify' as PendingStage, redirectTo: '/superadmin', kind: 'super' });
    res.cookie('pre2fa', token, { httpOnly: true, sameSite: 'lax', path: '/auth', secure: !IS_LOCAL });
    return res.render('auth-2fa-verify', { token, error: '', mode: 'super' });
  }

  const secret = speakeasy.generateSecret({ name: `Super Admin (${admin.email})` });
  const otpauth = secret.otpauth_url!;
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  const token = signTemp({
    adminId: admin.id,
    stage: '2fa_setup' as PendingStage,
    secretBase32: secret.base32,
    issuer: 'Super Admin',
    accountLabel: admin.email,
    redirectTo: '/superadmin',
    kind: 'super',
  });
  return res.render('auth-2fa-setup', { token, qrDataUrl, secretBase32: secret.base32, accountLabel: admin.email, error: '', mode: 'super' });
});

router.get('/super/logout', (_req, res) => {
  try {
    res.clearCookie('admin_jwt', { path: '/' });
    res.clearCookie('admin',     { path: '/' });
    res.clearCookie('session',   { path: '/' });
    res.clearCookie('token',     { path: '/' });
    res.clearCookie('pre2fa',    { path: '/auth' });
  } catch {}
  res.redirect('/auth/super/login');
});

router.get('/logout', (_req, res) => {
  try {
    res.clearCookie('admin_jwt', { path: '/' });
    res.clearCookie('admin',     { path: '/' });
    res.clearCookie('session',   { path: '/' });
    res.clearCookie('token',     { path: '/' });
    res.clearCookie('pre2fa',    { path: '/auth' });
  } catch {}
  res.redirect('/auth/admin/login');
});

// ─────────────────────────────────────────────────────────────
// MERCHANT LOGIN + 2FA (public-facing under /auth/merchant/*)
// ─────────────────────────────────────────────────────────────

router.get('/merchant/login', (req, res) => {
  res.render('merchant-login', {
    title: 'Merchant Login',
    error: '',
    reset: req.query?.reset === 'ok',
    siteKey: SITE_KEY,
  });
});

router.post('/merchant/login', enforceTurnstile, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).render('merchant-login', {
      title: 'Merchant Login',
      error: 'Missing email or password.',
      reset: false,
      siteKey: SITE_KEY,
    });
  }

  const user = await prisma.merchantUser.findUnique({
    where: { email },
    include: { merchant: true },
  });

  if (!user || !user.active || !user.merchant) {
    return res.status(401).render('merchant-login', {
      title: 'Merchant Login',
      error: 'Invalid credentials.',
      reset: false,
      siteKey: SITE_KEY,
    });
  }

  const m = user.merchant as any;
  const status = String(m.status || '').toLowerCase();
  if (!m.active || status === 'suspended' || status === 'closed') {
    return res.status(403).render('merchant-login', {
      title: 'Merchant Login',
      error: 'Merchant account is not active.',
      reset: false,
      siteKey: SITE_KEY,
    });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).render('merchant-login', {
      title: 'Merchant Login',
      error: 'Invalid credentials.',
      reset: false,
      siteKey: SITE_KEY,
    });
  }

  // 2FA
  if (user.twoFactorEnabled && user.totpSecret) {
    const token = signTemp({ userId: user.id, merchantId: user.merchantId, stage: '2fa_verify' as PendingStage });
    res.cookie('m_pre2fa', token, { httpOnly: true, sameSite: 'lax', path: '/auth/merchant', secure: !IS_LOCAL });
    return res.render('auth-2fa-verify', { token, error: '', mode: 'merchant' });
  }

  const secret = speakeasy.generateSecret({ name: `Merchant (${user.email})` });
  const otpauth = secret.otpauth_url!;
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  const token = signTemp({
    userId: user.id,
    merchantId: user.merchantId,
    stage: '2fa_setup' as PendingStage,
    secretBase32: secret.base32,
    issuer: 'Merchant',
    accountLabel: user.email,
  });
  return res.render('auth-2fa-setup', { token, qrDataUrl, secretBase32: secret.base32, accountLabel: user.email, error: '', mode: 'merchant' });
});

router.post('/merchant/2fa/setup', async (req, res) => {
  const rawToken = req.body?.token;
  const code = String(req.body?.code || '').replace(/\s+/g, '');
  if (!rawToken || !code) {
    return res.status(400).render('auth-2fa-setup', { token: rawToken || '', qrDataUrl: null, secretBase32: '', accountLabel: '', error: 'Missing code.', mode: 'merchant' });
  }
  try {
    const payload = jwt.verify(rawToken, JWT_SECRET) as any;
    if (payload.stage !== '2fa_setup') throw new Error('bad-stage');
    const ok = speakeasy.totp.verify({ secret: payload.secretBase32, encoding: 'base32', token: code, window: 2 });
    if (!ok) {
      const otpauth = speakeasy.otpauthURL({ secret: payload.secretBase32, label: `Merchant (${payload.accountLabel})`, issuer: 'Merchant' });
      const qrDataUrl = await QRCode.toDataURL(otpauth);
      return res.status(400).render('auth-2fa-setup', { token: rawToken, qrDataUrl, secretBase32: payload.secretBase32, accountLabel: payload.accountLabel, error: 'Invalid or expired code.', mode: 'merchant' });
    }
    await prisma.merchantUser.update({ where: { id: payload.userId }, data: { twoFactorEnabled: true, totpSecret: payload.secretBase32 } });
    const fresh = await prisma.merchantUser.findUnique({
      where: { id: payload.userId },
      select: { id: true, merchantId: true, email: true, canViewUserDirectory: true },
    });
    const canViewUsers = fresh ? fresh.canViewUserDirectory !== false : true;
    setMerchantCookie(res, {
      sub: payload.userId,
      merchantId: payload.merchantId,
      email: payload.accountLabel,
      canViewUsers,
    });
    res.clearCookie('m_pre2fa', { path: '/auth/merchant' });
    return res.redirect(payload.redirectTo || '/merchant');
  } catch {
    return res.status(400).render('auth-2fa-setup', { token: rawToken, qrDataUrl: null, secretBase32: '', accountLabel: '', error: 'Setup error.', mode: 'merchant' });
  }
});

router.post('/merchant/2fa/verify', async (req, res) => {
  const rawToken = req.body?.token;
  const code = String(req.body?.code || '').replace(/\s+/g, '');
  if (!rawToken || !code) {
    return res.status(400).render('auth-2fa-verify', { token: rawToken || '', error: 'Missing code.', mode: 'merchant' });
  }
  try {
    const payload = jwt.verify(rawToken, JWT_SECRET) as any;
    if (payload.stage !== '2fa_verify') throw new Error('bad-stage');
    const user = await prisma.merchantUser.findUnique({ where: { id: payload.userId } });
    if (!user || !user.totpSecret) return res.status(400).render('auth-2fa-verify', { token: rawToken, error: '2FA not set up.', mode: 'merchant' });
    const ok = speakeasy.totp.verify({ secret: user.totpSecret, encoding: 'base32', token: code, window: 2 });
    if (!ok) return res.status(400).render('auth-2fa-verify', { token: rawToken, error: 'Invalid or expired code.', mode: 'merchant' });
    setMerchantCookie(res, {
      sub: user.id,
      merchantId: user.merchantId,
      email: user.email,
      canViewUsers: user.canViewUserDirectory !== false,
    });
    res.clearCookie('m_pre2fa', { path: '/auth/merchant' });
    return res.redirect(payload.redirectTo || '/merchant');
  } catch {
    return res.status(400).render('auth-2fa-verify', { token: rawToken, error: 'Verification error.', mode: 'merchant' });
  }
});

// ── Merchant password reset (from Super Admin force-reset) ──
router.get('/merchant/reset', async (req, res) => {
  const token = String(req.query?.token || '');
  if (!token) return res.status(400).send('Missing token');

  const row = await prisma.merchantPasswordReset.findUnique({ where: { token } });
  const now = new Date();

  if (!row || row.usedAt || row.expiresAt < now) {
    return res.status(400).send('This reset link is invalid or expired.');
  }

  return res.render('auth-merchant-reset', {
    title: 'Reset Merchant Password',
    token,
    error: ''
  });
});

router.post('/merchant/reset', async (req, res) => {
  const token = String(req.body?.token || '');
  const pass1 = String(req.body?.password || '');
  const pass2 = String(req.body?.confirm || '');

  if (!token) return res.status(400).send('Missing token');
  if (!pass1 || pass1.length < 8) {
    return res.status(400).render('auth-merchant-reset', { title: 'Reset Merchant Password', token, error: 'Password must be at least 8 characters.' });
  }
  if (pass1 !== pass2) {
    return res.status(400).render('auth-merchant-reset', { title: 'Reset Merchant Password', token, error: 'Passwords do not match.' });
  }

  const row = await prisma.merchantPasswordReset.findUnique({ where: { token } });
  const now = new Date();
  if (!row || row.usedAt || row.expiresAt < now) {
    return res.status(400).render('auth-merchant-reset', { title: 'Reset Merchant Password', token, error: 'This reset link is invalid or expired.' });
  }

  if (!row.merchantUserId) {
    return res.status(400).render('auth-merchant-reset', { title: 'Reset Merchant Password', token, error: 'This reset link is invalid or expired.' });
  }

  const hash = await bcrypt.hash(pass1, 10);

  await prisma.$transaction([
    prisma.merchantUser.update({ where: { id: row.merchantUserId }, data: { passwordHash: hash, twoFactorEnabled: false, totpSecret: null } }),
    prisma.merchantPasswordReset.update({ where: { id: row.id }, data: { usedAt: now } }),
  ]);

  // Go back to *merchant* login page (public-facing under /auth)
  return res.redirect('/auth/merchant/login?reset=ok');
});

// Admin reset (kept)
router.get('/admin/reset', async (req, res) => {
  const token = String(req.query?.token || '');
  if (!token) return res.status(400).send('Missing token');

  const row = await prisma.adminPasswordReset.findUnique({ where: { token } });
  const now = new Date();

  if (!row || row.usedAt || row.expiresAt < now) {
    return res.status(400).send('This reset link is invalid or expired.');
  }

  return res.render('auth-admin-reset', {
    title: 'Reset Password',
    token,
    error: ''
  });
});

router.post('/admin/reset', async (req, res) => {
  const token = String(req.body?.token || '');
  const pass1 = String(req.body?.password || '');
  const pass2 = String(req.body?.confirm || '');

  if (!token) return res.status(400).send('Missing token');
  if (!pass1 || pass1.length < 8) {
    return res.status(400).render('auth-admin-reset', { title: 'Reset Password', token, error: 'Password must be at least 8 characters.' });
  }
  if (pass1 !== pass2) {
    return res.status(400).render('auth-admin-reset', { title: 'Reset Password', token, error: 'Passwords do not match.' });
  }

  const row = await prisma.adminPasswordReset.findUnique({ where: { token } });
  const now = new Date();
  if (!row || row.usedAt || row.expiresAt < now) {
    return res.status(400).render('auth-admin-reset', { title: 'Reset Password', token, error: 'This reset link is invalid or expired.' });
  }

  if (!row.adminId) {
    return res.status(400).render('auth-admin-reset', { title: 'Reset Password', token, error: 'This reset link is invalid or expired.' });
  }

  const admin = await prisma.adminUser.findUnique({ where: { id: row.adminId }, select: { role: true } });

  const hash = await bcrypt.hash(pass1, 10);

  await prisma.$transaction([
    prisma.adminUser.update({ where: { id: row.adminId }, data: { passwordHash: hash, twoFactorEnabled: false, totpSecret: null } }),
    prisma.adminPasswordReset.update({ where: { id: row.id }, data: { usedAt: now } }),
  ]);

  const dest = String(admin?.role || '').toUpperCase() === 'SUPER'
    ? '/auth/super/login'
    : '/auth/admin/login';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
  <meta http-equiv="refresh" content="1.5;url=${dest}">
  <link rel="stylesheet" href="/static/auth/styles.css">
  <body class="login-body">
    <div class="bg"></div>
    <main class="login-card" style="text-align:center">
      <h2>Password updated</h2>
      <p>You’ll be redirected shortly…</p>
      <p><a class="btn" href="${dest}">Continue</a></p>
    </main>
  </body>`);
});

export { router as authRouter };