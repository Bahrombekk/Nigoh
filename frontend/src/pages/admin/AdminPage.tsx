/* pages/admin/AdminPage.tsx — 05 Boshqaruv: kameralar jadvali (v3 admin/admin.js; Figma 05.01–05.04,
   05.08, 05.10, 05.15, 05.16).
     - Sarlavha "Kameralar" + Sysbar.
     - Toolbar: holat chiplari (ko'p tanlovli, serverdagi sonlar), qidiruv ("/"), "Filtr" popover'i
       (Hudud / Kodek / Rejim, "Filtr · N"), Eksport menyusi, "⋯" (Registratordan qoʻshish, Media
       sozlamalari), "Kamera qoʻshish" (3 qadamli oyna).
     - Jadval: checkbox (indeterminate), Holat, Kamera, Hudud, Oqim manzili (hover — to'liq + nusxalash),
       Kodek, Rejim, Amallar (⋯; hover/tanlanganda ✎ ▶). Saralash serverda; qator bosilsa — drawer.
     - Qator menyusi (E / T / M / ⌫), ommaviy panel, sahifalash 25/50/100, bo'sh holat.
     - O'chirish: tasdiq → toast "Kamera oʻchirildi · Qaytarish" (10 s, restore).
     - Dashboard ishorasi: navigate("/admin", {state: {adminFilter: {status?, ids?, label?}}}) — bir marta
       olinadi; ids — olib tashlanadigan chip (brauzerda filtrlanadi).
   Rejimlar: javobda `counts` bo'lsa — server filtrlaydi; yo'q bo'lsa (eski backend) yoki aniq ids /
   "H.265 → H.264" filtri bo'lsa — butun ro'yxat olinib brauzerda hisoblanadi. UI bir xil.
   Video devorga — prefs "wall.pinned" (id ro'yxati; devor shu kameralarni oldinga qo'yadi). */
import "@/styles/admin.css";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { prefs } from "@/lib/prefs";
import { debounce } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/types";
import { useCameras, usePollSeconds } from "@/data/queries";
import { Icon } from "@/components/Icon";
import { Badge, Button, Chip, EmptyState, IconButton, InfoTip, cx } from "@/components/ui";
import { Menu, Popover, useConfirm, useDelayed, useMenuAnchor, useShortcut, useToast, type MenuEntry, type Place } from "@/components/overlays";
import { useT } from "@/i18n/I18nProvider";
import { Sysbar } from "@/layout/Sysbar";
import { CameraWizard } from "./CameraWizard";
import { CameraDrawer } from "./CameraDrawer";
import { NvrDialog } from "./NvrDialog";
import { MediaMtxDialog } from "./MediaMtxDialog";
import { ADMIN_KEY, fetchAllAdmin, invalidateAdmin } from "./queries";
import {
  STATE_RANK, camApiState, camUiStatus, canTest, codecKind, codecLabel, copyText, download, fmtSec, missing,
  modeLabel, pool, probeCamera, streamAddr, streamUrl, type AdminCamera, type AdminList,
} from "./util";

const CHIPS = [
  { key: "", label: "Hammasi" },
  { key: "online", label: "Onlayn", ui: "online" },
  { key: "offline", label: "Uzilgan", ui: "offline" },
  { key: "stalled", label: "Tasvirsiz", ui: "no-video" },
  { key: "disabled", label: "Oʻchirilgan", ui: "disabled", hideZero: true },
] as const;
const CODECS = [
  { v: "h264", label: "H.264" },
  { v: "h265", label: "H.265" },
  { v: "transcode", label: "H.265 → H.264" },
];
const MODES = [
  { v: "ondemand", label: "Soʻrov boʻyicha" },
  { v: "always", label: "Doim tayyor" },
];

interface Filters { region: string; codec: string; mode: string }
interface IdFilter { ids: Set<number>; label: string }
interface AdminHint { status?: string; ids?: number[]; label?: string }
type RowItem = { key?: string; label: string; icon: string; kbd?: string; disabled?: boolean; danger?: boolean; run: () => void } | "sep";

const NO_FILTERS: Filters = { region: "", codec: "", mode: "" };

/** Toast'ni matni bo'yicha yopish (useToast yopish funksiyasini qaytarmaydi). */
function dismissToast(text: string) {
  document.querySelectorAll("#toasts .toast").forEach((el) => {
    if (el.querySelector(".toast__msg")?.textContent === text) el.querySelector<HTMLButtonElement>(".toast__close")?.click();
  });
}

