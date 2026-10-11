import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { localizedJsxPlugin } from "./i18n-vite";

// Separate, throwaway offline renderer bundle. Production vite.config.ts never
// includes this fixture and shipped apps never expose a simulation route.
export default defineConfig({
  plugins: [localizedJsxPlugin(), react()],
  base: "./",
  build: {
    outDir: "dist-nol-ui",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "nol-ui-fixture.html"),
    },
  },
});
