import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
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
      "@pianio/notation": path.resolve(rootDir, "packages/notation/src/index.ts")
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-tone": ["tone"],
          "vendor-osmd": ["opensheetmusicdisplay"]
        }
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [rootDir]
    }
  }
});