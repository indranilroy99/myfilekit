// Office / eBook -> HTML parsing for the "import to PDF" tools (Word, Excel,
// PowerPoint, eBook). Everything here is 100% local: docx/xlsx are parsed by the
// bundled `mammoth` / `xlsx` libraries, pptx/epub containers are unzipped with
// `fflate`, and no function ever touches the network.
//
// Rendering the returned HTML to a canvas/PDF is browser-only (html2canvas), so
// it lives in App.tsx. The parsing below is dependency-light and unit-testable in
// Node: `mammoth`/`xlsx` are dynamically imported (so they also code-split into
// their own chunks and only load when a tool runs), and pptx/epub XML is parsed
// with plain regex rather than DOMParser (which does not exist in Node).

import { unzipSync, strFromU8 } from "fflate";

const EMU_PER_INCH = 914400;

// --- Word (.docx) -> HTML via mammoth -----------------------------------------

// mammoth converts docx to semantic HTML (headings, bold/italic, lists, tables)
// and inlines embedded images as base64 data URIs by default, so the output is
// self-contained and offline-safe.
export async function docxToHtml(file) {
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".doc") && !name.endsWith(".docx")) {
    throw new Error("Legacy .doc files can't be read. Open the file in Word and re-save it as .docx (File > Save As > Word Document), then try again.");
  }
  const mod = await import("mammoth");
  const mammoth = mod.default || mod;
  const arrayBuffer = await file.arrayBuffer();
  // mammoth's browser build (what Vite bundles via the package `browser` field)
  // reads `arrayBuffer`; its Node build reads a `buffer`. Feed each what it wants
  // so this stays correct in the browser and runnable in Node tests.
  const input = typeof Buffer !== "undefined" ? { buffer: Buffer.from(arrayBuffer) } : { arrayBuffer };
  let result;
  try {
    result = await mammoth.convertToHtml(input);
  } catch (error) {
    throw new Error("This file could not be read as a Word document. Make sure it is a valid .docx file.");
  }
  const html = (result?.value || "").trim();
  if (!html) throw new Error("No readable content was found in this Word document.");
  return html;
}

// --- Excel (.xlsx/.xls/.csv) -> sheets via SheetJS -----------------------------

// Reads every sheet as an array-of-arrays (rows of cells). CSV is auto-detected
// by SheetJS, so one path covers all three formats.
// SheetJS is vendored locally (assets/vendor/xlsx.full.min.js) rather than taken
// from npm: the npm `xlsx` package is frozen at 0.18.5, which carries unfixed
// prototype-pollution and ReDoS advisories. The vendored 0.20.3 build fixes both.
// In the browser we lazily inject the local script once (same-origin, so the
// `script-src 'self'` CSP allows it, and it only loads when a spreadsheet tool
// runs). In Node (tests) we evaluate the same vendored file, mirroring how
// tests/core.test.js already loads pdf-lib.
// Exported so the PDF-to-Excel export (export.service.js) writes workbooks with
// the same vendored build instead of pulling the npm package back in.
let xlsxPromise = null;
export function loadXlsx() {
  if (xlsxPromise) return xlsxPromise;
  xlsxPromise = (async () => {
    if (typeof window !== "undefined") {
      if (window.XLSX) return window.XLSX;
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/assets/vendor/xlsx.full.min.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("The spreadsheet engine could not be loaded."));
        document.head.appendChild(script);
      });
      if (!window.XLSX) throw new Error("The spreadsheet engine could not be loaded.");
      return window.XLSX;
    }
    // Node: evaluate the vendored bundle in-process.
    const { readFileSync } = await import("node:fs");
    const path = new URL("../../assets/vendor/xlsx.full.min.js", import.meta.url);
    const code = readFileSync(path, "utf8");
    return new Function(`${code}; return XLSX;`)();
  })();
  return xlsxPromise;
}

