/* Backend bilan aloqa: `api(path, options)` — JSON so'rov, xatoni tushunarli xabarga
   aylantiradi, 401 da kirish oynasini ochadi. Endpointlar: backend/README.md. */
import { state } from "./holat.js";
import { openModal } from "./modallar.js";
import { setAdmin } from "./auth.js";

/* ---------- API ---------- */
export async function api(path, options = {}) {
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
