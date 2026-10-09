/* pages/map/MapPage.tsx — "02 Xarita" (Figma 02.01–02.24), v3 frontend/js/map/* dan ko'chirilgan.
   Dizayn va xatti-harakat v3 bilan bir xil; bu fayl sahifa holatini va amallarini ushlaydi
   (v3 dagi global `state` o'rniga) va ularni MapCtx orqali bo'laklarga beradi:
     MapController (Leaflet: plitkalar, parda, chegaralar, temir yo'l, markerlar/klasterlar,
       o'lchash, lasso, joylashuv), Panel (qidiruv, ro'yxatlar, filtrlar, guruhlar),
     Toolbar/Legend/MapControls/ScaleBar/ModeBars (MapChrome), CameraCard, CameraDrawer,
     GroupDialog, Onboarding.
   Manzil: ?camera=ID — kamerani ochish, ?panel=closed — panel yig'iq (HashRouter: #/?camera=…).
   Klaviatura: / — qidiruv, + − — zoom, L — joylashuv, Esc zanjiri (onboarding → o'lchash →
   lasso → tanlash rejimi → karta → drawer → mobil panel).
   Bo'limlararo kelishuv: "Video devorga qoʻshish" → prefs "wall.pinned" (+id) va #/wall; guruhni devorda ochish —
   prefs "wall".group = "g:ID" + #/wall; "Kamerani sozlash" → #/admin?edit=ID. */
import "@/styles/map.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type L from "leaflet";
import { useT } from "@/i18n/I18nProvider";
import { useAuth } from "@/auth/AuthProvider";
import { Icon } from "@/components/Icon";
import { cx } from "@/components/ui";
import { useShortcut, useToast } from "@/components/overlays";
import { useCameras, usePollSeconds } from "@/data/queries";
import { api } from "@/lib/api";
import { prefs, usePref } from "@/lib/prefs";
import { setSelectedCamera } from "@/lib/selection";
import type { Camera } from "@/lib/types";
import { LAYER_DEFAULTS, MapController, type LayerState } from "./MapController";
import {
  GROUPS_KEY, MapCtx, searchCams,
  type Group, type ListView, type MapApi, type RegionInfo, type StatusFilter,
} from "./model";
import { MOBILE_Q, NOGEO, PHONE_Q, camStatus, hasGeo } from "./util";
import { useLatest, useMedia } from "./hooks";
import { Panel } from "./Panel";
import { Legend, MapControls, ModeBars, ScaleBar, Toolbar } from "./MapChrome";
import { CameraCard } from "./CameraCard";
import { CameraDrawer } from "./CameraDrawer";
import { GroupDialog, useGroupCache, type GroupModal } from "./GroupDialog";
import { Onboarding, STEPS, onboardingDone, saveOnboardingDone } from "./Onboarding";

const NO_GROUPS: Group[] = [];

