import { getPdfLib } from "./pdf.service.js";
import { lineDiff } from "./text-tools.service.js";
// Shared BCP-47 validation (single source of truth, also used by the a11y service)
// so a free-text /Lang can never break out of the catalog literal.
import { safeLangTag } from "../utils/bcp47.js";

// =============================================================================
// Phase 2 PDF review tooling — pure, Node-testable logic.
//
// The canvas / pdf.js rendering (rasterising pages for visual diff and deskew,
// converting to a darkness matrix) lives thin in the React component. Everything
// here is deterministic and runs in Node against plain arrays / bytes, so the
// diff maths, the skew estimator, and the archival hygiene are all unit-tested.
// =============================================================================

// =============================================================================
// 1. COMPARE PDFs — per-page text diff
// =============================================================================

/**
 * Compares two documents page by page from their extracted per-page text.
 * `pagesA` / `pagesB` are arrays of strings (one entry per page). Pure.
 *
 * Returns a structured report:
 *  - pages: one entry per page position (1-based `page`) with a `status` of
 *    "same" | "changed" | "added" | "removed" | "textless", the added/removed
 *    line counts, and the diff `rows` (from lineDiff) for changed pages.
 *  - totals: summed added / removed lines and the count of differing pages.
 *  - differingPages / addedPages / removedPages: page-number lists.
 *  - identical: true when both documents have the same pages and no line differs.
 *  - textlessPages: pages where neither side had extractable text (scanned) — the
 *    caller should fall back to the visual diff for these.
 */
export function comparePdfText(pagesA, pagesB) {
  const a = Array.isArray(pagesA) ? pagesA : [];
  const b = Array.isArray(pagesB) ? pagesB : [];
  const pageCountA = a.length;
  const pageCountB = b.length;
  const max = Math.max(pageCountA, pageCountB);

  const pages = [];
  const differingPages = [];
  const addedPages = [];
  const removedPages = [];
  const textlessPages = [];
  let totalAdded = 0;
  let totalRemoved = 0;

  for (let index = 0; index < max; index += 1) {
    const page = index + 1;
    const inA = index < pageCountA;
    const inB = index < pageCountB;

    if (inA && !inB) {
      pages.push({ page, status: "removed", added: 0, removed: 0, rows: [] });
      removedPages.push(page);
      continue;
    }
    if (!inA && inB) {
      pages.push({ page, status: "added", added: 0, removed: 0, rows: [] });
      addedPages.push(page);
      continue;
    }

    const textA = String(a[index] ?? "");
    const textB = String(b[index] ?? "");

    if (!textA.trim() && !textB.trim()) {
      pages.push({ page, status: "textless", added: 0, removed: 0, rows: [] });
      textlessPages.push(page);
      continue;
    }

    if (textA === textB) {
      pages.push({ page, status: "same", added: 0, removed: 0, rows: [] });
      continue;
    }

    const rows = lineDiff(textA, textB);
    let added = 0;
    let removed = 0;
    for (const row of rows) {
      if (row.type === "added") added += 1;
      else if (row.type === "removed") removed += 1;
    }
    totalAdded += added;
    totalRemoved += removed;
    differingPages.push(page);
    pages.push({ page, status: "changed", added, removed, rows });
  }

  // A page present only on one side is also a difference.
  const changedPageSet = new Set([...differingPages, ...addedPages, ...removedPages]);

  return {
    pageCountA,
    pageCountB,
    comparedPages: Math.min(pageCountA, pageCountB),
    pages,
    totals: {
      added: totalAdded,
      removed: totalRemoved,
      changedPages: changedPageSet.size,
    },
    differingPages,
    addedPages,
    removedPages,
    textlessPages,
    identical: changedPageSet.size === 0 && pageCountA === pageCountB,
  };
}

