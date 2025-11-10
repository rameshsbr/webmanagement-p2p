import type { Request, Response, NextFunction } from 'express';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

type ViewInfo = {
  view: 'admin-login' | 'superadmin-login' | 'merchant-login';
  title: string;
  includeReset?: boolean;
};

function resolveView(req: Request): ViewInfo {
  const original = req.originalUrl || '';
  if (original.includes('/auth/super')) {
    return { view: 'superadmin-login', title: 'Super Admin Login' };
  }
  if (original.includes('/auth/merchant')) {
    return { view: 'merchant-login', title: 'Merchant Login', includeReset: true };
  }
  return { view: 'admin-login', title: 'Admin Login' };
}

export async function enforceTurnstile(req: Request, res: Response, next: NextFunction) {
  const siteKey = process.env.TURNSTILE_SITE_KEY || '';
  const secret  = process.env.TURNSTILE_SECRET_KEY || '';
  const bypass  = process.env.TURNSTILE_BYPASS === '1';
  const viewInfo = resolveView(req);

  const renderError = (status: number, message: string) => {
    const locals: Record<string, any> = {
      title: viewInfo.title,
      siteKey,
      error: message,
    };
    if (viewInfo.includeReset) locals.reset = false;
    return res.status(status).render(viewInfo.view, locals);
  };

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
    return renderError(400, 'Please complete the Cloudflare check.');
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
      return renderError(400, 'Please complete the Cloudflare check.');
    }

    return next();
  } catch (e) {
    console.warn('[turnstile] verify error:', e);
    return renderError(500, 'Cloudflare verification error.');
  }
}
