import { Router } from "express";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { prisma } from "../lib/prisma.js";
import { requireRole } from "../middleware/roles.js";
import crypto from "node:crypto";
import { auditAdmin } from "../services/audit.js";
import * as XLSX from "xlsx";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import { seal } from "../services/secretBox.js";
import { z } from "zod";
import { generateBankPublicId } from "../services/reference.js";
import { getUserDirectory, getAllUsers, renderUserDirectoryPdf } from "../services/userDirectory.js";
import { changePaymentStatus, PaymentStatusError } from "../services/paymentStatus.js";
import { stringify } from "csv-stringify";
import ExcelJS from "exceljs";
import {
  buildPaymentExportFile,
  normalizeColumns,
  PaymentExportColumn,
  PaymentExportItem,
} from "../services/paymentExports.js";
import {
  createAccountEntry,
  listAccountEntries,
  listMerchantBalances,
} from "../services/merchantAccounts.js";
import type { MerchantAccountEntryType } from "@prisma/client";
import { defaultTimezone, normalizeTimezone, resolveTimezone } from "../lib/timezone.js";

export const superAdminRouter = Router();

// Require SUPER role
superAdminRouter.use(requireRole(["SUPER"]));

superAdminRouter.use(async (req: any, res: any, next) => {
  const session = req.admin || null;
  const adminId = session?.sub ? String(session.sub) : null;
  let timezone = session?.timezone ? resolveTimezone(session.timezone) : defaultTimezone();
  let adminRecord: any = null;

  if (adminId) {
    try {
      adminRecord = await prisma.adminUser.findUnique({
        where: { id: adminId },
        select: { id: true, email: true, displayName: true, timezone: true },
      });
      if (adminRecord) {
        timezone = resolveTimezone(adminRecord.timezone);
      }
    } catch {
      adminRecord = null;
    }
  }

  res.locals.admin = adminRecord
    ? { ...session, ...adminRecord }
    : session || null;

  if (session) {
    session.timezone = timezone;
  }

  res.locals.timezone = timezone;
  (req as any).activeTimezone = timezone;

  next();
});

superAdminRouter.post('/prefs/timezone', async (req: any, res) => {
  const adminId = req.admin?.sub ? String(req.admin.sub) : null;
  if (!adminId) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }

  const timezoneRaw = normalizeTimezone(req.body?.timezone);
  const timezone = timezoneRaw ?? null;

  try {
    await prisma.adminUser.update({
      where: { id: adminId },
      data: { timezone },
    });
    const resolved = resolveTimezone(timezone);
    res.locals.timezone = resolved;
    (req as any).activeTimezone = resolved;
    if (req.admin && typeof req.admin === 'object') {
      req.admin.timezone = resolved;
    }
    return res.json({ ok: true, timezone: resolved });
  } catch (err) {
    console.error('[superadmin prefs] failed to update timezone', err);
    return res.status(500).json({ ok: false, error: 'Failed to save timezone' });
  }
});

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

function signTemp(payload: object, minutes = 10) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: `${minutes}m` });
}

// ───────────────────────────────────────────────────────────────
// Small helpers used across pages
// ───────────────────────────────────────────────────────────────
function int(v: any, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
const STATUS_ALLOWED = new Set(["PENDING", "SUBMITTED", "APPROVED", "REJECTED"]);
function statusesCSV(s?: string) {
  if (!s) return undefined;
  const arr = s
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter((x) => STATUS_ALLOWED.has(x));
  return arr.length ? arr : undefined;
}

const superUserQuery = z.object({
  q: z.string().optional(),
  merchantId: z.union([z.string(), z.array(z.string())]).optional(),
  page: z.string().optional(),
  perPage: z.string().optional(),
});

function normalizeMerchantFilter(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((id) => (typeof id === "string" ? id.trim() : ""))
      .filter((id) => id.length > 0);
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}
function sortSpec(s?: string) {
  // allowlist of sortable columns + default
  const wl = new Set([
    "createdAt",
    "processedAt",
    "updatedAt",
    "amountCents",
    "status",
    "currency",
    "referenceCode",
  ]);
  let col = "createdAt",
    dir: "asc" | "desc" = "desc";
  if (s) {
    const [c, d] = s.split(":");
    if (c && wl.has(c)) col = c;
    if (d === "asc" || d === "desc") dir = d;
  }
  return { [col]: dir } as any;
}

const PAYMENT_FILTER_KEYS = new Set([
  "q",
  "id",
  "merchantId",
  "currency",
  "status",
  "from",
  "to",
  "dateField",
  "sort",
  "hasReceipt",
  "amountMin",
  "amountMax",
  "page",
  "perPage",
]);

// ───────────────────────────────────────────────────────────────
// Super Admin 2FA settings
// ───────────────────────────────────────────────────────────────
superAdminRouter.get("/settings/security", async (req: any, res) => {
  const adminId = req.admin?.sub ? String(req.admin.sub) : null;
  if (!adminId) return res.redirect("/auth/super/login");

  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId },
    select: { email: true, superTwoFactorEnabled: true, superTotpSecret: true },
  });

  const enabled = !!(admin?.superTwoFactorEnabled && admin?.superTotpSecret);
  const { enabled: justEnabled, disabled: justDisabled, already, error } = req.query || {};
  let flash: { message: string; variant?: "error" } | null = null;
  if (typeof error === "string" && error) {
    flash = { message: error, variant: "error" };
  } else if (typeof already !== "undefined") {
    flash = { message: "Two-factor authentication is already enabled." };
  } else if (typeof justEnabled !== "undefined") {
    flash = { message: "Two-factor authentication enabled." };
  } else if (typeof justDisabled !== "undefined") {
    flash = { message: "Two-factor authentication disabled." };
  }

  return res.render("superadmin-settings-security", {
    title: "Security",
    twoFactorEnabled: enabled,
    email: admin?.email || "",
    flash,
  });
});

superAdminRouter.post("/settings/security/start", async (req: any, res) => {
  const adminId = req.admin?.sub ? String(req.admin.sub) : null;
  if (!adminId) return res.redirect("/auth/super/login");

  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId },
    select: { email: true, superTwoFactorEnabled: true, superTotpSecret: true },
  });

  if (admin?.superTwoFactorEnabled && admin?.superTotpSecret) {
    return res.redirect("/superadmin/settings/security?already=1");
  }

  try {
    const secret = speakeasy.generateSecret({
      name: `Super Admin (${admin?.email || adminId})`,
    });

    const otpauth = secret.otpauth_url!;
    const qrDataUrl = await QRCode.toDataURL(otpauth);

    const token = signTemp({
      adminId,
      stage: "2fa_setup",
      secretBase32: secret.base32,
      issuer: "Super Admin",
      accountLabel: admin?.email || adminId,
      kind: "super",
      redirectTo: "/superadmin/settings/security?enabled=1",
    });

    return res.render("auth-2fa-setup", {
      token,
      qrDataUrl,
      secretBase32: secret.base32,
      accountLabel: admin?.email || adminId,
      error: "",
      mode: "super",
    });
  } catch (err) {
    console.error("[superadmin 2fa] start failed", err);
    const msg = encodeURIComponent("Unable to start two-factor setup.");
    return res.redirect(`/superadmin/settings/security?error=${msg}`);
  }
});

superAdminRouter.post("/settings/security/disable", async (req: any, res) => {
  const adminId = req.admin?.sub ? String(req.admin.sub) : null;
  if (!adminId) return res.redirect("/auth/super/login");

  try {
    await prisma.adminUser.update({
      where: { id: adminId },
      data: { superTwoFactorEnabled: false, superTotpSecret: null },
    });
    return res.redirect("/superadmin/settings/security?disabled=1");
  } catch (err) {
    console.error("[superadmin 2fa] disable failed", err);
    const msg = encodeURIComponent("Unable to disable two-factor authentication.");
    return res.redirect(`/superadmin/settings/security?error=${msg}`);
  }
});

const SUPERADMIN_DEPOSIT_EXPORT_COLUMNS: PaymentExportColumn[] = [
  { key: "txnId", label: "TRANSACTION ID" },
  { key: "userId", label: "USER ID" },
  { key: "merchant", label: "MERCHANT" },
  { key: "currency", label: "CURRENCY" },
  { key: "amount", label: "AMOUNT" },
  { key: "status", label: "STATUS" },
  { key: "bank", label: "BANK NAME" },
  { key: "created", label: "DATE OF CREATION" },
  { key: "processedAt", label: "DATE OF DEPOSIT" },
  { key: "processingTime", label: "TIME TO PROCESS" },
  { key: "userInfo", label: "USER INFO" },
  { key: "comment", label: "COMMENT" },
  { key: "admin", label: "ADMIN" },
  { key: "receipts", label: "RECEIPTS" },
  { key: "actions", label: "ACTIONS" },
];

const SUPERADMIN_WITHDRAWAL_EXPORT_COLUMNS: PaymentExportColumn[] = [
  { key: "txnId", label: "TRANSACTION ID" },
  { key: "userId", label: "USER ID" },
  { key: "merchant", label: "MERCHANT" },
  { key: "currency", label: "CURRENCY" },
  { key: "amount", label: "AMOUNT" },
  { key: "status", label: "STATUS" },
  { key: "bank", label: "BANK NAME" },
  { key: "created", label: "DATE OF CREATION" },
  { key: "processedAt", label: "DATE OF WITHDRAWAL" },
  { key: "processingTime", label: "TIME TO PROCESS" },
  { key: "userInfo", label: "USER INFO" },
  { key: "comment", label: "COMMENT" },
  { key: "admin", label: "ADMIN" },
  { key: "actions", label: "ACTIONS" },
];

function parseExportFormat(raw: unknown): "csv" | "xlsx" | "pdf" {
  const value = String(raw || "").toLowerCase();
  if (value === "csv" || value === "xlsx" || value === "pdf") return value;
  return "csv";
}

function coerceExportFilters(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const key of PAYMENT_FILTER_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "undefined" || value === null) continue;
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value)) {
      const last = value[value.length - 1];
      if (typeof last === "string") out[key] = last;
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

function sanitizeColumns(raw: unknown, fallback: PaymentExportColumn[]): PaymentExportColumn[] {
  const allowed = new Set(fallback.map((col) => col.key));
  return normalizeColumns(raw, fallback, allowed);
}

async function collectUsersForSuperAdmin(merchantIds: string[], search?: string | null) {
  if (!merchantIds.length) return [];
  return getAllUsers({ merchantIds, search: search ?? null });
}

function parseAmountToCents(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw * 100);
  }
  const str = String(raw ?? "").replace(/,/g, "").trim();
  if (!str) return null;
  const value = Number(str);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

async function loadAccountPageData(
  type: MerchantAccountEntryType,
  merchantId?: string | null
) {
  const merchants = await listMerchantBalances();
  const entries = await listAccountEntries({ type, merchantId: merchantId || null });
  return { merchants, entries };
}

