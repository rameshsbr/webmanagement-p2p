// apps/server/src/services/checkoutToken.ts
import { seal, open } from "./secretBox.js";
import type { ClientStatus } from "./merchantClient.js";

export type CheckoutClaims = {
  merchantId: string;
  diditSubject: string;
  externalId?: string | null;
  email?: string | null;
  currency: string; // e.g. "AUD"
  availableBalanceCents?: number; // optional hint for withdrawal UX
  clientStatus?: ClientStatus;
  iat: number; // unix seconds
  exp: number; // unix seconds
};

export function signCheckoutToken(input: Omit<CheckoutClaims, "iat" | "exp">, ttlSeconds = 15 * 60): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: CheckoutClaims = {
    ...input,
    iat: now,
    exp: now + ttlSeconds,
  };
  return seal(JSON.stringify(payload));
}

export function verifyCheckoutToken(token: string): CheckoutClaims | null {
  try {
    const raw = open(token);
    const claims = JSON.parse(raw) as CheckoutClaims;
    const now = Math.floor(Date.now() / 1000);
    if (!claims?.merchantId || !claims?.diditSubject || !claims?.currency) return null;
    if (typeof claims.exp !== "number" || claims.exp < now) return null;
    if (typeof claims.iat !== "number" || claims.iat > now + 60) return null; // iat in the future? nope
    return claims;
  } catch {
    return null;
  }
}