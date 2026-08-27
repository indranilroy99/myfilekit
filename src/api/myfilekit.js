// MyFileKit programmatic API — a stable, namespaced surface over the existing
// services. This is the differentiator: unlike iLovePDF / Stirling PDF, whose
// APIs are SERVER-SIDE (you upload your file to their machine), this API runs
// 100% in the caller's own browser or Node process. There is no server, no
// upload, no API key — your bytes never leave the process.
//
// This module is a THIN wrapper: every method delegates to the real service
// functions the app itself uses (pdf.service, pdf-render, pdf-crypto, ocr, …).
// Nothing here re-implements the work. Every method is a local computation and
// makes no network calls of any kind — with ONE explicit, opt-in exception:
// pdf.sign(file, { timestamp: true, tsaUrl }) contacts the user-supplied RFC 3161
// timestamp authority. Even then it sends only a SHA-256 hash of the CMS
// signature (never the document), the default off-by-default toggle keeps it
// silent, and the request is Content-Security-Policy connect-src-gated, so it
// only succeeds on a deploy whose CSP the operator has opened for that TSA.
// Methods that need a browser (canvas / pdf.js / tesseract) throw the same clear
// errors their services throw when run outside one; the pure pdf-lib methods
// (merge, split, encrypt, …) also work in Node.

import {
  mergePdfs,
  extractPdfPages,
  deletePdfPages,
  rotatePdfPages,
  addTextToPdf,
  addPdfPageNumbers,
  watermarkPdf,
  cleanPdfMetadata,
  textToPdf,
  imagesToPdf,
  loadPdf,
} from "../services/pdf.service.js";
import {
  organizePdfPages,
  cropResizePdf,
  addHeadersFooters,
  fillPdfForm,
  readPdfFormFields,
  redactPdf,
  repairPdf,
  fingerprintPdf,
} from "../services/pdf-edit.service.js";
import {
  compressPdf,
  flattenPdf,
  invertPdf,
  pdfToImages,
  pdfToZip,
  extractPdfText,
} from "../services/pdf-render.service.js";
import { encryptPdf, decryptPdf, unlockPdf } from "../services/pdf-crypto.service.js";
import { sanitizePdf } from "../services/pdf-sanitize.service.js";
import { archivalPrepPdf } from "../services/pdf-review.service.js";
import { auditPdfAccessibility, remediatePdfAccessibility } from "../services/pdf-accessibility.service.js";
import { batesNumberPdf, smartSplitPdf, imposePdf } from "../services/pdf-advanced.service.js";
import { extractPdfAssets, buildExtractionZip } from "../services/pdf-extract.service.js";
import { signPdf, verifyPdfSignatures } from "../services/pdf-sign.service.js";
import { ocrPdf, ocrImages } from "../services/ocr.service.js";
import { compressImage, resizeImage, exportCanvas } from "../services/image.service.js";
import { runBatch, zipOutputs } from "../services/batch.service.js";
import { WORKFLOW_OPS } from "../services/business.service.js";
import { parsePageRanges } from "../utils/format.js";

const VERSION = "1.0.0";

/**
 * Coerces a File / Blob / Uint8Array / ArrayBuffer into a File the file-based
 * services can read. A real File is returned untouched.
 * @returns {File}
 */
function asFile(input, name = "document.pdf", type = "application/pdf") {
  if (input && typeof input.arrayBuffer === "function" && typeof input.name === "string") return input;
  if (input && typeof input.arrayBuffer === "function") return new File([input], name, { type }); // Blob
  if (input instanceof Uint8Array || input instanceof ArrayBuffer) return new File([input], name, { type });
  throw new Error("Expected a File, Blob, Uint8Array, or ArrayBuffer.");
}

/** Coerces a File / Blob / Uint8Array / ArrayBuffer into raw bytes. */
async function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (input && typeof input.arrayBuffer === "function") return new Uint8Array(await input.arrayBuffer());
  throw new Error("Expected a File, Blob, Uint8Array, or ArrayBuffer.");
}

