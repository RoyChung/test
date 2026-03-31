export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getBaseUrl(): string {
  return "/backend";
}

function getToken(): string {
  return import.meta.env.VITE_AI_BUILDER_TOKEN || "";
}

function buildHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = getBaseUrl();
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, { ...init, headers: buildHeaders(init) });

  if (!res.ok) {
    const text = await res.text();
    let message = `Request failed (${res.status})`;
    try {
      const j = JSON.parse(text) as { detail?: unknown };
      if (Array.isArray(j.detail)) {
        message =
          j.detail.map((d: { msg?: string }) => d.msg ?? "").filter(Boolean).join("; ") || message;
      } else if (typeof j.detail === "string") message = j.detail;
    } catch {
      if (text) message = text.slice(0, 500);
    }
    throw new ApiError(res.status, message, text);
  }
  return res;
}

export function getApiConfig(): { hasToken: boolean } {
  if (import.meta.env.DEV) return { hasToken: Boolean(getToken()) };
  return { hasToken: true };
}

/** Build WebSocket URL for realtime (dev: proxied /backend; prod: wss to API host). */
export function getRealtimeWebSocketUrl(wsPathAndQuery: string): string {
  const path = wsPathAndQuery.startsWith("/") ? wsPathAndQuery : `/${wsPathAndQuery}`;
  if (import.meta.env.DEV) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/backend${path}`;
  }
  const base = import.meta.env.VITE_AI_BUILDER_BASE_URL || "https://space.ai-builders.com/backend";
  const u = new URL(base.startsWith("http") ? base : `https://${base}`);
  return `wss://${u.host}${path}`;
}
