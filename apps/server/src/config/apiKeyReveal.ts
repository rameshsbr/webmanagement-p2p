// apps/server/src/config/apiKeyReveal.ts
export type ApiKeyRevealConfig = {
  allow: boolean;
  perKeyPerDay: number;
  windowMs: number;
  freshnessSeconds: number;
  adminCanRevealRevoked: boolean;
  sendEmail: boolean;
  autoHideSeconds: number;
};

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const cached: ApiKeyRevealConfig = {
  allow: (process.env.ALLOW_API_KEY_REVEAL ?? "true").toLowerCase() !== "false",
  perKeyPerDay: intEnv("REVEAL_RATE_LIMIT_PER_KEY_PER_DAY", 3),
  windowMs: 24 * 60 * 60 * 1000,
  freshnessSeconds: intEnv("REVEAL_SESSION_FRESHNESS_SECONDS", 300),
  adminCanRevealRevoked: (process.env.ADMIN_CAN_REVEAL_REVOKED_KEYS ?? "false").toLowerCase() === "true",
  sendEmail: (process.env.SEND_REVEAL_ALERT_EMAIL ?? "true").toLowerCase() !== "false",
  autoHideSeconds: intEnv("REVEAL_AUTO_HIDE_SECONDS", 60),
};

export function getApiKeyRevealConfig(): ApiKeyRevealConfig {
  return cached;
}