export async function readWorkbookSheets(file) {
  const XLSX = await loadXlsx();
  const data = new Uint8Array(await file.arrayBuffer());
  // SheetJS falls back to reading anything it cannot identify as plain text, so a
  // PDF renamed .xlsx would come back as a one-column "sheet" of PDF source.
  // Sniff the container first and reject what is neither a spreadsheet nor text.
  if (!looksLikeSpreadsheet(data)) {
    throw new Error("This file could not be read as a spreadsheet. Supported formats are .xlsx, .xls, and .csv.");
  }
  let workbook;
  try {
    workbook = XLSX.read(data, { type: "array" });
  } catch (error) {
    throw new Error("This file could not be read as a spreadsheet. Supported formats are .xlsx, .xls, and .csv.");
  }
  const names = workbook.SheetNames || [];
  if (!names.length) throw new Error("No sheets were found in this workbook.");
  const sheets = names.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, blankrows: false, defval: "" }),
  }));
  if (sheets.every((sheet) => !sheet.rows.length)) throw new Error("This workbook has no cell data to convert.");
  return sheets;
}

// A real spreadsheet is either an OOXML zip (.xlsx) or a legacy OLE2 container
// (.xls); anything else has to look like plain text before SheetJS sees it, so
// csv/tsv still work while binary files (which SheetJS would happily "read" as
// text) are turned away.
function looksLikeSpreadsheet(data) {
  const startsWith = (bytes) => bytes.every((byte, index) => data[index] === byte);
  if (startsWith([0x50, 0x4b, 0x03, 0x04])) return true; // "PK\x03\x04" — xlsx / OOXML
  if (startsWith([0xd0, 0xcf, 0x11, 0xe0])) return true; // OLE2 — legacy .xls
  // Formats whose header is ASCII (so the text check below would pass them).
  const binaryMagic = [
    [0x25, 0x50, 0x44, 0x46], // %PDF
    [0x47, 0x49, 0x46, 0x38], // GIF8
    [0x52, 0x61, 0x72, 0x21], // Rar!
    [0x37, 0x7a, 0xbc, 0xaf], // 7z
    [0x4d, 0x5a], // MZ — Windows executable
  ];
  if (binaryMagic.some((magic) => startsWith(magic))) return false;
  return looksLikeText(data);
}

// Plain-text heuristic for csv/tsv: no NUL bytes and effectively no control
// characters in the first few KB. Encoding-agnostic on purpose, so UTF-8 and
// legacy single-byte CSVs both pass.
function looksLikeText(data) {
  const sample = data.subarray(0, 4096);
  if (!sample.length) return false;
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) control += 1;
  }
  return control / sample.length < 0.02;
}

// Pure HTML builder for the workbook. First row of each sheet is styled as a
// header. Kept separate from the SheetJS read so it is unit-testable in Node.
export function sheetsToHtml(sheets) {
  return sheets
    .map((sheet) => {
      const rows = sheet.rows || [];
      const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
      const body = rows
        .map((row, rowIndex) => {
          const cells = [];
          for (let column = 0; column < columnCount; column += 1) {
            const value = escapeHtml(row[column]);
            cells.push(rowIndex === 0 ? `<th>${value}</th>` : `<td>${value}</td>`);
          }
          return `<tr>${cells.join("")}</tr>`;
        })
        .join("");
      const table = columnCount
        ? `<table><tbody>${body}</tbody></table>`
        : `<p class="empty-sheet">This sheet is empty.</p>`;
      return `<section class="sheet"><h2>${escapeHtml(sheet.name)}</h2>${table}</section>`;
    })
    .join("");
}

// --- PowerPoint (.pptx) -> slides ---------------------------------------------

