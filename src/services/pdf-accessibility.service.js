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
// Reuse pdf-reflow's layout analysis rather than re-deriving it: detectColumnLayout
// flags table-like / multi-column pages, parseParagraphs turns raw pdf.js items
// into paragraph/heading/list-item blocks (with the list marker split out), and
// LIST_MARKER is the exact marker regex used to group /L > /LI > /Lbl + /LBody.
import { detectColumnLayout, parseParagraphs, LIST_MARKER } from "./pdf-reflow.service.js";
// Shared BCP-47 validation — the single source of truth also used by the PDF/A
// archival prep (pdf-review.service.js), so both services reject the same unsafe
// /Lang values identically.
import { safeLangTag as safeLangTagShared } from "../utils/bcp47.js";

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

// Every structure type this tagger emits. All are standard PDF 1.7 structure
// types (§14.8.4), so the /RoleMap we write maps each to itself — a harmless,
// spec-valid identity map that satisfies validators expecting custom types to be
// mapped, and gives the checker a concrete /RoleMap to verify.
const EMITTED_ROLES = [
  "Document", "H1", "H2", "H3", "H4", "H5", "H6", "P",
  "L", "LI", "Lbl", "LBody", "Table", "TR", "TH", "TD", "Figure", "Link",
];

const LANGUAGE_CODES = new Set(LANGUAGE_OPTIONS.map((option) => option.code));

// Validates a caller-supplied language tag. The UI dropdown only offers
// LANGUAGE_OPTIONS, but the public API (window.MyFileKit.pdf.accessibility.tag)
// forwards an arbitrary string here; a value like
//   'en) >> /OpenAction << /S /JavaScript /JS(…) >>'
// must never reach the catalog as literal syntax. Accepts a known option or a
// BCP-47-shaped tag; falls back to a safe default otherwise. (Belt-and-suspenders:
// the value is additionally written as a hex string, so even a slipped value can
// not break the dictionary.) Delegates the shape check to the shared validator so
// this service and the PDF/A archival prep stay in lock-step.
function safeLangTag(raw, fallback = "en") {
  return safeLangTagShared(raw, fallback, LANGUAGE_CODES);
}

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

// Walks the structure tree from the root, counting element types and gathering
// the conformance-oriented facts the checker reports: figures carrying /Alt,
// list structure (/L>/LI>/Lbl+/LBody), table structure (/Table>/TR>/TH|/TD with
// /Scope), tagged links (/Link carrying an /OBJR), and the heading-level sequence
// (for skipped-level detection). Bounded by a visited-ref set and a node cap so a
// malformed or cyclic tree can never turn this into a super-linear / infinite walk.
function walkStructTree(lib, pdf, structRoot) {
  const counts = {
    total: 0, paragraphs: 0, headings: 0, figures: 0, figuresWithAlt: 0, hasKids: false,
    lists: 0, listItems: 0, listItemsWithBody: 0,
    tables: 0, tableRows: 0, th: 0, td: 0, thWithScope: 0, tablesWithHeader: 0,
    links: 0, linksWithObjr: 0, headingLevels: [],
  };
  if (!structRoot) return counts;
  const visited = new Set();
  const MAX_NODES = 100000;
  const ctx = pdf.context;
  const S = nameKey(lib, "S");
  const K = nameKey(lib, "K");
  const Alt = nameKey(lib, "Alt");
  const Scope = nameKey(lib, "Scope");
  const Type = nameKey(lib, "Type");

  // True if a node's /K contains a direct object-reference dict (/Type /OBJR).
  const hasObjrChild = (node) => {
    const kids = node.get(K);
    const resolved = kids ? ctx.lookup(kids) : undefined;
    const check = (dict) => dict && typeof dict.get === "function" && decodeName(dict.get(Type)) === "OBJR";
    if (resolved instanceof lib.PDFArray) {
      for (let i = 0; i < resolved.size(); i += 1) {
        const item = ctx.lookup(resolved.get(i));
        if (check(item)) return true;
      }
      return false;
    }
    return check(resolved);
  };
  // True if a node has a child structure element of type /LBody.
  const hasBodyChild = (node) => {
    for (const child of collectKidDicts(lib, ctx, node.get(K))) {
      if (decodeName(child.get(S)) === "LBody") return true;
    }
    return false;
  };

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
      // Push kids reversed so the LIFO stack pops them in document order (which
      // the heading-level sequence relies on for skip detection).
      for (const child of collectKidDicts(lib, ctx, node.get(K)).reverse()) stack.push(child);
      continue;
    }
    counts.total += 1;
    if (role === "P") counts.paragraphs += 1;
    else if (role === "H" || HEADING_TAGS.includes(role)) {
      counts.headings += 1;
      counts.headingLevels.push(role === "H" ? null : Number(role.slice(1)));
    } else if (role === "Figure") {
      counts.figures += 1;
      if (decodePdfText(node.get(Alt)).trim()) counts.figuresWithAlt += 1;
    } else if (role === "L") counts.lists += 1;
    else if (role === "LI") {
      counts.listItems += 1;
      if (hasBodyChild(node)) counts.listItemsWithBody += 1;
    } else if (role === "Table") {
      counts.tables += 1;
      if (tableHasHeaderCell(lib, ctx, node)) counts.tablesWithHeader += 1;
    } else if (role === "TR") counts.tableRows += 1;
    else if (role === "TH") {
      counts.th += 1;
      if (node.get(Scope)) counts.thWithScope += 1;
    } else if (role === "TD") counts.td += 1;
    else if (role === "Link") {
      counts.links += 1;
      if (hasObjrChild(node)) counts.linksWithObjr += 1;
    }
    for (const child of collectKidDicts(lib, ctx, node.get(K)).reverse()) stack.push(child);
  }
  return counts;
}

// True if a /Table element has at least one /TH descendant (bounded local walk).
function tableHasHeaderCell(lib, ctx, tableNode) {
  const S = nameKey(lib, "S");
  const K = nameKey(lib, "K");
  const stack = collectKidDicts(lib, ctx, tableNode.get(K));
  let seen = 0;
  while (stack.length && seen < 5000) {
    const node = stack.pop();
    seen += 1;
    if (!node || typeof node.get !== "function") continue;
    if (decodeName(node.get(S)) === "TH") return true;
    for (const child of collectKidDicts(lib, ctx, node.get(K))) stack.push(child);
  }
  return false;
}

// Detects the first skipped heading level in encounter order (e.g. H1 -> H3).
// Returns { skipped:true, from, to } or { skipped:false }. Untyped /H entries
// (level unknown) break the run without being treated as a skip.
function findHeadingSkip(levels) {
  let prev = 0;
  for (const level of levels) {
    if (!Number.isFinite(level)) { prev = 0; continue; }
    if (prev && level > prev + 1) return { skipped: true, from: prev, to: level };
    prev = level;
  }
  return { skipped: false };
}

