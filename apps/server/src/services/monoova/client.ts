const DEFAULT_BASE_URL = "https://api.sandbox.monoova.com";

type MonoovaRequestOptions = {
  method?: string;
  body?: unknown;
};

function getBaseUrl() {
  return (process.env.MONOOVA_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function buildAuthHeader() {
  const username = process.env.MONOOVA_BASIC_USERNAME || "";
  const password = process.env.MONOOVA_BASIC_PASSWORD || "";
  if (!username || !password) {
    throw new Error("Monoova basic auth not configured");
  }
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${token}`;
}

export async function monoovaRequest<T>(path: string, options: MonoovaRequestOptions = {}): Promise<T> {
  const url = `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const method = options.method || "GET";
  const headers: Record<string, string> = {
    Authorization: buildAuthHeader(),
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const raw = await res.text();
  let json: any = null;
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch {
      json = raw;
    }
  }

  if (!res.ok) {
    const message = typeof json === "string" ? json : JSON.stringify(json);
    throw new Error(`Monoova ${method} ${path} failed: ${res.status} ${message}`);
  }

  return json as T;
}

export function getMonoovaAccountToken() {
  const token = process.env.MONOOVA_MACCOUNT_TOKEN || "";
  if (!token) throw new Error("Monoova mAccount token not configured");
  return token;
}
