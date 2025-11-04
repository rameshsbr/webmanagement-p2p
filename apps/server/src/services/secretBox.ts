import crypto from "node:crypto";

const rawB64 = process.env.APIKEY_ENC_KEY || "";
if (!rawB64) console.warn("[secretBox] APIKEY_ENC_KEY is not set.");
function getKey(): Buffer {
  if (!rawB64) throw new Error("APIKEY_ENC_KEY missing");
  const key = Buffer.from(rawB64, "base64");
  if (key.length !== 32) throw new Error("APIKEY_ENC_KEY must be 32 bytes (base64)");
  return key;
}

export function seal(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function open(box: string): string {
  const key = getKey();
  const buf = Buffer.from(box, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

export function tscmp(a: string, b: string): boolean {
  const A = Buffer.from(a); const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}