/* pages/map/Panel.tsx — Panel / Kameralar (Figma 02.01–02.04, 02.07–02.16), v3 map/camera-list.js.
   Suzuvchi panel (360px; 1280–1439 da 320; <1024 overlay; telefonda pastki varaq):
     * sarlavha + "Panelni yigʻish" (?panel=closed, prefs "panel");
     * SearchField ("/", 300 ms): kamera nomi, km/piket, hudud — natijalar guruhlangan,
       mos qism ajratilgan, ↑↓ tanlash, Enter — xaritada markazlash; natija yo'q — EmptyState;
     * Segmented Kameralar / Hududlar / Guruhlar (sonlar bilan);
     * FilterChip'lar (ko'p tanlov, ro'yxat va xaritaga birga) + guruh chipi;
     * RegionRow (uzilganlar ↓) → ochiladi + fitBounds; CameraRow; "Belgilanmagan";
     * footer "Yangilandi HH:MM:SS · har N s"; Skeleton (>300 ms); Alert (2 ketma-ket xato).
   5000+ kamerada: yopiq hudud qatorlari faqat ochilganda yaratiladi; natijalar 60 tagacha. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useT } from "@/i18n/I18nProvider";
import { Icon } from "@/components/Icon";
import { Button, EmptyState, InfoTip, cx } from "@/components/ui";
import { useDelayed } from "@/components/overlays";
import { prewarm } from "@/player/player.js";
import type { Camera } from "@/lib/types";
import {
  countStates, groupByRegion, regionMeta, searchCams, useMap,
  type Group, type ListView, type RegionInfo, type SearchResults, type StatusFilter,
} from "./model";
import { MOBILE_Q, NOGEO, STATUS_LABEL, camMeta, camStatus, hasGeo, hms, splitHit } from "./util";
import { useMedia } from "./hooks";

const CHIPS: { key: StatusFilter | ""; label: string }[] = [
  { key: "", label: "Hammasi" },
  { key: "online", label: "Onlayn" },
  { key: "offline", label: "Uzilgan" },
  { key: "no-video", label: "Tasvirsiz" },
];
const RES_LIMIT = 60;

interface NavItem { id?: number; km?: string; reg?: string }
/* Natija qatorlari tartibi (↑↓ va Enter uchun) — Results bilan bir xil. */
function navItems(r: SearchResults): NavItem[] {
  return [
    ...r.camHits.slice(0, RES_LIMIT).map((c) => ({ id: c.id })),
    ...[...r.kmMap.keys()].slice(0, RES_LIMIT).map((km) => ({ km })),
    ...r.regions.map((g) => ({ reg: g.key })),
  ];
}
const colorOf = (g: Group | undefined) => (g && g.color) || "var(--color-bg-brand)";

/* Bo'sh joy bilan ajratilgan v3 "span[data-icon]" — ikonka span ichida (v3 DOM bilan bir xil). */
export function IconSpan({ name, size = "md" }: { name: string; size?: "xs" | "sm" | "md" | "lg" }) {
  return <span><Icon name={name} size={size} /></span>;
}

function Hl({ text, q }: { text: string; q: string }) {
  const p = splitHit(text, q);
  if (!p) return <>{text}</>;
  return <>{p[0]}<mark className="mp-hl">{p[1]}</mark>{p[2]}</>;
}

function Counts({ n }: { n: RegionInfo["n"] }) {
  return (
    <span className="mp-counts">
      <span className="badge badge--count" data-status="online" data-tip="Onlayn">{n.online}</span>
      {!!n["no-video"] && <span className="badge badge--count" data-status="no-video" data-tip="Tasvirsiz">{n["no-video"]}</span>}
      {!!n.offline && <span className="badge badge--count" data-status="offline" data-tip="Uzilgan">{n.offline}</span>}
    </span>
  );
}

function ListHead({ title, tip, children }: { title: string; tip?: string; children?: React.ReactNode }) {
  const t = useT();
  return (
    <div className="mp-listhead" id="mp-listhead">
      <span className="overline">{t(title)}</span>
      {tip && <InfoTip text={tip} />}
      <span className="spacer" />
      {children}
    </div>
  );
}

