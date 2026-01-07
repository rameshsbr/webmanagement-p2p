import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";

export const fazzWebhookRouter = Router();

/**
 * HMAC verify helper.
 * We accept either:
 *  - header "x-fazz-signature" OR "x-signature" (hex),
 *  - env secret FAZZ_WEBHOOK_SECRET
 * If the provider uses a different header name, we can add it later.
 */
function verifySignature(raw: Buffer, headerSig: string | undefined, secret: string | undefined) {
  if (!headerSig || !secret) return false;
  const mac = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  // constant-time compare
  return mac.length === headerSig.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(headerSig));
}

/**
 * Map provider statuses to our local enums (deposits)
 * provider: pending | paid | completed | failed | cancelled | canceled | expired | success | succeeded
 * local:    PENDING | SUBMITTED | APPROVED | REJECTED
 */
function mapDepositStatus(provider: string): "PENDING" | "SUBMITTED" | "APPROVED" | "REJECTED" | null {
  const s = String(provider || "").toLowerCase();
  if (["paid", "success", "succeeded", "completed"].includes(s)) return "APPROVED";
  if (["failed", "cancelled", "canceled", "expired", "rejected"].includes(s)) return "REJECTED";
  // still pending-like
  return null;
}

/**
 * Map provider statuses for disbursements
 * We'll store raw, and for ledger later:
 *  - completed -> success
 *  - failed    -> failed
 *  - processing/pending -> noop
 */
function normalizePayoutStatus(s: string) {
  const v = String(s || "").toLowerCase();
  if (["completed", "success", "succeeded"].includes(v)) return "completed";
  if (["failed", "rejected", "cancelled", "canceled"].includes(v)) return "failed";
  return "processing";
}

// This route expects raw body (Buffer) to verify HMAC; we’ll attach middleware in index.ts
fazzWebhookRouter.post("/", async (req: any, res) => {
  try {
    const secret = process.env.FAZZ_WEBHOOK_SECRET || "";
    const sig = (req.get("x-fazz-signature") || req.get("x-signature") || "").trim();
    const raw: Buffer = req.rawBody || Buffer.from([]);

    const ok = verifySignature(raw, sig, secret);
    // We persist payload regardless (with processed=false) so we can replay if needed
    const payloadText = raw.toString("utf8");
    let payload: any;
    try { payload = JSON.parse(payloadText); } catch { payload = { _raw: payloadText }; }

    const log = await prisma.providerWebhookLog.create({
      data: {
        provider: "FAZZ",
        topic: String(payload?.event || payload?.type || "unknown"),
        signature: sig || null,
        headersJson: req.headers as any,
        payloadJson: payload,
        processed: ok, // mark processed only if signature verified
        processedAt: ok ? new Date() : null,
        error: ok ? null : "signature_verification_failed",
      },
    });

    if (!ok) {
      // Don’t process if signature bad; return 400 so provider retries (optional)
      return res.status(400).json({ ok: false });
    }

    // Branch by topic/event. Adjust these fields once you know exact Fazz payload names.
    const topic = String(payload?.event || payload?.type || "").toLowerCase();

    if (topic.includes("payment")) {
      // Accept (VA) side
      const providerPaymentId: string | undefined =
        payload?.data?.id || payload?.data?.payment_id || payload?.paymentId || payload?.id;
      const providerStatus: string | undefined =
        payload?.data?.status || payload?.status;

      if (providerPaymentId) {
        // update ProviderPayment + PaymentRequest
        const pp = await prisma.providerPayment.findFirst({
          where: { provider: "FAZZ", providerPaymentId },
        });

        if (pp) {
          // persist latest snapshot
          await prisma.providerPayment.update({
            where: { paymentRequestId: pp.paymentRequestId },
            data: { status: providerStatus || "unknown", rawLatestJson: payload },
          });

          // map to local PaymentRequest status
          const mapped = providerStatus ? mapDepositStatus(providerStatus) : null;
          if (mapped) {
            await prisma.paymentRequest.update({
              where: { id: pp.paymentRequestId },
              data: { status: mapped },
            });
          }
        }
      }
    } else if (topic.includes("disbursement") || topic.includes("transfer") || topic.includes("payout")) {
      // Send (payout) side
      const providerPayoutId: string | undefined =
        payload?.data?.id || payload?.data?.payout_id || payload?.payoutId || payload?.id;
      const providerStatus: string | undefined =
        payload?.data?.status || payload?.status;

      if (providerPayoutId) {
        const pd = await prisma.providerDisbursement.findFirst({
          where: { provider: "FAZZ", providerPayoutId },
        });
        if (pd) {
          await prisma.providerDisbursement.update({
            where: { id: pd.id },
            data: { status: providerStatus || "unknown", rawLatestJson: payload },
          });
          // (Later) ledger side-effects when status transitions to completed/failed
        }
      }
    } else {
      // unknown topic; nothing to do
    }

    return res.json({ ok: true, id: log.id });
  } catch (e) {
    // Best-effort logging; if prisma fails before insert, we still 200 so provider doesn’t spam.
    return res.json({ ok: true });
  }
});
