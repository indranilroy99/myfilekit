// PDF Accessibility service — audit a PDF against PDF/UA + WCAG basics, and
// remediate one toward PDF/UA as far as is reliably automatable.
//
// SCOPE / HONESTY: The audit checks only machine-verifiable criteria readable
// from the PDF object model (tagged, title, language, alt text on figure tags,
// encryption accessibility permission, a structure tree with reading order and
// headings). It does NOT judge colour contrast of rendered content, whether alt
// text is meaningful, or whether the reading order is logically correct — those
// need a human. Remediation sets language/title/marked/viewer-preferences and
// builds a BASIC but real tagged structure tree (a /Document root with /P and
// /H heading elements in reading order, plus /Figure elements carrying /Alt, or
// /Artifact marks for decorative images). It does not claim certified PDF/UA
// conformance: perfect reading order and correct semantics for complex layouts
// (multi-column, tables, forms) still need a manual pass in a full authoring
// tool.
//
// Node-testable (via window.PDFLib) parts: auditPdfAccessibility (structure +
// metadata + a caller-supplied text-layer summary), buildAccessibilityReportText,
// and remediatePdfAccessibility (given already-extracted text blocks + figures).
// BROWSER-ONLY parts are marked below: extractAccessibilityContent uses pdf.js
// for the text layout + character counts that only a renderer can produce.

import { getPdfLib } from "./pdf.service.js";

// Language choices for the remediation dropdown. Codes are BCP-47 / RFC 3066
// tags written verbatim into the catalog /Lang and XMP dc:language (ASCII).
export const LANGUAGE_OPTIONS = [
  { code: "en-US", label: "English (United States)" },
  { code: "en-GB", label: "English (United Kingdom)" },
  { code: "en-IN", label: "English (India)" },
  { code: "hi-IN", label: "Hindi (India)" },
  { code: "bn-IN", label: "Bengali (India)" },
  { code: "ta-IN", label: "Tamil (India)" },
  { code: "te-IN", label: "Telugu (India)" },
  { code: "mr-IN", label: "Marathi (India)" },
  { code: "fr-FR", label: "French (France)" },
  { code: "de-DE", label: "German (Germany)" },
  { code: "es-ES", label: "Spanish (Spain)" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "it-IT", label: "Italian (Italy)" },
  { code: "nl-NL", label: "Dutch (Netherlands)" },
  { code: "ja-JP", label: "Japanese (Japan)" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "zh-TW", label: "Chinese (Traditional)" },
  { code: "ko-KR", label: "Korean (Korea)" },
  { code: "ar-SA", label: "Arabic (Saudi Arabia)" },
  { code: "ru-RU", label: "Russian (Russia)" },
];

const HEADING_TAGS = ["H1", "H2", "H3", "H4", "H5", "H6"];

// --- small object-model read helpers -----------------------------------------

function nameKey(lib, key) {
  return lib.PDFName.of(key);
}

// Decodes a PDF text-string value (PDFString or UTF-16BE PDFHexString) to JS.
function decodePdfText(value) {
  if (!value) return "";
  try {
    if (typeof value.decodeText === "function") return value.decodeText();
    if (typeof value.asString === "function") return value.asString();
  } catch {
    /* fall through to empty */
  }
  return "";
}

// Reads Info dictionary /Title (Info metadata title).
function readInfoTitle(lib, pdf) {
  const infoRef = pdf.context.trailerInfo.Info;
  const info = infoRef ? pdf.context.lookup(infoRef) : undefined;
  if (!info || typeof info.get !== "function") return "";
  return decodePdfText(info.get(nameKey(lib, "Title"))).trim();
}

// Reads XMP dc:title from the catalog /Metadata stream, if present.
function readXmpTitle(lib, pdf) {
  try {
    const metaRef = pdf.catalog.get(nameKey(lib, "Metadata"));
    const meta = metaRef ? pdf.context.lookup(metaRef) : undefined;
    if (!meta || typeof meta.getContents !== "function") return "";
    const xml = new TextDecoder().decode(meta.getContents());
    // dc:title is an rdf:Alt of rdf:li elements; take the first language item.
    const match = xml.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i);
    if (!match) return "";
    return unescapeXml(match[1]).trim();
  } catch {
    return "";
  }
}

function unescapeXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Reads catalog /Lang.
function readLang(lib, pdf) {
  return decodePdfText(pdf.catalog.get(nameKey(lib, "Lang"))).trim();
}

// Reads /ViewerPreferences /DisplayDocTitle boolean.
function readDisplayDocTitle(lib, pdf) {
  const vpRef = pdf.catalog.get(nameKey(lib, "ViewerPreferences"));
  const vp = vpRef ? pdf.context.lookup(vpRef) : undefined;
  if (!vp || typeof vp.get !== "function") return false;
  const value = vp.get(nameKey(lib, "DisplayDocTitle"));
  return isTrue(value);
}

function isTrue(value) {
  if (!value) return false;
  // pdf-lib PDFBool exposes asBoolean(); direct-parsed bools stringify to "true".
  if (typeof value.asBoolean === "function") return value.asBoolean() === true;
  return String(value) === "true";
}

