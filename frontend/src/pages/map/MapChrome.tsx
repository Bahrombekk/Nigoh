/* pages/map/MapChrome.tsx — xarita ustidagi boshqaruvlar (v3 map/layers.js, map/tools.js):
     Toolbar     — "Temir yoʻllar", "Hudud chegaralari", "Barcha qatlamlar" (Map/Control) + <Sysbar/>
     LayersPopover (02.05) — LayerRow'lar (darhol qo'llanadi), Manba (Yangi · OSM / Eski), Sxema / Gibrid
     Legend      — Onlayn / Tasvirsiz / Uzilgan + "?" → to'liq shartli belgilar
     MapControls — Zoom + / −, Joylashuvim, Masofa oʻlchash, Toʻliq ekran
     ScaleBar    — masshtab chizig'i + kursor koordinatasi (bosilsa nusxalanadi)
     ModeBars    — o'lchash (02.17), lasso, joy tanlash izohlari */
import { Fragment, useEffect, useRef, useState } from "react";
import type L from "leaflet";
import { useT } from "@/i18n/I18nProvider";
import { Icon } from "@/components/Icon";
import { Button, cx } from "@/components/ui";
import { Popover, useToast } from "@/components/overlays";
import { Sysbar } from "@/layout/Sysbar";
import { fmtDist, iconHtml, type LayerState } from "./MapController";
import { useMap } from "./model";
import { IconSpan } from "./Panel";

/* ---------- Toolbar + Qatlamlar ---------- */
const ROWS: { key: "rail" | "regions" | "clusters"; icon: string; title: string; meta: string }[] = [
  { key: "rail", icon: "train", title: "Temir yoʻllar", meta: "Faol liniyalar" },
  { key: "regions", icon: "map", title: "Hudud chegaralari", meta: "Viloyatlar" },
  { key: "clusters", icon: "circle-nodes", title: "Kamera klasterlari", meta: "Uzoqlashtirilganda birlashadi" },
];

