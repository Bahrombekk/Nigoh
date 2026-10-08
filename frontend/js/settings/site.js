/* ==========================================================================
   settings/site.js — sayt sozlamalari: Umumiy (06.01), Kirish va xavfsizlik
   (06.05), Kuzatuv (06.02 / 06.09)
   --------------------------------------------------------------------------
   Vazifasi:
     /api/admin/settings ro'yxatidan SettingRow qatorlarini chizadi:
     nom + InfoTip (to'liq izoh) + bitta qator meta ("Standart: 60 s · oraliq
     30–600") + boshqaruv (Switch / Number / Select / Segmented / TextField).
       - Number/Select/Text — qoralamaga (draft) tushadi; pastda "N ta oʻzgarish
         saqlanmagan" paneli (Bekor qilish / Saqlash) → toast "Sozlamalar saqlandi".
         O'zgargan qator: meta "Oʻzgartirildi: 60 s → 45 s" (brand), maydon 1.5px brand.
       - Switch — darhol qo'llanadi (Figma: Saqlash kerak emas).
       - Mavzu (White/Cream/Dark) — shaxsiy, core/theme.js orqali, darhol.
       - Til — server `language` bersa saytning standart tili (qoralama → Saqlash),
         bermasa shaxsiy afzallik (prefs.lang, darhol). 4 til: uz, uz-cyrl, ru, en
         (core/i18n.js); til nomlari oʻz yozuvida (data-no-i18n).
     Server bermagan sozlama (eski backend) — qatori chizilmaydi.
     Qoralama bor ekan sahifada `.is-dirty` (profil "Chiqish" ogohlantiradi).

   Eksport: SiteForm (klass), FORM_SECTIONS
   Backend: GET/PUT /api/admin/settings ({values: {kalit: qiymat | null}})
   ========================================================================== */
import { $, esc } from "../core/state.js";
import { api } from "../core/api.js";
import { toast, infotip } from "../core/ui.js";
import { THEMES, getTheme, setTheme } from "../core/theme.js";
import { getLang, setLang } from "../core/i18n.js";
import { applySiteName } from "./util.js";

export const FORM_SECTIONS = ["umumiy", "xavfsizlik", "kuzatuv"];

/* Bo'lim tarkibi (tartib — Figma). "@" bilan boshlanganlar — mijoz tomonidagi qatorlar. */
const LAYOUT = {
  umumiy: ["site_name", "@theme", "language", "timezone"],
  xavfsizlik: ["session_hours", "public_view"],
  kuzatuv: ["health_interval_s", "stall_after_s", "transport_check_after_s", "ui_poll_s", "notify_outage"],
};
const GROUP_SECTION = { "Sayt": "umumiy", "Kirish": "xavfsizlik", "Kuzatuv": "kuzatuv" };

/* Figma matnlari: nom, InfoTip (≤ 120 belgi), meta (bo'sh — standart/oraliq avtomatik). */
const COPY = {
  site_name: { label: "Sayt nomi", tip: "Yon menyu, brauzer sarlavhasi va kirish oynasida koʻrinadigan nom (40 belgigacha).",
    meta: "Yon menyu, brauzer sarlavhasi va kirish oynasida" },
  "@theme": { label: "Mavzu", meta: "Har bir foydalanuvchi uchun alohida saqlanadi" },
  language: { label: "Til", tip: "", meta: "Saytning standart tili · shaxsiy til — profil menyusida" },
  timezone: { label: "Vaqt zonasi", tip: "", meta: "Hisobot va hodisalar vaqti shu boʻyicha" },
  session_hours: { label: "Seans muddati", tip: "Shuncha vaqtdan keyin qaytadan kirish kerak. Yangi kirishlarga qoʻllanadi." },
  public_view: { label: "Mehmon koʻrishi",
    tip: "Kirmagan foydalanuvchi xarita va jonli oqimni koʻradi. Dashboard, guruhlar va boshqaruv yopiq.",
    meta: "Kirmaganlar uchun · faqat koʻrish" },
  health_interval_s: { label: "Holat tekshiruvi oraligʻi",
    tip: "Kameralar RTSP porti qanchalik tez-tez tekshiriladi. Kichik qiymat — uzilish tezroq bilinadi, lekin tarmoqqa yuk koʻproq." },
  stall_after_s: { label: "Tasvir toʻxtashi chegarasi",
    tip: "Ochiq oqimda shuncha vaqt maʼlumot kelmasa — tasvir toʻxtagan hisoblanadi. Juda kichik qiymat soxta ogohlantirish beradi." },
  transport_check_after_s: { label: "Uzatish usulini tekshirish",
    tip: "Oqim shuncha vaqt ochilmasa, TCP va UDP sinab koʻriladi va yaxshisi tanlanadi." },
  ui_poll_s: { label: "Xarita va roʻyxat yangilanishi", tip: "Xarita va kameralar roʻyxati shuncha soniyada bir yangilanadi." },
  notify_outage: { label: "Uzilish haqida bildirishnoma",
    tip: "Kamera uzilgani va qayta ulangani bildirishnomalar roʻyxatida koʻrsatiladi.",
    meta: "Bildirishnomalar roʻyxatida koʻrsatiladi" },
};

