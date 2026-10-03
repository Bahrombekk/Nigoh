/* Chap panel: kameralar/hududlar ro'yxati, qidiruv, filtrlar, hover surati,
   pastki statistika chiziqchasi. */
import { $, esc, state } from "./holat.js";
import { hasGeo, map, rebuildMarkers, visibleCams } from "./xarita.js";
import { prewarm } from "./pleyer.js";
import { fmtLastSeen, selPlayer, selectCamera } from "./tanlov.js";
import { wallPlayers } from "./devor.js";
import { renderBell } from "./grafiklar.js";
import { showTab } from "./tablar.js";

/* ---------- Chap ro'yxat ---------- */

/* Ma'lumot o'zgarmagan bo'lsa ro'yxat qayta chizilmaydi — 60 soniyalik
   yangilanish foydalanuvchi qarab turgan ro'yxatni "sakratmaydi". */
let lastListSig = "";

/* Faqat tanlov o'zgarganda butun ro'yxat qayta chizilmaydi — `.sel`
   belgisi ko'chiriladi. */
function syncListSel() {
  document.querySelectorAll("#list-body .cam-row").forEach((row) => {
    row.classList.toggle("sel", Number(row.dataset.id) === state.selectedId);
  });
}

export function renderList(force) {
  const cams = visibleCams();
  const q = state.q.trim();
  const sig = [state.filter, q, state.listView,
    state.cameras.map((c) => c.id + (c.online === false ? "d" : c.online ? "u" : "?")).join("")
  ].join("|");
  if (!force && sig === lastListSig) { syncListSel(); return; }
  lastListSig = sig;

  $("list-count").textContent = cams.length + " / " + state.cameras.length + " kamera";

  // Filtr tugmalarida jonli hisob ko'rinadi.
  const onCount = state.cameras.filter((c) => c.online === true).length;
  const offCount = state.cameras.filter((c) => c.online === false).length;
  const fLabels = { all: "Barchasi " + state.cameras.length,
                    online: "Onlayn " + onCount, offline: "Uzilgan " + offCount };
  document.querySelectorAll("#filters button").forEach((b) => {
    b.textContent = fLabels[b.dataset.filter];
  });

  if (state.listView === "regs") { renderRegionList(cams); renderFootStats(); return; }

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
    headRow.querySelector(".grp-fly").addEventListener("click", () => flyToRegion(region));
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
        row.addEventListener("click", () => { hideCamTip(); selectCamera(cam.id, true); });
        row.addEventListener("mouseenter", (e) => { prewarm(cam); showCamTip(cam, row); });
        row.addEventListener("mouseleave", hideCamTip);
        wrap.appendChild(row);
      });
    };
    if (state.openRegions[region] || q) fillRows();
    grp.appendChild(wrap);
    body.appendChild(grp);
  });

  renderFootStats();
}

/* Hududdagi barcha kameralar sig'adigan qilib xaritani yaqinlashtiradi. */
function flyToRegion(region) {
  const pts = state.cameras.filter((c) => c.region === region && hasGeo(c))
    .map((c) => [c.lat, c.lng]);
  if (!pts.length) return;
  if (pts.length === 1) map.flyTo(pts[0], 13, { duration: 0.6 });
  else map.flyToBounds(L.latLngBounds(pts).pad(0.3), { duration: 0.6 });
}

/* Hammasini ochish/yopish */
$("list-exp").addEventListener("click", () => {
  const regions = [...new Set(state.cameras.map((c) => c.region))];
  const anyClosed = regions.some((r) => !state.openRegions[r]);
  regions.forEach((r) => { state.openRegions[r] = anyClosed; });
  $("list-exp").textContent = anyClosed ? "Hammasini yopish" : "Hammasini ochish";
  renderList(true);
});

/* Chap paneldagi ikki ko'rinish: kameralar daraxti / hududlar ro'yxati. */
document.querySelectorAll(".lh-tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    state.listView = b.dataset.lview;
    document.querySelectorAll(".lh-tabs button").forEach((x) => x.classList.toggle("on", x === b));
    renderList(true);
  }));

/* Hududlar ko'rinishi — har biri bitta qator, bosilsa xaritada ochiladi. */
function renderRegionList(cams) {
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
    row.addEventListener("click", () => flyToRegion(row.dataset.region)));
}

