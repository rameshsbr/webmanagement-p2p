// IDR v4 bank-code mapping for FAZZ VA (Dynamic/Static). Update list as needed.
export const IDRV4_BANKS: Record<
  "VIRTUAL_BANK_ACCOUNT_DYNAMIC" | "VIRTUAL_BANK_ACCOUNT_STATIC",
  string[]
> = {
  VIRTUAL_BANK_ACCOUNT_DYNAMIC: ["BCA", "BRI", "BNI", "MANDIRI", "SAHABAT_SAMPOERNA", "BSI"],
  VIRTUAL_BANK_ACCOUNT_STATIC: [
    "BCA",
    "BRI",
    "BNI",
    "MANDIRI",
    "CIMB_NIAGA",
    "DANAMON",
    "PERMATA",
    "HANA",
    "SAHABAT_SAMPOERNA",
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
  CIMB_NIAGA: "CIMB",
  CIMB: "CIMB",
  DANAMON: "DANAMON",
  PERMATA: "PERMATA",
  HANA: "HANA",
};

export function normalizeIdrV4BankCode(input: string): string {
  const key = String(input || "").trim().toUpperCase();
  return CANONICAL[key] ?? key;
}