const pdf = {
  /** Combine several PDFs into one. @returns {Promise<Uint8Array>} */
  merge(files) {
    const list = Array.from(files || []).map((file) => asFile(file));
    if (list.length < 1) throw new Error("Provide at least one PDF to merge.");
    return mergePdfs(list);
  },
  /**
   * Pull the given pages into a single new PDF. `ranges` is a page-range string
   * ("1-3,5", 1-based) or an array of 0-based indexes. @returns {Promise<Uint8Array>}
   */
  async split(file, ranges) {
    const source = asFile(file);
    let indexes = ranges;
    if (!Array.isArray(ranges)) {
      const doc = await loadPdf(source);
      indexes = parsePageRanges(String(ranges ?? ""), doc.getPageCount());
    }
    return extractPdfPages(source, indexes);
  },
  /** Keep only these 0-based page indexes. @returns {Promise<Uint8Array>} */
  extractPages(file, indexes) {
    return extractPdfPages(asFile(file), indexes);
  },
  /** Remove these 0-based page indexes. @returns {Promise<Uint8Array>} */
  deletePages(file, indexes) {
    return deletePdfPages(asFile(file), indexes);
  },
  /** Rotate the given pages (or every page) by a multiple of 90°. @returns {Promise<Uint8Array>} */
  async rotate(file, degrees, indexes) {
    const source = asFile(file);
    const pages = indexes || (await loadPdf(source)).getPageIndices();
    return rotatePdfPages(source, pages, degrees);
  },
  /** Reorder / duplicate / drop pages by a page-order string ("3,1,2"). @returns {Promise<Uint8Array>} */
  organize(file, order) {
    return organizePdfPages(asFile(file), order);
  },
  /** Scale to a standard size or apply a margin crop. @returns {Promise<Uint8Array>} */
  cropResize(file, options) {
    return cropResizePdf(asFile(file), options);
  },
  /** Stamp brand-new text onto a page. @returns {Promise<Uint8Array>} */
  addText(file, text, options) {
    return addTextToPdf(asFile(file), text, options);
  },
  /** Stamp a diagonal text watermark across every page. @returns {Promise<Uint8Array>} */
  watermark(file, text, options) {
    return watermarkPdf(asFile(file), text, options);
  },
  /** Add centred page numbers to every page. @returns {Promise<Uint8Array>} */
  pageNumbers(file, options) {
    return addPdfPageNumbers(asFile(file), options);
  },
  /** Stamp continuous legal Bates numbers. @returns {Promise<{bytes:Uint8Array,first:string,last:string,count:number}>} */
  bates(file, options) {
    return batesNumberPdf(asFile(file), options);
  },
  /** Draw custom header / footer text on every page. @returns {Promise<Uint8Array>} */
  headersFooters(file, options) {
    return addHeadersFooters(asFile(file), options);
  },
  /** Remove the Info dictionary, XMP, and private app data. @returns {Promise<Uint8Array>} */
  cleanMetadata(file) {
    return cleanPdfMetadata(asFile(file));
  },
  /** Read a PDF's form fields. @returns {Promise<Array>} */
  readFormFields(file) {
    return readPdfFormFields(asFile(file));
  },
  /** Fill an AcroForm's fields, optionally flattening. @returns {Promise<Uint8Array>} */
  fillForm(file, values, flatten = false) {
    return fillPdfForm(asFile(file), values, flatten);
  },
  /** Split one PDF into several files (browser). @returns {Promise<{zipped:Uint8Array,partCount:number}>} */
  smartSplit(file, options) {
    return smartSplitPdf(asFile(file), options);
  },
  /** N-up / booklet imposition. @returns {Promise<{bytes:Uint8Array}>} */
  impose(file, options) {
    return imposePdf(asFile(file), options);
  },
  /** Extract embedded raster images + file attachments. @returns {Promise<object>} */
  extractAssets(file, options) {
    return extractPdfAssets(asFile(file), options);
  },
  /** Bundle an extractAssets result into a ZIP. @returns {Uint8Array} */
  extractAssetsZip(result) {
    return buildExtractionZip(result);
  },
  /** Build a PDF from plain text. @returns {Promise<Uint8Array>} */
  fromText(text) {
    return textToPdf(text);
  },
  /** Build a PDF from JPG/PNG/WebP images. @returns {Promise<Uint8Array>} */
  fromImages(files) {
    return imagesToPdf(Array.from(files || []).map((file) => asFile(file, "image", "image/png")));
  },

  // --- browser-only (canvas / pdf.js) ---------------------------------------
  /** Shrink a PDF by rasterising pages (browser). @returns {Promise<{bytes:Uint8Array,before:number,after:number}>} */
  compress(file, options) {
    return compressPdf(asFile(file), options);
  },
  /** Rebuild a flat, non-interactive PDF (browser). @returns {Promise<Uint8Array>} */
  flatten(file, options) {
    return flattenPdf(asFile(file), options);
  },
  /** Invert page colours for dark-mode reading (browser). @returns {Promise<Uint8Array>} */
  invert(file, options) {
    return invertPdf(asFile(file), options);
  },
  /** Render each page to an image blob (browser). @returns {Promise<Array<{name:string,blob:Blob}>>} */
  toImages(file, options) {
    return pdfToImages(asFile(file), options);
  },
  /** Burst a PDF into one single-page PDF per page, zipped. @returns {Promise<{zipped:Uint8Array,pages:number}>} */
  toZip(file, options) {
    return pdfToZip(asFile(file), options);
  },
  /** Extract selectable text, page by page (browser). @returns {Promise<string>} */
  extractText(file, options) {
    return extractPdfText(asFile(file), options);
  },
  /** Permanently redact rectangles by rasterising black boxes (browser). @returns {Promise<{bytes:Uint8Array}>} */
  redact(file, rects, options) {
    return redactPdf(asFile(file), rects, options);
  },
  /** Best-effort repair / re-save of a damaged PDF. @returns {Promise<{bytes:Uint8Array}>} */
  repair(file, options) {
    return repairPdf(asFile(file), options);
  },
  /** Embed an invisible traceable identifier via metadata. @returns {Promise<{bytes:Uint8Array,id:string}>} */
  fingerprint(file, options) {
    return fingerprintPdf(asFile(file), options);
  },

  // --- security -------------------------------------------------------------
  /** Password-protect with AES-256/128. @returns {Promise<{bytes:Uint8Array}>} */
  encrypt(file, options) {
    return encryptPdf(asFile(file), options);
  },
  /** Decrypt a PDF you can open with its password. @returns {Promise<{bytes:Uint8Array}>} */
  decrypt(file, password) {
    return decryptPdf(asFile(file), password);
  },
  /** Remove owner-password restrictions from an openable PDF. @returns {Promise<{bytes:Uint8Array}>} */
  unlock(file) {
    return unlockPdf(asFile(file));
  },
  /** Strip active-content threats at the object level. @returns {Promise<{bytes:Uint8Array,report:object}>} */
  async sanitize(input, options) {
    return sanitizePdf(await asBytes(input), options);
  },
  /** Best-effort PDF/A archival prep (sRGB OutputIntent, PDF/A XMP, /ID, /Lang). @returns {Promise<{bytes:Uint8Array,report:object}>} */
  async archivalPrep(input, options) {
    return archivalPrepPdf(await asBytes(input), options);
  },
  /** Cryptographically sign with a PKCS#12 certificate. @returns {Promise<object>} */
  sign(file, options) {
    return signPdf(asFile(file), options);
  },
  /** Verify every digital signature in a PDF (offline maths only). @returns {Promise<object>} */
  verify(file) {
    return verifyPdfSignatures(asFile(file));
  },

  // --- accessibility (PDF/UA + WCAG basics) ---------------------------------
  accessibility: {
    /** Audit against PDF/UA + WCAG basics. @returns {Promise<object>} */
    async check(input, options) {
      return auditPdfAccessibility(await asBytes(input), options);
    },
    /** Auto-tag toward PDF/UA (language, title, structure tree, alt text). @returns {Promise<object>} */
    async tag(input, params) {
      return remediatePdfAccessibility(await asBytes(input), params);
    },
  },
};