// Multer setup (store in /uploads so they're web-accessible via /uploads/*)
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, path.join(process.cwd(), "uploads"));
    },
    filename: (_req, file, cb) => {
      const base = file.originalname.replace(/[^\w.\-]+/g, "_").slice(-100);
      cb(null, `${Date.now()}_${base}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

function whereFrom(q: any, type: "DEPOSIT" | "WITHDRAWAL") {
  const where: any = { type };

  // Exact fields
  if (q.id) where.id = String(q.id);
  if (q.merchantId) where.merchantId = String(q.merchantId);
  if (q.currency) where.currency = String(q.currency).toUpperCase();

  // Status (CSV or single)
  const sts = statusesCSV(q.status);
  if (sts) where.status = { in: sts };

  // Amount range
  if (q.amountMin || q.amountMax) {
    where.amountCents = {};
    if (q.amountMin) {
      const v = Number(q.amountMin);
      if (Number.isFinite(v)) where.amountCents.gte = Math.round(v * 100);
    }
    if (q.amountMax) {
      const v = Number(q.amountMax);
      if (Number.isFinite(v)) where.amountCents.lte = Math.round(v * 100);
    }
  }

  // Date window (inclusive, whole-day)
  const df = q.dateField === "processedAt"
    ? "processedAt"
    : q.dateField === "updatedAt"
      ? "updatedAt"
      : "createdAt";
  if (q.from || q.to) {
    where[df] = {};
    if (q.from) {
      const d = new Date(String(q.from));
      d.setHours(0, 0, 0, 0);
      where[df].gte = d;
    }
    if (q.to) {
      const d = new Date(String(q.to));
      d.setHours(23, 59, 59, 999);
      where[df].lte = d;
    }
  }

  // hasReceipt: yes/no/true/false/1/0
  if (q.hasReceipt != null && q.hasReceipt !== "") {
    const v = String(q.hasReceipt).toLowerCase();
    const yes = v === "yes" || v === "true" || v === "1";
    const no = v === "no" || v === "false" || v === "0";
    if (yes) where.receipts = { some: {} };
    else if (no) where.receipts = { none: {} };
  }

  // Free-text search
  const text = (q.q || "").toString().trim();
  if (text) {
    where.OR = [
      { referenceCode: { contains: text, mode: "insensitive" } },
      { merchant: { is: { name: { contains: text, mode: "insensitive" } } } },
      { user: { is: { email: { contains: text, mode: "insensitive" } } } },
      { user: { is: { phone: { contains: text, mode: "insensitive" } } } },
    ];
  }
  return where;
}

async function fetchPayments(q: any, type: "DEPOSIT" | "WITHDRAWAL") {
  const where = whereFrom(q, type);
  const page = Math.max(1, int(q.page, 1));
  const perPage = Math.min(150, Math.max(5, int(q.perPage, 25)));
  const orderBy = sortSpec(q.sort);

  const [total, rawItems] = await Promise.all([
    prisma.paymentRequest.count({ where }),
    prisma.paymentRequest.findMany({
      where,
      include: {
        bankAccount: true,
        receipts: {
          select: { id: true, original: true, path: true, createdAt: true },
        },
        user: { select: { id: true, publicId: true, email: true, phone: true } },
        merchant: { select: { id: true, name: true } },
        processedByAdmin: {
          select: { id: true, email: true, displayName: true },
        },
      },
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  const formCache = new Map<string, { deposit: any[]; withdrawal: any[] }>();

  async function ensureFormConfig(
    merchantId: string,
    bankAccountId: string | null
  ) {
    const key = `${merchantId}::${bankAccountId || "null"}`;
    if (formCache.has(key)) return formCache.get(key)!;

    let row: any = await prisma.merchantFormConfig.findFirst({
      where: { merchantId, bankAccountId },
    });

    if (!row && bankAccountId) {
      row = await prisma.merchantFormConfig.findFirst({
        where: { merchantId, bankAccountId: null },
      });
    }

    const entry = {
      deposit: cleanRows(((row as any)?.deposit as any[]) || []),
      withdrawal: cleanRows(((row as any)?.withdrawal as any[]) || []),
    };
    formCache.set(key, entry);
    return entry;
  }

  const comboList: Array<{ merchantId: string; bankAccountId: string | null }> = [];
  const comboSeen = new Set<string>();

  rawItems.forEach((x: any) => {
    const bankKey = type === "DEPOSIT" ? x.bankAccountId || null : null;
    const key = `${x.merchantId}::${bankKey || "null"}`;
    if (!comboSeen.has(key)) {
      comboSeen.add(key);
      comboList.push({ merchantId: x.merchantId, bankAccountId: bankKey });
    }
  });

  await Promise.all(
    comboList.map(({ merchantId, bankAccountId }) =>
      ensureFormConfig(merchantId, bankAccountId)
    )
  );

  const items = await Promise.all(
    rawItems.map(async (x: any) => {
      const first = x.receipts && x.receipts.length > 0 ? x.receipts[0] : null;
      const extras =
        x?.detailsJson && typeof x.detailsJson === "object" && !Array.isArray(x.detailsJson)
          ? (x.detailsJson as any)?.extras || {}
          : {};

      const extrasObj =
        extras && typeof extras === "object" && !Array.isArray(extras)
          ? (extras as Record<string, any>)
          : {};

      const seenExtras = new Set<string>();
      const orderedExtras: Array<{ label: string; value: any }> = [];

      const pushExtra = (label: any, value: any) => {
        const norm = typeof label === "string" ? label.trim() : "";
        if (!norm) return;
        const key = norm.toLowerCase();
        if (seenExtras.has(key)) return;
        seenExtras.add(key);
        orderedExtras.push({ label: norm, value });
      };

      if (type === "DEPOSIT") {
        const cfg = await ensureFormConfig(x.merchantId, x.bankAccountId || null);
        const defined = Array.isArray(cfg.deposit) ? cfg.deposit : [];
        defined.forEach((field: any) => {
          pushExtra(field?.name, extrasObj[field?.name as keyof typeof extrasObj]);
        });
      } else {
        const cfg = await ensureFormConfig(x.merchantId, null);
        const defined = Array.isArray(cfg.withdrawal) ? cfg.withdrawal : [];
        defined.forEach((field: any) => {
          pushExtra(field?.name, extrasObj[field?.name as keyof typeof extrasObj]);
        });
      }

      Object.keys(extrasObj).forEach((key) => {
        pushExtra(key, extrasObj[key]);
      });

      const extrasLookup: Record<string, true> = {};
      orderedExtras.forEach((extra) => {
        const key = typeof extra.label === "string" ? extra.label.trim().toLowerCase() : "";
        if (key) extrasLookup[key] = true;
      });

      return {
        ...x,
        receiptFile: first,
        _receipts: (x.receipts || []).map((r: any) => ({ id: r.id, path: r.path })),
        _receiptCount: Array.isArray(x.receipts) ? x.receipts.length : 0,
        _extrasList: orderedExtras,
        _extrasLookup: extrasLookup,
      };
    })
  );

  return {
    total,
    items,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
    query: q,
  };
}

function csvEscape(v: any): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "string" ? v : JSON.stringify(v);
  s = s.replace(/\r/g, "").replace(/\n/g, "\n");
  const mustQuote = /[",\n]/.test(s);
  if (mustQuote) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCSVRows(items: any[]) {
  const header = [
    "id",
    "referenceCode",
    "merchantName",
    "type",
    "status",
    "currency",
    "amountCents",
    "userEmail",
    "userPhone",
    "bankName",
    "hasReceipt",
    "createdAt",
    "updatedAt",
  ].join(",");
  const body = items
    .map((x: any) => {
      const hasReceipt = Array.isArray(x.receipts)
        ? x.receipts.length > 0
        : !!x.receiptFile;
      return [
        csvEscape(x.id),
        csvEscape(x.referenceCode || ""),
        csvEscape(x.merchant?.name || ""),
        csvEscape(x.type || ""),
        csvEscape(x.status || ""),
        csvEscape(x.currency || ""),
        csvEscape(String(x.amountCents ?? "")),
        csvEscape(x.user?.email || ""),
        csvEscape(x.user?.phone || ""),
        csvEscape(x.bankAccount?.bankName || ""),
        csvEscape(hasReceipt ? "yes" : "no"),
        csvEscape(x.createdAt?.toISOString() || ""),
        csvEscape(x.updatedAt?.toISOString() || ""),
      ].join(",");
    })
    .join("\n");
  return header + "\n" + body;
}

// ───────────────────────────────────────────────────────────────
// Helpers for API keys (fits your current schema + secretBox)
// ───────────────────────────────────────────────────────────────
function parseScopes(input: any): string[] {
  return String(input || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function genApiTokenParts(): { prefix: string; secret: string; token: string } {
  const prefix = crypto.randomBytes(6).toString("base64url"); // short public identifier
  const secret = crypto.randomBytes(24).toString("base64url"); // >=20 chars
  return { prefix, secret, token: `${prefix}.${secret}` };
}

// ───────────────────────────────────────────────────────────────
// Dynamic bank fields + promoted DB columns
// ───────────────────────────────────────────────────────────────

// Baseline BankAccount columns (NOT treated as "promoted")
const BASE_BANK_COLUMNS = [
  "id", "merchantId",
  "currency", "holderName", "bankName", "accountNo", "iban",
  "instructions", "method", "label",
  "fields", "active", "createdAt"
];
const BASE_BANK_SET = new Set(BASE_BANK_COLUMNS);

// Get promoted columns directly from Postgres
type PromotedCol = { name: string; pgType: string; input: "text"|"number"|"checkbox"|"date"|"textarea"|"url"|"email"|"tel" };
async function getPromotedColumns(): Promise<PromotedCol[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string; data_type: string; udt_name?: string }>>(
    `
      select column_name, data_type, udt_name
      from information_schema.columns
      where table_name = 'BankAccount'
        and table_schema = current_schema()
      order by ordinal_position
    `
  );

  const mapInput = (dt: string, udt?: string): PromotedCol["input"] => {
    const t = (dt || "").toLowerCase();
    const u = (udt || "").toLowerCase();
    if (t === "boolean") return "checkbox";
    if (t.includes("timestamp") || t === "date") return "date";
    if (t.includes("int") || t === "numeric" || u === "int4" || u === "int8" || u === "decimal") return "number";
    // default to text
    return "text";
  };

  return (rows || [])
    .filter(r => !BASE_BANK_SET.has(r.column_name))
    .map(r => ({ name: r.column_name, pgType: r.data_type, input: mapInput(r.data_type, r.udt_name) }));
}

// Build { core, extra[] } from the POST body (now dynamic: any `core_visible_*` / `core_label_*` / `core_order_*`)
function buildFieldsFromBody(body: any) {
  const core: Record<string, any> = {};

  Object.keys(body || {}).forEach((k) => {
    if (k.startsWith("core_visible_")) {
      const key = k.slice("core_visible_".length);
      const vis = truthy(body[k]);
      core[key] = core[key] || {};
      core[key].visible = vis;
    }
  });
  Object.keys(body || {}).forEach((k) => {
    if (k.startsWith("core_label_")) {
      const key = k.slice("core_label_".length);
      const raw = body[k];
      const label = typeof raw === "string" ? raw.trim() : "";
      if (label) {
        core[key] = core[key] || {};
        core[key].label = label;
      }
    }
  });
  // capture per-core order (from drag/drop)
  Object.keys(body || {}).forEach((k) => {
    if (k.startsWith("core_order_")) {
      const key = k.slice("core_order_".length);
      const n = Number(body[k]);
      if (Number.isFinite(n)) {
        core[key] = core[key] || {};
        core[key].order = n;
      }
    }
  });

  // Arrays posted from the Additional Fields table
  const labels = ([] as string[])
    .concat(body["extra_label[]"] ?? body.extra_label ?? [])
    .filter(Boolean);

  const types = ([] as string[])
    .concat(body["extra_type[]"] ?? body.extra_type ?? [])
    .filter(() => true);

  const values = ([] as string[])
    .concat(body["extra_value[]"] ?? body.extra_value ?? [])
    .filter(() => true);

  const visible = ([] as any[])
    .concat(body["extra_visible[]"] ?? body.extra_visible ?? [])
    .filter(() => true);

  const orders = ([] as any[])
    .concat(body["extra_order[]"] ?? body.extra_order ?? [])
    .filter(() => true);

  const keys = ([] as string[])
    .concat(body["extra_key[]"] ?? body.extra_key ?? [])
    .filter(() => true);

  const n = Math.max(labels.length, types.length, values.length);
  const extra: any[] = [];
  for (let i = 0; i < n; i++) {
    const label = String(labels[i] ?? "").trim();
    if (!label) continue; // skip blank rows

    const type = String(types[i] ?? "text").trim().toLowerCase();
    const value = String(values[i] ?? "");
    const vis = truthy(visible[i]);
    const order = Number(orders[i] ?? i);
    const key = (keys[i] && String(keys[i]).trim()) || slug(label);

    extra.push({ key, label, type, value, visible: vis, order });
  }

  return { core, extra };
}

// >>> NEW: make orders unique & stable (10,20,30,...) both for core and extra
function normalizeFieldOrders<T extends { core: Record<string, any>; extra: any[] }>(fields: T): T {
  const coreEntries = Object.entries(fields.core || {}).map(([k, v]) => {
    const o = Number((v && v.order) ?? Number.POSITIVE_INFINITY);
    return { k, v, o: Number.isFinite(o) ? o : Number.POSITIVE_INFINITY };
  });
  coreEntries.sort((a, b) => (a.o - b.o) || a.k.localeCompare(b.k));
  const coreOut: Record<string, any> = {};
  coreEntries.forEach((e, idx) => {
    coreOut[e.k] = { ...e.v, order: (idx + 1) * 10 };
  });

  const extraArr = Array.isArray(fields.extra) ? fields.extra.slice() : [];
  extraArr.sort((a, b) => {
    const ao = Number((a && a.order) ?? Number.POSITIVE_INFINITY);
    const bo = Number((b && b.order) ?? Number.POSITIVE_INFINITY);
    return (ao - bo);
  });
  extraArr.forEach((x, idx) => { x.order = (idx + 1) * 10; });

  return { ...(fields as any), core: coreOut, extra: extraArr };
}

function truthy(v: any): boolean {
  const s = String(v ?? "").toLowerCase();
  return s === "on" || s === "true" || s === "1" || s === "yes";
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "field"
  );
}

// ───────────────────────────────────────────────────────────────
// Dashboard
// ───────────────────────────────────────────────────────────────
superAdminRouter.get("/", async (_req, res) => {
  const awaitingStatuses: Array<'PENDING' | 'SUBMITTED'> = ["PENDING", "SUBMITTED"];
  const [admins, merchants, pending, logs] = await Promise.all([
    prisma.adminUser.count(),
    prisma.merchant.count(),
    prisma.paymentRequest.count({ where: { status: { in: awaitingStatuses } } }),
    prisma.adminAuditLog.count(),
  ]);
  res.render("superadmin/dashboard", {
    title: "Super Admin",
    metrics: { admins, merchants, pending, logs },
  });
});

// ───────────────────────────────────────────────────────────────
// Admin users CRUD
// ───────────────────────────────────────────────────────────────
superAdminRouter.get("/admins", async (_req, res) => {
  const admins = await prisma.adminUser.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      active: true,
      displayName: true,
      createdAt: true,
      lastLoginAt: true,
      twoFactorEnabled: true,
      canViewUserDirectory: true,
    },
  });
  res.render("superadmin/admins", { title: "Admin Users", admins });
});

superAdminRouter.get("/admins/new", (_req, res) =>
  res.render("superadmin/admin-edit", { title: "New Admin", admin: null })
);

superAdminRouter.post("/admins/new", async (req, res) => {
  const { email, displayName, password, role, active, canViewUsers } = req.body || {};
  const roleNorm = String(role || "ADMIN").toUpperCase();
  const allowed = new Set(["SUPER", "ADMIN", "SUPPORT"]);
  const safeRole = allowed.has(roleNorm) ? roleNorm : "ADMIN";
  const passwordHash = bcrypt.hashSync(String(password || "changeme123"), 10);
  const allowUsers = canViewUsers === "on";

  const created = await prisma.adminUser.create({
    data: {
      email,
      displayName: displayName || null,
      passwordHash,
      role: safeRole,
      active: active === "on",
      canViewUserDirectory: allowUsers,
    },
  });

  await auditAdmin(req, "admin.create", "ADMIN", created.id, {
    email,
    role: safeRole,
    active: !!active,
    canViewUsers: allowUsers,
  });

  res.redirect("/superadmin/admins");
});

superAdminRouter.get("/admins/:id/edit", async (req, res) => {
  const admin = await prisma.adminUser.findUnique({
    where: { id: req.params.id },
  });
  if (!admin) return res.status(404).send("Not found");
  res.render("superadmin/admin-edit", { title: "Edit Admin", admin });
});

superAdminRouter.post("/admins/:id/edit", async (req, res) => {
  const { email, displayName, role, active, password, canViewUsers } = req.body || {};
  const roleNorm = String(role || "ADMIN").toUpperCase();
  const allowed = new Set(["SUPER", "ADMIN", "SUPPORT"]);
  const safeRole = allowed.has(roleNorm) ? roleNorm : "ADMIN";
  const allowUsers = canViewUsers === "on";

  const data: any = {
    email,
    displayName: displayName || null,
    role: safeRole,
    active: active === "on",
    canViewUserDirectory: allowUsers,
  };
  if (password) data.passwordHash = bcrypt.hashSync(password, 10);

  const before = await prisma.adminUser.findUnique({
    where: { id: req.params.id },
  });
  await prisma.adminUser.update({ where: { id: req.params.id }, data });
  await auditAdmin(req, "admin.update", "ADMIN", req.params.id, {
    changed: Object.keys(data),
    previous: { role: before?.role, active: before?.active, canViewUsers: before?.canViewUserDirectory },
  });

  res.redirect("/superadmin/admins");
});

superAdminRouter.post("/admins/:id/reset-2fa", async (req, res) => {
  await prisma.adminUser.update({
    where: { id: req.params.id },
    data: {
      twoFactorEnabled: false,
      totpSecret: null,
      superTwoFactorEnabled: false,
      superTotpSecret: null,
    },
  });
  await auditAdmin(req, "admin.2fa.reset", "ADMIN", req.params.id);
  res.redirect("/superadmin/admins");
});

superAdminRouter.post("/admins/:id/delete", async (req, res) => {
  const id = req.params.id;
  const a = await prisma.adminUser.findUnique({ where: { id } });
  await prisma.adminUser.delete({ where: { id } });
  await auditAdmin(req, "admin.delete", "ADMIN", id, { email: a?.email });
  res.redirect("/superadmin/admins");
});

// Create a password reset link for an Admin
superAdminRouter.post("/admins/:id/force-reset", async (req, res) => {
  const id = req.params.id;
  const admin = await prisma.adminUser.findUnique({ where: { id } });
  if (!admin) return res.status(404).send("Not found");

  const token = crypto.randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + 1000 * 60 * 30); // 30 min

  await prisma.adminPasswordReset.create({
    data: { adminId: id, token, expiresAt: expires },
  });

  await auditAdmin(req, "admin.password.resetLink", "ADMIN", id);

  const base = process.env.BASE_URL || "http://localhost:4000";
  const link = `${base}/auth/admin/reset?token=${token}`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<html><body style="font-family:ui-sans-serif,system-ui">
    <p>Reset link for <strong>${admin.email}</strong> (valid 30 minutes):</p>
    <p><a href="${link}">${link}</a></p>
    <p><a href="/superadmin/admins">Back</a></p>
  </body></html>`);
});