// Best-effort: unzip the pptx, read the slide size, then for each slide extract
// text shapes (with bullet levels) and pictures, positioning both from their EMU
// offset/extent when present. Complex layouts, charts, transitions, and SmartArt
// are approximated. Returns pixel-space boxes ready for absolute layout.
export async function pptxToSlides(file) {
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".ppt") && !name.endsWith(".pptx")) {
    throw new Error("Legacy .ppt files can't be read. Open the file in PowerPoint and re-save it as .pptx, then try again.");
  }
  const entries = unzipEntries(await file.arrayBuffer(), "This file could not be read as a PowerPoint (.pptx) file.");

  const presentation = entries["ppt/presentation.xml"] ? strFromU8(entries["ppt/presentation.xml"]) : "";
  const size = tagAttrs(presentation, /<p:sldSz\b[^>]*>/g, ["cx", "cy"]);
  const slideWEmu = size && Number(size[0]) > 0 ? Number(size[0]) : 9144000;
  const slideHEmu = size && Number(size[1]) > 0 ? Number(size[1]) : 6858000;

  const slideNames = Object.keys(entries)
    .map((path) => path.match(/^ppt\/slides\/slide(\d+)\.xml$/))
    .filter(Boolean)
    .map((match) => ({ path: match[0], index: Number(match[1]) }))
    .sort((a, b) => a.index - b.index);
  if (!slideNames.length) throw new Error("No slides were found in this presentation.");

  const slides = slideNames.map(({ path, index }, order) => {
    const xml = strFromU8(entries[path]);
    const rels = readSlideRels(entries, index);
    const elements = parseSlideElements(xml, rels, entries, slideWEmu, slideHEmu);
    return { index: order + 1, elements };
  });

  return { slideWidthEmu: slideWEmu, slideHeightEmu: slideHEmu, slides };
}

function readSlideRels(entries, index) {
  const relsPath = `ppt/slides/_rels/slide${index}.xml.rels`;
  const map = {};
  if (!entries[relsPath]) return map;
  const xml = strFromU8(entries[relsPath]);
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(match[0], "Id");
    const target = attr(match[0], "Target");
    if (id && target) map[id] = target;
  }
  return map;
}

// Extract <p:sp> (text) and <p:pic> (image) shapes in document order.
function parseSlideElements(xml, rels, entries, slideWEmu, slideHEmu) {
  const elements = [];
  for (const match of xml.matchAll(/<p:(sp|pic)\b[\s\S]*?<\/p:\1>/g)) {
    const block = match[0];
    const kind = match[1];
    const box = parseBox(block, slideWEmu, slideHEmu);
    if (kind === "pic") {
      const embed = tagAttrs(block, /<a:blip\b[^>]*>/g, ["r:embed"]);
      const image = embed ? imageFromRel(rels[embed[0]], entries) : null;
      if (image) elements.push({ type: "image", dataUrl: image, box });
    } else {
      const isTitle = [...block.matchAll(/<p:ph\b[^>]*>/g)].some((ph) => ["title", "ctrTitle"].includes(attr(ph[0], "type")));
      const paragraphs = parseParagraphs(block);
      if (paragraphs.some((p) => p.text)) elements.push({ type: "text", title: isTitle, paragraphs, box });
    }
  }
  return elements;
}

// EMU offset/extent -> fractional box (0..1) so callers can scale to any size.
function parseBox(block, slideWEmu, slideHEmu) {
  const off = tagAttrs(block, /<a:off\b[^>]*>/g, ["x", "y"]);
  const ext = tagAttrs(block, /<a:ext\b[^>]*>/g, ["cx", "cy"]);
  if (!off || !ext) return null;
  const [x, y, w, h] = [...off, ...ext].map(Number);
  if (![x, y, w, h].every((value) => Number.isFinite(value))) return null;
  return {
    x: x / slideWEmu,
    y: y / slideHEmu,
    w: w / slideWEmu,
    h: h / slideHEmu,
  };
}

// Each <a:p> is a paragraph; its <a:t> runs are the text, <a:pPr lvl> the indent.
function parseParagraphs(block) {
  const paragraphs = [];
  for (const match of block.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)) {
    const paragraph = match[0];
    const level = tagAttrs(paragraph, /<a:pPr\b[^>]*>/g, ["lvl"]);
    const runs = [...paragraph.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((run) => decodeXml(run[1]));
    paragraphs.push({ text: runs.join(""), level: level && Number(level[0]) >= 0 ? Number(level[0]) : 0 });
  }
  return paragraphs;
}

function imageFromRel(target, entries) {
  if (!target) return null;
  const path = resolvePath("ppt/slides", target);
  const bytes = entries[path];
  if (!bytes) return null;
  return `data:${mimeForImage(path)};base64,${bytesToBase64(bytes)}`;
}

// --- eBook (.epub) -> HTML -----------------------------------------------------

