// apps/server/src/services/providers/fazz/idr-v4-banks.ts
// IDR v4 bank-code mapping isolated for FAZZ VA (Dynamic/Static). Update list as needed.
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
