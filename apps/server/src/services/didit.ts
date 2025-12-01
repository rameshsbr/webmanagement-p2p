// apps/server/src/services/didit.ts
import { upsertMerchantClientMapping } from "./merchantClient.js";
import { generateUserId } from "./reference.js";

// apps/server/src/services/didit.ts
// Integration for Didit Low-Code + profile helpers.
//
// Env used:
//   DIDIT_API_BASE        (default https://api.didit.me)
//   DIDIT_APP_ID
//   DIDIT_WORKFLOW_ID
//   DIDIT_REDIRECT_URL
//   DIDIT_API_KEY         (for v2 /session and optionally profile)
//   DIDIT_CLIENT_ID       (for OAuth client credentials; recommended for profile/v1 APIs)
//   DIDIT_CLIENT_SECRET
//   DIDIT_AUTH_URL        (e.g. https://auth.didit.me/oauth/token or similar)
//   DIDIT_AUDIENCE        (optional; if Didit requires audience)
//   DIDIT_DEBUG           ("1" to log extra info)
//
// Additional (v2 Verification Links):
//   DIDIT_VERIFICATION_BASE (default https://verification.didit.me)
//   DIDIT_CALLBACK_URL      (optional; webhook for v2)
//   DIDIT_USE_V1            ("1" to force legacy v1 even if API key exists)
//
// NOTE: Low-code v2 uses x-api-key. Management/profile APIs usually use Bearer tokens.

const DIDIT_DEBUG = String(process.env.DIDIT_DEBUG || "") === "1";

function logDebug(...args: any[]) {
  if (DIDIT_DEBUG) console.log("[didit]", ...args);
}

// ───────────────────────────────────────────────────────────────
// Lazy prisma import so shell probes don't explode
// ───────────────────────────────────────────────────────────────
let prismaSingleton: any | null = null;
async function prisma() {
  if (!prismaSingleton) {
    const mod = await import("../lib/prisma.js");
    prismaSingleton = (mod as any).prisma;
  }
  return prismaSingleton;
}

async function getMerchantWorkflowId(merchantId?: string | null): Promise<string | null> {
  if (!merchantId) return null;
  const p = await prisma();
  const merchant = await p.merchant.findUnique({
    where: { id: merchantId },
    select: { diditWorkflowId: true },
  });
  return merchant?.diditWorkflowId || null;
}

/**
 * Legacy local stub (kept for dev). Returns a fake URL that renders your local
 * fake KYC page. Not used when Low-Code is configured.
 */
export async function startDiditSession(diditSubjectHint?: string) {
  const sessionId = "didit_" + Math.random().toString(36).slice(2);
  const url = `${process.env.BASE_URL}/public/fake-didit?session=${sessionId}&subj=${encodeURIComponent(
    diditSubjectHint ?? ""
  )}`;
  return { sessionId, url };
}

export type DiditProfile = {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  documentIssuingState?: string | null;
  documentIssuingCountry?: string | null;
  dateOfBirth?: string | Date | null;
  documentExpiry?: string | Date | null;
  gender?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string | null;
};

/**
 * Legacy webhook handler (kept for dev). Marks user verified/rejected and records KYC row.
 *
 * ⚠️ Extended: can now accept profile data (fullName/email/phone) and store it
 * into the user record when KYC is approved.
 */
