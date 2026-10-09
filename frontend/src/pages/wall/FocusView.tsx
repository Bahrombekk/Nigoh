/* pages/wall/FocusView.tsx — Fokus rejimi (Figma 04.02, `#/wall/focus`; v3 wall/focus.js).
   Bitta kamera katta (asosiy oqim) + yonida devor tartibidagi keyingi 3 ta (past oqim),
   pastda 4 KpiTile: Ochilish vaqti, Kodek, Ishlash ulushi, Uzilishlar.
   ←/→ va Esc — WallPage (devor tartibi o'sha yerda). Kamera almashganda asosiy katak
   qayta yaratiladi (key = id), KPI so'rovi eskisini tashlaydi (queryKey = id). */
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { IconButton, InfoTip } from "@/components/ui";
import { useT } from "@/i18n/I18nProvider";
import { camStatus, STATUS_LABEL, type Camera } from "@/lib/types";
import { openTimes } from "@/player/openTimes.js";
import { WallTile, fmtCodec, fmtSec } from "./WallTile";
import { useFocusKpis } from "./queries";

const NEXT_COUNT = 3;

const pct = (v: number | null | undefined) =>
  v == null ? "—" : (Math.round(v * 10) / 10).toFixed(1).replace(".", ",").replace(/,0$/, "") + "%";

/* "2560x1440" → "1440p" */
function fmtRes(res: string | null | undefined) {
  const m = String(res || "").match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
  return m ? m[2] + "p" : "";
}

export function FocusView({ cam, list, onShow, onExit, onShot, onMap }: {
  cam: Camera;
  /** Devor tartibidagi kameralar (keyingilar shu ro'yxatdan, aylana) */
  list: Camera[];
  onShow: (id: number) => void;
  onExit: () => void;
  onShot: (cam: Camera) => void;
  onMap: (cam: Camera) => void;
}) {
  const t = useT();
  const mainEl = useRef<HTMLDivElement | null>(null);
  const [localMs, setLocalMs] = useState<number | null>(null);
  const kpis = useFocusKpis(cam.id);
  useEffect(() => { setLocalMs(null); }, [cam.id]);

  // Keyingi kameralar — devor tartibida, aylana.
  const i = list.findIndex((c) => c.id === cam.id);
  const next: Camera[] = [];
  for (let k = 1; k < list.length && next.length < NEXT_COUNT; k++) {
    const c = list[(Math.max(i, 0) + k) % list.length];
    if (c.id !== cam.id) next.push(c);
  }

  const st = camStatus(cam);
  const k = kpis.data;
  const openMs = k?.server != null ? k.server : localMs != null ? localMs : (openTimes.byCam.get(cam.id) as number | undefined);
  const codec = fmtCodec(cam.codec) + (cam.transcode && /265/.test(cam.codec || "") ? " → H.264" : "");
  const codecMeta = [fmtRes(cam.resolution), cam.fps ? cam.fps + " fps" : ""].filter(Boolean).join(" · ");

  const fullscreen = () => {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    mainEl.current?.requestFullscreen?.().catch(() => {});
  };

  const tile = (label: string, tip: string, value: string, meta: string) => (
    <div className="kpi-tile wl-kpi" key={label}>
      <div className="kpi-tile__label">{t(label)}{tip && <><span className="spacer" /><InfoTip text={tip} /></>}</div>
      <div className="wl-kpi__row"><span className="kpi-tile__value">{t(value)}</span>
        {meta && <span className="kpi-tile__meta">{t(meta)}</span>}</div>
    </div>
  );

  return (
    <div className="wl-focus" id="wall-focus">
      <div className="wl-bar">
        <button type="button" className="btn btn--tertiary wl-back" id="wf-back" onClick={onExit}>
          <span><Icon name="chevron-left" /></span>{t("Video devorga qaytish")}
        </button>
        <h1 className="heading-lg ellipsis wl-focus__name" id="wf-name">{cam.name}</h1>
        <span className="badge" id="wf-status" data-status={st}><span className="dot" data-status={st} /><span>{t(STATUS_LABEL[st])}</span></span>
        <span className="spacer" />
        <IconButton icon="camera" tip="Suratni saqlash" variant="secondary" id="wf-shot" onClick={() => onShot(cam)} />
        <IconButton icon="location-crosshairs" tip="Xaritada koʻrsatish" variant="secondary" id="wf-map" onClick={() => onMap(cam)} />
        <button type="button" className="btn btn--secondary wl-fs" id="wf-fs" onClick={fullscreen}>
          <span><Icon name="maximize" /></span><span className="wl-fs__text">{t("Toʻliq ekran")}</span>
        </button>
      </div>
      <div className="wl-focus__body">
        <div className="wl-focus__main" id="wf-main">
          <WallTile key={cam.id} cam={cam} quality="" actions={false} main
            elRef={(el) => { mainEl.current = el; }} onOpenMs={(ms) => setLocalMs(ms)} />
        </div>
        <div className="wl-focus__side">
          <div className="overline">{t("Keyingi kameralar")}</div>
          <div className="wl-focus__next" id="wf-next">
            {next.map((c) => (
              <WallTile key={c.id} cam={c} quality="sub" onActivate={() => onShow(c.id)}
                onShot={onShot} onMap={onMap} onFocus={(x) => onShow(x.id)} />
            ))}
          </div>
        </div>
      </div>
      <div className="wl-kpis" id="wf-kpis">
        {tile("Ochilish vaqti", "Oqim bosilgandan birinchi kadr kelguncha ketgan vaqt", openMs != null ? fmtSec(openMs) : "—", "birinchi kadr")}
        {tile("Kodek", "", codec, codecMeta)}
        {tile("Ishlash ulushi", "Uptime — oxirgi 7 kunda kamera onlayn boʻlgan vaqt ulushi", pct(k?.uptime), "7 kun")}
        {tile("Uzilishlar", "", k?.outages == null ? "—" : String(k.outages), "bugun")}
      </div>
    </div>
  );
}
