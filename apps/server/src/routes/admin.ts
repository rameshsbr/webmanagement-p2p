// apps/server/src/routes/admin.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { stringify } from 'csv-stringify';
import ExcelJS from 'exceljs';
import { getUserDirectory, getAllUsers, UserDirectoryItem, renderUserDirectoryPdf } from '../services/userDirectory.js';

async function safeNotify(text: string) {
  try {
    const mod = await import('../services/telegram.js' as any);
    const svc: any = mod;
    if (typeof svc?.send === 'function') return svc.send(text);
    if (typeof svc?.sendMessage === 'function') return svc.sendMessage(text);
  } catch {}
}

const router = Router();

// ───────────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────────
function int(v: any, d: number) { const n = Number(v); return Number.isFinite(n) ? n : d; }

function statusesCSV(s?: string) {
  if (!s) return undefined;
  const ok = new Set(['PENDING','SUBMITTED','APPROVED','REJECTED']);
  const arr = s.split(',').map(x=>x.trim().toUpperCase()).filter(x=>ok.has(x));
  return arr.length ? arr : undefined;
}

function formatAmount(cents: number) {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return '-';
  const absCents = Math.abs(cents);
  const hasFraction = absCents % 100 !== 0;
  const value = (cents / 100).toLocaleString('en-AU', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  });
  return value;
}

function sortSpec(s?: string) {
  const wl = new Set(['createdAt','processedAt','updatedAt','amountCents','status','currency','referenceCode']);
  let col: string = 'createdAt', dir: 'asc'|'desc' = 'desc';
  if (s) {
    const [c, d] = s.split(':');
    if (c && wl.has(c)) col = c;
    if (d === 'asc' || d === 'desc') dir = d;
  }
  return { [col]: dir } as any;
}

function bankLabel(bank?: { publicId?: string | null; bankName?: string | null } | null) {
  if (!bank) return '';
  const parts: string[] = [];
  if (bank.publicId) parts.push(bank.publicId);
  if (bank.bankName) parts.push(bank.bankName);
  return parts.join(' • ');
}

const userDirectoryQuery = z.object({
  q: z.string().optional(),
  merchantId: z.string().optional(),
  page: z.string().optional(),
  perPage: z.string().optional(),
});

