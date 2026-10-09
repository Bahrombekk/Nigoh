# Interfeys — React + Vite + TypeScript (`frontend/`, 3.0.1 dan)

v3.0.0 dagi vanilla JS interfeys 3.0.1 da React'ga ko'chirildi va o'chirildi (dizayn o'zgarmagan;
eski kod git tarixida — `git show v3.0.0:frontend/...`). Xatti-harakat bo'yicha manba (har bo'lim modulining fayl boshidagi izohlari,
`docs/V3_FRONTEND.md`, `docs/V3_API.md`, `docs/UZ_GLOSSARY.md`).

## Ishga tushirish

```bash
cd frontend
npm run dev          # http://localhost:5173 ; /api /health /assets → NIGOH_API (standart http://localhost:8010)
npx tsc -b           # tip tekshiruvi (xatosiz bo'lishi shart)
npm run build        # dist/ — backend standart holatda frontend/dist ni beradi (start.bat yo'q bo'lsa o'zi yig'adi)
```

## Tuzilma

| Yo'l | Nima |
|---|---|
| `src/styles/*.css` | v3 CSS fayllari (tokens, base, shell, login, map, dash, wall, admin, settings) — **o'sha klasslar**. Bo'lim CSS'i o'z sahifasida import qilinadi |
| `src/components/Icon.tsx`, `icons.ts` | `<Icon name size="xs\|sm\|md\|lg"/>` (FA nomlari). Yangi ikon → `icons.ts` ga qo'shing |
| `src/components/ui.tsx` | `Button`, `IconButton` (tip majburiy), `Badge`, `Dot`, `Chip`, `Seg`, `Switch`, `Check`, `InfoTip`, `Alert`, `EmptyState`, `SkeletonRows`, `SearchField`, `Field`, `Kbd`, `cx` |
| `src/components/overlays.tsx` | `Popover`, `Menu`, `useMenuAnchor`, `Dialog`, `useToast()`, `useConfirm()`, `useShortcut(key, fn)`, `useDelayed(flag)`; tooltip — istalgan elementga `data-tip="…"` (o'zbekcha, avtomatik tarjima) |
| `src/lib/api.ts` | `api<T>(path, {method, body})`, `ApiError` (`status`, `body`) |
| `src/lib/types.ts` | `Camera`, `Me`, `SystemState`, `Notice`, `camStatus(cam)`, `STATUS_LABEL`, `ROLE_LABEL` |
| `src/lib/prefs.ts` | `usePref(key, def)` — localStorage + server (kalitlar v3 dagidek: layers, panel, onboarding, wall, dashTab, dashPeriod) |
| `src/lib/theme.ts` | `useTheme()`, `cssVar("--color-…")`; mavzu almashganda `window` "nigoh:theme" hodisasi |
| `src/lib/format.ts` | `fmtTime`, `fmtHm`, `fmtDateShort`, `fmtNum`, `fmtPct`, `fmtDur`, `fmtAgo`, `debounce`, `p2` |
| `src/data/queries.ts` | TanStack Query: `useMe`, `useCameras()` (poll_s bo'yicha), `useSystemState`, `useNotifications`, `useMarkRead`, `usePollSeconds`. Yangi so'rovlar shu uslubda (sahifa ichida yoki shu faylga yaqin `pages/<x>/queries.ts`) |
| `src/auth/*` | `useAuth()` — `user` (`role`), `guest`, `openLogin()`; `isAdmin(user)` |
| `src/i18n/*` | `useT()` → `t("Oʻzbekcha matn")`. **Har ko'rinadigan matn `t()` dan o'tadi** (atributlar ham: placeholder, aria-label; `data-tip` esa avtomatik). Manba — o'zbekcha (glossariy), ru/en lug'atlar `src/i18n/ru.js`, `en.js` — yangi matn qo'shsangiz ikkalasiga ham kalit qo'shing |
| `src/layout/AppShell.tsx` | rail, profil, yordam; `PageSheet` (xaritadan tashqari sahifa "sheet"i) |
| `src/layout/Sysbar.tsx` | `<Sysbar/>` — tizim holati + soat + bildirishnomalar |
| `src/player/usePlayer.ts` | `usePlayer(camera, {quality, enabled})` → `videoRef`, `msgRef`, `status`, `openMs`, `retry` (WebRTC→HLS, v3 player.js) |
| `src/pages/<bo'lim>/` | bo'lim kodi: `MapPage`, `DashPage`, `WallPage`, `AdminPage`, `SettingsPage` (default export) |

## Marshrutlar (HashRouter)

`#/` xarita (`?camera=ID` — kamerani ochish, `?panel=closed`), `#/dash/:sub` (hozir/trend/tahlil),
`#/wall/:sub` (focus), `#/admin`, `#/settings/:sub`. `useParams`, `useNavigate`, `useSearchParams`
(`react-router` v7 dan import). Boshqa bo'limdan kamerani ochish: `navigate("/?camera=" + id)`.

## Qoidalar

- TypeScript strict; `any` dan qoching. Komponentlar funksional, hook'lar bilan.
- Leaflet: react-leaflet o'rniga to'g'ridan-to'g'ri Leaflet (`useEffect` ichida) — v3 mantiqi
  (markercluster yamoqlari, klaster radiusi, chegaralar) aynan ko'chadi.
- Ko'p yangilanadigan ro'yxatlarda `key` barqaror (kamera id), `useMemo` bilan hisoblang.
- Rang/o'lcham — faqat CSS tokenlari; v3 CSS klasslarini ishlating, yangi uslub — bo'lim CSS fayliga.
- Esc: ochiq popover/dialog o'zi yopiladi; sahifa darajasidagi Esc — `useShortcut("Escape", …)`
  (return false — boshqalarga qoldirish).

## Statik fayllar

`public/assets/` — geojson (chegaralar, temir yo'l) va fon suratlari; build'da `dist/assets/` ga
ko'chadi. Ularni `backend/scripts/build_boundaries.py`, `build_railways_v2.py` yangilaydi.
