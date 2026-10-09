/* pages/map/leaflet-global.ts — Leaflet'ni `window.L` ga qo'yadi (markercluster plagini uchun). */
import L from "leaflet";

(window as unknown as { L: typeof L }).L = L;

export default L;
