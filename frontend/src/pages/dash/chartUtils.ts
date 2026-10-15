/* pages/dash/chartUtils.ts — grafiklar uchun umumiy bo'laklar (charts.tsx va tablar ishlatadi):
   esc (SVG/HTML matni), grafik maslahati chTipShow/chTipHide (.db-tip, kursorga ergashadi,
   bitta umumiy element), issiqlik xaritasi bosqichlari HEAT_ALPHA. */

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/* ---------- Grafik maslahati (kursorga ergashadi) ---------- */
let tipEl: HTMLDivElement | null = null;
function tip() {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "db-tip";
    tipEl.setAttribute("role", "tooltip");
    document.body.appendChild(tipEl);
    addEventListener("scroll", chTipHide, true);
  }
  return tipEl;
}
export function chTipShow(title: string, text: string, cx: number, cy: number) {
  const el = tip();
  el.innerHTML = (title ? "<b>" + esc(title) + "</b>" : "") + (text ? "<span>" + esc(text) + "</span>" : "");
  el.classList.add("show");
  const r = el.getBoundingClientRect();
  let x = cx + 14, y = cy - r.height - 12;
  if (x + r.width > innerWidth - 8) x = cx - r.width - 14;
  if (y < 8) y = cy + 16;
  el.style.left = Math.max(8, x) + "px";
  el.style.top = y + "px";
}
export function chTipHide() { tipEl?.classList.remove("show"); }

/* ---------- Issiqlik xaritasi ---------- */
/** 5 bosqich (0 — eng och, kuzatuv bor lekin uzilish yo'q). */
export const HEAT_ALPHA = [0.07, 0.2, 0.36, 0.54, 0.74, 0.95];