// Reads /MarkInfo /Marked and /StructTreeRoot presence.
function readTagging(lib, pdf) {
  const markRef = pdf.catalog.get(nameKey(lib, "MarkInfo"));
  const markInfo = markRef ? pdf.context.lookup(markRef) : undefined;
  const marked = markInfo && typeof markInfo.get === "function" ? isTrue(markInfo.get(nameKey(lib, "Marked"))) : false;
  const structRef = pdf.catalog.get(nameKey(lib, "StructTreeRoot"));
  const structRoot = structRef ? pdf.context.lookup(structRef) : undefined;
  const hasStructRoot = !!structRoot && typeof structRoot.get === "function";
  return { marked, hasStructRoot, structRoot };
}

// Walks the structure tree from the root, counting element types and whether
// figures carry /Alt. Bounded by a visited-ref set and a node cap so a malformed
// or cyclic tree can never turn this into a super-linear / infinite walk.
function walkStructTree(lib, pdf, structRoot) {
  const counts = { total: 0, paragraphs: 0, headings: 0, figures: 0, figuresWithAlt: 0, hasKids: false };
  if (!structRoot) return counts;
  const visited = new Set();
  const MAX_NODES = 100000;
  const ctx = pdf.context;
  const S = nameKey(lib, "S");
  const K = nameKey(lib, "K");
  const Alt = nameKey(lib, "Alt");

  const rootKids = structRoot.get(K);
  const stack = collectKidDicts(lib, ctx, rootKids);
  counts.hasKids = stack.length > 0;

  while (stack.length) {
    if (counts.total >= MAX_NODES) break;
    const node = stack.pop();
    if (!node || typeof node.get !== "function") continue;
    const refTag = node === structRoot ? null : nodeIdentity(node);
    if (refTag) {
      if (visited.has(refTag)) continue;
      visited.add(refTag);
    }
    const role = decodeName(node.get(S));
    if (!role) {
      // A grouping node without /S (e.g. StructTreeRoot-like) — descend only.
      for (const child of collectKidDicts(lib, ctx, node.get(K))) stack.push(child);
      continue;
    }
    counts.total += 1;
    if (role === "P") counts.paragraphs += 1;
    else if (role === "H" || HEADING_TAGS.includes(role)) counts.headings += 1;
    else if (role === "Figure") {
      counts.figures += 1;
      if (decodePdfText(node.get(Alt)).trim()) counts.figuresWithAlt += 1;
    }
    for (const child of collectKidDicts(lib, ctx, node.get(K))) stack.push(child);
  }
  return counts;
}

let identityCounter = 0;
const identityMap = new WeakMap();
// A stable identity for a resolved dict node (references are resolved to the
// same object by the context, so object identity de-dupes the walk).
function nodeIdentity(node) {
  let id = identityMap.get(node);
  if (id === undefined) {
    id = `n${(identityCounter += 1)}`;
    identityMap.set(node, id);
  }
  return id;
}

// Returns the child structure-element dicts referenced by a /K value, which may
// be a single ref/dict, an array of them, or plain integers (MCIDs — skipped).
function collectKidDicts(lib, ctx, kids) {
  const out = [];
  if (kids === undefined || kids === null) return out;
  const resolved = ctx.lookup(kids);
  if (resolved instanceof lib.PDFArray) {
    for (let i = 0; i < resolved.size(); i += 1) {
      const child = ctx.lookup(resolved.get(i));
      if (child && typeof child.get === "function") out.push(child);
    }
  } else if (resolved && typeof resolved.get === "function") {
    out.push(resolved);
  }
  return out;
}

function decodeName(value) {
  if (!value) return "";
  if (typeof value.decodeText === "function" && value.constructor && /Name/.test(value.constructor.name)) {
    return value.decodeText();
  }
  const str = String(value);
  return str.startsWith("/") ? str.slice(1) : str;
}

// Counts distinct image XObjects across all pages (dedup by object reference).
// Bounded per page; total work is O(sum of XObject entries), not super-linear.
function countImageXObjects(lib, pdf) {
  const ctx = pdf.context;
  const Resources = nameKey(lib, "Resources");
  const XObject = nameKey(lib, "XObject");
  const Subtype = nameKey(lib, "Subtype");
  const seen = new Set();
  let count = 0;
  for (const page of pdf.getPages()) {
    const resources = ctx.lookup(page.node.get(Resources));
    if (!resources || typeof resources.get !== "function") continue;
    const xobjects = ctx.lookup(resources.get(XObject));
    if (!xobjects || typeof xobjects.entries !== "function") continue;
    for (const [, ref] of xobjects.entries()) {
      const tag = ref && typeof ref.tag === "function" ? ref.tag() : String(ref);
      if (seen.has(tag)) continue;
      seen.add(tag);
      const stream = ctx.lookup(ref);
      if (!stream || typeof stream.dict?.get !== "function") continue;
      if (decodeName(stream.dict.get(Subtype)) === "Image") count += 1;
    }
  }
  return count;
}

