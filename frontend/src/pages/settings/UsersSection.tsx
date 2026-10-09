/* pages/settings/UsersSection.tsx — Foydalanuvchilar (06.03) va "Yangi foydalanuvchi" (06.10).
   v3 settings/users.js dan.
   Jadval: Foydalanuvchi (avatar + F.I.Sh + login) · Rol tegi (ustun sarlavhasida InfoTip) ·
   Hududlar · Holat (Faol / Bloklangan) · Oxirgi kirish · ⋯ menyu: Tahrirlash, Parolni tiklash,
   Bloklash/Faollashtirish, Oʻchirish (confirm). Dialog — yaratish va tahrirlash (rol, hududlar —
   ko'p tanlovli popover, vaqtinchalik parol). Yaratilgach va parol tiklangach parol BIR MARTA
   ko'rsatiladi (nusxalash bilan).
   Qoidalar: o'zini bloklash/o'chirish menyuda o'chiq; parollar ro'yxatda hech qachon ko'rinmaydi. */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "@/i18n/I18nProvider";
import { useAuth } from "@/auth/AuthProvider";
import { Icon } from "@/components/Icon";
import { Alert, Button, EmptyState, IconButton, InfoTip, cx } from "@/components/ui";
import { Dialog, Menu, Popover, useConfirm, useToast } from "@/components/overlays";
import { ApiError } from "@/lib/api";
import { ROLE_LABEL, type Role } from "@/lib/types";
import { sk, useRegions, useUsers, usersApi, type AdminUser, type UserBody } from "./queries";
import { agoText, copyText, initials, tempPassword, whenText } from "./util";
import { SxSearch } from "./SxSearch";

const ROLE_HINT: Record<Role, string> = {
  admin: "Hamma boʻlimlar va sozlamalar",
  operator: "Oʻz hududlari: xarita, video devor, tasdiqlash",
  viewer: "Oʻz hududlarini faqat koʻradi",
};
const ROLE_TIP = "Administrator — barcha boʻlimlar. Operator — oʻz hududlari: xarita, video devor, tasdiqlash. Kuzatuvchi — faqat koʻrish.";

