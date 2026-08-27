import { zipSync } from "fflate";
import { getPdfLib, loadPdf } from "./pdf.service.js";
import { PAGE_SIZES } from "./pdf-edit.service.js";

// --- shared numeric validation (mirrors pdf.service / pdf-edit.service) ------

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a valid number.`);
  return number;
}

function positiveInteger(value, label) {
  const number = finiteNumber(value, label);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a whole number of at least 1.`);
  return number;
}

function nonNegativeNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number < 0) throw new Error(`${label} cannot be negative.`);
  return number;
}

// pdf-lib's standard fonts only cover WinAnsi (Latin-1). Turn its cryptic
// "WinAnsi cannot encode ..." error into a clear, user-facing message. Mirrors
// the helper pattern in pdf.service.js / pdf-edit.service.js.
function drawTextSafe(page, text, options) {
  try {
    page.drawText(text, options);
  } catch (error) {
    throw latin1Error(error);
  }
}

function measureSafe(font, text, size) {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch (error) {
    throw latin1Error(error);
  }
}

function latin1Error(error, fieldName) {
  if (/cannot encode|WinAnsi/i.test(String(error?.message))) {
    const where = fieldName ? ` Check the "${fieldName}" field.` : "";
    return new Error(`This PDF text tool supports Latin-1 characters only (no CJK/emoji).${where}`);
  }
  return error;
}

// =============================================================================
// 1. SMART SPLIT
// =============================================================================

/**
 * Turns a set of 1-based "start" pages into contiguous groups of zero-based page
 * indexes covering 1..pageCount. Page 1 always begins the first group.
 */
function groupsFromStarts(starts, pageCount) {
  const bounds = new Set([1]);
  for (const start of starts) {
    const page = finiteNumber(start, "Split page");
    if (!Number.isInteger(page) || page < 2 || page > pageCount) {
      throw new Error(`Split page ${page} must be between 2 and ${pageCount}.`);
    }
    bounds.add(page);
  }
  const sorted = [...bounds].sort((a, b) => a - b);
  const groups = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    const end = i + 1 < sorted.length ? sorted[i + 1] - 1 : pageCount;
    const indexes = [];
    for (let p = start; p <= end; p++) indexes.push(p - 1);
    groups.push(indexes);
  }
  return groups;
}

/**
 * Pure split planner. Returns an array of groups, each a list of zero-based page
 * indexes. Unit-testable in Node.
 *
 * - mode "everyN": chunks of `everyN` pages.
 * - mode "equalParts": `parts` groups, remainder spread over the earliest groups.
 * - mode "atPages": `atPages` (1-based numbers) each begin a new group.
 * - mode "bookmarks": `boundaries` (1-based start pages from the outline).
 */
export function computeSplitGroups({ mode, pageCount, everyN, parts, atPages = [], boundaries = [] } = {}) {
  const total = positiveInteger(pageCount, "Page count");
  if (mode === "everyN") {
    const size = positiveInteger(everyN, "Pages per file");
    const groups = [];
    for (let start = 0; start < total; start += size) {
      const indexes = [];
      for (let p = start; p < Math.min(start + size, total); p++) indexes.push(p);
      groups.push(indexes);
    }
    return groups;
  }
  if (mode === "equalParts") {
    const k = positiveInteger(parts, "Number of parts");
    if (k > total) throw new Error(`Cannot split ${total} page${total === 1 ? "" : "s"} into ${k} parts.`);
    const base = Math.floor(total / k);
    const remainder = total % k;
    const groups = [];
    let cursor = 0;
    for (let i = 0; i < k; i++) {
      const size = base + (i < remainder ? 1 : 0);
      const indexes = [];
      for (let p = 0; p < size; p++) indexes.push(cursor++);
      groups.push(indexes);
    }
    return groups;
  }
  if (mode === "atPages") return groupsFromStarts(atPages, total);
  if (mode === "bookmarks") {
    if (!boundaries.length) throw new Error("This PDF has no bookmarks to split at.");
    return groupsFromStarts(boundaries, total);
  }
  throw new Error("Choose a valid split mode.");
}

