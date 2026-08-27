import { getPdfLib, drawPdfText } from "./pdf.service.js";

// ---------------------------------------------------------------------------
// PDF annotation / markup — the data model and the pdf-lib burn-in.
//
// This is a FLATTEN model: annotations are drawn directly onto the page content
// with pdf-lib (drawRectangle / drawEllipse / drawLine / drawText). They become
// part of the page's drawing operators, so they render identically in every
// reader — but they are NOT reader-editable /Annot objects and cannot be
// selected, moved, or deleted once exported. The UI states this plainly.
//
// Coordinate system: annotations are stored in pdf-lib PAGE space — points,
// origin bottom-left, y-up — the SAME space textItemToPageRect reports and the
// same space pdf-lib draws in. The one screen->page conversion (top-origin
// pixels -> bottom-origin points) is `screenToPagePoint`, a pure, tested
// function used by the browser overlay before anything is stored.
//
// Everything here is pure / Node-testable (pdf-lib via window.PDFLib). All
// annotation input is treated as untrusted: the normaliser clamps coordinates
// to the page, clamps widths/sizes to sane ranges, validates colours against a
// hex allowlist (accent fallback), strips/limits note text, decimates dense
// freehand strokes, and caps the annotation count per page.
// ---------------------------------------------------------------------------

export const ANNOTATION_TYPES = ["highlight", "ink", "rect", "ellipse", "line", "arrow", "note", "callout"];

// The tool's single accent (matches the app --primary). Any invalid colour
// falls back to this so a hostile/garbage colour can never reach the output.
export const ACCENT_HEX = "#2563eb";

// Functional highlight palette — highlighting is one of the few places colour
// carries meaning, so a small, tasteful set is allowed. Default is the accent.
export const HIGHLIGHT_PALETTE = [
  { id: "accent", hex: ACCENT_HEX },
  { id: "yellow", hex: "#facc15" },
  { id: "green", hex: "#22c55e" },
  { id: "pink", hex: "#ec4899" },
  { id: "blue", hex: "#38bdf8" },
];
const HIGHLIGHT_HEXES = new Set(HIGHLIGHT_PALETTE.map((c) => c.hex));

export const MAX_ANNOTATIONS_PER_PAGE = 500;
export const MAX_INK_POINTS = 2000; // after decimation
export const MIN_STROKE_WIDTH = 0.5;
export const MAX_STROKE_WIDTH = 60;
export const MIN_FONT_SIZE = 4;
export const MAX_FONT_SIZE = 96;
export const MAX_TEXT_LENGTH = 500;
export const MIN_HIGHLIGHT_OPACITY = 0.1;
export const MAX_HIGHLIGHT_OPACITY = 0.85;
const DEFAULT_HIGHLIGHT_OPACITY = 0.4;
const DEFAULT_STROKE_WIDTH = 2;
const NOTE_TEXT_COLOR = "#111827";
const CALLOUT_FILL = "#fef9c3";

let idCounter = 0;
function nextId(prefix = "a") {
  idCounter += 1;
  return `${prefix}${idCounter.toString(36)}`;
}

// --- Value validators (pure) -------------------------------------------------

export function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n < min ? min : n > max ? max : n;
}

// Expands #rgb to #rrggbb, lowercases; anything not a valid hex triplet returns
// the fallback. A string like "javascript:alert(1)" fails the test and falls
// back to the accent colour.
export function normalizeHex(value, fallback = ACCENT_HEX) {
  if (typeof value === "string") {
    const v = value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(v)) {
      const [, r, g, b] = /^#(.)(.)(.)$/.exec(v);
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
  }
  return fallback;
}

function pickHighlightHex(value) {
  const hex = normalizeHex(value, ACCENT_HEX);
  return HIGHLIGHT_HEXES.has(hex) ? hex : ACCENT_HEX;
}

export function hexToRgbUnit(hex) {
  const h = normalizeHex(hex, ACCENT_HEX).slice(1);
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
}