// Reads the /Encrypt permissions integer (/P) and the accessibility bit (bit
// position 10, value 512 in the 1-based PDF permission layout). Returns null
// when the file is not encrypted.
function readEncryptionPermissions(lib, pdf) {
  const encRef = pdf.context.trailerInfo.Encrypt;
  const enc = encRef ? pdf.context.lookup(encRef) : undefined;
  if (!enc || typeof enc.get !== "function") return null;
  const pValue = enc.get(nameKey(lib, "P"));
  const p = pValue && typeof pValue.asNumber === "function" ? pValue.asNumber() : Number(String(pValue));
  if (!Number.isFinite(p)) return { accessible: true, permissions: null };
  // Bit 10 (0x200) — "extract text and graphics for accessibility". Set = allowed.
  const accessible = (p & 0x200) !== 0;
  return { accessible, permissions: p };
}

// =============================================================================
// AUDIT
// =============================================================================

/**
 * Audits raw PDF bytes against PDF/UA + WCAG machine-verifiable basics.
 *
 * @param {Uint8Array} bytes
 * @param {object} [options]
 * @param {{characters:number, pageCount:number}} [options.textLayer] Text-layer
 *   summary from pdf.js (browser). When omitted, the extractable-text check is
 *   reported as "not evaluated" rather than guessed.
 * @returns {object} report with checks[], stats, verdict.
 */
