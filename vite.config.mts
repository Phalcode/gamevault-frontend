import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    tsconfigPaths: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(
      process.env.GV_BUILD_VERSION || pkg.version,
    ),
  },
});
