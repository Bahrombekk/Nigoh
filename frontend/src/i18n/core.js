/* ==========================================================================
   i18n/core.js — tarjima yadrosi (v3 frontend/js/core/i18n.js dan, DOM'siz)
   --------------------------------------------------------------------------
   Manba matnlar o'zbekcha (lotin). translate(uz, lang): uz-cyrl — avtomatik
   transliteratsiya; ru/en — lug'at (./ru.js, ./en.js) + raqamli shablonlar +
   regex qoidalar. React'da: useT() (i18n/I18nProvider.tsx).
   Joriy til setCurrentLang() bilan beriladi (provayder chaqiradi) — sana
   nomlari (WEEKDAYS/MONTHS/dateShort) shunga qaraydi.
   ========================================================================== */
/* Lug'atlar (ru.js, en.js — har biri ~100 KB) faqat shu til tanlanganda
   yuklanadi: loadLang(l). Yuklanmaguncha translate() manbani qaytaradi. */

export const LANGS = [
  { id: "uz", label: "Oʻzbekcha", html: "uz" },
  { id: "uz-cyrl", label: "Ўзбекча", html: "uz-Cyrl" },
  { id: "ru", label: "Русский", html: "ru" },
  { id: "en", label: "English", html: "en" },
];
const IDS = LANGS.map((l) => l.id);
// Prototipsiz nusxa — "constructor" kabi satr Object.prototype'ga tushmasin.
const DICT = { ru: null, en: null };
const RULES = { ru: [], en: [] };
const LOADERS = { ru: () => import("./ru.js"), en: () => import("./en.js") };
const loading = {};

/** Til lug'ati tayyormi (uz va uz-cyrl — lug'atsiz). */
export function langReady(l) { return !(l in DICT) || DICT[l] !== null; }

/** Lug'atni yuklash (bir marta). */
export function loadLang(l) {
  if (langReady(l)) return Promise.resolve();
  if (!loading[l]) {
    loading[l] = LOADERS[l]().then((m) => {
      DICT[l] = Object.assign(Object.create(null), m.default);
      RULES[l] = m.rules || [];
      if (cache[l]) cache[l].clear();
    });
  }
  return loading[l];
}

let lang = "uz";


/* ---------------- Sana nomlari ---------------- */
const WD = {
  uz: ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"],
  ru: ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};
const MO = {
  uz: ["yan", "fev", "mar", "apr", "may", "iyun", "iyul", "avg", "sen", "okt", "noy", "dek"],
  ru: ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};
export function WEEKDAYS(l = lang) { return l === "uz-cyrl" ? WD.uz.map(translit) : WD[l] || WD.uz; }
export function MONTHS(l = lang) { return l === "uz-cyrl" ? MO.uz.map(translit) : MO[l] || MO.uz; }
/* "Chor, 8 okt" / "Ср, 8 окт" / "Wed, Oct 8" */
export function dateShort(d = new Date()) {
  const w = WEEKDAYS()[d.getDay()], m = MONTHS()[d.getMonth()];
  return lang === "en" ? w + ", " + m + " " + d.getDate() : w + ", " + d.getDate() + " " + m;
}

/* ---------------- Kirill transliteratsiyasi ---------------- */
const LAT = {
  a: "а", b: "б", c: "с", d: "д", e: "е", f: "ф", g: "г", h: "ҳ", i: "и", j: "ж", k: "к", l: "л", m: "м",
  n: "н", o: "о", p: "п", q: "қ", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "х", y: "й", z: "з",
};
const VOWEL = /[aeiouʻ]/;
// Lotinda qoladigan soʻzlar (brend, qisqartma, birlik). Kichik harfda.
const KEEP = new Set(("uptime white cream dark live excel csv mediamtx webrtc hls rtsp rtmp holowits hikvision dahua " +
  "uniview openstreetmap osm esri maxar earthstar geographics onvif firmware keyframe ice caps lock enter esc shift " +
  "ctrl alt tab px fps kbps mbps mb gb kb tb postgresql sqlite nvr dvr ip api http https ok mp4 m3u8 whep mttr tcp " +
  "udp cpu ram gpu id url json xlsx pdf utc warn info error debug blip leaflet poe ptz snmp ntp dns ssl tls " +
  "asia europe tashkent samarkand almaty dushanbe bishkek moscow").split(" "));