export async function auditPdfAccessibility(bytes, options = {}) {
  const lib = getPdfLib();
  const { PDFDocument } = lib;

  let pdf;
  let encrypted = false;
  try {
    pdf = await PDFDocument.load(bytes, { throwOnInvalidObject: false });
  } catch (error) {
    if (/encrypt/i.test(String(error?.message))) {
      encrypted = true;
      pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
    } else {
      throw new Error(`This file could not be read as a PDF. (${String(error?.message || "parse error")})`);
    }
  }
  if (pdf.isEncrypted) encrypted = true;

  const pageCount = pdf.getPageCount();
  const { marked, hasStructRoot, structRoot } = readTagging(lib, pdf);
  const tagged = marked && hasStructRoot;
  const structCounts = walkStructTree(lib, pdf, structRoot);
  const infoTitle = readInfoTitle(lib, pdf);
  const xmpTitle = readXmpTitle(lib, pdf);
  const title = infoTitle || xmpTitle;
  const lang = readLang(lib, pdf);
  const displayDocTitle = readDisplayDocTitle(lib, pdf);
  const imageCount = countImageXObjects(lib, pdf);
  const encryptionPerms = readEncryptionPermissions(lib, pdf);
  const textLayer = options.textLayer && Number.isFinite(options.textLayer.characters) ? options.textLayer : null;

  const checks = [];
  const add = (check) => checks.push(check);

  // 1. Tagged
  add({
    id: "tagged",
    label: "Document is tagged",
    status: tagged ? "pass" : "fail",
    detail: tagged
      ? "The catalog has /MarkInfo << /Marked true >> and a /StructTreeRoot — the document carries a tagged structure tree."
      : !hasStructRoot && !marked
        ? "No /StructTreeRoot and no /MarkInfo /Marked true — the document is not tagged."
        : !hasStructRoot
          ? "/MarkInfo marks the document but there is no /StructTreeRoot, so there is no structure tree."
          : "A /StructTreeRoot exists but /MarkInfo /Marked is not true.",
    fix: tagged ? "" : "Run Make Accessible (Auto-Tag) to add a structure tree and set /MarkInfo /Marked true.",
  });

  // 2. Document title present
  add({
    id: "document-title",
    label: "Document has a title",
    status: title ? "pass" : "fail",
    detail: title
      ? `Title set${infoTitle ? " in Info /Title" : ""}${xmpTitle ? `${infoTitle ? " and" : " in"} XMP dc:title` : ""}: “${title}”.`
      : "No title in Info /Title or XMP dc:title. Assistive technology reads the file name instead of a meaningful title.",
    fix: title ? "" : "Set a document title in Make Accessible (Auto-Tag).",
  });

  // 3. Title shown in the window title bar
  add({
    id: "title-in-titlebar",
    label: "Title shown in the window bar",
    status: title && displayDocTitle ? "pass" : title ? "warn" : "fail",
    detail: displayDocTitle
      ? "/ViewerPreferences /DisplayDocTitle is true — viewers show the document title, not the file name."
      : "/ViewerPreferences /DisplayDocTitle is not true — viewers show the file name in the window bar instead of the title.",
    fix: displayDocTitle ? "" : "Auto-Tag sets /ViewerPreferences /DisplayDocTitle true.",
  });

  // 4. Language
  add({
    id: "language",
    label: "Document language is set",
    status: lang ? "pass" : "fail",
    detail: lang
      ? `Catalog /Lang is “${lang}” — screen readers know which language to pronounce.`
      : "No catalog /Lang. Screen readers cannot pick the right pronunciation rules.",
    fix: lang ? "" : "Set the document language in Make Accessible (Auto-Tag).",
  });

  // 5. Images have alt text
  const missingAlt = tagged ? Math.max(0, structCounts.figures - structCounts.figuresWithAlt) : imageCount;
  add({
    id: "image-alt",
    label: "Images have alternative text",
    status:
      imageCount === 0 && structCounts.figures === 0
        ? "pass"
        : tagged
          ? missingAlt === 0
            ? "pass"
            : "fail"
          : "fail",
    detail:
      imageCount === 0 && structCounts.figures === 0
        ? "No image XObjects were found, so no alternative text is required."
        : tagged
          ? missingAlt === 0
            ? `All ${structCounts.figures} figure tag(s) carry /Alt alternative text.`
            : `${missingAlt} of ${structCounts.figures || imageCount} figure(s)/image(s) have no /Alt alternative text.`
          : `${imageCount} image(s) found, but the document is not tagged, so none can carry /Alt alternative text.`,
    fix: (imageCount === 0 && structCounts.figures === 0) || (tagged && missingAlt === 0)
      ? ""
      : "In Make Accessible (Auto-Tag), type alt text for each image (or mark purely decorative ones as artifacts).",
    note: "An automated tool cannot judge whether alt text is meaningful — that needs a human.",
  });

  // 6. Extractable text (needs the pdf.js text layer)
  if (textLayer) {
    const scanned = textLayer.characters < 8 && imageCount > 0;
    add({
      id: "extractable-text",
      label: "Text is extractable (not a scan)",
      status: scanned ? "fail" : textLayer.characters > 0 ? "pass" : "warn",
      detail: scanned
        ? "Almost no extractable text but image(s) are present — this looks like a scanned, image-only PDF. Screen readers get nothing to read."
        : textLayer.characters > 0
          ? `About ${textLayer.characters} extractable character(s) across ${textLayer.pageCount} page(s).`
          : "No extractable text found and no images either — the document may be empty.",
      fix: scanned ? "Run OCR / Searchable PDF first to add a real text layer, then tag the result." : "",
    });
  } else {
    add({
      id: "extractable-text",
      label: "Text is extractable (not a scan)",
      status: "info",
      detail: "Not evaluated here — the extractable-text check runs in the browser using the PDF renderer.",
      fix: "",
    });
  }

  // 7. Encryption does not block accessibility
  add({
    id: "encryption-accessibility",
    label: "Encryption allows accessibility",
    status: !encrypted ? "pass" : encryptionPerms && encryptionPerms.accessible === false ? "fail" : "warn",
    detail: !encrypted
      ? "The document is not encrypted — nothing blocks text extraction for assistive technology."
      : encryptionPerms && encryptionPerms.accessible === false
        ? "The document is encrypted and the accessibility permission bit is cleared — assistive technology is blocked from extracting the content."
        : "The document is encrypted. Encryption can interfere with assistive technology even when the accessibility bit is set.",
    fix: encrypted ? "Remove the password (use Remove Password) before tagging and distributing." : "",
  });

  // 8. Reading order present
  add({
    id: "reading-order",
    label: "Reading order is defined",
    status: tagged && structCounts.hasKids ? "pass" : "fail",
    detail: tagged && structCounts.hasKids
      ? `The structure tree defines an ordered sequence of ${structCounts.total} element(s) — that is the reading order for assistive technology.`
      : tagged
        ? "The structure tree has no content elements, so there is no reading order to follow."
        : "Without a tagged structure tree there is no defined reading order — assistive technology guesses from page geometry.",
    fix: tagged && structCounts.hasKids ? "" : "Auto-Tag builds a reading-order structure tree from the text layout.",
    note: "Whether the reading order is logically correct still needs a human to confirm.",
  });

  // 9. Heading structure
  add({
    id: "headings",
    label: "Heading structure present",
    status: structCounts.headings > 0 ? "pass" : "warn",
    detail: structCounts.headings > 0
      ? `${structCounts.headings} heading element(s) (H1–H6) give the document a navigable outline.`
      : tagged
        ? "The structure tree has no heading elements — long documents are hard to navigate without headings."
        : "No headings, because the document is not tagged.",
    fix: structCounts.headings > 0 ? "" : "Auto-Tag detects large/bold text runs as headings, but confirm the levels by hand.",
  });

  const summary = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const check of checks) summary[check.status] += 1;

  const verdict = buildVerdict({ tagged, summary, title, lang });

  return {
    checks,
    summary,
    verdict,
    stats: {
      pageCount,
      tagged,
      marked,
      hasStructRoot,
      imageCount,
      figures: structCounts.figures,
      figuresWithAlt: structCounts.figuresWithAlt,
      headings: structCounts.headings,
      paragraphs: structCounts.paragraphs,
      structElements: structCounts.total,
      title,
      infoTitle,
      xmpTitle,
      lang,
      displayDocTitle,
      encrypted,
      encryptionAccessible: encryptionPerms ? encryptionPerms.accessible : true,
      textLayerEvaluated: !!textLayer,
    },
  };
}

function buildVerdict({ tagged, summary }) {
  if (!tagged) {
    return {
      level: "fail",
      headline: "Not tagged — fails PDF/UA",
      summary: `This document has no tagged structure tree, so it cannot meet PDF/UA. ${summary.fail} check(s) fail and ${summary.warn} need attention. Run Make Accessible (Auto-Tag) to fix the machine-fixable basics.`,
    };
  }
  if (summary.fail > 0) {
    return {
      level: "warn",
      headline: `Tagged, ${summary.fail} issue(s) to fix`,
      summary: `The document is tagged, but ${summary.fail} check(s) still fail and ${summary.warn} need attention. Fix these, then confirm reading order and alt-text quality by hand.`,
    };
  }
  return {
    level: summary.warn > 0 ? "warn" : "pass",
    headline: summary.warn > 0 ? "Tagged — minor items to review" : "Passes automated checks",
    summary: `All automated failures are clear${summary.warn > 0 ? `, with ${summary.warn} item(s) to review` : ""}. This does not certify PDF/UA: colour contrast, meaningful alt text, and logical reading order still need a manual audit.`,
  };
}

