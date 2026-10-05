/* Inline SVG ikonkalar (ICO) — tashqi ikonka kutubxonasi kerak emas. */

/* ---------- Ikonkalar (inline SVG) ---------- */
export const svg = (d, extra) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>";
export const ICO = {
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/>' +
           '<path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/>' +
           '<path d="M20 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/>'),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  star: svg('<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>'),
  pin: svg('<circle cx="12" cy="12" r="7"/><path d="M12 2v3"/><path d="M12 19v3"/>' +
           '<path d="M2 12h3"/><path d="M19 12h3"/>'),
  down: svg('<path d="M12 4v10"/><path d="m8 11 4 4 4-4"/><path d="M4 19h16"/>'),
  full: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/>' +
            '<path d="M16 21h3a2 2 0 0 0 2-2v-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/>'),
  close: svg('<path d="m6 6 12 12"/><path d="m18 6-12 12"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  play: svg('<path d="m7 4 12 8-12 8z"/>'),
  trash: svg('<path d="M3 6h18"/><path d="m6 6 1 14h10l1-14"/><path d="M10 6V4h4v2"/>'),
  map: svg('<path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>'),
  server: svg('<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01"/><path d="M7 16.5h.01"/>'),
  db: svg('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
  net: svg('<path d="M5 12.5a9.5 9.5 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1.4"/>'),
  cast: svg('<path d="m7 4 12 8-12 8z"/><circle cx="12" cy="12" r="9"/>'),
};