// Counts /Link annotations across pages (dedup by object reference), so the
// checker can tell whether links exist that ought to be tagged. Bounded per page.
function countLinkAnnots(lib, pdf) {
  const ctx = pdf.context;
  const Annots = nameKey(lib, "Annots");
  const Subtype = nameKey(lib, "Subtype");
  const seen = new Set();
  let count = 0;
  for (const page of pdf.getPages()) {
    const annots = ctx.lookup(page.node.get(Annots));
    if (!(annots instanceof lib.PDFArray)) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const ref = annots.get(i);
      const tag = ref && typeof ref.tag === "function" ? ref.tag() : String(ref);
      if (seen.has(tag)) continue;
      seen.add(tag);
      const annot = ctx.lookup(ref);
      if (annot && typeof annot.get === "function" && decodeName(annot.get(Subtype)) === "Link") count += 1;
    }
  }
  return count;
}

// Scans page content streams for an /Artifact marked-content operator, so the
// checker can report whether running content (headers/footers/page numbers) is
// artifacted. Bounded: at most FIRST_PAGES pages and MAX_BYTES decoded, so a huge
// document can never make this super-linear. Returns true on the first hit.
function hasArtifactMarks(lib, pdf) {
  const ctx = pdf.context;
  const Contents = nameKey(lib, "Contents");
  const decode = lib.decodePDFRawStream;
  if (typeof decode !== "function") return false;
  const FIRST_PAGES = 50;
  const MAX_BYTES = 5_000_000;
  let budget = MAX_BYTES;
  const pages = pdf.getPages();
  const limit = Math.min(pages.length, FIRST_PAGES);
  for (let pi = 0; pi < limit && budget > 0; pi += 1) {
    const contents = pages[pi].node.get(Contents);
    const resolved = contents ? ctx.lookup(contents) : undefined;
    const refs = resolved instanceof lib.PDFArray ? resolved.asArray() : contents ? [contents] : [];
    for (const ref of refs) {
      if (budget <= 0) break;
      const stream = ctx.lookup(ref);
      if (!stream) continue;
      let text = "";
      try { text = new TextDecoder().decode(decode(stream).decode()); } catch { continue; }
      budget -= text.length;
      if (/\/Artifact\b/.test(text)) return true;
    }
  }
  return false;
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
 * @param {{characters:number, pageCount:number, text?:string}} [options.textLayer] Text-layer
 *   summary from pdf.js (browser). When omitted, the extractable-text check is
 *   reported as "not evaluated" rather than guessed.
 * @returns {object} report with checks[], stats, verdict.
 */

/**
 * Fraction of substantial lines that appear more than once.
 *
 * A remediation that draws a tagged copy of the text over the original leaves
 * every string in the file twice. The checker graded such a file 12 pass /
 * 0 fail, because nothing looked for it — the tool that produces the defect and
 * the tool that certifies the result were both blind to the same thing, which
 * is the failure mode this project keeps hitting.
 */
export function duplicateTextRatio(text) {
  const lines = String(text || "")
    .split(/\r?\n|(?<=[.:;])\s{2,}/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8);
  if (lines.length < 4) return 0;
  const seen = new Map();
  for (const line of lines) seen.set(line, (seen.get(line) || 0) + 1);
  let repeated = 0;
  for (const [, n] of seen) if (n > 1) repeated += n;
  return repeated / lines.length;
}

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
  const hasRoleMap = !!(structRoot && typeof structRoot.get === "function" && structRoot.get(nameKey(lib, "RoleMap")));
  const linkAnnots = countLinkAnnots(lib, pdf);
  const artifacted = tagged ? hasArtifactMarks(lib, pdf) : false;
  const headingSkip = findHeadingSkip(structCounts.headingLevels);

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
  // Every string present twice: a tagged copy drawn over untagged original.
  if (textLayer && typeof textLayer.text === "string") {
    const ratio = duplicateTextRatio(textLayer.text);
    const duplicated = ratio >= 0.6;
    add({
      id: "duplicate-text",
      label: "Text appears once",
      status: duplicated ? "fail" : "pass",
      detail: duplicated
        ? `About ${Math.round(ratio * 100)}% of the text appears more than once. A screen reader will read the document twice, and any sensitive value is stored twice in the file.`
        : "No duplicated text layer detected.",
      fix: duplicated
        ? "This usually means a tagged text layer was drawn over content that is still unmarked. Re-run Make Accessible on the ORIGINAL file rather than on an already-tagged copy."
        : "",
    });
  }

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

  // 10. Heading levels do not skip (H1 -> H3 with no H2)
  add({
    id: "heading-nesting",
    label: "Heading levels are not skipped",
    status: !tagged ? "fail" : structCounts.headings === 0 ? "info" : headingSkip.skipped ? "fail" : "pass",
    detail: !tagged
      ? "The document is not tagged, so there is no heading hierarchy to check."
      : structCounts.headings === 0
        ? "No heading elements, so there is no hierarchy to check."
        : headingSkip.skipped
          ? `The outline jumps from H${headingSkip.from} straight to H${headingSkip.to}, skipping H${headingSkip.from + 1}. PDF/UA requires headings to descend one level at a time.`
          : "Heading levels descend without skipping — the outline is well nested.",
    fix: headingSkip.skipped ? `Insert an H${headingSkip.from + 1} or lower the H${headingSkip.to} so no level is skipped.` : "",
  });

  // 11. Lists use L / LI / Lbl / LBody structure
  add({
    id: "lists-structured",
    label: "Lists use list structure",
    status: !tagged ? "fail" : structCounts.lists === 0 ? "pass" : structCounts.listItemsWithBody === structCounts.listItems ? "pass" : "fail",
    detail: !tagged
      ? "The document is not tagged, so list content cannot use /L > /LI structure."
      : structCounts.lists === 0
        ? "No /L list structures were found. If the document has bulleted or numbered lists, tag them so screen readers announce list position."
        : structCounts.listItemsWithBody === structCounts.listItems
          ? `${structCounts.lists} list(s) with ${structCounts.listItems} item(s); every /LI carries an /LBody.`
          : `${structCounts.listItems - structCounts.listItemsWithBody} of ${structCounts.listItems} list item(s) have no /LBody — screen readers cannot read the item text.`,
    fix: tagged && structCounts.lists > 0 && structCounts.listItemsWithBody !== structCounts.listItems
      ? "Re-run Auto-Tag so each list item has an /Lbl (marker) and /LBody (text)."
      : "",
  });

  // 12. Tables have header cells with scope
  const tableHeadersOk = structCounts.tables > 0 && structCounts.tablesWithHeader === structCounts.tables && structCounts.thWithScope === structCounts.th && structCounts.th > 0;
  add({
    id: "table-headers",
    label: "Tables have header cells",
    status: !tagged ? "fail" : structCounts.tables === 0 ? "pass" : tableHeadersOk ? "pass" : "fail",
    detail: !tagged
      ? "The document is not tagged, so tables cannot use /Table > /TR > /TH|/TD structure."
      : structCounts.tables === 0
        ? "No /Table structures were found. If the document has data tables, tag them with header cells so screen readers can associate cells with headers."
        : tableHeadersOk
          ? `${structCounts.tables} table(s) with ${structCounts.th} header cell(s), each carrying /Scope.`
          : `${structCounts.tables} table(s) found, but ${structCounts.th === 0 ? "no /TH header cells" : `${structCounts.th - structCounts.thWithScope} header cell(s) lack /Scope`}. Header cells and their scope let screen readers announce which header a cell belongs to.`,
    fix: tagged && structCounts.tables > 0 && !tableHeadersOk ? "Mark the header row cells as /TH with /Scope Row or Column." : "",
    note: "Table structure inferred from a flat text layer is heuristic — confirm the header cells and reading order by hand.",
  });

  // 13. Links are tagged
  add({
    id: "links-tagged",
    label: "Links are tagged",
    status: !tagged ? (linkAnnots > 0 ? "fail" : "pass") : linkAnnots === 0 ? "pass" : structCounts.linksWithObjr >= 1 ? "pass" : "fail",
    detail: !tagged
      ? linkAnnots > 0
        ? `${linkAnnots} link annotation(s) found, but the document is not tagged, so none are wired into the structure tree with /Link + /OBJR.`
        : "No link annotations, so there is nothing to tag."
      : linkAnnots === 0
        ? "No link annotations were found."
        : structCounts.linksWithObjr >= 1
          ? `${structCounts.links} /Link element(s) reference their annotation via /OBJR, so screen readers announce them as links.`
          : `${linkAnnots} link annotation(s) are not represented by /Link structure elements with /OBJR — screen readers may not announce them as links.`,
    fix: tagged && linkAnnots > 0 && structCounts.linksWithObjr < 1 ? "Re-run Auto-Tag to add a /Link element with an /OBJR for each link annotation." : "",
  });

  // 14. Running content (headers/footers/page numbers) is artifacted
  add({
    id: "running-content",
    label: "Running content is artifacted",
    status: !tagged ? "fail" : artifacted ? "pass" : pageCount > 1 ? "warn" : "pass",
    detail: !tagged
      ? "The document is not tagged, so repeated headers, footers, and page numbers cannot be marked as artifacts."
      : artifacted
        ? "Running content is marked with /Artifact, so assistive technology skips repeated headers, footers, and page numbers."
        : pageCount > 1
          ? "No /Artifact-marked content was found. If this document repeats headers, footers, or page numbers across pages, they should be tagged as artifacts so they are not read on every page."
          : "Single-page document — no running headers/footers to artifact.",
    fix: tagged && !artifacted && pageCount > 1 ? "Auto-Tag marks repeated top/bottom-margin text as /Artifact (pagination)." : "",
  });

  // 15. Role map present
  add({
    id: "role-map",
    label: "Structure has a role map",
    status: !tagged ? "fail" : hasRoleMap ? "pass" : "warn",
    detail: !tagged
      ? "The document is not tagged, so there is no /StructTreeRoot to carry a /RoleMap."
      : hasRoleMap
        ? "/StructTreeRoot carries a /RoleMap, so any custom structure types map to standard PDF/UA types."
        : "/StructTreeRoot has no /RoleMap. A role map is recommended so custom structure types resolve to standard ones.",
    fix: tagged && !hasRoleMap ? "Auto-Tag writes a /RoleMap on the structure tree root." : "",
  });

  const summary = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const check of checks) summary[check.status] += 1;

  // Conformance-style tally over the machine-verifiable (non-info) checks.
  const applicable = summary.pass + summary.warn + summary.fail;
  const conformance = {
    passed: summary.pass,
    applicable,
    // These two feed the DOWNLOADABLE report, which someone may rely on as
    // evidence, so they stay complete and precise. The on-screen verdict renders
    // a shorter form — a compliance document and a UI are different audiences,
    // and trimming the report to tidy the screen would be the wrong trade.
    summary: `${summary.pass} of ${applicable} automated PDF/UA checks pass`,
    caveat:
      "This tallies only machine-verifiable criteria. It is NOT a veraPDF or certified PDF/UA conformance pass: meaningful alt text, correct reading order for complex layouts, and colour contrast still need human review.",
  };

  const verdict = buildVerdict({ tagged, summary, title, lang });

  return {
    checks,
    summary,
    conformance,
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
      lists: structCounts.lists,
      listItems: structCounts.listItems,
      tables: structCounts.tables,
      tableHeaderCells: structCounts.th,
      links: structCounts.links,
      linkAnnots,
      artifacted,
      hasRoleMap,
      headingSkipped: headingSkip.skipped,
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
      summary: `This document has no structure for a screen reader to follow. ${summary.fail} check(s) fail, ${summary.warn} need attention — Make Accessible fixes the basics.`,
    };
  }
  if (summary.fail > 0) {
    return {
      level: "warn",
      headline: `Tagged, ${summary.fail} issue(s) to fix`,
      summary: `Structured, but ${summary.fail} check(s) still fail and ${summary.warn} need attention.`,
    };
  }
  return {
    level: summary.warn > 0 ? "warn" : "pass",
    headline: summary.warn > 0 ? "Tagged — minor items to review" : "Passes automated checks",
    summary: `Every automated check passes${summary.warn > 0 ? `, with ${summary.warn} item(s) to review` : ""}.`,
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
  if (report.conformance) lines.push(`CONFORMANCE: ${report.conformance.summary}`);
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
    "This is an automated check of machine-verifiable criteria (tagging, title, language, alt-text presence, encryption permissions, structure/reading-order presence, headings and their nesting, list structure, table header cells, tagged links, artifacted running content, and a role map). It is NOT a veraPDF or certified PDF/UA conformance pass. It does NOT replace a manual audit. Colour contrast of rendered content, whether alt text is actually meaningful, whether table/list detection matched the real layout, and whether the reading order is logically correct all require human judgement. Passing every automated check is necessary but not sufficient for PDF/UA or WCAG conformance.",
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

// --- re-run cleanup: removing a prior remediation's structure + text layer ----
//
// Re-running Auto-Tag on an already-tagged PDF must not leave the previous
// /StructTreeRoot + StructElems as orphaned/disconnected objects (veraPDF flags
// these) nor stack a second invisible hidden-text layer on each page. The two
// helpers below strip the previous graph and our previously-injected content so
// each run starts from a clean slate before the new tree/layer are written.

// Collects the indirect StructElem references reachable from a /K value, for
// deleting an old structure graph. /K may be a single ref, an indirect or direct
// array of refs (mixed with MCID integers / inline MCR dicts, which carry no ref
// to delete), or a plain MCID number.
function collectKidRefs(lib, ctx, kids) {
  const out = [];
  if (kids === undefined || kids === null) return out;
  let value = kids;
  if (value instanceof lib.PDFRef) {
    const resolved = ctx.lookup(value);
    if (resolved instanceof lib.PDFArray) {
      value = resolved;
    } else {
      out.push(value);
      return out;
    }
  }
  if (value instanceof lib.PDFArray) {
    for (let i = 0; i < value.size(); i += 1) {
      const item = value.get(i);
      if (item instanceof lib.PDFRef) out.push(item);
    }
  }
  return out;
}

// Removes a previously-written structure graph (from an earlier remediation, or
// any tagged input): deletes every StructElem descendant reachable from the root
// via /K, the /ParentTree number-tree arrays, and the /StructTreeRoot itself, so
// re-tagging leaves no orphaned/disconnected structure objects. Bounded by a
// visited-ref set and a node cap against cyclic/malformed trees.
function removeOldStructGraph(lib, ctx, structRootRef) {
  const N = (k) => lib.PDFName.of(k);
  const structRoot = structRootRef ? ctx.lookup(structRootRef) : undefined;
  if (!structRoot || typeof structRoot.get !== "function") return 0;
  const MAX_NODES = 200000;
  const visited = new Set();
  const stack = collectKidRefs(lib, ctx, structRoot.get(N("K")));
  let removed = 0;
  while (stack.length && removed < MAX_NODES) {
    const ref = stack.pop();
    const key = ref instanceof lib.PDFRef ? ref.toString() : String(ref);
    if (visited.has(key)) continue;
    visited.add(key);
    const node = ctx.lookup(ref);
    if (node && typeof node.get === "function") {
      for (const child of collectKidRefs(lib, ctx, node.get(N("K")))) stack.push(child);
    }
    try { ctx.delete(ref); removed += 1; } catch { /* already gone */ }
  }
  // ParentTree: delete the per-page parent arrays and the number-tree dict.
  const ptRef = structRoot.get(N("ParentTree"));
  if (ptRef) {
    const pt = ctx.lookup(ptRef);
    const nums = pt && typeof pt.get === "function" ? ctx.lookup(pt.get(N("Nums"))) : undefined;
    if (nums instanceof lib.PDFArray) {
      for (let i = 0; i < nums.size(); i += 1) {
        const item = nums.get(i);
        if (item instanceof lib.PDFRef) { try { ctx.delete(item); } catch { /* gone */ } }
      }
    }
    if (ptRef instanceof lib.PDFRef) { try { ctx.delete(ptRef); } catch { /* gone */ } }
  }
  if (structRootRef instanceof lib.PDFRef) { try { ctx.delete(structRootRef); } catch { /* gone */ } }
  return removed;
}

// Removes the invisible tagged-text / artifact marked-content stream this tool
// appended on a prior remediation. That stream is tagged with /MFKAccessLayer
// true on its dict; the page's original content streams have no such marker and
// are left untouched, so a re-run replaces (not stacks) the hidden-text layer.
function stripPriorAccessLayers(lib, ctx, page) {
  const N = (k) => lib.PDFName.of(k);
  const contents = page.node.get(N("Contents"));
  const resolved = contents ? ctx.lookup(contents) : undefined;
  if (!(resolved instanceof lib.PDFArray)) return 0;
  const keep = [];
  let removed = 0;
  for (let i = 0; i < resolved.size(); i += 1) {
    const ref = resolved.get(i);
    const stream = ref instanceof lib.PDFRef ? ctx.lookup(ref) : undefined;
    const dict = stream && stream.dict && typeof stream.dict.get === "function" ? stream.dict : null;
    const marker = dict ? dict.get(N("MFKAccessLayer")) : undefined;
    // The /Artifact BMC ... EMC wrappers are ours too: without removing them a
    // re-run nests another pair around the previous one.
    const wrapper = dict ? dict.get(N("MFKAccessArtifact")) : undefined;
    if ((marker && isTrue(marker)) || (wrapper && isTrue(wrapper))) {
      try { ctx.delete(ref); } catch { /* gone */ }
      removed += 1;
    } else {
      keep.push(ref);
    }
  }
  if (removed) {
    const arr = lib.PDFArray.withContext(ctx);
    for (const ref of keep) arr.push(ref);
    page.node.set(N("Contents"), arr);
  }
  return removed;
}


/**
 * Marks the page's ORIGINAL content as an artifact.
 *
 * This tool cannot tag the existing content stream — it never parses it — so it
 * draws an invisible, tagged copy of the text and leaves the visible original
 * alone. That left every string in the document present TWICE and neither copy
 * marked: extracting text from a tagged file returned 142 characters where the
 * input had 70, with the Aadhaar number appearing twice. A screen reader would
 * read the whole document, then read it again. Under PDF/UA every content item
 * must be tagged or marked as an artifact, so the output was non-conformant by
 * construction — while the app's own checker graded it 12 pass, 0 fail.
 *
 * Wrapping the original streams in /Artifact BMC ... EMC makes them decorative:
 * assistive technology skips them and reads the tagged layer, which is the one
 * carrying headings, lists and reading order. BMC/EMC nest independently of
 * q/Q, so this is safe around arbitrary existing content.
 *
 * Both wrappers carry /MFKAccessArtifact so a re-run strips them instead of
 * nesting another pair.
 */
function artifactWrapOriginalContent(lib, ctx, page) {
  const N = (k) => lib.PDFName.of(k);
  const existing = page.node.get(N("Contents"));
  if (!existing) return false;

  const make = (text) => {
    const stream = ctx.flateStream(text);
    stream.dict.set(N("MFKAccessArtifact"), lib.PDFBool.True);
    return ctx.register(stream);
  };

  const arr = lib.PDFArray.withContext(ctx);
  arr.push(make("/Artifact BMC\n"));
  const resolved = ctx.lookup(existing);
  if (resolved instanceof lib.PDFArray) {
    for (let i = 0; i < resolved.size(); i += 1) arr.push(resolved.get(i));
  } else {
    arr.push(existing);
  }
  arr.push(make("EMC\n"));
  page.node.set(N("Contents"), arr);
  return true;
}

// --- structure planning (pure) ------------------------------------------------
//
// Turns the flat, positioned text blocks ({page,text,x,y,fontSize,heading}) that
// extraction hands us into an ordered list of richer structure nodes per page:
// headings, paragraphs, lists (/L>/LI>/Lbl+/LBody), and tables (/Table>/TR>cells).
// These are pure, Node-testable, and bounded (single pass over pre-clustered rows).

// The position triple a leaf needs to draw its invisible text.
function posOf(block) {
  return {
    x: Number(block.x) || 0,
    y: Number(block.y) || 0,
    size: Number(block.fontSize) > 0 ? Number(block.fontSize) : 12,
  };
}

// The planner's heading test, shared so running-content detection never diverges
// from how planPageNodes actually classifies a block: a block whose `heading`
// field is an integer level 1..6 is emitted as an /H1../H6 structure element.
// Everything else (level 0, or an out-of-range value) is body text.
function headingLevelOf(block) {
  return Math.floor(Number(block?.heading) || 0);
}
function isHeadingBlock(block) {
  const level = headingLevelOf(block);
  return level >= 1 && level <= 6;
}

// Detects running content — text repeated in the top/bottom margin band across
// two or more pages (headers, footers, page numbers). Digits are normalised so
// "Page 1"/"Page 2" match. Returns a Set of the exact block objects to artifact.
//
// A block the planner treats as a heading (heading level 1..6) is never treated
// as running content, even when it repeats near a margin: a recurring section
// heading ("Executive Summary" on two pages, "Chapter 1"/"Chapter 2" which
// digit-normalise to the same key) must stay in the reading order as an /H1. A
// false /Artifact is permanent content loss — worse than a heading redundantly
// repeated — so genuine headings are kept. True running headers/footers/page
// numbers carry heading level 0 and are still artifacted.
function detectRunningContent(blocksByPage, pageHeights) {
  const running = new Set();
  const pageCount = blocksByPage.length;
  if (pageCount < 2) return running;
  const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ").replace(/\d+/g, "#").toLowerCase();
  const byText = new Map(); // normalised text -> Map(pageIndex -> [blocks])
  for (let pi = 0; pi < pageCount; pi += 1) {
    const height = Number(pageHeights[pi]) > 0 ? Number(pageHeights[pi]) : 792;
    for (const block of blocksByPage[pi]) {
      const text = String(block?.text ?? "").trim();
      if (!text) continue;
      if (isHeadingBlock(block)) continue; // a detected heading stays in the reading order
      const y = Number(block.y) || 0;
      if (y < height * 0.9 && y > height * 0.1) continue; // not in a margin band
      const key = norm(text);
      if (!key) continue;
      if (!byText.has(key)) byText.set(key, new Map());
      const pages = byText.get(key);
      if (!pages.has(pi)) pages.set(pi, []);
      pages.get(pi).push(block);
    }
  }
  for (const [, pages] of byText) {
    if (pages.size >= 2) for (const [, arr] of pages) for (const block of arr) running.add(block);
  }
  return running;
}

// Clusters blocks into visual rows (top-to-bottom), each row's cells sorted L→R.
function clusterRows(blocks) {
  const sorted = blocks.slice().sort((a, b) => (Math.abs((Number(a.y) || 0) - (Number(b.y) || 0)) > 2 ? (Number(b.y) || 0) - (Number(a.y) || 0) : (Number(a.x) || 0) - (Number(b.x) || 0)));
  const rows = [];
  let current = null;
  for (const block of sorted) {
    const y = Number(block.y) || 0;
    const size = Number(block.fontSize) > 0 ? Number(block.fontSize) : 12;
    if (current && Math.abs(current.y - y) <= Math.max(2, size * 0.6)) current.cells.push(block);
    else { current = { y, cells: [block] }; rows.push(current); }
  }
  for (const row of rows) row.cells.sort((a, b) => (Number(a.x) || 0) - (Number(b.x) || 0));
  return rows;
}

// True if two rows have cells at the same x positions (within a font-scaled tol).
function columnsAlign(rowA, rowB) {
  if (rowA.cells.length !== rowB.cells.length) return false;
  for (let i = 0; i < rowA.cells.length; i += 1) {
    const tol = Math.max(6, (Number(rowA.cells[i].fontSize) || 12) * 3);
    if (Math.abs((Number(rowA.cells[i].x) || 0) - (Number(rowB.cells[i].x) || 0)) > tol) return false;
  }
  return true;
}

// Given clustered rows, returns the exclusive end index of a qualifying table run
// starting at `start` (≥2 rows, each with the same ≥2 aligned columns), or `start`
// itself when there is no table. Conservative: a mis-detected table is worse than
// none, so only clearly grid-shaped runs qualify; single-column blocks never do.
function tableRunEnd(rows, start) {
  const first = rows[start];
  if (!first || first.cells.length < 2) return start;
  let end = start + 1;
  while (end < rows.length && columnsAlign(first, rows[end])) end += 1;
  return end - start >= 2 ? end : start;
}

// Plans one page's non-running blocks into ordered structure nodes. Pure.
export function planPageNodes(blocks) {
  const rows = clusterRows(blocks);
  const nodes = [];
  let pendingList = null;
  const flushList = () => {
    if (!pendingList) return;
    if (pendingList.length >= 2) nodes.push({ kind: "list", items: pendingList });
    else for (const item of pendingList) nodes.push({ kind: "para", text: `${item.marker} ${item.body}`.trim(), pos: item.pos });
    pendingList = null;
  };

  let i = 0;
  while (i < rows.length) {
    const end = tableRunEnd(rows, i);
    if (end > i) {
      flushList();
      const tableRows = rows.slice(i, end).map((row) => ({ cells: row.cells.map((c) => ({ text: String(c.text ?? ""), pos: posOf(c) })) }));
      nodes.push({ kind: "table", rows: tableRows });
      i = end;
      continue;
    }
    for (const block of rows[i].cells) {
      const text = String(block.text ?? "");
      const marker = LIST_MARKER.exec(text);
      if (marker) {
        if (!pendingList) pendingList = [];
        pendingList.push({ marker: (marker[1] || marker[0]).trim(), body: text.slice(marker[0].length).trim(), pos: posOf(block) });
      } else {
        flushList();
        const level = headingLevelOf(block);
        if (level >= 1 && level <= 6) nodes.push({ kind: "heading", level, text, pos: posOf(block) });
        else nodes.push({ kind: "para", text, pos: posOf(block) });
      }
    }
    i += 1;
  }
  flushList();
  return nodes;
}

// A figure's /BBox [llx lly urx ury] in default user space, when derivable.
function figureBBox(figure) {
  const x = Number(figure.x);
  const y = Number(figure.y);
  const w = Number(figure.width);
  const h = Number(figure.height);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return [x, y, x + w, y + h];
}

// Derives link alt text (/Contents) from an annotation's /A /URI, when present.
function deriveLinkContents(lib, ctx, annot) {
  const action = ctx.lookup(annot.get(lib.PDFName.of("A")));
  if (!action || typeof action.get !== "function") return "";
  const uri = decodePdfText(action.get(lib.PDFName.of("URI"))).trim();
  return uri ? `Link to ${uri}` : "";
}

/**
 * Remediates raw PDF bytes toward PDF/UA as far as is reliably automatable.
 *
 * Sets catalog /Lang, Info /Title + XMP dc:title (UTF-16BE so non-Latin titles
 * survive), /ViewerPreferences /DisplayDocTitle true, /MarkInfo /Marked true,
 * and builds a conformance-oriented tagged structure tree under a /Document root:
 *   - /H1../H6 headings and /P paragraphs in reading order;
 *   - /L > /LI > (/Lbl + /LBody) for consecutive list-marker lines;
 *   - /Table > /TR > /TH (first row, /Scope Column) | /TD for grid-shaped regions;
 *   - /Link > /OBJR wiring each link annotation into the tree (and /Contents alt
 *     text on the annotation when missing);
 *   - /Figure carrying /Alt (and a /BBox layout attribute when derivable);
 *   - a /RoleMap on the /StructTreeRoot mapping the emitted types to standard ones.
 * Repeated top/bottom-margin text (running headers/footers/page numbers) is drawn
 * as /Artifact (pagination) so it is excluded from the reading order. Every text
 * leaf is re-drawn as an INVISIBLE (render-mode 3) marked-content run wired to its
 * MCID, so the tags cover real screen-reader-readable content; /ActualText
 * (UTF-16BE) preserves text the Latin-1 standard font cannot draw. Table and list
 * detection from a flat text layer is heuristic — only clearly grid/list-shaped
 * regions are tagged; ambiguous ones stay paragraphs. NOT certified PDF/UA.
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
    PDFDocument, PDFName, PDFNumber, PDFHexString, PDFBool, PDFArray, PDFRef, StandardFonts,
    PDFOperator, PDFOperatorNames, beginText, endText, showText, setFontAndSize, setTextRenderingMode, setTextMatrix, endMarkedContent,
  } = lib;

  const lang = safeLangTag(params.lang || "en-US", "en");
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

  // --- 0. Clean slate for re-runs -------------------------------------------
  // If the input already carries a /StructTreeRoot (a prior remediation, or any
  // tagged PDF), remove that whole structure graph and our previously-injected
  // hidden-text layer BEFORE writing the new ones. Without this, re-tagging
  // orphans the old /StructTreeRoot + StructElems (veraPDF flags them as
  // disconnected) and stacks a second invisible marked-content text layer on
  // each page. A first-pass (untagged) input has no /StructTreeRoot, so this is
  // skipped and the untagged path is unchanged.
  const priorStructRef = catalog.get(N("StructTreeRoot"));
  if (priorStructRef) {
    // Delete the old /RoleMap too — it hangs off the root, not off /K, so
    // removeOldStructGraph would otherwise leave it orphaned on a re-run.
    const priorRoot = ctx.lookup(priorStructRef);
    if (priorRoot && typeof priorRoot.get === "function") {
      const priorRoleMap = priorRoot.get(N("RoleMap"));
      if (priorRoleMap instanceof PDFRef) { try { ctx.delete(priorRoleMap); } catch { /* gone */ } }
    }
    removeOldStructGraph(lib, ctx, priorStructRef);
    catalog.delete(N("StructTreeRoot"));
    const priorMarkInfo = catalog.get(N("MarkInfo"));
    if (priorMarkInfo instanceof PDFRef) { try { ctx.delete(priorMarkInfo); } catch { /* gone */ } }
    catalog.delete(N("MarkInfo"));
    for (const page of pages) stripPriorAccessLayers(lib, ctx, page);
  }

  // --- 1. Language ----------------------------------------------------------
  // Written as a hex string so even a value that slipped past safeLangTag cannot
  // inject dictionary syntax into the catalog. `lang` is already validated above.
  catalog.set(N("Lang"), PDFHexString.fromText(lang));
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
  // Link annotations enter the ParentTree by a single StructParent key each,
  // allocated AFTER the page StructParents block (0..pageCount-1).
  let nextParentKey = pageCount;
  const annotParents = []; // [key, linkStructElemRef]

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

  const pageHeights = pages.map((p) => { try { return p.getSize().height; } catch { return 792; } });
  // Running content (repeated headers/footers/page numbers) → /Artifact, so it is
  // excluded from the reading order (a PDF/UA requirement).
  const runningBlocks = detectRunningContent(blocksByPage, pageHeights);

  let paragraphs = 0;
  let headings = 0;
  let lists = 0;
  let listItems = 0;
  let tables = 0;
  let tableCells = 0;
  let links = 0;
  let taggedFigures = 0;
  let artifacts = 0;
  let runningArtifacts = 0;
  let undrawable = 0;
  const headingLevelsSeen = [];

  // Draws one invisible (render-mode-3) marked-content run. `mcid === null` emits
  // an /Artifact (pagination) region with no MCID; otherwise a tagged MCID run.
  const drawMc = (pi, page, mcTag, mcid, text, x, y, size) => {
    let encoded = null;
    if (text) { try { encoded = font.encodeText(text); } catch { encoded = null; undrawable += 1; } }
    const props = mcid === null ? ctx.obj({ Type: N("Pagination") }) : ctx.obj({ MCID: mcid });
    const ops = [PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [N(mcTag), props])];
    if (encoded) {
      ops.push(
        beginText(),
        setTextRenderingMode(3),
        setFontAndSize(fontKeyFor(pi), Number(size) > 0 ? Number(size) : 12),
        setTextMatrix(1, 0, 0, 1, Number(x) || 0, Number(y) || 0),
        showText(encoded),
        endText(),
      );
    }
    ops.push(endMarkedContent());
    page.pushOperators(...ops);
  };

  // Creates a leaf StructElem carrying a single MCID of invisible text. Its MC tag
  // is the structure type; /ActualText preserves the exact string (UTF-16BE) even
  // when the Latin-1 standard font cannot draw a glyph layer for it.
  const emitLeaf = (pi, page, pageRef, parentRef, sType, text, pos, attrs) => {
    const mcid = mcidCounters[pi];
    mcidCounters[pi] += 1;
    const el = ctx.obj({ Type: N("StructElem"), S: N(sType), P: parentRef, Pg: pageRef });
    if (text) el.set(N("ActualText"), PDFHexString.fromText(String(text)));
    el.set(N("K"), PDFNumber.of(mcid));
    if (attrs) for (const [k, v] of attrs) el.set(N(k), v);
    const elRef = ctx.register(el);
    parentArrays[pi][mcid] = elRef;
    drawMc(pi, page, sType, mcid, String(text ?? ""), pos.x, pos.y, pos.size);
    return elRef;
  };

  let artifactedPages = 0;
  for (let pi = 0; pi < pageCount; pi += 1) {
    const page = pages[pi];
    const pageRef = page.ref;

    // Mark the page's existing content decorative BEFORE the tagged layer is
    // appended, so the layer itself is never caught inside the wrapper.
    if (artifactWrapOriginalContent(lib, ctx, page)) artifactedPages += 1;

    const pageBlocks = blocksByPage[pi].filter((b) => String(b?.text ?? "").trim());
    const contentBlocks = pageBlocks.filter((b) => !runningBlocks.has(b));
    const runningOnPage = pageBlocks.filter((b) => runningBlocks.has(b));

    // Plan this page's content into headings / paragraphs / lists / tables, then
    // emit the corresponding structure elements in reading order.
    for (const node of planPageNodes(contentBlocks)) {
      if (node.kind === "heading") {
        documentKids.push(emitLeaf(pi, page, pageRef, documentRef, `H${node.level}`, node.text, node.pos));
        headings += 1;
        headingLevelsSeen.push(node.level);
      } else if (node.kind === "para") {
        documentKids.push(emitLeaf(pi, page, pageRef, documentRef, "P", node.text, node.pos));
        paragraphs += 1;
      } else if (node.kind === "list") {
        // /L > /LI > (/Lbl + /LBody). Register the list first so its items can
        // reference it as their /P, then fill /K bottom-up.
        const listEl = ctx.obj({ Type: N("StructElem"), S: N("L"), P: documentRef, Pg: pageRef });
        const listRef = ctx.register(listEl);
        const liRefs = [];
        for (const item of node.items) {
          const liEl = ctx.obj({ Type: N("StructElem"), S: N("LI"), P: listRef, Pg: pageRef });
          const liRef = ctx.register(liEl);
          const lblRef = emitLeaf(pi, page, pageRef, liRef, "Lbl", item.marker, item.pos);
          const bodyRef = emitLeaf(pi, page, pageRef, liRef, "LBody", item.body, item.pos);
          const liKids = PDFArray.withContext(ctx);
          liKids.push(lblRef);
          liKids.push(bodyRef);
          liEl.set(N("K"), liKids);
          liRefs.push(liRef);
          listItems += 1;
        }
        const listKids = PDFArray.withContext(ctx);
        for (const ref of liRefs) listKids.push(ref);
        listEl.set(N("K"), listKids);
        documentKids.push(listRef);
        lists += 1;
      } else if (node.kind === "table") {
        // /Table > /TR > /TH (first row, /Scope Column) | /TD.
        const tableEl = ctx.obj({ Type: N("StructElem"), S: N("Table"), P: documentRef, Pg: pageRef });
        const tableRef = ctx.register(tableEl);
        const trRefs = [];
        node.rows.forEach((row, ri) => {
          const trEl = ctx.obj({ Type: N("StructElem"), S: N("TR"), P: tableRef, Pg: pageRef });
          const trRef = ctx.register(trEl);
          const cellRefs = [];
          for (const cell of row.cells) {
            const header = ri === 0;
            const cellType = header ? "TH" : "TD";
            const attrs = header ? [["Scope", N("Column")]] : null;
            cellRefs.push(emitLeaf(pi, page, pageRef, trRef, cellType, cell.text, cell.pos, attrs));
            tableCells += 1;
          }
          const trKids = PDFArray.withContext(ctx);
          for (const ref of cellRefs) trKids.push(ref);
          trEl.set(N("K"), trKids);
          trRefs.push(trRef);
        });
        const tableKids = PDFArray.withContext(ctx);
        for (const ref of trRefs) tableKids.push(ref);
        tableEl.set(N("K"), tableKids);
        documentKids.push(tableRef);
        tables += 1;
      }
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
      // /BBox layout attribute when the figure's geometry is known.
      const bbox = figureBBox(figure);
      if (bbox) figEl.set(N("A"), ctx.obj({ O: N("Layout"), BBox: bbox }));
      const figRef = ctx.register(figEl);
      documentKids.push(figRef);
      parentArrays[pi][mcid] = figRef;
      mcidCounters[pi] += 1;
      page.pushOperators(
        PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [N("Figure"), ctx.obj({ MCID: mcid })]),
        endMarkedContent(),
      );
    }

    // Links: wire each /Link annotation into the tree as /Link > /OBJR so screen
    // readers announce it, and give it /Contents alt text when missing.
    const annotsVal = ctx.lookup(page.node.get(N("Annots")));
    if (annotsVal instanceof PDFArray) {
      for (let ai = 0; ai < annotsVal.size(); ai += 1) {
        const aref = annotsVal.get(ai);
        if (!(aref instanceof PDFRef)) continue;
        const annot = ctx.lookup(aref);
        if (!annot || typeof annot.get !== "function") continue;
        if (decodeName(annot.get(N("Subtype"))) !== "Link") continue;
        if (!decodePdfText(annot.get(N("Contents"))).trim()) {
          const derived = deriveLinkContents(lib, ctx, annot);
          if (derived) annot.set(N("Contents"), PDFHexString.fromText(derived));
          else review.push("A link annotation has no /Contents description — add link alt text so its purpose is announced.");
        }
        const linkEl = ctx.obj({ Type: N("StructElem"), S: N("Link"), P: documentRef, Pg: pageRef });
        const linkRef = ctx.register(linkEl);
        const objr = ctx.obj({ Type: N("OBJR"), Pg: pageRef, Obj: aref });
        const linkKids = PDFArray.withContext(ctx);
        linkKids.push(objr);
        linkEl.set(N("K"), linkKids);
        const key = nextParentKey;
        nextParentKey += 1;
        annot.set(N("StructParent"), PDFNumber.of(key));
        annotParents.push([key, linkRef]);
        documentKids.push(linkRef);
        links += 1;
      }
    }

    // Running content: draw as invisible /Artifact (pagination) so the repeated
    // header/footer text is excluded from the reading order.
    for (const block of runningOnPage) {
      runningArtifacts += 1;
      drawMc(pi, page, "Artifact", null, String(block.text ?? ""), Number(block.x) || 0, Number(block.y) || 0, Number(block.fontSize) > 0 ? Number(block.fontSize) : 12);
    }

    // Tag the marked-content stream we injected above so a later re-run can find
    // and remove exactly this layer (see stripPriorAccessLayers) instead of
    // stacking a second hidden-text layer on top of it.
    if (page.contentStream && page.contentStream.dict && typeof page.contentStream.dict.set === "function") {
      page.contentStream.dict.set(N("MFKAccessLayer"), PDFBool.True);
    }

    // Wire the page into the structure parent tree.
    page.node.set(N("StructParents"), PDFNumber.of(pi));
    page.node.set(N("Tabs"), N("S"));
  }

  // Document /K = ordered array of all top-level structure elements.
  const kidsArray = PDFArray.withContext(ctx);
  for (const ref of documentKids) kidsArray.push(ref);
  documentEl.set(N("K"), kidsArray);
  structTreeRoot.set(N("K"), documentRef);

  // RoleMap: map every structure type we emit to its standard equivalent, so
  // validators that require custom types to be mapped are satisfied.
  const roleMap = ctx.obj({});
  for (const role of EMITTED_ROLES) roleMap.set(N(role), N(role));
  structTreeRoot.set(N("RoleMap"), ctx.register(roleMap));

  // ParentTree: page MCID arrays (keys 0..pageCount-1), then one entry per link
  // annotation (key -> its /Link element). Keys stay in ascending order.
  const nums = PDFArray.withContext(ctx);
  for (let pi = 0; pi < pageCount; pi += 1) {
    const arr = PDFArray.withContext(ctx);
    for (const ref of parentArrays[pi]) arr.push(ref);
    nums.push(PDFNumber.of(pi));
    nums.push(ctx.register(arr));
  }
  for (const [key, ref] of annotParents) {
    nums.push(PDFNumber.of(key));
    nums.push(ref);
  }
  const parentTree = ctx.obj({});
  parentTree.set(N("Nums"), nums);
  structTreeRoot.set(N("ParentTree"), ctx.register(parentTree));
  structTreeRoot.set(N("ParentTreeNextKey"), PDFNumber.of(nextParentKey));
  catalog.set(N("StructTreeRoot"), structTreeRef);

  applied.push(`tagged structure tree (/Document root with ${paragraphs} paragraph, ${headings} heading, ${lists} list, ${tables} table, ${links} link, ${taggedFigures} figure element(s))`);
  if (artifacts || runningArtifacts) applied.push(`${artifacts} decorative image(s) and ${runningArtifacts} running-content run(s) marked as /Artifact`);
  applied.push("/RoleMap mapping structure types to standard PDF/UA roles");
  if (undrawable) review.push(`${undrawable} text block(s) use characters the standard font cannot draw; their text is preserved as /ActualText but not as a visible glyph layer.`);

  const skip = findHeadingSkip(headingLevelsSeen);
  if (skip.skipped) review.push(`Heading levels skip from H${skip.from} to H${skip.to}; insert the missing H${skip.from + 1} or adjust the outline.`);
  review.push("Reading order was inferred from text position (top-to-bottom, left-to-right). Confirm it is logically correct for multi-column, table, or form layouts.");
  review.push("Heading levels were guessed from text size/weight. Confirm the H1–H6 outline by hand.");
  if (tables) review.push("Table structure was inferred from text positions and is heuristic — confirm the /TH header cells and cell reading order by hand.");
  if (artifactedPages) {
    applied.push(`Marked the original page content on ${artifactedPages} page${artifactedPages === 1 ? "" : "s"} as decorative, so a screen reader reads the tagged text once rather than the document twice`);
  }
  if (links) review.push("Confirm each link's /Contents description conveys its purpose.");
  if (taggedFigures) review.push("Confirm each image's alt text actually describes the image's meaning.");

  const outBytes = await pdf.save({ updateMetadata: false });
  return {
    bytes: outBytes,
    report: {
      applied,
      review,
      structSummary: { paragraphs, headings, lists, listItems, tables, tableCells, links, figures: taggedFigures, artifacts, runningArtifacts, pageCount },
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
  const links = [];
  let characters = 0;

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    onProgress?.(pageNumber, pageCount);
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const geom = { width: viewport.width, height: viewport.height };

    // pdf.js text items already carry {str, transform:[a,b,c,d,e,f], width,
    // height, fontName} — the exact shape pdf-reflow's layout analysis consumes,
    // where transform's e,f are the baseline origin in PDF user space (bottom-left).
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (typeof item.str === "string") characters += item.str.length;
    }

    // Reuse detectColumnLayout to decide whether this page is tabular. On a
    // table-like page, split the raw runs into positioned cells so the tagger
    // rebuilds a real /Table; otherwise reuse parseParagraphs, which merges prose
    // into paragraphs, flags headings, and keeps each list item as its own block
    // (marker intact) so the tagger can group them into an /L.
    const layout = detectColumnLayout(content.items, geom);
    if (layout.tableLike && layout.lineCount >= 3) {
      for (const cell of extractTableCells(content.items, pageNumber)) textBlocks.push(cell);
    } else {
      const blocks = parseParagraphs(content.items, geom);
      const levelOf = paragraphHeadingLevel(blocks);
      for (const block of blocks) {
        textBlocks.push({
          page: pageNumber,
          text: block.text,
          x: block.left,
          y: block.top - block.fontSize, // baseline ≈ top-of-slot minus one em
          fontSize: block.fontSize,
          heading: block.isHeading ? levelOf(block) : 0,
        });
      }
    }

    // Link annotations, for the UI to surface (the tagger re-reads them from the
    // page object model to wire /Link + /OBJR, so this list is informational).
    try {
      for (const annot of await page.getAnnotations()) {
        if (annot && annot.subtype === "Link") links.push({ page: pageNumber, url: annot.url || "", rect: annot.rect || null });
      }
    } catch {
      /* annotations unavailable — links simply not listed for this page */
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

  // The text itself, so the checker can spot a duplicated text layer. Capped:
  // this is only ever scanned for repeats, never displayed or stored.
  const sampleText = textBlocks.map((b) => String(b?.text ?? "").trim()).filter(Boolean).join("\n").slice(0, 200_000);
  return { textBlocks, figures, links, textLayer: { characters, pageCount, text: sampleText }, pageCount };
}

// Maps parseParagraphs heading blocks to H1..H6 by distinct font-size tier
// (largest = H1). Returns a lookup closure over the page's blocks.
function paragraphHeadingLevel(blocks) {
  const headingSizes = [...new Set(blocks.filter((b) => b.isHeading).map((b) => Math.round(b.fontSize)))].sort((a, b) => b - a);
  return (block) => {
    const tier = headingSizes.indexOf(Math.round(block.fontSize));
    return tier >= 0 && tier < 6 ? tier + 1 : 1;
  };
}

// Splits a table-like page's raw pdf.js runs into positioned cells: runs are
// clustered into rows by baseline, then each row is split into cells wherever a
// horizontal gap exceeds the run's own size (a real column gap, not word spacing).
// Bounded single pass over sorted runs. Browser-only.
function extractTableCells(items, pageNumber) {
  const runs = [];
  for (const item of items) {
    const str = typeof item.str === "string" ? item.str : "";
    if (!str.trim()) continue;
    const t = item.transform || [1, 0, 0, 1, 0, 0];
    const size = Math.hypot(Number(t[1]), Number(t[3])) || Math.abs(Number(t[3])) || 12;
    runs.push({ str, x: Number(t[4]) || 0, y: Number(t[5]) || 0, size, width: Math.abs(Number(item.width)) || 0 });
  }
  runs.sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));
  const rows = [];
  let currentRow = null;
  for (const run of runs) {
    if (currentRow && Math.abs(currentRow.y - run.y) <= Math.max(2, run.size * 0.5)) currentRow.runs.push(run);
    else { currentRow = { y: run.y, runs: [run] }; rows.push(currentRow); }
  }
  const cells = [];
  for (const row of rows) {
    row.runs.sort((a, b) => a.x - b.x);
    let cell = null;
    for (const run of row.runs) {
      if (cell && run.x - cell.endX <= cell.size * 1.8) {
        cell.text += (cell.text.endsWith(" ") ? "" : " ") + run.str;
        cell.endX = run.x + run.width;
      } else {
        cell = { text: run.str, x: run.x, endX: run.x + run.width, y: run.y, size: run.size };
        cells.push(cell);
      }
    }
  }
  return cells.map((c) => ({ page: pageNumber, text: c.text.trim(), x: c.x, y: c.y, fontSize: c.size, heading: 0 }));
}
