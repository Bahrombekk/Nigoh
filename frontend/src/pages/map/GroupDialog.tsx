/* pages/map/GroupDialog.tsx — kamera guruhi oynasi (v3 #group-modal, map/groups.js):
   mavjud guruhga qo'shish, yangi guruh, tahrirlash — har kamera katakcha bilan.
   Backend: POST /api/groups, PATCH/DELETE /api/groups/{id}, POST /api/groups/{id}/cameras {camera_ids, mode}.
   Guruh rangi — foydalanuvchi tanlagan ma'lumot (inline style), token emas. */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "@/i18n/I18nProvider";
import { Icon } from "@/components/Icon";
import { Button, cx } from "@/components/ui";
import { Dialog, useConfirm, useToast } from "@/components/overlays";
import { api } from "@/lib/api";
import type { Camera } from "@/lib/types";
import { GROUPS_KEY, useMap, type Group } from "./model";
import { IconSpan } from "./Panel";
import { camStatus, norm } from "./util";

export const GROUP_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#ec4899", "#64748b"];
const colorOf = (g: Group) => g.color || "var(--color-bg-brand)";

export type GroupModal =
  | { kind: "picker"; ids: number[]; title: string }
  | { kind: "edit"; group: Group };

export function useGroupCache() {
  const qc = useQueryClient();
  return {
    replace: (g: Group) => qc.setQueryData<Group[]>(GROUPS_KEY, (list = []) =>
      list.some((x) => x.id === g.id) ? list.map((x) => (x.id === g.id ? g : x)) : [g, ...list]),
    remove: (id: number) => qc.setQueryData<Group[]>(GROUPS_KEY, (list = []) => list.filter((x) => x.id !== id)),
  };
}

