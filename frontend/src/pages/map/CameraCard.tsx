/* pages/map/CameraCard.tsx — Map/CameraPopover (Figma 125:263, 02.24), v3 selection.js kartasi.
   Marker bosilsa → markerdan 12px yuqorida kichik karta: avval oxirgi kadr (snapshot), so'ng
   jonli oqim (past sifatli 2-oqim, "sub") kadr ustiga chiqadi va JONLI belgisi faqat shunda
   yonadi. Kadr bosilsa — oqim (qayta) ochiladi; jonli ketayotganda — batafsil (drawer).
   Nom + StatusBadge, meta, "Batafsil", devorga qo'shish, to'liq ekran, yopish.
   Tashqariga click / Esc / × yopadi (MapPage). Komponent doim joyida (pleyer ref'lari uchun) — hidden. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import { Icon } from "@/components/Icon";
import { cx } from "@/components/ui";
import { usePlayer } from "@/player/usePlayer";
import { useMap } from "./model";
import { STATUS_LABEL, camStatus, camSub, fmtAgo, fmtCodec, fmtRes, hasGeo, hms } from "./util";

type PrevState = "load" | "snap" | "off" | "off-img" | "playing";

export function CameraCard({ onFullscreen }: { onFullscreen: (id: number) => void }) {
  const t = useT();
  const m = useMap();
  const id = m.cardId;
  const cam = id != null ? m.byId.get(id) || null : null;
  const st = cam ? camStatus(cam) : "unknown";
  const cardRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  const [pstate, setPstate] = useState<PrevState>("load");
  const [snap, setSnap] = useState<string | null>(null);
  const [time, setTime] = useState("");
  const [offText, setOffText] = useState("");
  const [manual, setManual] = useState(false);
  const player = usePlayer(live ? cam : null, { quality: "sub", enabled: live && id != null });
  const idRef = useRef(id);
  idRef.current = id;
  const pstateRef = useRef(pstate);
  pstateRef.current = pstate;

  /* Yangi kamera: oxirgi kadr + (uzilgan bo'lmasa) jonli oqim. */
  useEffect(() => {
    setManual(false);
    if (id == null || !cam) { setLive(false); return; }
    const off = camStatus(cam) === "offline";
    setPstate(off ? "off" : "load");
    setOffText(off ? "Oqim yoʻq · " + fmtAgo(cam.last_seen).replace("oldin", "oldin uzildi") : "");
    setTime("");
    setSnap(null);
    setLive(!off);
    let url: string | null = null;
    let alive = true;
    fetch("/api/cameras/" + cam.id + "/snapshot" + (off ? "?stale=1" : ""), { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const at = r.headers.get("X-Snapshot-At");
        const blob = await r.blob();
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setSnap(url);
        // Jonli oqim allaqachon kelgan bo'lsa — holat o'zgarmaydi.
        if (pstateRef.current !== "playing") {
          setPstate(off ? "off-img" : "snap");
          setTime(hms(at ? new Date(isNaN(Number(at)) ? at : Number(at) * 1000) : new Date()));
        }
      })
      .catch(() => {
        if (!alive) return;
        setPstate("off");
        setOffText((x) => x || "Kadr yoʻq");
      });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Oqim kelgach: video kadr ustiga chiqadi, JONLI va vaqt. */
  // Faqat holat o'zgarganda (kamera almashganda eski "playing" hisobga olinmaydi).
  useEffect(() => {
    if (player.status === "playing" && idRef.current != null) { setPstate("playing"); setTime(hms(new Date())); }
  }, [player.status]);

  /* Joylashuv: marker ustida (tanlangan marker 40px → markazdan 20 + 12). */
  const place = () => {
    const el = cardRef.current;
    const c = m.ctl;
    if (!el || !c || id == null || !cam || !hasGeo(cam) || el.hidden) return;
    const map = c.map;
    const p = map.latLngToContainerPoint([cam.lat, cam.lng]);
    const size = map.getSize();
    const w = el.offsetWidth, h = el.offsetHeight;
    const below = p.y - 32 - h < 8;
    const top = below ? p.y + 32 : p.y - 32 - h;
    const left = Math.max(8, Math.min(size.x - w - 8, p.x - w / 2));
    el.classList.toggle("is-below", below);
    el.style.transform = "translate(" + Math.round(left) + "px," + Math.round(top) + "px)";
    el.style.setProperty("--ptr-x", Math.max(16, Math.min(w - 16, p.x - left)) + "px");
    const outside = p.x < -40 || p.y < -40 || p.x > size.x + 40 || p.y > size.y + 40;
    el.classList.toggle("is-out", outside);
  };
  const placeRef = useRef(place);
  placeRef.current = place;
  useLayoutEffect(() => { place(); });

  useEffect(() => {
    const c = m.ctl;
    if (!c) return;
    const map = c.map;
    const onMove = () => placeRef.current();
    const zs = () => { if (cardRef.current && !cardRef.current.hidden) cardRef.current.classList.add("is-moving"); };
    const ze = () => { cardRef.current?.classList.remove("is-moving"); placeRef.current(); };
    map.on("move zoom viewreset", onMove);
    map.on("zoomstart", zs);
    map.on("zoomend", ze);
    addEventListener("resize", onMove);
    return () => {
      map.off("move zoom viewreset", onMove);
      map.off("zoomstart", zs);
      map.off("zoomend", ze);
      removeEventListener("resize", onMove);
    };
  }, [m.ctl]);

  const onPrev = () => {
    if (id == null) return;
    if (pstate === "playing") { m.closeCard(false); m.selectCamera(id, false); return; }
    setManual(true);
    if (live) player.retry(); else setLive(true);
  };

  const connecting = player.status === "wait" || (manual && pstate !== "playing" && player.status !== "fail");
  const failed = player.status === "fail";
  const playing = pstate === "playing";

  return (
    <div className={cx("mp-card")} id="mp-card" role="dialog" aria-labelledby="mc-name" hidden={id == null} ref={cardRef}>
      <button type="button" className={cx("mp-prev", connecting && "is-connecting", failed && "is-failed")} id="mc-prev"
        data-state={pstate} aria-label={t(playing ? "Batafsil" : "Jonli koʻrish")} onClick={onPrev}>
        <img alt="" src={snap || undefined} />
        <video id="mc-video" ref={player.videoRef} muted playsInline />
        <span className="mp-prev__msg label-xs" id="mc-msg" ref={player.msgRef} />
        <span className="mp-prev__scrim" />
        <span className="mp-prev__live"><span className="mp-livedot" />{t("JONLI")}</span>
        <span className="mp-prev__time mono-xs">{time}</span>
        <span className="mp-prev__off"><span><Icon name="camera-slash" size="lg" /></span><span className="mp-prev__off-t label-sm">{t(offText)}</span></span>
        <span className="mp-prev__spin spinner" />
        <span className="mp-prev__bar"><span className="mono-xs" id="mc-fmt">{cam ? [fmtCodec(cam.codec), fmtRes(cam.resolution)].filter(Boolean).join(" · ") || "—" : ""}</span></span>
      </button>
      <div className="mp-card__body">
        <div className="mp-card__row">
          <span className="label-md ellipsis" id="mc-name">{cam?.name}</span>
          <span className="badge" id="mc-badge" data-status={st}><span className="dot" data-status={st} />{t(STATUS_LABEL[st])}</span>
          <span className="spacer" />
          <button type="button" className="icon-btn icon-btn--sm" id="mc-close" data-tip="Yopish" aria-label={t("Yopish")}
            onClick={() => m.closeCard(true)}><Icon name="xmark" size="sm" /></button>
        </div>
        <div className="body-xs t-tertiary ellipsis" id="mc-meta">{cam ? t([camSub(cam), fmtCodec(cam.codec)].filter(Boolean).join(" · ") || "—") : ""}</div>
        <div className="mp-card__actions">
          <button type="button" className="btn btn--primary btn--sm mp-card__more" id="mc-more"
            onClick={() => { if (id == null) return; m.closeCard(false); m.selectCamera(id, false); }}>{t("Batafsil")}</button>
          <button type="button" className="icon-btn icon-btn--sm icon-btn--secondary" id="mc-wall" data-tip="Video devorga qoʻshish"
            aria-label={t("Video devorga qoʻshish")} onClick={() => m.toWall(id)}><Icon name="grid" size="sm" /></button>
          <button type="button" className="icon-btn icon-btn--sm icon-btn--secondary" id="mc-full" data-tip="Toʻliq ekran"
            aria-label={t("Toʻliq ekran")} onClick={() => {
              if (id != null) onFullscreen(id);
            }}><Icon name="maximize" size="sm" /></button>
        </div>
      </div>
      <span className="mp-card__ptr" aria-hidden="true" />
    </div>
  );
}
