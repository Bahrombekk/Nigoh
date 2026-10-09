/* pages/wall/snapshot.ts — kamera suratini .jpg qilib yuklab berish + toast (Figma 04.07; v3 saveSnapshot).
   const save = useSaveSnapshot(); save(cam)  — GET /api/cameras/{id}/snapshot */
import { useCallback } from "react";
import { useToast } from "@/components/overlays";
import { p2 } from "@/lib/format";
import type { Camera } from "@/lib/types";

export function useSaveSnapshot() {
  const toast = useToast();
  return useCallback(async (cam: Pick<Camera, "id" | "name">) => {
    try {
      const res = await fetch("/api/cameras/" + cam.id + "/snapshot", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
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