export function UsersSection({ q, setQ }: { q: string; setQ: (v: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { user: me } = useAuth();
  const usersQ = useUsers();
  const regionsQ = useRegions();
  const users = usersQ.data;
  const [menu, setMenu] = useState<{ el: HTMLElement; u: AdminUser } | null>(null);
  const [edit, setEdit] = useState<{ u: AdminUser | null } | null>(null);
  const [shown, setShown] = useState<{ login: string; pass: string; title: string } | null>(null);
  const reload = () => qc.invalidateQueries({ queryKey: sk.users });

  useEffect(() => { if (usersQ.error) toast((usersQ.error as Error).message, { tone: "error" }); }, [usersQ.error, toast]);

  const ql = q.trim().toLowerCase();
  const list = (users || []).filter((u) => !ql || (u.username + " " + (u.full_name || "")).toLowerCase().includes(ql));
  const admins = (users || []).filter((u) => u.role === "admin").length;

  async function resetPassword(u: AdminUser) {
    const ok = await confirm({
      title: "“" + u.username + "” paroli tiklansinmi?",
      text: "Joriy parol va ochiq seanslar bekor boʻladi. Yangi vaqtinchalik parol bir marta koʻrsatiladi.",
      ok: "Parolni tiklash", icon: "key",
    });
    if (!ok) return;
    let pass: string;
    try { pass = await usersApi.resetPassword(u, () => tempPassword()); }
    catch (e) { toast((e as Error).message, { tone: "error" }); return; }
    setShown({ login: u.username, pass, title: "Parol tiklandi" });
  }

  async function toggleBlock(u: AdminUser) {
    const ok = await confirm(u.is_active
      ? { title: "“" + u.username + "” bloklansinmi?", text: "U tizimga kira olmaydi, ochiq seansi yopiladi.", ok: "Bloklash", danger: true, icon: "ban" }
      : { title: "“" + u.username + "” faollashtirilsinmi?", text: "Foydalanuvchi yana tizimga kira oladi.", ok: "Faollashtirish", icon: "circle-check" });
    if (!ok) return;
    try {
      await usersApi.update(u.id, { username: u.username, full_name: u.full_name, role: u.role, regions: u.regions, is_active: !u.is_active });
    } catch (e) { toast((e as Error).message, { tone: "error" }); return; }
    toast(u.is_active ? "Foydalanuvchi bloklandi" : "Foydalanuvchi faollashtirildi");
    reload();
  }

  async function remove(u: AdminUser) {
    const ok = await confirm({
      title: "“" + (u.full_name || u.username) + "” oʻchirilsinmi?",
      text: "Foydalanuvchi va uning shaxsiy guruhlari oʻchadi. Oʻzgarishlar jurnali saqlanadi.",
      ok: "Oʻchirish", danger: true,
    });
    if (!ok) return;
    try { await usersApi.remove(u.id); }
    catch (e) { toast((e as Error).message, { tone: "error" }); return; }
    toast("Foydalanuvchi oʻchirildi");
    reload();
  }

  const self = menu ? me?.username === menu.u.username : false;

  return (
    <div className="sx-sec" data-st="foydalanuvchilar">
      <div className="sx-head">
        <h2 className="heading-lg">{t("Foydalanuvchilar")}</h2>
        <span className="body-sm t-tertiary">{users ? t(users.length + " ta · " + admins + " administrator") : ""}</span>
        <span className="spacer" />
        <SxSearch value={q} onChange={setQ} placeholder="Login yoki F.I.Sh" label="Foydalanuvchi qidirish" />
        <Button variant="primary" icon="plus" onClick={() => setEdit({ u: null })}>{t("Yangi foydalanuvchi")}</Button>
      </div>
      <div className="sx-scroll">
        <table className="tbl sx-tbl sx-users">
          {!users ? (
            <tbody><tr><td colSpan={6}><span className="skeleton" style={{ display: "block", height: 12, width: "40%" }} /></td></tr></tbody>
          ) : (
            <>
              <thead><tr>
                <th>{t("Foydalanuvchi")}</th>
                <th className="sx-c-role"><span className="sx-th">{t("Rol")}<InfoTip text={ROLE_TIP} title="Rollar" /></span></th>
                <th className="sx-c-reg">{t("Hududlar")}</th>
                <th className="sx-c-state">{t("Holat")}</th>
                <th className="sx-c-last">{t("Oxirgi kirish")}</th>
                <th className="sx-c-act"><span className="sr-only">{t("Amallar")}</span></th>
              </tr></thead>
              <tbody>
                {list.length ? list.map((u) => {
                  const name = u.full_name || u.username;
                  return (
                    <tr key={u.id} data-id={u.id} onClick={(e) => {
                      const tg = e.target as HTMLElement;
                      if (tg.closest(".infotip") || tg.closest("[data-more]")) return;
                      setEdit({ u });
                    }}>
                      <td><div className="sx-who"><span className="avatar">{initials(name)}</span><span className="sx-who__txt">
                        <span className="label-sm ellipsis t-primary">{name}{u.username === me?.username && <> <span className="t-tertiary">{t("(siz)")}</span></>}</span>
                        <span className="mono-xs t-tertiary ellipsis">{u.username}</span>
                      </span></div></td>
                      <td className="sx-c-role"><span className={cx("sx-tag", u.role === "admin" && "sx-tag--brand")}>{t(ROLE_LABEL[u.role] || u.role)}</span></td>
                      <td className="sx-c-reg"><span className="ellipsis sx-reg">{u.role === "admin" ? t("Hamma hududlar")
                        : u.regions && u.regions.length ? u.regions.join(", ") : <span className="t-warning">{t("Hudud biriktirilmagan")}</span>}</span></td>
                      <td className="sx-c-state">{u.is_active
                        ? <span className="badge" data-status="online"><span className="dot" />{t("Faol")}</span>
                        : <span className="badge" data-status="disabled"><span className="dot" />{t("Bloklangan")}</span>}</td>
                      <td className="sx-c-last t-tertiary" data-tip={u.last_login_at ? whenText(u.last_login_at) : "Hali kirmagan"}>{t(agoText(u.last_login_at))}</td>
                      <td className="sx-c-act">
                        <IconButton icon="dots-horizontal" size="sm" tip="Amallar" data-more aria-haspopup="menu"
                          onClick={(e) => { const el = e.currentTarget; setMenu((m) => (m && m.el === el ? null : { el, u })); }} />
                      </td>
                    </tr>
                  );
                }) : (
                  <tr className="sx-empty-row"><td colSpan={6}>
                    <EmptyState type="search" title={ql ? "Foydalanuvchi topilmadi" : "Hali foydalanuvchi yoʻq"}
                      text={ql ? "“" + ql + "” boʻyicha mos login yoki F.I.Sh yoʻq" : ""} />
                  </td></tr>
                )}
              </tbody>
            </>
          )}
        </table>
      </div>

      <Popover anchor={menu?.el || null} open={!!menu} onClose={() => setMenu(null)} place="bottom-end" width={220}>
        {menu && <Menu onDone={() => setMenu(null)} items={[
          { label: "Tahrirlash", icon: "pen", onClick: () => setEdit({ u: menu.u }) },
          { label: "Parolni tiklash", icon: "key", onClick: () => resetPassword(menu.u) },
          { label: menu.u.is_active ? "Bloklash" : "Faollashtirish", icon: menu.u.is_active ? "ban" : "circle-check",
            disabled: self, onClick: () => toggleBlock(menu.u) },
          "sep",
          { label: "Oʻchirish", icon: "trash", danger: true, disabled: self, onClick: () => remove(menu.u) },
        ]} />}
      </Popover>

      <UserDialog open={!!edit} user={edit?.u || null} regions={regionsQ.data || []} onClose={() => setEdit(null)}
        onSaved={(created) => {
          setEdit(null);
          if (created) setShown({ ...created, title: "Foydalanuvchi yaratildi" });
          else toast("Foydalanuvchi saqlandi");
          reload();
        }} />
      <PasswordShown data={shown} onClose={() => setShown(null)} />
    </div>
  );
}

/* ---------- 06.10 dialog ---------- */
function UserDialog({ open, user, regions, onClose, onSaved }: {
  open: boolean; user: AdminUser | null; regions: string[]; onClose: () => void;
  onSaved: (created: { login: string; pass: string } | null) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [login, setLogin] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [picked, setPicked] = useState<string[]>([]);
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickEl, setPickEl] = useState<HTMLElement | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const loginRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(user ? user.full_name || "" : "");
    setLogin(user ? user.username : "");
    setRole(user ? user.role : "operator");
    setPicked(user ? [...(user.regions || [])] : []);
    setPass(user ? "" : tempPassword());
    setErr(null); setLoginErr(null); setBusy(false); setPickOpen(false);
    const id = setTimeout(() => nameRef.current?.focus(), 40);
    return () => clearTimeout(id);
  }, [open, user]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPickOpen(false);
    const body: UserBody = {
      username: login.trim(), full_name: name.trim(), role, is_active: user ? user.is_active : true,
      regions: role === "admin" ? [] : picked,
    };
    const p = pass.trim();
    if (!user) body.password = p;
    if (!body.username) { setLoginErr("Login kiriting"); loginRef.current?.focus(); return; }
    if (!user && p.length < 8) { setErr("Parol kamida 8 belgi boʻlsin"); return; }
    setBusy(true);
    try {
      if (user) await usersApi.update(user.id, body);
      else await usersApi.create(body);
    } catch (ex) {
      setErr(ex instanceof ApiError && ex.status === 422 && body.role === "viewer"
        ? "Server “Kuzatuvchi” rolini hali qabul qilmaydi" : (ex as Error).message);
      setBusy(false);
      return;
    }
    setBusy(false);
    onSaved(user ? null : { login: body.username, pass: p });
  }

  return (
    <Dialog open={open} onClose={onClose} title={user ? "Foydalanuvchini tahrirlash" : "Yangi foydalanuvchi"} className="sx-user-dialog">
      <form onSubmit={submit} noValidate style={{ display: "contents" }}>
        <label className="field">
          <span className="field__label">{t("F.I.Sh")}</span>
          <input ref={nameRef} className="input" maxLength={120} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={cx("field", loginErr && "is-error")}>
          <span className="field__label">{t("Login")}</span>
          <input ref={loginRef} className="input" maxLength={64} autoComplete="off" spellCheck={false} autoCapitalize="off"
            value={login} onChange={(e) => setLogin(e.target.value)} />
          {loginErr && <span className="field__hint">{t(loginErr)}</span>}
        </label>
        <label className="field">
          <span className="field__label">{t("Rol")}</span>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="operator">{t("Operator")}</option>
            <option value="viewer">{t("Kuzatuvchi")}</option>
            <option value="admin">{t("Administrator")}</option>
          </select>
          <span className="field__hint">{t(ROLE_HINT[role] || "")}</span>
        </label>
        {role !== "admin" && (
          <div className="field">
            <span className="field__label" id="um-regions-label">{t("Hududlar")}</span>
            <button type="button" className="select sx-multi" id="um-regions" ref={setPickEl} aria-haspopup="listbox"
              aria-labelledby="um-regions-label um-regions" onClick={() => setPickOpen((o) => !o)}>
              <span className={cx("ellipsis", !picked.length && "t-tertiary")}>{picked.length ? picked.join(", ") : t("Hududni tanlang")}</span>
            </button>
          </div>
        )}
        {!user && (
          <div className="field">
            <span className="field__label">{t("Vaqtinchalik parol")}</span>
            <div className="input-wrap">
              <input className="input mono" maxLength={200} autoComplete="off" spellCheck={false} aria-label={t("Vaqtinchalik parol")}
                value={pass} onChange={(e) => setPass(e.target.value)} />
              <IconButton icon="rotate-cw" size="sm" tip="Yangi parol yaratish" onClick={() => setPass(tempPassword())} />
            </div>
            <span className="field__hint">{t("Birinchi kirishda oʻzgartirish tavsiya etiladi")}</span>
          </div>
        )}
        {err && <Alert tone="error" title={err} />}
        <div className="dialog__actions">
          <Button variant="tertiary" onClick={onClose}>{t("Bekor qilish")}</Button>
          <Button variant="primary" type="submit" disabled={busy}>{t(user ? "Saqlash" : "Yaratish")}</Button>
        </div>
      </form>
      <Popover anchor={pickEl} open={pickOpen && role !== "admin"} onClose={() => setPickOpen(false)} place="bottom-start"
        offset={8} width={pickEl?.offsetWidth} className="sx-regpop">
        <RegionPick regions={regions} picked={picked} setPicked={setPicked} />
      </Popover>
    </Dialog>
  );
}