export async function handleDiditWebhook(
  sessionId: string,
  diditSubject: string,
  status: "approved" | "rejected",
  merchantId?: string | null,
  externalId?: string | null,
  email?: string | null,
  profile?: DiditProfile | null
) {
  const p = await prisma();

  let user = await p.user.findUnique({ where: { diditSubject } });
  const now = new Date();

  const incomingFullName = profile?.fullName?.trim?.() || null;
  const incomingFirstName = profile?.firstName?.trim?.() || null;
  const incomingLastName = profile?.lastName?.trim?.() || null;
  const incomingDocumentType = profile?.documentType ?? null;
  const incomingDocumentNumber = profile?.documentNumber ?? null;
  const incomingDocumentIssuingState = profile?.documentIssuingState ?? null;
  const incomingDocumentIssuingCountry = profile?.documentIssuingCountry ?? null;
  const incomingGender = profile?.gender ?? null;
  const incomingAddress = profile?.address ?? null;

  const parseDate = (value: string | Date | null | undefined): Date | null => {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const incomingDateOfBirth = parseDate(profile?.dateOfBirth);
  const incomingDocumentExpiry = parseDate(profile?.documentExpiry);

  const incomingEmail = (profile?.email || email)?.trim?.() || null;
  const incomingPhone = profile?.phone?.trim?.() || null;

  if (!user) {
    // New user: we can set fullName/email/phone directly
    user = await p.user.create({
      data: {
        publicId: generateUserId(),
        diditSubject,
        verifiedAt: status === "approved" ? now : null,
        fullName: incomingFullName || null,
        firstName: incomingFirstName || null,
        lastName: incomingLastName || null,
        documentType: incomingDocumentType || null,
        documentNumber: incomingDocumentNumber || null,
        documentIssuingState: incomingDocumentIssuingState || null,
        documentIssuingCountry: incomingDocumentIssuingCountry || null,
        dateOfBirth: incomingDateOfBirth || null,
        documentExpiry: incomingDocumentExpiry || null,
        gender: incomingGender || null,
        address: incomingAddress || null,
        email: incomingEmail || null,
        phone: incomingPhone || null,
      },
    });
  } else {
    const data: any = {};

    if (status === "approved" && !user.verifiedAt) {
      data.verifiedAt = now;
    }

    data.fullName = incomingFullName ?? undefined;
    data.firstName = incomingFirstName ?? undefined;
    data.lastName = incomingLastName ?? undefined;
    data.documentType = incomingDocumentType ?? undefined;
    data.documentNumber = incomingDocumentNumber ?? undefined;
    data.documentIssuingState = incomingDocumentIssuingState ?? undefined;
    data.documentIssuingCountry = incomingDocumentIssuingCountry ?? undefined;
    data.dateOfBirth = incomingDateOfBirth ?? undefined;
    data.documentExpiry = incomingDocumentExpiry ?? undefined;
    data.gender = incomingGender ?? undefined;
    data.address = incomingAddress ?? undefined;
    data.email = incomingEmail ?? undefined;
    data.phone = incomingPhone ?? undefined;

    Object.keys(data).forEach((key) => {
      if (typeof data[key] === "undefined") delete data[key];
    });

    if (Object.keys(data).length) {
      user = await p.user.update({
        where: { id: user.id },
        data,
      });
    }
  }

  await p.kycVerification.upsert({
    where: { externalSessionId: sessionId },
    create: {
      externalSessionId: sessionId,
      provider: "didit",
      status,
      userId: user.id,
    },
    update: { status, userId: user.id },
  });

  if (merchantId) {
    await upsertMerchantClientMapping({
      merchantId,
      userId: user.id,
      externalId,
      email: incomingEmail || email || null,
    });
  }

  return user;
}

// ───────────────────────────────────────────────────────────────
// PROFILE FETCH (kept as-is, subject-based; you can keep or delete
// if you no longer use it in your UI)
// ───────────────────────────────────────────────────────────────
export async function fetchDiditProfile(_subjectOrSession: string): Promise<DiditProfile | null> {
  // If you still want to use the remote decision/profile API, you can implement it here.
  // For now we just no-op so you stop getting 404s from calling it with diditSubject.
  // (All important data is coming via webhooks instead.)
  return null;
}

// ───────────────────────────────────────────────────────────────
// OAuth helper: fetch access token (Client Credentials)
// ───────────────────────────────────────────────────────────────
async function getDiditAccessToken(): Promise<string | null> {
  // Explicit override (useful for experiments)
  if (process.env.DIDIT_ACCESS_TOKEN) {
    logDebug("Using DIDIT_ACCESS_TOKEN from env");
    return process.env.DIDIT_ACCESS_TOKEN;
  }

  const clientId = process.env.DIDIT_CLIENT_ID;
  const clientSecret = process.env.DIDIT_CLIENT_SECRET;

  // If client creds are present, do a proper OAuth client_credentials flow
  if (clientId && clientSecret) {
    const apiBase = (process.env.DIDIT_API_BASE || "https://api.didit.me").replace(/\/+$/, "");
    const candidates = [
      process.env.DIDIT_AUTH_URL, // preferred if you set it
      "https://auth.didit.me/oauth/token", // common pattern
      `${apiBase}/oauth/token`, // fallback guess
    ].filter(Boolean) as string[];

    const audience = process.env.DIDIT_AUDIENCE || undefined;

    for (const url of candidates) {
      try {
        logDebug("Token attempt:", url);
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
            ...(audience ? { audience } : {}),
          }),
        });
        const txt = await res.text();
        if (!res.ok) {
          logDebug("Token response", res.status, txt);
          continue; // try next candidate
        }
        const json = JSON.parse(txt);
        const token = json.access_token || json.token || null;
        if (token) return token;
      } catch (e) {
        logDebug("Token error", (e as any)?.message || e);
      }
    }

    // If we tried all candidates and failed:
    return null;
  }

  // No client creds – do NOT treat API key as OAuth token here.
  // API key is handled separately (x-api-key / Bearer) by callers.
  if (process.env.DIDIT_API_KEY) {
    logDebug("DIDIT_API_KEY present (used directly by callers, not as OAuth token)");
  }

  return null;
}

