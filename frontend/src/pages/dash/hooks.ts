/* pages/dash/hooks.ts — dashboard hook'lari va karta holati yordamchilari:
   useDashNav (kamera / hudud / admin o'tishlari), useRetry ("Qayta urinish" — barcha statistika
   so'rovlari qayta yuklanadi), is404 (eski serverda endpoint yo'q). */
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";

/* ---------- Navigatsiya ---------- */
/** Admin sahifasiga filtr ishorasi (README.md: "Boshqaruv filtri"). */
export interface AdminFilterHint {
  /** "offline" — Diqqat talab qiladi → Barchasi */
  status?: "offline";
  /** Maʼlumot sifati tekshiruvi kaliti (no_location, probe_failed, …) */
  quality?: string;
  /** Aniq kameralar (id) — sifat tekshiruvi ro'yxati (ko'pi bilan 50 ta, server shuncha beradi) */
  ids?: number[];
  /** Filtr yorlig'i (o'zbekcha, t() bilan tarjima qilinadi) */
  label?: string;
  /** Tekshiruvdagi jami kamchiliklar soni (ids dan ko'p bo'lishi mumkin) */
  count?: number;
}
export type AdminAction = "new-camera" | "sync";

export function useDashNav() {
  const nav = useNavigate();
  return {
    camera: (id: number) => nav("/?camera=" + id),
    /** Hudud xaritada: kameralar ro'yxati shu hudud nomi bilan filtrlanadi (v2/v3 xatti-harakati). */
    region: (region: string) => nav("/?q=" + encodeURIComponent(region)),
    map: () => nav("/"),
    wall: () => nav("/wall"),
    settings: (sub: string) => nav("/settings/" + sub),
    admin: (adminFilter?: AdminFilterHint, adminAction?: AdminAction) =>
      nav("/admin", { state: { adminFilter, adminAction } }),
  };
}

/* ---------- Karta holatlari ---------- */
/** "Qayta urinish" — barcha statistika so'rovlari keshdan o'chirilib qayta so'raladi (v3 invalidate()). */
export function useRetry() {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: ["stats"] }); };
}

export const is404 = (e: unknown) => e instanceof ApiError && e.status === 404;
