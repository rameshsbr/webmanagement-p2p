import { prisma } from "../lib/prisma.js";

export const IDR_V4_METHOD_BANK_CODES = [
  "VIRTUAL_BANK_ACCOUNT_DYNAMIC",
  "VIRTUAL_BANK_ACCOUNT_STATIC",
] as const;

export const KNOWN_IDR_V4_BANK_CODES = [
  "BCA",
  "BRI",
  "BNI",
  "MANDIRI",
  "PERMATA",
  "CIMB_NIAGA",
  "DANAMON",
  "SEABANK",
  "MAYBANK",
  "HANA",
  "SAHABAT_SAMPOERNA",
  "BSI",
] as const;

const KNOWN_LABELS: Record<string, string> = {
  BCA: "BCA",
  BRI: "BRI",
  BNI: "BNI",
  MANDIRI: "Mandiri",
  PERMATA: "Permata",
  CIMB_NIAGA: "CIMB Niaga",
  DANAMON: "Danamon",
  SEABANK: "SeaBank",
  MAYBANK: "Maybank",
  HANA: "Hana",
  SAHABAT_SAMPOERNA: "Bank Sahabat Sampoerna",
  BSI: "Bank Syariah Indonesia",
};

export type MethodBankInput = {
  code: string;
  label?: string | null;
  active?: boolean;
  sort?: number;
};

export function normalizeMethodBankCode(code: string) {
  return String(code || "").trim().toUpperCase();
}

function titleCaseCode(code: string) {
  return String(code || "")
    .trim()
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function idrV4BankLabel(code: string) {
  const key = normalizeMethodBankCode(code);
  return KNOWN_LABELS[key] || titleCaseCode(key) || key;
}

export function defaultIdrV4MethodBanks(): MethodBankInput[] {
  return KNOWN_IDR_V4_BANK_CODES.map((code, idx) => ({
    code,
    label: KNOWN_LABELS[code],
    active: true,
    sort: idx + 1,
  }));
}

export async function getMethodBanksForMeta(methodCode: string) {
  const normalizedCode = normalizeMethodBankCode(methodCode);
  const method = await prisma.method.findUnique({
    where: { code: normalizedCode },
    select: { id: true },
  });

  let rows: { code: string; label: string | null }[] = [];
  if (method) {
    rows = await prisma.methodBank.findMany({
      where: { methodId: method.id, active: true },
      orderBy: [{ sort: "asc" }, { code: "asc" }],
      select: { code: true, label: true },
    });
  }

  const defaults = defaultIdrV4MethodBanks();
  const source = rows.length
    ? rows.map((row) => ({
        code: normalizeMethodBankCode(row.code),
        label: row.label,
      }))
    : defaults.map((row) => ({ code: row.code, label: row.label || null }));

  const labels: Record<string, string> = {};
  const banks = source.map((row) => {
    const code = normalizeMethodBankCode(row.code);
    const defaultLabel = idrV4BankLabel(code);
    const label = row.label?.trim() || defaultLabel;
    if (label && label !== defaultLabel) {
      labels[code] = label;
    }
    return code;
  });

  return {
    banks,
    labels: Object.keys(labels).length ? labels : undefined,
    hasCustomConfig: rows.length > 0,
  };
}