/** Builds a plain-text diff report from a comparePdfText result. Pure. */
export function comparePdfReportText(result, { nameA = "A (original)", nameB = "B (revised)" } = {}) {
  const lines = [];
  lines.push("PDF COMPARISON REPORT");
  lines.push("=====================");
  lines.push(`A (original): ${nameA} — ${result.pageCountA} page(s)`);
  lines.push(`B (revised):  ${nameB} — ${result.pageCountB} page(s)`);
  lines.push("");

  if (result.identical) {
    lines.push("No differences found. The extracted text of both documents is identical page for page.");
    return lines.join("\n") + "\n";
  }

  lines.push(
    `Summary: ${result.totals.changedPages} page(s) differ — ` +
    `${result.totals.added} line(s) added, ${result.totals.removed} line(s) removed.`
  );
  if (result.addedPages.length) lines.push(`Pages only in B (extra): ${result.addedPages.join(", ")}.`);
  if (result.removedPages.length) lines.push(`Pages only in A (missing from B): ${result.removedPages.join(", ")}.`);
  if (result.textlessPages.length) {
    lines.push(`Pages with no extractable text (compare visually): ${result.textlessPages.join(", ")}.`);
  }
  lines.push("");

  for (const entry of result.pages) {
    if (entry.status === "same") continue;
    lines.push(`--- Page ${entry.page} — ${entry.status} ---`);
    if (entry.status === "added") {
      lines.push("This page exists only in B (revised).");
    } else if (entry.status === "removed") {
      lines.push("This page exists only in A (original).");
    } else if (entry.status === "textless") {
      lines.push("Neither side had extractable text on this page — use the visual diff.");
    } else {
      lines.push(`+${entry.added} / -${entry.removed} line(s)`);
      for (const row of entry.rows) {
        if (row.type === "removed") lines.push(`- ${row.left}`);
        else if (row.type === "added") lines.push(`+ ${row.right}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

// =============================================================================
// 2. DESKEW — projection-profile skew angle estimation
// =============================================================================

/**
 * Estimates the skew angle of a page from a darkness matrix using the classic
 * projection-profile method.
 *
 * `gray` is a flat array of ink intensities, row-major, length width*height,
 * where a LARGER value means MORE ink (0 = blank background, 255 = solid ink).
 * The caller (browser) rasterises the page and converts luma to darkness
 * (255 - luma) at a downscaled resolution before calling this.
 *
 * For each candidate angle we project every ink pixel onto a 1-D profile of
 * rotated row positions and score the profile's variance. When text lines are
 * horizontal the ink piles into a few rows, giving a high-variance ("peaky")
 * profile; a skewed page spreads ink across many rows and flattens it. The bin
 * count is fixed across angles, so the total ink (and thus the profile mean) is
 * constant — maximising variance is therefore well defined and comparable.
 *
 * Sign convention: a positive result means the content is rotated so that the
 * caller should rotate the page by -angle to straighten it. A synthetic image
 * whose lines were rotated by +θ is recovered as ≈ +θ.
 *
 * A blank matrix (no ink) returns 0 without throwing.
 *
 * Bounded cost: (angles) × (ink pixels). Downscale before calling.
 */
export function estimateSkewAngle(gray, width, height, options = {}) {
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (!gray || w <= 0 || h <= 0 || gray.length < w * h) return 0;

  const minDeg = Number.isFinite(options.minDeg) ? options.minDeg : -10;
  const maxDeg = Number.isFinite(options.maxDeg) ? options.maxDeg : 10;
  const step = options.step > 0 ? options.step : 0.5;
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 32;

  // Collect ink pixels once (sparse pass): most page pixels are background.
  const xs = [];
  const ys = [];
  const ws = [];
  for (let y = 0; y < h; y += 1) {
    const rowBase = y * w;
    for (let x = 0; x < w; x += 1) {
      const v = gray[rowBase + x];
      if (v > threshold) {
        xs.push(x);
        ys.push(y);
        ws.push(v);
      }
    }
  }
  if (!xs.length) return 0;

  // Fixed bin geometry, valid for |sin θ| ≤ ~0.18 (±10°): x*sinθ stays within ±w.
  const offset = w + 2;
  const bins = h + 2 * w + 4;
  const profile = new Float64Array(bins);
  const DEG = Math.PI / 180;

  let bestAngle = 0;
  let bestScore = -1;

  for (let deg = minDeg; deg <= maxDeg + 1e-9; deg += step) {
    const theta = deg * DEG;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    profile.fill(0);

    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < xs.length; i += 1) {
      // bin = y*cosθ - x*sinθ (the minus makes a +θ content skew read as +θ).
      const bin = ((ys[i] * cosT - xs[i] * sinT) | 0) + offset;
      profile[bin] += ws[i];
    }
    for (let b = 0; b < bins; b += 1) {
      const value = profile[b];
      sum += value;
      sumSq += value * value;
    }
    const mean = sum / bins;
    const variance = sumSq / bins - mean * mean;

    // Prefer higher variance; on a near-tie keep the angle closest to zero.
    if (variance > bestScore * (1 + 1e-6) || (variance > bestScore * (1 - 1e-6) && Math.abs(deg) < Math.abs(bestAngle))) {
      bestScore = variance;
      bestAngle = deg;
    }
  }

  return Math.round(bestAngle * 100) / 100;
}

// =============================================================================
// 3. PDF/A ARCHIVAL PREP — best-effort archival hygiene (NOT certified PDF/A)
// =============================================================================
//
// HONEST SCOPE: This is best-effort archival hygiene, not a validated,
// veraPDF-certified PDF/A conversion. Real PDF/A requires every font embedded
// and subset, no transparency/forbidden operators, a full validation pass, and
// (for the "A" level) a tagged structure tree — none of which can be guaranteed
// from the browser without re-typesetting the document. What we DO here is
// genuine and verifiable: an sRGB OutputIntent + ICC profile, an XMP packet
// carrying the PDF/A conformance identifier, a document /ID, a /MarkInfo entry,
// Info metadata, and the removal of things PDF/A forbids (encryption is refused;
// JavaScript / OpenAction / Launch actions are stripped). We never claim
// compliance we cannot prove.

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function randomIdHex() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Builds a compact but structurally valid sRGB ICC profile (v2.1, 3-channel
 * RGB → XYZ) suitable for a PDF OutputIntent's DestOutputProfile. It uses the
 * Bradford-adapted D50 sRGB primaries and a gamma-2.2 TRC approximation of the
 * sRGB tone curve — a faithful sRGB intent for archival colour, not the exact
 * piecewise sRGB curve. Returns the profile bytes. Pure.
 */
export function buildSrgbIccProfile() {
  const s15 = (value) => Math.round(value * 65536); // s15Fixed16
  const enc = (str) => Array.from(str, (c) => c.charCodeAt(0));

  // --- tag data blocks -------------------------------------------------------
  const xyzTag = (x, y, z) => {
    const out = [];
    out.push(...enc("XYZ "), 0, 0, 0, 0);
    for (const v of [x, y, z]) {
      const f = s15(v);
      out.push((f >>> 24) & 0xff, (f >>> 16) & 0xff, (f >>> 8) & 0xff, f & 0xff);
    }
    return out; // 20 bytes
  };

  // The exact IEC 61966-2.1 sRGB tone response curve, encoded as an ICC
  // parametricCurveType ('para') function type 3: Y = ((a·X + b)^g) for X ≥ d,
  // Y = c·X for X < d — the true piecewise sRGB curve (g=2.4, a=1/1.055,
  // b=0.055/1.055, c=1/12.92, d=0.04045), not a gamma-2.2 approximation.
  const trcTag = (() => {
    const s15 = (value) => Math.round(value * 65536) >>> 0;
    const params = [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045];
    const out = [...enc("para"), 0, 0, 0, 0]; // sig + reserved
    out.push(0x00, 0x03, 0x00, 0x00);         // function type 3, reserved
    for (const p of params) {
      const f = s15(p);
      out.push((f >>> 24) & 0xff, (f >>> 16) & 0xff, (f >>> 8) & 0xff, f & 0xff);
    }
    return out; // 12 + 5*4 = 32 bytes
  })();

  // 'desc' textDescriptionType with a short ASCII name.
  const descTag = (() => {
    const ascii = enc("sRGB\0");
    const out = [...enc("desc"), 0, 0, 0, 0];
    out.push((ascii.length >>> 24) & 0xff, (ascii.length >>> 16) & 0xff, (ascii.length >>> 8) & 0xff, ascii.length & 0xff);
    out.push(...ascii);
    out.push(0, 0, 0, 0); // unicode language code
    out.push(0, 0, 0, 0); // unicode count
    out.push(0, 0); // scriptcode code
    out.push(0); // mac description count
    for (let i = 0; i < 67; i += 1) out.push(0); // mac description
    return out;
  })();

  // 'text' type copyright.
  const cprtTag = [...enc("text"), 0, 0, 0, 0, ...enc("MyFileKit\0")];

  const wtpt = xyzTag(0.9642, 1.0, 0.8249); // D50
  const rXYZ = xyzTag(0.4360, 0.2225, 0.0139);
  const gXYZ = xyzTag(0.3851, 0.7169, 0.0971);
  const bXYZ = xyzTag(0.1431, 0.0606, 0.7139);

  // TRC tags share one parametric-curve block; XYZ tags are distinct.
  const blocks = [
    { sig: "desc", data: descTag },
    { sig: "wtpt", data: wtpt },
    { sig: "rXYZ", data: rXYZ },
    { sig: "gXYZ", data: gXYZ },
    { sig: "bXYZ", data: bXYZ },
    { sig: "cprt", data: cprtTag },
  ];
  // Curve tags reference the same data offset.
  const trcSigs = ["rTRC", "gTRC", "bTRC"];

  const headerSize = 128;
  const tagCount = blocks.length + trcSigs.length;
  const tagTableSize = 4 + tagCount * 12;
  let cursor = headerSize + tagTableSize;

  const align4 = (n) => (n + 3) & ~3;
  const tagEntries = [];
  const dataParts = [];

  for (const block of blocks) {
    const offset = cursor;
    tagEntries.push({ sig: block.sig, offset, size: block.data.length });
    dataParts.push({ offset, bytes: block.data });
    cursor = align4(cursor + block.data.length);
  }
  // Shared parametric TRC block for the three TRC tags.
  const trcOffset = cursor;
  dataParts.push({ offset: trcOffset, bytes: trcTag });
  cursor = align4(cursor + trcTag.length);
  for (const sig of trcSigs) tagEntries.push({ sig, offset: trcOffset, size: trcTag.length });

  const totalSize = cursor;
  const buf = new Uint8Array(totalSize);
  const u32 = (pos, v) => { buf[pos] = (v >>> 24) & 0xff; buf[pos + 1] = (v >>> 16) & 0xff; buf[pos + 2] = (v >>> 8) & 0xff; buf[pos + 3] = v & 0xff; };
  const put = (pos, arr) => buf.set(arr, pos);

  // --- header ---------------------------------------------------------------
  u32(0, totalSize);
  put(8, [0x02, 0x10, 0x00, 0x00]); // version 2.1
  put(12, enc("mntr"));
  put(16, enc("RGB "));
  put(20, enc("XYZ "));
  put(36, enc("acsp"));
  // PCS illuminant D50 at offset 68.
  const d50 = [0.9642, 1.0, 0.8249].map(s15);
  for (let i = 0; i < 3; i += 1) u32(68 + i * 4, d50[i] >>> 0);

  // --- tag table ------------------------------------------------------------
  u32(headerSize, tagCount);
  let tp = headerSize + 4;
  for (const entry of tagEntries) {
    put(tp, enc(entry.sig)); tp += 4;
    u32(tp, entry.offset); tp += 4;
    u32(tp, entry.size); tp += 4;
  }

  // --- tag data -------------------------------------------------------------
  for (const part of dataParts) put(part.offset, part.bytes);

  return buf;
}

/**
 * Builds the XMP packet carrying Dublin Core, PDF, XMP basic, and — the point of
 * the exercise — the PDF/A conformance identifier (pdfaid:part / :conformance).
 * Pure.
 */
export function buildArchivalXmp({ title = "", author = "", subject = "", producer = "MyFileKit", part = "1", conformance = "B", date = new Date() } = {}) {
  const iso = date.toISOString().replace(/\.\d+Z$/, "Z");
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
    xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>${xmlEscape(part)}</pdfaid:part>
   <pdfaid:conformance>${xmlEscape(conformance)}</pdfaid:conformance>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(title)}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>${xmlEscape(author)}</rdf:li></rdf:Seq></dc:creator>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(subject)}</rdf:li></rdf:Alt></dc:description>
   <pdf:Producer>${xmlEscape(producer)}</pdf:Producer>
   <xmp:CreatorTool>${xmlEscape(producer)}</xmp:CreatorTool>
   <xmp:CreateDate>${iso}</xmp:CreateDate>
   <xmp:ModifyDate>${iso}</xmp:ModifyDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/** Deletes a key from a dict and frees its value. Returns true when something was removed. */
function stripEntry(pdf, dict, keyName) {
  const { PDFName } = getPdfLib();
  const key = PDFName.of(keyName);
  const value = dict.get(key);
  if (value === undefined) return false;
  try {
    if (value && typeof value === "object" && "objectNumber" in value) pdf.context.delete(value);
  } catch {
    // A direct (non-reference) value has nothing to delete from the context.
  }
  dict.delete(key);
  return true;
}

/** Reads the /S action-type sub-key of a resolved action dict, as a plain name string. */
function actionTypeOf(actionDict) {
  const { PDFName } = getPdfLib();
  const s = actionDict.get(PDFName.of("S"));
  return s && typeof s.decodeText === "function" ? s.decodeText() : s ? String(s).replace(/^\//, "") : null;
}

// Depth cap for an /A → /Next → … action chain (a /Next can be cyclic or deep).
const MAX_ACTION_CHAIN = 64;

/** True when a resolved action dict's /S is a PDF/A-forbidden auto-run type. */
function isForbiddenAction(actionDict) {
  const t = actionTypeOf(actionDict);
  return t === "JavaScript" || t === "Launch";
}

/** Stable "<obj> <gen>" tag for an indirect reference, else null (direct value). */
function actionRefTag(value) {
  return value && typeof value === "object" && "objectNumber" in value
    ? `${value.objectNumber} ${value.generationNumber}`
    : null;
}

/**
 * Walks an action value — the action dict itself PLUS its /Next chain (a single
 * action dict or an array of them) — collecting whether any link is a forbidden
 * JavaScript or Launch action. Mirrors the sanitizer's /Next recursion so a
 * dangerous action hidden behind a benign head (e.g. /GoTo → /Next → /JavaScript)
 * is still detected. Cycle-guarded by an object-ref set and bounded by a depth cap.
 */
function collectChainForbidden(pdf, value, out = { javascript: false, launch: false, truncated: false }, seen = new Set(), depth = 0) {
  const { PDFDict, PDFArray, PDFName } = getPdfLib();
  if (value === undefined || value === null) return out;
  // Fail safe on cap overflow: a chain too deep to fully inspect is treated as
  // possibly-forbidden (mirrors stripChainForbidden, which removes such an entry)
  // so the compliance checker never reports an un-walked chain as clean.
  if (depth > MAX_ACTION_CHAIN) { out.truncated = true; return out; }
  const resolved = pdf.context.lookup(value);
  if (resolved instanceof PDFArray) {
    for (let i = 0; i < resolved.size(); i += 1) {
      collectChainForbidden(pdf, resolved.get(i), out, seen, depth + 1);
    }
    return out;
  }
  if (!(resolved instanceof PDFDict)) return out;
  const tag = actionRefTag(value);
  if (tag) { if (seen.has(tag)) return out; seen.add(tag); }
  const t = actionTypeOf(resolved);
  if (t === "JavaScript") out.javascript = true;
  else if (t === "Launch") out.launch = true;
  collectChainForbidden(pdf, resolved.get(PDFName.of("Next")), out, seen, depth + 1);
  return out;
}

/**
 * Strips JavaScript / Launch actions from the action held at parent[keyName] and
 * its /Next chain. A forbidden HEAD removes the whole entry; a benign head is kept
 * and its /Next chain (a single action or an array) is walked, dropping only the
 * forbidden links. Mirrors the sanitizer's /Next recursion. Cycle-guarded by an
 * object-ref set and bounded by a depth cap. Returns the count of actions removed.
 */
function stripChainForbidden(pdf, parent, keyName, seen, depth) {
  const { PDFDict, PDFArray, PDFName } = getPdfLib();
  const ctx = pdf.context;
  const key = PDFName.of(keyName);
  const value = parent.get(key);
  if (value === undefined) return 0;
  if (depth > MAX_ACTION_CHAIN) { stripEntry(pdf, parent, keyName); return 0; }
  const action = ctx.lookup(value);

  if (action instanceof PDFArray) {
    let removed = 0;
    const keep = [];
    for (let i = 0; i < action.size(); i += 1) {
      const entry = action.get(i);
      const el = ctx.lookup(entry);
      if (!(el instanceof PDFDict)) { keep.push(entry); continue; }
      const tag = actionRefTag(entry);
      if (tag) { if (seen.has(tag)) continue; seen.add(tag); }
      if (isForbiddenAction(el)) {
        if (actionRefTag(entry)) { try { ctx.delete(entry); } catch { /* already gone */ } }
        removed += 1;
        continue; // drop this link from the rebuilt array
      }
      removed += stripChainForbidden(pdf, el, "Next", seen, depth + 1);
      keep.push(entry);
    }
    if (keep.length !== action.size()) {
      const rebuilt = PDFArray.withContext(ctx);
      for (const ref of keep) rebuilt.push(ref);
      parent.set(key, rebuilt);
    }
    return removed;
  }

  if (!(action instanceof PDFDict)) return 0;
  const tag = actionRefTag(value);
  if (tag) { if (seen.has(tag)) { stripEntry(pdf, parent, keyName); return 0; } seen.add(tag); }
  if (isForbiddenAction(action)) {
    stripEntry(pdf, parent, keyName); // deletes the referenced action object too
    return 1;
  }
  return stripChainForbidden(pdf, action, "Next", seen, depth + 1); // benign head kept
}

/**
 * Loads PDF bytes only to confirm they are not encrypted, throwing the same
 * friendly message archivalPrepPdf uses. The archival raster path calls this on
 * the ORIGINAL bytes before rasterising, so an encrypted file is refused with a
 * clear message rather than an opaque pdf.js "no password" error.
 */
export async function assertPdfDecryptable(bytes) {
  const { PDFDocument } = getPdfLib();
  let pdf;
  try {
    pdf = await PDFDocument.load(bytes);
  } catch (error) {
    if (/encrypt/i.test(String(error?.message))) {
      throw new Error("This PDF is encrypted. Remove the password first (use Remove Password), then run archival prep.");
    }
    throw error;
  }
  if (pdf.isEncrypted) {
    throw new Error("This PDF is encrypted. Remove the password first (use Remove Password), then run archival prep.");
  }
}

/** Best-effort human name for a font, from /BaseFont (subset prefix trimmed). */
function fontDisplayName(pdf, fontDict) {
  const { PDFName } = getPdfLib();
  const base = fontDict.get(PDFName.of("BaseFont"));
  let name = base && typeof base.decodeText === "function" ? base.decodeText()
    : base ? String(base).replace(/^\//, "") : "(unnamed font)";
  // Subset fonts are tagged "ABCDEF+FontName"; keep the readable half.
  const plus = name.indexOf("+");
  if (plus === 6) name = name.slice(plus + 1);
  return name || "(unnamed font)";
}

/**
 * Walks every font in the document and reports embedding. PDF/A forbids any
 * font whose glyph program is not embedded — including the standard-14 fonts,
 * which carry no /FontDescriptor at all. Type3 fonts define their glyphs as
 * content streams and need no font file, so they count as self-contained. Pure.
 *
 * Returns { fonts: [{ name, subtype, embedded }], unembedded: string[] }.
 */
export function scanFontEmbedding(pdf) {
  const { PDFDict, PDFName, PDFArray } = getPdfLib();
  const ctx = pdf.context;
  const fonts = [];
  const unembeddedSet = new Set();
  const seen = new Set();

  const descriptorEmbedded = (descriptor) => {
    if (!(descriptor instanceof PDFDict)) return false;
    return ["FontFile", "FontFile2", "FontFile3"].some(
      (k) => descriptor.get(PDFName.of(k)) !== undefined,
    );
  };

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const type = obj.get(PDFName.of("Type"));
    const typeName = type && typeof type.encodedName === "string" ? type.encodedName : type ? String(type) : "";
    if (typeName !== "/Font") continue;
    if (seen.has(ref.tag)) continue;
    seen.add(ref.tag);

    const subtypeObj = obj.get(PDFName.of("Subtype"));
    const subtype = subtypeObj ? String(subtypeObj).replace(/^\//, "") : "";
    const name = fontDisplayName(pdf, obj);

    let embedded;
    if (subtype === "Type3") {
      embedded = true; // glyphs are inline content streams
    } else if (subtype === "Type0") {
      // Composite font: the embedded program lives on the descendant CIDFont.
      const descendants = ctx.lookup(obj.get(PDFName.of("DescendantFonts")));
      let anyEmbedded = false;
      if (descendants instanceof PDFArray && descendants.size() > 0) {
        for (let i = 0; i < descendants.size(); i += 1) {
          const cid = ctx.lookup(descendants.get(i));
          if (cid instanceof PDFDict) {
            anyEmbedded = descriptorEmbedded(ctx.lookup(cid.get(PDFName.of("FontDescriptor")))) || anyEmbedded;
          }
        }
      }
      embedded = anyEmbedded;
    } else {
      embedded = descriptorEmbedded(ctx.lookup(obj.get(PDFName.of("FontDescriptor"))));
    }

    fonts.push({ name, subtype, embedded });
    if (!embedded) unembeddedSet.add(name);
  }

  return { fonts, unembedded: [...unembeddedSet] };
}

/**
 * Best-effort PDF/A archival prep on raw PDF bytes (pure pdf-lib, Node-testable).
 * Refuses encrypted input. FAILS LOUDLY if any font is not embedded (a core
 * PDF/A rule). Strips JavaScript / OpenAction / Launch actions and embedded
 * files (unless targeting PDF/A-3), adds an sRGB OutputIntent, XMP with the
 * PDF/A id synced to DocInfo, Info, /Lang, /MarkInfo and /ID.
 *
 * Returns { bytes, report: { applied: string[], removed: string[], conformance } }.
 * The caller handles the optional "rasterise first" mode (browser-only) and
 * hands the rasterised bytes here.
 */
export async function archivalPrepPdf(sourceBytes, options = {}) {
  const { PDFDocument, PDFName, PDFArray, PDFNumber, PDFString, PDFHexString, PDFBool } = getPdfLib();
  const pdfFalse = PDFBool.False;
  // Default to PDF/A-2b: the self-contained raster path (image-only pages, no
  // unembedded fonts) targets 2b, which allows the JPEG/Flate image compression
  // rasterising produces (PDF/A-1 does not). Callers can still pass part "1".
  const part = String(options.part || "2");
  const conformance = String(options.conformance || "B");
  // Validate the caller-supplied language against BCP-47 (an invalid tag falls
  // back to "en", matching the a11y service) so it cannot inject catalog syntax.
  const lang = safeLangTag(options.lang || "en", "en");

  let pdf;
  try {
    pdf = await PDFDocument.load(sourceBytes);
  } catch (error) {
    if (/encrypt/i.test(String(error?.message))) {
      throw new Error("This PDF is encrypted. Remove the password first (use Remove Password), then run archival prep.");
    }
    throw error;
  }
  if (pdf.isEncrypted) {
    throw new Error("This PDF is encrypted. Remove the password first (use Remove Password), then run archival prep.");
  }

  const ctx = pdf.context;
  const catalog = pdf.catalog;
  const applied = [];
  const removed = [];

  // --- FAIL LOUDLY on unembedded fonts (a core PDF/A rule) ------------------
  // A missing font program cannot be repaired from the browser without
  // re-typesetting, so we refuse rather than silently emit non-conformant
  // output. The raster path (image-only pages) has no fonts and passes.
  const { unembedded } = scanFontEmbedding(pdf);
  if (unembedded.length > 0) {
    throw new Error(
      `Cannot produce PDF/A: ${unembedded.length} font(s) are not embedded — `
      + `${unembedded.join(", ")}. PDF/A requires every font (including the `
      + `standard 14) to be embedded. Embed the fonts in the source, or use the `
      + `"rasterise pages" archival mode, then try again.`,
    );
  }

  // --- remove things PDF/A forbids where easy -------------------------------
  if (stripEntry(pdf, catalog, "OpenAction")) removed.push("document OpenAction (auto-run action)");
  if (stripEntry(pdf, catalog, "AA")) removed.push("document additional-actions (/AA)");

  // Embedded files are forbidden except in PDF/A-3. Strip the catalog
  // /Names /EmbeddedFiles tree (and the AF associated-files array) unless the
  // caller is explicitly targeting part 3.
  if (part !== "3") {
    const nm = ctx.lookup(catalog.get(PDFName.of("Names")));
    if (nm && typeof nm.get === "function" && stripEntry(pdf, nm, "EmbeddedFiles")) {
      removed.push("embedded files (/Names /EmbeddedFiles) — not allowed outside PDF/A-3");
    }
    if (stripEntry(pdf, catalog, "AF")) removed.push("document associated files (/AF)");
  }

  // Catalog /Names /JavaScript name tree.
  const names = ctx.lookup(catalog.get(PDFName.of("Names")));
  if (names && typeof names.get === "function") {
    if (stripEntry(pdf, names, "JavaScript")) removed.push("document-level JavaScript (/Names /JavaScript)");
  }

  // Per-page annotation and page actions.
  let strippedAnnotActions = 0;
  let strippedPageAA = 0;
  for (const page of pdf.getPages()) {
    const node = page.node;
    if (stripEntry(pdf, node, "AA")) strippedPageAA += 1;
    const annots = ctx.lookup(node.get(PDFName.of("Annots")));
    if (!annots || typeof annots.size !== "function") continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const annot = ctx.lookup(annots.get(i));
      if (!annot || typeof annot.get !== "function") continue;
      // Walk the whole /A → /Next chain, not just the top-level /S, so a
      // dangerous action hidden behind a benign head (/GoTo → /Next → /JavaScript)
      // is stripped too.
      strippedAnnotActions += stripChainForbidden(pdf, annot, "A", new Set(), 0);
      stripEntry(pdf, annot, "AA");
    }
  }
  if (strippedPageAA) removed.push(`${strippedPageAA} page additional-action block(s)`);
  if (strippedAnnotActions) removed.push(`${strippedAnnotActions} JavaScript/Launch action(s) on links or annotations`);

  // --- Info metadata --------------------------------------------------------
  const now = options.date instanceof Date ? options.date : new Date();
  // PDF/A recommends a document title; always set one (defaulting when none is
  // given) so the title is present in both Info and the XMP dc:title below.
  const title = String(options.title || "").trim() || "Archived document";
  const author = String(options.author || "");
  const subject = String(options.subject || "");
  const producer = "MyFileKit Archival Prep";
  pdf.setTitle(title);
  if (author) pdf.setAuthor(author);
  if (subject) pdf.setSubject(subject);
  pdf.setProducer(producer);
  pdf.setCreator(producer);
  try { pdf.setModificationDate(now); pdf.setCreationDate(now); } catch { /* date setters are best-effort */ }
  applied.push("document Info metadata (Title/Author/Producer/dates)");

  // --- document language (/Lang) — required by PDF/UA, recommended by PDF/A --
  // Written as a hex string (like the a11y service) so even a slipped value can
  // never break out of the catalog dictionary as literal syntax.
  catalog.set(PDFName.of("Lang"), PDFHexString.fromText(lang));
  applied.push(`document language /Lang (${lang})`);

  // --- /MarkInfo (honest: not tagged, so Marked = false for level B) --------
  const markInfo = ctx.obj({});
  markInfo.set(PDFName.of("Marked"), pdfFalse);
  catalog.set(PDFName.of("MarkInfo"), ctx.register(markInfo));
  applied.push("/MarkInfo (Marked=false — this is level B, no tagged structure)");

  // --- sRGB OutputIntent + ICC ---------------------------------------------
  const icc = buildSrgbIccProfile();
  const iccStream = ctx.flateStream(icc, { N: PDFNumber.of(3) });
  const iccRef = ctx.register(iccStream);
  const outputIntent = ctx.obj({});
  outputIntent.set(PDFName.of("Type"), PDFName.of("OutputIntent"));
  outputIntent.set(PDFName.of("S"), PDFName.of("GTS_PDFA1"));
  outputIntent.set(PDFName.of("OutputConditionIdentifier"), PDFString.of("sRGB IEC61966-2.1"));
  outputIntent.set(PDFName.of("Info"), PDFString.of("sRGB IEC61966-2.1"));
  outputIntent.set(PDFName.of("DestOutputProfile"), iccRef);
  const intents = PDFArray.withContext(ctx);
  intents.push(ctx.register(outputIntent));
  catalog.set(PDFName.of("OutputIntents"), intents);
  applied.push("sRGB OutputIntent with embedded ICC profile");

  // --- XMP metadata with the PDF/A identifier -------------------------------
  stripEntry(pdf, catalog, "Metadata");
  const xmp = buildArchivalXmp({ title, author, subject, producer, part, conformance, date: now });
  const metadataStream = ctx.stream(xmp, {
    Type: PDFName.of("Metadata"),
    Subtype: PDFName.of("XML"),
  });
  catalog.set(PDFName.of("Metadata"), ctx.register(metadataStream));
  applied.push(`XMP metadata with PDF/A-${part}${conformance} conformance identifier`);

  // --- document /ID ---------------------------------------------------------
  const idHex = PDFHexString.of(randomIdHex());
  const idArray = PDFArray.withContext(ctx);
  idArray.push(idHex);
  idArray.push(idHex);
  ctx.trailerInfo.ID = idArray;
  applied.push("document /ID");

  // updateMetadata:false so pdf-lib does not overwrite our XMP / Producer.
  const bytes = await pdf.save({ useObjectStreams: false, updateMetadata: false });
  return { bytes, report: { applied, removed, conformance: `PDF/A-${part}${conformance} (best-effort, not validated)` } };
}

// =============================================================================
// 3b. PDF/A PRE-FLIGHT CHECKER — reports which machine-checkable criteria a
// given file passes. HONEST: this checks a well-defined subset of PDF/A-2b /
// PDF/A-1b rules. It is NOT veraPDF and issues NO certification. Rules we do
// NOT check (all colour spaces, every annotation flag, deep ICC validity,
// tagged-structure completeness for level A) are listed under `notChecked`.
// =============================================================================

const NOT_CHECKED_RULES = [
  "Every colour operator resolves to a device-independent space (we anchor colour with an OutputIntent but do not walk every content-stream colour operator).",
  "All annotation appearance streams and flags conform (e.g. every annotation has a normal appearance, no forbidden flags).",
  "Deep ICC profile validity (we confirm an ICC stream is present with a channel count, not that the profile passes ICC's own validation).",
  "Complete tagged-structure tree for PDF/A level A (this checker targets level B only).",
  "Absence of every forbidden operator/filter across all content streams (e.g. LZW, certain transfer functions).",
];

// The pdfaid / title / date probes only need the packet header, so decoding the
// whole stream is wasted work and a DoS vector on a multi-MB /Metadata. Cap the
// slice we decode; a well-formed XMP packet is a few KB.
const MAX_XMP_BYTES = 256 * 1024;

/** Reads the XMP packet text (capped) from the catalog /Metadata stream, or "". */
function readXmpText(pdf) {
  const { PDFName } = getPdfLib();
  const meta = pdf.context.lookup(pdf.catalog.get(PDFName.of("Metadata")));
  if (!meta || !meta.contents) return "";
  const raw = meta.contents.length > MAX_XMP_BYTES ? meta.contents.slice(0, MAX_XMP_BYTES) : meta.contents;
  try {
    return new TextDecoder("utf-8").decode(raw);
  } catch {
    let out = "";
    for (const b of raw) out += String.fromCharCode(b);
    return out;
  }
}

/** Detects PDF/A-forbidden active content still present in a loaded document. */
function detectForbidden(pdf) {
  const { PDFName } = getPdfLib();
  const ctx = pdf.context;
  const catalog = pdf.catalog;
  const result = { javascript: false, launch: false, openAction: false, additionalActions: false, embeddedFiles: false };

  const openAction = catalog.get(PDFName.of("OpenAction"));
  if (openAction !== undefined) result.openAction = true;
  // Walk the OpenAction's full /Next chain and flag JavaScript OR Launch (a
  // /Launch OpenAction launches a program on open, so it must fail the check too).
  const oa = collectChainForbidden(pdf, openAction);
  if (oa.javascript || oa.truncated) result.javascript = true;
  if (oa.launch) result.launch = true;
  if (catalog.get(PDFName.of("AA")) !== undefined) result.additionalActions = true;

  const names = ctx.lookup(catalog.get(PDFName.of("Names")));
  if (names && typeof names.get === "function") {
    if (names.get(PDFName.of("JavaScript")) !== undefined) result.javascript = true;
    if (names.get(PDFName.of("EmbeddedFiles")) !== undefined) result.embeddedFiles = true;
  }
  if (catalog.get(PDFName.of("AF")) !== undefined) result.embeddedFiles = true;

  for (const page of pdf.getPages()) {
    const node = page.node;
    if (node.get(PDFName.of("AA")) !== undefined) result.additionalActions = true;
    const annots = ctx.lookup(node.get(PDFName.of("Annots")));
    if (!annots || typeof annots.size !== "function") continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const annot = ctx.lookup(annots.get(i));
      if (!annot || typeof annot.get !== "function") continue;
      // Walk the whole /A → /Next chain, not just the top-level /S.
      const chain = collectChainForbidden(pdf, annot.get(PDFName.of("A")));
      if (chain.javascript || chain.truncated) result.javascript = true;
      if (chain.launch) result.launch = true;
      if (annot.get(PDFName.of("AA")) !== undefined) result.additionalActions = true;
    }
  }
  return result;
}

/** Best-effort detection of page-level transparency (a group with /S /Transparency). */
function detectTransparency(pdf) {
  const { PDFName, PDFDict } = getPdfLib();
  const ctx = pdf.context;
  for (const page of pdf.getPages()) {
    const group = ctx.lookup(page.node.get(PDFName.of("Group")));
    if (group instanceof PDFDict) {
      const s = group.get(PDFName.of("S"));
      if (s && String(s) === "/Transparency") return true;
    }
  }
  return false;
}

/**
 * Runs the PDF/A pre-flight over raw bytes and returns a pass/fail tally.
 * Pure (pdf-lib only), Node-testable. Never throws on a normal PDF — an
 * encrypted file is reported as a failed criterion, not an exception.
 *
 * Returns { target, criteria: [{ id, label, pass, detail }], passed, total,
 *   certified:false, caveat, notChecked }.
 */
export async function checkPdfACompliance(bytes, options = {}) {
  const { PDFDocument, PDFName, PDFArray, PDFDict } = getPdfLib();
  const part = String(options.part || "2");
  const conformance = String(options.conformance || "B");
  const criteria = [];
  const add = (id, label, pass, detail) => criteria.push({ id, label, pass: Boolean(pass), detail });

  let pdf = null;
  try {
    pdf = await PDFDocument.load(bytes, { throwOnInvalidObject: false });
  } catch (error) {
    if (/encrypt/i.test(String(error?.message))) {
      add("encryption", "Not encrypted", false, "The file is encrypted; PDF/A forbids encryption. Remove the password first.");
    } else {
      add("parse", "File parses as PDF", false, error?.message || "The file could not be parsed as a PDF.");
    }
    const passed = criteria.filter((c) => c.pass).length;
    return { target: `PDF/A-${part}${conformance}`, criteria, passed, total: criteria.length, certified: false, caveat: NOT_VERAPDF_CAVEAT, notChecked: NOT_CHECKED_RULES };
  }

  const ctx = pdf.context;
  const catalog = pdf.catalog;

  // 1. Encryption.
  add("encryption", "Not encrypted", !pdf.isEncrypted,
    pdf.isEncrypted ? "The file is encrypted; PDF/A forbids encryption." : "No document encryption.");

  // 2. Fonts embedded.
  const { fonts, unembedded } = scanFontEmbedding(pdf);
  add("fonts", "All fonts embedded", unembedded.length === 0,
    unembedded.length === 0
      ? `${fonts.length} font(s) checked; all embedded (or self-contained Type3).`
      : `Not embedded: ${unembedded.join(", ")}. PDF/A requires every font embedded.`);

  // 3. OutputIntent + ICC.
  const intents = ctx.lookup(catalog.get(PDFName.of("OutputIntents")));
  let iccChannels = null;
  let hasOutputIntent = false;
  if (intents instanceof PDFArray && intents.size() > 0) {
    const intent = ctx.lookup(intents.get(0));
    if (intent instanceof PDFDict) {
      const dest = ctx.lookup(intent.get(PDFName.of("DestOutputProfile")));
      if (dest && dest.dict && dest.dict.get(PDFName.of("N")) !== undefined) {
        hasOutputIntent = true;
        iccChannels = Number(String(dest.dict.get(PDFName.of("N"))));
      } else if (dest) {
        hasOutputIntent = true;
      }
    }
  }
  add("outputIntent", "sRGB OutputIntent with embedded ICC profile", hasOutputIntent,
    hasOutputIntent
      ? `OutputIntent present with an embedded ICC DestOutputProfile${iccChannels ? ` (${iccChannels}-channel)` : ""}.`
      : "No OutputIntent with an embedded ICC profile.");

  // 4/5. XMP present + carries the PDF/A identifier.
  const xmp = readXmpText(pdf);
  add("xmp", "XMP metadata packet present", xmp.length > 0,
    xmp.length > 0 ? "An XMP /Metadata stream is present." : "No XMP /Metadata stream.");
  const xmpPart = (xmp.match(/<pdfaid:part>\s*([^<\s]+)\s*<\/pdfaid:part>/) || [])[1] || null;
  const xmpConf = (xmp.match(/<pdfaid:conformance>\s*([^<\s]+)\s*<\/pdfaid:conformance>/) || [])[1] || null;
  add("pdfaid", "XMP carries pdfaid:part / :conformance", Boolean(xmpPart && xmpConf),
    xmpPart && xmpConf ? `pdfaid:part=${xmpPart}, pdfaid:conformance=${xmpConf}.` : "The XMP is missing the pdfaid:part / :conformance identifier.");

  // 6. XMP dc:title agrees with DocInfo /Title (PDF/A requires them consistent).
  const infoTitle = (() => { try { return pdf.getTitle() || ""; } catch { return ""; } })();
  const xmpTitle = (() => {
    // Inner capture bounded to [^<]* (a title has no '<') so this cannot become a
    // polynomial-backtracking regex on metadata stuffed with unclosed <rdf:li.
    const m = xmp.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]*)<\/rdf:li>/);
    return m ? m[1] : null;
  })();
  const titlesAgree = xmpTitle !== null && xmpTitle === xmlEscape(infoTitle) && infoTitle !== "";
  add("titleSync", "XMP dc:title matches DocInfo /Title", titlesAgree,
    titlesAgree ? `Both carry "${infoTitle}".`
      : `XMP dc:title (${xmpTitle === null ? "absent" : `"${xmpTitle}"`}) and DocInfo /Title ("${infoTitle}") must match.`);

  // 7. XMP CreateDate / ModifyDate agree with DocInfo dates (to the second).
  const toIso = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().replace(/\.\d+Z$/, "Z") : null);
  const infoCreate = (() => { try { return toIso(pdf.getCreationDate()); } catch { return null; } })();
  const infoModify = (() => { try { return toIso(pdf.getModificationDate()); } catch { return null; } })();
  const xmpCreate = (xmp.match(/<xmp:CreateDate>\s*([^<\s]+)\s*<\/xmp:CreateDate>/) || [])[1] || null;
  const xmpModify = (xmp.match(/<xmp:ModifyDate>\s*([^<\s]+)\s*<\/xmp:ModifyDate>/) || [])[1] || null;
  const datesAgree = Boolean(xmpCreate && xmpModify && infoCreate && infoModify && xmpCreate === infoCreate && xmpModify === infoModify);
  add("dateSync", "XMP CreateDate / ModifyDate match DocInfo", datesAgree,
    datesAgree ? "XMP and DocInfo dates agree." : "XMP xmp:CreateDate / xmp:ModifyDate must match DocInfo CreationDate / ModDate.");

  // 8. No JavaScript / forbidden auto-run actions.
  const forbidden = detectForbidden(pdf);
  const noJs = !forbidden.javascript && !forbidden.launch && !forbidden.additionalActions;
  add("noJavaScript", "No JavaScript / Launch / additional-actions", noJs,
    noJs ? "No document or annotation JavaScript, /Launch, or /AA found."
      : `Forbidden active content present: ${[forbidden.javascript && "JavaScript", forbidden.launch && "/Launch", forbidden.additionalActions && "/AA"].filter(Boolean).join(", ")}.`);

  // 9. No embedded files (unless PDF/A-3).
  const embeddedOk = part === "3" || !forbidden.embeddedFiles;
  add("embeddedFiles", part === "3" ? "Embedded files allowed (PDF/A-3)" : "No embedded files", embeddedOk,
    part === "3" ? "PDF/A-3 permits embedded files." : forbidden.embeddedFiles ? "Embedded files present; forbidden outside PDF/A-3." : "No embedded files.");

  // 10. Device-independent colour anchor (best-effort — see notChecked).
  add("deviceIndependentColor", "Device-independent colour anchor", hasOutputIntent,
    hasOutputIntent ? "An OutputIntent supplies a device-independent colour anchor for device colours."
      : "No OutputIntent, so device colours (DeviceRGB/Gray/CMYK) have no PDF/A colour anchor.");

  // 11. No detectable transparency (best-effort).
  const transparency = detectTransparency(pdf);
  add("transparency", "No detectable transparency group", !transparency,
    transparency ? "A page transparency group (/Group /S /Transparency) was detected; PDF/A-1 forbids transparency (PDF/A-2 allows it with a blending colour space)."
      : "No page-level transparency group detected.");

  // 12. Document /Lang.
  const hasLang = catalog.get(PDFName.of("Lang")) !== undefined;
  add("lang", "Document /Lang set", hasLang, hasLang ? "A document language is declared." : "No document /Lang.");

  // 13. /MarkInfo.
  const hasMarkInfo = catalog.get(PDFName.of("MarkInfo")) !== undefined;
  add("markInfo", "/MarkInfo present", hasMarkInfo, hasMarkInfo ? "/MarkInfo is present." : "No /MarkInfo dictionary.");

  // 14. Document /ID.
  const hasId = Boolean(ctx.trailerInfo && ctx.trailerInfo.ID);
  add("documentId", "Document /ID present", hasId, hasId ? "A trailer /ID is present." : "No trailer /ID.");

  const passed = criteria.filter((c) => c.pass).length;
  return {
    target: `PDF/A-${part}${conformance}`,
    criteria,
    passed,
    total: criteria.length,
    certified: false,
    caveat: NOT_VERAPDF_CAVEAT,
    notChecked: NOT_CHECKED_RULES,
  };
}

const NOT_VERAPDF_CAVEAT =
  "Hardened toward PDF/A-2b, not veraPDF-certified. This is a best-effort self-check of "
  + "machine-checkable rules from the browser — it cannot guarantee every veraPDF rule, and it "
  + "issues no certification. See the not-checked list for rules outside this checker's scope.";
