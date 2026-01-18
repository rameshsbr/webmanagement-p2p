// apps/server/src/routes/webhooks-fazz.ts
import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import {
  normalizeFazzPaymentStatus,
  normalizeFazzPayoutStatus,
  updatePaymentRequestFromProvider,
} from "../services/providers/fazz/idr-v4-sync.js";

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

function extractMerchantId(payload: any) {
  return (
    pick<string>(payload, [
      "data.attributes.metadata.merchantId",
      "data.attributes.metadata.merchant_id",
      "metadata.merchantId",
      "metadata.merchant_id",
    ]) || undefined
  );
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

function getRequestIp(req: any) {
  const header = String(req.headers["x-forwarded-for"] || "");
  if (header) return header.split(",")[0].trim();
  return req.ip || req.connection?.remoteAddress || "";
}

function isIpAllowlisted(req: any) {
  const raw = String(process.env.FAZZ_WEBHOOK_IP_ALLOWLIST || "");
  const allowlist = raw.split(",").map((v) => v.trim()).filter(Boolean);
  if (!allowlist.length) return false;
  const ip = getRequestIp(req);
  return allowlist.includes(ip);
}

function extractEventId(payload: any) {
  return (
    pick<string>(payload, ["event_id", "eventId", "event.id", "data.eventId"]) || undefined
  );
}

function buildDedupeKey(provider: string, topic: string, payload: any, raw: Buffer) {
  const eventId = extractEventId(payload);
  if (eventId) return `${provider}|${topic}|${eventId}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return `${provider}|${topic}|${hash}`;
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
  const hasSignature = Boolean(presented);
  const okSig = hasSignature && !!secret && safeEqualHex(computed, presented);
  const okIp = !hasSignature && isIpAllowlisted(req);
  const authorized = okSig || okIp;

  // 3) parse full payload
  let payload: any;
  const payloadText = raw.toString("utf8");
  try { payload = JSON.parse(payloadText); } catch { payload = { _raw: payloadText }; }

  // 4) log + dedupe
  let logId: string | undefined;
  const topic = String(pick<string>(payload, ["event", "type"]) || "unknown");
  const dedupeKey = buildDedupeKey("FAZZ", topic, payload, raw);
  try {
    const log = await prisma.providerWebhookLog.create({
      data: {
        provider: "FAZZ",
        topic,
        signature: headerSig || null,
        headersJson: req.headers as any,
        payloadJson: payload,
        dedupeKey,
        processed: false,
        processedAt: null,
        error: authorized ? null : (hasSignature ? "signature_verification_failed" : "ip_not_allowlisted"),
      },
      select: { id: true },
    });
    logId = log.id;
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.json({ ok: true, duplicate: true });
    }
  }

  if (!authorized) {
    if (debug) {
      return res.status(400).json({
        ok: false,
        error: hasSignature ? "bad_signature" : "ip_not_allowlisted",
        diag: {
          contentType: req.get("content-type") || null,
          rawLen: raw.length,
          secretPresent: Boolean(secret),
          presented,
          computed,
          ip: getRequestIp(req),
        },
      });
    }
    return res.status(400).json({ ok: false, error: "unauthorized" });
  }

  // 5) classify (payment vs disbursement)
  const { id, status, referenceId, typeLower } = extractPaymentLikeIdentifiers(payload);
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
      const providerStatusRaw = String(status || "");
      const providerStatusNorm = normalizeFazzPayoutStatus(providerStatusRaw);

      let pd = providerPayoutId
        ? await prisma.providerDisbursement.findFirst({
            where: { provider: "FAZZ", providerPayoutId },
            select: { id: true, paymentRequestId: true },
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
            select: { id: true, paymentRequestId: true },
          });
        }
      }

      if (!pd) {
        // No match yet (maybe our create row isn’t committed) — accept idempotently
        await markLogProcessed(logId, null);
        return res.json({ ok: true, matched: false });
      }

      const payloadMerchantId = extractMerchantId(payload);
      let merchantId: string | null = null;
      if (pd.paymentRequestId) {
        const pr = await prisma.paymentRequest.findUnique({
          where: { id: pd.paymentRequestId },
          select: { merchantId: true },
        });
        merchantId = pr?.merchantId || null;
        if (payloadMerchantId && merchantId && payloadMerchantId !== merchantId) {
          await markLogProcessed(logId, "merchant_mismatch");
          return res.json({ ok: true, matched: false });
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.providerDisbursement.update({
          where: { id: pd.id },
          data: {
            status: providerStatusRaw,
            normalizedStatus: providerStatusNorm,
            rawLatestJson: toJsonSafe(payload),
          },
        });
        if (pd.paymentRequestId) {
          await updatePaymentRequestFromProvider(
            {
              paymentRequestId: pd.paymentRequestId,
              kind: "send",
              normalized: providerStatusNorm,
              rawStatus: providerStatusRaw,
            },
            tx,
          );
        }
      });

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
                status: providerStatusRaw,
                referenceCode: pr.referenceCode,
                mappedStatus: providerStatusNorm,
              },
            }).catch(() => {});
          }
        }
      } catch {}

      await markLogProcessed(logId, null);
      console.log("[FAZZ_WEBHOOK]", JSON.stringify({
        provider: "FAZZ",
        topic,
        providerId: providerPayoutId || null,
        merchantId,
        normalized: providerStatusNorm,
        prId: pd.paymentRequestId || null,
      }));
      return res.json({ ok: true, id: providerPayoutId || null, providerStatus: providerStatusRaw, applied: true });
    }

    // ─────────────────────────────────────────────────────────────────
    // ACCEPT (payments / VA)
    // ─────────────────────────────────────────────────────────────────
    const providerPaymentId = id;
    const providerStatus = status;

    let pp = providerPaymentId
      ? await prisma.providerPayment.findFirst({
          where: { provider: "FAZZ", providerPaymentId },
          select: { id: true, paymentRequestId: true },
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
          select: { id: true, paymentRequestId: true },
        });
      }
    }

    let paymentRequestId = pp?.paymentRequestId || null;
    if (!paymentRequestId && referenceId) {
      const pr = await prisma.paymentRequest.findFirst({
        where: { referenceCode: referenceId, type: "DEPOSIT" },
        select: { id: true },
      });
      paymentRequestId = pr?.id || null;
    }

    if (!paymentRequestId) {
      await markLogProcessed(logId, null);
      return res.json({ ok: true, matched: false });
    }

    const providerStatusStr = String(providerStatus || "unknown");
    const providerStatusNorm = normalizeFazzPaymentStatus(providerStatusStr);
    const payloadMerchantId = extractMerchantId(payload);
    let merchantId: string | null = null;
    const prMeta = await prisma.paymentRequest.findUnique({
      where: { id: paymentRequestId },
      select: { merchantId: true },
    });
    merchantId = prMeta?.merchantId || null;
    if (payloadMerchantId && merchantId && payloadMerchantId !== merchantId) {
      await markLogProcessed(logId, "merchant_mismatch");
      return res.json({ ok: true, matched: false });
    }

    await prisma.$transaction(async (tx) => {
      if (pp?.id) {
        await tx.providerPayment.update({
          where: { id: pp.id },
          data: {
            status: providerStatusStr,
            normalizedStatus: providerStatusNorm,
            rawLatestJson: toJsonSafe(payload),
          },
        });
      } else if (providerPaymentId) {
        await tx.providerPayment.create({
          data: {
            paymentRequestId,
            provider: "FAZZ",
            providerPaymentId: String(providerPaymentId),
            methodType: "virtual_bank_account",
            status: providerStatusStr,
            normalizedStatus: providerStatusNorm,
            rawLatestJson: toJsonSafe(payload),
          },
        });
      }
      await updatePaymentRequestFromProvider(
        {
          paymentRequestId,
          kind: "accept",
          normalized: providerStatusNorm,
          rawStatus: providerStatusStr,
        },
        tx,
      );
    });

    // forward merchant webhook if available
    try {
      const pr = await prisma.paymentRequest.findUnique({
        where: { id: paymentRequestId },
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
            mappedStatus: providerStatusNorm,
          },
        }).catch(() => {});
      }
    } catch {}

    await markLogProcessed(logId, null);
      console.log("[FAZZ_WEBHOOK]", JSON.stringify({
        provider: "FAZZ",
        topic,
        providerId: providerPaymentId || null,
        merchantId,
        normalized: providerStatusNorm,
        prId: paymentRequestId,
      }));
    return res.json({ ok: true, id: providerPaymentId || null, providerStatus: providerStatusStr, applied: true });
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
