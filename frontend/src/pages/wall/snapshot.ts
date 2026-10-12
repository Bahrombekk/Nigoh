/* pages/wall/snapshot.ts — kamera suratini .jpg qilib yuklab berish + toast (Figma 04.07; v3 saveSnapshot).
   const save = useSaveSnapshot(); save(cam, video?)

   Surat — EKRANDAGI JORIY KADR: video o'ynab turgan bo'lsa kadr canvas'ga
   chiziladi. Ilgari doim GET /api/cameras/{id}/snapshot olinardi — u fon
   xizmati bir necha daqiqa oldin saqlagan surat, ya'ni foydalanuvchi
   ko'rib turgan lahza emas edi (foydalanuvchi shikoyati). Video yo'q yoki
   hali kadr kelmagan bo'lsa — server surati (zaxira).
   `video` berilmasa shu kameraning ekrandagi eng katta o'ynayotgan videosi
   qidiriladi (devor katagi, Fokus, drawer). */
import { useCallback } from "react";
import { useToast } from "@/components/overlays";
import { p2 } from "@/lib/format";
import type { Camera } from "@/lib/types";

function playingVideoOf(id: number): HTMLVideoElement | null {
  const list = [...document.querySelectorAll<HTMLVideoElement>('.wl-tile[data-id="' + id + '"] video')];
  const ok = list.filter((v) => v.readyState >= 2 && v.videoWidth > 0);
  ok.sort((a, b) => b.clientWidth - a.clientWidth);
  return ok[0] || null;
}

function frameOf(video: HTMLVideoElement | null | undefined): Promise<Blob | null> {
  if (!video || video.readyState < 2 || !video.videoWidth) return Promise.resolve(null);
  try {
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext("2d")!.drawImage(video, 0, 0, c.width, c.height);
    return new Promise((ok) => c.toBlob((b) => ok(b), "image/jpeg", 0.92));
  } catch {
    return Promise.resolve(null);            // canvas "tainted" va h.k. — server suratiga
  }
}

export function useSaveSnapshot() {
  const toast = useToast();
  return useCallback(async (cam: Pick<Camera, "id" | "name">, video?: HTMLVideoElement | null) => {
    try {
      let blob = await frameOf(video || playingVideoOf(cam.id));
      if (!blob) {
        const res = await fetch("/api/cameras/" + cam.id + "/snapshot", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        blob = await res.blob();
      }
      const url = URL.createObjectURL(blob);
      const d = new Date();
      const name = String(cam.name).replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") +
        "_" + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + ".jpg";
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast("Surat saqlandi · " + name, {
        tone: "info", action: "Ochish", ms: 6000,
        onAction: () => window.open(url, "_blank", "noopener"),
      });
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch {
      toast("Surat olinmadi", { tone: "error" });
    }
  }, [toast]);
}
