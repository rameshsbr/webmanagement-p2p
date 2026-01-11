// apps/server/src/routes/webhooks-fazz.ts
import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";

export const fazzWebhookRouter = Router();

/** Constant-time HMAC verification (hex digest). */
function verifySignature(raw: Buffer, headerSig: string | undefined, secret: string | undefined) {
  if (!raw || !headerSig || !secret) return false;
  try {
    const mac = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    return mac.length === headerSig.length &&
      crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(headerSig));
  } catch {
    return false;
  }
}

/**
 * Pick the correct secret:
 *  - Accept (payments / VA)           → FAZZ_ACCEPT_WEBHOOK_SECRET
 *  - Send   (disbursements / payouts) → FAZZ_SEND_WEBHOOK_SECRET
 */
function pickSecret(headers: Record<string, any>, payload: any) {
  const accept = process.env.FAZZ_ACCEPT_WEBHOOK_SECRET || "";
  const send   = process.env.FAZZ_SEND_WEBHOOK_SECRET || "";

  const topicHeader = String(headers["x-fazz-topic"] || headers["x-topic"] || "").toLowerCase();
  const event = String(payload?.event || payload?.type || "").toLowerCase();
  const resource = String(payload?.resource || "").toLowerCase();

  const looksLikeSend =
    topicHeader.includes("send") ||
    topicHeader.includes("disbursement") ||
    topicHeader.includes("payout") ||
    event.includes("send") ||
    event.includes("disbursement") ||
    event.includes("payout") ||
    resource.includes("disbursement") ||
    resource.includes("payout");

  // default to Accept when unknown
  return looksLikeSend ? send : accept;
}

/** Provider → local mapping (deposits / payments) */
function mapDepositStatus(provider: string): "PENDING" | "SUBMITTED" | "APPROVED" | "REJECTED" | null {
  const s = String(provider || "").toLowerCase();
  if (["paid", "success", "succeeded", "completed"].includes(s)) return "APPROVED";
  if (["failed", "cancelled", "canceled", "expired", "rejected"].includes(s)) return "REJECTED";
  return null;
}

/** Normalize disbursement status for storage */
function normalizePayoutStatus(s: string) {
  const v = String(s || "").toLowerCase();
  if (["completed", "success", "succeeded"].includes(v)) return "completed";
  if (["failed", "rejected", "cancelled", "canceled"].includes(v)) return "failed";
  return "processing";
}

/**
 * NOTE: In index.ts you already mounted:
 *
 * app.use("/webhooks/fazz",
 *   express.raw({ type: "application/json" }),
 *   (req, _res, next) => { if (!req.rawBody && Buffer.isBuffer(req.body)) req.rawBody = req.body; next(); },
 *   fazzWebhookRouter
 * );
 */
fazzWebhookRouter.post("/", async (req: any, res) => {
  // 1) raw body & signature
  const raw: Buffer = req.rawBody || Buffer.from([]);
  const sig = String(req.get("x-fazz-signature") || req.get("x-signature") || "").trim();

  // 2) minimally parse to decide which secret to use
  let peek: any = {};
  try { peek = JSON.parse(raw.toString("utf8")); } catch {}

  const secret = pickSecret(req.headers || {}, peek);
  const okSig = verifySignature(raw, sig, secret);

  // 3) parse full payload (safe)
  let payload: any;
  const payloadText = raw.toString("utf8");
  try { payload = JSON.parse(payloadText); } catch { payload = { _raw: payloadText }; }

  // 4) persist webhook log (store everything before state changes)
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
    // ignore log errors; continue
  }

  if (!okSig) {
    // bad signature → ask provider to retry
    return res.status(400).json({ ok: false, error: "bad_signature" });
  }

  // 5) route by topic/event to Accept vs Send handlers
  const topic = String(payload?.event || payload?.type || "").toLowerCase();
  const isSend = topic.includes("send") || topic.includes("disbursement") || topic.includes("payout");

  try {
    if (isSend) {
      // ---------- FAZZ SEND (disbursements) ----------
      const providerPayoutId: string | undefined =
        payload?.data?.id || payload?.data?.payout_id || payload?.payoutId || payload?.id;
      const providerStatus: string | undefined =
        payload?.data?.status || payload?.status;

      if (providerPayoutId) {
        const pd = await prisma.providerDisbursement.findFirst({
          where: { provider: "FAZZ", providerPayoutId },
          select: { id: true, status: true, paymentRequestId: true },
        });

        if (pd) {
          const newStatus = normalizePayoutStatus(providerStatus || "processing");
          await prisma.providerDisbursement.update({
            where: { id: pd.id },
            data: { status: newStatus, rawLatestJson: payload },
          });

          // (Optional) Update PaymentRequest if linked
          if (pd.paymentRequestId) {
            // You might map to WITHDRAWAL terminal states here if you keep PR linkage
            // Skipping to avoid breaking existing flows.
          }

          // (Optional) Forward to merchant webhook using your internal service if present
          try {
            const mod = await import("../services/webhooks.js");
            if (typeof (mod as any)?.forwardMerchantWebhook === "function" && pd.paymentRequestId) {
              const pr = await prisma.paymentRequest.findUnique({
                where: { id: pd.paymentRequestId },
                select: { merchantId: true, referenceCode: true, type: true },
              });
              if (pr) {
                await (mod as any).forwardMerchantWebhook({
                  merchantId: pr.merchantId,
                  topic: "disbursement.updated",
                  payload: { provider: "FAZZ", providerPayoutId, status: newStatus, referenceCode: pr.referenceCode },
                }).catch(() => {});
              }
            }
          } catch {}
        }
      }
    } else {
      // ---------- FAZZ ACCEPT (payments / VA) ----------
      const providerPaymentId: string | undefined =
        payload?.data?.id || payload?.data?.payment_id || payload?.paymentId || payload?.id;
      const providerStatus: string | undefined =
        payload?.data?.status || payload?.status;

      if (providerPaymentId) {
        const pp = await prisma.providerPayment.findFirst({
          where: { provider: "FAZZ", providerPaymentId },
          select: { paymentRequestId: true },
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

          // (Optional) Forward to merchant webhook using your internal service if present
          try {
            const pr = await prisma.paymentRequest.findUnique({
              where: { id: pp.paymentRequestId },
              select: { merchantId: true, referenceCode: true, type: true },
            });
            const mod = await import("../services/webhooks.js");
            if (pr && typeof (mod as any)?.forwardMerchantWebhook === "function") {
              await (mod as any).forwardMerchantWebhook({
                merchantId: pr.merchantId,
                topic: "payment.updated",
                payload: {
                  provider: "FAZZ",
                  providerPaymentId,
                  status: providerStatus || "unknown",
                  referenceCode: pr.referenceCode,
                  mappedStatus: mapped,
                },
              }).catch(() => {});
            }
          } catch {}
        }
      }
    }
  } catch (e: any) {
    // Mark the log with error but 200 so we don’t cause retry storms
    if (logId) {
      await prisma.providerWebhookLog.update({
        where: { id: logId },
        data: { processed: false, error: String(e?.message || e) },
      }).catch(() => {});
    }
  }

  return res.json({ ok: true, id: logId });
});

export default fazzWebhookRouter;
