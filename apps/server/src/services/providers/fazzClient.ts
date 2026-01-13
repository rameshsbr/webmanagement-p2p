// apps/server/src/services/providers/fazzClient.ts
// Minimal client for Fazz v4-ID using global fetch.
// Solves TS "RequestInit" body type clash by casting the init object.
const API_BASE = (process.env.FAZZ_API_BASE || "").replace(/\/+$/, "");
const API_KEY = process.env.FAZZ_API_KEY || "";
const API_SECRET = process.env.FAZZ_API_SECRET || "";

function basicAuth(): string {
  const token = Buffer.from(`${API_KEY}:${API_SECRET}`).toString("base64");
  return `Basic ${token}`;
}

type Jsonish = Record<string, any> | any;
type Init = RequestInit & { json?: Jsonish };

export async function fazzFetch(path: string, init?: Init): Promise<any> {
  if (!API_BASE) throw new Error("FAZZ_API_BASE is not set");
  const url = `${API_BASE}${path}`;

  const headers: Record<string, string> = {
    Authorization: basicAuth(),
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
    ...(init?.headers as any),
  };

  let body: any = init?.body;
  if (typeof init?.json !== "undefined") {
    body = JSON.stringify(init.json);
  }

  const res = await fetch(url, { ...(init as any), headers, body } as any);

  let data: any = null;
  let text = "";
  try {
    data = await res.clone().json();
  } catch {
    text = await res.text();
  }

  if (!res.ok) {
    const msg =
      (data && (data.errors?.[0]?.detail || data.message || data.error)) ||
      text ||
      `HTTP ${res.status}`;
    const err = new Error(msg) as any;
    err.status = res.status;
    err.response = data ?? text;
    throw err;
  }

  return data ?? text;
}

/** ---------- Helpers for sandbox tasks ---------- */

/** Mark a VA payment as settled (sandbox only). */
export async function settlePaymentTask(paymentId: string, idemKey?: string) {
  return fazzFetch(`/payments/${encodeURIComponent(paymentId)}/tasks`, {
    method: "POST",
    headers: { "Idempotency-Key": idemKey || `task-${Date.now()}` },
    json: { data: { type: "task", attributes: { action: "settle" } } },
  });
}

/** Mark a disbursement as completed (sandbox only). */
export async function completeDisbursementTask(disbursementId: string, idemKey?: string) {
  return fazzFetch(`/disbursements/${encodeURIComponent(disbursementId)}/tasks`, {
    method: "POST",
    headers: { "Idempotency-Key": idemKey || `task-${Date.now()}` },
    json: { data: { type: "task", attributes: { action: "complete" } } },
  });
}

/** Convenience getters (useful for audits/tests) */
export async function getPayment(paymentId: string) {
  return fazzFetch(`/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
}
export async function getDisbursement(disbursementId: string) {
  return fazzFetch(`/disbursements/${encodeURIComponent(disbursementId)}`, { method: "GET" });
}