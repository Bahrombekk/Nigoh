/* player/openTimes.js — shu seansda o'lchangan oqim ochilish vaqtlari (ms).
   add(camId, ms) — pleyer chaqiradi; window'ga "nigoh:open-time" (detail: {id, ms}) yuboriladi. */
export const openTimes = {
  list: [],
  byCam: new Map(),
  add(id, ms) {
    this.list.push(ms);
    if (this.list.length > 50) this.list.shift();
    this.byCam.set(id, ms);
    window.dispatchEvent(new CustomEvent("nigoh:open-time", { detail: { id, ms } }));
  },
};
