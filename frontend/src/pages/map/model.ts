/* pages/map/model.ts — xarita bo'limining ma'lumot modeli (sof funksiyalar va turlar):
   hududlar bo'yicha guruhlash, qidiruv natijalari (02.04), guruhlar turi, kontekst. */
import { createContext, useContext } from "react";
import type { Camera, UiStatus } from "@/lib/types";
import type { MapController } from "./MapController";
import { NOGEO, camStatus, norm, regionKey, worstStatus } from "./util";

export const GROUPS_KEY = ["groups"] as const;

export type ListView = "cams" | "regs" | "grps";
export type StatusFilter = "online" | "offline" | "no-video";

export interface Group {
  id: number; name: string; color: string; shared: boolean; owner_name: string;
  mine: boolean; can_edit: boolean; camera_ids: number[]; hidden: number;
}

export interface RegionInfo {
  key: string; name: string; items: Camera[];
  n: { online: number; offline: number; "no-video": number }; worst: UiStatus;
}

export function countStates(items: Camera[]) {
  const n = { online: 0, offline: 0, "no-video": 0 };
  items.forEach((c) => { const s = camStatus(c); if (s in n) n[s as keyof typeof n]++; });
  return n;
}

/* Hududlar bo'yicha: uzilganlar soni ↓, tasvirsizlar ↓, jami ↓; koordinatasizlar oxirida. */
export function groupByRegion(cams: Camera[]): RegionInfo[] {
  const by = new Map<string, Camera[]>();
  cams.forEach((c) => {
    const k = regionKey(c);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(c);
  });
  const list = [...by.entries()].map(([key, items]) => ({
    key, name: key === NOGEO ? "Belgilanmagan" : key, items, n: countStates(items), worst: worstStatus(items),
  }));
  list.sort((a, b) => (Number(a.key === NOGEO) - Number(b.key === NOGEO)) || b.n.offline - a.n.offline ||
    b.n["no-video"] - a.n["no-video"] || b.items.length - a.items.length || a.name.localeCompare(b.name));
  return list;
}

export function regionMeta(r: RegionInfo) {
  return r.items.length + " kamera" + (r.key === NOGEO ? " · koordinatasiz" : "");
}

export interface SearchResults {
  q: string;
  camHits: Camera[];
  kmMap: Map<string, Camera[]>;
  regions: RegionInfo[];
  ids: Set<number>;
  total: number;
}

export function searchCams(q: string, cams: Camera[]): SearchResults {
  const qn = norm(q);
  const camHits = cams.filter((c) => norm(c.name).includes(qn) || (c.km != null && String(c.km).includes(qn)));
  const kmMap = new Map<string, Camera[]>();
  cams.forEach((c) => {
    if (c.km == null || !String(c.km).includes(qn)) return;
    const k = String(c.km);
    if (!kmMap.has(k)) kmMap.set(k, []);
    kmMap.get(k)!.push(c);
  });
  const regions = groupByRegion(cams).filter((r) => norm(r.name).includes(qn));
  const ids = new Set(camHits.map((c) => c.id));
  kmMap.forEach((l) => l.forEach((c) => ids.add(c.id)));
  regions.forEach((r) => r.items.forEach((c) => ids.add(c.id)));
  return { q, camHits, kmMap, regions, ids, total: camHits.length + kmMap.size + regions.length };
}

/* ---------- Kontekst: sahifa holati va amallari ---------- */
export interface MapApi {
  ctl: MapController | null;
  cameras: Camera[];
  byId: Map<number, Camera>;
  visible: Camera[];
  loaded: boolean;
  groups: Group[];
  groupsById: Map<number, Group>;
  canEdit: boolean;
  authed: boolean;
  isAdminUser: boolean;

  selectedId: number | null;
  cardId: number | null;
  drawerOpen: boolean;
  selectCamera: (id: number, fly?: boolean) => void;
  openCard: (id: number) => void;
  closeCard: (deselect: boolean) => void;
  closeDrawer: () => void;
  toWall: (id: number | null) => void;
  editCamera: (id: number | null) => void;

  pickMode: boolean;
  pickIds: Set<number>;
  setPickMode: (on: boolean) => void;
  togglePick: (id: number) => void;
  setPickIds: (ids: Set<number>) => void;
  lassoOn: boolean;
  setLasso: (on: boolean) => void;
  groupFilter: number | null;
  setGroupFilter: (id: number | null) => void;
  openGroupPicker: (ids: number[], title: string) => void;
  openGroupEditor: (g: Group) => void;
  groupMembers: (groupId: number, ids: number[], mode: "add" | "remove") => Promise<Group | null>;
  openGroupOnWall: (g: Group) => void;

  filters: Set<StatusFilter>;
  toggleFilter: (f: StatusFilter | "") => void;
  clearFilters: () => void;
  listView: ListView;
  setView: (v: ListView) => void;
  q: string;
  qApplied: string;
  setQuery: (v: string, now?: boolean) => void;
  results: SearchResults | null;
  openRegions: Record<string, boolean>;
  setOpenRegions: (f: (o: Record<string, boolean>) => Record<string, boolean>) => void;
  focus: string | null;
  setFocus: (k: string | null) => void;
  flyToRegion: (r: RegionInfo) => void;
  pollFails: number;
  camsAt: number;
  retry: () => Promise<unknown>;
  pollS: number;

  measuring: boolean;
  setMeasure: (on: boolean) => void;
  collapsed: boolean;
  setCollapsed: (c: boolean, persist: boolean) => void;
  padTL: () => [number, number];
  hoverBus: EventTarget;
}

export const MapCtx = createContext<MapApi | null>(null);
export function useMap(): MapApi {
  const c = useContext(MapCtx);
  if (!c) throw new Error("MapCtx yo'q");
  return c;
}
