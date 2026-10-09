/* pages/admin/MiniMap.tsx — oyna ichidagi kichik Leaflet xarita (v3 camera-form.js MiniMap).
   Bosish → marker qo'yiladi va onPick(lat, lng) (5 kasr); marker suriladi.
   Ota komponent ref orqali: show(lat, lng) — ko'ringanda (o'lcham tayyor bo'lgach markazlash),
   set(lat, lng, recenter) — maydonlardan marker siljitish. */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import L from "leaflet";
import { useT } from "@/i18n/I18nProvider";
import { cx } from "@/components/ui";

const DEFAULT_VIEW: { center: [number, number]; zoom: number } = { center: [41.3, 64.6], zoom: 5 };
const MARKER_HTML = '<span class="ad-mk"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z"/><circle cx="12" cy="13" r="3.5"/></svg></span>';

export interface MiniMapHandle {
  show: (lat: number | null, lng: number | null) => void;
  set: (lat: number | null, lng: number | null, recenter: boolean) => void;
}

export const MiniMap = forwardRef<MiniMapHandle, {
  onPick: (lat: number, lng: number) => void; hint: string; small?: boolean;
}>(function MiniMap({ onPick, hint, small }, ref) {
  const t = useT();
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const timer = useRef(0);

  const pick = () => {
    const p = markerRef.current!.getLatLng();
    pickRef.current(Number(p.lat.toFixed(5)), Number(p.lng.toFixed(5)));
  };
  const place = (lat: number, lng: number) => {
    const map = mapRef.current;
    if (!map) return;
    if (!markerRef.current) {
      const icon = L.divIcon({ className: "", iconSize: [44, 44], iconAnchor: [22, 22], html: MARKER_HTML });
      markerRef.current = L.marker([lat, lng], { icon, draggable: true, keyboard: false }).addTo(map);
      markerRef.current.on("dragend", pick);
    } else markerRef.current.setLatLng([lat, lng]);
  };
  const ensure = () => {
    if (mapRef.current) return true;
    if (!elRef.current) return false;
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: false, scrollWheelZoom: "center" })
      .setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, className: "ad-mm__tiles" }).addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => { place(e.latlng.lat, e.latlng.lng); pick(); });
    mapRef.current = map;
    return true;
  };
  const set = (lat: number | null, lng: number | null, recenter: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng)) {
      place(lat, lng);
      if (recenter) map.setView([lat, lng], Math.max(map.getZoom(), 14));
      else if (!map.getBounds().contains([lat, lng])) map.panTo([lat, lng]);
    } else {
      if (markerRef.current) { map.removeLayer(markerRef.current); markerRef.current = null; }
      if (recenter) map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
    }
  };

  useImperativeHandle(ref, () => ({
    show(lat, lng) {
      if (!ensure()) return;
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (!mapRef.current) return;
        mapRef.current.invalidateSize();
        set(lat, lng, true);
      }, 60);
    },
    set,
  }));

  useEffect(() => () => {
    clearTimeout(timer.current);
    mapRef.current?.remove();
    mapRef.current = null;
    markerRef.current = null;
  }, []);

  return (
    <div className={cx("ad-mm", small && "ad-mm--sm")} ref={elRef} aria-label={t("Xaritadan tanlash")}>
      <span className="ad-mm__hint">{t(hint)}</span>
    </div>
  );
});