// ───────────────────────────────────────────────────────────────
// Merchants CRUD + limits
// ───────────────────────────────────────────────────────────────
superAdminRouter.get("/merchants", async (_req, res) => {
  const merchants = await prisma.merchant.findMany({
    orderBy: { createdAt: "desc" },
    include: { limits: true },
  });
  res.render("superadmin/merchants", { title: "Merchants", merchants });
});

superAdminRouter.get("/merchants/new", (_req, res) => {
  res.render("superadmin/merchant-edit", {
    title: "New Merchant",
    merchant: null,
    limits: null,
    channels: [],
  });
});

superAdminRouter.post("/merchants/new", async (req, res) => {
  const { name, webhookUrl, status, email, defaultCurrency, active, userDirectoryEnabled } =
    req.body || {};

  const m = await prisma.merchant.create({
    data: {
      name,
      webhookUrl: (webhookUrl || "").trim() || null,
      status: status || "active",
      email: (email || "").trim() || null,
      defaultCurrency: (defaultCurrency || "USD").trim().toUpperCase(),
      active: active === "on",
      userDirectoryEnabled: userDirectoryEnabled === "on",
    },
  });

  await auditAdmin(req, "merchant.create", "MERCHANT", m.id, {
    name,
    status: m.status,
  });

  res.redirect("/superadmin/merchants");
});

// Edit form
superAdminRouter.get("/merchants/:id/edit", async (req, res) => {
  const id = req.params.id;

  const merchant = await prisma.merchant.findUnique({
    where: { id },
    include: { limits: true },
  });
  if (!merchant) return res.status(404).send("Not found");

  // Optional: show "just created" credentials once
  let newCreds: null | { email: string; password: string } = null;
  const credsB64 = String(req.query?.creds || "");
  if (credsB64) {
    try {
      const json = Buffer.from(credsB64, "base64url").toString("utf8");
      const parsed = JSON.parse(json);
      if (parsed?.email && parsed?.password)
        newCreds = { email: parsed.email, password: parsed.password };
    } catch {}
  }

  // Optional: show "just created" API key once
  let newApiKey: null | string = null;
  const keyB64 = String(req.query?.apiKey || "");
  if (keyB64) {
    try {
      const json = Buffer.from(keyB64, "base64url").toString("utf8");
      const parsed = JSON.parse(json);
      if (parsed?.token) newApiKey = String(parsed.token);
    } catch {}
  }

  const notifModel = (prisma as any).notificationChannel;
  const keysModel = (prisma as any).merchantApiKey;

  const channels =
    notifModel && typeof notifModel.findMany === "function"
      ? await notifModel.findMany({
          where: { merchantId: id },
          orderBy: { createdAt: "desc" },
        })
      : [];

  let apiKeys: any[] = [];
  if (keysModel && typeof keysModel.findMany === "function") {
    try {
      apiKeys = await keysModel.findMany({
        where: { merchantId: id },
        orderBy: { createdAt: "desc" } as any,
      });
    } catch {
      apiKeys = await keysModel.findMany({ where: { merchantId: id } });
    }
  }

  res.render("superadmin/merchant-edit", {
    title: "Edit Merchant",
    merchant,
    limits: merchant.limits,
    channels,
    saved: req.query?.saved ? true : false,
    newCreds,
    apiKeys,
    newApiKey,
  });
});

superAdminRouter.post("/merchants/:id/edit", async (req, res) => {
  const { name, status, email, defaultCurrency, active, userDirectoryEnabled, apiKeysSelfServiceEnabled } = req.body || {};
  const website = (req.body?.webhookUrl || req.body?.website || "").trim();

  const before = await prisma.merchant.findUnique({
    where: { id: req.params.id },
  });

  await prisma.merchant.update({
    where: { id: req.params.id },
    data: {
      name,
      webhookUrl: website || null,
      status: status || "active",
      email: (email || "").trim() || null,
      defaultCurrency: (defaultCurrency || "USD").trim().toUpperCase(),
      active: active === "on",
      userDirectoryEnabled: userDirectoryEnabled === "on",
      apiKeysSelfServiceEnabled: apiKeysSelfServiceEnabled === "on",
    },
  });

  await auditAdmin(req, "merchant.update", "MERCHANT", req.params.id, {
    changed: {
      name,
      webhookUrl: website || null,
      status: status || "active",
      email: (email || "").trim() || null,
      defaultCurrency: (defaultCurrency || "USD").trim().toUpperCase(),
      active: active === "on",
      userDirectoryEnabled: userDirectoryEnabled === "on",
      apiKeysSelfServiceEnabled: apiKeysSelfServiceEnabled === "on",
    },
    previous: {
      name: before?.name,
      status: before?.status,
      active: (before as any)?.active,
      userDirectoryEnabled: (before as any)?.userDirectoryEnabled,
      apiKeysSelfServiceEnabled: (before as any)?.apiKeysSelfServiceEnabled,
    },
  });

  res.redirect(`/superadmin/merchants/${req.params.id}/edit?saved=1`);
});

superAdminRouter.post("/merchants/:id/user-directory", async (req, res) => {
  const id = req.params.id;
  const action = String(req.body?.action || "").toLowerCase();
  const enable = action !== "disable";

  const updated = await prisma.merchant.update({
    where: { id },
    data: { userDirectoryEnabled: enable },
  });

  await auditAdmin(
    req,
    enable ? "merchant.userDirectory.enable" : "merchant.userDirectory.disable",
    "MERCHANT",
    id,
    { userDirectoryEnabled: updated.userDirectoryEnabled }
  );

  res.redirect("/superadmin/merchants");
});

superAdminRouter.get("/users", async (req, res) => {
  const query = superUserQuery.parse(req.query);
  const merchants = await prisma.merchant.findMany({
    select: { id: true, name: true, userDirectoryEnabled: true },
    orderBy: { name: "asc" },
  });

  const requested = normalizeMerchantFilter(query.merchantId);
  const merchantIds = requested.length ? requested : merchants.map((m) => m.id);

  const table = merchantIds.length
    ? await getUserDirectory({ merchantIds, search: query.q || null, page: query.page, perPage: query.perPage })
    : { total: 0, page: 1, perPage: 25, pages: 1, items: [] };

  res.render("superadmin/users", {
    title: "Clients",
    table,
    query,
    merchants,
    selectedIds: merchantIds,
    rawQuery: req.query,
  });
});

