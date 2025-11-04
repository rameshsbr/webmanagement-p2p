import { customAlphabet } from 'nanoid';
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const nano = customAlphabet(alphabet, 10);
export function generateReference(prefix = 'REF') {
  return `${prefix}-${nano()}`;
}