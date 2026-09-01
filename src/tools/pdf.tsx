// PDF tools. Loaded on demand by ToolRenderer in src/App.tsx.
import { useEffect, useMemo, useRef, useState } from "react";
import { approximateTextWidth, parseAreaLines, textOverflowsPage } from "../lib/page-geometry";
import { zipSync } from "fflate";
import { ArrowLeft, ArrowRight, Eye, Scissors } from "lucide-react";
import { formatBytes, parsePageRanges } from "../utils/format.js";
import { safeFilename, withExtension } from "../utils/safe-filename.js";
import { validateFiles } from "../services/file-validator.js";
import { downloadBlob, downloadBytes, downloadText, revokeDownloadUrl } from "../services/download.service.js";
import { imageToCanvas } from "../services/image.service.js";
import { addPdfPageNumbers, addSignatureImageToPdf, addTextToPdf, deletePdfPages, extractPdfPages, getPdfLib, imagesToPdf, loadPdf, mergePdfs, rotatePdfPages, textToPdf, watermarkPdf } from "../services/pdf.service.js";
import { compressPdf as rasterCompressPdf, extractPdfText, flattenPdf, invertPdf, pdfToImages, pdfToZip, rasterRebuild } from "../services/pdf-render.service.js";
import { applyTextEdits, mapPdfFontToStandard, standardFontKey, textItemToPageRect } from "../services/pdf-textedit.service.js";
import { parseParagraphs, detectColumnLayout, flowBlocks, rebuildReflowedPdf } from "../services/pdf-reflow.service.js";
import { applyAnnotations, screenToPagePoint, pagePointToScreen, HIGHLIGHT_PALETTE, MAX_ANNOTATIONS_PER_PAGE } from "../services/annotate.service.js";
import { archivalPrepPdf, assertPdfDecryptable, checkPdfACompliance, comparePdfText, comparePdfReportText, estimateSkewAngle } from "../services/pdf-review.service.js";
import { addHeadersFooters, createPdf, cropResizePdf, fillPdfForm, organizePdfPages, readPdfFormFields, redactPdf, repairPdf } from "../services/pdf-edit.service.js";
import { BATES_POSITION_IDS, NUP_COUNTS, batesNumberPdf, blankPagesFromCoverage, pagesAfterRemovingBlanks, removePdfImages, createFormPdf, imposePdf, parseOutlineInput, parseSplitPages, readOutline, setOutline, smartSplitPdf } from "../services/pdf-advanced.service.js";
import { extractPdfAssets, buildExtractionZip } from "../services/pdf-extract.service.js";
import { LANGUAGE_OPTIONS, auditPdfAccessibility, buildAccessibilityReportText, extractAccessibilityContent, remediatePdfAccessibility } from "../services/pdf-accessibility.service.js";
import { canvasToPdf, canvasesToPdf } from "../services/convert.service.js";
import { MAX_WORKFLOW_BATCH_FILES, WORKFLOW_PRESETS, defaultStepOptions, presetSteps, runWorkflow, runWorkflowBatch, workflowOpList } from "../services/business.service.js";
import { MAX_BATCH_FILES, batchAcceptFor, batchOpList, defaultBatchOptions, runBatch, zipOutputs } from "../services/batch.service.js";
import { captureVideoFrame, enhanceCanvas, getHtml2Canvas, startCameraStream, stopCameraStream } from "../services/capture.service.js";
import { docxToHtml, epubToHtml, pptxToSlides, readWorkbookSheets, sanitizeHtmlForOffline, sheetsToHtml } from "../services/office.service.js";
import { pdfToDocx, pdfToEpub, pdfToHtml, pdfToXlsx } from "../services/export.service.js";
import { serverCapabilities, convertOfficeOnServer } from "../services/server.service.js";
import { DEFAULT_OCR_LANG, OCR_ENGINE_SIZE_LABEL, OCR_LANGUAGES, mergeSearchablePdfPages, ocrImages, ocrPdf, terminateOcrWorker } from "../services/ocr.service.js";
import { getSpeechSynthesis, loadSpeechVoices, speechSynthesisSupported, splitTextForSpeech } from "../services/audio.service.js";
import { initialStatus, ToolMetaPanel, ToolForm, ProgressBar, StatusBox, ResultConsequenceNote, FileControl, InfoRow, Input, Textarea, Select, Range, Checkbox, PrimaryButton, SecondaryButton, verdictTone, pageProgress, MiniField, runSafely, ToolNotes, canvasToBlob, requireOutput, copyText } from "./shared";
import type { Tool } from "./shared";

type PdfOutput = { url: string; blob: Blob; filename: string; pages: number; sourceName: string };
function PdfFileTool({ tool, action, run, multiple = false, accept = "application/pdf" }: { tool: Tool; action: string; run: (files: File[]) => Promise<void>; multiple?: boolean; accept?: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <FileControl accept={accept} multiple={multiple} files={files} setFiles={setFiles} />
    <PrimaryButton label={action} onClick={() => runSafely(setStatus, async () => {
      const valid = validateFiles(files, tool.file);
      await run(valid);
      return `Processed ${valid.length} file${valid.length === 1 ? "" : "s"}.`;
    })} />
  </ToolForm>;
}

/**
 * Images to PDF.
 *
 * Has its own component rather than PdfFileTool because the page size is a real
 * decision and it used to be made silently and wrongly: pages were sized in
 * image pixels read as points, so a phone photo produced a 42x56 inch page.
 */
function ImagesToPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [pageSize, setPageSize] = useState("a4");
  const [status, setStatus] = useState(initialStatus);

  const reset = () => {
    setFiles([]);
    setPageSize("a4");
    setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <FileControl accept="image/jpeg,image/png,image/webp" multiple files={files} setFiles={setFiles} />
    <Select
      label="Page size"
      value={pageSize}
      onChange={setPageSize}
      options={["a4", "match"]}
      labels={["A4 — every page the same, ready to print", "Match each image — borderless, no white edges"]}
    />
    <p className="text-xs font-semibold text-neutral-500">
      A4 centres each image on a standard page, turning the page sideways for a landscape photo.
      Matching gives each image its own borderless page in the same shape, sized so the longest
      side is the length of an A4 sheet.
    </p>
    <PrimaryButton label="Create PDF" onClick={() => runSafely(setStatus, async () => {
      const valid = validateFiles(files, tool.file);
      const bytes = await imagesToPdf(valid, { pageSize });
      downloadBytes(bytes, "myfilekit-images.pdf", "application/pdf");
      return `Created a ${valid.length}-page PDF${pageSize === "a4" ? " on A4 pages" : ""}.`;
    })} />
  </ToolForm>;
}


/**
 * Remove Blank Pages.
 *
 * Shows what it found and lets you untick before anything is dropped — the
 * whole point of the tool is that you do not have to trust it blindly, and a
 * page it wrongly calls blank would otherwise be gone from your document.
 */
function RemoveBlankPagesTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [found, setFound] = useState<{ page: number; ink: number; drop: boolean }[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => { setFiles([]); setFound([]); setPageCount(0); setStatus(initialStatus); };

  // A new document invalidates the previous scan; showing page 3 as blank for a
  // file it was not measured on is how the wrong page gets deleted.
  useEffect(() => { setFound([]); setPageCount(0); }, [files]);

  const scan = () => runSafely(setStatus, async () => {
    const [file] = validateFiles(files, tool.file);
    const { renderPdfPageToCanvas, loadPdfDocument } = await import("../lib/pdfjs");
    const doc = await loadPdfDocument(new Uint8Array(await file.arrayBuffer()));
    const coverage: number[] = [];
    for (let page = 1; page <= doc.numPages; page += 1) {
      setStatus({ tone: "idle", message: `Checking page ${page} of ${doc.numPages}…`, progress: { value: page, total: doc.numPages, label: "Checking…" } });
      const canvas = await renderPdfPageToCanvas(doc, page, 0.4);
      const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) ink += 1;
      coverage.push(ink / (canvas.width * canvas.height));
    }
    const blank = blankPagesFromCoverage(coverage);
    setPageCount(doc.numPages);
    setFound(blank.map((page) => ({ page, ink: coverage[page - 1], drop: true })));
    return blank.length
      ? `Found ${blank.length} blank page${blank.length === 1 ? "" : "s"} of ${doc.numPages}. Review them below, then remove.`
      : `No blank pages found in ${doc.numPages} page${doc.numPages === 1 ? "" : "s"}.`;
  });

  return <ToolForm status={status} onReset={reset}>
    <p className="tool-lead">Find the empty pages a scanner leaves behind, then drop the ones you confirm.</p>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PrimaryButton label="Find blank pages" onClick={scan} />
    {found.length > 0 && (
      <div className="surface-card grid gap-2 p-3">
        <p className="text-xs font-bold uppercase text-neutral-500">Looks blank · {found.filter((f) => f.drop).length} of {found.length} selected</p>
        {found.map((entry, index) => (
          <Checkbox
            key={entry.page}
            label={`Page ${entry.page} — ${(entry.ink * 100).toFixed(2)}% ink`}
            checked={entry.drop}
            onChange={(checked) => setFound((list) => list.map((item, i) => (i === index ? { ...item, drop: checked } : item)))}
          />
        ))}
        <SecondaryButton label="Remove selected pages" onClick={() => runSafely(setStatus, async () => {
          const [file] = validateFiles(files, tool.file);
          const drop = found.filter((entry) => entry.drop).map((entry) => entry.page);
          if (!drop.length) throw new Error("Tick at least one page to remove.");
          const { keep, removed } = pagesAfterRemovingBlanks(pageCount, drop);
          if (!removed.length) throw new Error("Every page looks blank, so nothing was removed — you would be left with an empty file.");
          const bytes = await extractPdfPages(file, keep);
          downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-cleaned`, "pdf"), "application/pdf");
          return `Removed ${removed.length} page${removed.length === 1 ? "" : "s"} (${removed.join(", ")}). ${keep.length} page${keep.length === 1 ? "" : "s"} left.`;
        })} />
      </div>
    )}
  </ToolForm>;
}

/** Remove Images: strips pictures, keeps text selectable. */
function RemovePdfImagesTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <p className="tool-lead">Take the pictures out and keep the text selectable.</p>
    <ToolNotes summary="What to know">
      <li>Unlike Compress PDF, this does not turn your text into a picture — the words stay searchable.</li>
      <li>Layout is unchanged, so removed images leave their space empty.</li>
    </ToolNotes>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PrimaryButton label="Remove images" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const { bytes, removed, before, after } = await removePdfImages(file);
      if (!removed) throw new Error("This PDF has no embedded images to remove.");
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-no-images`, "pdf"), "application/pdf");
      return `Removed ${removed} image${removed === 1 ? "" : "s"}.\n${formatBytes(before)} → ${formatBytes(after)}`;
    })} />
  </ToolForm>;
}

function PageRangeTool({ tool, action, run, suffix }: { tool: Tool; action: string; suffix: string; run: (file: File, pages: number[]) => Promise<Uint8Array> }) {
  const [files, setFiles] = useState<File[]>([]);
  const [ranges, setRanges] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [result, setResult] = useState<PdfOutput | null>(null);

  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  const reset = () => {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    setFiles([]);
    setRanges("");
    setStatus(initialStatus);
  };

  return (
    <div className="tool-form-grid">
      <div className="tool-form-actions">
        <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
        <Input label="Pages" value={ranges} onChange={setRanges} placeholder="Example: 1-3,5,8" helper="Use comma-separated pages or ranges." />
        <PrimaryButton label={action} onClick={() => runSafely(setStatus, async () => {
          // Clear the previous output before validating anything: a rejected run
          // must not leave the last result on screen with a live Download button,
          // or the user saves the wrong pages.
          setResult((previous) => {
            if (previous) URL.revokeObjectURL(previous.url);
            return null;
          });
          const [file] = validateFiles(files, tool.file);
          const pdf = await loadPdf(file);
          const pages = parsePageRanges(ranges, pdf.getPageCount());
          const bytes = await run(file, pages);
          const buffer = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(buffer).set(bytes);
          const blob = new Blob([buffer], { type: "application/pdf" });
          const output: PdfOutput = {
            url: URL.createObjectURL(blob),
            blob,
            filename: withExtension(`${safeFilename(file.name)}-${suffix}`, "pdf"),
            pages: pages.length,
            sourceName: file.name,
          };
          setResult((previous) => {
            if (previous) URL.revokeObjectURL(previous.url);
            return output;
          });
          // Count the pages in the OUTPUT, not the pages the user typed. This is
          // shared with Delete Pages, where `pages` is what was removed: deleting
          // 2 of 5 reported "2 pages" for a file that correctly had 3.
          const outputPages = (await loadPdf(new File([blob], output.filename, { type: "application/pdf" }))).getPageCount();
          output.pages = outputPages;
          return `Preview ready — ${outputPages} page${outputPages === 1 ? "" : "s"}.`;
        })} />
      </div>
      <ToolMetaPanel status={status} onReset={reset}>
        <PdfResultPanel result={result} />
      </ToolMetaPanel>
    </div>
  );
}

function PdfResultPanel({ result }: { result: PdfOutput | null }) {
  if (!result) {
    return (
      <div className="pdf-result-panel empty">
        <Eye size={20} />
        <p className="font-black">Preview will appear here</p>
        <p className="text-sm font-semibold text-neutral-500">Extract or delete pages to create a downloadable PDF preview.</p>
      </div>
    );
  }

  return (
    <section className="pdf-result-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase text-neutral-500">Generated PDF</p>
          <p className="mt-1 font-black text-[var(--foreground)]">{result.filename}</p>
          <p className="mt-1 text-sm font-semibold text-neutral-500">{result.pages} page{result.pages === 1 ? "" : "s"} from {result.sourceName}</p>
        </div>
        <span className="tag-badge rounded-full px-3 py-1 text-xs font-bold uppercase">{formatBytes(result.blob.size)}</span>
      </div>
      <iframe className="pdf-preview-frame" title={`Preview of ${result.filename}`} src={result.url} />
      <div className="grid gap-2 sm:grid-cols-2">
        <SecondaryButton label="Open preview" onClick={() => window.open(result.url, "_blank", "noopener,noreferrer")} />
        <PrimaryButton label="Download PDF" onClick={() => downloadBlob(result.blob, result.filename)} />
      </div>
    </section>
  );
}

function RotatePdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [ranges, setRanges] = useState("");
  const [degrees, setDegrees] = useState("90");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setRanges(""); setStatus(initialStatus); }}>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Input label="Pages" value={ranges} onChange={setRanges} placeholder="Leave blank for all pages" />
    <Select label="Rotation" value={degrees} onChange={setDegrees} options={["90", "180", "270"]} />
    <PrimaryButton label="Rotate PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const pdf = await loadPdf(file);
      const pages = ranges.trim() ? parsePageRanges(ranges, pdf.getPageCount()) : pdf.getPageIndices();
      downloadBytes(await rotatePdfPages(file, pages, Number(degrees)), withExtension(`${safeFilename(file.name)}-rotated`, "pdf"), "application/pdf");
      return `Rotated ${pages.length} page${pages.length === 1 ? "" : "s"}.`;
    })} />
  </ToolForm>;
}

function AddTextToPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("Approved");
  const [page, setPage] = useState("1");
  const [x, setX] = useState("72");
  const [y, setY] = useState("720");
  const [size, setSize] = useState("18");
  const [status, setStatus] = useState(initialStatus);

  const loadFiles = (next: File[]) => {
    const changed = next[0] !== files[0];
    setFiles(next);
    if (changed) { setPage("1"); setX("72"); setY("720"); setStatus(initialStatus); }
  };

  // The click point is the text's bottom-left origin, so text placed near the
  // right edge used to run off the page and be clipped with no warning.
  const [pageWidth, setPageWidth] = useState(0);
  const textWarning = pageWidth && textOverflowsPage(Number(x), approximateTextWidth(text, Number(size)), pageWidth)
    ? "This text starts too far right and will run off the page. Move it left or reduce the size."
    : "";

  // Clicking the page fills the coordinates. The event carries PDF points
  // (origin bottom-left), which is exactly what addTextToPdf expects.
  useEffect(() => {
    const onRegion = (event: Event) => {
      const d = (event as CustomEvent<{ page: number; points: { x: number; y: number }; pageWidth?: number }>).detail;
      if (!d) return;
      if (d.pageWidth) setPageWidth(d.pageWidth);
      setPage(String(d.page));
      setX(String(Math.round(d.points.x)));
      setY(String(Math.round(d.points.y)));
    };
    window.addEventListener("myfilekit:region-selected", onRegion);
    return () => window.removeEventListener("myfilekit:region-selected", onRegion);
  }, []);

  return <ToolForm status={status} onReset={() => { setFiles([]); setText(""); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      This places new text on top of the PDF. It does not rewrite existing embedded PDF text.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={loadFiles} />
    {files.length ? <p className="doc-select-hint">Click the page to place the text — or type coordinates below.</p> : null}
    <Input label="Text" value={text} onChange={setText} />
    <div className="grid gap-3 sm:grid-cols-4"><Input label="Page" value={page} onChange={setPage} type="number" /><Input label="X" value={x} onChange={setX} type="number" /><Input label="Y" value={y} onChange={setY} type="number" /><Input label="Size" value={size} onChange={setSize} type="number" /></div>
    {textWarning ? <p className="doc-select-hint" role="status">{textWarning}</p> : null}
    <PrimaryButton label="Add text to PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const bytes = await addTextToPdf(file, text, { page: Number(page), x: Number(x), y: Number(y), size: Number(size) });
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-text-added`, "pdf"), "application/pdf");
      return `Text added to page ${page}.`;
    })} />
  </ToolForm>;
}

// --- Edit PDF Text (in-place overlay editing) --------------------------------
// This edits EXISTING PDF text by OVERLAY, not reflow: each edited run has its
// original glyphs covered by a background-colour rectangle and the new text
// redrawn at the same baseline/size with a base-14 substitute font. It does not
// re-wrap paragraphs, does not reuse the embedded font, and needs a real text
// layer (scanned PDFs must be OCR'd first). The pure geometry/apply logic lives
// in services/pdf-textedit.service.js; only the pdf.js render + click selection
// is here because it needs a browser canvas.

type EditRect = ReturnType<typeof textItemToPageRect>;
type TextRun = {
  key: string;
  index: number;
  str: string;
  display: { left: number; top: number; w: number; h: number };
  rect: EditRect;
  fontKey: string;
  color: { r: number; g: number; b: number } | null;
  background: { r: number; g: number; b: number } | null;
};
type TextEdit = { page: number; rect: EditRect; text: string; fontKey: string; original: string; color: TextRun["color"]; background: TextRun["background"] };
type SamplingImage = { data: Uint8ClampedArray; width: number; height: number };

// Resolves the human font name behind pdf.js's internal id (e.g. "g_d0_f1"),
// preferring the loaded font object, then the style family, then the id itself.
function resolveRunFontName(page: any, content: any, fontName: string) {
  try {
    const font = page.commonObjs.get(fontName);
    if (font && font.name) return String(font.name);
  } catch {
    /* font object not resolved — fall through */
  }
  const style = content.styles && content.styles[fontName];
  if (style && style.fontFamily) return String(style.fontFamily);
  return fontName || "";
}

// Samples a run's glyph colour (darkest pixel) and page-background colour
// (lightest pixel) from the rendered canvas. Bounded to a constant grid so a
// dense page never turns this into a super-linear scan. Returns nulls when
// unavailable so applyTextEdits falls back to near-black on white.
function sampleRunColors(img: SamplingImage | null, box: { left: number; top: number; w: number; h: number }) {
  if (!img) return { color: null, background: null };
  const x0 = Math.max(0, Math.floor(box.left));
  const y0 = Math.max(0, Math.floor(box.top));
  const x1 = Math.min(img.width, Math.ceil(box.left + box.w));
  const y1 = Math.min(img.height, Math.ceil(box.top + box.h));
  if (x1 <= x0 || y1 <= y0) return { color: null, background: null };
  const stepX = Math.max(1, Math.floor((x1 - x0) / 40));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 16));
  let dark: number[] | null = null;
  let darkLuma = Infinity;
  let light: number[] | null = null;
  let lightLuma = -Infinity;
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const i = (y * img.width + x) * 4;
      const a = img.data[i + 3];
      if (a < 8) continue;
      const r = img.data[i];
      const g = img.data[i + 1];
      const b = img.data[i + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luma < darkLuma) { darkLuma = luma; dark = [r, g, b]; }
      if (luma > lightLuma) { lightLuma = luma; light = [r, g, b]; }
    }
  }
  const toUnit = (c: number[] | null) => (c ? { r: c[0] / 255, g: c[1] / 255, b: c[2] / 255 } : null);
  // Trust the glyph colour only when it is clearly darker than the background.
  const color = dark && lightLuma - darkLuma > 25 ? toUnit(dark) : null;
  return { color, background: toUnit(light) };
}

function EditPdfTextTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [doc, setDoc] = useState<any>(null);
  const [fileName, setFileName] = useState("document.pdf");
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageImage, setPageImage] = useState("");
  const [pageDims, setPageDims] = useState<{ cw: number; ch: number } | null>(null);
  const [runs, setRuns] = useState<TextRun[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [edits, setEdits] = useState<Map<string, TextEdit>>(new Map());
  const [status, setStatus] = useState(initialStatus);
  const bytesRef = useRef<Uint8Array | null>(null);
  const samplingRef = useRef<SamplingImage | null>(null);

  const reset = () => {
    setFiles([]);
    setDoc(null);
    setPageCount(0);
    setCurrentPage(1);
    setPageImage("");
    setPageDims(null);
    setRuns([]);
    setSelectedKey(null);
    setDraft("");
    setEdits(new Map());
    bytesRef.current = null;
    samplingRef.current = null;
    setStatus(initialStatus);
  };

  // Destroy the pdf.js document when it is replaced or the tool unmounts.
  useEffect(() => () => { try { doc?.destroy?.(); } catch { /* already gone */ } }, [doc]);

  // Load the chosen PDF once. Keep a private byte copy for pdf-lib because
  // pdf.js detaches the buffer it is handed.
  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setRuns([]);
    setSelectedKey(null);
    setEdits(new Map());
    setPageImage("");
    setPageDims(null);
    if (!files.length) return undefined;
    runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const buffer = new Uint8Array(await file.arrayBuffer());
      bytesRef.current = buffer.slice();
      const { loadPdfDocument } = await import("../lib/pdfjs");
      const loaded = await loadPdfDocument(buffer.slice());
      if (cancelled) { try { await loaded.destroy(); } catch { /* ignore */ } return "Ready."; }
      setFileName(file.name);
      setPageCount(loaded.numPages);
      setCurrentPage(1);
      setDoc(loaded);
      // Deliberately no success message: a green "Loaded" box sat in the panel
      // for the rest of the session restating what the open document already
      // shows. Success boxes are for things you cannot see.
      return "";
    });
    return () => { cancelled = true; };
  }, [files, tool.file]);

  // Render the current page to a backdrop image and extract its clickable runs.
  useEffect(() => {
    if (!doc) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { renderPdfPageToCanvas, pdfjs } = await import("../lib/pdfjs");
        const page = await doc.getPage(currentPage);
        const rotation = page.rotate || 0;
        const view = page.view;
        const pointHeight = view[3] - view[1];
        const base = page.getViewport({ scale: 1 });
        // Fit the page to a legible-but-bounded width.
        const scale = Math.min(2.5, Math.max(0.6, 900 / base.width));
        const canvas = await renderPdfPageToCanvas(doc, currentPage, scale);
        const ctx = canvas.getContext("2d");
        samplingRef.current = ctx
          ? { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height }
          : null;
        const url = canvas.toDataURL("image/png");
        const cw = canvas.width;
        const ch = canvas.height;
        canvas.width = 0;
        canvas.height = 0; // release the render canvas immediately

        const viewport = page.getViewport({ scale });
        const content = await page.getTextContent();
        const built: TextRun[] = [];
        for (let i = 0; i < content.items.length; i += 1) {
          const item: any = content.items[i];
          if (typeof item.str !== "string" || !item.str.trim()) continue;
          const m = pdfjs.Util.transform(viewport.transform, item.transform);
          const fontHeightPx = Math.hypot(m[2], m[3]) || 1;
          const display = { left: m[4], top: m[5] - fontHeightPx, w: Math.abs(item.width * scale) || fontHeightPx, h: fontHeightPx };
          const rect = textItemToPageRect(item.transform, item.width, item.height, pointHeight, rotation);
          const fontKey = standardFontKey(mapPdfFontToStandard(resolveRunFontName(page, content, item.fontName)));
          const { color, background } = sampleRunColors(samplingRef.current, display);
          built.push({ key: `${currentPage}:${i}`, index: i, str: item.str, display, rect, fontKey, color, background });
        }
        page.cleanup();
        if (cancelled) return;
        setPageImage(url);
        setPageDims({ cw, ch });
        setRuns(built);
        setSelectedKey(null);
        setDraft("");
      } catch (error: any) {
        if (!cancelled) setStatus({ tone: "error", message: error?.message || "Could not render this page." });
      }
    })();
    return () => { cancelled = true; };
  }, [doc, currentPage]);

  const selectedRun = runs.find((run) => run.key === selectedKey) || null;

  const selectRun = (run: TextRun) => {
    setSelectedKey(run.key);
    const existing = edits.get(run.key);
    setDraft(existing ? existing.text : run.str);
  };

  const applyRunEdit = (nextText: string) => {
    if (!selectedRun) return;
    setEdits((current) => {
      const next = new Map(current);
      next.set(selectedRun.key, {
        page: currentPage,
        rect: selectedRun.rect,
        text: nextText,
        fontKey: selectedRun.fontKey,
        original: selectedRun.str,
        color: selectedRun.color,
        background: selectedRun.background,
      });
      return next;
    });
  };

  const removeEdit = (key: string) => {
    setEdits((current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    if (key === selectedKey && selectedRun) setDraft(selectedRun.str);
  };

  const editList = [...edits.values()];

  return (
    <ToolForm status={status} onReset={reset}>
      <p className="tool-lead">Click any text on the page, change it, then apply.</p>
      <ToolNotes summary="What to know">
        <li>Your new text is drawn over the old, which stays in the file. To remove text for good, use <a className="underline" href="#redact-pdf-tool">Redact PDF</a>.</li>
        <li>Fonts are matched, not reused, so spacing can shift a little.</li>
        <li>Only the line you click moves. To re-wrap a whole paragraph, use <a className="underline" href="#reflow-pdf-tool">Reflow Editor</a>.</li>
        <li>Needs real text. For a scanned page, run <a className="underline" href="#ocr-pdf-tool">OCR</a> first.</li>
        <li>Latin characters only — no CJK or emoji.</li>
      </ToolNotes>

      <FileControl accept="application/pdf" files={files} setFiles={setFiles} />

      {doc && pageCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button className="secondary-button" type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}><ArrowLeft size={16} /> Prev</button>
            <span className="text-sm font-bold tabular-nums">Page {currentPage} / {pageCount}</span>
            <button className="secondary-button" type="button" disabled={currentPage >= pageCount} onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}>Next <ArrowRight size={16} /></button>
          </div>
          <span className="text-xs font-bold text-neutral-500">{edits.size} edit{edits.size === 1 ? "" : "s"} pending across {new Set(editList.map((e) => e.page)).size || 0} page{new Set(editList.map((e) => e.page)).size === 1 ? "" : "s"}</span>
        </div>
      )}

      {doc && pageImage && pageDims && (
        <div className="surface-card wabi-card-edge overflow-auto p-2" style={{ maxHeight: "70vh" }}>
          <div className="relative mx-auto" style={{ width: pageDims.cw, height: pageDims.ch }}>
            <img src={pageImage} width={pageDims.cw} height={pageDims.ch} alt={`Page ${currentPage} of ${fileName}`} className="block select-none" draggable={false} />
            {runs.map((run) => {
              const edited = edits.has(run.key);
              const isSelected = run.key === selectedKey;
              const cls = isSelected
                ? "border-[var(--moss)] bg-[color-mix(in_srgb,var(--moss)_22%,transparent)]"
                : edited
                  ? "border-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_20%,transparent)]"
                  : "border-transparent hover:border-[var(--moss)] hover:bg-[color-mix(in_srgb,var(--moss)_12%,transparent)]";
              return (
                <button
                  key={run.key}
                  type="button"
                  title={run.str}
                  aria-label={`Edit text: ${run.str}`}
                  onClick={() => selectRun(run)}
                  className={`absolute cursor-text rounded-sm border ${cls}`}
                  style={{ left: run.display.left, top: run.display.top, width: Math.max(4, run.display.w), height: Math.max(6, run.display.h) }}
                />
              );
            })}
          </div>
        </div>
      )}

      {doc && pageImage && runs.length === 0 && (
        <div className="surface-card wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
          <p className="font-black text-[var(--foreground)]">No editable text on this page</p>
          <p className="mt-1">This page has no extractable text runs — it is likely a scan or image. Run <a className="underline" href="#ocr-pdf-tool">OCR / Searchable PDF</a> to add a text layer, then edit the OCR'd copy here.</p>
        </div>
      )}

      {selectedRun && (
        <div className="surface-card wabi-card-edge grid gap-3 p-4">
          <p className="text-xs font-bold uppercase text-neutral-500">Selected text · page {currentPage}</p>
          <p className="break-words rounded-lg border border-[var(--border)] bg-[var(--paper-soft)] px-3 py-2 font-mono text-sm text-neutral-600">{selectedRun.str}</p>
          <label className="grid gap-2">
            <span className="text-xs font-bold uppercase text-neutral-500">Replacement text (leave empty to delete)</span>
            <input className="field-input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Type the corrected text…" />
          </label>
          <div className="flex flex-wrap gap-2">
            <SecondaryButton label={edits.has(selectedRun.key) ? "Update this edit" : "Apply to this text"} onClick={() => applyRunEdit(draft)} />
            <SecondaryButton label="Delete this text" onClick={() => { setDraft(""); applyRunEdit(""); }} />
            {edits.has(selectedRun.key) && <SecondaryButton label="Discard edit" onClick={() => removeEdit(selectedRun.key)} />}
          </div>
        </div>
      )}

      {editList.length > 0 && (
        <div className="surface-card wabi-card-edge grid gap-2 p-4">
          <p className="font-black">Pending edits ({editList.length})</p>
          <div className="grid gap-1">
            {[...edits.entries()].map(([key, edit]) => (
              <div key={key} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-neutral-600">
                <span className="text-xs font-bold uppercase text-neutral-500">p{edit.page}</span>
                <span className="min-w-0 break-words font-mono text-neutral-500 line-through">{edit.original}</span>
                <ArrowRight size={14} />
                <span className="min-w-0 break-words font-mono text-[var(--foreground)]">{edit.text || "(deleted)"}</span>
                <button className="ml-auto text-xs font-bold uppercase text-[var(--danger-fg)] hover:underline" type="button" onClick={() => removeEdit(key)}>Remove</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <PrimaryButton label="Apply edits" disabled={editList.length === 0} onClick={() => runSafely(setStatus, async () => {
        if (!bytesRef.current) throw new Error("Load a PDF first.");
        if (!editList.length) throw new Error("Make at least one edit first — click a text run, change it, and Apply.");
        const out = await applyTextEdits(bytesRef.current, editList.map((edit) => ({
          page: edit.page,
          rect: edit.rect,
          text: edit.text,
          fontKey: edit.fontKey,
          color: edit.color || undefined,
          background: edit.background || undefined,
        })));
        downloadBytes(out, withExtension(`${safeFilename(fileName)}-edited`, "pdf"), "application/pdf");
        return `Applied ${editList.length} edit${editList.length === 1 ? "" : "s"} to ${fileName}. Longer edits wrap within their block; surrounding text was not reflowed.`;
      })} />

      <ResultConsequenceNote>The old text is still in the file underneath your edit. If you are removing something sensitive, use Redact PDF instead.</ResultConsequenceNote>
    </ToolForm>
  );
}

// --- Reflow Editor (genuine paragraph reflow) --------------------------------
// The heavier sibling of Edit PDF Text. Instead of covering one run and redrawing
// it in the SAME box, this extracts the document's text as an ordered sequence of
// PARAGRAPHS, lets the user edit/add/delete/split/merge them, then RE-LAYS-OUT the
// whole single text column: an edit re-wraps its paragraph AND pushes the
// following paragraphs down, repaginating onto new pages on overflow. The pure
// model + layout engine (parse/flow/rebuild) lives in services/pdf-reflow.service.js;
// only the pdf.js extraction (needs a browser canvas + worker) is here.

type ReflowBlock = {
  id: string;
  type: "paragraph" | "heading" | "list-item";
  text: string;
  fontSize: number;
  fontName: string;
  fontKey: string;
  family: string;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  color: { r: number; g: number; b: number } | null;
  sourcePage: number;
};
type ReflowModel = { pageWidth: number; pageHeight: number; column: { x: number; width: number; top: number; bottom: number } };

let reflowIdCounter = 0;
const nextReflowId = () => `b${(reflowIdCounter += 1).toString(36)}`;

// CSS font string that approximates a block's matched base-14 substitute, so the
// live preview wraps roughly where the exported PDF will (which measures with the
// real pdf-lib standard font).
function reflowFontCss(block: ReflowBlock, sizePx: number) {
  const family = block.family === "Times"
    ? 'Georgia, "Times New Roman", serif'
    : block.family === "Courier"
      ? '"Courier New", monospace'
      : "Helvetica, Arial, sans-serif";
  return `${block.italic ? "italic " : ""}${block.bold ? "700 " : "400 "}${sizePx}px ${family}`;
}

// One shared canvas 2D context for measuring preview text width.
let reflowMeasureCtx: CanvasRenderingContext2D | null = null;
function reflowMeasure(text: string, block: ReflowBlock) {
  if (!reflowMeasureCtx) reflowMeasureCtx = document.createElement("canvas").getContext("2d");
  if (!reflowMeasureCtx) return String(text).length * block.fontSize * 0.5;
  reflowMeasureCtx.font = reflowFontCss(block, block.fontSize);
  return reflowMeasureCtx.measureText(String(text)).width;
}

function ReflowEditorTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [doc, setDoc] = useState<any>(null);
  const [fileName, setFileName] = useState("document.pdf");
  const [blocks, setBlocks] = useState<ReflowBlock[]>([]);
  const [model, setModel] = useState<ReflowModel | null>(null);
  const [complexPages, setComplexPages] = useState<number[]>([]);
  const [extracted, setExtracted] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const bytesRef = useRef<Uint8Array | null>(null);
  const caretRef = useRef<Map<string, number>>(new Map());

  const reset = () => {
    setFiles([]);
    setDoc(null);
    setBlocks([]);
    setModel(null);
    setComplexPages([]);
    setExtracted(false);
    bytesRef.current = null;
    caretRef.current = new Map();
    setStatus(initialStatus);
  };

  useEffect(() => () => { try { doc?.destroy?.(); } catch { /* already gone */ } }, [doc]);

  // Load + extract: render nothing to screen, but read every page's text into an
  // ordered list of flowable blocks and detect complex (multi-column/table) pages.
  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setBlocks([]);
    setModel(null);
    setComplexPages([]);
    setExtracted(false);
    if (!files.length) return undefined;
    runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const buffer = new Uint8Array(await file.arrayBuffer());
      bytesRef.current = buffer.slice();
      const { loadPdfDocument } = await import("../lib/pdfjs");
      const loaded = await loadPdfDocument(buffer.slice());
      if (cancelled) { try { await loaded.destroy(); } catch { /* ignore */ } return "Ready."; }
      setFileName(file.name);
      setDoc(loaded);

      const total = loaded.numPages;
      const page1 = await loaded.getPage(1);
      const view = page1.view;
      const pageWidth = view[2] - view[0];
      const pageHeight = view[3] - view[1];
      const collected: ReflowBlock[] = [];
      const complex: number[] = [];
      let column: ReflowModel["column"] | null = null;

      for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
        if (cancelled) break;
        setStatus({ tone: "idle", message: `Extracting paragraphs from page ${pageNumber} of ${total}…`, progress: { value: pageNumber - 1, total, label: "Reading text" } });
        const page = pageNumber === 1 ? page1 : await loaded.getPage(pageNumber);
        const content = await page.getTextContent();
        const geom = { width: pageWidth, height: pageHeight };
        const items = content.items
          .filter((raw: any) => typeof raw.str === "string")
          .map((raw: any) => ({ str: raw.str, transform: raw.transform, width: raw.width, height: raw.height, fontName: resolveRunFontName(page, content, raw.fontName) }));
        const layout = detectColumnLayout(items, geom);
        if (pageNumber === 1) column = layout.column;
        if (layout.complex) complex.push(pageNumber);
        for (const parsed of parseParagraphs(items, geom)) {
          if (!parsed.text) continue;
          collected.push({ id: nextReflowId(), sourcePage: pageNumber, ...parsed } as ReflowBlock);
        }
        page.cleanup();
      }
      if (cancelled) return "Ready.";

      const margin = 54;
      setModel({ pageWidth, pageHeight, column: column || { x: margin, width: pageWidth - margin * 2, top: pageHeight - margin, bottom: margin } });
      setBlocks(collected);
      setComplexPages(complex);
      setExtracted(true);
      const warn = complex.length ? ` ${complex.length} page${complex.length === 1 ? "" : "s"} look multi-column/tabular — see the warning below.` : "";
      return `Extracted ${collected.length} paragraph${collected.length === 1 ? "" : "s"} from ${total} page${total === 1 ? "" : "s"}. Edit any paragraph — the whole column re-flows live.${warn}`;
    });
    return () => { cancelled = true; };
  }, [files, tool.file]);

  // Live reflow: flow the (edited) blocks down the column with a canvas width model.
  const flowed = useMemo(() => {
    if (!model || !blocks.length) return null;
    try {
      return flowBlocks(blocks, model.column, { measure: reflowMeasure as any });
    } catch {
      return null;
    }
  }, [blocks, model]);

  const updateBlock = (id: string, patch: Partial<ReflowBlock>) =>
    setBlocks((current) => current.map((block) => (block.id === id ? { ...block, ...patch } : block)));

  const deleteBlock = (id: string) => {
    caretRef.current.delete(id);
    setBlocks((current) => current.filter((block) => block.id !== id));
  };

  const addBlockAfter = (index: number) => setBlocks((current) => {
    const template = current[index];
    const fresh: ReflowBlock = {
      id: nextReflowId(),
      type: "paragraph",
      text: "New paragraph.",
      fontSize: template ? template.fontSize : 11,
      fontName: template ? template.fontName : "",
      fontKey: template ? template.fontKey : "Helvetica",
      family: template ? template.family : "Helvetica",
      bold: false,
      italic: false,
      align: "left",
      color: null,
      sourcePage: template ? template.sourcePage : 1,
    };
    const next = current.slice();
    next.splice(index + 1, 0, fresh);
    return next;
  });

  const mergeUp = (index: number) => setBlocks((current) => {
    if (index <= 0) return current;
    const next = current.slice();
    const prev = next[index - 1];
    next[index - 1] = { ...prev, text: `${prev.text} ${next[index].text}`.replace(/\s+/g, " ").trim() };
    next.splice(index, 1);
    return next;
  });

  const splitBlock = (index: number) => setBlocks((current) => {
    const block = current[index];
    if (!block) return current;
    const caret = caretRef.current.get(block.id);
    const at = Number.isFinite(caret) && caret! > 0 && caret! < block.text.length ? caret! : Math.floor(block.text.length / 2);
    const head = block.text.slice(0, at).trim();
    const tail = block.text.slice(at).trim();
    if (!head || !tail) return current;
    const next = current.slice();
    next[index] = { ...block, text: head };
    next.splice(index + 1, 0, { ...block, id: nextReflowId(), text: tail });
    return next;
  });

  const download = () => runSafely(setStatus, async () => {
    if (!model) throw new Error("Load a PDF first.");
    const usable = blocks.filter((block) => block.text.trim());
    if (!usable.length) throw new Error("There is no text to reflow — add or keep at least one paragraph.");
    const payload = usable.map((block) => ({ type: block.type, text: block.text, fontSize: block.fontSize, fontKey: block.fontKey, family: block.family, bold: block.bold, italic: block.italic, align: block.align, color: block.color }));
    const out = await rebuildReflowedPdf(bytesRef.current || new Uint8Array(), { pageWidth: model.pageWidth, pageHeight: model.pageHeight, column: model.column, blocks: payload });
    downloadBytes(out, withExtension(`${safeFilename(fileName)}-reflowed`, "pdf"), "application/pdf");
    return `Reflowed ${usable.length} paragraph${usable.length === 1 ? "" : "s"} into ${flowed ? flowed.pageCount : 1} page${flowed && flowed.pageCount === 1 ? "" : "s"}. Text was re-wrapped and repaginated; images and exact original positions are not preserved.`;
  });

  const previewScale = model ? 320 / model.pageWidth : 1;

  return (
    <ToolForm status={status} onReset={reset}>
      <div className="surface-muted wabi-card-edge grid gap-1 p-4 text-sm font-semibold leading-6 text-neutral-600">
        <p className="text-xs font-bold uppercase text-neutral-500">How this works — and its limits</p>
        <p className="text-[var(--foreground)]">This is genuine reflow: edit a paragraph and the whole text column re-wraps, the following paragraphs move, and content repaginates onto new pages when it overflows. It is the heavier sibling of <a className="underline" href="#edit-pdf-text-tool">Edit PDF Text</a> (which edits one block in place and moves nothing).</p>
        <ul className="ml-4 list-disc">
          <li>Works well for <strong>single-column text documents</strong>. Multi-column pages, tables, and complex layouts may reorder or misplace content — for those, prefer <a className="underline" href="#edit-pdf-text-tool">Edit PDF Text</a>.</li>
          <li>The output <strong>rebuilds the text column</strong> on fresh pages, so exact original positioning of untouched paragraphs may shift slightly.</li>
          <li>Fonts are matched to <strong>standard fonts</strong> (Helvetica, Times, Courier); the original embedded font is not reused. Drawn text is <strong>Latin-1 only</strong> (no CJK/emoji).</li>
          <li><strong>Images and other non-text content are not carried</strong> into the reflowed text column. Needs a real text layer — scanned PDFs must be <a className="underline" href="#ocr-pdf-tool">OCR'd</a> first.</li>
          <li>This is honest single-column reflow, <strong>not pixel-perfect Adobe reflow</strong>.</li>
        </ul>
      </div>

      <FileControl accept="application/pdf" files={files} setFiles={setFiles} />

      {complexPages.length > 0 && (
        <div className="surface-card wabi-card-edge grid gap-1 border-[var(--warning)] p-4 text-sm font-semibold leading-6 text-neutral-600">
          <p className="text-xs font-bold uppercase text-[var(--warning)]">Complex layout detected</p>
          <p className="text-[var(--foreground)]">Page{complexPages.length === 1 ? "" : "s"} {complexPages.join(", ")} look multi-column or tabular. Reflow treats the document as one single column, so side-by-side content there may be reordered. You can still proceed, but for those pages <a className="underline" href="#edit-pdf-text-tool">Edit PDF Text</a> preserves the layout.</p>
        </div>
      )}

      {extracted && blocks.length === 0 && (
        <div className="surface-card wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
          <p className="font-black text-[var(--foreground)]">No editable text found</p>
          <p className="mt-1">This PDF has no extractable text runs — it is likely a scan or image. Run <a className="underline" href="#ocr-pdf-tool">OCR / Searchable PDF</a> first, then reflow the OCR'd copy.</p>
        </div>
      )}

      {blocks.length > 0 && model && (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase text-neutral-500">Paragraphs ({blocks.length})</p>
              <span className="text-xs font-bold text-neutral-500">Reflows to {flowed ? flowed.pageCount : 1} page{flowed && flowed.pageCount === 1 ? "" : "s"}</span>
            </div>
            <div className="grid gap-3" style={{ maxHeight: "62vh", overflowY: "auto" }}>
              {blocks.map((block, index) => (
                <div key={block.id} className="surface-card wabi-card-edge grid gap-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold uppercase text-neutral-500">p{block.sourcePage}</span>
                    <select className="field-input h-8 w-auto py-0 text-xs" value={block.type} aria-label="Paragraph type" onChange={(event) => updateBlock(block.id, { type: event.target.value as ReflowBlock["type"], isHeading: event.target.value === "heading" } as Partial<ReflowBlock>)}>
                      <option value="paragraph">Paragraph</option>
                      <option value="heading">Heading</option>
                      <option value="list-item">List item</option>
                    </select>
                    <select className="field-input h-8 w-auto py-0 text-xs" value={block.align} aria-label="Alignment" onChange={(event) => updateBlock(block.id, { align: event.target.value as ReflowBlock["align"] })}>
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                    <div className="ml-auto flex flex-wrap gap-1">
                      <button className="text-xs font-bold uppercase text-neutral-500 hover:underline" type="button" onClick={() => splitBlock(index)}><Scissors size={12} className="inline" /> Split</button>
                      <button className="text-xs font-bold uppercase text-neutral-500 hover:underline disabled:opacity-40" type="button" disabled={index === 0} onClick={() => mergeUp(index)}>Merge up</button>
                      <button className="text-xs font-bold uppercase text-[var(--danger-fg)] hover:underline" type="button" onClick={() => deleteBlock(block.id)}>Delete</button>
                    </div>
                  </div>
                  <textarea
                    className="field-input min-h-16 font-mono text-sm leading-6"
                    value={block.text}
                    aria-label={`Paragraph ${index + 1} on page ${block.sourcePage}`}
                    onChange={(event) => updateBlock(block.id, { text: event.target.value })}
                    onSelect={(event) => caretRef.current.set(block.id, (event.target as HTMLTextAreaElement).selectionStart)}
                    onKeyUp={(event) => caretRef.current.set(block.id, (event.target as HTMLTextAreaElement).selectionStart)}
                    onClick={(event) => caretRef.current.set(block.id, (event.target as HTMLTextAreaElement).selectionStart)}
                  />
                  <button className="justify-self-start text-xs font-bold uppercase text-[var(--moss)] hover:underline" type="button" onClick={() => addBlockAfter(index)}>+ Add paragraph below</button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <p className="text-xs font-bold uppercase text-neutral-500">Live reflow preview</p>
            <div className="surface-card wabi-card-edge grid justify-items-center gap-3 p-3" style={{ maxHeight: "62vh", overflowY: "auto" }}>
              {flowed ? flowed.pages.map((page, pi) => (
                <div key={pi} className="relative shrink-0 border border-[var(--border)] bg-white shadow-sm" style={{ width: model.pageWidth * previewScale, height: model.pageHeight * previewScale }}>
                  {page.lines.map((line, li) => (
                    <span
                      key={li}
                      className="absolute whitespace-pre text-black"
                      style={{ left: line.x * previewScale, top: (model.pageHeight - line.baseline) * previewScale - line.fontSize * previewScale, ...reflowPreviewLineStyle(blocks[line.block], line.fontSize * previewScale) }}
                    >{line.text}</span>
                  ))}
                  <span className="absolute bottom-0 right-1 text-[8px] font-bold text-neutral-400">{pi + 1}</span>
                </div>
              )) : <p className="text-sm font-semibold text-neutral-500">Preview will appear here.</p>}
            </div>
          </div>
        </div>
      )}

      <PrimaryButton label="Reflow PDF" disabled={!extracted || !blocks.some((block) => block.text.trim())} onClick={download} />

      <ResultConsequenceNote>Text is rebuilt on fresh pages, so untouched paragraphs may shift and images are not carried over. To change one line without moving anything, use Edit PDF Text.</ResultConsequenceNote>
    </ToolForm>
  );
}

// Inline CSS for a preview line, matching the block's substitute font/style.
function reflowPreviewLineStyle(block: ReflowBlock | undefined, sizePx: number): React.CSSProperties {
  if (!block) return {};
  const fontFamily = block.family === "Times"
    ? 'Georgia, "Times New Roman", serif'
    : block.family === "Courier"
      ? '"Courier New", monospace'
      : "Helvetica, Arial, sans-serif";
  return { fontFamily, fontWeight: block.bold ? 700 : 400, fontStyle: block.italic ? "italic" : "normal", lineHeight: 1, fontSize: sizePx };
}

function AddSignatureToPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [signatures, setSignatures] = useState<File[]>([]);
  const [page, setPage] = useState("1");
  const [x, setX] = useState("72");
  const [y, setY] = useState("96");
  const [width, setWidth] = useState("180");
  const [status, setStatus] = useState(initialStatus);
  const imageOptions = { maxFiles: 1, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] };

  // Draw the signature box on the page instead of typing four numbers with no
  // units. A dragged rectangle carries position AND width, which is exactly what
  // addSignatureImageToPdf takes (PDF points, origin bottom-left).
  useEffect(() => {
    const onRegion = (event: Event) => {
      const d = (event as CustomEvent<{ page: number; points: { x: number; y: number; w: number; h: number } }>).detail;
      if (!d || d.points.w <= 0) return;
      setPage(String(d.page));
      setX(String(Math.round(d.points.x)));
      setY(String(Math.round(d.points.y)));
      setWidth(String(Math.max(24, Math.round(d.points.w))));
    };
    window.addEventListener("myfilekit:region-selected", onRegion);
    return () => window.removeEventListener("myfilekit:region-selected", onRegion);
  }, []);

  const loadPdfFiles = (next: File[]) => {
    const changed = next[0] !== files[0];
    setFiles(next);
    if (changed) { setPage("1"); setX("72"); setY("96"); setWidth("180"); setStatus(initialStatus); }
  };

  return <ToolForm status={status} onReset={() => { setFiles([]); setSignatures([]); setStatus(initialStatus); }}>
    <FileControl accept="application/pdf" files={files} setFiles={loadPdfFiles} label="Choose PDF" />
    {files.length ? <p className="doc-select-hint">Drag a box on the page where the signature should sit — or type the numbers below.</p> : null}
    <FileControl accept="image/jpeg,image/png,image/webp" files={signatures} setFiles={setSignatures} label="Choose signature image" />
    <div className="grid gap-3 sm:grid-cols-4"><Input label="Page" value={page} onChange={setPage} type="number" /><Input label="X (pt from left)" value={x} onChange={setX} type="number" /><Input label="Y (pt from bottom)" value={y} onChange={setY} type="number" /><Input label="Width (pt)" value={width} onChange={setWidth} type="number" /></div>
    <PrimaryButton label="Add signature to PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const [signature] = validateFiles(signatures, imageOptions);
      const bytes = await addSignatureImageToPdf(file, signature, { page: Number(page), x: Number(x), y: Number(y), width: Number(width) });
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-signed`, "pdf"), "application/pdf");
      return `Signature added to page ${page}.`;
    })} />
  </ToolForm>;
}

// --- Annotate PDF (highlight / ink / shapes / notes / callouts) --------------
// Real markup layer. A page is rendered with pdf.js as a backdrop; the user
// draws on an overlay canvas; on export the markup is BURNED into the page with
// pdf-lib. Burned-in markup renders identically in every reader, but it is NOT
// a set of reader-editable /Annot objects — the UI states this plainly. All the
// data-model, clamping, coordinate mapping, and pdf-lib drawing lives in
// services/annotate.service.js (Node-tested); only the browser canvas + pointer
// handling is here. Annotations are stored in pdf-lib page space (bottom-origin
// points), so they survive page navigation and export together.

type AnnPt = { x: number; y: number };
type Ann = { id: string; type: string; [key: string]: any };
type AnnStore = Record<number, Ann[]>;
type ScreenCtx = { scale: number; pointHeight: number };

const ANNOTATE_TOOLS = [
  { id: "select", label: "Select" },
  { id: "highlight", label: "Highlight" },
  { id: "ink", label: "Ink" },
  { id: "rect", label: "Rectangle" },
  { id: "ellipse", label: "Ellipse" },
  { id: "line", label: "Line" },
  { id: "arrow", label: "Arrow" },
  { id: "note", label: "Text note" },
  { id: "callout", label: "Sticky note" },
];

let annotateIdCounter = 0;
const nextAnnotateId = () => `u${(annotateIdCounter += 1).toString(36)}`;
const cloneStore = (store: AnnStore): AnnStore => JSON.parse(JSON.stringify(store));

// page point (bottom-origin) -> overlay CSS pixel (top-origin), via the service.
const toScreen = (x: number, y: number, sc: ScreenCtx) => pagePointToScreen({ x, y }, { scale: sc.scale, pageHeight: sc.pointHeight });