superAdminRouter.get("/export/users.csv", async (req, res) => {
  const query = superUserQuery.parse(req.query);
  const merchantIds = normalizeMerchantFilter(query.merchantId);
  const merchants = merchantIds.length ? merchantIds : (await prisma.merchant.findMany({ select: { id: true } })).map((m) => m.id);
  const items = await collectUsersForSuperAdmin(merchants, query.q || null);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="clients.csv"');
  const csv = stringify({
    header: true,
    columns: ["userId","fullName","email","phone","status","registeredAt","lastActivity","merchants"],
  });
  csv.pipe(res);
  items.forEach((user) => {
    csv.write({
      userId: user.publicId,
      fullName: user.fullName || "",
      email: user.email || "",
      phone: user.phone || "",
      status: user.verificationStatus,
      registeredAt: user.registeredAt.toISOString(),
      lastActivity: user.lastActivityAt ? user.lastActivityAt.toISOString() : "",
      merchants: user.merchants.map((m) => m.name).join(", "),
    });
  });
  csv.end();
});

superAdminRouter.get("/export/users.xlsx", async (req, res) => {
  const query = superUserQuery.parse(req.query);
  const merchantIds = normalizeMerchantFilter(query.merchantId);
  const merchants = merchantIds.length ? merchantIds : (await prisma.merchant.findMany({ select: { id: true } })).map((m) => m.id);
  const items = await collectUsersForSuperAdmin(merchants, query.q || null);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Clients");
  ws.columns = [
    { header: "User ID", key: "userId", width: 16 },
    { header: "Full name", key: "fullName", width: 24 },
    { header: "Email", key: "email", width: 24 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Status", key: "status", width: 14 },
    { header: "Registered", key: "registeredAt", width: 24 },
    { header: "Last activity", key: "lastActivity", width: 24 },
    { header: "Merchants", key: "merchants", width: 30 },
  ];
  items.forEach((user) => {
    ws.addRow({
      userId: user.publicId,
      fullName: user.fullName || "",
      email: user.email || "",
      phone: user.phone || "",
      status: user.verificationStatus,
      registeredAt: user.registeredAt,
      lastActivity: user.lastActivityAt || null,
      merchants: user.merchants.map((m) => m.name).join(", "),
    });
  });
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",'attachment; filename="clients.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

superAdminRouter.get("/export/users.pdf", async (req, res) => {
  const query = superUserQuery.parse(req.query);
  const merchantIds = normalizeMerchantFilter(query.merchantId);
  const merchants = merchantIds.length ? merchantIds : (await prisma.merchant.findMany({ select: { id: true } })).map((m) => m.id);
  const items = await collectUsersForSuperAdmin(merchants, query.q || null);
  const pdf = renderUserDirectoryPdf(items);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="clients.pdf"');
  res.end(pdf);
});

// Merchant limits (rate & IP allow list)
superAdminRouter.post("/merchants/:id/limits", async (req, res) => {
  const { maxReqPerMin, ipAllowList } = req.body || {};
  const ips = String(ipAllowList || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const row = await prisma.merchantLimits.upsert({
    where: { merchantId: req.params.id },
    update: {
      maxReqPerMin: maxReqPerMin ? Number(maxReqPerMin) : null,
      ipAllowList: ips,
    },
    create: {
      merchantId: req.params.id,
      maxReqPerMin: maxReqPerMin ? Number(maxReqPerMin) : null,
      ipAllowList: ips,
    },
  });

  await auditAdmin(req, "merchant.limits.upsert", "MERCHANT", req.params.id, row);

  res.redirect(`/superadmin/merchants/${req.params.id}/edit?saved=1`);
});

// ───────────────────────────────────────────────────────────────
// Banks CRUD (Super Admin)
// ───────────────────────────────────────────────────────────────

// allow any future method; normalize to UPPERCASE string
const bankSchema = z.object({
  merchantId: z
    .string()
    .optional()
    .transform((v) => (v && v !== "global" ? v : null)),
  currency: z
    .string()
    .min(3)
    .max(4)
    .transform((s) => s.toUpperCase()),
  method: z
    .string()
    .min(2)
    .max(32)
    .transform((s) => s.toUpperCase()),
  label: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v.trim() || null : null)),
  holderName: z.string().min(2),
  bankName: z.string().min(2),
  accountNo: z.string().min(3),
  iban: z.string().optional().nullable(),
  instructions: z.string().optional().nullable(),
  active: z
    .union([z.literal("on"), z.literal("true"), z.literal("1")])
    .optional()
    .transform((v) => !!v),
});

// Utility to coerce posted strings into the right JS values for promoted columns
function coerceByInputType(input: PromotedCol["input"], raw: any) {
  if (raw == null) return null;
  const v = String(raw);
  if (input === "checkbox") return truthy(v);
  if (input === "number") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (input === "date") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  // text-like
  const s = v.trim();
  return s === "" ? null : s;
}

// List
superAdminRouter.get("/banks", async (req: any, res: any) => {
  const qMerchant = (req.query.merchantId as string) || "";
  const qCurrency = (req.query.currency as string) || "";
  const qMethod = (req.query.method as string) || ""; // NEW
  const qActive = (req.query.active as string) || ""; // "", "true", "false"

  const where: any = {};
  if (qMerchant) where.merchantId = qMerchant === "global" ? null : qMerchant;
  if (qCurrency) where.currency = qCurrency.toUpperCase();
  if (qMethod) where.method = qMethod.toUpperCase();
  if (qActive) where.active = qActive === "true";

  const [merchants, banksRaw, usedCounts] = await Promise.all([
    prisma.merchant.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.bankAccount.findMany({
      where,
      orderBy: [
        { merchantId: "asc" },
        { currency: "asc" },
        { method: "asc" }, // NEW
        { createdAt: "desc" },
      ] as any,
      select: {
        id: true,
        publicId: true,
        merchantId: true,
        currency: true,
        method: true, // NEW
        label: true, // NEW
        holderName: true,
        bankName: true,
        accountNo: true,
        iban: true,
        instructions: true,
        active: true,
        createdAt: true,
      },
    }),
    prisma.paymentRequest.groupBy({
      by: ["bankAccountId"],
      _count: { _all: true },
      where: { bankAccountId: { not: null } },
    }),
  ]);

  const countMap = new Map<string, number>();
  for (const g of usedCounts)
    countMap.set(String(g.bankAccountId), Number(g._count?._all || 0));

  const banks = banksRaw.map((b) => ({
    ...b,
    _count: { payments: countMap.get(b.id) || 0 },
  }));

  res.render("superadmin/banks", {
    title: "Banks",
    merchants,
    banks,
    filters: { qMerchant, qCurrency, qMethod, qActive },
  });
});

// New
superAdminRouter.get("/banks/new", async (_req: any, res: any) => {
  const [merchants, promotedCols] = await Promise.all([
    prisma.merchant.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getPromotedColumns(),
  ]);
  res.render("superadmin/bank-edit", {
    title: "New Bank",
    bank: null,
    merchants,
    errors: null,
    promotedCols,
  });
});

superAdminRouter.post("/banks", async (req: any, res: any) => {
  let data: z.infer<typeof bankSchema>;
  const promotedCols = await getPromotedColumns();

  try {
    data = bankSchema.parse(req.body);
  } catch (e: any) {
    const merchants = await prisma.merchant.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return res.status(400).render("superadmin/bank-edit", {
      title: "New Bank",
      bank: req.body,
      merchants,
      errors: e?.errors || [{ message: "Invalid input" }],
      promotedCols,
    });
  }

  // parse dynamic field visibility/labels/orders + promoted column values
  const fieldsRaw = buildFieldsFromBody(req.body);
  const fields = normalizeFieldOrders(fieldsRaw); // <<< normalize ties & gaps

  const promotedData: Record<string, any> = {};
  for (const col of promotedCols) {
    if (Object.prototype.hasOwnProperty.call(req.body, col.name)) {
      promotedData[col.name] = coerceByInputType(col.input, req.body[col.name]);
    }
  }

  const created = await prisma.bankAccount.create({
    data: {
      publicId: generateBankPublicId(),
      ...data,
      ...promotedData,
      fields,
    } as any,
  });
  try {
    await auditAdmin(req, "super:banks.create", "BANK", created.id, {
      ...data,
      ...promotedData,
      fields,
      id: created.id,
    });
  } catch {}

  return res.redirect("/superadmin/banks");
});

// Edit
superAdminRouter.get("/banks/:id/edit", async (req: any, res: any) => {
  const [bank, merchants, promotedCols] = await Promise.all([
    prisma.bankAccount.findUnique({ where: { id: req.params.id } }),
    prisma.merchant.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getPromotedColumns(),
  ]);
  if (!bank) return res.status(404).send("Not found");
  res.render("superadmin/bank-edit", {
    title: `Edit Bank ${bank.publicId}`,
    bank,
    merchants,
    errors: null,
    promotedCols,
  });
});

superAdminRouter.post("/banks/:id", async (req: any, res: any) => {
  const promotedCols = await getPromotedColumns();

  // Editable columns include the fixed set plus promoted ones
  const editableCols = ["holderName", "bankName", "accountNo", "iban", "label", ...promotedCols.map(c => c.name)] as const;

  const existing = await prisma.bankAccount.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) return res.status(404).send("Not found");

  const merged: any = { ...req.body };
  editableCols.forEach((k) => {
    const delFlag = String(req.body?.[`core_deleted_${k}`] ?? "") === "1";
    const raw = req.body?.[k as any];
    const missing = raw == null || String(raw).trim?.() === "";
    if ((delFlag || missing) && Object.prototype.hasOwnProperty.call(existing, k)) {
      merged[k as any] = (existing as any)[k] ?? "";
    }
  });

  let data: z.infer<typeof bankSchema>;
  try {
    data = bankSchema.parse(merged);
  } catch (e: any) {
    const merchants = await prisma.merchant.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return res.status(400).render("superadmin/bank-edit", {
      title: `Edit Bank ${existing.publicId}`,
      bank: { ...existing, ...merged },
      merchants,
      errors: e?.errors || [{ message: "Invalid input" }],
      promotedCols,
    });
  }

  // dynamic fields JSON
  const fieldsRaw = buildFieldsFromBody(req.body);
  const fields = normalizeFieldOrders(fieldsRaw); // <<< normalize on update too

  // promoted column values
  const promotedData: Record<string, any> = {};
  for (const col of promotedCols) {
    if (Object.prototype.hasOwnProperty.call(req.body, col.name)) {
      promotedData[col.name] = coerceByInputType(col.input, req.body[col.name]);
    }
  }

  const updated = await prisma.bankAccount.update({
    where: { id: req.params.id },
    data: { ...data, ...promotedData, fields } as any,
  });
  try {
    await auditAdmin(req, "super:banks.update", "BANK", updated.id, { ...data, ...promotedData, fields });
  } catch {}

  return res.redirect("/superadmin/banks");
});

// Toggle active
superAdminRouter.post("/banks/:id/toggle", async (req: any, res: any) => {
  const bank = await prisma.bankAccount.findUnique({
    where: { id: req.params.id },
    select: { id: true, active: true },
  });
  if (!bank) return res.status(404).send("Not found");
  const updated = await prisma.bankAccount.update({
    where: { id: bank.id },
    data: { active: !bank.active },
  });
  try {
    await auditAdmin(req, "super:banks.toggle", "BANK", updated.id, {
      active: updated.active,
    });
  } catch {}
  res.redirect("/superadmin/banks");
});

// Soft delete (active=false) if used by payments; else hard delete
superAdminRouter.post("/banks/:id/delete", async (req: any, res: any) => {
  const usage = await prisma.paymentRequest.count({
    where: { bankAccountId: req.params.id },
  });
  if (usage > 0) {
    const updated = await prisma.bankAccount.update({
      where: { id: req.params.id },
      data: { active: false },
    });
    try {
      await auditAdmin(req, "super:banks.soft_delete", "BANK", updated.id);
    } catch {}
  } else {
    await prisma.bankAccount.delete({ where: { id: req.params.id } });
    try {
      await auditAdmin(req, "super:banks.delete", "BANK", req.params.id);
    } catch {}
  }
  res.redirect("/superadmin/banks");
});

// CSV export
superAdminRouter.get("/banks.csv", async (_req: any, res: any) => {
  const rows = await prisma.bankAccount.findMany({
    orderBy: [{ merchantId: "asc" }, { currency: "asc" }, { method: "asc" }],
    include: { merchant: { select: { name: true } } },
  });

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="banks.csv"');

  res.write(
    "id,publicId,merchant,currency,method,label,holderName,bankName,accountNo,iban,active,createdAt\n"
  );
  for (const r of rows) {
    const line = [
      r.id,
      r.publicId,
      r.merchant?.name ?? "GLOBAL",
      r.currency,
      r.method,
      r.label ?? "",
      r.holderName,
      r.bankName,
      r.accountNo,
      r.iban ?? "",
      r.active ? "true" : "false",
      r.createdAt.toISOString(),
    ]
      .map((v) => String(v).replace(/"/g, '""'))
      .map((v) => `"${v}"`)
      .join(",");
    res.write(line + "\n");
  }
  res.end();
});

// ───────────────────────────────────────────────────────────────
// Notification channels
// ───────────────────────────────────────────────────────────────
superAdminRouter.post("/merchants/:id/notify/add", async (req, res) => {
  const notifModel = (prisma as any).notificationChannel;
  if (!notifModel || typeof notifModel.create !== "function") {
    return res
      .status(501)
      .send("Notification channels are not enabled in this build.");
  }

  const { type, chatId, direction } = req.body || {};
  await notifModel.create({
    data: {
      merchantId: req.params.id,
      type: String(type || "TELEGRAM"),
      chatId: String(chatId || ""),
      direction: String(direction || "BOTH"),
    },
  });
  await auditAdmin(req, "merchant.notify.add", "MERCHANT", req.params.id, {
    type,
    chatId,
    direction,
  });
  res.redirect(`/superadmin/merchants/${req.params.id}/edit?saved=1`);
});

superAdminRouter.post(
  "/merchants/:id/notify/:nid/delete",
  async (req, res) => {
    const notifModel = (prisma as any).notificationChannel;
    if (!notifModel || typeof notifModel.delete !== "function") {
      return res
        .status(501)
        .send("Notification channels are not enabled in this build.");
    }

    await notifModel.delete({ where: { id: req.params.nid } });
    await auditAdmin(req, "merchant.notify.delete", "MERCHANT", req.params.id, {
      channelId: req.params.nid,
    });
    res.redirect(`/superadmin/merchants/${req.params.id}/edit?saved=1`);
  }
);

// ───────────────────────────────────────────────────────────────
// Merchant Clients (CRUD, 2FA reset, password reset)
// ───────────────────────────────────────────────────────────────
const MERCHANT_ROLES = new Set(["OWNER", "MANAGER", "ANALYST"]);

// list
superAdminRouter.get("/merchants/:id/users", async (req, res) => {
  const merchant = await prisma.merchant.findUnique({
    where: { id: req.params.id },
  });
  if (!merchant) return res.status(404).send("Not found");

  const users = await prisma.merchantUser.findMany({
    where: { merchantId: req.params.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      active: true,
      twoFactorEnabled: true,
      createdAt: true,
      lastLoginAt: true,
      canViewUserDirectory: true,
    },
  });

  // decode one-time creds if present
  let newCreds: null | { email: string; password: string } = null;
  const credsB64 = String(req.query?.creds || "");
  if (credsB64) {
    try {
      const json = Buffer.from(credsB64, "base64url").toString("utf8");
      const parsed = JSON.parse(json);
      if (parsed?.email && parsed?.password)
        newCreds = { email: parsed.email, password: parsed.password };
    } catch {}
  }

  res.render("superadmin/merchant-users", {
    title: `Merchant Clients – ${merchant.name}`,
    merchant,
    users,
    newCreds,
    query: req.query || {},
    backUrl: `/superadmin/merchants/${merchant.id}/edit`,
  });
});

// new form
superAdminRouter.get("/merchants/:id/users/new", async (req, res) => {
  const merchant = await prisma.merchant.findUnique({
    where: { id: req.params.id },
  });
  if (!merchant) return res.status(404).send("Not found");
  res.render("superadmin/merchant-user-edit", {
    title: "New Merchant Client",
    merchant,
    user: null,
  });
});

// create
superAdminRouter.post("/merchants/:id/users/new", async (req, res) => {
  const merchantId = req.params.id;
  const { email, password, role, active, generate, canViewUsers } = req.body || {};

  const safeRole = MERCHANT_ROLES.has(String(role).toUpperCase())
    ? String(role).toUpperCase()
    : "MANAGER";

  const emailNorm = String(email || "").trim().toLowerCase();
  const willGenerate = generate === "on" || !password;
  const tempPassword = willGenerate
    ? crypto.randomBytes(10).toString("base64url")
    : String(password);

  const passwordHash = bcrypt.hashSync(tempPassword, 10);

  const allowUsers = canViewUsers === "on";

  const u = await prisma.merchantUser.create({
    data: {
      merchantId,
      email: emailNorm,
      passwordHash,
      role: safeRole as any,
      active: active === "on",
      canViewUserDirectory: allowUsers,
    },
  });

  await auditAdmin(req, "merchantUser.create", "MERCHANT_USER", u.id, {
    merchantId,
    email: emailNorm,
    role: safeRole,
    active: !!active,
    canViewUsers: allowUsers,
    autoGenerated: willGenerate,
  });

  const creds = Buffer.from(
    JSON.stringify({ email: emailNorm, password: tempPassword }),
    "utf8"
  ).toString("base64url");
  if (req.query?.from === "edit") {
    return res.redirect(
      `/superadmin/merchants/${merchantId}/edit?creds=${creds}`
    );
  }
  return res.redirect(
    `/superadmin/merchants/${merchantId}/users?creds=${creds}`
  );
});

// edit form
superAdminRouter.get("/merchants/:id/users/:uid/edit", async (req, res) => {
  const merchant = await prisma.merchant.findUnique({
    where: { id: req.params.id },
  });
  const user = await prisma.merchantUser.findUnique({
    where: { id: req.params.uid },
  });
  if (!merchant || !user || user.merchantId !== merchant.id)
    return res.status(404).send("Not found");

  res.render("superadmin/merchant-user-edit", {
    title: "Edit Merchant Client",
    merchant,
    user,
  });
});

// edit
superAdminRouter.post("/merchants/:id/users/:uid/edit", async (req, res) => {
  const merchantId = req.params.id;
  const userId = req.params.uid;
  const { email, role, active, password, canViewUsers } = req.body || {};
  const safeRole = MERCHANT_ROLES.has(String(role).toUpperCase())
    ? String(role).toUpperCase()
    : "MANAGER";
  const allowUsers = canViewUsers === "on";

  const data: any = {
    email: String(email || "").trim().toLowerCase(),
    role: safeRole as any,
    active: active === "on",
    canViewUserDirectory: allowUsers,
  };
  if (password) data.passwordHash = bcrypt.hashSync(password, 10);

  const before = await prisma.merchantUser.findUnique({
    where: { id: userId },
  });
  await prisma.merchantUser.update({ where: { id: userId }, data });

  await auditAdmin(req, "merchantUser.update", "MERCHANT_USER", userId, {
    changed: Object.keys(data),
    previous: { role: before?.role, active: before?.active, canViewUsers: before?.canViewUserDirectory },
  });

  res.redirect(`/superadmin/merchants/${merchantId}/users`);
});

// reset 2FA
superAdminRouter.post(
  "/merchants/:id/users/:uid/reset-2fa",
  async (req, res) => {
    await prisma.merchantUser.update({
      where: { id: req.params.uid },
      data: { twoFactorEnabled: false, totpSecret: null },
    });
    await auditAdmin(req, "merchantUser.2fa.reset", "MERCHANT_USER", req.params.uid, {
      merchantId: req.params.id,
    });
    res.redirect(`/superadmin/merchants/${req.params.id}/users`);
  }
);

// force password reset (link)
superAdminRouter.post(
  "/merchants/:id/users/:uid/force-reset",
  async (req, res) => {
    const user = await prisma.merchantUser.findUnique({
      where: { id: req.params.uid },
    });
    if (!user || user.merchantId !== req.params.id)
      return res.status(404).send("Not found");

    const token = crypto.randomBytes(24).toString("base64url");
    const expires = new Date(Date.now() + 1000 * 60 * 30);

    await prisma.merchantPasswordReset.create({
      data: { merchantUserId: user.id, token, expiresAt: expires },
    });

    await auditAdmin(req, "merchantUser.password.resetLink", "MERCHANT_USER", user.id, {
      merchantId: user.merchantId,
    });

    const base = process.env.BASE_URL || "http://localhost:4000";
    const link = `${base}/auth/merchant/reset?token=${token}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<html><body style="font-family:ui-sans-serif,system-ui">
    <p>Reset link for <strong>${user.email}</strong> (valid 30 minutes):</p>
    <p><a href="${link}">${link}</a></p>
    <p><a href="/superadmin/merchants/${req.params.id}/users">Back</a></p>
  </body></html>`);
  }
);

// delete user
superAdminRouter.post(
  "/merchants/:id/users/:uid/delete",
  async (req, res) => {
    const user = await prisma.merchantUser.findUnique({
      where: { id: req.params.uid },
    });
    if (!user || user.merchantId !== req.params.id)
      return res.status(404).send("Not found");

    await prisma.merchantUser.delete({ where: { id: user.id } });
    await auditAdmin(req, "merchantUser.delete", "MERCHANT_USER", user.id, {
      merchantId: user.merchantId,
      email: user.email,
    });

    res.redirect(`/superadmin/merchants/${req.params.id}/users`);
  }
);

// ───────────────────────────────────────────────────────────────
// Merchant API Keys (list / create / revoke)
// ───────────────────────────────────────────────────────────────

// Create a new API key for a merchant (shows plaintext once via redirect param)
superAdminRouter.post("/merchants/:id/keys/new", async (req, res) => {
  const merchantId = req.params.id;
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
  });
  if (!merchant) return res.status(404).send("Not found");

  const scopes = parseScopes(req.body?.scopes);
  const { prefix, secret, token } = genApiTokenParts();

  const created = await prisma.merchantApiKey.create({
    data: {
      merchantId,
      prefix,
      secretEnc: seal(secret),
      last4: secret.slice(-4),
      scopes,
      active: true,
    },
  });

  await auditAdmin(req, "merchant.apiKey.create", "MERCHANT_API_KEY", created.id, {
    merchantId,
    prefix,
    scopes,
  });

  const apiKeyParam = Buffer.from(JSON.stringify({ token }), "utf8").toString(
    "base64url"
  );
  res.redirect(`/superadmin/merchants/${merchantId}/edit?apiKey=${apiKeyParam}`);
});

