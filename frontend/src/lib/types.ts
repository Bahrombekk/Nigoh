/* lib/types.ts — backend javoblari shakli (docs/V3_API.md, backend camera/views.py).
   Hammasi kerakli maydonlar emas — sahifalar o'zlariga keraklisini qo'shadi. */

export type Role = "admin" | "operator" | "viewer";
export type ApiState = "online" | "stalled" | "offline" | "disabled" | "unknown";
/** UI holat modeli (Figma): stalled → "no-video" */
export type UiStatus = "online" | "no-video" | "offline" | "disabled" | "unknown";

export interface Me {
  authenticated: boolean;
  username?: string;
  role?: Role;
  full_name?: string;
  prefs?: Prefs;
  public_view?: boolean;
  guest_view?: boolean;
  site_name?: string;
  session_hours?: number;
  poll_s?: number;
  language?: string;
  version?: string;
}

export interface Prefs {
  theme?: "white" | "cream" | "dark";
  lang?: string;
  [key: string]: unknown;
}

export interface Camera {
  id: number;
  name: string;
  region: string;
  lat: number | null;
  lng: number | null;
  km?: number | null;
  picket?: number | null;
  state: ApiState;
  state_reason?: string | null;
  online?: boolean | null;
  last_seen?: string | null;
  codec?: string | null;
  resolution?: string | null;
  fps?: number | null;
  transcode?: boolean;
  vendor?: string | null;
  model?: string | null;
  online_since?: string | null;
  [key: string]: unknown;
}

export interface SystemService { key: string; name: string; state: "ok" | "warn" | "error"; detail: string }
export interface SystemState {
  state: "ok" | "degraded" | "down";
  label: string;
  services: SystemService[];
  checked_at: string;
}

export interface Notice {
  id: string;
  type: "offline" | "online" | "system";
  title: string;
  text: string;
  ts: string;
  camera_id: number | null;
  severity: "error" | "warning" | "success" | "info";
  read: boolean;
}
export interface NoticeList {
  items: Notice[];
  unread: number;
  counts: { all: number; outage: number; system: number };
}

export const STATUS_OF: Record<ApiState, UiStatus> = {
  online: "online", stalled: "no-video", offline: "offline", disabled: "disabled", unknown: "unknown",
};
export const STATUS_LABEL: Record<UiStatus, string> = {
  online: "Onlayn", "no-video": "Tasvirsiz", offline: "Uzilgan", disabled: "Oʻchirilgan", unknown: "Nomaʼlum",
};
export function camStatus(c: Pick<Camera, "state" | "online">): UiStatus {
  if (c.state && STATUS_OF[c.state]) return STATUS_OF[c.state];
  return c.online === false ? "offline" : c.online ? "online" : "unknown";
}
export const ROLE_LABEL: Record<Role, string> = { admin: "Administrator", operator: "Operator", viewer: "Kuzatuvchi" };
