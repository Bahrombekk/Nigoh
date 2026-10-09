/* pages/admin/CameraDrawer.tsx — o'ng drawer "Kamerani tahrirlash" (v3 camera-form.js CameraDrawer;
   Figma 05.09): nomi, hudud, oqim manzili (mono "ip:port/yo'l"), kodek (faqat ko'rish), rejim, faol;
   "Qoʻshimcha sozlamalar" — ishlab chiqaruvchi, login/parol, koordinata + mini xarita, izoh.
   "Tekshirish" — saqlamasdan ulanishni sinash.
   Tuzoqlar: parol bo'sh → null (server eskisini saqlaydi); external_id, km, piket, temir yo'l
   qayta yuboriladi — PUT ularni o'chirib yubormasin. */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { Button, IconButton } from "@/components/ui";
import { useToast } from "@/components/overlays";
import { useT } from "@/i18n/I18nProvider";
import { AlertBox, Fld, useErrs, type AlertState } from "./FormBits";
import { MiniMap, type MiniMapHandle } from "./MiniMap";
import { invalidateAdmin, useRegionList, useVendors } from "./queries";
import { codecLabel, fmtRes, fmtSec, num, parseRtsp, probeCamera, regionAt, validators, type AdminCamera } from "./util";

export function CameraDrawer({ cam, onClose }: { cam: AdminCamera | null; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const open = !!cam;
  const vendors = useVendors(open).data || [];
  const regions = useRegionList(open);
  const E = useErrs();
  const mm = useRef<MiniMapHandle>(null);
  const regionSeq = useRef(0);

  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState("ondemand");
  const [enabled, setEnabled] = useState(true);
  const [vendor, setVendor] = useState("boshqa");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [note, setNote] = useState("");
  const [more, setMore] = useState(false);
  const [testOut, setTestOut] = useState<AlertState | null>(null);
  const [err, setErr] = useState<AlertState | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const rtsp = cam?.source_type === "rtsp";

  useEffect(() => {
    if (!cam) return;
    setName(cam.name || "");
    setRegion(cam.region || "");
    let p = cam.rtsp_path || "/";
    if (!p.startsWith("/")) p = "/" + p;
    setUrl(cam.source_type === "rtsp" ? (cam.ip ? cam.ip + ":" + (cam.port || 554) + p : "") : (cam.raw_stream_url || ""));
    setMode(cam.always_on ? "always" : "ondemand");
    setEnabled(cam.enabled !== false);
    setVendor(cam.vendor || "boshqa");
    setUser(cam.username || "");
    setPass("");
    setLat(cam.lat != null && cam.lat !== 0 ? Number(cam.lat).toFixed(5) : "");
    setLng(cam.lng != null && cam.lng !== 0 ? Number(cam.lng).toFixed(5) : "");
    setNote(cam.note || "");
    setMore(false);
    setTestOut(null); setErr(null); setTesting(false); setSaving(false);
    E.reset();
    setTimeout(() => document.getElementById("e-name")?.focus(), 30);
  }, [cam]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [open, onClose]);

  useEffect(() => { if (more) mm.current?.show(num(lat), num(lng)); }, [more]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cam) return null;

  const vendorOpts = vendors.length ? vendors : [{ id: "boshqa", name: "Boshqa", path: "/stream1", port: 554 }];
  const vendorVal = vendorOpts.some((v) => v.id === vendor) ? vendor : vendorOpts[0].id;
  const regionOpts = region && !regions.includes(region) ? [region, ...regions] : regions;
  const lbl = codecLabel(cam);

  const checkUrl = (v: string) => {
    if (rtsp) {
      if (!v.trim()) return "Oqim manzilini kiriting";
      const p = parseRtsp(v);
      if (!p) return "Format: IP:port/yoʻl";
      const e = validators.ip(p.ip);
      if (e) return e;
      return validators.port(p.port);
    }
    return validators.url(v);
  };

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

  const parts = () => {
    if (!rtsp) return { ip: cam.ip || "", port: cam.port || 554, path: cam.rtsp_path || "/stream1", user: user.trim(), pass: null as string | null };
    const p = parseRtsp(url);
    return { ip: p?.ip || "", port: p?.port || 554, path: p?.path || "/",
             user: p && p.user != null ? p.user : user.trim(), pass: p && p.pass != null ? p.pass : (pass || null) };
  };

  const test = async () => {
    if (!E.set("url", checkUrl(url))) return;
    const p = parts();
    setTestOut({ tone: "wait", title: "Tekshirilmoqda…", text: "10 soniyagacha" });
    setTesting(true);
    try {
      const r = await probeCamera(cam, { ip: p.ip, port: p.port, username: p.user, password: p.pass, rtsp_path: p.path, camera_id: cam.id });
      const meta = [r.codec ? (r.needs_transcode ? "H.265 → H.264" : codecLabel({ codec: r.codec })) : "", fmtRes(r.resolution),
                    r.fps ? Math.round(r.fps) + " fps" : "", fmtSec(r.ms)].filter(Boolean).join(" · ");
      if (r.ok) setTestOut({ tone: "success", title: "Ulanish barqaror", text: meta });
      else setTestOut({ tone: "error", title: r.message || "Ulanmadi", text: meta });
    } catch (e) { setTestOut({ tone: "error", title: "Tekshirib boʻlmadi", text: (e as Error).message }); }
    setTesting(false);
  };

  const save = async () => {
    let ok = E.set("name", validators.required(name, "Kamera nomini kiriting"));
    ok = E.set("url", checkUrl(url)) && ok;
    const latErr = validators.lat(lat, false), lngErr = validators.lng(lng, false);
    if (latErr || lngErr) { setMore(true); E.set("lat", latErr); E.set("lng", lngErr); ok = false; }
    if (!ok) return;
    const p = parts();
    const body = {
      name: name.trim(), region, lat: num(lat), lng: num(lng),
      source_type: cam.source_type, enabled,
      always_on: mode === "always", note: note.trim(),
      external_id: cam.external_id || "", node_id: cam.node_id || 1,
      rail_line_id: cam.rail_line_id ?? null, km: cam.km ?? null, picket: cam.picket ?? null,
      ip: p.ip, port: p.port, username: p.user, password: p.pass || null, rtsp_path: p.path,
      vendor: vendorVal || cam.vendor || "boshqa",
      stream_url: rtsp ? (cam.raw_stream_url || "") : url.trim(),
    };
    setSaving(true);
    setErr(null);
    try {
      await api("/api/admin/cameras/" + cam.id, { method: "PUT", body });
      onClose();
      invalidateAdmin(qc);
      toast("Oʻzgarishlar saqlandi");
    } catch (e) {
      setErr({ tone: "error", title: "Saqlanmadi", text: (e as Error).message });
    }
    setSaving(false);
  };

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" && (e.target as HTMLElement).matches("input") && !e.nativeEvent.isComposing) { e.preventDefault(); save(); }
  };

  return createPortal(
    <div className="dialog-backdrop ad-drawer-bd open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="ad-drawer" role="dialog" aria-modal="true" aria-labelledby="ed-title" onKeyDown={onKey}>
        <div className="ad-drawer__head">
          <div className="ad-drawer__titles">
            <h2 className="heading-lg" id="ed-title">{t("Kamerani tahrirlash")}</h2>
            <span className="body-xs t-tertiary ellipsis">{t(cam.name + " · ID " + cam.id)}</span>
          </div>
          <IconButton icon="xmark" size="sm" tip="Yopish" onClick={onClose} />
        </div>
        <div className="ad-drawer__body">
          <Fld label="Nomi" error={E.errs.name}>
            <input className="input" id="e-name" ref={E.reg("name")} maxLength={120} autoComplete="off" value={name}
              onChange={(e) => { setName(e.target.value); E.live("name", validators.required(e.target.value, "Kamera nomini kiriting")); }}
              onBlur={(e) => E.set("name", validators.required(e.target.value, "Kamera nomini kiriting"))} />
          </Fld>
          <Fld label="Hudud">
            <select className="select" value={region} onChange={(e) => setRegion(e.target.value)}>
              {regionOpts.map((r) => <option key={r} value={r}>{t(r)}</option>)}
            </select>
          </Fld>
          <Fld label={rtsp ? "Oqim manzili (RTSP)" : "Oqim manzili"} error={E.errs.url}>
            <input className="input mono" ref={E.reg("url")} maxLength={500} autoComplete="off" spellCheck={false} value={url}
              onChange={(e) => { setUrl(e.target.value); E.live("url", checkUrl(e.target.value)); }}
              onBlur={(e) => E.set("url", checkUrl(e.target.value))} />
          </Fld>
          <Fld div label="Kodek" htmlFor="e-codec" info="Kameradan avtomatik aniqlanadi. H.265 brauzerda ochilmasa server H.264 ga oʻgiradi.">
            <select className="select" id="e-codec" disabled>
              <option>{lbl === "—" ? t("Hali aniqlanmagan") : lbl + (cam.transcode ? " " + t("(oʻgirish)") : "")}</option>
            </select>
          </Fld>
          <Fld label="Ishlash rejimi">
            <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="ondemand">{t("Soʻrov boʻyicha")}</option>
              <option value="always">{t("Doim tayyor")}</option>
            </select>
          </Fld>
          <div className="ad-switch-row">
            <span className="label-md" id="e-enabled-lbl">{t("Kamera faol (kuzatiladi)")}</span>
            <button type="button" className="switch" role="switch" aria-checked={enabled} aria-labelledby="e-enabled-lbl"
              onClick={() => setEnabled((v) => !v)} />
          </div>
          <AlertBox st={testOut} />
          <details className="ad-more-fields" open={more} onToggle={(e) => setMore((e.target as HTMLDetailsElement).open)}>
            <summary className="label-sm t-secondary"><span data-icon="chevron-right"><Icon name="chevron-right" size="sm" /></span>{t("Qoʻshimcha sozlamalar")}</summary>
            <div className="ad-pane__group">
              <Fld label="Ishlab chiqaruvchi">
                <select className="select" value={vendorVal} onChange={(e) => setVendor(e.target.value)}>
                  {vendorOpts.map((v) => <option key={v.id} value={v.id}>{t(v.name)}</option>)}
                </select>
              </Fld>
              <div className="ad-grid2">
                <Fld label="Login">
                  <input className="input" maxLength={100} autoComplete="off" spellCheck={false} value={user} onChange={(e) => setUser(e.target.value)} />
                </Fld>
                <Fld label="Parol" hint="Boʻsh qoldirilsa — saqlangan parol oʻzgarmaydi">
                  <input className="input" type="password" maxLength={200} placeholder="••••••••" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
                </Fld>
              </div>
              <div className="ad-grid2">
                <Fld label="Kenglik" error={E.errs.lat}>
                  <input className="input mono" ref={E.reg("lat")} inputMode="decimal" autoComplete="off" value={lat}
                    onChange={(e) => { setLat(e.target.value); E.live("lat", validators.lat(e.target.value, false)); }}
                    onBlur={(e) => { E.set("lat", validators.lat(e.target.value, false)); syncCoords(); }} />
                </Fld>
                <Fld label="Uzunlik" error={E.errs.lng}>
                  <input className="input mono" ref={E.reg("lng")} inputMode="decimal" autoComplete="off" value={lng}
                    onChange={(e) => { setLng(e.target.value); E.live("lng", validators.lng(e.target.value, false)); }}
                    onBlur={(e) => { E.set("lng", validators.lng(e.target.value, false)); syncCoords(); }} />
                </Fld>
              </div>
              <MiniMap ref={mm} small onPick={onPick} hint="Xaritada bosing yoki markerni suring" />
              <Fld label="Izoh">
                <textarea className="textarea" maxLength={500} placeholder={t("Masalan: 3-qavat, kirish eshigi")} value={note} onChange={(e) => setNote(e.target.value)} />
              </Fld>
            </div>
          </details>
          <AlertBox st={err} />
        </div>
        <div className="ad-drawer__foot">
          <Button icon="play" disabled={!rtsp || testing} onClick={test}>{t("Tekshirish")}</Button>
          <span className="spacer" />
          <Button variant="tertiary" onClick={onClose}>{t("Bekor qilish")}</Button>
          <Button variant="primary" disabled={saving} onClick={save}>{t("Saqlash")}</Button>
        </div>
      </aside>
    </div>, document.body);
}
