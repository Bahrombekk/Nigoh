/* auth/LoginScreen.tsx — 01 Kirish (Figma 01.01–01.04): xarita fonida shishasimon karta,
   o'ng tepada Preferences/Bar (til + 3 mavzu). Xato: "Yana N ta urinish qoldi",
   429 — "N daqiqadan keyin"; seans tugasa — "Qayta kiring" + Info alert. */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./AuthProvider";
import { useI18n, LANG_LIST, type LangId } from "@/i18n/I18nProvider";
import { THEMES, useTheme } from "@/lib/theme";
import { api, ApiError } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { Alert, Button, Check, InfoTip } from "@/components/ui";
import { Popover, Menu, useToast } from "@/components/overlays";

interface PublicInfo { site_name?: string; version?: string; public_view?: boolean; guest_view?: boolean }

export function PrefBar() {
  const { t, lang, setLang } = useI18n();
  const [theme, setTheme] = useTheme();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="prefbar">
      <button ref={setAnchor} type="button" className="prefbar__lang" aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        <Icon name="globe" size="sm" />
        <span>{LANG_LIST.find((l) => l.id === lang)?.label}</span>
        <Icon name="chevron-down" size="sm" />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} place="bottom-start" className="popover--login">
        <Menu onDone={() => setOpen(false)} items={LANG_LIST.map((l) => ({
          label: l.label, on: l.id === lang, onClick: () => setLang(l.id as LangId),
        }))} />
      </Popover>
      <span className="prefbar__sep" />
      <div className="prefbar__themes" role="radiogroup" aria-label={t("Mavzu")}>
        {THEMES.map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={theme === x.id} data-tip={x.label}
            aria-label={t(x.label)} onClick={() => setTheme(x.id)}>
            <Icon name={x.icon} size="sm" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function LoginScreen() {
  const { loginOpen, loginReason, login, enterGuest, me } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const info = useQuery({ queryKey: ["public-info"], queryFn: () => api<PublicInfo>("/api/public/info"), staleTime: 300_000 });
  const [user, setUser] = useState(() => { try { return localStorage.getItem("nigoh-login") || ""; } catch { return ""; } });
  const [pass, setPass] = useState("");
  const [remember, setRemember] = useState(() => !!user);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ title: string; text?: string; field?: boolean } | null>(null);
  const [shake, setShake] = useState(false);
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loginOpen) return;
    setPass(""); setErr(null);
    setTimeout(() => (user ? passRef : userRef).current?.focus(), 60);
  }, [loginOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loginOpen) return null;
  const expired = loginReason === "expired";
  const version = info.data?.version || me?.version;
  const guestOk = !!(info.data?.public_view || info.data?.guest_view || me?.public_view);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user.trim()) { userRef.current?.focus(); return; }
    if (!pass) { passRef.current?.focus(); return; }
    setBusy(true);
    try {
      const m = await login(user.trim(), pass, remember);
      try { if (remember) localStorage.setItem("nigoh-login", m.username || ""); else localStorage.removeItem("nigoh-login"); } catch { /* */ }
      toast(t("Xush kelibsiz") + ", " + (m.full_name || m.username));
    } catch (ex) {
      const a = ex as ApiError;
      if (a.status === 429) {
        const s = Number(a.body.retry_after) || 300;
        setErr({ title: "Juda koʻp urinish", text: t("{0} daqiqadan keyin qayta urinib koʻring").replace("{0}", String(Math.ceil(s / 60))) });
      } else if (a.status === 401 || a.status === 403) {
        const left = a.body.remaining;
        setErr({ title: a.status === 403 ? a.message : "Login yoki parol notoʻgʻri",
                 text: typeof left === "number" ? t("Yana {0} ta urinish qoldi").replace("{0}", String(left)) : undefined, field: true });
      } else setErr({ title: "Kirib boʻlmadi", text: a.message });
      setShake(false); requestAnimationFrame(() => setShake(true));
      passRef.current?.select();
    } finally { setBusy(false); }
  }

  return (
    <div className={"login open" + (shake ? " is-shake" : "")} role="dialog" aria-modal="true" aria-labelledby="l-title">
      <div className="login__bg" aria-hidden="true" />
      <div className="login__veil" aria-hidden="true" />
      <PrefBar />
      <form className="login__card" noValidate onSubmit={submit}>
        <div className="login__brand">
          <span className="logo-mark"><Icon name="eye" /></span>
          <span><b className="heading-lg">{info.data?.site_name || me?.site_name || "NIGOH"}</b><i className="body-sm t-tertiary">{t("Video nazorat tizimi")}</i></span>
        </div>
        <h1 className="heading-xl" id="l-title">{t(expired ? "Qayta kiring" : "Tizimga kirish")}</h1>
        {expired && !err && (
          <Alert tone="info" title="Seans tugadi" text={t("{0} soatlik seans muddati tugadi · xavfsizlik uchun").replace("{0}", String(me?.session_hours || 12))} />
        )}
        {err && <Alert tone="error" title={err.title} text={err.text} />}
        <div className="login__fields">
          <label className="field">
            <span className="field__label">{t("Login")}</span>
            <input ref={userRef} className="input" autoComplete="username" spellCheck={false} autoCapitalize="off"
              value={user} onChange={(e) => setUser(e.target.value)} />
          </label>
          <label className={"field" + (err?.field ? " is-error" : "")}>
            <span className="field__label">{t("Parol")}</span>
            <span className="input-wrap">
              <input ref={passRef} className="input" type={show ? "text" : "password"} autoComplete="current-password"
                placeholder={t("Parolni kiriting")} value={pass} onChange={(e) => { setPass(e.target.value); if (err?.field) setErr({ ...err, field: false }); }} />
              <button type="button" className="icon-btn icon-btn--sm" data-tip={show ? "Parolni yashirish" : "Parolni koʻrsatish"}
                aria-label={t(show ? "Parolni yashirish" : "Parolni koʻrsatish")} onClick={() => { setShow(!show); passRef.current?.focus(); }}>
                <Icon name={show ? "eye-slash" : "eye"} size="sm" />
              </button>
            </span>
            {err?.field && <span className="field__hint"><Icon name="triangle-exclamation" size="sm" />{t("Klaviatura tili va Caps Lockʼni tekshiring")}</span>}
          </label>
        </div>
        <label className="check-row"><Check checked={remember} onChange={setRemember} /><span>{t("Shu qurilmada eslab qolish")}</span></label>
        <Button variant="primary" block type="submit" disabled={busy}>{t("Kirish")}</Button>
        {guestOk && !expired && (
          <div className="login__guest">
            <button type="button" className="label-sm t-brand" onClick={enterGuest}>{t("Mehmon sifatida koʻrish")}</button>
            <InfoTip text="Faqat xarita va kamera holati, video va boshqaruvsiz." />
          </div>
        )}
        <div className="login__foot body-xs t-tertiary">{(version ? "v" + version + " · " : "") + t("Barqaror va xavfsiz nazorat")}</div>
      </form>
    </div>
  );
}