function RegionPick({ regions, picked, setPicked }: { regions: string[]; picked: string[]; setPicked: (v: string[]) => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLInputElement>("input")?.focus(); }, []);
  if (!regions.length) return <div className="body-sm t-tertiary" style={{ padding: 8 }}>{t("Hududlar roʻyxati yoʻq")}</div>;
  return (
    <div className="sx-regpick" role="listbox" aria-multiselectable="true" ref={ref}>
      {regions.map((r) => (
        <label key={r} className="check-row sx-regpick__row">
          <input type="checkbox" className="check" value={r} checked={picked.includes(r)}
            onChange={(e) => setPicked(e.target.checked ? regions.filter((x) => x === r || picked.includes(x)) : picked.filter((x) => x !== r))} />
          <span>{r}</span>
        </label>
      ))}
    </div>
  );
}

/* Vaqtinchalik parol — bir marta, nusxalash bilan. */
function PasswordShown({ data, onClose }: { data: { login: string; pass: string; title: string } | null; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (data) setTimeout(() => okRef.current?.focus(), 20); }, [data]);
  const copy = async () => {
    if (!data) return;
    toast(await copyText(data.pass) ? "Parol nusxalandi" : "Nusxalab boʻlmadi — qoʻlda belgilang", { tone: "info" });
  };
  return (
    <Dialog open={!!data} onClose={onClose} title={data?.title}
      actions={<>
        <button type="button" className="btn btn--secondary" onClick={copy}><Icon name="copy" size="sm" />{t("Nusxalash")}</button>
        <Button ref={okRef} variant="primary" onClick={onClose}>{t("Tayyor")}</Button>
      </>}>
      {data && (
        <>
          <div className="field">
            <span className="field__label">{t("Vaqtinchalik parol")} · <span className="mono">{data.login}</span></span>
            <div className="input-wrap">
              <input className="input mono" readOnly value={data.pass} aria-label={t("Vaqtinchalik parol")} onFocus={(e) => e.target.select()} />
              <IconButton icon="copy" size="sm" tip="Nusxalash" onClick={copy} />
            </div>
          </div>
          <div className="alert alert--warning">
            <Icon name="triangle-exclamation" size="sm" />
            <div className="alert__body">
              <span className="alert__title">{t("Parol faqat hozir koʻrsatiladi")}</span>
              <span className="alert__text">{t("Nusxalab foydalanuvchiga yetkazing — keyin uni koʻrib boʻlmaydi.")}</span>
            </div>
          </div>
        </>
      )}
    </Dialog>
  );
}
