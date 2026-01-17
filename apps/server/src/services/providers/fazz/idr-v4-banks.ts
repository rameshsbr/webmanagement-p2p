// IDR v4 bank-code mapping for FAZZ VA (Dynamic/Static). Update list as needed.
export const IDRV4_BANKS: Record<
  "VIRTUAL_BANK_ACCOUNT_DYNAMIC" | "VIRTUAL_BANK_ACCOUNT_STATIC",
  string[]
> = {
  VIRTUAL_BANK_ACCOUNT_DYNAMIC: [
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
  ],
  VIRTUAL_BANK_ACCOUNT_STATIC: [
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
  ],
};

// Canonical short codes as Fazz typically expects them.
// If Fazz tells you a different value for your merchant, add/adjust here.
const CANONICAL: Record<string, string> = {
  BCA: "BCA",
  BRI: "BRI",
  BNI: "BNI",
  MANDIRI: "MANDIRI",
  BSI: "BSI",
  SAHABAT_SAMPOERNA: "SAHABAT_SAMPOERNA",
  // Common aliases
  CIMB_NIAGA: "CIMB_NIAGA",
  CIMB: "CIMB_NIAGA",
  DANAMON: "DANAMON",
  PERMATA: "PERMATA",
  HANA: "HANA",
  SEABANK: "SEABANK",
  MAYBANK: "MAYBANK",
};

export function normalizeIdrV4BankCode(input: string): string {
  const key = String(input || "").trim().toUpperCase();
  return CANONICAL[key] ?? key;
}