// ───────────────────────────────────────────────────────────────
// v2 Verification Links helpers (preferred if DIDIT_API_KEY is present)
// ───────────────────────────────────────────────────────────────
type CreateLinkInput = {
  subject: string;
  merchantId?: string | null;
  externalId?: string | null;
  email?: string | null;

  // Optional override, mostly for tests or special cases
  workflowIdOverride?: string | null;
};
type CreateLinkOutput = { url: string; sessionId: string };

type DiditMeta = {
  subject: string;
  merchantId: string;
  externalId?: string | null;
  email?: string | null;
};

function buildVendorData(meta: DiditMeta) {
  return `${meta.merchantId}|${meta.subject}`;
}

function buildCallbackUrl(meta: DiditMeta) {
  const base =
    process.env.DIDIT_CALLBACK_URL ||
    `${process.env.PUBLIC_URL || "http://localhost:4000"}/webhooks/didit`;
  const qp = new URLSearchParams({
    merchantId: meta.merchantId,
    diditSubject: meta.subject,
  });
  return `${base}?${qp.toString()}`;
}

async function createLinkV2(input: CreateLinkInput): Promise<{ url: string; sessionId: string }> {
  const apiKey = process.env.DIDIT_API_KEY;
  const base = (process.env.DIDIT_VERIFICATION_BASE || "https://verification.didit.me").replace(
    /\/+$/,
    ""
  );

  if (!apiKey) throw new Error("DIDIT_API_KEY missing");

  // 1) Try explicit override
  let workflowId = input.workflowIdOverride || null;

  // 2) If not provided, try merchant-specific setting
  if (!workflowId && input.merchantId) {
    workflowId = await getMerchantWorkflowId(input.merchantId);
  }

  // 3) Fallback to env (for old merchants)
  if (!workflowId) {
    workflowId = process.env.DIDIT_WORKFLOW_ID || null;
  }

  if (!workflowId) {
    throw new Error("Didit workflow ID missing (no merchant.diditWorkflowId and no DIDIT_WORKFLOW_ID env)");
  }

  const body: any = {
    workflow_id: workflowId,
    vendor_data: buildVendorData({
      merchantId: input.merchantId || "",
      subject: input.subject,
      externalId: input.externalId,
      email: input.email,
    }),
    callback: buildCallbackUrl({
      merchantId: input.merchantId || "",
      subject: input.subject,
      externalId: input.externalId,
      email: input.email,
    }),
  };

  const url = `${base}/v2/session/`;
  logDebug("createLinkV2 →", url, body);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  logDebug("createLinkV2 status", res.status, raw);

  if (!res.ok) {
    throw new Error(`Didit create link (v2) failed: ${res.status} ${raw}`);
  }

  const json: any = JSON.parse(raw);
  const sessionId = json?.session_id || json?.id || json?.sessionId;
  const link = json?.url || json?.verification_url || json?.link;

  if (!sessionId || !link) {
    throw new Error("Didit v2 create link: unexpected response shape");
  }
  return { url: String(link), sessionId: String(sessionId) };
}

async function getStatusV2(sessionId: string): Promise<"pending" | "approved" | "rejected"> {
  const apiKey = process.env.DIDIT_API_KEY;
  const base = (process.env.DIDIT_VERIFICATION_BASE || "https://verification.didit.me").replace(
    /\/+$/,
    ""
  );
  if (!apiKey) throw new Error("DIDIT_API_KEY missing");

  const url = `${base}/v2/session/${encodeURIComponent(sessionId)}/`;
  logDebug("getStatusV2 →", url);

  const res = await fetch(url, { headers: { "x-api-key": apiKey } });
  const raw = await res.text();
  logDebug("getStatusV2 status", res.status, raw);
  if (!res.ok) throw new Error(`Didit v2 status failed: ${res.status} ${raw}`);

  const json: any = JSON.parse(raw);
  const st = String(json?.status || "").toLowerCase();
  if (st.includes("approve") || st.includes("complete")) return "approved";
  if (st.includes("reject") || st.includes("fail")) return "rejected";
  return "pending";
}

