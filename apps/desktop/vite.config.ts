import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { localizedJsxPlugin } from "./i18n-vite";

export default defineConfig({
  plugins: [localizedJsxPlugin(), react()],
  base: "./",
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