// Screen-space bounding box of an annotation, for hit-testing and selection UI.
function annScreenBox(ann: Ann, sc: ScreenCtx): { x: number; y: number; w: number; h: number } {
  if (ann.type === "line" || ann.type === "arrow") {
    const a = toScreen(ann.x1, ann.y1, sc);
    const b = toScreen(ann.x2, ann.y2, sc);
    return { x: Math.min(a.px, b.px), y: Math.min(a.py, b.py), w: Math.abs(a.px - b.px), h: Math.abs(a.py - b.py) };
  }
  if (ann.type === "ink") {
    const pts = (ann.points || []).map((p: AnnPt) => toScreen(p.x, p.y, sc));
    if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
    const xs = pts.map((p: any) => p.px);
    const ys = pts.map((p: any) => p.py);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  if (ann.type === "note") {
    const p = toScreen(ann.x, ann.y, sc);
    const w = Math.max(20, (ann.text?.length || 4) * ann.size * 0.5 * sc.scale);
    const h = ann.size * 1.2 * sc.scale;
    return { x: p.px, y: p.py - h, w, h };
  }
  // box types: highlight, rect, ellipse, callout — top-left is (x, y+h) in page space
  const tl = toScreen(ann.x, ann.y + ann.h, sc);
  return { x: tl.px, y: tl.py, w: ann.w * sc.scale, h: ann.h * sc.scale };
}

// Distance from a point to a segment, for line/arrow/ink hit-testing.
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Topmost annotation under a screen point (search from the end = most recent on top).
function hitTestAnnotations(list: Ann[], sx: number, sy: number, sc: ScreenCtx): Ann | null {
  const tol = 6;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const ann = list[i];
    if (ann.type === "line" || ann.type === "arrow") {
      const a = toScreen(ann.x1, ann.y1, sc);
      const b = toScreen(ann.x2, ann.y2, sc);
      if (distToSegment(sx, sy, a.px, a.py, b.px, b.py) <= tol + ann.width) return ann;
      continue;
    }
    if (ann.type === "ink") {
      const pts = (ann.points || []).map((p: AnnPt) => toScreen(p.x, p.y, sc));
      for (let j = 0; j < pts.length - 1; j += 1) {
        if (distToSegment(sx, sy, pts[j].px, pts[j].py, pts[j + 1].px, pts[j + 1].py) <= tol + ann.width) return ann;
      }
      if (pts.length === 1 && Math.hypot(sx - pts[0].px, sy - pts[0].py) <= tol + ann.width) return ann;
      continue;
    }
    const box = annScreenBox(ann, sc);
    if (sx >= box.x - tol && sx <= box.x + box.w + tol && sy >= box.y - tol && sy <= box.y + box.h + tol) return ann;
  }
  return null;
}

// Moves an annotation by a page-space delta (used by drag-to-move in select mode).
function translateAnn(ann: Ann, dx: number, dy: number): Ann {
  if (ann.type === "line" || ann.type === "arrow") return { ...ann, x1: ann.x1 + dx, y1: ann.y1 + dy, x2: ann.x2 + dx, y2: ann.y2 + dy };
  if (ann.type === "ink") return { ...ann, points: (ann.points || []).map((p: AnnPt) => ({ x: p.x + dx, y: p.y + dy })) };
  if (ann.type === "callout") return { ...ann, x: ann.x + dx, y: ann.y + dy, target: ann.target ? { x: ann.target.x + dx, y: ann.target.y + dy } : null };
  return { ...ann, x: ann.x + dx, y: ann.y + dy };
}

// Wraps text to a pixel width for the on-canvas callout preview only.
function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of String(text).split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
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

// Paints every annotation on the current page (plus an in-progress draft and the
// selection outline) onto the overlay canvas, in screen space. Approximate on
// purpose — pdf-lib produces the authoritative flattened output on export.
function paintAnnotations(ctx: CanvasRenderingContext2D, cssW: number, cssH: number, list: Ann[], sc: ScreenCtx, selectedId: string | null, draft: Ann | null) {
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const ann of list) drawAnnScreen(ctx, ann, sc);
  if (draft) drawAnnScreen(ctx, draft, sc);
  if (selectedId) {
    const sel = list.find((a) => a.id === selectedId);
    if (sel) {
      const box = annScreenBox(sel, sc);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#2563eb";
      ctx.strokeRect(box.x - 3, box.y - 3, box.w + 6, box.h + 6);
      ctx.restore();
    }
  }
}

function drawAnnScreen(ctx: CanvasRenderingContext2D, ann: Ann, sc: ScreenCtx) {
  ctx.save();
  const lw = Math.max(1, (ann.width || 1) * sc.scale);
  if (ann.type === "highlight") {
    const tl = toScreen(ann.x, ann.y + ann.h, sc);
    ctx.globalAlpha = ann.opacity ?? 0.4;
    ctx.fillStyle = ann.color;
    ctx.fillRect(tl.px, tl.py, ann.w * sc.scale, ann.h * sc.scale);
  } else if (ann.type === "rect") {
    const tl = toScreen(ann.x, ann.y + ann.h, sc);
    if (ann.fill) { ctx.globalAlpha = ann.fillOpacity ?? 0.2; ctx.fillStyle = ann.fill; ctx.fillRect(tl.px, tl.py, ann.w * sc.scale, ann.h * sc.scale); ctx.globalAlpha = 1; }
    ctx.lineWidth = lw;
    ctx.strokeStyle = ann.color;
    ctx.strokeRect(tl.px, tl.py, ann.w * sc.scale, ann.h * sc.scale);
  } else if (ann.type === "ellipse") {
    const c = toScreen(ann.x + ann.w / 2, ann.y + ann.h / 2, sc);
    ctx.beginPath();
    ctx.ellipse(c.px, c.py, (ann.w / 2) * sc.scale, (ann.h / 2) * sc.scale, 0, 0, Math.PI * 2);
    if (ann.fill) { ctx.globalAlpha = ann.fillOpacity ?? 0.2; ctx.fillStyle = ann.fill; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.lineWidth = lw;
    ctx.strokeStyle = ann.color;
    ctx.stroke();
  } else if (ann.type === "line" || ann.type === "arrow") {
    const a = toScreen(ann.x1, ann.y1, sc);
    const b = toScreen(ann.x2, ann.y2, sc);
    ctx.lineWidth = lw;
    ctx.strokeStyle = ann.color;
    ctx.beginPath();
    ctx.moveTo(a.px, a.py);
    ctx.lineTo(b.px, b.py);
    ctx.stroke();
    if (ann.type === "arrow") {
      const angle = Math.atan2(b.py - a.py, b.px - a.px);
      const head = Math.max(8, lw * 3.5);
      const spread = Math.PI / 7;
      ctx.beginPath();
      ctx.moveTo(b.px, b.py);
      ctx.lineTo(b.px - head * Math.cos(angle - spread), b.py - head * Math.sin(angle - spread));
      ctx.moveTo(b.px, b.py);
      ctx.lineTo(b.px - head * Math.cos(angle + spread), b.py - head * Math.sin(angle + spread));
      ctx.stroke();
    }
  } else if (ann.type === "ink") {
    const pts = (ann.points || []).map((p: AnnPt) => toScreen(p.x, p.y, sc));
    ctx.lineWidth = lw;
    ctx.strokeStyle = ann.color;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].px, pts[0].py, lw / 2, 0, Math.PI * 2);
      ctx.fillStyle = ann.color;
      ctx.fill();
    } else {
      ctx.beginPath();
      pts.forEach((p: any, i: number) => (i === 0 ? ctx.moveTo(p.px, p.py) : ctx.lineTo(p.px, p.py)));
      ctx.stroke();
    }
  } else if (ann.type === "note") {
    const p = toScreen(ann.x, ann.y, sc);
    ctx.fillStyle = ann.color;
    ctx.font = `${Math.max(6, ann.size * sc.scale)}px Helvetica, Arial, sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(ann.text || "", p.px, p.py);
  } else if (ann.type === "callout") {
    const tl = toScreen(ann.x, ann.y + ann.h, sc);
    const w = ann.w * sc.scale;
    const h = ann.h * sc.scale;
    if (ann.target) {
      const t = toScreen(ann.target.x, ann.target.y, sc);
      ctx.strokeStyle = ann.border;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(tl.px + w / 2, tl.py + h / 2);
      ctx.lineTo(t.px, t.py);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = ann.fill;
    ctx.fillRect(tl.px, tl.py, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ann.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.px, tl.py, w, h);
    ctx.fillStyle = ann.color;
    const fontPx = Math.max(6, ann.size * sc.scale);
    ctx.font = `${fontPx}px Helvetica, Arial, sans-serif`;
    ctx.textBaseline = "alphabetic";
    const pad = 6;
    const lines = wrapCanvasText(ctx, ann.text || "", w - pad * 2);
    let ly = tl.py + pad + fontPx;
    for (const line of lines) {
      if (ly > tl.py + h - pad + fontPx) break;
      ctx.fillText(line, tl.px + pad, ly);
      ly += fontPx * 1.25;
    }
  }
  ctx.restore();
}

function AnnotatePdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [doc, setDoc] = useState<any>(null);
  const [fileName, setFileName] = useState("document.pdf");
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageImage, setPageImage] = useState("");
  const [pageDims, setPageDims] = useState<{ cw: number; ch: number } | null>(null);
  const [annos, setAnnos] = useState<AnnStore>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState("highlight");
  const [color, setColor] = useState("#dc2626");
  const [strokeWidth, setStrokeWidth] = useState("3");
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_PALETTE[0].hex);
  const [fillEnabled, setFillEnabled] = useState(false);
  const [fillColor, setFillColor] = useState("#2563eb");
  const [fontSize, setFontSize] = useState("14");
  const [noteText, setNoteText] = useState("Review note");
  const [calloutLeader, setCalloutLeader] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [histTick, setHistTick] = useState(0);

  const bytesRef = useRef<Uint8Array | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const scRef = useRef<ScreenCtx>({ scale: 1, pointHeight: 792 });
  const pageWHRef = useRef<{ w: number; h: number }>({ w: 612, h: 792 });
  const dimsRef = useRef<{ cw: number; ch: number }>({ cw: 1, ch: 1 });
  const annosRef = useRef<AnnStore>({});
  const pageRef = useRef(1);
  const toolRef = useRef(activeTool);
  const styleRef = useRef({ color, strokeWidth: 3, highlightColor, fillEnabled, fillColor, fontSize: 14, noteText, calloutLeader });
  const draftRef = useRef<Ann | null>(null);
  const gestureRef = useRef<{ startPx: number; startPy: number; startPage: AnnPt } | null>(null);
  const moveRef = useRef<{ id: string; last: AnnPt; snapshot: AnnStore; moved: boolean } | null>(null);
  const calloutTargetRef = useRef<AnnPt | null>(null);
  const pastRef = useRef<AnnStore[]>([]);
  const futureRef = useRef<AnnStore[]>([]);
  const selectedRef = useRef<string | null>(null);

  useEffect(() => { annosRef.current = annos; }, [annos]);
  useEffect(() => { pageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { toolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  useEffect(() => {
    styleRef.current = {
      color,
      strokeWidth: Math.max(0.5, Math.min(60, Number(strokeWidth) || 3)),
      highlightColor,
      fillEnabled,
      fillColor,
      fontSize: Math.max(4, Math.min(96, Number(fontSize) || 14)),
      noteText,
      calloutLeader,
    };
  }, [color, strokeWidth, highlightColor, fillEnabled, fillColor, fontSize, noteText, calloutLeader]);

  const reset = () => {
    setFiles([]);
    setDoc(null);
    setPageCount(0);
    setCurrentPage(1);
    setPageImage("");
    setPageDims(null);
    setAnnos({});
    setSelectedId(null);
    bytesRef.current = null;
    annosRef.current = {};
    pastRef.current = [];
    futureRef.current = [];
    draftRef.current = null;
    calloutTargetRef.current = null;
    setStatus(initialStatus);
  };

  useEffect(() => () => { try { doc?.destroy?.(); } catch { /* already gone */ } }, [doc]);

  const paint = () => {
    const ctx = ctxRef.current;
    const dims = dimsRef.current;
    if (!ctx) return;
    const list = annosRef.current[pageRef.current] || [];
    paintAnnotations(ctx, dims.cw, dims.ch, list, scRef.current, selectedRef.current, draftRef.current);
  };

  // Repaint whenever committed state or the page changes.
  useEffect(() => { paint(); }, [annos, currentPage, selectedId, pageImage, pageDims]);

  const pushStore = (prev: AnnStore, next: AnnStore) => {
    pastRef.current = [...pastRef.current, prev];
    futureRef.current = [];
    annosRef.current = next;
    setAnnos(next);
    setHistTick((t) => t + 1);
  };

  const addAnnotation = (ann: Ann): boolean => {
    const page = pageRef.current;
    const prev = annosRef.current;
    const existing = prev[page] || [];
    if (existing.length >= MAX_ANNOTATIONS_PER_PAGE) {
      setStatus({ tone: "error", message: `This page is at the ${MAX_ANNOTATIONS_PER_PAGE}-annotation limit. Delete some, or export and re-open to keep going.` });
      return false;
    }
    const next = cloneStore(prev);
    next[page] = [...existing, ann];
    pushStore(prev, next);
    return true;
  };

  const deleteSelected = () => {
    const id = selectedRef.current;
    if (!id) { setStatus({ tone: "error", message: "Select an annotation first, then delete it." }); return; }
    const page = pageRef.current;
    const prev = annosRef.current;
    const next = cloneStore(prev);
    next[page] = (next[page] || []).filter((a) => a.id !== id);
    pushStore(prev, next);
    setSelectedId(null);
    selectedRef.current = null;
    setStatus({ tone: "success", message: "Annotation deleted." });
  };

  const undo = () => {
    if (!pastRef.current.length) { setStatus({ tone: "error", message: "Nothing to undo." }); return; }
    const prev = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [annosRef.current, ...futureRef.current];
    annosRef.current = prev;
    setAnnos(prev);
    setSelectedId(null);
    selectedRef.current = null;
    setHistTick((t) => t + 1);
  };

  const redo = () => {
    if (!futureRef.current.length) { setStatus({ tone: "error", message: "Nothing to redo." }); return; }
    const next = futureRef.current[0];
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, annosRef.current];
    annosRef.current = next;
    setAnnos(next);
    setSelectedId(null);
    selectedRef.current = null;
    setHistTick((t) => t + 1);
  };

  const clearPage = () => {
    const page = pageRef.current;
    const prev = annosRef.current;
    if (!(prev[page] || []).length) { setStatus({ tone: "error", message: "This page has no annotations to clear." }); return; }
    const next = cloneStore(prev);
    next[page] = [];
    pushStore(prev, next);
    setSelectedId(null);
    selectedRef.current = null;
    setStatus({ tone: "success", message: `Cleared annotations on page ${page}.` });
  };

  // Load the chosen PDF once; keep a private byte copy for pdf-lib.
  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setAnnos({});
    annosRef.current = {};
    pastRef.current = [];
    futureRef.current = [];
    setSelectedId(null);
    setPageImage("");
    setPageDims(null);
    if (!files.length) return undefined;
    runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const buffer = new Uint8Array(await file.arrayBuffer());
      bytesRef.current = buffer.slice();
      const { loadPdfDocument } = await import("../lib/pdfjs");
      const loaded = await loadPdfDocument(buffer.slice());
      if (cancelled) { try { await loaded.destroy(); } catch { /* ignore */ } return "Ready."; }
      setFileName(file.name);
      setPageCount(loaded.numPages);
      setCurrentPage(1);
      setDoc(loaded);
      return "";
    });
    return () => { cancelled = true; };
  }, [files, tool.file]);

  // Render the current page to a backdrop image.
  useEffect(() => {
    if (!doc) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { renderPdfPageToCanvas } = await import("../lib/pdfjs");
        const page = await doc.getPage(currentPage);
        const view = page.view;
        const pointWidth = view[2] - view[0];
        const pointHeight = view[3] - view[1];
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2.5, Math.max(0.6, 900 / base.width));
        const canvas = await renderPdfPageToCanvas(doc, currentPage, scale);
        const cw = canvas.width;
        const ch = canvas.height;
        const url = canvas.toDataURL("image/png");
        canvas.width = 0;
        canvas.height = 0; // release the render canvas immediately
        page.cleanup();
        if (cancelled) return;
        pageWHRef.current = { w: pointWidth, h: pointHeight };
        // Exact px-per-point from the rendered backdrop, so overlay maps 1:1.
        scRef.current = { scale: cw / pointWidth, pointHeight };
        dimsRef.current = { cw, ch };
        setPageImage(url);
        setPageDims({ cw, ch });
        setSelectedId(null);
      } catch (error: any) {
        if (!cancelled) setStatus({ tone: "error", message: error?.message || "Could not render this page." });
      }
    })();
    return () => { cancelled = true; };
  }, [doc, currentPage]);

  // Prepare the overlay canvas backing store (DPI-correct) when it/size changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pageDims) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(pageDims.cw * dpr));
    canvas.height = Math.max(1, Math.round(pageDims.ch * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctxRef.current = ctx;
    paint();
    return () => { ctxRef.current = null; };
  }, [pageDims]);

  // Pointer handling: mouse / touch / stylus in one path. Bound once; live tool
  // settings and page context are read through refs.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const localPoint = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = ((event.clientX - rect.left) / (rect.width || 1)) * dimsRef.current.cw;
      const sy = ((event.clientY - rect.top) / (rect.height || 1)) * dimsRef.current.ch;
      return { sx, sy };
    };
    const toPage = (sx: number, sy: number) =>
      screenToPagePoint({ px: sx, py: sy }, { scale: scRef.current.scale, pageWidth: pageWHRef.current.w, pageHeight: pageWHRef.current.h });

    const down = (event: PointerEvent) => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      const { sx, sy } = localPoint(event);
      const t = toolRef.current;
      const st = styleRef.current;

      if (t === "select") {
        const list = annosRef.current[pageRef.current] || [];
        const hit = hitTestAnnotations(list, sx, sy, scRef.current);
        if (hit) {
          setSelectedId(hit.id);
          selectedRef.current = hit.id;
          moveRef.current = { id: hit.id, last: toPage(sx, sy), snapshot: cloneStore(annosRef.current), moved: false };
        } else {
          setSelectedId(null);
          selectedRef.current = null;
        }
        paint();
        return;
      }

      if (t === "note") {
        const label = st.noteText.trim();
        if (!label) { setStatus({ tone: "error", message: "Type the note text in the field first, then click the page." }); return; }
        const p = toPage(sx, sy);
        addAnnotation({ id: nextAnnotateId(), type: "note", x: p.x, y: p.y, text: label, size: st.fontSize, color: st.color });
        return;
      }

      if (t === "callout") {
        const p = toPage(sx, sy);
        if (st.calloutLeader && !calloutTargetRef.current) {
          calloutTargetRef.current = p;
          setStatus({ tone: "idle", message: "Leader target set. Now click where the note box should sit." });
          return;
        }
        const boxW = Math.min(pageWHRef.current.w * 0.5, 180);
        const boxH = Math.min(pageWHRef.current.h * 0.5, 70);
        const target = calloutTargetRef.current;
        calloutTargetRef.current = null;
        addAnnotation({
          id: nextAnnotateId(), type: "callout",
          x: p.x, y: Math.max(0, p.y - boxH), w: boxW, h: boxH,
          text: st.noteText, size: st.fontSize, color: "#111827", fill: "#fef9c3", border: st.color,
          tx: target ? target.x : undefined, ty: target ? target.y : undefined,
        });
        setStatus({ tone: "success", message: "Sticky note added." });
        return;
      }

      // Drag-based tools: highlight / rect / ellipse / line / arrow / ink.
      gestureRef.current = { startPx: sx, startPy: sy, startPage: toPage(sx, sy) };
      if (t === "ink") {
        const p = toPage(sx, sy);
        draftRef.current = { id: nextAnnotateId(), type: "ink", points: [p], color: st.color, width: st.strokeWidth };
      } else {
        draftRef.current = null;
      }
      paint();
    };

    const move = (event: PointerEvent) => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      const { sx, sy } = localPoint(event);
      const t = toolRef.current;

      if (moveRef.current) {
        event.preventDefault();
        const now = toPage(sx, sy);
        const dx = now.x - moveRef.current.last.x;
        const dy = now.y - moveRef.current.last.y;
        moveRef.current.last = now;
        moveRef.current.moved = true;
        const page = pageRef.current;
        const list = annosRef.current[page] || [];
        annosRef.current[page] = list.map((a) => (a.id === moveRef.current!.id ? translateAnn(a, dx, dy) : a));
        paint();
        return;
      }

      if (!gestureRef.current) return;
      event.preventDefault();
      const st = styleRef.current;
      const g = gestureRef.current;

      if (t === "ink" && draftRef.current) {
        const samples = event.getCoalescedEvents?.() || [];
        for (const s of samples.length ? samples : [event]) {
          const local = localPoint(s);
          draftRef.current.points.push(toPage(local.sx, local.sy));
        }
        paint();
        return;
      }

      const p0 = g.startPage;
      const p1 = toPage(sx, sy);
      if (t === "line" || t === "arrow") {
        draftRef.current = { id: "draft", type: t, x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y, color: st.color, width: st.strokeWidth };
      } else {
        const box = { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y) };
        if (t === "highlight") draftRef.current = { id: "draft", type: "highlight", ...box, color: st.highlightColor, opacity: 0.4 };
        else draftRef.current = { id: "draft", type: t, ...box, color: st.color, width: st.strokeWidth, fill: st.fillEnabled ? st.fillColor : null, fillOpacity: 0.2 };
      }
      paint();
    };

    const up = (event: PointerEvent) => {
      if (moveRef.current) {
        const mv = moveRef.current;
        moveRef.current = null;
        if (mv.moved) {
          const committed = cloneStore(annosRef.current); // fresh ref so setAnnos re-renders
          annosRef.current = mv.snapshot; // rewind so pushStore records the pre-move state as history
          pushStore(mv.snapshot, committed);
        }
        return;
      }
      const g = gestureRef.current;
      const draft = draftRef.current;
      gestureRef.current = null;
      draftRef.current = null;
      if (!g || !draft) { paint(); return; }
      const st = styleRef.current;
      const t = draft.type;

      if (t === "ink") {
        if ((draft.points || []).length >= 1) addAnnotation({ ...draft, id: nextAnnotateId() });
        else paint();
        return;
      }

      const { sx, sy } = localPoint(event);
      const p0 = g.startPage;
      const p1 = toPage(sx, sy);
      if (t === "line" || t === "arrow") {
        if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1) { paint(); return; }
        addAnnotation({ id: nextAnnotateId(), type: t, x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y, color: st.color, width: st.strokeWidth });
        return;
      }
      const w = Math.abs(p1.x - p0.x);
      const h = Math.abs(p1.y - p0.y);
      if (w < 2 || h < 2) { paint(); return; } // ignore an accidental click-sized box
      const box = { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w, h };
      if (t === "highlight") addAnnotation({ id: nextAnnotateId(), type: "highlight", ...box, color: st.highlightColor, opacity: 0.4 });
      else addAnnotation({ id: nextAnnotateId(), type: t, ...box, color: st.color, width: st.strokeWidth, fill: st.fillEnabled ? st.fillColor : null, fillOpacity: 0.2 });
    };

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointercancel", up);
    window.addEventListener("pointerup", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointercancel", up);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  // Delete/Backspace removes the selected annotation while the tool is focused.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedRef.current) {
        event.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const totalAnnos = Object.values(annos).reduce((sum, list) => sum + list.length, 0);
  const pagesWithAnnos = Object.entries(annos).filter(([, list]) => list.length > 0).length;
  const showStroke = ["ink", "rect", "ellipse", "line", "arrow"].includes(activeTool);
  const showFill = activeTool === "rect" || activeTool === "ellipse";
  const showColor = showStroke || activeTool === "note" || activeTool === "callout";
  const showText = activeTool === "note" || activeTool === "callout";

  return (
    <ToolForm status={status} onReset={reset}>
      <div className="surface-muted wabi-card-edge grid gap-1 p-4 text-sm font-semibold leading-6 text-neutral-600">
        <p className="text-xs font-bold uppercase text-neutral-500">How this works — and its limits</p>
        <p className="text-[var(--foreground)]">Pick a tool, mark up the page, navigate pages, then export. Your markup is <strong>flattened (burned) into the page</strong> on export.</p>
        <ul className="ml-4 list-disc">
          <li>Flattened markup renders <strong>identically in every reader</strong> and cannot be tampered with as data — but it is <strong>not reader-editable</strong> (no selectable /Annot objects). Edit here before exporting.</li>
          <li>The original page content stays intact <strong>underneath</strong> the markup; a highlight is drawn as a translucent marker over it.</li>
          <li>Text notes and sticky notes are <strong>English and common European letters only</strong> — no CJK or emoji.</li>
          <li>To permanently remove content rather than mark it up, use <a className="underline" href="#redact-pdf-tool">Redact PDF</a>.</li>
        </ul>
      </div>

      <FileControl accept="application/pdf" files={files} setFiles={setFiles} />

      {doc && pageCount > 0 && (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Annotation tools">
            {ANNOTATE_TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={activeTool === t.id}
                onClick={() => { setActiveTool(t.id); calloutTargetRef.current = null; if (t.id !== "select") { setSelectedId(null); selectedRef.current = null; } }}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold uppercase transition ${activeTool === t.id ? "border-[var(--moss)] bg-[var(--moss)] text-white" : "border-[var(--line)] bg-[var(--paper-soft)] text-neutral-600 hover:border-[var(--moss)]"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            {activeTool === "highlight" && (
              <div className="grid gap-2">
                <span className="text-xs font-bold uppercase text-neutral-500">Highlight colour</span>
                <div className="flex flex-wrap gap-2">
                  {HIGHLIGHT_PALETTE.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      aria-label={`Highlight ${c.id}`}
                      aria-pressed={highlightColor === c.hex}
                      onClick={() => setHighlightColor(c.hex)}
                      className={`h-8 w-8 rounded-full border-2 transition ${highlightColor === c.hex ? "border-[var(--foreground)] scale-110" : "border-[var(--line)]"}`}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              </div>
            )}
            {(showColor || showText) && (
              <div className="grid gap-3 sm:grid-cols-3">
                {showColor && <Input label={activeTool === "note" ? "Text colour" : activeTool === "callout" ? "Accent colour" : "Stroke colour"} value={color} onChange={setColor} type="color" />}
                {showStroke && <Input label="Stroke width" value={strokeWidth} onChange={setStrokeWidth} type="number" helper="0.5–60 pt" />}
                {showText && <Input label="Font size" value={fontSize} onChange={setFontSize} type="number" helper="4–96 pt" />}
              </div>
            )}
            {showFill && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Checkbox label="Fill shape" checked={fillEnabled} onChange={setFillEnabled} />
                {fillEnabled && <Input label="Fill colour" value={fillColor} onChange={setFillColor} type="color" />}
              </div>
            )}
            {showText && <Input label={activeTool === "note" ? "Note text" : "Sticky note text"} value={noteText} onChange={setNoteText} helper={activeTool === "note" ? "Click the page to place this label." : "Drag/click to place the note box."} />}
            {activeTool === "callout" && <Checkbox label="Add a leader line (click the target first, then place the box)" checked={calloutLeader} onChange={setCalloutLeader} />}
            {activeTool === "select" && <p className="text-sm font-semibold text-neutral-600">Click an annotation to select it, drag to move it, and press Delete (or the button below) to remove it.</p>}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button className="secondary-button" type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}><ArrowLeft size={16} /> Prev</button>
              <span className="text-sm font-bold tabular-nums">Page {currentPage} / {pageCount}</span>
              <button className="secondary-button" type="button" disabled={currentPage >= pageCount} onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}>Next <ArrowRight size={16} /></button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="secondary-button" type="button" disabled={pastRef.current.length === 0} onClick={undo} data-hist={histTick}>Undo</button>
              <button className="secondary-button" type="button" disabled={futureRef.current.length === 0} onClick={redo}>Redo</button>
              <button className="secondary-button" type="button" disabled={!selectedId} onClick={deleteSelected}>Delete</button>
              <button className="secondary-button" type="button" onClick={clearPage}>Clear page</button>
            </div>
          </div>

          <p className="text-xs font-bold text-neutral-500">{totalAnnos} annotation{totalAnnos === 1 ? "" : "s"} across {pagesWithAnnos} page{pagesWithAnnos === 1 ? "" : "s"} · this page: {(annos[currentPage] || []).length}</p>
        </>
      )}

      {doc && pageImage && pageDims && (
        <div className="surface-card wabi-card-edge overflow-auto p-2" style={{ maxHeight: "72vh" }}>
          <div className="relative mx-auto" style={{ width: pageDims.cw, height: pageDims.ch }}>
            <img src={pageImage} width={pageDims.cw} height={pageDims.ch} alt={`Page ${currentPage} of ${fileName}`} className="block select-none" draggable={false} />
            <canvas
              ref={canvasRef}
              className="absolute left-0 top-0"
              style={{ width: pageDims.cw, height: pageDims.ch, touchAction: "none", cursor: activeTool === "select" ? "default" : "crosshair" }}
            />
          </div>
        </div>
      )}

      <PrimaryButton label="Export annotated PDF" disabled={totalAnnos === 0} onClick={() => runSafely(setStatus, async () => {
        if (!bytesRef.current) throw new Error("Load a PDF first.");
        if (totalAnnos === 0) throw new Error("Add at least one annotation before exporting.");
        const map: AnnStore = {};
        for (const [page, list] of Object.entries(annos)) if (list.length) map[Number(page)] = list;
        const out = await applyAnnotations(bytesRef.current, map, undefined, {
          onProgress: (done: number, total: number) => setStatus({ tone: "idle", message: `Burning annotations — page ${done} of ${total}…`, progress: { value: done, total, label: "Flattening…" } }),
        });
        downloadBytes(out, withExtension(`${safeFilename(fileName)}-annotated`, "pdf"), "application/pdf");
        return `Exported ${totalAnnos} annotation${totalAnnos === 1 ? "" : "s"} across ${pagesWithAnnos} page${pagesWithAnnos === 1 ? "" : "s"}. The markup is now flattened into ${fileName}.`;
      })} />

      <ResultConsequenceNote>Marks are drawn into the page, so every reader shows them the same way — but they cannot be edited afterwards. Keep your original if you might need to change them.</ResultConsequenceNote>
    </ToolForm>
  );
}

function PdfPageNumbersTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [prefix, setPrefix] = useState("Page ");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setPrefix("Page "); setStatus(initialStatus); }}>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Input label="Prefix" value={prefix} onChange={setPrefix} placeholder="Page " helper="Example output: Page 1, Page 2, Page 3" />
    <PrimaryButton label="Add page numbers" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const bytes = await addPdfPageNumbers(file, { prefix });
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-page-numbers`, "pdf"), "application/pdf");
      return `Added page numbers to ${file.name}.`;
    })} />
  </ToolForm>;
}

function WatermarkPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("CONFIDENTIAL");
  const [opacity, setOpacity] = useState("0.18");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setText("CONFIDENTIAL"); setOpacity("0.18"); setStatus(initialStatus); }}>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Input label="Watermark text" value={text} onChange={setText} />
    <Input label="Opacity" value={opacity} onChange={setOpacity} type="number" helper="Use a value from 0.05 to 0.6." />
    <PrimaryButton label="Watermark PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const bytes = await watermarkPdf(file, text, { opacity: Number(opacity) });
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-watermarked`, "pdf"), "application/pdf");
      return `Watermark applied to ${file.name}.`;
    })} />
  </ToolForm>;
}

function PdfToImageTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState("jpg");
  const [dpi, setDpi] = useState("150");
  const [quality, setQuality] = useState("0.82");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Select label="Image format" value={format} onChange={setFormat} options={["jpg", "png", "webp"]} labels={["JPG", "PNG", "WebP"]} />
    <Select label="Resolution (DPI)" value={dpi} onChange={setDpi} options={["72", "150", "200", "300"]} labels={["72 · screen", "150 · default", "200 · high", "300 · print"]} />
    {format !== "png" && <Range label="Quality" value={quality} onChange={setQuality} />}
    <PrimaryButton label="Convert to images" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const images = await pdfToImages(file, { format, dpi: Number(dpi), quality: Number(quality), onProgress: pageProgress(setStatus, "Rendering") });
      const base = safeFilename(file.name);
      if (images.length === 1) {
        downloadBlob(images[0].blob, withExtension(`${base}-page-1`, format));
        return `Exported 1 page as ${format.toUpperCase()}.`;
      }
      const entries: Record<string, Uint8Array> = {};
      for (const image of images) entries[image.name] = new Uint8Array(await image.blob.arrayBuffer());
      const zipped = zipSync(entries, { level: 0 });
      const buffer = new ArrayBuffer(zipped.byteLength);
      new Uint8Array(buffer).set(zipped);
      downloadBlob(new Blob([buffer], { type: "application/zip" }), `${base}-images.zip`);
      return `Exported ${images.length} pages as ${format.toUpperCase()} into one ZIP file.`;
    })} />
  </ToolForm>;
}

// Compressing turns every page into a JPEG. On a genuinely text-based PDF that
// both destroys the selectable text and inflates the file — a 15 KB text PDF
// comes back at 1 MB. So we look before we leap: a substantial text layer with
// far fewer embedded images than pages means "this is text, don't flatten it".
// A scan (or an OCR'd scan) carries a full-page image per page, so it is never
// flagged and keeps compressing as before.
const TEXT_HEAVY_CHARS_PER_PAGE = 200;
type CompressPreflight = { pages: number; chars: number; images: number; textHeavy: boolean };

async function inspectPdfForCompression(file: File): Promise<CompressPreflight> {
  const text = await extractPdfText(file);
  const pdf = await loadPdf(file, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
  const { PDFName, PDFRawStream } = getPdfLib();
  const pages = pdf.getPageCount();
  let images = 0;
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream && object.dict && String(object.dict.get(PDFName.of("Subtype"))) === "/Image") images += 1;
  }
  const chars = text.replace(/\s+/g, " ").trim().length;
  const charsPerPage = pages > 0 ? chars / pages : 0;
  return { pages, chars, images, textHeavy: charsPerPage >= TEXT_HEAVY_CHARS_PER_PAGE && images * 2 < pages };
}

function CompressPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState("0.6");
  const [dpi, setDpi] = useState("120");
  const [status, setStatus] = useState(initialStatus);
  const [preflight, setPreflight] = useState<CompressPreflight | null>(null);
  const [flattenAnyway, setFlattenAnyway] = useState(false);

  // Inspect the chosen PDF up front so the warning arrives before the damage,
  // not after. The check is advisory: if it fails, compressing still works.
  useEffect(() => {
    const file = files[0];
    setPreflight(null);
    setFlattenAnyway(false);
    if (!file) return;
    let cancelled = false;
    inspectPdfForCompression(file)
      .then((result) => { if (!cancelled) setPreflight(result); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [files]);

  const blocked = Boolean(preflight?.textHeavy) && !flattenAnyway;

  return <ToolForm status={status} onReset={() => { setFiles([]); setPreflight(null); setFlattenAnyway(false); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      This turns each page into a JPEG image, so selectable text becomes part of the image. Best for image-heavy or scanned PDFs. On a text-based PDF it destroys the text and usually makes the file <strong>bigger</strong>.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    {preflight?.textHeavy && (
      <div className="surface-card wabi-card-edge grid gap-2 border-[var(--warning)] p-4 text-sm font-semibold leading-6 text-neutral-600">
        <p className="text-xs font-bold uppercase text-[var(--warning)]">This is a text-based PDF — compressing will probably make it larger</p>
        <p className="text-[var(--foreground)]">It carries about {preflight.chars.toLocaleString()} characters of selectable text across {preflight.pages} page{preflight.pages === 1 ? "" : "s"}, with {preflight.images === 0 ? "no" : preflight.images} embedded image{preflight.images === 1 ? "" : "s"}. Text is already tiny to store; a photograph of that text is not — so rasterising it typically inflates the file many times over <em>and</em> leaves you with no selectable, searchable, or copyable text.</p>
        <p>What to do instead: keep this file as it is, drop pages you don't need with <a className="underline" href="#split-pdf-tool">Split / Extract PDF Pages</a>, pull out the heavy artwork with <a className="underline" href="#extract-images-tool">Extract Images &amp; Attachments</a>, or re-save it with <a className="underline" href="#repair-pdf-tool">Repair PDF</a> to drop unused objects.</p>
        <Checkbox label="Do it anyway — I accept a bigger file with no selectable text" checked={flattenAnyway} onChange={setFlattenAnyway} />
      </div>
    )}
    <Select label="Resolution (DPI)" value={dpi} onChange={setDpi} options={["96", "120", "150", "200"]} labels={["96 · smallest", "120 · default", "150 · sharp", "200 · sharpest"]} />
    <Range label="JPEG quality" value={quality} onChange={setQuality} />
    <PrimaryButton label="Compress PDF" disabled={blocked} onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const { bytes, before, after } = await rasterCompressPdf(file, { quality: Number(quality), dpi: Number(dpi), onProgress: pageProgress(setStatus, "Compressing") });
      // Never hand back a worse file behind a success message. If the output is
      // larger it is not offered for download at all — it is reported, with both
      // sizes, as the warning it is.
      if (after >= before) {
        throw new Error([
          `Not compressed — this file got bigger, so nothing was saved.`,
          `Original: ${formatBytes(before)}`,
          `Turn into an imaged output: ${formatBytes(after)}`,
          `Why: compressing turns every page into a JPEG. This PDF's pages are mostly text, and a picture of text costs far more to store than the text itself — so the output grew instead of shrinking, and it would have had no selectable text.`,
          `What to do instead: keep the original, remove pages you don't need with Split / Extract PDF Pages, or re-save it with Repair PDF. Compression only pays off on scans and image-heavy PDFs.`,
        ].join("\n"));
      }
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-compressed`, "pdf"), "application/pdf");
      const saved = Math.round((1 - after / before) * 100);
      return `Original: ${formatBytes(before)}\nOutput: ${formatBytes(after)}\nSaved about ${saved}%.`;
    })} />
  </ToolForm>;
}

function PdfToZipTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PrimaryButton label="Split into ZIP" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const { zipped, pages } = await pdfToZip(file);
      const buffer = new ArrayBuffer(zipped.byteLength);
      new Uint8Array(buffer).set(zipped);
      downloadBlob(new Blob([buffer], { type: "application/zip" }), `${safeFilename(file.name)}-pages.zip`);
      return `Split ${pages} page${pages === 1 ? "" : "s"} into one ZIP file (one PDF per page).`;
    })} />
  </ToolForm>;
}

function FlattenPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [dpi, setDpi] = useState("150");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Rebuilds every page as a flat image, removing form fields, annotations, and other interactive layers before you share.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Select label="Resolution (DPI)" value={dpi} onChange={setDpi} options={["120", "150", "200", "300"]} labels={["120 · smaller", "150 · default", "200 · high", "300 · print"]} />
    <PrimaryButton label="Flatten PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const bytes = await flattenPdf(file, { dpi: Number(dpi), onProgress: pageProgress(setStatus, "Flattening") });
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-flattened`, "pdf"), "application/pdf");
      return `Flattened ${file.name} into a non-interactive PDF.`;
    })} />
  </ToolForm>;
}

function InvertPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [dpi, setDpi] = useState("150");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Select label="Resolution (DPI)" value={dpi} onChange={setDpi} options={["120", "150", "200", "300"]} labels={["120 · smaller", "150 · default", "200 · high", "300 · print"]} />
    <PrimaryButton label="Invert colours" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const bytes = await invertPdf(file, { dpi: Number(dpi), onProgress: pageProgress(setStatus, "Inverting") });
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-inverted`, "pdf"), "application/pdf");
      return `Inverted the colours of ${file.name}.`;
    })} />
  </ToolForm>;
}

function OrganizePagesTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [order, setOrder] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setOrder(""); setStatus(initialStatus); }}>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Input label="Page order" value={order} onChange={setOrder} placeholder="Example: 3,1,2,5-7" helper="List pages/ranges in the order you want. Repeat to duplicate, omit to delete. Descending ranges (7-5) reverse pages." />
    <PrimaryButton label="Organize pages" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const bytes = await organizePdfPages(file, order);
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-organized`, "pdf"), "application/pdf");
      return `Rebuilt ${file.name} in the requested page order.`;
    })} />
  </ToolForm>;
}

function CropResizePdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState("resize");
  const [size, setSize] = useState("A4");
  const [customWidth, setCustomWidth] = useState("210");
  const [customHeight, setCustomHeight] = useState("297");
  const [margin, setMargin] = useState("10");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Select label="Action" value={mode} onChange={setMode} options={["resize", "crop"]} labels={["Resize pages to a target size", "Crop a uniform margin"]} />
    {mode === "resize" && <Select label="Page size" value={size} onChange={setSize} options={["A4", "A3", "A5", "Letter", "Legal", "custom"]} labels={["A4", "A3", "A5", "US Letter", "US Legal", "Custom (mm)"]} />}
    {mode === "resize" && size === "custom" && (
      <div className="grid gap-3 sm:grid-cols-2"><Input label="Width (mm)" value={customWidth} onChange={setCustomWidth} type="number" /><Input label="Height (mm)" value={customHeight} onChange={setCustomHeight} type="number" /></div>
    )}
    {mode === "crop" && <Input label="Margin (mm)" value={margin} onChange={setMargin} type="number" helper="Trims this margin from every edge via the page crop and media boxes." />}
    <PrimaryButton label={mode === "crop" ? "Crop PDF" : "Resize PDF"} onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const bytes = await cropResizePdf(file, { mode, size, customWidthMm: Number(customWidth), customHeightMm: Number(customHeight), marginMm: Number(margin) });
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-${mode === "crop" ? "cropped" : "resized"}`, "pdf"), "application/pdf");
      return mode === "crop" ? `Cropped a ${margin}mm margin from ${file.name}.` : `Resized ${file.name}${size === "custom" ? ` to ${customWidth}×${customHeight}mm` : ` to ${size}`}.`;
    })} />
  </ToolForm>;
}

function HeadersFootersTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("Page {n} of {total}");
  const [align, setAlign] = useState("center");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Use the tokens {"{n}"} for the current page number and {"{total}"} for the page count. Text supports Latin-1 characters only.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Input label="Header text" value={header} onChange={setHeader} placeholder="Leave blank for no header" />
    <Input label="Footer text" value={footer} onChange={setFooter} placeholder="Leave blank for no footer" />
    <Select label="Alignment" value={align} onChange={setAlign} options={["left", "center", "right"]} labels={["Left", "Center", "Right"]} />
    <PrimaryButton label="Add headers & footers" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const bytes = await addHeadersFooters(file, { header, footer, align });
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-headers`, "pdf"), "application/pdf");
      return `Applied headers/footers to ${file.name}.`;
    })} />
  </ToolForm>;
}

type FormFieldDescriptor = { name: string; type: "text" | "checkbox" | "unsupported"; value?: string; checked?: boolean };

function FillPdfFormTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [fields, setFields] = useState<FormFieldDescriptor[]>([]);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [flatten, setFlatten] = useState(false);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => { setFiles([]); setFields([]); setValues({}); setFlatten(false); setStatus(initialStatus); };

  return <ToolForm status={status} onReset={reset}>
    <FileControl accept="application/pdf" files={files} setFiles={(next) => { setFiles(next); setFields([]); setValues({}); }} />
    <PrimaryButton label="Read form fields" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const found = await readPdfFormFields(file);
      setFields(found);
      const initial: Record<string, string | boolean> = {};
      for (const field of found) initial[field.name] = field.type === "checkbox" ? Boolean(field.checked) : (field.value || "");
      setValues(initial);
      return found.length ? `Found ${found.length} form field${found.length === 1 ? "" : "s"}.` : "This PDF has no fillable form fields.";
    })} />
    {fields.length > 0 && (
      <div className="grid gap-3">
        {fields.map((field) => field.type === "checkbox" ? (
          <Checkbox key={field.name} label={field.name} checked={Boolean(values[field.name])} onChange={(checked) => setValues((prev) => ({ ...prev, [field.name]: checked }))} />
        ) : field.type === "text" ? (
          <Input key={field.name} label={field.name} value={String(values[field.name] ?? "")} onChange={(next) => setValues((prev) => ({ ...prev, [field.name]: next }))} />
        ) : (
          <p key={field.name} className="text-xs font-semibold text-neutral-500">{field.name}: unsupported field type (left unchanged).</p>
        ))}
        <Checkbox label="Flatten form after filling (values become permanent)" checked={flatten} onChange={setFlatten} />
        <PrimaryButton label="Fill PDF" onClick={() => runSafely(setStatus, async () => {
          const [file] = validateFiles(files, tool.file);
          const bytes = await fillPdfForm(file, values, flatten);
          downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-filled`, "pdf"), "application/pdf");
          return `Filled ${fields.length} field${fields.length === 1 ? "" : "s"}${flatten ? " and flattened the form" : ""}.`;
        })} />
      </div>
    )}
  </ToolForm>;
}

function RedactPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [areas, setAreas] = useState("");
  const [dpi, setDpi] = useState("150");
  const [status, setStatus] = useState(initialStatus);

  // Marking a new file must not inherit the previous file's areas: this is an
  // irreversible flattening operation, and applying page 4 of the old document
  // to a one-page new one used to succeed silently.
  const loadFiles = (next: File[]) => {
    const changed = next[0] !== files[0];
    setFiles(next);
    if (changed) { setAreas(""); setStatus(initialStatus); }
  };

  // Areas dragged directly on the page arrive here in the same percentage units
  // the textarea has always used, so both routes feed one parser.
  useEffect(() => {
    const onRegion = (event: Event) => {
      const d = (event as CustomEvent<{ page: number; percent: { x: number; y: number; w: number; h: number } }>).detail;
      if (!d || d.percent.w <= 0 || d.percent.h <= 0) return;
      const line = `${d.page}, ${d.percent.x}, ${d.percent.y}, ${d.percent.w}, ${d.percent.h}`;
      setAreas((current) => (current.trim() ? `${current.trim()}\n${line}` : line));
    };
    window.addEventListener("myfilekit:region-selected", onRegion);
    return () => window.removeEventListener("myfilekit:region-selected", onRegion);
  }, []);

  // One source of truth: the page draws what the coordinate list says, so
  // editing or deleting a line updates the page and a mis-drag can be undone.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("myfilekit:marked-areas", { detail: { areas: parseAreaLines(areas) } }));
  }, [areas]);

  return <ToolForm status={status} onReset={() => { setFiles([]); setAreas(""); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Redaction turns the whole PDF into images and paints opaque black boxes on the listed areas, so covered content is permanently removed — not just hidden. Selectable text is lost.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={loadFiles} />
    {files.length ? <p className="doc-select-hint">Drag on the page, or press Enter on it and use the arrow keys — or type coordinates below.</p> : null}
    <Textarea label="Redaction areas — one per line: page, x, y, width, height (in %)" value={areas} onChange={setAreas} rows={5} />
    <Select label="Resolution (DPI)" value={dpi} onChange={setDpi} options={["120", "150", "200", "300"]} labels={["120 · smaller", "150 · default", "200 · high", "300 · print"]} />
    <PrimaryButton label="Redact PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const rects = parseRedactionAreas(areas);
      const bytes = await redactPdf(file, rects, { dpi: Number(dpi) });
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-redacted`, "pdf"), "application/pdf");
      return `Applied ${rects.length} redaction${rects.length === 1 ? "" : "s"} and flattened ${file.name} to images.`;
    })} />
    {status.tone === "success" && <ResultConsequenceNote>The covered text is permanently removed and the page is flattened to an image. Verify nothing sensitive remains before sharing.</ResultConsequenceNote>}
  </ToolForm>;
}

type ExtractResult = {
  images: { name: string; bytes: Uint8Array; mime: string; kind: string }[];
  attachments: { name: string; bytes: Uint8Array; size: number }[];
  skipped: { reason: string; width?: number; height?: number; filters?: string[] }[];
  counts: { imageXObjects: number; extractedImages: number; attachments: number; skipped: number };
};

function ExtractImagesTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => { setFiles([]); setResult(null); setStatus(initialStatus); };

  const zipName = files.length ? withExtension(`${safeFilename(files[0].name)}-extracted`, "zip") : "extracted.zip";

  return (
    <ToolForm status={status} onReset={reset}>
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        Pulls out the raster images and file attachments actually stored inside a PDF — not page renders. JPEG (DCTDecode) images are saved byte-for-byte as .jpg; FlateDecode raster is rebuilt as lossless PNG. Repeated images are de-duplicated, attachment names are sanitized, and anything in a codec that cannot be extracted losslessly is listed rather than guessed at.
      </div>
      <FileControl accept="application/pdf" files={files} setFiles={(next) => { setFiles(next); setResult(null); setStatus(initialStatus); }} />

      <PrimaryButton label="Extract" onClick={() => runSafely(setStatus, async () => {
        const [file] = validateFiles(files, tool.file);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const extracted = (await extractPdfAssets(bytes, {
          onProgress: (done: number, total: number) => setStatus({ tone: "idle", message: `Decoding images ${done} of ${total}…`, progress: { value: done, total: Math.max(total, 1), label: "Extracting" } }),
        })) as ExtractResult;
        setResult(extracted);
        if (!extracted.images.length && !extracted.attachments.length) {
          return extracted.counts.imageXObjects > 0
            ? `No images could be extracted losslessly — ${extracted.counts.skipped} image${extracted.counts.skipped === 1 ? "" : "s"} use an unsupported codec (see below).`
            : "This PDF has no embedded raster images or file attachments to extract.";
        }
        return `Found ${extracted.images.length} image${extracted.images.length === 1 ? "" : "s"} and ${extracted.attachments.length} attachment${extracted.attachments.length === 1 ? "" : "s"}.`;
      })} />

      {result && (
        <div className="surface-card wabi-card-edge grid gap-3 p-4">
          <p className="font-black">Extraction summary</p>
          <dl className="grid gap-2 text-sm font-semibold text-neutral-600 sm:grid-cols-2">
            <InfoRow label="Image XObjects found" value={String(result.counts.imageXObjects)} />
            <InfoRow label="Images extracted" value={String(result.counts.extractedImages)} />
            <InfoRow label="Attachments" value={String(result.counts.attachments)} />
            <InfoRow label="Skipped (unsupported)" value={String(result.counts.skipped)} />
          </dl>
          {result.images.length > 0 && (
            <div className="grid gap-1 text-sm font-semibold text-neutral-600">
              <p className="text-xs font-bold uppercase text-neutral-500">Images</p>
              <ul className="grid gap-1">
                {result.images.map((image) => <li key={image.name} className="flex flex-wrap items-center justify-between gap-2"><span className="break-words text-[var(--foreground)]">{image.name}</span><span className="text-xs text-neutral-500">{image.kind} · {formatBytes(image.bytes.length)}</span></li>)}
              </ul>
            </div>
          )}
          {result.attachments.length > 0 && (
            <div className="grid gap-1 text-sm font-semibold text-neutral-600">
              <p className="text-xs font-bold uppercase text-neutral-500">Attachments</p>
              <ul className="grid gap-1">
                {result.attachments.map((attachment) => <li key={attachment.name} className="flex flex-wrap items-center justify-between gap-2"><span className="break-words text-[var(--foreground)]">{attachment.name}</span><span className="text-xs text-neutral-500">{formatBytes(attachment.size)}</span></li>)}
              </ul>
            </div>
          )}
          {result.skipped.length > 0 && (
            <div className="grid gap-1 text-sm font-semibold text-neutral-600">
              <p className="text-xs font-bold uppercase text-neutral-500">Skipped</p>
              <ul className="grid gap-1">
                {result.skipped.map((entry, index) => <li key={index} className="break-words text-neutral-500">{entry.width && entry.height ? `${entry.width}×${entry.height}: ` : ""}{entry.reason}</li>)}
              </ul>
            </div>
          )}
          {(result.images.length > 0 || result.attachments.length > 0) && (
            <PrimaryButton label="Package as ZIP" onClick={() => runSafely(setStatus, async () => {
              const zipped = buildExtractionZip(result);
              downloadBytes(zipped, zipName, "application/zip");
              return `${zipName} ready to save (${result.images.length + result.attachments.length} file${result.images.length + result.attachments.length === 1 ? "" : "s"}).`;
            })} />
          )}
        </div>
      )}
    </ToolForm>
  );
}

function CreatePdfTool() {
  const [mode, setMode] = useState("text");
  const [size, setSize] = useState("A4");
  const [count, setCount] = useState("1");
  const [text, setText] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setText(""); setCount("1"); setStatus(initialStatus); }}>
    <Select label="Build from" value={mode} onChange={setMode} options={["text", "blank"]} labels={["Pasted text", "Blank pages"]} />
    {mode === "blank" && <Select label="Page size" value={size} onChange={setSize} options={["A4", "A3", "A5", "Letter", "Legal"]} labels={["A4", "A3", "A5", "US Letter", "US Legal"]} />}
    {mode === "blank" && <Input label="Page count" value={count} onChange={setCount} type="number" helper="1 to 200 pages." />}
    {mode === "text" && <Textarea label="Text content" value={text} onChange={setText} rows={12} />}
    <PrimaryButton label="Create PDF" onClick={() => runSafely(setStatus, async () => {
      const bytes = await createPdf({ mode, size, count: Number(count), text });
      downloadBytes(bytes, withExtension("myfilekit-created", "pdf"), "application/pdf");
      return mode === "text" ? "Created a PDF from your text." : `Created a ${count}-page ${size} PDF.`;
    })} />
  </ToolForm>;
}

function RepairPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Best-effort repair: the PDF is loaded leniently and re-saved in a normalised form. If it cannot be parsed at all, pages are rebuilt from rendered images (text becomes non-selectable).
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PrimaryButton label="Repair PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const { bytes, message } = await repairPdf(file);
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-repaired`, "pdf"), "application/pdf");
      return message;
    })} />
  </ToolForm>;
}

function SmartSplitPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState("everyN");
  const [everyN, setEveryN] = useState("5");
  const [parts, setParts] = useState("2");
  const [atPages, setAtPages] = useState("");
  const [outline, setOutlineEntries] = useState<Array<{ title: string; page: number | null; level: number }> | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => { setFiles([]); setMode("everyN"); setEveryN("5"); setParts("2"); setAtPages(""); setOutlineEntries(null); setStatus(initialStatus); };
  const topBookmarks = outline ? outline.filter((entry) => entry.level === 0 && entry.page) : [];

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Splits one PDF into several files and bundles them into a ZIP. Choose how to split: fixed page counts, a number of equal parts, specific page numbers, or one file per top-level bookmark.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={(next) => { setFiles(next); setOutlineEntries(null); }} />
    <Select label="Split mode" value={mode} onChange={setMode} options={["everyN", "equalParts", "atPages", "bookmarks"]} labels={["Every N pages", "Into K equal parts", "At specific page numbers", "One file per bookmark"]} />
    {mode === "everyN" && <Input label="Pages per file" value={everyN} onChange={setEveryN} type="number" helper="Each output file gets this many pages (the last may have fewer)." />}
    {mode === "equalParts" && <Input label="Number of parts" value={parts} onChange={setParts} type="number" helper="Pages are distributed as evenly as possible; any remainder goes to the earliest parts." />}
    {mode === "atPages" && <Input label="Split at pages" value={atPages} onChange={setAtPages} placeholder="Example: 5, 12, 20" helper="Each listed page starts a new file." />}
    {mode === "bookmarks" && (
      <div className="grid gap-3">
        <SecondaryButton label="Read bookmarks" onClick={() => runSafely(setStatus, async () => {
          const [file] = validateFiles(files, tool.file);
          const entries = await readOutline(file);
          setOutlineEntries(entries);
          const top = entries.filter((entry) => entry.level === 0 && entry.page);
          return top.length ? `Found ${top.length} top-level bookmark${top.length === 1 ? "" : "s"}.` : "This PDF has no top-level bookmarks. Choose another split mode.";
        })} />
        {topBookmarks.length > 0 && (
          <div className="surface-muted wabi-card-edge grid gap-1 p-4 text-sm font-semibold text-neutral-600">
            {topBookmarks.map((entry, index) => <p key={index} className="break-words text-[var(--foreground)]">{entry.title || "(untitled)"} · page {entry.page}</p>)}
          </div>
        )}
      </div>
    )}
    <PrimaryButton label="Split into ZIP" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const opts: any = { mode, onProgress: pageProgress(setStatus, "Writing") };
      if (mode === "everyN") opts.everyN = Number(everyN);
      if (mode === "equalParts") opts.parts = Number(parts);
      if (mode === "atPages") opts.atPages = parseSplitPages(atPages);
      const { zipped, partCount, sizes } = await smartSplitPdf(file, opts);
      const buffer = new ArrayBuffer(zipped.byteLength);
      new Uint8Array(buffer).set(zipped);
      downloadBlob(new Blob([buffer], { type: "application/zip" }), `${safeFilename(file.name)}-split.zip`);
      return `Produced ${partCount} file${partCount === 1 ? "" : "s"} (pages per file: ${sizes.join(", ")}).`;
    })} />
  </ToolForm>;
}

function BatesNumberingTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [prefix, setPrefix] = useState("ABC");
  const [start, setStart] = useState("1");
  const [padding, setPadding] = useState("6");
  const [suffix, setSuffix] = useState("");
  const [position, setPosition] = useState("bottom-right");
  const [fontSize, setFontSize] = useState("10");
  const [startPage, setStartPage] = useState("1");
  const [status, setStatus] = useState(initialStatus);

  const positionLabels: Record<string, string> = { "bottom-right": "Bottom right", "bottom-left": "Bottom left", "bottom-center": "Bottom center", "top-right": "Top right", "top-left": "Top left", "top-center": "Top center" };

  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Stamps continuous legal Bates numbers on every page, e.g. prefix "ABC" with padding 6 starting at 1 gives ABC000001, ABC000002… Unlike plain page numbers, the number is continuous with a fixed-width prefix. Text supports Latin-1 characters only.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="Prefix" value={prefix} onChange={setPrefix} placeholder="e.g. ABC" />
      <Input label="Suffix" value={suffix} onChange={setSuffix} placeholder="Optional" />
      <Input label="Starting number" value={start} onChange={setStart} type="number" />
      <Input label="Digit padding" value={padding} onChange={setPadding} type="number" helper="e.g. 6 → 000001" />
      <Input label="Start page" value={startPage} onChange={setStartPage} type="number" helper="Stamp from this page onward." />
      <Input label="Font size" value={fontSize} onChange={setFontSize} type="number" />
    </div>
    <Select label="Position" value={position} onChange={setPosition} options={BATES_POSITION_IDS} labels={BATES_POSITION_IDS.map((id) => positionLabels[id] || id)} />
    <PrimaryButton label="Apply Bates numbers" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const { bytes, first, last, count } = await batesNumberPdf(file, {
        prefix, suffix, start: Number(start), padding: Number(padding),
        position, fontSize: Number(fontSize), startPage: Number(startPage),
      });
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-bates`, "pdf"), "application/pdf");
      return `Stamped ${count} page${count === 1 ? "" : "s"} from ${first} to ${last}.`;
    })} />
  </ToolForm>;
}

function ImposePdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState("nup");
  const [n, setN] = useState("4");
  const [pageSize, setPageSize] = useState("A4");
  const [orientation, setOrientation] = useState("portrait");
  const [margin, setMargin] = useState("18");
  const [gutter, setGutter] = useState("8");
  const [status, setStatus] = useState(initialStatus);

  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      N-up places several source pages on each sheet for handouts. Booklet reorders pages 2-up so the printout folds into a saddle-stitched booklet (pages are padded to a multiple of 4 with blanks). Source pages are scaled to fit each cell, preserving aspect ratio.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Select label="Mode" value={mode} onChange={setMode} options={["nup", "booklet"]} labels={["N-up (handout)", "Booklet (foldable)"]} />
    {mode === "nup" && <Select label="Pages per sheet" value={n} onChange={setN} options={NUP_COUNTS.map(String)} labels={NUP_COUNTS.map((count) => `${count}-up`)} />}
    <Select label="Sheet size" value={pageSize} onChange={setPageSize} options={["A4", "A3", "A5", "Letter", "Legal"]} labels={["A4", "A3", "A5", "US Letter", "US Legal"]} />
    {mode === "nup" && <Select label="Orientation" value={orientation} onChange={setOrientation} options={["portrait", "landscape"]} labels={["Portrait", "Landscape"]} />}
    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="Margin (pt)" value={margin} onChange={setMargin} type="number" />
      <Input label="Gutter (pt)" value={gutter} onChange={setGutter} type="number" helper="Space between cells." />
    </div>
    <PrimaryButton label={mode === "booklet" ? "Create booklet" : "Impose N-up"} onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const { bytes, sheets, outputPages } = await imposePdf(file, {
        mode, n: Number(n), pageSize, orientation, margin: Number(margin), gutter: Number(gutter),
        onProgress: pageProgress(setStatus, "Imposing"),
      });
      const suffix = mode === "booklet" ? "booklet" : `${n}up`;
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-${suffix}`, "pdf"), "application/pdf");
      return mode === "booklet"
        ? `Built a booklet: ${outputPages} printable side${outputPages === 1 ? "" : "s"} across ${sheets} sheet${sheets === 1 ? "" : "s"}.`
        : `Placed ${n} pages per sheet across ${sheets} sheet${sheets === 1 ? "" : "s"}.`;
    })} />
  </ToolForm>;
}

function BookmarksEditorTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [entries, setEntries] = useState("");
  const [existing, setExisting] = useState<Array<{ title: string; page: number | null; level: number }> | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => { setFiles([]); setEntries(""); setExisting(null); setStatus(initialStatus); };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Replaces the PDF's outline (table of contents). Enter one entry per line as <span className="font-mono">Title | pageNumber</span>. Indent a line with a space or tab to nest it one level under the entry above. Titles support Latin-1 and beyond (stored as Unicode).
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={(next) => { setFiles(next); setExisting(null); }} />
    <SecondaryButton label="Read current outline" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const found = await readOutline(file);
      setExisting(found);
      if (found.length) {
        setEntries(found.map((entry) => `${entry.level === 1 ? "  " : ""}${entry.title} | ${entry.page ?? 1}`).join("\n"));
      }
      return found.length ? `Found ${found.length} outline entr${found.length === 1 ? "y" : "ies"} (loaded into the editor below).` : "This PDF has no outline yet. Add entries below.";
    })} />
    {existing && existing.length > 0 && (
      <div className="surface-muted wabi-card-edge grid gap-1 p-4 text-sm font-semibold text-neutral-600">
        <p className="text-xs font-bold uppercase text-neutral-500">Current outline</p>
        {existing.map((entry, index) => <p key={index} className="break-words text-[var(--foreground)]">{entry.level === 1 ? "— " : ""}{entry.title || "(untitled)"} · page {entry.page ?? "?"}</p>)}
      </div>
    )}
    <Textarea label="Outline entries" value={entries} onChange={setEntries} rows={10} />
    <PrimaryButton label="Write outline" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const pdf = await loadPdf(file);
      const parsed = parseOutlineInput(entries, pdf.getPageCount());
      const { bytes, topLevel, total } = await setOutline(file, parsed);
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-bookmarks`, "pdf"), "application/pdf");
      return `Wrote ${total} outline entr${total === 1 ? "y" : "ies"} (${topLevel} top-level).`;
    })} />
  </ToolForm>;
}

type FormFieldDraft = { id: number; type: "text" | "checkbox" | "dropdown" | "radio"; name: string; page: string; x: string; y: string; w: string; h: string; options: string };

function CreateFormTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [useBlank, setUseBlank] = useState(false);
  const [pageSize, setPageSize] = useState("A4");
  const [pageCount, setPageCount] = useState("1");
  const [nextId, setNextId] = useState(2);
  const [fields, setFields] = useState<FormFieldDraft[]>([{ id: 1, type: "text", name: "full_name", page: "1", x: "10", y: "10", w: "50", h: "5", options: "" }]);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => { setFiles([]); setUseBlank(false); setPageSize("A4"); setPageCount("1"); setFields([{ id: 1, type: "text", name: "full_name", page: "1", x: "10", y: "10", w: "50", h: "5", options: "" }]); setNextId(2); setStatus(initialStatus); };
  const addField = () => { setFields((prev) => [...prev, { id: nextId, type: "text", name: `field_${nextId}`, page: "1", x: "10", y: "20", w: "50", h: "5", options: "" }]); setNextId((id) => id + 1); };
  const updateField = (id: number, patch: Partial<FormFieldDraft>) => setFields((prev) => prev.map((field) => field.id === id ? { ...field, ...patch } : field));
  const removeField = (id: number) => setFields((prev) => prev.filter((field) => field.id !== id));

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Designs a fillable form. Add fields onto an uploaded PDF or a blank page. Positions are in percent of the page, measured from the top-left corner. The result is a real AcroForm you can fill in any reader or with the Fill PDF Form tool.
    </div>
    <Checkbox label="Start from a blank page instead of a PDF" checked={useBlank} onChange={setUseBlank} />
    {useBlank ? (
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Page size" value={pageSize} onChange={setPageSize} options={["A4", "A3", "A5", "Letter", "Legal"]} labels={["A4", "A3", "A5", "US Letter", "US Legal"]} />
        <Input label="Page count" value={pageCount} onChange={setPageCount} type="number" helper="1 to 200 pages." />
      </div>
    ) : (
      <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    )}
    <div className="grid gap-4">
      {fields.map((field) => (
        <div key={field.id} className="surface-card grid gap-3 rounded-2xl p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase text-neutral-500">Field</span>
            {fields.length > 1 && <button type="button" className="secondary-button" onClick={() => removeField(field.id)}>Remove</button>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Type" value={field.type} onChange={(value) => updateField(field.id, { type: value as FormFieldDraft["type"] })} options={["text", "checkbox", "dropdown", "radio"]} labels={["Text field", "Checkbox", "Dropdown", "Radio group"]} />
            <Input label="Name" value={field.name} onChange={(value) => updateField(field.id, { name: value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-5">
            <Input label="Page" value={field.page} onChange={(value) => updateField(field.id, { page: value })} type="number" />
            <Input label="X %" value={field.x} onChange={(value) => updateField(field.id, { x: value })} type="number" />
            <Input label="Y %" value={field.y} onChange={(value) => updateField(field.id, { y: value })} type="number" />
            <Input label="W %" value={field.w} onChange={(value) => updateField(field.id, { w: value })} type="number" />
            <Input label="H %" value={field.h} onChange={(value) => updateField(field.id, { h: value })} type="number" />
          </div>
          {(field.type === "dropdown" || field.type === "radio") && (
            <Input label="Options (comma-separated)" value={field.options} onChange={(value) => updateField(field.id, { options: value })} placeholder="e.g. Red, Green, Blue" />
          )}
        </div>
      ))}
      <SecondaryButton label="Add field" onClick={addField} />
    </div>
    <PrimaryButton label="Create form PDF" onClick={() => runSafely(setStatus, async () => {
      const source = useBlank ? null : validateFiles(files, tool.file)[0];
      const payload = fields.map((field) => ({
        type: field.type,
        name: field.name.trim(),
        page: Number(field.page),
        x: Number(field.x), y: Number(field.y), w: Number(field.w), h: Number(field.h),
        unit: "percent" as const,
        options: field.options.split(",").map((option) => option.trim()).filter(Boolean),
      }));
      const { bytes, fieldCount } = await createFormPdf(source, payload, { pageSize, pageCount: Number(pageCount), orientation: "portrait" });
      const base = source ? `${safeFilename(source.name)}-form` : "myfilekit-form";
      downloadBytes(bytes, withExtension(base, "pdf"), "application/pdf");
      return `Created a fillable form with ${fieldCount} field${fieldCount === 1 ? "" : "s"}.`;
    })} />
  </ToolForm>;
}

// =============================================================================
// Phase 2: Compare / Deskew / PDF-A prep — browser (canvas + pdf.js) helpers.
// The pure logic (text diff, skew estimator, archival hygiene) lives in
// pdf-review.service.js and is unit-tested; only the rendering is here.
// =============================================================================

const VISUAL_DIFF_THRESHOLD = 40; // luma delta that counts a pixel as "changed"

/** Turn into an images `src` onto a fresh w×h white canvas and returns its pixel data. */
function rasterOnWhite(src: HTMLCanvasElement, w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not create a 2D canvas.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0);
  return ctx.getImageData(0, 0, w, h).data;
}

/**
 * Renders the given pages of both PDFs at a common scale, computes a per-pixel
 * luma difference, and paints a composite per page: a faded grey rendering of
 * the revised page with every changed pixel tinted in a strong highlight so the
 * reader sees WHERE it changed. Browser-only (canvas + pdf.js).
 */
async function buildVisualDiffs(
  fileA: File,
  fileB: File,
  pages: number[],
  onProgress?: (done: number, total: number) => void
) {
  const { loadPdfDocument, renderPdfPageToCanvas } = await import("../lib/pdfjs");
  const pdfA = await loadPdfDocument(fileA);
  const pdfB = await loadPdfDocument(fileB);
  const scale = 100 / 72; // ~100 dpi keeps the composite legible but bounded.
  const results: Array<{ page: number; blob: Blob; changedPixels: number }> = [];
  try {
    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i];
      const canvasA = await renderPdfPageToCanvas(pdfA, page, scale);
      const canvasB = await renderPdfPageToCanvas(pdfB, page, scale);
      const w = Math.max(canvasA.width, canvasB.width);
      const h = Math.max(canvasA.height, canvasB.height);
      const dataA = rasterOnWhite(canvasA, w, h);
      const dataB = rasterOnWhite(canvasB, w, h);

      const out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      const octx = out.getContext("2d");
      if (!octx) throw new Error("This browser could not create a 2D canvas.");
      const composite = octx.createImageData(w, h);
      const pixels = composite.data;
      let changedPixels = 0;
      for (let p = 0; p < w * h; p += 1) {
        const idx = p * 4;
        const lumaA = dataA[idx] * 0.299 + dataA[idx + 1] * 0.587 + dataA[idx + 2] * 0.114;
        const lumaB = dataB[idx] * 0.299 + dataB[idx + 1] * 0.587 + dataB[idx + 2] * 0.114;
        if (Math.abs(lumaA - lumaB) > VISUAL_DIFF_THRESHOLD) {
          pixels[idx] = 224; pixels[idx + 1] = 32; pixels[idx + 2] = 32; pixels[idx + 3] = 255;
          changedPixels += 1;
        } else {
          // Faded grey base from the revised page so the tint stands out.
          const grey = Math.round(255 - (255 - lumaB) * 0.35);
          pixels[idx] = grey; pixels[idx + 1] = grey; pixels[idx + 2] = grey; pixels[idx + 3] = 255;
        }
      }
      octx.putImageData(composite, 0, 0);
      results.push({ page, blob: await canvasToBlob(out, "image/png"), changedPixels });
      canvasA.width = 0; canvasA.height = 0;
      canvasB.width = 0; canvasB.height = 0;
      out.width = 0; out.height = 0;
      onProgress?.(i + 1, pages.length);
    }
    return results;
  } finally {
    await pdfA.destroy();
    await pdfB.destroy();
  }
}

/** Downscales a rendered page canvas to a darkness matrix for skew estimation. */
function canvasToDarkness(canvas: HTMLCanvasElement, maxDim: number) {
  const factor = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * factor));
  const h = Math.max(1, Math.round(canvas.height * factor));
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  const ctx = small.getContext("2d");
  if (!ctx) throw new Error("This browser could not create a 2D canvas.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(canvas, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p += 1) {
    const idx = p * 4;
    const luma = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
    gray[p] = 255 - Math.round(luma);
  }
  small.width = 0;
  small.height = 0;
  return { gray, w, h };
}

/**
 * Turn into an images each page, estimates (or applies an override) skew angle, rotates
 * the page image to straighten it, and rebuilds an image-based PDF. Output pages
 * are images, so text is no longer selectable. Browser-only.
 */
async function deskewPdf(
  file: File,
  { dpi = 150, overrideAngle, onProgress }: { dpi?: number; overrideAngle?: number | null; onProgress?: (page: number, total: number) => void }
) {
  const { PDFDocument } = getPdfLib();
  const { loadPdfDocument, renderPdfPageToCanvas } = await import("../lib/pdfjs");
  const scale = Math.max(0.1, dpi / 72);
  const pdf = await loadPdfDocument(file);
  const out = await PDFDocument.create();
  const angles: number[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const canvas = await renderPdfPageToCanvas(pdf, n, scale);
      let angle = overrideAngle ?? null;
      if (angle === null) {
        const { gray, w, h } = canvasToDarkness(canvas, 700);
        angle = estimateSkewAngle(gray, w, h);
      }
      angles.push(angle);

      const rad = (-angle * Math.PI) / 180; // rotate by -skew to straighten
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const nw = Math.ceil(canvas.width * cos + canvas.height * sin);
      const nh = Math.ceil(canvas.width * sin + canvas.height * cos);
      const rc = document.createElement("canvas");
      rc.width = nw;
      rc.height = nh;
      const rctx = rc.getContext("2d");
      if (!rctx) throw new Error("This browser could not create a 2D canvas.");
      rctx.fillStyle = "#ffffff";
      rctx.fillRect(0, 0, nw, nh);
      rctx.translate(nw / 2, nh / 2);
      rctx.rotate(rad);
      rctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);

      const blob = await canvasToBlob(rc, "image/png");
      const embedded = await out.embedPng(new Uint8Array(await blob.arrayBuffer()));
      const pw = nw / scale;
      const ph = nh / scale;
      const page = out.addPage([pw, ph]);
      page.drawImage(embedded, { x: 0, y: 0, width: pw, height: ph });

      canvas.width = 0; canvas.height = 0;
      rc.width = 0; rc.height = 0;
      onProgress?.(n, pdf.numPages);
    }
    return { bytes: await out.save({ useObjectStreams: true }), angles };
  } finally {
    await pdf.destroy();
  }
}

