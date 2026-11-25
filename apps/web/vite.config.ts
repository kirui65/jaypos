import { VitePWA } from "vite-plugin-pwa";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const cacheHashedAssets: Plugin = {
  name: "eminent-cache-hashed-assets",
  configurePreviewServer(server) {
    server.middlewares.use((request, response, next) => {
      const path = (request.url ?? "").split("?", 1)[0] ?? "";
      if (/^\/assets\/[^/]+-[\da-f]{8,}\.(?:js|css|woff2?)$/i.test(path)) {
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (/^\/(?:fonts\/[^/]+\.(?:woff2?|ttf)|logo\.webp|favicon\.svg)$/i.test(path)) {
        response.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), cacheHashedAssets, VitePWA({
    injectRegister: null,
    registerType: "autoUpdate",
    manifest: {
      name: "Retail POS",
      short_name: "Retail POS",
      description: "Sales and stock management for a retail shop.",
      theme_color: "#14243A",
      background_color: "#F5F8FC",
      display: "standalone",
      icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    },
  })],
  server: { port: 5173 },
});
