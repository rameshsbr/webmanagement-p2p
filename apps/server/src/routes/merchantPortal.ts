// apps/server/src/routes/merchantPortal.ts
import { Router, Request } from "express";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";
import { stringify } from "csv-stringify";
import ExcelJS from "exceljs";
import crypto from "node:crypto";
import { seal } from "../services/secretBox.js";
import jwt from "jsonwebtoken";
// ⬇️ NEW: we’ll mint a short-lived checkout token for the merchant demo
import { signCheckoutToken } from "../services/checkoutToken.js";
import { getUserDirectory, getAllUsers, renderUserDirectoryPdf } from "../services/userDirectory.js";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

const userQuery = z.object({
  q: z.string().optional(),
  page: z.string().optional(),
  perPage: z.string().optional(),
});

function usersFeatureEnabled(res: any): boolean {
  return !!res?.locals?.merchantFeatures?.usersEnabled;
}

async function collectMerchantUsersForExport(merchantId: string, search?: string | null) {
  return getAllUsers({ merchantIds: [merchantId], search: search ?? null });
}

// ─────────────────────────────────────────────────────────────
// Merchant auth guard — tolerant to old/new token shapes
// ─────────────────────────────────────────────────────────────
async function requireMerchant(req: any, res: any, next: any) {
  const tok =
    req.cookies?.merchant_jwt ||
    req.cookies?.merchant ||
    null;

  if (!tok) return res.redirect("/public/merchant/login");

  try {
    const p: any = jwt.verify(tok, JWT_SECRET);

    // New tokens carry merchantId; try these first
    let merchantId: string | null =
      p.merchantId || p.mid || p.merchant || null;

    // Back-compat: older tokens had only sub = merchantUserId
    if (!merchantId && p.sub) {
      const mu = await prisma.merchantUser.findUnique({
        where: { id: String(p.sub) },
        select: { merchantId: true },
      });
      merchantId = mu?.merchantId || null;
    }

    if (!merchantId) {
      // Stale/malformed cookie → clear + bounce to login
      res.clearCookie("merchant_jwt", { path: "/" });
      res.clearCookie("merchant",     { path: "/" });
      return res.redirect("/public/merchant/login");
    }

    // Maintain compatibility with existing code:
    // many routes read req.merchant?.sub as merchantId
    req.merchant = { sub: merchantId };
    req.merchantAuth = p; // expose full payload if needed
    return next();
  } catch {
    res.clearCookie("merchant_jwt", { path: "/" });
    res.clearCookie("merchant",     { path: "/" });
    return res.redirect("/public/merchant/login");
  }
}

// All routes below require merchant auth
router.use(requireMerchant);

router.use(async (req: any, res, next) => {
  const merchantId = req.merchant?.sub as string;
  if (!merchantId) return next();
  if (!req.merchantDetails) {
    req.merchantDetails = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, name: true, email: true, balanceCents: true, defaultCurrency: true, userDirectoryEnabled: true },
    });
  }
  res.locals.merchant = req.merchantDetails;
  res.locals.merchantFeatures = { usersEnabled: !!req.merchantDetails?.userDirectoryEnabled };
  next();
});

const listQuery = z.object({
  q: z.string().optional(),
  id: z.string().optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
  amountMin: z.string().optional(),
  amountMax: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  dateField: z.enum(["createdAt", "processedAt", "updatedAt"]).optional(),
  sort: z.string().optional(),
  page: z.string().optional(),
  perPage: z.string().optional(),
  type: z.enum(["DEPOSIT", "WITHDRAWAL"]).optional(),
});

