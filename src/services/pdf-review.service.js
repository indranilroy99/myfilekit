import { getPdfLib } from "./pdf.service.js";
import { lineDiff } from "./text-tools.service.js";

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

  // curv with one entry = gamma in u8Fixed8 (2.2 → 563).
  const curvTag = (() => {
    const gamma = Math.round(2.2 * 256);
    return [...enc("curv"), 0, 0, 0, 0, 0, 0, 0, 1, (gamma >>> 8) & 0xff, gamma & 0xff]; // 14 bytes
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

  // TRC tags share one curv block; XYZ tags are distinct.
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
  // Shared curv block for the three TRC tags.
  const curvOffset = cursor;
  dataParts.push({ offset: curvOffset, bytes: curvTag });
  cursor = align4(cursor + curvTag.length);
  for (const sig of trcSigs) tagEntries.push({ sig, offset: curvOffset, size: curvTag.length });

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

/** Reads the /S action-type sub-key of an action dict, as a plain name string. */
function actionType(pdf, actionDict) {
  const { PDFDict, PDFName } = getPdfLib();
  const dict = pdf.context.lookup(actionDict);
  if (!(dict instanceof PDFDict)) return null;
  const s = dict.get(PDFName.of("S"));
  return s && typeof s.decodeText === "function" ? s.decodeText() : s ? String(s).replace(/^\//, "") : null;
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

/**
 * Best-effort PDF/A archival prep on raw PDF bytes (pure pdf-lib, Node-testable).
 * Refuses encrypted input. Strips JavaScript / OpenAction / Launch actions,
 * adds an sRGB OutputIntent, XMP with the PDF/A id, Info, /MarkInfo and /ID.
 *
 * Returns { bytes, report: { applied: string[], removed: string[], conformance } }.
 * The caller handles the optional "rasterise first" mode (browser-only) and
 * hands the rasterised bytes here.
 */
export async function archivalPrepPdf(sourceBytes, options = {}) {
  const { PDFDocument, PDFName, PDFArray, PDFNumber, PDFString, PDFHexString, PDFBool } = getPdfLib();
  const pdfFalse = PDFBool.False;
  const part = String(options.part || "1");
  const conformance = String(options.conformance || "B");

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

  // --- remove things PDF/A forbids where easy -------------------------------
  if (stripEntry(pdf, catalog, "OpenAction")) removed.push("document OpenAction (auto-run action)");
  if (stripEntry(pdf, catalog, "AA")) removed.push("document additional-actions (/AA)");

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
      const type = actionType(pdf, annot.get(PDFName.of("A")));
      if (type === "JavaScript" || type === "Launch") {
        stripEntry(pdf, annot, "A");
        strippedAnnotActions += 1;
      }
      stripEntry(pdf, annot, "AA");
    }
  }
  if (strippedPageAA) removed.push(`${strippedPageAA} page additional-action block(s)`);
  if (strippedAnnotActions) removed.push(`${strippedAnnotActions} JavaScript/Launch action(s) on links or annotations`);

  // --- Info metadata --------------------------------------------------------
  const now = options.date instanceof Date ? options.date : new Date();
  const title = String(options.title || "");
  const author = String(options.author || "");
  const subject = String(options.subject || "");
  const producer = "MyFileKit Archival Prep";
  if (title) pdf.setTitle(title);
  if (author) pdf.setAuthor(author);
  if (subject) pdf.setSubject(subject);
  pdf.setProducer(producer);
  pdf.setCreator(producer);
  try { pdf.setModificationDate(now); pdf.setCreationDate(now); } catch { /* date setters are best-effort */ }
  applied.push("document Info metadata (Title/Author/Producer/dates)");

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
