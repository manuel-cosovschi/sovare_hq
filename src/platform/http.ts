import { isNative } from "./runtime";
import { SECRET_HOSTS, readBrowserSecret, type SecretKey } from "./secrets";

export interface HttpRequest {
  method?: "GET" | "POST" | "HEAD";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  latencyMs: number;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number | null,
    public code: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}

const FORBIDDEN = ["authorization", "x-api-key", "cookie", "host"];

/** Request authenticated with a stored credential. The token is attached by the native layer. */
export async function secureRequest(secret: SecretKey, req: HttpRequest): Promise<HttpResponse> {
  const url = new URL(req.url);
  if (url.protocol !== "https:") throw new HttpError("Las credenciales solo se envían por HTTPS", null, "insecure_url", false);
  if (!(SECRET_HOSTS[secret] as readonly string[]).includes(url.hostname)) throw new HttpError(`Host no permitido para esta credencial: ${url.hostname}`, null, "host_not_allowed", false);
  const headers = Object.fromEntries(Object.entries(req.headers ?? {}).filter(([k]) => !FORBIDDEN.includes(k.toLowerCase())));
  if (isNative()) {
    const { call } = await import("./native");
    try {
      const r = await call<{ status: number; headers: Record<string, string>; body: string; latency_ms: number }>("http_secure", {
        req: { secret, method: req.method ?? "GET", url: req.url, headers, body: req.body ?? null, timeout_ms: req.timeoutMs ?? 30000 },
      });
      return { status: r.status, headers: r.headers, body: r.body, latencyMs: r.latency_ms };
    } catch (e) {
      const err = e as Error & { code?: string };
      throw new HttpError(err.message, null, err.code ?? "network", ["timeout", "connect", "network"].includes(err.code ?? ""));
    }
  }
  const token = await readBrowserSecret(secret);
  if (!token) throw new HttpError("No hay credencial guardada para esta integración", null, "missing_credential", false);
  const auth: Record<string, string> = secret === "anthropic" ? { "x-api-key": token, "anthropic-dangerous-direct-browser-access": "true" } : { Authorization: `Bearer ${token}` };
  return browserFetch({ ...req, headers: { ...headers, ...auth } }, "error");
}

/** Unauthenticated request (health checks, public FX rates, local LLM servers). */
export async function publicRequest(req: HttpRequest): Promise<HttpResponse> {
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) throw new HttpError("Solo URLs http(s)", null, "invalid_scheme", false);
  if (url.username || url.password) throw new HttpError("La URL no puede contener credenciales", null, "invalid_url", false);
  const headers = Object.fromEntries(Object.entries(req.headers ?? {}).filter(([k]) => !FORBIDDEN.includes(k.toLowerCase())));
  if (isNative()) {
    const { call } = await import("./native");
    try {
      const r = await call<{ status: number; headers: Record<string, string>; body: string; latency_ms: number }>("http_public", {
        req: { method: req.method ?? "GET", url: req.url, headers, body: req.body ?? null, timeout_ms: req.timeoutMs ?? 15000 },
      });
      return { status: r.status, headers: r.headers, body: r.body, latencyMs: r.latency_ms };
    } catch (e) {
      const err = e as Error & { code?: string };
      throw new HttpError(err.message, null, err.code ?? "network", true);
    }
  }
  return browserFetch({ ...req, headers }, "follow");
}

async function browserFetch(req: HttpRequest, redirect: RequestRedirect): Promise<HttpResponse> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 30000);
  const started = performance.now();
  try {
    const res = await fetch(req.url, { method: req.method ?? "GET", headers: req.headers, body: req.body, signal: ctrl.signal, redirect, credentials: "omit" });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return { status: res.status, headers, body: req.method === "HEAD" ? "" : await res.text(), latencyMs: Math.round(performance.now() - started) };
  } catch (e) {
    const aborted = (e as Error).name === "AbortError";
    throw new HttpError(
      aborted ? "Tiempo de espera agotado" : "Error de red (en modo navegador el proveedor puede bloquear CORS; usá la app de escritorio)",
      null,
      aborted ? "timeout" : "network",
      true,
    );
  } finally {
    clearTimeout(t);
  }
}

/** JSON helper with uniform error handling for API connectors. */
export async function secureJson<T>(secret: SecretKey, req: HttpRequest): Promise<{ data: T; headers: Record<string, string> }> {
  const res = await secureRequest(secret, { ...req, headers: { Accept: "application/json", ...(req.body ? { "Content-Type": "application/json" } : {}), ...req.headers } });
  return { data: parseOrThrow<T>(res), headers: res.headers };
}

export function parseOrThrow<T>(res: HttpResponse): T {
  if (res.status >= 200 && res.status < 300) {
    try {
      return (res.body ? JSON.parse(res.body) : null) as T;
    } catch {
      throw new HttpError("Respuesta inválida del proveedor", res.status, "invalid_json", false);
    }
  }
  let msg = `HTTP ${res.status}`;
  try {
    const j = JSON.parse(res.body);
    const m = j?.message ?? j?.error?.message ?? j?.error_description ?? (typeof j?.error === "string" ? j.error : null);
    if (m) msg += `: ${String(m).slice(0, 300)}`;
  } catch {
    /* non-JSON body */
  }
  const code = res.status === 401 ? "unauthorized" : res.status === 403 ? "forbidden" : res.status === 404 ? "not_found" : res.status === 429 ? "rate_limited" : "http_error";
  throw new HttpError(msg, res.status, code, res.status === 429 || res.status >= 500);
}
