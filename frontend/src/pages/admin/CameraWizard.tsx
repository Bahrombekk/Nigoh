/* pages/admin/CameraWizard.tsx — "Yangi kamera" oynasi, 3 qadam (v3 camera-form.js CameraWizard;
   Figma 05.05–05.07): 1 Joylashuv (nomi, hudud, mini xarita, koordinata) → 2 Ulanish (RTSP / tayyor
   oqim, ishlab chiqaruvchi, IP+port, login/parol, "Qurilmani aniqlash", bir nechta kanal — belgilash)
   → 3 Tekshiruv (kadr, Ochilish / Kodek / Barqarorlik, ishlash rejimi) → "Saqlash".
   Tuzoqlar: saqlashdan oldin MediaMTX yo'li yo'q — 3-qadamda skan topgan kanal surati (5 s);
   oyna yopilganda skan SSE va surat taymeri to'xtatiladi. */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { Button, IconButton, InfoTip, cx } from "@/components/ui";
import { Dialog, useToast } from "@/components/overlays";
import { useT } from "@/i18n/I18nProvider";
import { AlertBox, Fld, useErrs, type AlertState } from "./FormBits";
import { MiniMap, type MiniMapHandle } from "./MiniMap";
import { invalidateAdmin, useRegionList, useVendors } from "./queries";
import { codecLabel, fmtRes, fmtSec, num, probeCamera, regionAt, validators, type ProbeResult } from "./util";

interface Channel { channel: number; ok?: boolean; codec?: string | null; needs_transcode?: boolean; rtsp_path?: string; snapshot_url?: string }
interface ScanRes { vendor: string; vendor_name: string; device?: string; channels: Channel[]; found?: boolean; message?: string }
type PreviewState = { state: "connecting" | "live" | "offline"; msg?: string };
interface Kpis { open: string; codec: string; codecMeta: string; signal: string; signalMeta: string }

const STEPS = [{ n: 1, label: "Joylashuv" }, { n: 2, label: "Ulanish" }, { n: 3, label: "Tekshiruv" }];
const EMPTY_KP: Kpis = { open: "—", codec: "—", codecMeta: "—", signal: "—", signalMeta: "—" };

