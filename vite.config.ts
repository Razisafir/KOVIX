import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Conditionally load Monaco editor plugin — skip in CI if it causes issues
const getMonacoPlugin = () => {
  if (process.env.CI) {
    console.log("[vite] CI detected — skipping Monaco editor plugin");
    return null;
  }
  try {
    const monacoEditor = require("vite-plugin-monaco-editor");
    return monacoEditor.default({
      languageWorkers: ["editorWorkerService", "typescript", "json", "html", "css"],
      customDistPath: (root: string) => `${root}/dist/monaco`,
    });
  } catch {
    console.warn("[vite] Monaco editor plugin not available — editor will load from CDN");
    return null;
  }
};

const monacoPlugin = getMonacoPlugin();
const plugins = monacoPlugin ? [react(), monacoPlugin] : [react()];

export default defineConfig(({ mode }) => ({
  plugins,
  root: ".",
  base: mode === "web" ? "/" : "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/renderer"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [".."],
    },
  },
}));