function matchesQ(c: AdminCamera, q: string) {
  if (!q) return true;
  const hay = [c.name, c.region, c.ip, c.ip ? c.ip + ":" + c.port : "", c.rtsp_path, c.raw_stream_url,
               c.km != null ? String(c.km) : ""].join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

export default function AdminPage() {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const poll = usePollSeconds();
  const { byId } = useCameras();

  /* ---------- Holat ---------- */
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState("name");
  const [offset, setOffset] = useState(0);
  const [size, setSize] = useState(50);
  const [idFilter, setIdFilter] = useState<IdFilter | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [selected, setSelected] = useState<Map<number, AdminCamera>>(() => new Map());

  const [wizard, setWizard] = useState(false);
  const [nvr, setNvr] = useState(false);
  const [mtx, setMtx] = useState(false);
  const [editCam, setEditCam] = useState<AdminCamera | null>(null);
  const [rowMenu, setRowMenu] = useState<{ cam: AdminCamera; anchor: HTMLElement; place: Place } | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<HTMLButtonElement | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [groupMenu, setGroupMenu] = useState<{ anchor: HTMLElement; items: MenuEntry[] } | null>(null);
  const exportMenu = useMenuAnchor("bottom-end");
  const moreMenu = useMenuAnchor("bottom-end");
  const searchRef = useRef<HTMLInputElement>(null);
  const regionsRef = useRef<string[]>([]);

  const applyQ = useMemo(() => debounce((v: string) => { setQ(v.trim()); setOffset(0); }, 300), []);

  /* ---------- Dashboard ishorasi (bir marta) ---------- */
  useEffect(() => {
    const st = loc.state as { adminFilter?: AdminHint; adminAction?: "new-camera" | "sync" } | null;
    // Statistika → Tezkor amallar: "Kamera qoʻshish" va "MediaMTX" (v3 dagi #new-cam / #sync-btn).
    if (st?.adminAction === "new-camera") setWizard(true);
    if (st?.adminAction === "sync") setMtx(true);
    const f = st?.adminFilter;
    if (!f) { if (st?.adminAction) nav(loc.pathname + loc.search, { replace: true, state: null }); return; }
    if (f.status) setStatuses([f.status]);
    if (f.ids && f.ids.length) setIdFilter({ ids: new Set(f.ids.map(Number)), label: f.label || "Tanlangan kameralar" });
    setOffset(0);
    nav(loc.pathname + loc.search, { replace: true, state: null });
  }, [loc.key]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- So'rov ---------- */
  const filterCount = Object.values(filters).filter(Boolean).length;
  const hasAnyFilter = !!(q || statuses.length || filterCount || idFilter);
  const needsClient = !!idFilter || filters.codec === "transcode";
  const clientMode = legacy || needsClient;

  const params = useCallback((withPage: boolean) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (statuses.length) p.set("status", statuses.join(","));
    (Object.entries(filters) as [string, string][]).forEach(([k, v]) => { if (v) p.set(k, v); });
    if (sort) p.set("sort", sort);
    if (withPage) { p.set("offset", String(offset)); p.set("limit", String(size)); }
    return p.toString();
  }, [q, statuses, filters, sort, offset, size]);

  const serverQ = useQuery({
    queryKey: [...ADMIN_KEY, "page", params(true)],
    queryFn: () => api<AdminList>("/api/admin/cameras?" + params(true)),
    enabled: !clientMode,
    placeholderData: keepPreviousData,
    refetchInterval: poll * 1000,
    retry: false,
  });
  const allQ = useQuery({
    queryKey: [...ADMIN_KEY, "all"],
    queryFn: fetchAllAdmin,
    enabled: clientMode,
    placeholderData: keepPreviousData,
    refetchInterval: poll * 1000,
    retry: false,
  });
  useEffect(() => { if (serverQ.data && !serverQ.data.counts) setLegacy(true); }, [serverQ.data]);
  const activeQ = clientMode ? allQ : serverQ;

  const pubOnline = useCallback((c: AdminCamera) => byId.get(c.id)?.online, [byId]);
  const apiState = useCallback((c: AdminCamera) => camApiState(c, pubOnline(c)), [pubOnline]);

  /* ---------- Ko'rinish: server yoki brauzer ---------- */
  const view = useMemo(() => {
    if (!clientMode) {
      const res = serverQ.data;
      if (!res || !res.counts) return null;
      const f = res.facets || {};
      if (Array.isArray(f.regions) && f.regions.length) regionsRef.current = f.regions.map(String);
      else if (!regionsRef.current.length) regionsRef.current = [...new Set(res.cameras.map((c) => c.region).filter(Boolean))].sort();
      return { rows: res.cameras || [], total: res.total || 0, counts: res.counts, filtered: null as AdminCamera[] | null };
    }
    const all = allQ.data;
    if (!all) return null;
    const ids = idFilter?.ids;
    const base = all.filter((c) =>
      (!ids || ids.has(Number(c.id))) &&
      matchesQ(c, q) &&
      (!filters.region || c.region === filters.region) &&
      (!filters.codec || codecKind(c) === filters.codec) &&
      (!filters.mode || (filters.mode === "always") === !!c.always_on));
    const counts: Record<string, number> = { all: base.length, online: 0, offline: 0, stalled: 0, disabled: 0, unknown: 0 };
    base.forEach((c) => { const s = apiState(c); counts[s] = (counts[s] || 0) + 1; });
    let list = statuses.length ? base.filter((c) => statuses.includes(apiState(c))) : base;
    const key = sort.replace(/^-/, "");
    const dir = sort.startsWith("-") ? -1 : 1;
    const coll = new Intl.Collator("uz", { numeric: true, sensitivity: "base" });
    const val = (c: AdminCamera): string | number =>
      key === "state" ? STATE_RANK[apiState(c)] : key === "codec" ? codecLabel(c) : String(c[key] ?? "");
    if (key) list = [...list].sort((a, b) => {
      const va = val(a), vb = val(b);
      const r = typeof va === "number" ? va - (vb as number) : coll.compare(va, vb as string);
      return dir * (r || coll.compare(a.name || "", b.name || ""));
    });
    regionsRef.current = [...new Set(all.map((c) => c.region).filter(Boolean))].sort((a, b) => coll.compare(a, b));
    return { rows: list.slice(offset, offset + size), total: list.length, counts, filtered: list };
  }, [clientMode, serverQ.data, allQ.data, idFilter, q, filters, statuses, sort, offset, size, apiState]);

  const rows = useMemo(() => view?.rows || [], [view]);
  const total = view?.total || 0;
  const counts = view?.counts || {};

  /* Sahifa chegaradan chiqsa — oxirgi sahifa. */
  useEffect(() => {
    if (offset && total && offset >= total) setOffset(Math.floor((total - 1) / size) * size);
  }, [offset, total, size]);

  /* Tanlangan kameralarning yozuvini yangilaymiz (sahifadagilari). */
  useEffect(() => {
    setSelected((m) => {
      let changed = false;
      const n = new Map(m);
      rows.forEach((c) => { if (n.has(c.id) && n.get(c.id) !== c) { n.set(c.id, c); changed = true; } });
      return changed ? n : m;
    });
  }, [rows]);

  const loading = activeQ.isFetching && (activeQ.isPlaceholderData || !activeQ.data);
  const showSk = useDelayed(loading, 300);
  const error = activeQ.isError ? (activeQ.error as Error) : null;

  /* ---------- Yorliqlar ---------- */
  useShortcut("/", () => { searchRef.current?.focus(); searchRef.current?.select(); });
  useShortcut("Escape", () => {
    if (!selected.size) return false;
    setSelected(new Map());
  });

  /* ---------- Filtrlar ---------- */
  const toggleStatus = (k: string) => {
    setStatuses((s) => (!k ? [] : s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
    setOffset(0);
  };
  const setFilter = (k: keyof Filters, v: string) => { setFilters((f) => ({ ...f, [k]: v })); setOffset(0); };
  const clearFilters = () => {
    setQ(""); setQInput(""); setStatuses([]); setFilters(NO_FILTERS); setIdFilter(null); setOffset(0);
  };
  const filterSummary = () => {
    const parts: string[] = [];
    if (idFilter) parts.push(t(idFilter.label));
    if (statuses.length) parts.push(CHIPS.filter((c) => statuses.includes(c.key)).map((c) => t(c.label)).join(", "));
    if (filters.region) parts.push(filters.region);
    if (filters.codec) parts.push(CODECS.find((c) => c.v === filters.codec)?.label || "");
    if (filters.mode) parts.push(t(MODES.find((c) => c.v === filters.mode)?.label || ""));
    if (q) parts.push("«" + q + "»");
    return parts.join(" · ");
  };

  /* ---------- Amallar ---------- */
  const openCam = (id: number) => nav("/?camera=" + id);

  const showOnMap = (cam: AdminCamera) => {
    const pub = byId.get(cam.id);
    if (!pub) { toast("Kamera xaritada koʻrinmaydi (oʻchirilgan)", { tone: "info" }); return; }
    if (!(cam.lat || pub.lat) || !(cam.lng || pub.lng)) toast("Bu kameraga koordinata kiritilmagan", { tone: "info" });
    openCam(cam.id);
  };

  const addToWall = (cams: AdminCamera[]) => {
    if (!cams.length) return;
    const pinned = [...prefs.get<number[]>("wall.pinned", [])];
    cams.forEach((c) => { if (!pinned.includes(c.id)) pinned.push(c.id); });
    prefs.set("wall.pinned", pinned);
    toast(cams.length === 1 ? "«" + cams[0].name + "» video devorga qoʻshildi" : cams.length + " ta kamera video devorga qoʻshildi",
      { action: "Ochish", onAction: () => nav("/wall") });
  };

  const copyUrl = async (cam: AdminCamera) => {
    const u = streamUrl(cam);
    if (!u) return;
    await copyText(u);
    toast("Oqim manzili nusxalandi");
  };

  const testCamera = async (cam: AdminCamera) => {
    if (!canTest(cam)) { toast("Tayyor oqim manzilini tekshirib boʻlmaydi", { tone: "info" }); return; }
    const wait = cam.name + " · tekshirilmoqda…";
    toast(wait, { tone: "info", ms: 15000 });
    try {
      const r = await probeCamera(cam);
      dismissToast(t(wait));
      if (r.ok) toast(cam.name + " · ulanish barqaror · " + fmtSec(r.ms), { action: "Videoni ochish", ms: 6000, onAction: () => openCam(cam.id) });
      else toast(cam.name + " · " + (r.message || "ulanmadi"), { tone: "error", ms: 6000 });
    } catch (e) {
      dismissToast(t(wait));
      toast(cam.name + " · " + (e as Error).message, { tone: "error" });
    }
  };

  const bulk = async (action: string, cams: AdminCamera[]) => {
    try {
      const r = await api<{ results: { id: number; ok: boolean; detail?: string }[] }>("/api/admin/cameras/bulk",
        { method: "POST", body: { action, ids: cams.map((c) => c.id) } });
      return (r && r.results) || [];
    } catch (e) {
      if (!missing(e)) throw e;
      return null;                       // eski backend — bittalab
    }
  };

  const bulkTest = async (cams: AdminCamera[]) => {
    const list = cams.filter(canTest);
    if (!list.length) { toast("Tanlanganlar orasida RTSP kamera yoʻq", { tone: "info" }); return; }
    const wait = list.length + " ta kamera tekshirilmoqda…";
    toast(wait, { tone: "info", ms: 60000 });
    try {
      let res = await bulk("test", list);
      if (!res) res = await pool(list, 4, async (c) => {
        try { const r = await probeCamera(c); return { id: c.id, ok: !!r.ok, detail: r.message }; }
        catch (e) { return { id: c.id, ok: false, detail: (e as Error).message }; }
      });
      dismissToast(t(wait));
      const ok = res.filter((r) => r.ok).length;
      const bad = res.length - ok;
      const firstBad = res.find((r) => !r.ok);
      const name = firstBad ? list.find((c) => c.id === firstBad.id)?.name : "";
      toast(bad ? ok + " tasi ulandi · " + bad + " tasida xato" + (name && firstBad ? " (" + name + ": " + (firstBad.detail || "ulanmadi") + ")" : "")
                : "Hammasi ulandi · " + ok + " ta kamera",
            { tone: bad ? "error" : "success", ms: 8000 });
    } catch (e) { dismissToast(t(wait)); toast((e as Error).message, { tone: "error" }); }
  };

  const addToGroup = async (g: { id: number; name: string }, cams: AdminCamera[]) => {
    try {
      await api("/api/groups/" + g.id + "/cameras", { method: "POST", body: { camera_ids: cams.map((c) => c.id), mode: "add" } });
      qc.invalidateQueries({ queryKey: ["groups"] });
      toast(cams.length + " ta kamera «" + g.name + "» guruhiga qoʻshildi");
    } catch (e) { toast((e as Error).message, { tone: "error" }); }
  };

  const openGroupMenu = async (anchor: HTMLElement, cams: AdminCamera[]) => {
    let groups: { id: number; name: string; can_edit?: boolean }[] = [];
    try {
      const r = await api<{ groups?: typeof groups } | typeof groups>("/api/groups");
      groups = (Array.isArray(r) ? r : r.groups || []).filter((g) => g.can_edit !== false);
    } catch (e) { toast("Guruhlar yuklanmadi: " + (e as Error).message, { tone: "error" }); return; }
    const items: MenuEntry[] = groups.length
      ? [{ heading: "Guruhni tanlang" }, ...groups.map((g) => ({ label: g.name, icon: "layer-group", onClick: () => addToGroup(g, cams) }))]
      : [{ label: "Tahrirlanadigan guruh yoʻq", disabled: true }];
    setGroupMenu({ anchor, items });
  };

  const restore = async (cams: AdminCamera[]) => {
    const out = await pool(cams, 4, async (c) => {
      try { await api("/api/admin/cameras/" + c.id + "/restore", { method: "POST" }); return true; }
      catch (e) { return missing(e) ? null : false; }
    });
    if (out.every((x) => x === null)) { toast("Qaytarish serverda hali yoʻq", { tone: "error" }); return; }
    const n = out.filter(Boolean).length;
    invalidateAdmin(qc);
    toast(n ? (n === 1 ? "Kamera qaytarildi" : n + " ta kamera qaytarildi") : "Qaytarib boʻlmadi", { tone: n ? "success" : "error" });
  };

  const deleteCameras = async (cams: AdminCamera[]) => {
    if (!cams.length) return;
    const one = cams.length === 1;
    const ok = await confirm({
      title: one ? "“" + cams[0].name + "” oʻchirilsinmi?" : cams.length + " ta kamera oʻchirilsinmi?",
      text: "Kamera xarita, video devor va hisobotlardan olib tashlanadi. Tarix 30 kun saqlanadi.",
      ok: "Oʻchirish", danger: true,
    });
    if (!ok) return;
    let done: AdminCamera[] = [], soft = false;
    let failed: { detail?: string }[] = [];
    try {
      const res = one ? null : await bulk("delete", cams);
      if (res) {
        done = cams.filter((c) => res.some((r) => r.id === c.id && r.ok));
        failed = res.filter((r) => !r.ok);
        soft = true;                      // bulk faqat yangi backendda — yumshoq o'chirish
      } else {
        const out = await pool(cams, 4, async (c) => {
          try {
            const r = await api<{ restore_until?: string } | null>("/api/admin/cameras/" + c.id, { method: "DELETE" });
            return { c, ok: true, soft: !!(r && r.restore_until), detail: "" };
          } catch (e) { return { c, ok: false, soft: false, detail: (e as Error).message }; }
        });
        done = out.filter((x) => x.ok).map((x) => x.c);
        soft = out.some((x) => x.soft);
        failed = out.filter((x) => !x.ok);
      }
    } catch (e) { toast((e as Error).message, { tone: "error" }); return; }

    setSelected((m) => { const n = new Map(m); done.forEach((c) => n.delete(c.id)); return n; });
    invalidateAdmin(qc);
    if (!done.length) { toast((failed[0] && failed[0].detail) || "Oʻchirilmadi", { tone: "error" }); return; }
    const msg = done.length === 1 ? "Kamera oʻchirildi" : done.length + " ta kamera oʻchirildi";
    toast(msg + (failed.length ? " · " + failed.length + " tasi oʻchirilmadi" : ""), soft
      ? { action: "Qaytarish", ms: 10000, onAction: () => restore(done) }
      : { ms: 4000 });
  };

  /* ---------- Eksport ---------- */
  const exportCsvLocal = async () => {
    let list: AdminCamera[];
    if (clientMode) list = view?.filtered || [];
    else {
      list = [];
      try {
        for (let off = 0; ; off += 500) {
          const p = new URLSearchParams(params(false));
          p.set("offset", String(off)); p.set("limit", "500");
          const res = await api<AdminList>("/api/admin/cameras?" + p);
          list.push(...(res.cameras || []));
          if (!res.cameras || !res.cameras.length || list.length >= res.total) break;
        }
      } catch (e) { toast((e as Error).message, { tone: "error" }); return; }
    }
    if (!list.length) { toast("Eksport uchun kamera yoʻq", { tone: "info" }); return; }
    const head = ["Nomi", "Hudud", "Holat", "Oqim manzili", "Kodek", "Rejim", "Faol"];
    const cell = (v: unknown) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const body = list.map((c) => [c.name, c.region, STATUS_LABEL[camUiStatus(c, pubOnline(c))], streamUrl(c),
      codecLabel(c), modeLabel(c), c.enabled ? "ha" : "yoʻq"].map(cell).join(","));
    const blob = new Blob(["﻿" + [head.map(cell).join(","), ...body].join("\r\n")], { type: "text/csv;charset=utf-8" });
    download(blob, "nigoh-kameralar.csv");
    toast(list.length + " ta kamera eksport qilindi");
  };

  const exportFile = async (format: "csv" | "xlsx") => {
    if (!clientMode) {
      try {
        const res = await fetch("/api/admin/cameras/export?format=" + format + "&" + params(false), { credentials: "same-origin" });
        if (res.ok) {
          const blob = await res.blob();
          const cd = res.headers.get("Content-Disposition") || "";
          const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
          download(blob, m ? decodeURIComponent(m[1]) : "nigoh-kameralar." + format);
          toast("Eksport tayyor");
          return;
        }
        if (format === "xlsx" && res.status !== 404) toast("Excel faylini yaratib boʻlmadi — CSV yuklandi", { tone: "info" });
      } catch { /* pastda brauzerda CSV */ }
    }
    await exportCsvLocal();
  };

  /* ---------- Qator menyusi ---------- */
  const rowItems = (cam: AdminCamera): RowItem[] => [
    { key: "e", label: "Tahrirlash", icon: "pen", kbd: "E", run: () => setEditCam(cam) },
    { key: "t", label: "Ulanishni tekshirish", icon: "play", kbd: "T", disabled: !canTest(cam), run: () => testCamera(cam) },
    { key: "m", label: "Xaritada koʻrsatish", icon: "map-pin", kbd: "M", run: () => showOnMap(cam) },
    { label: "Video devorga qoʻshish", icon: "grid", run: () => addToWall([cam]) },
    { label: "Oqim manzilini nusxalash", icon: "link", disabled: !streamUrl(cam), run: () => copyUrl(cam) },
    "sep",
    { key: "del", label: "Oʻchirish", icon: "trash", kbd: "⌫", danger: true, run: () => deleteCameras([cam]) },
  ];

  const shortcut = (e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, cam: AdminCamera) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key.toLowerCase();
    const key = k === "backspace" || k === "delete" ? "del" : k;
    const it = rowItems(cam).find((x) => x !== "sep" && x.key === key && !x.disabled);
    if (!it || it === "sep") return false;
    setRowMenu(null); setGroupMenu(null); setFilterOpen(false); exportMenu.close(); moreMenu.close();
    it.run();
    return true;
  };

  const openRowMenu = (anchor: HTMLElement, cam: AdminCamera) => {
    if (rowMenu && rowMenu.cam.id === cam.id) { setRowMenu(null); return; }
    const up = anchor.getBoundingClientRect().bottom + 270 > innerHeight;
    setRowMenu({ cam, anchor, place: up ? "top-end" : "bottom-end" });
  };
  const closeRowMenu = useCallback(() => setRowMenu(null), []);
  const closeGroupMenu = useCallback(() => setGroupMenu(null), []);
  const closeFilter = useCallback(() => setFilterOpen(false), []);
  const closeDrawer = useCallback(() => setEditCam(null), []);

  /* Xarita → "Kamerani sozlash": #/admin?edit=ID — shu kameraning tahrirlash paneli ochiladi. */
  useEffect(() => {
    const id = Number(new URLSearchParams(loc.search).get("edit"));
    if (!id) return;
    let alive = true;
    fetchAllAdmin().then((all) => {
      if (!alive) return;
      const cam = all.find((c) => c.id === id);
      if (cam) setEditCam(cam);
      else toast(t("Kamera yozuvi topilmadi"), { tone: "error" });
      nav(loc.pathname, { replace: true, state: loc.state });
    }).catch(() => {});
    return () => { alive = false; };
  }, [loc.search]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Tanlov ---------- */
  const toggleRow = (cam: AdminCamera, on: boolean) =>
    setSelected((m) => { const n = new Map(m); if (on) n.set(cam.id, cam); else n.delete(cam.id); return n; });
  const onPage = rows.filter((c) => selected.has(c.id)).length;
  const allChecked = !!rows.length && onPage === rows.length;
  const indeterminate = (onPage > 0 && onPage < rows.length) || (onPage === 0 && selected.size > 0);
  const checkAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (checkAllRef.current) checkAllRef.current.indeterminate = indeterminate; }, [indeterminate]);
  const selList = () => [...selected.values()];

  const onRowClick = (e: RMouseEvent<HTMLTableRowElement>, cam: AdminCamera) => {
    const tg = e.target as HTMLElement;
    const td = tg.closest(".ad-c-check");
    if (td) {
      if (!tg.closest(".ad-row-check")) td.querySelector<HTMLInputElement>(".ad-row-check")?.click();
      return;
    }
    if (tg.closest("[data-act]")) return;
    setEditCam(cam);
  };

  /* ---------- Sahifalash ---------- */
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + size, total);
  const pages = Math.max(1, Math.ceil(total / size));
  const cur = Math.floor(offset / size);
  const pageList = useMemo(() => {
    const want = new Set([0, pages - 1, cur, cur - 1, cur + 1]);
    if (cur <= 2) [1, 2, 3].forEach((i) => want.add(i));
    if (cur >= pages - 3) [pages - 2, pages - 3, pages - 4].forEach((i) => want.add(i));
    return [...want].filter((i) => i >= 0 && i < pages).sort((a, b) => a - b);
  }, [pages, cur]);

  const sortKey = sort.replace(/^-/, "");
  const desc = sort.startsWith("-");
  const sortHead = (k: string, label: string) => {
    const on = sortKey === k;
    return (
      <th className={cx("sortable", on && "is-sorted")} aria-sort={on ? (desc ? "descending" : "ascending") : "none"}
        onClick={() => { setSort(sort === k ? "-" + k : k); setOffset(0); }}>
        <span className="ad-th">{t(label)}<span className="ad-sort"><Icon name={on ? (desc ? "sort-down" : "sort-up") : "sort"} size="xs" /></span></span>
      </th>
    );
  };

  const empty = !error && !showSk && !!view && !rows.length;
  const showFoot = !error && !empty;
  const resetPage = () => setOffset(0);

  return (
    <section className={cx("page page--sheet", selected.size > 0 && "has-bulk", empty && "is-empty")} id="admin-view">
      <div className="sheet ad-sheet">
        <header className="page-head ad-head">
          <h1 className="page-head__title">{t("Kameralar")}</h1>
          <InfoTip text="Barcha kameralar: qoʻshish, tahrirlash, ulanishni tekshirish va oʻchirish. Holat soni — chiplarda." />
          <span className="spacer" />
          <div className="ad-sysbar"><Sysbar /></div>
        </header>

        <div className="ad-toolbar">
          <div className="chips ad-chips" role="group" aria-label={t("Holat filtri")}>
            {CHIPS.map((ch) => {
              const n = ch.key ? (counts[ch.key] || 0) : (counts.all || 0);
              const on = ch.key ? statuses.includes(ch.key) : !statuses.length;
              if ("hideZero" in ch && !n && !on) return null;
              return <Chip key={ch.key || "all"} on={on} status={"ui" in ch ? ch.ui : undefined} label={ch.label} count={n} onClick={() => toggleStatus(ch.key)} />;
            })}
            {idFilter && (
              <button type="button" className="chip is-on" aria-label={t("Filtrni olib tashlash")} data-tip="Filtrni olib tashlash"
                onClick={() => { setIdFilter(null); setOffset(0); }}>
                {t(idFilter.label)}<span className="chip__count">{idFilter.ids.size}</span><Icon name="xmark" size="xs" />
              </button>
            )}
          </div>
          <span className="spacer" />
          <label className={cx("search ad-search", !!qInput && "is-filled")}>
            <Icon name="search" />
            <input ref={searchRef} type="search" placeholder={t("Nomi, IP yoki hudud")} autoComplete="off" spellCheck={false}
              aria-label={t("Qidiruv: nomi, IP yoki hudud")} value={qInput}
              onChange={(e) => { setQInput(e.target.value); applyQ(e.target.value); }} />
            <button type="button" className="search__clear" aria-label={t("Qidiruvni tozalash")}
              onClick={(e) => { e.preventDefault(); setQInput(""); setQ(""); setOffset(0); searchRef.current?.focus(); }}>
              <Icon name="xmark" size="sm" />
            </button>
            <span className="kbd">/</span>
          </label>
          <Button ref={setFilterAnchor} className={cx("ad-filter-btn", filterCount > 0 && "is-active")} icon="filter"
            aria-haspopup="dialog" aria-expanded={filterOpen} onClick={() => setFilterOpen((o) => !o)}>
            <span>{filterCount ? t("Filtr") + " · " + filterCount : t("Filtr")}</span>
          </Button>
          <Button ref={exportMenu.ref} id="ad-export" icon="download" aria-haspopup="menu" aria-expanded={exportMenu.open} onClick={exportMenu.toggle}>
            <span className="ad-hide-sm">{t("Eksport")}</span>
          </Button>
          <IconButton ref={moreMenu.ref} variant="secondary" icon="dots-horizontal" tip="Qoʻshimcha amallar (NVR, media)"
            aria-haspopup="menu" aria-expanded={moreMenu.open} onClick={moreMenu.toggle} />
          <Button id="new-cam" variant="primary" icon="plus" onClick={() => setWizard(true)}><span>{t("Kamera qoʻshish")}</span></Button>
        </div>

        <div className="ad-card">
          <div className="ad-scroll">
            <table className="tbl ad-tbl">
              <colgroup>
                <col className="ad-col-check" /><col className="ad-col-state" /><col className="ad-col-name" /><col className="ad-col-region" />
                <col className="ad-col-url" /><col className="ad-col-codec" /><col className="ad-col-mode" /><col className="ad-col-act" />
              </colgroup>
              <thead><tr>
                <th className="ad-c-check">
                  <input ref={checkAllRef} type="checkbox" className="check" aria-label={t("Sahifadagi hammasini tanlash")}
                    checked={allChecked} aria-checked={indeterminate ? "mixed" : allChecked}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setSelected((m) => { const n = new Map(m); rows.forEach((c) => { if (on) n.set(c.id, c); else n.delete(c.id); }); return n; });
                    }} />
                </th>
                {sortHead("state", "Holat")}
                {sortHead("name", "Kamera")}
                <th>{t("Hudud")}</th>
                <th>{t("Oqim manzili")}</th>
                <th>{t("Kodek")}</th>
                <th>{t("Rejim")}</th>
                <th className="ad-c-act">{t("Amallar")}</th>
              </tr></thead>
              <tbody>
                {showSk ? Array.from({ length: 8 }, (_, i) => (
                  <tr key={"sk" + i} className="ad-sk">
                    <td />
                    <td><span className="skeleton" style={{ width: 64, height: 16 }} /></td>
                    <td><span className="skeleton" style={{ width: 90 + (i * 23) % 60, height: 12 }} /></td>
                    <td><span className="skeleton" style={{ width: 80, height: 12 }} /></td>
                    <td><span className="skeleton" style={{ width: 160 + (i * 37) % 90, height: 10 }} /></td>
                    <td><span className="skeleton" style={{ width: 56, height: 14 }} /></td>
                    <td><span className="skeleton" style={{ width: 90, height: 12 }} /></td>
                    <td />
                  </tr>
                )) : !error && rows.map((c) => {
                  const st = camUiStatus(c, pubOnline(c));
                  const addr = streamAddr(c);
                  const sel = selected.has(c.id);
                  const testable = canTest(c);
                  return (
                    <tr key={c.id} tabIndex={0} className={cx(sel && "is-selected", rowMenu?.cam.id === c.id && "is-menu")}
                      onClick={(e) => onRowClick(e, c)}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter") { e.preventDefault(); setEditCam(c); return; }
                        if (shortcut(e, c)) e.preventDefault();
                      }}>
                      <td className="ad-c-check">
                        <input type="checkbox" className="check ad-row-check" aria-label={c.name + " — " + t("tanlash")} checked={sel}
                          onChange={(e) => toggleRow(c, e.target.checked)} />
                      </td>
                      <td><Badge status={st} /></td>
                      <td><span className="ad-name ellipsis" title={c.name}>{t(c.name)}</span></td>
                      <td><span className="ellipsis">{c.region ? t(c.region) : "—"}</span></td>
                      <td className="ad-c-url">{addr
                        ? <span className="ad-url">
                            <span className="ad-url__t mono-xs ellipsis" data-tip={streamUrl(c)}>{addr}</span>
                            <button type="button" className="ad-url__copy" data-act="copy" data-tip="Nusxalash" aria-label={t("Oqim manzilini nusxalash")}
                              onClick={(e) => { e.stopPropagation(); copyUrl(c); }}><Icon name="copy" size="xs" /></button>
                          </span>
                        : <span className="t-tertiary">—</span>}
                      </td>
                      <td><span className="codec-tag">{codecLabel(c)}</span></td>
                      <td><span className="ellipsis">{t(modeLabel(c))}</span></td>
                      <td className="ad-c-act"><span className="ad-acts">
                        <IconButton size="sm" icon="pen" tip="Tahrirlash" className="ad-hover-act" data-act="edit"
                          onClick={(e) => { e.stopPropagation(); setEditCam(c); }} />
                        <IconButton size="sm" icon="play" tip="Ulanishni tekshirish" className="ad-hover-act" data-act="test" disabled={!testable}
                          onClick={(e) => { e.stopPropagation(); testCamera(c); }} />
                        <IconButton size="sm" icon="dots-horizontal" tip="Amallar" data-act="menu" aria-haspopup="menu"
                          onClick={(e) => { e.stopPropagation(); openRowMenu(e.currentTarget, c); }} />
                      </span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {error && !showSk && (
              <div id="ad-empty">
                <EmptyState type="triangle-exclamation" title="Roʻyxat yuklanmadi" text={error.message || "Server javob bermadi"}
                  action="Qayta urinish" onAction={() => activeQ.refetch()} />
              </div>
            )}
            {empty && (
              <div id="ad-empty">
                {hasAnyFilter
                  ? <EmptyState type="filter" title="Bu filtrda kamera yoʻq" text={filterSummary() + " — " + t("mos kamera topilmadi")}
                      action="Filtrlarni tozalash" onAction={clearFilters} />
                  : <EmptyState type="nodata" title="Hali kamera yoʻq" text="Birinchi kamerani qoʻshing"
                      action="Kamera qoʻshish" primary onAction={() => setWizard(true)} />}
              </div>
            )}
          </div>
          {showFoot && (
            <div className="ad-pager" id="admin-foot">
              <span className="body-sm t-tertiary tnum" id="admin-count">{t(from + "–" + to + " / " + total + " kamera")}</span>
              <span className="spacer" />
              <IconButton size="sm" variant="secondary" icon="chevron-left" tip="Oldingi sahifa" disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - size))} />
              <span className="ad-pages">
                {pageList.map((i, k) => [
                  k > 0 && i - pageList[k - 1] > 1 && <span key={"g" + i} className="ad-pages__gap">…</span>,
                  <button key={i} type="button" className={cx("ad-page", i === cur && "is-on")} aria-current={i === cur ? "page" : undefined}
                    onClick={() => setOffset(i * size)}>{i + 1}</button>,
                ])}
              </span>
              <IconButton size="sm" variant="secondary" icon="chevron-right" tip="Keyingi sahifa" disabled={offset + size >= total}
                onClick={() => setOffset(offset + size)} />
              <select className="select ad-size" aria-label={t("Sahifadagi kameralar soni")} value={String(size)}
                onChange={(e) => { setSize(Number(e.target.value) || 50); setOffset(0); }}>
                <option value="25">{t("25 ta")}</option>
                <option value="50">{t("50 ta")}</option>
                <option value="100">{t("100 ta")}</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* 05.03 Ommaviy tanlash paneli */}
      {selected.size > 0 && (
        <div className="ad-bulk" role="toolbar" aria-label={t("Tanlangan kameralar amallari")}>
          <span className="ad-bulk__n tnum">{t(selected.size + " ta tanlandi")}</span>
          <span className="ad-bulk__div" />
          <button type="button" className="ad-bulk__btn" onClick={() => addToWall(selList())}>{t("Video devorga")}</button>
          <button type="button" className="ad-bulk__btn" aria-haspopup="menu" onClick={(e) => openGroupMenu(e.currentTarget, selList())}>{t("Guruhga qoʻshish")}</button>
          <button type="button" className="ad-bulk__btn" onClick={() => bulkTest(selList())}>{t("Ulanishni tekshirish")}</button>
          <button type="button" className="ad-bulk__btn is-danger" onClick={() => deleteCameras(selList())}>{t("Oʻchirish")}</button>
          <button type="button" className="ad-bulk__close" data-tip="Tanlovni bekor qilish" aria-label={t("Tanlovni bekor qilish")}
            onClick={() => setSelected(new Map())}><Icon name="xmark" size="sm" /></button>
        </div>
      )}

      {/* Toolbar popover/menyulari */}
      <Popover anchor={filterAnchor} open={filterOpen} onClose={closeFilter} place="bottom-end" width={280}>
        <FilterPop regions={regionsRef.current} filters={filters} onChange={setFilter}
          onClear={() => { setFilters(NO_FILTERS); resetPage(); }} />
      </Popover>
      {exportMenu.render([
        ...(!clientMode ? [{ label: "Excel (.xlsx)", icon: "download", onClick: () => exportFile("xlsx") }] : []),
        { label: "CSV", icon: "download", onClick: () => exportFile("csv") },
      ], 240)}
      {moreMenu.render([
        { label: "Registratordan qoʻshish", icon: "server", onClick: () => setNvr(true) },
        { label: "Media sozlamalari", icon: "gear", onClick: () => setMtx(true) },
      ], 240)}
      <Popover anchor={rowMenu?.anchor || null} open={!!rowMenu} onClose={closeRowMenu} place={rowMenu?.place || "bottom-end"} width={240}>
        {rowMenu && (
          <div onKeyDown={(e) => { if (shortcut(e, rowMenu.cam)) { e.preventDefault(); e.stopPropagation(); } }}>
            <Menu onDone={closeRowMenu} items={rowItems(rowMenu.cam).map((x) => (x === "sep" ? x
              : { label: x.label, icon: x.icon, kbd: x.kbd, danger: x.danger, disabled: x.disabled, onClick: x.run }))} />
          </div>
        )}
      </Popover>
      <Popover anchor={groupMenu?.anchor || null} open={!!groupMenu} onClose={closeGroupMenu} place="top-start" width={240}>
        {groupMenu && <Menu items={groupMenu.items} onDone={closeGroupMenu} />}
      </Popover>

      <CameraWizard open={wizard} onClose={() => setWizard(false)} onSaved={resetPage} />
      <CameraDrawer cam={editCam} onClose={closeDrawer} />
      <NvrDialog open={nvr} onClose={() => setNvr(false)} onSaved={resetPage} />
      <MediaMtxDialog open={mtx} onClose={() => setMtx(false)} />
    </section>
  );
}

