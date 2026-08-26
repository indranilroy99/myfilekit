// PDF -> Word / Excel / HTML / EPUB exports (Phase 4b). Everything here is 100%
// local: text and its coordinates come from the locally-bundled pdf.js, .docx is
// written by the bundled `docx` library, .xlsx by the VENDORED SheetJS build
// (see office.service.js `loadXlsx`), and the EPUB container is zipped with
// `fflate`. No function ever touches the network.
//
// The pdf.js-backed readers are browser-only (the worker is imported with Vite's
// `?worker`), so they lazily import ../lib/pdfjs exactly like
// pdf-render.service.js does. Everything that shapes the extracted text into a
// document — line grouping, table clustering, HTML/XHTML building — is a pure
// function so it stays unit-testable in Node.

import { zipSync, strToU8 } from "fflate";
import { loadXlsx } from "./office.service.js";
import { pdfToImages } from "./pdf-render.service.js";

async function getPdfjs() {
  return import("../lib/pdfjs");
}

// --- Positioned text extraction ----------------------------------------------

/**
 * Reads every page's text runs together with their position, in top-left CSS
 * coordinates (y grows downwards) at 1:1 point scale. This is the raw material
 * for line grouping, table clustering, and positioned HTML.
 */
export async function extractPositionedPages(file, { onProgress } = {}) {
  const { loadPdfDocument } = await getPdfjs();
  let pdf;
  try {
    pdf = await loadPdfDocument(file);
  } catch (error) {
    // pdf.js reports parse failures as raw messages like "Invalid PDF structure";
    // every other parser here gives actionable guidance, so this one should too.
    throw new Error("This file could not be read as a PDF. If it is damaged, try the Repair PDF tool first.");
  }
  const pages = [];
  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = [];
      for (const item of content.items) {
        if (typeof item.str !== "string" || !item.str.trim()) continue;
        const transform = item.transform || [1, 0, 0, 1, 0, 0];
        const height = Math.abs(transform[3]) || Math.abs(item.height) || 10;
        items.push({
          text: item.str,
          x: transform[4],
          // pdf.js reports a bottom-left origin; flip to top-left so the same
          // numbers drive HTML layout and reading order.
          y: viewport.height - transform[5],
          width: item.width || 0,
          height,
        });
      }
      pages.push({ number: pageNum, width: viewport.width, height: viewport.height, items });
      page.cleanup();
      onProgress?.(pageNum, pdf.numPages);
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}

/** Convenience: one plain-text string per page, blank lines preserved. */
export async function extractPdfPageTexts(file, { onProgress } = {}) {
  const pages = await extractPositionedPages(file, { onProgress });
  return pages.map((page) => linesToText(groupItemsIntoLines(page.items)));
}

// --- Pure text-shaping helpers (unit-testable) --------------------------------

/**
 * Groups positioned runs into visual lines by vertical proximity, then orders
 * each line left-to-right and the lines top-to-bottom.
 */
export function groupItemsIntoLines(items, tolerance = 2) {
  const sorted = [...(items || [])].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const item of sorted) {
    const line = lines[lines.length - 1];
    const limit = Math.max(tolerance, (item.height || 10) * 0.5);
    if (line && Math.abs(item.y - line.y) <= limit) {
      line.items.push(item);
      line.height = Math.max(line.height, item.height || 0);
    } else {
      lines.push({ y: item.y, height: item.height || 10, items: [item] });
    }
  }
  return lines.map((line) => {
    const ordered = line.items.sort((a, b) => a.x - b.x);
    return { ...line, items: ordered, x: ordered[0].x, text: joinRuns(ordered) };
  });
}

// Runs inside one line are separated by a space only when the gap suggests one,
// so "Total" + ":" does not become "Total :".
function joinRuns(items) {
  let text = "";
  let end = null;
  for (const item of items) {
    if (end !== null && item.x - end > 1 && !text.endsWith(" ") && !item.text.startsWith(" ")) text += " ";
    text += item.text;
    end = item.x + (item.width || 0);
  }
  return text.replace(/\s+/g, " ").trim();
}