async function resolveUserDirectoryInput(req: Request) {
  const query = userDirectoryQuery.parse(req.query);
  const merchants = await prisma.merchant.findMany({
    where: { userDirectoryEnabled: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const allowedIds = merchants.map((m) => m.id);
  const selected = query.merchantId && allowedIds.includes(query.merchantId)
    ? [query.merchantId]
    : allowedIds;
  return { query, merchants, merchantIds: selected };
}

async function collectUsersForExport(merchantIds: string[], search?: string | null) {
  if (!merchantIds.length) return [] as UserDirectoryItem[];
  return getAllUsers({ merchantIds, search: search ?? null });
}

const listQuery = z.object({
  q: z.string().optional(),
  reference: z.string().optional(),
  uniqueReference: z.string().optional(),
  id: z.string().optional(),
  userId: z.string().optional(),
  merchantId: z.string().optional(),
  merchantName: z.string().optional(),
  processedBy: z.string().optional(),
  processedByName: z.string().optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
  bankId: z.string().optional(),
  method: z.string().optional(),
  amountMin: z.string().optional(),
  amountMax: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  dateField: z.enum(['createdAt','processedAt','updatedAt']).optional(),
  sort: z.string().optional(),
  page: z.string().optional(),
  perPage: z.string().optional()
});

function whereFrom(q: z.infer<typeof listQuery>, type: 'DEPOSIT' | 'WITHDRAWAL') {
  const where: any = { type };
  const and: any[] = [];
  if (q.id) where.id = q.id;
  if (q.reference) where.referenceCode = q.reference;
  if (q.uniqueReference) where.uniqueReference = q.uniqueReference;
  if (q.userId) {
    and.push({
      OR: [
        { user: { publicId: { equals: q.userId } } },
        { userId: q.userId }
      ]
    });
  }
  if (q.merchantId) where.merchantId = q.merchantId;
  if (q.merchantName) {
    and.push({ merchant: { name: { contains: q.merchantName, mode: 'insensitive' } } });
  }
  if (q.currency) where.currency = q.currency;
  if (q.bankId) {
    and.push({
      OR: [
        { bankAccountId: q.bankId },
        { bankAccount: { publicId: q.bankId } }
      ]
    });
  }
  if (q.processedBy) where.processedByAdminId = q.processedBy;
  if (q.processedByName) {
    and.push({
      processedByAdmin: {
        OR: [
          { displayName: { contains: q.processedByName, mode: 'insensitive' } },
          { email: { contains: q.processedByName, mode: 'insensitive' } }
        ]
      }
    });
  }
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
  const df = q.dateField || 'createdAt';
  if (q.from || q.to) {
    where[df] = {};
    if (q.from) where[df].gte = new Date(q.from);
    if (q.to) where[df].lte = new Date(q.to);
  }
  if (q.method) {
    and.push({ detailsJson: { path: ['method'], equals: q.method } });
  }
  if (q.q) {
    where.OR = [
      { referenceCode: { contains: q.q, mode: 'insensitive' } },
      { uniqueReference: { contains: q.q, mode: 'insensitive' } },
      { userId: { contains: q.q, mode: 'insensitive' } }
    ];
  }
  if (and.length) {
    where.AND = (where.AND || []).concat(and);
  }
  return where;
}

async function fetchPayments(
  req: Request,
  type: 'DEPOSIT'|'WITHDRAWAL',
  overrides?: Partial<Record<keyof z.infer<typeof listQuery>, string | undefined>>
) {
  const q = listQuery.parse({ ...req.query, ...(overrides || {}) });
  const where = whereFrom(q, type);
  const page = Math.max(1, int(q.page, 1));
  const perPage = Math.min(100, Math.max(5, int(q.perPage, 25)));
  const orderBy = sortSpec(q.sort);

  const [total, items] = await Promise.all([
    prisma.paymentRequest.count({ where }),
    prisma.paymentRequest.findMany({
      where,
      include: {
        merchant: { select: { id: true, name: true } },
        user: { select: { id: true, publicId: true, email: true, phone: true, diditSubject: true } },
        bankAccount: {
          select: {
            id: true,
            publicId: true,
            bankName: true,
            holderName: true,
            accountNo: true,
            currency: true,
            method: true,
          }
        },
        receiptFile: { select: { id: true, path: true, mimeType: true, original: true } },
        processedByAdmin: { select: { id: true, email: true, displayName: true } }
      },
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage
    })
  ]);

  return { total, items, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)), query: q };
}

function resolveReturnTo(raw: unknown, fallback: string) {
  if (typeof raw === 'string' && raw.startsWith('/admin')) return raw;
  return fallback;
}

function extractProcessingDetails(pr: {
  createdAt: Date;
  updatedAt: Date;
  processedAt?: Date | null;
  processedByAdmin?: { displayName: string | null; email: string | null; id: string } | null;
}) {
  const processed = pr.processedAt ?? pr.updatedAt ?? null;
  const processedDate = processed ? new Date(processed) : null;
  const processingSeconds = processedDate
    ? Math.max(0, Math.round((processedDate.getTime() - pr.createdAt.getTime()) / 1000))
    : null;
  const processedBy = pr.processedByAdmin
    ? pr.processedByAdmin.displayName || pr.processedByAdmin.email || pr.processedByAdmin.id
    : '';
  return { processedDate, processingSeconds, processedBy };
}

// ───────────────────────────────────────────────────────────────────────────────
// Dashboard
// ───────────────────────────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  const awaitingStatuses: Array<'PENDING' | 'SUBMITTED'> = ['PENDING', 'SUBMITTED'];
  const [pendingDeposits, pendingWithdrawals, totalsToday] = await Promise.all([
    prisma.paymentRequest.count({ where: { type: 'DEPOSIT', status: { in: awaitingStatuses } } }),
    prisma.paymentRequest.count({ where: { type: 'WITHDRAWAL', status: { in: awaitingStatuses } } }),
    prisma.paymentRequest.groupBy({
      by: ['type'],
      where: { createdAt: { gte: new Date(new Date().setHours(0,0,0,0)) }, status: 'APPROVED' },
      _sum: { amountCents: true }
    })
  ]);
  res.render('admin-dashboard', {
    title: 'Admin Dashboard',
    metrics: {
      pendingDeposits,
      pendingWithdrawals,
      todayDeposits: totalsToday.find(t => t.type === 'DEPOSIT')?._sum.amountCents ?? 0,
      todayWithdrawals: totalsToday.find(t => t.type === 'WITHDRAWAL')?._sum.amountCents ?? 0
    }
  });
});