function int(v: any, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function statusesCSV(s?: string) {
  if (!s) return undefined;
  const ok = new Set(["PENDING", "SUBMITTED", "APPROVED", "REJECTED"]);
  const arr = s.split(",").map(x => x.trim().toUpperCase()).filter(x => ok.has(x));
  return arr.length ? arr : undefined;
}
function sortSpec(s?: string) {
  const wl = new Set(["createdAt", "processedAt", "updatedAt", "amountCents", "status", "currency", "referenceCode"]);
  let col = "createdAt", dir: "asc" | "desc" = "desc";
  if (s) {
    const [c, d] = s.split(":");
    if (c && wl.has(c)) col = c;
    if (d === "asc" || "desc" === d) dir = d;
  }
  return { [col]: dir } as any;
}
function whereFrom(q: z.infer<typeof listQuery>, merchantId: string, type?: "DEPOSIT" | "WITHDRAWAL") {
  const where: any = { merchantId };
  if (type) where.type = type;
  if (q.id) where.id = q.id;
  if (q.currency) where.currency = q.currency;
  const sts = statusesCSV(q.status);
  if (sts) where.status = { in: sts };
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
  const df = q.dateField === "processedAt" ? "processedAt" : (q.dateField === "updatedAt" ? "updatedAt" : "createdAt");
  if (q.from || q.to) {
    where[df] = {};
    if (q.from) where[df].gte = new Date(q.from);
    if (q.to) where[df].lte = new Date(q.to);
  }
  if (q.q) where.OR = [
    { referenceCode: { contains: q.q, mode: "insensitive" } },
    { uniqueReference: { contains: q.q, mode: "insensitive" } }
  ];
  return where;
}

async function fetchPayments(req: Request, merchantId: string, type?: "DEPOSIT" | "WITHDRAWAL") {
  const q = listQuery.parse(req.query);
  const where = whereFrom(q, merchantId, type ?? q.type);
  const page = Math.max(1, int(q.page, 1));
  const perPage = Math.min(100, Math.max(5, int(q.perPage, 25)));
  const orderBy = sortSpec(q.sort);

  const [total, items] = await Promise.all([
    prisma.paymentRequest.count({ where }),
    prisma.paymentRequest.findMany({
      where,
      select: {
        id: true,
        type: true,
        status: true,
        amountCents: true,
        currency: true,
        referenceCode: true,
        uniqueReference: true,
        createdAt: true,
        updatedAt: true,
        processedAt: true,
        notes: true,
        rejectedReason: true,
        detailsJson: true,
        merchantId: true,
        bankAccountId: true,
        merchant: { select: { id: true, name: true } },
        user: { select: { id: true, publicId: true, email: true, phone: true } },
        processedByAdmin: { select: { id: true, email: true, displayName: true } },
        bankAccount: { select: { publicId: true, bankName: true, method: true } },
        receiptFile: { select: { path: true, original: true } },
      },
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return { total, items, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)), query: q };
}

// Dashboard
router.get("/", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const awaitingStatuses: Array<'PENDING' | 'SUBMITTED'> = ['PENDING', 'SUBMITTED'];
  const [pendingDeposits, pendingWithdrawals, totalsToday, latest] = await Promise.all([
    prisma.paymentRequest.count({ where: { merchantId, type: "DEPOSIT", status: { in: awaitingStatuses } } }),
    prisma.paymentRequest.count({ where: { merchantId, type: "WITHDRAWAL", status: { in: awaitingStatuses } } }),
    prisma.paymentRequest.groupBy({
      by: ["type"],
      where: { merchantId, createdAt: { gte: today }, status: "APPROVED" },
      _sum: { amountCents: true },
    }),
    prisma.paymentRequest.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        referenceCode: true,
        uniqueReference: true,
        type: true,
        status: true,
        amountCents: true,
        currency: true,
        createdAt: true,
      },
    }),
  ]);

  const merchant = req.merchantDetails || await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { name: true, balanceCents: true, defaultCurrency: true },
  });

  res.render("merchant/dashboard", {
    title: "Merchant Dashboard",
    merchant,
    metrics: {
      pendingDeposits,
      pendingWithdrawals,
      todayDeposits: totalsToday.find(t => t.type === "DEPOSIT")?._sum.amountCents ?? 0,
      todayWithdrawals: totalsToday.find(t => t.type === "WITHDRAWAL")?._sum.amountCents ?? 0,
    },
    latest,
  });
});

// Payments list
router.get("/payments", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;

  const { total, items, page, perPage, pages, query } = await fetchPayments(req, merchantId);

  let title = "Payments";
  const t = (query.type || "").toString().toUpperCase();
  if (t === "DEPOSIT") title = "Deposits";
  else if (t === "WITHDRAWAL") title = "Withdrawals";

  // NEW: build a short-lived checkout token for the “Test checkout” panel
  let checkoutToken: string | undefined;
  const diditSubject =
    String((req.query?.subject as string) || (req.query?.diditSubject as string) || "").trim();

  if (diditSubject) {
    // You can also pull merchant balance to show a realistic available balance.
    const m = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { balanceCents: true },
    });

    checkoutToken = signCheckoutToken({
      merchantId,
      diditSubject,
      currency: "AUD",
      // Keep it generous for testing. Use m?.balanceCents if you prefer.
      availableBalanceCents: typeof m?.balanceCents === "number" ? m.balanceCents : 200000,
    });
  }

  res.render("merchant/payments", {
    title,
    table: { total, items, page, perPage, pages },
    query,
    checkoutToken, // <- pass to EJS so PayX.init can run
  });
});

