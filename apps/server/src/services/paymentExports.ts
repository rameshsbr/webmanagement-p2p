// apps/server/src/services/paymentExports.ts
import { stringify as csvStringify } from "csv-stringify/sync";
import ExcelJS from "exceljs";
import { resolveTimezone } from "../lib/timezone.js";

export type PaymentExportFormat = "csv" | "xlsx" | "pdf";

export interface PaymentExportColumn {
  key: string;
  label: string;
}

export interface PaymentExportItem {
  id: string;
  type: "DEPOSIT" | "WITHDRAWAL" | string;
  status: string;
  amountCents: number;
  currency: string;
  referenceCode: string;
  uniqueReference?: string | null;
  createdAt: Date;
  updatedAt: Date;
  processedAt?: Date | null;
  notes?: string | null;
  rejectedReason?: string | null;
  detailsJson?: Record<string, unknown> | null;
  merchant?: { name?: string | null } | null;
  user?: { publicId?: string | null; email?: string | null; phone?: string | null } | null;
  bankAccount?: {
    publicId?: string | null;
    bankName?: string | null;
    holderName?: string | null;
    accountNo?: string | null;
    bsb?: string | null;
    method?: string | null;
  } | null;
  receiptFile?: { path?: string | null; original?: string | null } | null;
  processedByAdmin?: { displayName?: string | null; email?: string | null } | null;
  _receipts?: Array<{ id: string; path: string }>;
  _receiptCount?: number;
  _extrasList?: Array<{ label: string; value: unknown }>;
  _extrasLookup?: Record<string, true>;
}

export interface PaymentExportContext {
  scope: "admin" | "merchant" | "superadmin";
  type: "DEPOSIT" | "WITHDRAWAL" | "ALL";
}

export interface PaymentExportResult {
  filename: string;
  contentType: string;
  body: Buffer;
}

export interface PaymentExportOptions {
  format: PaymentExportFormat;
  columns: PaymentExportColumn[];
  items: PaymentExportItem[];
  context: PaymentExportContext;
  timezone?: string;
}

export function normalizeColumns(
  raw: unknown,
  fallback: PaymentExportColumn[],
  allowedKeys?: Set<string>
): PaymentExportColumn[] {
  const out: PaymentExportColumn[] = [];
  const seen = new Set<string>();
  const allow = allowedKeys || new Set(fallback.map((c) => c.key));

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const key = typeof (entry as any).key === "string" ? (entry as any).key.trim() : "";
      if (!key || seen.has(key) || !allow.has(key)) continue;
      const labelRaw = typeof (entry as any).label === "string" ? (entry as any).label.trim() : "";
      const fallbackLabel = fallback.find((c) => c.key === key)?.label || key;
      out.push({ key, label: labelRaw || fallbackLabel });
      seen.add(key);
    }
  }

  if (!out.length) {
    fallback.forEach((col) => {
      if (seen.has(col.key)) return;
      if (!allow.has(col.key)) return;
      out.push({ key: col.key, label: col.label });
      seen.add(col.key);
    });
  }

  return out;
}

export async function buildPaymentExportFile(options: PaymentExportOptions): Promise<PaymentExportResult> {
  const { format, columns, items, context } = options;
  const safeColumns = columns.filter((col) => col.key && col.label);
  const headers = safeColumns.map((col) => col.label);
  const timezone = resolveTimezone(options.timezone);
  const rows = items.map((item) => safeColumns.map((col) => formatColumnValue(item, col.key, context, timezone)));

  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = buildBaseName(context);

  if (format === "csv") {
    const records = rows.map((values) => {
      const record: Record<string, string> = {};
      values.forEach((value, idx) => {
        record[headers[idx] ?? `Column ${idx + 1}`] = value;
      });
      return record;
    });
    const csv = csvStringify(records, { header: true, columns: headers });
    return {
      filename: `${baseName}_${stamp}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: Buffer.from(csv, "utf8"),
    };
  }

  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Payments");
    ws.columns = headers.map((label, idx) => ({
      header: label,
      key: `c${idx}`,
      width: Math.min(60, Math.max(12, label.length + 6)),
      style: { alignment: { vertical: "top", wrapText: true } },
    }));

    rows.forEach((values) => {
      const data: Record<string, string> = {};
      values.forEach((value, idx) => {
        data[`c${idx}`] = value;
      });
      ws.addRow(data);
    });

    const buf = await wb.xlsx.writeBuffer();
    return {
      filename: `${baseName}_${stamp}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: Buffer.isBuffer(buf) ? buf : Buffer.from(buf),
    };
  }

  if (format === "pdf") {
    const lines: string[] = [];
    lines.push(`${titleCase(context.scope)} ${titleCase(resolveContextType(context))} payments export — ${new Date().toISOString()}`);
    lines.push("");

    if (!rows.length) {
      lines.push("No payment records available.");
    }

    rows.forEach((values, rowIdx) => {
      lines.push(`Row ${rowIdx + 1}`);
      values.forEach((value, colIdx) => {
        const label = headers[colIdx] ?? `Column ${colIdx + 1}`;
        const parts = value.split(/\r?\n/);
        lines.push(`${label}: ${parts[0] || "-"}`);
        for (let i = 1; i < parts.length; i += 1) {
          lines.push(`  ${parts[i]}`);
        }
      });
      lines.push("");
    });

    const pdf = buildSimplePdf(lines);
    return {
      filename: `${baseName}_${stamp}.pdf`,
      contentType: "application/pdf",
      body: pdf,
    };
  }

  throw new Error(`Unsupported export format: ${format}`);
}

