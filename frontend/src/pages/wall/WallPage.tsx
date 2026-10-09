/* pages/wall/WallPage.tsx — Video devor (Figma 04.01–04.07; v3 wall/video-wall.js).
   Devor rejimi: toolbar (Guruh menyusi, setka 2×2/3×3/4×4 [+6×6, 8×8 keng ekranda], sifat
   Avto/Past/Yuqori, avto-aylanish + oraliq, Toʻliq ekran, sysbar), kataklar (WallTile),
   footer ("7 / 9 onlayn", sahifalagich, keyingi sahifagacha teskari sanoq). Kataklarni sudrab
   tartiblash, ←/→ sahifalar, hover'da avto-aylanish pauzasi, keyingi sahifani oldindan ochish.
   Fokus (04.02) — `#/wall/focus` (FocusView); Toʻliq ekran (04.05) — TV rejimi (body.wl-tv:
   rail yashirin, pastda "Sahifa 1 / 16 · keyingisi 8 s").

   Prefs "wall": { size, quality, auto, interval, group ("" | "g:<id>" | "r:<hudud>"), order, focus }
   Prefs "wall.pinned": [kamera id...] — "Devorga qoʻshish" (Boshqaruv/xarita): devorda oldinda; sudrab
     tartiblanganda o'rni "order" ga o'tadi va pinned dan olinadi (v3 state.pinned).
   Qoidalar / tuzoqlar (v3 dan):
     - Kataklar kamera id bo'yicha kalitlangan — ma'lumot yangilanishi oqimni uzmaydi.
     - Sifat "Avto": katak kengligi ≤ 480 px → sub, aks holda asosiy (Dev handoff §7).
       O'lcham o'zgarsa (300 ms jamlab) kataklar kerak bo'lsa yangi oqimga o'tadi;
       ustun/qator va 16:9 katak o'lchami esa darhol (ResizeObserver, oqim qayta ochilmaydi).
     - Fokusda devor kataklari yopiladi (trafik), qaytganda sahifa o'sha.
     - Avto-aylanish 1 s lik tik: hover/sudrash/yashirin oynada sanoq to'xtaydi; ma'lumot
       yangilanishi sanoqni noldan boshlamaydi. Almashishdan 5 s oldin (oraliq qisqa bo'lsa —
       yarmi) keyingi sahifa ko'rinmas kataklarda (.is-staged) ochiladi va o'sha katak devorga
       o'tadi (bir ota-elementda, kalit bir xil — oqim uzilmaydi).
     - Sahifadan chiqilsa barcha pleyerlar to'xtaydi (kataklar unmount), TV rejimi yopiladi. */
import "@/styles/wall.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { useT } from "@/i18n/I18nProvider";
import { useAuth } from "@/auth/AuthProvider";
import { PageSheet } from "@/layout/AppShell";
import { Sysbar } from "@/layout/Sysbar";
import { Icon } from "@/components/Icon";
import { EmptyState, IconButton, InfoTip, cx } from "@/components/ui";
import { Menu, Popover, useShortcut, type MenuEntry } from "@/components/overlays";
import { useCameras } from "@/data/queries";
import { prefs, usePref } from "@/lib/prefs";
import { getSelectedCamera } from "@/lib/selection";
import { fmtTime } from "@/lib/format";
import type { Camera } from "@/lib/types";
import { WallTile, isDown, type Quality } from "./WallTile";
import { FocusView } from "./FocusView";
import { useGroups } from "./queries";
import { useSaveSnapshot } from "./snapshot";

const SIZES = [2, 3, 4, 6, 8];
const INTERVALS = [8, 12, 20, 30];          // Figma: "interval Select’da: 8/12/20/30 s"
/* Katak shu kenglikdan (px) tor bo'lsa "Avto" past oqimni oladi. */
const SUB_MAX_CELL = 480;
/* Keyingi sahifa almashishdan shuncha oldin ko'rinmas joyda ochiladi
   (devorda o'lchangan ochilish 1,5–4,8 s). Oraliq qisqa bo'lsa — yarmi. */
const PRELOAD_LEAD_MS = 5000;
/* 6×6 va 8×8 — faqat keng (TV) ekranda; torroqda 4×4 gacha qisiladi. */
const TV_MIN_WIDTH = 1720;
const GAP = 8;

