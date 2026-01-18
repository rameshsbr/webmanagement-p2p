// apps/server/src/services/apiKeyScopes.ts
export const API_KEY_SCOPES = {
  P2P: "P2P",
  IDRV4_ACCEPT: "IDRV4_ACCEPT",
  IDRV4_DISBURSE: "IDRV4_DISBURSE",
  METHOD_AUD_NPP: "method:AUD_NPP",
} as const;

export type ApiKeyScope = typeof API_KEY_SCOPES[keyof typeof API_KEY_SCOPES];

export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
  P2P: "P2P",
  IDRV4_ACCEPT: "IDR v4 Accept (VA Dynamic/Static)",
  IDRV4_DISBURSE: "IDR v4 Disburse (Send)",
  METHOD_AUD_NPP: "AUD NPP",
};

export const API_KEY_SCOPE_OPTIONS = [
  { value: API_KEY_SCOPES.P2P, label: API_KEY_SCOPE_LABELS.P2P },
  { value: API_KEY_SCOPES.IDRV4_ACCEPT, label: API_KEY_SCOPE_LABELS.IDRV4_ACCEPT },
  { value: API_KEY_SCOPES.IDRV4_DISBURSE, label: API_KEY_SCOPE_LABELS.IDRV4_DISBURSE },
  { value: API_KEY_SCOPES.METHOD_AUD_NPP, label: API_KEY_SCOPE_LABELS.METHOD_AUD_NPP },
];

const CANONICAL_SCOPE_MAP = new Map<string, ApiKeyScope>(
  Object.values(API_KEY_SCOPES).map((value) => [value.toUpperCase(), value]),
);

const LEGACY_SCOPE_MAP: Record<string, ApiKeyScope[]> = {
  "read:payments": [API_KEY_SCOPES.P2P],
  "write:deposit": [API_KEY_SCOPES.IDRV4_ACCEPT],
  "read:deposit": [API_KEY_SCOPES.IDRV4_ACCEPT],
  "write:withdrawal": [API_KEY_SCOPES.IDRV4_DISBURSE],
  "read:withdrawal": [API_KEY_SCOPES.IDRV4_DISBURSE],
};

function normalizeCanonical(scope: string): ApiKeyScope | null {
  const upper = scope.trim().toUpperCase();
  return CANONICAL_SCOPE_MAP.get(upper) || null;
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
