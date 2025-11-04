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

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

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

const listQuery = z.object({
  q: z.string().optional(),
  id: z.string().optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
  amountMin: z.string().optional(),
  amountMax: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  dateField: z.enum(["createdAt", "updatedAt"]).optional(),
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
  const wl = new Set(["createdAt", "updatedAt", "amountCents", "status", "currency", "referenceCode"]);
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
    if (q.amountMin) where.amountCents.gte = Number(q.amountMin);
    if (q.amountMax) where.amountCents.lte = Number(q.amountMax);
  }
  const df = q.dateField || "createdAt";
  if (q.from || q.to) {
    where[df] = {};
    if (q.from) where[df].gte = new Date(q.from);
    if (q.to) where[df].lte = new Date(q.to);
  }
  if (q.q) where.OR = [{ referenceCode: { contains: q.q, mode: "insensitive" } }];
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
      include: {
        user: { select: { id: true, email: true, phone: true } },
        bankAccount: { select: { bankName: true } },
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
  const [merchant, pendingDeposits, pendingWithdrawals, totalsToday, latest] = await Promise.all([
    prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { name: true, balanceCents: true }
    }),
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
      select: { id: true, referenceCode: true, type: true, status: true, amountCents: true, currency: true, createdAt: true },
    }),
  ]);

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