/* layout/AppShell.tsx — ilova qobig'i: Nav rail (72px), statik xira fon (xaritadan
   tashqari sahifalar), profil menyusi (07.02), yordam / klaviatura oynasi, parol dialogi.
   Sahifalar <Outlet/> ga chiziladi. body[data-tab] — joriy bo'lim (CSS shunga qaraydi). */
import { useEffect, useState, type FormEvent } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthProvider";
import { useI18n, LANG_LIST, type LangId } from "@/i18n/I18nProvider";
import { THEMES, useTheme } from "@/lib/theme";
import { api } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/types";
import { Icon } from "@/components/Icon";
import { Alert, Button, Seg } from "@/components/ui";
import { Dialog, Menu, Popover, useShortcut, useToast } from "@/components/overlays";

export const TABS = [
  { tab: "dash", path: "/dash", icon: "chart-pie", label: "Statistika", auth: true },
  { tab: "map", path: "/", icon: "map", label: "Xarita" },
  { tab: "wall", path: "/wall", icon: "grid", label: "Video devor" },
  { tab: "admin", path: "/admin", icon: "sliders", label: "Boshqaruv", admin: true },
  { tab: "settings", path: "/settings", icon: "gear", label: "Sozlamalar", admin: true },
] as const;

export function tabOf(pathname: string): string {
  const seg = pathname.split("/")[1] || "";
  return ["dash", "wall", "admin", "settings"].includes(seg) ? seg : "map";
}

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return (p.length > 1 ? p[0][0] + p[1][0] : name.slice(0, 2)).toUpperCase();
}

export function AppShell() {
  const { t, tShort } = useI18n();
  const { user, openLogin } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const tab = tabOf(loc.pathname);
  const [avatar, setAvatar] = useState<HTMLButtonElement | null>(null);
  const [profile, setProfile] = useState(false);
  const [help, setHelp] = useState(false);
  const [pw, setPw] = useState(false);

  useEffect(() => { document.body.dataset.tab = tab; }, [tab]);
  useShortcut("?", () => setHelp(true));

  const go = (path: string, needAuth?: boolean) => {
    if (needAuth && !user) { openLogin(); return; }
    nav(path);
  };

  return (
    <div id="app">
      <div id="backdrop" aria-hidden="true" />
      <nav id="rail" aria-label={t("Asosiy menyu")}>
        <button type="button" className="logo-mark" data-tip="Statistika" data-tip-place="right" aria-label={t("Statistika")}
          onClick={() => go("/dash", true)}><Icon name="eye" /></button>
        <div className="rail__gap" />
        {TABS.filter((x) => !("admin" in x) || user?.role === "admin").map((x) => (
          <button key={x.tab} type="button" className={"rail-item" + (tab === x.tab ? " is-on" : "")}
            aria-current={tab === x.tab ? "page" : undefined} onClick={() => go(x.path, "auth" in x)}>
            <span className="rail-item__ind"><Icon name={x.icon} /></span>
            <span className="rail-item__label">{tShort(x.label)}</span>
          </button>
        ))}
        <div className="spacer" />
        <button type="button" className="rail-item" id="rail-help" onClick={() => setHelp(true)}>
          <span className="rail-item__ind"><Icon name="circle-question" /></span>
          <span className="rail-item__label">{t("Yordam")}</span>
        </button>
        <button ref={setAvatar} type="button" className="avatar" data-tip-place="right"
          data-tip={user ? (user.full_name || user.username) + " · " + t(ROLE_LABEL[user.role]) : "Kirish"}
          onClick={() => (user ? setProfile((o) => !o) : openLogin())}>
          {user ? initials(user.full_name || user.username) : "?"}
        </button>
      </nav>

      <main id="pages"><Outlet /></main>

      <Popover anchor={avatar} open={profile} onClose={() => setProfile(false)} place="right-end" offset={24}>
        <ProfileMenu onClose={() => setProfile(false)} onHelp={() => setHelp(true)} onPassword={() => setPw(true)} />
      </Popover>
      <HelpDialog open={help} onClose={() => setHelp(false)} />
      <PasswordDialog open={pw} onClose={() => setPw(false)} />
    </div>
  );
}

