import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(here, "web/src"),
      "@shared": path.join(here, "shared"),
    },
  },
  test: {
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "web/src/**/*.test.ts"],
    environment: "node",
    // Tests never touch the real data folder.
    env: { WARROOM_DATA_DIR: path.join(here, "node_modules", ".cache", "warroom-test-data") },
  },
});