const WORD = { dashboard: "дашборд", zoom: "зум", trend: "тренд", server: "сервер", media: "медиа", video: "видео" };

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function translitWord(w) {
  const low = w.toLowerCase();
  if (KEEP.has(low)) return w;
  const letters = low.replace(/[ʻʼ]/g, "");
  if (w === w.toUpperCase() && /[A-Z]/.test(w) && (letters.length <= 3 || !/[aeiou]/.test(letters))) return w; // NVR, RTSP
  if (/[a-z][A-Z]/.test(w)) return w;                                     // WebRTC, MediaMTX
  const upper = w.length > 1 && w === w.toUpperCase();
  let out = "";
  if (WORD[low]) out = WORD[low];
  else {
    for (let i = 0; i < low.length; i++) {
      const c = low[i], n = low[i + 1], prev = low[i - 1];
      if ((c === "o" || c === "g") && n === "ʻ") { out += c === "o" ? "ў" : "ғ"; i++; continue; }
      if (c === "s" && n === "h") { out += "ш"; i++; continue; }
      if (c === "c" && n === "h") { out += "ч"; i++; continue; }
      if (c === "y" && n === "o" && low[i + 2] !== "ʻ") { out += "ё"; i++; continue; }
      if (c === "y" && n === "a") { out += "я"; i++; continue; }
      if (c === "y" && n === "u") { out += "ю"; i++; continue; }
      if (c === "y" && n === "e") { out += "е"; i++; continue; }
      if (c === "t" && n === "s" && (i === 0 || /^i(ya|on)/.test(low.slice(i + 2)))) { out += "ц"; i++; continue; }
      if (c === "e") { out += i === 0 || VOWEL.test(prev) ? "э" : "е"; continue; }
      if (c === "ʼ") { out += "ъ"; continue; }
      if (c === "ʻ") { continue; }
      out += LAT[c] || c;
    }
  }
  if (upper) return out.toUpperCase();
  return /[A-Z]/.test(w[0]) ? cap(out) : out;
}

/* Matnni kirillga: boʻsh joy bilan ajralgan boʻlak kodga oʻxshasa (URL, IP,
   H.264, 1080p, fayl) — tegilmaydi. */
