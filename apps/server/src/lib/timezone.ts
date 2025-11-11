// apps/server/src/lib/timezone.ts

const DEFAULT_TIMEZONE = 'UTC';

export function normalizeTimezone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value) return null;
  try {
    // Intl.DateTimeFormat throws if the timezone identifier is invalid
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return value;
  } catch {
    return null;
  }
}

export function resolveTimezone(input: unknown, fallback: string = DEFAULT_TIMEZONE): string {
  const normalized = normalizeTimezone(input);
  return normalized || fallback;
}

export function defaultTimezone(): string {
  return DEFAULT_TIMEZONE;
}
