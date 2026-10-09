/* pages/map/hooks.ts — xarita bo'limining kichik hook'lari. */
import { useEffect, useRef, useState } from "react";

/** CSS media so'rovi (v3 MOBILE/PHONE matchMedia). */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const h = () => setOn(mq.matches);
    h();
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [query]);
  return on;
}

/** Har renderda yangilanadigan ref (callback'larda eskirgan qiymat bo'lmasin). */
export function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}

/** Har soniyada yangilanadigan vaqt (drawer'dagi soat). */
export function useNow(ms = 1000, enabled = true) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => { if (!document.hidden) setNow(new Date()); }, ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
  return now;
}