// Revoke an API key (set active=false)
superAdminRouter.post(
  "/merchants/:id/keys/:kid/revoke",
  async (req, res) => {
    const merchantId = req.params.id;
    const kid = req.params.kid;

    const k = await prisma.merchantApiKey.findUnique({ where: { id: kid } });
    if (!k || k.merchantId !== merchantId) {
      return res
        .status(404)
        .send("Key not found");
    }

    const updated = await prisma.merchantApiKey.update({
      where: { id: kid },
      data: { active: false },
    });

    await auditAdmin(req, "merchant.apiKey.revoke", "MERCHANT_API_KEY", kid, {
      merchantId,
      prefix: updated.prefix,
    });

    res.redirect(`/superadmin/merchants/${merchantId}/edit?saved=1`);
  }
);

// ───────────────────────────────────────────────────────────────
// Accounts — balances, settlements, topups
// ───────────────────────────────────────────────────────────────

superAdminRouter.get("/accounts", (_req, res) => {
  res.redirect("/superadmin/accounts/balance");
});

superAdminRouter.get("/accounts/balance", async (_req, res) => {
  const balances = await listMerchantBalances();
  res.render("superadmin/accounts-balance", {
    title: "Accounts · Balance",
    balances,
  });
});

function pickMerchantFilter(raw: unknown): string {
  if (Array.isArray(raw)) {
    const last = raw[raw.length - 1];
    return typeof last === "string" ? last.trim() : "";
  }
  if (typeof raw === "string") return raw.trim();
  return "";
}

function buildAccountViewModel(opts: {
  title: string;
  merchants: Awaited<ReturnType<typeof listMerchantBalances>>;
  entries: Awaited<ReturnType<typeof listAccountEntries>>;
  merchantId: string;
  success?: string | null;
  error?: string | null;
  form?: { merchantId?: string; amount?: string; method?: string; note?: string } | null;
}) {
  return {
    title: opts.title,
    merchants: opts.merchants,
    entries: opts.entries,
    filters: { merchantId: opts.merchantId },
    success: opts.success ?? null,
    error: opts.error ?? null,
    form: opts.form ?? null,
  };
}