export function Panel() {
  const t = useT();
  const m = useMap();
  const mobile = useMedia(MOBILE_Q);
  const phone = useMedia("(max-width:640px)");
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<number | null>(null);
  const [nav, setNav] = useState(0);
  const skeleton = useDelayed(!m.loaded, 300);
  const q = m.qApplied.trim();
  const results = m.results;

  // Natijalar o'zgarganda — birinchi qator faol (v3: nav = 0).
  useEffect(() => { setNav(0); }, [results?.q]);

  // Marker hover → ro'yxat qatori (DOM klassi, qayta chizmasdan).
  useEffect(() => {
    const h = (e: Event) => {
      const body = bodyRef.current;
      if (!body) return;
      body.querySelectorAll(".mp-crow.is-hover").forEach((r) => r.classList.remove("is-hover"));
      const id = (e as CustomEvent<number | null>).detail;
      if (id == null) return;
      body.querySelector('.mp-crow[data-id="' + id + '"]')?.classList.add("is-hover");
    };
    m.hoverBus.addEventListener("map", h);
    return () => m.hoverBus.removeEventListener("map", h);
  }, [m.hoverBus]);

  const tabCounts = useMemo(() => ({
    cams: m.visible.length,
    regs: new Set(m.visible.map((c) => (hasGeo(c) ? c.region || "—" : NOGEO))).size,
    grps: m.authed ? m.groups.length : null,
  }), [m.visible, m.authed, m.groups.length]);

  const onOver = (e: MouseEvent) => {
    const row = (e.target as Element).closest("[data-id]") as HTMLElement | null;
    const id = row ? Number(row.dataset.id) : null;
    if (id === hoverRef.current) return;
    hoverRef.current = id;
    m.ctl?.setHover(id);
    // Uzilgan kamerani uyg'otish befoyda (snapshot 404, oqim ochilmaydi).
    if (id != null) { const c = m.byId.get(id); if (c && camStatus(c) !== "offline") prewarm(c); }
  };
  const onLeave = () => { hoverRef.current = null; m.ctl?.setHover(null); };

  /* ---------- qidiruv klaviaturasi ---------- */
  const navRows = () => [...(bodyRef.current?.querySelectorAll<HTMLElement>("[data-nav]") || [])];
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const v = e.currentTarget.value;
    if (e.key === "Escape" && v) { e.stopPropagation(); e.preventDefault(); e.nativeEvent.preventDefault(); m.setQuery("", true); return; }
    if (!v.trim()) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const rows = navRows();
      if (!rows.length) return;
      e.preventDefault();
      const i = e.key === "ArrowDown" ? Math.min(rows.length - 1, nav + 1) : Math.max(0, nav - 1);
      setNav(i);
      rows[i].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Kechikayotgan qidiruv (300 ms) — darhol qo'llanadi va birinchi natija faollashadi.
      if (m.qApplied !== v) {
        m.setQuery(v, true);
        const fresh = searchCams(v.trim(), m.visible);
        const first = navItems(fresh)[0];
        if (first) activate(first, fresh, true);
        return;
      }
      const it = results && navItems(results)[Math.max(0, nav)];
      if (it && results) activate(it, results, true);
    }
  };

  const activate = (it: NavItem, res: SearchResults, enter: boolean) => {
    if (it.id != null) {
      const id = it.id;
      const cam = m.byId.get(id);
      if (!cam) return;
      if (enter && hasGeo(cam) && m.ctl) {
        // Enter → xaritada markazlash + kichik karta.
        const map = m.ctl.map;
        map.flyTo([cam.lat, cam.lng], Math.max(map.getZoom(), 15), { duration: 0.5 });
        map.once("moveend", () => m.ctl?.reveal(id, () => m.openCard(id)));
        if (mobile) m.setCollapsed(true, false);
      } else m.selectCamera(id, true);
    } else if (it.km != null) {
      m.ctl?.fitCams(res.kmMap.get(it.km) || [], { zoom: 15 }, m.padTL());
    } else if (it.reg != null) {
      const r = res.regions.find((x) => x.key === it.reg);
      if (r) m.flyToRegion(r);
    }
  };
  const activateRow = (row: HTMLElement) => {
    if (!results) return;
    const d = row.dataset;
    activate(d.id ? { id: Number(d.id) } : d.km != null ? { km: d.km } : { reg: d.reg }, results, false);
  };

  const clearQ = () => { m.setQuery("", true); inputRef.current?.focus(); };
  const clearFilters = () => { m.clearFilters(); };

  /* ---------- tanlov ---------- */
  const onCamRow = (id: number) => {
    if (m.pickMode) { m.togglePick(id); return; }
    m.selectCamera(id, true);
  };

  const collapseTip = m.collapsed && phone ? "Panelni ochish" : "Panelni yigʻish";
  const noResults = !!q && !!results && !results.total;

  return (
    <aside className="mp-panel" id="mp-panel" aria-label={t("Kameralar paneli")}>
      <div className="mp-panel__grip" aria-hidden="true" />
      <div className="mp-panel__head">
        <h1 className="heading-md ellipsis">{t("Oʻzbekiston xaritasi")}</h1>
        <button type="button" className="icon-btn icon-btn--sm" id="mp-collapse" data-tip={collapseTip} aria-label={t(collapseTip)}
          aria-controls="mp-panel" aria-expanded={!m.collapsed} onClick={() => m.setCollapsed(!m.collapsed, true)}>
          <Icon name="sidebar" size="sm" />
        </button>
      </div>
      <label className={cx("search", m.q && "is-filled")} id="mp-search">
        <IconSpan name="search" />
        <input ref={inputRef} type="search" id="q-list" placeholder={t("Kamera, km yoki hudud")} autoComplete="off" spellCheck={false}
          aria-label={t("Qidiruv: kamera, km yoki hudud")} value={m.q} onChange={(e) => m.setQuery(e.target.value)} onKeyDown={onSearchKey} />
        <button type="button" className="search__clear" id="mp-search-clear" aria-label={t("Qidiruvni tozalash")} onClick={clearQ}>
          <Icon name="xmark" size="sm" />
        </button>
        <span className="kbd" aria-hidden="true">/</span>
      </label>
      {m.pollFails >= 2 && <ConnAlert />}
      <div className="seg" id="mp-tabs" role="tablist" aria-label={t("Koʻrinish")}>
        {([["cams", "Kameralar"], ["regs", "Hududlar"], ["grps", "Guruhlar"]] as [ListView, string][]).map(([v, label]) => (
          <button key={v} type="button" role="tab" data-lview={v} className={cx(m.listView === v && "is-on", v === "grps" && "auth-only")}
            aria-selected={m.listView === v} onClick={() => m.setView(v)}>
            {t(label)} <span className="seg__count">{m.loaded ? (tabCounts[v] ?? "") : ""}</span>
          </button>
        ))}
      </div>
      <div className="chips" id="mp-chips" role="group" aria-label={t("Holat filtri")} hidden={m.loaded && !!q}>
        {m.loaded ? <Chips /> : skeleton ? [0, 1, 2].map((i) => <span key={i} className="skeleton mp-sk-chip" />) : null}
      </div>
      <div className="mp-divider" id="mp-divider" hidden={noResults} />
      {!m.loaded ? (
        skeleton ? (
          <ListHead title="Hududlar" tip="Hududlar uzilganlar soni boʻyicha saralangan.">
            <button type="button" className="btn btn--tertiary btn--sm" disabled>{t("Hammasini ochish")}</button>
          </ListHead>
        ) : <div className="mp-listhead" id="mp-listhead" />
      ) : null}
      {m.loaded && q && results && (
        results.total ? <ListHead title={results.total + " natija"} tip="Mos qism ajratib koʻrsatiladi. ↑↓ — tanlash, Enter — xaritada markazlash." />
          : <div className="mp-listhead" id="mp-listhead" />
      )}
      {m.loaded && !q && m.listView === "cams" && <CamsHead />}
      {m.loaded && !q && m.listView === "regs" && <RegsHead />}
      {m.loaded && !q && m.listView === "grps" && <GroupsHead />}
      <div className="mp-list" id="list-body" aria-live="polite" ref={bodyRef} onMouseOver={onOver} onMouseLeave={onLeave}>
        {!m.loaded ? (skeleton ? <SkeletonList /> : null)
          : q && results ? (
            results.total ? <Results r={results} q={q} nav={nav} onActivate={activateRow} />
              : <EmptyState type="search" title="Hech narsa topilmadi" text={"“" + q + "” boʻyicha kamera, km yoki hudud yoʻq"}
                action="Qidiruvni tozalash" onAction={clearQ} />
          )
          : m.listView === "regs" ? <RegionsFlat onEmpty={clearFilters} />
          : m.listView === "grps" ? <GroupList />
          : <CamsByRegion onRow={onCamRow} onEmpty={clearFilters} />}
      </div>
      {m.pickMode && (
        <div className="mp-pickbar" id="pick-bar">
          <span className="label-sm" id="pick-bar-n">{t(m.pickIds.size + " ta tanlandi")}</span>
          <span className="spacer" />
          <Button size="sm" variant="secondary" id="pick-bar-clear" onClick={() => m.setPickMode(false)}>{t("Bekor qilish")}</Button>
          <Button size="sm" variant="primary" id="pick-bar-add" disabled={!m.pickIds.size}
            onClick={() => { if (m.pickIds.size) m.openGroupPicker([...m.pickIds], ""); }}>{t("Guruhga qoʻshish")}</Button>
        </div>
      )}
      <Foot />
    </aside>
  );
}

