/* ==========================================================================
   map/camera-list.js — chap panel: kameralar ro'yxati
   --------------------------------------------------------------------------
   Vazifasi:
     Xarita sahifasidagi chap panel: hudud bo'yicha guruhlangan kameralar
     daraxti yoki hududlar ro'yxati, qidiruv (ikki maydon, bitta holat),
     filtrlar va pastki chiplar, kamera ustida turganda surat (tooltip),
     pastki statistika chiziqchasi va panel ostidagi raqamlar.

   Eksport:
     CameraList               — klass: ro'yxat, qidiruv, filtrlar, tooltip, chiziqcha
     cameraList               — yagona nusxa
     renderList(force)        — ro'yxatni chizish (ma'lumot o'zgarmasa faqat tanlov ko'chadi)
     renderFootStats()        — o'rtacha ochilish vaqti va jonli oqimlar soni
     MOBILE                   — MediaQueryList "(max-width:820px)" (tor ekran)
     setListOpen(open)        — chap panelni ochish/yopish
     setQuery(v, now)         — qidiruv matnini o'rnatish (300 ms kechikish, now=true — darhol)
     renderStrip()            — pastki chiziqcha (jami/onlayn/uzilgan/hudud) + qo'ng'iroq hisobi

   Bog'liqliklar:
     import: ../core/state.js, ./map.js (hasGeo, map, rebuildMarkers, visibleCams),
             ../player/player.js (prewarm), ./selection.js (fmtLastSeen, selPlayer, selectCamera),
             ../wall/video-wall.js (wallPlayers), ../layout/notifications.js (renderBell),
             ../layout/tabs.js (showTab)
     global: L (L.latLngBounds — hududga uchish)

   DOM: #list-panel, #list-body, #list-count, #list-exp, #list-close, #filters,
        .lh-tabs, #chip-on, #chip-off, #chip-all, #q-list, #cam-tip,
        #stat-open, #stat-live, #strip-total, #strip-on, #strip-off, #strip-reg,
        #strip-on-sub, #strip-off-sub
   Backend: GET /api/cameras/{id}/snapshot (tooltip surati, 8 s kesh)

   Qoidalar / tuzoqlar:
     - 5000+ kamerada ham qotmasligi uchun: imzo (sig) o'zgarmasa qayta
       chizilmaydi; yopiq guruh qatorlari faqat ochilganda yaratiladi.
     - Ctrl+K (Cmd+K) — tepadagi qidiruvga fokus (document keydown).
     - WebRTC sog'ligi hisobi (webrtcDead/noteWebRtc) endi player/player.js da.
   ========================================================================== */
import { $, esc, state } from "../core/state.js";
import { hasGeo, map, rebuildMarkers, visibleCams } from "./map.js";
import { prewarm } from "../player/player.js";
import { fmtLastSeen, selPlayer, selectCamera } from "./selection.js";
import { wallPlayers } from "../wall/video-wall.js";
import { renderBell } from "../layout/notifications.js";
import { showTab } from "../layout/tabs.js";

/* Tor ekran: ro'yxat va tafsilotlar paneli xarita ustida suzadi. */
export const MOBILE = window.matchMedia("(max-width:820px)");

