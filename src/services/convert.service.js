import katex from "katex";
import { getPdfLib } from "./pdf.service.js";
import { parseCsv } from "./csv.service.js";

// A4 in PostScript points, shared by every PDF this service builds.
const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 54;

// --- Markdown to PDF (pure pdf-lib text layout, unit-testable in Node) -------

// Block sizes mirror simpleMarkdownToHtml's heading/list/paragraph structure so
// the PDF matches the app's Markdown preview, but stays crisp vector text.
const MARKDOWN_BLOCKS = {
  h1: { size: 22, bold: true, gap: 10, before: 14 },
  h2: { size: 17, bold: true, gap: 8, before: 12 },
  h3: { size: 14, bold: true, gap: 6, before: 10 },
  li: { size: 11, bold: false, gap: 5, before: 0, indent: 18, bullet: "• " },
  p: { size: 11, bold: false, gap: 8, before: 0 },
};

export async function markdownToPdf(markdown) {
  const value = String(markdown || "");
  if (!value.trim()) throw new Error("Add Markdown before creating a PDF.");
  const { PDFDocument, StandardFonts, rgb } = getPdfLib();
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.06, 0.08, 0.12);

  const blocks = parseMarkdownBlocks(value);
  const maxWidth = A4.width - MARGIN * 2;
  let page = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;

  for (const block of blocks) {
    const style = MARKDOWN_BLOCKS[block.type];
    const font = style.bold ? bold : regular;
    const indent = style.indent || 0;
    const prefix = style.bullet || "";
    const lineHeight = style.size * 1.35;
    y -= style.before;
    const lines = wrapByWidth(font, prefix + block.text, style.size, maxWidth - indent);
    for (const line of lines) {
      if (y - lineHeight < MARGIN) {
        page = pdf.addPage([A4.width, A4.height]);
        y = A4.height - MARGIN;
      }
      drawText(page, line, { x: MARGIN + indent, y: y - style.size, size: style.size, font, color: ink });
      y -= lineHeight;
    }
    y -= style.gap;
  }
  return pdf.save();
}

function parseMarkdownBlocks(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const raw = line.trim();
      if (!raw) return null;
      if (/^###\s+/.test(raw)) return { type: "h3", text: stripInline(raw.replace(/^###\s+/, "")) };
      if (/^##\s+/.test(raw)) return { type: "h2", text: stripInline(raw.replace(/^##\s+/, "")) };
      if (/^#\s+/.test(raw)) return { type: "h1", text: stripInline(raw.replace(/^#\s+/, "")) };
      if (/^[-*]\s+/.test(raw)) return { type: "li", text: stripInline(raw.replace(/^[-*]\s+/, "")) };
      return { type: "p", text: stripInline(raw) };
    })
    .filter(Boolean);
}

// pdf-lib standard fonts have no bold/italic runs, so drop the inline markers
// rather than render literal asterisks/backticks.
function stripInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1");
}

// --- CSV to PDF (paginated table, pure pdf-lib, unit-testable in Node) --------

export async function csvToPdf(csvText) {
  const value = String(csvText || "");
  if (!value.trim()) throw new Error("Add CSV content before creating a PDF.");
  const rows = parseCsv(value).filter((row) => row.some((cell) => String(cell).trim() !== ""));
  if (!rows.length) throw new Error("No rows found in the CSV.");

  const { PDFDocument, StandardFonts, rgb } = getPdfLib();
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const [header, ...body] = rows;
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const fontSize = 9;
  const cellPadding = 4;
  const lineHeight = fontSize * 1.25;
  const tableWidth = A4.width - MARGIN * 2;
  const columnWidth = tableWidth / columnCount;
  const ink = rgb(0.1, 0.12, 0.18);
  const line = rgb(0.72, 0.75, 0.8);
  const headerFill = rgb(0.93, 0.94, 0.96);

  let page = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;

  const drawRow = (cells, isHeader) => {
    const font = isHeader ? bold : regular;
    const wrapped = [];
    for (let column = 0; column < columnCount; column += 1) {
      wrapped.push(wrapByWidth(font, String(cells[column] ?? ""), fontSize, columnWidth - cellPadding * 2));
    }
    const rowLines = Math.max(1, ...wrapped.map((lines) => lines.length));
    const rowHeight = rowLines * lineHeight + cellPadding * 2;

    if (y - rowHeight < MARGIN) {
      page = pdf.addPage([A4.width, A4.height]);
      y = A4.height - MARGIN;
      if (!isHeader) drawRow(header, true);
    }

    const top = y;
    if (isHeader) {
      page.drawRectangle({ x: MARGIN, y: top - rowHeight, width: tableWidth, height: rowHeight, color: headerFill });
    }
    for (let column = 0; column <= columnCount; column += 1) {
      const x = MARGIN + column * columnWidth;
      page.drawLine({ start: { x, y: top }, end: { x, y: top - rowHeight }, thickness: 0.5, color: line });
    }
    page.drawLine({ start: { x: MARGIN, y: top }, end: { x: MARGIN + tableWidth, y: top }, thickness: 0.5, color: line });
    page.drawLine({ start: { x: MARGIN, y: top - rowHeight }, end: { x: MARGIN + tableWidth, y: top - rowHeight }, thickness: 0.5, color: line });

    for (let column = 0; column < columnCount; column += 1) {
      let textY = top - cellPadding - fontSize;
      for (const cellLine of wrapped[column]) {
        drawText(page, cellLine, { x: MARGIN + column * columnWidth + cellPadding, y: textY, size: fontSize, font, color: ink });
        textY -= lineHeight;
      }
    }
    y -= rowHeight;
  };

  drawRow(header, true);
  for (const row of body) drawRow(row, false);
  return pdf.save();
}