// Reads the OPF spine order, concatenates the XHTML chapters, inlines referenced
// images as data URLs, and strips scripts/remote references for offline safety.
export async function epubToHtml(file) {
  const name = String(file?.name || "").toLowerCase();
  if (!name.endsWith(".epub")) throw new Error("Only .epub eBooks are supported.");
  const entries = unzipEntries(await file.arrayBuffer(), "This file could not be read as an EPUB eBook.");

  const container = entries["META-INF/container.xml"];
  if (!container) throw new Error("This EPUB is missing its container manifest and can't be read.");
  const rootfile = tagAttrs(strFromU8(container), /<rootfile\b[^>]*>/g, ["full-path"]);
  if (!rootfile) throw new Error("This EPUB does not point to a package document.");
  const opfPath = resolveEntryPath(entries, "", decodeXml(rootfile[0]));
  const opfDir = dirName(opfPath);
  if (!entries[opfPath]) throw new Error("This EPUB's package document is missing.");
  const opf = strFromU8(entries[opfPath]);

  const manifest = {};
  for (const match of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = attr(match[0], "id");
    const href = attr(match[0], "href");
    if (!id || !href) continue;
    manifest[id] = resolveEntryPath(entries, opfDir, decodeXml(href));
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*>/g)].map((match) => attr(match[0], "idref")).filter(Boolean);
  const order = spine.length ? spine : Object.keys(manifest);

  const chapters = [];
  for (const id of order) {
    const path = manifest[id];
    if (!path || !entries[path] || !/\.x?html?$/i.test(path)) continue;
    const raw = strFromU8(entries[path]);
    chapters.push(inlineImages(bodyContent(raw), dirName(path), entries));
  }
  if (!chapters.length) throw new Error("No readable chapters were found in this eBook.");

  return sanitizeHtmlForOffline(chapters.join('\n<hr class="chapter-break"/>\n'));
}

// Pull just the <body> contents when present so we don't nest <html>/<head>.
function bodyContent(html) {
  const match = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return match ? match[1] : html;
}

// Replace <img src="..."> / SVG <image xlink:href="..."> that point at packaged
// images with inline data URLs; leave already-inline data: URLs untouched.
function inlineImages(html, baseDir, entries) {
  return html.replace(/\b(src|xlink:href|href)\s*=\s*("([^"]*)"|'([^']*)')/gi, (whole, name, _quoted, double, single) => {
    const value = double !== undefined ? double : single;
    if (!value) return whole;
    if (/^(data:|https?:|\/\/|mailto:|#)/i.test(value)) return whole;
    if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(value)) return whole;
    const path = resolveEntryPath(entries, baseDir, value.split("#")[0]);
    const bytes = entries[path];
    if (!bytes) return whole;
    return `${name}="data:${mimeForImage(path)};base64,${bytesToBase64(bytes)}"`;
  });
}

// --- Shared HTML safety --------------------------------------------------------

/*
 * This HTML comes out of a .docx/.epub the user opened, and gets rendered to a
 * canvas in a sandboxed iframe. The sandbox and the CSP are the real controls;
 * this is the layer under them.
 *
 * It used to be a blocklist — strip <script>, strip on*="..." — and a blocklist
 * only stops the attacks you listed. Measured against the old version, all of
 * these went straight through:
 *
 *   <img src=x onerror=alert(1)>          unquoted, so the on*="..." regex missed it
 *   <img src=x onerror=`alert(1)`>        backticks, likewise
 *   <svg onload=alert(1)>                 likewise
 *   <iframe src=https://evil.test/x>      unquoted, so the remote-URL regex missed it
 *
 * So it is an ALLOWLIST now, which fails closed: an attribute nobody named is
 * dropped whatever it is quoted with, and a tag nobody named loses its markup.
 * Nothing here needs to know that `onerror` is dangerous.
 */

// Tags kept, with their attributes filtered. Everything else has its markup
// removed and its text content preserved.
const ALLOWED_TAGS = new Set([
  "html", "head", "body", "title",
  "p", "div", "span", "br", "hr", "pre", "blockquote", "center",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "strike", "sub", "sup", "small", "big", "font", "code", "kbd", "var", "abbr", "mark",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
  "a", "img", "figure", "figcaption",
  "section", "article", "header", "footer", "nav", "main", "aside", "style",
]);