const ocr = {
  /** OCR a scanned PDF and rebuild a searchable PDF (browser). @returns {Promise<{text:string,pages:number,bytes:Uint8Array|null}>} */
  pdf(file, options) {
    return ocrPdf(asFile(file), options);
  },
  /** OCR a list of image blobs (browser). @returns {Promise<Array>} */
  images(images, options) {
    return ocrImages(images, options);
  },
};

const image = {
  /** Re-encode an image at a chosen quality (browser). @returns {Promise<Blob>} */
  compress(file, type, quality) {
    return compressImage(asFile(file, "image", "image/jpeg"), type, quality);
  },
  /** Convert an image to another format (browser). @returns {Promise<Blob>} */
  convert(file, type, quality) {
    return compressImage(asFile(file, "image", "image/png"), type, quality);
  },
  /** Resize an image, returning encoded bytes (browser). @returns {Promise<Uint8Array>} */
  async resize(file, width, height, { preserveAspect = true, type = "image/png", quality = 0.92 } = {}) {
    const canvas = await resizeImage(asFile(file, "image", "image/png"), width, height, preserveAspect);
    return exportCanvas(canvas, type, quality);
  },
};

const batch = {
  /**
   * Apply ONE operation across MANY files, isolating per-file failures.
   * @returns {Promise<{opId:string,total:number,outputs:Array,failures:Array}>}
   */
  run(op, files, options = {}, runtime = {}) {
    return runBatch(Array.from(files || []).map((file) => asFile(file)), op, options, runtime);
  },
  /** Bundle batch outputs into a ZIP. @returns {Uint8Array} */
  zip(outputs) {
    return zipOutputs(outputs);
  },
};

