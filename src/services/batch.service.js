// Batch processing: apply ONE operation across MANY files, collecting outputs and
// isolating per-file failures, then bundle the successes into a ZIP.
//
// The op registry (BATCH_OPS) maps an id -> { label, accepts, run, outExt, ... }.
// Every `run(file, options)` reuses the SAME single-file service functions the
// standalone tools call, so batch behaviour matches them exactly.
//
// The registry + run-loop + error-collection + zip logic is 100% local and pure
// enough to unit-test in Node with the pdf-lib ops (rotate / page-numbers /
// metadata-clean / watermark / encrypt). The canvas/pdf.js ops (compress,
// flatten, image-*) are marked `browserOnly` and only run in the browser.

import { zipSync } from "fflate";
import { loadPdf, addPdfPageNumbers, cleanPdfMetadata, rotatePdfPages, watermarkPdf } from "./pdf.service.js";
import { compressPdf, flattenPdf } from "./pdf-render.service.js";
import { encryptPdf } from "./pdf-crypto.service.js";
import { compressImage, resizeImage, exportCanvas } from "./image.service.js";
import { safeFilename } from "../utils/safe-filename.js";

/** Hard cap on how many files one batch may hold. */
export const MAX_BATCH_FILES = 100;

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const IMAGE_MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Lower-case extension of a file, falling back to its MIME type. */
function extOf(file) {
  const fromName = String(file?.name || "").toLowerCase().split(".").pop();
  if (fromName && fromName !== String(file?.name || "").toLowerCase()) return fromName;
  const type = String(file?.type || "");
  if (type === "application/pdf") return "pdf";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "";
}

function isPdfFile(file) {
  return extOf(file) === "pdf" || file?.type === "application/pdf";
}

function isImageFile(file) {
  const ext = extOf(file);
  return IMAGE_EXTENSIONS.has(ext) || String(file?.type || "").startsWith("image/");
}

/** Normalise whatever a service function returns into raw Uint8Array bytes. */
async function toBytes(result) {
  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (result && typeof result.arrayBuffer === "function") return new Uint8Array(await result.arrayBuffer()); // Blob
  if (result && result.bytes) return result.bytes instanceof Uint8Array ? result.bytes : new Uint8Array(result.bytes);
  throw new Error("This operation produced no output.");
}

/**
 * Supported batch operations. `accepts` is "pdf" or "image" and drives the
 * per-file type guard. `outExt` is the output extension — a string, or a
 * function of (options, file) for ops whose extension depends on input/options.
 * `browserOnly` ops rasterise through canvas / pdf.js.
 */