// Elements removed WITH their contents: their text is markup, not prose, or
// their whole purpose is to fetch or execute something.
const DROP_WITH_CONTENT = ["script", "noscript", "template", "iframe", "object", "embed", "applet", "frameset", "frame", "svg", "math", "audio", "video", "canvas"];

// Void elements dropped outright. `meta` earns its place here on its own:
// <meta http-equiv="refresh"> navigates, which no document preview should do.
const DROP_VOID = ["link", "base", "meta", "source", "track", "param"];

// Presentation and structure only. No event handler can appear here, because
// no name here starts with "on".
const ALLOWED_ATTRS = new Set([
  "class", "id", "style", "title", "alt", "dir", "lang",
  "colspan", "rowspan", "align", "valign", "width", "height", "span",
  "border", "cellpadding", "cellspacing", "bgcolor", "color", "face", "size",
  "start", "value", "type", "reversed",
  "src", "href",
]);

const VOID_TAGS = new Set(["br", "hr", "img", "col"]);

/** Only data: URIs and same-document fragments survive. */
function safeUrl(value) {
  const trimmed = String(value).trim();
  if (/^#/.test(trimmed)) return trimmed;
  // An image embedded by the converter is a data: URI, which is the whole
  // reason data: is allowed here at all. data:text/html would be a navigation
  // target, so only images pass.
  if (/^data:image\/(png|jpe?g|gif|webp|bmp|x-icon)[;,]/i.test(trimmed)) return trimmed;
  return "";
}

/** Drop url(...) that points anywhere off this page, in CSS text or a style attribute. */
function safeCss(value) {
  return String(value).replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (whole, quote, url) => {
    const safe = safeUrl(url);
    return safe ? `url(${quote}${safe}${quote})` : "none";
  });
}

function sanitizeAttributes(raw) {
  const kept = [];
  // Matches name="value", name='value', name=value and bare name.
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  let match;
  while ((match = pattern.exec(raw))) {
    const name = match[1].toLowerCase();
    if (!ALLOWED_ATTRS.has(name)) continue;
    let value = match[2] ?? match[3] ?? match[4] ?? "";
    if (name === "src" || name === "href") {
      value = safeUrl(value);
      // An <img> with no source renders as a broken-image box; dropping the
      // attribute entirely is quieter and says the same thing.
      if (!value) continue;
    }
    if (name === "style") value = safeCss(value);
    kept.push(`${name}="${value.replace(/"/g, "&quot;")}"`);
  }
  return kept.length ? ` ${kept.join(" ")}` : "";
}

