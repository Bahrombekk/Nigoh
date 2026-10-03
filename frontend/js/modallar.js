/* Modal oynalarni ochish/yopish. */
import { $, state } from "./holat.js";
import { stopPicking } from "./kamera-shakli.js";

/* ---------- Modallar ---------- */
export function openModal(id) { $(id).classList.add("open"); }
export function closeModal(id) {
  $(id).classList.remove("open");
  if (id === "cam-modal") stopPicking(true);
  if (id === "login-modal") state.pendingTab = null;
}
document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", () => closeModal(b.dataset.close)));
document.querySelectorAll(".backdrop").forEach((bd) =>
  bd.addEventListener("click", (e) => { if (e.target === bd) closeModal(bd.id); }));