function ComparePdfTool({ tool }: { tool: Tool }) {
  const [filesA, setFilesA] = useState<File[]>([]);
  const [filesB, setFilesB] = useState<File[]>([]);
  const [result, setResult] = useState<ReturnType<typeof comparePdfText> | null>(null);
  const [reportText, setReportText] = useState("");
  const [diffs, setDiffs] = useState<Array<{ page: number; url: string; blob: Blob; changedPixels: number }>>([]);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => () => { diffs.forEach((diff) => revokeDownloadUrl(diff.url)); }, [diffs]);

  const reset = () => {
    diffs.forEach((diff) => revokeDownloadUrl(diff.url));
    setDiffs([]);
    setFilesA([]);
    setFilesB([]);
    setResult(null);
    setReportText("");
    setStatus(initialStatus);
  };

  const singleFile = { ...tool.file, maxFiles: 1 };

  const changedPages = result ? result.pages.filter((entry) => entry.status === "changed") : [];

  return (
    <div className="tool-form-grid">
      <div className="tool-form-actions">
        <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
          Compares two PDFs. The text diff shows added, removed, and changed lines per page from the selectable text; the visual diff renders each differing page and tints the pixels that changed. Pages with no extractable text (scanned) fall back to the visual diff only. Everything runs in this browser.
        </div>
        <FileControl accept="application/pdf" files={filesA} setFiles={setFilesA} label="File A — original" />
        <FileControl accept="application/pdf" files={filesB} setFiles={setFilesB} label="File B — revised" />
        <PrimaryButton label="Compare PDFs" onClick={() => runSafely(setStatus, async () => {
          diffs.forEach((diff) => revokeDownloadUrl(diff.url));
          setDiffs([]);
          setResult(null);
          setReportText("");
          const fileA = validateFiles(filesA, singleFile)[0];
          const fileB = validateFiles(filesB, singleFile)[0];

          const pagesA: string[] = [];
          const pagesB: string[] = [];
          await extractPdfText(fileA, {
            onPage: (n: number, text: string) => { pagesA[n - 1] = text; },
            onProgress: (page: number, total: number) => setStatus({ tone: "idle", message: `Reading A — page ${page} of ${total}…`, progress: { value: page, total, label: "Reading A…" } }),
          });
          await extractPdfText(fileB, {
            onPage: (n: number, text: string) => { pagesB[n - 1] = text; },
            onProgress: (page: number, total: number) => setStatus({ tone: "idle", message: `Reading B — page ${page} of ${total}…`, progress: { value: page, total, label: "Reading B…" } }),
          });

          const compareResult = comparePdfText(pagesA, pagesB);
          setResult(compareResult);
          setReportText(comparePdfReportText(compareResult, { nameA: fileA.name, nameB: fileB.name }));

          if (compareResult.identical) {
            return "No differences found. The extracted text of both documents is identical page for page.";
          }

          // Visual diff for pages present in both that differ or are text-less.
          const visualPages = compareResult.pages
            .filter((entry) => entry.status === "changed" || entry.status === "textless")
            .map((entry) => entry.page)
            .filter((page) => page <= compareResult.pageCountA && page <= compareResult.pageCountB);

          if (visualPages.length) {
            const built = await buildVisualDiffs(fileA, fileB, visualPages, (done, total) =>
              setStatus({ tone: "idle", message: `Rendering visual diff — page ${done} of ${total}…`, progress: { value: done, total, label: "Visual diff…" } })
            );
            setDiffs(built.map((diff) => ({ page: diff.page, blob: diff.blob, changedPixels: diff.changedPixels, url: URL.createObjectURL(diff.blob) })));
          }

          const parts = [`${compareResult.totals.changedPages} page(s) differ`, `+${compareResult.totals.added} / -${compareResult.totals.removed} line(s)`];
          if (compareResult.addedPages.length) parts.push(`extra pages in B: ${compareResult.addedPages.join(", ")}`);
          if (compareResult.removedPages.length) parts.push(`missing from B: ${compareResult.removedPages.join(", ")}`);
          if (compareResult.textlessPages.length) parts.push(`text-less (visual only): ${compareResult.textlessPages.join(", ")}`);
          return parts.join(" · ") + ".";
        })} />

        {result && !result.identical && (
          <>
            <div className="surface-card wabi-card-edge grid gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-black">Text diff</p>
                <p className="text-xs font-bold uppercase text-neutral-500">A: {result.pageCountA}p · B: {result.pageCountB}p</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <SecondaryButton label="Download .txt report" onClick={() => {
                  if (!reportText) throw new Error("Compare two PDFs first.");
                  downloadText(reportText, "myfilekit-pdf-comparison", "txt");
                }} />
              </div>
              {result.addedPages.length > 0 && <p className="text-sm font-semibold text-neutral-600">Pages only in B (extra): {result.addedPages.join(", ")}.</p>}
              {result.removedPages.length > 0 && <p className="text-sm font-semibold text-neutral-600">Pages only in A (missing from B): {result.removedPages.join(", ")}.</p>}
              {result.textlessPages.length > 0 && <p className="text-sm font-semibold text-neutral-600">Pages with no extractable text — compare visually: {result.textlessPages.join(", ")}.</p>}
              {changedPages.length > 0 ? (
                <div className="grid gap-3">
                  {changedPages.map((entry) => (
                    <div key={entry.page} className="surface-muted wabi-card-edge grid gap-2 p-3">
                      <p className="text-sm font-bold text-[var(--foreground)]">Page {entry.page} — +{entry.added} / -{entry.removed} line(s)</p>
                      <pre className="max-h-64 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--paper-soft)] px-3 py-2 text-xs leading-5 whitespace-pre-wrap break-words">
                        {entry.rows
                          .filter((row) => row.type !== "same")
                          .slice(0, 60)
                          .map((row, index) => (
                            <div key={index} className={row.type === "added" ? "text-[var(--success-fg)]" : "text-[var(--danger-fg)]"}>
                              {row.type === "added" ? `+ ${row.right}` : `- ${row.left}`}
                            </div>
                          ))}
                        {entry.rows.filter((row) => row.type !== "same").length > 60 ? <div className="text-neutral-500">… more in the .txt report</div> : null}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm font-semibold text-neutral-500">No line-level text differences — the pages that differ are text-less or exist on only one side. See the visual diff below.</p>
              )}
            </div>

            {diffs.length > 0 && (
              <div className="surface-card wabi-card-edge grid gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-black">Visual diff</p>
                  <SecondaryButton label={diffs.length === 1 ? "Download image" : "Download all (zip)"} onClick={async () => {
                    if (diffs.length === 1) {
                      downloadBlob(diffs[0].blob, `myfilekit-visual-diff-page-${diffs[0].page}.png`);
                      return;
                    }
                    const entries: Record<string, Uint8Array> = {};
                    const width = String(Math.max(...diffs.map((diff) => diff.page))).length;
                    for (const diff of diffs) {
                      entries[`visual-diff-page-${String(diff.page).padStart(width, "0")}.png`] = new Uint8Array(await diff.blob.arrayBuffer());
                    }
                    const zipped = zipSync(entries, { level: 0 });
                    const buffer = new ArrayBuffer(zipped.byteLength);
                    new Uint8Array(buffer).set(zipped);
                    downloadBlob(new Blob([buffer], { type: "application/zip" }), "myfilekit-visual-diff.zip");
                  }} />
                </div>
                <p className="text-sm font-semibold text-neutral-500">Changed regions are tinted red over a faded grey copy of the revised page.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {diffs.map((diff) => (
                    <figure key={diff.page} className="grid gap-2">
                      <img src={diff.url} alt={`Visual diff of page ${diff.page}`} className="w-full rounded-xl border border-[var(--border)]" loading="lazy" />
                      <figcaption className="text-xs font-bold text-neutral-500">Page {diff.page} · {diff.changedPixels.toLocaleString()} changed pixel(s)</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <ToolMetaPanel status={status} onReset={reset} />
    </div>
  );
}

function DeskewPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [overrideAngle, setOverrideAngle] = useState("");
  const [status, setStatus] = useState(initialStatus);

  return <ToolForm status={status} onReset={() => { setFiles([]); setOverrideAngle(""); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Auto-straightens skewed scans. Each page is turned into an image, its skew angle is estimated with a projection-profile method (the angle that lines the text rows up into the sharpest horizontal profile), and the page is rotated to correct it. Because it works on rendered pages, the output pages become images — text is no longer selectable. Leave the override blank to auto-detect per page.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Input label="Override angle (degrees)" value={overrideAngle} onChange={setOverrideAngle} placeholder="Auto-detect" helper="Optional. Positive rotates one way, negative the other. Blank = detect each page (-10° to +10°)." />
    <PrimaryButton label="Deskew PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      let override: number | null = null;
      if (overrideAngle.trim()) {
        override = Number(overrideAngle);
        if (!Number.isFinite(override)) throw new Error("Override angle must be a number, or blank to auto-detect.");
        if (override < -45 || override > 45) throw new Error("Override angle must be between -45 and 45 degrees.");
      }
      const { bytes, angles } = await deskewPdf(file, { overrideAngle: override, onProgress: pageProgress(setStatus, "Straightening") });
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-deskewed`, "pdf"), "application/pdf");
      const shown = angles.slice(0, 12).map((angle) => `${angle > 0 ? "+" : ""}${angle}°`).join(", ");
      const suffix = angles.length > 12 ? ", …" : "";
      return override === null
        ? `Straightened ${angles.length} page(s). Detected skew: ${shown}${suffix}. Output pages are images (text not selectable).`
        : `Straightened ${angles.length} page(s) by ${override > 0 ? "+" : ""}${override}°. Output pages are images (text not selectable).`;
    })} />
  </ToolForm>;
}

function PdfaPrepTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [raster, setRaster] = useState(false);
  const [ocrLayer, setOcrLayer] = useState(false);
  const [ocrLang, setOcrLang] = useState(DEFAULT_OCR_LANG);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [lang, setLang] = useState("en");
  const [report, setReport] = useState<{ applied: string[]; removed: string[]; conformance: string } | null>(null);
  const [compliance, setCompliance] = useState<{ target: string; criteria: { id: string; label: string; pass: boolean; detail: string }[]; passed: number; total: number; certified: boolean; notChecked: string[]; caveat: string } | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => { setFiles([]); setRaster(false); setOcrLayer(false); setOcrLang(DEFAULT_OCR_LANG); setTitle(""); setAuthor(""); setLang("en"); setReport(null); setCompliance(null); setStatus(initialStatus); };

  return <ToolForm status={status} onReset={reset}>
    <p className="tool-lead">Prepare a PDF for long-term archiving.</p>
    <ToolNotes summary="What this does, and what it cannot promise">
      <li>Embeds the colour profile and the archival identifier the format needs.</li>
      <li>Sets the document title and language, and removes scripts and auto-run actions.</li>
      <li>This is <strong>not</strong> a certified conformance check. Before relying on it for legal compliance, validate the result with a formal tool.</li>
    </ToolNotes>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Checkbox label="Turn every page into an image (guaranteed self-contained)" checked={raster} onChange={setRaster} />
    {raster && (
      <div className="surface-muted wabi-card-edge grid gap-3 p-4 text-sm font-semibold leading-6 text-neutral-600">
        <p>Turning pages into images guarantees no font can go missing, but the text stops being selectable.</p>
        <Checkbox label="Add a searchable OCR text layer (self-contained AND searchable)" checked={ocrLayer} onChange={setOcrLayer} />
        {ocrLayer && (
          <>
            <p>Reads the text back and layers it invisibly over the image, so the file stays searchable. First run downloads {OCR_ENGINE_SIZE_LABEL} of language data.</p>
            <Select label="OCR language" value={ocrLang} onChange={setOcrLang} options={OCR_LANGUAGES.map((entry) => entry.code)} labels={OCR_LANGUAGES.map((entry) => entry.label)} />
          </>
        )}
      </div>
    )}
    <div className="grid gap-3 sm:grid-cols-3">
      <Input label="Title (optional)" value={title} onChange={setTitle} placeholder="Document title" />
      <Input label="Author (optional)" value={author} onChange={setAuthor} placeholder="Author" />
      <Input label="Language (BCP-47)" value={lang} onChange={setLang} placeholder="en" />
    </div>
    <PrimaryButton label="Prepare for archiving" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const originalBytes = new Uint8Array(await file.arrayBuffer());
      const docTitle = title.trim() || safeFilename(file.name);
      const docLang = lang.trim() || "en";
      let source: Uint8Array = originalBytes;
      let ocrApplied = false;
      if (raster) {
        // Refuse encrypted originals with a clear message before rasterising.
        await assertPdfDecryptable(originalBytes);
        if (ocrLayer) {
          // OCR turns pages into images internally and returns a searchable image PDF (page
          // image + invisible text layer). Feed those bytes to archival prep.
          const ocr = await ocrPdf(file, {
            lang: ocrLang,
            searchablePdf: true,
            onRender: pageProgress(setStatus, "Rasterising"),
            onStage: (page: number, total: number, stage: string) => setStatus({ tone: "idle", message: `OCR page ${page} of ${total}: ${stage}`, progress: { value: page, total, label: "OCR…" } }),
          });
          if (!ocr.bytes) throw new Error("OCR did not produce a searchable PDF for every page.");
          source = ocr.bytes;
          ocrApplied = true;
        } else {
          source = await rasterRebuild(file, { format: "png", onProgress: pageProgress(setStatus, "Rasterising") });
        }
      }
      const { bytes, report: prepReport } = await archivalPrepPdf(source, { title: docTitle, author: author.trim(), lang: docLang });
      if (raster) prepReport.removed.unshift(ocrApplied ? "turned into an image all pages, then added a searchable OCR text layer" : "turned into an image all pages (text no longer selectable)");
      if (ocrApplied) prepReport.applied.push("searchable OCR text layer over the raster (invisible, selectable)");
      setReport(prepReport);
      // Re-run the self-check on the produced bytes so the user sees exactly
      // which machine-checkable PDF/A criteria the output now satisfies.
      setCompliance(await checkPdfACompliance(bytes));
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-archival`, "pdf"), "application/pdf");
      return `Prepped for archiving (${prepReport.conformance}). Applied ${prepReport.applied.length} change(s); removed ${prepReport.removed.length} item(s). Aims for PDF/A-2b — run veraPDF to certify.`;
    })} />

    <SecondaryButton label="Check PDF/A compliance (no conversion)" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const bytes = new Uint8Array(await file.arrayBuffer());
      setReport(null);
      const result = await checkPdfACompliance(bytes);
      setCompliance(result);
      const failed = result.criteria.filter((c) => !c.pass).length;
      return failed === 0
        ? `${result.passed} of ${result.total} machine-checkable ${result.target} criteria pass. Not a veraPDF certification.`
        : `${result.passed} of ${result.total} ${result.target} criteria pass; ${failed} need work. See the breakdown below.`;
    })} />

    {compliance && (
      <div className="surface-card wabi-card-edge grid gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-black">Pre-flight check — {compliance.target}</p>
          <p className="text-sm font-bold text-neutral-500">{compliance.passed} of {compliance.total} machine-checkable criteria pass</p>
        </div>
        <div className="grid gap-2">
          {compliance.criteria.map((c) => (
            <div key={c.id} className="surface-muted wabi-card-edge grid gap-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase ${c.pass ? "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success-fg)]" : "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger-fg)]"}`}>{c.pass ? "PASS" : "FAIL"}</span>
                <span className="font-black text-[var(--foreground)]">{c.label}</span>
              </div>
              <p className="text-sm font-semibold leading-6 text-neutral-600">{c.detail}</p>
            </div>
          ))}
        </div>
        {compliance.notChecked?.length ? (
          <div className="grid gap-1 text-sm font-semibold text-neutral-600">
            <p className="text-xs font-bold uppercase text-neutral-500">Not checked here (needs veraPDF / a human)</p>
            {compliance.notChecked.map((item, index) => <p key={index}>• {item}</p>)}
          </div>
        ) : null}
        <p className="text-sm font-semibold leading-6 text-neutral-500">{compliance.caveat}</p>
      </div>
    )}

    {report && (
      <div className="surface-card wabi-card-edge grid gap-3 p-4">
        <p className="font-black">What was done — {report.conformance}</p>
        <div className="grid gap-1 text-sm font-semibold text-neutral-600">
          <p className="text-xs font-bold uppercase text-neutral-500">Applied</p>
          {report.applied.map((item, index) => <p key={index} className="text-[var(--foreground)]">• {item}</p>)}
        </div>
        <div className="grid gap-1 text-sm font-semibold text-neutral-600">
          <p className="text-xs font-bold uppercase text-neutral-500">Removed</p>
          {report.removed.length ? report.removed.map((item, index) => <p key={index} className="text-[var(--foreground)]">• {item}</p>) : <p>Nothing forbidden was found to remove.</p>}
        </div>
        <p className="text-sm font-semibold text-neutral-500">Not guaranteed: font embedding, colour-space coverage for every object, transparency flattening, and a validation pass. Verify with a PDF/A validator (e.g. veraPDF) if certification matters.</p>
      </div>
    )}
  </ToolForm>;
}

// --- Accessibility: Check + Auto-Tag -----------------------------------------
// The check audits machine-verifiable PDF/UA + WCAG basics from the object model
// (via the accessibility service) plus a pdf.js text-layer count. Auto-Tag sets
// language/title/marked/viewer-preferences and builds a basic real tagged
// structure tree with alt text. Neither claims certified PDF/UA conformance.

type A11yStatus = "pass" | "warn" | "fail" | "info";
type A11yCheck = { id: string; label: string; status: A11yStatus; detail: string; fix?: string; note?: string };
type A11yReport = {
  checks: A11yCheck[];
  summary: { pass: number; warn: number; fail: number; info: number };
  conformance?: { passed: number; applicable: number; summary: string; caveat: string };
  verdict: { level: "pass" | "warn" | "fail"; headline: string; summary: string };
  stats: Record<string, any>;
};
type A11yFigure = { page: number; id: string; alt: string; decorative: boolean };
type A11yAnalysis = { textBlocks: any[]; figures: A11yFigure[]; links?: any[]; textLayer: { characters: number; pageCount: number; text?: string }; pageCount: number };

function a11yStatusTone(status: A11yStatus) {
  if (status === "fail") return "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger-fg)]";
  if (status === "warn") return "border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning-fg)]";
  if (status === "pass") return "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success-fg)]";
  return "border-[var(--line)] bg-[var(--paper-soft)] text-[var(--stone)]";
}

function A11yStatusTag({ status }: { status: A11yStatus }) {
  const label = status === "pass" ? "PASS" : status === "warn" ? "WARN" : status === "fail" ? "FAIL" : "INFO";
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase ${a11yStatusTone(status)}`}>{label}</span>;
}

function A11yCheckList({ checks }: { checks: A11yCheck[] }) {
  return (
    <div className="grid gap-2">
      {checks.map((check) => (
        <div key={check.id} className="surface-muted wabi-card-edge grid gap-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <A11yStatusTag status={check.status} />
            <span className="font-black text-[var(--foreground)]">{check.label}</span>
          </div>
          <p className="text-sm font-semibold leading-6 text-neutral-600">{check.detail}</p>
          {check.fix ? <p className="text-sm font-semibold leading-6 text-[var(--foreground)]">Fix: {check.fix}</p> : null}
          {check.note ? <p className="text-xs font-semibold text-neutral-500">Note: {check.note}</p> : null}
        </div>
      ))}
    </div>
  );
}

function AccessibilityCheckTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<A11yReport | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => { setFiles([]); setReport(null); setStatus(initialStatus); };

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    if (!files.length) return undefined;
    runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const bytes = new Uint8Array(await file.arrayBuffer());
      // The extractable-text check needs the pdf.js text layer (browser-only).
      const { textLayer } = await extractAccessibilityContent(file, (page: number, total: number) =>
        setStatus({ tone: "idle", message: `Reading ${file.name} — page ${page} of ${total}…`, progress: { value: page, total, label: "Reading text layer…" } }));
      const result = (await auditPdfAccessibility(bytes, { textLayer })) as A11yReport;
      if (cancelled) return "Ready.";
      setReport(result);
      return `${result.verdict.headline}. ${result.summary.fail} fail, ${result.summary.warn} warn, ${result.summary.pass} pass. Automated check only — a manual audit is still required.`;
    });
    return () => { cancelled = true; };
  }, [files, tool.file]);

  const reportText = useMemo(() => (report && files.length ? buildAccessibilityReportText(report, { fileName: files[0].name }) : ""), [report, files]);

  return (
    <ToolForm status={status} onReset={reset}>
      <p className="tool-lead">Check whether a PDF works for screen readers, and get a list of what to fix.</p>
      <ToolNotes summary="What this cannot check">
        <li>Whether an image's description actually describes it.</li>
        <li>Whether the reading order makes sense to a person.</li>
        <li>Colour contrast.</li>
        <li>These need a human. A formal audit needs a certified tool.</li>
      </ToolNotes>
      <FileControl accept="application/pdf" files={files} setFiles={setFiles} />

      {report && (
        <>
          <div className={`wabi-card-edge grid gap-2 rounded-2xl border p-4 ${verdictTone(report.verdict.level)}`}>
            <p className="text-xs font-bold uppercase tracking-wide">Accessibility verdict</p>
            <p className="text-lg font-black">{report.verdict.headline}</p>
            {/* The screen shows the count and the finding. The full
                not-certified caveat lives in the downloadable report and in the
                tool's own "What this cannot check" list — printing it a third
                time here was the redundancy. */}
            {report.conformance ? <p className="text-sm font-bold">{report.conformance.passed} of {report.conformance.applicable} automated checks pass</p> : null}
            <p className="text-sm font-semibold leading-6">{report.verdict.summary}</p>
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-black">Checks</p>
              <p className="text-xs font-bold uppercase text-neutral-500">{report.summary.pass}P · {report.summary.warn}W · {report.summary.fail}F</p>
            </div>
            <A11yCheckList checks={report.checks} />
            <div className="flex flex-wrap gap-2">
              <SecondaryButton label="Download .txt report" onClick={() => {
                if (!reportText) throw new Error("Check a file first.");
                downloadText(reportText, `${safeFilename(files[0].name)}-accessibility`, "txt");
              }} />
              <SecondaryButton label="Download .pdf report" onClick={async () => {
                if (!reportText) throw new Error("Check a file first.");
                try {
                  const bytes = await textToPdf(reportText);
                  downloadBytes(bytes, withExtension(`${safeFilename(files[0].name)}-accessibility`, "pdf"), "application/pdf");
                } catch {
                  throw new Error("The PDF report supports Latin-1 characters only. Download the .txt report instead.");
                }
              }} />
            </div>
            {!report.stats.tagged ? (
              <p className="text-sm font-semibold text-neutral-500">This document is not tagged. Use Make Accessible (Auto-Tag) to fix the machine-fixable basics, then re-check.</p>
            ) : null}
          </div>
        </>
      )}
    </ToolForm>
  );
}

function TagPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [analysis, setAnalysis] = useState<A11yAnalysis | null>(null);
  const [title, setTitle] = useState("");
  const [lang, setLang] = useState("en-US");
  const [figures, setFigures] = useState<A11yFigure[]>([]);
  const [before, setBefore] = useState<A11yReport | null>(null);
  const [after, setAfter] = useState<A11yReport | null>(null);
  const [remediation, setRemediation] = useState<{ applied: string[]; review: string[] } | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => {
    setFiles([]); setAnalysis(null); setTitle(""); setLang("en-US"); setFigures([]);
    setBefore(null); setAfter(null); setRemediation(null); setStatus(initialStatus);
  };

  useEffect(() => {
    let cancelled = false;
    setAnalysis(null); setBefore(null); setAfter(null); setRemediation(null);
    if (!files.length) return undefined;
    runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const content = (await extractAccessibilityContent(file, (page: number, total: number) =>
        setStatus({ tone: "idle", message: `Analysing ${file.name} — page ${page} of ${total}…`, progress: { value: page, total, label: "Analysing layout…" } }))) as A11yAnalysis;
      const audit = (await auditPdfAccessibility(bytes, { textLayer: content.textLayer })) as A11yReport;
      if (cancelled) return "Ready.";
      setAnalysis(content);
      setFigures(content.figures.map((figure) => ({ ...figure, alt: "", decorative: false })));
      setTitle(audit.stats.title || file.name.replace(/\.[^.]+$/, ""));
      if (audit.stats.lang) setLang(audit.stats.lang);
      setBefore(audit);
      const noText = content.textLayer.characters < 8;
      return noText
        ? `Analysed. Warning: almost no extractable text — if this is a scan, run OCR / Searchable PDF first. Found ${content.figures.length} image(s).`
        : `Analysed: ${content.textBlocks.length} text block(s), ${content.figures.length} image(s). Review the details below, then make the PDF accessible.`;
    });
    return () => { cancelled = true; };
  }, [files, tool.file]);

  const updateFigure = (index: number, patch: Partial<A11yFigure>) => {
    setFigures((current) => current.map((figure, i) => (i === index ? { ...figure, ...patch } : figure)));
  };

  const remediate = () => runSafely(setStatus, async () => {
    const [file] = validateFiles(files, tool.file);
    if (!analysis) throw new Error("Wait for analysis to finish before tagging.");
    if (!title.trim()) throw new Error("Enter a document title — assistive technology reads it aloud first.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { bytes: out, report } = await remediatePdfAccessibility(bytes, {
      lang,
      title: title.trim(),
      textBlocks: analysis.textBlocks,
      figures: figures.map((figure) => ({ page: figure.page, alt: figure.alt, decorative: figure.decorative })),
    });
    downloadBytes(out, withExtension(`${safeFilename(file.name)}-accessible`, "pdf"), "application/pdf");
    const remReport = report as { applied: string[]; review: string[] };
    setRemediation({ applied: remReport.applied, review: remReport.review });
    // Eval: re-check the OUTPUT so the before/after failure counts are visible.
    const recheck = (await auditPdfAccessibility(out, { textLayer: analysis.textLayer })) as A11yReport;
    setAfter(recheck);
    return `Made accessible. Set language, title, tagged structure, and alt text. Re-check: ${before ? before.summary.fail : "?"} → ${recheck.summary.fail} failing check(s). This is a strong automated start, not certified PDF/UA — review the reading order and alt text by hand.`;
  });

  return (
    <div className="tool-form-grid">
      <div className="tool-form-actions">
        <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
          Remediates a PDF toward PDF/UA as far as is reliably automatable: sets the document language, title, and window-bar title, marks it tagged, and builds a <strong>real</strong> structure tree in an invisible tagged text layer — headings (with level nesting), paragraphs, lists (/L·/LI·/Lbl·/LBody), data tables (/Table·/TR·/TH·/TD with header scope), links wired to their annotations (/Link·/OBJR), alt text for images, and a role map. Repeated headers, footers, and page numbers are marked as artifacts so they are skipped. Table and list detection from a flat text layer is heuristic, and a perfect reading order and semantics for complex layouts still need a manual pass in a full authoring tool. This does <strong>not</strong> claim certified PDF/UA conformance.
        </div>
        <FileControl accept="application/pdf" files={files} setFiles={setFiles} />

        {analysis && (
          <>
            <Input label="Document title" value={title} onChange={setTitle} placeholder="e.g. Quarterly Report 2026" helper="Read aloud first by screen readers and shown in the window bar. Non-Latin titles are written as UTF-16BE and preserved." />
            <Select label="Document language" value={lang} onChange={setLang} options={LANGUAGE_OPTIONS.map((option) => option.code)} labels={LANGUAGE_OPTIONS.map((option) => `${option.label} (${option.code})`)} />

            <div className="surface-card wabi-card-edge grid gap-3 p-4">
              <p className="font-black">Images ({figures.length})</p>
              {figures.length ? (
                <>
                  <p className="text-sm font-semibold text-neutral-500">Type alt text that describes each image's meaning. Leave it blank and tick “decorative” for images that carry no information (they are marked as artifacts and skipped by screen readers).</p>
                  {figures.map((figure, index) => (
                    <div key={figure.id} className="surface-muted wabi-card-edge grid gap-2 p-3">
                      <p className="text-xs font-bold uppercase text-neutral-500">{figure.id}</p>
                      <Input label="Alt text" value={figure.alt} onChange={(value) => updateFigure(index, { alt: value, decorative: value.trim() ? false : figure.decorative })} placeholder="Describe the image" />
                      <Checkbox label="Decorative (no alt text needed)" checked={figure.decorative} onChange={(checked) => updateFigure(index, { decorative: checked, alt: checked ? "" : figure.alt })} />
                    </div>
                  ))}
                </>
              ) : (
                <p className="text-sm font-semibold text-neutral-500">No image XObjects were detected, so no alt text is needed.</p>
              )}
            </div>

            <PrimaryButton label="Make accessible" onClick={remediate} />
          </>
        )}
      </div>
      <ToolMetaPanel status={status} onReset={reset}>
        {before && (
          <div className="surface-card wabi-card-edge grid gap-2 p-4">
            <p className="text-xs font-bold uppercase text-neutral-500">{after ? "Before → after" : "Before (current)"}</p>
            <div className="flex flex-wrap items-center gap-3 text-sm font-bold">
              <span>Failing checks:</span>
              <span className="tabular-nums">{before.summary.fail}</span>
              {after ? <><span aria-hidden>→</span><span className="tabular-nums text-[var(--success-fg)]">{after.summary.fail}</span></> : null}
            </div>
            {after ? <p className="text-sm font-semibold text-neutral-600">Language, title, tagging, and reading order now pass. Remaining items are the ones a machine cannot settle.</p> : <p className="text-sm font-semibold text-neutral-500">Run the remediation to see the after count.</p>}
          </div>
        )}
        {remediation && (
          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <div className="grid gap-1 text-sm font-semibold text-neutral-600">
              <p className="text-xs font-bold uppercase text-neutral-500">What I set</p>
              {remediation.applied.map((item, index) => <p key={index} className="text-[var(--foreground)]">• {item}</p>)}
            </div>
            <div className="grid gap-1 text-sm font-semibold text-neutral-600">
              <p className="text-xs font-bold uppercase text-neutral-500">What still needs human review</p>
              {remediation.review.map((item, index) => <p key={index} className="text-[var(--foreground)]">• {item}</p>)}
            </div>
          </div>
        )}
      </ToolMetaPanel>
    </div>
  );
}

function HtmlToPdfTool() {
  const [html, setHtml] = useState("<h1>Hello from MyFileKit</h1>\n<p>Paste any HTML here. It renders locally in a sandboxed frame.</p>\n<ul><li>Scripts never run</li><li>Remote resources are blocked</li></ul>");
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [status, setStatus] = useState(initialStatus);
  // Strip scripts/handlers/remote refs before interpolation so safety does not
  // rest solely on the scriptless sandbox attribute (matches the Word/PPTX paths).
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}body{padding:24px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;line-height:1.5}img,table{max-width:100%}</style></head><body>${sanitizeHtmlForOffline(html)}</body></html>`;
  return <ToolForm status={status} onReset={() => { setHtml(""); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      HTML is rendered locally in a sandboxed frame with scripts disabled. Remote images, styles, and network requests are blocked, so no external content is fetched or executed.
    </div>
    <Textarea label="HTML" value={html} onChange={setHtml} rows={10} />
    <div className="grid gap-2">
      <span className="text-xs font-bold uppercase text-neutral-500">Local preview</span>
      <iframe
        ref={frameRef}
        title="Sandboxed HTML preview"
        sandbox="allow-same-origin"
        srcDoc={srcDoc}
        className="surface-card wabi-card-edge h-80 w-full rounded-3xl bg-white"
      />
    </div>
    <PrimaryButton label="Make PDF" onClick={() => runSafely(setStatus, async () => {
      if (!html.trim()) throw new Error("Paste some HTML first.");
      // Rendered OFF-SCREEN at a fixed page width, not captured from the preview
      // above. Capturing the preview meant the PDF followed the browser window:
      // the same input produced 3 pages (two of them blank) in a narrow window
      // and 1 page at 1280px, and reported "Done" every time. The helper next
      // door already lays out at a fixed 794px, which is A4 at 96dpi — Word,
      // Excel and eBook to PDF have always used it.
      const canvas = await renderHtmlToCanvas(html);
      downloadBytes(await canvasToPdf(canvas), "myfilekit-html.pdf", "application/pdf");
      return "PDF ready to save.";
    })} />
  </ToolForm>;
}

// Shared base styles for the offscreen document render (Word/Excel/eBook).
const OFFICE_RENDER_CSS = "html,body{margin:0}body{padding:36px;font-family:'Helvetica Neue',Arial,system-ui,sans-serif;color:#111;line-height:1.55;font-size:14px;background:#fff;-webkit-font-smoothing:antialiased}img{max-width:100%;height:auto}h1{font-size:26px;margin:0 0 12px}h2{font-size:20px;margin:24px 0 10px}h3{font-size:16px;margin:18px 0 8px}p{margin:0 0 10px}ul,ol{margin:0 0 10px 22px;padding:0}li{margin:2px 0}table{border-collapse:collapse;width:100%;margin:0 0 14px;font-size:12px}th,td{border:1px solid #c4c4c4;padding:5px 8px;text-align:left;vertical-align:top}th{background:#eef0f2;font-weight:700}section.sheet{margin:0 0 28px}.chapter-break{border:0;border-top:1px solid #ddd;margin:28px 0}.empty-sheet{color:#777;font-style:italic}";

// Render sanitized HTML in an offscreen, scriptless sandboxed iframe and capture
// it with html2canvas. The iframe is always removed, even on failure, so no
// render container leaks. Remote resources cannot load (no allow-scripts, plus
// the page CSP), and callers pass HTML already stripped of remote refs.
async function renderHtmlToCanvas(bodyHtml: string, { widthPx = 794, scale = 2 }: { widthPx?: number; scale?: number } = {}) {
  const html2canvas = getHtml2Canvas();
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;border:0;width:${widthPx}px;height:1200px`;
  document.body.appendChild(iframe);
  try {
    const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>${OFFICE_RENDER_CSS}</style></head><body>${bodyHtml}</body></html>`;
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
      iframe.srcdoc = srcDoc;
    });
    const doc = iframe.contentDocument;
    if (!doc?.body) throw new Error("Could not prepare the document for rendering.");
    await doc.fonts?.ready?.catch(() => {});
    // Collapse the frame BEFORE measuring. It is created 1200px tall so the
    // document has room to lay out, but the body then reports at least that
    // height — so a one-line document measured ~1200px and produced a second,
    // blank A4 page. Collapsing first means scrollHeight is the content's own
    // height, and the capture is exactly as tall as the content.
    iframe.style.height = "1px";
    void doc.body.offsetHeight;
    const height = Math.max(doc.body.scrollHeight, 1);
    iframe.style.height = `${height}px`;
    void doc.body.offsetHeight;
    return await html2canvas(doc.body, {
      backgroundColor: "#ffffff",
      scale,
      useCORS: false,
      logging: false,
      width: widthPx,
      height,
      windowWidth: widthPx,
      windowHeight: height,
    });
  } finally {
    iframe.remove();
  }
}

