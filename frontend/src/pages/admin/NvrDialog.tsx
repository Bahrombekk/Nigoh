/* pages/admin/NvrDialog.tsx — "Registratordan qoʻshish" (v3 admin/nvr.js): NVR manzili va kanallari,
   "Kanallarni aniqlash" (skaner), "Tekshirish" (dry run — jadvalda har kanal holati), "Qoʻshish".
   Joy mini xaritada tanlanadi (hudud avtomatik), kameralar shu nuqta atrofiga tarqatiladi.
   "Qoʻshish" tekshiruvda kamida bitta kanal javob bersa yoki skaner kanal topsa ochiladi.
   Maydonlar oynalar orasida saqlanadi (v3 dagidek). */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button, IconButton } from "@/components/ui";
import { Dialog, useToast } from "@/components/overlays";
import { useT } from "@/i18n/I18nProvider";
import { AlertBox, Fld, useErrs, type AlertState } from "./FormBits";
import { MiniMap, type MiniMapHandle } from "./MiniMap";
import { invalidateAdmin, useRegionList, useVendors } from "./queries";
import { num, regionAt, validators } from "./util";

interface Planned { channel: number; ok: boolean | null; codec?: string | null; transcode?: boolean; message?: string }

export function NvrDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const vendors = useVendors(open).data || [];
  const regions = useRegionList(open);
  const E = useErrs();
  const mm = useRef<MiniMapHandle>(null);
  const regionSeq = useRef(0);

  const [ip, setIp] = useState("");
  const [port, setPort] = useState("554");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [vendor, setVendor] = useState("hikvision");
  const [channels, setChannels] = useState("1-16");
  const [stream, setStream] = useState("main");
  const [spread, setSpread] = useState("120");
  const [region, setRegion] = useState("");
  const [prefix, setPrefix] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [out, setOut] = useState<AlertState | null>(null);
  const [err, setErr] = useState<AlertState | null>(null);
  const [planned, setPlanned] = useState<Planned[] | null>(null);
  const [canSave, setCanSave] = useState(false);
  const [busy, setBusy] = useState<"" | "scan" | "check" | "save">("");

  useEffect(() => {
    if (!open) return;
    setErr(null); setOut(null); setPlanned(null); setCanSave(false); setVendor("hikvision");
    E.reset();
    setTimeout(() => { mm.current?.show(num(lat), num(lng)); document.getElementById("n-ip")?.focus(); }, 30);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const regionOpts = region && !regions.includes(region) ? [region, ...regions] : regions;
  const vendorVal = vendors.some((v) => v.id === vendor) ? vendor : vendors[0]?.id || "";

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

  const body = (dryRun: boolean) => ({
    ip: ip.trim(), port: Number(port) || 554, username: user.trim(), password: pass, vendor: vendorVal,
    channels: channels.trim(), region, name_prefix: prefix.trim(), lat: num(lat), lng: num(lng),
    spread_m: Number(spread) || 0, stream, probe: true, dry_run: dryRun,
  });

  const validate = (b: ReturnType<typeof body>) => {
    let ok = E.set("ip", validators.ip(ip));
    ok = E.set("port", validators.port(port)) && ok;
    ok = E.set("lat", validators.lat(lat, true)) && ok;
    ok = E.set("lng", validators.lng(lng, true)) && ok;
    if (!ok) setErr({ tone: "error", title: "Maydonlarni tekshiring", text: b.lat == null ? "Registrator joyini xaritada tanlang" : "" });
    else setErr(null);
    return ok;
  };

  const run = async (dryRun: boolean) => {
    const b = body(dryRun);
    if (!validate(b)) return;
    setBusy(dryRun ? "check" : "save");
    setOut({ tone: "wait", title: "Kanallar tekshirilmoqda…", text: "Biroz kuting" });
    try {
      const res = await api<{ planned: Planned[]; reachable: number; created: number }>("/api/admin/nvr/import", { method: "POST", body: b });
      setPlanned(res.planned || []);
      const ok = res.reachable;
      if (dryRun) {
        setOut({ tone: ok ? "success" : "error", title: res.planned.length + " ta kanaldan " + ok + " tasi javob berdi",
                 text: ok ? "«Qoʻshish» tugmasini bosing" : "Manzil, login va parolni tekshiring" });
        setCanSave(ok !== 0);
      } else {
        onClose();
        invalidateAdmin(qc);
        onSaved();
        toast(res.created + " ta kamera qoʻshildi");
      }
    } catch (e) {
      setOut({ tone: "error", title: "Bajarilmadi", text: (e as Error).message });
    }
    setBusy("");
  };

  const scan = async () => {
    if (!E.set("ip", validators.ip(ip))) return;
    setBusy("scan");
    setOut({ tone: "wait", title: "Qurilma aniqlanmoqda…", text: "Kanallar sanalmoqda (10–30 s)" });
    try {
      const res = await api<{ found: boolean; message?: string; vendor: string; vendor_name: string; channels: { channel: number }[] }>(
        "/api/admin/scan", { method: "POST", body: { ip: ip.trim(), port: Number(port) || 554, username: user.trim(), password: pass || "" } });
      if (!res.found) setOut({ tone: "error", title: "Aniqlab boʻlmadi", text: res.message });
      else {
        if (vendors.some((o) => o.id === res.vendor)) setVendor(res.vendor);
        setChannels(res.channels.map((c) => c.channel).join(","));
        setOut({ tone: "success", title: "Qurilma aniqlandi: " + res.vendor_name,
                 text: res.channels.length + " ta jonli kanal · hudud va nuqtani belgilab «Qoʻshish»ni bosing" });
        setCanSave(true);
      }
    } catch (e) { setOut({ tone: "error", title: "Aniqlab boʻlmadi", text: (e as Error).message }); }
    setBusy("");
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg" className="ad-dlg">
      <div className="dialog__head">
        <div className="ad-dlg__titles">
          <h2 className="dialog__title">{t("Registratordan qoʻshish")}</h2>
          <span className="body-sm t-tertiary">{t("Bitta NVR/DVR dagi kanallar birdaniga qoʻshiladi; javob bermaganlari oʻtkazib yuboriladi.")}</span>
        </div>
        <IconButton icon="xmark" size="sm" tip="Yopish" className="dialog__close" onClick={onClose} />
      </div>
      <div className="ad-dlg__body">
        <div className="ad-grid-ip">
          <Fld label="NVR manzili" error={E.errs.ip}>
            <input className="input mono" id="n-ip" ref={E.reg("ip")} maxLength={100} placeholder="192.168.1.100" autoComplete="off" spellCheck={false}
              value={ip} onChange={(e) => setIp(e.target.value)} onBlur={(e) => E.set("ip", validators.ip(e.target.value))} />
          </Fld>
          <Fld label="Port" error={E.errs.port}>
            <input className="input mono" inputMode="numeric" maxLength={5} autoComplete="off"
              value={port} onChange={(e) => setPort(e.target.value)} onBlur={(e) => E.set("port", validators.port(e.target.value))} />
          </Fld>
        </div>
        <div className="ad-grid2">
          <Fld label="Login">
            <input className="input" maxLength={100} placeholder="admin" autoComplete="off" spellCheck={false} value={user} onChange={(e) => setUser(e.target.value)} />
          </Fld>
          <Fld label="Parol">
            <input className="input" type="password" maxLength={200} placeholder="••••••••" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </Fld>
        </div>
        <div className="ad-grid2">
          <Fld label="Ishlab chiqaruvchi">
            <select className="select" value={vendorVal} onChange={(e) => setVendor(e.target.value)}>
              {vendors.map((v) => <option key={v.id} value={v.id}>{t(v.name)}</option>)}
            </select>
          </Fld>
          <Fld label="Kanallar">
            <input className="input mono" placeholder={t("1-16 yoki 1,3,5-8")} maxLength={200} autoComplete="off" value={channels} onChange={(e) => setChannels(e.target.value)} />
          </Fld>
        </div>
        <div className="ad-grid2">
          <Fld label="Oqim turi">
            <select className="select" value={stream} onChange={(e) => setStream(e.target.value)}>
              <option value="main">{t("Asosiy — sifatli, ogʻirroq")}</option>
              <option value="sub">{t("Qoʻshimcha — yengil")}</option>
            </select>
          </Fld>
          <Fld label="Nuqtalar orasi (metr)" info="Kanallar tanlangan nuqta atrofiga spiral boʻylab tarqatiladi — keyin har birini oʻz joyiga surish mumkin.">
            <input className="input mono" inputMode="numeric" maxLength={4} autoComplete="off" value={spread} onChange={(e) => setSpread(e.target.value)} />
          </Fld>
        </div>
        <div className="ad-grid2">
          <Fld label="Hudud">
            <select className="select" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">{t("Koordinatadan aniqlansin")}</option>
              {regionOpts.map((r) => <option key={r} value={r}>{t(r)}</option>)}
            </select>
          </Fld>
          <Fld label="Nom boshidagi soʻz">
            <input className="input" placeholder={t("Chorsu")} maxLength={100} autoComplete="off" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
          </Fld>
        </div>
        <MiniMap ref={mm} small onPick={onPick} hint="Registrator joyini xaritada bosing" />
        <div className="ad-grid2">
          <Fld label="Kenglik" error={E.errs.lat}>
            <input className="input mono" inputMode="decimal" placeholder="41.32660" autoComplete="off" value={lat}
              onChange={(e) => setLat(e.target.value)} onBlur={(e) => { E.set("lat", validators.lat(e.target.value, false)); syncCoords(); }} />
          </Fld>
          <Fld label="Uzunlik" error={E.errs.lng}>
            <input className="input mono" inputMode="decimal" placeholder="69.23450" autoComplete="off" value={lng}
              onChange={(e) => setLng(e.target.value)} onBlur={(e) => { E.set("lng", validators.lng(e.target.value, false)); syncCoords(); }} />
          </Fld>
        </div>
        <AlertBox st={out} />
        {planned && planned.length > 0 && (
          <div className="ad-ntable">
            <table className="tbl">
              <thead><tr><th>{t("Kanal")}</th><th>{t("Holat")}</th><th>{t("Kodek")}</th><th>{t("Izoh")}</th></tr></thead>
              <tbody>
                {planned.map((p) => {
                  const st = p.ok === null ? "unknown" : p.ok ? "online" : "offline";
                  const tx = p.ok === null ? "—" : p.ok ? "Javob berdi" : "Javobsiz";
                  return (
                    <tr key={p.channel}>
                      <td className="mono-xs">{t(p.channel + "-kanal")}</td>
                      <td><span className="badge" data-status={st}><span className="dot" data-status={st} />{t(tx)}</span></td>
                      <td><span className="codec-tag">{(p.codec || "—") + (p.transcode ? " → H.264" : "")}</span></td>
                      <td><span className="ellipsis" title={p.message}>{p.message || ""}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <AlertBox st={err} />
      </div>
      <div className="dialog__actions ad-dlg__foot">
        <Button variant="tertiary" onClick={onClose}>{t("Bekor qilish")}</Button>
        <span className="spacer" />
        <Button icon="search" disabled={busy === "scan"} onClick={scan}>{t("Kanallarni aniqlash")}</Button>
        <Button disabled={busy === "check"} onClick={() => run(true)}>{t("Tekshirish")}</Button>
        <Button variant="primary" disabled={!canSave || busy === "save"} onClick={() => run(false)}>{t("Qoʻshish")}</Button>
      </div>
    </Dialog>
  );
}