/** Joins grouped lines into text, inserting a blank line on a large y gap. */
export function linesToText(lines) {
  const out = [];
  let previous = null;
  for (const line of lines) {
    if (previous) {
      const baseline = Math.max(previous.height, line.height, 1);
      if (line.y - previous.y > baseline * 1.8) out.push("");
    }
    out.push(line.text);
    previous = line;
  }
  return out.join("\n").trim();
}

/**
 * Splits one line into table cells: runs separated by a horizontal gap wider
 * than roughly half the glyph height start a new cell.
 */
export function groupLineIntoCells(line, { gap } = {}) {
  const threshold = gap || Math.max(6, (line.height || 10) * 0.6);
  const cells = [];
  let current = null;
  for (const item of line.items) {
    if (!current) {
      current = { x: item.x, end: item.x + (item.width || 0), text: item.text };
      continue;
    }
    const distance = item.x - current.end;
    if (distance > threshold) {
      cells.push(current);
      current = { x: item.x, end: item.x + (item.width || 0), text: item.text };
    } else {
      if (distance > 1 && !current.text.endsWith(" ") && !item.text.startsWith(" ")) current.text += " ";
      current.text += item.text;
      current.end = Math.max(current.end, item.x + (item.width || 0));
    }
  }
  if (current) cells.push(current);
  return cells.map((cell) => ({ ...cell, text: cell.text.replace(/\s+/g, " ").trim() }));
}

/** 1-D clustering of cell start positions into shared column anchors. */
export function clusterColumns(cells, tolerance = 12) {
  const xs = (cells || []).map((cell) => cell.x).sort((a, b) => a - b);
  const groups = [];
  for (const x of xs) {
    const last = groups[groups.length - 1];
    if (last && x - last.max <= tolerance) {
      last.max = x;
      last.values.push(x);
    } else {
      groups.push({ max: x, values: [x] });
    }
  }
  return groups.map((group) => group.values.reduce((sum, value) => sum + value, 0) / group.values.length);
}

/**
 * Reconstructs a table from positioned runs: lines become rows, and cells are
 * snapped to the nearest shared column anchor. Works well on ruled/tabular
 * PDFs; free-flowing prose comes back as one wide column per line.
 */
export function itemsToTableRows(items, { lineTolerance = 2, columnTolerance = 12 } = {}) {
  const lines = groupItemsIntoLines(items, lineTolerance);
  const perLine = lines.map((line) => groupLineIntoCells(line));
  const columns = clusterColumns(perLine.flat(), columnTolerance);
  if (!columns.length) return [];
  const rows = perLine.map((cells) => {
    const row = new Array(columns.length).fill("");
    for (const cell of cells) {
      const index = nearestIndex(columns, cell.x);
      row[index] = row[index] ? `${row[index]} ${cell.text}` : cell.text;
    }
    return row;
  });
  return rows.filter((row) => row.some((cell) => cell !== ""));
}

