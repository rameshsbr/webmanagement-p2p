import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";

export const fazzWebhookRouter = Router();

/**
 * Constant-time HMAC verification (hex digest).
 */
function verifySignature(raw: Buffer, headerSig: string | undefined, secret: string | undefined) {
  if (!raw || !headerSig || !secret) return false;
  const mac = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  try {
    return mac.length === headerSig.length &&
      crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(headerSig));
  } catch {
    return false;
  }
}

/**
 * Figure out which secret to use based on topic or payload.
 * - Accept (payments / VA): FAZZ_ACCEPT_WEBHOOK_SECRET
 * - Send (disbursements):   FAZZ_SEND_WEBHOOK_SECRET
 */
function pickSecret(headers: Record<string, any>, payload: any) {
  const accept = process.env.FAZZ_ACCEPT_WEBHOOK_SECRET || "";
  const send   = process.env.FAZZ_SEND_WEBHOOK_SECRET || "";

  const topicHeader = String(headers["x-fazz-topic"] || headers["x-topic"] || "").toLowerCase();
  const event = String(payload?.event || payload?.type || "").toLowerCase();

  const looksLikeSend =
    topicHeader.includes("send") ||
    topicHeader.includes("disbursement") ||
    topicHeader.includes("payout") ||
    event.includes("send") ||
    event.includes("disbursement") ||
    event.includes("payout") ||
    // some payloads use a resource hint
    String(payload?.resource || "").toLowerCase().includes("disbursement");

  // Default to Accept if we can’t tell
  return looksLikeSend ? send : accept;
}

/** Provider -> local mapping (deposits/payments) */
function mapDepositStatus(provider: string): "PENDING" | "SUBMITTED" | "APPROVED" | "REJECTED" | null {
  const s = String(provider || "").toLowerCase();
  if (["paid", "success", "succeeded", "completed"].includes(s)) return "APPROVED";
  if (["failed", "cancelled", "canceled", "expired", "rejected"].includes(s)) return "REJECTED";
  return null; // keep as pending-ish
}

/** Normalize disbursement status for storage */
function normalizePayoutStatus(s: string) {
  const v = String(s || "").toLowerCase();
  if (["completed", "success", "succeeded"].includes(v)) return "completed";
  if (["failed", "rejected", "cancelled", "canceled"].includes(v)) return "failed";
  return "processing";
}

/**
 * NOTE: this route MUST receive the raw (unparsed) body to verify HMAC.
 * Ensure in your app bootstrap you mount:
 *   app.use("/webhooks/fazz", express.raw({ type: "*/*" }));
 *   app.use("/webhooks/fazz", fazzWebhookRouter);
 */
fazzWebhookRouter.post("/", async (req: any, res) => {
  // 1) Grab raw body + compute signature with the correct secret
  const raw: Buffer = req.rawBody || Buffer.from([]);
  const sig = String(req.get("x-fazz-signature") || req.get("x-signature") || "").trim();

  // Parse ONLY after verifying (but we need a peek to select the secret)
  let parsedForSecret: any = {};
  try { parsedForSecret = JSON.parse(raw.toString("utf8")); } catch {}

  const secret = pickSecret(req.headers || {}, parsedForSecret);
  const okSig = verifySignature(raw, sig, secret);

  // 2) Parse JSON (safe)
  let payload: any;
  const payloadText = raw.toString("utf8");
  try { payload = JSON.parse(payloadText); } catch { payload = { _raw: payloadText }; }

  // 3) Persist webhook log first (idempotency & audit)
  let logId: string | undefined;
  try {
    const topic = String(payload?.event || payload?.type || "unknown");
    const log = await prisma.providerWebhookLog.create({
      data: {
        provider: "FAZZ",
        topic,
        signature: sig || null,
        headersJson: req.headers as any,
        payloadJson: payload,
        processed: okSig,
        processedAt: okSig ? new Date() : null,
        error: okSig ? null : "signature_verification_failed",
      },
    });
    logId = log.id;
  } catch {
    // if DB down, we still try to process (best-effort), but will 200 to avoid provider storms
  }

  if (!okSig) {
    // Bad signature: tell provider to retry (or 200 if you prefer to absorb)
    return res.status(400).json({ ok: false, error: "bad_signature" });
  }

  // 4) Route by event/topic to Accept vs Send handlers
  const topic = String(payload?.event || payload?.type || "").toLowerCase();
  const isSend = topic.includes("send") || topic.includes("disbursement") || topic.includes("payout");

  try {
    if (isSend) {
      // --------- FAZZ SEND (disbursement) ----------
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
            data: { status: normalizePayoutStatus(providerStatus || "processing"), rawLatestJson: payload },
          });
          // (Later) ledger effects for completed/failed belong here.
        }
      }
    } else {
      // --------- FAZZ ACCEPT (payments / VA) ----------
      const providerPaymentId: string | undefined =
        payload?.data?.id || payload?.data?.payment_id || payload?.paymentId || payload?.id;
      const providerStatus: string | undefined =
        payload?.data?.status || payload?.status;

      if (providerPaymentId) {
        const pp = await prisma.providerPayment.findFirst({
          where: { provider: "FAZZ", providerPaymentId },
        });

        if (pp) {
          await prisma.providerPayment.update({
            where: { paymentRequestId: pp.paymentRequestId },
            data: { status: providerStatus || "unknown", rawLatestJson: payload },
          });

          const mapped = providerStatus ? mapDepositStatus(providerStatus) : null;
          if (mapped) {
            await prisma.paymentRequest.update({
              where: { id: pp.paymentRequestId },
              data: { status: mapped },
            });
          }
        }
      }
    }
  } catch (e: any) {
    // If anything fails post-verification, mark the log error but still 200 to avoid retries storm
    if (logId) {
      await prisma.providerWebhookLog.update({
        where: { id: logId },
        data: { processed: false, error: String(e?.message || e) },
      }).catch(()=>{});
    }
  }

  return res.json({ ok: true, id: logId });
});

export default fazzWebhookRouter;
