import { getPdfLib, drawPdfText } from "./pdf.service.js";
import { mapPdfFontToStandard, standardFontKey, wrapToWidth } from "./pdf-textedit.service.js";

// ---------------------------------------------------------------------------
// Genuine paragraph REFLOW for single-column PDF text documents.
//
// Unlike the in-place Edit PDF Text tool (which covers ONE run and redraws a
// wrapped replacement in the SAME box, moving nothing around it), reflow models
// the page's text as an ordered sequence of flowable BLOCKS (paragraph /
// heading / list-item), lets the user edit any block, then RE-LAYS-OUT the whole
// text column: an edit re-wraps its own block AND pushes the following blocks
// down (or up), repaginating to new pages when the column overflows. Surrounding
// paragraphs MOVE. This is real reflow.
//
// HONEST SCOPE (the UI states this plainly):
//   * Works well for SINGLE-COLUMN text documents. Multi-column pages, tables,
//     and complex layouts are DETECTED (detectColumnLayout) and the user is
//     warned that reflow may reorder/misplace content — Edit PDF Text is the
//     safer tool there.
//   * The output rebuilds the TEXT column on fresh pages of the original size.
//     Exact positioning of untouched paragraphs may shift slightly.
//   * Fonts are matched to base-14 substitutes (Helvetica/Times/Courier); the
//     original embedded font is not reused. Drawn text is Latin-1 (WinAnsi) only
//     — the shared safe-draw helper raises a friendly error for CJK/emoji.
//   * Non-text content (images) is re-anchored best-effort: rebuild draws any
//     images carried in the model, clamped to an existing output page.
//
// Split of concerns (so the model + layout engine stay pure and Node-testable):
//   * parseParagraphs / detectColumnLayout / flowBlocks are PURE — they take
//     pdf.js-shaped items or plain blocks and return plain data.
//   * rebuildReflowedPdf uses pdf-lib (via window.PDFLib) to draw + paginate.
//   * The pdf.js EXTRACTION from a real PDF is browser-only (needs a canvas +
//     the worker) and lives in the React component; it feeds pdf.js-shaped items
//     into these pure functions.
// ---------------------------------------------------------------------------

// A new block starts when the vertical gap to the previous line exceeds this
// multiple of the line's font size (a blank-line-sized gap = new paragraph).
const PARAGRAPH_GAP_FACTOR = 1.7;
// A line whose font is at least this much bigger than the document's body size
// reads as a heading.
const HEADING_SIZE_RATIO = 1.15;
// A first-line left-indent bigger than this multiple of the font size (relative
// to the block's established left edge) also breaks a new paragraph.
const INDENT_BREAK_FACTOR = 1.4;
// Two runs on the SAME line separated by a gap wider than this multiple of the
// font size look like side-by-side columns / table cells, not ordinary word
// spacing. Used only for layout detection, never for reflow.
const COLUMN_GAP_FACTOR = 3.2;

// Leading (line advance) as a multiple of font size, per block kind.
const PARAGRAPH_LINE_HEIGHT = 1.32;
const HEADING_LINE_HEIGHT = 1.2;
// Where the baseline sits below the top of a line's slot.
const ASCENT_RATIO = 0.8;
// Space inserted BEFORE a block (as a multiple of its font size), per kind.
const SPACE_BEFORE = { heading: 0.8, "list-item": 0.2, paragraph: 0.45 };
// Common list markers at the very start of a line.
const LIST_MARKER = /^\s*([•‣◦⁃∙*\-–]|\d{1,3}[.)]|[a-zA-Z][.)])\s+/;

// ---------------------------------------------------------------------------
// parseParagraphs — pure. pdf.js text items -> ordered flowable blocks.
// ---------------------------------------------------------------------------

