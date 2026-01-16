const ZERO_DECIMAL = new Set(["IDR", "JPY", "KRW"]);

export function isZeroDecimal(cur: string) {
  return ZERO_DECIMAL.has((cur || "").toUpperCase());
}

export function displayAmount(amount: number, currency: string): string {
  if (isZeroDecimal(currency)) {
    return Number(amount || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  const v = Number(amount || 0) / 100;
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseAmountInput(input: string, currency: string): number {
  const raw = String(input || "").replace(/,/g, "").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return isZeroDecimal(currency) ? Math.round(n) : Math.round(n * 100);
}
