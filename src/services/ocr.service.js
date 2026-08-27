// Local OCR (Phase 4b) built on tesseract.js. Nothing here touches the network.
//
// tesseract.js normally downloads its worker script, its WebAssembly core, and
// the language model from a CDN at runtime. That would break both the offline
// promise and the page's `default-src 'self'` CSP, so all four pieces are
// VENDORED into assets/vendor/tesseract and every path is passed explicitly:
//
//   assets/vendor/tesseract/tesseract.min.js               (UMD build, ~63 KB)
//   assets/vendor/tesseract/worker.min.js                  (worker, ~111 KB)
//   assets/vendor/tesseract/core/*-lstm.wasm.js            (3 SIMD variants, ~11.7 MB)
//   assets/vendor/tesseract/lang/<code>.traineddata.gz     (one model per language)
//
// Re-vendor after bumping the devDependencies with:
//   cp node_modules/tesseract.js/dist/tesseract.min.js assets/vendor/tesseract/
//   cp node_modules/tesseract.js/dist/worker.min.js assets/vendor/tesseract/
//   cp node_modules/tesseract.js-core/tesseract-core*-lstm.wasm.js assets/vendor/tesseract/core/
//
// The language models come from the @tesseract.js-data/<code> npm packages
// (version 1.0.0), variant `4.0.0_best_int` — the same source/variant as the
// English core, so every model is compatible with the vendored WebAssembly. To
// add a language, extract `package/4.0.0_best_int/<code>.traineddata.gz` from
// `@tesseract.js-data/<code>` into lang/, add it to OCR_LANGUAGES below, and
// register its sha256 in scripts/security-audit.js and scripts/build-check.js.
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
// pulls one core variant (~3.9 MB) plus the worker; the repo carries all three
// SIMD variants so any browser gets a matching build. The selected language's
// model is fetched separately, lazily, and only when OCR actually runs.
export const OCR_ENGINE_SIZE_LABEL = "about 4 MB of engine";

// The curated set of recognition languages vendored under
// assets/vendor/tesseract/lang. `file` is the on-disk gzipped model and
// `sizeBytes` its exact size, so the UI can warn about the one-time download and
// the tests can catch drift. This list is the single source of truth: every code
// here must have a vendored model (and vice-versa), asserted by the test-suite.
export const OCR_LANGUAGES = [
  { code: "eng", label: "English", file: "eng.traineddata.gz", sizeBytes: 2952873 },
  { code: "hin", label: "Hindi", file: "hin.traineddata.gz", sizeBytes: 1389692 },
  { code: "spa", label: "Spanish", file: "spa.traineddata.gz", sizeBytes: 2100190 },
  { code: "fra", label: "French", file: "fra.traineddata.gz", sizeBytes: 707406 },
  { code: "deu", label: "German", file: "deu.traineddata.gz", sizeBytes: 1333102 },
  { code: "por", label: "Portuguese", file: "por.traineddata.gz", sizeBytes: 1392239 },
  { code: "chi_sim", label: "Chinese (Simplified)", file: "chi_sim.traineddata.gz", sizeBytes: 1718768 },
  { code: "ara", label: "Arabic", file: "ara.traineddata.gz", sizeBytes: 1661906 },
  { code: "rus", label: "Russian", file: "rus.traineddata.gz", sizeBytes: 2679598 },
];

export const DEFAULT_OCR_LANG = "eng";
const AVAILABLE_LANG_CODES = new Set(OCR_LANGUAGES.map((entry) => entry.code));

/**
 * Normalises a language selection ("hin", "eng+hin", or ["eng","hin"]) into a
 * validated Tesseract lang string. Only languages with a locally vendored model
 * survive; duplicates are dropped and, if nothing valid remains, it falls back
 * to English. Pure and Node-reachable so the config plumbing can be unit-tested
 * without a browser.
 *
 * @param {string | string[]} lang
 * @returns {string} a "+"-joined code string, e.g. "eng" or "hin+eng"
 */
export function resolveOcrLang(lang) {
  const requested = (Array.isArray(lang) ? lang : String(lang ?? "").split("+"))
    .map((code) => code.trim())
    .filter(Boolean);
  const seen = new Set();
  const valid = [];
  for (const code of requested) {
    if (AVAILABLE_LANG_CODES.has(code) && !seen.has(code)) {
      seen.add(code);
      valid.push(code);
    }
  }
  return valid.length ? valid.join("+") : DEFAULT_OCR_LANG;
}

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
// pointlessly slow). It is keyed on the resolved language string: asking for a
// different language terminates the old worker and starts one with that model,
// so only the selected language's traineddata is ever fetched. `progressListener`
// is swapped per job so the caller's progress callback always receives the
// current page's events.
let workerPromise = null;
let workerLang = null;
let progressListener = null;

async function getWorker(lang = DEFAULT_OCR_LANG) {
  const resolved = resolveOcrLang(lang);
  if (workerPromise && workerLang === resolved) return workerPromise;
  // A different language needs a fresh worker with that model loaded.
  if (workerPromise) await terminateOcrWorker();
  const Tesseract = await loadTesseract();

  // tesseract.js swallows start-up failures other than the core load (its
  // internal chain ends in `.catch(() => {})`), so a missing language model
  // would leave `createWorker` pending forever. Racing an `errorHandler`-fed
  // rejection turns every start-up failure into a real error the UI can show.
  let reportFailure;
  const failed = new Promise((_, reject) => { reportFailure = reject; });

  workerLang = resolved;
  workerPromise = Promise.race([
    // The resolved code(s) drive both loadLanguage and initialize inside
    // createWorker; langPath is the local vendored dir so the model is read
    // from disk, never a CDN. "eng+hin"-style strings load several models.
    Tesseract.createWorker(resolved, 1, {
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
    workerLang = null;
    throw new Error(`The local OCR engine could not start: ${error?.message || error}`);
  });
  return workerPromise;
}

/** Releases the OCR worker (and its WebAssembly heap). Safe to call twice. */
export async function terminateOcrWorker() {
  const pending = workerPromise;
  workerPromise = null;
  workerLang = null;
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
 * @param {{ lang?: string | string[], searchablePdf?: boolean, dpi?: number, onProgress?: (done: number, total: number) => void, onStage?: (page: number, total: number, stage: string) => void }} [options]
 */
export async function ocrImages(images, { lang = DEFAULT_OCR_LANG, searchablePdf = false, dpi, onProgress, onStage } = {}) {
  const list = Array.from(images || []);
  if (!list.length) throw new Error("Add at least one page or image to read.");
  const worker = await getWorker(lang);
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
 * @param {{ lang?: string | string[], dpi?: number, searchablePdf?: boolean, onProgress?: (done: number, total: number) => void, onStage?: (page: number, total: number, stage: string) => void, onRender?: (page: number, total: number) => void }} [options]
 */
export async function ocrPdf(file, { lang = DEFAULT_OCR_LANG, dpi = 200, searchablePdf = true, onProgress, onStage, onRender } = {}) {
  const images = await pdfToImages(file, { format: "png", dpi, onProgress: onRender });
  const results = await ocrImages(images, { lang, searchablePdf, dpi, onProgress, onStage });
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