superAdminRouter.get("/accounts/settlements", async (req, res) => {
  const merchantId = pickMerchantFilter(req.query?.merchantId);
  const { merchants, entries } = await loadAccountPageData("SETTLEMENT", merchantId || null);
  res.render(
    "superadmin/accounts-settlements",
    buildAccountViewModel({
      title: "Accounts · Settlements",
      merchants,
      entries,
      merchantId,
      success: typeof req.query?.success === "string" ? req.query.success : null,
    })
  );
});

superAdminRouter.post(
  "/accounts/settlements",
  upload.single("receipt"),
  async (req: any, res) => {
    const merchantId = pickMerchantFilter(req.body?.merchantId);
    const method = String(req.body?.method || "").trim();
    const note = String(req.body?.note || "").trim();
    const amountCents = parseAmountToCents(req.body?.amount ?? req.body?.amountCents);
    const adminId = req.admin?.sub ? String(req.admin.sub) : null;
    const file = req.file as Express.Multer.File | undefined;

    if (!merchantId) {
      if (file) await fs.unlink(file.path).catch(() => {});
      const { merchants, entries } = await loadAccountPageData("SETTLEMENT", null);
      return res.status(400).render(
        "superadmin/accounts-settlements",
        buildAccountViewModel({
          title: "Accounts · Settlements",
          merchants,
          entries,
          merchantId: "",
          error: "Merchant is required",
          form: { amount: String(req.body?.amount || ""), method, note },
        })
      );
    }

    if (amountCents === null) {
      if (file) await fs.unlink(file.path).catch(() => {});
      const { merchants, entries } = await loadAccountPageData("SETTLEMENT", merchantId);
      return res.status(400).render(
        "superadmin/accounts-settlements",
        buildAccountViewModel({
          title: "Accounts · Settlements",
          merchants,
          entries,
          merchantId,
          error: "Enter a valid amount",
          form: { merchantId, amount: String(req.body?.amount || ""), method, note },
        })
      );
    }

    try {
      await createAccountEntry({
        merchantId,
        type: "SETTLEMENT",
        amountCents,
        method,
        note,
        adminId,
        receipt: file
          ? {
              path: file.path,
              mimeType: file.mimetype,
              original: file.originalname,
              size: file.size,
            }
          : null,
      });

      await auditAdmin(req, "accounts.settlement.create", "MERCHANT", merchantId, {
        amountCents,
        method: method || null,
      });

      const params = new URLSearchParams();
      params.set("success", "created");
      if (merchantId) params.set("merchantId", merchantId);

      return res.redirect(`/superadmin/accounts/settlements?${params.toString()}`);
    } catch (err) {
      console.error(err);
      if (file) await fs.unlink(file.path).catch(() => {});
      const { merchants, entries } = await loadAccountPageData("SETTLEMENT", merchantId);
      return res.status(500).render(
        "superadmin/accounts-settlements",
        buildAccountViewModel({
          title: "Accounts · Settlements",
          merchants,
          entries,
          merchantId,
          error: err instanceof Error ? err.message : "Unable to create settlement",
          form: { merchantId, amount: String(req.body?.amount || ""), method, note },
        })
      );
    }
  }
);

superAdminRouter.get("/accounts/topups", async (req, res) => {
  const merchantId = pickMerchantFilter(req.query?.merchantId);
  const { merchants, entries } = await loadAccountPageData("TOPUP", merchantId || null);
  res.render(
    "superadmin/accounts-topups",
    buildAccountViewModel({
      title: "Accounts · Topups",
      merchants,
      entries,
      merchantId,
      success: typeof req.query?.success === "string" ? req.query.success : null,
    })
  );
});

superAdminRouter.post(
  "/accounts/topups",
  upload.single("receipt"),
  async (req: any, res) => {
    const merchantId = pickMerchantFilter(req.body?.merchantId);
    const method = String(req.body?.method || "").trim();
    const note = String(req.body?.note || "").trim();
    const amountCents = parseAmountToCents(req.body?.amount ?? req.body?.amountCents);
    const adminId = req.admin?.sub ? String(req.admin.sub) : null;
    const file = req.file as Express.Multer.File | undefined;

    if (!merchantId) {
      if (file) await fs.unlink(file.path).catch(() => {});
      const { merchants, entries } = await loadAccountPageData("TOPUP", null);
      return res.status(400).render(
        "superadmin/accounts-topups",
        buildAccountViewModel({
          title: "Accounts · Topups",
          merchants,
          entries,
          merchantId: "",
          error: "Merchant is required",
          form: { amount: String(req.body?.amount || ""), method, note },
        })
      );
    }

    if (amountCents === null) {
      if (file) await fs.unlink(file.path).catch(() => {});
      const { merchants, entries } = await loadAccountPageData("TOPUP", merchantId);
      return res.status(400).render(
        "superadmin/accounts-topups",
        buildAccountViewModel({
          title: "Accounts · Topups",
          merchants,
          entries,
          merchantId,
          error: "Enter a valid amount",
          form: { merchantId, amount: String(req.body?.amount || ""), method, note },
        })
      );
    }

    try {
      await createAccountEntry({
        merchantId,
        type: "TOPUP",
        amountCents,
        method,
        note,
        adminId,
        receipt: file
          ? {
              path: file.path,
              mimeType: file.mimetype,
              original: file.originalname,
              size: file.size,
            }
          : null,
      });

      await auditAdmin(req, "accounts.topup.create", "MERCHANT", merchantId, {
        amountCents,
        method: method || null,
      });

      const params = new URLSearchParams();
      params.set("success", "created");
      if (merchantId) params.set("merchantId", merchantId);

      return res.redirect(`/superadmin/accounts/topups?${params.toString()}`);
    } catch (err) {
      console.error(err);
      if (file) await fs.unlink(file.path).catch(() => {});
      const { merchants, entries } = await loadAccountPageData("TOPUP", merchantId);
      return res.status(500).render(
        "superadmin/accounts-topups",
        buildAccountViewModel({
          title: "Accounts · Topups",
          merchants,
          entries,
          merchantId,
          error: err instanceof Error ? err.message : "Unable to create topup",
          form: { merchantId, amount: String(req.body?.amount || ""), method, note },
        })
      );
    }
  }
);

// Payments — pages, edits, exports
// ───────────────────────────────────────────────────────────────

async function renderPaymentsPage(
  req: any,
  res: any,
  type: "DEPOSIT" | "WITHDRAWAL"
) {
  const q = req.query || {};
  const data = await fetchPayments(q, type);
  res.render("superadmin/payments", {
    title: type === "DEPOSIT" ? "Deposits" : "Withdrawals",
    type,
    ...data,
  });
}

superAdminRouter.get("/deposits", async (req, res) =>
  renderPaymentsPage(req, res, "DEPOSIT")
);
superAdminRouter.get("/withdrawals", async (req, res) =>
  renderPaymentsPage(req, res, "WITHDRAWAL")
);
superAdminRouter.get("/payments", (_req, res) =>
  res.redirect("/superadmin/deposits")
);

// Status change (with reason)
superAdminRouter.post("/payments/:id/status", async (req, res) => {
  const rawStatus = String(req.body?.toStatus ?? req.body?.targetStatus ?? "").toUpperCase();
  const targetStatus = rawStatus === "REJECTED" ? "REJECTED" : rawStatus === "APPROVED" ? "APPROVED" : null;
  if (!targetStatus) return res.status(400).send("Bad status");

  const payment = await prisma.paymentRequest.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true, type: true, amountCents: true },
  });
  if (!payment) return res.status(404).send("Not found");

  const comment = String(req.body?.comment ?? req.body?.reason ?? "").trim();
  const amountRaw = req.body?.amount ?? req.body?.amountCents ?? null;
  let amountCents: number | null = null;
  if (targetStatus === "APPROVED" && amountRaw !== null && String(amountRaw).trim() !== "") {
    const parsed = Number(String(amountRaw).replace(/,/g, ""));
    if (!Number.isFinite(parsed) || parsed <= 0) return res.status(400).send("Invalid amount");
    amountCents = Math.round(parsed * (typeof req.body?.amount !== "undefined" ? 100 : 1));
    if (!Number.isFinite(amountCents) || amountCents <= 0) return res.status(400).send("Invalid amount");
  }

  if (targetStatus === "REJECTED" && !comment) {
    return res.status(400).send("Comment is required");
  }

  if (targetStatus === "APPROVED" && payment.type === "DEPOSIT" && amountCents !== null) {
    if (amountCents !== payment.amountCents && !comment) {
      return res.status(400).send("Comment required when adjusting the amount");
    }
  }

  try {
    await changePaymentStatus(payment.type, {
      paymentId: payment.id,
      targetStatus,
      actorAdminId: null,
      amountCents: targetStatus === "APPROVED" ? amountCents : null,
      comment,
    });
  } catch (err) {
    if (err instanceof PaymentStatusError) {
      const message = err.code === "INSUFFICIENT_FUNDS" ? "Insufficient Balance" : err.message;
      return res.status(400).send(message);
    }
    console.error(err);
    return res.status(500).send("Unable to update status");
  }

  await auditAdmin(req, "payment.status.change", "PAYMENT", payment.id, {
    fromStatus: payment.status,
    toStatus: targetStatus,
    comment: comment || null,
  });

  const back = payment.type === "WITHDRAWAL" ? "/superadmin/withdrawals" : "/superadmin/deposits";
  res.redirect(back);
});

// Edit amount/currency (with reason)
superAdminRouter.post("/payments/:id/edit-amount", async (req, res) => {
  const amountRaw = typeof req.body?.amount !== "undefined" ? req.body.amount : req.body?.amountCents;
  const currencyRaw = req.body?.currency;
  const reason = String(req.body?.reason || "").trim();

  const parsedAmount = Number(String(amountRaw ?? "").replace(/,/g, ""));
  if (!Number.isFinite(parsedAmount) || parsedAmount < 0)
    return res.status(400).send("Invalid amount");
  const amountCents =
    typeof req.body?.amount !== "undefined"
      ? Math.round(parsedAmount * 100)
      : Math.round(parsedAmount);
  if (!Number.isFinite(amountCents)) return res.status(400).send("Invalid amount");
  const currency = String(currencyRaw || "").trim().toUpperCase();
  if (!currency || currency.length > 8)
    return res.status(400).send("Invalid currency");
  if (!reason) return res.status(400).send("Reason is required");

  const before = await prisma.paymentRequest.findUnique({
    where: { id: req.params.id },
    select: { id: true, type: true, amountCents: true, currency: true },
  });
  if (!before) return res.status(404).send("Not found");

  await prisma.paymentRequest.update({
    where: { id: before.id },
    data: { amountCents, currency },
  });

  await auditAdmin(req, "payment.amount.edit", "PAYMENT", before.id, {
    reason,
    from: { amountCents: before.amountCents, currency: before.currency },
    to: { amountCents, currency },
  });

  const back = (req.get("referer") || "").includes("/withdrawal")
    ? "/superadmin/withdrawals"
    : "/superadmin/deposits";
  res.redirect(back);
});

// Notes
superAdminRouter.post("/payments/:id/notes", async (req, res) => {
  const notes = String(req.body?.notes || "").trim();
  const before = await prisma.paymentRequest.findUnique({
    where: { id: req.params.id },
    select: { id: true, notes: true, type: true },
  });
  if (!before) return res.status(404).send("Not found");

  await prisma.paymentRequest.update({
    where: { id: before.id },
    data: { notes },
  });

  await auditAdmin(req, "payment.notes.update", "PAYMENT", before.id, {
    from: before.notes || null,
    to: notes || null,
  });

  const back = (req.get("referer") || "").includes("/withdrawal")
    ? "/superadmin/withdrawals"
    : "/superadmin/deposits";
  res.redirect(back);
});