export const BATCH_OPS = {
  rotate: {
    label: "Rotate pages",
    hint: "Rotate every page of each PDF.",
    accepts: "pdf",
    suffix: "rotated",
    outExt: "pdf",
    fields: [{ key: "degrees", label: "Rotation", type: "select", options: ["90", "180", "270"], default: "90" }],
    run: async (file, options) => {
      const pdf = await loadPdf(file);
      return rotatePdfPages(file, pdf.getPageIndices(), Number(options.degrees || 90));
    },
  },
  "page-numbers": {
    label: "Add page numbers",
    hint: "Stamp a centred page number on every page.",
    accepts: "pdf",
    suffix: "numbered",
    outExt: "pdf",
    fields: [
      { key: "prefix", label: "Prefix", type: "text", placeholder: "Page ", default: "" },
      { key: "fontSize", label: "Font size", type: "number", placeholder: "10", default: "10" },
    ],
    run: (file, options) => addPdfPageNumbers(file, { prefix: options.prefix || "", fontSize: Number(options.fontSize || 10) }),
  },
  watermark: {
    label: "Watermark",
    hint: "Stamp diagonal text across every page.",
    accepts: "pdf",
    suffix: "watermarked",
    outExt: "pdf",
    fields: [
      { key: "text", label: "Watermark text", type: "text", placeholder: "DRAFT", default: "DRAFT" },
      { key: "size", label: "Size", type: "number", placeholder: "48", default: "48" },
      { key: "opacity", label: "Opacity (0.05-0.6)", type: "text", placeholder: "0.18", default: "0.18" },
    ],
    run: (file, options) => watermarkPdf(file, options.text || "DRAFT", { size: Number(options.size || 48), opacity: Number(options.opacity || 0.18) }),
  },
  "metadata-clean": {
    label: "Clean metadata",
    hint: "Remove the document info dictionary from each PDF.",
    accepts: "pdf",
    suffix: "clean",
    outExt: "pdf",
    fields: [],
    run: (file) => cleanPdfMetadata(file),
  },
  encrypt: {
    label: "Encrypt (password protect)",
    hint: "Apply the same AES-256 password to every PDF.",
    accepts: "pdf",
    suffix: "encrypted",
    outExt: "pdf",
    fields: [{ key: "password", label: "Password", type: "password", placeholder: "Open password", default: "" }],
    run: (file, options) => {
      const password = String(options.password || "");
      if (!password) throw new Error("Enter a password to encrypt with.");
      return encryptPdf(file, { userPassword: password, algorithm: "aes-256" });
    },
  },
  compress: {
    label: "Compress",
    hint: "Rasterise pages at a lower quality to shrink each PDF.",
    accepts: "pdf",
    browserOnly: true,
    suffix: "compressed",
    outExt: "pdf",
    fields: [
      { key: "quality", label: "Quality", type: "select", options: ["0.4", "0.6", "0.8"], default: "0.6" },
      { key: "dpi", label: "DPI", type: "select", options: ["100", "120", "150"], default: "120" },
    ],
    run: (file, options) => compressPdf(file, { quality: Number(options.quality || 0.6), dpi: Number(options.dpi || 120) }),
  },
  flatten: {
    label: "Flatten",
    hint: "Rebuild each PDF flat and non-interactive.",
    accepts: "pdf",
    browserOnly: true,
    suffix: "flat",
    outExt: "pdf",
    fields: [{ key: "dpi", label: "DPI", type: "select", options: ["120", "150", "200"], default: "150" }],
    run: (file, options) => flattenPdf(file, { dpi: Number(options.dpi || 150) }),
  },
  "image-compress": {
    label: "Compress image",
    hint: "Re-encode each image at a chosen quality, keeping its format.",
    accepts: "image",
    browserOnly: true,
    suffix: "compressed",
    outExt: (_options, file) => extOf(file) || "jpg",
    fields: [{ key: "quality", label: "Quality (0.1-1)", type: "text", placeholder: "0.8", default: "0.8" }],
    run: (file, options) => {
      const mime = IMAGE_MIME[extOf(file)] || file.type || "image/jpeg";
      return compressImage(file, mime, clampQuality(options.quality, 0.8));
    },
  },
  "image-convert": {
    label: "Convert image format",
    hint: "Convert every image to one target format.",
    accepts: "image",
    browserOnly: true,
    suffix: "converted",
    outExt: (options) => (options.format || "png"),
    fields: [
      { key: "format", label: "Target format", type: "select", options: ["png", "jpg", "webp"], default: "png" },
      { key: "quality", label: "Quality (0.1-1)", type: "text", placeholder: "0.9", default: "0.9" },
    ],
    run: (file, options) => {
      const mime = IMAGE_MIME[options.format] || "image/png";
      return compressImage(file, mime, clampQuality(options.quality, 0.9));
    },
  },
  "image-resize": {
    label: "Resize image",
    hint: "Resize every image to the same dimensions.",
    accepts: "image",
    browserOnly: true,
    suffix: "resized",
    outExt: (_options, file) => extOf(file) || "png",
    fields: [
      { key: "width", label: "Width (px)", type: "number", placeholder: "1024", default: "" },
      { key: "height", label: "Height (px)", type: "number", placeholder: "", default: "" },
      { key: "preserveAspect", label: "Lock aspect ratio", type: "checkbox", default: "true" },
    ],
    run: async (file, options) => {
      const mime = IMAGE_MIME[extOf(file)] || file.type || "image/png";
      const preserve = options.preserveAspect === true || options.preserveAspect === "true";
      const canvas = await resizeImage(file, options.width, options.height, preserve);
      return exportCanvas(canvas, mime, 0.92);
    },
  },
};

function clampQuality(value, fallback) {
  const q = Number(value);
  if (!Number.isFinite(q) || q <= 0 || q > 1) return fallback;
  return q;
}

