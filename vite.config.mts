import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    // Acknowledges the larger vendor/analytics bundles produced by rolldown.
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|react-router|react-router-dom)/,
            },
            { name: "motion", test: /node_modules[\\/]motion/ },
            { name: "heroicons", test: /node_modules[\\/]@heroicons/ },
            { name: "swetrix", test: /node_modules[\\/]swetrix/ },
          ],
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(
      process.env.GV_BUILD_VERSION || pkg.version,
    ),
    __BUILD_COMMIT__: JSON.stringify(process.env.GV_BUILD_COMMIT || "unknown"),
    __BUILD_CHANNEL__: JSON.stringify(
      process.env.GV_BUILD_CHANNEL ||
        (process.env.GV_BUILD_VERSION ? "ci" : "dev"),
    ),
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**"],
      exclude: ["src/api/**", "src/generated/**"],
    },
  },
});