const STATUS_LABEL = { pass: "PASS", warn: "WARN", fail: "FAIL", info: "INFO" };

/** Renders an audit report as a downloadable plain-text report. Pure. */
export function buildAccessibilityReportText(report, { fileName = "document.pdf" } = {}) {
  const lines = [];
  lines.push("PDF ACCESSIBILITY CHECK");
  lines.push("=======================");
  lines.push(`File:    ${fileName}`);
  lines.push(`Date:    ${new Date().toISOString()}`);
  lines.push(`Pages:   ${report.stats.pageCount}`);
  lines.push("");
  lines.push(`VERDICT: ${report.verdict.headline}`);
  lines.push(wrapIndent(report.verdict.summary, ""));
  lines.push("");
  lines.push(`Summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail, ${report.summary.info} info`);
  lines.push("");
  lines.push("CHECKS");
  lines.push("------");
  for (const check of report.checks) {
    lines.push(`[${STATUS_LABEL[check.status]}] ${check.label}`);
    if (check.detail) lines.push(wrapIndent(check.detail, "    "));
    if (check.fix) lines.push(wrapIndent(`Fix: ${check.fix}`, "    "));
    if (check.note) lines.push(wrapIndent(`Note: ${check.note}`, "    "));
    lines.push("");
  }
  lines.push("LIMITS OF THIS AUTOMATED CHECK");
  lines.push("------------------------------");
  lines.push(wrapIndent(
    "This is an automated check of machine-verifiable criteria (tagging, title, language, alt-text presence, encryption permissions, structure/reading-order presence, headings). It does NOT replace a manual audit. Colour contrast of rendered content, whether alt text is actually meaningful, and whether the reading order is logically correct all require human judgement. Passing every automated check is necessary but not sufficient for PDF/UA or WCAG conformance.",
    "",
  ));
  return lines.join("\n");
}

