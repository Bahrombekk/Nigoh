/* ==========================================================================
   layout/notifications.js — hodisalar lentasi va qo'ng'iroq (bildirishnomalar)
   --------------------------------------------------------------------------
   Vazifasi:
     Shu seansdagi mahalliy hodisalar (oqim ochildi, kamera qo'shildi,
     MediaMTX ...) va serverdagi uzilish/ulanish hodisalarini bitta lentada
     ko'rsatish: dashboarddagi "Hodisalar" kartasi va tepadagi qo'ng'iroq
     paneli. Qo'ng'iroqdagi hisob — hozir uzilgan kameralar soni.

   Eksport:
     Notifications        — klass: add, renderEvents, renderBell; konstruktor qo'ng'iroqni ulaydi
     notifications        — yagona nusxa
     addEvent(text, kind) — mahalliy hodisa qo'shish (kind: ok | warn | danger), 50 tagacha
     renderEvents()       — lentani va qo'ng'iroq ro'yxatini chizish
     renderBell()         — qo'ng'iroqdagi hisob va panel sarlavhasi

   Bog'liqliklar:
     import: ../core/state.js ($, esc, state)

   DOM: #events-list, #bell, #bell-count, #bell-panel, #bp-list, #bp-sub
   Backend: ma'lumot state.stats.events dan (/api/stats/dashboard — dashboard.js yuklaydi);
            GET /api/cameras/{id}/snapshot?stale=1&cached=1 (hodisa suratchasi)

   Qoidalar / tuzoqlar:
     - Ilgari bu kod dashboard.js (addEvent) va charts.js (renderEvents,
       renderBell, qo'ng'iroq) ga sochilgan edi — mazmuni o'zgarmagan.
     - Lenta HTML o'zgarmasa qayta chizilmaydi (data-sig) — suratlar
       har 15 s da miltillamasin.
     - Suratcha faqat dashboard lentasida va faqat eng so'nggi 12 ta server
       hodisasida; qo'ng'iroq panelida suratsiz.
     - Panel tashqarisiga bosish uni yopadi (document click).
   ========================================================================== */
import { $, esc, state } from "../core/state.js";

/* Hodisalar lentasi: server yozgan uzilishlar (doimiy) + shu seansdagi
   mahalliy hodisalar (oqim ochildi, MediaMTX va h.k.) bitta ro'yxatda. */
function fmtEvTime(t) {
  const d = new Date(t), p = (n) => String(n).padStart(2, "0");
  const sameDay = d.toDateString() === new Date().toDateString();
  return (sameDay ? "" : p(d.getDate()) + "." + p(d.getMonth() + 1) + " ") +
         p(d.getHours()) + ":" + p(d.getMinutes());
}

export class Notifications {
  constructor() {
    $("bell").addEventListener("click", (e) => {
      e.stopPropagation();
      const p = $("bell-panel");
      p.hidden = !p.hidden;
      if (!p.hidden) this.renderEvents();
    });
    document.addEventListener("click", (e) => {
      const p = $("bell-panel");
      if (!p.hidden && !p.contains(e.target)) p.hidden = true;
    });
  }

  add(text, kind) {
    state.events.unshift({ t: Date.now(), text, kind });
    if (state.events.length > 50) state.events.pop();
    this.renderEvents();
  }

  renderEvents() {
    const colors = { ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)" };
    const server = ((state.stats && state.stats.events) || []).map((e, i) => ({
      t: Date.parse(e.ts),
      id: i < 12 ? e.id : null,   // surat faqat eng so'nggi 12 ta hodisada
      text: e.name + " (" + e.region + ") — " +
            (e.kind === "offline" ? "uzildi" : "qayta ulandi"),
      kind: e.kind === "offline" ? "danger" : "ok",
    }));
    const all = state.events.concat(server).sort((a, b) => b.t - a.t).slice(0, 60);
    const row = (e) => {
      // Matn "Nomi (hudud) — sabab" ko'rinishida: nom qalin, sababi pastda.
      const m = /^(.*?) — (.*)$/.exec(e.text);
      const title = m ? m[1] : e.text;
      const note = m ? m[2] : "";
      return '<div class="erow">' +
        '<span class="ln" style="background:' + (colors[e.kind] || "var(--muted)") + '"></span>' +
        '<span class="tx"><b>' + esc(title) + "</b>" +
          (note ? "<i>" + esc(note) + "</i>" : "") + "</span>" +
        '<span class="tm">' + fmtEvTime(e.t) + "</span>" +
        // Kameraning oxirgi ma'lum surati — hodisa qaysi joyda ekanini bir qarashda
        // tanitadi. Uzilgan kamerada ham oxirgi kadr ko'rinadi (?stale=1).
        (e.id && withThumb ? '<img class="ev-thumb" loading="lazy" alt="" src="/api/cameras/' + e.id +
          '/snapshot?stale=1&cached=1" onerror="this.remove()">' : "") + "</div>";
    };
    let withThumb = true;
    const html = all.length
      ? all.slice(0, 40).map(row).join("")
      : '<div class="empty">Hodisalar hali yo‘q.</div>';
    // Ro'yxat o'zgarmasa qayta chizilmaydi — suratlar har 15 s da miltillamasin.
    const list = $("events-list");
    if (list.dataset.sig !== html) { list.innerHTML = html; list.dataset.sig = html; }
    withThumb = false;
    $("bp-list").innerHTML = all.length
      ? all.slice(0, 12).map(row).join("")
      : '<div class="empty">Yangi bildirishnoma yo‘q.</div>';
  }

  /* Qo'ng'iroqdagi hisob — hozir uzilgan kameralar soni. */
  renderBell() {
    const off = state.cameras.filter((c) => c.online === false).length;
    const el = $("bell-count");
    el.textContent = off > 99 ? "99+" : off;
    el.hidden = off === 0;
    $("bp-sub").textContent = off ? off + " ta uzilgan" : "hammasi joyida";
  }
}

export const notifications = new Notifications();

export function addEvent(text, kind) { notifications.add(text, kind); }
export function renderEvents() { notifications.renderEvents(); }
export function renderBell() { notifications.renderBell(); }
