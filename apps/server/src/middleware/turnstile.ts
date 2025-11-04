import type { Request, Response, NextFunction } from 'express';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function enforceTurnstile(req: Request, res: Response, next: NextFunction) {
  const siteKey = process.env.TURNSTILE_SITE_KEY || '';
  const secret  = process.env.TURNSTILE_SECRET_KEY || '';
  const bypass  = process.env.TURNSTILE_BYPASS === '1';

  // Local/dev bypass (or when keys aren’t set)
  if (bypass || !siteKey || !secret) return next();

  const b: any = req.body || {};
  const token =
    b['cf-turnstile-response'] ||
    b['cf-turnstile-token'] ||
    b['cf-turnstile'] ||
    (req.headers['cf-turnstile-token'] as string | undefined);

  if (!token) {
    console.warn('[turnstile] no token on POST', req.originalUrl);
    return res.status(400).render('admin-login', {
      title: 'Admin Login',
      siteKey,
      error: 'Please complete the Cloudflare check.',
    });
  }

  try {
    const params = new URLSearchParams();
    params.set('secret', secret);
    params.set('response', token);
    const ip = (req.headers['cf-connecting-ip'] as string) || req.ip || '';
    if (ip) params.set('remoteip', ip);

    const resp = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const data = await resp.json() as { success?: boolean; ['error-codes']?: string[] };

    if (!data.success) {
      console.warn('[turnstile] verify failed:', data['error-codes']);
      return res.status(400).render('admin-login', {
        title: 'Admin Login',
        siteKey,
        error: 'Please complete the Cloudflare check.',
      });
    }

    return next();
  } catch (e) {
    console.warn('[turnstile] verify error:', e);
    return res.status(500).render('admin-login', {
      title: 'Admin Login',
      siteKey,
      error: 'Cloudflare verification error.',
    });
  }
}