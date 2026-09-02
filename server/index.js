/**
 * MyFileKit conversion server.
 *
 * Exists for one reason: a browser can only rasterise an Office document, so
 * client-side Word/Excel/PowerPoint output is a picture with no selectable
 * text. LibreOffice on a server produces real text. Everything the browser can
 * do well stays in the browser.
 *
 * Deliberately zero-dependency (node:http, no framework) to match the rest of
 * the project, which vendors rather than installs.
 *
 * WHAT THIS SERVER PROMISES, and the code below is what enforces it:
 *   - Files are held in a per-request temp directory and deleted in a finally
 *     block, whether the conversion succeeds or fails.
 *   - Nothing is written to a database, a log, or any persistent path.
 *   - No filename the caller chose ever reaches a path or a command line.
 *   - Every external tool is spawned with an argument array, never a shell.
 */
import http from "node:http";
import { capabilities, officeToPdf, compressPdf, LIMITS, OFFICE_EXTENSIONS, COMPRESSION_LEVELS } from "./convert.js";

const PORT = Number(process.env.PORT || 8081);
// Browsers enforce this; it is not a security boundary on its own, but it stops
// a random page driving this server on a user's behalf.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:4180,http://localhost:5173")
  .split(",").map((value) => value.trim()).filter(Boolean);

/** Requests per window, per IP. Crude on purpose — a real deployment fronts this. */
const RATE = { windowMs: 60_000, max: 20 };
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.start > RATE.windowMs) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE.max;
}

// Unbounded Maps are how a long-running server leaks; drop stale buckets.
setInterval(() => {
  const cutoff = Date.now() - RATE.windowMs;
  for (const [ip, entry] of hits) if (entry.start < cutoff) hits.delete(ip);
}, RATE.windowMs).unref();

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-File-Extension, X-Compression-Level");
  // The client reads these off a PDF response; without this they are invisible
  // to cross-origin fetch, and the size saving could not be shown honestly.
  res.setHeader("Access-Control-Expose-Headers", "X-Original-Bytes, X-Compressed");
  res.setHeader("Access-Control-Max-Age", "600");
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

/** Read the body with a hard cap, destroying the socket if it is exceeded. */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error("That file is larger than this server accepts."), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const ip = req.socket.remoteAddress || "unknown";

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      const caps = await capabilities();
      return json(res, 200, {
        ok: true,
        capabilities: caps,
        // Stated in the response so a client can show the user what this server
        // will and will not do, rather than guessing.
        limits: { maxBytes: LIMITS.maxBytes, timeoutMs: LIMITS.timeoutMs },
        accepts: [...OFFICE_EXTENSIONS],
        compressionLevels: [...COMPRESSION_LEVELS.keys()],
        retention: "none — files are deleted when the request finishes",
      });
    }

    if (req.method === "POST" && url.pathname === "/api/office-to-pdf") {
      if (rateLimited(ip)) return json(res, 429, { error: "Too many conversions from this address. Wait a minute and try again." });
      const caps = await capabilities();
      if (!caps.office) return json(res, 503, { error: "This server has no document converter installed." });

      const extension = String(req.headers["x-file-extension"] || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const body = await readBody(req, LIMITS.maxBytes);
      const pdf = await officeToPdf(body, extension);
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": pdf.length,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      });
      return res.end(pdf);
    }

    if (req.method === "POST" && url.pathname === "/api/compress-pdf") {
      if (rateLimited(ip)) return json(res, 429, { error: "Too many conversions from this address. Wait a minute and try again." });
      const caps = await capabilities();
      if (!caps.ghostscript) return json(res, 503, { error: "This server has no PDF compressor installed." });

      const level = String(req.headers["x-compression-level"] || "balanced").toLowerCase().replace(/[^a-z]/g, "");
      const body = await readBody(req, LIMITS.maxBytes);
      const { bytes, originalBytes, compressed } = await compressPdf(body, level);
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": bytes.length,
        // So the client can state the real saving rather than assuming there was
        // one. `false` means we sent the original back untouched.
        "X-Original-Bytes": String(originalBytes),
        "X-Compressed": compressed ? "true" : "false",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      });
      return res.end(bytes);
    }

    return json(res, 404, { error: "No such endpoint." });
  } catch (error) {
    const status = Number(error?.status) || 500;
    // The tool's own message is useful; a stack trace is not, and would leak
    // paths from this host.
    return json(res, status, { error: status === 500 ? "The conversion failed on the server." : String(error.message) });
  }
});

server.listen(PORT, () => {
  process.stdout.write(`MyFileKit conversion server on :${PORT}\n`);
});
