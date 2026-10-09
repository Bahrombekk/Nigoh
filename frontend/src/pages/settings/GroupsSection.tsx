/* pages/settings/GroupsSection.tsx — Kamera guruhlari (06.06): barcha foydalanuvchilarning guruhlari.
   v3 settings/groups.js dan.
   Qator: ikon katak + nom + meta ("24 kamera · Toshkent shahri, Jizzax · Shaxsiy") · o'ngda
   "Video devorda" (shu guruh devorda tanlangan bo'lsa) yoki "–" · ⋯ menyu: Xaritada koʻrsatish,
   Video devorda ochish, Tahrirlash, Umumiy/Shaxsiy qilish, Oʻchirish. Qatorni bosish — tahrirlash.
   Navigatsiya: xarita — "/?group=ID"; devor — prefs "wall".group = "g:ID" (v3 kaliti) + "/wall". */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useT } from "@/i18n/I18nProvider";
import { Icon } from "@/components/Icon";
import { Button, EmptyState, IconButton } from "@/components/ui";
import { Menu, Popover, useConfirm, useToast } from "@/components/overlays";
import { usePref } from "@/lib/prefs";
import { useCameras } from "@/data/queries";
import { groupsApi, useGroupCache, useGroups, type Group } from "./queries";
import { GroupDialog, type GroupDialogMode } from "./GroupDialog";

export function GroupsSection() {
  const t = useT();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const groupsQ = useGroups();
  const cache = useGroupCache();
  const { byId } = useCameras();
  const [wall, setWall] = usePref<Record<string, unknown> | null>("wall", {});
  const [menu, setMenu] = useState<{ el: HTMLElement; g: Group } | null>(null);
  const [dlg, setDlg] = useState<GroupDialogMode | null>(null);
  const groups = groupsQ.data;

  useEffect(() => { if (groupsQ.error) toast((groupsQ.error as Error).message, { tone: "error" }); }, [groupsQ.error, toast]);

  const onWall = (g: Group) => { const w = wall || {}; return w.group === "g:" + g.id || w.group === g.id; };
  const meta = (g: Group) => {
    const cams = g.camera_ids.map((id) => byId.get(id)).filter(Boolean);
    const regions = [...new Set(cams.map((c) => c!.region).filter(Boolean))];
    const parts = [g.camera_ids.length + " kamera"];
    if (regions.length) parts.push(regions.length > 2 ? regions.length + " hudud" : regions.join(", "));
    parts.push(g.shared ? "Umumiy" : "Shaxsiy");
    if (!g.mine && g.owner_name) parts.push(g.owner_name);
    if (g.hidden) parts.push("+" + g.hidden + " yashirin");
    return parts.join(" · ");
  };
  const openEditor = (g: Group) => setDlg({ kind: "edit", group: g });

  async function toggleShared(g: Group) {
    try {
      cache.replace(await groupsApi.patch(g.id, { shared: !g.shared }));
      cache.others();
      toast(g.shared ? "Guruh shaxsiy qilindi" : "Guruh hamma uchun ochildi");
    } catch (e) { toast((e as Error).message, { tone: "error" }); }
  }
  async function remove(g: Group) {
    const ok = await confirm({ title: "“" + g.name + "” guruhi oʻchirilsinmi?",
      text: "Faqat guruh oʻchadi — kameralarga tegilmaydi.", ok: "Oʻchirish", danger: true });
    if (!ok) return;
    try { await groupsApi.remove(g.id); }
    catch (e) { toast((e as Error).message, { tone: "error" }); return; }
    cache.drop(g.id);
    cache.others();
    toast("Guruh oʻchirildi");
  }
  function openOnWall(g: Group) {
    setWall({ ...(wall || {}), group: "g:" + g.id });
    nav("/wall");
  }

  return (
    <div className="sx-sec" data-st="guruhlar">
      <div className="sx-head">
        <h2 className="heading-lg">{t("Kamera guruhlari")}</h2>
        <span className="body-sm t-tertiary">{groups ? t(groups.length + " ta guruh") : ""}</span>
        <span className="spacer" />
        <Button variant="primary" icon="plus" onClick={() => setDlg({ kind: "new" })}>{t("Yangi guruh")}</Button>
      </div>
      <div className="sx-scroll">
        {!groups ? (
          <div className="sx-glist">
            {[0, 1, 2].map((i) => (
              <div className="sx-grow" key={i}>
                <span className="skeleton" style={{ width: 36, height: 36, borderRadius: 8 }} />
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="skeleton" style={{ height: 12, width: "30%" }} />
                  <span className="skeleton" style={{ height: 10, width: "45%" }} />
                </span>
              </div>
            ))}
          </div>
        ) : groups.length ? (
          <div className="sx-glist">
            {groups.map((g) => (
              <div key={g.id} className="sx-grow" data-gid={g.id} tabIndex={0}
                onClick={(e) => { if ((e.target as HTMLElement).closest("[data-more]")) return; if (g.can_edit !== false) openEditor(g); }}
                onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) openEditor(g); }}>
                <span className="sx-gicon" style={{ ["--g-color" as string]: g.color || "" }}><Icon name="grid" /></span>
                <span className="sx-grow__txt">
                  <span className="label-md ellipsis">{g.name}</span>
                  <span className="body-xs t-tertiary ellipsis">{t(meta(g))}</span>
                </span>
                {onWall(g) ? <span className="label-sm t-success sx-grow__wall">{t("Video devorda")}</span>
                  : <span className="body-sm t-tertiary sx-grow__wall">–</span>}
                <IconButton icon="dots-horizontal" size="sm" tip="Amallar" data-more aria-haspopup="menu"
                  onClick={(e) => { const el = e.currentTarget; setMenu((m) => (m && m.el === el ? null : { el, g })); }} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState type="layer-group" title="Hali guruh yoʻq" text="Kameralarni guruhlab xarita va devorda tez oching" />
        )}
      </div>

      <Popover anchor={menu?.el || null} open={!!menu} onClose={() => setMenu(null)} place="bottom-end">
        {menu && <Menu onDone={() => setMenu(null)} items={[
          { label: "Xaritada koʻrsatish", icon: "map", onClick: () => nav("/?group=" + menu.g.id) },
          { label: "Video devorda ochish", icon: "grid", onClick: () => openOnWall(menu.g) },
          { label: "Tahrirlash", icon: "pen", disabled: menu.g.can_edit === false, onClick: () => openEditor(menu.g) },
          { label: menu.g.shared ? "Shaxsiy qilish" : "Umumiy qilish", icon: menu.g.shared ? "lock" : "users",
            disabled: menu.g.can_edit === false, onClick: () => toggleShared(menu.g) },
          "sep",
          { label: "Oʻchirish", icon: "trash", danger: true, disabled: menu.g.can_edit === false, onClick: () => remove(menu.g) },
        ]} />}
      </Popover>

      <GroupDialog mode={dlg} count={groups?.length || 0} onClose={() => setDlg(null)} />
    </div>
  );
}
