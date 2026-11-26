import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const api = process.env.API_URL ?? "http://localhost:4100";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": { target: api, changeOrigin: true },
      "/socket.io": { target: api, ws: true, changeOrigin: true },
    },
  },
});
