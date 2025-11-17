import { generateUserId } from "./reference.js";
import { upsertMerchantClientMapping } from "./merchantClient.js";

// apps/server/src/services/didit.ts
// Placeholder integration for Didit + real Low-Code API helpers.
// Uses env:
//   DIDIT_API_BASE (default https://api.didit.me)
//   DIDIT_APP_ID
//   DIDIT_WORKFLOW_ID
//   DIDIT_REDIRECT_URL
//   DIDIT_API_KEY                (optional; may not work for Low-Code endpoints)
//   DIDIT_CLIENT_ID              (recommended; OAuth client credentials)
//   DIDIT_CLIENT_SECRET          (recommended; OAuth client credentials)
//   DIDIT_AUTH_URL               (recommended; e.g. https://auth.didit.me/oauth/token)
//   DIDIT_AUDIENCE               (optional; if Didit requires an 'audience' for the token)
//   DIDIT_DEBUG                  (optional; set to "1" to log auth/link details)
//
// Additional (for v2 Verification Links):
//   DIDIT_VERIFICATION_BASE      (default https://verification.didit.me)
//   DIDIT_CALLBACK_URL           (optional; webhook for v2)
//   DIDIT_USE_V1                 ("1" to force legacy v1 flow even if API key exists)

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

/**
 * Legacy webhook handler (kept for dev). Marks user verified/rejected and records KYC row.
 */
export async function handleDiditWebhook(
  sessionId: string,
  diditSubject: string,
  status: "approved" | "rejected",
  metadata?: { merchantId?: string | null; externalId?: string | null; email?: string | null }
) {
  const p = await prisma();
  let user = await p.user.findUnique({ where: { diditSubject } });
  if (!user) {
    user = await p.user.create({
      data: { publicId: generateUserId(), diditSubject, verifiedAt: status === "approved" ? new Date() : null },
    });
  } else if (status === "approved" && !user.verifiedAt) {
    await p.user.update({ where: { id: user.id }, data: { verifiedAt: new Date() } });
  }
  if (metadata?.merchantId) {
    await upsertMerchantClientMapping({
      merchantId: metadata.merchantId,
      userId: user.id,
      diditSubject,
      externalId: metadata.externalId,
      email: metadata.email,
    });
  }
  await p.kycVerification.upsert({
    where: { externalSessionId: sessionId },
    create: { externalSessionId: sessionId, provider: "didit", status, userId: user.id },
    update: { status, userId: user.id },
  });
  return user;
}

export type DiditProfile = {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string | null;
};

export async function fetchDiditProfile(subject: string): Promise<DiditProfile | null> {
  if (!subject) return null;
  const token = await getDiditAccessToken();
  if (!token) return null;

  const base = (process.env.DIDIT_API_BASE || "https://api.didit.me").replace(/\/+$/, "");
  const url = `${base}/users/${encodeURIComponent(subject)}`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    return {
      fullName: json?.name || json?.full_name || json?.fullName || null,
      email: json?.email || null,
      phone: json?.phone || json?.phone_number || null,
      status: json?.status || null,
    };
  } catch {
    return null;
  }
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
      process.env.DIDIT_AUTH_URL,                 // preferred if you set it
      "https://auth.didit.me/oauth/token",        // common pattern
      `${apiBase}/oauth/token`,                   // fallback guess
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

  // No client creds—try the old API key as bearer (may not work for Low-Code)
  if (process.env.DIDIT_API_KEY) {
    logDebug("Falling back to DIDIT_API_KEY as bearer");
    return process.env.DIDIT_API_KEY;
  }

  return null;
}