/* ---------- Alert "Server bilan aloqa yoʻq" (02.09) ---------- */
function ConnAlert() {
  const t = useT();
  const m = useMap();
  const [busy, setBusy] = useState(false);
  return (
    <div className="alert alert--error mp-alert" id="mp-alert" role="alert">
      <IconSpan name="triangle-exclamation" size="sm" />
      <div className="alert__body">
        <span className="alert__title">{t("Server bilan aloqa yoʻq")}</span>
        <span className="alert__text" id="mp-alert-text">{t("Maʼlumotlar " + (m.camsAt ? hms(m.camsAt) : "—") + " holatida")}</span>
      </div>
      <button type="button" className="btn btn--tertiary btn--sm" id="mp-alert-retry" disabled={busy}
        onClick={() => { setBusy(true); m.retry().finally(() => setBusy(false)); }}>{t("Qayta urinish")}</button>
    </div>
  );
}

/* ---------- FilterChip'lar ---------- */
function Chips() {
  const t = useT();
  const m = useMap();
  const g = m.groupFilter != null ? m.groupsById.get(m.groupFilter) : undefined;
  const cnt = useMemo(() => {
    const base = g ? m.cameras.filter((c) => g.camera_ids.includes(c.id)) : m.cameras;
    return { "": base.length, ...countStates(base) };
  }, [m.cameras, g]);
  return (
    <>
      {CHIPS.map(({ key, label }) => {
        const on = key ? m.filters.has(key) : !m.filters.size;
        return (
          <button key={key || "all"} type="button" className={cx("chip", on && "is-on")} data-f={key} aria-pressed={on} onClick={() => m.toggleFilter(key)}>
            {key && <span className="dot" data-status={key} />}{t(label)} <span className="chip__count">{cnt[key]}</span>
          </button>
        );
      })}
      {g && (
        <button type="button" className="chip is-on mp-chip-group" data-f="group" data-tip="Guruh filtrini olib tashlash" onClick={() => m.setGroupFilter(null)}>
          <span className="dot" style={{ background: colorOf(g) }} />
          <span className="ellipsis">{g.name}</span><Icon name="xmark" size="xs" />
        </button>
      )}
    </>
  );
}