/* ---------------- Deposits ---------------- */
router.get('/report/deposits', async (req, res) => {
  const { total, items, page, perPage, pages, query } = await fetchPayments(req, 'DEPOSIT');
  res.render('admin-deposits', { title: 'Deposit requests', table: { total, items, page, perPage, pages }, query });
});

// DB-level filtering for PENDING so new items appear immediately
router.get('/report/deposits/pending', async (req, res) => {
  const { total, items, page, perPage, pages, query } = await fetchPayments(req, 'DEPOSIT', { status: 'PENDING,SUBMITTED' });
  res.render('admin-deposits-pending', {
    title: 'Pending deposit requests',
    table: { total, items, page, perPage, pages },
    query,
    returnTo: req.originalUrl
  });
});

router.get('/notifications/queue', async (req, res) => {
  const sinceRaw = Number(req.query?.since);
  let since = new Date(Date.now() - 5 * 60 * 1000);
  if (Number.isFinite(sinceRaw) && sinceRaw > 0) {
    const candidate = new Date(sinceRaw);
    if (!Number.isNaN(candidate.getTime())) since = candidate;
  }
  const awaiting: Array<'PENDING' | 'SUBMITTED'> = ['PENDING', 'SUBMITTED'];
  const [deposits, withdrawals, latest] = await Promise.all([
    prisma.paymentRequest.count({ where: { type: 'DEPOSIT', status: { in: awaiting }, createdAt: { gt: since } } }),
    prisma.paymentRequest.count({ where: { type: 'WITHDRAWAL', status: { in: awaiting }, createdAt: { gt: since } } }),
    prisma.paymentRequest.findFirst({
      where: { status: { in: awaiting }, type: { in: ['DEPOSIT', 'WITHDRAWAL'] }, createdAt: { gt: since } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);
  res.json({
    ok: true,
    deposits,
    withdrawals,
    latest: latest?.createdAt ?? null,
  });
});

router.get('/notifications/queue', async (req, res) => {
  const sinceRaw = Number(req.query?.since);
  let since = new Date();
  if (Number.isFinite(sinceRaw) && sinceRaw > 0) {
    const candidate = new Date(sinceRaw);
    if (!Number.isNaN(candidate.getTime())) since = candidate;
  }

  const depositWhere = {
    type: 'DEPOSIT' as const,
    status: 'SUBMITTED' as const,
    updatedAt: { gt: since },
  };

  const withdrawalWhere = {
    type: 'WITHDRAWAL' as const,
    status: { in: ['PENDING', 'SUBMITTED'] as Array<'PENDING' | 'SUBMITTED'> },
    createdAt: { gt: since },
  };

  const [deposits, withdrawals, latestDeposit, latestWithdrawal] = await Promise.all([
    prisma.paymentRequest.count({ where: depositWhere }),
    prisma.paymentRequest.count({ where: withdrawalWhere }),
    prisma.paymentRequest.findFirst({
      where: depositWhere,
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    }),
    prisma.paymentRequest.findFirst({
      where: withdrawalWhere,
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);

  const latestCandidates = [latestDeposit?.updatedAt, latestWithdrawal?.createdAt]
    .filter((d): d is Date => !!d);
  const latest = latestCandidates.length
    ? new Date(Math.max(...latestCandidates.map((d) => d.getTime())))
    : null;

  res.json({
    ok: true,
    deposits,
    withdrawals,
    latest,
  });
});

router.get('/notifications/queue', async (req, res) => {
  const sinceRaw = Number(req.query?.since);
  let since = new Date();
  if (Number.isFinite(sinceRaw) && sinceRaw > 0) {
    const candidate = new Date(sinceRaw);
    if (!Number.isNaN(candidate.getTime())) since = candidate;
  }

  const depositWhere = {
    type: 'DEPOSIT' as const,
    status: 'SUBMITTED' as const,
    updatedAt: { gt: since },
  };

  const withdrawalWhere = {
    type: 'WITHDRAWAL' as const,
    status: { in: ['PENDING', 'SUBMITTED'] as Array<'PENDING' | 'SUBMITTED'> },
    createdAt: { gt: since },
  };

  const [deposits, withdrawals, latestDeposit, latestWithdrawal] = await Promise.all([
    prisma.paymentRequest.count({ where: depositWhere }),
    prisma.paymentRequest.count({ where: withdrawalWhere }),
    prisma.paymentRequest.findFirst({
      where: depositWhere,
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    }),
    prisma.paymentRequest.findFirst({
      where: withdrawalWhere,
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);

  const latestCandidates = [latestDeposit?.updatedAt, latestWithdrawal?.createdAt]
    .filter((d): d is Date => !!d);
  const latest = latestCandidates.length
    ? new Date(Math.max(...latestCandidates.map((d) => d.getTime())))
    : null;

  res.json({
    ok: true,
    deposits,
    withdrawals,
    latest,
  });
});

const approveBodySchema = z.object({
  amount: z.union([z.string(), z.number()]).optional(),
  amountCents: z.union([z.string(), z.number()]).optional(),
  comment: z.string().optional(),
  returnTo: z.string().optional()
});

const rejectBodySchema = z.object({
  comment: z.string().optional(),
  reason: z.string().optional(),
  returnTo: z.string().optional()
});

router.post('/deposits/:id/approve', async (req, res) => {
  const id = req.params.id;
  const pr = await prisma.paymentRequest.findUnique({ where: { id }, include: { merchant: true } });
  if (!pr || pr.type !== 'DEPOSIT' || !['PENDING', 'SUBMITTED'].includes(pr.status)) {
    return res.status(400).json({ ok: false, error: 'Invalid state' });
  }

  const parsed = approveBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Invalid payload' });
  }

  const body = parsed.data;
  const rawAmount = body.amount ?? body.amountCents;
  let nextAmount = pr.amountCents;
  if (rawAmount !== undefined && rawAmount !== null && String(rawAmount).trim() !== '') {
    const num = Number(String(rawAmount).replace(/,/g, ''));
    if (!Number.isFinite(num) || num <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid amount' });
    }
    const cents = body.amount !== undefined ? Math.round(num * 100) : Math.round(num);
    if (!Number.isFinite(cents) || cents <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid amount' });
    }
    nextAmount = cents;
  }

  const comment = (body.comment || '').trim();
  const amountChanged = nextAmount !== pr.amountCents;
  if (amountChanged && !comment) {
    return res.status(400).json({ ok: false, error: 'Comment required when adjusting the amount' });
  }

  const redirectTarget = resolveReturnTo(body.returnTo, '/admin/report/deposits/pending');

  await prisma.$transaction(async (tx) => {
    await tx.paymentRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        updatedAt: new Date(),
        processedAt: new Date(),
        processedByAdminId: req.admin?.sub ?? null,
        ...(amountChanged ? { amountCents: nextAmount } : {}),
        ...(comment ? { notes: comment } : {})
      }
    });
    await tx.ledgerEntry.create({
      data: { merchantId: pr.merchantId, amountCents: nextAmount, reason: `Deposit ${pr.referenceCode}`, paymentId: pr.id }
    });
    await tx.merchant.update({ where: { id: pr.merchantId }, data: { balanceCents: { increment: nextAmount } } });
  });

  const suffix = comment ? ` — ${comment}` : '';
  safeNotify(`✅ Deposit approved: ${pr.referenceCode} ${formatAmount(nextAmount)} ${pr.currency} (merchant ${pr.merchant.name})${suffix}`).catch(() => {});
  res.json({ ok: true, redirect: redirectTarget });
});

router.post('/deposits/:id/reject', async (req, res) => {
  const id = req.params.id;
  const parsed = rejectBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Invalid payload' });
  }

  const comment = (parsed.data.comment || parsed.data.reason || '').trim();
  if (!comment) {
    return res.status(400).json({ ok: false, error: 'Comment is required' });
  }

  const pr = await prisma.paymentRequest.findUnique({ where: { id }, include: { merchant: true } });
  if (!pr || pr.type !== 'DEPOSIT' || !['PENDING', 'SUBMITTED'].includes(pr.status)) {
    return res.status(400).json({ ok: false, error: 'Invalid state' });
  }

  const redirectTarget = resolveReturnTo(parsed.data.returnTo, '/admin/report/deposits/pending');

  await prisma.paymentRequest.update({
    where: { id },
    data: {
      status: 'REJECTED',
      rejectedReason: comment,
      notes: comment,
      updatedAt: new Date(),
      processedAt: new Date(),
      processedByAdminId: req.admin?.sub ?? null
    }
  });
  safeNotify(`⛔ Deposit rejected: ${pr.referenceCode} ${formatAmount(pr.amountCents)} ${pr.currency} — ${comment}`).catch(() => {});
  res.json({ ok: true, redirect: redirectTarget });
});

router.get('/export/deposits.csv', async (req: Request, res: Response) => {
  const { items } = await fetchPayments(req, 'DEPOSIT');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="deposits.csv"');
  const csv = stringify({
    header: true,
    columns: ['id','referenceCode','uniqueReference','userId','merchant','currency','amount','status','bank','createdAt','processedAt','processingSeconds','processedBy','receipt']
  });
  csv.pipe(res);
  for (const x of items) {
    const { processedDate, processingSeconds, processedBy } = extractProcessingDetails(x);
    csv.write({
      id: x.id, referenceCode: x.referenceCode, uniqueReference: x.uniqueReference,
      userId: x.user?.publicId ?? x.userId,
      merchant: x.merchant?.name ?? '', currency: x.currency, amount: formatAmount(x.amountCents), status: x.status,
      bank: bankLabel(x.bankAccount), createdAt: x.createdAt.toISOString(),
      processedAt: processedDate ? processedDate.toISOString() : '',
      processingSeconds: processingSeconds ?? '',
      processedBy,
      receipt: x.receiptFile?.original ?? ''
    });
  }
  csv.end();
});

router.get('/export/deposits.xlsx', async (req: Request, res: Response) => {
  const { items } = await fetchPayments(req, 'DEPOSIT');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Deposits');
  ws.columns = [
    { header: 'ID', key: 'id', width: 28 },{ header: 'Reference', key: 'referenceCode', width: 16 },
    { header: 'Unique Reference', key: 'uniqueReference', width: 20 },
    { header: 'User', key: 'userId', width: 16 },{ header: 'Merchant', key: 'merchant', width: 24 },
    { header: 'Currency', key: 'currency', width: 10 },{ header: 'Amount', key: 'amount', width: 14 },
    { header: 'Status', key: 'status', width: 12 },{ header: 'Bank', key: 'bank', width: 18 },
    { header: 'Created', key: 'createdAt', width: 22 },{ header: 'Processed', key: 'processedAt', width: 22 },
    { header: 'Processing (s)', key: 'processingSeconds', width: 16 },
    { header: 'Processed by', key: 'processedBy', width: 24 },
    { header: 'Receipt', key: 'receipt', width: 28 },
  ];
  items.forEach(x => {
    const { processedDate, processingSeconds, processedBy } = extractProcessingDetails(x);
    ws.addRow({
      id: x.id,
      referenceCode: x.referenceCode,
      uniqueReference: x.uniqueReference,
      userId: x.user?.publicId ?? x.userId,
      merchant: x.merchant?.name ?? '',
      currency: x.currency,
      amount: Number((x.amountCents / 100).toFixed(2)),
      status: x.status,
      bank: bankLabel(x.bankAccount),
      createdAt: x.createdAt,
      processedAt: processedDate,
      processingSeconds,
      processedBy,
      receipt: x.receiptFile?.original ?? ''
    });
  });
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="deposits.xlsx"');
  await wb.xlsx.write(res); res.end();
});

/* ---------------- Withdrawals ---------------- */
router.get('/report/withdrawals', async (req, res) => {
  const { total, items, page, perPage, pages, query } = await fetchPayments(req, 'WITHDRAWAL');
  res.render('admin-withdrawals', { title: 'Withdrawal requests', table: { total, items, page, perPage, pages }, query });
});

// DB-level filtering for PENDING so new items appear immediately
router.get('/report/withdrawals/pending', async (req, res) => {
  const { total, items, page, perPage, pages, query } = await fetchPayments(req, 'WITHDRAWAL', { status: 'PENDING,SUBMITTED' });
  res.render('admin-withdrawals-pending', {
    title: 'Pending withdrawal requests',
    table: { total, items, page, perPage, pages },
    query
  });
});

router.post('/withdrawals/:id/approve', async (req, res) => {
  const id = req.params.id;
  const pr = await prisma.paymentRequest.findUnique({ where: { id }, include: { merchant: true } });
  if (!pr || pr.type !== 'WITHDRAWAL' || !['PENDING', 'SUBMITTED'].includes(pr.status)) {
    return res.status(400).json({ ok: false, error: 'Invalid state' });
  }

  const redirectTarget = resolveReturnTo((req.body && (req.body.returnTo ?? req.body.redirect)) || undefined, '/admin/report/withdrawals/pending');

  const m = await prisma.merchant.findUnique({ where: { id: pr.merchantId }, select: { balanceCents: true, name: true } });
  if (!m || m.balanceCents < pr.amountCents) {
    return res.status(400).json({ ok: false, error: 'Insufficient merchant balance' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.paymentRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        updatedAt: new Date(),
        processedAt: new Date(),
        processedByAdminId: req.admin?.sub ?? null
      }
    });
    await tx.ledgerEntry.create({
      data: { merchantId: pr.merchantId, amountCents: -pr.amountCents, reason: `Withdrawal ${pr.referenceCode}`, paymentId: pr.id }
    });
    await tx.merchant.update({ where: { id: pr.merchantId }, data: { balanceCents: { decrement: pr.amountCents } } });
  });

  safeNotify(`✅ Withdrawal approved: ${pr.referenceCode} ${formatAmount(pr.amountCents)} ${pr.currency} (merchant ${m?.name})`).catch(()=>{});
  res.json({ ok: true, redirect: redirectTarget });
});

router.post('/withdrawals/:id/reject', async (req, res) => {
  const id = req.params.id;
  const parsed = rejectBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Invalid payload' });
  }

  const comment = (parsed.data.comment || parsed.data.reason || '').trim();
  if (!comment) {
    return res.status(400).json({ ok: false, error: 'Comment is required' });
  }

  const pr = await prisma.paymentRequest.findUnique({ where: { id }, include: { merchant: true } });
  if (!pr || pr.type !== 'WITHDRAWAL' || !['PENDING', 'SUBMITTED'].includes(pr.status)) {
    return res.status(400).json({ ok: false, error: 'Invalid state' });
  }

  const redirectTarget = resolveReturnTo(parsed.data.returnTo, '/admin/report/withdrawals/pending');

  await prisma.paymentRequest.update({
    where: { id },
    data: {
      status: 'REJECTED',
      rejectedReason: comment,
      updatedAt: new Date(),
      processedAt: new Date(),
      processedByAdminId: req.admin?.sub ?? null
    }
  });
  safeNotify(`⛔ Withdrawal rejected: ${pr.referenceCode} ${formatAmount(pr.amountCents)} ${pr.currency} — ${comment}`).catch(()=>{});
  res.json({ ok: true, redirect: redirectTarget });
});

router.get('/export/withdrawals.csv', async (req: Request, res: Response) => {
  const { items } = await fetchPayments(req, 'WITHDRAWAL');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="withdrawals.csv"');
  const csv = stringify({
    header: true,
    columns: ['id','referenceCode','uniqueReference','userId','merchant','currency','amount','status','bank','createdAt','processedAt','processingSeconds','processedBy']
  });
  csv.pipe(res);
  for (const x of items) {
    const { processedDate, processingSeconds, processedBy } = extractProcessingDetails(x);
    csv.write({
      id: x.id, referenceCode: x.referenceCode, uniqueReference: x.uniqueReference,
      userId: x.user?.publicId ?? x.userId,
      merchant: x.merchant?.name ?? '', currency: x.currency, amount: formatAmount(x.amountCents), status: x.status,
      bank: bankLabel(x.bankAccount), createdAt: x.createdAt.toISOString(),
      processedAt: processedDate ? processedDate.toISOString() : '',
      processingSeconds: processingSeconds ?? '',
      processedBy
    });
  }
  csv.end();
});

router.get('/export/withdrawals.xlsx', async (req: Request, res: Response) => {
  const { items } = await fetchPayments(req, 'WITHDRAWAL');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Withdrawals');
  ws.columns = [
    { header: 'ID', key: 'id', width: 28 },{ header: 'Reference', key: 'referenceCode', width: 16 },
    { header: 'Unique Reference', key: 'uniqueReference', width: 20 },
    { header: 'User', key: 'userId', width: 16 },{ header: 'Merchant', key: 'merchant', width: 24 },
    { header: 'Currency', key: 'currency', width: 10 },{ header: 'Amount', key: 'amount', width: 14 },
    { header: 'Status', key: 'status', width: 12 },{ header: 'Bank', key: 'bank', width: 18 },
    { header: 'Created', key: 'createdAt', width: 22 },{ header: 'Processed', key: 'processedAt', width: 22 },
    { header: 'Processing (s)', key: 'processingSeconds', width: 16 },
    { header: 'Processed by', key: 'processedBy', width: 24 },
  ];
  items.forEach(x => {
    const { processedDate, processingSeconds, processedBy } = extractProcessingDetails(x);
    ws.addRow({
      id: x.id,
      referenceCode: x.referenceCode,
      uniqueReference: x.uniqueReference,
      userId: x.user?.publicId ?? x.userId,
      merchant: x.merchant?.name ?? '',
      currency: x.currency,
      amount: Number((x.amountCents / 100).toFixed(2)),
      status: x.status,
      bank: bankLabel(x.bankAccount),
      createdAt: x.createdAt,
      processedAt: processedDate,
      processingSeconds,
      processedBy,
    });
  });
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="withdrawals.xlsx"');
  await wb.xlsx.write(res); res.end();
});

/* ---------------- Users ---------------- */
router.get('/users', async (req, res) => {
  const { query, merchants, merchantIds } = await resolveUserDirectoryInput(req);
  const table = merchantIds.length
    ? await getUserDirectory({ merchantIds, search: query.q || null, page: query.page, perPage: query.perPage })
    : { total: 0, page: 1, perPage: 25, pages: 1, items: [] };

  res.render('admin-users', {
    title: 'Users',
    table,
    query,
    merchants,
  });
});

router.get('/export/users.csv', async (req: Request, res: Response) => {
  const { query, merchantIds } = await resolveUserDirectoryInput(req);
  const items = await collectUsersForExport(merchantIds, query.q || null);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
  const csv = stringify({
    header: true,
    columns: ['userId','fullName','email','phone','status','registeredAt','lastActivity','merchants'],
  });
  csv.pipe(res);
  items.forEach((user) => {
    csv.write({
      userId: user.publicId,
      fullName: user.fullName || '',
      email: user.email || '',
      phone: user.phone || '',
      status: user.verificationStatus,
      registeredAt: user.registeredAt.toISOString(),
      lastActivity: user.lastActivityAt ? user.lastActivityAt.toISOString() : '',
      merchants: user.merchants.map((m) => m.name).join(', '),
    });
  });
  csv.end();
});

router.get('/export/users.xlsx', async (req: Request, res: Response) => {
  const { query, merchantIds } = await resolveUserDirectoryInput(req);
  const items = await collectUsersForExport(merchantIds, query.q || null);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Users');
  ws.columns = [
    { header: 'User ID', key: 'userId', width: 16 },
    { header: 'Full name', key: 'fullName', width: 24 },
    { header: 'Email', key: 'email', width: 24 },
    { header: 'Phone', key: 'phone', width: 18 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Registered', key: 'registeredAt', width: 24 },
    { header: 'Last activity', key: 'lastActivity', width: 24 },
    { header: 'Merchants', key: 'merchants', width: 32 },
  ];
  items.forEach((user) => {
    ws.addRow({
      userId: user.publicId,
      fullName: user.fullName || '',
      email: user.email || '',
      phone: user.phone || '',
      status: user.verificationStatus,
      registeredAt: user.registeredAt,
      lastActivity: user.lastActivityAt,
      merchants: user.merchants.map((m) => m.name).join(', '),
    });
  });
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="users.xlsx"');
  await wb.xlsx.write(res); res.end();
});

router.get('/export/users.pdf', async (req: Request, res: Response) => {
  const { query, merchantIds } = await resolveUserDirectoryInput(req);
  const items = await collectUsersForExport(merchantIds, query.q || null);
  const pdf = renderUserDirectoryPdf(items);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="users.pdf"');
  res.end(pdf);
});

/* ---------------- Banks ---------------- */
router.get('/bank-transfer/banks', async (_req, res) => {
  const banks = await prisma.bankAccount.findMany({ orderBy: { createdAt: 'desc' } });
  res.render('admin-banks', { title: 'List of banks', banks });
});

router.get('/bank-transfer/banks/:id/edit', async (req, res) => {
  const bank = await prisma.bankAccount.findUnique({ where: { id: req.params.id } });
  if (!bank) return res.status(404).send('Not found');
  res.render('admin-bank-edit', { title: 'Edit bank', bank });
});

router.post('/bank-transfer/banks/:id/edit', async (req, res) => {
  const id = req.params.id;
  const data: any = {
    holderName: req.body.holderName,
    bankName: req.body.bankName,
    accountNo: req.body.accountNo,
    iban: req.body.iban || null,
    currency: req.body.currency,
    instructions: req.body.instructions || null,
    active: req.body.active === 'on'
  };
  await prisma.bankAccount.update({ where: { id }, data });
  res.redirect('/admin/bank-transfer/banks');
});

export const adminRouter = router;