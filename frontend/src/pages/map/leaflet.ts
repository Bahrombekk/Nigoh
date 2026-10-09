/* pages/map/leaflet.ts — Leaflet + markercluster.
   leaflet.markercluster global `L` ga tayanadi (UMD) — Vite ESM'da `window.L`
   o'zi paydo bo'lmaydi, shuning uchun plagin yuklanishidan OLDIN qo'yiladi
   (./leaflet-global.ts — alohida modul: import tartibi kafolatlanadi). */
import L from "./leaflet-global";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";

export default L;
