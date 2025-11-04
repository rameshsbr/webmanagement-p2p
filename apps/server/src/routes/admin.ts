// apps/server/src/routes/admin.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { stringify } from 'csv-stringify';
import ExcelJS from 'exceljs';

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

function sortSpec(s?: string) {
  const wl = new Set(['createdAt','updatedAt','amountCents','status','currency','referenceCode']);
  let col: string = 'createdAt', dir: 'asc'|'desc' = 'desc';
  if (s) {
    const [c, d] = s.split(':');
    if (c && wl.has(c)) col = c;
    if (d === 'asc' || d === 'desc') dir = d;
  }
  return { [col]: dir } as any;
}

const listQuery = z.object({
  q: z.string().optional(),
  id: z.string().optional(),
  userId: z.string().optional(),
  merchantId: z.string().optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
  bankId: z.string().optional(),
  amountMin: z.string().optional(),
  amountMax: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  dateField: z.enum(['createdAt','updatedAt']).optional(),
  sort: z.string().optional(),
  page: z.string().optional(),
  perPage: z.string().optional()
});

function whereFrom(q: z.infer<typeof listQuery>, type: 'DEPOSIT' | 'WITHDRAWAL') {
  const where: any = { type };
  if (q.id) where.id = q.id;
  if (q.userId) where.userId = q.userId;
  if (q.merchantId) where.merchantId = q.merchantId;
  if (q.currency) where.currency = q.currency;
  if (q.bankId) where.bankAccountId = q.bankId;
  const sts = statusesCSV(q.status);
  if (sts) where.status = { in: sts };
  if (q.amountMin || q.amountMax) {
    where.amountCents = {};
    if (q.amountMin) where.amountCents.gte = Number(q.amountMin);
    if (q.amountMax) where.amountCents.lte = Number(q.amountMax);
  }
  const df = q.dateField || 'createdAt';
  if (q.from || q.to) {
    where[df] = {};
    if (q.from) where[df].gte = new Date(q.from);
    if (q.to) where[df].lte = new Date(q.to);
  }
  if (q.q) where.OR = [{ referenceCode: { contains: q.q, mode: 'insensitive' } }];
  return where;
}

async function fetchPayments(req: Request, type: 'DEPOSIT'|'WITHDRAWAL') {
  const q = listQuery.parse(req.query);
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
        user: { select: { id: true, email: true, phone: true, diditSubject: true } },
        bankAccount: { select: { id: true, bankName: true, holderName: true, accountNo: true, currency: true } },
        receiptFile: { select: { id: true, path: true, mimeType: true, original: true } }
      },
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage
    })
  ]);

  return { total, items, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)), query: q };
}

