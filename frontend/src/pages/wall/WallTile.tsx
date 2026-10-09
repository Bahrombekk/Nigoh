/* pages/wall/WallTile.tsx — Video/Tile (Figma 60:69): devor va Fokus katagi (v3 wall/tile.js).
   Kadr (oqim), ustki/ostki scrim, holat nuqtasi + nom + hudud, "JONLI" belgisi, pastda
   "kodek · ochilish vaqti". Holatlar (data-state): connecting (spinner + "Ulanmoqda…";
   3 s dan keyin "Qayta urinish"), live, offline ("Uzilgan · 10 daq oldin" + "Qayta ulash"),
   fail (oqim ochilmadi — 3 s dan keyin bir marta o'zi qayta urinadi, keyin "Qayta ulash").
   Hover: Surat · Xaritada · Fokus amallari + ko'k chegara (CSS).

   Pleyer — usePlayer emas, to'g'ridan-to'g'ri createPlayer: v3 dagi holat mashinasi
   (kechiktirilgan "Qayta urinish", bir martalik avto-qayta urinish, uzilgan kamerada pleyer
   yaratilmasligi, sifat almashganda qayta ochish) aynan saqlanadi.
   Qoidalar:
     - quality: "" — asosiy oqim, "sub" — past (Player.open ga shu holicha).
     - staged — keyingi sahifa uchun oldindan ochilgan, ko'rinmas katak (CSS .is-staged);
       devorga o'tganda <video> qayta play() qilinadi (DOM'da ko'chirilgan video to'xtaydi).
     - Komponent yopilsa pleyer to'xtaydi (oqim uziladi). */
import { useEffect, useReducer, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { createPlayer } from "@/player/player.js";
import { HEVC_OK } from "@/player/env.js";
import { Icon } from "@/components/Icon";
import { cx } from "@/components/ui";
import { useT } from "@/i18n/I18nProvider";
import { camStatus, type Camera } from "@/lib/types";
import { useSelectedCamera } from "@/lib/selection";

export type Quality = "" | "sub";
type TileState = "" | "connecting" | "live" | "offline" | "fail";

interface PlayerLike {
  open: (cam: unknown, useHevc: boolean, quality?: string) => void;
  stop: () => void;
  destroy?: () => void;
  onOpen: ((ms: number, mode: string) => void) | null;
  onState: ((kind: string, text: string) => void) | null;
}

/* Ulanish shuncha cho'zilsa "Qayta urinish" tugmasi chiqadi (Video/Preview tavsifi). */
const RETRY_HINT_MS = 3000;
/* Oqim ochilmasa — bir marta shuncha kutib o'zi qayta urinadi. */
const AUTO_RETRY_MS = 3000;

export function isDown(cam: Camera) {
  const s = camStatus(cam);
  return s === "offline" || s === "disabled";
}

export function fmtCodec(codec: string | null | undefined) {
  if (!codec) return "—";
  const c = String(codec).toUpperCase();
  const m = c.match(/^H\.?(\d{3})$/);
  return m ? "H." + m[1] : c;
}

export function fmtSec(ms: number | null | undefined) {
  if (ms == null || !isFinite(ms)) return "—";
  return (ms / 1000).toFixed(1).replace(".", ",") + " s";
}

/* v3 tile.js fmtAgo: "hozirgina" · "10 daq oldin" · "3 soat oldin" · "2 kun oldin" */
function fmtAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "hozirgina";
  if (s < 3600) return Math.round(s / 60) + " daq oldin";
  if (s < 86400) return Math.round(s / 3600) + " soat oldin";
  return Math.round(s / 86400) + " kun oldin";
}

export interface WallTileProps {
  cam: Camera;
  quality: Quality;
  /** Hover amallari (Surat · Xaritada · Fokus); Fokus asosiy katagida — yo'q */
  actions?: boolean;
  main?: boolean;
  staged?: boolean;
  draggable?: boolean;
  onShot?: (cam: Camera) => void;
  onMap?: (cam: Camera) => void;
  onFocus?: (cam: Camera) => void;
  /** Katakni bosish (tugmadan tashqari) */
  onActivate?: (cam: Camera) => void;
  /** Enter — onActivate (devor katagi) */
  enterKey?: boolean;
  onOpenMs?: (ms: number) => void;
  elRef?: (el: HTMLDivElement | null) => void;
}

