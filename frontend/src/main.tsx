/* main.tsx — kirish nuqtasi: uslublar, Query mijoz, til, kirish, toast/tasdiqlash qatlami. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "leaflet/dist/leaflet.css";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/shell.css";
import "@/styles/login.css";
import { I18nProvider } from "@/i18n/I18nProvider";
import { AuthProvider } from "@/auth/AuthProvider";
import { OverlayProvider } from "@/components/overlays";
import App from "./App";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 10_000 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AuthProvider>
          <OverlayProvider>
            <App />
          </OverlayProvider>
        </AuthProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);

/* Mahalliy xarita bo'laklari keshi (public/sw.js) — faqat /tiles/ so'rovlari;
   boshqa hamma narsa odatdagidek tarmoqdan. HTTPS yoki localhost'da ishlaydi. */
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
