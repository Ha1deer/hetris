import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Standalone SPA build used to package the game inside a Capacitor APK.
// Produces a fully static bundle in dist/spa that works fully offline.
export default defineConfig({
  root: path.resolve(__dirname, "mobile"),
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/spa"),
    emptyOutDir: true,
    target: "es2020",
    assetsInlineLimit: 0,
  },
});