// Strips control characters (so nothing odd reaches a drawn string or a list
// row) and truncates to a hard cap. `singleLine` collapses newlines for labels.
export function sanitizeText(value, { max = MAX_TEXT_LENGTH, singleLine = false } = {}) {
  let s = String(value ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  s = s.replace(/\t/g, " ");
  if (singleLine) s = s.replace(/[\r\n]+/g, " ");
  return s.slice(0, max);
}

// Linear (single-pass) stride decimation that always keeps the first and last
// point and never exceeds `max`. RDP would be O(n^2) worst case; a huge stroke
// must never turn drawing into a super-linear scan.
export function decimatePoints(points, max = MAX_INK_POINTS) {
  const pts = Array.isArray(points) ? points : [];
  if (pts.length <= max) return pts.slice();
  const step = Math.ceil(pts.length / max);
  const out = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
  const last = pts[pts.length - 1];
  if (out[out.length - 1] !== last) {
    if (out.length >= max) out[out.length - 1] = last;
    else out.push(last);
  }
  return out;
}

// --- Coordinate mapping (pure, tested) --------------------------------------

// Converts a top-origin screen pixel (as reported by a pointer event over the
// rendered page image, at `scale` = pdf-px-per-point) into bottom-origin pdf-lib
// page space, clamped to the page. This is the ONLY place the y-flip happens.
export function screenToPagePoint({ px, py }, { scale, pageWidth, pageHeight }) {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  const pw = clampNumber(pageWidth, 1, 1e6, 612);
  const ph = clampNumber(pageHeight, 1, 1e6, 792);
  const x = clampNumber(Number(px) / s, 0, pw, 0);
  const y = clampNumber(ph - Number(py) / s, 0, ph, 0);
  return { x, y };
}

// Inverse: pdf-lib page point -> top-origin screen pixel. Used by the overlay to
// paint committed annotations back onto the canvas.
export function pagePointToScreen({ x, y }, { scale, pageHeight }) {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  const ph = clampNumber(pageHeight, 1, 1e6, 792);
  return { px: Number(x) * s, py: (ph - Number(y)) * s };
}

// --- Model normaliser (pure) -------------------------------------------------

function clampBox(raw, pw, ph) {
  let x = clampNumber(raw.x, 0, pw, 0);
  let y = clampNumber(raw.y, 0, ph, 0);
  let w = Math.max(1, clampNumber(raw.w, 0, pw, 1));
  let h = Math.max(1, clampNumber(raw.h, 0, ph, 1));
  if (x + w > pw) x = Math.max(0, pw - w);
  if (y + h > ph) y = Math.max(0, ph - h);
  return { x, y, w, h };
}

/**
 * Validates and clamps ONE untrusted annotation against a page size. Returns a
 * canonical, safe annotation object, or null if the type is unknown. Every
 * numeric field is clamped; every colour is validated (accent fallback); text
 * is stripped and truncated; freehand points are decimated and capped.
 *
 * @param {object} raw
 * @param {{width:number,height:number}} pageSize
 * @returns {object|null}
 */
export function normalizeAnnotation(raw, pageSize = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const type = String(raw.type || "");
  if (!ANNOTATION_TYPES.includes(type)) return null;
  const pw = clampNumber(pageSize.width, 1, 1e6, 612);
  const ph = clampNumber(pageSize.height, 1, 1e6, 792);
  const cx = (v) => clampNumber(v, 0, pw, 0);
  const cy = (v) => clampNumber(v, 0, ph, 0);
  const id = typeof raw.id === "string" && raw.id.length > 0 && raw.id.length <= 64 ? raw.id : nextId();
  const width = () => clampNumber(raw.width, MIN_STROKE_WIDTH, MAX_STROKE_WIDTH, DEFAULT_STROKE_WIDTH);

  switch (type) {
    case "highlight": {
      return {
        id, type, ...clampBox(raw, pw, ph),
        color: pickHighlightHex(raw.color),
        opacity: clampNumber(raw.opacity, MIN_HIGHLIGHT_OPACITY, MAX_HIGHLIGHT_OPACITY, DEFAULT_HIGHLIGHT_OPACITY),
      };
    }
    case "rect":
    case "ellipse": {
      return {
        id, type, ...clampBox(raw, pw, ph),
        color: normalizeHex(raw.color),
        width: width(),
        fill: raw.fill ? normalizeHex(raw.fill) : null,
        fillOpacity: clampNumber(raw.fillOpacity, 0, 1, 0.2),
      };
    }
    case "line":
    case "arrow": {
      return { id, type, x1: cx(raw.x1), y1: cy(raw.y1), x2: cx(raw.x2), y2: cy(raw.y2), color: normalizeHex(raw.color), width: width() };
    }
    case "ink": {
      const raw_pts = Array.isArray(raw.points) ? raw.points : [];
      const pts = decimatePoints(raw_pts.map((p) => ({ x: cx(p?.x), y: cy(p?.y) })));
      return { id, type, points: pts, color: normalizeHex(raw.color), width: width() };
    }
    case "note": {
      return {
        id, type, x: cx(raw.x), y: cy(raw.y),
        text: sanitizeText(raw.text, { singleLine: true }),
        size: clampNumber(raw.size, MIN_FONT_SIZE, MAX_FONT_SIZE, 14),
        color: normalizeHex(raw.color, NOTE_TEXT_COLOR),
      };
    }
    case "callout": {
      const box = clampBox(raw, pw, ph);
      const hasTarget = Number.isFinite(Number(raw.tx)) && Number.isFinite(Number(raw.ty));
      return {
        id, type, ...box,
        text: sanitizeText(raw.text),
        size: clampNumber(raw.size, MIN_FONT_SIZE, MAX_FONT_SIZE, 12),
        color: normalizeHex(raw.color, NOTE_TEXT_COLOR),
        fill: normalizeHex(raw.fill, CALLOUT_FILL),
        border: normalizeHex(raw.border, ACCENT_HEX),
        target: hasTarget ? { x: cx(raw.tx), y: cy(raw.ty) } : null,
      };
    }
    default:
      return null;
  }
}

/** Normalises a list for one page: drops invalid entries and caps the count. */
export function normalizeAnnotations(list, pageSize = {}) {
  const arr = Array.isArray(list) ? list : [];
  const out = [];
  for (const raw of arr) {
    const a = normalizeAnnotation(raw, pageSize);
    if (a) out.push(a);
    if (out.length >= MAX_ANNOTATIONS_PER_PAGE) break;
  }
  return out;
}

// --- pdf-lib burn-in ---------------------------------------------------------

// Accepts a Map or a plain object keyed by 1-based page number. Non-numeric or
// empty keys are ignored here; out-of-range keys are rejected in applyAnnotations.
function toPageMap(annotationsByPage) {
  const map = new Map();
  const add = (key, value) => {
    const n = Number(key);
    if (!Array.isArray(value) || value.length === 0) return;
    if (map.has(n)) map.set(n, map.get(n).concat(value));
    else map.set(n, value.slice());
  };
  if (annotationsByPage instanceof Map) {
    for (const [k, v] of annotationsByPage) add(k, v);
  } else if (annotationsByPage && typeof annotationsByPage === "object") {
    for (const k of Object.keys(annotationsByPage)) add(k, annotationsByPage[k]);
  }
  return map;
}

// Turn pdf-lib's cryptic WinAnsi encode error into the shared friendly message.
function latin1Guard(fn) {
  try {
    return fn();
  } catch (error) {
    if (/cannot encode|WinAnsi/i.test(String(error?.message))) {
      throw new Error("This PDF annotation tool supports Latin-1 characters only (no CJK/emoji).");
    }
    throw error;
  }
}

/**
 * Burns annotations onto a PDF with pdf-lib. Node-testable via window.PDFLib.
 *
 * @param {Uint8Array|ArrayBuffer} pdfBytes
 * @param {Map<number,object[]>|Object<string,object[]>} annotationsByPage  1-based page -> annotations
 * @param {Array<{width:number,height:number}>} [pageSizes]  per-page capture sizes; used to clamp/draw when provided, else the real page size
 * @param {{onProgress?:(done:number,total:number)=>void}} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function applyAnnotations(pdfBytes, annotationsByPage, pageSizes, options = {}) {
  const lib = getPdfLib();
  const { PDFDocument, StandardFonts, rgb, degrees, BlendMode, LineCapStyle } = lib;
  const map = toPageMap(annotationsByPage);
  if (map.size === 0) throw new Error("No annotations to apply. Add some markup to a page first.");

  const pdf = await PDFDocument.load(pdfBytes);
  const pages = pdf.getPages();
  for (const pageNum of map.keys()) {
    if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > pages.length) {
      throw new Error(`Annotations target page ${pageNum}, which does not exist in this ${pages.length}-page PDF.`);
    }
  }

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const ctx = { rgb, degrees, BlendMode, LineCapStyle, font };
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const total = map.size;
  let done = 0;

  for (const [pageNum, rawList] of map) {
    const page = pages[pageNum - 1];
    const captured = Array.isArray(pageSizes) ? pageSizes[pageNum - 1] : null;
    const size = captured && Number(captured.width) > 0 && Number(captured.height) > 0 ? captured : page.getSize();
    const anns = normalizeAnnotations(rawList, size);
    // Highlights sit underneath the rest so a marker never hides ink or a shape.
    const ordered = anns.slice().sort((a, b) => (a.type === "highlight" ? 0 : 1) - (b.type === "highlight" ? 0 : 1));
    for (const ann of ordered) drawAnnotation(page, ann, ctx);
    done += 1;
    if (onProgress) onProgress(done, total);
  }
  return pdf.save();
}

function drawAnnotation(page, ann, ctx) {
  const { rgb, BlendMode, LineCapStyle, font } = ctx;
  const stroke = hexToRgbUnit(ann.color);
  const strokeColor = ann.color ? rgb(stroke.r, stroke.g, stroke.b) : undefined;
  const cap = LineCapStyle ? { lineCap: LineCapStyle.Round } : {};

  switch (ann.type) {
    case "highlight": {
      const c = hexToRgbUnit(ann.color);
      const opts = { x: ann.x, y: ann.y, width: ann.w, height: ann.h, color: rgb(c.r, c.g, c.b), opacity: ann.opacity };
      // Multiply darkens the page like a real marker, so text under it stays readable.
      if (BlendMode && BlendMode.Multiply) opts.blendMode = BlendMode.Multiply;
      page.drawRectangle(opts);
      return;
    }
    case "rect": {
      const opts = { x: ann.x, y: ann.y, width: ann.w, height: ann.h, borderColor: strokeColor, borderWidth: ann.width };
      if (ann.fill) {
        const f = hexToRgbUnit(ann.fill);
        opts.color = rgb(f.r, f.g, f.b);
        opts.opacity = ann.fillOpacity;
      }
      page.drawRectangle(opts);
      return;
    }
    case "ellipse": {
      const opts = { x: ann.x + ann.w / 2, y: ann.y + ann.h / 2, xScale: ann.w / 2, yScale: ann.h / 2, borderColor: strokeColor, borderWidth: ann.width };
      if (ann.fill) {
        const f = hexToRgbUnit(ann.fill);
        opts.color = rgb(f.r, f.g, f.b);
        opts.opacity = ann.fillOpacity;
      }
      page.drawEllipse(opts);
      return;
    }
    case "line": {
      page.drawLine({ start: { x: ann.x1, y: ann.y1 }, end: { x: ann.x2, y: ann.y2 }, thickness: ann.width, color: strokeColor, ...cap });
      return;
    }
    case "arrow": {
      drawArrow(page, ann, strokeColor, cap);
      return;
    }
    case "ink": {
      drawInk(page, ann, strokeColor, cap, rgb);
      return;
    }
    case "note": {
      if (!ann.text) return;
      const c = hexToRgbUnit(ann.color);
      drawPdfText(page, ann.text, { x: ann.x, y: ann.y, size: ann.size, font, color: rgb(c.r, c.g, c.b) });
      return;
    }
    case "callout": {
      drawCallout(page, ann, ctx);
      return;
    }
    default:
      return;
  }
}

function drawArrow(page, ann, color, cap) {
  page.drawLine({ start: { x: ann.x1, y: ann.y1 }, end: { x: ann.x2, y: ann.y2 }, thickness: ann.width, color, ...cap });
  const angle = Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1);
  const head = Math.max(6, ann.width * 3.2);
  const spread = Math.PI / 7;
  for (const a of [angle + Math.PI - spread, angle + Math.PI + spread]) {
    page.drawLine({
      start: { x: ann.x2, y: ann.y2 },
      end: { x: ann.x2 + head * Math.cos(a), y: ann.y2 + head * Math.sin(a) },
      thickness: ann.width,
      color,
      ...cap,
    });
  }
}

function drawInk(page, ann, color, cap, rgb) {
  const pts = ann.points || [];
  if (pts.length === 0) return;
  if (pts.length === 1) {
    const c = hexToRgbUnit(ann.color);
    page.drawCircle({ x: pts[0].x, y: pts[0].y, size: Math.max(0.5, ann.width / 2), color: rgb(c.r, c.g, c.b) });
    return;
  }
  for (let i = 0; i < pts.length - 1; i += 1) {
    page.drawLine({ start: { x: pts[i].x, y: pts[i].y }, end: { x: pts[i + 1].x, y: pts[i + 1].y }, thickness: ann.width, color, ...cap });
  }
}

function drawCallout(page, ann, ctx) {
  const { rgb, font } = ctx;
  const fill = hexToRgbUnit(ann.fill);
  const border = hexToRgbUnit(ann.border);
  const textColor = hexToRgbUnit(ann.color);

  // Optional leader line: from the box corner nearest the target to the target.
  if (ann.target) {
    const anchor = nearestBoxCorner(ann, ann.target);
    page.drawLine({ start: anchor, end: { x: ann.target.x, y: ann.target.y }, thickness: 1.5, color: rgb(border.r, border.g, border.b) });
  }

  page.drawRectangle({
    x: ann.x, y: ann.y, width: ann.w, height: ann.h,
    color: rgb(fill.r, fill.g, fill.b), opacity: 0.95,
    borderColor: rgb(border.r, border.g, border.b), borderWidth: 1,
  });

  if (!ann.text) return;
  const pad = 6;
  const size = ann.size;
  const lineHeight = size * 1.25;
  const maxWidth = ann.w - pad * 2;
  const lines = wrapMeasured(ann.text, maxWidth, font, size);
  let lineY = ann.y + ann.h - pad - size;
  const bottom = ann.y + pad;
  for (const line of lines) {
    if (lineY < bottom) break; // clip to the box; never spill out
    drawPdfText(page, line, { x: ann.x + pad, y: lineY, size, font, color: rgb(textColor.r, textColor.g, textColor.b) });
    lineY -= lineHeight;
  }
}

function nearestBoxCorner(box, target) {
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x, y: box.y + box.h },
    { x: box.x + box.w, y: box.y + box.h },
  ];
  let best = corners[0];
  let bestD = Infinity;
  for (const c of corners) {
    const d = (c.x - target.x) ** 2 + (c.y - target.y) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// Greedy word wrap on measured text width (guarded so non-Latin raises the
// friendly error). A single word wider than the box is hard-split by measured
// prefix so it never overflows.
function wrapMeasured(text, maxWidth, font, size) {
  const measure = (s) => latin1Guard(() => font.widthOfTextAtSize(s, size));
  const lines = [];
  for (const paragraph of String(text).split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(""); continue; }
    let line = "";
    for (let word of words) {
      while (measure(word) > maxWidth && word.length > 1) {
        let cut = word.length;
        while (cut > 1 && measure(word.slice(0, cut)) > maxWidth) cut -= 1;
        if (line) { lines.push(line); line = ""; }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}
