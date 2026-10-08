/* ==========================================================================
   core/api.js — backend bilan aloqa
   --------------------------------------------------------------------------
   Vazifasi:
     Barcha /api/... so'rovlari shu yerdan o'tadi: JSON yuborish/qabul qilish,
     server xatosini tushunarli xabarga aylantirish, sessiya tugasa (401)
     kirish ekranini "Sessiya tugadi" holatida ochish (01.03).

   Eksport:
     ApiClient, apiClient, api(path, options)
     ApiError — xato: .status, .body (server JSON'i: detail, remaining, retry_after)

   Qoidalar / tuzoqlar:
     - /api/auth/login ning 401 i "noto'g'ri parol" — sessiya tugashi emas.
     - state.apiOk faqat tarmoq xatosi yoki 5xx da false bo'ladi (4xx — server
       ishlayapti); o'zgarsa "api:status" hodisasi (sysbar "Aloqa yoʻq").
     - 204 javobda null qaytadi.
   ========================================================================== */
import { state } from "./state.js";
import { openLogin, setAdmin } from "../auth/auth.js";

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body || {};
  }
}

function setOk(ok) {
  if (state.apiOk === ok) return;
  state.apiOk = ok;
  if (ok) state.lastOkAt = Date.now();
  document.dispatchEvent(new CustomEvent("api:status", { detail: { ok } }));
}

export class ApiClient {
  async request(path, options = {}) {
    let res;
    try {
      res = await fetch(path, {
        credentials: "same-origin",
        headers: options.body ? { "Content-Type": "application/json" } : {},
        ...options
      });
    } catch (e) {
      setOk(false);
      throw new ApiError("Server bilan aloqa yoʻq", 0);
    }
    if (res.status === 401 && !path.startsWith("/api/auth/login")) {
      setOk(true);
      if (state.admin) {
        setAdmin(null);
        openLogin({ reason: "expired" });
      }
      throw new ApiError("Seans tugadi — qaytadan kiring", 401);
    }
    if (!res.ok) {
      setOk(res.status < 500);
      let body = {};
      try { body = await res.json(); } catch (e) {}
      const d = body.detail;
      const msg = typeof d === "string" ? d : (Array.isArray(d) && d[0] && d[0].msg) || "Xatolik yuz berdi";
      throw new ApiError(msg, res.status, body);
    }
    setOk(true);
    state.lastOkAt = Date.now();
    return res.status === 204 ? null : res.json();
  }
}

export const apiClient = new ApiClient();

export function api(path, options = {}) {
  return apiClient.request(path, options);
}
