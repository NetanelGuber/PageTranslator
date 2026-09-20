import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: resolve(root, "src/content.ts"),
      name: "PageTranslatorContent",
      formats: ["iife"],
      fileName: () => "content.js"
    }
  }
});