function wrapIndent(text, indent) {
  const width = 78 - indent.length;
  const words = String(text).split(/\s+/);
  const out = [];
  let line = "";
  for (const word of words) {
    if (line && (line.length + 1 + word.length) > width) {
      out.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(indent + line);
  return out.join("\n");
}

// =============================================================================
// REMEDIATION (Auto-Tag)
// =============================================================================

// Builds a minimal XMP packet carrying dc:title and dc:language. Deliberately
// does NOT assert a pdfuaid conformance identifier — we do not claim certified
// PDF/UA conformance. Pure.
function buildAccessibilityXmp({ title = "", lang = "", date = new Date() }) {
  const iso = date.toISOString().replace(/\.\d+Z$/, "Z");
  const esc = (v) => String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(title)}</rdf:li></rdf:Alt></dc:title>
   <dc:language><rdf:Bag><rdf:li>${esc(lang)}</rdf:li></rdf:Bag></dc:language>
   <xmp:CreatorTool>MyFileKit Accessibility</xmp:CreatorTool>
   <xmp:ModifyDate>${iso}</xmp:ModifyDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Remediates raw PDF bytes toward PDF/UA as far as is reliably automatable.
 *
 * Sets catalog /Lang, Info /Title + XMP dc:title (UTF-16BE so non-Latin titles
 * survive), /ViewerPreferences /DisplayDocTitle true, /MarkInfo /Marked true,
 * and builds a basic real tagged structure tree: a /Document root whose ordered
 * /K kids are /P and /H heading elements (one per text block, in reading order)
 * plus /Figure elements carrying /Alt. Text blocks are additionally re-drawn as
 * an INVISIBLE (text-render-mode 3) marked-content layer wired to the structure
 * elements' MCIDs, so the tags genuinely cover screen-reader-readable content.
 * Decorative images are wrapped as /Artifact marked content and left out of the
 * structure tree. Non-Latin text that the standard font cannot draw still gets a
 * structure element with /ActualText (UTF-16BE) so the text remains available.
 *
 * @param {Uint8Array} bytes
 * @param {object} params
 * @param {string} params.lang         BCP-47 language tag (default "en-US").
 * @param {string} params.title        Document title.
 * @param {Array}  [params.textBlocks] [{page,text,x,y,fontSize,heading}] in PDF
 *                                      user space (origin bottom-left, y=baseline).
 *                                      `heading` 0 = paragraph, 1..6 = H1..H6.
 * @param {Array}  [params.figures]    [{page,alt,decorative,x,y,width,height}].
 * @returns {Promise<{bytes:Uint8Array, report:object}>}
 */
export async function remediatePdfAccessibility(bytes, params = {}) {
  const lib = getPdfLib();
  const {
    PDFDocument, PDFName, PDFNumber, PDFString, PDFHexString, PDFBool, PDFArray, StandardFonts,
    PDFOperator, PDFOperatorNames, beginText, endText, showText, setFontAndSize, setTextRenderingMode, setTextMatrix, endMarkedContent,
  } = lib;

  const lang = String(params.lang || "en-US").trim() || "en-US";
  const title = String(params.title ?? "").trim();
  const textBlocks = Array.isArray(params.textBlocks) ? params.textBlocks : [];
  const figures = Array.isArray(params.figures) ? params.figures : [];
  const date = params.date instanceof Date ? params.date : new Date();

  let pdf;
  try {
    pdf = await PDFDocument.load(bytes, { throwOnInvalidObject: false });
  } catch (error) {
    if (/encrypt/i.test(String(error?.message))) {
      throw new Error("This PDF is encrypted. Remove the password first (use Remove Password), then make it accessible.");
    }
    throw new Error(`This file could not be read as a PDF. (${String(error?.message || "parse error")})`);
  }
  if (pdf.isEncrypted) {
    throw new Error("This PDF is encrypted. Remove the password first (use Remove Password), then make it accessible.");
  }

  const ctx = pdf.context;
  const catalog = pdf.catalog;
  const pages = pdf.getPages();
  const pageCount = pages.length;
  const applied = [];
  const review = [];
  const N = (k) => PDFName.of(k);

  // --- 1. Language ----------------------------------------------------------
  catalog.set(N("Lang"), PDFString.of(lang));
  applied.push(`document language /Lang = ${lang}`);

  // --- 2. Title (Info /Title as UTF-16BE) -----------------------------------
  let infoDict = pdf.context.trailerInfo.Info ? ctx.lookup(pdf.context.trailerInfo.Info) : undefined;
  if (!infoDict || typeof infoDict.set !== "function") {
    infoDict = ctx.obj({});
    pdf.context.trailerInfo.Info = ctx.register(infoDict);
  }
  if (title) {
    infoDict.set(N("Title"), PDFHexString.fromText(title));
    applied.push("document title (Info /Title, UTF-16BE)");
  } else {
    review.push("No title was provided — set a meaningful document title.");
  }

  // --- 3. ViewerPreferences /DisplayDocTitle true ---------------------------
  let vp = ctx.lookup(catalog.get(N("ViewerPreferences")));
  if (!vp || typeof vp.set !== "function") {
    vp = ctx.obj({});
    catalog.set(N("ViewerPreferences"), ctx.register(vp));
  }
  vp.set(N("DisplayDocTitle"), PDFBool.True);
  applied.push("/ViewerPreferences /DisplayDocTitle true");

  // --- 4. MarkInfo /Marked true ---------------------------------------------
  const markInfo = ctx.obj({});
  markInfo.set(N("Marked"), PDFBool.True);
  catalog.set(N("MarkInfo"), ctx.register(markInfo));
  applied.push("/MarkInfo << /Marked true >>");

  // --- 5. XMP dc:title + dc:language ----------------------------------------
  const existingMeta = catalog.get(N("Metadata"));
  if (existingMeta) {
    try { ctx.delete(existingMeta); } catch { /* direct value */ }
  }
  const xmp = buildAccessibilityXmp({ title, lang, date });
  const metaStream = ctx.stream(xmp, { Type: N("Metadata"), Subtype: N("XML") });
  catalog.set(N("Metadata"), ctx.register(metaStream));
  applied.push("XMP dc:title + dc:language");

  // --- 6. Structure tree ----------------------------------------------------
  const structTreeRoot = ctx.obj({ Type: N("StructTreeRoot") });
  const structTreeRef = ctx.register(structTreeRoot);
  const documentEl = ctx.obj({ Type: N("StructElem"), S: N("Document"), P: structTreeRef });
  const documentRef = ctx.register(documentEl);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pageFontKeys = new Map(); // pageIndex -> registered font resource key
  const fontKeyFor = (pageIndex) => {
    if (pageFontKeys.has(pageIndex)) return pageFontKeys.get(pageIndex);
    const key = pages[pageIndex].node.newFontDictionary("MFKAccess", font.ref);
    const keyName = key instanceof PDFName ? key : PDFName.of(String(key).replace(/^\//, ""));
    pageFontKeys.set(pageIndex, keyName);
    return keyName;
  };

  const documentKids = [];
  // Per page: MCID counter + parent-array (index = MCID) for the ParentTree.
  const mcidCounters = new Array(pageCount).fill(0);
  const parentArrays = Array.from({ length: pageCount }, () => []);

  const clampPage = (p) => {
    const idx = Math.floor(Number(p) || 1) - 1;
    return Math.min(Math.max(idx, 0), pageCount - 1);
  };

  // Group text blocks by page, preserving caller reading order within a page.
  const blocksByPage = Array.from({ length: pageCount }, () => []);
  for (const block of textBlocks) {
    if (!block || typeof block !== "object") continue;
    blocksByPage[clampPage(block.page)].push(block);
  }
  const figuresByPage = Array.from({ length: pageCount }, () => []);
  for (const figure of figures) {
    if (!figure || typeof figure !== "object") continue;
    figuresByPage[clampPage(figure.page)].push(figure);
  }

  let paragraphs = 0;
  let headings = 0;
  let taggedFigures = 0;
  let artifacts = 0;
  let undrawable = 0;

  for (let pi = 0; pi < pageCount; pi += 1) {
    const page = pages[pi];
    const pageRef = page.ref;

    for (const block of blocksByPage[pi]) {
      const text = String(block.text ?? "");
      if (!text.trim()) continue;
      const level = Math.floor(Number(block.heading) || 0);
      const tag = level >= 1 && level <= 6 ? `H${level}` : "P";
      if (tag === "P") paragraphs += 1; else headings += 1;

      const mcid = mcidCounters[pi];
      const el = ctx.obj({ Type: N("StructElem"), S: N(tag), P: documentRef, Pg: pageRef });
      // /ActualText carries the text (UTF-16BE) so it survives even if the glyph
      // layer cannot be drawn (non-Latin) and helps AT extract the exact string.
      el.set(N("ActualText"), PDFHexString.fromText(text));
      el.set(N("K"), PDFNumber.of(mcid));
      const elRef = ctx.register(el);
      documentKids.push(elRef);
      parentArrays[pi][mcid] = elRef;
      mcidCounters[pi] += 1;

      // Invisible marked-content text layer wired to this MCID. Guarded: the
      // standard font is Latin-1 only, so non-Latin text is left to /ActualText.
      const size = Number(block.fontSize) > 0 ? Number(block.fontSize) : 12;
      const x = Number.isFinite(Number(block.x)) ? Number(block.x) : 0;
      const y = Number.isFinite(Number(block.y)) ? Number(block.y) : 0;
      let encoded;
      try {
        encoded = font.encodeText(text);
      } catch {
        encoded = null;
        undrawable += 1;
      }
      const mcDict = ctx.obj({ MCID: mcid });
      const ops = [PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [N(tag), mcDict])];
      if (encoded) {
        ops.push(
          beginText(),
          setTextRenderingMode(3),
          setFontAndSize(fontKeyFor(pi), size),
          setTextMatrix(1, 0, 0, 1, x, y),
          showText(encoded),
          endText(),
        );
      }
      ops.push(endMarkedContent());
      page.pushOperators(...ops);
    }

    for (const figure of figuresByPage[pi]) {
      const alt = String(figure.alt ?? "").trim();
      const decorative = figure.decorative === true || (!alt && figure.decorative !== false);
      if (decorative) {
        // Decorative image: wrap an /Artifact marked-content region (excluded
        // from the structure tree) so assistive technology skips it.
        artifacts += 1;
        page.pushOperators(
          PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [N("Artifact"), ctx.obj({ Type: N("Layout") })]),
          endMarkedContent(),
        );
        continue;
      }
      taggedFigures += 1;
      const mcid = mcidCounters[pi];
      const figEl = ctx.obj({ Type: N("StructElem"), S: N("Figure"), P: documentRef, Pg: pageRef });
      figEl.set(N("Alt"), PDFHexString.fromText(alt));
      figEl.set(N("K"), PDFNumber.of(mcid));
      const figRef = ctx.register(figEl);
      documentKids.push(figRef);
      parentArrays[pi][mcid] = figRef;
      mcidCounters[pi] += 1;
      page.pushOperators(
        PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [N("Figure"), ctx.obj({ MCID: mcid })]),
        endMarkedContent(),
      );
    }

    // Wire the page into the structure parent tree.
    page.node.set(N("StructParents"), PDFNumber.of(pi));
    page.node.set(N("Tabs"), N("S"));
  }

  // Document /K = ordered array of all block/figure elements.
  const kidsArray = PDFArray.withContext(ctx);
  for (const ref of documentKids) kidsArray.push(ref);
  documentEl.set(N("K"), kidsArray);
  structTreeRoot.set(N("K"), documentRef);

  // ParentTree: number tree mapping each page's /StructParents index to the
  // array of parent structure elements ordered by MCID.
  const nums = PDFArray.withContext(ctx);
  for (let pi = 0; pi < pageCount; pi += 1) {
    const arr = PDFArray.withContext(ctx);
    for (const ref of parentArrays[pi]) arr.push(ref);
    nums.push(PDFNumber.of(pi));
    nums.push(ctx.register(arr));
  }
  const parentTree = ctx.obj({});
  parentTree.set(N("Nums"), nums);
  structTreeRoot.set(N("ParentTree"), ctx.register(parentTree));
  structTreeRoot.set(N("ParentTreeNextKey"), PDFNumber.of(pageCount));
  catalog.set(N("StructTreeRoot"), structTreeRef);

  applied.push(`tagged structure tree (/Document root with ${paragraphs} paragraph, ${headings} heading, ${taggedFigures} figure element(s))`);
  if (artifacts) applied.push(`${artifacts} decorative image(s) marked as /Artifact`);
  if (undrawable) review.push(`${undrawable} text block(s) use characters the standard font cannot draw; their text is preserved as /ActualText but not as a visible glyph layer.`);

  review.push("Reading order was inferred from text position (top-to-bottom, left-to-right). Confirm it is logically correct for multi-column, table, or form layouts.");
  review.push("Heading levels were guessed from text size/weight. Confirm the H1–H6 outline by hand.");
  if (taggedFigures) review.push("Confirm each image's alt text actually describes the image's meaning.");

  const outBytes = await pdf.save({ updateMetadata: false });
  return {
    bytes: outBytes,
    report: {
      applied,
      review,
      structSummary: { paragraphs, headings, figures: taggedFigures, artifacts, pageCount },
      lang,
      title,
    },
  };
}

// =============================================================================
// BROWSER-ONLY: text-layer + figure extraction via pdf.js
// =============================================================================
//
// Uses the pdf.js renderer to read positioned text items and image operators —
// layout information a pure object-model read cannot produce. Not Node-testable;
// exercised in the app. Returns { textBlocks, figures, textLayer } ready to hand
// to remediatePdfAccessibility / auditPdfAccessibility.

/**
 * @param {File|ArrayBuffer|Uint8Array} source
 * @param {(page:number,total:number)=>void} [onProgress]
 */
export async function extractAccessibilityContent(source, onProgress) {
  const { loadPdfDocument } = await import("../lib/pdfjs");
  const doc = await loadPdfDocument(source);
  const pageCount = doc.numPages;
  const textBlocks = [];
  const figures = [];
  let characters = 0;

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    onProgress?.(pageNumber, pageCount);
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const pageHeight = viewport.height;

    // Text items with positions. pdf.js transform is [a,b,c,d,e,f]; e,f are the
    // text origin in a top-left-ish device space at scale 1 — convert f to a
    // PDF bottom-left baseline y.
    const content = await page.getTextContent();
    const rawItems = [];
    for (const item of content.items) {
      const str = typeof item.str === "string" ? item.str : "";
      if (!str) continue;
      characters += str.length;
      const tr = item.transform || [1, 0, 0, 1, 0, 0];
      const x = tr[4];
      const yTop = tr[5];
      const fontSize = Math.hypot(tr[2], tr[3]) || Math.abs(tr[3]) || 12;
      rawItems.push({
        str,
        x,
        y: yTop, // pdf.js text transform f is already in PDF user space (bottom-left)
        fontSize,
        width: item.width || 0,
        hasEOL: item.hasEOL === true,
      });
    }

    const blocks = groupTextItemsIntoBlocks(rawItems);
    // Heading heuristic: a block whose font size is clearly above the page's
    // median body size becomes a heading; the two largest tiers map to H1/H2.
    assignHeadingLevels(blocks);
    for (const block of blocks) {
      textBlocks.push({
        page: pageNumber,
        text: block.text,
        x: block.x,
        y: block.y,
        fontSize: block.fontSize,
        heading: block.heading,
      });
    }

    // Image operators → figure regions.
    try {
      const opList = await page.getOperatorList();
      const OPS = (await import("pdfjs-dist")).OPS;
      let imageIndex = 0;
      for (let i = 0; i < opList.fnArray.length; i += 1) {
        const fn = opList.fnArray[i];
        if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintInlineImageXObject) {
          imageIndex += 1;
          figures.push({ page: pageNumber, id: `Page ${pageNumber}, image ${imageIndex}`, alt: "", decorative: false });
        }
      }
    } catch {
      /* operator list unavailable — figures simply not listed for this page */
    }
    page.cleanup();
  }

  return { textBlocks, figures, textLayer: { characters, pageCount }, pageCount };
}

