// Local OCR (Phase 4b) built on tesseract.js. Nothing here touches the network.
//
// tesseract.js normally downloads its worker script, its WebAssembly core, and
// the language model from jsDelivr at runtime. That would break both the offline
// promise and the page's `default-src 'self'` CSP, so all four pieces are
// VENDORED into assets/vendor/tesseract and every path is passed explicitly:
//
//   assets/vendor/tesseract/tesseract.min.js               (UMD build, ~63 KB)
//   assets/vendor/tesseract/worker.min.js                  (worker, ~111 KB)
//   assets/vendor/tesseract/core/*-lstm.wasm.js            (3 SIMD variants, ~11.7 MB)
//   assets/vendor/tesseract/lang/eng.traineddata.gz        (English model, ~2.9 MB)
//
// Re-vendor after bumping the devDependencies with:
//   cp node_modules/tesseract.js/dist/tesseract.min.js assets/vendor/tesseract/
//   cp node_modules/tesseract.js/dist/worker.min.js assets/vendor/tesseract/
//   cp node_modules/tesseract.js-core/tesseract-core*-lstm.wasm.js assets/vendor/tesseract/core/
// (the traineddata comes from the @tesseract.js-data/eng package, 4.0.0_best_int)
//
// The main build is loaded through a same-origin <script> tag rather than an npm
// import, mirroring office.service.js's vendored SheetJS loader. That keeps the
// library's hard-coded CDN fallback strings out of the app bundle entirely and
// means the OCR engine is only fetched when someone actually runs OCR.

import { getPdfLib } from "./pdf.service.js";
import { pdfToImages } from "./pdf-render.service.js";

const VENDOR_BASE = "/assets/vendor/tesseract";
const TESSERACT_SCRIPT = `${VENDOR_BASE}/tesseract.min.js`;
const WORKER_PATH = `${VENDOR_BASE}/worker.min.js`;
const CORE_PATH = `${VENDOR_BASE}/core`;
const LANG_PATH = `${VENDOR_BASE}/lang`;

// One-time local load, so the UI can be honest about the first run. The browser
// pulls one core variant (~3.9 MB) plus the worker and the English model; the
// repo carries all three SIMD variants so any browser gets a matching build.
export const OCR_ENGINE_SIZE_LABEL = "about 4 MB of engine plus a 3 MB English model";

let tesseractPromise = null;

function loadTesseract() {
  if (tesseractPromise) return tesseractPromise;
  tesseractPromise = (async () => {
    if (typeof window === "undefined") {
      throw new Error("OCR runs in the browser only.");
    }
    if (window.Tesseract) return window.Tesseract;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = TESSERACT_SCRIPT;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("The local OCR engine could not be loaded."));
      document.head.appendChild(script);
    });
    if (!window.Tesseract) throw new Error("The local OCR engine could not be loaded.");
    return window.Tesseract;
  })();
  return tesseractPromise;
}

// A single worker is reused across pages (loading the model per page would be
// pointlessly slow). `progressListener` is swapped per job so the caller's
// progress callback always receives the current page's events.
let workerPromise = null;
let progressListener = null;

async function getWorker() {
  if (workerPromise) return workerPromise;
  const Tesseract = await loadTesseract();

  // tesseract.js swallows start-up failures other than the core load (its
  // internal chain ends in `.catch(() => {})`), so a missing language model
  // would leave `createWorker` pending forever. Racing an `errorHandler`-fed
  // rejection turns every start-up failure into a real error the UI can show.
  let reportFailure;
  const failed = new Promise((_, reject) => { reportFailure = reject; });

  workerPromise = Promise.race([
    Tesseract.createWorker("eng", 1, {
      workerPath: WORKER_PATH,
      corePath: CORE_PATH,
      langPath: LANG_PATH,
      // The traineddata is shipped gzipped, exactly as the CDN serves it.
      gzip: true,
      // MUST stay false: the default wraps the worker in a blob: URL, which the
      // page's `default-src 'self'` CSP blocks.
      workerBlobURL: false,
      logger: (message) => progressListener?.(message),
      errorHandler: (message) => reportFailure(new Error(String(message))),
    }),
    failed,
  ]).catch((error) => {
    workerPromise = null;
    throw new Error(`The local OCR engine could not start: ${error?.message || error}`);
  });
  return workerPromise;
}

