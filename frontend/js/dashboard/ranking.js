/* ==========================================================================
   dashboard/ranking.js — Tahlil tabining reyting va taqsimot kartalari
   --------------------------------------------------------------------------
   Vazifasi:
     v2 dashboardidagi davr kesimidagi ro'yxatlarni v3 (Figma "Nigoh vision")
     uslubida chizadi. Ma'lumotni overview.js yuklaydi va shu funksiyalarga
     beradi (bu modul so'rov yubormaydi):
       * renderRegionTable — Hududlar reytingi: hozir, davr uptime (90–100% shkala),
                             uzilish, sakrash, o'chiq soat; qator → xarita;
       * regionsCsv        — shu jadvalni CSV faylga (v2 "CSV" tugmasi);
       * renderDistribution — Uptime taqsimoti (availability.distribution);
       * renderRanking     — Muammoli kameralar reytingi (o'chiq vaqt / uzilish /
                             sakrash / tasvir to'xtashi), kamera → xarita;
       * renderLongest     — Eng uzun uzilishlar (outages?sort=duration).

   Eksport: renderRegionTable, regionsCsv, renderDistribution, renderRanking, renderLongest, RANK_BY
   Bog'liqliklar: ../core/state.js (esc), ../core/ui.js (toast), ./common.js
   ========================================================================== */
import { esc } from "../core/state.js";
import { toast } from "../core/ui.js";
import { STATUS, LABEL, fmtPct, fmtInt, fmtDur, hhmm, dayLabel, emptyHtml } from "./common.js";

const kmOf = (x) => (x.km != null ? x.km + (x.picket ? "/" + x.picket : "") + " km" : "");
/* Nomida km bo'lsa (masalan "3377/1 km") — takrorlanmaydi. */
const where = (x) => [x.region, String(x.name || "").includes(kmOf(x)) ? "" : kmOf(x)].filter(Boolean).join(" · ");
const upTone = (v) => (v == null ? "unknown" : v >= 99 ? "online" : v >= 95 ? "no-video" : "offline");
const upCls = (v) => (v == null ? "" : v >= 99 ? "t-success" : v >= 95 ? "t-warning" : "t-error");

/* ---------- Hududlar reytingi ---------- */
const FLOOR = 90;   // shkala 90–100%: 0–100 da 95 va 98 bir xil uzunlikda ko'rinib, farq yo'qolardi
export function renderRegionTable(box, data) {
  const list = (data && data.regions) || [];
  if (!list.length) { box.innerHTML = emptyHtml("Hudud yoʻq"); return; }
  const rows = [...list].sort((a, b) => (a.uptime_pct ?? 101) - (b.uptime_pct ?? 101));
  box.innerHTML = '<div class="db-rt"><div class="db-rt-row db-rt-head">' +
    "<span>#</span><span>Hudud</span><span data-tip=\"Hozir onlayn / tekshirilgan kameralar\">Hozir onlayn</span>" +
    "<span data-tip=\"Uptime — davrda onlayn boʻlgan vaqt ulushi. Shkala 90–100%\">Ishlash ulushi</span>" +
    "<span>Uzilish</span><span data-tip=\"2 daqiqadan qisqa uzilishlar\">Qisqa uzilish</span><span>Ishlamagan vaqt</span></div>" +
    rows.map((r, i) => {
      const v = r.uptime_pct;
      const w = v == null ? 0 : Math.max(2, Math.min(100, ((v - FLOOR) / (100 - FLOOR)) * 100));
      const now = r.now || {};
      const measured = (now.online || 0) + (now.stalled || 0) + (now.offline || 0);
      return '<button class="db-rt-row" data-region="' + esc(r.region) + '" data-tip="Xaritada koʻrsatish">' +
        '<span class="db-rt-n">' + (i + 1) + "</span>" +
        '<span class="db-rt-name ellipsis">' + esc(r.region) + "</span>" +
        '<span class="db-num">' + (measured ? fmtInt(now.online) + "/" + fmtInt(measured) : "—") + "</span>" +
        '<span class="db-rt-up"><span class="db-bar"><i data-status="' + upTone(v) + '" style="width:' + w.toFixed(1) + '%"></i></span>' +
          '<span class="db-num ' + upCls(v) + '">' + fmtPct(v) + "</span></span>" +
        '<span class="db-num' + (r.outages ? " t-error" : "") + '">' + fmtInt(r.outages || 0) + "</span>" +
        '<span class="db-num">' + fmtInt(r.blips || 0) + "</span>" +
        '<span class="db-num">' + (r.offline_hours != null ? fmtDur(r.offline_hours * 3600) : "—") + "</span></button>";
    }).join("") + "</div>";
}