type WallQuality = "auto" | "sub" | "main";
interface WallPrefs { size: number; quality: WallQuality; auto: boolean; interval: number; group: string; order: number[]; focus: number | null }

function normPrefs(raw: unknown): WallPrefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const iv = Number(p.interval);
  return {
    size: SIZES.includes(Number(p.size)) ? Number(p.size) : 3,
    quality: ["auto", "sub", "main"].includes(p.quality as string) ? (p.quality as WallQuality) : "auto",
    auto: !!p.auto,
    interval: iv > 0 ? INTERVALS.reduce((a, b) => (Math.abs(b - iv) < Math.abs(a - iv) ? b : a)) : 12,
    group: typeof p.group === "string" ? p.group : "",
    order: Array.isArray(p.order) ? p.order.filter(Number.isInteger) : [],
    focus: Number.isInteger(p.focus) ? (p.focus as number) : null,
  };
}
function savePrefs(patch: Partial<WallPrefs>) {
  prefs.set("wall", { ...normPrefs(prefs.get("wall", {})), ...patch });
}

/* v3 state.wallPage — boshqa bo'limga o'tib qaytganda sahifa o'sha qoladi. */
let lastPage = 0;

interface Box { W: number; H: number; gap: number; vw: number }

/* Setka kamera soniga moslashadi (2 ta kamera 3×3 ga qisilmaydi); eni uzun monitorda
   (21:9, 32:9) 16:9 katak eng katta chiqadigan ustunlar soni tanlanadi. */
function layout(n: number, size: number, phone: boolean, W: number, H: number) {
  if (phone) return { cols: 1, rows: Math.max(1, n) };
  const count = Math.max(1, n);
  let cols = Math.min(size, Math.ceil(Math.sqrt(count)));
  let rows = Math.min(size, Math.ceil(count / cols));
  if (W && H) {
    const cell = (c: number, r: number) => Math.min((W - GAP * (c - 1)) / c, ((H - GAP * (r - 1)) / r) * 16 / 9);
    let best = cell(cols, rows);
    for (let c = 1; c <= count; c++) {
      const r = Math.ceil(count / c);
      const w = cell(c, r);
      if (w > best * 1.04) { best = w; cols = c; rows = r; }
    }
  }
  return { cols, rows };
}