function buildBaseName(context: PaymentExportContext): string {
  const prefix = context.scope.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  const type = resolveContextType(context).toLowerCase();
  return `${prefix}_${type}`;
}

function resolveContextType(context: PaymentExportContext): "DEPOSITS" | "WITHDRAWALS" | "PAYMENTS" {
  if (context.type === "DEPOSIT") return "DEPOSITS";
  if (context.type === "WITHDRAWAL") return "WITHDRAWALS";
  return "PAYMENTS";
}

function formatColumnValue(item: PaymentExportItem, key: string, context: PaymentExportContext, timezone: string): string {
  const paymentType = resolvePaymentType(item, context.type);
  const method = extractMethod(item);
  const processedAt = item.processedAt || item.updatedAt || null;
  const hasProcessed = !!processedAt && !["PENDING", "SUBMITTED"].includes(item.status);

  switch (key) {
    case "txnId":
      return item.referenceCode || "-";
    case "userId":
      return item.user?.publicId || "-";
    case "merchant":
      return item.merchant?.name || "-";
    case "type":
      return item.type || paymentType;
    case "currency":
      return item.currency || "-";
    case "amount":
      return formatAmount(item.amountCents, context.scope === "superadmin" ? item.currency : undefined);
    case "status":
      return item.status || "-";
    case "bank": {
      const showBank = paymentType === "DEPOSIT" || (item.bankAccount && item.status !== "REJECTED");
      if (!showBank || !item.bankAccount) return "-";
      const id = item.bankAccount.publicId || "-";
      const name = item.bankAccount.bankName || "-";
      return `${id}\n${name}`;
    }
    case "created":
      return formatDateTime(item.createdAt, timezone);
    case "processedAt":
      return hasProcessed && processedAt ? formatDateTime(processedAt, timezone) : "-";
    case "processingTime":
      return hasProcessed && processedAt ? formatDuration(item.createdAt, processedAt) : "-";
    case "userInfo":
      return formatUserInfo(item, paymentType, method, context.scope);
    case "comment":
      return item.notes || item.rejectedReason || "-";
    case "admin":
      return item.processedByAdmin?.displayName || item.processedByAdmin?.email || "-";
    case "receipts":
      return formatReceipts(item);
    case "actions":
      return "";
    default:
      return "";
  }
}

function resolvePaymentType(item: PaymentExportItem, scopeType: PaymentExportContext["type"]): "DEPOSIT" | "WITHDRAWAL" {
  if (scopeType === "ALL") {
    const raw = (item.type || "").toUpperCase();
    return raw === "WITHDRAWAL" ? "WITHDRAWAL" : "DEPOSIT";
  }
  return scopeType;
}

function extractMethod(item: PaymentExportItem): string {
  const rawDetails = item.detailsJson || {};
  const method = (rawDetails && typeof rawDetails === "object" ? (rawDetails as any).method : null) || item.bankAccount?.method || "";
  return String(method || "").toUpperCase();
}