router.get("/payments/deposits", (_req, res) => res.redirect("/merchant/payments?type=DEPOSIT"));
router.get("/payments/withdrawals", (_req, res) => res.redirect("/merchant/payments?type=WITHDRAWAL"));

router.get("/users", async (req: any, res) => {
  if (!usersFeatureEnabled(res)) {
    return res.status(403).render("merchant/users-disabled", { title: "Users" });
  }
  const merchantId = req.merchant?.sub as string;
  const query = userQuery.parse(req.query);
  const table = await getUserDirectory({ merchantIds: [merchantId], search: query.q || null, page: query.page, perPage: query.perPage });
  res.render("merchant/users", { title: "Users", table, query });
});

// Ledger
router.get("/ledger", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;

  const entries = await prisma.ledgerEntry.findMany({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, amountCents: true, reason: true, createdAt: true },
  });

  res.render("merchant/ledger", { title: "Ledger", entries });
});

// EXPORTS
router.get("/export/payments.csv", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  const { items } = await fetchPayments(req, merchantId);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="payments.csv"');
  const csv = stringify({
    header: true,
    columns: ["id","referenceCode","type","currency","amountCents","status","bank","createdAt","updatedAt","receipt"]
  });
  csv.pipe(res);
  for (const x of items) {
    csv.write({
      id: x.id,
      referenceCode: x.referenceCode,
      type: x.type,
      currency: x.currency,
      amountCents: x.amountCents,
      status: x.status,
      bank: x.bankAccount?.bankName ?? "",
      createdAt: x.createdAt.toISOString(),
      updatedAt: x.updatedAt.toISOString(),
      receipt: x.receiptFile?.original ?? "",
    });
  }
  csv.end();
});

router.get("/export/payments.xlsx", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  const { items } = await fetchPayments(req, merchantId);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Payments");
  ws.columns = [
    { header: "ID", key: "id", width: 28 },
    { header: "Reference", key: "referenceCode", width: 18 },
    { header: "Type", key: "type", width: 12 },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Amount (cents)", key: "amountCents", width: 16 },
    { header: "Status", key: "status", width: 12 },
    { header: "Bank", key: "bank", width: 20 },
    { header: "Created", key: "createdAt", width: 22 },
    { header: "Updated", key: "updatedAt", width: 22 },
    { header: "Receipt", key: "receipt", width: 28 },
  ];
  items.forEach(x => ws.addRow({
    id: x.id,
    referenceCode: x.referenceCode,
    type: x.type,
    currency: x.currency,
    amountCents: x.amountCents,
    status: x.status,
    bank: x.bankAccount?.bankName ?? "",
    createdAt: x.createdAt,
    updatedAt: x.updatedAt,
    receipt: x.receiptFile?.original ?? "",
  }));
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",'attachment; filename="payments.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

router.get("/export/ledger.csv", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  const entries = await prisma.ledgerEntry.findMany({
    where: { merchantId }, orderBy: { createdAt: "desc" }, take: 100
  });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="ledger.csv"');
  const csv = stringify({ header: true, columns: ["id","amountCents","reason","createdAt"] });
  csv.pipe(res);
  for (const e of entries) {
    csv.write({ id: e.id, amountCents: e.amountCents, reason: e.reason, createdAt: e.createdAt.toISOString() });
  }
  csv.end();
});

