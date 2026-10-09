/* pages/settings/GroupDialog.tsx — kamera guruhi oynasi (v3 map/groups.js #group-modal: "Yangi guruh"
   va "Guruhni tahrirlash" rejimlari; css/map.css .mp-gm klasslari).
   Nom, rang (8 ta), "Hamma koʻrsin", kameralar ro'yxati (qidiruv, hudud, "Faqat tanlanganlar",
   hudud bo'yicha "hammasini belgilash"; 400 tadan ortig'i ko'rsatilmaydi). Tahrirda "Guruhni oʻchirish".
   Backend: POST /api/groups, PATCH /api/groups/{id}, POST /api/groups/{id}/cameras {mode:"set"},
   DELETE /api/groups/{id}. */
import "@/styles/map.css";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n/I18nProvider";
import { Icon } from "@/components/Icon";
import { Button, cx } from "@/components/ui";
import { Dialog, useConfirm, useToast } from "@/components/overlays";
import { useCameras } from "@/data/queries";
import { camStatus } from "@/lib/types";
import { groupsApi, useGroupCache, type Group } from "./queries";

export type GroupDialogMode = { kind: "new" } | { kind: "edit"; group: Group };
export const GROUP_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#ec4899", "#64748b"];

const CYR: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k",
  л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch",
  ш: "sh", ъ: "'", ь: "", э: "e", ю: "yu", я: "ya", ў: "o'", қ: "q", ғ: "g'", ҳ: "h" };