/** List for the UI: id, label, hint, accepts, browserOnly, fields. */
export function batchOpList() {
  return Object.entries(BATCH_OPS).map(([id, op]) => ({
    id,
    label: op.label,
    hint: op.hint,
    accepts: op.accepts,
    browserOnly: Boolean(op.browserOnly),
    fields: op.fields,
  }));
}

export function defaultBatchOptions(opId) {
  // Own-property check only, so inherited keys ("__proto__", "toString") get the
  // same friendly error as any other unknown op.
  if (!Object.hasOwn(BATCH_OPS, opId)) throw new Error(`"${opId}" is not a supported batch operation.`);
  return Object.fromEntries(BATCH_OPS[opId].fields.map((field) => [field.key, field.default ?? ""]));
}

/** MIME type accepted by an op's file picker. */
export function batchAcceptFor(opId) {
  if (!Object.hasOwn(BATCH_OPS, opId)) return "";
  return BATCH_OPS[opId].accepts === "image" ? "image/jpeg,image/png,image/webp" : "application/pdf";
}

function resolveOutExt(op, options, file) {
  const ext = typeof op.outExt === "function" ? op.outExt(options, file) : op.outExt;
  return String(ext || "bin").replace(/^\./, "").toLowerCase();
}

/**
 * Runs one op over many files, sequentially. A per-file failure is recorded and
 * the loop keeps going, so one bad file never aborts the batch. Only one file is
 * processed at a time (no fleet of canvases held at once).
 *
 * @param {File[]} files
 * @param {string} opId
 * @param {Record<string, unknown>} options
 * @param {{ onProgress?: (info: {current:number,total:number,name:string}) => void, maxFiles?: number, maxSize?: number }} [runtime]
 * @returns {Promise<{ opId:string, total:number, outputs:{name:string,bytes:Uint8Array}[], failures:{name:string,reason:string}[] }>}
 */
export async function runBatch(files, opId, options = {}, { onProgress, maxFiles = MAX_BATCH_FILES, maxSize = 0 } = {}) {
  if (!Object.hasOwn(BATCH_OPS, opId)) throw new Error(`"${opId}" is not a supported batch operation.`);
  const list = Array.from(files || []);
  if (!list.length) throw new Error("Choose at least one file first.");
  if (list.length > maxFiles) throw new Error(`Choose no more than ${maxFiles} files at a time. You selected ${list.length}.`);

  const op = BATCH_OPS[opId];
  const outputs = [];
  const failures = [];
  const usedNames = new Set();

  const uniqueName = (base, ext) => {
    let candidate = `${base}.${ext}`;
    let n = 2;
    while (usedNames.has(candidate)) candidate = `${base}-${n++}.${ext}`;
    usedNames.add(candidate);
    return candidate;
  };

  for (let index = 0; index < list.length; index += 1) {
    const file = list[index];
    const name = String(file?.name || `file-${index + 1}`);
    onProgress?.({ current: index + 1, total: list.length, name });

    // Type guard: skip (flag) files the op can't process, never crash.
    const typeOk = op.accepts === "image" ? isImageFile(file) : isPdfFile(file);
    if (!typeOk) {
      failures.push({ name, reason: op.accepts === "image" ? "Not a supported image (JPG, PNG, or WebP)." : "Not a PDF file." });
      continue;
    }
    if (maxSize > 0 && Number(file?.size) > maxSize) {
      failures.push({ name, reason: `Larger than the ${Math.round(maxSize / (1024 * 1024))} MB limit.` });
      continue;
    }

    try {
      const bytes = await toBytes(await op.run(file, options));
      const base = `${safeFilename(name)}-${op.suffix}`;
      outputs.push({ name: uniqueName(base, resolveOutExt(op, options, file)), bytes });
    } catch (error) {
      failures.push({ name, reason: error?.message || "This file could not be processed." });
    }
  }

  return { opId, total: list.length, outputs, failures };
}

/** Bundles batch outputs into a ZIP. Throws if there is nothing to bundle. */
export function zipOutputs(outputs) {
  const list = Array.isArray(outputs) ? outputs : [];
  if (!list.length) throw new Error("There are no successful outputs to bundle.");
  const entries = {};
  for (const item of list) entries[item.name] = item.bytes;
  return zipSync(entries, { level: 6 });
}
