import fetch from 'node-fetch';
import { prisma } from '../lib/prisma.js';
export async function notifyMerchant(paymentId: string) {
  const pr = await prisma.paymentRequest.findUnique({
    where: { id: paymentId },
    include: { merchant: true, user: true }
  });
  if (!pr || !pr.merchant.webhookUrl) return;
  const payload = {
    type: 'events.payment.updated',
    data: {
      id: pr.id,
      type: pr.type,
      status: pr.status,
      amountCents: pr.amountCents,
      currency: pr.currency,
      referenceCode: pr.referenceCode,
      userDiditSubject: pr.user?.diditSubject
    }
  };
  try {
    await fetch(pr.merchant.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch {
    // In production, queue retries with backoff
  }
}