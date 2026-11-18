import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPort = Number(process.env.WARROOM_PORT ?? 4317);

export default defineConfig({
  root: path.join(here, "web"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.join(here, "web/src"),
      "@shared": path.join(here, "shared"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5317,
    proxy: {
      "/api": { target: `http://127.0.0.1:${serverPort}`, changeOrigin: false },
    },
  },
  build: {
    outDir: path.join(here, "dist/web"),
    emptyOutDir: true,
  },
});
