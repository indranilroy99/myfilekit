import { getPdfLib, drawPdfText } from "./pdf.service.js";

// ---------------------------------------------------------------------------
// In-place PDF text editing — the honest, real client-side method.
//
// This is an OVERLAY edit, NOT a reflow. For each edited run we cover the
// original glyphs with a filled rectangle (in the sampled page-background
// colour) and redraw the new string at the original baseline/size/colour with
// a base-14 substitute font. Consequences the UI must state plainly:
//   * No reflow: a longer replacement can overflow its box; a shorter one
//     leaves a gap. Only the one run is touched — surrounding text never moves.
//   * Font matching is approximate. The original embedded font is not reused;
//     we substitute Helvetica/Times/Courier (+bold/italic), so glyph shapes and
//     kerning may differ slightly.
//   * Works only where text is extractable. Scanned/image PDFs have no text
//     runs — the user must OCR first.
//   * Latin-1 only for the drawn replacement (WinAnsi), enforced by the shared
//     safe-draw helper, which raises a friendly error for CJK/emoji.
//
// The coordinate transform below is the crux and is verified against a real
// PDF (including a /Rotate 90 page) in tests/core.test.js.
// ---------------------------------------------------------------------------

// Fraction of the font size that glyphs dip below the baseline. Used to size
// the cover box so descenders (g, y, p) of the original text are painted over.
const DESCENT_RATIO = 0.22;

/**
 * Converts a pdf.js text-item transform into a pdf-lib draw rectangle.
 *
 * pdf.js `item.transform` is `[a, b, c, d, e, f]`: the run's text matrix in the
 * PDF's *unrotated* user space, origin bottom-left, y-up — the SAME coordinate
 * system pdf-lib's `drawText` uses. So `(e, f)` is the text baseline origin and
 * maps to pdf-lib `(x, baseline)` directly, with NO y-flip. This holds even when
 * the page has /Rotate set, because pdf-lib draws in unrotated space and the
 * viewer applies the rotation at display time (verified on a real 90° PDF).
 *
 * `pageHeight` (the unrotated media-box height) and `rotation` (the page
 * /Rotate) are therefore not needed to place the baseline; they are accepted so
 * the caller can pass full page context and are used to normalise `rotation`
 * and to keep the API self-documenting about the space it works in.
 *
 * @param {number[]} transform pdf.js text-item transform [a,b,c,d,e,f]
 * @param {number} itemWidth  run advance width in points (item.width)
 * @param {number} itemHeight run font height in points (item.height)
 * @param {number} pageHeight unrotated page height in points
 * @param {number} [rotation] page /Rotate (0|90|180|270)
 * @returns {{x:number,y:number,w:number,h:number,baseline:number,fontSize:number,angle:number}}
 */
export function textItemToPageRect(transform, itemWidth, itemHeight, pageHeight, rotation = 0) {
  if (!Array.isArray(transform) || transform.length < 6) {
    throw new Error("A text run is missing its position data.");
  }
  const [a, b, , d, e, f] = transform.map(Number);
  // pdf.js /Rotate is a multiple of 90; normalise it so callers can pass raw values.
  const pageRotation = (((Number(rotation) || 0) % 360) + 360) % 360;
  const fontSize = Math.hypot(b, d) || Math.abs(d) || Math.abs(Number(itemHeight)) || 10;
  // The run's own rotation (from its matrix), used so a genuinely rotated run is
  // redrawn at the same angle. This is independent of the page /Rotate.
  const angle = normaliseDegrees((Math.atan2(b, a) * 180) / Math.PI);
  const width = Math.abs(Number(itemWidth)) || fontSize;
  const height = Math.abs(Number(itemHeight)) || fontSize;
  const descent = fontSize * DESCENT_RATIO;

  // Axis-aligned cover box enclosing the run. Runs are almost always upright;
  // when the run's matrix is turned ~90°, width and height swap so the box still
  // encloses the glyphs.
  const upright = Math.round(angle / 90) % 2 === 0;
  const w = upright ? width : height + descent;
  const h = upright ? height + descent : width;
  const x = e;
  const y = f - descent; // bottom-left of the cover box, pdf-lib space

  // Whether the run sits within the page's unrotated media box on the y-axis.
  // pageHeight/rotation are accepted so the caller passes full page context and
  // so callers can trust the result is expressed in unrotated pdf-lib space
  // regardless of /Rotate; applyTextEdits does the authoritative bounds check.
  const onPage =
    !Number.isFinite(pageHeight) || pageHeight <= 0 ? true : f >= -1 && f <= pageHeight + 1;

  return { x, y, w, h, baseline: f, fontSize, angle, rotation: pageRotation, onPage };
}

function normaliseDegrees(deg) {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  // Snap tiny floating dust to 0 so upright runs read as exactly upright.
  return Math.abs(d) < 1e-6 ? 0 : d;
}

// Base-14 font families available in every PDF viewer, keyed by style.
const STANDARD_FONT = {
  Helvetica: { regular: "Helvetica", bold: "HelveticaBold", italic: "HelveticaOblique", boldItalic: "HelveticaBoldOblique" },
  Times: { regular: "TimesRoman", bold: "TimesRomanBold", italic: "TimesRomanItalic", boldItalic: "TimesRomanBoldItalic" },
  Courier: { regular: "Courier", bold: "CourierBold", italic: "CourierOblique", boldItalic: "CourierBoldOblique" },
};

