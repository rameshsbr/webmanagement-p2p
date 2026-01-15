export const IDR_V4_METHODS = new Set([
  "VIRTUAL_BANK_ACCOUNT_DYNAMIC",
  "VIRTUAL_BANK_ACCOUNT_STATIC",
  "FAZZ_SEND",
]);

const FAZZ_DISPLAY_STATUS: Record<string, { label: string; variant: "" | "warn" | "danger" | "success" }> = {
  pending: { label: "Pending", variant: "warn" },
  processing: { label: "Processing", variant: "warn" },
  cancelled: { label: "Cancelled", variant: "danger" },
  expired: { label: "Expired", variant: "danger" },
  failed: { label: "Failed", variant: "danger" },
  paid: { label: "Paid", variant: "warn" },
  completed: { label: "Completed", variant: "success" },
};

function titleCase(value: string) {
  const raw = String(value || "");
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

export function mapFazzDisplayStatus(status?: string | null) {
  if (!status) return null;
  const key = String(status).toLowerCase();
  if (FAZZ_DISPLAY_STATUS[key]) return FAZZ_DISPLAY_STATUS[key];
  return { label: titleCase(key), variant: "" as const };
}

export function isIdrV4Method(code?: string | null) {
  if (!code) return false;
  return IDR_V4_METHODS.has(String(code).trim().toUpperCase());
}
