import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    rollupOptions: {
      output: {
        // Vite 8 (rolldown) requires `manualChunks` to be a function — the
        // object form is a Rollup-only feature and fails the build with
        // "manualChunks is not a function".
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router/")
          ) {
            return "react";
          }
          if (id.includes("node_modules/motion/")) return "motion";
          if (id.includes("node_modules/@heroicons/")) return "heroicons";
          if (id.includes("node_modules/swetrix/")) return "swetrix";
          return undefined;
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(
      process.env.GV_BUILD_VERSION || pkg.version,
    ),
    __BUILD_COMMIT__: JSON.stringify(process.env.GV_RELEASE_REF || "unknown"),
    __BUILD_CHANNEL__: JSON.stringify(
      process.env.GV_BUILD_CHANNEL ||
        (process.env.GV_BUILD_VERSION ? "ci" : "dev"),
    ),
  },
});