function formatUserInfo(
  item: PaymentExportItem,
  paymentType: "DEPOSIT" | "WITHDRAWAL",
  method: string,
  scope: PaymentExportContext["scope"]
): string {
  const lines: string[] = [];
  const details = (item.detailsJson && typeof item.detailsJson === "object") ? (item.detailsJson as any) : {};
  const payer = paymentType === "DEPOSIT" ? (details.payer || {}) : (details.destination || {});
  const extrasList = Array.isArray((item as any)._extrasList) ? (item as any)._extrasList as Array<{ label: string; value: unknown }> : [];
  const extrasLookup = (item as any)._extrasLookup && typeof (item as any)._extrasLookup === "object"
    ? (item as any)._extrasLookup as Record<string, true>
    : {};

  const hasExtra = (...labels: string[]) => {
    return labels.some((label) => {
      const key = label.trim().toLowerCase();
      return !!extrasLookup[key];
    });
  };

  if (paymentType === "DEPOSIT") {
    if (scope !== "superadmin" || !hasExtra("unique reference no", "unique reference number")) {
      lines.push(`Unique Reference No: ${item.uniqueReference || "-"}`);
    }
  }

  if (scope !== "superadmin" || !hasExtra("method")) {
    lines.push(`Method: ${method || "-"}`);
  }

  const bankName = paymentType === "DEPOSIT"
    ? (payer.bankName || item.bankAccount?.bankName || "-")
    : (payer.bankName || item.bankAccount?.bankName || "-");
  if (scope !== "superadmin" || !hasExtra("bank name")) {
    lines.push(`Bank name: ${bankName || "-"}`);
  }

  const holder = payer.holderName || payer.holder || payer.accountName || payer.name || item.bankAccount?.holderName || "-";
  if (scope !== "superadmin" || !hasExtra("account holder name", "account name")) {
    lines.push(`Account holder name: ${holder || "-"}`);
  }

  if (method === "OSKO") {
    if (scope !== "superadmin" || !hasExtra("account number")) {
      const accountNo = payer.accountNo || payer.accountNumber || payer.account || item.bankAccount?.accountNo || "-";
      lines.push(`Account number: ${accountNo || "-"}`);
    }
    if (scope !== "superadmin" || !hasExtra("bsb", "bsb number")) {
      const bsb = payer.bsb || payer.bsbNumber || item.bankAccount?.bsb || "-";
      lines.push(`BSB: ${bsb || "-"}`);
    }
  } else if (method === "PAYID") {
    if (scope !== "superadmin" || !hasExtra("payid type")) {
      const payIdType = payer.payIdType || payer.payidType || "";
      lines.push(`PayID type: ${payIdType ? String(payIdType).toUpperCase() : "-"}`);
    }
    if (scope !== "superadmin" || !hasExtra("payid value", "payid")) {
      const payIdValue = payer.payIdValue || payer.payId || payer.payid || "-";
      lines.push(`PayID value: ${payIdValue || "-"}`);
    }
  }

  if (paymentType === "DEPOSIT" && scope !== "superadmin") {
    const receiptPath = item.receiptFile?.path || "";
    if (receiptPath) {
      lines.push(`Receipt: ${receiptPath}`);
    }
  }

  if (scope === "superadmin" && extrasList.length) {
    extrasList.forEach((extra) => {
      const label = String(extra.label || "").trim();
      if (!label) return;
      lines.push(`${label}: ${formatExtraValue(extra.value)}`);
    });
  }

  return lines.join("\n");
}

function formatReceipts(item: PaymentExportItem): string {
  const list = Array.isArray(item._receipts) ? item._receipts : [];
  if (list.length) {
    return list
      .map((receipt, idx) => `Receipt${idx ? ` ${idx + 1}` : ""}: ${receipt.path}`)
      .join("\n");
  }
  if (item.receiptFile?.path) {
    return `Receipt: ${item.receiptFile.path}`;
  }
  const count = typeof item._receiptCount === "number" ? item._receiptCount : 0;
  return count ? `Receipts: ${count}` : "No receipts";
}

function formatAmount(cents: number, currency?: string): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "-";
  const abs = Math.abs(cents);
  const hasFraction = abs % 100 !== 0;
  const value = (cents / 100).toLocaleString("en-AU", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  });
  return currency ? `${value} ${currency}` : value;
}

const exportDateTimeCache = new Map<string, Intl.DateTimeFormat>();