function FilterPop({ regions, filters, onChange, onClear }: {
  regions: string[]; filters: Filters; onChange: (k: keyof Filters, v: string) => void; onClear: () => void;
}) {
  const t = useT();
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => { const id = setTimeout(() => first.current?.focus(), 30); return () => clearTimeout(id); }, []);
  const regs = [...new Set([...regions, filters.region].filter(Boolean))];
  const sel = (k: keyof Filters, label: string, opts: { v: string; label: string }[], ref?: React.Ref<HTMLSelectElement>) => (
    <label className="field">
      <span className="field__label">{t(label)}</span>
      <select className="select" ref={ref} value={filters[k]} onChange={(e) => onChange(k, e.target.value)}>
        {opts.map((o) => <option key={o.v} value={o.v}>{t(o.label)}</option>)}
      </select>
    </label>
  );
  return (
    <div className="ad-filter-pop" role="dialog" aria-label={t("Filtr")}>
      {sel("region", "Hudud", [{ v: "", label: "Barcha hududlar" }, ...regs.map((r) => ({ v: r, label: r }))], first)}
      {sel("codec", "Kodek", [{ v: "", label: "Barcha kodeklar" }, ...CODECS])}
      {sel("mode", "Rejim", [{ v: "", label: "Barcha rejimlar" }, ...MODES])}
      <div className="ad-filter-pop__foot">
        <Button variant="tertiary" size="sm" onClick={onClear}>{t("Tozalash")}</Button>
      </div>
    </div>
  );
}
