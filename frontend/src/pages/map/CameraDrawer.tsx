/* pages/map/CameraDrawer.tsx — Map/CameraDrawer (Figma 02.03, 02.19 Texnik pasport, 02.20 Tarix,
   02.21 Surat saqlandi), v3 selection.js drawer qismi.
   O'ngda 480px: sarlavha + holat + "Hudud · km · piket", jonli video (usePlayer, asosiy oqim),
   amallar (1 Primary + IconButton'lar), 3 KpiTile, "Soʻnggi 24 soat" (48 blok), tablar
   Maʼlumot / Texnik pasport / Tarix N, so'nggi hodisalar. Drawer ochiq bo'lsa boshqa marker →
   kontent almashadi. Tafsilotlar faqat tanlashda so'raladi (GET /api/cameras/{id}/details).
   timeline_24h yo'q bo'lsa (eski backend) — tarixdan taxminan yasaladi.
   Komponent doim joyida (pleyer ref'lari uchun) — yopiq bo'lsa hidden. */
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useT } from "@/i18n/I18nProvider";
import { Icon } from "@/components/Icon";
import { InfoTip, cx } from "@/components/ui";
import { useToast } from "@/components/overlays";
import { api } from "@/lib/api";
import { usePlayer } from "@/player/usePlayer";
import type { Camera } from "@/lib/types";
import { useMap, type Group } from "./model";
import { useNow } from "./hooks";
import {
  STATUS_LABEL, camPlace, camStatus, camSub, fmtAgo, fmtCodec, fmtDur, fmtRes, fmtStamp, fmtWhen, hasGeo, hm, hms, p2,
} from "./util";

const VENDORS: Record<string, string> = { dahua: "Dahua", hikvision: "Hikvision", holowits: "Holowits" };
const HIST: Record<string, [string, string]> = {
  offline: ["Uzildi", "offline"], online: ["Tiklandi", "online"],
  stalled: ["Tasvir toʻxtadi", "no-video"], resumed: ["Tasvir tiklandi", "online"],
  transport: ["Uzatish usuli almashdi", "unknown"], mediamtx: ["Video server", "unknown"],
};
const BLOCK_RANK: Record<string, number> = { offline: 3, stalled: 2, unknown: 1, online: 0 };
const AFTER: Record<string, string> = { offline: "offline", online: "online", stalled: "stalled", resumed: "online" };
const BEFORE: Record<string, string> = { offline: "online", online: "offline", stalled: "online", resumed: "stalled" };

interface HistItem { ts: string; kind: string; detail?: string }
interface Passport {
  vendor?: string; model?: string; firmware?: string; codec?: string; resolution?: string; fps?: number | null;
  sub_codec?: string; has_sub?: boolean; sub_bad?: boolean; transport?: string; transcode?: boolean;
  rail_line?: string | null; km?: number | null; picket?: number | null; lat?: number | null; lng?: number | null;
  snapshot_at?: string | null; probe_at?: string | null; probe_error?: string | null; note?: string; created_at?: string | null;
}
interface Reliability { days: number; uptime_pct: number | null; outages: number; blips: number; mttr_median_s: number | null }
interface Details {
  id: number; passport?: Passport; reliability?: Reliability | null; history?: HistItem[];
  timeline_24h?: { t: string; state: string }[]; availability_24h?: number | null; online_since?: string | null;
}

/* history (yangisi birinchi) → [{from, to, state}] — 24 soat oynasida. */
function segmentsFromHistory(cam: Camera, history: HistItem[] | undefined, now: number) {
  const start = now - 86400000;
  const cur0 = ({ online: "online", "no-video": "stalled", offline: "offline" } as Record<string, string>)[camStatus(cam)] || "unknown";
  let cur = cur0, end = now;
  const segs: { from: number; to: number; state: string }[] = [];
  for (const h of history || []) {
    if (!AFTER[h.kind]) continue;
    const t = new Date(h.ts).getTime();
    if (isNaN(t)) continue;
    if (t <= start) break;
    segs.push({ from: t, to: end, state: cur });
    cur = BEFORE[h.kind];
    end = t;
  }
  segs.push({ from: start, to: end, state: cur });
  return segs;
}

