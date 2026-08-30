/**
 * Geometry for marking areas on a rendered PDF page.
 *
 * Extracted out of the component so the maths is unit-testable: these values
 * drive an irreversible, flattening redaction, so "it looked right when I
 * dragged it" is not sufficient evidence.
 *
 * Fractions are 0..1 from the top-left of the page. Percentages are 0..100 in
 * the same orientation (what the redaction service parses). PDF points are
 * absolute with the origin at the BOTTOM-left, which is what pdf-lib expects.
 */
export type Fraction = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Normalise a drag into a box inside the page.
 *
 * Handles drags in any direction, and clamps to the page: releasing outside the
 * canvas used to emit negative percentages, which the redaction service rejects
 * outright — taking every other marked area down with it.
 */
export function boxFromDrag(start: Fraction, end: Fraction): Box {
  const x1 = clamp01(start.x);
  const y1 = clamp01(start.y);
  const x2 = clamp01(end.x);
  const y2 = clamp01(end.y);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

/** Is this box big enough to be a deliberate mark rather than a stray click? */
export function isMeaningful(box: Box, minimum = 0.01): boolean {
  return box.w >= minimum && box.h >= minimum;
}

/** Box as percentages, rounded the way the coordinate list is written. */
export function boxToPercent(box: Box): Box {
  return {
    x: round1(box.x * 100),
    y: round1(box.y * 100),
    w: round1(box.w * 100),
    h: round1(box.h * 100),
  };
}

/**
 * Box in PDF points. The y axis flips: the canvas measures down from the top,
 * a PDF measures up from the bottom.
 */
export function boxToPoints(box: Box, pageWidth: number, pageHeight: number): Box {
  return {
    x: round1(box.x * pageWidth),
    y: round1((1 - box.y - box.h) * pageHeight),
    w: round1(box.w * pageWidth),
    h: round1(box.h * pageHeight),
  };
}

/** A single point in PDF points, same axis flip. */
export function pointToPdf(point: Fraction, pageWidth: number, pageHeight: number): Fraction {
  return {
    x: round1(clamp01(point.x) * pageWidth),
    y: round1((1 - clamp01(point.y)) * pageHeight),
  };
}

/**
 * Parse the coordinate list back into boxes, so what is drawn on the page is
 * derived from what will actually be applied rather than accumulated
 * separately. Invalid lines are skipped rather than throwing: this feeds a
 * preview, and the tool's own validation reports the error on submit.
 */
export function parseAreaLines(input: string): { page: number; x: number; y: number; w: number; h: number }[] {
  return String(input || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[,\s]+/).map(Number))
    .filter((parts) => parts.length === 5 && parts.every((value) => Number.isFinite(value)))
    .map(([page, x, y, w, h]) => ({ page, x, y, w, h }))
    .filter((area) => area.page >= 1 && area.w > 0 && area.h > 0);
}

/** Does text of this width fit on the page when drawn from this origin? */
export function textOverflowsPage(originX: number, textWidth: number, pageWidth: number): boolean {
  return originX + textWidth > pageWidth;
}

/** Rough width of a string at a given size, for a warning — not for layout. */
export function approximateTextWidth(text: string, size: number): number {
  // Helvetica averages a little over half an em across mixed-case text.
  return text.length * size * 0.52;
}