export function CameraWizard({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const vendors = useVendors(open).data || [];
  const regions = useRegionList(open);
  const E = useErrs();
  const mm = useRef<MiniMapHandle>(null);

  const [step, setStep] = useState(1);
  const [done, setDone] = useState(0);
  const stepRef = useRef(1);
  stepRef.current = step;

  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [src, setSrc] = useState<"rtsp" | "manual">("rtsp");
  const [vendor, setVendor] = useState("boshqa");
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("554");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [path, setPath] = useState("/stream1");
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState("ondemand");

  const [scan, setScan] = useState<ScanRes | null>(null);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [scanOut, setScanOut] = useState<AlertState | null>(null);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<AlertState | null>(null);
  const [saving, setSaving] = useState(false);

  const [pv, setPv] = useState<PreviewState>({ state: "connecting" });
  const [img, setImg] = useState("");
  const [pvTime, setPvTime] = useState("");
  const [pvMeta, setPvMeta] = useState("—");
  const [kp, setKp] = useState<Kpis>(EMPTY_KP);
  const probeRef = useRef<{ key: string; r: ProbeResult } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const snapTimer = useRef(0);
  const regionSeq = useRef(0);

  const cleanup = () => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    clearInterval(snapTimer.current); snapTimer.current = 0;
  };
  useEffect(() => cleanup, []);

  /* Ochilganda — hammasi boshidan (v3 open()). */
  useEffect(() => {
    if (!open) { cleanup(); return; }
    setStep(1); setDone(0); setScan(null); setChecked({}); probeRef.current = null;
    setName(""); setLat(""); setLng(""); setIp(""); setUser(""); setPass(""); setUrl("");
    setPort("554"); setPath("/stream1"); setMode("ondemand"); setRegion(""); setVendor("boshqa");
    setSrc("rtsp"); setScanOut(null); setErr(null); setSaving(false); setScanning(false);
    E.reset();
    setTimeout(() => { mm.current?.show(null, null); document.getElementById("f-name")?.focus(); }, 60);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Ishlab chiqaruvchi ro'yxati keyin kelsa — "boshqa" yo'q bo'lsa birinchisi. */
  const vendorOpts = vendors.length ? vendors : [{ id: "boshqa", name: "Boshqa", path: "/stream1", port: 554 }];
  const vendorVal = vendorOpts.some((v) => v.id === vendor) ? vendor : vendorOpts[0].id;

  const regionOpts = region && !regions.includes(region) ? [region, ...regions] : regions;

  const autoRegion = (la: number, ln: number) => {
    const my = ++regionSeq.current;
    regionAt(la, ln).then((n) => { if (n && my === regionSeq.current) setRegion(n); });
  };
  const onPick = (la: number, ln: number) => {
    setLat(la.toFixed(5)); setLng(ln.toFixed(5));
    E.set("lat", ""); E.set("lng", "");
    autoRegion(la, ln);
  };
  const syncCoords = () => {
    const la = num(lat), ln = num(lng);
    if (la != null && ln != null) { mm.current?.set(la, ln, false); autoRegion(la, ln); }
  };

  const preview = (() => {
    let p = path.trim();
    if (p && !p.startsWith("/")) p = "/" + p;
    const u = user.trim();
    return "rtsp://" + (u ? u + (pass ? ":•••" : "") + "@" : "") + (ip.trim() || "IP") + ":" + (port || "554") + (p || "/");
  })();

  const dropScan = () => { if (scan) { setScan(null); setChecked({}); setScanOut(null); } };

  const picked = (): Channel[] | null => scan ? scan.channels.filter((c) => checked[c.channel] !== false) : null;
  const pk = src === "rtsp" ? picked() : null;
  const saveLabel = pk && pk.length > 1 ? pk.length + " ta kamerani saqlash" : "Saqlash";

  const validate = (s: number) => {
    if (s === 1) return E.checkAll([
      ["name", validators.required(name, "Kamera nomini kiriting")],
      ["lat", validators.lat(lat, true)],
      ["lng", validators.lng(lng, true)],
    ]);
    if (s === 2) return src === "rtsp"
      ? E.checkAll([["ip", validators.ip(ip)], ["port", validators.port(port)]])
      : E.checkAll([["url", validators.url(url)]]);
    return true;
  };

  const focusPane = (s: number) => setTimeout(() => {
    const first = document.querySelector<HTMLElement>('.ad-wiz [data-pane="' + s + '"] input:not([type=hidden]), .ad-wiz [data-pane="' + s + '"] select');
    first?.focus();
  }, 30);

  const go = (target: number) => {
    if (target < 1 || target > 3) return;
    if (target > step) {
      for (let s = step; s < target; s++) {
        if (s !== step) setStep(s);
        if (!validate(s)) return;
      }
      setDone((d) => Math.max(d, target - 1));
    }
    setStep(target);
    stepRef.current = target;
    setErr(null);
    if (target === 1) setTimeout(() => mm.current?.show(num(lat), num(lng)), 0);
    if (target === 3) enterReview(); else { clearInterval(snapTimer.current); snapTimer.current = 0; }
    if (target !== 3) focusPane(target);
  };

  /* --- qurilmani aniqlash --- */
  const applyScan = (res: ScanRes) => {
    if (!res.channels || !res.channels.length) { setScanOut({ tone: "error", title: "Aniqlab boʻlmadi", text: "Jonli kanal topilmadi" }); return; }
    setScan(res);
    setChecked({});
    const first = res.channels[0];
    if (res.vendor && vendorOpts.some((o) => o.id === res.vendor)) setVendor(res.vendor);
    if (first.rtsp_path) setPath(first.rtsp_path);
    setScanOut({
      tone: "success",
      title: "Qurilma aniqlandi: " + (res.vendor_name || res.vendor || "kamera") + (res.device === "nvr" ? " registrator (NVR)" : ""),
      text: res.channels.length + " kanal · RTSP yoʻli avtomatik toʻldirildi",
    });
  };

  const scanBody = () => ({ ip: ip.trim(), port: Number(port) || 554, username: user.trim(), password: pass || "" });

  const listen = (job: { events: string }) => new Promise<void>((resolve) => {
    const res: ScanRes = { vendor: "", vendor_name: "", channels: [] };
    const es = esRef.current = new EventSource(job.events);
    const finish = () => { es.close(); if (esRef.current === es) esRef.current = null; resolve(); };
    es.addEventListener("meta", (ev) => { Object.assign(res, JSON.parse((ev as MessageEvent).data)); });
    es.addEventListener("channel", (ev) => {
      const c = JSON.parse((ev as MessageEvent).data) as Channel;
      if (!c.ok) return;
      res.channels.push(c);
      res.channels.sort((a, b) => a.channel - b.channel);
      setScanOut({ tone: "wait", title: (res.vendor_name || "Qurilma") + " · " + res.channels.length + " kanal topildi", text: "Qolgan kanallar tekshirilmoqda…" });
    });
    es.addEventListener("done", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      res.device = d.device || (res.channels.length > 1 ? "nvr" : "camera");
      res.vendor = d.vendor || res.vendor; res.vendor_name = d.vendor_name || res.vendor_name;
      applyScan({ ...res, channels: [...res.channels] });
      finish();
    });
    es.addEventListener("error", (ev) => {
      // Server "error" hodisasi (data bor) yoki ulanish uzildi.
      let msg = "Qurilma javob bermadi";
      try { const data = (ev as MessageEvent).data; if (data) msg = JSON.parse(data).message || msg; } catch { /* jim */ }
      if (res.channels.length) { res.device = res.channels.length > 1 ? "nvr" : "camera"; applyScan({ ...res, channels: [...res.channels] }); }
      else setScanOut({ tone: "error", title: "Aniqlab boʻlmadi", text: msg });
      finish();
    });
  });

  const runScan = async () => {
    const okIp = E.set("ip", validators.ip(ip));
    const okPort = E.set("port", validators.port(port));
    if (!okIp || !okPort) return;
    cleanup();
    setScan(null); setChecked({}); probeRef.current = null;
    setScanOut({ tone: "wait", title: "Qurilma aniqlanmoqda…", text: "Shablon va kanallar tekshirilmoqda (10–30 s)" });
    setScanning(true);
    try {
      const job = await api<{ events: string }>("/api/devices/scan", { method: "POST", body: scanBody() });
      await listen(job);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) {
        try {
          const res = await api<ScanRes>("/api/admin/scan", { method: "POST", body: scanBody() });
          if (!res.found) setScanOut({ tone: "error", title: "Aniqlab boʻlmadi", text: res.message });
          else applyScan(res);
        } catch (e2) { setScanOut({ tone: "error", title: "Aniqlab boʻlmadi", text: (e2 as Error).message }); }
      } else setScanOut({ tone: "error", title: "Aniqlab boʻlmadi", text: (e as Error).message });
    }
    setScanning(false);
  };

  /* --- 3-qadam: tekshiruv --- */
  const kpSet = (open_: string, codec: string, codecMeta: string, signal: string, signalMeta: string) =>
    setKp({ open: open_, codec, codecMeta, signal, signalMeta });

  const paintProbe = (r: ProbeResult, ch: Channel | undefined) => {
    const codec = r.codec ? (r.needs_transcode ? "H.265 → H.264" : codecLabel({ codec: r.codec })) : "—";
    const meta = [fmtRes(r.resolution), r.fps ? Math.round(r.fps) + " fps" : ""].filter(Boolean).join(" · ") || "—";
    setPvMeta([r.codec ? codecLabel({ codec: r.codec }) : "", fmtRes(r.resolution), r.fps ? Math.round(r.fps) + " fps" : ""].filter(Boolean).join(" · ") || "—");
    if (r.ok) kpSet(fmtSec(r.ms), codec, meta, "Barqaror", "0 uzilish");
    else kpSet("—", codec, meta, "Javob yoʻq", r.message || "ulanmadi");
    if (!(ch && ch.snapshot_url)) setPv({ state: "offline", msg: r.ok ? "Jonli tasvir saqlangandan keyin ochiladi" : (r.message || "Kamera javob bermadi") });
  };

  const enterReview = async () => {
    setPvTime("");
    if (src !== "rtsp") {
      setImg("");
      setPv({ state: "offline", msg: "Oldindan koʻrish saqlangandan keyin" });
      setPvMeta(url.trim());
      kpSet("—", "—", "server aniqlaydi", "—", "tayyor oqim");
      return;
    }
    const pks = picked();
    const ch = pks && pks.length ? pks[0] : (scan ? scan.channels[0] : undefined);
    const rpath = (ch && ch.rtsp_path) || path.trim() || "/";
    const body = { ip: ip.trim(), port: Number(port) || 554, username: user.trim(), password: pass || null, rtsp_path: rpath, camera_id: null };
    const key = JSON.stringify(body);

    // Kadr: skan topgan kanal surati (saqlanmagan qurilmadan), 5 s da yangilanadi.
    clearInterval(snapTimer.current); snapTimer.current = 0;
    if (ch && ch.snapshot_url) {
      setPv({ state: "connecting" });
      let tries = 0;
      let have = false;
      const snap = ch.snapshot_url;
      const load = () => {
        if (++tries > 24 || stepRef.current !== 3) { clearInterval(snapTimer.current); return; }
        const u = snap + (snap.includes("?") ? "&" : "?") + "t=" + Date.now();
        const im = new Image();
        im.onload = () => { have = true; setImg(u); setPv({ state: "live" }); setPvTime(new Date().toTimeString().slice(0, 8)); };
        im.onerror = () => { if (!have) setPv({ state: "offline", msg: "Kadr olinmadi" }); };
        im.src = u;
      };
      setImg("");
      load();
      snapTimer.current = window.setInterval(load, 5000);
    } else {
      setImg("");
      setPv({ state: "connecting", msg: "Tekshirilmoqda…" });
    }

    if (probeRef.current && probeRef.current.key === key) { paintProbe(probeRef.current.r, ch); return; }
    kpSet("…", "…", "aniqlanmoqda", "…", "tekshirilmoqda");
    try {
      const r = await probeCamera({}, body);
      if (stepRef.current !== 3) return;
      probeRef.current = { key, r };
      paintProbe(r, ch);
    } catch (e) {
      if (stepRef.current !== 3) return;
      kpSet("—", "—", "—", "Javob yoʻq", (e as Error).message);
      if (!(ch && ch.snapshot_url)) setPv({ state: "offline", msg: (e as Error).message });
    }
  };

  /* --- saqlash --- */
  const save = async () => {
    for (const s of [1, 2]) {
      if (!validate(s)) { setStep(s); stepRef.current = s; setTimeout(() => validate(s), 0); return; }
    }
    setErr(null);
    const la = num(lat), ln = num(lng);
    const body = {
      name: name.trim(), region, lat: la, lng: ln,
      source_type: src, enabled: true, always_on: mode === "always", note: "",
      ip: ip.trim(), port: Number(port) || 554, username: user.trim(),
      password: pass || null, rtsp_path: path.trim() || "/stream1",
      vendor: vendorVal || "boshqa", stream_url: url.trim(),
    };
    setSaving(true);
    try {
      const pks = src === "rtsp" ? picked() : null;
      if (pks && pks.length > 1 && scan) {
        const res = await api<{ created: number }>("/api/admin/nvr/import", { method: "POST", body: {
          ip: body.ip, port: body.port, username: body.username, password: pass || "",
          vendor: scan.vendor || body.vendor, channels: pks.map((c) => c.channel).join(","),
          region: body.region, name_prefix: body.name, lat: la, lng: ln, spread_m: 60, stream: "main",
          enabled: true, probe: true, dry_run: false } });
        onClose();
        invalidateAdmin(qc);
        onSaved();
        toast(res.created + " ta kamera qoʻshildi");
      } else {
        if (pks && pks.length === 1 && scan) { body.rtsp_path = pks[0].rtsp_path || body.rtsp_path; body.vendor = scan.vendor || body.vendor; }
        const cam = await api<{ id: number }>("/api/admin/cameras", { method: "POST", body });
        onClose();
        invalidateAdmin(qc);
        onSaved();
        toast("Kamera qoʻshildi", { action: "Ochish", ms: 6000, onAction: () => nav("/?camera=" + cam.id) });
      }
    } catch (e) {
      setErr({ tone: "error", title: "Saqlanmadi", text: (e as Error).message });
    }
    setSaving(false);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && (e.target as HTMLElement).matches("input") && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (step < 3) go(step + 1); else save();
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="ad-wiz">
      <div className="ad-wiz__head" onKeyDown={onKey}>
        <div className="dialog__head">
          <h2 className="dialog__title" id="cam-title">{t("Yangi kamera")}</h2>
          <IconButton icon="xmark" size="sm" tip="Yopish" className="dialog__close" onClick={onClose} />
        </div>
        <ol className="ad-stepper" aria-label={t("Qadamlar")}>
          {STEPS.map((s, i) => {
            const st = s.n === step ? "current" : s.n <= done ? "done" : "upcoming";
            const can = s.n <= done + 1 && s.n !== step;
            return [
              i > 0 && <li key={"l" + s.n} className={cx("ad-step__line", i <= done && "is-done")} aria-hidden="true" />,
              <li key={s.n} className="ad-step" data-step={s.n} data-status={st}>
                <button type="button" className="ad-step__btn" disabled={!can} aria-current={st === "current" ? "step" : undefined}
                  onClick={() => { if (can) go(s.n); }}>
                  <span className="ad-step__mk">{st === "done"
                    ? <svg className="i xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                    : s.n}</span>
                  <span className="ad-step__lbl">{t(s.label)}</span>
                </button>
              </li>,
            ];
          })}
        </ol>
      </div>

      <div className="ad-wiz__body" onKeyDown={onKey}>
        {/* 1/3 Joylashuv */}
        <section className="ad-pane" data-pane="1" hidden={step !== 1}>
          <Fld label="Nomi" error={E.errs.name}>
            <input className="input" id="f-name" ref={E.reg("name")} maxLength={120} placeholder={t("Chorsu bozori · 1-kanal")} autoComplete="off"
              value={name} onChange={(e) => { setName(e.target.value); E.live("name", validators.required(e.target.value, "Kamera nomini kiriting")); }}
              onBlur={(e) => E.set("name", validators.required(e.target.value, "Kamera nomini kiriting"))} />
          </Fld>
          <Fld div label="Hudud" htmlFor="f-region" info="Kamera shu hudud hisobotlariga kiradi. Koordinatadan avtomatik aniqlanadi.">
            <select className="select" id="f-region" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">{t("Koordinatadan aniqlansin")}</option>
              {regionOpts.map((r) => <option key={r} value={r}>{t(r)}</option>)}
            </select>
          </Fld>
          <MiniMap ref={mm} onPick={onPick} hint="Xaritada bosing yoki markerni suring" />
          <div className="ad-grid2">
            <Fld label="Kenglik" error={E.errs.lat}>
              <input className="input mono" ref={E.reg("lat")} inputMode="decimal" placeholder="41.32660" autoComplete="off" value={lat}
                onChange={(e) => { setLat(e.target.value); E.live("lat", validators.lat(e.target.value, true)); }}
                onBlur={(e) => { E.set("lat", validators.lat(e.target.value, true)); syncCoords(); }} />
            </Fld>
            <Fld label="Uzunlik" error={E.errs.lng}>
              <input className="input mono" ref={E.reg("lng")} inputMode="decimal" placeholder="69.23450" autoComplete="off" value={lng}
                onChange={(e) => { setLng(e.target.value); E.live("lng", validators.lng(e.target.value, true)); }}
                onBlur={(e) => { E.set("lng", validators.lng(e.target.value, true)); syncCoords(); }} />
            </Fld>
          </div>
        </section>

        {/* 2/3 Ulanish */}
        <section className="ad-pane" data-pane="2" hidden={step !== 2}>
          <div className="seg" role="radiogroup" aria-label={t("Manba turi")}>
            {([["rtsp", "IP kamera (RTSP)"], ["manual", "Tayyor oqim manzili"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" className={cx(src === k && "is-on")} aria-checked={src === k} onClick={() => setSrc(k)}>{t(l)}</button>
            ))}
          </div>
          <div className="ad-pane__group" hidden={src !== "rtsp"}>
            <Fld label="Ishlab chiqaruvchi">
              <select className="select" value={vendorVal} onChange={(e) => {
                setVendor(e.target.value);
                const v = vendors.find((x) => x.id === e.target.value);
                if (!v) return;
                setPath(v.path);
                if (!port || port === "554") setPort(String(v.port));
              }}>
                {vendorOpts.map((v) => <option key={v.id} value={v.id}>{t(v.name)}</option>)}
              </select>
            </Fld>
            <div className="ad-grid-ip">
              <Fld label="IP manzil" error={E.errs.ip}>
                <input className="input mono" ref={E.reg("ip")} maxLength={100} placeholder="10.30.33.60" autoComplete="off" spellCheck={false} value={ip}
                  onChange={(e) => { setIp(e.target.value); dropScan(); E.live("ip", validators.ip(e.target.value)); }}
                  onBlur={(e) => E.set("ip", validators.ip(e.target.value))} />
              </Fld>
              <Fld label="Port" error={E.errs.port}>
                <input className="input mono" ref={E.reg("port")} inputMode="numeric" maxLength={5} autoComplete="off" value={port}
                  onChange={(e) => { setPort(e.target.value); dropScan(); E.live("port", validators.port(e.target.value)); }}
                  onBlur={(e) => E.set("port", validators.port(e.target.value))} />
              </Fld>
            </div>
            <div className="ad-grid2">
              <Fld label="Login">
                <input className="input" maxLength={100} placeholder="admin" autoComplete="off" spellCheck={false} value={user}
                  onChange={(e) => { setUser(e.target.value); dropScan(); }} />
              </Fld>
              <Fld label="Parol">
                <input className="input" type="password" maxLength={200} placeholder="••••••••" autoComplete="new-password" value={pass}
                  onChange={(e) => { setPass(e.target.value); dropScan(); }} />
              </Fld>
            </div>
            <div className="ad-row">
              <Button icon="search" disabled={scanning} onClick={runScan}>{t("Qurilmani aniqlash")}</Button>
              <InfoTip text="IP, login va parol boʻyicha qurilma turi, kanallar va RTSP yoʻli avtomatik topiladi." />
            </div>
            <AlertBox st={scanOut} />
            {scan && scan.channels.length >= 2 && (
              <div className="ad-channels">
                <div className="label-xs t-tertiary">{t("Qoʻshiladigan kanallar")}</div>
                {scan.channels.map((c) => (
                  <label key={c.channel} className="check-row ad-ch">
                    <input type="checkbox" className="check" checked={checked[c.channel] !== false}
                      onChange={(e) => setChecked((m) => ({ ...m, [c.channel]: e.target.checked }))} />
                    <span className="label-sm t-primary">{t(c.channel + "-kanal")}</span>
                    <span className="codec-tag">{(c.codec || "?") + (c.needs_transcode ? " → H.264" : "")}</span>
                    <span className="mono-xs t-tertiary ellipsis">{c.rtsp_path}</span>
                  </label>
                ))}
              </div>
            )}
            <details className="ad-more-fields">
              <summary className="label-sm t-secondary"><span data-icon="chevron-right"><Icon name="chevron-right" size="sm" /></span>{t("RTSP yoʻlini qoʻlda kiritish")}</summary>
              <Fld label="RTSP yoʻli" hint={preview} hintClass="mono-xs">
                <input className="input mono" maxLength={300} placeholder="/Streaming/Channels/101" autoComplete="off" spellCheck={false}
                  value={path} onChange={(e) => setPath(e.target.value)} />
              </Fld>
            </details>
          </div>
          <div className="ad-pane__group" hidden={src !== "manual"}>
            <Fld label="Oqim manzili" error={E.errs.url} hint="RTSP, HLS (.m3u8) yoki MP4 manzil">
              <input className="input mono" ref={E.reg("url")} maxLength={500} placeholder="rtsp://10.30.33.60:554/stream1" autoComplete="off" spellCheck={false}
                value={url} onChange={(e) => { setUrl(e.target.value); E.live("url", validators.url(e.target.value)); }}
                onBlur={(e) => E.set("url", validators.url(e.target.value))} />
            </Fld>
          </div>
        </section>

        {/* 3/3 Tekshiruv */}
        <section className="ad-pane" data-pane="3" hidden={step !== 3}>
          <div className="ad-preview" data-state={pv.state}>
            {img ? <img className="ad-preview__img" src={img} alt="" /> : <img className="ad-preview__img" alt="" />}
            <div className="ad-preview__top">
              <span className="ad-preview__badge"><span className="pulse" />{t("KADR")}</span>
              <span className="spacer" />
              <span className="mono-xs ad-preview__time">{pvTime}</span>
            </div>
            <div className="ad-preview__center">
              {pv.state === "connecting" && <><span className="spinner" /><span className="label-sm">{t(pv.msg || "Ulanmoqda…")}</span></>}
              {pv.state === "offline" && <>
                <svg className="i lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m2 2 20 20" /><path d="M9.5 4h5L17 7h3a2 2 0 0 1 2 2v7.5" /><path d="M14.1 14.1A3.5 3.5 0 1 1 9.9 9.9" /><path d="M18 20H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2.5" /></svg>
                <span className="label-sm">{t(pv.msg || "")}</span>
              </>}
            </div>
            <div className="ad-preview__bottom"><span className="mono-xs">{pvMeta}</span></div>
          </div>
          <div className="ad-kpis">
            <div className="kpi-tile">
              <span className="kpi-tile__label">{t("Ochilish vaqti")}<InfoTip text="Kameradan birinchi kadr kelguncha ketgan vaqt (ulanish tekshiruvi)." /></span>
              <span className="kpi-tile__value">{kp.open}</span>
              <span className="kpi-tile__meta">{t("birinchi kadr")}</span>
            </div>
            <div className="kpi-tile">
              <span className="kpi-tile__label">{t("Kodek")}</span>
              <span className="kpi-tile__value">{kp.codec}</span>
              <span className="kpi-tile__meta">{t(kp.codecMeta)}</span>
            </div>
            <div className="kpi-tile">
              <span className="kpi-tile__label">{t("Barqarorlik")}<InfoTip text="Tekshiruv paytida oqim uzilmasdan kelyaptimi." /></span>
              <span className="kpi-tile__value">{t(kp.signal)}</span>
              <span className="kpi-tile__meta">{t(kp.signalMeta)}</span>
            </div>
          </div>
          <Fld div label="Ishlash rejimi" htmlFor="f-mode" info="Soʻrov boʻyicha — kimdir koʻrganda ulanadi. Doim tayyor — doim ulangan, tez ochiladi, lekin resurs egallaydi.">
            <select className="select" id="f-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="ondemand">{t("Soʻrov boʻyicha")}</option>
              <option value="always">{t("Doim tayyor")}</option>
            </select>
          </Fld>
        </section>

        <AlertBox st={err} />
      </div>

      <div className="ad-wiz__foot">
        <Button variant="tertiary" onClick={onClose}>{t("Bekor qilish")}</Button>
        <span className="spacer" />
        {step > 1 && <Button onClick={() => go(step - 1)}>{t("Orqaga")}</Button>}
        {step < 3 && <Button variant="primary" onClick={() => go(step + 1)}>{t("Keyingi")}</Button>}
        {step === 3 && <Button variant="primary" icon="check" disabled={saving} onClick={save}><span>{t(saveLabel)}</span></Button>}
      </div>
    </Dialog>
  );
}
