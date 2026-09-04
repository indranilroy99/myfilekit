import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "./package.json" with { type: "json" };

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const STATIC_MIME_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".map": "application/json",
  ".html": "text/html",
  ".gz": "application/octet-stream",
  ".icc": "application/octet-stream",
  ".txt": "text/plain"
};

/**
 * Two things this project ships as raw static files, never as Vite modules:
 * the vendored libraries under assets/vendor (pdf-lib, html2canvas, Tesseract's
 * language models — the CSP's SRI hashes are pinned against their exact bytes,
 * a deliberate control) and invoice-generator, a whole separate static HTML app.
 *
 * The production build already treats them this way — closeBundle copies them
 * into dist verbatim. `vite dev`, though, has no publicDir configured for these
 * paths, so a request for e.g. /assets/vendor/pdf-lib.min.js falls through to
 * Vite's module transform pipeline instead of a static passthrough. That
 * pipeline rewrites the file (525 KB on disk becomes ~2 MB served), which
 * changes its bytes and breaks the pinned SRI hash — pdf-lib and html2canvas
 * get silently blocked by the browser's own integrity check, and nothing in
 * the app that depends on them works under `npm run dev`.
 *
 * This plugin intercepts those two paths BEFORE Vite's transform middleware
 * (`enforce: "pre"`) and serves the bytes straight off disk, so dev matches
 * what the built app already does.
 */
function serveStaticToolAssets() {
  const passthroughRoots = [
    { prefix: "/assets/vendor/", dir: path.join(projectRoot, "assets", "vendor") },
    { prefix: "/invoice-generator/", dir: path.join(projectRoot, "invoice-generator") }
  ];
  return {
    name: "serve-static-tool-assets",
    enforce: "pre" as const,
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || "").split("?")[0];
        const root = passthroughRoots.find((entry) => url.startsWith(entry.prefix));
        if (!root) return next();
        const relative = decodeURIComponent(url.slice(root.prefix.length));
        // No parent-directory segments: this only ever serves files inside its
        // own vendored/static directory, never an arbitrary path on the host.
        if (relative.split("/").some((part) => part === "..")) return next();
        const filePath = path.join(root.dir, relative);
        if (!filePath.startsWith(root.dir) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return next();
        res.setHeader("Content-Type", STATIC_MIME_TYPES[path.extname(filePath)] || "application/octet-stream");
        // Dev only: never let the browser cache these across a restart. The one
        // time it did during this fix's own testing, a stale cached response
        // kept failing the SRI check for reasons that had nothing to do with
        // the fix — worth closing off rather than re-hitting later.
        res.setHeader("Cache-Control", "no-store");
        fs.createReadStream(filePath).pipe(res);
      });
    }
  };
}

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
  plugins: [react(), tailwindcss(), serveStaticToolAssets(), copyStaticToolAssets()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "src")
    }
  },
  worker: {
    // pdf.js ships an ESM worker. Emit + construct workers as ES modules so the
    // `?worker` import (src/lib/pdfjs.ts) produces a worker that actually runs
    // and completes the pdf.js handshake instead of silently hanging.
    format: "es"
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/framer-motion")) {
            return "motion";
          }
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) {
            return "vendor";
          }
        }
      }
    }
  },
  server: {
    strictPort: false,
    // The conversion server is reached at /api on the SAME origin, so the
    // shipped `connect-src 'self'` policy needs no second host. In development
    // that origin is Vite, so it proxies through to the local converter.
    proxy: {
      "/api": { target: process.env.MFK_API_TARGET || "http://localhost:8081", changeOrigin: false }
    }
  },
  preview: {
    strictPort: false,
    proxy: {
      "/api": { target: process.env.MFK_API_TARGET || "http://localhost:8081", changeOrigin: false }
    }
  }
});
