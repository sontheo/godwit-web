import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("src", import.meta.url)) } },
  build: {
    outDir: "dist-web",
    rollupOptions: { input: fileURLToPath(new URL("webmail.html", import.meta.url)) },
  },
  server: { proxy: { "/api": "http://127.0.0.1:8787", "/oauth": "http://127.0.0.1:8787" } },
});