export function Toolbar({ layers, setLayer, railsOk, railSrc, hybridOk }: {
  layers: LayerState; setLayer: <K extends keyof LayerState>(k: K, v: LayerState[K]) => void;
  railsOk: boolean; railSrc: string; hybridOk: boolean | null;
}) {
  const t = useT();
  const [group, setGroup] = useState<HTMLDivElement | null>(null);
  const allRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ctl = (id: string, key: "rail" | "regions", icon: string, tip: string) => {
    const on = layers[key] !== false;
    return (
      <button type="button" className={cx("mp-ctl", on && "is-on")} id={id} data-tip={tip} data-tip-place="bottom" aria-label={t(tip)}
        aria-pressed={on} hidden={key === "rail" && !railsOk} onClick={() => setLayer(key, !on)}>
        <Icon name={icon} />
      </button>
    );
  };
  return (
    <div className="mp-toolbar" id="mp-toolbar">
      <div className="mp-ctlgroup" id="mp-layers" role="group" aria-label={t("Qatlamlar")} ref={setGroup}>
        {ctl("ly-rail", "rail", "train", "Temir yoʻllar")}
        {ctl("ly-regions", "regions", "map", "Hudud chegaralari")}
        <button ref={allRef} type="button" className="mp-ctl" id="ly-all" data-tip="Barcha qatlamlar" data-tip-place="bottom"
          aria-label={t("Barcha qatlamlar")} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Icon name="layer-group" />
        </button>
      </div>
      <Sysbar />
      {/* O'ng cheti toolbar guruhi bilan tekis (anchor — guruh; offset 7 = tugma tagidan 10px). */}
      <Popover anchor={group} open={open} onClose={close} place="bottom-end" offset={7} className="mp-lp-pop">
        <div className="mp-lp" role="dialog" aria-label={t("Qatlamlar")}>
          <div className="mp-lp__head">
            <span className="heading-sm">{t("Qatlamlar")}</span>
            <button type="button" className="icon-btn icon-btn--sm" data-tip="Yopish" aria-label={t("Yopish")}
              onClick={() => { close(); allRef.current?.focus(); }}><Icon name="xmark" size="sm" /></button>
          </div>
          {ROWS.map((r) => {
            const on = layers[r.key] !== false;
            return (
              <Fragment key={r.key}>
                <button type="button" className={cx("mp-lrow", on && "is-on")} role="switch" aria-checked={on} data-layer={r.key}
                  hidden={r.key === "rail" && !railsOk} onClick={() => setLayer(r.key, !on)}>
                  <span className="mp-lrow__ic"><Icon name={r.icon} /></span>
                  <span className="mp-lrow__txt"><span className="label-md">{t(r.title)}</span><span className="body-xs t-tertiary">{t(r.meta)}</span></span>
                  <span className="switch" aria-hidden="true" aria-checked={on} />
                </button>
                {r.key === "rail" && (
                  <div className="mp-lp__src" hidden={layers.rail === false || !railsOk}>
                    <span className="body-xs t-tertiary">{t("Manba")}</span>
                    <div className="seg seg--sm seg--inline">
                      <button type="button" data-src="v2" className={cx(railSrc === "v2" && "is-on")} onClick={() => setLayer("railSrc", "v2")}>{t("Yangi · OSM")}</button>
                      <button type="button" data-src="v1" className={cx(railSrc === "v1" && "is-on")} onClick={() => setLayer("railSrc", "v1")}>{t("Eski")}</button>
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
          <div className="mp-lp__sep" />
          <div className="mp-lp__type">
            <span className="label-sm t-secondary">{t("Xarita turi")}</span>
            <div className="seg seg--sm mp-lp__base">
              <button type="button" data-base="scheme" className={cx(layers.base !== "hybrid" && "is-on")} onClick={() => setLayer("base", "scheme")}>{t("Sxema")}</button>
              <button type="button" data-base="hybrid" className={cx(layers.base === "hybrid" && "is-on")} aria-disabled={!hybridOk}
                data-tip={!hybridOk ? "Sunʼiy yoʻldosh plitkalari serverda ruxsat etilmagan" : undefined}
                onClick={() => { if (hybridOk) setLayer("base", "hybrid"); }}>{t("Gibrid")}</button>
            </div>
          </div>
        </div>
      </Popover>
    </div>
  );
}

/* ---------- Map/LegendChip ---------- */
export function Legend() {
  const t = useT();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const mk = (st: string, ic: string) => (
    <span className="mp-lg__mk"><span className="mp-mk" data-status={st} dangerouslySetInnerHTML={{ __html: iconHtml(ic, "xs") }} /></span>
  );
  const item = (sym: React.ReactNode, text: string) => (
    <div className="mp-lg__row">{sym}<span className="body-sm t-secondary">{t(text)}</span></div>
  );
  return (
    <div className="mp-legend" id="mp-legend">
      <span className="mp-legend__i"><span className="dot" data-status="online" />{t("Onlayn")}</span>
      <span className="mp-legend__i"><span className="dot" data-status="no-video" />{t("Tasvirsiz")}</span>
      <span className="mp-legend__i"><span className="dot" data-status="offline" />{t("Uzilgan")}</span>
      <button ref={setAnchor} type="button" className="infotip" id="mp-legend-more" data-tip="Shartli belgilar" aria-label={t("Shartli belgilar")}
        aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}><Icon name="circle-question" size="sm" /></button>
      <Popover anchor={anchor} open={open} onClose={close} place="top-start" offset={10} className="mp-lp-pop">
        <div className="mp-lg" role="dialog" aria-label={t("Shartli belgilar")}>
          <div className="mp-lp__head">
            <span className="heading-sm">{t("Shartli belgilar")}</span>
            <button type="button" className="icon-btn icon-btn--sm" data-tip="Yopish" aria-label={t("Yopish")}
              onClick={() => { close(); anchor?.focus(); }}><Icon name="xmark" size="sm" /></button>
          </div>
          <div className="overline">{t("Kamera holati")}</div>
          {item(mk("online", "camera"), "Onlayn — oqim ochiladi, kadr keladi")}
          {item(mk("no-video", "camera"), "Tasvirsiz — port javob beradi, kadr yoʻq")}
          {item(mk("offline", "camera-slash"), "Uzilgan — port javob bermaydi")}
          {item(mk("disabled", "camera"), "Oʻchirilgan — kuzatilmaydi")}
          <div className="overline">{t("Xarita")}</div>
          {item(<span className="mp-lg__cl"><span className="mp-cl is-alert"><span className="mp-cl__n">12</span><span className="mp-cl__badge">3</span></span></span>,
            "Klaster: jami kamera · qizil — ichidagi uzilganlar")}
          {item(<span className="mp-lg__line mp-lg__line--rail" />, "Temir yoʻl")}
          {item(<span className="mp-lg__line mp-lg__line--region" />, "Hudud chegarasi")}
          {item(<span className="mp-lg__mask" />, "Oʻzbekiston tashqarisi")}
        </div>
      </Popover>
    </div>
  );
}

/* ---------- Map controls ---------- */
export function MapControls({ locate, fs, onFs }: { locate: "busy" | "on" | "off"; fs: boolean; onFs: () => void }) {
  const t = useT();
  const m = useMap();
  const btn = (id: string, icon: string, tip: string, onClick: () => void, extra: { cls?: string; pressed?: boolean } = {}) => (
    <button type="button" className={cx("mp-ctl", extra.cls)} id={id} data-tip={tip} aria-label={t(tip)}
      aria-pressed={extra.pressed} onClick={onClick}><Icon name={icon} /></button>
  );
  const fsTip = fs ? "Toʻliq ekrandan chiqish" : "Toʻliq ekran";
  return (
    <div className="mp-controls" id="mp-controls">
      <div className="mp-ctlgroup mp-ctlgroup--v" role="group" aria-label={t("Masshtab")}>
        {btn("z-in", "plus", "Yaqinlashtirish (+)", () => m.ctl?.map.zoomIn())}
        {btn("z-out", "minus", "Uzoqlashtirish (−)", () => m.ctl?.map.zoomOut())}
      </div>
      {btn("mp-locate", "location-crosshairs", "Joylashuvim (L)", () => m.ctl?.locate(),
        { cls: cx("mp-ctl--solo", locate === "busy" && "is-busy", locate === "on" && "is-on") })}
      {btn("mp-measure", "ruler", "Masofa oʻlchash", () => m.setMeasure(!m.measuring),
        { cls: cx("mp-ctl--solo", m.measuring && "is-on"), pressed: m.measuring })}
      {btn("mp-fs", fs ? "minimize" : "maximize", fsTip, onFs, { cls: cx("mp-ctl--solo", fs && "is-on") })}
    </div>
  );
}

/* ---------- Map/ScaleBar ---------- */
function niceNum(m: number) {
  const pow = Math.pow(10, Math.floor(Math.log10(m)));
  const d = m / pow;
  return pow * (d >= 5 ? 5 : d >= 3 ? 3 : d >= 2 ? 2 : 1);
}
function fmtCoord(ll: L.LatLng) {
  return Math.abs(ll.lat).toFixed(4) + "° " + (ll.lat >= 0 ? "N" : "S") + " · " +
    Math.abs(ll.lng).toFixed(4) + "° " + (ll.lng >= 0 ? "E" : "W");
}

export function ScaleBar() {
  const t = useT();
  const m = useMap();
  const toast = useToast();
  const [scale, setScale] = useState<{ w: number; label: string }>({ w: 64, label: "100 km" });
  const coordRef = useRef<HTMLButtonElement>(null);
  const cursor = useRef<L.LatLng | null>(null);
  const ctl = m.ctl;

  useEffect(() => {
    if (!ctl) return;
    const map = ctl.map;
    const paint = () => {
      const ll = cursor.current || map.getCenter();
      if (coordRef.current) coordRef.current.textContent = fmtCoord(ll);
    };
    const update = () => {
      const y = map.getSize().y / 2;
      const maxPx = 80;
      const a = map.containerPointToLatLng([0, y]);
      const b = map.containerPointToLatLng([maxPx, y]);
      const meters = map.distance(a, b);
      if (!meters || !isFinite(meters)) return;
      const nice = niceNum(meters);
      setScale({ w: Math.round((maxPx * nice) / meters), label: nice >= 1000 ? nice / 1000 + " km" : nice + " m" });
      paint();
    };
    const move = (e: L.LeafletMouseEvent) => { cursor.current = e.latlng; paint(); };
    const leave = () => { cursor.current = null; paint(); };
    map.on("zoomend moveend resize", update);
    map.on("mousemove", move);
    const el = map.getContainer();
    el.addEventListener("mouseleave", leave);
    update();
    return () => {
      map.off("zoomend moveend resize", update);
      map.off("mousemove", move);
      el.removeEventListener("mouseleave", leave);
    };
  }, [ctl]);

  const copy = () => {
    if (!ctl) return;
    const ll = cursor.current || ctl.map.getCenter();
    const text = ll.lat.toFixed(6) + ", " + ll.lng.toFixed(6);
    const done = () => toast("Koordinata nusxalandi: " + text, { tone: "success" });
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => toast(text, { tone: "info" }));
    else toast(text, { tone: "info" });
  };

  return (
    <div className="mp-scale" id="mp-scale">
      <span className="mp-scale__bar" id="mp-scale-bar" style={{ width: scale.w }} />
      <span className="label-2xs mp-scale__label" id="mp-scale-label">{t(scale.label)}</span>
      <button type="button" className="mono-xs mp-scale__coord" id="mp-scale-coord" data-tip="Bosing — koordinata nusxalanadi"
        aria-label={t("Bosing — koordinata nusxalanadi")} ref={coordRef} onClick={copy} />
    </div>
  );
}

/* ---------- Rejim izohlari ---------- */
export function ModeBars({ measurePts }: { measurePts: L.LatLng[] }) {
  const t = useT();
  const m = useMap();
  let total = 0;
  if (m.ctl) for (let i = 1; i < measurePts.length; i++) total += m.ctl.map.distance(measurePts[i - 1], measurePts[i]);
  const n = measurePts.length;
  return (
    <>
      <div className="mp-modebar" id="mp-measure-bar" hidden={!m.measuring}>
        <IconSpan name="ruler" size="sm" />
        <span className="mp-modebar__txt">
          <span className="label-sm" id="mp-measure-total">{t(n > 1 ? fmtDist(total) : n ? "Keyingi nuqtani bosing" : "Xaritada boshlangʻich nuqtani bosing")}</span>
          <span className="body-xs t-tertiary" id="mp-measure-n">{n > 1 ? t(n - 1 + " boʻlak") : ""}</span>
        </span>
        <Button size="sm" variant="tertiary" id="mp-measure-clear" disabled={!n} onClick={() => m.ctl?.clearMeasure()}>{t("Tozalash")}</Button>
        <Button size="sm" variant="primary" id="mp-measure-done" onClick={() => m.setMeasure(false)}>{t("Tugatish")}</Button>
      </div>
      <div className="mp-modebar" id="lasso-hint" hidden={!m.lassoOn}>
        <IconSpan name="draw-polygon" size="sm" />
        <span className="mp-modebar__txt"><span className="label-sm">{t("Kameralar atrofini chizing")}</span><span className="body-xs t-tertiary">{t("Esc — bekor qilish")}</span></span>
        <Button size="sm" variant="tertiary" id="lasso-cancel" onClick={() => m.setLasso(false)}>{t("Bekor qilish")}</Button>
      </div>
      <div className="mp-modebar mp-pickhint" id="pick-hint">
        <IconSpan name="map-pin" size="sm" />
        <span className="label-sm">{t("Xaritada kerakli nuqtani bosing — koordinata shaklga tushadi")}</span>
      </div>
    </>
  );
}
