/* lib/api.ts — backend bilan aloqa (docs/V3_API.md).
   api<T>(path, opts) — JSON yuboradi/oladi; xato → ApiError (status, body).
   401 (login'dan tashqari) → "nigoh:unauthorized" hodisasi (AuthProvider kirish
   ekranini "Seans tugadi" holatida ochadi). Tarmoq/5xx → "nigoh:api-status". */

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let ok = true;
function setOk(v: boolean) {
  if (ok === v) return;
  ok = v;
  window.dispatchEvent(new CustomEvent("nigoh:api-status", { detail: { ok: v } }));
}
export function apiOk() { return ok; }

type Opts = Omit<RequestInit, "body"> & { body?: unknown };

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const { body, headers, ...rest } = opts;
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json", ...headers } : headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      ...rest,
    });
  } catch {
    setOk(false);
    throw new ApiError("Server bilan aloqa yoʻq", 0);
  }
  if (res.status === 401 && !path.startsWith("/api/auth/login")) {
    setOk(true);
    window.dispatchEvent(new CustomEvent("nigoh:unauthorized"));
    throw new ApiError("Seans tugadi — qaytadan kiring", 401);
  }
  if (!res.ok) {
    setOk(res.status < 500);
    let data: Record<string, unknown> = {};
    try { data = await res.json(); } catch { /* bo'sh javob */ }
    const d = data.detail as unknown;
    const msg = typeof d === "string" ? d
      : Array.isArray(d) && d[0] && typeof d[0].msg === "string" ? d[0].msg : "Xatolik yuz berdi";
    throw new ApiError(msg, res.status, data);
  }
  setOk(true);
  if (res.status === 204) return null as T;
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("json") ? res.json() : res.text()) as Promise<T>;
}