export function sanitizeHtmlForOffline(html) {
  let out = String(html || "");
  // Comments first: a conditional comment can hide a whole tag from the tag
  // scanner below.
  out = out.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  for (const tag of DROP_WITH_CONTENT) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, "gi"), "");
    // An unclosed one would otherwise leave its opening tag behind.
    out = out.replace(new RegExp(`</?${tag}\\b[^>]*>`, "gi"), "");
  }
  for (const tag of DROP_VOID) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>`, "gi"), "");
  }
  // CSS inside a surviving <style> can still fetch.
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (whole, open, css, close) => open + safeCss(css) + close);
  // Every remaining tag: keep it if it is allowlisted, with allowlisted
  // attributes only; otherwise remove the markup and leave the text.
  return out.replace(/<\s*(\/?)\s*([a-zA-Z][-a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (whole, slash, tag, attrs) => {
    const name = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return "";
    if (slash) return `</${name}>`;
    const rendered = `<${name}${sanitizeAttributes(attrs)}`;
    return VOID_TAGS.has(name) ? `${rendered} />` : `${rendered}>`;
  });
}

// --- Low-level helpers ---------------------------------------------------------

/*
 * Zip-bomb limits.
 *
 * A .pptx and an .epub are both ZIP archives the user hands us, and
 * unzipSync with no ceiling will happily expand a 40 KB file into every byte of
 * memory the tab can get, which locks the whole page up. These numbers are
 * generous for real documents — a photo-heavy deck runs to tens of megabytes
 * unpacked — and nowhere near what a bomb needs.
 */
const ZIP_LIMITS = {
  totalBytes: 300 * 1024 * 1024,
  entryBytes: 100 * 1024 * 1024,
  // Ratio alone is a bad test: a small file of repeated bytes compresses
  // enormously and is harmless. Only ratios on entries that are already large
  // once unpacked mean anything, hence the floor.
  maxRatio: 200,
  ratioFloorBytes: 1024 * 1024,
};

function unzipEntries(arrayBuffer, message) {
  let budget = ZIP_LIMITS.totalBytes;
  let refusal = "";
  try {
    const entries = unzipSync(new Uint8Array(arrayBuffer), {
      filter: (entry) => {
        const unpacked = entry.originalSize || 0;
        // A ZIP may name an entry "../../x" or "/etc/x". Nothing in these
        // documents needs to escape its own archive, so refuse rather than
        // normalise — the caller looks entries up by name and a name it does
        // not expect simply goes unread.
        if (/^([a-zA-Z]:)?[\\/]/.test(entry.name) || entry.name.split(/[\\/]/).includes("..")) {
          refusal = refusal || "This archive contains a file path that points outside it, so it was not opened.";
          return false;
        }
        if (unpacked > ZIP_LIMITS.entryBytes) {
          refusal = refusal || "One part of this file is too large to open safely.";
          return false;
        }
        if (unpacked > ZIP_LIMITS.ratioFloorBytes && entry.size > 0 && unpacked / entry.size > ZIP_LIMITS.maxRatio) {
          refusal = refusal || "This file expands far more than its size suggests, so it was not opened.";
          return false;
        }
        budget -= unpacked;
        if (budget < 0) {
          refusal = refusal || "This file unpacks to more than this tool will hold in memory.";
          return false;
        }
        return true;
      },
    });
    // A refusal that skipped a needed part would otherwise surface later as a
    // confusing "could not find" error, so say what actually happened.
    if (refusal) throw Object.assign(new Error(refusal), { zipRefusal: true });
    return entries;
  } catch (error) {
    if (error?.zipRefusal) throw error;
    throw new Error(message);
  }
}

function resolvePath(baseDir, relative) {
  const stack = baseDir ? baseDir.split("/").filter(Boolean) : [];
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function dirName(path) {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function mimeForImage(path) {
  const extension = path.toLowerCase().split(".").pop();
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "svg") return "image/svg+xml";
  return "image/jpeg";
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(binary, "binary").toString("base64");
}

// XML attribute order is not significant and either quote style is legal, so the
// pptx/epub parsing above matches a whole TAG first and then reads each attribute
// independently through these two helpers instead of assuming a fixed layout.
function attr(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The lookbehind stops `href` from matching `xlink:href` (and `x` from `cx`).
  const match = String(tag).match(new RegExp(`(?<![\\w:.-])${escaped}\\s*=\\s*("([^"]*)"|'([^']*)')`));
  if (!match) return null;
  return match[2] !== undefined ? match[2] : match[3];
}

// Values of the first tag matching `tagPattern` that carries every named
// attribute, in `names` order; null when no tag qualifies. Requiring the full set
// keeps unrelated same-name tags (e.g. `<a:ext uri=...>` inside `<a:extLst>`)
// from shadowing the real one, exactly as the old combined regexes did.
function tagAttrs(xml, tagPattern, names) {
  for (const match of String(xml).matchAll(tagPattern)) {
    const values = names.map((name) => attr(match[0], name));
    if (values.every((value) => value !== null)) return values;
  }
  return null;
}

// EPUB hrefs are URL-encoded per spec, so a file named "Chapter 01.xhtml" appears
// as "Chapter%2001.xhtml" while the ZIP entry keeps the literal space. Malformed
// escapes fall back to the raw value.
function decodeUri(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Resolve an href against the archive, preferring the decoded spelling but
// accepting the raw one so either encoding of a name resolves.
function resolveEntryPath(entries, baseDir, href) {
  const decoded = resolvePath(baseDir, decodeUri(href));
  if (entries[decoded]) return decoded;
  const raw = resolvePath(baseDir, href);
  return entries[raw] ? raw : decoded;
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
