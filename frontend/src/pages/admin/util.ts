/* pages/admin/util.ts — Boshqaruv yordamchilari (v3 admin/admin.js + camera-form.js dan).
   Holat/kodek/rejim yorliqlari, oqim manzili, ulanish tekshiruvi (probe), validatorlar,
   koordinatadan hudud (uz_regions.geojson), cheklangan parallellik, nusxalash. */
import { api, ApiError } from "@/lib/api";
import type { ApiState, UiStatus } from "@/lib/types";

/* ---------- Admin kamera yozuvi (GET /api/admin/cameras) ---------- */
export interface AdminCamera {
  id: number;
  name: string;
  region: string;
  lat: number | null;
  lng: number | null;
  state?: ApiState;
  enabled: boolean;
  source_type: "rtsp" | "manual" | string;
  ip?: string | null;
  port?: number | null;
  username?: string | null;
  rtsp_path?: string | null;
  raw_stream_url?: string | null;
  vendor?: string | null;
  codec?: string | null;
  transcode?: boolean;
  always_on?: boolean;
  note?: string | null;
  external_id?: string | null;
  node_id?: number | null;
  rail_line_id?: number | null;
  km?: number | null;
  picket?: number | null;
  [key: string]: unknown;
}

export interface AdminList {
  total: number;
  offset?: number;
  limit?: number;
  counts?: Record<string, number>;
  facets?: { regions?: string[]; codecs?: string[]; modes?: string[] };
  cameras: AdminCamera[];
}

export interface Vendor { id: string; name: string; path: string; port: number }

const API_TO_UI: Record<string, UiStatus> = { online: "online", stalled: "no-video", offline: "offline", disabled: "disabled", unknown: "unknown" };
export const STATE_RANK: Record<string, number> = { online: 0, stalled: 1, offline: 2, unknown: 3, disabled: 4 };

/** Backend holati: admin yozuvida `state`, bo'lmasa ochiq ro'yxatdagi `online`. */
export function camApiState(cam: AdminCamera, pubOnline?: boolean | null): ApiState {
  if (!cam.enabled) return "disabled";
  if (cam.state && API_TO_UI[cam.state]) return cam.state;
  if (pubOnline === true) return "online";
  if (pubOnline === false) return "offline";
  return "unknown";
}
export function camUiStatus(cam: AdminCamera, pubOnline?: boolean | null): UiStatus {
  return API_TO_UI[camApiState(cam, pubOnline)] || "unknown";
}

export function codecKind(cam: { codec?: string | null; transcode?: boolean }): "" | "h264" | "h265" | "transcode" {
  if (cam.transcode) return "transcode";
  if (/h265|hevc/i.test(cam.codec || "")) return "h265";
  if (/h264|avc/i.test(cam.codec || "")) return "h264";
  return "";
}
export function codecLabel(cam: { codec?: string | null; transcode?: boolean }): string {
  const k = codecKind(cam);
  if (k === "transcode") return "H.265 → H.264";
  if (k === "h265") return "H.265";
  if (k === "h264") return "H.264";
  return cam.codec ? String(cam.codec) : "—";
}
export function modeLabel(cam: AdminCamera) { return cam.always_on ? "Doim tayyor" : "Soʻrov boʻyicha"; }

/** Jadvaldagi manzil (sxemasiz, parolsiz): "10.30.33.60:554/cam/realmonitor?…" */
export function streamAddr(cam: AdminCamera): string {
  if (cam.source_type === "rtsp") {
    if (!cam.ip) return "";
    let p = cam.rtsp_path || "";
    if (p && !p.startsWith("/")) p = "/" + p;
    return cam.ip + ":" + (cam.port || 554) + p;
  }
  return cam.raw_stream_url || "";
}
/** Nusxalanadigan to'liq manzil (login/parolsiz). */
export function streamUrl(cam: AdminCamera): string {
  const a = streamAddr(cam);
  if (!a) return "";
  return cam.source_type === "rtsp" ? "rtsp://" + a : a;
}
export const canTest = (cam: AdminCamera) => cam.source_type === "rtsp" && !!cam.ip;

/* ---------- Ulanishni tekshirish ---------- */
export interface ProbeResult {
  ok: boolean; message?: string; codec?: string | null; resolution?: string | null; fps?: number | null;
  needs_transcode?: boolean; ms: number;
}
export interface ProbeBody {
  ip?: string | null; port?: number | null; username?: string | null; password?: string | null;
  rtsp_path?: string | null; camera_id?: number | null;
}
/** Saqlangan parol bilan (password: null) tekshirish → {ok, message, codec, resolution, fps, ms} */
export async function probeCamera(cam: Partial<AdminCamera>, over: ProbeBody = {}): Promise<ProbeResult> {
  const t0 = performance.now();
  const r = await api<Omit<ProbeResult, "ms">>("/api/admin/probe", {
    method: "POST",
    body: {
      ip: cam.ip, port: cam.port || 554, username: cam.username || "",
      password: null, rtsp_path: cam.rtsp_path || "/", camera_id: cam.id || null,
      ...over,
    },
  });
  return { ...r, ms: performance.now() - t0 };
}
export function fmtSec(ms: number) { return (ms / 1000).toFixed(1).replace(".", ",") + " s"; }
export function fmtRes(res?: string | null) {
  const m = /(\d+)\s*x\s*(\d+)/i.exec(res || "");
  return m ? m[2] + "p" : (res || "");
}