/**
 * Word to PDF, with two honestly-labelled paths.
 *
 * In the browser this can only RASTERISE the document — measured at 0
 * extractable characters, so the output is a picture of the page. The
 * conversion server runs LibreOffice and returns real text: the same document
 * came back with 88 selectable characters.
 *
 * The server is OFFERED, never assumed. Uploading someone's document is not a
 * default to be inherited from a build flag, and the product's central claim
 * only survives if the user is the one who decides.
 */
function WordToPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [server, setServer] = useState<{ available: boolean; office: boolean } | null>(null);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    let cancelled = false;
    serverCapabilities().then((probe) => { if (!cancelled) setServer(probe); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const canUseServer = Boolean(server?.available && server?.office);

  const convertLocally = () => runSafely(setStatus, async () => {
    const [file] = validateFiles(files, tool.file);
    setStatus({ tone: "idle", message: "Reading document…" });
    const html = sanitizeHtmlForOffline(await docxToHtml(file));
    setStatus({ tone: "idle", message: "Rendering PDF…" });
    const canvas = await renderHtmlToCanvas(html);
    downloadBytes(await canvasToPdf(canvas), withExtension(`${safeFilename(file.name)}`, "pdf"), "application/pdf");
    return "Converted here. The text in this PDF is part of the picture, so it cannot be selected or searched.";
  });

  const convertOnServer = () => runSafely(setStatus, async () => {
    const [file] = validateFiles(files, tool.file);
    setStatus({ tone: "idle", message: "Uploading and converting…" });
    const bytes = await convertOfficeOnServer(file);
    downloadBytes(bytes, withExtension(`${safeFilename(file.name)}`, "pdf"), "application/pdf");
    return "Converted on our server. The text is real and selectable. Your file was deleted when the request finished.";
  });

  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <p className="tool-lead">Turn a Word document into a PDF.</p>
    <FileControl accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" files={files} setFiles={setFiles} label="Choose or drop a Word file" />
    {canUseServer ? (
      <div className="convert-choice">
        <PrimaryButton label="Convert on our server" onClick={convertOnServer} />
        <p className="convert-choice-note">Real, selectable text. Your file is uploaded to our converter and deleted when the request finishes.</p>
        <SecondaryButton label="Convert here instead" onClick={convertLocally} />
        <p className="convert-choice-note">Nothing is uploaded, but the text becomes part of a picture — not selectable or searchable.</p>
      </div>
    ) : (
      <>
        <PrimaryButton label="Convert to PDF" onClick={convertLocally} />
        <ToolNotes summary="About the output">
          <li>Converting in the browser turns the text into a picture, so it cannot be selected or searched.</li>
          <li>Legacy .doc files need re-saving as .docx first.</li>
          {server && !server.available ? <li>Our converter, which produces real text, is unreachable right now.</li> : null}
        </ToolNotes>
      </>
    )}
  </ToolForm>;
}

function ExcelToPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Reads .xlsx, .xls, or .csv locally with SheetJS, lays every sheet out as a table, then renders those pages to the PDF. Wide sheets are scaled to fit the page width, so very large tables render smaller.
    </div>
    <div className="surface-card wabi-card-edge grid gap-2 border-[var(--warning)] p-4 text-sm font-semibold leading-6 text-neutral-600">
      <p className="text-xs font-bold uppercase text-[var(--warning)]">The output is a picture of your sheet, not selectable text</p>
      <p className="text-[var(--foreground)]">The table is laid out and then <strong>turned into an image</strong>, so the PDF contains images rather than text. It looks exactly like your spreadsheet, but nobody can select, copy, search, or extract the figures from it — and the file is much larger than a text PDF of the same data.</p>
      <p>If you need a ledger whose rows stay real, selectable text, paste the sheet's CSV into <a className="underline" href="#csv-to-pdf-tool">CSV to PDF</a> instead. To turn a turned into an image PDF back into searchable text afterwards, run <a className="underline" href="#ocr-pdf-tool">OCR / Searchable PDF</a>.</p>
    </div>
    <FileControl accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" files={files} setFiles={setFiles} label="Choose or drop a spreadsheet" />
    <PrimaryButton label="Download PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      setStatus({ tone: "idle", message: "Reading workbook…" });
      const sheets = await readWorkbookSheets(file);
      setStatus({ tone: "idle", message: `Rendering ${sheets.length} sheet${sheets.length === 1 ? "" : "s"}…` });
      const canvas = await renderHtmlToCanvas(sheetsToHtml(sheets));
      downloadBytes(await canvasToPdf(canvas), withExtension(`${safeFilename(file.name)}`, "pdf"), "application/pdf");
      return `Converted ${sheets.length} sheet${sheets.length === 1 ? "" : "s"} to PDF as a rendered image — the pages have no selectable text. For selectable rows, use CSV to PDF.`;
    })} />
  </ToolForm>;
}

function PowerpointToPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Best-effort .pptx conversion: slide text and images are extracted and positioned locally, one PDF page per slide. Complex layouts, charts, SmartArt, and animations are approximated. Legacy .ppt files aren't supported.
    </div>
    <FileControl accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" files={files} setFiles={setFiles} label="Choose or drop a PowerPoint file" />
    <PrimaryButton label="Download PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      setStatus({ tone: "idle", message: "Reading slides…" });
      const { slideWidthEmu, slideHeightEmu, slides } = await pptxToSlides(file);
      const widthPx = 960;
      const aspect = slideHeightEmu / slideWidthEmu;
      const canvases: HTMLCanvasElement[] = [];
      for (const slide of slides) {
        setStatus({ tone: "idle", message: `Rendering slide ${slide.index} of ${slides.length}…` });
        const html = sanitizeHtmlForOffline(slideToHtml(slide, widthPx, Math.round(widthPx * aspect)));
        canvases.push(await renderHtmlToCanvas(html, { widthPx, scale: 2 }));
      }
      downloadBytes(await canvasesToPdf(canvases), withExtension(`${safeFilename(file.name)}`, "pdf"), "application/pdf");
      return `Converted ${slides.length} slide${slides.length === 1 ? "" : "s"} to PDF.`;
    })} />
  </ToolForm>;
}

// Build one absolutely-positioned slide "canvas" div. Elements with an EMU box
// are placed by percentage; anything without geometry stacks in a fallback flow.
function slideToHtml(slide: { index: number; elements: any[] }, widthPx: number, heightPx: number) {
  const positioned: string[] = [];
  const flow: string[] = [];
  for (const element of slide.elements) {
    const inner = element.type === "image"
      ? `<img src="${element.dataUrl}" style="width:100%;height:100%;object-fit:contain"/>`
      : `<div style="font-size:${element.title ? 26 : 16}px;font-weight:${element.title ? 700 : 400};line-height:1.3">${element.paragraphs.map((p: any) => `<div style="margin:2px 0;padding-left:${p.level * 18}px">${p.level > 0 && p.text ? "• " : ""}${escapeText(p.text)}</div>`).join("")}</div>`;
    if (element.box) {
      positioned.push(`<div style="position:absolute;left:${(element.box.x * 100).toFixed(2)}%;top:${(element.box.y * 100).toFixed(2)}%;width:${(element.box.w * 100).toFixed(2)}%;height:${(element.box.h * 100).toFixed(2)}%;overflow:hidden">${inner}</div>`);
    } else {
      flow.push(`<div style="margin:6px 0">${inner}</div>`);
    }
  }
  return `<div style="position:relative;width:${widthPx}px;height:${heightPx}px;background:#fff;overflow:hidden;padding:0">${positioned.join("")}${flow.length ? `<div style="position:absolute;inset:24px">${flow.join("")}</div>` : ""}</div>`;
}

function escapeText(value: string) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function EbookToPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Converts an .epub eBook locally: chapters are read in spine order, referenced images are inlined, scripts and remote references are stripped for offline safety, then rendered to a paginated PDF.
    </div>
    <FileControl accept=".epub,application/epub+zip" files={files} setFiles={setFiles} label="Choose or drop an eBook (.epub)" />
    <PrimaryButton label="Convert to PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      setStatus({ tone: "idle", message: "Reading eBook…" });
      const html = await epubToHtml(file);
      setStatus({ tone: "idle", message: "Rendering PDF…" });
      const canvas = await renderHtmlToCanvas(html);
      downloadBytes(await canvasToPdf(canvas), withExtension(`${safeFilename(file.name)}`, "pdf"), "application/pdf");
      return "eBook converted to PDF.";
    })} />
  </ToolForm>;
}

// --- PDF export tools (Phase 4b) ---------------------------------------------

function PdfToWordTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Text-focused conversion: each line of selectable text becomes a Word paragraph, blank space becomes a blank line, and every PDF page ends with a page break. Multi-column layouts, tables, and images are not reproduced. A scanned PDF has no selectable text — run OCR first.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PrimaryButton label="Convert to Word" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const bytes = await pdfToDocx(file, { title: file.name, onProgress: pageProgress(setStatus, "Reading") });
      downloadBytes(bytes, withExtension(safeFilename(file.name), "docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      return "Word document ready.";
    })} />
  </ToolForm>;
}

function PdfToExcelTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [tolerance, setTolerance] = useState("12");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Rebuilds tables from where the text actually sits on the page, one sheet per PDF page. This works best on ruled or clearly tabular PDFs (statements, invoices, reports); flowing prose comes back as one column per line. Merged cells and spanning headers are approximated.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Select
      label="Column detection"
      value={tolerance}
      onChange={setTolerance}
      options={["8", "12", "20", "32"]}
      labels={["8 · many narrow columns", "12 · default", "20 · fewer columns", "32 · widest columns"]}
    />
    <PrimaryButton label="Convert to Excel" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const { bytes, sheets, rows, columns } = await pdfToXlsx(file, {
        columnTolerance: Number(tolerance),
        onProgress: pageProgress(setStatus, "Reading"),
      });
      downloadBytes(bytes, withExtension(safeFilename(file.name), "xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      return `Rebuilt ${rows} row${rows === 1 ? "" : "s"} across ${columns} column${columns === 1 ? "" : "s"} in ${sheets} sheet${sheets === 1 ? "" : "s"}.\nCheck the result — column detection is a best-effort guess from text positions.`;
    })} />
  </ToolForm>;
}

function PdfToHtmlTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState("image");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Exports one self-contained .html file with no remote references, so it opens offline anywhere. "Page images" keeps the exact look and lays invisible, selectable text over each page; "text only" produces a much smaller file with positioned text on blank pages. All text is escaped, so nothing in the PDF can run as script.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Select
      label="Fidelity"
      value={mode}
      onChange={setMode}
      options={["image", "text"]}
      labels={["Page images + selectable text · exact look, large file", "Text only · small file, no graphics"]}
    />
    <PrimaryButton label="Convert to HTML" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const html = await pdfToHtml(file, {
        pageImages: mode === "image",
        title: safeFilename(file.name),
        onProgress: pageProgress(setStatus, "Rendering"),
      });
      downloadText(html, `${safeFilename(file.name)}`, "html", "text/html;charset=utf-8");
      return `HTML ready (${formatBytes(new Blob([html]).size)}).`;
    })} />
  </ToolForm>;
}

function PdfToEpubTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setTitle(""); setAuthor(""); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Packages the PDF's text as a valid EPUB 3 eBook: one reflowable chapter per PDF page, plus a table of contents. Text only — images, columns, and fixed layout are not carried over, so this suits prose rather than magazines. Scanned PDFs need OCR first.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Input label="Book title" value={title} onChange={setTitle} placeholder="Leave blank to use the file name" />
    <Input label="Author" value={author} onChange={setAuthor} placeholder="Leave blank for MyFileKit" />
    <PrimaryButton label="Download .epub" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const { bytes, chapters } = await pdfToEpub(file, {
        title: title.trim() || safeFilename(file.name),
        author: author.trim() || undefined,
        onProgress: pageProgress(setStatus, "Reading"),
      });
      downloadBytes(bytes, withExtension(safeFilename(file.name), "epub"), "application/epub+zip");
      return `EPUB ready with ${chapters} chapter${chapters === 1 ? "" : "s"}.`;
    })} />
  </ToolForm>;
}

function OcrPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [dpi, setDpi] = useState("200");
  const [lang, setLang] = useState(DEFAULT_OCR_LANG);
  const [alsoEnglish, setAlsoEnglish] = useState(false);
  const [searchable, setSearchable] = useState(true);
  const [text, setText] = useState("");
  const [status, setStatus] = useState(initialStatus);

  // The OCR engine keeps a worker (and a WebAssembly heap) alive between pages;
  // always release it when the tool unmounts or is reset.
  useEffect(() => () => { void terminateOcrWorker(); }, []);

  const reset = () => {
    void terminateOcrWorker();
    setFiles([]);
    setText("");
    setLang(DEFAULT_OCR_LANG);
    setAlsoEnglish(false);
    setStatus(initialStatus);
  };

  // Tesseract accepts "hin+eng"; pair a non-English language with English only
  // when asked. The selector already limits `lang` to a vendored model, so the
  // effective string never names a language whose model is missing.
  const selected = OCR_LANGUAGES.find((entry) => entry.code === lang) || OCR_LANGUAGES[0];
  const combineEnglish = alsoEnglish && lang !== DEFAULT_OCR_LANG;
  const effectiveLang = combineEnglish ? `${lang}+${DEFAULT_OCR_LANG}` : lang;
  const englishModel = OCR_LANGUAGES.find((entry) => entry.code === DEFAULT_OCR_LANG)!;
  const modelBytes = selected.sizeBytes + (combineEnglish ? englishModel.sizeBytes : 0);
  const downloadMb = (modelBytes / (1024 * 1024)).toFixed(1);

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Reads text out of scanned PDFs and photos with a local OCR engine (Tesseract). The engine and every language model ship with this app — nothing is uploaded. {OCR_ENGINE_SIZE_LABEL} loads once from this page on first use; each language model is fetched only when you first read in that language, then your browser caches it. Accuracy depends on the scan: straight, high-contrast, 200–300 DPI pages read best. A searchable PDF keeps the original page image with an invisible text layer over it.
    </div>
    <FileControl accept="application/pdf,image/jpeg,image/png,image/webp" multiple files={files} setFiles={setFiles} label="Choose or drop one scanned PDF, or images" />
    <Select label="Recognition language" value={lang} onChange={setLang} options={OCR_LANGUAGES.map((entry) => entry.code)} labels={OCR_LANGUAGES.map((entry) => entry.label)} />
    {lang !== DEFAULT_OCR_LANG && <Checkbox label="Also recognise English on the same page (adds the English model)" checked={alsoEnglish} onChange={setAlsoEnglish} />}
    <p className="text-xs font-semibold leading-5 text-neutral-500">
      First use of {combineEnglish ? `${selected.label} + English` : selected.label} downloads {combineEnglish ? "their models" : "its model"} once (~{downloadMb} MB), then your browser caches {combineEnglish ? "them" : "it"}. No other language is fetched.
    </p>
    <Select label="Render resolution (DPI)" value={dpi} onChange={setDpi} options={["150", "200", "300"]} labels={["150 · fastest", "200 · default", "300 · most accurate"]} />
    <Checkbox label="Also build a searchable PDF (image + invisible text layer)" checked={searchable} onChange={setSearchable} />
    <PrimaryButton label="Run OCR" onClick={() => runSafely(setStatus, async () => {
      const valid = validateFiles(files, tool.file);
      const pdfs = valid.filter((file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name));
      if (pdfs.length && pdfs.length !== valid.length) throw new Error("Choose either one PDF or a set of images, not both at once.");
      if (pdfs.length > 1) throw new Error("Choose a single PDF at a time.");

      const base = safeFilename(valid[0].name);
      const onStage = (page: number, total: number, stage: string) =>
        setStatus({ tone: "idle", message: `Reading page ${page} of ${total} — ${stage}` });

      if (pdfs.length === 1) {
        const { text: recognised, pages, bytes } = await ocrPdf(pdfs[0], {
          lang: effectiveLang,
          dpi: Number(dpi),
          searchablePdf: searchable,
          onStage,
          onRender: (page, total) => setStatus({ tone: "idle", message: `Rendering page ${page} of ${total}…` }),
        });
        setText(recognised);
        if (searchable && bytes) downloadBytes(bytes, withExtension(`${base}-ocr`, "pdf"), "application/pdf");
        if (!recognised) return `No text was recognised in ${pages} page${pages === 1 ? "" : "s"}. Try a higher DPI or a cleaner scan.`;
        return searchable && bytes
          ? `Read ${pages} page${pages === 1 ? "" : "s"}. Searchable PDF ready to save.`
          : `Read ${pages} page${pages === 1 ? "" : "s"}.`;
      }

      const results = await ocrImages(
        valid.map((file) => ({ name: file.name, blob: file })),
        { lang: effectiveLang, searchablePdf: searchable, dpi: Number(dpi), onStage }
      );
      const recognised = results
        .map((result: any, index: number) => `--- ${result.name || `Image ${index + 1}`} ---\n${result.text}`)
        .join("\n\n")
        .trim();
      setText(recognised);
      const parts = results.map((result: any) => result.pdf).filter(Boolean);
      if (searchable && parts.length === results.length) {
        downloadBytes(await mergeSearchablePdfPages(parts), withExtension(`${base}-ocr`, "pdf"), "application/pdf");
      }
      if (!recognised) return `No text was recognised in ${results.length} image${results.length === 1 ? "" : "s"}.`;
      return `Read ${results.length} image${results.length === 1 ? "" : "s"}.`;
    })} />
    <Textarea label="Recognised text" value={text} onChange={setText} rows={12} />
    <div className="flex flex-wrap gap-2">
      <SecondaryButton label="Copy" onClick={() => runSafely(setStatus, async () => { await copyText(text); return "Copied."; })} />
      <SecondaryButton label="Download .txt" onClick={() => runSafely(setStatus, async () => {
        downloadText(requireOutput(text), `${safeFilename(files[0]?.name || "ocr")}-ocr`, "txt");
        return "Text file ready to download.";
      })} />
    </div>
  </ToolForm>;
}

function PdfToAudioTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [voices, setVoices] = useState<any[]>([]);
  const [voiceName, setVoiceName] = useState("");
  const [rate, setRate] = useState("1");
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const stopRequested = useRef(false);
  const supported = speechSynthesisSupported();

  useEffect(() => {
    if (!supported) return;
    let active = true;
    loadSpeechVoices().then((list: any[]) => { if (active) setVoices(list || []); }).catch(() => {});
    return () => { active = false; };
  }, [supported]);

  // Never leave a voice talking after the user navigates away.
  useEffect(() => () => { if (speechSynthesisSupported()) window.speechSynthesis.cancel(); }, []);

  const stop = () => {
    stopRequested.current = true;
    if (supported) window.speechSynthesis.cancel();
    setPaused(false);
  };

  const reset = () => {
    stop();
    setFiles([]);
    setText("");
    setStatus(initialStatus);
  };

  const voiceNames = voices.map((voice: any) => voice.name);

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Extracts the PDF's text, then reads it aloud with the voices already installed on your device. Playback is local — no audio leaves your browser. It cannot be saved as a file: the browser's speech API never exposes the audio samples, and this app ships no audio encoder, so there is no honest way to hand you an MP3 offline. Use your operating system's own recorder if you need a file.
    </div>
    {!supported && <StatusBox status={{ tone: "error", message: "This browser has no built-in speech engine, so text cannot be read aloud here." }} />}
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <SecondaryButton label="Extract text" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const extracted = await extractPdfText(file, { onProgress: pageProgress(setStatus, "Reading") });
      setText(extracted);
      return extracted.trim()
        ? "Text extracted. Press Read aloud to start."
        : "No selectable text found — this PDF is likely scanned images. Run OCR first.";
    })} />
    <Textarea label="Text to read" value={text} onChange={setText} rows={10} />
    {voiceNames.length > 0 && <Select label="Voice" value={voiceName || voiceNames[0]} onChange={setVoiceName} options={voiceNames} />}
    <Select label="Speed" value={rate} onChange={setRate} options={["0.75", "1", "1.25", "1.5", "2"]} labels={["0.75× slower", "1× normal", "1.25×", "1.5×", "2× faster"]} />
    <div className="flex flex-wrap gap-2">
      <PrimaryButton label="Read aloud" onClick={() => runSafely(setStatus, async () => {
        const chunks = splitTextForSpeech(requireOutput(text));
        if (!chunks.length) throw new Error("Extract or paste some text first.");
        const synthesis = getSpeechSynthesis();
        synthesis.cancel();
        stopRequested.current = false;
        const voice = voices.find((item: any) => item.name === (voiceName || voiceNames[0])) || null;
        setSpeaking(true);
        setPaused(false);
        try {
          for (let index = 0; index < chunks.length; index += 1) {
            if (stopRequested.current) break;
            setStatus({ tone: "idle", message: `Reading part ${index + 1} of ${chunks.length}…` });
            await new Promise<void>((resolve, reject) => {
              const utterance = new window.SpeechSynthesisUtterance(chunks[index]);
              if (voice) utterance.voice = voice;
              utterance.rate = Number(rate) || 1;
              utterance.onend = () => resolve();
              utterance.onerror = (event: any) => {
                // Cancelling on purpose surfaces as an error event; that is not a failure.
                if (stopRequested.current || event?.error === "interrupted" || event?.error === "canceled") resolve();
                else reject(new Error(`Playback failed: ${event?.error || "unknown error"}.`));
              };
              synthesis.speak(utterance);
            });
          }
        } finally {
          setSpeaking(false);
          setPaused(false);
        }
        return stopRequested.current ? "Playback stopped." : `Finished reading ${chunks.length} part${chunks.length === 1 ? "" : "s"}.`;
      })} />
      {speaking && <SecondaryButton
        label={paused ? "Resume" : "Pause"}
        onClick={() => {
          const synthesis = getSpeechSynthesis();
          if (paused) { synthesis.resume(); setPaused(false); } else { synthesis.pause(); setPaused(true); }
        }}
      />}
      {speaking && <SecondaryButton label="Stop" onClick={stop} />}
    </div>
  </ToolForm>;
}

function HandwritingToPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [enhance, setEnhance] = useState(true);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Upload photos of handwritten or scanned pages. They are combined into one PDF in the order shown, one page per image. Enable cleanup for a cleaner, higher-contrast document look.
    </div>
    <FileControl accept="image/jpeg,image/png,image/webp" multiple files={files} setFiles={setFiles} />
    <Checkbox label="Enhance pages (grayscale + contrast)" checked={enhance} onChange={setEnhance} />
    <PrimaryButton label="Create PDF" onClick={() => runSafely(setStatus, async () => {
      const valid = validateFiles(files, tool.file);
      const canvases: HTMLCanvasElement[] = [];
      for (const file of valid) {
        const canvas = await imageToCanvas(file, "image/jpeg");
        canvases.push(enhance ? enhanceCanvas(canvas) : canvas);
      }
      downloadBytes(await canvasesToPdf(canvases), "myfilekit-handwriting.pdf", "application/pdf");
      return `Combined ${valid.length} page${valid.length === 1 ? "" : "s"} into one PDF.`;
    })} />
  </ToolForm>;
}

