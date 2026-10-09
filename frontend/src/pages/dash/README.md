# pages/dash — Statistika (v4 React)

v3 `frontend/js/dashboard/*` ning React ko'chirmasi. Dizayn, CSS klasslari (`src/styles/dash.css`) va
xatti-harakat v3 bilan bir xil.

| Fayl | Nima |
|---|---|
| `DashPage.tsx` | Sarlavha: tablar Hozir / Dinamika / Tahlil (`#/dash/hozir\|trend\|tahlil`, prefs `dashTab`, ← / →), davr Bugun / 7 kun / 30 kun (prefs `dashPeriod`), `<Sysbar flat/>` |
| `HozirTab.tsx` | 4 StatCard, Liniya holati, Diqqat talab qiladi (Uzilgan / Beqaror), Hududlar holati, Soʻnggi hodisalar, Bugungi tahlil, Tezkor amallar (admin), Tizim holati |
| `TrendTab.tsx` | Onlaynlik darajasi + SLA, Kunlik onlaynlik, Kunlik uzilishlar, Uzilishlar xaritasi, Sutka soatlari, Oldingi davr bilan |
| `TahlilTab.tsx` | Ishonchlilik, Hududlar reytingi (+CSV), Ishlash ulushi taqsimoti, Kamera markalari, Kamera holatlari (donut), Reyting, Eng uzun uzilishlar, Ochilish vaqti, Texnik kesim, Maʼlumot sifati |
| `charts.tsx` | SVG grafiklar: Sparkline, LineChart, Columns, HourBars, Heatmap, Donut; `.db-tip` maslahati. Ranglar `cssVar()`, qayta chizish — ResizeObserver va `window` "nigoh:theme" |
| `queries.ts` | TanStack Query hook'lari, kalit `["stats", url]` (url'da davr). Xatoda qayta urinmaydi; "Qayta urinish" → `invalidateQueries(["stats"])` |
| `common.tsx` | v3 formatlari (`fmtPct`, `fmtInt`, `fmtDur`, …), holat modeli, karta holatlari (skeleton 300 ms dan keyin, Alert, bo'sh, 404 → "Server bu hisobotni bermaydi"), navigatsiya |
| `i18n-new.json` | v3 lug'atida yo'q yangi kalitlar (ru/en) — umumiy lug'atga qo'shish uchun |

## Boshqa bo'limlarga o'tish (kontrakt)

- **Kamera** — `navigate("/?camera=" + id)`.
- **Hudud xaritada** (Hududlar holati, Hududlar reytingi qatori) — `navigate("/?q=" + encodeURIComponent(region))`.
  Xarita `q` ni kameralar ro'yxati qidiruviga qo'yishi kerak (v3 `camera-list.setQuery(region, true)`).
- **Tizim holati** (Tezkor amallar) — `navigate("/settings/tizim")`.

### Boshqaruv filtri — `navigate("/admin", { state })`

```ts
state = {
  adminFilter?: {
    status?: "offline";   // "Diqqat talab qiladi → Barchasi": holat chipi "Uzilgan"
    quality?: string;     // Maʼlumot sifati tekshiruvi kaliti: no_location | no_region | no_km | no_codec |
                          //   never_seen | no_model | probe_failed | vendor_mismatch | km_name_mismatch
    ids?: number[];       // shu tekshiruvdagi kameralar id'lari (server ko'pi bilan 50 ta beradi)
    label?: string;       // filtr chipi yorlig'i, o'zbekcha (t() bilan): "Koordinatasi yoʻq", …
    count?: number;       // tekshiruvdagi jami kamchiliklar (ids dan ko'p bo'lishi mumkin)
  };
  adminAction?: "new-camera" | "sync";  // Tezkor amallar: "Kamera qoʻshish" oynasini ochish /
                                         //   MediaMTX sinxronlash (v3 #sync-btn) — bir marta
}
```

Turi: `AdminFilterHint`, `AdminAction` (`common.tsx`). Admin sahifasi ishorani bir marta oladi va
`navigate(pathname, { replace: true, state: null })` bilan tozalaydi (v3 `consumeHint()`).
Faqat administrator yuboradi; boshqa rollar uchun "Barchasi" — xarita, sifat qatori — qator ostida ro'yxat.