/** Parses "5, 12, 20" into a sorted, de-duplicated list of 1-based page numbers. */
export function parseSplitPages(input) {
  const value = String(input || "").trim();
  if (!value) throw new Error("Enter the page numbers to split at, e.g. 5, 12, 20.");
  const pages = [];
  for (const raw of value.split(/[,\s]+/)) {
    if (!raw) continue;
    if (!/^\d+$/.test(raw)) throw new Error(`"${raw}" is not a valid page number.`);
    pages.push(Number(raw));
  }
  if (!pages.length) throw new Error("Enter at least one page number to split at.");
  return pages;
}

/**
 * Reads top-level (and one nested level of) outline entries from a loaded
 * pdf-lib document. Best-effort: resolves explicit array destinations, GoTo
 * actions, and named destinations. Returns [{ title, pageIndex, level }].
 */
export function readOutlineFromDoc(pdf) {
  const { PDFName, PDFDict, PDFArray } = getPdfLib();
  const ctx = pdf.context;
  const outlinesRef = pdf.catalog.get(PDFName.of("Outlines"));
  const outlines = outlinesRef ? ctx.lookup(outlinesRef) : undefined;
  if (!(outlines instanceof PDFDict)) return [];

  const pages = pdf.getPages();
  const refIndex = new Map();
  pages.forEach((page, index) => refIndex.set(page.ref, index));

  // Named destinations live under /Names /Dests (a name tree) or the older
  // /Dests dictionary. Build a best-effort name -> array lookup.
  const namedDests = new Map();
  try {
    const namesDict = ctx.lookup(pdf.catalog.get(PDFName.of("Names")));
    const destsTree = namesDict instanceof PDFDict ? ctx.lookup(namesDict.get(PDFName.of("Dests"))) : undefined;
    const namesArr = destsTree instanceof PDFDict ? ctx.lookup(destsTree.get(PDFName.of("Names"))) : undefined;
    if (namesArr instanceof PDFArray) {
      for (let i = 0; i + 1 < namesArr.size(); i += 2) {
        const key = ctx.lookup(namesArr.get(i));
        const val = ctx.lookup(namesArr.get(i + 1));
        namedDests.set(String(key), val);
      }
    }
  } catch {
    // Ignore malformed name trees.
  }

  const pageIndexOfDest = (dict) => {
    let dest = ctx.lookup(dict.get(PDFName.of("Dest")));
    if (!dest) {
      const action = ctx.lookup(dict.get(PDFName.of("A")));
      if (action instanceof PDFDict) dest = ctx.lookup(action.get(PDFName.of("D")));
    }
    if (dest && !(dest instanceof PDFArray)) {
      // Named destination: resolve, possibly to a { D: [...] } dictionary.
      const named = namedDests.get(String(dest));
      dest = named instanceof PDFDict ? ctx.lookup(named.get(PDFName.of("D"))) : named;
    }
    if (!(dest instanceof PDFArray)) return -1;
    const pageRef = dest.get(0);
    return refIndex.has(pageRef) ? refIndex.get(pageRef) : -1;
  };

  const decodeTitle = (dict) => {
    const title = dict.get(PDFName.of("Title"));
    if (!title) return "";
    if (typeof title.decodeText === "function") return title.decodeText();
    if (typeof title.asString === "function") return title.asString();
    return String(title);
  };

  const entries = [];
  let topRef = outlines.get(PDFName.of("First"));
  let guard = 0;
  while (topRef && guard++ < 5000) {
    const node = ctx.lookup(topRef);
    if (!(node instanceof PDFDict)) break;
    entries.push({ title: decodeTitle(node), pageIndex: pageIndexOfDest(node), level: 0 });
    let childRef = node.get(PDFName.of("First"));
    let childGuard = 0;
    while (childRef && childGuard++ < 5000) {
      const child = ctx.lookup(childRef);
      if (!(child instanceof PDFDict)) break;
      entries.push({ title: decodeTitle(child), pageIndex: pageIndexOfDest(child), level: 1 });
      childRef = child.get(PDFName.of("Next"));
    }
    topRef = node.get(PDFName.of("Next"));
  }
  return entries;
}

/** Reads the outline of a File (top level + one nested level) as 1-based pages. */
export async function readOutline(file) {
  const pdf = await loadPdf(file);
  return readOutlineFromDoc(pdf).map((entry) => ({
    title: entry.title,
    page: entry.pageIndex >= 0 ? entry.pageIndex + 1 : null,
    level: entry.level,
  }));
}

