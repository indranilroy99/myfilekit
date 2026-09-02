/**
 * Talking to the MyFileKit conversion server.
 *
 * The server exists for the jobs the browser cannot do:
 *
 *   - Office to PDF. A browser can only RASTERISE a document, so client-side
 *     Word/Excel/PowerPoint output is a picture with no selectable text —
 *     measured at 0 extractable characters. LibreOffice produces real text; the
 *     same document came back with 88 characters of searchable content.
 *   - Compress PDF. The browser tool turns every page into a JPEG, which
 *     destroys the text and inflates text-based files. Ghostscript recompresses
 *     images and subsets fonts while leaving text as text.
 *   - OCR. Tesseract in the browser recognises the words. OCRmyPDF also deskews
 *     and cleans the page first, and positions the invisible text to match the
 *     image — the difference between a searchable PDF and one where the
 *     highlight lands on the wrong word.
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
      ghostscript: Boolean(body?.capabilities?.ghostscript),
      ocr: Boolean(body?.capabilities?.ocr),
      accepts: Array.isArray(body?.accepts) ? body.accepts : [],
      compressionLevels: Array.isArray(body?.compressionLevels) ? body.compressionLevels : [],
      ocrLanguages: Array.isArray(body?.ocrLanguages) ? body.ocrLanguages : [],
      retention: String(body?.retention || ""),
    };
  } catch {
    cachedProbe = { available: false, office: false, ghostscript: false, ocr: false, maxBytes: 0, accepts: [], compressionLevels: [], ocrLanguages: [], retention: "" };
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

/**
 * Compress a PDF on the server, keeping its text as text.
 *
 * Returns the byte count of what was sent as well as what came back, and
 * whether the server actually compressed anything: when a PDF is already
 * optimised, Ghostscript's output is larger, and the server sends the original
 * back rather than handing over a bigger file labelled "compressed". The UI has
 * to be able to say that plainly, which is why `compressed` is part of the
 * return value and not inferred from the sizes.
 */
export async function compressPdfOnServer(file, level = "balanced") {
  const probe = await serverCapabilities();
  if (!probe.available) throw new Error("The conversion server is not reachable. Compress here instead, or try again later.");
  if (!probe.ghostscript) throw new Error("This server has no PDF compressor installed.");
  if (probe.maxBytes && file.size > probe.maxBytes) {
    throw new Error(`That file is larger than the server's ${Math.round(probe.maxBytes / 1024 / 1024)} MB limit. Compress it here instead.`);
  }
  const response = await fetch(`${API_BASE}/api/compress-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf", "X-Compression-Level": level },
    body: file,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || `The server could not compress that file (${response.status}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error("The server returned an empty file.");
  return {
    bytes,
    originalBytes: Number(response.headers.get("X-Original-Bytes")) || file.size,
    compressed: response.headers.get("X-Compressed") !== "false",
  };
}

/**
 * Add a searchable text layer to a scanned PDF, on the server.
 *
 * Returns how many characters were recognised as well as the file, because a
 * PDF that came back with nothing in it looks exactly like one that worked.
 */
export async function ocrPdfOnServer(file, { language = "eng", redoOcr = false } = {}) {
  const probe = await serverCapabilities();
  if (!probe.available) throw new Error("The conversion server is not reachable. Run OCR here instead, or try again later.");
  if (!probe.ocr) throw new Error("This server has no OCR engine installed.");
  if (probe.maxBytes && file.size > probe.maxBytes) {
    throw new Error(`That file is larger than the server's ${Math.round(probe.maxBytes / 1024 / 1024)} MB limit. Run OCR here instead.`);
  }
  const response = await fetch(`${API_BASE}/api/ocr-pdf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
      "X-Ocr-Language": language,
      "X-Ocr-Redo": redoOcr ? "true" : "false",
    },
    body: file,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || `The server could not read that file (${response.status}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error("The server returned an empty file.");
  return { bytes, chars: Number(response.headers.get("X-Ocr-Text-Chars")) || 0 };
}
