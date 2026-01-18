import { prisma } from "../../../lib/prisma.js";
import { isIdrV4Method } from "../../methods.js";

export type FazzAcceptNormalized = "PENDING_OPEN" | "PAID" | "FAILED" | "CANCELED" | "EXPIRED";
export type FazzSendNormalized = "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "EXPIRED";
export type ProviderSyncKind = "accept" | "send";

const ACCEPT_PENDING = new Set(["created", "awaiting_payment", "pending", "processing"]);
const ACCEPT_PAID = new Set(["paid", "completed", "success", "succeeded", "settled"]);
const ACCEPT_FAILED = new Set(["failed", "declined"]);
const ACCEPT_CANCELED = new Set(["cancelled", "canceled"]);
const ACCEPT_EXPIRED = new Set(["expired"]);

const SEND_QUEUED = new Set(["created", "queued", "processing", "pending"]);
const SEND_SUCCEEDED = new Set(["succeeded", "completed", "success"]);
const SEND_FAILED = new Set(["failed", "declined", "rejected"]);
const SEND_CANCELED = new Set(["cancelled", "canceled"]);
const SEND_EXPIRED = new Set(["expired"]);

export function normalizeFazzPaymentStatus(raw: string | null | undefined): FazzAcceptNormalized {
  const v = String(raw || "").toLowerCase();
  if (ACCEPT_PAID.has(v)) return "PAID";
  if (ACCEPT_FAILED.has(v)) return "FAILED";
  if (ACCEPT_CANCELED.has(v)) return "CANCELED";
  if (ACCEPT_EXPIRED.has(v)) return "EXPIRED";
  return "PENDING_OPEN";
}

export function normalizeFazzPayoutStatus(raw: string | null | undefined): FazzSendNormalized {
  const v = String(raw || "").toLowerCase();
  if (SEND_SUCCEEDED.has(v)) return "SUCCEEDED";
  if (SEND_FAILED.has(v)) return "FAILED";
  if (SEND_CANCELED.has(v)) return "CANCELED";
  if (SEND_EXPIRED.has(v)) return "EXPIRED";
  if (SEND_QUEUED.has(v)) return "QUEUED";
  return "PROCESSING";
}

export function mapAcceptNormalizedToPaymentStatus(normalized: FazzAcceptNormalized) {
  if (normalized === "PAID") return "APPROVED";
  if (normalized === "FAILED") return "REJECTED";
  if (normalized === "CANCELED") return "REJECTED";
  if (normalized === "EXPIRED") return "REJECTED";
  return "PENDING";
}

export function mapSendNormalizedToPaymentStatus(normalized: FazzSendNormalized) {
  if (normalized === "SUCCEEDED") return "APPROVED";
  if (normalized === "FAILED") return "REJECTED";
  if (normalized === "CANCELED") return "REJECTED";
  if (normalized === "EXPIRED") return "REJECTED";
  return "SUBMITTED";
}

function extractMethodCode(details: unknown, methodCode?: string | null) {
  const fromDetails =
    details && typeof details === "object" && "method" in (details as any)
      ? String((details as any).method || "")
      : "";
  const candidate = methodCode || fromDetails || "";
  return candidate.trim().toUpperCase();
}

function appendSystemNote(existing: string | null, note: string) {
  const stamp = new Date().toISOString();
  const line = `[system] ${note} @ ${stamp}`;
  if (!existing) return line;
  if (existing.includes(line)) return existing;
  return `${existing}\n${line}`;
}

type UpdateInput = {
  paymentRequestId: string;
  kind: ProviderSyncKind;
  normalized: FazzAcceptNormalized | FazzSendNormalized;
  rawStatus: string;
  reason?: string | null;
};

export async function updatePaymentRequestFromProvider(input: UpdateInput, client: typeof prisma = prisma) {
  const pr = await client.paymentRequest.findUnique({
    where: { id: input.paymentRequestId },
    select: {
      id: true,
      type: true,
      status: true,
      merchantId: true,
      detailsJson: true,
      notes: true,
      rejectedReason: true,
      method: { select: { code: true } },
      bankAccount: { select: { method: true } },
    },
  });
  if (!pr) return { updated: false, paymentRequestId: input.paymentRequestId };

  const methodCode = extractMethodCode(pr.detailsJson, pr.method?.code || pr.bankAccount?.method || null);
  if (!isIdrV4Method(methodCode)) return { updated: false, paymentRequestId: pr.id };

  if (input.kind === "accept" && pr.type !== "DEPOSIT") {
    return { updated: false, paymentRequestId: pr.id };
  }
  if (input.kind === "send" && pr.type !== "WITHDRAWAL") {
    return { updated: false, paymentRequestId: pr.id };
  }

  let nextStatus: "PENDING" | "SUBMITTED" | "APPROVED" | "REJECTED";
  let rejectedReason: string | null = null;
  let note: string | null = null;

  if (input.kind === "accept") {
    const normalized = input.normalized as FazzAcceptNormalized;
    nextStatus = mapAcceptNormalizedToPaymentStatus(normalized) as any;
    if (normalized === "PAID") {
      note = "Auto-approved by FAZZ webhook";
    }
    if (nextStatus === "REJECTED") {
      rejectedReason = `PROVIDER_${normalized}`;
      note = `Auto-rejected by FAZZ (${normalized})`;
    }
  } else {
    const normalized = input.normalized as FazzSendNormalized;
    nextStatus = mapSendNormalizedToPaymentStatus(normalized) as any;
    if (nextStatus === "REJECTED") {
      rejectedReason = `PROVIDER_${normalized}`;
      note = `Auto-rejected by FAZZ (${normalized})`;
    }
  }

  if (pr.status === "APPROVED" || pr.status === "REJECTED") {
    return { updated: false, paymentRequestId: pr.id };
  }
  if (pr.status === nextStatus) {
    return { updated: false, paymentRequestId: pr.id };
  }

  const data: any = { status: nextStatus };
  if (nextStatus === "REJECTED" && !pr.rejectedReason) {
    data.rejectedReason = rejectedReason;
  }
  if (note) {
    data.notes = appendSystemNote(pr.notes, note);
  }

  await client.paymentRequest.update({ where: { id: pr.id }, data });

  return { updated: true, paymentRequestId: pr.id, status: nextStatus, merchantId: pr.merchantId };
}