function ProfileMenu({ onClose, onHelp, onPassword }: { onClose: () => void; onHelp: () => void; onPassword: () => void }) {
  const { t, lang, setLang } = useI18n();
  const { user, logout } = useAuth();
  const [theme, setTheme] = useTheme();
  const [langOpen, setLangOpen] = useState(false);
  const [langAnchor, setLangAnchor] = useState<HTMLButtonElement | null>(null);
  if (!user) return null;
  return (
    <div className="menu profile" role="menu">
      <div className="profile__head">
        <span className="avatar avatar--lg">{initials(user.full_name || user.username)}</span>
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span className="label-md ellipsis">{user.full_name || user.username}</span>
          <span className="body-xs t-tertiary ellipsis">{t(ROLE_LABEL[user.role])} · {user.username}</span>
        </span>
      </div>
      <div className="menu__sep" />
      <button type="button" className="menu__item" role="menuitem" onClick={() => { onClose(); onPassword(); }}>
        <Icon name="user" size="sm" /><span>{t("Profil va parol")}</span>
      </button>
      <div className="menu__label">{t("Mavzu")}</div>
      <div className="profile__seg">
        <Seg small value={theme} onChange={setTheme} items={THEMES.map((x) => ({ value: x.id, label: x.label }))} />
      </div>
      <button ref={setLangAnchor} type="button" className="menu__item" role="menuitem" onClick={() => setLangOpen((o) => !o)}>
        <Icon name="globe" size="sm" /><span>{t("Til")}: {LANG_LIST.find((l) => l.id === lang)?.label}</span>
      </button>
      <Popover anchor={langAnchor} open={langOpen} onClose={() => setLangOpen(false)} place="right-start">
        <Menu onDone={() => setLangOpen(false)} items={LANG_LIST.map((l) => ({ label: l.label, on: l.id === lang, onClick: () => setLang(l.id as LangId) }))} />
      </Popover>
      <button type="button" className="menu__item" role="menuitem" onClick={() => { onClose(); onHelp(); }}>
        <Icon name="keyboard" size="sm" /><span>{t("Klaviatura yorliqlari")}</span><span className="menu__kbd">?</span>
      </button>
      <div className="menu__sep" />
      <button type="button" className="menu__item is-danger" role="menuitem" onClick={() => {
        if (document.querySelector(".is-dirty") && !window.confirm(t("Saqlanmagan oʻzgarishlar bor. Baribir chiqasizmi?"))) return;
        logout();
      }}>
        <Icon name="arrow-right-from-bracket" size="sm" /><span>{t("Chiqish")}</span>
      </button>
    </div>
  );
}

function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const rows: [string[], string][] = [
    [["/"], "Qidiruvga oʻtish"],
    [["+", "−"], "Xaritani yaqinlashtirish / uzoqlashtirish"],
    [["L"], "Mening joylashuvim"],
    [["←", "→"], "Fokus rejimida kamerani almashtirish"],
    [["Esc"], "Ochiq menyu, panel yoki oynani yopish"],
    [["?"], "Shu oyna"],
  ];
  return (
    <Dialog open={open} onClose={onClose} title="Klaviatura yorliqlari" size="md"
      actions={<>
        <Button variant="secondary" onClick={() => {
          onClose();
          // Tanishtiruv xaritada: boshqa sahifadan bosilsa avval xaritaga o'tiladi (MapPage hodisani tinglaydi).
          const onMap = tabOf(location.hash.replace(/^#/, "")) === "map";
          if (!onMap) nav("/");
          setTimeout(() => window.dispatchEvent(new CustomEvent("nigoh:tour")), onMap ? 0 : 600);
        }}>{t("Tanishtiruvni qayta koʻrish")}</Button>
        <Button variant="primary" onClick={onClose}>{t("Yopish")}</Button>
      </>}>
      <div className="help-keys">
        {rows.map(([keys, text]) => (
          <div key={text}>{keys.map((k) => <span key={k} className="kbd">{k}</span>)}<span>{t(text)}</span></div>
        ))}
      </div>
    </Dialog>
  );
}

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState(""); const [nw, setNw] = useState(""); const [rep, setRep] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setCur(""); setNw(""); setRep(""); setErr(null); } }, [open]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (nw.length < 8) { setErr("Yangi parol kamida 8 belgi boʻlsin"); return; }
    if (nw !== rep) { setErr("Parollar mos kelmadi"); return; }
    try {
      await api("/api/auth/password", { method: "POST", body: { current: cur, new: nw } });
      onClose(); toast("Parol yangilandi");
    } catch (ex) { setErr((ex as Error).message); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Profil va parol">
      <form onSubmit={submit} style={{ display: "contents" }}>
        <div className="detail-row" style={{ border: 0, padding: 0 }}>
          <span className="detail-row__k">{t("Login")}</span><span className="detail-row__v mono">{user?.username}</span>
        </div>
        <label className="field"><span className="field__label">{t("Joriy parol")}</span>
          <input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} autoFocus /></label>
        <label className="field"><span className="field__label">{t("Yangi parol")}</span>
          <input className="input" type="password" autoComplete="new-password" value={nw} onChange={(e) => setNw(e.target.value)} />
          <span className="field__hint">{t("Kamida 8 belgi")}</span></label>
        <label className="field"><span className="field__label">{t("Yangi parolni takrorlang")}</span>
          <input className="input" type="password" autoComplete="new-password" value={rep} onChange={(e) => setRep(e.target.value)} /></label>
        {err && <Alert tone="error" title={err} />}
        <div className="dialog__actions">
          <Button variant="secondary" onClick={onClose}>{t("Bekor qilish")}</Button>
          <Button variant="primary" type="submit">{t("Saqlash")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Xaritadan tashqari sahifalar: statik fon ustida "sheet" (88,16 dan). */
export function PageSheet({ id, className = "", children }: { id: string; className?: string; children: React.ReactNode }) {
  return (
    <section className="page page--sheet" id={id}>
      <div className={"sheet " + className}>{children}</div>
    </section>
  );
}