export function translit(s) {
  return String(s).replace(/\S+/g, (chunk) => {
    if (/^([A-Za-z]{1,2}\.)+[A-Za-z]{1,2}$/.test(chunk) && !/^[HhVv]\./.test(chunk)) return chunk.replace(/[A-Za-z]+/g, translitWord); // F.I.Sh
    if (/[/@_\\]|:\/\/|[A-Za-z]\.[A-Za-z0-9]|\d\.\d.*[A-Za-z]|^[A-Za-z]+\.\d/.test(chunk)) return chunk;
    if (/\d[A-Za-z]|[A-Za-z]\d/.test(chunk) && !/^\d+-[A-Za-zʻʼ]+/.test(chunk)) return chunk;
    // Oʻzbek lotinida yolgʻiz "c" va "w" yoʻq — login, brend, inglizcha soʻz (claude-test).
    if (/c(?!h)|w/i.test(chunk)) return chunk;
    // Apostroflar: o/g dan keyin — ʻ (oʻ, gʻ), boshqa joyda harflar orasida — ʼ.
    const norm = chunk.replace(/([oOgG])['‘’`ʼ](?=[A-Za-z])/g, "$1ʻ").replace(/([A-Za-z])['’`](?=[A-Za-z])/g, "$1ʼ");
    return norm.replace(/[A-Za-zʻʼ]+/g, translitWord);
  });
}

/* ---------------- ru / en lugʻat ---------------- */
const RU_PLURAL = (n) => (n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2);
const EN_PLURAL = (n) => (n === 1 ? 0 : 1);
// Son: 12, 3,5, 16:44:02, 3415/3, 10–30, 1 377 (minglik boʻsh joy bilan)
const NUM = /\d+(?:[.,:/–-]\d+|[   ]\d{3}(?!\d))*/g;

function fill(tpl, args, l) {
  return tpl.replace(/\{(\d+)\|([^}]*)\}/g, (m, i, forms) => {
    const n = parseFloat(String(args[+i]).replace(/[\s  ]/g, "").replace(",", "."));
    const f = forms.split("|");
    const k = isNaN(n) ? f.length - 1 : (l === "ru" ? RU_PLURAL : EN_PLURAL)(Math.abs(n));
    return f[Math.min(k, f.length - 1)];
  }).replace(/\{(\d+)\}/g, (m, i) => (args[+i] == null ? m : args[+i]));
}

const normApos = (s) => s.replace(/([oOgG])['‘’`ʼ]/g, "$1ʻ").replace(/([A-Za-z])['’`](?=[A-Za-z])/g, "$1ʼ");

/* Bitta boʻlak: aniq → apostrof → harf kattaligi → raqam shabloni → qoida. */
function lookup1(s, l) {
  const d = DICT[l];
  if (!d) return null;                 // lug'at hali yuklanmagan
  if (d[s] !== undefined) return d[s];
  const n = normApos(s);
  if (n !== s && d[n] !== undefined) return d[n];
  const first = n[0];
  if (first && first !== first.toUpperCase() && d[cap(n)] !== undefined) {
    const v = d[cap(n)];
    return /^[A-ZА-ЯЁ][a-zа-яё]/.test(v) ? v[0].toLowerCase() + v.slice(1) : v;
  }
  if (first && first !== first.toLowerCase()) {
    const lo = first.toLowerCase() + n.slice(1);
    if (d[lo] !== undefined) return cap(d[lo]);
  }
  if (/\d/.test(n)) {
    const args = [];
    const key = n.replace(NUM, (m) => "{" + (args.push(m) - 1) + "}");
    if (d[key] !== undefined) return fill(d[key], args, l);
  }
  for (const [re, fn] of RULES[l]) {
    const m = n.match(re);
    if (m) {
      const r = fn(m, (x) => translate(x, l));
      if (r != null) return r;
    }
  }
  return null;
}

const PEEL = /^([\s—·:,;(«“"'→←↑↓•–-]*)([\s\S]*?)([\s:·,;.…—)»”"'!?→–-]*)$/;
const SPLIT = /(\s+[·—–→]\s+|:\s+|\s*\|\s*|;\s+|\.\s+(?=[A-ZА-ЯЁ]))/;

function lookup(s, l) {
  let r = lookup1(s, l);
  if (r != null) return r;
  const p = PEEL.exec(s);
  if (p && (p[1] || p[3]) && p[2]) {
    r = lookup1(p[2], l);
    if (r != null) return p[1] + r + p[3];
  }
  if (SPLIT.test(s)) {
    const parts = s.split(SPLIT);
    let hit = false;
    const out = parts.map((x, i) => {
      if (i % 2 || !/[A-Za-z]/.test(x)) return x;
      const y = lookup(x, l);
      if (y != null) { hit = true; return y; }
      return x;
    });
    if (hit) return out.join("");
  }
  return null;
}

const cache = { ru: new Map(), en: new Map(), "uz-cyrl": new Map() };
const DEBUG = (() => { try { return localStorage.getItem("nigoh.i18n.debug") === "1"; } catch (e) { return false; } })();
const missing = new Set();

/* Kodga oʻxshash yoki tarjimasi kerak boʻlmagan satr. */
function untranslatable(core) {
  if (!/[A-Za-zʻʼ]/.test(core)) return true;                       // raqam, belgi
  if (/^(https?|rtsp|rtmp|wss?):\/\//i.test(core)) return true;     // URL
  if (/^[\w.-]+@[\w.-]+$/.test(core)) return true;                  // e-pochta
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/\S*)?$/.test(core)) return true;  // IP
  if (/\b[a-z_]+=\S/.test(core)) return true;                       // log tafsiloti: key=value
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(core)) return true;           // hodisa kodi: stream_stalled
  if (/^\/\S*$/.test(core)) return true;                            // yoʻl: /Streaming/Channels/101
  return false;
}

export function translate(src, l = lang) {
  if (l === "uz" || src == null) return src;
  const str = String(src);
  const c = cache[l];
  if (!c) return str;
  let r = c.get(str);
  if (r !== undefined) return r;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(str);
  const core = m[2];
  if (untranslatable(core)) r = str;
  else if (l === "uz-cyrl") r = m[1] + translit(core) + m[3];
  else if (/^\d+(\/\d+)? km\b/.test(core) && !/ · /.test(core)) r = str;   // kamera nomi: "3415/3 km (2)"
  else {
    const t = lookup(core, l);
    if (t == null) {
      r = str;
      if (DEBUG && /[a-zʻʼ]{2}/.test(core)) missing.add(core);
    } else r = m[1] + t + m[3];
  }
  if (c.size > 20000) c.clear();
  c.set(str, r);
  return r;
}


export function setCurrentLang(id) { if (IDS.includes(id)) lang = id; }
export function getCurrentLang() { return lang; }

/* Rail yorlig'i 64px ga sig'ishi kerak — uzun tarjimalarning qisqa shakli. */
export const SHORT = { "uz-cyrl": { "Video devor": "Девор", "Sozlamalar": "Созлама" }, en: { "Boshqaruv": "Manage" } };
