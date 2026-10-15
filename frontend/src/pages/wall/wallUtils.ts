/* pages/wall/wallUtils.ts — Video devor katagi uchun sof yordamchilar (WallTile, WallPage, FocusView):
   isDown (kamera uzilgan / o'chirilgan), fmtCodec ("H.265"), fmtSec (ochilish vaqti "1,8 s"). */
import { camStatus, type Camera } from "@/lib/types";

export function isDown(cam: Camera) {
  const s = camStatus(cam);
  return s === "offline" || s === "disabled";
}

export function fmtCodec(codec: string | null | undefined) {
  if (!codec) return "—";
  const c = String(codec).toUpperCase();
  const m = c.match(/^H\.?(\d{3})$/);
  return m ? "H." + m[1] : c;
}

export function fmtSec(ms: number | null | undefined) {
  if (ms == null || !isFinite(ms)) return "—";
  return (ms / 1000).toFixed(1).replace(".", ",") + " s";
}