export function GroupDialog({ modal, onClose, onSaved }: { modal: GroupModal | null; onClose: () => void; onSaved: (manyIds: boolean) => void }) {
  const t = useT();
  const m = useMap();
  const toast = useToast();
  const confirm = useConfirm();
  const cache = useGroupCache();
  const nameRef = useRef<HTMLInputElement>(null);

  const editable = useMemo(() => m.groups.filter((g) => g.can_edit), [m.groups]);
  const ids = modal?.kind === "picker" ? modal.ids : [];
  const mode: "add" | "new" | "edit" = modal?.kind === "edit" ? "edit" : ids.length && editable.length ? "add" : "new";

  const [target, setTarget] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [shared, setShared] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editIds, setEditIds] = useState<number[] | null>(null);
  const [origIds, setOrigIds] = useState<number[]>([]);
  const [camQ, setCamQ] = useState("");
  const [camReg, setCamReg] = useState("");
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [busy, setBusy] = useState(false);

  // Oyna ochilganda shakl to'ldiriladi (v3 openPicker / openEditor).
  useEffect(() => {
    if (!modal) return;
    setErr(null);
    setTarget(null);
    setCamQ(""); setCamReg(""); setOnlyPicked(false);
    if (modal.kind === "edit") {
      const g = modal.group;
      setName(g.name || ""); setColor(g.color || ""); setShared(!!g.shared);
      setEditIds([...g.camera_ids]); setOrigIds([...g.camera_ids]);
    } else {
      setName(""); setColor(GROUP_COLORS[m.groups.length % GROUP_COLORS.length]); setShared(false);
      if (modal.ids.length) { setEditIds(null); setOrigIds([]); }
      else { setEditIds([]); setOrigIds([]); }
    }
    const h = setTimeout(() => nameRef.current?.focus(), 60);
    return () => clearTimeout(h);
  }, [modal]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!modal) return null;

  const title = modal.kind === "edit" ? "Guruhni tahrirlash" : ids.length ? "Guruhga qoʻshish" : "Yangi guruh";
  const lead = modal.kind === "edit"
    ? (modal.group.mine ? "Nomi, rangi, koʻrinishi va kameralari." : "Egasi: " + modal.group.owner_name + ".") +
      (modal.group.hidden ? " " + modal.group.hidden + " ta kamera sizning hududingizda emas — ular oʻzgarmaydi." : "")
    : ids.length
      ? (ids.length === 1 && modal.title ? modal.title + " — " : ids.length + " ta kamera — ") +
        (editable.length ? "mavjud guruhni tanlang yoki yangisini yarating." : "yangi guruhga nom bering.")
      : "Nom bering va kameralarni pastdagi roʻyxatdan belgilang (keyin ham qoʻshsa boʻladi).";
  const changed = !!editIds && (editIds.length !== origIds.length || editIds.some((id, i) => id !== origIds[i]));

  const save = async () => {
    if (busy) return;
    const nm = name.trim();
    setBusy(true);
    try {
      if (modal.kind === "edit") {
        if (!nm) { setErr("Guruh nomini kiriting"); return; }
        let g = await api<Group>("/api/groups/" + modal.group.id, { method: "PATCH", body: { name: nm, color, shared } });
        if (changed && editIds) {
          g = await api<Group>("/api/groups/" + modal.group.id + "/cameras", { method: "POST", body: { camera_ids: editIds, mode: "set" } });
        }
        cache.replace(g);
        toast("Guruh saqlandi" + (changed ? " · " + g.camera_ids.length + " kamera" : ""));
      } else if (mode === "add" && target != null) {
        const g = await api<Group>("/api/groups/" + target + "/cameras", { method: "POST", body: { camera_ids: ids, mode: "add" } });
        cache.replace(g);
        toast(ids.length + " ta kamera “" + g.name + "” guruhiga qoʻshildi");
      } else {
        if (!nm) { setErr("Guruh nomini kiriting"); return; }
        const list = ids.length ? ids : (editIds || []);
        const g = await api<Group>("/api/groups", { method: "POST", body: { name: nm, color, shared, camera_ids: list } });
        cache.replace(g);
        toast("“" + g.name + "” guruhi yaratildi" + (list.length ? " · " + list.length + " kamera" : ""));
      }
    } catch (e) { setErr((e as Error).message); return; }
    finally { setBusy(false); }
    onClose();
    onSaved(ids.length > 1);
  };

  const remove = async () => {
    if (modal.kind !== "edit") return;
    const g = modal.group;
    const ok = await confirm({ title: "“" + g.name + "” oʻchirilsinmi?", text: "Kameralarning oʻziga tegilmaydi.", ok: "Oʻchirish", danger: true });
    if (!ok) return;
    try { await api("/api/groups/" + g.id, { method: "DELETE" }); }
    catch (e) { setErr((e as Error).message); return; }
    onClose();
    cache.remove(g.id);
    toast("Guruh oʻchirildi");
  };

  const showNew = !(mode === "add" && target != null);
  const showCams = !!editIds;

  return (
    <Dialog open onClose={onClose} title={title} size={showCams ? "lg" : "md"} className="mp-gm"
      actions={<>
        {modal.kind === "edit" && <Button variant="tertiary" className="mp-gm__del" id="gm-delete" onClick={remove}>{t("Guruhni oʻchirish")}</Button>}
        <span className="spacer" />
        <Button variant="secondary" onClick={onClose}>{t("Bekor qilish")}</Button>
        <Button variant="primary" id="gm-save" disabled={busy} onClick={save}>
          {t(modal.kind === "edit" ? "Saqlash" : ids.length ? "Qoʻshish" : "Yaratish")}
        </Button>
      </>}>
      <p className="dialog__text" id="gm-lead">{t(lead)}</p>
      {mode === "add" && (
        <div className="mp-gm__list" id="gm-list">
          {editable.map((g) => {
            const has = ids.filter((id) => g.camera_ids.includes(id)).length;
            return (
              <button key={g.id} type="button" className={cx("mp-gm__opt", target === g.id && "is-on")} data-g={g.id} onClick={() => setTarget(g.id)}>
                <i style={{ background: colorOf(g) }} />
                <span className="label-sm">{g.name}</span>
                <span className="body-xs t-tertiary">{t(g.camera_ids.length + " kamera" +
                  (has ? " · " + (has === ids.length ? "hammasi bor" : has + " tasi bor") : ""))}</span>
              </button>
            );
          })}
          <button type="button" className={cx("mp-gm__opt", target == null && "is-on")} data-g="new" onClick={() => setTarget(null)}>
            <i className="mp-gm__plus"><Icon name="plus" size="xs" /></i>
            <span className="label-sm">{t("Yangi guruh")}</span><span className="body-xs t-tertiary">{t("nom berib yaratish")}</span>
          </button>
        </div>
      )}
      {showNew && (
        <div className="mp-gm__new" id="gm-new">
          <label className="field">
            <span className="field__label">{t("Guruh nomi")}</span>
            <input ref={nameRef} className="input" id="gm-name" maxLength={80} placeholder={t("Masalan: Toshkent stansiyasi")} autoComplete="off"
              value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
          </label>
          <div className="mp-gm__row">
            <div className="mp-gm__colors" id="gm-colors" role="radiogroup" aria-label={t("Guruh rangi")}>
              {GROUP_COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={c === color} data-c={c} style={{ background: c }}
                  aria-label={t("Rang") + " " + c} onClick={() => setColor(c)} />
              ))}
            </div>
            <label className="check-row"><input type="checkbox" className="check" id="gm-shared" checked={shared} onChange={(e) => setShared(e.target.checked)} /><span>{t("Hamma koʻrsin")}</span></label>
          </div>
        </div>
      )}
      {showCams && editIds && (
        <CamPicker editIds={editIds} setEditIds={setEditIds} changed={changed} q={camQ} setQ={setCamQ}
          reg={camReg} setReg={setCamReg} onlyPicked={onlyPicked} setOnlyPicked={setOnlyPicked}
          confirmClear={async () => editIds.length <= 5 || await confirm({ title: editIds.length + " ta tanlangan kamera olib tashlansinmi?", ok: "Olib tashlash" })} />
      )}
      {err && <div className="field__hint t-error" id="gm-err" role="alert">{t(err)}</div>}
    </Dialog>
  );
}