/**
 * Groups pdf.js-shaped text items into paragraphs/headings/list-items in reading
 * order. Pure and Node-testable with synthetic items.
 *
 * Each item is `{ str, transform:[a,b,c,d,e,f], width, height, fontName }` — the
 * same shape pdf.js `getTextContent()` yields. `pageGeom` is `{ width, height }`
 * in PDF points, used only for the alignment guess.
 *
 * @param {Array<{str:string,transform:number[],width:number,height:number,fontName?:string}>} textItems
 * @param {{width:number,height:number}} pageGeom
 * @returns {Array<{type:"paragraph"|"heading"|"list-item",text:string,fontSize:number,fontName:string,fontKey:string,family:string,bold:boolean,italic:boolean,align:"left"|"center"|"right",left:number,right:number,top:number,isHeading:boolean,listMarker:string|null,color:null}>}
 */
export function parseParagraphs(textItems, pageGeom = {}) {
  const lines = groupItemsIntoLines(textItems);
  if (!lines.length) return [];

  const bodySize = medianOf(lines.map((line) => line.size)) || lines[0].size || 11;
  const pageWidth = Number(pageGeom.width) > 0 ? Number(pageGeom.width) : null;

  const blocks = [];
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const previous = lines[i - 1];
    const marker = LIST_MARKER.exec(line.text);
    const isHeadingLine = line.size >= bodySize * HEADING_SIZE_RATIO && line.text.length <= 120;

    // Decide whether this line CONTINUES the current block or STARTS a new one.
    let breakHere = !current;
    if (current && previous) {
      const gap = previous.baseline - line.baseline; // top-to-bottom, positive
      const normalLead = Math.max(previous.size, line.size);
      if (gap > normalLead * PARAGRAPH_GAP_FACTOR) breakHere = true; // blank-line gap
      else if (isHeadingLine !== current.isHeading) breakHere = true; // heading boundary
      else if (marker) breakHere = true; // a new list item
      else if (Math.abs(line.startX - current.left) > line.size * INDENT_BREAK_FACTOR) breakHere = true; // indent change
    }

    if (breakHere) {
      current = {
        lines: [line],
        left: line.startX,
        right: line.endX,
        top: line.baseline + line.size,
        size: line.size,
        fontName: line.fontName,
        isHeading: isHeadingLine,
        listMarker: marker ? marker[1] : null,
      };
      blocks.push(current);
    } else {
      current.lines.push(line);
      current.left = Math.min(current.left, line.startX);
      current.right = Math.max(current.right, line.endX);
      current.size = Math.max(current.size, line.size);
    }
  }

  return blocks.map((block) => finalizeBlock(block, pageWidth));
}

// Turns an accumulated block into the public flowable-block shape.
function finalizeBlock(block, pageWidth) {
  const text = block.lines.map((line) => line.text).join(" ").replace(/\s+/g, " ").trim();
  const style = mapPdfFontToStandard(block.fontName);
  const type = block.listMarker ? "list-item" : block.isHeading ? "heading" : "paragraph";
  return {
    type,
    text,
    fontSize: round2(block.size),
    fontName: block.fontName || "",
    fontKey: standardFontKey(style),
    family: style.family,
    bold: style.bold,
    italic: style.italic,
    align: guessAlign(block, pageWidth),
    left: round2(block.left),
    right: round2(block.right),
    top: round2(block.top),
    isHeading: type === "heading",
    listMarker: block.listMarker,
    color: null,
  };
}

// Clusters items into visual lines: sorted by baseline (top-first) then by x.
// A line break occurs when the baseline drops by more than a small tolerance.
function groupItemsIntoLines(textItems) {
  const items = [];
  for (const raw of Array.isArray(textItems) ? textItems : []) {
    if (!raw || typeof raw.str !== "string" || !raw.str.trim()) continue;
    const t = raw.transform;
    if (!Array.isArray(t) || t.length < 6) continue;
    const size = Math.hypot(Number(t[1]), Number(t[3])) || Math.abs(Number(t[3])) || Math.abs(Number(raw.height)) || 11;
    const x = Number(t[4]);
    const baseline = Number(t[5]);
    const width = Math.abs(Number(raw.width)) || 0;
    items.push({ str: raw.str, x, baseline, size, width, endX: x + width, fontName: String(raw.fontName || "") });
  }
  // Top-to-bottom, then left-to-right. A tiny baseline delta = same line.
  items.sort((a, b) => (b.baseline - a.baseline) || (a.x - b.x));

  const lines = [];
  let group = null;
  for (const item of items) {
    const tol = Math.max(2, item.size * 0.3);
    if (group && Math.abs(item.baseline - group.baseline) <= tol) {
      group.items.push(item);
    } else {
      group = { baseline: item.baseline, items: [item] };
      lines.push(group);
    }
  }
  return lines.map(buildLine);
}

