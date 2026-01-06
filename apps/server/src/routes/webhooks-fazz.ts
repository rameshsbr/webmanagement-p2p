import { Router } from "express";
export const fazzWebhookRouter = Router();

function verifySignature(req: any): boolean {
  // You already have raw body capture middleware.
  // Fazz: HMAC-SHA256 with WEBHOOK_SIGNING_SECRET over raw body (adjust header key if needed).
  const secret = process.env.FAZZ_WEBHOOK_SIGNING_SECRET || "";
  const sigHeader = req.get("x-signature") || req.get("x-fazz-signature") || "";
  if (!secret || !sigHeader) return false;

  const raw: Buffer = (req as any).rawBody || Buffer.from("");
  const computed = require("crypto").createHmac("sha256", secret).update(raw).digest("hex");
  // constant-time compare
  return computed.length === sigHeader.length && crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(sigHeader));
}

fazzWebhookRouter.post("/webhooks/fazz", async (req, res) => {
  // 1) Verify signature
  if (!verifySignature(req)) return res.status(401).send("invalid signature");

  const payload = req.body;
  const headers = req.headers;

  // 2) Persist log
  const { prisma } = await import("../lib/prisma.js");
  await prisma.providerWebhookLog.create({
    data: {
      provider: "FAZZ",
      topic: String(payload?.event || payload?.type || "unknown"),
      signature: (req.get("x-signature") || req.get("x-fazz-signature") || "") as string,
      headersJson: headers as any,
      payloadJson: payload as any,
      processed: false,
    },
  });

  // 3) Map events
  try {
    const evType = String(payload?.event || payload?.type || "");
    // Extract referenceId or provider ids to find local row(s)
    const providerPaymentId = payload?.data?.id || payload?.id || null;
    const providerStatus = payload?.data?.status || payload?.status || null;

    if (evType.startsWith("payment.")) {
      // Find provider payment
      const pp = await prisma.providerPayment.findFirst({ where: { provider: "FAZZ", providerPaymentId } });
      if (pp) {
        const pr = await prisma.paymentRequest.findUnique({ where: { id: pp.paymentRequestId } });
        if (pr) {
          let newStatus = pr.status;
          if (providerStatus === "paid") newStatus = "APPROVED";
          if (providerStatus === "completed") newStatus = "SETTLED";
          if (["expired","cancelled","failed"].includes(providerStatus || "")) newStatus = "REJECTED";

          await prisma.paymentRequest.update({ where: { id: pr.id }, data: { status: newStatus } });
          await prisma.providerPayment.update({ where: { paymentRequestId: pr.id }, data: { status: providerStatus || "pending", rawLatestJson: payload as any } });

          // TODO: forward to merchant webhook (your existing signer + retry)
        }
      }
    }

    if (evType.startsWith("disbursement.")) {
      const pd = await prisma.providerDisbursement.findFirst({ where: { provider: "FAZZ", providerPayoutId: providerPaymentId! } });
      if (pd) {
        await prisma.providerDisbursement.update({ where: { id: pd.id }, data: { status: providerStatus || "pending", rawLatestJson: payload as any } });
        if (["completed"].includes(providerStatus || "")) {
          // TODO: ledger debit; update PaymentRequest if you link them
        }
        // TODO: forward to merchant webhook
      }
    }

    // Mark log processed
    await prisma.providerWebhookLog.updateMany({
      where: { provider: "FAZZ", topic: evType, processed: false },
      data: { processed: true, processedAt: new Date() },
    });

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ ok: false });
  }
});