function CamPicker({ editIds, setEditIds, changed, q, setQ, reg, setReg, onlyPicked, setOnlyPicked, confirmClear }: {
  editIds: number[]; setEditIds: (v: number[]) => void; changed: boolean;
  q: string; setQ: (v: string) => void; reg: string; setReg: (v: string) => void;
  onlyPicked: boolean; setOnlyPicked: (v: boolean) => void; confirmClear: () => Promise<boolean>;
}) {
  const t = useT();
  const m = useMap();
  const boxRef = useRef<HTMLDivElement>(null);
  const picked = useMemo(() => new Set(editIds), [editIds]);
  const regions = useMemo(() => [...new Set(m.cameras.map((c) => c.region))].sort(), [m.cameras]);
  const qn = norm(q);
  const cams = m.cameras.filter((c) =>
    (!reg || c.region === reg) && (!onlyPicked || picked.has(c.id)) &&
    (!qn || norm(c.name + " " + (c.km != null ? c.km : "") + " " + c.region).includes(qn)));
  const LIMIT = 400;
  const byReg = new Map<string, Camera[]>();
  cams.slice(0, LIMIT).forEach((c) => {
    if (!byReg.has(c.region)) byReg.set(c.region, []);
    byReg.get(c.region)!.push(c);
  });

  const toggleRegion = (region: string) => {
    const rows = cams.slice(0, LIMIT).filter((c) => c.region === region).map((c) => c.id);
    const every = rows.every((id) => picked.has(id));
    if (every) setEditIds(editIds.filter((id) => !rows.includes(id)));
    else setEditIds([...editIds, ...rows.filter((id) => !picked.has(id))]);
  };
  const toggle = (id: number, on: boolean) => {
    if (on) { if (!picked.has(id)) setEditIds([...editIds, id]); }
    else setEditIds(editIds.filter((x) => x !== id));
  };

  return (
    <div className="mp-gm__cams" id="gm-cams">
      <div className="mp-gm__ch">
        <span className="label-sm">{t("Kameralar")}</span>
        <span className="body-xs t-tertiary" id="gm-cams-n">
          <b>{editIds.length}</b>{t(" ta tanlangan")}
          {changed && <> · <span className="t-brand">{t("oʻzgardi")}</span></>}
          {!!editIds.length && <> <button type="button" className="label-xs t-brand mp-gm__clear"
            onClick={async () => { if (await confirmClear()) setEditIds([]); }}>{t("tanlovni tozalash")}</button></>}
        </span>
      </div>
      <div className="mp-gm__tools">
        <label className="search mp-gm__q">
          <IconSpan name="search" size="sm" />
          <input type="search" id="gm-cam-q" placeholder={t("Qidirish: nomi yoki km…")} autoComplete="off" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
        </label>
        <select className="select select--sm mp-gm__reg" id="gm-cam-reg" value={reg} onChange={(e) => setReg(e.target.value)}>
          <option value="">{t("Barcha hududlar")}</option>
          {regions.map((r) => <option key={r} value={r}>{t(r)}</option>)}
        </select>
        <button type="button" className={cx("chip", onlyPicked && "is-on")} id="gm-only" onClick={() => setOnlyPicked(!onlyPicked)}>
          {t("Faqat tanlanganlar")} <span className="chip__count">{editIds.length}</span>
        </button>
      </div>
      <div className="mp-gm__pick" id="gm-pick" ref={boxRef}>
        {!cams.length ? (
          <div className="body-sm t-tertiary mp-gm__empty">{t(onlyPicked ? "Hali kamera tanlanmagan." : "Mos kamera topilmadi.")}</div>
        ) : (
          <>
            {[...byReg.entries()].map(([region, list]) => {
              const n = list.filter((c) => picked.has(c.id)).length;
              return (
                <Fragment key={region}>
                  <div className="mp-gm__rh">
                    <span className="overline">{t(region) + " · " + n + " / " + list.length}</span>
                    <button type="button" className="label-xs t-brand mp-gm__rall" data-r={region} onClick={() => toggleRegion(region)}>
                      {t(n === list.length ? "hammasini olib tashlash" : "hammasini belgilash")}
                    </button>
                  </div>
                  {list.map((c) => {
                    const where = c.km != null ? c.km + (c.picket ? "/" + c.picket : "") + " km" : "";
                    return (
                      <label key={c.id} className="mp-gm__cam">
                        <input type="checkbox" className="check" data-id={c.id} checked={picked.has(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} />
                        <span className="dot" data-status={camStatus(c)} />
                        <span className="label-sm ellipsis">{c.name}</span>
                        {where && where !== c.name && <span className="mono-xs t-tertiary">{where}</span>}
                      </label>
                    );
                  })}
                </Fragment>
              );
            })}
            {cams.length > LIMIT && <div className="body-xs t-tertiary mp-gm__empty">{t("va yana " + (cams.length - LIMIT) + " ta — qidiruv yoki hudud bilan toraytiring")}</div>}
          </>
        )}
      </div>
    </div>
  );
}
