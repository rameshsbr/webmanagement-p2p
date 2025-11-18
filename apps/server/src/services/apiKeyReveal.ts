// apps/server/src/services/apiKeyReveal.ts
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import speakeasy from "speakeasy";
import { prisma } from "../lib/prisma.js";
import { open } from "./secretBox.js";
import { getApiKeyRevealConfig } from "../config/apiKeyReveal.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

export class ApiKeyRevealError extends Error {
  code: string;
  status: number;
  needsStepUp?: boolean;
  retryAt?: Date | null;

  constructor(code: string, status: number, message: string, opts?: { needsStepUp?: boolean; retryAt?: Date | null }) {
    super(message);
    this.code = code;
    this.status = status;
    this.needsStepUp = opts?.needsStepUp;
    this.retryAt = opts?.retryAt ?? null;
  }
}

type BaseActor = {
  ip?: string | null;
  userAgent?: string | null;
};

type MerchantActor = BaseActor & {
  kind: "merchant";
  merchantId: string;
  merchantUserId: string;
  password?: string;
  totp?: string;
  stepToken?: string;
};

type AdminActor = BaseActor & {
  kind: "admin";
  adminId: string;
  password?: string;
  totp?: string;
  stepToken?: string;
  reason?: string | null;
};

type RevealParams = (MerchantActor | AdminActor) & {
  keyId: string;
};

export type RevealResult = {
  keyId: string;
  merchantId: string;
  prefix: string;
  secret: string;
  stepToken: string;
  stepExpiresIn: number;
  previousSuccessAt: Date | null;
};

function verifyStepToken(token: string | undefined, scope: string, subject: string): boolean {
  if (!token) return false;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (!payload || typeof payload !== "object") return false;
    if (String(payload.scope || "") !== scope) return false;
    if (String(payload.sub || "") !== subject) return false;
    return true;
  } catch {
    return false;
  }
}

function mintStepToken(scope: string, subject: string, seconds: number): string {
  const ttl = Number.isFinite(seconds) && seconds > 0 ? seconds : 300;
  return jwt.sign({ scope, sub: subject }, JWT_SECRET, { expiresIn: `${Math.max(30, ttl)}s` });
}

async function logReveal(opts: {
  merchantApiKeyId: string;
  merchantId: string;
  actorType: "MERCHANT" | "ADMIN";
  merchantUserId?: string | null;
  adminUserId?: string | null;
  reason?: string | null;
  outcome: "SUCCESS" | "DENIED" | "RATE_LIMIT" | "ERROR" | "DISABLED";
  ip?: string | null;
  userAgent?: string | null;
}) {
  try {
    await prisma.merchantApiKeyRevealLog.create({
      data: {
        merchantApiKeyId: opts.merchantApiKeyId,
        merchantId: opts.merchantId,
        actorType: opts.actorType,
        merchantUserId: opts.merchantUserId ?? null,
        adminUserId: opts.adminUserId ?? null,
        reason: opts.reason ?? null,
        outcome: opts.outcome,
        ip: opts.ip ?? null,
        userAgent: opts.userAgent ?? null,
      },
    });
  } catch {
    // Never throw if logging fails
  }
}

async function notifyReveal(merchantId: string, prefix: string, actor: "MERCHANT" | "ADMIN") {
  const config = getApiKeyRevealConfig();
  if (!config.sendEmail) return;

  try {
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { email: true, name: true },
    });

    const owners = await prisma.merchantUser.findMany({
      where: { merchantId, role: "OWNER", active: true },
      select: { email: true },
    });

    const recipients = new Set<string>();
    for (const owner of owners) {
      if (owner.email) recipients.add(owner.email);
    }
    if (merchant?.email) recipients.add(merchant.email);

    if (!recipients.size) return;

    const subject = `API key revealed for ${merchant?.name ?? merchantId}`;
    const line = actor === "ADMIN"
      ? "A platform administrator revealed one of your API keys."
      : "A user on your merchant account revealed one of your API keys.";

    const body = [
      line,
      `Key prefix: ${prefix}`,
      "No secret values are included in this email.",
      "If this was unexpected, rotate or revoke the key immediately.",
    ].join("\n");

    // No SMTP integration yet; log for observability.
    console.info("[SECURITY] notify merchant about API key reveal", {
      recipients: Array.from(recipients),
      subject,
      summary: body,
    });
  } catch (err) {
    console.warn("[SECURITY] failed to queue reveal notification", err);
  }
}