// ───────────────────────────────────────────────────────────────────────────────
// Dashboard
// ───────────────────────────────────────────────────────────────────────────────
router.get('/', async (_req, res) => {
  const [pendingDeposits, pendingWithdrawals, totalsToday] = await Promise.all([
    prisma.paymentRequest.count({ where: { type: 'DEPOSIT', status: 'PENDING' } }),
    prisma.paymentRequest.count({ where: { type: 'WITHDRAWAL', status: 'PENDING' } }),
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
  const reqPending = { ...req, query: { ...req.query, status: 'PENDING' } } as Request;
  const { total, items, page, perPage, pages, query } = await fetchPayments(reqPending, 'DEPOSIT');
  res.render('admin-deposits-pending', {
    title: 'Pending deposit requests',
    table: { total, items, page, perPage, pages },
    query
  });
});

router.post('/deposits/:id/approve', async (req, res) => {
  const id = req.params.id;
  const pr = await prisma.paymentRequest.findUnique({ where: { id }, include: { merchant: true } });
  if (!pr || pr.type !== 'DEPOSIT' || pr.status !== 'PENDING') return res.status(400).json({ ok: false, error: 'Invalid state' });

  await prisma.$transaction(async (tx) => {
    await tx.paymentRequest.update({ where: { id }, data: { status: 'APPROVED', updatedAt: new Date() } });
    await tx.ledgerEntry.create({
      data: { merchantId: pr.merchantId, amountCents: pr.amountCents, reason: `Deposit ${pr.referenceCode}`, paymentId: pr.id }
    });
    await tx.merchant.update({ where: { id: pr.merchantId }, data: { balanceCents: { increment: pr.amountCents } } });
  });

  safeNotify(`✅ Deposit approved: ${pr.referenceCode} ${pr.amountCents} ${pr.currency} (merchant ${pr.merchant.name})`).catch(()=>{});
  res.redirect('back');
});

router.post('/deposits/:id/reject', async (req, res) => {
  const id = req.params.id;
  const reason = (req.body?.reason as string) || 'Rejected by admin';
  const pr = await prisma.paymentRequest.findUnique({ where: { id }, include: { merchant: true } });
  if (!pr || pr.type !== 'DEPOSIT' || pr.status !== 'PENDING') return res.status(400).json({ ok: false, error: 'Invalid state' });

  await prisma.paymentRequest.update({ where: { id }, data: { status: 'REJECTED', rejectedReason: reason, updatedAt: new Date() } });
  safeNotify(`⛔ Deposit rejected: ${pr.referenceCode} ${pr.amountCents} ${pr.currency} — ${reason}`).catch(()=>{});
  res.redirect('back');
});

router.get('/export/deposits.csv', async (req: Request, res: Response) => {
  const { items } = await fetchPayments(req, 'DEPOSIT');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="deposits.csv"');
  const csv = stringify({ header: true, columns: ['id','referenceCode','userId','merchant','currency','amountCents','status','bank','createdAt','updatedAt','receipt'] });
  csv.pipe(res);
  for (const x of items) {
    csv.write({
      id: x.id, referenceCode: x.referenceCode, userId: x.userId,
      merchant: x.merchant?.name ?? '', currency: x.currency, amountCents: x.amountCents, status: x.status,
      bank: x.bankAccount?.bankName ?? '', createdAt: x.createdAt.toISOString(), updatedAt: x.updatedAt.toISOString(),
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
    { header: 'User', key: 'userId', width: 16 },{ header: 'Merchant', key: 'merchant', width: 24 },
    { header: 'Currency', key: 'currency', width: 10 },{ header: 'Amount (cents)', key: 'amountCents', width: 14 },
    { header: 'Status', key: 'status', width: 12 },{ header: 'Bank', key: 'bank', width: 18 },
    { header: 'Created', key: 'createdAt', width: 22 },{ header: 'Updated', key: 'updatedAt', width: 22 },
    { header: 'Receipt', key: 'receipt', width: 28 },
  ];
  items.forEach(x => ws.addRow({
    id: x.id, referenceCode: x.referenceCode, userId: x.userId, merchant: x.merchant?.name ?? '',
    currency: x.currency, amountCents: x.amountCents, status: x.status, bank: x.bankAccount?.bankName ?? '',
    createdAt: x.createdAt, updatedAt: x.updatedAt, receipt: x.receiptFile?.original ?? ''
  }));
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
  const reqPending = { ...req, query: { ...req.query, status: 'PENDING' } } as Request;
  const { total, items, page, perPage, pages, query } = await fetchPayments(reqPending, 'WITHDRAWAL');
  res.render('admin-withdrawals-pending', {
    title: 'Pending withdrawal requests',
    table: { total, items, page, perPage, pages },
    query
  });
});

router.post('/withdrawals/:id/approve', async (req, res) => {
  const id = req.params.id;
  const pr = await prisma.paymentRequest.findUnique({ where: { id }, include: { merchant: true } });
  if (!pr || pr.type !== 'WITHDRAWAL' || pr.status !== 'PENDING') return res.status(400).json({ ok: false, error: 'Invalid state' });

  // balance check
  const m = await prisma.merchant.findUnique({ where: { id: pr.merchantId }, select: { balanceCents: true, name: true } });
  if (!m || m.balanceCents < pr.amountCents) return res.status(400).json({ ok: false, error: 'Insufficient merchant balance' });

  await prisma.$transaction(async (tx) => {
    await tx.paymentRequest.update({ where: { id }, data: { status: 'APPROVED', updatedAt: new Date() } });
    await tx.ledgerEntry.create({
      data: { merchantId: pr.merchantId, amountCents: -pr.amountCents, reason: `Withdrawal ${pr.referenceCode}`, paymentId: pr.id }
    });
    await tx.merchant.update({ where: { id: pr.merchantId }, data: { balanceCents: { decrement: pr.amountCents } } });
  });

  safeNotify(`✅ Withdrawal approved: ${pr.referenceCode} ${pr.amountCents} ${pr.currency} (merchant ${m?.name})`).catch(()=>{});
  res.redirect('back');
});

router.post('/withdrawals/:id/reject', async (req, res) => {
  const id = req.params.id;
  const reason = (req.body?.reason as string) || 'Rejected by admin';
  const pr = await prisma.paymentRequest.findUnique({ where: { id }, include: { merchant: true } });
  if (!pr || pr.type !== 'WITHDRAWAL' || pr.status !== 'PENDING') return res.status(400).json({ ok: false, error: 'Invalid state' });

  await prisma.paymentRequest.update({ where: { id }, data: { status: 'REJECTED', rejectedReason: reason, updatedAt: new Date() } });
  safeNotify(`⛔ Withdrawal rejected: ${pr.referenceCode} ${pr.amountCents} ${pr.currency} — ${reason}`).catch(()=>{});
  res.redirect('back');
});

router.get('/export/withdrawals.csv', async (req: Request, res: Response) => {
  const { items } = await fetchPayments(req, 'WITHDRAWAL');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="withdrawals.csv"');
  const csv = stringify({ header: true, columns: ['id','referenceCode','userId','merchant','currency','amountCents','status','bank','createdAt','updatedAt'] });
  csv.pipe(res);
  for (const x of items) {
    csv.write({
      id: x.id, referenceCode: x.referenceCode, userId: x.userId,
      merchant: x.merchant?.name ?? '', currency: x.currency, amountCents: x.amountCents, status: x.status,
      bank: x.bankAccount?.bankName ?? '', createdAt: x.createdAt.toISOString(), updatedAt: x.updatedAt.toISOString()
    });
  }
  csv.end();
});

router.get('/export/withdrawals.xlsx', async (req: Request, res: Response) => {
  const { items } = await fetchPayments(req, 'WITHDRAWAL');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Withdrawals');
  ws.columns = [
    { header: 'ID', key: 'id', width: 28 },{ header: 'Reference', key: 'referenceCode', width: 16 },
    { header: 'User', key: 'userId', width: 16 },{ header: 'Merchant', key: 'merchant', width: 24 },
    { header: 'Currency', key: 'currency', width: 10 },{ header: 'Amount (cents)', key: 'amountCents', width: 14 },
    { header: 'Status', key: 'status', width: 12 },{ header: 'Bank', key: 'bank', width: 18 },
    { header: 'Created', key: 'createdAt', width: 22 },{ header: 'Updated', key: 'updatedAt', width: 22 },
  ];
  items.forEach(x => ws.addRow({
    id: x.id, referenceCode: x.referenceCode, userId: x.userId, merchant: x.merchant?.name ?? '',
    currency: x.currency, amountCents: x.amountCents, status: x.status, bank: x.bankAccount?.bankName ?? '',
    createdAt: x.createdAt, updatedAt: x.updatedAt
  }));
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="withdrawals.xlsx"');
  await wb.xlsx.write(res); res.end();
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