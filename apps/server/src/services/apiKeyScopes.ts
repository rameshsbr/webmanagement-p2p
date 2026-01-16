// apps/server/src/services/apiKeyScopes.ts
export const API_KEY_SCOPES = {
  P2P: "P2P",
  IDRV4_ACCEPT: "IDRV4_ACCEPT",
  IDRV4_DISBURSE: "IDRV4_DISBURSE",
} as const;

export type ApiKeyScope = typeof API_KEY_SCOPES[keyof typeof API_KEY_SCOPES];

export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
  P2P: "P2P",
  IDRV4_ACCEPT: "IDR v4 Accept (VA Dynamic/Static)",
  IDRV4_DISBURSE: "IDR v4 Disburse (Send)",
};

export const API_KEY_SCOPE_OPTIONS = [
  { value: API_KEY_SCOPES.P2P, label: API_KEY_SCOPE_LABELS.P2P },
  { value: API_KEY_SCOPES.IDRV4_ACCEPT, label: API_KEY_SCOPE_LABELS.IDRV4_ACCEPT },
  { value: API_KEY_SCOPES.IDRV4_DISBURSE, label: API_KEY_SCOPE_LABELS.IDRV4_DISBURSE },
];

const CANONICAL_SCOPE_SET = new Set<string>(Object.values(API_KEY_SCOPES));

const LEGACY_SCOPE_MAP: Record<string, ApiKeyScope[]> = {
  "read:payments": [API_KEY_SCOPES.P2P],
  "write:deposit": [API_KEY_SCOPES.IDRV4_ACCEPT],
  "read:deposit": [API_KEY_SCOPES.IDRV4_ACCEPT],
  "write:withdrawal": [API_KEY_SCOPES.IDRV4_DISBURSE],
  "read:withdrawal": [API_KEY_SCOPES.IDRV4_DISBURSE],
};

function normalizeCanonical(scope: string): ApiKeyScope | null {
  const upper = scope.trim().toUpperCase();
  if (CANONICAL_SCOPE_SET.has(upper)) return upper as ApiKeyScope;
  return null;
}

export function parseApiKeyScopesInput(input: unknown): { scopes: ApiKeyScope[]; invalid: string[] } {
  const raw: string[] = [];
  if (Array.isArray(input)) {
    raw.push(...input.map((v) => String(v)));
  } else if (typeof input === "string") {
    raw.push(...input.split(/[,\s]+/));
  } else if (input != null) {
    raw.push(String(input));
  }

  const scopes = new Set<ApiKeyScope>();
  const invalid: string[] = [];

  raw.forEach((value) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return;
    const canonical = normalizeCanonical(trimmed);
    if (canonical) {
      scopes.add(canonical);
    } else {
      invalid.push(trimmed);
    }
  });

  return { scopes: Array.from(scopes), invalid };
}

export function normalizeApiKeyScopes(input: string[] | null | undefined): ApiKeyScope[] {
  const scopes = new Set<ApiKeyScope>();
  (input || []).forEach((raw) => {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return;
    const canonical = normalizeCanonical(trimmed);
    if (canonical) {
      scopes.add(canonical);
      return;
    }
    const legacy = LEGACY_SCOPE_MAP[trimmed.toLowerCase()];
    if (legacy) {
      legacy.forEach((scope) => scopes.add(scope));
    }
  });
  return Array.from(scopes);
}