// --- Equation to markup (KaTeX, pure, unit-testable in Node) ------------------

export function renderEquationToHtml(latex, options = {}) {
  const value = String(latex || "").trim();
  if (!value) throw new Error("Enter a LaTeX equation.");
  try {
    return katex.renderToString(value, {
      displayMode: options.displayMode !== false,
      throwOnError: true,
      output: "html",
    });
  } catch (error) {
    throw new Error(`Invalid LaTeX: ${error?.message || "could not parse the equation."}`);
  }
}

// --- Canvas to PDF (browser-only: needs canvas.toBlob) ------------------------

// One rendered canvas (e.g. an HTML capture) may be taller than a page, so slice
// it vertically into A4-width pages. Used by HTML to PDF.
export async function canvasToPdf(canvas) {
  const { PDFDocument } = getPdfLib();
  const pdf = await PDFDocument.create();
  const scale = A4.width / canvas.width;
  const sliceHeightPx = Math.max(1, Math.floor(A4.height / scale));
  for (let offset = 0; offset < canvas.height; offset += sliceHeightPx) {
    const height = Math.min(sliceHeightPx, canvas.height - offset);
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = height;
    const context = slice.getContext("2d");
    if (!context) throw new Error("This browser cannot create a 2D image workspace.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, slice.width, height);
    context.drawImage(canvas, 0, offset, canvas.width, height, 0, 0, canvas.width, height);
    const image = await pdf.embedJpg(await canvasJpegBytes(slice));
    const page = pdf.addPage([A4.width, height * scale]);
    page.drawImage(image, { x: 0, y: 0, width: A4.width, height: height * scale });
  }
  return pdf.save();
}

// One page per canvas, page sized to the image (mirrors imagesToPdf). Used by
// Handwriting to PDF and Scan to PDF.
export async function canvasesToPdf(canvases) {
  if (!canvases.length) throw new Error("Add at least one page.");
  const { PDFDocument } = getPdfLib();
  const pdf = await PDFDocument.create();
  for (const canvas of canvases) {
    const image = await pdf.embedJpg(await canvasJpegBytes(canvas));
    const page = pdf.addPage([canvas.width, canvas.height]);
    page.drawImage(image, { x: 0, y: 0, width: canvas.width, height: canvas.height });
  }
  return pdf.save();
}

async function canvasJpegBytes(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("This browser cannot convert the page to an image.");
  return new Uint8Array(await blob.arrayBuffer());
}

// --- Shared helpers -----------------------------------------------------------

// Wrap by measured glyph width so headings and body text stay inside the margin
// regardless of font size (font.widthOfTextAtSize works in Node too).
function wrapByWidth(font, text, size, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let current = "";
  for (const word of words) {
    let token = word;
    // Break a single word that is wider than the column.
    while (measureWidth(font, token, size) > maxWidth && token.length > 1) {
      const cut = widestFittingPrefix(font, token, size, maxWidth);
      if (current) { lines.push(current); current = ""; }
      lines.push(token.slice(0, cut));
      token = token.slice(cut);
    }
    const candidate = current ? `${current} ${token}` : token;
    if (measureWidth(font, candidate, size) > maxWidth && current) {
      lines.push(current);
      current = token;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

// Longest prefix of `token` (never shorter than one character, so the caller
// always makes progress) that still fits `maxWidth`. Binary search instead of
// stepping down one character at a time: a single 8000-character token used to
// re-measure a near-full-length string thousands of times and froze the tab.
function widestFittingPrefix(font, token, size, maxWidth) {
  let low = 1;
  let high = token.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measureWidth(font, token.slice(0, mid), size) > maxWidth) high = mid - 1;
    else low = mid;
  }
  return low;
}

// Standard fonts throw the same WinAnsi error when measuring non-Latin-1 text,
// so surface the friendly message here too (before any drawing happens).
function measureWidth(font, text, size) {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch (error) {
    if (/cannot encode|WinAnsi/i.test(String(error?.message))) {
      throw new Error("This tool supports Latin-1 characters only (no CJK/emoji).");
    }
    throw error;
  }
}

// pdf-lib's standard fonts cover Latin-1 (WinAnsi) only. Mirror pdf.service's
// friendly error instead of leaking the cryptic encoder message.
function drawText(page, text, options) {
  try {
    page.drawText(text, options);
  } catch (error) {
    if (/cannot encode|WinAnsi/i.test(String(error?.message))) {
      throw new Error("This tool supports Latin-1 characters only (no CJK/emoji).");
    }
    throw error;
  }
}