const workflow = {
  /** The chainable workflow operation ids. @returns {string[]} */
  ops() {
    return Object.keys(WORKFLOW_OPS);
  },
  /**
   * Run a chain of steps over one file; each step's output feeds the next.
   * @param {Array<{op:string, options?:object}>} steps
   * @returns {Promise<Uint8Array>}
   */
  async run(steps, file) {
    if (!Array.isArray(steps) || !steps.length) throw new Error("Provide at least one workflow step.");
    let current = asFile(file);
    for (const step of steps) {
      const op = WORKFLOW_OPS[step?.op];
      if (!op) throw new Error(`"${step?.op}" is not a workflow operation.`);
      const bytes = await op.run(current, step.options || {});
      current = new File([bytes], current.name, { type: "application/pdf" });
    }
    return asBytes(current);
  },
};

/**
 * The MyFileKit programmatic API. 100% local: no server, no upload, no key.
 * Namespaced over the real services so callers get exactly what the app does.
 */
export const MyFileKit = {
  version: VERSION,
  local: true,
  pdf,
  ocr,
  image,
  batch,
  workflow,
  /** Convenience alias for pdf.extractText. */
  extractText(file, options) {
    return pdf.extractText(file, options);
  },
};

/**
 * Exposes the API on `window.MyFileKit` in a browser. Safe to call more than
 * once and a no-op outside a browser (no window). Never overwrites an existing
 * global so a page can install its own first.
 */
export function installMyFileKit() {
  if (typeof window === "undefined") return MyFileKit;
  if (!window.MyFileKit) window.MyFileKit = MyFileKit;
  return window.MyFileKit;
}

export default MyFileKit;
