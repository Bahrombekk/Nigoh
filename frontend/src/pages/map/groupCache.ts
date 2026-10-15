/* pages/map/groupCache.ts — xarita guruhlari keshini qo'lda yangilash (useGroupCache):
   replace(g) — guruhni almashtirish / boshiga qo'shish, remove(id) — o'chirish (GROUPS_KEY so'rovi). */
import { useQueryClient } from "@tanstack/react-query";
import { GROUPS_KEY, type Group } from "./model";

export function useGroupCache() {
  const qc = useQueryClient();
  return {
    replace: (g: Group) => qc.setQueryData<Group[]>(GROUPS_KEY, (list = []) =>
      list.some((x) => x.id === g.id) ? list.map((x) => (x.id === g.id ? g : x)) : [g, ...list]),
    remove: (id: number) => qc.setQueryData<Group[]>(GROUPS_KEY, (list = []) => list.filter((x) => x.id !== id)),
  };
}
