// apps/server/src/routes/webhooks-fazz.ts
import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";

export const fazzWebhookRouter = Router();

/** ------------------------- utils ------------------------- **/

/** Normalize header signature: allow hex, "sha256=<hex>", or "hmac-sha256=<hex>" */
function normalizePresentedSignature(headerSig?: string) {
  if (!headerSig) return "";
  return String(headerSig).trim().toLowerCase()
    .replace(/^sha256=/, "")
    .replace(/^hmac-sha256=/, "");
}

/** Compute HMAC (hex) over raw body */
function computeMac(raw: Buffer, secret: string) {
  return crypto.createHmac("sha256", secret).update(raw).digest("hex");
}

/** timing-safe hex compare */
function safeEqualHex(a: string, b: string) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** tiny get-in helper */
function pick<T = any>(obj: any, paths: string[]): T | undefined {
  for (const p of paths) {
    const ks = p.split(".");
    let cur = obj;
    let ok = true;
    for (const k of ks) {
      if (cur && typeof cur === "object" && k in cur) cur = cur[k];
      else { ok = false; break; }
    }
    if (ok) return cur as T;
  }
  return undefined;
}

/** JSON:API-ish id/status/reference helpers */
function extractPaymentLikeIdentifiers(payload: any) {
  const id =
    pick<string>(payload, ["data.id", "id", "data.attributes.id"]) || undefined;

  const status =
    pick<string>(payload, [
      "data.attributes.status",
      "data.status",
      "status",
      "attributes.status",
    ]) || undefined;

  const referenceId =
    pick<string>(payload, [
      "data.attributes.referenceId",
      "referenceId",
      "attributes.referenceId",
    ]) || undefined;

  const topic =
    String(
      pick<string>(payload, ["event", "type"]) ||
      ""
    ).toLowerCase();

  const typeLower =
    String(pick<string>(payload, ["data.type"]) || "").toLowerCase();

  return { id, status, referenceId, topic, typeLower };
}

/** Choose webhook secret (now with aliases):
 *  - If event/topic/type looks like disbursement/payout → SEND secret(s)
 *  - Else → ACCEPT secret(s)
 *  - If a *unified* secret is present, it wins
 *  Supported envs:
 *    FAZZ_WEBHOOK_SIGNING_SECRET | FAZZ_WEBHOOK_SECRET (unified)
 *    FAZZ_ACCEPT_WEBHOOK_SIGNING_SECRET | FAZZ_ACCEPT_WEBHOOK_SECRET
 *    FAZZ_SEND_WEBHOOK_SIGNING_SECRET   | FAZZ_SEND_WEBHOOK_SECRET
 */
function pickSecret(headers: Record<string, any>, payload: any) {
  const unified =
    process.env.FAZZ_WEBHOOK_SIGNING_SECRET ||
    process.env.FAZZ_WEBHOOK_SECRET ||
    "";

  const accept =
    process.env.FAZZ_ACCEPT_WEBHOOK_SIGNING_SECRET ||
    process.env.FAZZ_ACCEPT_WEBHOOK_SECRET ||
    "";

  const send =
    process.env.FAZZ_SEND_WEBHOOK_SIGNING_SECRET ||
    process.env.FAZZ_SEND_WEBHOOK_SECRET ||
    "";

  const topicHeader = String(
    headers["x-fazz-topic"] ||
    headers["x-xfers-topic"] ||
    headers["x-topic"] ||
    ""
  ).toLowerCase();

  const event = String(payload?.event || payload?.type || "").toLowerCase();
  const resType = String(payload?.data?.type || "").toLowerCase();

  const looksSend =
    topicHeader.includes("send") ||
    topicHeader.includes("disbursement") ||
    topicHeader.includes("payout") ||
    event.includes("send") ||
    event.includes("disbursement") ||
    event.includes("payout") ||
    resType.includes("disbursement") ||
    resType.includes("payout");

  if (unified) return unified;
  return looksSend ? send : accept;
}

function toJsonSafe<T = any>(value: T): any {
  const seen = new WeakSet();
  const replacer = (_key: string, v: any) => {
    if (v === undefined) return undefined;
    if (Number.isNaN(v) || v === Infinity || v === -Infinity) return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "bigint") return String(v);
    if (typeof v === "object" && v !== null) {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);
    }
    return v;
  };
  try {
    return JSON.parse(JSON.stringify(value, replacer));
  } catch {
    try {
      return JSON.stringify(value, replacer);
    } catch {
      return null;
    }
  }
}

