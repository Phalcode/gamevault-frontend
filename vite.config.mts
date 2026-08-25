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
        manualChunks: {
          react: ["react", "react-dom", "react-router"],
          motion: ["motion"],
          heroicons: [
            "@heroicons/react/24/solid",
            "@heroicons/react/24/outline",
            "@heroicons/react/16/solid",
          ],
          swetrix: ["swetrix"],
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