/* ---------- Kameralar (hududlar bo'yicha) ---------- */
function useRegions() {
  const m = useMap();
  return useMemo(() => groupByRegion(m.visible), [m.visible]);
}

function CamsHead() {
  const t = useT();
  const m = useMap();
  const regions = useRegions();
  const focus = m.focus ? regions.find((r) => r.key === m.focus && m.openRegions[r.key]) : undefined;
  if (focus) {
    return (
      <ListHead title={t(focus.name) + " · " + focus.items.length + " kamera"}
        tip="Hudud ichidagi kameralar. Qator bosilsa — xaritada markazlanadi va tafsilotlar ochiladi.">
        <button type="button" className="btn btn--tertiary btn--sm" data-act="all-regions" onClick={() => {
          m.setFocus(null);
          m.setOpenRegions(() => ({}));
          m.ctl?.setFocusRegion(null);
          m.ctl?.fitCams(m.visible, {}, m.padTL());
        }}>{t("Barcha hududlar")}</button>
      </ListHead>
    );
  }
  const anyClosed = regions.some((r) => !m.openRegions[r.key]);
  return (
    <ListHead title={regions.length + " hudud"} tip="Hududlar uzilganlar soni boʻyicha saralangan. Chap nuqta — hududdagi eng yomon holat.">
      {!!regions.length && (
        <button type="button" className="btn btn--tertiary btn--sm" data-act="expand" onClick={() => {
          const next: Record<string, boolean> = {};
          regions.forEach((r) => { next[r.key] = anyClosed; });
          m.setOpenRegions(() => next);
          m.setFocus(null);
          m.ctl?.setFocusRegion(null);
        }}>{t(anyClosed ? "Hammasini ochish" : "Hammasini yopish")}</button>
      )}
    </ListHead>
  );
}