// Receipt upload (ADD new receipt)
superAdminRouter.post(
  "/payments/:id/receipt",
  upload.single("receipt"),
  async (req, res) => {
    if (!req.file) return res.status(400).send("Missing file");

    const pr = await prisma.paymentRequest.findUnique({
      where: { id: req.params.id },
      select: { id: true, type: true },
    });
    if (!pr) return res.status(404).send("Not found");

    const relPath = "/uploads/" + req.file.filename;

    await prisma.paymentRequest.update({
      where: { id: pr.id },
      data: {
        receipts: {
          create: {
            original: req.file.originalname,
            path: relPath,
            mimeType: req.file.mimetype,
            size: req.file.size,
          },
        },
      } as any,
    });

    await auditAdmin(req, "payment.receipt.upload", "PAYMENT", pr.id, {
      original: req.file.originalname,
      path: relPath,
    });

    const back = (req.get("referer") || "").includes("/withdrawal")
      ? "/superadmin/withdrawals"
      : "/superadmin/deposits";
    res.redirect(back);
  }
);

// Targeted receipt remove
superAdminRouter.post(
  "/payments/:id/receipts/:rid/remove",
  async (req, res) => {
    const p = await prisma.paymentRequest.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!p) return res.status(404).send("Not found");

    const rf = await prisma.receiptFile.findUnique({
      where: { id: req.params.rid },
    });
    if (!rf || rf.paymentId !== p.id)
      return res.status(404).send("Receipt not found");

    await prisma.receiptFile.delete({ where: { id: rf.id } });

    await auditAdmin(req, "payment.receipt.remove", "PAYMENT", p.id, {
      fileId: rf.id,
      path: rf.path,
    });

    const back = (req.get("referer") || "").includes("/withdrawal")
      ? "/superadmin/withdrawals"
      : "/superadmin/deposits";
    res.redirect(back);
  }
);

// Legacy remove-most-recent (compat)
superAdminRouter.post("/payments/:id/receipt/remove", async (req, res) => {
  const p = await prisma.paymentRequest.findUnique({
    where: { id: req.params.id },
    include: { receipts: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!p) return res.status(404).send("Not found");

  const last = (p as any).receipts[0];
  if (last) {
    await prisma.receiptFile.delete({ where: { id: last.id } });
    await auditAdmin(req, "payment.receipt.remove", "PAYMENT", p.id, {
      fileId: last.id,
      path: last.path,
    });
  }

  const back = (req.get("referer") || "").includes("/withdrawal")
    ? "/superadmin/withdrawals"
    : "/superadmin/deposits";
  res.redirect(back);
});

// Exports — per type, respect filters
superAdminRouter.post("/deposits/export", async (req, res) => {
  try {
    const format = parseExportFormat(req.body?.type);
    const filters = coerceExportFilters(req.body?.filters);
    const columns = sanitizeColumns(req.body?.columns, SUPERADMIN_DEPOSIT_EXPORT_COLUMNS);
    const query = Object.keys(filters).length ? filters : {};
    const { items } = await fetchPayments(query, "DEPOSIT");
    const timezone = resolveTimezone((req as any).activeTimezone || res.locals.timezone);
    const file = await buildPaymentExportFile({
      format,
      columns,
      items: items as unknown as PaymentExportItem[],
      context: { scope: "superadmin", type: "DEPOSIT" },
      timezone,
    });
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(file.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Unable to export deposits" });
  }
});

superAdminRouter.get("/deposits/export.csv", async (req, res) => {
  const { items } = await fetchPayments(req.query || {}, "DEPOSIT");
  const csv = toCSVRows(items);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="deposits_${stamp}.csv"`
  );
  res.send(csv);
});

superAdminRouter.post("/withdrawals/export", async (req, res) => {
  try {
    const format = parseExportFormat(req.body?.type);
    const filters = coerceExportFilters(req.body?.filters);
    const columns = sanitizeColumns(req.body?.columns, SUPERADMIN_WITHDRAWAL_EXPORT_COLUMNS);
    const query = Object.keys(filters).length ? filters : {};
    const { items } = await fetchPayments(query, "WITHDRAWAL");
    const timezone = resolveTimezone((req as any).activeTimezone || res.locals.timezone);
    const file = await buildPaymentExportFile({
      format,
      columns,
      items: items as unknown as PaymentExportItem[],
      context: { scope: "superadmin", type: "WITHDRAWAL" },
      timezone,
    });
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(file.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Unable to export withdrawals" });
  }
});

superAdminRouter.get("/withdrawals/export.csv", async (req, res) => {
  const { items } = await fetchPayments(req.query || {}, "WITHDRAWAL");
  const csv = toCSVRows(items);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="withdrawals_${stamp}.csv"`
  );
  res.send(csv);
});

superAdminRouter.get("/deposits/export.xlsx", async (req, res) => {
  const { items } = await fetchPayments(req.query || {}, "DEPOSIT");
  const data = items.map((x: any) => ({
    id: x.id,
    referenceCode: x.referenceCode,
    merchantName: x.merchant?.name || "",
    type: x.type,
    status: x.status,
    currency: x.currency,
    amountCents: x.amountCents,
    userEmail: x.user?.email || "",
    userPhone: x.user?.phone || "",
    bankName: x.bankAccount?.bankName || "",
    hasReceipt: (Array.isArray(x.receipts)
      ? x.receipts.length > 0
      : !!x.receiptFile)
      ? "yes"
      : "no",
    createdAt: x.createdAt?.toISOString() || "",
    updatedAt: x.updatedAt?.toISOString() || "",
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Deposits");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="deposits_${stamp}.xlsx"`
  );
  res.send(buf);
});

superAdminRouter.get("/withdrawals/export.xlsx", async (req, res) => {
  const { items } = await fetchPayments(req.query || {}, "WITHDRAWAL");
  const data = items.map((x: any) => ({
    id: x.id,
    referenceCode: x.referenceCode,
    merchantName: x.merchant?.name || "",
    type: x.type,
    status: x.status,
    currency: x.currency,
    amountCents: x.amountCents,
    userEmail: x.user?.email || "",
    userPhone: x.user?.phone || "",
    bankName: x.bankAccount?.bankName || "",
    hasReceipt: (Array.isArray(x.receipts)
      ? x.receipts.length > 0
      : !!x.receiptFile)
      ? "yes"
      : "no",
    createdAt: x.createdAt?.toISOString() || "",
    updatedAt: x.updatedAt?.toISOString() || "",
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Withdrawals");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="withdrawals_${stamp}.xlsx"`
  );
  res.send(buf);
});

// ───────────────────────────────────────────────────────────────
// Audit Log pages + exports
// ───────────────────────────────────────────────────────────────
superAdminRouter.get("/logs", async (req, res) => {
  const q = String((req.query?.q as string) || "").trim();

  const where: any = q
    ? {
        OR: [
          { action: { contains: q, mode: "insensitive" } },
          { targetType: { contains: q, mode: "insensitive" } },
          { targetId: { contains: q, mode: "insensitive" } },
          { ip: { contains: q, mode: "insensitive" } },
          {
            admin: { is: { email: { contains: q, mode: "insensitive" } } },
          },
        ],
      }
    : {};

  const logs = await prisma.adminAuditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { admin: { select: { email: true } } },
    take: 500,
  });

  res.render("superadmin/logs", { title: "Audit Log", logs, q });
});

superAdminRouter.get("/logs.csv", async (_req, res) => {
  const rows = await prisma.adminAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    include: { admin: { select: { email: true } } },
    take: 5000,
  });

  const header = [
    "createdAt",
    "adminEmail",
    "action",
    "targetType",
    "targetId",
    "ip",
    "meta",
  ].join(",");
  const body = rows
    .map((r) =>
      [
        csvEscape(r.createdAt.toISOString()),
        csvEscape(r.admin?.email || ""),
        csvEscape(r.action || ""),
        csvEscape(r.targetType || ""),
        csvEscape(r.targetId || ""),
        csvEscape(r.ip || ""),
        csvEscape(r.meta || ""),
      ].join(",")
    )
    .join("\n");

  const csv = header + "\n" + body;
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="admin_audit_logs_${stamp}.csv"`
  );
  res.send(csv);
});

superAdminRouter.get("/login-logs.csv", async (_req, res) => {
  const rows = await prisma.adminLoginLog.findMany({
    orderBy: { createdAt: "desc" },
    include: { admin: { select: { email: true } } },
    take: 5000,
  });

  const header = [
    "createdAt",
    "adminEmail",
    "formEmail",
    "success",
    "ip",
    "userAgent",
  ].join(",");
  const body = rows
    .map((r) =>
      [
        csvEscape(r.createdAt.toISOString()),
        csvEscape(r.admin?.email || ""),
        csvEscape(r.email || ""),
        csvEscape(r.success ? "true" : "false"),
        csvEscape(r.ip || ""),
        csvEscape(r.userAgent || ""),
      ].join(",")
    )
    .join("\n");

  const csv = header + "\n" + body;
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="admin_login_logs_${stamp}.csv"`
  );
  res.send(csv);
});

superAdminRouter.get("/logs.xlsx", async (_req, res) => {
  const rows = await prisma.adminAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    include: { admin: { select: { email: true } } },
    take: 5000,
  });

  const data = rows.map((r) => ({
    createdAt: r.createdAt.toISOString(),
    adminEmail: r.admin?.email || "",
    action: r.action || "",
    targetType: r.targetType || "",
    targetId: r.targetId || "",
    ip: r.ip || "",
    meta: r.meta ? JSON.stringify(r.meta) : "",
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "AuditLogs");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="admin_audit_logs_${stamp}.xlsx"`
  );
  res.send(buf);
});

superAdminRouter.get("/login-logs.xlsx", async (_req, res) => {
  const rows = await prisma.adminLoginLog.findMany({
    orderBy: { createdAt: "desc" },
    include: { admin: { select: { email: true } } },
    take: 5000,
  });

  const data = rows.map((r) => ({
    createdAt: r.createdAt.toISOString(),
    adminEmail: r.admin?.email || "",
    formEmail: r.email || "",
    success: r.success ? "true" : "false",
    ip: r.ip || "",
    userAgent: r.userAgent || "",
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "LoginLogs");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="login_logs_${stamp}.xlsx"`
  );
  res.send(buf);
});

// ───────────────────────────────────────────────────────────────
// NEW: Forms (per-merchant and per-bank) — configure deposit/withdrawal inputs
// Matches UI payload; backward compatible with legacy rows
// ───────────────────────────────────────────────────────────────
const FieldRow = z.object({
  name: z.string().min(1).max(60),
  display: z.enum(["input", "file", "select"]),
  // NEW allowed field types for "input"
  field: z
    .enum(["text", "number", "phone", "email", "phone_email"])
    .nullable(), // null for file/select
  placeholder: z.string().max(200).optional().nullable(),
  required: z.boolean().optional().default(false),
  digits: z.number().int().nonnegative().max(64).optional().default(0), // 0 = unlimited (number only)
  options: z.array(z.string().min(1).max(200)).optional().default([]), // for select
});

const FormPayload = z.object({
  deposit: z.array(FieldRow).optional().default([]),
  withdrawal: z.array(FieldRow).optional().default([]),
}).superRefine((val, ctx) => {
  const norm = (s: string) => s.toLowerCase().trim();
  const dup = (arr: string[]) => new Set(arr).size !== arr.length;
  const depNames = (val.deposit || []).map((r) => norm(r.name));
  const witNames = (val.withdrawal || []).map((r) => norm(r.name));
  if (dup(depNames))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Duplicate names in deposit",
    });
  if (dup(witNames))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Duplicate names in withdrawal",
    });
});

// Accept both shapes: new (name/display/field/options[]) and old (key/label/mode/data)
function normalizeRow(r: any): z.infer<typeof FieldRow> {
  const name = String(r?.name ?? r?.key ?? r?.label ?? "")
    .replace(/\s+/g, " ")
    .trim();

  const displayRaw = String(r?.display ?? r?.mode ?? "input").toLowerCase();
  const display =
    displayRaw === "file" || displayRaw === "select" ? displayRaw : "input";

  // allow extended field types for "input"
  type FieldT =
    | "text"
    | "number"
    | "phone"
    | "email"
    | "phone_email"
    | null;

  let field: FieldT = null;
  if (display === "input") {
    const f = String(r?.field ?? "text").toLowerCase();
    field = (["text", "number", "phone", "email", "phone_email"] as const).includes(
      f as any
    )
      ? (f as FieldT)
      : "text";
  }

  const placeholder = (r?.placeholder ?? "") as string;
  const required = !!r?.required;

  const digitsNum = Number(r?.digits);
  // digits only meaningful for number inputs
  const digits =
    display === "input" && field === "number" && Number.isFinite(digitsNum)
      ? Math.max(0, digitsNum)
      : 0;

  let options: string[] = [];
  if (Array.isArray(r?.options))
    options = r.options.map((s: any) => String(s)).filter(Boolean);
  else if (typeof r?.data === "string")
    options = r.data
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
  options = options
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return { name, display, field, placeholder, required, digits, options };
}