function norm(s: unknown) {
  return String(s == null ? "" : s).toLowerCase().replace(/[ʻʼ'‘’`]/g, "'")
    .replace(/[а-яёўқғҳ]/g, (c) => CYR[c] ?? c).trim();
}
const LIMIT = 400;

export function GroupDialog({ mode, count, onClose }: { mode: GroupDialogMode | null; count: number; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const cache = useGroupCache();
  const { cameras } = useCameras(!!mode);
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [shared, setShared] = useState(false);
  const [ids, setIds] = useState<number[]>([]);
  const [orig, setOrig] = useState<number[]>([]);
  const [q, setQ] = useState("");
  const [reg, setReg] = useState("");
  const [only, setOnly] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mode) return;
    const g = mode.kind === "edit" ? mode.group : null;
    setName(g ? g.name : "");
    setColor(g ? g.color || "" : GROUP_COLORS[count % GROUP_COLORS.length]);
    setShared(g ? !!g.shared : false);
    setIds(g ? [...g.camera_ids] : []);
    setOrig(g ? [...g.camera_ids] : []);
    setQ(""); setReg(""); setOnly(false); setErr(null); setBusy(false);
    const id = setTimeout(() => nameRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const regions = useMemo(() => [...new Set(cameras.map((c) => c.region))].sort(), [cameras]);
  const picked = useMemo(() => new Set(ids), [ids]);
  const changed = ids.length !== orig.length || ids.some((id, i) => id !== orig[i]);
  const list = useMemo(() => {
    const nq = norm(q);
    return cameras.filter((c) => (!reg || c.region === reg) && (!only || picked.has(c.id)) &&
      (!nq || norm(c.name + " " + (c.km != null ? c.km : "") + " " + c.region).includes(nq)));
  }, [cameras, q, reg, only, picked]);
  const byReg = useMemo(() => {
    const m = new Map<string, typeof list>();
    list.slice(0, LIMIT).forEach((c) => { if (!m.has(c.region)) m.set(c.region, []); m.get(c.region)!.push(c); });
    return m;
  }, [list]);

  if (!mode) return null;
  const g = mode.kind === "edit" ? mode.group : null;
  const lead = g
    ? (g.mine ? "Nomi, rangi, koʻrinishi va kameralari." : "Egasi: " + g.owner_name + ".") +
      (g.hidden ? " " + g.hidden + " ta kamera sizning hududingizda emas — ular oʻzgarmaydi." : "")
    : "Nom bering va kameralarni pastdagi roʻyxatdan belgilang (keyin ham qoʻshsa boʻladi).";

  const toggle = (id: number, on: boolean) => setIds((l) => (on ? (l.includes(id) ? l : [...l, id]) : l.filter((x) => x !== id)));
  const toggleRegion = (region: string, cams: { id: number }[]) => {
    const all = cams.every((c) => picked.has(c.id));
    setIds((l) => all ? l.filter((id) => !cams.some((c) => c.id === id)) : [...l, ...cams.map((c) => c.id).filter((id) => !l.includes(id))]);
    void region;
  };

  async function save() {
    const nm = name.trim();
    if (!nm) { setErr("Guruh nomini kiriting"); return; }
    setBusy(true);
    try {
      if (g) {
        let res = await groupsApi.patch(g.id, { name: nm, color, shared });
        if (changed) res = await groupsApi.setCameras(g.id, ids);
        cache.replace(res);
        toast("Guruh saqlandi" + (changed ? " · " + res.camera_ids.length + " kamera" : ""));
      } else {
        const res = await groupsApi.create({ name: nm, color, shared, camera_ids: ids });
        cache.replace(res);
        toast("“" + res.name + "” guruhi yaratildi" + (ids.length ? " · " + ids.length + " kamera" : ""));
      }
    } catch (e) { setErr((e as Error).message); setBusy(false); return; }
    cache.others();
    setBusy(false);
    onClose();
  }

  async function remove() {
    if (!g) return;
    const ok = await confirm({ title: "“" + g.name + "” oʻchirilsinmi?", text: "Kameralarning oʻziga tegilmaydi.", ok: "Oʻchirish", danger: true });
    if (!ok) return;
    try { await groupsApi.remove(g.id); }
    catch (e) { setErr((e as Error).message); return; }
    cache.drop(g.id);
    cache.others();
    onClose();
    toast("Guruh oʻchirildi");
  }

  return (
    <Dialog open onClose={onClose} title={g ? "Guruhni tahrirlash" : "Yangi guruh"} size="lg" className="mp-gm"
      actions={<>
        {g && <Button variant="tertiary" className="mp-gm__del" onClick={remove}>{t("Guruhni oʻchirish")}</Button>}
        <span className="spacer" />
        <Button variant="secondary" onClick={onClose}>{t("Bekor qilish")}</Button>
        <Button variant="primary" disabled={busy} onClick={save}>{t(g ? "Saqlash" : "Yaratish")}</Button>
      </>}>
      <p className="dialog__text">{t(lead)}</p>
      <div className="mp-gm__new">
        <label className="field">
          <span className="field__label">{t("Guruh nomi")}</span>
          <input ref={nameRef} className="input" maxLength={80} placeholder={t("Masalan: Toshkent stansiyasi")} autoComplete="off"
            value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
        </label>
        <div className="mp-gm__row">
          <div className="mp-gm__colors" role="radiogroup" aria-label={t("Guruh rangi")}>
            {GROUP_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={c === color} style={{ background: c }}
                aria-label={t("Rang " + c)} onClick={() => setColor(c)} />
            ))}
          </div>
          <label className="check-row"><input type="checkbox" className="check" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            <span>{t("Hamma koʻrsin")}</span></label>
        </div>
      </div>
      <div className="mp-gm__cams">
        <div className="mp-gm__ch">
          <span className="label-sm">{t("Kameralar")}</span>
          <span className="body-xs t-tertiary">
            <b>{ids.length}</b> {t("ta tanlangan")}
            {changed && <> · <span className="t-brand">{t("oʻzgardi")}</span></>}
            {ids.length > 0 && <> <button type="button" className="label-xs t-brand mp-gm__clear" onClick={() => setIds([])}>{t("tanlovni tozalash")}</button></>}
          </span>
        </div>
        <div className="mp-gm__tools">
          <label className="search mp-gm__q">
            <Icon name="search" size="sm" />
            <input type="search" placeholder={t("Qidirish: nomi yoki km…")} autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select className="select select--sm mp-gm__reg" value={reg} onChange={(e) => setReg(e.target.value)}>
            <option value="">{t("Barcha hududlar")}</option>
            {regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button type="button" className={cx("chip", only && "is-on")} onClick={() => setOnly((o) => !o)}>
            {t("Faqat tanlanganlar")} <span className="chip__count">{ids.length}</span>
          </button>
        </div>
        <div className="mp-gm__pick" ref={pickRef}>
          {!list.length ? (
            <div className="body-sm t-tertiary mp-gm__empty">{t(only ? "Hali kamera tanlanmagan." : "Mos kamera topilmadi.")}</div>
          ) : (
            <>
              {[...byReg.entries()].map(([region, cams]) => {
                const n = cams.filter((c) => picked.has(c.id)).length;
                return (
                  <Fragment key={region}>
                    <div className="mp-gm__rh">
                      <span className="overline">{region} · {n} / {cams.length}</span>
                      <button type="button" className="label-xs t-brand mp-gm__rall" onClick={() => toggleRegion(region, cams)}>
                        {t(n === cams.length ? "hammasini olib tashlash" : "hammasini belgilash")}
                      </button>
                    </div>
                    {cams.map((c) => {
                      const where = c.km != null ? c.km + (c.picket ? "/" + c.picket : "") + " km" : "";
                      return (
                        <label key={c.id} className="mp-gm__cam">
                          <input type="checkbox" className="check" checked={picked.has(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} />
                          <span className="dot" data-status={camStatus(c)} />
                          <span className="label-sm ellipsis">{c.name}</span>
                          {where && where !== c.name && <span className="mono-xs t-tertiary">{where}</span>}
                        </label>
                      );
                    })}
                  </Fragment>
                );
              })}
              {list.length > LIMIT && <div className="body-xs t-tertiary mp-gm__empty">{t("va yana " + (list.length - LIMIT) + " ta — qidiruv yoki hudud bilan toraytiring")}</div>}
            </>
          )}
        </div>
      </div>
      {err && <div className="field__hint t-error" role="alert">{t(err)}</div>}
    </Dialog>
  );
}
