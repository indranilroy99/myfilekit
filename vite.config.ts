import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "./package.json" with { type: "json" };

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "src")
    }
  },
  server: {
    strictPort: false
  },
  preview: {
    strictPort: false
  }
});