export function regionsCsv(data, days) {
  const list = (data && data.regions) || [];
  if (!list.length) { toast("Eksport uchun maʼlumot yoʻq", { tone: "error" }); return; }
  const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const head = ["Hudud", "Kameralar soni", "Hozir onlayn", "Hozir tasvirsiz", "Hozir uzilgan", "Hozir onlayn, %",
    "Ishlash ulushi, % (" + days + " kun)", "Uzilishlar", "Qisqa uzilishlar", "Ishlamagan vaqt, soat"];
  const body = list.map((r) => {
    const n = r.now || {};
    return [r.region, r.cameras, n.online, n.stalled, n.offline, r.online_now_pct, r.uptime_pct, r.outages, r.blips,
      r.offline_hours].map(cell).join(",");
  });
  const blob = new Blob(["﻿" + [head.map(cell).join(","), ...body].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "nigoh-hududlar-" + days + "kun.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(list.length + " ta hudud eksport qilindi", { tone: "success" });
}

/* ---------- Uptime taqsimoti ---------- */
const BAND_TONE = { "100%": "online", "99–100%": "online", "95–99%": "brand", "90–95%": "no-video", "<90%": "offline" };
const BAND_LABEL = { "100%": "100% (uzilishsiz)", "99–100%": "99–100%", "95–99%": "95–99%", "90–95%": "90–95%", "<90%": "90% dan past" };
export function renderDistribution(box, avail) {
  const dist = (avail && avail.distribution) || [];
  const total = dist.reduce((s, b) => s + b.cameras, 0);
  if (!total) { box.innerHTML = emptyHtml("Taqsimot yoʻq", "Davrda kuzatilgan kamera boʻlmagan."); return ""; }
  const max = Math.max(...dist.map((b) => b.cameras), 1);
  // Band nomlari serverdan "99–100%" (en-dash) bilan keladi.
  box.innerHTML = '<div class="db-dist">' + dist.map((b) => {
    const tone = BAND_TONE[b.band] || "unknown";
    const pct = (b.cameras / total) * 100;
    return '<div class="db-dist-row" data-tip="' + esc(fmtInt(b.cameras) + " kamera · " + Math.round(pct) + "%") + '">' +
      '<span class="db-dist-l">' + esc(BAND_LABEL[b.band] || b.band) + "</span>" +
      '<span class="db-dist-bar"><i data-tone="' + tone + '" style="width:' + Math.max(1.5, (b.cameras / max) * 100).toFixed(1) + '%"></i></span>' +
      '<span class="db-num">' + fmtInt(b.cameras) + '</span><span class="db-tech-pct">' + Math.round(pct) + "%</span></div>";
  }).join("") + "</div>";
  const good = dist.filter((b) => b.band === "100%" || b.band.startsWith("99")).reduce((s, b) => s + b.cameras, 0);
  return Math.round((good / total) * 100) + "% kamerada 99% dan yuqori";
}

/* ---------- Muammoli kameralar reytingi ---------- */
export const RANK_BY = {
  offline_time: { val: (c) => c.offline_seconds, main: (c) => fmtDur(c.offline_seconds), note: (c) => "ishlash ulushi " + fmtPct(c.uptime_pct) },
  outages: { val: (c) => c.outages, main: (c) => fmtInt(c.outages) + " marta", note: (c) => "ishlamagan vaqt — " + fmtDur(c.offline_seconds) },
  blips: { val: (c) => c.blips, main: (c) => fmtInt(c.blips) + " marta", note: (c) => "uzilish: " + fmtInt(c.outages) },
  stalls: { val: (c) => c.stalls, main: (c) => fmtInt(c.stalls) + " marta", note: (c) => "ishlash ulushi " + fmtPct(c.uptime_pct) },
};
export function renderRanking(box, data, by) {
  const items = (data && data.items) || [];
  if (!items.length) { box.innerHTML = emptyHtml("Muammoli kamera yoʻq", "Bu davrda shu koʻrsatkich boʻyicha kamera topilmadi."); return; }
  const m = RANK_BY[by] || RANK_BY.offline_time;
  const max = Math.max(1, ...items.map(m.val));
  box.innerHTML = items.map((c, i) => {
    const st = c.state || "unknown";
    return '<button class="db-rk-row" data-id="' + c.id + '">' +
      '<span class="db-rk-n">' + (i + 1) + "</span>" +
      '<span class="dot" data-status="' + STATUS[st] + '" data-tip="' + (LABEL[st] || "") + '"></span>' +
      '<span class="db-att-row__t"><span class="ellipsis">' + esc(c.name) + '</span><span class="db-att-row__s ellipsis">' + esc(where(c)) + "</span></span>" +
      '<span class="db-rk-v"><span class="db-num">' + m.main(c) + '</span><span class="db-bar"><i data-status="offline" style="width:' +
        Math.max(4, (m.val(c) / max) * 100).toFixed(1) + '%"></i></span><span class="db-rk-note ellipsis">' + esc(m.note(c)) + "</span></span></button>";
  }).join("");
}

/* ---------- Eng uzun uzilishlar ---------- */
export function renderLongest(box, data, days) {
  const items = (data && data.items) || [];
  if (!items.length) { box.innerHTML = emptyHtml("Uzilish yoʻq", "Bu davrda uzilish qayd etilmagan."); return; }
  const when = (iso) => (days === 1 ? hhmm(iso) : dayLabel(new Date(iso)) + " " + hhmm(iso));
  box.innerHTML = items.map((o) =>
    '<button class="db-att-row" data-id="' + o.camera_id + '" data-tip="' + esc(when(o.start) + " → " + (o.open ? "hozirgacha" : when(o.end))) + '">' +
      '<span class="dot" data-status="' + (o.open ? "offline" : "disabled") + '"></span>' +
      '<span class="db-att-row__t"><span class="ellipsis">' + esc(o.name) + '</span><span class="db-att-row__s ellipsis">' + esc(where(o)) + "</span></span>" +
      (o.open ? '<span class="db-tag db-tag--err">Davom etmoqda</span>' : '<span class="db-att-row__s db-long-when">' + when(o.start) + "</span>") +
      '<span class="db-att-row__d ' + (o.open ? "t-error" : "") + '">' + fmtDur(o.seconds) + "</span></button>").join("");
}
