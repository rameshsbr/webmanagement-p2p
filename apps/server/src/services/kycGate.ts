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
  const hasReset = await hasOpenKycReverify({ merchantId, userId });
  if (verifiedAt && !hasReset) return { allow: true };

  let url: string | null = null;
  let sessionId: string | null = null;

  try {
    const out = await createLowCodeLink({ subject: diditSubject, merchantId, externalId, email });
    url = out.url;
    sessionId = out.sessionId;
  } catch (err) {
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

  await prisma.kycVerification.create({
    data: { userId, provider: "didit", status: "pending", externalSessionId: sessionId },
  });

  return { allow: false, url, sessionId };
}