// ───────────────────────────────────────────────────────────────
// v1 Low-Code helpers (OAuth/Bearer)
// ───────────────────────────────────────────────────────────────

async function createLinkV1(input: CreateLinkInput): Promise<CreateLinkOutput> {
  const base = (process.env.DIDIT_API_BASE || "https://api.didit.me").replace(/\/+$/, "");
  const appId = process.env.DIDIT_APP_ID;
  let workflowId = input.workflowIdOverride || null;

  if (!workflowId && input.merchantId) {
    workflowId = await getMerchantWorkflowId(input.merchantId);
  }

  if (!workflowId) {
    workflowId = process.env.DIDIT_WORKFLOW_ID || null;
  }

  if (!appId) throw new Error("DIDIT_APP_ID missing");
  if (!workflowId) {
    throw new Error("Didit workflow ID missing (no merchant.diditWorkflowId and no DIDIT_WORKFLOW_ID env)");
  }

  const token = await getDiditAccessToken();
  if (!token) {
    throw new Error(
      "Didit auth not configured. Set DIDIT_CLIENT_ID/DIDIT_CLIENT_SECRET (+DIDIT_AUTH_URL) for v1 endpoints."
    );
  }

  const body = {
    subject: input.subject,
    vendor_data: buildVendorData({
      merchantId: input.merchantId || "",
      subject: input.subject,
      externalId: input.externalId,
      email: input.email,
    }),
    callback: buildCallbackUrl({
      merchantId: input.merchantId || "",
      subject: input.subject,
      externalId: input.externalId,
      email: input.email,
    }),
    appId,
    workflowId,
    redirectUrl:
      process.env.DIDIT_REDIRECT_URL ||
      `${process.env.BASE_URL || "http://localhost:4000"}/public/kyc/done`,
  };

  logDebug("createLinkV1 body", body);

  const res = await fetch(`${base}/v1/verification-links`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  logDebug("createLinkV1 status", res.status, raw);

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Didit auth failed (${res.status}). Ensure OAuth client creds are correct. Response: ${raw}`
      );
    }
    throw new Error(`Didit create link failed: ${res.status} ${raw}`);
  }

  const json: any = JSON.parse(raw);
  const url = json?.url || json?.link?.url;
  const sessionId = json?.id || json?.sessionId || json?.link?.id;
  if (!url || !sessionId) {
    throw new Error("Didit create link: unexpected response shape");
  }
  return { url, sessionId };
}

async function getStatusV1(sessionId: string): Promise<"pending" | "approved" | "rejected"> {
  const base = (process.env.DIDIT_API_BASE || "https://api.didit.me").replace(/\/+$/, "");
  const token = await getDiditAccessToken();
  if (!token) throw new Error("Didit auth not configured");

  const res = await fetch(`${base}/v1/verifications/${encodeURIComponent(sessionId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  const raw = await res.text();
  logDebug("getStatusV1 status", res.status, raw);

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Didit status auth failed (${res.status}). Response: ${raw}`);
    }
    throw new Error(`Didit status failed: ${res.status} ${raw}`);
  }

  const json: any = JSON.parse(raw);
  const st = String(json?.status || "").toLowerCase();
  if (st.includes("approve")) return "approved";
  if (st.includes("reject")) return "rejected";
  return "pending";
}

// ───────────────────────────────────────────────────────────────
// Public API — chooses v2 when possible
// ───────────────────────────────────────────────────────────────

export async function createLowCodeLink(input: CreateLinkInput): Promise<CreateLinkOutput> {
  const preferV2 = !!process.env.DIDIT_API_KEY && String(process.env.DIDIT_USE_V1 || "") !== "1";
  if (preferV2) {
    try {
      return await createLinkV2(input);
    } catch (e) {
      logDebug("v2 create failed, falling back to v1:", (e as any)?.message || e);
      // fall through to v1
    }
  }
  return await createLinkV1(input);
}

export async function getVerificationStatus(
  sessionId: string
): Promise<"pending" | "approved" | "rejected"> {
  const preferV2 = !!process.env.DIDIT_API_KEY && String(process.env.DIDIT_USE_V1 || "") !== "1";
  if (preferV2) {
    try {
      return await getStatusV2(sessionId);
    } catch (e) {
      logDebug("v2 status failed, trying v1:", (e as any)?.message || e);
      // fall through
    }
  }
  return await getStatusV1(sessionId);
}