function FilterEmpty({ onEmpty }: { onEmpty: () => void }) {
  return <EmptyState type="filter" title="Hech narsa topilmadi" text="Tanlangan filtrga mos kamera yoʻq" action="Filtrlarni tozalash" onAction={onEmpty} />;
}

function CamsByRegion({ onRow, onEmpty }: { onRow: (id: number) => void; onEmpty: () => void }) {
  const t = useT();
  const m = useMap();
  const regions = useRegions();
  const focus = m.focus ? regions.find((r) => r.key === m.focus && m.openRegions[r.key]) : undefined;
  if (!regions.length) return <FilterEmpty onEmpty={onEmpty} />;

  const toggle = (r: RegionInfo) => {
    const open = !m.openRegions[r.key];
    m.setOpenRegions((o) => ({ ...o, [r.key]: open }));
    if (open) { m.setFocus(r.key); m.flyToRegion(r); }
    else if (m.focus === r.key) { m.setFocus(null); m.ctl?.setFocusRegion(null); }
  };
  const pickRegion = (r: RegionInfo) => {
    const all = r.items.every((c) => m.pickIds.has(c.id));
    const next = new Set(m.pickIds);
    r.items.forEach((c) => { if (all) next.delete(c.id); else next.add(c.id); });
    m.setPickIds(next);
    m.setOpenRegions((o) => ({ ...o, [r.key]: true }));
  };

  return (
    <>
      {regions.map((r) => {
        const open = !!m.openRegions[r.key];
        const pickAll = m.pickMode ? r.items.every((c) => m.pickIds.has(c.id)) : false;
        return (
          <div key={r.key} className={cx("mp-reg", open && "is-open", focus && focus.key === r.key && "is-sel")} data-key={r.key}>
            <div className="mp-reg__head">
              {m.pickMode && (
                <input type="checkbox" className="check mp-reg__pick" checked={pickAll} aria-label={t("Hududdagi hammasini belgilash")}
                  onChange={() => pickRegion(r)} />
              )}
              <button type="button" className="mp-rrow" data-act="toggle" aria-expanded={open} onClick={() => toggle(r)}>
                <span className="mp-rrow__chev"><Icon name="chevron-right" size="sm" /></span>
                <span className="dot" data-status={r.worst} />
                <span className="mp-rrow__txt">
                  <span className="label-md ellipsis mp-rrow__name">{t(r.name)}</span>
                  <span className="body-xs t-tertiary">{t(regionMeta(r))}</span>
                </span>
                <Counts n={r.n} />
              </button>
            </div>
            <div className="mp-cams">{open && <CamRows items={r.items} onRow={onRow} />}</div>
          </div>
        );
      })}
    </>
  );
}