router.get("/export/ledger.xlsx", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  const entries = await prisma.ledgerEntry.findMany({
    where: { merchantId }, orderBy: { createdAt: "desc" }, take: 100
  });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Ledger");
  ws.columns = [
    { header: "ID", key: "id", width: 28 },
    { header: "Amount (cents)", key: "amountCents", width: 16 },
    { header: "Reason", key: "reason", width: 40 },
    { header: "Created", key: "createdAt", width: 22 },
  ];
  entries.forEach(e => ws.addRow(e));
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",'attachment; filename="ledger.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

router.get("/export/users.csv", async (req: any, res) => {
  if (!usersFeatureEnabled(res)) return res.status(403).send("User directory disabled");
  const merchantId = req.merchant?.sub as string;
  const query = userQuery.parse(req.query);
  const items = await collectMerchantUsersForExport(merchantId, query.q || null);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="users.csv"');
  const csv = stringify({
    header: true,
    columns: ["userId","fullName","email","phone","status","registeredAt","lastActivity"],
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
    });
  });
  csv.end();
});

router.get("/export/users.xlsx", async (req: any, res) => {
  if (!usersFeatureEnabled(res)) return res.status(403).send("User directory disabled");
  const merchantId = req.merchant?.sub as string;
  const query = userQuery.parse(req.query);
  const items = await collectMerchantUsersForExport(merchantId, query.q || null);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Users");
  ws.columns = [
    { header: "User ID", key: "userId", width: 16 },
    { header: "Full name", key: "fullName", width: 24 },
    { header: "Email", key: "email", width: 24 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Status", key: "status", width: 14 },
    { header: "Registered", key: "registeredAt", width: 24 },
    { header: "Last activity", key: "lastActivity", width: 24 },
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
    });
  });
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",'attachment; filename="users.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

router.get("/export/users.pdf", async (req: any, res) => {
  if (!usersFeatureEnabled(res)) return res.status(403).send("User directory disabled");
  const merchantId = req.merchant?.sub as string;
  const query = userQuery.parse(req.query);
  const items = await collectMerchantUsersForExport(merchantId, query.q || null);
  const pdf = renderUserDirectoryPdf(items);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="users.pdf"');
  res.end(pdf);
});

// API Keys
function genPrefix(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "m_";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
function genSecret(): string {
  return crypto.randomBytes(24).toString("base64url");
}

router.get("/keys", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  const keys = await prisma.merchantApiKey.findMany({
    where: { merchantId }, orderBy: { createdAt: "desc" },
    select: { id:true, prefix:true, last4:true, active:true, scopes:true, createdAt:true, lastUsedAt:true, expiresAt:true }
  });
  res.render("merchant/api-keys", { title: "API Keys", keys, justCreated: null });
});

router.post("/prefs/theme", (req, res) => {
  const mode = (req.body?.mode === "dark") ? "dark" : "light";
  res.cookie("merchant_theme", mode, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 31536000 * 1000,
    secure: process.env.NODE_ENV === "production",
  });
  res.json({ ok: true, mode });
});

router.post("/keys/create", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  const prefix = genPrefix();
  const secret = genSecret();
  await prisma.merchantApiKey.create({
    data: { merchantId, prefix, secretEnc: seal(secret), last4: secret.slice(-4), scopes: ["read:payments"] }
  });
  const keys = await prisma.merchantApiKey.findMany({
    where: { merchantId }, orderBy: { createdAt: "desc" },
    select: { id:true, prefix:true, last4:true, active:true, scopes:true, createdAt:true, lastUsedAt:true, expiresAt:true }
  });
  res.render("merchant/api-keys", { title: "API Keys", keys, justCreated: `${prefix}.${secret}` });
});

router.post("/keys/:id/revoke", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  await prisma.merchantApiKey.updateMany({ where: { id: req.params.id, merchantId }, data: { active: false } });
  res.redirect("/merchant/keys");
});

router.post("/keys/:id/rotate", async (req: any, res) => {
  const merchantId = req.merchant?.sub as string;
  await prisma.merchantApiKey.updateMany({ where: { id: req.params.id, merchantId }, data: { active: false } });
  const prefix = genPrefix(); const secret = genSecret();
  await prisma.merchantApiKey.create({
    data: { merchantId, prefix, secretEnc: seal(secret), last4: secret.slice(-4), scopes: ["read:payments"] }
  });
  res.redirect("/merchant/keys");
});

// Logout → go to public login
router.get("/logout", (_req, res) => {
  try {
    res.clearCookie("merchant_jwt", { path: "/" });
    res.clearCookie("merchant",     { path: "/" });
  } catch {}
  return res.redirect("/public/merchant/login");
});

export const merchantPortalRouter = router;