/**
 * Talking to the MyFileKit conversion server.
 *
 * The server exists for one job the browser cannot do: a browser can only
 * RASTERISE an Office document, so client-side Word/Excel/PowerPoint output is
 * a picture with no selectable text — measured at 0 extractable characters.
 * LibreOffice on a server produces real text; the same document came back with
 * 88 characters of searchable content.
 *
 * The design rule here is the one the whole product rests on: a file is never
 * uploaded unless the user chose it for that conversion. The server is offered,
 * with what it does and what it costs stated, and declining leaves the local
 * path exactly as it was. That keeps "nothing is uploaded unless you choose to"
 * literally true rather than approximately true.
 */

/**
 * The API is ALWAYS same-origin.
 *
 * Not a style preference: `connect-src 'self'` in index.html is the auditable
 * proof that a default build cannot send a document anywhere, and a test pins
 * it. Serving the converter under /api on the same origin means that guarantee
 * survives the feature — no origin was added to the policy. In development Vite
 * proxies /api to the local converter, so this code needs no second branch.
 */
const API_BASE = "";

let cachedProbe = null;

/**
 * What the server can do, or null if it cannot be reached.
 *
 * Cached per session: a tool asking on every render would probe on every
 * keystroke. Never throws — an unreachable server is a normal state, not an
 * error, and every caller must still work without one.
 */
export async function serverCapabilities({ force = false } = {}) {
  if (cachedProbe && !force) return cachedProbe;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`${API_BASE}/api/health`, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`health ${response.status}`);
    const body = await response.json();
    cachedProbe = {
      available: true,
      office: Boolean(body?.capabilities?.office),
      maxBytes: Number(body?.limits?.maxBytes) || 0,
      accepts: Array.isArray(body?.accepts) ? body.accepts : [],
      retention: String(body?.retention || ""),
    };
  } catch {
    cachedProbe = { available: false, office: false, maxBytes: 0, accepts: [], retention: "" };
  }
  return cachedProbe;
}

/** Reset the probe — used when the user changes the endpoint. */
export function forgetServer() {
  cachedProbe = null;
}

export function serverOrigin() {
  try {
    return typeof window !== "undefined" ? window.location.origin : "same origin";
  } catch {
    return API_BASE;
  }
}

/**
 * Convert an Office document to PDF on the server.
 *
 * The extension travels in a header, not in the body and not as a filename:
 * the server generates its own filenames so nothing the user chose reaches a
 * path or a command line.
 */
export async function convertOfficeOnServer(file) {
  const probe = await serverCapabilities();
  if (!probe.available) throw new Error("The conversion server is not reachable. Convert here instead, or try again later.");
  if (!probe.office) throw new Error("This server has no document converter installed.");
  if (probe.maxBytes && file.size > probe.maxBytes) {
    throw new Error(`That file is larger than the server's ${Math.round(probe.maxBytes / 1024 / 1024)} MB limit. Convert it here instead.`);
  }
  const extension = (file.name.split(".").pop() || "").toLowerCase();
  const response = await fetch(`${API_BASE}/api/office-to-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-File-Extension": extension },
    body: file,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || `The server could not convert that file (${response.status}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error("The server returned an empty file.");
  return bytes;
}
