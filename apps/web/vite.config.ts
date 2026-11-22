import { VitePWA } from "vite-plugin-pwa";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), VitePWA({ registerType: "autoUpdate", manifest: false })],
  server: { port: 5173 },
});