/**
 * Splits a PDF into multiple single files and bundles them into a ZIP.
 * Returns { zipped, partCount, sizes, mode }.
 */
export async function smartSplitPdf(file, options = {}) {
  const { PDFDocument } = getPdfLib();
  const { mode = "everyN", everyN, parts, onProgress } = options;
  const source = await loadPdf(file);
  const pageCount = source.getPageCount();
  if (!pageCount) throw new Error("This PDF has no pages to split.");

  let boundaries = [];
  let atPages = [];
  if (mode === "bookmarks") {
    const outline = readOutlineFromDoc(source).filter((entry) => entry.level === 0 && entry.pageIndex >= 0);
    if (!outline.length) throw new Error("This PDF has no top-level bookmarks to split at. Choose another mode.");
    boundaries = [...new Set(outline.map((entry) => entry.pageIndex + 1))].filter((page) => page >= 2);
  } else if (mode === "atPages") {
    atPages = Array.isArray(options.atPages) ? options.atPages : parseSplitPages(options.atPages);
  }

  const groups = computeSplitGroups({ mode, pageCount, everyN, parts, atPages, boundaries });
  const width = String(groups.length).length;
  const stem = String(file.name || "document").replace(/\.[^.]*$/, "") || "document";
  const entries = {};
  const sizes = [];
  for (let i = 0; i < groups.length; i++) {
    const out = await PDFDocument.create();
    const pages = await out.copyPages(source, groups[i]);
    pages.forEach((page) => out.addPage(page));
    entries[`${stem}-part-${String(i + 1).padStart(width, "0")}.pdf`] = await out.save();
    sizes.push(groups[i].length);
    onProgress?.(i + 1, groups.length);
  }
  return { zipped: zipSync(entries, { level: 6 }), partCount: groups.length, sizes, mode };
}

// =============================================================================
// 2. BATES NUMBERING
// =============================================================================

const BATES_POSITIONS = {
  "bottom-right": { align: "right", vertical: "bottom" },
  "bottom-left": { align: "left", vertical: "bottom" },
  "bottom-center": { align: "center", vertical: "bottom" },
  "top-right": { align: "right", vertical: "top" },
  "top-left": { align: "left", vertical: "top" },
  "top-center": { align: "center", vertical: "top" },
};

export const BATES_POSITION_IDS = Object.keys(BATES_POSITIONS);

/** Formats one Bates stamp. padStart never truncates a wider number. Pure. */
export function formatBates(prefix, number, padding, suffix = "") {
  const pad = Math.max(0, Math.floor(finiteNumber(padding, "Padding")));
  return `${prefix || ""}${String(Math.floor(number)).padStart(pad, "0")}${suffix || ""}`;
}

/**
 * Stamps a continuous, incrementing Bates number on every page from `startPage`
 * onward. Returns { bytes, first, last, count }.
 */
