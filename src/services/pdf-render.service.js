import { zipSync } from "fflate";
import { getPdfLib } from "./pdf.service.js";

// pdf.js (with its locally-bundled worker) is loaded lazily so that:
//  1. This module can be imported in Node for unit tests without tripping over
//     the Vite-only `?url` worker import inside ../lib/pdfjs.
//  2. The large pdf.js chunk is only fetched in the browser when a rendering
//     tool actually runs.
async function getPdfjs() {
  return import("../lib/pdfjs");
}

const IMAGE_MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("This browser could not encode the page image."))),
      mime,
      quality
    );
  });
}

async function canvasToBytes(canvas, mime, quality) {
  const blob = await canvasToBlob(canvas, mime, quality);
  return new Uint8Array(await blob.arrayBuffer());
}

function releaseCanvas(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

/** Point-size of a source page, accounting for its rotation. */
function pagePointSize(srcPage) {
  const [, , width, height] = srcPage.view;
  const rotation = (((srcPage.rotate || 0) % 360) + 360) % 360;
  const swap = rotation === 90 || rotation === 270;
  return { width: swap ? height : width, height: swap ? width : height };
}

/**
 * Renders every page to a canvas, applies an optional pixel transform, and
 * rebuilds a flat (non-interactive) PDF sized to the original page points.
 * Shared by compress / flatten / invert.
 *
 * @param {File} file
 * @param {{ dpi?: number, format?: string, quality?: number, transform?: Function, onProgress?: (page: number, total: number) => void }} [options]
 */
export async function rasterRebuild(file, { dpi = 150, format = "png", quality = 0.92, transform, onProgress } = {}) {
  const { PDFDocument } = getPdfLib();
  const { loadPdfDocument, renderPdfPageToCanvas } = await getPdfjs();
  const scale = Math.max(0.1, dpi / 72);

  const pdf = await loadPdfDocument(file);
  const out = await PDFDocument.create();
  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const canvas = await renderPdfPageToCanvas(pdf, pageNum, scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser could not create a 2D canvas.");

      // JPEG has no alpha, so flatten transparency onto white first.
      if (format === "jpg") {
        context.globalCompositeOperation = "destination-over";
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.globalCompositeOperation = "source-over";
      }

      if (transform) transform(canvas, context, pageNum);

      const embedded =
        format === "png"
          ? await out.embedPng(await canvasToBytes(canvas, "image/png"))
          : await out.embedJpg(await canvasToBytes(canvas, "image/jpeg", quality));

      const srcPage = await pdf.getPage(pageNum);
      const { width, height } = pagePointSize(srcPage);
      const page = out.addPage([width, height]);
      page.drawImage(embedded, { x: 0, y: 0, width, height });

      releaseCanvas(canvas);
      onProgress?.(pageNum, pdf.numPages);
    }
    return await out.save({ useObjectStreams: true });
  } finally {
    await pdf.destroy();
  }
}

/**
 * Renders each PDF page to an image blob. Returns one entry per page so the
 * caller can download a single page directly or bundle many into a ZIP.
 * @param {File} file
 * @param {{ format?: string, dpi?: number, quality?: number, onProgress?: (page: number, total: number) => void }} [options]
 */
export async function pdfToImages(file, { format = "jpg", dpi = 150, quality = 0.92, onProgress } = {}) {
  const mime = IMAGE_MIME[format];
  if (!mime) throw new Error("Choose JPG, PNG, or WebP output.");
  const { loadPdfDocument, renderPdfPageToCanvas } = await getPdfjs();
  const scale = Math.max(0.1, dpi / 72);

  const pdf = await loadPdfDocument(file);
  const images = [];
  try {
    const width = String(pdf.numPages).length;
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const canvas = await renderPdfPageToCanvas(pdf, pageNum, scale);
      const blob = await canvasToBlob(canvas, mime, format === "png" ? undefined : quality);
      images.push({ name: `page-${String(pageNum).padStart(width, "0")}.${format}`, blob });
      releaseCanvas(canvas);
      onProgress?.(pageNum, pdf.numPages);
    }
    return images;
  } finally {
    await pdf.destroy();
  }
}

/**
 * Extracts selectable text from a PDF, page by page. Scanned/image-only PDFs
 * legitimately return an empty string.
 *
 * `onPage(pageNumber, text)` receives each page's text as it is read, for
 * callers (Ask Your PDF) that need to keep page boundaries rather than the
 * flattened document string.
 */
export async function extractPdfText(file, { onProgress, onPage } = {}) {
  const { loadPdfDocument } = await getPdfjs();
  const pdf = await loadPdfDocument(file);
  const pages = [];
  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        text += item.str;
        if (item.hasEOL) text += "\n";
        else if (item.str && !item.str.endsWith(" ")) text += " ";
      }
      const pageText = text.replace(/[ \t]+\n/g, "\n").trimEnd();
      pages.push(pageText);
      onPage?.(pageNum, pageText);
      page.cleanup();
      onProgress?.(pageNum, pdf.numPages);
    }
    return pages.join("\n\n").trim();
  } finally {
    await pdf.destroy();
  }
}

/**
 * Compresses a PDF by rasterising each page to JPEG at the given quality/DPI and
 * re-embedding it. Returns the new bytes plus before/after sizes so the caller
 * can warn when the result is not actually smaller.
 * @param {File} file
 * @param {{ quality?: number, dpi?: number, onProgress?: (page: number, total: number) => void }} [options]
 */
export async function compressPdf(file, { quality = 0.6, dpi = 120, onProgress } = {}) {
  const bytes = await rasterRebuild(file, { format: "jpg", dpi, quality, onProgress });
  return { bytes, before: file.size, after: bytes.byteLength };
}

/**
 * Renders each page to an image and rebuilds a flat, non-interactive PDF. This
 * bakes in (and removes) form fields and annotations.
 * @param {File} file
 * @param {{ dpi?: number, onProgress?: (page: number, total: number) => void }} [options]
 */
export async function flattenPdf(file, { dpi = 150, onProgress } = {}) {
  return rasterRebuild(file, { format: "png", dpi, onProgress });
}

/**
 * Renders each page, inverts its colours, and rebuilds the PDF (dark-mode /
 * printer-friendly).
 * @param {File} file
 * @param {{ dpi?: number, onProgress?: (page: number, total: number) => void }} [options]
 */
export async function invertPdf(file, { dpi = 150, onProgress } = {}) {
  return rasterRebuild(file, {
    format: "png",
    dpi,
    onProgress,
    transform: (canvas, context) => {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const data = image.data;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i];
        data[i + 1] = 255 - data[i + 1];
        data[i + 2] = 255 - data[i + 2];
      }
      context.putImageData(image, 0, 0);
    },
  });
}

/**
 * Splits a PDF into one single-page PDF per page and bundles them into a ZIP.
 * Pure pdf-lib + fflate (no rendering), so this path is unit-testable in Node.
 * Returns the zipped bytes and the page count.
 */
export async function pdfToZip(file, { onProgress } = {}) {
  const { PDFDocument } = getPdfLib();
  const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const count = source.getPageCount();
  if (!count) throw new Error("This PDF has no pages to split.");

  const width = String(count).length;
  const entries = {};
  for (let index = 0; index < count; index++) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(source, [index]);
    doc.addPage(page);
    entries[`page-${String(index + 1).padStart(width, "0")}.pdf`] = await doc.save();
    onProgress?.(index + 1, count);
  }
  return { zipped: zipSync(entries, { level: 6 }), pages: count };
}