const LANG_LABEL = { "uz": "Oʻzbekcha (lotin)", "uz-cyrl": "Ўзбекча (кирилл)", "ru": "Русский", "en": "English" };
const TZ = [
  ["Asia/Tashkent", "Asia/Tashkent (UTC+5)"], ["Asia/Samarkand", "Asia/Samarkand (UTC+5)"],
  ["Asia/Almaty", "Asia/Almaty (UTC+5)"], ["Asia/Dushanbe", "Asia/Dushanbe (UTC+5)"],
  ["Asia/Bishkek", "Asia/Bishkek (UTC+6)"], ["Europe/Moscow", "Europe/Moscow (UTC+3)"], ["UTC", "UTC (UTC+0)"],
];
const THEME_NAME = { white: "Oq", cream: "Qaymoq", dark: "Qorongʻi" };

export class SiteForm {
  constructor(page) {
    this.page = page;
    this.settings = [];
    this.draft = {};
    this.loaded = false;
    this.loading = null;
    this.bound = false;
  }

  /* ---------- yuklash ---------- */
  async load(force) {
    if (this.loaded && !force) { this.render(); return; }
    if (!this.loading) {
      this.loading = api("/api/admin/settings")
        .then((r) => { this.settings = r.settings || []; this.loaded = true; })
        .catch((e) => { toast(e.message, { tone: "error" }); })
        .finally(() => { this.loading = null; });
    }
    await this.loading;
    this.render();
  }

  def(key) { return this.settings.find((s) => s.key === key); }
  cur(s) { return s.key in this.draft ? this.draft[s.key] : s.value; }

  sectionKeys(sec) {
    const keys = LAYOUT[sec].filter((k) => k.startsWith("@") || this.def(k));
    if (sec === "umumiy" && !this.def("language")) keys.splice(keys.indexOf("@theme") + 1, 0, "@lang");
    const known = new Set(Object.values(LAYOUT).flat());
    this.settings.forEach((s) => { if (!known.has(s.key) && GROUP_SECTION[s.group] === sec) keys.push(s.key); });
    return keys;
  }

  /* ---------- chizish ---------- */
  render() {
    this.bind();
    FORM_SECTIONS.forEach((sec) => {
      const box = $("sx-form-" + sec);
      if (!this.loaded) {
        box.innerHTML = '<div class="sx-rows">' + [0, 1, 2].map(() =>
          '<div class="sx-row"><div class="sx-row__text"><span class="skeleton" style="width:180px;height:14px"></span>' +
          '<span class="skeleton" style="width:240px;height:10px"></span></div></div>').join("") + "</div>";
        return;
      }
      box.innerHTML = '<div class="sx-rows">' + this.sectionKeys(sec).map((k) => this.rowHtml(k)).join("") + "</div>";
    });
    this.syncBar();
  }