function CamRows({ items, onRow }: { items: Camera[]; onRow: (id: number) => void }) {
  const t = useT();
  const m = useMap();
  return (
    <>
      {items.map((c) => {
        const st = camStatus(c);
        const meta = camMeta(c);
        const picked = m.pickMode && m.pickIds.has(c.id);
        return (
          <button key={c.id} type="button" className={cx("mp-crow", c.id === m.selectedId && "is-sel", picked && "is-picked")}
            data-id={c.id} data-tip={c.state_reason || undefined} onClick={() => onRow(c.id)}>
            {m.pickMode && <span className="mp-crow__pick" aria-hidden="true"><Icon name="check" size="xs" /></span>}
            <span className="dot" data-status={st} aria-label={t(STATUS_LABEL[st])} />
            <span className="label-sm ellipsis mp-crow__name">{c.name}</span>
            <span className={cx("mono-xs mp-crow__meta", meta.bad ? "t-error" : meta.warn && "t-warning")}>{t(meta.text)}</span>
          </button>
        );
      })}
    </>
  );
}

/* ---------- Hududlar (yassi) ---------- */
function RegsHead() {
  const regions = useRegions();
  return <ListHead title={regions.length + " hudud"} tip="Hudud bosilsa — xarita shu hududga yaqinlashadi. Saralash: uzilganlar soni boʻyicha." />;
}

function RegionsFlat({ onEmpty }: { onEmpty: () => void }) {
  const t = useT();
  const m = useMap();
  const regions = useRegions();
  if (!regions.length) return <FilterEmpty onEmpty={onEmpty} />;
  return (
    <>
      {regions.map((r) => {
        const pct = r.items.length ? Math.round((r.n.online / r.items.length) * 100) : 0;
        return (
          <button key={r.key} type="button" className={cx("mp-rrow mp-rrow--flat", m.focus === r.key && "is-sel")} data-act="fly" data-key={r.key}
            onClick={() => { m.setFocus(r.key); m.flyToRegion(r); }}>
            <span className="dot" data-status={r.worst} />
            <span className="mp-rrow__txt">
              <span className="label-md ellipsis mp-rrow__name">{t(r.name)}</span>
              <span className="body-xs t-tertiary">{t(regionMeta(r) + " · " + pct + "% onlayn")}</span>
            </span>
            <Counts n={r.n} />
            <Icon name="chevron-right" size="sm" className="mp-rrow__go" />
          </button>
        );
      })}
    </>
  );
}