/* ---------- Kamera surat-ko'rinishi (hover tooltip) ---------- */
function showCamTip(cam, row) {
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
function hideCamTip() { $("cam-tip").style.display = "none"; }
$("list-body").addEventListener("scroll", hideCamTip);

export function renderFootStats() {
  const t = state.openTimes;
  $("stat-open").innerHTML = t.length
    ? (t.reduce((s, v) => s + v, 0) / t.length / 1000).toFixed(2).replace(".", ",") + "s"
    : "&mdash;";
  // Faqat chindan o'ynayotgan oqimlar sanaladi.
  const live = [selPlayer, ...wallPlayers]
    .filter((p) => p && p.video && !p.video.paused).length;
  $("stat-live").textContent = live + "/" + state.cameras.length;
}

/* Tor ekran: ro'yxat va tafsilotlar paneli xarita ustida suzadi. */
export const MOBILE = window.matchMedia("(max-width:820px)");

export function setListOpen(open) {
  state.listOpen = open;
  $("list-panel").hidden = !open;
}
$("list-close").addEventListener("click", () => setListOpen(false));

function setFilter(f) {
  state.filter = f;
  document.querySelectorAll("#filters button").forEach((x) =>
    x.classList.toggle("on", x.dataset.filter === f));
  // Pastki chiplarda ham qaysi filtr faol ekani ko'rinadi.
  $("chip-on").classList.toggle("on", f === "online");
  $("chip-off").classList.toggle("on", f === "offline");
  $("chip-all").classList.toggle("on", f === "all");
  renderList();
  rebuildMarkers();
}
document.querySelectorAll("#filters button").forEach((b) =>
  b.addEventListener("click", () => setFilter(b.dataset.filter)));

/* Pastki chiplar ham filtr sifatida ishlaydi. */
function chipFilter(f) {
  if (state.tab !== "map") showTab("map");
  setFilter(f);
  setListOpen(true);
}
$("chip-on").addEventListener("click", () => chipFilter("online"));
$("chip-off").addEventListener("click", () => chipFilter("offline"));
$("chip-all").addEventListener("click", () => chipFilter("all"));

/* ---------- Qidiruv ---------- */
let qTimer = null;
/* Ikkita qidiruv maydoni (tepa qator va chap panel) bitta holatni boshqaradi. */
export function setQuery(v, from, now) {
  state.q = v;
  if (from !== "top") $("q-input").value = v;
  if (from !== "list") $("q-list").value = v;
  clearTimeout(qTimer);
  const run = () => { renderList(); rebuildMarkers(); };
  if (now) run(); else qTimer = setTimeout(run, 300);
}
["q-input", "q-list"].forEach((id) => {
  const from = id === "q-input" ? "top" : "list";
  $(id).addEventListener("input", (e) => setQuery(e.target.value, from));
  $(id).addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !e.target.value) return;
    e.stopPropagation();
    setQuery("", null, true);
  });
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    $("q-input").focus();
    $("q-input").select();
  }
});

/* ---------- Pastki chiziqcha ---------- */
export function renderStrip() {
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

/* WebRTC serverda umuman ishlamasligi mumkin — va bu tasodifiy emas.

   MediaMTX ICE nomzodlari sifatida faqat o'z interfeys manzillarini
   (127.0.0.1, 192.168.x, docker0) e'lon qilsa, internetdagi brauzer
   ularning birortasiga yeta olmaydi: signalizatsiya muvaffaqiyatli
   o'tadi, kadr esa hech qachon kelmaydi. Serverda o'lchandi — 5 ta
   kameradan 5 tasi 12 soniyada bitta ham kadr bermadi.

   Bunda har ochilish 6 soniyani behuda kutishga sarflardi: pleyer
   WebRTC'ni sinaydi, jim qoladi, keyin HLS'ga tushadi. Kamera almashsa
   yana 6 soniya. Ketma-ket ikki marta jim qolgandan keyin bu seansda
   WebRTC sinalmaydi — HLS darhol boshlanadi.

   Bir marta jim qolish sabab emas: kamera ayni damda uyg'onayotgan
   bo'lishi mumkin. Muvaffaqiyatli ochilish hisobni nolga qaytaradi.

   Bekor qilingan urinish (foydalanuvchi boshqa kamerani bosdi) HECH QACHON
   sanalmaydi. Ilgari sanalardi: kameralarni ketma-ket ko'rib chiqqan
   foydalanuvchida WebRTC ikki bosishda o'chib, butun seans 7-17 s lik
   HLS'ga tushardi (lokal o'lchov: WebRTC 15 dan 14 kamerada 3-7 s da
   ochiladi). Kadr bermaydigan kamera ham sanalmaydi — ICE ulangan bo'lsa
   aybdor tarmoq emas. O'chgan WebRTC ham 2 daqiqadan keyin qayta
   sinaladi — bitta yomon daqiqa butun ish kunini sekinlashtirmasin. */
const WEBRTC_JIM_CHEGARA = 2;
const WEBRTC_QAYTA_SINASH = 120000;           // ms
let webrtcJim = 0;
let webrtcJimAt = 0;

export function webrtcDead() {
  if (webrtcJim < WEBRTC_JIM_CHEGARA) return false;
  if (Date.now() - webrtcJimAt > WEBRTC_QAYTA_SINASH) { webrtcJim = 0; return false; }
  return true;
}

export function noteWebRtc(ok) {
  if (ok) { webrtcJim = 0; return; }
  webrtcJim++;
  webrtcJimAt = Date.now();
  if (webrtcJim === WEBRTC_JIM_CHEGARA) {
    console.warn("Nigoh: WebRTC kadr bermayapti — bu seansda faqat HLS " +
                 "ishlatiladi. Serverda webrtcAdditionalHosts sozlanmagan " +
                 "yoki ICE porti yopiq bo'lishi mumkin.");
  }
}
