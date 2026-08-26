// Whiteboard stroke model, wire format, and canvas rendering.
//
// Coordinates and pen widths are stored as fractions of the board (0..1), never
// as pixels. That keeps a drawing crisp across device-pixel ratios, survives a
// window resize, and lets a paired peer with a differently sized canvas render
// the same strokes without any negotiation.
//
// Everything above the "browser-only" marker is pure and unit testable in Node.
// Strokes that arrive from a peer are untrusted input: deserializeStroke and
// deserializeStrokeChunk validate and clamp every field, and no stroke value is
// ever interpolated into HTML.

export const BOARD_VERSION = 1;
export const MAX_POINTS_PER_STROKE = 8000;
export const MAX_STROKES = 4000;
// Pen width as a fraction of board width: 0.0005 is hairline, 0.08 is a marker.
export const MIN_STROKE_WIDTH = 0.0005;
export const MAX_STROKE_WIDTH = 0.08;
const COORDINATE_PRECISION = 10000;
const WIDTH_PRECISION = 100000;

let strokeCounter = 0;

export function nextStrokeId(prefix = "l") {
  strokeCounter += 1;
  return `${prefix}${strokeCounter.toString(36)}`;
}

export function isHexColor(value) {
  return typeof value === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

export function clampUnit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return number < 0 ? 0 : number > 1 ? 1 : number;
}

export function clampStrokeWidth(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return MIN_STROKE_WIDTH;
  return Math.min(MAX_STROKE_WIDTH, Math.max(MIN_STROKE_WIDTH, number));
}

function round(value, precision) {
  return Math.round(value * precision) / precision;
}

export function createStroke({ color = "#111111", width = 0.005, erase = false, remote = false, id } = {}) {
  return {
    id: id || nextStrokeId(remote ? "r" : "l"),
    color: isHexColor(color) ? color : "#111111",
    width: clampStrokeWidth(width),
    erase: Boolean(erase),
    remote: Boolean(remote),
    points: [],
  };
}

// Appends a point in board space. `pressure` is 0..1; 0 means "unknown", which
// renderers treat as a flat line width.
export function addStrokePoint(stroke, { x, y, pressure = 0 }) {
  if (stroke.points.length >= MAX_POINTS_PER_STROKE) return stroke;
  stroke.points.push({ x: clampUnit(x), y: clampUnit(y), pressure: clampUnit(pressure) });
  return stroke;
}

// Wire/disk form: short keys, flat point array, rounded numbers. A 500-point
// stroke serialises to roughly 4 KB of JSON.
export function serializeStroke(stroke) {
  const points = [];
  for (const point of stroke.points) {
    points.push(round(clampUnit(point.x), COORDINATE_PRECISION), round(clampUnit(point.y), COORDINATE_PRECISION), round(clampUnit(point.pressure || 0), 100));
  }
  return {
    i: String(stroke.id),
    c: isHexColor(stroke.color) ? stroke.color : "#111111",
    w: round(clampStrokeWidth(stroke.width), WIDTH_PRECISION),
    e: stroke.erase ? 1 : 0,
    p: points,
  };
}

export function deserializeStroke(raw, { remote = false } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("A whiteboard stroke arrived in an unexpected shape.");
  if (!Array.isArray(raw.p)) throw new Error("A whiteboard stroke arrived without any points.");
  if (raw.p.length % 3 !== 0) throw new Error("A whiteboard stroke arrived with an incomplete point list.");
  if (raw.p.length / 3 > MAX_POINTS_PER_STROKE) throw new Error("A whiteboard stroke arrived with too many points.");
  const id = typeof raw.i === "string" && raw.i.length > 0 && raw.i.length <= 64 ? raw.i : nextStrokeId(remote ? "r" : "l");
  const stroke = {
    id,
    color: isHexColor(raw.c) ? raw.c : "#111111",
    width: clampStrokeWidth(raw.w),
    erase: raw.e === 1 || raw.e === true,
    remote: Boolean(remote),
    points: [],
  };
  for (let index = 0; index < raw.p.length; index += 3) {
    stroke.points.push({
      x: clampUnit(raw.p[index]),
      y: clampUnit(raw.p[index + 1]),
      pressure: clampUnit(raw.p[index + 2]),
    });
  }
  return stroke;
}

// A live fragment of a stroke, so a paired peer sees a line appear as it is
// drawn instead of only when the pen lifts. `o` is the index the fragment's
// points start at, so the receiver can append without guessing.
export function serializeStrokeChunk(stroke, fromIndex = 0, final = false) {
  const start = Math.max(0, Math.min(fromIndex, stroke.points.length));
  const slice = { ...stroke, points: stroke.points.slice(start) };
  return { ...serializeStroke(slice), o: start, f: final ? 1 : 0 };
}

export function deserializeStrokeChunk(raw) {
  const stroke = deserializeStroke(raw, { remote: true });
  const offset = Number(raw?.o);
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_POINTS_PER_STROKE) throw new Error("A whiteboard stroke fragment arrived with an invalid position.");
  return { stroke, offset, final: raw?.f === 1 || raw?.f === true };
}

// Folds a fragment into whatever the receiver already has for that stroke id.
// Returns the merged stroke plus the index new points start at, so the caller
// can draw only the new segment instead of re-rendering the board.
export function mergeStrokeChunk(existing, { stroke, offset, final }) {
  if (!existing) {
    if (offset !== 0) throw new Error("A whiteboard stroke fragment arrived before its start. The board may be out of sync.");
    return { stroke, from: 0, final };
  }
  if (offset > existing.points.length) throw new Error("A whiteboard stroke fragment arrived out of order. The board may be out of sync.");
  const skip = existing.points.length - offset;
  const fresh = stroke.points.slice(skip);
  const from = Math.max(0, existing.points.length - 1);
  const merged = {
    ...existing,
    color: stroke.color,
    width: stroke.width,
    erase: stroke.erase,
    points: existing.points.concat(fresh).slice(0, MAX_POINTS_PER_STROKE),
  };
  return { stroke: merged, from, final };
}