export async function batesNumberPdf(file, options = {}) {
  const { StandardFonts, rgb } = getPdfLib();
  const prefix = String(options.prefix ?? "");
  const suffix = String(options.suffix ?? "");
  const start = Math.floor(finiteNumber(options.start ?? 1, "Starting number"));
  if (start < 0) throw new Error("Starting number cannot be negative.");
  const padding = Math.max(0, Math.floor(finiteNumber(options.padding ?? 6, "Digit padding")));
  const fontSize = (() => {
    const size = finiteNumber(options.fontSize ?? 10, "Font size");
    if (size <= 0) throw new Error("Font size must be greater than zero.");
    return size;
  })();
  const margin = nonNegativeNumber(options.margin ?? 24, "Margin");
  const position = BATES_POSITIONS[options.position] || BATES_POSITIONS["bottom-right"];

  const pdf = await loadPdf(file);
  const pages = pdf.getPages();
  const startPage = Math.floor(finiteNumber(options.startPage ?? 1, "Start page"));
  if (startPage < 1 || startPage > pages.length) {
    throw new Error(`Start page must be between 1 and ${pages.length}.`);
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const color = rgb(0.1, 0.12, 0.18);

  let current = start;
  let first = "";
  let last = "";
  let count = 0;
  for (let index = startPage - 1; index < pages.length; index++) {
    const page = pages[index];
    const { width, height } = page.getSize();
    const label = formatBates(prefix, current, padding, suffix);
    const textWidth = measureSafe(font, label, fontSize);
    const x = position.align === "left"
      ? margin
      : position.align === "right"
        ? Math.max(margin, width - margin - textWidth)
        : Math.max(margin, (width - textWidth) / 2);
    const y = position.vertical === "top" ? Math.max(0, height - margin - fontSize) : margin;
    drawTextSafe(page, label, { x, y, size: fontSize, font, color });
    if (count === 0) first = label;
    last = label;
    current++;
    count++;
  }
  const bytes = await pdf.save();
  return { bytes, first, last, count };
}

// =============================================================================
// 3. IMPOSITION (N-up / Booklet)
// =============================================================================

// [rows, cols] grids for supported N-up counts, filled left-to-right, top-down.
export const NUP_GRIDS = {
  2: [1, 2],
  4: [2, 2],
  6: [2, 3],
  8: [2, 4],
  9: [3, 3],
  16: [4, 4],
};

export const NUP_COUNTS = Object.keys(NUP_GRIDS).map(Number);

function sheetDimensions(pageSize, orientation) {
  const preset = PAGE_SIZES[pageSize];
  if (!preset) throw new Error("Choose a valid page size.");
  const [w, h] = preset;
  const portrait = orientation !== "landscape";
  return portrait ? [Math.min(w, h), Math.max(w, h)] : [Math.max(w, h), Math.min(w, h)];
}

/** Draws one embedded page scaled to fit a cell, preserving aspect ratio, centred. */
function drawFitted(page, embedded, cellX, cellY, cellW, cellH) {
  if (cellW <= 0 || cellH <= 0) throw new Error("Margins/gutter leave no room for pages. Reduce them.");
  const scale = Math.min(cellW / embedded.width, cellH / embedded.height);
  const w = embedded.width * scale;
  const h = embedded.height * scale;
  page.drawPage(embedded, { x: cellX + (cellW - w) / 2, y: cellY + (cellH - h) / 2, width: w, height: h });
}

/**
 * Booklet imposition order. For P pages padded up to a multiple of 4, produces
 * the 1-based sheet sequence that folds into a saddle-stitched booklet.
 *
 * Each group of 4 slots is one physical sheet (front: [last,first], back:
 * [second, second-last]). For 8 pages: [8,1,2,7,6,3,4,5]. Entries greater than
 * `pageCount` are blank filler pages. Pure and unit-testable.
 */
export function computeBookletOrder(pageCount) {
  const total = positiveInteger(pageCount, "Page count");
  const padded = Math.ceil(total / 4) * 4;
  const order = [];
  let a = 1;
  let b = padded;
  while (a < b) {
    order.push(b, a, a + 1, b - 1);
    a += 2;
    b -= 2;
  }
  return { order, padded };
}

/**
 * N-up or booklet imposition using pdf-lib embedPage. Returns
 * { bytes, sheets, outputPages, mode }.
 */
export async function imposePdf(file, options = {}) {
  const { PDFDocument } = getPdfLib();
  const { mode = "nup", pageSize = "A4", orientation = "portrait", onProgress } = options;
  const margin = nonNegativeNumber(options.margin ?? 18, "Margin");
  const gutter = nonNegativeNumber(options.gutter ?? 8, "Gutter");

  const source = await loadPdf(file);
  const srcPages = source.getPages();
  if (!srcPages.length) throw new Error("This PDF has no pages to impose.");

  const out = await PDFDocument.create();

  if (mode === "booklet") {
    const [sw, sh] = sheetDimensions(pageSize, orientation === "portrait" ? "landscape" : orientation);
    const { order, padded } = computeBookletOrder(srcPages.length);
    // Embed only the real source pages; padded slots stay blank.
    const embedded = await out.embedPages(srcPages);
    const cellW = (sw - 2 * margin - gutter) / 2;
    const cellH = sh - 2 * margin;
    let outputPages = 0;
    // Two slots (left, right) per output page.
    for (let i = 0; i < order.length; i += 2) {
      const page = out.addPage([sw, sh]);
      for (let half = 0; half < 2; half++) {
        const slot = order[i + half];
        if (!slot || slot > srcPages.length) continue; // blank filler
        const cellX = margin + half * (cellW + gutter);
        drawFitted(page, embedded[slot - 1], cellX, margin, cellW, cellH);
      }
      outputPages++;
      onProgress?.(outputPages, order.length / 2);
    }
    return { bytes: await out.save(), sheets: padded / 4, outputPages, mode };
  }

  const n = Number(options.n ?? 4);
  const grid = NUP_GRIDS[n];
  if (!grid) throw new Error("Choose 2, 4, 6, 8, 9, or 16 pages per sheet.");
  const [rows, cols] = grid;
  const [sw, sh] = sheetDimensions(pageSize, orientation);
  const embedded = await out.embedPages(srcPages);
  const cellW = (sw - 2 * margin - (cols - 1) * gutter) / cols;
  const cellH = (sh - 2 * margin - (rows - 1) * gutter) / rows;
  const sheetCount = Math.ceil(srcPages.length / n);
  for (let s = 0; s < sheetCount; s++) {
    const page = out.addPage([sw, sh]);
    for (let k = 0; k < n; k++) {
      const idx = s * n + k;
      if (idx >= embedded.length) break;
      const col = k % cols;
      const row = Math.floor(k / cols);
      const cellX = margin + col * (cellW + gutter);
      // Top row first: y measured from the sheet top.
      const cellY = sh - margin - (row + 1) * cellH - row * gutter;
      drawFitted(page, embedded[idx], cellX, cellY, cellW, cellH);
    }
    onProgress?.(s + 1, sheetCount);
  }
  return { bytes: await out.save(), sheets: sheetCount, outputPages: sheetCount, mode };
}

// =============================================================================
// 4. BOOKMARKS / OUTLINE EDITOR
// =============================================================================

/**
 * Parses outline input lines. Each line is `Title | pageNumber`; a leading
 * space or tab marks the line as a nested (level 1) child of the entry above.
 * Returns [{ title, page (1-based), level }]. Pure and unit-testable.
 */
export function parseOutlineInput(input, pageCount) {
  const total = positiveInteger(pageCount, "Page count");
  const lines = String(input || "").split(/\r?\n/);
  const entries = [];
  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    const indented = /^[ \t]/.test(rawLine);
    const line = rawLine.trim();
    const sep = line.lastIndexOf("|");
    if (sep < 0) throw new Error(`"${line}" must be in the form: Title | pageNumber.`);
    const title = line.slice(0, sep).trim();
    const pageText = line.slice(sep + 1).trim();
    if (!title) throw new Error(`An outline entry is missing its title: "${line}".`);
    if (!/^\d+$/.test(pageText)) throw new Error(`"${pageText}" is not a valid page number in "${line}".`);
    const page = Number(pageText);
    if (page < 1 || page > total) throw new Error(`Page ${page} in "${title}" is outside 1–${total}.`);
    const level = indented && entries.length ? 1 : 0;
    entries.push({ title, page, level });
  }
  if (!entries.length) throw new Error("Enter at least one outline entry, e.g. Introduction | 1.");
  return entries;
}

