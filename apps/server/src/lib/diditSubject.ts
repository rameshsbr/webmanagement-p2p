import crypto from "node:crypto";

export function deriveDiditSubject(merchantId: string, externalId: string) {
  const base = `m:${merchantId}:u:${String(externalId || "").trim().toLowerCase()}`;
  const h = crypto.createHash("sha256").update(base).digest("base64url").slice(0, 32);
  return `m:${merchantId}:${h}`;
}
