import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * `shared/apiClient.ts` talks to the backend same-origin (`/api/...`), which is
 * how this ships: one service serving both the API and the built SPA. In dev
 * the two run on different ports, so Vite proxies `/api` to the backend and
 * same-origin holds there too — no CORS, no `VITE_API_BASE` to forget to set.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_ORIGIN ?? "http://localhost:3001",
        changeOrigin: true,
        // `GET /api/state` is a long-poll the server holds open for ~25s.
        // The default proxy timeout would cut it and make the UI look flaky.
        timeout: 60_000,
        proxyTimeout: 60_000,
      },
    },
  },
});