function buildBlocks(cam: Camera, d: Details, now: number) {
  if (Array.isArray(d.timeline_24h) && d.timeline_24h.length) {
    const blocks = d.timeline_24h.slice(-48).map((b) => b.state || "unknown");
    const pct = d.availability_24h != null ? d.availability_24h
      : (blocks.filter((s) => s === "online").length / blocks.length) * 100;
    return { blocks, pct };
  }
  const segs = segmentsFromHistory(cam, d.history, now);
  const start = now - 86400000, step = 1800000;
  const blocks: string[] = [];
  for (let i = 0; i < 48; i++) {
    const a = start + i * step, b = a + step;
    let worst: string | null = null;
    segs.forEach((s) => {
      if (s.to <= a || s.from >= b) return;
      if (worst == null || BLOCK_RANK[s.state] > BLOCK_RANK[worst]) worst = s.state;
    });
    blocks.push(worst || "unknown");
  }
  let on = 0;
  segs.forEach((s) => { if (s.state === "online") on += s.to - s.from; });
  return { blocks, pct: (on / 86400000) * 100 };
}

/* Kamera suratini faylga saqlash (v3 wall/video-wall.js saveSnapshot) — toast 04.07. */
export function useSaveSnapshot() {
  const toast = useToast();
  return async (cam: Camera) => {
    try {
      const res = await fetch("/api/cameras/" + cam.id + "/snapshot", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const d = new Date();
      const name = String(cam.name).replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") +
        "_" + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + ".jpg";
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast("Surat saqlandi · " + name, { tone: "info", action: "Ochish", ms: 6000, onAction: () => window.open(url, "_blank", "noopener") });
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch {
      toast("Surat olinmadi", { tone: "error" });
    }
  };
}

function Row({ icon, k, v, mono, cls, id, children }: { icon: string; k: string; v?: string; mono?: boolean; cls?: string; id?: string; children?: React.ReactNode }) {
  const t = useT();
  return (
    <div className="detail-row">
      <Icon name={icon} size="sm" />
      <span className="detail-row__k">{t(k)}</span>
      <span className={cx("detail-row__v", mono && "mono-sm", cls)} id={id}>{children ?? (mono ? v : t(v || ""))}</span>
    </div>
  );
}

function Kpi({ label, tip, value, meta, cls }: { label: string; tip: string; value: string; meta: string; cls?: string }) {
  const t = useT();
  return (
    <div className="kpi-tile">
      <span className="kpi-tile__label">{t(label)}<InfoTip text={tip} /></span>
      <span className={cx("kpi-tile__value", cls)}>{t(value)}</span>
      <span className="kpi-tile__meta">{t(meta)}</span>
    </div>
  );
}

export const CameraDrawer = forwardRef<HTMLDivElement>(function CameraDrawer(_props, videoWrapRef) {
  const t = useT();
  const m = useMap();
  const toast = useToast();
  const saveSnapshot = useSaveSnapshot();
  const open = m.drawerOpen;
  const id = open ? m.selectedId : null;
  const cam = id != null ? m.byId.get(id) || null : null;
  const st = cam ? camStatus(cam) : "unknown";
  const [tab, setTab] = useState<"info" | "pass" | "hist">("info");
  const [openInfo, setOpenInfo] = useState<{ id: number; ms: number; ts: string } | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const videoRef0 = useRef<HTMLVideoElement | null>(null);
  const player = usePlayer(cam, { enabled: open && id != null });
  const now = useNow(1000, open);

  const det = useQuery({
    queryKey: ["camera-details", id],
    queryFn: () => api<Details>("/api/cameras/" + id + "/details?days=7&history=30"),
    enabled: id != null,
    retry: false,
    staleTime: 0,
  });
  const d = det.data && cam && det.data.id === cam.id ? det.data : null;
  const failed = det.isError;

  // Poster: oxirgi kadr (uzilganda saqlangani — ?stale=1); pleyer effektidan OLDIN.
  useLayoutEffect(() => {
    const v = videoRef0.current;
    if (!v || id == null || !cam) return;
    v.poster = "/api/cameras/" + cam.id + "/snapshot?" + (camStatus(cam) === "offline" ? "stale=1&" : "") + "t=" + Date.now();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Uzilgan kamera: pleyer ochilgach sabab yoziladi (v3 player.setMsg).
  useEffect(() => {
    const el = player.msgRef.current;
    if (!el || id == null || !cam || camStatus(cam) !== "offline") return;
    el.textContent = t("Oqim yoʻq · " + fmtAgo(cam.last_seen).replace("oldin", "oldin uzildi"));
    el.classList.add("wait");
    el.classList.remove("fail");
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (player.status === "playing" && player.openMs != null && cam) setOpenInfo({ id: cam.id, ms: player.openMs, ts: new Date().toISOString() });
  }, [player.status, player.openMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ochilganda fokus sarlavhaga.
  useEffect(() => {
    if (!open) return;
    const h = setTimeout(() => headRef.current?.focus({ preventScroll: true }), 60);
    return () => clearTimeout(h);
  }, [open]);

  const fullscreen = () => {
    const v = (videoWrapRef as React.RefObject<HTMLDivElement | null>)?.current;
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (v?.requestFullscreen) v.requestFullscreen().catch(() => {});
  };

  /* ---------- hisoblangan qiymatlar ---------- */
  const ps = d ? d.passport || null : null;
  const fps = (ps && ps.fps) || cam?.fps;
  const fmt = cam ? [fmtCodec((ps && ps.codec) || cam.codec), fmtRes((ps && ps.resolution) || cam.resolution), fps ? Math.round(fps) + " fps" : ""]
    .filter(Boolean).join(" · ") : "";

  return (
    <aside className="mp-drawer" id="mp-drawer" role="dialog" aria-labelledby="sel-name" hidden={!open}>
      <header className="mp-drawer__head">
        <div className="mp-drawer__title">
          <h2 className="heading-lg ellipsis" id="sel-name" tabIndex={-1} ref={headRef}>{cam?.name}</h2>
          <button type="button" className="icon-btn icon-btn--sm" id="sel-close" data-tip="Yopish" aria-label={t("Yopish")}
            onClick={() => m.closeDrawer()}><Icon name="xmark" size="sm" /></button>
        </div>
        <div className="mp-drawer__sub">
          <span className="badge" id="sel-badge" data-status={st}><span className="dot" data-status={st} />{t(STATUS_LABEL[st])}</span>
          <span className="body-sm t-tertiary ellipsis" id="sel-sub">{cam ? t(camSub(cam) || "Hudud belgilanmagan") : ""}</span>
        </div>
      </header>
      <div className="mp-drawer__scroll">
        <div className="mp-video" id="sel-video-wrap" ref={videoWrapRef} onDoubleClick={fullscreen}>
          <video id="sel-video" ref={(el) => { videoRef0.current = el; (player.videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el; }}
            muted playsInline />
          <div id="sel-msg" ref={player.msgRef as unknown as React.Ref<HTMLDivElement>} />
          <span className="mp-prev__scrim" />
          <span className="mp-prev__live" id="sel-live" hidden={st === "offline" || st === "disabled"}><span className="mp-livedot" />{t("JONLI")}</span>
          <span className="mp-prev__time mono-xs" id="sel-stamp">{open ? hms(now) : ""}</span>
          <span className="mp-prev__bar">
            <span className="mono-xs" id="sel-fmt">{fmt || "—"}</span>
            <button type="button" className="mp-prev__fs" id="sel-full" data-tip="Toʻliq ekran" aria-label={t("Toʻliq ekran")} onClick={fullscreen}>
              <Icon name="maximize" />
            </button>
          </span>
        </div>
        <div className="mp-drawer__actions">
          <button type="button" className="btn btn--primary mp-drawer__wall" id="sel-wall" onClick={() => m.toWall(id)}>
            <Icon name="grid" />{t("Video devorga qoʻshish")}
          </button>
          <button type="button" className="icon-btn icon-btn--secondary" id="sel-shot" data-tip="Suratni saqlash" aria-label={t("Suratni saqlash")}
            onClick={() => { if (cam) saveSnapshot(cam); }}><Icon name="camera" /></button>
          <button type="button" className="icon-btn icon-btn--secondary" id="sel-center" data-tip="Xaritada markazlash" aria-label={t("Xaritada markazlash")}
            onClick={() => {
              if (cam && hasGeo(cam) && m.ctl) m.ctl.map.flyTo([cam.lat, cam.lng], Math.max(m.ctl.map.getZoom(), 15), { duration: 0.6 });
              else if (cam) toast("Bu kameraga koordinata kiritilmagan", { tone: "info" });
            }}><Icon name="location-crosshairs" /></button>
          {m.isAdminUser && (
            <button type="button" className="icon-btn icon-btn--secondary admin-only" id="sel-edit" data-tip="Kamerani sozlash" aria-label={t("Kamerani sozlash")}
              onClick={() => m.editCamera(id)}><Icon name="sliders" /></button>
          )}
        </div>
        {cam && <Kpis d={d} failed={failed} />}
        {cam && <Avail cam={cam} d={d} failed={failed} />}
        <div className="seg" id="sel-tabs" role="tablist">
          <button type="button" data-tab="info" className={cx(tab === "info" && "is-on")} role="tab" onClick={() => setTab("info")}>{t("Maʼlumot")}</button>
          <button type="button" data-tab="pass" className={cx(tab === "pass" && "is-on")} role="tab" onClick={() => setTab("pass")}>{t("Texnik pasport")}</button>
          <button type="button" data-tab="hist" className={cx(tab === "hist" && "is-on")} role="tab" onClick={() => setTab("hist")}>
            {t("Tarix")} <span className="seg__count" id="sel-hist-n">{d ? String((d.history || []).length) : ""}</span>
          </button>
        </div>
        <div id="sel-tab-info" hidden={tab !== "info"}>
          {cam && <InfoRows cam={cam} d={d} fmt={fmt} />}
          <div className="overline mp-drawer__h">{t("Soʻnggi hodisalar")}</div>
          <div id="sel-events">{cam && <Events cam={cam} d={d} openInfo={openInfo} />}</div>
        </div>
        <div id="sel-tab-pass" hidden={tab !== "pass"}>{cam && <PassportRows ps={ps} failed={failed} />}</div>
        <div id="sel-tab-hist" hidden={tab !== "hist"}><History list={d ? d.history || [] : null} failed={failed} /></div>
      </div>
    </aside>
  );
});

function Kpis({ d, failed }: { d: Details | null; failed: boolean }) {
  const r = d ? d.reliability : undefined;
  const tiles: { k: string; label: string; tip: string; value: string; meta: string; cls?: string }[] = [];
  const up = { label: "Ishlash ulushi", tip: "Uptime — soʻnggi 7 kunda kamera onlayn boʻlgan vaqt ulushi. Tasvirsiz vaqt onlayn hisoblanmaydi." };
  const out = { label: "Uzilishlar", tip: "2 daqiqadan uzun uzilishlar soni (7 kun). Qisqa uzilishlar alohida sanaladi." };
  const mttr = { label: "Tiklanish vaqti", tip: "MTTR — uzilishdan qayta ulanishgacha oʻtgan vaqtning medianasi." };
  if (!r) {
    const t = r === null ? "kuzatilmaydi" : failed ? "maʼlumot yoʻq" : "…";
    tiles.push({ k: "up", ...up, value: "—", meta: t }, { k: "out", ...out, value: "—", meta: "" }, { k: "mttr", ...mttr, value: "—", meta: "" });
  } else {
    const u = r.uptime_pct;
    tiles.push(
      { k: "up", ...up, value: u == null ? "—" : u.toFixed(1).replace(".", ",") + "%", meta: r.days + " kun",
        cls: u == null ? "" : u >= 99 ? "" : u >= 90 ? "t-warning" : "t-error" },
      { k: "out", ...out, value: String(r.outages), meta: r.blips ? "+" + r.blips + " qisqa uzilish" : "qisqa uzilish yoʻq" },
      { k: "mttr", ...mttr, value: r.mttr_median_s != null ? fmtDur(r.mttr_median_s) : "—", meta: "mediana" },
    );
  }
  return <div className="mp-kpis">{tiles.map((x) => <Kpi key={x.k} {...x} />)}</div>;
}

function Avail({ cam, d, failed }: { cam: Camera; d: Details | null; failed: boolean }) {
  const t = useT();
  const now = Date.now();
  const label: Record<string, string> = { online: "onlayn", offline: "uzilgan", stalled: "tasvirsiz", unknown: "maʼlumot yoʻq" };
  let blocks: string[], pctText = "", pctCls = "mono-xs";
  if (!d) {
    blocks = Array.from({ length: 48 }, () => "unknown");
    pctText = failed ? "" : "…";
  } else {
    const b = buildBlocks(cam, d, now);
    blocks = b.blocks;
    pctText = "onlayn " + b.pct.toFixed(1).replace(".", ",") + "%";
    pctCls = "mono-xs " + (b.pct >= 99 ? "t-success" : b.pct >= 90 ? "t-warning" : "t-error");
  }
  const start = new Date(now - 86400000);
  start.setMinutes(0, 0, 0);
  const lab = [0, 6, 12, 18].map((h) => hm(new Date(start.getTime() + h * 3600000)));
  return (
    <section className="mp-avail">
      <div className="mp-avail__head"><span className="overline">{t("Soʻnggi 24 soat")}</span><span className="spacer" /><span className={pctCls} id="sel-avail-pct">{t(pctText)}</span></div>
      <div className="mp-avail__bar" id="sel-avail">
        {blocks.map((s, i) => (
          <i key={i} data-s={s} title={d ? t(hm(new Date(now - 86400000 + i * 1800000)) + " · " + (label[s] || s)) : undefined} />
        ))}
      </div>
      <div className="mp-avail__axis mono-xs" id="sel-avail-axis">
        {lab.map((l, i) => <span key={i}>{l}</span>)}<span>{t("hozir")}</span>
      </div>
    </section>
  );
}

/* "Ish vaqti" — joriy onlayn seriya davomiyligi. */
function uptimeText(cam: Camera, d: Details | null) {
  const st = camStatus(cam);
  const since = (d && d.online_since) || cam.online_since;
  if (st === "online" && since) return fmtDur((Date.now() - new Date(since).getTime()) / 1000);
  const hist = (d && d.history) || [];
  if (st === "online") {
    const last = hist.find((h) => h.kind === "online");
    if (last) return fmtDur((Date.now() - new Date(last.ts).getTime()) / 1000);
    return d ? (d.reliability ? d.reliability.days + "+ kun" : "—") : "…";
  }
  if (st === "offline") {
    const last = hist.find((h) => h.kind === "offline");
    return last ? "uzilgan · " + fmtDur((Date.now() - new Date(last.ts).getTime()) / 1000) : "uzilgan";
  }
  return "—";
}

function InfoRows({ cam, d, fmt }: { cam: Camera; d: Details | null; fmt: string }) {
  const m = useMap();
  const ps = d ? d.passport || null : null;
  const vendor = VENDORS[String((ps && ps.vendor) || cam.vendor || "")] || "";
  const model = [vendor, (ps && ps.model) || cam.model].filter(Boolean).join(" ") || "—";
  const st = camStatus(cam);
  const place = camPlace(ps ? { km: ps.km, picket: ps.picket } : cam);
  return (
    <div id="sel-info-rows">
      <Row icon="map-pin" k="Hudud" v={cam.region || "—"} />
      <Row icon="location-pin" k="Joy" v={place || "—"} />
      <Row icon="video" k="Kodek · format" v={fmt || "—"} />
      <Row icon="camera" k="Model" v={model} />
      <Row icon="clock" k="Oxirgi aloqa" v={st === "online" ? "hozirgina" : fmtAgo(cam.last_seen)} />
      <Row icon="history" k="Ish vaqti" v={uptimeText(cam, d)} />
      {m.authed && <Row icon="grid" k="Guruh" cls="mp-gchips" id="sel-f-groups"><CamGroups cam={cam} /></Row>}
    </div>
  );
}

/* Drawer'dagi "Guruh" qatori: kamera guruhlari (bosilsa — filtr), × — chiqarish, "+ guruh". */
function CamGroups({ cam }: { cam: Camera }) {
  const t = useT();
  const m = useMap();
  const mine = m.groups.filter((g) => g.camera_ids.includes(cam.id));
  const colorOf = (g: Group) => g.color || "var(--color-bg-brand)";
  return (
    <>
      {mine.map((g) => (
        <span key={g.id} className="mp-gchip" data-g={g.id} data-tip="Xaritada faqat shu guruh" onClick={() => m.setGroupFilter(g.id)}>
          <i style={{ background: colorOf(g) }} />{g.name}
          {g.can_edit && m.canEdit && (
            <button type="button" aria-label={t("Guruhdan chiqarish")}
              onClick={(e) => { e.stopPropagation(); m.groupMembers(g.id, [cam.id], "remove"); }}><Icon name="xmark" size="xs" /></button>
          )}
        </span>
      ))}
      {m.canEdit ? (
        <button type="button" className="mp-gchip mp-gchip--add" onClick={() => m.openGroupPicker([cam.id], cam.name)}>
          <Icon name="plus" size="xs" />{t("guruh")}
        </button>
      ) : (mine.length ? null : "—")}
    </>
  );
}

function PassportRows({ ps, failed }: { ps: Passport | null; failed: boolean }) {
  const t = useT();
  if (!ps) return <div className="body-sm t-tertiary mp-drawer__empty">{t(failed ? "Maʼlumotni olib boʻlmadi." : "Yuklanmoqda…")}</div>;
  const sub: [string, string] = !ps.has_sub ? ["yoʻq", ""]
    : ps.sub_bad ? [(ps.sub_codec ? fmtCodec(ps.sub_codec) + " · " : "") + "ishlamaydi", "t-error"]
    : [fmtCodec(ps.sub_codec || "?") + " · ishlaydi", ""];
  const probe: [string, string] = ps.probe_error ? [ps.probe_error, "t-error"]
    : ps.probe_at ? ["muvaffaqiyatli · " + fmtStamp(ps.probe_at), ""] : ["hali tekshirilmagan", ""];
  const created = ps.created_at ? new Date(ps.created_at) : null;
  const vendor = VENDORS[ps.vendor || ""] || ps.vendor || "";
  return (
    <>
      <Row icon="camera" k="Model" v={[vendor, ps.model].filter(Boolean).join(" ") || "—"} />
      <Row icon="cpu" k="Proshivka" v={ps.firmware ? ps.firmware.split(",")[0] : "—"} mono />
      <Row icon="video" k="Asosiy oqim" v={[fmtCodec(ps.codec), fmtRes(ps.resolution), ps.fps ? Math.round(ps.fps) + " fps" : ""].filter(Boolean).join(" · ") || "—"} />
      <Row icon="signal" k="Qoʻshimcha oqim" v={sub[0]} cls={sub[1]} />
      <Row icon="rotate-cw" k="Oʻgirish" v={ps.transcode ? "H.265 → H.264 (server)" : "yoʻq — kameraning oʻz oqimi"} />
      <Row icon="wifi" k="Uzatish usuli" v={ps.transport === "udp" ? "UDP (TCPʼda kadr kelmagan)" : "TCP"} />
      <Row icon="train" k="Liniya" v={ps.rail_line || "—"} />
      <Row icon="location-crosshairs" k="Koordinata" v={ps.lat != null && ps.lng != null ? ps.lat.toFixed(5) + ", " + ps.lng.toFixed(5) : "kiritilmagan"}
        mono={ps.lat != null} cls={ps.lat == null ? "t-warning" : ""} />
      <Row icon="image" k="Oxirgi surat" v={ps.snapshot_at ? fmtAgo(ps.snapshot_at) : "—"} />
      <Row icon="circle-check" k="Pasport tekshiruvi" v={probe[0]} cls={probe[1]} />
      <Row icon="calendar" k="Qoʻshilgan" v={created && !isNaN(created.getTime())
        ? p2(created.getDate()) + "." + p2(created.getMonth() + 1) + "." + created.getFullYear() : "—"} />
      {ps.note ? <Row icon="pen" k="Izoh" v={ps.note} /> : null}
    </>
  );
}

function History({ list, failed }: { list: HistItem[] | null; failed: boolean }) {
  const t = useT();
  if (!list) return <div className="body-sm t-tertiary mp-drawer__empty">{t(failed ? "Maʼlumotni olib boʻlmadi." : "Yuklanmoqda…")}</div>;
  if (!list.length) return <div className="body-sm t-tertiary mp-drawer__empty">{t("Soʻnggi 30 kunda hodisa qayd etilmagan.")}</div>;
  return (
    <ol className="mp-events mp-events--full">
      {list.map((h, i) => {
        const [label, st] = HIST[h.kind] || [h.kind, "unknown"];
        let note = h.kind === "transport" ? h.detail || "" : "";
        const pair = ({ online: "offline", resumed: "stalled" } as Record<string, string>)[h.kind];
        if (pair) {
          const prev = list.slice(i + 1).find((x) => x.kind === pair || x.kind === h.kind);
          if (prev && prev.kind === pair) note = fmtDur((new Date(h.ts).getTime() - new Date(prev.ts).getTime()) / 1000) + " uzilishdan keyin";
        }
        return (
          <li key={i}><time className="mono-xs">{fmtStamp(h.ts)}</time><span className="dot" data-status={st} />
            <span className="body-sm t-secondary">{t(label + (note ? " · " + note : ""))}</span></li>
        );
      })}
    </ol>
  );
}

/* SOʻNGGI HODISALAR — 3 ta: oqim ochilishi (shu seans), uzilishlar, tasvirsizlik. */
function Events({ cam, d, openInfo }: { cam: Camera; d: Details | null; openInfo: { id: number; ms: number; ts: string } | null }) {
  const t = useT();
  const list = d ? d.history || [] : null;
  const items: { ts: string; st: string; text: string }[] = [];
  if (openInfo && openInfo.id === cam.id) {
    items.push({ ts: openInfo.ts, st: "online", text: "Oqim ochildi · " + (openInfo.ms / 1000).toFixed(1).replace(".", ",") + " s" });
  }
  if (list) {
    list.forEach((h, i) => {
      if (h.kind !== "offline" && h.kind !== "stalled") return;
      const end = list.slice(0, i).reverse().find((x) => x.kind === (h.kind === "offline" ? "online" : "resumed"));
      const dur = fmtDur(((end ? new Date(end.ts).getTime() : Date.now()) - new Date(h.ts).getTime()) / 1000);
      items.push(h.kind === "offline"
        ? { ts: h.ts, st: "offline", text: "Uzildi · " + dur + (end ? "" : " · davom etmoqda") }
        : { ts: h.ts, st: "no-video", text: "Tasvirsiz · " + dur + (/muzla|toʻxta/.test(h.detail || "") ? " · oqim toʻxtadi" : "") });
    });
  }
  items.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  if (!items.length) return <div className="body-sm t-tertiary">{t(list ? "Soʻnggi 30 kunda hodisa yoʻq" : "Yuklanmoqda…")}</div>;
  return (
    <ol className="mp-events">
      {items.slice(0, 3).map((it, i) => (
        <li key={i}><time className="mono-xs">{fmtWhen(it.ts)}</time><span className="dot" data-status={it.st} />
          <span className="body-sm t-secondary">{t(it.text)}</span></li>
      ))}
    </ol>
  );
}
