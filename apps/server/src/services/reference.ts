import { customAlphabet } from 'nanoid';

const digits = '0123456789';
const txnShort = customAlphabet(digits, 5); // T + 5 digits → 6 characters
const txnLong = customAlphabet(digits, 6);
const userShort = customAlphabet(digits, 5); // U + 5 digits → 6 characters
const userLong = customAlphabet(digits, 6);
const uniqShort = customAlphabet(digits, 5); // UB + 5 digits → 7 characters
const uniqLong = customAlphabet(digits, 6);

function makePrefixedId(prefix: string, short: () => string, longer: () => string) {
  // Favor the shorter variant; if we ever need a longer pool, random chance will promote it.
  const useLonger = Math.random() < 0.1; // ~10% of the time issue a 7-char id to expand the space gradually
  const body = useLonger ? longer() : short();
  return `${prefix}${body}`;
}

export function generateTransactionId() {
  return makePrefixedId('T', txnShort, txnLong);
}

export function generateUserId() {
  return makePrefixedId('U', userShort, userLong);
}

export function generateUniqueReference() {
  return makePrefixedId('UB', uniqShort, uniqLong);
}

export function formatBankPublicId(n: number) {
  const raw = Number.isFinite(n) ? Math.floor(Number(n)) : 0;
  const normalized = raw < 1 ? 1 : raw;
  const body = String(normalized);
  const padded = body.length >= 4 ? body : body.padStart(4, '0');
  return `B${padded}`;
}

// Backwards compatibility helper for older imports
export function generateReference(_prefix = 'REF') {
  return generateUniqueReference();
}