export default function MapPage() {
  const t = useT();
  const toast = useToast();
  const nav = useNavigate();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const camsQ = useCameras();
  const pollS = usePollSeconds();
  const mobile = useMedia(MOBILE_Q);
  const phone = useMedia(PHONE_Q);
  const authed = !!user;
  const canEdit = !!user && user.role !== "viewer";
  const isAdminUser = user?.role === "admin";

  const cameras = camsQ.cameras;
  const byId = camsQ.byId;
  const loaded = !!camsQ.data;

  /* ---------- guruhlar ---------- */
  const groupsQ = useQuery({
    queryKey: GROUPS_KEY,
    queryFn: () => api<{ groups: Group[] }>("/api/groups").then((r) => r.groups || []),
    enabled: authed,
    retry: false,
  });
  const groups = authed ? groupsQ.data || NO_GROUPS : NO_GROUPS;
  const groupsById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const cache = useGroupCache();

  /* ---------- qatlamlar (prefs "layers") ---------- */
  const [layersPref] = usePref<Partial<LayerState> | null>("layers", {});
  const layers: LayerState = useMemo(() => ({ ...LAYER_DEFAULTS, ...(layersPref || {}) }), [layersPref]);
  const [railsOk, setRailsOk] = useState(true);
  const [railSrc, setRailSrc] = useState<string>(layers.railSrc === "v1" ? "v1" : "v2");
  const [hybridOk, setHybridOk] = useState<boolean | null>(null);

  /* ---------- panel holati ---------- */
  const [filters, setFilters] = useState<Set<StatusFilter>>(() => new Set());
  const [groupFilter, setGroupFilterS] = useState<number | null>(null);
  const [listView, setListView] = useState<ListView>("cams");
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const qTimer = useRef<number | undefined>(undefined);
  const [openRegions, setOpenRegionsS] = useState<Record<string, boolean>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const [collapsed, setCollapsedS] = useState(() => {
    if (window.matchMedia(MOBILE_Q).matches) return true;
    const p = params.get("panel");
    return p === "closed" || (!p && prefs.get<string>("panel", "") === "closed");
  });

  /* ---------- tanlov, rejimlar ---------- */
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [cardId, setCardId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pickMode, setPickModeS] = useState(false);
  const [pickIds, setPickIds] = useState<Set<number>>(() => new Set());
  const [lassoOn, setLassoOn] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [measurePts, setMeasurePts] = useState<L.LatLng[]>([]);
  const [locate, setLocate] = useState<"busy" | "on" | "off">("off");
  const [fs, setFs] = useState(false);
  const [groupModal, setGroupModal] = useState<GroupModal | null>(null);
  const [step, setStep] = useState(-1);
  const [pollFails, setPollFails] = useState(0);

  const viewRef = useRef<HTMLElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const videoWrapRef = useRef<HTMLDivElement>(null);
  const [ctl, setCtl] = useState<MapController | null>(null);
  const hoverBus = useMemo(() => new EventTarget(), []);

  /* ---------- ko'rinadigan kameralar (guruh + holat filtri) ---------- */
  const groupMembersSet = useMemo(() => {
    const g = groupFilter != null ? groupsById.get(groupFilter) : undefined;
    return g ? new Set(g.camera_ids) : null;
  }, [groupFilter, groupsById]);
  const visible = useMemo(() => cameras.filter((c) => {
    if (groupMembersSet && !groupMembersSet.has(c.id)) return false;
    if (filters.size && !filters.has(camStatus(c) as StatusFilter)) return false;
    return true;
  }), [cameras, groupMembersSet, filters]);
  const results = useMemo(() => (qApplied.trim() && loaded ? searchCams(qApplied.trim(), visible) : null), [qApplied, visible, loaded]);

  /* ---------- manzil parametri ---------- */
  const setParam = useCallback((key: string, val: string | number | null) => {
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      if (val == null || val === "") n.delete(key); else n.set(key, String(val));
      return n;
    }, { replace: true });
  }, [setParams]);

  const padTL = (): [number, number] => {
    const panel = document.getElementById("mp-panel");
    const w = panel && innerWidth >= 1024 && !viewRef.current?.classList.contains("mp-collapsed")
      ? panel.getBoundingClientRect().right + 16 : 88;
    return [w, 16];
  };

  /* ---------- amallar ---------- */
  const setCollapsed = (c: boolean, persist: boolean) => {
    setCollapsedS(!!c);
    if (persist && !mobile) {
      prefs.set("panel", c ? "closed" : "open");
      setParam("panel", c ? "closed" : null);
    }
  };

  const setQuery = (v: string, now?: boolean) => {
    setQ(v);
    clearTimeout(qTimer.current);
    if (now) setQApplied(v);
    else qTimer.current = window.setTimeout(() => setQApplied(v), 300);
  };

  const select = (id: number, fly?: boolean) => {
    const cam = byId.get(id);
    if (!cam) return;
    setSelectedId(id);
    setCardId(null);
    if (fly !== false && hasGeo(cam) && ctl) {
      const map = ctl.map;
      map.flyTo([cam.lat, cam.lng], Math.max(map.getZoom(), 14), { duration: 0.6 });
      // Bir ustundagi kameralar klasterda qolsa — yoyiladi, tanlangan marker ko'rinsin.
      map.once("moveend", () => { if (apiRef.current.selectedId === id) ctl.reveal(id); });
    }
    setDrawerOpen(true);
    if (mobile) setCollapsed(true, false);
    setParam("camera", id);
  };

  const openCard = (id: number) => {
    if (!byId.has(id)) return;
    if (drawerOpen) { select(id, false); return; }     // drawer ochiq — kontent almashadi
    setCardId(id);
    setSelectedId(id);
  };
  const closeCard = (deselect: boolean) => {
    setCardId(null);
    if (deselect && !drawerOpen) setSelectedId(null);
  };
  const closeDrawer = () => {
    setCardId(null);
    setSelectedId(null);
    setDrawerOpen(false);
    setParam("camera", null);
  };

  const toggleFilter = (f: StatusFilter | "") => {
    const set = new Set(filters);
    if (!f) set.clear();
    else if (set.has(f)) set.delete(f);
    else set.add(f);
    if (set.size >= 3) set.clear();        // hammasi tanlangandek — filtrsiz
    setFilters(set);
  };

  const setGroupFilter = (id: number | null) => {
    setGroupFilterS(id);
    const g = id != null ? groupsById.get(id) : undefined;
    if (g && ctl) ctl.fitCams(g.camera_ids.map((x) => byId.get(x)).filter((c): c is Camera => !!c && hasGeo(c)), { zoom: 14 }, padTL());
  };

  const setView = (v: ListView) => {
    setListView(v);
    setFocus(null);
    ctl?.setFocusRegion(null);
  };

  const flyToRegion = (r: RegionInfo) => {
    if (r.key !== NOGEO) ctl?.setFocusRegion(r.name);
    if (!ctl || !ctl.fitCams(r.items, {}, padTL())) return;
    if (mobile && !phone) setCollapsed(true, false);
  };

  const setPickMode = (on: boolean) => {
    setPickModeS(on);
    if (!on) setPickIds(new Set());
    if (on) {
      setListView("cams");
      setCollapsed(false, false);
      if (q) setQuery("", true);
    }
  };
  const togglePick = (id: number) => {
    setPickIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const setLasso = (on: boolean) => { ctl?.setLasso(on); setLassoOn(on); };
  const setMeasure = (on: boolean) => { ctl?.setMeasure(on); setMeasuring(on); };

  const openGroupPicker = (ids: number[], title: string) => {
    if (!canEdit) { toast(user ? "Kuzatuvchi guruh yarata olmaydi" : "Guruhlar uchun tizimga kiring", { tone: "info" }); return; }
    setGroupModal({ kind: "picker", ids, title });
  };
  const openGroupEditor = (g: Group) => setGroupModal({ kind: "edit", group: g });
  const groupMembers = async (groupId: number, ids: number[], mode: "add" | "remove") => {
    try {
      const g = await api<Group>("/api/groups/" + groupId + "/cameras", { method: "POST", body: { camera_ids: ids, mode } });
      cache.replace(g);
      return g;
    } catch (e) { toast((e as Error).message, { tone: "error" }); return null; }
  };
  const openGroupOnWall = (g: Group) => {
    prefs.set("wall", { ...(prefs.get<Record<string, unknown>>("wall", {}) || {}), group: "g:" + g.id });
    nav("/wall");
  };
  const toWall = (id: number | null) => {
    closeCard(false);
    if (id != null) {
      // Kelishuv: prefs "wall.pinned" (alohida kalit, Boshqaruv bilan bir xil) — devor oldinda ko'rsatadigan kameralar.
      const raw = prefs.get<unknown>("wall.pinned", []);
      const pinned = Array.isArray(raw) ? raw.filter((x): x is number => typeof x === "number") : [];
      if (!pinned.includes(id)) prefs.set("wall.pinned", [...pinned, id]);
    }
    nav("/wall");
  };
  const editCamera = (id: number | null) => {
    if (!isAdminUser) { toast("Kamerani faqat administrator sozlaydi", { tone: "info" }); return; }
    if (id != null) nav("/admin?edit=" + id);
  };

  /* ---------- Onboarding ---------- */
  const finishTour = (save: boolean) => {
    if (save && apiRef.current.step >= 0) saveOnboardingDone();
    setStep(-1);
  };
  const startTour = () => setStep(0);
  const maybeStartTour = () => {
    if (onboardingDone() || apiRef.current.step >= 0) return;
    if (document.querySelector(".login.open, .dialog-backdrop.open")) return;
    startTour();
  };

  /* Esc zanjiri — true: yopildi. */
  const escape = () => {
    if (step >= 0) { finishTour(true); return true; }
    if (measuring) { setMeasure(false); return true; }
    if (lassoOn) { setLasso(false); return true; }
    if (pickMode) { setPickMode(false); return true; }
    if (cardId != null) { closeCard(true); return true; }
    if (drawerOpen) { closeDrawer(); return true; }
    if (mobile && !collapsed) { setCollapsed(true, false); return true; }
    return false;
  };

  const cardFullscreen = (id: number) => {
    // Drawer darhol ochilishi kerak — requestFullscreen foydalanuvchi bosishi ichida chaqiriladi.
    flushSync(() => { closeCard(false); select(id, false); });
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    videoWrapRef.current?.requestFullscreen?.().catch(() => {});
  };
  const toggleMapFullscreen = () => {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    const el = viewRef.current;
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => toast("Toʻliq ekran rejimi mavjud emas", { tone: "error" }));
  };

  const mapApi: MapApi & { step: number; escape: () => boolean; maybeStartTour: () => void; startTour: () => void } = {
    ctl, cameras, byId, visible, loaded, groups, groupsById, canEdit, authed, isAdminUser,
    selectedId, cardId, drawerOpen, selectCamera: select, openCard, closeCard, closeDrawer, toWall, editCamera,
    pickMode, pickIds, setPickMode, togglePick, setPickIds, lassoOn, setLasso,
    groupFilter, setGroupFilter, openGroupPicker, openGroupEditor, groupMembers, openGroupOnWall,
    filters, toggleFilter, clearFilters: () => { setFilters(new Set()); if (groupFilter != null) setGroupFilter(null); },
    listView, setView, q, qApplied, setQuery, results,
    openRegions, setOpenRegions: (f) => setOpenRegionsS(f), focus, setFocus, flyToRegion,
    pollFails, camsAt: camsQ.dataUpdatedAt, retry: () => camsQ.refetch(), pollS,
    measuring, setMeasure, collapsed, setCollapsed, padTL, hoverBus,
    step, escape, maybeStartTour, startTour,
  };
  const apiRef = useLatest(mapApi);
  const tRef = useLatest(t);

  /* ---------- Leaflet ---------- */
  useEffect(() => {
    const el = mapEl.current!;
    const a = () => apiRef.current;
    const c = new MapController(el, {
      layers: { ...LAYER_DEFAULTS, ...(prefs.get<Partial<LayerState> | null>("layers", {}) || {}) },
      t: (s) => tRef.current(s),
      cb: {
        markerClick: (id) => a().openCard(id),
        markerHover: (id) => hoverBus.dispatchEvent(new CustomEvent("map", { detail: id })),
        mapClick: () => { if (a().cardId != null) a().closeCard(true); },
        measureChange: (pts) => setMeasurePts(pts),
        measureEnd: () => a().setMeasure(false),
        lassoDone: (ids) => {
          if (!ids.length) { toast("Belgilangan sohada kamera topilmadi", { tone: "info" }); return; }
          a().openGroupPicker(ids, "");
        },
        lassoEnd: () => setLassoOn(false),
        railsLoaded: (ok, src) => { setRailsOk(ok); if (ok && src) setRailSrc(src); },
        toast: (text, tone) => toast(text, { tone }),
        locateState: (s) => setLocate(s),
      },
    });
    setCtl(c);
    const h = setTimeout(() => c.map.invalidateSize(), 60);
    return () => { clearTimeout(h); c.destroy(); setCtl(null); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Kameralar → markerlar (to'plam o'zgarsa qayta quriladi, aks holda faqat belgilar).
  useEffect(() => { if (ctl && loaded) ctl.setCameras(visible, byId); }, [ctl, visible, byId, loaded]);
  useEffect(() => { ctl?.setSelected(selectedId); }, [ctl, selectedId]);
  // Bo'limlararo: video devor tanlangan kamerani ajratib ko'rsatadi (lib/selection).
  useEffect(() => { setSelectedCamera(selectedId); }, [selectedId]);

  // Qidiruv: mos markerlar ajratiladi; so'rov o'zgarganda natijalarga moslanadi.
  const lastFitQ = useRef("");
  useEffect(() => {
    if (!ctl) return;
    if (results) {
      const fit = lastFitQ.current !== results.q;
      lastFitQ.current = results.q;
      ctl.setSearch(results.ids, fit && results.ids.size > 0, padTL());
    } else if (lastFitQ.current) {
      lastFitQ.current = "";
      ctl.setSearch(null, false, padTL());
    }
  }, [ctl, results]); // eslint-disable-line react-hooks/exhaustive-deps

  // Qatlamlar.
  useEffect(() => { ctl?.rail.setVisible(layers.rail !== false); }, [ctl, layers.rail]);
  useEffect(() => { ctl?.setRegionsVisible(layers.regions !== false); }, [ctl, layers.regions]);
  useEffect(() => { ctl?.setClusters(layers.clusters !== false); }, [ctl, layers.clusters]);
  const base = layers.base === "hybrid" && hybridOk ? "hybrid" : "scheme";
  useEffect(() => { if (ctl && ctl.base !== base) ctl.setBase(base); }, [ctl, base]);
  const railSrcInit = useRef(true);
  useEffect(() => {
    if (!ctl) return;
    if (railSrcInit.current) { railSrcInit.current = false; return; }
    ctl.rail.setSource(layers.railSrc === "v1" ? "v1" : "v2");
  }, [ctl, layers.railSrc]);
  const setLayer = <K extends keyof LayerState>(k: K, v: LayerState[K]) => {
    if (k === "base" && v === "hybrid" && !hybridOk) return;
    if (k === "railSrc") setRailSrc(String(v));
    prefs.set("layers", { ...layers, [k]: v });
  };

  /* "Gibrid" (Esri) — sahifa CSP'si img-src da server.arcgisonline.com ga ruxsat bermasa
     plitkalar bloklanadi. Avval sarlavha tekshiriladi; ruxsat yo'q — tugma o'chiq. */
  useEffect(() => {
    let alive = true;
    fetch("/assets/uz.geojson", { credentials: "same-origin" }).then((r) => {
      const csp = r.headers.get("content-security-policy") || "";
      const img = (csp.match(/img-src([^;]*)/) || [])[1];
      if (alive) setHybridOk(!csp || !img || /arcgisonline|\*(\s|$)|https:(\s|$)/.test(img));
    }).catch(() => { if (alive) setHybridOk(false); });
    return () => { alive = false; };
  }, []);

  // Mavzu almashganda Leaflet uslublari qayta o'qiladi.
  useEffect(() => {
    const h = () => ctl?.restyle();
    window.addEventListener("nigoh:theme", h);
    return () => window.removeEventListener("nigoh:theme", h);
  }, [ctl]);

  /* ---------- aloqa holati: ketma-ket xatolar ---------- */
  useEffect(() => { if (camsQ.errorUpdatedAt) setPollFails((f) => f + 1); }, [camsQ.errorUpdatedAt]);
  useEffect(() => { setPollFails(0); }, [camsQ.dataUpdatedAt]);

  /* ---------- kamera yo'qolsa / guruh o'chsa ---------- */
  useEffect(() => {
    if (!loaded) return;
    if (cardId != null && !byId.has(cardId)) closeCard(true);
    if (selectedId != null && drawerOpen && !byId.has(selectedId)) closeDrawer();
  }, [byId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (groupFilter != null && groupsQ.data && !groupsById.has(groupFilter)) setGroupFilterS(null);
  }, [groupsById]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- birinchi ma'lumot: ?camera=ID yoki onboarding ---------- */
  const firstLoad = useRef(true);
  useEffect(() => {
    if (!loaded || !firstLoad.current || !ctl) return;
    firstLoad.current = false;
    const id = Number(params.get("camera"));
    const h = id && byId.has(id)
      ? setTimeout(() => apiRef.current.selectCamera(id, true), 50)
      : setTimeout(() => apiRef.current.maybeStartTour(), 900);
    return () => clearTimeout(h);
  }, [loaded, ctl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Boshqa bo'limdan "/?camera=ID" bilan kelinsa (bildirishnoma) — ochiladi.
  const camParam = params.get("camera");
  useEffect(() => {
    if (!loaded || firstLoad.current) return;
    const id = Number(camParam);
    if (id && id !== apiRef.current.selectedId && byId.has(id)) apiRef.current.selectCamera(id, true);
  }, [camParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // Boshqa bo'limlardan: "/?q=<matn>" (Dashboard hudud qatori) — panel qidiruviga;
  // "/?group=<id>" (Sozlamalar → guruhlar) — guruh filtri + xarita moslanadi. Qo'llangach olib tashlanadi.
  const qParam = params.get("q");
  const groupParam = params.get("group");
  useEffect(() => {
    if (!loaded || !ctl || qParam == null) return;
    const a = apiRef.current;
    a.setCollapsed(false, false);
    if (a.pickMode) a.setPickMode(false);
    a.setQuery(qParam, true);
    setParam("q", null);
  }, [qParam, loaded, ctl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loaded || !ctl || groupParam == null) return;
    const id = Number(groupParam);
    if (authed && !groupsQ.data && !groupsQ.isError) return;          // guruhlar hali kelmagan
    const g = groupsById.get(id);
    setParam("group", null);
    if (!g) return;
    setOpenRegionsS((o) => {
      const n = { ...o };
      g.camera_ids.forEach((cid) => { const c = byId.get(cid); if (c) n[hasGeo(c) ? c.region : NOGEO] = true; });
      return n;
    });
    setView("cams");
    setCollapsed(false, false);
    setGroupFilter(id);
  }, [groupParam, loaded, ctl, groupsById]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tor ekranga o'tilsa panel yig'iladi; kengayganda saqlangan tanlov.
  const mobileInit = useRef(true);
  useEffect(() => {
    if (mobileInit.current) { mobileInit.current = false; return; }
    setCollapsedS(mobile ? true : prefs.get<string>("panel", "") === "closed");
  }, [mobile]);

  // "Tanishtiruvni qayta koʻrish" (yordam oynasi).
  useEffect(() => {
    const h = () => setTimeout(() => apiRef.current.startTour(), 250);
    window.addEventListener("nigoh:tour", h);
    return () => window.removeEventListener("nigoh:tour", h);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- klaviatura ---------- */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(".login.open, .dialog-backdrop.open")) return;
      if (apiRef.current.escape()) e.preventDefault();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useShortcut("/", () => {
    setCollapsed(false, false);
    const input = document.getElementById("q-list") as HTMLInputElement | null;
    input?.focus();
    input?.select();
  });
  useShortcut("+", () => { ctl?.map.zoomIn(); });
  useShortcut("=", () => { ctl?.map.zoomIn(); });
  useShortcut("-", () => { ctl?.map.zoomOut(); });
  useShortcut("l", () => { ctl?.locate(); });
  useShortcut("L", () => { ctl?.locate(); });

  /* ---------- to'liq ekran ---------- */
  useEffect(() => {
    const h = () => {
      setFs(document.fullscreenElement === viewRef.current && !!viewRef.current);
      setTimeout(() => apiRef.current.ctl?.map.invalidateSize(), 120);
    };
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // body klasslari (v3 mosligi).
  useEffect(() => {
    document.body.classList.toggle("has-sel", drawerOpen);
    document.body.classList.toggle("pick-mode", pickMode);
    return () => { document.body.classList.remove("has-sel", "pick-mode"); };
  }, [drawerOpen, pickMode]);

  return (
    <MapCtx.Provider value={mapApi}>
      <section ref={viewRef} id="map-view" aria-label={t("Oʻzbekiston xaritasi")}
        className={cx("page page--map", collapsed && "mp-collapsed", drawerOpen && "mp-has-drawer", pollFails >= 2 && "mp-stale")}>
        <div id="map" className="mp-map" ref={mapEl} />
        <Panel />
        <button type="button" className="mp-ctl mp-expand" id="mp-expand" data-tip="Panelni ochish" data-tip-place="right"
          aria-label={t("Panelni ochish")} onClick={() => setCollapsed(false, true)}><Icon name="sidebar" /></button>
        <div className="mp-scrim" id="mp-scrim" aria-hidden="true" onClick={() => setCollapsed(true, false)} />
        <Toolbar layers={{ ...layers, base }} setLayer={setLayer} railsOk={railsOk} railSrc={railSrc} hybridOk={hybridOk} />
        <MapControls locate={locate} fs={fs} onFs={toggleMapFullscreen} />
        <Legend />
        <ScaleBar />
        <ModeBars measurePts={measurePts} />
        <CameraCard onFullscreen={cardFullscreen} />
        <CameraDrawer ref={videoWrapRef} />
      </section>
      <GroupDialog modal={groupModal} onClose={() => setGroupModal(null)} onSaved={(many) => { if (many) setPickMode(false); }} />
      {step >= 0 && step < STEPS.length && (
        <Onboarding step={step} onSkip={() => finishTour(true)}
          onNext={() => { if (step >= STEPS.length - 1) finishTour(true); else setStep(step + 1); }} />
      )}
    </MapCtx.Provider>
  );
}
