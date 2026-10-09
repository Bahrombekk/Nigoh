/* data/queries.ts — server ma'lumotlari (TanStack Query).
   useMe            — /api/auth/me (kim kirgan, sayt nomi, poll_s, til)
   useCameras       — /api/cameras, har poll_s soniyada (standart 30); byId xaritasi
   useSystemState   — /api/system/state (sysbar "Tizim barqaror")
   useNotifications — /api/notifications?type=…; useMarkRead — o'qildi
   Sahifalar o'z so'rovlarini shu uslubda (queryKey + api()) qo'shadi. */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Camera, Me, NoticeList, SystemState } from "@/lib/types";

export const qk = {
  me: ["me"] as const,
  cameras: ["cameras"] as const,
  system: ["system-state"] as const,
  notices: (type: string) => ["notifications", type] as const,
};

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => api<Me>("/api/auth/me"),
    staleTime: 60_000,
    retry: (n) => n < 30,
    retryDelay: 2000,
  });
}

export function usePollSeconds(): number {
  const { data } = useMe();
  return Math.max(10, data?.poll_s || 30);
}

export function useCameras(enabled = true) {
  const poll = usePollSeconds();
  const q = useQuery({
    queryKey: qk.cameras,
    queryFn: async () => {
      const r = await api<Camera[] | { cameras: Camera[] }>("/api/cameras");
      return Array.isArray(r) ? r : r.cameras || [];
    },
    enabled,
    refetchInterval: poll * 1000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const byId = useMemo(() => new Map((q.data || []).map((c) => [c.id, c])), [q.data]);
  return { ...q, cameras: q.data || [], byId };
}

export function useSystemState(enabled = true) {
  const poll = usePollSeconds();
  return useQuery({
    queryKey: qk.system,
    queryFn: () => api<SystemState>("/api/system/state"),
    enabled,
    refetchInterval: poll * 1000,
    retry: false,
  });
}

export function useNotifications(type: "all" | "outage" | "system", enabled = true) {
  const poll = usePollSeconds();
  return useQuery({
    queryKey: qk.notices(type),
    queryFn: () => api<NoticeList>("/api/notifications?type=" + type + "&limit=50"),
    enabled,
    refetchInterval: poll * 1000,
    retry: false,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids: string[] } | { all: true }) =>
      api<{ unread: number }>("/api/notifications/read", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
