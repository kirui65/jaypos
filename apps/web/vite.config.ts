import { VitePWA } from "vite-plugin-pwa";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), VitePWA({
    injectRegister: null,
    registerType: "autoUpdate",
    manifest: {
      name: "Eminent Jay Retail POS",
      short_name: "Eminent Jay",
      description: "Sales and stock for the Eminent Jay retail shop.",
      theme_color: "#0B0B0B",
      background_color: "#F7F6F2",
      display: "standalone",
      icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    },
  })],
  server: { port: 5173 },
});