// Reconstructs a line's text + geometry from its x-sorted items, inserting a
// space where a real horizontal gap sits between runs, and recording the widest
// internal gap (used to spot side-by-side / tabular content).
function buildLine(group) {
  const items = group.items.slice().sort((a, b) => a.x - b.x);
  let text = "";
  let maxGap = 0;
  let previous = null;
  for (const item of items) {
    if (previous) {
      const gap = item.x - previous.endX;
      if (gap > maxGap) maxGap = gap;
      const needsSpace = gap > previous.size * 0.25 && !/\s$/.test(text) && !/^\s/.test(item.str);
      if (needsSpace) text += " ";
    }
    text += item.str;
    previous = item;
  }
  const startX = items[0].x;
  const endX = items.reduce((max, item) => Math.max(max, item.endX), startX);
  const size = medianOf(items.map((item) => item.size)) || items[0].size;
  // Dominant font = the run covering the most horizontal width.
  const dominant = items.reduce((best, item) => (item.width > (best?.width || 0) ? item : best), items[0]);
  return { text: text.replace(/\s+/g, " ").trim(), startX, endX, baseline: group.baseline, size, maxGap, fontName: dominant.fontName };
}

// Alignment guess from the line box's margins within the page.
function guessAlign(block, pageWidth) {
  if (!pageWidth) return "left";
  const leftMargin = block.left;
  const rightMargin = pageWidth - block.right;
  const slack = block.size * 1.5;
  if (leftMargin > slack && Math.abs(leftMargin - rightMargin) <= slack) return "center";
  if (rightMargin <= slack && leftMargin > slack * 2) return "right";
  return "left";
}

// ---------------------------------------------------------------------------
// detectColumnLayout — pure. Column box + honest complexity flags.
// ---------------------------------------------------------------------------

/**
 * Derives the single text-column box and flags whether the page looks
 * multi-column or tabular (side-by-side content on shared lines). Pure.
 *
 * @param {Array} textItems  pdf.js-shaped items
 * @param {{width:number,height:number}} pageGeom
 * @returns {{column:{x:number,width:number,top:number,bottom:number},multiColumn:boolean,tableLike:boolean,complex:boolean,lineCount:number}}
 */
export function detectColumnLayout(textItems, pageGeom = {}) {
  const pageWidth = Number(pageGeom.width) > 0 ? Number(pageGeom.width) : 612;
  const pageHeight = Number(pageGeom.height) > 0 ? Number(pageGeom.height) : 792;
  const lines = groupItemsIntoLines(textItems);

  if (!lines.length) {
    const margin = 54;
    return {
      column: { x: margin, width: pageWidth - margin * 2, top: pageHeight - margin, bottom: margin },
      multiColumn: false,
      tableLike: false,
      complex: false,
      lineCount: 0,
    };
  }

  let minStart = Infinity;
  let maxEnd = -Infinity;
  let maxTop = -Infinity;
  let splitLines = 0;
  for (const line of lines) {
    minStart = Math.min(minStart, line.startX);
    maxEnd = Math.max(maxEnd, line.endX);
    maxTop = Math.max(maxTop, line.baseline + line.size);
    if (line.maxGap > line.size * COLUMN_GAP_FACTOR) splitLines += 1;
  }
  const leftMargin = Math.max(0, minStart);
  const rightMargin = Math.max(0, pageWidth - maxEnd);
  const top = Math.min(pageHeight - 12, maxTop);
  // Mirror the top margin as the bottom margin so reflow fills a balanced column.
  const bottom = Math.max(12, Math.min(pageHeight - top, leftMargin, rightMargin) || 54);

  // Tabular / multi-column if a meaningful share of lines carry side-by-side runs.
  const splitRatio = splitLines / lines.length;
  const tableLike = lines.length >= 3 && splitRatio >= 0.25;
  const multiColumn = tableLike && splitRatio >= 0.4;

  return {
    column: { x: round2(leftMargin), width: round2(Math.max(1, pageWidth - leftMargin - rightMargin)), top: round2(top), bottom: round2(bottom) },
    multiColumn,
    tableLike,
    complex: tableLike || multiColumn,
    lineCount: lines.length,
  };
}