/** 404/405 — endpoint hali yo'q (eski backend). */
export function missing(e: unknown) { return e instanceof ApiError && (e.status === 404 || e.status === 405); }

/** N ta ishni cheklangan parallellikda bajarish. */
export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  const run = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
  return out;
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch { /* jim */ }
    ta.remove();
  }
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- Validatsiya ---------- */
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOST = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
export const validators = {
  required: (v: string, m: string) => (v.trim() ? "" : m),
  ip(v: string) {
    v = v.trim();
    if (!v) return "IP manzilni kiriting";
    if (/^\d+(\.\d+)*$/.test(v)) return IPV4.test(v) ? "" : "Manzil formati notoʻgʻri: 0–255.0–255.0–255.0–255";
    return HOST.test(v) ? "" : "Manzil formati notoʻgʻri";
  },
  port(v: string | number) {
    const n = Number(String(v).trim());
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? "" : "Port 1–65535 oraligʻida boʻlsin";
  },
  lat(v: string, required: boolean) {
    if (!String(v).trim()) return required ? "Xaritada nuqtani tanlang" : "";
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) && n >= -90 && n <= 90 ? "" : "Kenglik −90…90 oraligʻida";
  },
  lng(v: string, required: boolean) {
    if (!String(v).trim()) return required ? "Xaritada nuqtani tanlang" : "";
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) && n >= -180 && n <= 180 ? "" : "Uzunlik −180…180 oraligʻida";
  },
  url(v: string) {
    v = v.trim();
    if (!v) return "Oqim manzilini kiriting";
    return /^(rtsp|rtsps|https?):\/\/[^\s]+$/i.test(v) ? "" : "Manzil rtsp:// yoki http(s):// bilan boshlansin";
  },
};
export const num = (v: string): number | null => {
  const n = Number(String(v).replace(",", ".").trim());
  return String(v).trim() && Number.isFinite(n) ? n : null;
};

/** "ip:port/yo'l" (ixtiyoriy rtsp:// va login[:parol]@) → qismlar */
export function parseRtsp(v: string) {
  const m = /^(?:rtsps?:\/\/)?(?:([^:@/\s]+)(?::([^@/\s]*))?@)?([^:/\s?#]+)(?::(\d+))?(\/[^\s]*)?$/i.exec(v.trim());
  if (!m) return null;
  return { user: m[1] ? decodeURIComponent(m[1]) : null, pass: m[2] ? decodeURIComponent(m[2]) : null,
           ip: m[3], port: m[4] ? Number(m[4]) : 554, path: m[5] || "/" };
}

/* ---------- Koordinatadan hudud ---------- */
type Ring = number[][];
interface GeoFeature { properties: { name: string }; geometry: { type: string; coordinates: Ring[] | Ring[][] } }
function pointInRing(lat: number, lng: number, ring: Ring) {
  // Nur usuli (ray casting); geojson koordinatasi [lng, lat] tartibida.
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
let regionGeo: { features: GeoFeature[] } | null = null;
let regionGeoP: Promise<{ features: GeoFeature[] }> | null = null;
function ensureRegionGeo() {
  if (regionGeo) return Promise.resolve(regionGeo);
  if (!regionGeoP) regionGeoP = fetch("/assets/uz_regions.geojson")
    .then((r) => { if (!r.ok) throw new Error("chegara fayli yuklanmadi"); return r.json(); })
    .then((g) => { regionGeo = g; return g; })
    .catch((e) => { regionGeoP = null; throw e; });
  return regionGeoP;
}
function regionAtSync(lat: number, lng: number): string {
  if (!regionGeo) return "";
  for (const f of regionGeo.features) {
    const g = f.geometry;
    const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as Ring[][];
    for (const poly of polys) {
      if (pointInRing(lat, lng, poly[0]) && !poly.slice(1).some((h) => pointInRing(lat, lng, h))) return f.properties.name;
    }
  }
  return "";
}
/** Koordinatadan viloyat nomi ("" — topilmadi yoki fayl yuklanmadi). */
export async function regionAt(lat: number, lng: number): Promise<string> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  try { await ensureRegionGeo(); } catch { return ""; }
  return regionAtSync(lat, lng);
}
