> **Tarixiy hujjat.** 3.0.1 dan interfeys React'da — `docs/V4_REACT.md`. Bu yerdagi tokenlar,
> komponent klasslari va qoidalar React'da ham amal qiladi (CSS fayllari o'zgarmagan).

# v3 frontend — qobiq va umumiy komponentlar (Figma "Nigoh vision")

Figma fayli: `ddCkB9SY2dEsbAHtiNEOYM`. Batafsil ekran tavsiflari (agentlar uchun):
`%SCRATCH%\figma\01-foundations-components.md` (tokenlar, komponentlar, Dev handoff),
`02-kirish-xarita-global.md`, `03-dashboard-devor-rahbariyat.md`, `04-boshqaruv-sozlamalar.md`.

## Fayllar

| Fayl | Kimniki | Nima |
|---|---|---|
| `css/tokens.css` | umumiy | Figma o'zgaruvchilari, 3 mavzu (`<html data-theme="white|cream|dark">`) — `--color-*`, `--map-*`, `--button-*`, `--input-*`, `--video-*`, `--spacing-*`, `--radius-*`, `--shadow-*`, `--z-*` |
| `css/base.css` | umumiy | reset, tipografiya klasslari, komponentlar (ro'yxat fayl boshida) |
| `css/shell.css`, `css/login.css` | umumiy | rail, sheet, sysbar, bildirishnomalar, profil, kirish |
| `css/map.css`, `dash.css`, `wall.css`, `admin.css`, `settings.css` | bo'lim | har bo'lim faqat o'z faylida; klasslar bo'lim prefiksi bilan (`.mp-`, `.db-`, `.wl-`, `.ad-`, `.sx-`) |

Qattiq qoida: rang, o'lcham, soya, radius — **faqat tokenlar** (`var(--…)`). Hex yozilmaydi
(faqat tokens.css'da). Shrift: Onest (UI), JetBrains Mono (IP, URL, ID, vaqt, kodek, log).
Raqamli ko'rsatkichlar `font-variant-numeric: tabular-nums` (`.tnum`, `.numeric-*`).

## Komponent klasslari (`css/base.css`)

`.btn` (+`--primary/--secondary/--tertiary/--danger`, `--sm`, `--block`) · `.icon-btn` (+`--sm`, `--secondary`, `--primary`, `.is-on`)
· `.field` > `.field__label` + `.input|.select|.textarea` + `.field__hint` (`.field.is-error`) · `.input-wrap`
· `.search` (`<label class="search"><svg/><input type="search"><button class="search__clear"/><span class="kbd">/</span></label>`, `.is-filled`)
· `.seg` > `button.is-on` (+`.seg__count`; `.seg--inline`, `.seg--sm`) · `.chips` > `.chip.is-on` (+`.dot[data-status]`, `.chip__count`)
· `.badge[data-status=online|no-video|offline|disabled|unknown|brand|warning]` (+`--count`, `--solid`) · `.dot[data-status]`
· `.switch[role=switch][aria-checked]` · `input.check` (indeterminate qo'llanadi) · `.check-row`
· `.infotip` (yoki `infotip(text)` JS) · `.alert--error|warning|info|success` > `.alert__body` > `.alert__title` + `.alert__text`
· `.card` (+`.card__head`, `.card__title`) · `.popover` · `.menu` > `.menu__item` (`.is-danger`, `.menu__kbd`), `.menu__sep`, `.menu__label`
· `.dialog-backdrop.open` > `.dialog` (+`--md` 560, `--lg` 720) > `.dialog__head` `.dialog__title` `.dialog__close` `.dialog__actions`
· `.skeleton` · `.empty` (`emptyState()` JS) · `.kpi-tile` · `.detail-row` · `.codec-tag` · `.tbl` (`tr.is-selected`, `th.sortable.is-sorted`)
· `.kbd` · `.pulse` (Live/Pulse, `color` = puls rangi) · `.spinner`
· Tipografiya: `.heading-xl|lg|md|sm`, `.body-lg|md|sm|xs`, `.label-lg|md|sm|xs|2xs`, `.overline`, `.numeric-2xl|xl|lg|md`, `.mono-sm|xs`, `.t-primary|secondary|tertiary|brand|error|success|warning`, `.ellipsis`, `.spacer`

Holat modeli (backend `state` → UI): `online`→`online` "Onlayn", `stalled`→`no-video` "Tasvirsiz",
`offline`→`offline` "Uzilgan", `disabled`→`disabled` "Oʻchirilgan", `unknown`→`unknown` "Nomaʼlum".
Rang hech qachon yolg'iz emas — nuqta + matn.

## JS xizmatlar

- `core/icons.js` — `icon(name, size="md"|"sm"|"xs"|"lg")` → SVG satr (Figma FA nomlari: `camera`, `camera-slash`,
  `layer-group`, `location-crosshairs`, `circle-question`, `dots-horizontal`, ...); `hydrateIcons(root)` —
  `data-icon="nom" data-icon-size="sm"` atributli elementlarga ikonka qo'yadi. Yangi ikonka kerak bo'lsa `ICONS` ga qo'shing.
  Qoida: ≤16px → `sm`, ≥20px → `md`.
- `core/ui.js` — `toast(text, {tone, action, onAction})`, `confirmDialog({title, text, ok, danger})` (Promise<bool>),
  `popover(anchor, html|el, {place, offset, cls, width, onClose})`, `closePopovers()`, `menu(anchor, items, opts)`,
  `infotip(text, title?)`, `emptyState({type, title, text, action, primary, id})`, `skeletonRows(n)`, `delayed(fn, 300)`,
  `onShortcut(key, fn)` (input ichida ishlamaydi), `debounce`, `fmtTime`, `fmtDateShort`.
  Tooltip: istalgan elementga `data-tip="…"` (+`data-tip-title`, `data-tip-place="right|bottom"`) — avtomatik.
  IconButton'da `data-tip` majburiy (aria-label undan olinadi).
- `core/state.js` — `state`, `$`, `esc`, `toast(text, bad|opts)` (ui.js'ga yo'naltiradi).
- `core/api.js` — `api(path, opts)`; xato `ApiError` (`.status`, `.body`). `state.apiOk` + `"api:status"` hodisasi.
- `core/prefs.js` — `prefs.get/set` (localStorage + kirganda serverga). Kalitlar: `layers`, `panel`, `onboarding`, `wall`, `dashTab`, `dashPeriod`.
- `core/i18n.js` — til (`prefs.lang`: `uz` manba, `uz-cyrl`, `ru`, `en`). Kodda matn oʻzbekcha (lotin) yoziladi;
  DOM tarjimoni matn tugunlari va `placeholder/title/aria-label/data-tip/data-tip-title/alt` ni joyida almashtiradi
  (MutationObserver). Kirill — avtomatik transliteratsiya; ru/en — `core/i18n/ru.js`, `en.js` lugʻati (kalit = aynan
  oʻzbekcha satr, raqamlar `{0}` shablon, `{0|камера|камеры|камер}` son shakli). Yangi UI satri qoʻshsangiz ikkala
  lugʻatga ham qoʻshing. JS'da quriladigan, DOM'ga tushmaydigan matn (`window.confirm`, canvas) — `t("…")`.
  Tarjima qilinmasin: `data-no-i18n`. Tekshirish: `localStorage["nigoh.i18n.debug"]="1"` → `__i18n.missing`.
- `core/theme.js` — `setTheme`, `getTheme`, hodisa `"theme:changed"` (xarita plitkalari, grafik ranglari shunda yangilanadi).
  Grafiklarda rangni `getComputedStyle(document.documentElement).getPropertyValue("--color-…")` bilan oling.
- `core/modals.js` — statik `.dialog-backdrop` lar: `openModal(id)`, `closeModal(id)`, hodisa `"modal:closed"` (detail.id).
- `layout/tabs.js` — `registerPage(tab, {show(sub), hide()})`, `showTab(tab, sub)`, `setSub(sub)` (masalan `#dash/trend`),
  `[data-tab-go="dash/trend"]` havolalar. Esc: `document` ga `"page:escape"` hodisasi keladi (popover/modal yopilmagan bo'lsa).
- `layout/notifications.js` — `mountSysbar(container)` — "Tizim holati · soat · qo'ng'iroq" (Toolbar / Tizim). Xarita
  toolbar'i va dashboard/devor sarlavhasi shuni joylaydi.
- Hodisa `"camera:select"` (detail.id) — istalgan joydan kamerani xaritada ochish.

## Sahifa qobig'i

- `#map-view.page.page--map` — xarita butun ekran (rail ustida, 72px). Panellar suzuvchi (Figma 02).
- `#dash-view`, `#wall-view`, `#admin-view`, `#settings-view` — `.page.page--sheet` > `.sheet` (88,16 → o'ng/past 16;
  `bg/sheet` + blur 24, r16, padding 16/24). Ichida `.page-head` (sarlavha + amallar + sysbar).
- Body: `body[data-tab]`, `.authed`, `.anon`, `.is-admin`, `.operator`, `.viewer`. `.admin-only`, `.auth-only` klasslari bor.
- Breakpointlar (Dev handoff): ≥1440 asos · 1280–1439 panel 320 · 1024–1279 panel yig'ilgan · <1024 planshet · ≤640 telefon
  (rail pastki menyu 64px). Har sahifa 1760 / 1280 / 375 da tekshiriladi, gorizontal scroll bo'lmasin.

## Backend

`docs/V3_API.md` — v3 endpointlari. Interfeys eski (v2) serverda ham buzilmaydi: endpoint 404 bersa
zaxira yo'l yoki element yashiriladi (masalan Boshqaruv filtrlari brauzerda hisoblanadi).

## Statik fon suratlari

`assets/backdrop-{white,cream,dark}.jpg` (sahifalar foni, blur 6) va `assets/login-*.jpg` (kirish, blur 10) —
xaritaning statik surati (Toshkent atrofi, zoom 9). Xarita uslubi o'zgarsa qayta yasaladi: v3 serverini
ishga tushirib, Playwright bilan xarita UI'sini yashirib skrinshot olinadi va Pillow bilan xiralashtiriladi.