// helper: strip blank names and collapse dup options
function cleanRows(arr: any[]): Array<z.infer<typeof FieldRow>> {
  const normed = (Array.isArray(arr) ? arr : []).map(normalizeRow);
  const nonEmpty = normed.filter((r) => r.name && r.name.trim().length > 0);
  return nonEmpty.map((r) => ({
    ...r,
    options: Array.from(
      new Set((r.options || []).map((s) => s.trim()).filter(Boolean))
    ),
  }));
}

// GET: forms editor — supports bank selection under a merchant
superAdminRouter.get("/forms", async (req, res) => {
  const merchants = await prisma.merchant.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  if (!merchants.length) {
    return res.render("superadmin/forms", {
      title: "Forms",
      merchants: [],
      banks: [],
      current: null,
      currentBank: "",
      config: { deposit: [], withdrawal: [] },
      error: null,
      copied: false,
      copiedFromLabel: "",
      usedFallback: false,
    });
  }

  const requested = String(req.query.merchantId || "");
  const merchantId = merchants.find(m => m.id === requested)?.id ?? merchants[0].id;

  // load banks for the selected merchant
  const banks = await prisma.bankAccount.findMany({
    where: { merchantId },
    orderBy: [{ method: "asc" }, { createdAt: "desc" }],
    select: { id: true, method: true, bankName: true, label: true, accountNo: true, active: true }
  });

  const bankId = String(req.query.bankAccountId || "");
  const selectedBankId = banks.find(b => b.id === bankId)?.id ?? ""; // "" means merchant-level

  // pull config for (merchantId, selectedBankId|null) with fallback to merchant default
  let usedFallback = false;
  let row = await prisma.merchantFormConfig.findFirst({
    where: { merchantId, bankAccountId: selectedBankId || null }
  });

  if (!row && selectedBankId) {
    // try merchant default
    row = await prisma.merchantFormConfig.findFirst({
      where: { merchantId, bankAccountId: null }
    });
    if (row) usedFallback = true;
  }

  const config = {
    deposit: Array.isArray((row as any)?.deposit) ? (row as any).deposit : [],
    withdrawal: Array.isArray((row as any)?.withdrawal) ? (row as any).withdrawal : [],
  };

  const copied = String(req.query.copied || "") === "1";
  const copiedFromLabel = String(req.query.from || "");
  const error = String(req.query.error || "") || null;

  res.render("superadmin/forms", {
    title: "Forms",
    merchants,
    banks,
    current: merchantId,
    currentBank: selectedBankId,
    config,
    error,
    copied,
    copiedFromLabel,
    usedFallback,
  });
});

// JSON: banks for a merchant (source list for cloning UI)
superAdminRouter.get("/forms/banks.json", async (req, res) => {
  const merchantId = String(req.query.merchantId || "");
  if (!merchantId) return res.json({ ok: true, banks: [] });

  const rows = await prisma.bankAccount.findMany({
    where: { merchantId },
    orderBy: [{ method: "asc" }, { createdAt: "desc" }],
    select: { id: true, method: true, bankName: true, label: true, accountNo: true, active: true }
  });

  const banks = rows.map(b => ({
    id: b.id,
    label: b.label || `${b.bankName} • ${String(b.accountNo || "").slice(-4)}`,
    method: b.method,
    active: b.active
  }));
  res.json({ ok: true, banks });
});

// POST: upsert forms for (merchant, bank?) — bankAccountId ""/missing means merchant-level
superAdminRouter.post("/forms/:merchantId", async (req, res) => {
  const merchantId = req.params.merchantId;

  // Ensure merchant exists
  const exists = await prisma.merchant.count({ where: { id: merchantId } });
  if (!exists) return res.status(404).send("Merchant not found");

  // Accept JSON strings from the page
  let payload: any = {};
  try {
    payload = {
      deposit: req.body?.depositJson ? JSON.parse(String(req.body.depositJson)) : [],
      withdrawal: req.body?.withdrawalJson ? JSON.parse(String(req.body.withdrawalJson)) : [],
    };
  } catch {
    return res.status(400).send("Bad JSON payload");
  }

  // Normalize, strip blanks before validation
  const normalized = {
    deposit: cleanRows(payload.deposit),
    withdrawal: cleanRows(payload.withdrawal),
  };

  // Validate safely (don’t crash on user error)
  const parsed = FormPayload.safeParse(normalized);
  if (!parsed.success) {
    // Re-render the page with the posted values and a friendly error
    const merchants = await prisma.merchant.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
    const banks = await prisma.bankAccount.findMany({
      where: { merchantId },
      orderBy: [{ method: "asc" }, { createdAt: "desc" }],
      select: { id: true, method: true, bankName: true, label: true, accountNo: true, active: true }
    });

    const bankIdRaw = String(req.body?.bankAccountId || "").trim();
    const selectedBankId = banks.find(b => b.id === bankIdRaw)?.id ?? "";

    const firstIssue = (parsed as any).error?.issues?.[0];
    const msg = firstIssue?.message || "Invalid form configuration. Remove empty fields and try again.";

    return res.status(400).render("superadmin/forms", {
      title: "Forms",
      merchants,
      banks,
      current: merchantId,
      currentBank: selectedBankId,
      config: normalized,     // show what the user posted (minus blank rows)
      error: msg,
      copied: false,
      copiedFromLabel: "",
      usedFallback: false,
    });
  }

  // bank scope
  const bankIdRaw = String(req.body?.bankAccountId || "").trim();
  const bankAccountId = bankIdRaw === "" ? null : bankIdRaw;

  if (bankAccountId) {
    const bankOk = await prisma.bankAccount.count({ where: { id: bankAccountId, merchantId } });
    if (!bankOk) return res.status(400).send("Bank does not belong to merchant");
  }

  if (bankAccountId) {
    await prisma.merchantFormConfig.upsert({
      where: { merchantId_bankAccountId: { merchantId, bankAccountId } },
      update: { deposit: parsed.data.deposit as any, withdrawal: parsed.data.withdrawal as any },
      create: { merchantId, bankAccountId, deposit: parsed.data.deposit as any, withdrawal: parsed.data.withdrawal as any },
    });
  } else {
    const existing = await prisma.merchantFormConfig.findFirst({
      where: { merchantId, bankAccountId: null },
      select: { id: true },
    });
    if (existing) {
      await prisma.merchantFormConfig.update({
        where: { id: existing.id },
        data: { deposit: parsed.data.deposit as any, withdrawal: parsed.data.withdrawal as any },
      });
    } else {
      await prisma.merchantFormConfig.create({
        data: { merchantId, bankAccountId: null, deposit: parsed.data.deposit as any, withdrawal: parsed.data.withdrawal as any },
      });
    }
  }

  await auditAdmin(req, "merchant.forms.upsert", "MERCHANT", merchantId, {
    bankAccountId: bankAccountId || null,
    depositCount: parsed.data.deposit.length,
    withdrawalCount: parsed.data.withdrawal.length,
  });

  const q = new URLSearchParams({ merchantId, ...(bankAccountId ? { bankAccountId } : {}) }).toString();
  res.redirect(`/superadmin/forms?${q}`);
});

// POST: COPY from another merchant/bank into the current selection
// Body: fromMerchantId, fromBankAccountId ("" or cuid), toBankAccountId ("" or cuid)
superAdminRouter.post("/forms/:merchantId/copy-from", async (req: any, res: any) => {
  const toMerchantId = req.params.merchantId;
  const existsTo = await prisma.merchant.count({ where: { id: toMerchantId } });
  if (!existsTo) return res.status(404).send("Target merchant not found");

  const fromMerchantId = String(req.body?.fromMerchantId || "");
  const fromBankIdRaw = String(req.body?.fromBankAccountId || "").trim();
  const fromBankAccountId = fromBankIdRaw === "" ? null : fromBankIdRaw;

  const toBankIdRaw = String(req.body?.toBankAccountId || "").trim();
  const toBankAccountId = toBankIdRaw === "" ? null : toBankIdRaw;

  if (!fromMerchantId) {
    const back = new URLSearchParams({ merchantId: toMerchantId, ...(toBankAccountId ? { bankAccountId: toBankAccountId } : {}), error: "Select a source merchant" }).toString();
    return res.redirect(`/superadmin/forms?${back}`);
  }

  // Verify bank-merchant relationships when bank IDs provided
  if (fromBankAccountId) {
    const ok = await prisma.bankAccount.count({ where: { id: fromBankAccountId, merchantId: fromMerchantId } });
    if (!ok) {
      const back = new URLSearchParams({ merchantId: toMerchantId, ...(toBankAccountId ? { bankAccountId: toBankAccountId } : {}), error: "Source bank not under selected source merchant" }).toString();
      return res.redirect(`/superadmin/forms?${back}`);
    }
  }
  if (toBankAccountId) {
    const ok = await prisma.bankAccount.count({ where: { id: toBankAccountId, merchantId: toMerchantId } });
    if (!ok) {
      const back = new URLSearchParams({ merchantId: toMerchantId, error: "Target bank not under target merchant" }).toString();
      return res.redirect(`/superadmin/forms?${back}`);
    }
  }

  // Load source config
  const source = await prisma.merchantFormConfig.findFirst({
    where: { merchantId: fromMerchantId, bankAccountId: fromBankAccountId }
  });
  if (!source) {
    const back = new URLSearchParams({
      merchantId: toMerchantId,
      ...(toBankAccountId ? { bankAccountId: toBankAccountId } : {}),
      error: "Source form not found"
    }).toString();
    return res.redirect(`/superadmin/forms?${back}`);
  }

  // Clone payload verbatim (already normalized when saved originally)
  const dep = Array.isArray((source as any).deposit) ? (source as any).deposit : [];
  const wdr = Array.isArray((source as any).withdrawal) ? (source as any).withdrawal : [];

  if (toBankAccountId) {
    await prisma.merchantFormConfig.upsert({
      where: { merchantId_bankAccountId: { merchantId: toMerchantId, bankAccountId: toBankAccountId } },
      update: { deposit: dep as any, withdrawal: wdr as any },
      create: { merchantId: toMerchantId, bankAccountId: toBankAccountId, deposit: dep as any, withdrawal: wdr as any },
    });
  } else {
    const existing = await prisma.merchantFormConfig.findFirst({
      where: { merchantId: toMerchantId, bankAccountId: null },
      select: { id: true },
    });
    if (existing) {
      await prisma.merchantFormConfig.update({
        where: { id: existing.id },
        data: { deposit: dep as any, withdrawal: wdr as any },
      });
    } else {
      await prisma.merchantFormConfig.create({
        data: { merchantId: toMerchantId, bankAccountId: null, deposit: dep as any, withdrawal: wdr as any },
      });
    }
  }

  // Build a nice label for the success banner
  const [fromMerch, fromBank, toBank] = await Promise.all([
    prisma.merchant.findUnique({ where: { id: fromMerchantId }, select: { name: true } }),
    fromBankAccountId
      ? prisma.bankAccount.findUnique({ where: { id: fromBankAccountId }, select: { label: true, bankName: true, accountNo: true, method: true } })
      : Promise.resolve(null),
    toBankAccountId
      ? prisma.bankAccount.findUnique({ where: { id: toBankAccountId }, select: { label: true, bankName: true, accountNo: true, method: true } })
      : Promise.resolve(null),
  ]);

  const bankLabel = (b: any) => b ? (b.label || `${b.bankName} • ${String(b.accountNo || "").slice(-4)} (${b.method})`) : "Merchant default";

  const fromLabel = `${fromMerch?.name || fromMerchantId} — ${bankLabel(fromBank)}`;

  await auditAdmin(req, "merchant.forms.copy", "MERCHANT", toMerchantId, {
    fromMerchantId,
    fromBankAccountId: fromBankAccountId || null,
    toBankAccountId: toBankAccountId || null,
  });

  const q = new URLSearchParams({
    merchantId: toMerchantId,
    ...(toBankAccountId ? { bankAccountId: toBankAccountId } : {}),
    copied: "1",
    from: fromLabel
  }).toString();
  res.redirect(`/superadmin/forms?${q}`);
});