/** Provider → local mapping (deposits / payments) */
function mapDepositStatus(provider: string): "APPROVED" | "REJECTED" | null {
  const s = String(provider || "").toLowerCase();
  if (["paid", "success", "succeeded", "completed", "settled"].includes(s)) return "APPROVED";
  if (["failed", "cancelled", "canceled", "expired", "rejected"].includes(s)) return "REJECTED";
  return null;
}

/** Normalize disbursement status for provider storage; map → local separately */
function normalizePayoutProviderStatus(s: string | undefined) {
  const v = String(s || "").toLowerCase();
  if (["completed", "success", "succeeded"].includes(v)) return "completed";
  if (["failed", "rejected", "cancelled", "canceled"].includes(v)) return "failed";
  return "processing";
}
function mapWithdrawLocalStatus(providerNorm: string): "APPROVED" | "REJECTED" | null {
  const v = String(providerNorm || "").toLowerCase();
  if (v === "completed") return "APPROVED";
  if (v === "failed") return "REJECTED";
  return null;
}

/**
 * NOTE (mounting in index.ts):
 *
 * app.use(
 *   "/webhooks/fazz",
 *   express.raw({ type: ["application/json","application/*+json","application/vnd.api+json"] }),
 *   (req, _res, next) => { if (!req.rawBody && Buffer.isBuffer(req.body)) (req as any).rawBody = req.body; next(); },
 *   fazzWebhookRouter
 * );
 */
