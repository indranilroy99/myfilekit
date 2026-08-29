import * as pdfjs from "pdfjs-dist";
// Bundle the worker locally via Vite's `?worker` import. Vite compiles this into
// a proper worker constructor (correct module type + local hashed asset), which
// keeps the app 100% offline (same-origin, no CDN — the `script-src 'self'` CSP
// would block a CDN anyway). We hand pdf.js the worker via `workerPort` set
// EAGERLY at module load, so pdf.js never falls back to guessing the worker type
// (which spawns a broken classic worker against the ESM file and hangs).
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

try {
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
} catch {
  // If constructing a worker fails, pdf.js will run on the main thread.
}

export const ensurePdfWorker = () => {
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    try {
      pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
    } catch {
      /* main-thread fallback */
    }
  }
};

export { pdfjs };

/**
 * Loads a PDF with pdf.js. Always copies the buffer because pdf.js transfers
 * (detaches) the ArrayBuffer it is handed.
 */
export const loadPdfDocument = async (source: File | ArrayBuffer | Uint8Array) => {
  let bytes: Uint8Array;
  if (source instanceof File) {
    bytes = new Uint8Array(await source.arrayBuffer());
  } else if (source instanceof Uint8Array) {
    bytes = new Uint8Array(source);
  } else {
    bytes = new Uint8Array(source.slice(0));
  }
  ensurePdfWorker();
  // isEvalSupported:false stops pdf.js using Function() for some font paths. The
  // CSP already lacks 'unsafe-eval' so this is defense-in-depth, made explicit.
  return pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
};

/**
 * Renders a single page (1-based) into a fresh canvas and returns it.
 */
export const renderPdfPageToCanvas = async (
  pdf: Awaited<ReturnType<typeof loadPdfDocument>>,
  pageNumber: number,
  scale = 1.5
): Promise<HTMLCanvasElement> => {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create a 2D canvas.");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  await page.render({ canvasContext: context, viewport } as any).promise;
  page.cleanup();
  return canvas;
};
