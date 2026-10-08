# Davlat va viloyat chegaralari (xarita qatlami)

| Fayl | Nima | Nuqtalar | Hajm |
|---|---|---|---|
| `frontend/assets/uz_regions.geojson` | 14 hudud (12 viloyat, Qoraqalpog'iston, Toshkent shahri), `properties.name` | ~25 ming | ~540 KB |
| `frontend/assets/uz.geojson` | O'zbekiston chegarasi (ADM0): xarita niqobi va chegara chizig'i, temir yo'lni kesish chegarasi | ~14 ming | ~310 KB |

Manba: **OpenStreetMap** — relation 196240 (O'zbekiston) va uning viloyat
relation'lari. Ma'lumot © OpenStreetMap contributors, ODbL litsenziyasi.
Xarita plitkalari ham OSM asosida, shuning uchun uzuq ko'k chiziq plitkadagi
chegaraga aniq tushadi.

## Qayta qurish

```bash
python backend/scripts/fetch_osm_boundaries.py   # Overpass'dan (osm_boundaries.json, ~3 MB; git'ga kirmaydi)
python backend/scripts/build_boundaries.py       # uz_regions.geojson va uz.geojson
```

- Viloyatlar ISO3166-2 kodi bo'yicha loyihadagi nomlarga moslanadi
  (`build_boundaries.py` → `NAMES`). **Nomlarni o'zgartirmang** — ular bazadagi
  kamera hududlari (`admin_areas`), `camera-form.js` (koordinatadan hudud) va
  `map.js` (`regionByName`) bilan bir xil bo'lishi shart.
- Yo'llar halqalarga relation rollari bo'yicha yig'iladi: eksklavlar (So'x,
  Shohimardon — Farg'ona) `outer`, qo'shni davlat anklavi (Sarvak — Namangan)
  va Toshkent shahri (Toshkent viloyati ichida) `inner` — teshik.
- Soddalashtirish: Duglas–Pekker, 12 m. Umumiy chegara bo'laklari bir marta
  soddalashtiriladi — qo'shni viloyatlar aynan bir xil nuqtalarni oladi,
  oraliq yoki ustma-ust tushish yo'q (viloyatlar maydoni yig'indisi davlat
  maydoniga teng). Koordinatalar 6 xona.
- Server fayllarni bir kun keshlaydi (`/assets/*.geojson`, `max-age=86400`) —
  yangilangandan keyin brauzerda qattiq yangilash kerak bo'lishi mumkin.

## Eslatmalar

- `backend/database/data/uz_regions.geojson` — 2-migratsiya `admin_areas.boundary`
  ni shundan to'ldiradi (faqat yangi o'rnatishda). Bazadagi chegaralar
  (backend koordinatadan hudud aniqlashi) bu skript bilan o'zgarmaydi.
- `uz.geojson` o'zgarsa `railways-v2.geojson` ham shu chegara bo'yicha qayta
  kesilishi mumkin (`build_railways_v2.py`, qarang `docs/RAILWAYS.md`).

## 2026-10-08 yangilanishi (OSM holati 2026-07-15)

Eski `uz_regions.geojson` 4 xonali, juda dag'al edi (jami ~6 200 nuqta,
Samarqand 202): eski chegara nuqtalari yangi (OSM) chiziqdan o'rtacha ~2 km,
95% i 7,5 km gacha chetda edi (eng katta farq — Qoraqalpog'iston Orol
tomonida, Samarqand/Navoiy/Jizzax, kengaygan Toshkent shahri). Yangi fayl xom
OSM'dan ko'pi bilan 12 m (o'rtacha 1,8 m) farq qiladi.

## Bazadagi chegaralar

Backend koordinatadan hududni `admin_areas.boundary` dan aniqlaydi (`areas.id_for_point`).
Fayl yangilansa, nusxasi `backend/database/data/uz_regions.geojson` ga ham qo'yiladi va yangi
migratsiya bilan `admin_areas` ga yoziladi (namuna: `0007_region_boundaries.py`, 2026-10-08).
Migratsiya kameralarning `admin_area_id` sini o'zgartirmaydi — bazada yozilgan hudud saqlanadi
("26/5 km" va "26/5 km (2)" chegara ustida, Jizzaxda qoldirilgan). Ishlab turgan server chegaralarni
keshlaydi — yangilangani qayta ishga tushirilgandan keyin kuchga kiradi.
