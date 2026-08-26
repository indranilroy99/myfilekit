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
  const sizeMatch = presentation.match(/<p:sldSz[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  const slideWEmu = sizeMatch ? Number(sizeMatch[1]) : 9144000;
  const slideHEmu = sizeMatch ? Number(sizeMatch[2]) : 6858000;

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
  for (const match of xml.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)) {
    map[match[1]] = match[2];
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
      const embed = block.match(/<a:blip\b[^>]*r:embed="([^"]+)"/);
      const image = embed ? imageFromRel(rels[embed[1]], entries) : null;
      if (image) elements.push({ type: "image", dataUrl: image, box });
    } else {
      const isTitle = /<p:ph\b[^>]*type="(title|ctrTitle)"/.test(block);
      const paragraphs = parseParagraphs(block);
      if (paragraphs.some((p) => p.text)) elements.push({ type: "text", title: isTitle, paragraphs, box });
    }
  }
  return elements;
}

// EMU offset/extent -> fractional box (0..1) so callers can scale to any size.
function parseBox(block, slideWEmu, slideHEmu) {
  const off = block.match(/<a:off\b[^>]*\bx="(-?\d+)"[^>]*\by="(-?\d+)"/);
  const ext = block.match(/<a:ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  if (!off || !ext) return null;
  return {
    x: Number(off[1]) / slideWEmu,
    y: Number(off[2]) / slideHEmu,
    w: Number(ext[1]) / slideWEmu,
    h: Number(ext[2]) / slideHEmu,
  };
}

// Each <a:p> is a paragraph; its <a:t> runs are the text, <a:pPr lvl> the indent.
function parseParagraphs(block) {
  const paragraphs = [];
  for (const match of block.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)) {
    const paragraph = match[0];
    const level = paragraph.match(/<a:pPr\b[^>]*\blvl="(\d+)"/);
    const runs = [...paragraph.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((run) => decodeXml(run[1]));
    paragraphs.push({ text: runs.join(""), level: level ? Number(level[1]) : 0 });
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
  const opfMatch = strFromU8(container).match(/<rootfile\b[^>]*\bfull-path="([^"]+)"/);
  if (!opfMatch) throw new Error("This EPUB does not point to a package document.");
  const opfPath = opfMatch[1];
  const opfDir = dirName(opfPath);
  if (!entries[opfPath]) throw new Error("This EPUB's package document is missing.");
  const opf = strFromU8(entries[opfPath]);

  const manifest = {};
  for (const match of opf.matchAll(/<item\b[^>]*\bid="([^"]+)"[^>]*\bhref="([^"]+)"/g)) {
    manifest[match[1]] = resolvePath(opfDir, decodeXml(match[2]));
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map((match) => match[1]);
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
  return html.replace(/\b(src|xlink:href|href)\s*=\s*"([^"]+)"/gi, (whole, attr, value) => {
    if (/^(data:|https?:|\/\/|mailto:|#)/i.test(value)) return whole;
    if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(value)) return whole;
    const path = resolvePath(baseDir, value.split("#")[0]);
    const bytes = entries[path];
    if (!bytes) return whole;
    return `${attr}="data:${mimeForImage(path)};base64,${bytesToBase64(bytes)}"`;
  });
}

// --- Shared HTML safety --------------------------------------------------------

// Strip scripts, inline event handlers, and any remaining remote references so
// the rendered document stays fully offline (defence in depth on top of the CSP
// and the scriptless sandboxed iframe used to render it).
export function sanitizeHtmlForOffline(html) {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\b(src|href|xlink:href)\s*=\s*"(?:https?:|\/\/)[^"]*"/gi, '$1=""')
    .replace(/\b(src|href|xlink:href)\s*=\s*'(?:https?:|\/\/)[^']*'/gi, "$1=''");
}

// --- Low-level helpers ---------------------------------------------------------

function unzipEntries(arrayBuffer, message) {
  try {
    return unzipSync(new Uint8Array(arrayBuffer));
  } catch (error) {
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