// Groups positioned text items into paragraph-ish blocks by line proximity.
// A new block starts when the vertical gap to the previous line exceeds ~1.6×
// the running font size (a paragraph break) or the font size changes sharply
// (a heading). Bounded single pass over pre-sorted items — no super-linear work.
function groupTextItemsIntoBlocks(items) {
  if (!items.length) return [];
  // Reading order: top-to-bottom (descending y), then left-to-right.
  const sorted = items.slice().sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));
  const blocks = [];
  let current = null;
  let prevY = null;
  for (const item of sorted) {
    const size = item.fontSize || 12;
    const bigGap = prevY !== null && Math.abs(prevY - item.y) > size * 1.6;
    const sizeShift = current && Math.abs((current.fontSize || 12) - size) > Math.max(1.5, size * 0.25);
    if (!current || bigGap || sizeShift) {
      current = { text: item.str, x: item.x, y: item.y, fontSize: size, maxSize: size };
      blocks.push(current);
    } else {
      current.text += (current.text.endsWith(" ") || item.str.startsWith(" ") ? "" : " ") + item.str;
      current.maxSize = Math.max(current.maxSize, size);
    }
    prevY = item.y;
  }
  return blocks;
}

function assignHeadingLevels(blocks) {
  if (!blocks.length) return;
  const sizes = blocks.map((b) => b.fontSize).slice().sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] || 12;
  // Distinct sizes clearly above the body median, largest first, map to H1..H3.
  const bigSizes = [...new Set(blocks.map((b) => Math.round(b.fontSize)).filter((s) => s > median * 1.15))].sort((a, b) => b - a);
  for (const block of blocks) {
    const rounded = Math.round(block.fontSize);
    const tier = bigSizes.indexOf(rounded);
    block.heading = tier >= 0 && tier < 6 ? tier + 1 : 0;
  }
}