// ───────────────────────────────────────────────────────────────
// v2 Verification Links helpers (preferred if DIDIT_API_KEY is present)
// ───────────────────────────────────────────────────────────────
async function createLinkV2(input: CreateLinkInput): Promise<{ url: string; sessionId: string }> {
  const apiKey = process.env.DIDIT_API_KEY;
  const base = (process.env.DIDIT_VERIFICATION_BASE || "https://verification.didit.me").replace(/\/+$/, "");
  const workflowId = process.env.DIDIT_WORKFLOW_ID;

  if (!apiKey) throw new Error("DIDIT_API_KEY missing");
  if (!workflowId) throw new Error("DIDIT_WORKFLOW_ID missing");

  const body: any = {
    workflow_id: workflowId,
    vendor_data: buildVendorData(input),
    callback: process.env.DIDIT_CALLBACK_URL || buildCallbackUrl(input),
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

  if (!sessionId || !link) throw new Error("Didit v2 create link: unexpected response shape");
  return { url: String(link), sessionId: String(sessionId) };
}

async function getStatusV2(sessionId: string): Promise<"pending" | "approved" | "rejected"> {
  const apiKey = process.env.DIDIT_API_KEY;
  const base = (process.env.DIDIT_VERIFICATION_BASE || "https://verification.didit.me").replace(/\/+$/, "");
  if (!apiKey) throw new Error("DIDIT_API_KEY missing");

  // API works both with and without the trailing slash; include it to match docs
  const url = `${base}/v2/session/${encodeURIComponent(sessionId)}/`;
  logDebug("getStatusV2 →", url);

  const res = await fetch(url, { headers: { "x-api-key": apiKey } });
  const raw = await res.text();
  logDebug("getStatusV2 status", res.status, raw);
  if (!res.ok) throw new Error(`Didit v2 status failed: ${res.status} ${raw}`);

  const json: any = JSON.parse(raw);
  const st = String(json?.status || "").toLowerCase();
  // Didit returns e.g. "Not Started", "In Progress", "Approved", "Rejected", "Completed"
  if (st.includes("approve") || st.includes("complete")) return "approved";
  if (st.includes("reject") || st.includes("fail")) return "rejected";
  return "pending";
}

// ───────────────────────────────────────────────────────────────
// Real Didit Low-Code API helpers (legacy v1 via OAuth/Bearer)
// ───────────────────────────────────────────────────────────────
type CreateLinkInput = { subject: string; merchantId?: string | null };
type CreateLinkOutput = { url: string; sessionId: string };

function buildVendorData(input: CreateLinkInput) {
  return input.merchantId ? `${input.merchantId}|${input.subject}` : input.subject;
}

function buildCallbackUrl(input: CreateLinkInput) {
  const base = (process.env.BASE_URL || "http://localhost:4000").replace(/\/+$/, "");
  const qp = new URLSearchParams();
  qp.set("diditSubject", input.subject);
  if (input.merchantId) qp.set("merchantId", input.merchantId);
  return `${base}/webhooks/didit?${qp.toString()}`;
}

/**
 * Create a Didit Low-Code verification link (v1 OAuth).
 * Prefers OAuth access token; falls back to raw API key if present.
 * Requires DIDIT_APP_ID + DIDIT_WORKFLOW_ID.
 */
async function createLinkV1(input: CreateLinkInput): Promise<CreateLinkOutput> {
  const base = (process.env.DIDIT_API_BASE || "https://api.didit.me").replace(/\/+$/, "");
  const appId = process.env.DIDIT_APP_ID;
  const workflowId = process.env.DIDIT_WORKFLOW_ID;

  if (!appId) throw new Error("DIDIT_APP_ID missing");
  if (!workflowId) throw new Error("DIDIT_WORKFLOW_ID missing");

  const token = await getDiditAccessToken();
  if (!token) {
    throw new Error(
      "Didit auth not configured. Set DIDIT_CLIENT_ID/DIDIT_CLIENT_SECRET (+DIDIT_AUTH_URL) or DIDIT_API_KEY."
    );
  }

  const body = {
    subject: input.subject,
    vendor_data: buildVendorData(input.subject, input.merchantId),
    callback: buildCallbackUrl(input.subject, input.merchantId),
    appId,
    workflowId,
    vendor_data: buildVendorData(input),
    callback: process.env.DIDIT_CALLBACK_URL || buildCallbackUrl(input),
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
    // Be explicit on the common auth failure to save time
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

/**
 * Poll a verification by sessionId (v1 OAuth).
 */
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
// Public API (kept name/signature) — chooses v2 when possible
// ───────────────────────────────────────────────────────────────

/**
 * Create a Didit Low-Code verification link.
 * If DIDIT_API_KEY is present and DIDIT_USE_V1 !== "1", use v2 (/v2/session/, x-api-key).
 * Otherwise fall back to v1 (/v1/verification-links, Bearer/OAuth).
 */
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

/**
 * Poll a verification by sessionId.
 * Try v2 first if API key exists; on failure fallback to v1.
 */
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