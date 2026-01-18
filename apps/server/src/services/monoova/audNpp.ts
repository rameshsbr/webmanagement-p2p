import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { monoovaRequest, getMonoovaAccountToken } from "./client.js";

const CLIENT_ID_PREFIX = "U";
const CLIENT_ID_LENGTH = 9;

function sanitizeNamePart(value: string | null | undefined) {
  return String(value || "").trim().replace(/[^\p{L}\p{N} .'-]/gu, "");
}

function splitName(fullName: string | null | undefined) {
  const cleaned = sanitizeNamePart(fullName || "");
  if (!cleaned) return { firstName: "Client", lastName: "" };
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function deriveClientUniqueId(publicId: string | null | undefined) {
  const raw = String(publicId || "").trim();
  const match = raw.match(/^U(\d{1,9})$/i);
  if (!match) return null;
  const digits = match[1].padStart(CLIENT_ID_LENGTH, "0");
  return `${CLIENT_ID_PREFIX}${digits}`;
}

function randomClientUniqueId() {
  const digits = Math.floor(Math.random() * 1_000_000_000)
    .toString()
    .padStart(CLIENT_ID_LENGTH, "0");
  return `${CLIENT_ID_PREFIX}${digits}`;
}

function pickResponseRoot(payload: any) {
  if (!payload || typeof payload !== "object") return {};
  return payload?.data || payload?.result || payload || {};
}

function normalizeAutomatcher(payload: any) {
  const root = pickResponseRoot(payload);
  return {
    mProfileId: root?.mProfileId || root?.mProfileID || root?.profileId || null,
    bsb: root?.bsb || root?.bankBsb || root?.bsbNumber || null,
    bankAccountNumber: root?.bankAccountNumber || root?.accountNumber || root?.accountNo || null,
    bankAccountName: root?.bankAccountName || root?.accountName || null,
    status: root?.status || root?.automatcherStatus || null,
  };
}

function normalizePayId(payload: any) {
  const root = pickResponseRoot(payload);
  return {
    payIdType: root?.payIdType || root?.type || null,
    payIdValue: root?.payId || root?.payIdValue || null,
    payIdName: root?.name || root?.accountName || null,
    payIdStatus: root?.status || root?.payIdStatus || null,
  };
}

async function createProfileRecord(userId: string, clientUniqueId: string) {
  return prisma.monoovaProfile.create({
    data: {
      userId,
      clientUniqueId,
    },
  });
}

export async function ensureMonoovaProfile(user: { id: string; publicId?: string | null }) {
  const existing = await prisma.monoovaProfile.findUnique({ where: { userId: user.id } });
  if (existing) return existing;

  const preferred = deriveClientUniqueId(user.publicId || null);
  const candidates = [preferred, randomClientUniqueId(), randomClientUniqueId(), randomClientUniqueId()].filter(
    (v): v is string => Boolean(v)
  );

  for (const candidate of candidates) {
    try {
      return await createProfileRecord(user.id, candidate);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        continue;
      }
      throw err;
    }
  }

  throw new Error("Unable to allocate Monoova clientUniqueId");
}

export async function refreshAutomatcherProfile(user: { id: string; publicId?: string | null; firstName?: string | null; lastName?: string | null; fullName?: string | null }) {
  const profile = await ensureMonoovaProfile(user);
  const name = splitName(user.fullName || "");
  const firstName = sanitizeNamePart(user.firstName || name.firstName || "Client") || "Client";
  const lastName = sanitizeNamePart(user.lastName || name.lastName || "") || "";

  const resp = await monoovaRequest<any>("/receivables/v1/create-or-update", {
    method: "POST",
    body: {
      clientUniqueId: profile.clientUniqueId,
      firstName,
      lastName,
    },
  });

  const normalized = normalizeAutomatcher(resp);
  return prisma.monoovaProfile.update({
    where: { id: profile.id },
    data: {
      ...normalized,
      lastResponse: resp as any,
    },
  });
}

export async function ensureAutomatcher(user: { id: string; publicId?: string | null; firstName?: string | null; lastName?: string | null; fullName?: string | null }) {
  const existing = await prisma.monoovaProfile.findUnique({ where: { userId: user.id } });
  if (existing?.bsb && existing?.bankAccountNumber) return existing;
  return refreshAutomatcherProfile(user);
}

export async function registerPayId(profile: { id: string; clientUniqueId: string }, details: { email: string; name: string }) {
  const resp = await monoovaRequest<any>("/receivables/v1/registerPayId", {
    method: "POST",
    body: {
      clientUniqueId: profile.clientUniqueId,
      payIdType: "Email",
      payId: details.email,
      name: details.name,
    },
  });

  const normalized = normalizePayId(resp);
  return prisma.monoovaProfile.update({
    where: { id: profile.id },
    data: {
      ...normalized,
      lastResponse: resp as any,
    },
  });
}

export async function ensurePayId(user: { id: string; email?: string | null; fullName?: string | null }) {
  const profile = await ensureMonoovaProfile(user);
  if (profile.payIdValue && profile.payIdStatus) return profile;
  const email = String(user.email || "").trim();
  if (!email) throw new Error("PayID email missing");
  const name = sanitizeNamePart(user.fullName || "Client") || "Client";
  return registerPayId(profile, { email, name });
}

export async function updatePayIdStatus(clientUniqueId: string, status: string) {
  return monoovaRequest<any>("/receivables/v1/updatePayIdStatus", {
    method: "POST",
    body: { clientUniqueId, status },
  });
}

export async function updatePayIdName(clientUniqueId: string, name: string) {
  return monoovaRequest<any>("/receivables/v1/updatePayIdName", {
    method: "POST",
    body: { clientUniqueId, name },
  });
}

export async function validateNppDisbursement(payload: any) {
  return monoovaRequest<any>("/financial/v2/transaction/validate", {
    method: "POST",
    body: payload,
  });
}

export async function executeNppDisbursement(payload: any) {
  return monoovaRequest<any>("/financial/v2/transaction/execute", {
    method: "POST",
    body: payload,
  });
}

export function buildNppBankPayload(options: {
  amountCents: number;
  accountName: string;
  bsb: string;
  accountNumber: string;
  remitterName: string;
  endToEndId: string;
  lodgementReference: string;
}) {
  const totalAmount = Number((options.amountCents / 100).toFixed(2));
  return {
    paymentSource: "mAccount",
    totalAmount,
    mAccount: { token: getMonoovaAccountToken() },
    disbursements: [
      {
        disbursementMethod: "NppCreditBankAccount",
        toNppCreditBankAccountDetails: {
          accountName: options.accountName,
          bsb: options.bsb,
          accountNumber: options.accountNumber,
          endToEndId: options.endToEndId,
          remitterName: options.remitterName,
        },
        lodgementReference: options.lodgementReference,
        amount: totalAmount,
      },
    ],
    description: "NPP to bank account",
  };
}

export function buildNppPayIdPayload(options: {
  amountCents: number;
  accountName: string;
  payIdType: "Email" | "Phone" | "PhoneNumber" | "Phone Number" | string;
  payId: string;
  remitterName: string;
  endToEndId: string;
  lodgementReference: string;
}) {
  const totalAmount = Number((options.amountCents / 100).toFixed(2));
  return {
    paymentSource: "mAccount",
    totalAmount,
    mAccount: { token: getMonoovaAccountToken() },
    disbursements: [
      {
        disbursementMethod: "NppCreditPayId",
        toNppCreditPayIdDetails: {
          payIdType: options.payIdType,
          payId: options.payId,
          accountName: options.accountName,
          endToEndId: options.endToEndId,
          remitterName: options.remitterName,
        },
        lodgementReference: options.lodgementReference,
        amount: totalAmount,
      },
    ],
    description: "NPP to PayID",
  };
}