/* ---------- Chap ro'yxat ---------- */
export class CameraList {
  constructor() {
    /* Ma'lumot o'zgarmagan bo'lsa ro'yxat qayta chizilmaydi — 60 soniyalik
       yangilanish foydalanuvchi qarab turgan ro'yxatni "sakratmaydi". */
    this.lastListSig = "";
    this.qTimer = null;

    /* Hammasini ochish/yopish */
    $("list-exp").addEventListener("click", () => {
      const regions = [...new Set(state.cameras.map((c) => c.region))];
      const anyClosed = regions.some((r) => !state.openRegions[r]);
      regions.forEach((r) => { state.openRegions[r] = anyClosed; });
      $("list-exp").textContent = anyClosed ? "Hammasini yopish" : "Hammasini ochish";
      this.render(true);
    });

    /* Chap paneldagi ikki ko'rinish: kameralar daraxti / hududlar ro'yxati. */
    document.querySelectorAll(".lh-tabs button").forEach((b) =>
      b.addEventListener("click", () => {
        state.listView = b.dataset.lview;
        document.querySelectorAll(".lh-tabs button").forEach((x) => x.classList.toggle("on", x === b));
        this.render(true);
      }));

    $("list-body").addEventListener("scroll", () => this.hideCamTip());

    $("list-close").addEventListener("click", () => this.setOpen(false));

    document.querySelectorAll("#filters button").forEach((b) =>
      b.addEventListener("click", () => this.setFilter(b.dataset.filter)));

    /* Pastki chiplar ham filtr sifatida ishlaydi. */
    $("chip-on").addEventListener("click", () => this.chipFilter("online"));
    $("chip-off").addEventListener("click", () => this.chipFilter("offline"));
    $("chip-all").addEventListener("click", () => this.chipFilter("all"));

    /* ---------- Qidiruv ---------- */
    $("q-list").addEventListener("input", (e) => this.setQuery(e.target.value));
    $("q-list").addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !e.target.value) return;
      e.stopPropagation();
      this.setQuery("", true);
    });
    // Ctrl+K — xaritaga o'tib, ro'yxat qidiruviga (tepa qatordagi qidiruv olib tashlangan).
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (state.tab !== "map") showTab("map");
        this.setOpen(true);
        $("q-list").focus();
        $("q-list").select();
      }
    });
  }

  /* Faqat tanlov o'zgarganda butun ro'yxat qayta chizilmaydi — `.sel`
     belgisi ko'chiriladi. */
  syncListSel() {
    document.querySelectorAll("#list-body .cam-row").forEach((row) => {
      row.classList.toggle("sel", Number(row.dataset.id) === state.selectedId);
    });
  }

  render(force) {
    const cams = visibleCams();
    const q = state.q.trim();
    const sig = [state.filter, q, state.listView,
      state.cameras.map((c) => c.id + (c.online === false ? "d" : c.online ? "u" : "?")).join("")
    ].join("|");
    if (!force && sig === this.lastListSig) { this.syncListSel(); return; }
    this.lastListSig = sig;

    $("list-count").textContent = cams.length + " / " + state.cameras.length + " kamera";

    // Filtr tugmalarida jonli hisob ko'rinadi.
    const onCount = state.cameras.filter((c) => c.online === true).length;
    const offCount = state.cameras.filter((c) => c.online === false).length;
    const fLabels = { all: "Barchasi " + state.cameras.length,
                      online: "Onlayn " + onCount, offline: "Uzilgan " + offCount };
    document.querySelectorAll("#filters button").forEach((b) => {
      b.textContent = fLabels[b.dataset.filter];
    });

    if (state.listView === "regs") { this.renderRegionList(cams); this.renderFootStats(); return; }

    // Hudud bo'yicha bir o'tishda guruhlanadi (ilgari har hudud uchun
    // butun ro'yxat qayta filtrlanardi: 110 hudud x 5000 kamera).
    const byRegion = new Map();
    cams.forEach((c) => {
      if (!byRegion.has(c.region)) byRegion.set(c.region, []);
      byRegion.get(c.region).push(c);
    });
    const body = $("list-body");
    body.innerHTML = byRegion.size ? "" :
      '<div class="empty">Kamera topilmadi.</div>';

    byRegion.forEach((list, region) => {
      const down = list.filter((c) => c.online === false).length;
      const known = list.some((c) => c.online === true);
      const grp = document.createElement("div");
      // Qidiruv paytida guruhlar ochiq — topilgan kamera darhol ko'rinadi.
      grp.className = "grp" + (state.openRegions[region] || q ? " open" : "");

      const headRow = document.createElement("div");
      headRow.className = "grp-row";
      headRow.innerHTML =
        '<button class="grp-head">' +
          '<span class="caret">&#9654;</span>' +
          '<span class="st' + (down ? " down" : known ? "" : " unk") + '"></span>' +
          '<span class="rg">' + esc(region) + "<i>" + list.length + " kamera</i></span>" +
          '<span class="bdg"><span>' + (list.length - down) + "</span>" +
            (down ? '<span class="d">' + down + "</span>" : "") + "</span>" +
        "</button>" +
        '<button class="grp-fly" title="Xaritada ko\'rsatish">&#9678;</button>';
      headRow.querySelector(".grp-head").addEventListener("click", () => {
        state.openRegions[region] = !state.openRegions[region];
        if (state.openRegions[region]) fillRows();
        grp.classList.toggle("open", state.openRegions[region]);
      });
      headRow.querySelector(".grp-fly").addEventListener("click", () => this.flyToRegion(region));
      grp.appendChild(headRow);

      const wrap = document.createElement("div");
      wrap.className = "grp-cams";
      // Qatorlar faqat guruh ochiq bo'lsa (yoki ochilganda) yaratiladi.
      // 5000 kamerada yopiq guruhlar ichidagi minglab ko'rinmas tugmani
      // qurish ro'yxatning har chizilishiga ~1 s qo'shardi.
      let filled = false;
      const fillRows = () => {
        if (filled) return;
        filled = true;
        list.forEach((cam) => {
          const row = document.createElement("button");
          row.dataset.id = cam.id;
          // "Tirik, lekin oqimsiz" — alohida holat. Kameraning porti ochiq
          // (health uni ONLINE deb belgilaydi), ammo RTSP kodek bermagan:
          // login/parol yoki yo'l xato. Bunday kamera hech qachon ochilmaydi.
          // Ilgari u ro'yxatda oddiy yashil bo'lib turardi va foydalanuvchi
          // bosib, kutib, sababsiz xato olardi — servisda 4 tasi shunday.
          const oqimsiz = cam.online !== false && !cam.codec;
          row.className = "cam-row" + (cam.online === false ? " down" : "") +
                          (oqimsiz ? " nostream" : "") +
                          (cam.id === state.selectedId ? " sel" : "");
          if (oqimsiz) {
            row.title = "Tarmoqda ko'rinadi, lekin oqim bermayapti — "
                      + "RTSP login/parol yoki yo'l xato bo'lishi mumkin";
          }
          row.innerHTML =
            '<span class="dot"></span>' +
            '<span class="nm">' + esc(cam.name) + "</span>" +
            '<span class="cdx">' + esc(cam.codec || "oqim yo'q") + "</span>";
          row.addEventListener("click", () => { this.hideCamTip(); selectCamera(cam.id, true); });
          row.addEventListener("mouseenter", (e) => { prewarm(cam); this.showCamTip(cam, row); });
          row.addEventListener("mouseleave", () => this.hideCamTip());
          wrap.appendChild(row);
        });
      };
      if (state.openRegions[region] || q) fillRows();
      grp.appendChild(wrap);
      body.appendChild(grp);
    });

    this.renderFootStats();
  }

  /* Hududdagi barcha kameralar sig'adigan qilib xaritani yaqinlashtiradi. */
  flyToRegion(region) {
    const pts = state.cameras.filter((c) => c.region === region && hasGeo(c))
      .map((c) => [c.lat, c.lng]);
    if (!pts.length) return;
    if (pts.length === 1) map.flyTo(pts[0], 13, { duration: 0.6 });
    else map.flyToBounds(L.latLngBounds(pts).pad(0.3), { duration: 0.6 });
  }

  /* Hududlar ko'rinishi — har biri bitta qator, bosilsa xaritada ochiladi. */
  renderRegionList(cams) {
    const regions = [...new Set(cams.map((c) => c.region))].sort();
    const body = $("list-body");
    if (!regions.length) { body.innerHTML = '<div class="empty">Hudud topilmadi.</div>'; return; }
    body.innerHTML = regions.map((r) => {
      const list = cams.filter((c) => c.region === r);
      const down = list.filter((c) => c.online === false).length;
      return '<button class="cam-row rgrow" data-region="' + esc(r) + '">' +
        '<span class="dot' + (down ? " d" : "") + '"></span>' +
        '<span class="nm">' + esc(r) + "</span>" +
        '<span class="bdg"><span>' + (list.length - down) + "</span>" +
          (down ? '<span class="d">' + down + "</span>" : "") + "</span></button>";
    }).join("");
    body.querySelectorAll(".rgrow").forEach((row) =>
      row.addEventListener("click", () => this.flyToRegion(row.dataset.region)));
  }

  /* ---------- Kamera surat-ko'rinishi (hover tooltip) ---------- */
  showCamTip(cam, row) {
    const tip = $("cam-tip");
    const img = tip.querySelector("img");
    img.hidden = false;
    img.onerror = () => { img.hidden = true; };
    // 8 soniyalik server keshi bilan mos — bir xil manzil qayta so'ralmaydi.
    img.src = "/api/cameras/" + cam.id + "/snapshot?t=" + Math.floor(Date.now() / 8000);
    tip.querySelector(".cap").textContent = cam.online === false
      ? "O'chiq · oxirgi onlayn: " + fmtLastSeen(cam.last_seen)
      : [cam.codec, cam.always_on ? "doim tayyor" : "jonli"].filter(Boolean).join(" · ");
    const r = row.getBoundingClientRect();
    tip.style.left = (r.right + 10) + "px";
    tip.style.top = Math.max(80, Math.min(r.top - 40, innerHeight - 200)) + "px";
    tip.style.display = "block";
  }

  hideCamTip() { $("cam-tip").style.display = "none"; }

  renderFootStats() {
    const t = state.openTimes;
    $("stat-open").innerHTML = t.length
      ? (t.reduce((s, v) => s + v, 0) / t.length / 1000).toFixed(2).replace(".", ",") + "s"
      : "&mdash;";
    // Faqat chindan o'ynayotgan oqimlar sanaladi.
    const live = [selPlayer, ...wallPlayers]
      .filter((p) => p && p.video && !p.video.paused).length;
    $("stat-live").textContent = live + "/" + state.cameras.length;
  }

  setOpen(open) {
    state.listOpen = open;
    $("list-panel").hidden = !open;
  }

  setFilter(f) {
    state.filter = f;
    document.querySelectorAll("#filters button").forEach((x) =>
      x.classList.toggle("on", x.dataset.filter === f));
    // Pastki chiplarda ham qaysi filtr faol ekani ko'rinadi.
    $("chip-on").classList.toggle("on", f === "online");
    $("chip-off").classList.toggle("on", f === "offline");
    $("chip-all").classList.toggle("on", f === "all");
    this.render();
    rebuildMarkers();
  }

  /* Pastki chiplar ham filtr sifatida ishlaydi. */
  chipFilter(f) {
    if (state.tab !== "map") showTab("map");
    this.setFilter(f);
    this.setOpen(true);
  }

  /* Ro'yxat qidiruvi: holat, maydon qiymati, ro'yxat va markerlar. */
  setQuery(v, now) {
    state.q = v;
    $("q-list").value = v;
    clearTimeout(this.qTimer);
    const run = () => { this.render(); rebuildMarkers(); };
    if (now) run(); else this.qTimer = setTimeout(run, 300);
  }

  /* ---------- Pastki chiziqcha ---------- */
  renderStrip() {
    const total = state.cameras.length;
    const on = state.cameras.filter((c) => c.online === true).length;
    const off = state.cameras.filter((c) => c.online === false).length;
    $("strip-total").textContent = total;
    $("strip-on").textContent = on;
    $("strip-off").textContent = off;
    $("strip-reg").textContent = new Set(state.cameras.map((c) => c.region)).size;
    $("strip-on-sub").textContent = total ? Math.round((on / total) * 100) + "% faol" : "Faol kameralar";
    $("strip-off-sub").textContent = off ? "Tekshirish kerak" : "Aloqa yo'q";
    renderBell();
  }
}

export const cameraList = new CameraList();

export function renderList(force) { cameraList.render(force); }
export function renderFootStats() { cameraList.renderFootStats(); }
export function setListOpen(open) { cameraList.setOpen(open); }
export function setQuery(v, now) { cameraList.setQuery(v, now); }
export function renderStrip() { cameraList.renderStrip(); }
