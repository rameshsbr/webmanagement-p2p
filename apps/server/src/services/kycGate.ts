import { prisma } from "../lib/prisma.js";
import { createLowCodeLink, startDiditSession } from "./didit.js";
import { hasOpenKycReverify } from "./kycReset.js";

type KycGateInput = {
  merchantId: string;
  userId: string;
  diditSubject: string;
  externalId?: string | null;
  email?: string | null;
  verifiedAt?: Date | null;
};

type KycGateAllow = { allow: true };

type KycGateBlock = {
  allow: false;
  url: string;
  sessionId: string;
};

export async function requireKycOrStartFlow(input: KycGateInput): Promise<KycGateAllow | KycGateBlock> {
  const { merchantId, userId, diditSubject, externalId, email, verifiedAt } = input;

  // If already verified and no open reverify reset → allow
  const hasReset = await hasOpenKycReverify({ merchantId, userId });
  if (verifiedAt && !hasReset) return { allow: true };

  // Start (or re-start) a Didit low-code session.
  // We make DB writes idempotent with an upsert on externalSessionId to avoid P2002.
  let url: string | null = null;
  let sessionId: string | null = null;

  try {
    const out = await createLowCodeLink({ subject: diditSubject, merchantId, externalId, email });
    url = out.url;
    sessionId = out.sessionId;
  } catch (err) {
    // Fallback to local fake KYC (dev) if real link cannot be created
    try {
      const fallback = await startDiditSession(diditSubject);
      url = fallback.url;
      sessionId = fallback.sessionId;
    } catch (fallbackErr) {
      console.error("[kyc] unable to start verification", fallbackErr);
    }
  }

  if (!url || !sessionId) {
    throw new Error("KYC_START_FAILED");
  }

  // Idempotent write: if another request created the same session, we just connect it to this user
  try {
    await prisma.kycVerification.upsert({
      where: { externalSessionId: sessionId },
      create: { userId, provider: "didit", status: "pending", externalSessionId: sessionId },
      update: { userId },
    });
  } catch (err) {
    // Never block the flow because of a duplicate here
    console.warn("[kyc] upsert KycVerification failed (non-fatal)", err);
  }

  return { allow: false, url, sessionId };
}