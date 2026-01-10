// Adds types for res.ok/res.badRequest helpers and injects currency formatters
import type express from "express";

declare global {
  namespace Express {
    interface Response {
      ok: (data?: unknown) => void;
      badRequest: (msg: string) => void;
      unauthorized: (msg?: string) => void;
      forbidden: (msg?: string) => void;
      notFound: (msg?: string) => void;
    }
    interface Request {
      rawBody?: string;
      merchantId?: string;
      apiKeyScopes?: string[];
      admin?: { sub?: string; role?: string; [key: string]: unknown } | null;
    }
  }
}

/**
 * Zero-decimal currencies (provider returns whole units, not cents).
 * We treat IDR as whole Rupiah (no /100 conversion when formatting).
 */
const ZERO_DECIMAL = new Set(["IDR", "JPY", "KRW"]);

function getMinorUnit(currency?: string): number {
  const c = String(currency || "IDR").toUpperCase();
  return ZERO_DECIMAL.has(c) ? 1 : 100;
}

/**
 * Format a money value from "amountCents" (internal integer) to a human number string.
 * - If currency is IDR (default), show thousand separators and NO decimals.
 * - For non zero-decimal currencies, show 2 decimals.
 * NOTE: This returns just the number (no currency code), for table columns where
 * code is shown in a separate "CURRENCY" column.
 */
function formatAmountNumber(amountCents: number, currency?: string): string {
  const mu = getMinorUnit(currency);
  const major = (Number(amountCents) || 0) / mu;
  const cur = String(currency || "IDR").toUpperCase();
  if (ZERO_DECIMAL.has(cur)) {
    return major.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return major.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Same as above but prefixes the currency code (e.g., "IDR 1,500,000").
 */
function formatAmountWithCode(amountCents: number, currency?: string): string {
  const cur = String(currency || "IDR").toUpperCase();
  return `${cur} ${formatAmountNumber(amountCents, cur)}`;
}

/**
 * Attach common helpers and JSON response helpers to Express.
 * Call this once in your server bootstrap (e.g., in src/index.ts).
 */
export function applyExpressAugments(app: express.Express) {
  // Response helpers
  app.use((_, res, next) => {
    res.ok = (data?: unknown) => {
      res.status(200).json({ ok: true, data });
    };
    res.badRequest = (msg: string) => {
      res.status(400).json({ ok: false, error: msg || "Bad request" });
    };
    res.unauthorized = (msg?: string) => {
      res.status(401).json({ ok: false, error: msg || "Unauthorized" });
    };
    res.forbidden = (msg?: string) => {
      res.status(403).json({ ok: false, error: msg || "Forbidden" });
    };
    res.notFound = (msg?: string) => {
      res.status(404).json({ ok: false, error: msg || "Not found" });
    };
    next();
  });

  // Template helpers (available in all EJS as plain functions)
  app.use((_, res, next) => {
    // default currency for templates that only pass amountCents
    // (most of your views show currency in a separate column)
    const defaultCurrency = "IDR";

    // amount only (no currency code). Usage: <%= formatAmount(r.amountCents) %> or <%= formatAmount(r.amountCents, r.currency) %>
    res.locals.formatAmount = (amountCents: number, currency?: string) =>
      formatAmountNumber(amountCents, currency || defaultCurrency);

    // amount with code. Usage: <%= formatAmountWithCode(r.amountCents, r.currency) %>
    res.locals.formatAmountWithCode = (amountCents: number, currency?: string) =>
      formatAmountWithCode(amountCents, currency || defaultCurrency);

    // expose minor unit helper if needed in templates
    res.locals.minorUnit = (currency?: string) => getMinorUnit(currency || defaultCurrency);

    next();
  });
}

// Keep the old name for imports elsewhere
export const augmentExpress = applyExpressAugments;
