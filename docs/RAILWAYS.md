# Temir yo'l tarmog'i (xarita qatlami)

Xaritadagi temir yo'l chiziqlari ikki manbadan, ikkalasi ham loyihada saqlanadi:

| Fayl | Nima | Nuqtalar | Holat |
|---|---|---|---|
| `frontend/assets/railways-v2.geojson` | **v2** — OpenStreetMap geometriyasi + bo'linma ranglari, chegarada kesilgan | ~155 ming | standart |
| `frontend/assets/railways.geojson` | v1 — `railway-lines.json` dan | 35 ming (soddalashtirilgan) | eski; afsonadagi "Eski" tugmasi bilan |

Afsonada (xarita chap pastida) "Yangi · OSM / Eski" tugmasi bor — bir bosishda
solishtiriladi. Yangi fayl yuklanmasa qatlam avtomatik eskisiga tushadi.

## Nega v1 yetarli emas edi (2026-10-07 o'lchovi)

- 12 925 ta uchning **9 953 tasi hech narsaga ulanmagan** — yo'l minglab bo'lakka bo'linib ketgan;
- **2 961 ta kesma 500 m dan uzun** (o'rtacha nuqta oralig'i 139 m): egri joylar
  to'g'ri chiziq bilan kesilgan, eng uzuni **27 km**; 2 km dan uzun to'g'ri
  kesmalar jami **~1 600 km** — u yerda haqiqiy yo'l emas, "bo'shliq to'ldirgich";
- **~310 km** yo'l (3 124 nuqta) xaritadagi haqiqiy yo'ldan 25–400 m chetga siljigan;
- eski faylda **10 376 km emas, 8 710 km** bor edi.

## v2 qanday qurilgan

Haqiqiy geometriya OpenStreetMap'dan (xarita plitkalari ham OSM — chiziq yo'lga
aniq tushadi); bo'linma (MTU) ranglari eski fayldan olinadi.

```bash
python backend/scripts/fetch_osm_railways.py            # OSM'dan yuklash (osm_rail.json, ~10 MB; git'ga kirmaydi)
python backend/scripts/build_railways_v2.py             # frontend/assets/railways-v2.geojson
```

1. **Yo'llar** — `railway=rail` (+ qurilayotgan): 12 865 yo'l, 101 mingga yaqin nuqta, 10 376 km.
   **Chegarada kesish:** OSM qo'shni davlatlarga o'tgan yo'llarni ham beradi — ular
   `frontend/assets/uz.geojson` chegarasida (~1 m aniqlikda) kesiladi: 39 yo'l, **43 km** tashqarisi
   olib tashlandi, qolgan **~10 333 km** O'zbekiston ichida (chiziqlar chegarada aniq tugaydi).
2. **Bo'linma** — har yo'l eski fayldagi eng yaqin rangli chiziqdan ovoz bilan
   (120 m ichida): 11 995 yo'l; qolganlari tarmoq bo'ylab tarqatilgan (233),
   eng yaqin rangli yo'ldan (637).
3. **Toifa** (`kind`): `main` asosiy liniya (4 904 km), `branch` tarmoq (532 km),
   `other` teglanmagan jamoat yo'li (58 km), `industrial` sanoat tarmog'i (3 219 km),
   `yard` stansiya yo'llari (1 675 km). **Tezyurar** (`hs`): `maxspeed >= 160` yoki
   nomida "tezyurar" — **1 019 km** (Toshkent–Samarqand–Buxoro, Samarqand–Qarshi).
4. **Ulash** — bir guruhdagi bo'laklar uzluksiz yo'llarga birlashtiriladi; 1,5 m
   dan kichik bo'shliqlar yopiladi; 15 m gacha uzilishlar (faqat uchlari bir-biriga
   qaraganda, yonma-yon tupiklar emas) qisqa bo'lak bilan to'ldiriladi (90 ta).
5. **Nuqtalar** — detail darajada geometriya to'liq (0,45 m dan mayda siljish
   olib tashlanadi), 100 m dan uzun to'g'ri kesmalarga oraliq nuqtalar qo'shiladi.
6. **Ikki daraja aniqlik** (`lod`): `overview` (z < 10) — faqat main/branch/other,
   birlashtirilgan, silliqlangan, mayda tarmoqlarsiz (9 ming nuqta); `detail` —
   hamma narsa, sanoat va stansiya yo'llari z ≥ 12 dan.

Elektrlashtirilgan: **4 099 km**. Ko'prik: 68 km, tunnel: 21 km (OSM teglari).

## Eski bilan solishtirish

- Eskining ~9 600 km i yangi bilan 50 m ichida mos tushadi;
- yangida eskida **bo'lmagan ~1 500 km** yo'l bor;
- faqat eskida qolgan ~280 km — asosan Olmaliq koni (69,65 E / 40,81 N), Farg'ona
  vodiysi (72,9 E / 40,7 N) va Toshkent stansiyalari atrofidagi zich yo'l bo'laklari;
  ular v2 ga kiritilmagan (OSM'dagi bilan takrorlanadi yoki siljigan).
  Tekshirib ko'rish uchun `?rails=v1` bilan ochib solishtiring.

## Kameralar (xaritadagi koordinata tekshiruvi)

145 ta koordinatali kameradan **142 tasi yo'ldan 60 m ichida**. Qolgani:

| Kamera | Yo'ldan masofa | Izoh |
|---|---|---|
| **3393/1 km** (id 30) | **2 455 m** | koordinata **xato**: (41.21587, 69.08541). Qo'shnilari 3392/9 va 3394/4 yo'lda aniq (41.1435 / 41.1319). 3393/1 ularning orasida, taxminan 41.142, 69.0857 bo'lishi kerak |
| 3418/1 km | 138 m | kamera yo'l chetida o'rnatilgan, juda katta emas |
| 3405/3 km | 65 m | xuddi shunday |

Kamera koordinatasi bazada o'zgartirilmadi (hisobot uchun).

## Qatlam ko'rinishi (`frontend/src/pages/map/railways.ts`)

- har yo'l to'rt qatlam: nur, to'q yostiq, rangli chiziq, shpallar (z ≥ 14);
- asosiy liniya qalinroq, tarmoq va sanoat yo'llari ingichkaroq; chizish tartibi kichigidan kattasiga;
- tezyurar — qo'sh yo'l ko'rinishida (rangli chiziq ichida oq o'zak), nuri kuchliroq;
- chiziq ustiga kelinsa: bo'linma, toifa, uzunlik, elektrlashtirilgan ulushi.

Ma'lumot © OpenStreetMap contributors (ODbL).