/** Releases the OCR worker (and its WebAssembly heap). Safe to call twice. */
export async function terminateOcrWorker() {
  const pending = workerPromise;
  workerPromise = null;
  progressListener = null;
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // Nothing useful to do if the worker already died.
  }
}

function statusText(message) {
  const percent = Math.round((message?.progress ?? 0) * 100);
  return `${message?.status || "working"} ${percent}%`;
}

/**
 * OCRs a list of `{ name, blob }` images in order. Returns one entry per image
 * with its recognised text and, when `searchablePdf` is set, a single-page PDF
 * that draws the image with an invisible text layer on top.
 *
 * @param {Array<{ name?: string, blob: Blob } | Blob>} images
 * @param {{ searchablePdf?: boolean, dpi?: number, onProgress?: (done: number, total: number) => void, onStage?: (page: number, total: number, stage: string) => void }} [options]
 */
export async function ocrImages(images, { searchablePdf = false, dpi, onProgress, onStage } = {}) {
  const list = Array.from(images || []);
  if (!list.length) throw new Error("Add at least one page or image to read.");
  const worker = await getWorker();
  if (dpi) {
    // Tesseract otherwise guesses the resolution, which mis-sizes PDF pages.
    await worker.setParameters({ user_defined_dpi: String(Math.round(dpi)) }).catch(() => {});
  }
  const results = [];
  try {
    for (let index = 0; index < list.length; index += 1) {
      const entry = list[index];
      progressListener = (message) => onStage?.(index + 1, list.length, statusText(message));
      const { data } = await worker.recognize(
        entry.blob || entry,
        { pdfTextOnly: false },
        { text: true, pdf: searchablePdf }
      );
      results.push({
        name: entry.name || `image-${index + 1}`,
        text: String(data?.text || "").trim(),
        pdf: data?.pdf ? new Uint8Array(data.pdf) : null,
      });
      onProgress?.(index + 1, list.length);
    }
    return results;
  } finally {
    progressListener = null;
  }
}

/**
 * Rasterises a PDF locally, OCRs every page, and (by default) stitches the
 * per-page searchable PDFs back into one document: the original page image with
 * an invisible, selectable text layer over it.
 *
 * @param {File} file
 * @param {{ dpi?: number, searchablePdf?: boolean, onProgress?: (done: number, total: number) => void, onStage?: (page: number, total: number, stage: string) => void, onRender?: (page: number, total: number) => void }} [options]
 */
export async function ocrPdf(file, { dpi = 200, searchablePdf = true, onProgress, onStage, onRender } = {}) {
  const images = await pdfToImages(file, { format: "png", dpi, onProgress: onRender });
  const results = await ocrImages(images, { searchablePdf, dpi, onProgress, onStage });
  const text = results.map((result, index) => `--- Page ${index + 1} ---\n${result.text}`).join("\n\n").trim();
  const pdfParts = results.map((result) => result.pdf).filter(Boolean);
  const bytes = searchablePdf && pdfParts.length === results.length ? await mergeSearchablePdfPages(pdfParts) : null;
  return { text, pages: results.length, bytes, results };
}

/** Merges the per-page searchable PDFs tesseract produced into one document. */
export async function mergeSearchablePdfPages(parts) {
  const { PDFDocument } = getPdfLib();
  const merged = await PDFDocument.create();
  for (const part of parts) {
    const source = await PDFDocument.load(part, { ignoreEncryption: true });
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return merged.save({ useObjectStreams: true });
}