/* ---------- 02.04 qidiruv natijalari ---------- */
function Results({ r, q, nav, onActivate }: { r: SearchResults; q: string; nav: number; onActivate: (el: HTMLElement) => void }) {
  const t = useT();
  const m = useMap();
  let i = -1;
  const act = () => { i++; return i === nav ? " is-active" : ""; };
  const click = (e: MouseEvent<HTMLButtonElement>) => onActivate(e.currentTarget);
  return (
    <>
      {!!r.camHits.length && (
        <>
          <div className="overline mp-res__h">{t("Kameralar · " + r.camHits.length)}</div>
          {r.camHits.slice(0, RES_LIMIT).map((c) => {
            const st = camStatus(c);
            const meta = camMeta(c);
            return (
              <button key={c.id} type="button" className={"mp-crow mp-crow--res" + (c.id === m.selectedId ? " is-sel" : "") + act()}
                data-nav="" data-id={c.id} onClick={click}>
                <span className="dot" data-status={st} />
                <span className="label-sm ellipsis mp-crow__name"><Hl text={c.name} q={q} /></span>
                <span className={cx("mono-xs mp-crow__meta ellipsis", meta.bad ? "t-error" : meta.warn && "t-warning")}>
                  {t([c.region, meta.text].filter(Boolean).join(" · "))}
                </span>
              </button>
            );
          })}
          {r.camHits.length > RES_LIMIT && (
            <div className="body-xs t-tertiary mp-res__more">{t("va yana " + (r.camHits.length - RES_LIMIT) + " ta — qidiruvni aniqlashtiring")}</div>
          )}
        </>
      )}
      {!!r.kmMap.size && (
        <>
          <div className="overline mp-res__h">{t("Km / piket · " + r.kmMap.size)}</div>
          {[...r.kmMap.entries()].slice(0, RES_LIMIT).map(([km, list]) => (
            <button key={km} type="button" className={"mp-crow mp-crow--res mp-crow--plain" + act()} data-nav="" data-km={km} onClick={click}>
              <span className="label-sm ellipsis mp-crow__name"><Hl text={km + " km"} q={q} /></span>
              <span className="mono-xs mp-crow__meta ellipsis">{t([...new Set(list.map((c) => c.region))].join(", ") + " · " + list.length + " kamera")}</span>
            </button>
          ))}
        </>
      )}
      {!!r.regions.length && (
        <>
          <div className="overline mp-res__h">{t("Hududlar · " + r.regions.length)}</div>
          {r.regions.map((g) => (
            <button key={g.key} type="button" className={"mp-crow mp-crow--res mp-crow--plain" + act()} data-nav="" data-reg={g.key} onClick={click}>
              <span className="dot" data-status={g.worst} />
              <span className="label-sm ellipsis mp-crow__name"><Hl text={g.name} q={q} /></span>
              <span className="mono-xs mp-crow__meta">{t(regionMeta(g))}</span>
            </button>
          ))}
        </>
      )}
    </>
  );
}

/* ---------- Guruhlar tabi (02.12) ---------- */
function GroupsHead() {
  const t = useT();
  const m = useMap();
  if (!m.authed) return <div className="mp-listhead" id="mp-listhead" />;
  return (
    <ListHead title={m.groups.length + " guruh"} tip="Guruh bosilsa — xarita va roʻyxatda faqat shu guruh kameralari. Yana bosilsa — filtr olinadi.">
      {m.canEdit && (
        <button type="button" className="btn btn--tertiary btn--sm" data-act="g-new" onClick={() => m.openGroupPicker([], "Yangi guruh")}>
          <Icon name="plus" size="sm" />{t("Yangi guruh")}
        </button>
      )}
    </ListHead>
  );
}

