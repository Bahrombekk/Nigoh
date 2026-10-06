/* ==========================================================================
   core/api.js — backend bilan aloqa
   --------------------------------------------------------------------------
   Vazifasi:
     Barcha /api/... so'rovlari shu yerdan o'tadi: JSON yuborish/qabul qilish,
     server xatosini tushunarli xabarga aylantirish, sessiya tugasa (401)
     kirish oynasini ochish.

   Eksport:
     ApiClient            — klass: request(path, options) — fetch + xato ishlovi
     apiClient            — yagona nusxa
     api(path, options)   — eski nom, apiClient.request ga yo'naltiradi (Promise)

   Bog'liqliklar:
     import: ./state.js (state.apiOk), ./modals.js (openModal),
             ../auth/auth.js (setAdmin — 401 da sessiyani tozalash)
     global: fetch

   DOM: #login-modal (401 da ochiladi)
   Backend: har qanday /api/... yo'l (ro'yxat: backend/README.md, /docs)

   Qoidalar / tuzoqlar:
     - /api/auth/login ning 401 i "noto'g'ri parol" — u sessiya tugashi deb
       hisoblanmaydi va serverning o'z xabari bilan qaytadi.
     - state.apiOk har so'rovdan keyin yangilanadi — dashboarddagi
       "Tizim holati" bloki shunga qaraydi.
     - 204 javobda null qaytadi (JSON yo'q).
   ========================================================================== */
import { state } from "./state.js";
import { openModal } from "./modals.js";
import { setAdmin } from "../auth/auth.js";

/* ---------- API ---------- */
export class ApiClient {
  async request(path, options = {}) {
    const res = await fetch(path, {
      headers: options.body ? { "Content-Type": "application/json" } : {},
      ...options
    });
    // Login so'rovining 401 i — noto'g'ri parol, sessiya tugashi emas:
    // u pastda serverning o'z xabari bilan qaytadi.
    if (res.status === 401 && !path.startsWith("/api/auth/login")) {
      setAdmin(null);
      openModal("login-modal");
      throw new Error("Sessiya tugadi — qaytadan kiring");
    }
    if (!res.ok) {
      state.apiOk = false;
      let detail = "Xatolik yuz berdi";
      try { detail = (await res.json()).detail || detail; } catch (e) {}
      throw new Error(detail);
    }
    state.apiOk = true;
    return res.status === 204 ? null : res.json();
  }
}

export const apiClient = new ApiClient();

export function api(path, options = {}) {
  return apiClient.request(path, options);
}