  rowHtml(key) {
    const c = COPY[key] || {};
    if (key === "@theme") {
      return this.row(key, c.label, null, c.meta,
        '<div class="seg sx-seg" role="radiogroup" aria-label="Mavzu">' + THEMES.map((t) =>
          '<button type="button" role="radio" data-theme-set="' + t.id + '" aria-checked="' + (getTheme() === t.id) + '"' +
          (getTheme() === t.id ? ' class="is-on"' : "") + ">" + THEME_NAME[t.id] + "</button>").join("") + "</div>");
    }
    if (key === "@lang") {
      return this.row(key, "Til", null, null, this.langSelect('data-lang-pref', getLang()));
    }
    const s = this.def(key);
    const label = c.label || s.label;
    const tip = "tip" in c ? c.tip : s.help && s.help.length > 120 ? s.help.slice(0, 117) + "…" : s.help || "";
    const v = this.cur(s);
    let ctl;
    if (s.kind === "bool") {
      ctl = '<button type="button" class="switch" role="switch" aria-checked="' + !!v + '" data-k="' + s.key +
        '" aria-label="' + esc(label) + '"></button>';
    } else if (s.kind === "int") {
      ctl = '<label class="sx-num"><input class="input" type="number" inputmode="numeric" data-k="' + s.key + '" value="' +
        esc(String(v)) + '"' + (s.min != null ? ' min="' + s.min + '"' : "") + (s.max != null ? ' max="' + s.max + '"' : "") +
        ' aria-label="' + esc(label) + '">' + (s.unit ? '<span class="sx-num__u">' + esc(s.unit) + "</span>" : "") + "</label>";
    } else if (s.key === "language" || (s.kind === "choice" && (s.choices || []).every((x) => LANG_LABEL[x]))) {
      ctl = this.langSelect('data-k="' + s.key + '"', v, s.choices);
    } else if (s.kind === "choice") {
      ctl = '<select class="select sx-sel240" data-k="' + s.key + '" aria-label="' + esc(label) + '">' +
        (s.choices || []).map((x) => '<option value="' + esc(x) + '"' + (x === v ? " selected" : "") + ">" + esc(x) + "</option>").join("") + "</select>";
    } else if (s.key === "timezone") {
      const list = TZ.some(([id]) => id === v) ? TZ : [[v, v], ...TZ];
      ctl = '<select class="select sx-sel240" data-k="timezone" aria-label="Vaqt zonasi">' +
        list.map(([id, t]) => '<option value="' + esc(id) + '"' + (id === v ? " selected" : "") + ">" + esc(t) + "</option>").join("") + "</select>";
    } else {
      ctl = '<input class="input sx-text" data-k="' + s.key + '" value="' + esc(String(v)) + '"' +
        (s.max ? ' maxlength="' + s.max + '"' : "") + ' aria-label="' + esc(label) + '">';
    }
    return this.row(key, label, tip, this.metaHtml(s), ctl, s.kind === "bool");
  }

  langSelect(attr, cur, choices) {
    const ids = choices && choices.length ? choices : Object.keys(LANG_LABEL);
    return '<select class="select sx-sel240" ' + attr + ' aria-label="Til">' + ids.map((id) =>
      '<option value="' + id + '"' + (id === cur ? " selected" : "") + " data-no-i18n>" +
      esc(LANG_LABEL[id] || id) + "</option>").join("") + "</select>";
  }

  row(key, label, tip, meta, ctl, isSwitch) {
    const s = key.startsWith("@") ? null : this.def(key);
    const dirty = s && s.key in this.draft;
    const bad = dirty && !this.valid(s, this.draft[s.key]);
    return '<div class="sx-row' + (dirty ? " sx-row--dirty" : "") + (bad ? " sx-row--error" : "") +
      (isSwitch ? " sx-row--switch" : "") + '" data-row="' + esc(key) + '">' +
      '<div class="sx-row__text"><div class="sx-row__title"><span class="label-md">' + esc(label) + "</span>" +
        (tip ? infotip(tip) : "") + "</div>" +
        (meta ? '<div class="sx-row__meta body-xs">' + meta + "</div>" : "") + "</div>" +
      '<div class="sx-row__ctl">' + ctl + "</div></div>";
  }

  fmt(s, v) {
    if (s.kind === "bool") return v ? "yoqiq" : "oʻchiq";
    if (s.kind === "choice" && LANG_LABEL[v]) return LANG_LABEL[v];
    return String(v) + (s.unit ? " " + s.unit : "");
  }

  metaHtml(s) {
    const c = COPY[s.key] || {};
    if (s.key in this.draft) {
      const v = this.draft[s.key];
      if (!this.valid(s, v)) {
        return '<span class="t-error">' + (s.kind === "int" ? "Oraliq " + s.min + "–" + s.max + (s.unit ? " " + esc(s.unit) : "")
          : "1–" + (s.max || 40) + " belgi") + "</span>";
      }
      return '<span class="t-brand">Oʻzgartirildi: ' + esc(this.fmt(s, s.value)) + " → " + esc(this.fmt(s, v)) + "</span>";
    }
    let m = c.meta;
    if (m === null) m = "";
    else if (m === undefined) {
      m = "Standart: " + this.fmt(s, s.default) + (s.kind === "int" && s.min != null ? " · oraliq " + s.min + "–" + s.max : "");
    }
    m = esc(m);
    if (s.changed && s.kind !== "bool" && s.value !== s.default) {
      m += (m ? " · " : "") + '<button type="button" class="sx-link" data-reset="' + s.key + '">Standartga qaytarish</button>';
    }
    return m;
  }

  valid(s, v) {
    if (s.kind === "int") return Number.isInteger(v) && (s.min == null || v >= s.min) && (s.max == null || v <= s.max);
    if (s.kind === "str") return typeof v === "string" && v.trim().length > 0 && (!s.max || v.trim().length <= s.max);
    return true;
  }

