import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, "../..");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@pianio/content-schema": path.resolve(rootDir, "packages/content-schema/src/index.ts"),
      "@pianio/core-engine": path.resolve(rootDir, "packages/core-engine/src/index.ts"),
      "@pianio/midi-web": path.resolve(rootDir, "packages/midi-web/src/index.ts"),
      "@pianio/notation": path.resolve(rootDir, "packages/notation/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    clearMocks: true,
    restoreMocks: true,
  },
});