export function serializeBoard(strokes) {
  const list = Array.isArray(strokes) ? strokes.slice(0, MAX_STROKES) : [];
  return JSON.stringify({ v: BOARD_VERSION, strokes: list.map(serializeStroke) });
}

export function deserializeBoard(text) {
  let parsed;
  try {
    parsed = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    throw new Error("That whiteboard file could not be read.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("That whiteboard file is not in the expected format.");
  if (parsed.v !== BOARD_VERSION) throw new Error("That whiteboard file was made by a different version of this tool.");
  if (!Array.isArray(parsed.strokes)) throw new Error("That whiteboard file has no strokes.");
  if (parsed.strokes.length > MAX_STROKES) throw new Error("That whiteboard file has too many strokes.");
  return parsed.strokes.map((raw) => deserializeStroke(raw));
}

export function countPoints(strokes) {
  return (strokes || []).reduce((total, stroke) => total + stroke.points.length, 0);
}

// ============================================================================
// Browser-only below this line: canvas, devicePixelRatio, and pointer paths.
// Nothing here runs at import time, so Node tests can import this module.
// ============================================================================

export function boardContext(canvas) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create a 2D drawing workspace.");
  return context;
}

// Sizes the canvas backing store to the CSS box times devicePixelRatio, then
// scales the context so all drawing uses CSS pixels. Returns the CSS size, which
// is also the space stroke fractions are multiplied into.
export function prepareCanvas(canvas, { width, height, ratio } = {}) {
  const dpr = ratio || window.devicePixelRatio || 1;
  const cssWidth = Math.max(1, Math.round(width || canvas.clientWidth || 1));
  const cssHeight = Math.max(1, Math.round(height || canvas.clientHeight || 1));
  canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  const context = boardContext(canvas);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.lineCap = "round";
  context.lineJoin = "round";
  return { context, width: cssWidth, height: cssHeight, ratio: dpr };
}

// Converts a pointer event to board space (0..1) using the element's own box, so
// it is correct under CSS scaling, scrolling, and any devicePixelRatio.
export function pointFromEvent(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 1;
  const height = rect.height || 1;
  return {
    x: clampUnit((event.clientX - rect.left) / width),
    y: clampUnit((event.clientY - rect.top) / height),
    // Mouse input reports a flat 0.5; treat that (and 0) as "no pressure".
    pressure: event.pressure && event.pressure !== 0.5 ? clampUnit(event.pressure) : 0,
  };
}

function applyStrokeStyle(context, stroke, size) {
  context.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
  context.globalAlpha = stroke.erase ? 1 : stroke.remote ? 0.72 : 1;
  context.strokeStyle = stroke.erase ? "#000000" : isHexColor(stroke.color) ? stroke.color : "#111111";
  context.lineCap = "round";
  context.lineJoin = "round";
  return Math.max(0.5, clampStrokeWidth(stroke.width) * size.width);
}

function segmentWidth(baseWidth, point) {
  if (!point?.pressure) return baseWidth;
  return Math.max(0.5, baseWidth * (0.45 + 1.1 * point.pressure));
}

// Draws only points[from..end], which is what the live pointer loop and an
// incoming peer fragment both need.
export function drawStrokeSegment(context, stroke, size, from = 0) {
  const points = stroke.points;
  if (!points.length) return;
  const baseWidth = applyStrokeStyle(context, stroke, size);
  if (points.length === 1) {
    // A tap still leaves a dot.
    context.beginPath();
    context.arc(points[0].x * size.width, points[0].y * size.height, segmentWidth(baseWidth, points[0]) / 2, 0, Math.PI * 2);
    context.fillStyle = context.strokeStyle;
    context.fill();
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    return;
  }
  const start = Math.max(0, Math.min(from, points.length - 2));
  for (let index = start; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    context.lineWidth = segmentWidth(baseWidth, b);
    context.beginPath();
    context.moveTo(a.x * size.width, a.y * size.height);
    context.lineTo(b.x * size.width, b.y * size.height);
    context.stroke();
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
}

// Full repaint: used on resize, undo, redo, and load. Strokes are drawn onto a
// transparent surface so eraser strokes (destination-out) behave the same on
// screen as they do in an export.
export function renderBoard(context, strokes, size) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.restore();
  for (const stroke of strokes || []) drawStrokeSegment(context, stroke, size, 0);
}

// Renders to an offscreen canvas for PNG/PDF export. The strokes land on a
// transparent layer first, then that layer is composited over the background,
// so eraser strokes reveal the background instead of punching a hole in it.
export function exportBoardCanvas(strokes, { width = 1600, height = 1000, background = "#ffffff" } = {}) {
  const layer = document.createElement("canvas");
  layer.width = Math.max(1, Math.round(width));
  layer.height = Math.max(1, Math.round(height));
  const layerContext = boardContext(layer);
  const size = { width: layer.width, height: layer.height };
  for (const stroke of strokes || []) drawStrokeSegment(layerContext, stroke, size, 0);

  const output = document.createElement("canvas");
  output.width = layer.width;
  output.height = layer.height;
  const context = boardContext(output);
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, output.width, output.height);
  }
  context.drawImage(layer, 0, 0);
  // Drop the intermediate surface's pixels promptly on browsers that keep it.
  layer.width = 1;
  layer.height = 1;
  return output;
}
