import { prisma } from '../lib/prisma.js';
export async function withIdempotency(scope: string, key: string | undefined, fn: () => Promise<any>) {
  if (!key) return await fn();
  const existing = await prisma.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } as any });
  if (existing) return existing.response;
  const result = await fn();
  await prisma.idempotencyKey.create({ data: { scope, key, response: result } });
  return result;
}