// ---------------------------------------------------------------------------
// flowBlocks — pure. Lay blocks out down the column, paginating on overflow.
// ---------------------------------------------------------------------------

/**
 * Flows blocks down a text column, wrapping each block to the column width and
 * starting a new page when the column overflows. Pure and linear in the number
 * of blocks + wrapped lines. `options.measure(text, block)` returns the drawn
 * width of `text` at `block.fontSize` — in the browser/rebuild this is a pdf-lib
 * font's `widthOfTextAtSize`; in tests it can be any width model.
 *
 * @param {Array} blocks   flowable blocks (parseParagraphs output, possibly edited)
 * @param {{x:number,width:number,top:number,bottom:number}} column
 * @param {{measure?:(text:string,block:object)=>number}} options
 * @returns {{pages:Array<{lines:Array<{text:string,x:number,baseline:number,fontSize:number,block:number,type:string,color:object|null,align:string}>}>,lineCount:number,pageCount:number}}
 */
export function flowBlocks(blocks, column, options = {}) {
  const measure = typeof options.measure === "function" ? options.measure : () => 0;
  const col = normaliseColumn(column);
  const list = Array.isArray(blocks) ? blocks : [];

  const pages = [{ lines: [] }];
  let page = pages[0];
  let y = col.top;
  const startNewPage = () => {
    page = { lines: [] };
    pages.push(page);
    y = col.top;
  };

  for (let bi = 0; bi < list.length; bi += 1) {
    const block = list[bi];
    const size = Number(block.fontSize) > 0 ? Number(block.fontSize) : 11;
    const lineHeight = size * (block.type === "heading" ? HEADING_LINE_HEIGHT : PARAGRAPH_LINE_HEIGHT);
    const ascent = size * ASCENT_RATIO;
    const spaceBefore = size * (SPACE_BEFORE[block.type] ?? SPACE_BEFORE.paragraph);
    if (page.lines.length) y -= spaceBefore;

    // Reuse the block-editor's measured line-breaker via a width shim so a long
    // edit wraps to as many lines as needed, none wider than the column.
    const shim = { widthOfTextAtSize: (text) => measure(text, block) };
    const wrapped = wrapToWidth(String(block.text ?? ""), col.width, shim, size);

    for (const lineText of wrapped) {
      // Paginate before drawing — but never on an empty page (would loop forever
      // for a line taller than the whole column).
      if (page.lines.length && y - lineHeight < col.bottom) startNewPage();
      const width = measure(lineText, block);
      let x = col.x;
      if (block.align === "center") x = col.x + Math.max(0, (col.width - width) / 2);
      else if (block.align === "right") x = col.x + Math.max(0, col.width - width);
      page.lines.push({
        text: lineText,
        x: round2(x),
        baseline: round2(y - ascent),
        fontSize: size,
        block: bi,
        type: block.type || "paragraph",
        color: block.color || null,
        align: block.align || "left",
      });
      y -= lineHeight;
    }
  }

  const lineCount = pages.reduce((sum, p) => sum + p.lines.length, 0);
  return { pages, lineCount, pageCount: pages.length };
}

function normaliseColumn(column) {
  const c = column || {};
  const x = Number(c.x);
  const width = Number(c.width);
  const top = Number(c.top);
  const bottom = Number(c.bottom);
  if (![x, width, top, bottom].every(Number.isFinite) || width <= 0 || top <= bottom) {
    throw new Error("The text column geometry is invalid — could not reflow.");
  }
  return { x, width, top, bottom };
}

// ---------------------------------------------------------------------------
// rebuildReflowedPdf — pdf-lib. Draw the flowed layout onto fresh pages.
// ---------------------------------------------------------------------------

