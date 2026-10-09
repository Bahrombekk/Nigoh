/* layout/Sysbar.tsx — Toolbar / Tizim: "● Tizim barqaror" + soat + qo'ng'iroq (07.01 bildirishnomalar).
   Bir nechta joyda turishi mumkin (xarita toolbar'i, sahifa sarlavhalari) — ma'lumot umumiy (Query kesh). */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/auth/AuthProvider";
import { useMarkRead, useNotifications, useSystemState } from "@/data/queries";
import { apiOk } from "@/lib/api";
import { fmtDateShort, fmtHm, fmtTime } from "@/lib/format";
import { Icon } from "@/components/Icon";
import { Seg } from "@/components/ui";
import { Popover } from "@/components/overlays";
import type { Notice } from "@/lib/types";

const STATUS = { ok: "online", degraded: "no-video", down: "offline" } as const;

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  return now;
}
function useApiOk() {
  const [ok, setOk] = useState(apiOk());
  useEffect(() => {
    const h = (e: Event) => setOk((e as CustomEvent).detail.ok);
    window.addEventListener("nigoh:api-status", h);
    return () => window.removeEventListener("nigoh:api-status", h);
  }, []);
  return ok;
}

export function Sysbar({ flat }: { flat?: boolean }) {
  const { t } = useI18n();
  const { user, guest } = useAuth();
  const nav = useNavigate();
  const now = useClock();
  const ok = useApiOk();
  const sys = useSystemState(!!user || guest);
  const notices = useNotifications("all", !!user);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  const st = !ok ? "offline" : sys.data ? STATUS[sys.data.state] : "unknown";
  const label = !ok ? "Aloqa yoʻq" : sys.data?.label || "Tekshirilmoqda";
  const bad = (sys.data?.services || []).filter((s) => s.state !== "ok").map((s) => t(s.name)).join(", ");
  const unread = notices.data?.unread || 0;

  return (
    <div className={"sysbar" + (flat ? " sysbar--flat" : "")}>
      <button type="button" className="badge sysbar__state" data-status={st}
        data-tip={bad ? t("Muammo") + ": " + bad : "Barcha xizmatlar faol"}
        onClick={() => { if (user?.role === "admin") nav("/settings/tizim"); }}>
        <span className="dot" />{t(label)}
      </button>
      <span className="sysbar__div" />
      <span className="sysbar__clock">
        <span className="sysbar__time">{fmtTime(now)}</span>
        <span className="sysbar__date">{fmtDateShort(now)}</span>
      </span>
      {user && (
        <span className="bell">
          <button ref={setAnchor} type="button" className="icon-btn bell__btn" data-tip="Bildirishnomalar"
            aria-label={t("Bildirishnomalar") + (unread ? ", " + unread : "")} onClick={() => setOpen((o) => !o)}>
            <Icon name="bell" />
          </button>
          {unread > 0 && <span className="bell__badge">{unread > 99 ? "99+" : unread}</span>}
          <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} className="popover--bare">
            <NoticePanel onClose={() => setOpen(false)} />
          </Popover>
        </span>
      )}
    </div>
  );
}

const SEV_ICON: Record<string, string> = { error: "camera-slash", success: "camera", warning: "triangle-exclamation", info: "circle-info" };

function dayKey(ts: string) {
  const d = new Date(ts).getTime();
  const n = new Date();
  const start = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return d >= start ? "Bugun" : d >= start - 86400000 ? "Kecha" : "Oldin";
}

function NoticePanel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const [type, setType] = useState<"all" | "outage" | "system">("all");
  const q = useNotifications(type);
  const mark = useMarkRead();
  const c = q.data?.counts;
  const items = q.data?.items || [];
  let last = "";

  const openItem = (n: Notice) => {
    if (!n.read) mark.mutate({ ids: [n.id] });
    onClose();
    if (n.camera_id) nav("/?camera=" + n.camera_id);
  };

  return (
    <div className="notif">
      <div className="notif__head">
        <div className="notif__title">
          <span className="heading-sm">{t("Bildirishnomalar")}</span>
          {!!q.data?.unread && <span className="badge badge--count badge--solid">{q.data.unread}</span>}
          <span className="spacer" />
          {!!q.data?.unread && <button type="button" className="label-sm t-brand" onClick={() => mark.mutate({ all: true })}>{t("Hammasi oʻqildi")}</button>}
        </div>
        <Seg value={type} onChange={setType} items={[
          { value: "all", label: "Hammasi", count: c?.all },
          { value: "outage", label: "Uzilishlar", count: c?.outage },
          { value: "system", label: "Tizim", count: c?.system },
        ]} />
      </div>
      <div className="notif__list">
        {!items.length && (
          <div className="empty"><div className="empty__icon"><Icon name="bell" size="lg" /></div>
            <div className="empty__title">{t(q.isPending ? "Yuklanmoqda…" : "Bildirishnoma yoʻq")}</div></div>
        )}
        {items.map((n) => {
          const g = dayKey(n.ts);
          const head = g !== last ? (last = g) : null;
          return (
            <div key={n.id}>
              {head && <div className="notif__group overline">{t(head)}</div>}
              <button type="button" className={"notif__item" + (n.read ? "" : " is-unread")} onClick={() => openItem(n)}>
                <span className="notif__ic" data-sev={n.severity}><Icon name={SEV_ICON[n.severity] || "circle-info"} size="sm" /></span>
                <span className="notif__txt"><span className="notif__t">{t(n.title)}</span><span className="notif__s">{t(n.text || "")}</span></span>
                <span className="notif__meta"><span className="notif__time">{fmtHm(n.ts)}</span>{!n.read && <span className="dot dot--brand" />}</span>
              </button>
            </div>
          );
        })}
      </div>
      <div className="notif__foot">
        <button type="button" className="label-sm t-brand" onClick={() => { onClose(); nav("/dash"); }}>{t("Barcha hodisalar")} →</button>
      </div>
    </div>
  );
}