function nearestIndex(columns, x) {
  let best = 0;
  let bestDistance = Infinity;
  columns.forEach((column, index) => {
    const distance = Math.abs(column - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

// --- PDF -> Word (.docx) ------------------------------------------------------

/**
 * Builds a real .docx from the PDF's text: one paragraph per detected line, a
 * blank paragraph where the PDF had vertical space, and a page break between
 * pages. Text-focused by design — columns, tables, and images are not laid out.
 */
export async function pdfToDocx(file, { title, onProgress } = {}) {
  const pageTexts = await extractPdfPageTexts(file, { onProgress });
  return buildDocx(pageTexts, { title: title || "Converted document" });
}

/** Pure(ish) docx writer: takes one string per page. Testable in Node. */
export async function buildDocx(pageTexts, { title = "Converted document" } = {}) {
  const pages = (pageTexts || []).map((text) => String(text ?? ""));
  if (!pages.length || pages.every((text) => !text.trim())) {
    throw new Error("No selectable text was found in this PDF, so there is nothing to put in a Word file. Scanned PDFs need OCR first.");
  }
  const { Document, Packer, Paragraph, TextRun, PageBreak } = await import("docx");

  const children = [];
  pages.forEach((text, index) => {
    if (index > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    const lines = text.split(/\r?\n/);
    if (!lines.length) lines.push("");
    for (const line of lines) {
      children.push(new Paragraph({ children: [new TextRun({ text: line, font: "Calibri", size: 22 })] }));
    }
  });

  const document = new Document({
    creator: "MyFileKit",
    title,
    description: "Converted from PDF locally in the browser by MyFileKit.",
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(document));
}

// --- PDF -> Excel (.xlsx) ----------------------------------------------------

/**
 * Reconstructs a table per page from text coordinates and writes a workbook
 * with the VENDORED SheetJS build (one sheet per page).
 *
 * @param {File} file
 * @param {{ columnTolerance?: number, onProgress?: (page: number, total: number) => void }} [options]
 */
export async function pdfToXlsx(file, { columnTolerance = 12, onProgress } = {}) {
  const pages = await extractPositionedPages(file, { onProgress });
  const sheets = pages.map((page) => ({
    name: `Page ${page.number}`,
    rows: itemsToTableRows(page.items, { columnTolerance }),
  }));
  const filled = sheets.filter((sheet) => sheet.rows.length);
  if (!filled.length) {
    throw new Error("No selectable text was found in this PDF, so no table could be rebuilt. Scanned PDFs need OCR first.");
  }
  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();
  for (const sheet of filled) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name.slice(0, 31));
  }
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const columns = filled.reduce((max, sheet) => Math.max(max, ...sheet.rows.map((row) => row.length)), 0);
  return {
    bytes: new Uint8Array(bytes),
    sheets: filled.length,
    rows: filled.reduce((total, sheet) => total + sheet.rows.length, 0),
    columns,
  };
}

// --- PDF -> HTML -------------------------------------------------------------

/**
 * Produces one self-contained .html file. With `pageImages` the rendered page
 * is embedded as a data URL and the text sits invisibly on top (selectable and
 * searchable); without it you get positioned text on a blank page. Either way
 * the file has no remote references at all.
 *
 * @param {File} file
 * @param {{ pageImages?: boolean, dpi?: number, quality?: number, title?: string, onProgress?: (page: number, total: number) => void }} [options]
 */
export async function pdfToHtml(file, { pageImages = true, dpi = 150, quality = 0.85, title, onProgress } = {}) {
  const pages = await extractPositionedPages(file);
  let images = [];
  if (pageImages) {
    images = await pdfToImages(file, { format: "jpg", dpi, quality, onProgress });
  } else {
    pages.forEach((page, index) => onProgress?.(index + 1, pages.length));
  }
  const withImages = [];
  for (let index = 0; index < pages.length; index += 1) {
    const image = images[index];
    withImages.push({
      ...pages[index],
      imageDataUrl: image ? await blobToDataUrl(image.blob) : null,
    });
  }
  return buildHtmlDocument(withImages, { title: title || "Converted PDF" });
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type || "image/jpeg"};base64,${bytesToBase64(bytes)}`;
}

const HTML_PAGE_CSS = [
  ":root{color-scheme:light}",
  "body{margin:0;background:#f3f4f6;font-family:Helvetica,Arial,sans-serif}",
  ".pdf-page{position:relative;margin:16px auto;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.2);overflow:hidden}",
  ".pdf-page img{position:absolute;inset:0;width:100%;height:100%;display:block}",
  ".pdf-text{position:absolute;white-space:pre;transform-origin:0 0;line-height:1}",
  ".pdf-page.has-image .pdf-text{color:transparent}",
  ".pdf-page.has-image .pdf-text::selection{background:rgba(64,120,255,.35)}",
].join("");

/**
 * Pure HTML builder. Every string that comes from the PDF is escaped, so a PDF
 * containing `<script>` can never execute in the exported file.
 */
export function buildHtmlDocument(pages, { title = "Converted PDF" } = {}) {
  const body = (pages || [])
    .map((page) => {
      const spans = groupItemsIntoLines(page.items || [])
        .flatMap((line) => line.items)
        .map((item) => {
          const size = Math.max(1, Number(item.height) || 10);
          const top = (Number(item.y) || 0) - size;
          return `<span class="pdf-text" style="left:${round(item.x)}px;top:${round(top)}px;font-size:${round(size)}px">${escapeHtml(item.text)}</span>`;
        })
        .join("");
      const image = page.imageDataUrl
        ? `<img alt="Page ${escapeHtml(page.number ?? "")}" src="${escapeHtml(page.imageDataUrl)}"/>`
        : "";
      return `<section class="pdf-page${page.imageDataUrl ? " has-image" : ""}" style="width:${round(page.width)}px;height:${round(page.height)}px">${image}${spans}</section>`;
    })
    .join("\n");
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>${HTML_PAGE_CSS}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

function round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// --- PDF -> EPUB 3 -----------------------------------------------------------

/** Extracts text per page and packages it as a minimal, valid EPUB 3. */
export async function pdfToEpub(file, { title, author, onProgress } = {}) {
  const pageTexts = await extractPdfPageTexts(file, { onProgress });
  return buildEpub(pageTexts, { title: title || "Converted PDF", author: author || "MyFileKit" });
}

/**
 * Pure EPUB 3 writer. `mimetype` is written FIRST and stored uncompressed, as
 * the OCF specification requires; everything else is deflated.
 */
export function buildEpub(pageTexts, { title = "Converted PDF", author = "MyFileKit", language = "en", identifier } = {}) {
  const pages = (pageTexts || []).map((text) => String(text ?? ""));
  if (!pages.length || pages.every((text) => !text.trim())) {
    throw new Error("No selectable text was found in this PDF, so there is nothing to put in an eBook. Scanned PDFs need OCR first.");
  }
  const id = identifier || `urn:uuid:${randomUuid()}`;
  const width = String(pages.length).length;
  const chapters = pages.map((text, index) => ({
    id: `page-${String(index + 1).padStart(width, "0")}`,
    label: `Page ${index + 1}`,
    text,
  }));

  const container = '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>\n';

  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    ...chapters.map((chapter) => `<item id="${chapter.id}" href="${chapter.id}.xhtml" media-type="application/xhtml+xml"/>`),
  ].join("\n    ");
  const spine = ['<itemref idref="nav"/>', ...chapters.map((chapter) => `<itemref idref="${chapter.id}"/>`)].join("\n    ");
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(id)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>${escapeXml(language)}</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
  </metadata>
  <manifest>
    ${manifest}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>
`;

  const nav = xhtmlDocument(
    title,
    `<nav epub:type="toc" id="toc"><h1>${escapeXml(title)}</h1><ol>${chapters
      .map((chapter) => `<li><a href="${chapter.id}.xhtml">${escapeXml(chapter.label)}</a></li>`)
      .join("")}</ol></nav>`
  );

  const entries = {
    // Stored, uncompressed, and first in the archive (OCF requirement).
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(container),
    "EPUB/package.opf": strToU8(opf),
    "EPUB/nav.xhtml": strToU8(nav),
  };
  for (const chapter of chapters) {
    const body = `<h2>${escapeXml(chapter.label)}</h2>${textToXhtmlParagraphs(chapter.text)}`;
    entries[`EPUB/${chapter.id}.xhtml`] = strToU8(xhtmlDocument(chapter.label, body));
  }
  return { bytes: zipSync(entries, { level: 6 }), chapters: chapters.length };
}

function xhtmlDocument(title, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8"/><title>${escapeXml(title)}</title></head>
<body>
${body}
</body>
</html>
`;
}

// Blank lines separate paragraphs; single newlines become <br/> so the PDF's
// line structure survives. Text is escaped before it ever reaches the markup.
function textToXhtmlParagraphs(text) {
  const blocks = String(text || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (!blocks.length) return "<p/>";
  return blocks
    .map((block) => `<p>${block.split(/\n/).map((line) => escapeXml(line)).join("<br/>")}</p>`)
    .join("\n");
}

// --- Shared helpers ----------------------------------------------------------

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeXml(value) {
  return escapeHtml(value);
}

function randomUuid() {
  const source = globalThis.crypto;
  if (source?.randomUUID) return source.randomUUID();
  const bytes = new Uint8Array(16);
  if (source?.getRandomValues) source.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