function formatDateTime(value: Date | string | null | undefined, timezoneRaw?: string): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const timezone = resolveTimezone(timezoneRaw);
  let formatter = exportDateTimeCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-AU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: timezone,
    });
    exportDateTimeCache.set(timezone, formatter);
  }
  return formatter.format(date);
}

function formatDuration(start: Date | string | null | undefined, end: Date | string | null | undefined): string {
  if (!start || !end) return "-";
  const s = start instanceof Date ? start : new Date(start);
  const e = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "-";
  const diff = Math.max(0, e.getTime() - s.getTime());
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!parts.length || seconds) parts.push(`${seconds}s`);
  return parts.join(" ") || "0s";
}

function formatExtraValue(value: unknown): string {
  if (value === null || typeof value === "undefined") return "-";
  if (Array.isArray(value)) {
    const filtered = value
      .map((item) => (item == null ? "" : String(item)))
      .filter((str) => str.trim() !== "");
    return filtered.length ? filtered.join(", ") : "-";
  }
  if (typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      return json && json !== "{}" ? json : "-";
    } catch {
      return "-";
    }
  }
  const str = String(value);
  return str.trim() === "" ? "-" : str;
}

function titleCase(input: string): string {
  return input
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function buildSimplePdf(lines: string[]): Buffer {
  const perPage = 40;
  const pages = chunkLines(lines, perPage);
  const objects: Array<{ index: number; body: string }> = [];

  const catalogIndex = 1;
  const pagesIndex = 2;
  const fontIndex = 3 + pages.length * 2;

  const kidRefs = pages.map((_, idx) => `${3 + idx * 2} 0 R`).join(" ");

  objects.push({ index: catalogIndex, body: `<< /Type /Catalog /Pages ${pagesIndex} 0 R >>` });
  objects.push({ index: pagesIndex, body: `<< /Type /Pages /Count ${pages.length} /Kids [${kidRefs}] >>` });

  pages.forEach((pageLines, idx) => {
    const pageIndex = 3 + idx * 2;
    const contentIndex = pageIndex + 1;
    const contentStream = buildContentStream(pageLines);
    const length = Buffer.byteLength(contentStream, "utf8");
    objects.push({
      index: pageIndex,
      body: `<< /Type /Page /Parent ${pagesIndex} 0 R /MediaBox [0 0 612 792] /Contents ${contentIndex} 0 R /Resources << /Font << /F1 ${fontIndex} 0 R >> >> >>`,
    });
    objects.push({ index: contentIndex, body: `<< /Length ${length} >>\nstream\n${contentStream}\nendstream` });
  });

  objects.push({ index: fontIndex, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" });

  objects.sort((a, b) => a.index - b.index);

  const parts: string[] = ["%PDF-1.4\n"];
  const offsets: number[] = [];
  offsets[0] = 0;
  let offset = Buffer.byteLength(parts[0], "utf8");

  objects.forEach((obj) => {
    offsets[obj.index] = offset;
    const chunk = `${obj.index} 0 obj\n${obj.body}\nendobj\n`;
    parts.push(chunk);
    offset += Buffer.byteLength(chunk, "utf8");
  });

  const xrefStart = offset;
  const maxIndex = fontIndex;
  parts.push(`xref\n0 ${maxIndex + 1}\n`);
  parts.push("0000000000 65535 f \n");
  for (let i = 1; i <= maxIndex; i += 1) {
    const pos = offsets[i] ?? offset;
    parts.push(`${pos.toString().padStart(10, "0")} 00000 n \n`);
  }
  parts.push(`trailer\n<< /Size ${maxIndex + 1} /Root ${catalogIndex} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return Buffer.from(parts.join(""));
}

function chunkLines(lines: string[], perPage: number): string[][] {
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += perPage) {
    pages.push(lines.slice(i, i + perPage));
  }
  return pages.length ? pages : [["No payment records available."]];
}

function buildContentStream(lines: string[]): string {
  const body: string[] = [];
  body.push("BT");
  body.push("/F1 12 Tf");
  body.push("14 TL");
  body.push("72 760 Td");
  lines.forEach((line, idx) => {
    const escaped = escapePdfText(line);
    if (idx === 0) body.push(`(${escaped}) Tj`);
    else body.push("T*", `(${escaped}) Tj`);
  });
  body.push("ET");
  return body.join("\n");
}

function escapePdfText(text: string): string {
  return text.replace(/[\\()]/g, (match) => `\\${match}`).replace(/\r?\n/g, " ");
}