function ScanToPdfTool() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [pages, setPages] = useState<HTMLCanvasElement[]>([]);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [enhance, setEnhance] = useState(true);
  const [status, setStatus] = useState(initialStatus);

  const stopCamera = () => {
    stopCameraStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  };

  // Always release the camera when this tool unmounts (route change / reset),
  // so the camera light never stays on after leaving.
  useEffect(() => () => {
    stopCameraStream(streamRef.current);
    streamRef.current = null;
  }, []);

  const startCamera = () => runSafely(setStatus, async () => {
    const stream = await startCameraStream();
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => {});
    }
    setActive(true);
    return "Camera started. Capture one or more pages, then create your PDF.";
  });

  const capture = () => runSafely(setStatus, async () => {
    if (!active || !videoRef.current) throw new Error("Start the camera first.");
    const frame = captureVideoFrame(videoRef.current);
    const canvas = enhance ? enhanceCanvas(frame) : frame;
    setPages((previous) => [...previous, canvas]);
    setThumbs((previous) => [...previous, canvas.toDataURL("image/jpeg", 0.6)]);
    return "Captured a page.";
  });

  const reset = () => {
    stopCamera();
    setPages([]);
    setThumbs([]);
    setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Uses your device camera locally. Frames are captured and combined into a PDF in your browser — nothing is uploaded. The camera is released when you stop or leave this tool.
    </div>
    <video
      ref={videoRef}
      playsInline
      muted
      className="w-full rounded-3xl bg-black"
      style={{ display: active ? "block" : "none", aspectRatio: "4 / 3" }}
    />
    <div className="flex flex-wrap gap-2">
      {active
        ? <>
            <PrimaryButton label="Capture page" onClick={capture} />
            <SecondaryButton label="Stop camera" onClick={stopCamera} />
          </>
        : <SecondaryButton label="Start camera" onClick={startCamera} />}
    </div>
    <Checkbox label="Enhance pages (grayscale + contrast)" checked={enhance} onChange={setEnhance} />
    {thumbs.length > 0 && (
      <div className="surface-card wabi-card-edge grid gap-3 p-4">
        <p className="text-xs font-bold uppercase text-neutral-500">Captured pages · {thumbs.length}</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {thumbs.map((thumb, index) => (
            <img key={index} src={thumb} alt={`Captured page ${index + 1}`} className="wabi-card-edge w-full rounded-xl border border-[var(--line)]" />
          ))}
        </div>
      </div>
    )}
    <PrimaryButton label="Create PDF" onClick={() => runSafely(setStatus, async () => {
      if (!pages.length) throw new Error("Capture at least one page first.");
      downloadBytes(await canvasesToPdf(pages), "myfilekit-scan.pdf", "application/pdf");
      return `Created a PDF from ${pages.length} page${pages.length === 1 ? "" : "s"}.`;
    })} />
  </ToolForm>;
}

type WorkflowStep = { op: string; options: Record<string, string> };

const workflowOps = workflowOpList() as { id: string; label: string; hint: string; browserOnly: boolean; fields: { key: string; label: string; type: string; options?: string[]; placeholder?: string }[] }[];
const workflowOpIds = workflowOps.map((op) => op.id);
const workflowOpLabels = workflowOps.map((op) => `${op.label}${op.browserOnly ? " (turns pages into images)" : ""}`);
const workflowPresets = WORKFLOW_PRESETS as { id: string; label: string; hint: string; steps: { op: string; options: Record<string, string> }[] }[];

function WorkflowBuilderTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [nextOp, setNextOp] = useState(workflowOpIds[0]);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [progress, setProgress] = useState<string[]>([]);
  const [output, setOutput] = useState<{ bytes: Uint8Array; filename: string } | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const move = (index: number, delta: number) => setSteps((previous) => {
    const target = index + delta;
    if (target < 0 || target >= previous.length) return previous;
    const next = [...previous];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  const setOption = (index: number, key: string, value: string) => setSteps((previous) =>
    previous.map((step, position) => (position === index ? { ...step, options: { ...step.options, [key]: value } } : step)));

  const reset = () => { setFiles([]); setSteps([]); setProgress([]); setOutput(null); setStatus(initialStatus); };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Chain PDF operations over one file: each step's output PDF becomes the next step's input. Steps marked "turns pages into images" replace text with a picture of it, so put them last if you want selectable text earlier in the chain. Merge is not available here because it needs more than one input file.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={(next) => { setFiles(next); setOutput(null); setProgress([]); }} />

    <div className="grid gap-2">
      <p className="text-xs font-bold uppercase text-neutral-500">Presets — one click fills a chain you can still edit</p>
      <div className="flex flex-wrap gap-2">
        {workflowPresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="quick-chip"
            title={preset.hint}
            onClick={() => { setSteps(presetSteps(preset.id) as WorkflowStep[]); setOutput(null); setProgress([]); setStatus({ tone: "idle", message: `Loaded the "${preset.label}" preset. Edit the steps or run the workflow.` }); }}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>

    <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
      <Select label="Add a step" value={nextOp} onChange={setNextOp} options={workflowOpIds} labels={workflowOpLabels} />
      <SecondaryButton label="Add step" onClick={() => setSteps((previous) => [...previous, { op: nextOp, options: defaultStepOptions(nextOp) as Record<string, string> }])} />
    </div>

    {steps.length ? (
      <div className="grid gap-2">
        {steps.map((step, index) => {
          const definition = workflowOps.find((op) => op.id === step.op);
          return (
            <div key={`${step.op}-${index}`} className="surface-card wabi-card-edge grid gap-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-black">{index + 1}. {definition?.label || step.op}</span>
                <span className="flex gap-2">
                  <button className="secondary-button" type="button" aria-label="Move step up" onClick={() => move(index, -1)}>Up</button>
                  <button className="secondary-button" type="button" aria-label="Move step down" onClick={() => move(index, 1)}>Down</button>
                  <button className="secondary-button" type="button" onClick={() => setSteps((previous) => previous.filter((_, position) => position !== index))}>Remove</button>
                </span>
              </div>
              {definition?.hint && <p className="text-xs font-semibold text-neutral-500">{definition.hint}</p>}
              {definition?.fields.length ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  {definition.fields.map((field) => field.type === "select"
                    ? <Select key={field.key} label={field.label} value={String(step.options[field.key] ?? "")} onChange={(value) => setOption(index, field.key, value)} options={field.options || []} />
                    : <MiniField key={field.key} label={field.label} value={String(step.options[field.key] ?? "")} placeholder={field.placeholder} onChange={(value) => setOption(index, field.key, value)} />)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    ) : <p className="text-sm font-semibold text-neutral-500">No steps yet. Add one above to build a pipeline.</p>}

    <PrimaryButton label="Run workflow" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      if (!steps.length) throw new Error("Add at least one step to the workflow.");
      const trail: string[] = [];
      setProgress([]);
      setOutput(null);
      const result: any = await runWorkflow(file, steps, {
        onStep: ({ step, total, label, phase }: any) => {
          if (phase === "start") setStatus({ tone: "idle", message: `Step ${step} of ${total} — ${label}…` });
          if (phase === "done") { trail.push(`${step}. ${label} — done`); setProgress([...trail]); }
          if (phase === "failed") { trail.push(`${step}. ${label} — failed`); setProgress([...trail]); }
        },
      });
      const suffix = result.ok ? "workflow" : `workflow-step-${result.completed.length}`;
      setOutput({ bytes: result.bytes, filename: withExtension(`${safeFilename(file.name)}-${suffix}`, "pdf") });
      if (!result.ok) {
        throw new Error(`Step ${result.failed.step} (${result.failed.label}) failed: ${result.failed.message} The output of the ${result.completed.length} step${result.completed.length === 1 ? "" : "s"} before it is still available to download.`);
      }
      return `Ran ${result.completed.length} step${result.completed.length === 1 ? "" : "s"} on ${file.name}.`;
    })} />

    {progress.length > 0 && (
      <ul className="surface-muted wabi-card-edge grid gap-1 p-4 text-sm font-bold">
        {progress.map((entry) => <li key={entry}>{entry}</li>)}
      </ul>
    )}

    {output && <PrimaryButton label="Download PDF" onClick={() => runSafely(setStatus, async () => {
      downloadBytes(output.bytes, output.filename, "application/pdf");
      return `${output.filename} is ready to save.`;
    })} />}
  </ToolForm>;
}

const batchOps = batchOpList() as { id: string; label: string; hint: string; accepts: string; browserOnly: boolean; fields: { key: string; label: string; type: string; options?: string[]; placeholder?: string }[] }[];
const batchOpIds = batchOps.map((op) => op.id);
const batchOpLabels = batchOps.map((op) => `${op.label}${op.browserOnly ? " (turns pages into images)" : ""}`);
const batchMime: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

function BatchProcessTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [opId, setOpId] = useState(batchOpIds[0]);
  const [options, setOptions] = useState<Record<string, string | boolean>>(() => defaultBatchOptions(batchOpIds[0]) as Record<string, string | boolean>);
  const [progress, setProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const [result, setResult] = useState<{ outputs: { name: string; bytes: Uint8Array }[]; failures: { name: string; reason: string }[] } | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const definition = batchOps.find((op) => op.id === opId)!;

  const pickOp = (nextOp: string) => {
    setOpId(nextOp);
    setOptions(defaultBatchOptions(nextOp) as Record<string, string | boolean>);
    setProgress(null);
    setResult(null);
    setStatus(initialStatus);
  };

  const setOption = (key: string, value: string | boolean) => setOptions((previous) => ({ ...previous, [key]: value }));

  const reset = () => { setFiles([]); pickOp(batchOpIds[0]); };

  const downloadResult = () => runSafely(setStatus, async () => {
    if (!result?.outputs.length) throw new Error("Run the batch first — there is nothing to download.");
    if (result.outputs.length === 1) {
      const [only] = result.outputs;
      const ext = only.name.toLowerCase().split(".").pop() || "";
      downloadBytes(only.bytes, only.name, batchMime[ext] || "application/octet-stream");
      return `${only.name} is ready to save.`;
    }
    const zipped = zipOutputs(result.outputs);
    const zipName = withExtension(`myfilekit-batch-${definition.id}`, "zip");
    downloadBytes(zipped, zipName, "application/zip");
    return `${zipName} ready to save (${result.outputs.length} files).`;
  });

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Apply one operation across many files at once — up to {MAX_BATCH_FILES}. Each file is processed on its own: if one fails, the rest keep going, and you get a report of which succeeded and which did not. Successful results download together as a ZIP (or as a single file when there is only one). Operations marked "turns pages into images" replace text with a picture of it.
    </div>

    <Select label="Operation" value={opId} onChange={pickOp} options={batchOpIds} labels={batchOpLabels} />
    <p className="text-xs font-semibold text-neutral-500">{definition.hint} Accepts {definition.accepts === "image" ? "JPG, PNG, or WebP images" : "PDF files"}.</p>

    {definition.fields.length ? (
      <div className="grid gap-2 sm:grid-cols-3">
        {definition.fields.map((field) => {
          if (field.type === "select") return <Select key={field.key} label={field.label} value={String(options[field.key] ?? "")} onChange={(value) => setOption(field.key, value)} options={field.options || []} />;
          if (field.type === "checkbox") return <Checkbox key={field.key} label={field.label} checked={options[field.key] === true || options[field.key] === "true"} onChange={(value) => setOption(field.key, value)} />;
          return <MiniField key={field.key} label={field.label} type={field.type === "number" ? "number" : field.type === "password" ? "password" : "text"} value={String(options[field.key] ?? "")} placeholder={field.placeholder} onChange={(value) => setOption(field.key, value)} />;
        })}
      </div>
    ) : null}

    <FileControl accept={batchAcceptFor(opId)} multiple files={files} setFiles={(next) => { setFiles(next); setResult(null); setProgress(null); }} label={`Choose or drop files (up to ${MAX_BATCH_FILES})`} />
    {files.length > 0 && <p className="text-xs font-semibold text-neutral-500">{files.length} file{files.length === 1 ? "" : "s"} selected.</p>}

    <PrimaryButton label="Run batch" disabled={!files.length} onClick={() => runSafely(setStatus, async () => {
      setResult(null);
      setProgress(null);
      const run = await runBatch(files, opId, options, {
        maxFiles: MAX_BATCH_FILES,
        maxSize: (tool.file as { maxSize?: number }).maxSize || 0,
        onProgress: (info) => setProgress(info),
      });
      setProgress(null);
      setResult({ outputs: run.outputs, failures: run.failures });
      if (!run.outputs.length) throw new Error(`No files could be processed. ${run.failures.length} failed — see the report below.`);
      const failNote = run.failures.length ? ` ${run.failures.length} failed.` : "";
      return `Processed ${run.outputs.length} of ${run.total} file${run.total === 1 ? "" : "s"}.${failNote}`;
    })} />

    {progress && <ProgressBar value={progress.current} total={progress.total} label={`Processing ${progress.current} of ${progress.total} — ${progress.name}`} />}

    {result && (result.outputs.length > 0 || result.failures.length > 0) && (
      <div className="surface-muted wabi-card-edge grid gap-3 p-4 text-sm font-semibold">
        {result.outputs.length > 0 && (
          <div className="grid gap-1">
            <p className="text-xs font-bold uppercase text-neutral-500">Succeeded ({result.outputs.length})</p>
            <ul className="grid gap-1">
              {result.outputs.map((item) => <li key={item.name} className="break-words text-[var(--foreground)]">{item.name}</li>)}
            </ul>
          </div>
        )}
        {result.failures.length > 0 && (
          <div className="grid gap-1">
            <p className="text-xs font-bold uppercase text-[var(--danger-fg)]">Failed / skipped ({result.failures.length})</p>
            <ul className="grid gap-1">
              {result.failures.map((item) => <li key={`${item.name}-${item.reason}`} className="break-words text-neutral-600">{item.name} — {item.reason}</li>)}
            </ul>
          </div>
        )}
      </div>
    )}

    {result && result.outputs.length > 0 && (
      <PrimaryButton label={result.outputs.length === 1 ? "Download result" : "Download ZIP"} onClick={downloadResult} />
    )}
  </ToolForm>;
}

/**
 * Shared workflow step editor (presets + add-step + per-step fields), so the
 * Batch Workflow tool reuses the exact chain-building UI without duplicating it.
 */
function WorkflowStepsEditor({ steps, setSteps }: { steps: WorkflowStep[]; setSteps: React.Dispatch<React.SetStateAction<WorkflowStep[]>> }) {
  const [nextOp, setNextOp] = useState(workflowOpIds[0]);

  const move = (index: number, delta: number) => setSteps((previous) => {
    const target = index + delta;
    if (target < 0 || target >= previous.length) return previous;
    const next = [...previous];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const setOption = (index: number, key: string, value: string) => setSteps((previous) =>
    previous.map((step, position) => (position === index ? { ...step, options: { ...step.options, [key]: value } } : step)));

  return (
    <>
      <div className="grid gap-2">
        <p className="text-xs font-bold uppercase text-neutral-500">Presets — one click fills a chain you can still edit</p>
        <div className="flex flex-wrap gap-2">
          {workflowPresets.map((preset) => (
            <button key={preset.id} type="button" className="quick-chip" title={preset.hint} onClick={() => setSteps(presetSteps(preset.id) as WorkflowStep[])}>
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <Select label="Add a step" value={nextOp} onChange={setNextOp} options={workflowOpIds} labels={workflowOpLabels} />
        <SecondaryButton label="Add step" onClick={() => setSteps((previous) => [...previous, { op: nextOp, options: defaultStepOptions(nextOp) as Record<string, string> }])} />
      </div>
      {steps.length ? (
        <div className="grid gap-2">
          {steps.map((step, index) => {
            const definition = workflowOps.find((op) => op.id === step.op);
            return (
              <div key={`${step.op}-${index}`} className="surface-card wabi-card-edge grid gap-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-black">{index + 1}. {definition?.label || step.op}</span>
                  <span className="flex gap-2">
                    <button className="secondary-button" type="button" aria-label="Move step up" onClick={() => move(index, -1)}>Up</button>
                    <button className="secondary-button" type="button" aria-label="Move step down" onClick={() => move(index, 1)}>Down</button>
                    <button className="secondary-button" type="button" onClick={() => setSteps((previous) => previous.filter((_, position) => position !== index))}>Remove</button>
                  </span>
                </div>
                {definition?.hint && <p className="text-xs font-semibold text-neutral-500">{definition.hint}</p>}
                {definition?.fields.length ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    {definition.fields.map((field) => field.type === "select"
                      ? <Select key={field.key} label={field.label} value={String(step.options[field.key] ?? "")} onChange={(value) => setOption(index, field.key, value)} options={field.options || []} />
                      : <MiniField key={field.key} label={field.label} value={String(step.options[field.key] ?? "")} placeholder={field.placeholder} onChange={(value) => setOption(index, field.key, value)} />)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : <p className="text-sm font-semibold text-neutral-500">No steps yet. Add one above, or pick a preset, to build a pipeline.</p>}
    </>
  );
}

function BatchWorkflowTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [progress, setProgress] = useState<{ file: number; files: number; name: string; step: number; steps: number; label: string } | null>(null);
  const [result, setResult] = useState<{ outputs: { name: string; bytes: Uint8Array }[]; failures: { name: string; reason: string }[]; total: number } | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => { setFiles([]); setSteps([]); setProgress(null); setResult(null); setStatus(initialStatus); };

  const downloadResult = () => runSafely(setStatus, async () => {
    if (!result?.outputs.length) throw new Error("Run the batch first — there is nothing to download.");
    if (result.outputs.length === 1) {
      const [only] = result.outputs;
      downloadBytes(only.bytes, only.name, "application/pdf");
      return `${only.name} is ready to save.`;
    }
    const zipName = withExtension("myfilekit-batch-workflow", "zip");
    downloadBytes(zipOutputs(result.outputs), zipName, "application/zip");
    return `${zipName} ready to save (${result.outputs.length} files).`;
  });

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Build a workflow once — a chain of steps, or a one-click preset — and run it over many PDFs at once, up to {MAX_WORKFLOW_BATCH_FILES}. Each file goes through the identical pipeline; if one file fails, the rest keep going and you get a per-file report. Successful results download together as a ZIP (or as a single PDF when there is only one). Steps marked "turns pages into images" replace text with a picture of it.
    </div>

    <WorkflowStepsEditor steps={steps} setSteps={setSteps} />

    <FileControl accept="application/pdf" multiple files={files} setFiles={(next) => { setFiles(next); setResult(null); setProgress(null); }} label={`Choose or drop PDFs (up to ${MAX_WORKFLOW_BATCH_FILES})`} />
    {files.length > 0 && <p className="text-xs font-semibold text-neutral-500">{files.length} file{files.length === 1 ? "" : "s"} selected.</p>}

    <PrimaryButton label="Run workflow over all files" disabled={!files.length || !steps.length} onClick={() => runSafely(setStatus, async () => {
      const valid = validateFiles(files, tool.file);
      if (!steps.length) throw new Error("Add at least one step to the workflow.");
      setResult(null);
      setProgress(null);
      const run = await runWorkflowBatch(valid, steps, {
        maxFiles: MAX_WORKFLOW_BATCH_FILES,
        onProgress: (info: any) => { if (info.phase !== "failed") setProgress(info); },
      });
      setProgress(null);
      setResult(run);
      if (!run.outputs.length) throw new Error(`No files could be processed. ${run.failures.length} failed — see the report below.`);
      const failNote = run.failures.length ? ` ${run.failures.length} failed.` : "";
      return `Processed ${run.outputs.length} of ${run.total} file${run.total === 1 ? "" : "s"} through ${steps.length} step${steps.length === 1 ? "" : "s"}.${failNote}`;
    })} />

    {progress && <ProgressBar value={progress.file} total={progress.files} label={`File ${progress.file} of ${progress.files} — ${progress.name} · step ${progress.step} of ${progress.steps} (${progress.label})`} />}

    {result && (result.outputs.length > 0 || result.failures.length > 0) && (
      <div className="surface-muted wabi-card-edge grid gap-3 p-4 text-sm font-semibold">
        {result.outputs.length > 0 && (
          <div className="grid gap-1">
            <p className="text-xs font-bold uppercase text-neutral-500">Succeeded ({result.outputs.length})</p>
            <ul className="grid gap-1">
              {result.outputs.map((item) => <li key={item.name} className="break-words text-[var(--foreground)]">{item.name}</li>)}
            </ul>
          </div>
        )}
        {result.failures.length > 0 && (
          <div className="grid gap-1">
            <p className="text-xs font-bold uppercase text-[var(--danger-fg)]">Failed / skipped ({result.failures.length})</p>
            <ul className="grid gap-1">
              {result.failures.map((item) => <li key={`${item.name}-${item.reason}`} className="break-words text-neutral-600">{item.name} — {item.reason}</li>)}
            </ul>
          </div>
        )}
      </div>
    )}

    {result && result.outputs.length > 0 && (
      <PrimaryButton label={result.outputs.length === 1 ? "Download result" : "Download ZIP"} onClick={downloadResult} />
    )}
  </ToolForm>;
}

function parseRedactionAreas(input: string) {
  const lines = String(input || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error("Add at least one redaction area (page, x, y, width, height).");
  return lines.map((line) => {
    const parts = line.split(/[,\s]+/).map(Number);
    if (parts.length !== 5 || parts.some((value) => !Number.isFinite(value))) {
      throw new Error(`"${line}" is not a valid area. Use: page, x, y, width, height.`);
    }
    const [page, x, y, w, h] = parts;
    return { page, x, y, w, h };
  });
}

export default function PdfTools({ tool }: { tool: Tool }) {
  if (tool.id === "workflow-builder-tool") return <WorkflowBuilderTool tool={tool} />;
  if (tool.id === "batch-process-tool") return <BatchProcessTool tool={tool} />;
  if (tool.id === "batch-workflow-tool") return <BatchWorkflowTool tool={tool} />;
  if (tool.id === "smart-split-pdf-tool") return <SmartSplitPdfTool tool={tool} />;
  if (tool.id === "bates-numbering-tool") return <BatesNumberingTool tool={tool} />;
  if (tool.id === "impose-pdf-tool") return <ImposePdfTool tool={tool} />;
  if (tool.id === "bookmarks-editor-tool") return <BookmarksEditorTool tool={tool} />;
  if (tool.id === "create-form-tool") return <CreateFormTool tool={tool} />;
  if (tool.id === "compare-pdf-tool") return <ComparePdfTool tool={tool} />;
  if (tool.id === "deskew-pdf-tool") return <DeskewPdfTool tool={tool} />;
  if (tool.id === "pdfa-prep-tool") return <PdfaPrepTool tool={tool} />;
  if (tool.id === "accessibility-check-tool") return <AccessibilityCheckTool tool={tool} />;
  if (tool.id === "tag-pdf-tool") return <TagPdfTool tool={tool} />;
  if (tool.id === "merge-pdf-tool") return <PdfFileTool tool={tool} action="Merge PDFs" multiple run={(files) => mergePdfs(files).then((bytes) => downloadBytes(bytes, "myfilekit-merged.pdf", "application/pdf"))} />;
  if (tool.id === "split-pdf-tool") return <PageRangeTool tool={tool} action="Extract pages" suffix="extracted" run={extractPdfPages} />;
  if (tool.id === "delete-pdf-pages-tool") return <PageRangeTool tool={tool} action="Delete pages" suffix="pages-deleted" run={deletePdfPages} />;
  if (tool.id === "rotate-pdf-tool") return <RotatePdfTool tool={tool} />;
  if (tool.id === "add-text-to-pdf-tool") return <AddTextToPdfTool tool={tool} />;
  if (tool.id === "edit-pdf-text-tool") return <EditPdfTextTool tool={tool} />;
  if (tool.id === "reflow-pdf-tool") return <ReflowEditorTool tool={tool} />;
  if (tool.id === "add-signature-to-pdf-tool") return <AddSignatureToPdfTool tool={tool} />;
  if (tool.id === "annotate-pdf-tool") return <AnnotatePdfTool tool={tool} />;
  if (tool.id === "pdf-page-numbers-tool") return <PdfPageNumbersTool tool={tool} />;
  if (tool.id === "watermark-pdf-tool") return <WatermarkPdfTool tool={tool} />;
  if (tool.id === "pdf-to-image-tool") return <PdfToImageTool tool={tool} />;
  if (tool.id === "compress-pdf-tool") return <CompressPdfTool tool={tool} />;
  if (tool.id === "pdf-to-zip-tool") return <PdfToZipTool tool={tool} />;
  if (tool.id === "flatten-pdf-tool") return <FlattenPdfTool tool={tool} />;
  if (tool.id === "invert-pdf-tool") return <InvertPdfTool tool={tool} />;
  if (tool.id === "images-to-pdf-tool") return <ImagesToPdfTool tool={tool} />;
  if (tool.id === "remove-blank-pages-tool") return <RemoveBlankPagesTool tool={tool} />;
  if (tool.id === "remove-pdf-images-tool") return <RemovePdfImagesTool tool={tool} />;
  if (tool.id === "organize-pages-tool") return <OrganizePagesTool tool={tool} />;
  if (tool.id === "crop-resize-pdf-tool") return <CropResizePdfTool tool={tool} />;
  if (tool.id === "headers-footers-tool") return <HeadersFootersTool tool={tool} />;
  if (tool.id === "fill-pdf-form-tool") return <FillPdfFormTool tool={tool} />;
  if (tool.id === "redact-pdf-tool") return <RedactPdfTool tool={tool} />;
  if (tool.id === "extract-images-tool") return <ExtractImagesTool tool={tool} />;
  if (tool.id === "create-pdf-tool") return <CreatePdfTool />;
  if (tool.id === "repair-pdf-tool") return <RepairPdfTool tool={tool} />;
  if (tool.id === "html-to-pdf-tool") return <HtmlToPdfTool />;
  if (tool.id === "word-to-pdf-tool") return <WordToPdfTool tool={tool} />;
  if (tool.id === "excel-to-pdf-tool") return <ExcelToPdfTool tool={tool} />;
  if (tool.id === "powerpoint-to-pdf-tool") return <PowerpointToPdfTool tool={tool} />;
  if (tool.id === "ebook-to-pdf-tool") return <EbookToPdfTool tool={tool} />;
  if (tool.id === "pdf-to-word-tool") return <PdfToWordTool tool={tool} />;
  if (tool.id === "pdf-to-excel-tool") return <PdfToExcelTool tool={tool} />;
  if (tool.id === "pdf-to-html-tool") return <PdfToHtmlTool tool={tool} />;
  if (tool.id === "pdf-to-epub-tool") return <PdfToEpubTool tool={tool} />;
  if (tool.id === "ocr-pdf-tool") return <OcrPdfTool tool={tool} />;
  if (tool.id === "pdf-to-audio-tool") return <PdfToAudioTool tool={tool} />;
  if (tool.id === "handwriting-to-pdf-tool") return <HandwritingToPdfTool tool={tool} />;
  if (tool.id === "scan-to-pdf-tool") return <ScanToPdfTool />;
  return <StatusBox status={{ tone: "error", message: "This tool renderer is missing." }} />;
}
