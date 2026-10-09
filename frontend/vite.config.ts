/* Nigoh — interfeys (React + Vite + TypeScript).
   Dev:   npm run dev   → http://localhost:5173, /api /health /assets backend'ga (NIGOH_API, standart 8010).
   Build: npm run build → dist/ ; backend standart holatda frontend/dist ni beradi (app/config.py).
   public/assets (geojson, fon suratlari) build'da dist/assets ga ko'chadi; Vite o'z fayllarini
   (xeshli nom bilan) dist/static/ ga qo'yadi — backend ularni uzoq keshlaydi. */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = process.env.NIGOH_API || "http://localhost:8010";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "dist", assetsDir: "static", sourcemap: true, chunkSizeWarningLimit: 700 },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: API, changeOrigin: false },
      "/health": { target: API, changeOrigin: false },
    },
  },
});