/**
 * Rebuilds a reflowed PDF: embeds the matched base-14 fonts, flows the (edited)
 * blocks down the column with real measured widths, draws each line, and starts
 * a new page whenever the column overflows. Node-testable via window.PDFLib.
 *
 * @param {Uint8Array|ArrayBuffer} _originalBytes  kept for API symmetry / future
 *   image re-embedding; the text column is rebuilt fresh at the original size.
 * @param {{
 *   pageWidth:number, pageHeight:number,
 *   column:{x:number,width:number,top:number,bottom:number},
 *   blocks:Array,
 *   images?:Array<{page:number,bytes:Uint8Array,type:"png"|"jpg",x:number,y:number,width:number,height:number}>,
 *   background?:{r:number,g:number,b:number}
 * }} model
 * @returns {Promise<Uint8Array>}
 */
export async function rebuildReflowedPdf(_originalBytes, model) {
  const { PDFDocument, StandardFonts, rgb } = getPdfLib();
  const spec = model || {};
  const blocks = Array.isArray(spec.blocks) ? spec.blocks : [];
  if (!blocks.length) throw new Error("There is no text to reflow — add or keep at least one paragraph.");
  const pageWidth = Number(spec.pageWidth);
  const pageHeight = Number(spec.pageHeight);
  if (!(pageWidth > 0) || !(pageHeight > 0)) throw new Error("The page size for the reflowed PDF is invalid.");

  const doc = await PDFDocument.create();

  // Pre-embed every font the blocks need so measuring can stay synchronous.
  const fontCache = new Map();
  const fontFor = (block) => {
    const key = StandardFonts[block.fontKey] ? block.fontKey : "Helvetica";
    return fontCache.get(key);
  };
  const neededKeys = new Set(blocks.map((b) => (StandardFonts[b.fontKey] ? b.fontKey : "Helvetica")));
  for (const key of neededKeys) fontCache.set(key, await doc.embedFont(StandardFonts[key]));

  const measure = (text, block) => {
    const font = fontFor(block);
    const size = Number(block.fontSize) > 0 ? Number(block.fontSize) : 11;
    try {
      return font.widthOfTextAtSize(String(text ?? ""), size);
    } catch {
      // Non-Latin measuring throws; return 0 so wrapping does not crash — the
      // friendly Latin-1 error is raised at draw time by drawPdfText.
      return 0;
    }
  };

  const layout = flowBlocks(blocks, spec.column, { measure });
  const bg = spec.background && typeof spec.background === "object" ? spec.background : null;

  for (const flowedPage of layout.pages) {
    const page = doc.addPage([pageWidth, pageHeight]);
    if (bg) page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: rgb(clamp01(bg.r), clamp01(bg.g), clamp01(bg.b)) });
    for (const line of flowedPage.lines) {
      const block = blocks[line.block];
      const color = line.color && typeof line.color === "object"
        ? rgb(clamp01(line.color.r), clamp01(line.color.g), clamp01(line.color.b))
        : rgb(0.1, 0.1, 0.13);
      // drawPdfText raises the friendly Latin-1 error for CJK/emoji replacements.
      drawPdfText(page, line.text, { x: line.x, y: line.baseline, size: line.fontSize, font: fontFor(block), color });
    }
  }

  // Best-effort non-text re-anchoring: draw any carried images, clamped to an
  // existing output page (reflow repaginates, so the mapping is approximate).
  if (Array.isArray(spec.images) && spec.images.length) {
    const lastIndex = doc.getPageCount() - 1;
    for (const image of spec.images) {
      if (!image || !image.bytes) continue;
      const index = Math.max(0, Math.min(lastIndex, (Number(image.page) || 1) - 1));
      const page = doc.getPage(index);
      const embedded = image.type === "png" ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes);
      const width = Number(image.width) > 0 ? Number(image.width) : embedded.width;
      const height = Number(image.height) > 0 ? Number(image.height) : embedded.height;
      page.drawImage(embedded, { x: Number(image.x) || 0, y: Number(image.y) || 0, width, height });
    }
  }

  return doc.save();
}

// --- small pure helpers ------------------------------------------------------

function medianOf(values) {
  const nums = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