function destArray(ctx, pageRef) {
  const { PDFArray, PDFName, PDFNull } = getPdfLib();
  const arr = PDFArray.withContext(ctx);
  arr.push(pageRef);
  arr.push(PDFName.of("XYZ"));
  arr.push(PDFNull);
  arr.push(PDFNull);
  arr.push(PDFNull);
  return arr;
}

/**
 * Replaces the PDF's outline (table of contents) with the given entries. Builds
 * the /Outlines dictionary tree directly via the low-level context, wiring
 * /First /Last /Count /Parent /Next /Prev /Dest so readers resolve it. Supports
 * one level of nesting. Returns { bytes, topLevel, total }.
 */
export async function setOutline(file, entries) {
  const { PDFName, PDFNumber, PDFHexString } = getPdfLib();
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) throw new Error("Add at least one outline entry.");
  const pdf = await loadPdf(file);
  const ctx = pdf.context;
  const pages = pdf.getPages();
  for (const entry of list) {
    if (!Number.isInteger(entry.page) || entry.page < 1 || entry.page > pages.length) {
      throw new Error(`Page ${entry.page} is outside 1–${pages.length}.`);
    }
  }

  // Group into top-level entries, each owning any immediately-following level-1
  // children. A leading level-1 entry (no parent yet) is promoted to top level.
  const top = [];
  for (const entry of list) {
    if (entry.level !== 1 || !top.length) top.push({ ...entry, children: [] });
    else top[top.length - 1].children.push(entry);
  }

  const outlinesRef = ctx.nextRef();
  const topRefs = top.map(() => ctx.nextRef());
  let total = top.length;

  top.forEach((node, ti) => {
    const childRefs = node.children.map(() => ctx.nextRef());
    total += childRefs.length;
    const dict = ctx.obj({});
    dict.set(PDFName.of("Title"), PDFHexString.fromText(node.title));
    dict.set(PDFName.of("Parent"), outlinesRef);
    dict.set(PDFName.of("Dest"), destArray(ctx, pages[node.page - 1].ref));
    if (ti > 0) dict.set(PDFName.of("Prev"), topRefs[ti - 1]);
    if (ti < top.length - 1) dict.set(PDFName.of("Next"), topRefs[ti + 1]);
    if (childRefs.length) {
      dict.set(PDFName.of("First"), childRefs[0]);
      dict.set(PDFName.of("Last"), childRefs[childRefs.length - 1]);
      // Negative count = children present but collapsed by default.
      dict.set(PDFName.of("Count"), PDFNumber.of(-childRefs.length));
    }
    ctx.assign(topRefs[ti], dict);

    node.children.forEach((child, ci) => {
      const childDict = ctx.obj({});
      childDict.set(PDFName.of("Title"), PDFHexString.fromText(child.title));
      childDict.set(PDFName.of("Parent"), topRefs[ti]);
      childDict.set(PDFName.of("Dest"), destArray(ctx, pages[child.page - 1].ref));
      if (ci > 0) childDict.set(PDFName.of("Prev"), childRefs[ci - 1]);
      if (ci < childRefs.length - 1) childDict.set(PDFName.of("Next"), childRefs[ci + 1]);
      ctx.assign(childRefs[ci], childDict);
    });
  });

  const rootDict = ctx.obj({});
  rootDict.set(PDFName.of("Type"), PDFName.of("Outlines"));
  rootDict.set(PDFName.of("First"), topRefs[0]);
  rootDict.set(PDFName.of("Last"), topRefs[topRefs.length - 1]);
  rootDict.set(PDFName.of("Count"), PDFNumber.of(top.length));
  ctx.assign(outlinesRef, rootDict);
  pdf.catalog.set(PDFName.of("Outlines"), outlinesRef);

  const bytes = await pdf.save();
  return { bytes, topLevel: top.length, total };
}

