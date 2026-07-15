import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "./package.json" with { type: "json" };

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

function copyStaticToolAssets() {
  return {
    name: "copy-static-tool-assets",
    closeBundle() {
      const outputRoot = path.join(projectRoot, "dist");
      fs.cpSync(path.join(projectRoot, "invoice-generator"), path.join(outputRoot, "invoice-generator"), {
        recursive: true
      });
      fs.cpSync(path.join(projectRoot, "assets", "vendor"), path.join(outputRoot, "assets", "vendor"), {
        recursive: true
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), copyStaticToolAssets()],
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