function GroupList() {
  const t = useT();
  const m = useMap();
  if (!m.authed) return <EmptyState type="nodata" title="Guruhlar" text="Guruhlar uchun tizimga kiring" />;
  const edit = m.canEdit;
  const onFilter = (g: Group) => {
    const off = m.groupFilter === g.id;
    if (!off) {
      // Guruh kameralari joylashgan hududlar ochiladi, ro'yxat "Kameralar" ga o'tadi.
      m.setOpenRegions((o) => {
        const n = { ...o };
        g.camera_ids.forEach((id) => { const c = m.byId.get(id); if (c) n[hasGeo(c) ? c.region : NOGEO] = true; });
        return n;
      });
      m.setView("cams");
    }
    m.setGroupFilter(off ? null : g.id);
  };
  return (
    <>
      {edit && (
        <div className="mp-gtools">
          <button type="button" className="btn btn--secondary btn--sm" data-act="g-pick" onClick={() => m.setPickMode(true)}>
            <Icon name="list" size="sm" />{t("Roʻyxatdan tanlash")}
          </button>
          <button type="button" className={cx("btn btn--secondary btn--sm", m.lassoOn && "is-on")} data-act="g-lasso" onClick={() => m.setLasso(!m.lassoOn)}>
            <Icon name="draw-polygon" size="sm" />{t("Xaritada belgilash")}
          </button>
        </div>
      )}
      {!m.groups.length ? (
        <EmptyState type="nodata" title="Hali guruh yoʻq" text="Kameralarni roʻyxatdan yoki xaritadan belgilab guruh yarating"
          action={edit ? "Yangi guruh" : ""} primary onAction={() => m.openGroupPicker([], "Yangi guruh")} />
      ) : m.groups.map((g) => {
        const cams = g.camera_ids.map((id) => m.byId.get(id)).filter((c): c is Camera => !!c);
        const n = countStates(cams);
        const who = g.mine ? (g.shared ? "umumiy" : "shaxsiy") : (g.owner_name || "") + " · umumiy";
        const sel = m.groupFilter === g.id;
        return (
          <div key={g.id} className={cx("mp-grow", sel && "is-sel")}>
            <button type="button" className="mp-rrow mp-rrow--flat" data-act="g-filter" aria-pressed={sel} onClick={() => onFilter(g)}>
              <span className="mp-gdot" style={{ background: colorOf(g) }} />
              <span className="mp-rrow__txt">
                <span className="label-md ellipsis mp-rrow__name">{g.name}</span>
                <span className="body-xs t-tertiary ellipsis">{t(cams.length + " kamera · " + who + (g.hidden ? " · " + g.hidden + " ta yashirin" : ""))}</span>
              </span>
              <span className="mp-counts">
                <span className="badge badge--count" data-status="online">{n.online}</span>
                {!!n.offline && <span className="badge badge--count" data-status="offline">{n.offline}</span>}
              </span>
            </button>
            <span className="mp-grow__acts">
              <button type="button" className="icon-btn icon-btn--sm" data-tip="Video devorda ochish" aria-label={t("Video devorda ochish")}
                onClick={() => m.openGroupOnWall(g)}><Icon name="grid" size="sm" /></button>
              {g.can_edit && edit && (
                <button type="button" className="icon-btn icon-btn--sm" data-tip="Tahrirlash" aria-label={t("Tahrirlash")}
                  onClick={() => m.openGroupEditor(g)}><Icon name="pen" size="sm" /></button>
              )}
            </span>
          </div>
        );
      })}
    </>
  );
}

/* ---------- Skeleton (02.07) ---------- */
function SkeletonList() {
  const op = [1, 0.88, 0.76, 0.64, 0.52, 0.4];
  return (
    <>
      {op.map((o, i) => (
        <div key={i} className="mp-sk-row" style={{ opacity: o }}>
          <span className="skeleton mp-sk-dot" />
          <span className="mp-sk-lines">
            <span className="skeleton" style={{ width: 120 + ((i * 23) % 40), height: 12 }} />
            <span className="skeleton" style={{ width: 80, height: 10 }} />
          </span>
          <span className="skeleton mp-sk-pill" />
        </div>
      ))}
    </>
  );
}

/* ---------- Footer: "Yangilandi HH:MM:SS · har N s" ---------- */
function Foot() {
  const t = useT();
  const m = useMap();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) tick((x) => x + 1); }, 15000);
    return () => clearInterval(id);
  }, []);
  const every = m.pollS || 30;
  let dot: string, text: string;
  if (!m.loaded) { dot = "unknown"; text = "Yuklanmoqda…"; }
  else if (m.pollFails >= 2) { dot = "offline"; text = "Ulanish yoʻq · oxirgi " + (m.camsAt ? hms(m.camsAt) : "—"); }
  else { dot = "online"; text = "Yangilandi " + (m.camsAt ? hms(m.camsAt) : "—") + " · har " + every + " s"; }
  return (
    <div className="mp-foot" id="mp-foot">
      <span className={cx("mp-foot__dot", dot === "online" && "pulse")} data-status={dot} />
      <span className="body-xs t-tertiary">{t(text)}</span>
      <InfoTip text={"Holat har " + every + " soniyada yangilanadi (Sozlamalar → Kuzatuv). Aloqa uzilsa nuqta qizil boʻladi."} />
    </div>
  );
}
