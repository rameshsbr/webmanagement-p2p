import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

const AUD_NPP_CODE = "AUD_NPP";

function extractType(payload: any, headers: Record<string, any>) {
  const headerType = headers["x-event-type"] || headers["x-monoova-event"] || headers["x-webhook-type"];
  return String(payload?.type || payload?.eventType || payload?.event || headerType || "unknown");
}

function extractClientUniqueId(payload: any) {
  return (
    payload?.clientUniqueId ||
    payload?.client_unique_id ||
    payload?.clientId ||
    payload?.data?.clientUniqueId ||
    payload?.data?.client_unique_id ||
    payload?.data?.clientId ||
    null
  );
}

function extractAmount(payload: any) {
  const amount =
    payload?.amount ||
    payload?.paymentAmount ||
    payload?.transactionAmount ||
    payload?.data?.amount ||
    payload?.data?.paymentAmount ||
    payload?.data?.transactionAmount ||
    null;
  if (amount === null || amount === undefined) return null;
  const normalized = Number(amount);
  if (!Number.isFinite(normalized)) return null;
  return Math.round(normalized * 100);
}

function extractProviderReference(payload: any) {
  return (
    payload?.reference ||
    payload?.transactionId ||
    payload?.paymentId ||
    payload?.data?.reference ||
    payload?.data?.transactionId ||
    payload?.data?.paymentId ||
    null
  );
}

export async function handleMonoovaWebhook(payload: any, headers: Record<string, any>) {
  const type = extractType(payload, headers);
  const clientUniqueId = extractClientUniqueId(payload);
  const amountCents = extractAmount(payload);
  const providerReference = extractProviderReference(payload);

  let linkedUserId: string | null = null;
  let linkedRequestId: string | null = null;

  if (clientUniqueId) {
    const profile = await prisma.monoovaProfile.findUnique({ where: { clientUniqueId: String(clientUniqueId) } });
    if (profile) {
      linkedUserId = profile.userId;
      const where: Prisma.PaymentRequestWhereInput = {
        type: "DEPOSIT",
        status: "PENDING",
        currency: "AUD",
        userId: profile.userId,
        OR: [
          { method: { code: AUD_NPP_CODE } },
          { detailsJson: { path: ["method"], equals: AUD_NPP_CODE } },
        ],
      };
      if (amountCents) where.amountCents = amountCents;

      const matches = await prisma.paymentRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 3,
      });

      if (matches.length === 1) {
        const match = matches[0];
        linkedRequestId = match.id;
        const currentDetails = (match.detailsJson as Record<string, any>) || {};
        await prisma.paymentRequest.update({
          where: { id: match.id },
          data: {
            status: "APPROVED",
            detailsJson: {
              ...currentDetails,
              monoova: {
                providerReference: providerReference || currentDetails?.monoova?.providerReference || null,
                webhookType: type,
                receivedAt: new Date().toISOString(),
              },
            },
          },
        });
      }
    }
  }

  await prisma.monoovaWebhookInbox.create({
    data: {
      type,
      bodyJson: payload as any,
      headersJson: headers as any,
      receivedAt: new Date(),
      linkedUserId,
      linkedRequestId,
    },
  });

  return { linkedRequestId, linkedUserId };
}