export async function revealApiKey(params: RevealParams): Promise<RevealResult> {
  const config = getApiKeyRevealConfig();
  if (!config.allow) {
    throw new ApiKeyRevealError("disabled", 403, "API key reveal is disabled by policy.");
  }

  if (!params.keyId) {
    throw new ApiKeyRevealError("bad_request", 400, "Missing API key identifier.");
  }

  if (params.kind === "merchant") {
    if (!params.merchantId || !params.merchantUserId) {
      throw new ApiKeyRevealError("forbidden", 403, "Not authorized to reveal this API key.");
    }
  } else if (!params.adminId) {
    throw new ApiKeyRevealError("forbidden", 403, "Not authorized to reveal this API key.");
  }

  const key = await prisma.merchantApiKey.findUnique({
    where: { id: params.keyId },
    select: {
      id: true,
      merchantId: true,
      active: true,
      expiresAt: true,
      prefix: true,
      secretEnc: true,
    },
  });

  if (!key) {
    throw new ApiKeyRevealError("not_found", 404, "API key not found.");
  }

  if (params.kind === "merchant" && key.merchantId !== params.merchantId) {
    throw new ApiKeyRevealError("forbidden", 403, "Not authorized to reveal this API key.");
  }

  if (!key.active || (key.expiresAt && key.expiresAt < new Date())) {
    if (params.kind === "admin" && config.adminCanRevealRevoked) {
      // allow
    } else {
      throw new ApiKeyRevealError("inactive", 400, "API key is inactive or expired.");
    }
  }

  const scope = params.kind === "merchant" ? "merchant-key-reveal" : "admin-key-reveal";
  const subject = params.kind === "merchant" ? params.merchantUserId : params.adminId;
  let hasFreshStep = verifyStepToken(params.stepToken, scope, subject);

  if (params.kind === "merchant") {
    const user = await prisma.merchantUser.findUnique({
      where: { id: params.merchantUserId },
      select: {
        id: true,
        merchantId: true,
        passwordHash: true,
        twoFactorEnabled: true,
        totpSecret: true,
        canRevealApiKeys: true,
      },
    });

    if (!user || user.merchantId !== key.merchantId) {
      throw new ApiKeyRevealError("forbidden", 403, "Not authorized to reveal this API key.");
    }

    if (!user.canRevealApiKeys) {
      throw new ApiKeyRevealError("forbidden", 403, "You do not have permission to reveal API keys.");
    }

    if (!hasFreshStep) {
      if (user.twoFactorEnabled && user.totpSecret) {
        const code = String(params.totp ?? "").replace(/\s+/g, "");
        if (!code) {
          throw new ApiKeyRevealError("mfa_required", 401, "Authentication code required.", { needsStepUp: true });
        }
        const ok = speakeasy.totp.verify({ secret: user.totpSecret, encoding: "base32", token: code, window: 1 });
        if (!ok) {
          await logReveal({
            merchantApiKeyId: key.id,
            merchantId: key.merchantId,
            actorType: "MERCHANT",
            merchantUserId: user.id,
            outcome: "DENIED",
            ip: params.ip,
            userAgent: params.userAgent,
          });
          throw new ApiKeyRevealError("invalid_mfa", 401, "Invalid authentication code.", { needsStepUp: true });
        }
      } else {
        const password = String(params.password ?? "");
        if (!password) {
          throw new ApiKeyRevealError("password_required", 401, "Password required to reveal API key.", { needsStepUp: true });
        }
        const ok = await bcrypt.compare(password, user.passwordHash || "");
        if (!ok) {
          await logReveal({
            merchantApiKeyId: key.id,
            merchantId: key.merchantId,
            actorType: "MERCHANT",
            merchantUserId: user.id,
            outcome: "DENIED",
            ip: params.ip,
            userAgent: params.userAgent,
          });
          throw new ApiKeyRevealError("invalid_password", 401, "Incorrect password.", { needsStepUp: true });
        }
      }
      hasFreshStep = true;
    }
  } else {
    const admin = await prisma.adminUser.findUnique({
      where: { id: params.adminId },
      select: {
        id: true,
        role: true,
        passwordHash: true,
        superTwoFactorEnabled: true,
        superTotpSecret: true,
        canRevealMerchantApiKeys: true,
      },
    });

    const adminRole = String(admin?.role || "").toUpperCase();
    const adminIsSuper = adminRole === "SUPER";

    if (!adminIsSuper && !admin?.canRevealMerchantApiKeys) {
      throw new ApiKeyRevealError("forbidden", 403, "You do not have permission to reveal merchant API keys.");
    }

    if (!hasFreshStep) {
      if (admin.superTwoFactorEnabled && admin.superTotpSecret) {
        const code = String(params.totp ?? "").replace(/\s+/g, "");
        if (!code) {
          throw new ApiKeyRevealError("mfa_required", 401, "Authentication code required.", { needsStepUp: true });
        }
        const ok = speakeasy.totp.verify({ secret: admin.superTotpSecret, encoding: "base32", token: code, window: 1 });
        if (!ok) {
          await logReveal({
            merchantApiKeyId: key.id,
            merchantId: key.merchantId,
            actorType: "ADMIN",
            adminUserId: admin.id,
            reason: params.reason ?? null,
            outcome: "DENIED",
            ip: params.ip,
            userAgent: params.userAgent,
          });
          throw new ApiKeyRevealError("invalid_mfa", 401, "Invalid authentication code.", { needsStepUp: true });
        }
      } else {
        const password = String(params.password ?? "");
        if (!password) {
          throw new ApiKeyRevealError("password_required", 401, "Password required to reveal API key.", { needsStepUp: true });
        }
        const ok = await bcrypt.compare(password, admin.passwordHash || "");
        if (!ok) {
          await logReveal({
            merchantApiKeyId: key.id,
            merchantId: key.merchantId,
            actorType: "ADMIN",
            adminUserId: admin.id,
            reason: params.reason ?? null,
            outcome: "DENIED",
            ip: params.ip,
            userAgent: params.userAgent,
          });
          throw new ApiKeyRevealError("invalid_password", 401, "Incorrect password.", { needsStepUp: true });
        }
      }
      hasFreshStep = true;
    }
  }

  const since = new Date(Date.now() - config.windowMs);
  const rateWhere: any = {
    merchantApiKeyId: key.id,
    outcome: "SUCCESS",
    createdAt: { gte: since },
  };
  if (params.kind === "merchant") rateWhere.merchantUserId = params.merchantUserId;
  else rateWhere.adminUserId = params.adminId;

  const recentCount = await prisma.merchantApiKeyRevealLog.count({ where: rateWhere });
  if (recentCount >= config.perKeyPerDay) {
    const earliest = await prisma.merchantApiKeyRevealLog.findFirst({
      where: rateWhere,
      orderBy: { createdAt: "asc" },
    });
    await logReveal({
      merchantApiKeyId: key.id,
      merchantId: key.merchantId,
      actorType: params.kind === "merchant" ? "MERCHANT" : "ADMIN",
      merchantUserId: params.kind === "merchant" ? params.merchantUserId : null,
      adminUserId: params.kind === "admin" ? params.adminId : null,
      reason: params.kind === "admin" ? params.reason ?? null : null,
      outcome: "RATE_LIMIT",
      ip: params.ip,
      userAgent: params.userAgent,
    });
    const retryAt = earliest ? new Date(earliest.createdAt.getTime() + config.windowMs) : new Date(Date.now() + config.windowMs);
    throw new ApiKeyRevealError("rate_limited", 429, "Too many reveal attempts. Try again later.", { retryAt });
  }

  if (!hasFreshStep) {
    throw new ApiKeyRevealError("step_required", 401, "Additional verification required.", { needsStepUp: true });
  }

  const previous = await prisma.merchantApiKeyRevealLog.findFirst({
    where: {
      merchantApiKeyId: key.id,
      outcome: "SUCCESS",
      ...(params.kind === "merchant"
        ? { merchantUserId: params.merchantUserId }
        : { adminUserId: params.adminId }),
    },
    orderBy: { createdAt: "desc" },
  });

  const secret = open(key.secretEnc);
  const full = `${key.prefix}.${secret}`;
  const stepToken = mintStepToken(scope, subject, config.freshnessSeconds);

  await logReveal({
    merchantApiKeyId: key.id,
    merchantId: key.merchantId,
    actorType: params.kind === "merchant" ? "MERCHANT" : "ADMIN",
    merchantUserId: params.kind === "merchant" ? params.merchantUserId : null,
    adminUserId: params.kind === "admin" ? params.adminId : null,
    reason: params.kind === "admin" ? params.reason ?? null : null,
    outcome: "SUCCESS",
    ip: params.ip,
    userAgent: params.userAgent,
  });

  notifyReveal(key.merchantId, key.prefix, params.kind === "merchant" ? "MERCHANT" : "ADMIN").catch(() => undefined);

  return {
    keyId: key.id,
    merchantId: key.merchantId,
    prefix: key.prefix,
    secret: full,
    stepToken,
    stepExpiresIn: config.freshnessSeconds,
    previousSuccessAt: previous?.createdAt ?? null,
  };
}
