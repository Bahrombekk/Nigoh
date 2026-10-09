/* pages/admin/MediaMtxDialog.tsx — "Media sozlamalari" (v3 admin.js MediaMtxPanel):
   GET /api/admin/mediamtx/config — bazadagi kameralardan yaratilgan MediaMTX konfiguratsiyasi;
   "Faylga yozish va qoʻllash" — POST /api/admin/mediamtx/sync. */
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button, IconButton } from "@/components/ui";
import { Dialog, useToast } from "@/components/overlays";
import { useT } from "@/i18n/I18nProvider";

export function MediaMtxDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const [text, setText] = useState("…");
  const [lead, setLead] = useState("Bazadagi kameralardan yaratilgan MediaMTX konfiguratsiyasi.");
  const [busy, setBusy] = useState(false);
  const applyRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setText("Yuklanmoqda…");
    setTimeout(() => applyRef.current?.focus(), 30);
    api<{ text: string; api_available: boolean }>("/api/admin/mediamtx/config").then((r) => {
      if (!live) return;
      setText(r.text);
      setLead(r.api_available
        ? "MediaMTX ishlab turibdi — oʻzgarishlar qayta ishga tushirmasdan qoʻllanadi."
        : "MediaMTX hozir ishlamayapti — fayl yoziladi, keyin MediaMTXʼni ishga tushiring.");
    }).catch((e: Error) => { if (live) setText(e.message); });
    return () => { live = false; };
  }, [open]);

  const apply = async () => {
    setBusy(true);
    try {
      const r = await api<{ written: number; live: { ok: boolean; message: string } }>("/api/admin/mediamtx/sync", { method: "POST" });
      onClose();
      toast(r.written + " ta kamera yozildi · " + r.live.message, { tone: r.live.ok ? "success" : "error" });
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg" className="ad-dlg">
      <div className="dialog__head">
        <div className="ad-dlg__titles">
          <h2 className="dialog__title">{t("Media sozlamalari")}</h2>
          <span className="body-sm t-tertiary">{t(lead)}</span>
        </div>
        <IconButton icon="xmark" size="sm" tip="Yopish" className="dialog__close" onClick={onClose} />
      </div>
      <pre className="ad-config mono-sm" data-no-i18n>{text === "Yuklanmoqda…" ? t(text) : text}</pre>
      <div className="dialog__actions">
        <Button variant="tertiary" onClick={onClose}>{t("Yopish")}</Button>
        <Button ref={applyRef} variant="primary" disabled={busy} onClick={apply}>{t("Faylga yozish va qoʻllash")}</Button>
      </div>
    </Dialog>
  );
}