  /* ---------- hodisalar (bir marta, delegatsiya) ---------- */
  bind() {
    if (this.bound) return;
    this.bound = true;
    const root = $("settings-view");
    root.addEventListener("input", (e) => {
      const el = e.target.closest("[data-k]");
      if (!el || el.classList.contains("switch")) return;
      const s = this.def(el.dataset.k);
      if (!s) return;
      let v = el.value;
      if (s.kind === "int") v = el.value === "" ? NaN : Number(el.value);
      this.setDraft(s, v);
    });
    root.addEventListener("change", (e) => {
      const lp = e.target.closest("[data-lang-pref]");
      if (lp) setLang(lp.value);
    });
    root.addEventListener("click", (e) => {
      const t = e.target;
      const th = t.closest("[data-theme-set]");
      if (th) { setTheme(th.dataset.themeSet); return; }
      const rs = t.closest("[data-reset]");
      if (rs) { const s = this.def(rs.dataset.reset); if (s) this.setDraft(s, s.default, true); return; }
      const sw = t.closest(".switch[data-k]");
      // Switch: butun qator bosish maydoni (InfoTip bundan mustasno)
      const row = !sw && !t.closest(".infotip") && t.closest(".sx-row--switch");
      const btn = sw || (row && row.querySelector(".switch[data-k]"));
      if (btn) this.toggleNow(btn);
    });
    document.addEventListener("theme:changed", () => {
      document.querySelectorAll("#settings-view [data-theme-set]").forEach((b) => {
        const on = b.dataset.themeSet === getTheme();
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-checked", String(on));
      });
    });
    $("sx-save").addEventListener("click", () => this.save());
    $("sx-cancel").addEventListener("click", () => { this.draft = {}; this.render(); });
    addEventListener("beforeunload", (e) => {
      if (Object.keys(this.draft).length) { e.preventDefault(); e.returnValue = ""; }
    });
  }

  setDraft(s, v, rerender) {
    if (v === s.value || (typeof v === "string" && typeof s.value === "string" && v.trim() === s.value)) delete this.draft[s.key];
    else this.draft[s.key] = v;
    if (rerender) { this.render(); return; }
    // Faqat shu qator yangilanadi — fokus va kursor joyida qoladi.
    const row = document.querySelector('#settings-view [data-row="' + s.key + '"]');
    if (row) {
      const dirty = s.key in this.draft;
      row.classList.toggle("sx-row--dirty", dirty);
      row.classList.toggle("sx-row--error", dirty && !this.valid(s, this.draft[s.key]));
      let meta = row.querySelector(".sx-row__meta");
      const html = this.metaHtml(s);
      if (!meta && html) {
        meta = document.createElement("div");
        meta.className = "sx-row__meta body-xs";
        row.querySelector(".sx-row__text").appendChild(meta);
      }
      if (meta) meta.innerHTML = html;
    }
    this.syncBar();
  }

  syncBar() {
    const keys = Object.keys(this.draft);
    const n = keys.length;
    const onForm = FORM_SECTIONS.includes(this.page.section);
    $("sx-bar").hidden = !n || !onForm;
    $("sx-bar-n").textContent = n + " ta oʻzgarish saqlanmagan";
    $("sx-save").disabled = keys.some((k) => !this.valid(this.def(k), this.draft[k]));
    $("settings-view").classList.toggle("is-dirty", n > 0);
  }

  async put(values) {
    const res = await api("/api/admin/settings", { method: "PUT", body: JSON.stringify({ values }) });
    if (res && res.settings) this.settings = res.settings;
    const name = this.def("site_name");
    if (name) applySiteName(name.value);
    document.dispatchEvent(new CustomEvent("settings:changed", { detail: { values } }));
    return res;
  }

  async save() {
    const keys = Object.keys(this.draft);
    if (!keys.length) return;
    const values = {};
    keys.forEach((k) => { const v = this.draft[k]; values[k] = typeof v === "string" ? v.trim() : v; });
    $("sx-save").disabled = true;
    try { await this.put(values); }
    catch (e) { toast(e.message, { tone: "error" }); $("sx-save").disabled = false; return; }
    this.draft = {};
    this.render();
    toast("Sozlamalar saqlandi");
  }

  /* Switch darhol saqlanadi; xato bo'lsa qaytadi. */
  async toggleNow(btn) {
    const s = this.def(btn.dataset.k);
    if (!s || btn.disabled) return;
    const v = btn.getAttribute("aria-checked") !== "true";
    btn.setAttribute("aria-checked", String(v));
    btn.disabled = true;
    try {
      await this.put({ [s.key]: v });
      toast("Sozlamalar saqlandi");
    } catch (e) {
      btn.setAttribute("aria-checked", String(!v));
      toast(e.message, { tone: "error" });
    }
    btn.disabled = false;
  }
}