// =============================================================================
// 5. CREATE PDF FORM
// =============================================================================

const FORM_FIELD_TYPES = new Set(["text", "checkbox", "dropdown", "radio"]);
// pdf-lib treats "." as a field-name hierarchy separator, so disallow it.
const FIELD_NAME_RE = /^[A-Za-z0-9 _-]+$/;

/**
 * Resolves a field's rectangle (in PDF points, bottom-left origin) from a
 * top-left x/y/w/h given as percentages or points of a page of size (pw, ph).
 */
function resolveRect(field, pw, ph) {
  const unit = field.unit === "points" ? "points" : "percent";
  const toX = (value, label) => (unit === "percent" ? (finiteNumber(value, label) / 100) * pw : finiteNumber(value, label));
  const toY = (value, label) => (unit === "percent" ? (finiteNumber(value, label) / 100) * ph : finiteNumber(value, label));
  const x = toX(field.x, "X");
  const w = toX(field.w, "Width");
  const topY = toY(field.y, "Y");
  const h = toY(field.h, "Height");
  if (w <= 0 || h <= 0) throw new Error(`Field "${field.name}" needs a width and height greater than zero.`);
  const y = ph - topY - h; // convert top-left origin to pdf-lib bottom-left
  if (x < 0 || y < 0 || x + w > pw + 0.5 || topY + h > ph + 0.5) {
    throw new Error(`Field "${field.name}" does not fit on its page.`);
  }
  return { x, y, width: w, height: h };
}

