/* sw.js — mahalliy xarita (PMTiles) bo'laklari keshi. FAQAT /tiles/ so'rovlari.

   Nega kerak: xarita fayli /tiles/uz.pmtiles dan HTTP Range bilan bo'lak-bo'lak
   olinadi. Brauzerning oddiy HTTP keshi Range javoblarini yomon saqlaydi —
   o'lchov: qayta ochilganda 191 so'rovdan 126 tasi baribir serverga ketdi.
   Bu yerda har bo'lak "url + bayt oralig'i" kaliti bilan Cache Storage'da
   saqlanadi: PMTiles bir plitkani doim aynan bir xil oraliqdan so'raydi,
   ya'ni ikkinchi marta tarmoqqa chiqilmaydi.

   TUZOQ: Cache API qisman javobni (206) saqlamaydi — put() xato beradi va
   javob umuman qaytmasdi (xarita bo'sh qolardi). Shuning uchun bo'lak 200
   javob sifatida saqlanadi, qaytarishda 206 + Content-Range qayta yig'iladi.
   Keshda har qanday xato — so'rov odatdagidek tarmoqqa (xarita buzilmasin).

   Versiya: fayl almashtirilsa eski bo'laklar boshqa mazmunga ishora qiladi.
   PMTiles har ochilishda avval sarlavhani (bytes=0-...) so'raydi — u doim
   tarmoqdan olinadi va ETag o'zgargan bo'lsa butun kesh tozalanadi. Tarmoq
   yo'q bo'lsa saqlangan sarlavha beriladi (ko'rilgan joylar serversiz ham ochiladi).

   Hajm: MAX_ENTRIES dan oshsa eng eskilari o'chiriladi.
   Service worker faqat ishonchli sertifikatda ishlaydi (IP sertifikati uchun
   mijozda ca.crt o'rnatilgan bo'lishi kerak); bo'lmasa xarita keshsiz ishlaydi. */
const CACHE = "nigoh-tiles";
const META = "/__nigoh_tiles_etag__";
const MAX_ENTRIES = 6000;
let writes = 0;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/tiles/")) return;
  const range = req.headers.get("range");
  if (!range) return;
  event.respondWith(handle(req, url.pathname, range).catch(() => fetch(req)));
});

function keyOf(path, range) {
  return new Request(self.location.origin + path + "?r=" + encodeURIComponent(range));
}

/* Saqlangan (200) javobdan qaytariladigan 206 javob. */
function asPartial(stored) {
  const h = new Headers();
  for (const k of ["content-type", "content-range", "etag", "last-modified"]) {
    const v = stored.headers.get("x-" + k) || stored.headers.get(k);
    if (v) h.set(k, v);
  }
  h.set("x-nigoh-cache", "hit");
  return stored.arrayBuffer().then((buf) => {
    h.set("content-length", String(buf.byteLength));
    return new Response(buf, { status: 206, statusText: "Partial Content", headers: h });
  });
}

/* Tarmoqdan kelgan 206 javobni keshga 200 sifatida yozish. */
async function store(cache, key, res) {
  const buf = await res.clone().arrayBuffer();
  const h = new Headers({ "content-type": res.headers.get("content-type") || "application/octet-stream" });
  for (const k of ["content-range", "etag", "last-modified"]) {
    const v = res.headers.get(k);
    if (v) h.set("x-" + k, v);
  }
  await cache.put(key, new Response(buf, { status: 200, headers: h }));
}

async function handle(req, path, range) {
  const cache = await caches.open(CACHE);
  const key = keyOf(path, range);
  const isHeader = /^bytes=0-/.test(range);

  if (!isHeader) {
    const hit = await cache.match(key);
    if (hit) return asPartial(hit);
  }
  let res;
  try {
    res = await fetch(req);
  } catch (err) {
    const hit = await cache.match(key);          // tarmoq yo'q — saqlangani
    if (hit) return asPartial(hit);
    throw err;
  }
  if (res.status !== 206) return res;

  if (isHeader) {
    // Fayl versiyasi o'zgarganmi — o'zgargan bo'lsa butun kesh tozalanadi.
    const etag = res.headers.get("etag") || "";
    const meta = await cache.match(META);
    const old = meta ? await meta.text() : null;
    if (old !== etag) {
      if (old !== null) await caches.delete(CACHE);
      const c = await caches.open(CACHE);
      await c.put(META, new Response(etag));
      await store(c, key, res);
      return res;
    }
  }
  await store(cache, key, res);
  if (++writes % 200 === 0) trim(cache);
  return res;
}

async function trim(cache) {
  const keys = await cache.keys();
  const extra = keys.length - MAX_ENTRIES;
  for (let i = 0; i < extra; i++) {
    if (new URL(keys[i].url).pathname !== META) await cache.delete(keys[i]);
  }
}
