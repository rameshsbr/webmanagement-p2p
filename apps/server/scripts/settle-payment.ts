// pnpm tsx apps/server/scripts/settle-payment.ts <providerPaymentId>
import fetch from 'node-fetch';

async function main() {
  const [, , id] = process.argv;
  if (!id) {
    console.error('usage: pnpm tsx apps/server/scripts/settle-payment.ts <providerPaymentId>');
    process.exit(1);
  }

  const base = process.env.FAZZ_API_BASE!;
  const key = process.env.FAZZ_API_KEY!;
  const secret = process.env.FAZZ_API_SECRET!;
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');

  const r = await fetch(`${base}/payments/${id}/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      'Idempotency-Key': `task-${Date.now()}`
    },
    body: JSON.stringify({ data: { type: 'task', attributes: { action: 'settle' } } })
  });

  const text = await r.text();
  if (!r.ok) {
    console.error('FAZZ settle failed:', text);
    process.exit(1);
  }
  console.log(text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});