export function WallTile(props: WallTileProps) {
  const { cam, quality, actions = true, main, staged, draggable } = props;
  const t = useT();
  const selectedId = useSelectedCamera();      // xaritada tanlangan — ko'k chegara (v3 is-sel)
  const [, force] = useReducer((x: number) => x + 1, 0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const msgRef = useRef<HTMLSpanElement>(null);
  const cb = useRef(props);
  cb.current = props;
  const m = useRef({
    player: null as PlayerLike | null,
    state: "" as TileState,
    text: "",
    later: false,
    quality: quality,
    autoRetried: false,
    started: false,
    openMs: null as number | null,
    timers: [] as number[],
    cam,
  }).current;

  /* ---- v3 WallTile metodlari (ref ustida, render — force) ---- */
  const api = useRef({
    clearTimers() { m.timers.forEach(clearTimeout); m.timers = []; },
    paint(st: TileState, text = "") {
      const prev = m.state;
      m.state = st;
      m.text = text;
      if (st === "connecting" && prev !== "connecting") {
        m.later = false;
        m.timers.push(window.setTimeout(() => { if (m.state === "connecting") { m.later = true; force(); } }, RETRY_HINT_MS));
      }
      force();
    },
    stopPlayer() {
      api.clearTimers();
      if (m.player) { m.player.onState = null; m.player.onOpen = null; (m.player.destroy || m.player.stop).call(m.player); m.player = null; }
    },
    open() {
      api.clearTimers();
      if (!m.player) {
        if (!videoRef.current || !msgRef.current) return;
        const p = createPlayer(videoRef.current, msgRef.current) as unknown as PlayerLike;
        p.onOpen = (ms) => {
          m.openMs = ms;
          m.autoRetried = false;
          api.paint("live");
          cb.current.onOpenMs?.(ms);
        };
        p.onState = (kind, text) => {
          if (kind === "wait") api.paint("connecting", text);
          else if (kind === "fail") api.failed(text);
        };
        m.player = p;
      }
      api.paint("connecting", "Ulanmoqda…");
      m.player.open(m.cam, HEVC_OK, m.quality);
    },
    failed(text: string) {
      api.paint("fail", text);
      if (m.autoRetried) return;
      m.autoRetried = true;
      m.timers.push(window.setTimeout(() => { if (m.state === "fail") api.open(); }, AUTO_RETRY_MS));
    },
    start(q: Quality) {
      m.started = true;
      m.quality = q;
      if (isDown(m.cam)) { api.paint("offline"); return; }
      api.open();
    },
    /* "Qayta ulash" / "Qayta urinish" — faqat shu kamera qayta so'raladi. */
    reconnect() {
      m.autoRetried = true;          // qo'lda bosildi — o'zi takrorlamaydi
      m.started = true;
      api.open();
    },
  }).current;

  // Ochilish / yopilish.
  useEffect(() => {
    m.state = "";
    api.start(m.quality);
    return () => { api.stopPlayer(); m.started = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Kamera ma'lumoti yangilandi (har poll): holat o'zgarishi.
  useEffect(() => {
    if (cam === m.cam) return;
    const wasDown = isDown(m.cam);
    m.cam = cam;
    const down = isDown(cam);
    if (down && !m.player) api.paint("offline");
    else if (down && m.state !== "live") { api.stopPlayer(); api.paint("offline"); }
    else if (!down && wasDown && m.state === "offline" && m.started) api.start(m.quality);
  }, [cam]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sifat almashdi — kerak bo'lsa qayta ochish.
  useEffect(() => {
    if (quality === m.quality) return;
    m.quality = quality;
    if (m.player && m.state !== "offline") api.open();
  }, [quality]); // eslint-disable-line react-hooks/exhaustive-deps

  // Oldindan ochilgan katak devorga o'tdi — video davom etsin.
  const wasStaged = useRef(staged);
  useEffect(() => {
    if (wasStaged.current && !staged) videoRef.current?.play().catch(() => {});
    wasStaged.current = staged;
  }, [staged]);

  const st: TileState = m.state || (isDown(cam) ? "offline" : "connecting");
  const dot = { live: "online", connecting: "no-video", offline: "offline", fail: "offline", "": "offline" }[st];
  const codec = fmtCodec(cam.codec);
  const meta = st === "live" ? codec + " · " + fmtSec(m.openMs) : st === "connecting" ? codec + " · …" : codec + " · —";

  const click = (e: MouseEvent<HTMLDivElement>) => {
    const b = (e.target as Element).closest("button");
    if (b) {
      e.stopPropagation();
      const act = b.dataset.act;
      if (act === "retry") { api.reconnect(); return; }
      const fn = ({ shot: props.onShot, map: props.onMap, focus: props.onFocus } as Record<string, ((c: Camera) => void) | undefined>)[act || ""];
      fn?.(cam);
      return;
    }
    props.onActivate?.(cam);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (props.enterKey && e.key === "Enter" && e.target === e.currentTarget) props.onActivate?.(cam);
  };

  const retryBtn = (label: string) => (
    <button type="button" className="wl-tile__retry" data-act="retry"><Icon name="rotate-cw" size="sm" />{t(label)}</button>
  );
  let center = null;
  if (st === "connecting") {
    center = (
      <>
        <span className="spinner wl-tile__spin" aria-hidden="true" />
        <span className="wl-tile__text wl-tile__text--muted">{t(m.text || "Ulanmoqda…")}</span>
        <span className="wl-tile__later" hidden={!m.later}>{retryBtn("Qayta urinish")}</span>
      </>
    );
  } else if (st === "offline" || st === "fail") {
    const ago = fmtAgo(cam.last_seen);
    const msg = st === "offline"
      ? (camStatus(cam) === "disabled" ? "Oʻchirilgan" : "Uzilgan" + (ago ? " · " + ago : ""))
      : "Oqim ochilmadi";
    center = (
      <>
        <Icon name="camera-slash" size="lg" />
        <span className="wl-tile__text" title={st === "fail" && m.text ? t(m.text) : undefined}>{t(msg)}</span>
        {retryBtn("Qayta ulash")}
      </>
    );
  }

  return (
    <div ref={props.elRef} className={cx("wl-tile", main && "wl-tile--main", staged && "is-staged",
      !main && !staged && selectedId === cam.id && "is-sel")} data-id={cam.id}
      data-state={st} tabIndex={0} draggable={draggable || undefined} aria-hidden={staged || undefined}
      onClick={click} onKeyDown={key} onDoubleClick={(e) => e.stopPropagation()}>
      <video ref={videoRef} className="wl-tile__video" muted playsInline autoPlay />
      <div className="wl-tile__scrim wl-tile__scrim--t" /><div className="wl-tile__scrim wl-tile__scrim--b" />
      <div className="wl-tile__head">
        <span className="wl-tile__dot" data-status={dot} />
        <span className="wl-tile__name ellipsis">{cam.name}</span>
        <span className="wl-tile__region ellipsis">{cam.region && cam.region !== cam.name ? cam.region : ""}</span>
      </div>
      <span className="wl-tile__live"><span className="wl-tile__pulse pulse" />{t("JONLI")}</span>
      <div className="wl-tile__center">{center}</div>
      <span className="wl-tile__meta">{t(meta)}</span>
      {actions && (
        <div className="wl-tile__acts">
          <button type="button" data-act="shot" data-tip="Suratni saqlash" aria-label={t("Suratni saqlash")}><Icon name="camera" size="sm" /></button>
          <button type="button" data-act="map" data-tip="Xaritada koʻrsatish" aria-label={t("Xaritada koʻrsatish")}><Icon name="location-crosshairs" size="sm" /></button>
          <button type="button" data-act="focus" data-tip="Fokus rejimida ochish" aria-label={t("Fokus rejimida ochish")}><Icon name="maximize" size="sm" /></button>
        </div>
      )}
      <span ref={msgRef} className="wl-tile__msg" hidden />
    </div>
  );
}