fazzWebhookRouter.post("/", async (req: any, res) => {
  const debug = String(req.query?.debug || "").toLowerCase() === "1" || String(req.query?.debug || "").toLowerCase() === "true";

  // 1) raw body + signature(s)
  const raw: Buffer =
    (req.rawBody && Buffer.isBuffer(req.rawBody))
      ? req.rawBody
      : Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from([]);

  const headerSig =
    req.get("x-fazz-signature") ||
    req.get("x-xfers-signature") ||
    req.get("x-signature") ||
    "";

  const presented = normalizePresentedSignature(headerSig);

  // 2) peek to decide secret
  let peek: any = {};
  try { peek = JSON.parse(raw.toString("utf8")); } catch {}

  const secret = pickSecret(req.headers || {}, peek);
  const computed = secret ? computeMac(raw, secret) : "";
  const okSig = !!secret && !!presented && safeEqualHex(computed, presented);

  // 3) parse full payload
  let payload: any;
  const payloadText = raw.toString("utf8");
  try { payload = JSON.parse(payloadText); } catch { payload = { _raw: payloadText }; }

  // 4) log webhook before state changes
  let logId: string | undefined;
  try {
    const topic = String(pick<string>(payload, ["event", "type"]) || "unknown");
    const log = await prisma.providerWebhookLog.create({
      data: {
        provider: "FAZZ",
        topic,
        signature: headerSig || null,
        headersJson: req.headers as any,
        payloadJson: payload,
        processed: okSig,
        processedAt: okSig ? new Date() : null,
        error: okSig ? null : "signature_verification_failed",
      },
      select: { id: true },
    });
    logId = log.id;
  } catch {
    // swallow log errors
  }

  if (!okSig) {
    if (debug) {
      return res.status(400).json({
        ok: false,
        error: "bad_signature",
        diag: {
          contentType: req.get("content-type") || null,
          rawLen: raw.length,
          secretPresent: Boolean(secret),
          presented,
          computed,
        },
      });
    }
    return res.status(400).json({ ok: false, error: "bad_signature" });
  }

  // 5) classify (payment vs disbursement)
  const { id, status, referenceId, topic, typeLower } = extractPaymentLikeIdentifiers(payload);
  const looksSend =
    topic.includes("disbursement") ||
    topic.includes("payout") ||
    typeLower.includes("disbursement") ||
    typeLower.includes("payout");

  try {
    if (looksSend) {
      // ───────────────────────────────────────────────────────────────
      // SEND (disbursement)
      // ───────────────────────────────────────────────────────────────
      const providerPayoutId = id;
      const providerStatusNorm = normalizePayoutProviderStatus(status);

      let pd = providerPayoutId
        ? await prisma.providerDisbursement.findFirst({
            where: { provider: "FAZZ", providerPayoutId },
            select: { id: true, paymentRequestId: true, status: true },
          })
        : null;

      // Fallback correlation by referenceId → PaymentRequest → ProviderDisbursement
      if (!pd && referenceId) {
        const pr = await prisma.paymentRequest.findFirst({
          where: { referenceCode: referenceId, type: "WITHDRAWAL" },
          select: { id: true },
        });
        if (pr) {
          pd = await prisma.providerDisbursement.findFirst({
            where: { paymentRequestId: pr.id },
            select: { id: true, paymentRequestId: true, status: true },
          });
        }
      }

      if (!pd) {
        // No match yet (maybe our create row isn’t committed) — accept idempotently
        await markLogProcessed(logId, null);
        return res.json({ ok: true, matched: false });
      }

      await prisma.providerDisbursement.update({
        where: { id: pd.id },
        data: { status: providerStatusNorm, rawLatestJson: toJsonSafe(payload) },
      });

      const local = mapWithdrawLocalStatus(providerStatusNorm);
      if (local && pd.paymentRequestId) {
        await prisma.paymentRequest.update({
          where: { id: pd.paymentRequestId },
          data: { status: local },
        });
      }

      // forward merchant webhook if available
      try {
        if (pd.paymentRequestId) {
          const pr = await prisma.paymentRequest.findUnique({
            where: { id: pd.paymentRequestId },
            select: { merchantId: true, referenceCode: true },
          });
          const mod = await import("../services/webhooks.js");
          if (pr && typeof (mod as any)?.forwardMerchantWebhook === "function") {
            await (mod as any).forwardMerchantWebhook({
              merchantId: pr.merchantId,
              topic: "disbursement.updated",
              payload: {
                provider: "FAZZ",
                providerPayoutId: providerPayoutId || null,
                status: providerStatusNorm,
                referenceCode: pr.referenceCode,
                mappedStatus: local,
              },
            }).catch(() => {});
          }
        }
      } catch {}

      await markLogProcessed(logId, null);
      return res.json({ ok: true, id: providerPayoutId || null, providerStatus: providerStatusNorm, applied: Boolean(local) });
    }

    // ─────────────────────────────────────────────────────────────────
    // ACCEPT (payments / VA)
    // ─────────────────────────────────────────────────────────────────
    const providerPaymentId = id;
    const providerStatus = status;

    let pp = providerPaymentId
      ? await prisma.providerPayment.findFirst({
          where: { provider: "FAZZ", providerPaymentId },
          select: { paymentRequestId: true },
        })
      : null;

    // Fallback correlation by referenceId
    if ((!pp || !pp.paymentRequestId) && referenceId) {
      const pr = await prisma.paymentRequest.findFirst({
        where: { referenceCode: referenceId, type: "DEPOSIT" },
        select: { id: true },
      });
      if (pr) {
        pp = await prisma.providerPayment.findFirst({
          where: { paymentRequestId: pr.id },
          select: { paymentRequestId: true },
        });
      }
    }

    if (!pp?.paymentRequestId) {
      await markLogProcessed(logId, null);
      return res.json({ ok: true, matched: false });
    }

    const providerStatusStr = String(providerStatus || "unknown");
    await prisma.providerPayment.update({
      where: { paymentRequestId: pp.paymentRequestId },
      data: { status: providerStatusStr, rawLatestJson: toJsonSafe(payload) },
    });

    const mapped = mapDepositStatus(providerStatusStr);
    if (mapped) {
      await prisma.paymentRequest.update({
        where: { id: pp.paymentRequestId },
        data: { status: mapped },
      });
    }

    // forward merchant webhook if available
    try {
      const pr = await prisma.paymentRequest.findUnique({
        where: { id: pp.paymentRequestId },
        select: { merchantId: true, referenceCode: true },
      });
      const mod = await import("../services/webhooks.js");
      if (pr && typeof (mod as any)?.forwardMerchantWebhook === "function") {
        await (mod as any).forwardMerchantWebhook({
          merchantId: pr.merchantId,
          topic: "payment.updated",
          payload: {
            provider: "FAZZ",
            providerPaymentId: providerPaymentId || null,
            status: providerStatusStr,
            referenceCode: pr.referenceCode,
            mappedStatus: mapped,
          },
        }).catch(() => {});
      }
    } catch {}

    await markLogProcessed(logId, null);
    return res.json({ ok: true, id: providerPaymentId || null, providerStatus: providerStatusStr, applied: Boolean(mapped) });
  } catch (e: any) {
    // mark log with error but still 200 to avoid retries storm
    await markLogProcessed(logId, String(e?.message || e));
    return res.status(200).json({ ok: false, error: "internal_processing_error" });
  }
});

async function markLogProcessed(logId?: string, errorMsg: string | null = null) {
  if (!logId) return;
  try {
    await prisma.providerWebhookLog.update({
      where: { id: logId },
      data: {
        processed: !errorMsg,
        processedAt: new Date(),
        error: errorMsg,
      },
    });
  } catch {
    // ignore
  }
}

export default fazzWebhookRouter;