/**
 * Builds a fillable AcroForm PDF. `file` may be a source PDF (fields are added
 * onto it) or null (a blank document of `pageCount` pages is created). Fields
 * are { type, name, page (1-based), x, y, w, h, unit, options }. Returns
 * { bytes, fieldCount }.
 */
export async function createFormPdf(file, fields, options = {}) {
  const { PDFDocument } = getPdfLib();
  const list = Array.isArray(fields) ? fields : [];
  if (!list.length) throw new Error("Add at least one form field.");

  const names = new Set();
  for (const field of list) {
    if (!FORM_FIELD_TYPES.has(field.type)) throw new Error(`Unknown field type "${field.type}".`);
    const name = String(field.name || "").trim();
    if (!name) throw new Error("Every field needs a name.");
    if (!FIELD_NAME_RE.test(name)) throw new Error(`Field name "${name}" may use only letters, numbers, spaces, hyphen and underscore.`);
    if (names.has(name)) throw new Error(`Duplicate field name "${name}". Names must be unique.`);
    names.add(name);
    if ((field.type === "dropdown" || field.type === "radio")) {
      const opts = (field.options || []).map((opt) => String(opt).trim()).filter(Boolean);
      if (opts.length < 2) throw new Error(`Field "${name}" needs at least two options.`);
    }
  }

  const maxPage = list.reduce((max, field) => Math.max(max, Math.floor(finiteNumber(field.page ?? 1, "Field page"))), 1);

  let pdf;
  if (file) {
    pdf = await loadPdf(file);
    if (maxPage > pdf.getPageCount()) throw new Error(`Field placed on page ${maxPage}, but the PDF has ${pdf.getPageCount()} page${pdf.getPageCount() === 1 ? "" : "s"}.`);
  } else {
    pdf = await PDFDocument.create();
    const dimensions = PAGE_SIZES[options.pageSize] || PAGE_SIZES.A4;
    const wanted = Math.max(maxPage, Math.floor(finiteNumber(options.pageCount ?? maxPage, "Page count")));
    if (wanted > 200) throw new Error("Choose 200 pages or fewer.");
    const [w, h] = options.orientation === "landscape" ? [Math.max(...dimensions), Math.min(...dimensions)] : [Math.min(...dimensions), Math.max(...dimensions)];
    for (let i = 0; i < wanted; i++) pdf.addPage([w, h]);
  }

  const form = pdf.getForm();
  const pages = pdf.getPages();

  for (const field of list) {
    const pageIndex = Math.floor(finiteNumber(field.page ?? 1, "Field page")) - 1;
    if (pageIndex < 0 || pageIndex >= pages.length) throw new Error(`Field "${field.name}" targets a page out of range.`);
    const page = pages[pageIndex];
    const { width: pw, height: ph } = page.getSize();
    const name = field.name.trim();

    try {
      if (field.type === "text") {
        const tf = form.createTextField(name);
        tf.addToPage(page, resolveRect(field, pw, ph));
      } else if (field.type === "checkbox") {
        const cb = form.createCheckBox(name);
        cb.addToPage(page, resolveRect(field, pw, ph));
      } else if (field.type === "dropdown") {
        const opts = field.options.map((opt) => String(opt).trim()).filter(Boolean);
        const dd = form.createDropdown(name);
        dd.addOptions(opts);
        dd.select(opts[0]);
        dd.addToPage(page, resolveRect(field, pw, ph));
      } else if (field.type === "radio") {
        const opts = field.options.map((opt) => String(opt).trim()).filter(Boolean);
        const rg = form.createRadioGroup(name);
        const rect = resolveRect(field, pw, ph);
        const rowH = rect.height / opts.length;
        const square = Math.max(6, Math.min(rowH - 2, 16));
        opts.forEach((opt, i) => {
          const top = rect.y + rect.height - (i + 1) * rowH;
          rg.addOptionToPage(opt, page, { x: rect.x, y: top + (rowH - square) / 2, width: square, height: square });
        });
      }
    } catch (error) {
      throw latin1Error(error, name);
    }
  }

  try {
    const bytes = await pdf.save();
    return { bytes, fieldCount: list.length };
  } catch (error) {
    throw latin1Error(error);
  }
}