export default function WallPage() {
  const t = useT();
  const nav = useNavigate();
  const { sub } = useParams();
  const { user } = useAuth();
  const saveSnapshot = useSaveSnapshot();
  const camsQ = useCameras();
  const { cameras, byId } = camsQ;
  const groupsQ = useGroups(!!user);
  const groups = useMemo(() => groupsQ.data || [], [groupsQ.data]);
  const [rawPrefs] = usePref<unknown>("wall", {});
  const P = useMemo(() => normPrefs(rawPrefs), [rawPrefs]);
  const focusMode = sub === "focus";

  const [page, setPageState] = useState(lastPage);
  const setPage = useCallback((p: number) => { lastPage = p; setPageState(p); }, []);
  const [tv, setTv] = useState(false);
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const [staged, setStaged] = useState<{ ids: number[]; quality: Quality } | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  /* ---------- Guruh / hudud ---------- */
  const groupId = P.group.startsWith("g:") ? Number(P.group.slice(2)) : null;
  const region = P.group.startsWith("r:") ? P.group.slice(2) : "";
  const group = groupId != null ? groups.find((g) => g.id === groupId) || null : null;
  const groupLabel = group ? group.name : region ? region : "Barcha kameralar";

  /* "Devorga qoʻshish" (Boshqaruv, xarita) — pref "wall.pinned": shu kameralar devorda oldinda (v3 state.pinned). */
  const [pinnedRaw, setPinned] = usePref<unknown>("wall.pinned", []);
  const pinned = useMemo(() => (Array.isArray(pinnedRaw) ? pinnedRaw.filter(Number.isInteger) as number[] : []), [pinnedRaw]);

  /* Tartib: avval biriktirilganlar, keyin sudrab saqlangan tartib, qolganlari asl tartibda. */
  const sorted = useCallback((list: Camera[], order: number[]) => {
    const ord = new Map(order.map((id, i) => [id, i]));
    const pin = new Map(pinned.map((id, i) => [id, i]));
    const key = (c: Camera, i: number) => (pin.has(c.id) ? -1e6 + pin.get(c.id)! : ord.has(c.id) ? ord.get(c.id)! : 1e6 + i);
    return list.map((c, i) => [key(c, i), c] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  }, [pinned]);

  /* Devorga tushadigan kameralar: guruh yoki hudud filtri; uzilganlar ham, o'chirilganlar — yo'q. */
  const all = useMemo(() => {
    const ok = (c: Camera | undefined): c is Camera => !!c && c.state !== "disabled";
    const base = group ? group.camera_ids.map((id) => byId.get(id)).filter(ok)
      : cameras.filter((c) => ok(c) && (!region || c.region === region));
    return sorted(base, P.order);
  }, [group, byId, cameras, region, P.order, sorted]);

  /* ---------- O'lchamlar ---------- */
  const [box, setBox] = useState<Box>({ W: 0, H: 0, gap: GAP, vw: innerWidth });
  const [boxB, setBoxB] = useState<Box>(box);          // 300 ms jamlangan — sahifa va oqim sifati
  const gridEl = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const debTimer = useRef(0);
  const measure = useCallback((immediate: boolean) => {
    const g = gridEl.current;
    const nb: Box = g
      ? { W: g.clientWidth, H: g.clientHeight, gap: parseFloat(getComputedStyle(g).columnGap) || 0, vw: innerWidth }
      : { W: 0, H: 0, gap: GAP, vw: innerWidth };
    setBox((o) => (o.W === nb.W && o.H === nb.H && o.gap === nb.gap && o.vw === nb.vw ? o : nb));
    clearTimeout(debTimer.current);
    if (immediate) setBoxB(nb);
    else debTimer.current = window.setTimeout(() => setBoxB(nb), 300);
  }, []);
  const gridRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    gridEl.current = el;
    if (!el) return;
    measure(!boxBReady.current);
    if (window.ResizeObserver) {
      roRef.current = new ResizeObserver(() => measure(false));
      roRef.current.observe(el);
    }
  }, [measure]);
  const boxBReady = useRef(false);
  if (boxB.W > 0) boxBReady.current = true;
  useEffect(() => {
    const h = () => measure(false);
    addEventListener("resize", h);
    return () => { removeEventListener("resize", h); clearTimeout(debTimer.current); roRef.current?.disconnect(); };
  }, [measure]);
  // TV rejimi almashdi — devor maydoni darhol qayta o'lchanadi (v3: requestAnimationFrame build).
  useLayoutEffect(() => { if (gridEl.current) measure(true); }, [tv, measure]);

  const effSize = (vw: number) => (vw < 1024 ? Math.min(P.size, 2) : vw < TV_MIN_WIDTH && !tv ? Math.min(P.size, 4) : P.size);
  const sizeB = effSize(boxB.vw);
  const phoneB = boxB.vw <= 640;
  const slots = sizeB * sizeB;
  const pages = Math.max(1, Math.ceil(all.length / slots));
  const pg = Math.min(Math.max(0, page), pages - 1);
  const pageCams = useCallback((p: number) => {
    const q = ((p % pages) + pages) % pages;
    return all.slice(q * slots, q * slots + slots);
  }, [all, pages, slots]);
  const cams = useMemo(() => pageCams(pg), [pageCams, pg]);
  useEffect(() => { if (pg !== page) setPage(pg); }, [pg, page, setPage]);

  const streamQuality = useCallback((cols: number): Quality => {
    if (P.quality === "main") return "";
    if (P.quality === "sub") return "sub";
    const w = boxB.W || innerWidth - 136;
    return (w - GAP * (cols - 1)) / cols <= SUB_MAX_CELL ? "sub" : "";
  }, [P.quality, boxB.W]);
  const quality = streamQuality(layout(cams.length, sizeB, phoneB, boxB.W, boxB.H).cols);

  // Ko'rinish (darhol): ustun/qator va 16:9 katak (v3 relayout + fitGrid).
  const { cols, rows } = layout(cams.length, effSize(box.vw), box.vw <= 640, box.W, box.H);
  const gridStyle: Record<string, string | number> = { "--wl-cols": cols, "--wl-rows": rows };
  if (box.W) {
    const w = (box.W - box.gap * (cols - 1)) / cols;
    const h = (box.H - box.gap * (rows - 1)) / rows;
    const cw = Math.max(0, Math.floor(Math.min(w, h * 16 / 9)));
    gridStyle["--wl-cw"] = cw + "px";
    gridStyle["--wl-ch"] = Math.floor(cw * 9 / 16) + "px";
  }

  /* ---------- Avto-aylanish ---------- */
  const autoOn = P.auto && !focusMode && pages >= 2;
  const period = (iv = P.interval) => Math.max(5, iv) * 1000;
  const remain = useRef(0);
  const preloaded = useRef(false);
  const hover = useRef(false);
  const dragId = useRef<number | null>(null);
  const resetAuto = (iv?: number) => { remain.current = period(iv); preloaded.current = false; };
  const paused = () => hover.current || dragId.current != null || document.hidden;

  const nextIds = useMemo(() => new Set(pages >= 2 ? pageCams(pg + 1).map((c) => c.id) : []), [pageCams, pg, pages]);
  const curIds = useMemo(() => new Set(cams.map((c) => c.id)), [cams]);

  const live = useRef({ pg, pages, all, pageCams, streamQuality, sizeB, phoneB, boxB, curIds, P });
  live.current = { pg, pages, all, pageCams, streamQuality, sizeB, phoneB, boxB, curIds, P };

  const preloadNext = () => {
    const L = live.current;
    if (L.pages < 2) return;
    const next = L.pageCams(L.pg + 1);
    const q = L.streamQuality(layout(next.length, L.sizeB, L.phoneB, L.boxB.W, L.boxB.H).cols);
    setStaged({ ids: next.filter((c) => !L.curIds.has(c.id)).map((c) => c.id), quality: q });
  };

  useEffect(() => {
    if (!autoOn) { setStaged(null); return; }
    if (!remain.current) resetAuto();
    const id = setInterval(() => {
      const L = live.current;
      if (!paused()) remain.current -= 1000;
      const lead = Math.min(PRELOAD_LEAD_MS, period(L.P.interval) / 2);
      if (!preloaded.current && remain.current <= lead) { preloaded.current = true; preloadNext(); }
      if (remain.current <= 0) {
        setPage((L.pg + 1) % L.pages);
        resetAuto(L.P.interval);
        setStaged(null);      // shu render'da oldindan ochilganlar devorga o'tadi
        return;
      }
      tick();
    }, 1000);
    return () => clearInterval(id);
  }, [autoOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // "yangilandi HH:MM:SS" — devor qayta qurilganda (ma'lumot, sahifa, sozlama, o'lcham).
  useEffect(() => { setUpdatedAt(new Date()); }, [camsQ.dataUpdatedAt, pg, rawPrefs, tv, boxB, groups]);

  const goPage = (d: number) => {
    if (pages < 2) return;
    setPage((pg + d + pages) % pages);
    resetAuto();
    setStaged(null);
  };

  /* ---------- Fokus ---------- */
  const focusId = focusMode
    ? ([P.focus, getSelectedCamera()].find((x) => x != null && byId.has(x)) ?? (all[0] ? all[0].id : null))
    : null;
  const focusCam = focusId != null ? byId.get(focusId) || null : null;
  useEffect(() => {
    if (!focusMode || !camsQ.isSuccess) return;
    if (focusId == null) { nav("/wall", { replace: true }); return; }
    if (P.focus !== focusId) savePrefs({ focus: focusId });
  }, [focusMode, focusId, camsQ.isSuccess, P.focus, nav]);

  const enterFocus = (id: number) => {
    savePrefs({ focus: id });
    if (!focusMode) nav("/wall/focus");
  };
  const exitFocus = () => {
    if (document.fullscreenElement && !tvRef.current) document.exitFullscreen().catch(() => {});
    nav("/wall");
  };
  const stepFocus = (d: number) => {
    if (!all.length) return;
    const i = all.findIndex((c) => c.id === focusId);
    const n = all[((i < 0 ? 0 : i) + d + all.length) % all.length];
    savePrefs({ focus: n.id });
  };
  const showOnMap = (cam: Camera) => nav("/?camera=" + cam.id);

  /* ---------- To'liq ekran (TV, 04.05) ---------- */
  const tvRef = useRef(false);
  const tvNative = useRef(false);
  tvRef.current = tv;
  const enterTv = () => {
    if (tvRef.current) return;
    tvRef.current = true;
    setTv(true);
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
  };
  const exitTv = useCallback(() => {
    if (!tvRef.current) return;
    tvRef.current = false;
    setTv(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);
  useEffect(() => { document.body.classList.toggle("wl-tv", tv); }, [tv]);
  useEffect(() => {
    const h = () => {
      if (!document.fullscreenElement && tvRef.current && tvNative.current) exitTv();
      tvNative.current = !!document.fullscreenElement && tvRef.current;
    };
    document.addEventListener("fullscreenchange", h);
    return () => {
      document.removeEventListener("fullscreenchange", h);
      document.body.classList.remove("wl-tv");
      if (tvRef.current && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [exitTv]);

  /* ---------- Klaviatura ---------- */
  useShortcut("ArrowLeft", () => { if (focusMode) stepFocus(-1); else goPage(-1); });
  useShortcut("ArrowRight", () => { if (focusMode) stepFocus(1); else goPage(1); });
  useShortcut("Escape", () => {
    if (tvRef.current) { exitTv(); return; }
    if (focusMode) { exitFocus(); return; }
    return false;
  });

  /* ---------- Menyular ---------- */
  const [groupAnchor, setGroupAnchor] = useState<HTMLButtonElement | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [ivAnchor, setIvAnchor] = useState<HTMLButtonElement | null>(null);
  const [ivOpen, setIvOpen] = useState(false);
  const closeGroup = useCallback(() => setGroupOpen(false), []);
  const closeIv = useCallback(() => setIvOpen(false), []);

  const groupItems = (): MenuEntry[] => {
    const ok = (c: Camera) => c.state !== "disabled";
    const allOk = cameras.filter(ok);
    const regions = new Map<string, number>();
    allOk.forEach((c) => regions.set(c.region, (regions.get(c.region) || 0) + 1));
    const cur = group ? "g:" + group.id : region ? "r:" + region : "";
    const pick = (key: string) => () => { savePrefs({ group: key }); setPage(0); resetAuto(); setStaged(null); };
    const item = (key: string, label: string, n: number, ic: string): MenuEntry => ({
      label, kbd: String(n), icon: key === cur ? "check" : ic, on: key === cur, onClick: pick(key),
    });
    const items: MenuEntry[] = [item("", "Barcha kameralar", allOk.length, "grid")];
    if (groups.length) {
      items.push({ heading: "Guruhlar" });
      groups.forEach((g) => items.push(item("g:" + g.id, g.name,
        g.camera_ids.filter((id) => { const c = byId.get(id); return !!c && ok(c); }).length, "grid")));
    }
    if (regions.size) {
      items.push({ heading: "Hududlar" });
      [...regions.keys()].sort((a, b) => String(a).localeCompare(String(b), "uz"))
        .forEach((r) => items.push(item("r:" + r, r, regions.get(r)!, "location-pin")));
    }
    return items;
  };

  /* ---------- Sudrab tartiblash ---------- */
  const reorder = (fromId: number, toId: number) => {
    const list = all.map((c) => c.id);
    const a = list.indexOf(fromId), b = list.indexOf(toId);
    if (a < 0 || b < 0 || a === b) return;
    list.splice(a, 1);
    list.splice(b, 0, fromId);
    const inList = new Set(list);
    let k = 0;
    savePrefs({ order: sorted(cameras, P.order).map((c) => (inList.has(c.id) ? list[k++] : c.id)) });
    // Biriktirilganlik — faqat "oldinda turish"; endi o'rni tartibda saqlandi (v3 kabi tozalanadi).
    if (pinned.some((id) => inList.has(id))) setPinned(pinned.filter((id) => !inList.has(id)));
  };
  const tileOf = (e: DragEvent) => (e.target as Element).closest?.(".wl-tile") as HTMLElement | null;
  const endDrag = () => {
    dragId.current = null;
    gridEl.current?.querySelectorAll(".is-drag, .is-drop").forEach((x) => x.classList.remove("is-drag", "is-drop"));
  };
  const onDragStart = (e: DragEvent<HTMLDivElement>) => {
    const el = tileOf(e);
    if (!el) return;
    dragId.current = Number(el.dataset.id);
    el.classList.add("is-drag");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(dragId.current));
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (dragId.current == null) return;
    const el = tileOf(e);
    e.preventDefault();
    gridEl.current?.querySelectorAll(".is-drop").forEach((x) => { if (x !== el) x.classList.remove("is-drop"); });
    if (el && Number(el.dataset.id) !== dragId.current) el.classList.add("is-drop");
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (dragId.current == null) return;
    e.preventDefault();
    const el = tileOf(e);
    const from = dragId.current;
    endDrag();
    if (el) reorder(from, Number(el.dataset.id));
  };

  /* ---------- Matnlar ---------- */
  const up = cams.filter((c) => !isDown(c) && c.state !== "stalled").length;
  const sec = Math.max(0, Math.ceil(remain.current / 1000));
  const isPaused = paused();
  const nextTxt = !autoOn ? "" : isPaused ? "Keyingi sahifa: pauza" : "Keyingi sahifa: " + sec + " s";
  const updTxt = [nextTxt, updatedAt ? "yangilandi " + fmtTime(updatedAt) : ""].filter(Boolean).join(" · ");
  const tvTxt = "Sahifa " + (pg + 1) + " / " + pages + (autoOn ? " · keyingisi " + (isPaused ? "pauza" : sec + " s") : "");

  const stagedCams = staged && autoOn
    ? staged.ids.filter((id) => nextIds.has(id) && !curIds.has(id)).map((id) => byId.get(id)).filter((c): c is Camera => !!c)
    : [];
  const tileProps = {
    onShot: saveSnapshot, onMap: showOnMap, onFocus: (c: Camera) => enterFocus(c.id),
  };

  return (
    <PageSheet id="wall-view" className="wl-sheet">
      {focusMode && focusCam ? (
        <FocusView cam={focusCam} list={all} onShow={(id) => savePrefs({ focus: id })} onExit={exitFocus}
          onShot={saveSnapshot} onMap={showOnMap} />
      ) : focusMode ? null : (
        <>
          <div className="wl-bar" id="wall-bar">
            <div className="wl-title">
              <h1 className="heading-lg">{t("Video devor")}</h1>
              <InfoTip text="Jonli kameralar bir ekranda. Kartani bosing — Fokus; sudrab tartiblang; ← / → — sahifalar." />
            </div>
            <button ref={setGroupAnchor} type="button" className={cx("wl-select", groupOpen && "is-open")} id="wall-group"
              aria-haspopup="menu" aria-expanded={groupOpen} onClick={() => setGroupOpen((o) => !o)}>
              <span className="wl-select__text ellipsis" id="wall-group-text">{groupOpen ? t("Hududni tanlang") : t("Guruh: " + groupLabel)}</span>
              <span className="wl-select__chev"><Icon name="chevron-down" size="sm" /></span>
            </button>
            <Popover anchor={groupAnchor} open={groupOpen} onClose={closeGroup} place="bottom-start" className="wl-menu"
              width={Math.max(260, (groupAnchor?.offsetWidth || 0) + 20)}>
              <Menu items={groupItems()} onDone={closeGroup} />
            </Popover>
            <div className="seg seg--inline wl-seg" id="wall-sizes" role="group" aria-label={t("Katak oʻlchami")}>
              {SIZES.map((n) => (
                <button key={n} type="button" data-wsize={n} className={cx(n >= 6 && "wl-tv-only", n === sizeB && "is-on")}
                  onClick={() => { savePrefs({ size: n }); setPage(0); resetAuto(); setStaged(null); }}>{n}×{n}</button>
              ))}
            </div>
            <div className="seg seg--inline wl-seg" id="wall-quality" role="group" aria-label={t("Sifat")}>
              {([["auto", "Avto"], ["sub", "Past"], ["main", "Yuqori"]] as const).map(([q, label]) => (
                <button key={q} type="button" data-wq={q} className={cx(P.quality === q && "is-on")}
                  data-tip={q === "auto" ? "Katak 480 px gacha — qoʻshimcha (yengil) oqim, kattaroq — asosiy oqim" : undefined}
                  onClick={() => savePrefs({ quality: q })}>{t(label)}</button>
              ))}
            </div>
            <div className="wl-auto">
              <button type="button" className="switch" id="wall-auto" role="switch" aria-checked={P.auto} aria-labelledby="wall-auto-label"
                onClick={() => { savePrefs({ auto: !P.auto }); resetAuto(); }} />
              <button ref={setIvAnchor} type="button" className="wl-auto__label" id="wall-auto-label" aria-haspopup="menu"
                data-tip="Almashish oraligʻini tanlash" onClick={() => setIvOpen((o) => !o)}>
                {t("Avtoaylanish · ")}<span id="wall-interval">{t(P.interval + " s")}</span>
              </button>
              <Popover anchor={ivAnchor} open={ivOpen} onClose={closeIv} place="bottom-start" className="wl-menu">
                <Menu onDone={closeIv} items={INTERVALS.map((s) => ({
                  label: s + " soniya", on: s === P.interval,
                  onClick: () => { savePrefs({ interval: s, auto: true }); resetAuto(s); },
                }))} />
              </Popover>
            </div>
            <span className="spacer" />
            <button type="button" className="btn btn--secondary wl-fs" id="wall-fs" onClick={() => (tv ? exitTv() : enterTv())}>
              <span><Icon name="maximize" /></span><span className="wl-fs__text">{t("Toʻliq ekran")}</span>
            </button>
            <div className="wl-sysbar" id="wall-sysbar"><Sysbar flat /></div>
          </div>

          <div ref={gridRef} className={cx("wl-grid", sizeB >= 6 && "is-dense")} id="wall-grid" aria-label={t("Video devor")}
            style={gridStyle as CSSProperties}
            onMouseEnter={() => { hover.current = true; tick(); }}
            onMouseLeave={() => { hover.current = false; tick(); }}
            onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={endDrag}>
            {/* Bitta massiv: oldindan ochilgan katak devorga o'tganda kalit o'sha ro'yxatda qoladi — remount yo'q */}
            {boxB.W > 0 && [
              ...cams.map((cam) => (
                <WallTile key={cam.id} cam={cam} quality={quality} draggable={!phoneB} enterKey
                  onActivate={(c) => enterFocus(c.id)} {...tileProps} />
              )),
              ...stagedCams.map((cam) => (
                <WallTile key={cam.id} cam={cam} quality={staged!.quality} staged {...tileProps} />
              )),
            ]}
            {!cams.length && camsQ.isSuccess && (
              <EmptyState type="nodata" title="Koʻrsatiladigan kamera yoʻq" text="Boshqa guruh yoki hududni tanlang." />
            )}
          </div>

          <div className="wl-foot" id="wall-foot">
            <span className="wl-foot__live"><span className="dot" data-status="online" /><span id="wall-live">{t(up + " / " + cams.length + " onlayn")}</span></span>
            <span className="wl-pager">
              <IconButton icon="chevron-left" tip="Oldingi sahifa (←)" size="sm" variant="secondary" id="wall-prev"
                disabled={pages < 2} onClick={() => goPage(-1)} />
              <span className="wl-pager__num" id="wall-page">{pg + 1} / {pages}</span>
              <IconButton icon="chevron-right" tip="Keyingi sahifa (→)" size="sm" variant="secondary" id="wall-next"
                disabled={pages < 2} onClick={() => goPage(1)} />
            </span>
            <span className="wl-foot__upd" id="wall-upd">{t(updTxt || "yangilandi —")}</span>
          </div>
        </>
      )}

      <div className="wl-tvbar" id="wall-tvbar" hidden={!tv}><span id="wall-tvtext">{t(tvTxt)}</span><span className="wl-tvbar__hint">{t("Esc — chiqish")}</span></div>
    </PageSheet>
  );
}
