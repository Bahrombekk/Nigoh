/* pages/map/localStyle.ts — "Mahalliy" xarita uslubi (protomaps vektor plitkalari).
   Talab: Sxema (OSM rastr plitkalari) bilan BIR XIL ko'rinish. Shuning uchun ranglar
   OpenStreetMap standart uslubidan (openstreetmap-carto) olingan, mavzu esa Sxema
   qatlamidagi kabi CSS filtri bilan beriladi (--map-tiles-filter, map.css) — oq / krem /
   qorong'i mavzuda ikkala qatlam bir xil o'zgaradi. */
import { namedFlavor, type Flavor } from "@protomaps/basemaps";

// openstreetmap-carto palitrasi
const C = {
  land: "#f2efe9", water: "#aad3df", park: "#c8facc", wood: "#add19e", grass: "#cdebb0",
  farmland: "#eef0d5", scrub: "#c8d7ab", sand: "#f5e9c6", residential: "#e0dfdf",
  industrial: "#ebdbe8", military: "#f3e3dd", hospital: "#ffffe5", school: "#ffffe5",
  aerodrome: "#e9e7e2", runway: "#bbbbcc", building: "#d9d0c9", pedestrian: "#dddde8",
  motorway: "#e892a2", trunk: "#f9b29c", primary: "#fcd6a4", secondary: "#f7fabf",
  minor: "#ffffff", service: "#ffffff", casing: "#c4b6ab", motorwayCasing: "#dc2a67",
  trunkCasing: "#c84e2f", primaryCasing: "#a06b00", rail: "#707070",
  boundary: "#8d618b", label: "#000000", halo: "#ffffff", place: "#333333",
};

/* Standart protomaps uslubi chizmaydigan, lekin Sxemada (OSM) ko'rinadigan yer
   foydalanish hududlari: turar-joy (kulrang mahallalar — ko'chalar shu fonda ajraladi),
   ekin, qabriston, maydonchalar... Ma'lumot faylda bor (landuse qatlami, kind). */
const LANDUSE: Record<string, string> = {
  residential: "#e0dfdf", farmland: "#eef0d5", cemetery: "#aacbaf", grass: "#cdebb0",
  meadow: "#cdebb0", garden: "#cdebb0", pitch: "#aae0cb", playground: "#dffce2",
  allotments: "#c9e1bf", orchard: "#aedfa3", vineyard: "#aedfa3", retail: "#ffd6d1",
  commercial: "#f2dad9", construction: "#c7c7b4", garages: "#dfddce", railway: "#ebdbe8",
  brownfield: "#c7c7b4", quarry: "#c5c3c3", landfill: "#b6b592",
};

type PL = typeof import("protomaps-leaflet");
type PaintRule = ReturnType<PL["paintRules"]>[number];

/* Standart qoidalarga qo'shiladi — boshqa landuse qoidalaridan OLDIN (park, maktab,
   sanoat ustida chizilsin), yo'llar va binolar baribir keyinroq. */
export function withLanduse(pl: PL, rules: PaintRule[]): PaintRule[] {
  const extra: PaintRule[] = Object.entries(LANDUSE).map(([kind, fill]) => ({
    dataLayer: "landuse",
    symbolizer: new pl.PolygonSymbolizer({ fill }),
    filter: (_z: number, f: { props: Record<string, unknown> }) => f.props.kind === kind,
  }) as PaintRule);
  const i = rules.findIndex((r) => r.dataLayer === "landuse");
  return i < 0 ? [...rules, ...extra] : [...rules.slice(0, i), ...extra, ...rules.slice(i)];
}

/* Kichik ko'chalar: standart uslub ularni hoshiyasiz va ingichka chizadi — turar-joy
   kulrang fonida deyarli ko'rinmaydi. Sxemadagi kabi: to'q hoshiya + oq chiziq,
   masshtab bilan kengayadi. Boshqa yo'l qoidalaridan OLDIN — katta yo'llar ustida qoladi. */
export function withStreets(pl: PL, rules: PaintRule[]): PaintRule[] {
  const minor = (_z: number, f: { props: Record<string, unknown> }) =>
    f.props.kind === "minor_road" || f.props.kind === "other";
  const extra: PaintRule[] = [
    { dataLayer: "roads", minzoom: 13, filter: minor,
      symbolizer: new pl.LineSymbolizer({ color: C.casing, width: pl.exp(1.6, [[13, 1.2], [16, 6], [19, 20]]), lineCap: "round", lineJoin: "round" }) },
    { dataLayer: "roads", minzoom: 13, filter: minor,
      symbolizer: new pl.LineSymbolizer({ color: C.minor, width: pl.exp(1.6, [[13, 0.6], [16, 4.2], [19, 16]]), lineCap: "round", lineJoin: "round" }) },
  ] as PaintRule[];
  const i = rules.findIndex((r) => r.dataLayer === "roads");
  return i < 0 ? [...rules, ...extra] : [...rules.slice(0, i), ...extra, ...rules.slice(i)];
}

export function localFlavor(): Flavor {
  const base = namedFlavor("light");
  return {
    ...base,
    landcover: {
      barren: C.land, farmland: C.farmland, forest: C.wood, glacier: "#ddecec",
      grassland: C.grass, scrub: C.scrub, urban_area: C.residential,
    },
    background: C.land, earth: C.land, water: C.water,
    park_a: C.park, park_b: C.park, zoo: C.park, wood_a: C.wood, wood_b: C.wood,
    scrub_a: C.scrub, scrub_b: C.scrub, sand: C.sand, beach: C.sand, glacier: "#ddecec",
    hospital: C.hospital, school: C.school, industrial: C.industrial, military: C.military,
    aerodrome: C.aerodrome, runway: C.runway, pedestrian: C.pedestrian, pier: C.land,
    buildings: C.building,
    other: C.service, minor_service: C.service, minor_a: C.minor, minor_b: C.minor,
    link: C.primary, major: C.primary, highway: C.trunk,
    minor_service_casing: C.casing, minor_casing: C.casing, link_casing: C.primaryCasing,
    major_casing_early: C.primaryCasing, major_casing_late: C.primaryCasing,
    highway_casing_early: C.trunkCasing, highway_casing_late: C.trunkCasing,
    bridges_other: C.service, bridges_minor: C.minor, bridges_link: C.primary,
    bridges_major: C.primary, bridges_highway: C.trunk,
    bridges_other_casing: C.casing, bridges_minor_casing: C.casing, bridges_link_casing: C.primaryCasing,
    bridges_major_casing: C.primaryCasing, bridges_highway_casing: C.trunkCasing,
    railway: C.rail, boundaries: C.boundary,
    roads_label_minor: C.place, roads_label_minor_halo: C.halo,
    roads_label_major: C.place, roads_label_major_halo: C.halo,
    city_label: C.label, city_label_halo: C.halo,
    subplace_label: C.place, subplace_label_halo: C.halo,
    state_label: C.boundary, state_label_halo: C.halo,
    country_label: C.boundary, ocean_label: "#4d80b3",
    address_label: C.place, address_label_halo: C.halo,
  };
}