/**
 * Maps a pdf.js / base-14 font name to a standard-font family + style. This is
 * an approximation: the original embedded font is not reused. A subset prefix
 * ("ABCDEF+") is stripped first, then family and bold/italic are read from the
 * remaining name. Anything unrecognised falls back to Helvetica.
 *
 * @param {string} fontName
 * @returns {{family:"Helvetica"|"Times"|"Courier", bold:boolean, italic:boolean}}
 */
export function mapPdfFontToStandard(fontName) {
  const name = String(fontName || "").replace(/^[A-Z]{6}\+/, "");
  const lower = name.toLowerCase();
  const bold = /bold|black|heavy|semibold|,bd\b|-bd\b/.test(lower) || /,\s*bold/.test(lower);
  const italic = /italic|oblique|,it\b|-it\b/.test(lower);
  let family = "Helvetica";
  if (/times|serif|georgia|garamond|minion|book\s*antiqua/.test(lower)) family = "Times";
  else if (/courier|mono|consol/.test(lower)) family = "Courier";
  return { family, bold, italic };
}

/**
 * Resolves a {family, bold, italic} descriptor to a pdf-lib StandardFonts key.
 * @returns {string} e.g. "HelveticaBold", "TimesRomanItalic"
 */
export function standardFontKey({ family, bold, italic }) {
  const set = STANDARD_FONT[family] || STANDARD_FONT.Helvetica;
  if (bold && italic) return set.boldItalic;
  if (bold) return set.bold;
  if (italic) return set.italic;
  return set.regular;
}

/**
 * Applies overlay text edits to a PDF with pdf-lib (Node-testable via
 * window.PDFLib). Each edit covers its original region with a background-colour
 * rectangle, then redraws the new text at the original baseline. An empty
 * `text` deletes the run (cover only).
 *
 * @param {Uint8Array|ArrayBuffer} pdfBytes
 * @param {Array<{
 *   page:number,                                   // 1-based
 *   rect:{x:number,y:number,w:number,h:number,baseline:number,fontSize:number,angle?:number},
 *   text:string,
 *   fontKey?:string,                               // pdf-lib StandardFonts key
 *   color?:{r:number,g:number,b:number},           // 0..1, sampled glyph colour
 *   background?:{r:number,g:number,b:number}        // 0..1, sampled page bg
 * }>} edits
 * @returns {Promise<Uint8Array>}
 */
export async function applyTextEdits(pdfBytes, edits) {
  const { PDFDocument, StandardFonts, rgb, degrees } = getPdfLib();
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error("No text edits to apply. Select a text run and change it first.");
  }
  const pdf = await PDFDocument.load(pdfBytes);
  const pages = pdf.getPages();
  const fontCache = new Map();
  const getFont = async (key) => {
    const name = StandardFonts[key] ? key : "Helvetica";
    if (!fontCache.has(name)) fontCache.set(name, await pdf.embedFont(StandardFonts[name]));
    return fontCache.get(name);
  };

  for (const edit of edits) {
    const page = pages[Number(edit.page) - 1];
    if (!page) throw new Error(`An edit targets page ${edit.page}, which does not exist.`);
    const { width: pw, height: ph } = page.getSize();
    const r = edit.rect || {};
    const x = Number(r.x);
    const y = Number(r.y);
    const w = Number(r.w);
    const h = Number(r.h);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
      throw new Error(`An edit on page ${edit.page} has an invalid region.`);
    }
    // Reject edits whose box falls outside the page (1pt slack for rounding).
    if (x < -1 || y < -1 || x + w > pw + 1 || y + h > ph + 1) {
      throw new Error(`An edit on page ${edit.page} is outside the page bounds.`);
    }

    const bg = clampColor(edit.background, { r: 1, g: 1, b: 1 });
    page.drawRectangle({ x, y, width: w, height: h, color: rgb(bg.r, bg.g, bg.b) });

    const text = String(edit.text ?? "");
    if (!text) continue; // delete = cover only
    const font = await getFont(edit.fontKey);
    const col = clampColor(edit.color, { r: 0.1, g: 0.1, b: 0.13 });
    const baseline = Number.isFinite(Number(r.baseline)) ? Number(r.baseline) : y;
    const size = Number.isFinite(Number(r.fontSize)) && r.fontSize > 0 ? Number(r.fontSize) : h;
    const options = { x, y: baseline, size, font, color: rgb(col.r, col.g, col.b) };
    const angle = Number(r.angle) || 0;
    if (angle) options.rotate = degrees(angle);
    // Reuse the shared Latin-1 safe-draw helper: it raises the friendly
    // "Latin-1 characters only" error for CJK/emoji replacements.
    drawPdfText(page, text, options);
  }
  return pdf.save();
}

function clampColor(color, fallback) {
  if (!color || typeof color !== "object") return fallback;
  const channel = (v, d) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : d);
  return { r: channel(color.r, fallback.r), g: channel(color.g, fallback.g), b: channel(color.b, fallback.b) };
}
