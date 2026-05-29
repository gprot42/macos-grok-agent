import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { visualizer } from "rollup-plugin-visualizer";

const buildDate = new Date().toLocaleString("en-GB", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default defineConfig({
  plugins: [
    react(),
    // Bundle analyzer — only active when ANALYZE=true (via `bun run build:analyze`)
    ...(process.env.ANALYZE
      ? [visualizer({ open: true, filename: "dist/bundle-stats.html", gzipSize: true })]
      : []),
  ],
  clearScreen: false,
  define: {
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  resolve: {
    alias: {
      "@":          path.resolve(__dirname, "./src"),
      "@features":  path.resolve(__dirname, "./src/features"),
      "@shared":    path.resolve(__dirname, "./src/shared"),
      "@lib":       path.resolve(__dirname, "./src/lib"),
      "@store":     path.resolve(__dirname, "./src/store"),
    },
  },
  server: {
    port: 4731,
    strictPort: true,
    open: false,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
