import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import katex from "katex";
import "katex/dist/katex.min.css";
import { zipSync } from "fflate";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Download,
  FileArchive,
  FileText,
  FolderSearch,
  Hash,
  Eye,
  Image,
  Layers3,
  LayoutDashboard,
  Moon,
  PenLine,
  Printer,
  ReceiptText,
  RotateCw,
  Scissors,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Loader2,
  Menu,
  Sun,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { Icons } from "@/components/ui/icons";
import { NumberedPagination } from "@/components/ui/pagination";
import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { categories, categoryGroups, tools } from "./registry/tools.registry.js";
import { categoryRoute, routeForHash } from "./lib/routing";
import { filterTools, searchableText } from "./lib/search.js";
import { formatBytes, parsePageRanges, simpleMarkdownToHtml } from "./utils/format.js";
import { safeFilename, withExtension } from "./utils/safe-filename.js";
import { validateFiles } from "./services/file-validator.js";
import { downloadBlob, downloadBytes, downloadText, revokeDownloadUrl } from "./services/download.service.js";
import { csvToJson, jsonToCsv } from "./services/csv.service.js";
import { addSignatureToImage, addTextToImage, cleanImageMetadata, compressImage, cropImage, exportCanvas, imageDimensions, imageToCanvas, resizeImage, rotateFlipImage } from "./services/image.service.js";
import { inspectImageMetadata, metadataReportToJson } from "./services/metadata.service.js";
import { addPdfPageNumbers, addSignatureImageToPdf, addTextToPdf, cleanPdfMetadata, deletePdfPages, extractPdfPages, getPdfLib, imagesToPdf, loadPdf, mergePdfs, rotatePdfPages, textToPdf, watermarkPdf } from "./services/pdf.service.js";
import { compressPdf as rasterCompressPdf, extractPdfText, flattenPdf, invertPdf, pdfToImages, pdfToZip, rasterRebuild } from "./services/pdf-render.service.js";
import { applyTextEdits, mapPdfFontToStandard, standardFontKey, textItemToPageRect } from "./services/pdf-textedit.service.js";
import { applyAnnotations, screenToPagePoint, pagePointToScreen, HIGHLIGHT_PALETTE, MAX_ANNOTATIONS_PER_PAGE } from "./services/annotate.service.js";
import { archivalPrepPdf, assertPdfDecryptable, comparePdfText, comparePdfReportText, estimateSkewAngle } from "./services/pdf-review.service.js";
import { addHeadersFooters, createPdf, cropResizePdf, fillPdfForm, fingerprintPdf, organizePdfPages, readPdfFormFields, redactPdf, repairPdf } from "./services/pdf-edit.service.js";
import { BATES_POSITION_IDS, NUP_COUNTS, batesNumberPdf, createFormPdf, imposePdf, parseOutlineInput, parseSplitPages, readOutline, setOutline, smartSplitPdf } from "./services/pdf-advanced.service.js";
import { ALL_PERMISSIONS_ALLOWED, PDF_ENCRYPTION_ALGORITHMS, PDF_PERMISSION_LABELS, decryptPdf, encryptPdf, unlockPdf } from "./services/pdf-crypto.service.js";
import { signPdf, verifyPdfSignatures } from "./services/pdf-sign.service.js";
import { CONFIDENCE as PII_CONFIDENCE, PII_TYPE_LABELS, buildPrivacyReportText, confidenceLabel, extractPdfPiiHits, isPersonalType, scanPdfStructure } from "./services/pii.service.js";
import { analyzePdfBytes, buildAnalyzerReportText } from "./services/pdf-analyzer.service.js";
import { sanitizePdf, buildSanitizeReportText, residualActiveContent } from "./services/pdf-sanitize.service.js";
import { extractPdfAssets, buildExtractionZip } from "./services/pdf-extract.service.js";
import { LANGUAGE_OPTIONS, auditPdfAccessibility, buildAccessibilityReportText, extractAccessibilityContent, remediatePdfAccessibility } from "./services/pdf-accessibility.service.js";
import { base64Decode, base64Encode, diffToText, generatePassphrase, generatePassword, jsonToYaml, lineDiff, passwordStrength, textStats, urlDecode, urlEncode } from "./services/text-tools.service.js";
import { canvasToPdf, canvasesToPdf, csvToPdf, markdownToPdf } from "./services/convert.service.js";
import { MAX_WORKFLOW_BATCH_FILES, STATE_CODES, WORKFLOW_PRESETS, computeGstInvoice, computePosBill, defaultStepOptions, formatAmount, gstInvoicePdf, gstr1SummaryCsv, gstr1SummaryPdf, gstr1SummaryXlsx, posReceiptPdf, presetSteps, readInvoiceRows, runWorkflow, runWorkflowBatch, summariseGstr1, summarisePosSession, workflowOpList } from "./services/business.service.js";
import { MAX_BATCH_FILES, batchAcceptFor, batchOpList, defaultBatchOptions, runBatch, zipOutputs } from "./services/batch.service.js";
import { captureVideoFrame, enhanceCanvas, getHtml2Canvas, startCameraStream, stopCameraStream } from "./services/capture.service.js";
import { docxToHtml, epubToHtml, pptxToSlides, readWorkbookSheets, sanitizeHtmlForOffline, sheetsToHtml } from "./services/office.service.js";
import { pdfToDocx, pdfToEpub, pdfToHtml, pdfToXlsx } from "./services/export.service.js";
import { DEFAULT_OCR_LANG, OCR_ENGINE_SIZE_LABEL, OCR_LANGUAGES, mergeSearchablePdfPages, ocrImages, ocrPdf, terminateOcrWorker } from "./services/ocr.service.js";
import { createSpeechRecognizer, getSpeechSynthesis, loadSpeechVoices, speechRecognitionSupport, speechSynthesisSupported, splitTextForSpeech } from "./services/audio.service.js";
import { buildPassageIndex, chunkPages, highlightSegments, searchPassages, summarizeText } from "./services/nlp.service.js";
import { buildAnswerPrompt, buildSummaryPrompt, clearLlmSettings, endpointOrigin, isLlmConfigured, maskApiKey, readLlmSettings, requestChatCompletion, saveLlmSettings, translateDocument } from "./services/llm.service.js";
import { FRAME_KIND, MAX_TRANSFER_BYTES, createAssembler, createPeerLink, decodeJsonFrame, encodeJsonFrame, normalizeIncomingMeta, progressPercent, sendFileOverLink, transferRate, verifyBytes, webrtcSupported } from "./services/webrtc.service.js";
import { MAX_STROKES, addStrokePoint, createStroke, deserializeStrokeChunk, drawStrokeSegment, exportBoardCanvas, mergeStrokeChunk, pointFromEvent, prepareCanvas, renderBoard, serializeStrokeChunk } from "./services/whiteboard.service.js";

type Tool = (typeof tools)[number];
type Status = { tone: "idle" | "success" | "error"; message: string; progress?: { value: number; total: number; label: string } };
type ThemeMode = "light" | "dark";
type PdfOutput = { url: string; blob: Blob; filename: string; pages: number; sourceName: string };
type DownloadReady = { filename: string; mimeType: string; size: number; url: string };

const initialStatus: Status = { tone: "idle", message: "Ready." };

function printDownloadUrl(url: string) {
  const frame = document.createElement("iframe");
  frame.title = "MyFileKit print preview";
  frame.src = url;
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.opacity = "0";
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      window.setTimeout(() => frame.remove(), 60000);
    }
  };
  document.body.appendChild(frame);
}

const categoryIcons: Record<string, any> = {
  "PDF Tools": FileText,
  "Image Tools": Image,
  "Business Tools": ReceiptText,
  "Signature Tools": PenLine,
  "Text & Data Tools": FileArchive,
  "Security & Privacy": ShieldCheck,
  "Developer Utilities": Hash,
  "Sharing & Collaboration": Share2,
};

const categoryDetails: Record<string, { description: string; accent: string }> = {
  "PDF Tools": { description: "Merge, split, rotate, and create PDFs in your browser.", accent: "PDF" },
  "Image Tools": { description: "Compress, resize, convert, crop, and rotate everyday images.", accent: "Image" },
  "Business Tools": { description: "Invoices, Indian GST tax invoices, counter billing, and GSTR-1 filing prep.", accent: "Business" },
  "Signature Tools": { description: "Draw or type signatures and export them as PNG files.", accent: "Signature" },
  "Text & Data Tools": { description: "Format JSON, convert CSV, preview Markdown, and create PDFs from text.", accent: "Data" },
  "Security & Privacy": { description: "Redact PII, run a privacy audit, and triage suspicious PDFs for malware — plus encrypt, unlock, and clean metadata, all locally in your browser.", accent: "Privacy" },
  "Developer Utilities": { description: "Handle hashes, Base64, and small file checks without leaving the page.", accent: "Utility" },
  "Sharing & Collaboration": { description: "Send files browser-to-browser and sketch together over a direct connection — still no server.", accent: "Sharing" },
};

const quickSearches = ["Edit PDF text", "Annotate PDF", "Sign PDF", "Compare PDFs", "Redact PII", "Check for malware", "Encrypt PDF", "Merge PDF", "Compress Image", "Invoice", "File Hash"];
const recentToolsStorageKey = "myfilekit:recentTools";
const themeStorageKey = "myfilekit:theme";
const popularToolIds = ["auto-redact-pii-tool", "edit-pdf-text-tool", "pdf-analyzer-tool", "sign-pdf-tool", "merge-pdf-tool", "compress-image-tool", "invoice-generator-tool", "file-hash-tool"];
// The newest flagship tools, surfaced in a "New & Notable" shelf on the dashboard.
const newAndNotableIds = ["edit-pdf-text-tool", "annotate-pdf-tool", "sign-pdf-tool", "compare-pdf-tool", "smart-split-pdf-tool", "create-form-tool"];
const browseToolsPageSize = 10;

// Set by Cmd/Ctrl+K when it navigates to the dashboard from another route, so the
// dashboard can focus its search input on mount instead of racing a fixed timeout.
let pendingSearchFocus = false;

export default function App() {
  const [hash, setHash] = useState(window.location.hash || "#dashboard");
  const [theme, setTheme] = useState<ThemeMode>(() => readThemePreference());
  const isInitialRoute = useRef(true);

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash || "#dashboard");
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(themeStorageKey, theme);
    } catch {
      // Theme persistence is optional when storage is unavailable.
    }
  }, [theme]);

  const route = routeForHash(hash);
  const routeTitle = route.type === "dashboard" ? "Dashboard"
    : route.type === "browse" ? "Browse tools"
    : route.type === "category" ? route.category
    : route.type === "tool" ? route.tool.name
    : "Page not found";

  // On route change, move focus to the new page heading (or the main landmark)
  // so keyboard and screen-reader users don't stay stranded on stale controls.
  useEffect(() => {
    if (isInitialRoute.current) {
      isInitialRoute.current = false;
      return;
    }
    const main = document.getElementById("app-main");
    if (!main) return;
    const target = (main.querySelector("h1") || main) as HTMLElement;
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }, [hash]);

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--ink)]">
      <span aria-live="polite" className="sr-only">{routeTitle}</span>
      <Shell hash={hash} theme={theme} onToggleTheme={() => setTheme((current) => current === "dark" ? "light" : "dark")}>
        {route.type === "dashboard" && <Dashboard />}
        {route.type === "browse" && <BrowseToolsPage />}
        {route.type === "category" && <CategoryPage category={route.category} />}
        {route.type === "tool" && <ToolPage tool={route.tool} />}
        {route.type === "missing" && <MissingPage />}
      </Shell>
    </div>
  );
}

function Shell({ children, hash, theme, onToggleTheme }: { children: React.ReactNode; hash: string; theme: ThemeMode; onToggleTheme: () => void }) {
  const [isScrolled, setIsScrolled] = useState(() => window.scrollY > 4);
  const [menuOpen, setMenuOpen] = useState(false);
  const primaryNavItems = useMemo(() => [
    { id: "dashboard", label: "Dashboard", href: "#dashboard" },
    ...categories.map((category) => ({
      id: category,
      label: category.replace(" Tools", ""),
      href: categoryRoute(category),
    })),
  ], []);
  const activeNavIndex = activePrimaryNavIndex(hash);

  useEffect(() => {
    const syncScroll = () => setIsScrolled(window.scrollY > 4);
    syncScroll();
    window.addEventListener("scroll", syncScroll, { passive: true });
    return () => window.removeEventListener("scroll", syncScroll);
  }, []);

  // Global "focus search" shortcut so Cmd/Ctrl+K works on every route, not just the dashboard.
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if ((window.location.hash || "#dashboard") !== "#dashboard") {
          // Dashboard is not mounted yet: flag the intent so it focuses search on mount.
          pendingSearchFocus = true;
          window.location.hash = "#dashboard";
        } else {
          // Already on the dashboard: focus immediately, no timeout race.
          window.dispatchEvent(new Event("myfilekit:focus-search"));
        }
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  // Close the mobile menu whenever the route changes.
  useEffect(() => { setMenuOpen(false); }, [hash]);

  return (
    <>
      <header className={`site-header sticky top-0 z-30 ${isScrolled ? "site-header-scrolled" : ""}`}>
        <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between gap-4 px-5 py-4 sm:px-6 lg:px-10 2xl:max-w-[1680px] 2xl:px-0">
          <a href="#dashboard" className="flex items-center text-[var(--ink)] no-underline">
            <span className="leading-tight">
              <span className="block font-display text-xl font-black">MyFileKit</span>
              <span className="block text-xs font-bold uppercase text-neutral-500">Local-first tools</span>
            </span>
          </a>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
            {primaryNavItems.map((item, index) => {
              const active = index === activeNavIndex;
              return (
                <a
                  key={item.id}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full px-3 py-2 text-sm no-underline transition hover:bg-[var(--paper-soft)] ${active ? "font-black text-[var(--ink)] underline decoration-2 underline-offset-8" : "font-semibold text-neutral-500 hover:text-[var(--ink)]"}`}
                >
                  {item.label}
                </a>
              );
            })}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <a className="secondary-button hidden w-fit no-underline lg:inline-flex" href="#browse-tools">Browse tools</a>
            <button
              className="grid h-11 w-11 place-items-center rounded-2xl border border-[var(--line)] bg-[var(--paper-soft)] text-[var(--ink)] lg:hidden"
              type="button"
              aria-label="Open navigation menu"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={22} />
            </button>
          </div>
        </div>
      </header>
      <MobileNav open={menuOpen} onClose={() => setMenuOpen(false)} activeHash={hash} />
      <main id="app-main" tabIndex={-1} className="mx-auto w-full max-w-screen-2xl px-5 pb-16 pt-7 outline-none sm:px-6 lg:px-10 2xl:max-w-[1680px] 2xl:px-0">
        {children}
      </main>
    </>
  );
}

function MobileNav({ open, onClose, activeHash }: { open: boolean; onClose: () => void; activeHash: string }) {
  const panelRef = useRef<HTMLElement | null>(null);
  // Read onClose through a ref so the drawer effect can depend only on `open` and
  // not re-run (resetting focus/scroll) when the parent re-renders a new onClose.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const activeCategory = useMemo(() => {
    const route = routeForHash(activeHash);
    return route.type === "category" ? route.category : route.type === "tool" ? route.tool.category : "";
  }, [activeHash]);

  useEffect(() => {
    if (!open) return;
    // Remember the trigger (hamburger button) so we can restore focus on close.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
        .filter((el) => el.offsetParent !== null || el === document.activeElement);

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // Trap Tab / Shift+Tab: cycle within the panel instead of escaping to the page.
      if (event.shiftKey) {
        if (active === first || !panel?.contains(active)) { event.preventDefault(); last.focus(); }
      } else if (active === last || !panel?.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKey);
    panel?.querySelector<HTMLElement>("a, button")?.focus();
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousBodyOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const linkClass = "flex min-h-11 items-center rounded-2xl px-4 py-3 text-sm font-semibold text-[var(--ink)] no-underline transition hover:bg-[var(--paper-soft)]";

  return (
    <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Site navigation" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <nav
        id="mobile-nav"
        ref={panelRef}
        aria-label="Site navigation"
        className="absolute right-0 top-0 flex h-full w-72 max-w-[82vw] flex-col gap-1 overflow-y-auto border-l border-[var(--line)] bg-[var(--app-bg)] p-4 shadow-[var(--shadow-lift)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="font-display text-lg font-semibold">Menu</span>
          <button className="grid h-11 w-11 place-items-center rounded-2xl border border-[var(--line)] text-[var(--ink)]" type="button" aria-label="Close navigation menu" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <a className={linkClass} href="#dashboard" aria-current={activeHash === "#dashboard" ? "page" : undefined} onClick={onClose}>Dashboard</a>
        {categories.map((category) => (
          <a key={category} className={linkClass} href={categoryRoute(category)} aria-current={activeCategory === category ? "page" : undefined} onClick={onClose}>
            {category}
          </a>
        ))}
        <a className={linkClass} href="#browse-tools" aria-current={activeHash === "#browse-tools" ? "page" : undefined} onClick={onClose}>Browse tools</a>
      </nav>
    </div>
  );
}

function ThemeToggle({ theme, onToggle }: { theme: ThemeMode; onToggle: () => void }) {
  const isDark = theme === "dark";
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={onToggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
      title={isDark ? "Light mode" : "Dark mode"}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {isDark ? <Sun size={17} /> : <Moon size={17} />}
      </span>
      <span className="hidden text-sm font-black xl:inline">{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}

function Dashboard() {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState(() => readSessionValue("myfilekit:lastSearch"));
  const [recentTools, setRecentTools] = useState<Tool[]>(() => loadRecentTools());
  const matches = useMemo(() => filterTools(query), [query]);
  const isSearching = Boolean(query.trim());
  const popularTools = popularToolIds.map(findToolById).filter(Boolean) as Tool[];
  const newTools = newAndNotableIds.map(findToolById).filter(Boolean) as Tool[];
  const distinctRecentTools = recentTools.filter((tool) => !popularToolIds.includes(tool.id)).slice(0, 4);
  const updateQuery = (value: string) => {
    setQuery(value);
    writeSessionValue("myfilekit:lastSearch", value);
  };
  const openBestMatch = () => {
    if (!query.trim()) {
      searchRef.current?.focus();
      return;
    }
    const [bestMatch] = matches;
    if (bestMatch) window.location.hash = bestMatch.route;
  };

  useEffect(() => {
    const handleGlobalSearch = (event: Event) => {
      const value = String((event as CustomEvent<string>).detail || "");
      updateQuery(value);
    };
    window.addEventListener("myfilekit:search", handleGlobalSearch);
    return () => window.removeEventListener("myfilekit:search", handleGlobalSearch);
  }, []);

  useEffect(() => {
    const handleRecentTools = () => setRecentTools(loadRecentTools());
    const handleFocusSearch = () => requestAnimationFrame(() => searchRef.current?.focus());
    window.addEventListener("myfilekit:recent-tools", handleRecentTools);
    window.addEventListener("storage", handleRecentTools);
    window.addEventListener("myfilekit:focus-search", handleFocusSearch);
    // Cmd/Ctrl+K arrived from another route: consume the pending intent once on mount.
    if (pendingSearchFocus) {
      pendingSearchFocus = false;
      handleFocusSearch();
    }
    return () => {
      window.removeEventListener("myfilekit:recent-tools", handleRecentTools);
      window.removeEventListener("storage", handleRecentTools);
      window.removeEventListener("myfilekit:focus-search", handleFocusSearch);
    };
  }, []);

  return (
    <div className="dashboard-page">
      <section className={`hero-panel surface-panel wabi-edge overflow-hidden ${isSearching ? "hero-panel-searching" : ""}`}>
        <div className="relative z-10 mx-auto grid max-w-6xl justify-items-center gap-6 px-6 py-10 text-center md:px-10 lg:px-12">
          <div className="grid w-full justify-items-center gap-5">
            {!isSearching && (
              <div className="grid justify-items-center gap-5">
                <div className="grid justify-items-center gap-3">
                  <p className="app-badge mx-auto w-fit text-xs font-black uppercase">Local-first file toolkit</p>
                  <h1 className="font-display text-5xl font-black md:text-7xl">MyFileKit</h1>
                </div>
                <p className="max-w-3xl text-xl font-semibold leading-snug text-neutral-700 md:text-2xl">
                  PDF, image, business, signature, and data tools — fast, private, and ready when you are.
                </p>
                <p className="max-w-2xl text-sm font-bold text-neutral-500">
                  Supported tools process files locally in your browser. No unnecessary uploads.
                </p>
              </div>
            )}
            <form className="spotlight-search surface-card wabi-card-edge flex w-full max-w-3xl items-center gap-3 p-3 text-left" role="search" onSubmit={(event) => { event.preventDefault(); openBestMatch(); }}>
              <button className="search-submit-button icon-tile grid h-11 w-11 place-items-center rounded-2xl" type="submit" aria-label={query ? "Open best matching tool" : "Focus search"}>
                <Search size={21} />
              </button>
              <input
                ref={searchRef}
                aria-label="Search MyFileKit tools"
                className="min-h-12 w-full bg-transparent text-lg font-semibold outline-none placeholder:text-neutral-400"
                value={query}
                onChange={(event) => updateQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") updateQuery("");
                  if (event.key === "Enter") {
                    event.preventDefault();
                    openBestMatch();
                  }
                }}
                placeholder="Search PDF, image, invoice, signature..."
                type="search"
              />
              {query ? (
                <button className="search-clear-button" type="button" aria-label="Clear search" onClick={() => { updateQuery(""); searchRef.current?.focus(); }}>
                  ×
                </button>
              ) : null}
            </form>
            {!isSearching && (
              <div className="flex max-w-3xl flex-wrap justify-center gap-2">
                {quickSearches.map((term) => (
                  <button key={term} className="quick-chip" type="button" onClick={() => { updateQuery(term); searchRef.current?.focus(); }}>
                    {term}
                  </button>
                ))}
              </div>
            )}
            <p className="text-sm font-bold text-neutral-500">
              {query ? `${matches.length} matching tool${matches.length === 1 ? "" : "s"}` : "Choose a task below or search by what you need to do."}
            </p>
            {isSearching && (
              <div className="hero-search-results" aria-live="polite">
                {matches.length ? (
                  matches.slice(0, 8).map((tool: Tool) => <SearchResultCard key={tool.id} tool={tool} />)
                ) : (
                  <div className="hero-empty-result">
                    <p className="font-black">No matching tool yet</p>
                    <p>Try a shorter task like “pdf”, “image”, “sign”, or “json”.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {!isSearching && popularTools.length > 0 && (
        <section className="dashboard-shelf">
          <SectionHeader title="Popular Tools" subtitle="Fast paths for the most common file tasks." />
          <div className="dashboard-tool-row">
            {popularTools.map((tool) => <ToolCard key={tool.id} tool={tool} compact />)}
          </div>
        </section>
      )}

      {!isSearching && newTools.length > 0 && (
        <section className="dashboard-shelf">
          <SectionHeader title="New & Notable" subtitle="The latest tools added to the kit." />
          <div className="dashboard-tool-row">
            {newTools.map((tool) => <ToolCard key={tool.id} tool={tool} compact />)}
          </div>
        </section>
      )}

      {!isSearching && distinctRecentTools.length > 0 && (
        <section className="dashboard-shelf">
          <SectionHeader title="Recently Used" subtitle="Quickly jump back into your last tools." />
          <div className="dashboard-tool-row">
            {distinctRecentTools.map((tool) => <ToolCard key={tool.id} tool={tool} compact />)}
          </div>
        </section>
      )}

      {!isSearching && <CategoryOverview />}
      {!isSearching && <ProductCommandStrip />}
      {!isSearching && <WhyMyFileKit />}
      {!isSearching && <Footer />}
    </div>
  );
}

function ProductCommandStrip() {
  const stats = [
    { icon: ShieldCheck, label: "Local-first processing", note: "Supported files stay in your browser" },
    { icon: Zap, label: "No unnecessary uploads", note: "Run common tasks without a server path" },
    { icon: Layers3, label: "Organized tools", note: "PDF, image, business, privacy, and data" },
    { icon: FolderSearch, label: "Search-first", note: "Find tools by task, category, or file type" },
  ];
  return (
    <section className="dashboard-shelf">
      <SectionHeader title="Privacy And Trust" subtitle="Simple guarantees for everyday file work." />
      <div className="command-strip" aria-label="Product highlights">
      {stats.map(({ icon: Icon, label, note }) => (
        <SpotlightCard className="command-stat" key={label}>
          <span className="command-stat-icon"><Icon size={17} /></span>
          <span>
            <span className="block text-sm font-black">{label}</span>
            <span className="block text-xs font-bold text-neutral-500">{note}</span>
          </span>
        </SpotlightCard>
      ))}
      </div>
    </section>
  );
}

function CategoryOverview() {
  return (
    <section className="dashboard-shelf">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeader title="Tool Categories" subtitle="Browse focused workspaces when you know the file type." />
        <a className="secondary-button w-fit" href="#browse-tools">Browse all tools</a>
      </div>
      <div className="category-overview-grid" aria-label="Tool categories">
      {categories.map((category) => {
        const Icon = categoryIcons[category] || Sparkles;
        const count = tools.filter((tool: Tool) => tool.category === category).length;
        return (
          <SpotlightCard key={category} href={categoryRoute(category)} className="category-card">
            <span className="category-icon"><Icon size={19} /></span>
            <span className="grid gap-1">
              <span className="font-black">{category}</span>
              <span className="text-sm font-semibold text-neutral-500">{categoryDetails[category]?.description}</span>
            </span>
            <span className="category-count">{count}</span>
          </SpotlightCard>
        );
      })}
      </div>
    </section>
  );
}

function WhyMyFileKit() {
  const points = [
    ["Search without friction", "Start with a task like merge, resize, invoice, hash, or metadata."],
    ["Working tools only", "Visible cards open real routes with practical export or download actions."],
    ["Built for your computer", "Runs in a modern browser on macOS, Windows, and Linux."],
    ["One practical workspace", "Move between common file tasks without installing a separate app for each one."],
  ];
  return (
    <section className="dashboard-shelf">
      <SectionHeader title="Why MyFileKit" subtitle="A quiet utility workspace for files you handle every day." />
      <div className="why-grid">
        {points.map(([title, description]) => (
          <SpotlightCard className="why-card" key={title}>
            <p className="font-black">{title}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-neutral-600">{description}</p>
          </SpotlightCard>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <span>MyFileKit</span>
      <span>Local-first file tools for PDF, image, business, signature, privacy, and data workflows.</span>
      <a className="footer-link" href="https://github.com/indranilroy99/myfilekit" target="_blank" rel="noreferrer" aria-label="MyFileKit on GitHub">
        <Icons.gitHub className="h-4 w-4" />
        GitHub
      </a>
    </footer>
  );
}

function SearchResultCard({ tool }: { tool: Tool }) {
  const Icon = iconForTool(tool);
  return (
    <a className="search-result-card" href={tool.route}>
      <span className="search-result-icon"><Icon size={18} /></span>
      <span className="min-w-0">
        <span className="block truncate font-black">{tool.name}</span>
        <span className="block truncate text-sm font-semibold text-neutral-500">{tool.category}</span>
      </span>
      <ChevronRight size={16} className="ml-auto shrink-0" />
    </a>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="font-display text-3xl font-black">{title}</h2>
      <p className="mt-1 font-semibold text-neutral-500">{subtitle}</p>
    </div>
  );
}

function ToolSection({ title, tools: sectionTools, searchMode = false, layout = "row" }: { title: string; tools: Tool[]; searchMode?: boolean; layout?: "row" | "grid" }) {
  const Icon = categoryIcons[title] || Sparkles;
  const details = categoryDetails[title];
  return (
    <section className="dashboard-tool-section">
      <div className="category-heading flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="category-icon"><Icon size={19} /></span>
          <div>
            <h3 className="font-display text-xl font-black">{title}</h3>
            {details && <p className="mt-1 text-sm font-semibold text-neutral-500">{details.description}</p>}
          </div>
        </div>
        {!searchMode && categories.includes(title) && (
          <a className="moss-text text-sm font-black no-underline" href={categoryRoute(title)}>
            View all <ChevronRight className="inline" size={15} />
          </a>
        )}
      </div>
      <div className={layout === "grid" ? "tool-grid" : "dashboard-tool-row"}>
        {sectionTools.map((tool: Tool) => <ToolCard key={tool.id} tool={tool} compact={layout === "row"} />)}
      </div>
    </section>
  );
}

function ToolCard({ tool, compact = false }: { tool: Tool; compact?: boolean }) {
  const Icon = iconForTool(tool);
  const visibleBadges = (tool.badges || []).filter((badge: string) => !["Local", "Local processing", categoryDetails[tool.category]?.accent].includes(badge)).slice(0, 2);
  const multiFile = multiFileLabel(tool);
  const primaryBadge = categoryDetails[tool.category]?.accent || tool.category.replace(" Tools", "");
  return (
    <SpotlightCard className={`tool-card group p-0 transition hover:-translate-y-1 ${compact ? "min-h-40" : "min-h-52"}`}>
      <a href={tool.route} className={`tool-card-link gap-4 rounded-3xl p-5 transition focus-visible:-translate-y-1 ${compact ? "min-h-40" : "min-h-52"}`}>
        <div className="flex items-start justify-between gap-3">
          <span className="icon-tile grid h-12 w-12 place-items-center rounded-2xl transition group-hover:rotate-3">
            <Icon size={21} />
          </span>
          <span className="tool-arrow" aria-hidden="true"><ChevronRight size={17} /></span>
        </div>
        <div>
          <h4 className="text-lg font-black">{tool.name}</h4>
          <p className={`tool-description mt-1 text-sm font-semibold leading-6 text-neutral-600 ${compact ? "tool-description-compact" : ""}`}>{tool.description}</p>
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          {tool.isNew && <span className="new-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">New</span>}
          <span className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">{primaryBadge}</span>
          {!compact && visibleBadges.map((badge: string) => <span key={badge} className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">{badge}</span>)}
          {!compact && multiFile && <span className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">{multiFile}</span>}
          {!compact && fileTypeLabel(tool) && <span className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">{fileTypeLabel(tool)}</span>}
        </div>
      </a>
    </SpotlightCard>
  );
}

function BrowseToolsPage() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const isSearching = Boolean(query.trim());
  const visibleTools = useMemo(() => filterTools(query), [query]);
  const totalPages = Math.max(1, Math.ceil(visibleTools.length / browseToolsPageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * browseToolsPageSize;
  const pageTools = visibleTools.slice(pageStart, pageStart + browseToolsPageSize);
  const grouped = categories
    .map((category) => [category, pageTools.filter((tool: Tool) => tool.category === category)] as const)
    .filter(([, items]) => items.length);
  const rangeStart = visibleTools.length ? pageStart + 1 : 0;
  const rangeEnd = Math.min(pageStart + pageTools.length, visibleTools.length);

  useEffect(() => {
    setPage(1);
  }, [query]);

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow="Tool library"
        title="Browse tools"
        subtitle="Browse by category or search by task, file type, or outcome."
        icon={FolderSearch}
        badges={["Local-first", `${visibleTools.length} tools`]}
      />
      <section className="surface-panel wabi-edge p-6">
        <div className="category-filter mb-5 flex items-center gap-3">
          <Search size={18} />
          <input
            aria-label="Search all tools"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search all tools..."
          />
          {query && <button type="button" aria-label="Clear tools search" onClick={() => setQuery("")}>×</button>}
        </div>
        <div className="grid gap-10">
          {grouped.map(([category, items]) => (
            <ToolSection key={category} title={category} tools={items} searchMode={isSearching} layout="grid" />
          ))}
        </div>
        {visibleTools.length > browseToolsPageSize && (
          <div className="pagination-shell mt-8 flex flex-col items-center justify-between gap-4 p-4 sm:flex-row">
            <p className="text-sm font-black text-neutral-500">
              Showing {rangeStart}-{rangeEnd} of {visibleTools.length} tools
            </p>
            <NumberedPagination count={visibleTools.length} page={currentPage} pageSize={browseToolsPageSize} onPageChange={setPage} />
          </div>
        )}
        {!visibleTools.length && <EmptyState query={query} onPick={setQuery} />}
      </section>
    </div>
  );
}

function CategoryPage({ category }: { category: string }) {
  const [query, setQuery] = useState("");
  const categoryTools = tools.filter((tool: Tool) => tool.category === category);
  const visibleTools = query.trim()
    ? categoryTools.filter((tool: Tool) => searchableText(tool).includes(query.trim().toLowerCase()))
    : categoryTools;
  const Icon = categoryIcons[category] || Sparkles;
  const details = categoryDetails[category];
  const groupOrder = (categoryGroups as Record<string, string[]>)[category];
  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={details?.accent || "Tools"}
        title={category}
        subtitle={details?.description || "Choose any working tool below."}
        icon={Icon}
        badges={[`${categoryTools.length} ${categoryTools.length === 1 ? "tool" : "tools"}`]}
      />
      <section className="surface-panel wabi-edge p-6">
        <div className="category-filter mb-5 flex items-center gap-3">
          <Search size={18} />
          <input
            aria-label={`Search ${category}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${category.replace(" Tools", "").toLowerCase()} tools...`}
          />
          {query && <button type="button" aria-label="Clear category search" onClick={() => setQuery("")}>×</button>}
        </div>
        {groupOrder && visibleTools.some((tool: Tool) => tool.group) ? (
          <div className="grid gap-8">
            {groupOrder.map((group) => {
              const groupTools = visibleTools.filter((tool: Tool) => tool.group === group);
              if (!groupTools.length) return null;
              return (
                <div key={group} className="grid gap-4">
                  {/* Reuses the dashboard/browse sub-heading style (see ToolSection). */}
                  <h3 className="font-display text-xl font-black">{group}</h3>
                  <div className="tool-grid">
                    {groupTools.map((tool: Tool) => <ToolCard key={tool.id} tool={tool} />)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="tool-grid">
            {visibleTools.map((tool: Tool) => <ToolCard key={tool.id} tool={tool} />)}
          </div>
        )}
        {!visibleTools.length && <EmptyState query={query} onPick={setQuery} />}
      </section>
    </div>
  );
}

function ToolPage({ tool }: { tool: Tool }) {
  const related = tools.filter((item: Tool) => item.category === tool.category && item.id !== tool.id);
  const Icon = iconForTool(tool);
  useEffect(() => {
    saveRecentTool(tool.id);
  }, [tool.id]);

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={tool.category}
        title={tool.name}
        subtitle={tool.description}
        icon={Icon}
        badges={[fileTypeLabel(tool), multiFileLabel(tool), tool.category].filter(Boolean)}
      />
      <section className="grid gap-6">
        <div className="surface-panel wabi-edge tool-page-panel p-5 md:p-7">
          <div className="tool-action-panel">
            <ToolRenderer tool={tool} />
          </div>
        </div>
        {related.length > 0 && (
          <section className="related-tools-section">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <SectionHeader title={`More ${tool.category.replace(" Tools", "")} Tools`} subtitle="Keep working in the same category." />
              <a className="secondary-button w-fit" href={categoryRoute(tool.category)}>View category</a>
            </div>
            <div className="dashboard-tool-row">
              {related.slice(0, 6).map((item: Tool) => <ToolCard key={item.id} tool={item} compact />)}
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

function ToolMetaPanel({ status, onReset, children }: { status: Status; onReset: () => void; children?: React.ReactNode }) {
  const [downloadReady, setDownloadReady] = useState<DownloadReady | null>(null);
  const canReview = downloadReady ? /^(application\/pdf|application\/json|image\/|text\/)/.test(downloadReady.mimeType) : false;
  const canPrint = downloadReady ? /^(application\/pdf|image\/|text\/html)/.test(downloadReady.mimeType) : false;

  useEffect(() => {
    const handleDownloadReady = (event: Event) => {
      const detail = (event as CustomEvent<DownloadReady>).detail;
      if (!detail?.url || !detail?.filename) return;
      setDownloadReady((current) => {
        if (current?.url && current.url !== detail.url) revokeDownloadUrl(current.url);
        return detail;
      });
    };

    window.addEventListener("myfilekit:download-ready", handleDownloadReady);
    return () => {
      window.removeEventListener("myfilekit:download-ready", handleDownloadReady);
      setDownloadReady((current) => {
        if (current?.url) revokeDownloadUrl(current.url);
        return null;
      });
    };
  }, []);

  const resetPanel = () => {
    setDownloadReady((current) => {
      if (current?.url) revokeDownloadUrl(current.url);
      return null;
    });
    onReset();
  };

  return (
    <aside className="tool-form-status">
      <div>
        <p className="text-xs font-black uppercase text-neutral-500">Status</p>
        <StatusBox status={status} />
        {status.progress ? <ProgressBar value={status.progress.value} total={status.progress.total} label={status.progress.label} /> : null}
      </div>
      {children}
      {downloadReady ? (
        <div className="surface-muted wabi-card-edge grid gap-3 p-4 text-sm font-semibold leading-6 text-neutral-600">
          <div>
            <p className="text-xs font-black uppercase text-neutral-500">Export ready</p>
            <p className="mt-1 break-words text-[var(--foreground)]">{downloadReady.filename}</p>
            <p className="mt-1 text-xs font-semibold text-neutral-500">{formatBytes(downloadReady.size)} · Ready in this browser session</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canReview ? <a className="secondary-button no-underline" href={downloadReady.url} target="_blank" rel="noopener noreferrer">
              <Eye size={16} /> Review
            </a> : null}
            <a className="secondary-button no-underline" href={downloadReady.url} download={downloadReady.filename}>
              <Download size={16} /> Download
            </a>
            {canPrint ? <button className="secondary-button" type="button" onClick={() => printDownloadUrl(downloadReady.url)}>
              <Printer size={16} /> Print
            </button> : null}
          </div>
        </div>
      ) : null}
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        Supported files are processed locally in this browser session. Reset clears the current form state.
      </div>
      <SecondaryButton label="Reset" onClick={resetPanel} />
    </aside>
  );
}

function ToolForm({ children, status, onReset }: { children: React.ReactNode; status: Status; onReset: () => void }) {
  return (
    <div className="tool-form-grid">
      <div className="tool-form-actions">
        {children}
      </div>
      <ToolMetaPanel status={status} onReset={onReset} />
    </div>
  );
}

/** Shared determinate progress bar: accessible, single-accent fill, matches the P2P transfer bar. */
function ProgressBar({ value, total, label }: { value: number; total: number; label: string }) {
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((value / total) * 100))) : 0;
  return (
    <div className="mt-3 grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs font-bold text-neutral-500">
        <span className="min-w-0 break-words">{label}</span>
        <span className="tabular-nums">{percent}% · {value}/{total}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--paper-soft)]" role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-[var(--moss)] transition-[width] duration-200" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function StatusBox({ status }: { status: Status }) {
  const tone = status.tone === "error"
    ? "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger-fg)]"
    : status.tone === "success"
      ? "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success-fg)]"
      : "border-[var(--line)] bg-[var(--paper-soft)] text-[var(--stone)]";
  return <p role="status" aria-live="polite" className={`min-h-12 whitespace-pre-line rounded-lg border px-4 py-3 text-sm font-bold ${tone}`}>{status.message}</p>;
}

/** A persistent, result-attached consequence note — survives the transient status message. */
function ResultConsequenceNote({ children }: { children: React.ReactNode }) {
  return (
    <div role="note" className="grid gap-1 rounded-lg border border-[var(--line)] bg-[var(--paper-soft)] p-4 text-sm font-semibold leading-6 text-neutral-600">
      <p className="text-xs font-black uppercase text-neutral-500">Keep in mind</p>
      <p className="text-[var(--foreground)]">{children}</p>
    </div>
  );
}

function FileControl({ accept, multiple = false, files, setFiles, label }: { accept: string; multiple?: boolean; files: File[]; setFiles: (files: File[]) => void; label?: string }) {
  const [isDragging, setIsDragging] = useState(false);
  const heading = label || `Choose or drop file${multiple ? "s" : ""}`;
  const ariaLabel = label || `Choose ${multiple ? "files" : "file"}`;
  const acceptList = accept.split(",").map((item) => item.trim()).filter(Boolean);
  const matchesAccept = (file: File) => {
    if (!acceptList.length || acceptList.includes("*/*")) return true;
    return acceptList.some((rule) => rule === file.type || (rule.endsWith("/*") && file.type.startsWith(rule.slice(0, -1))));
  };
  return <label
    className={`surface-card grid cursor-pointer gap-3 rounded-3xl border-dashed border-neutral-300 p-5 transition hover:border-[var(--moss)] ${isDragging ? "border-[var(--moss)] bg-[var(--paper-soft)]" : ""}`}
    onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
    onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
    onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }}
    onDrop={(event) => {
      event.preventDefault();
      setIsDragging(false);
      const dropped = Array.from(event.dataTransfer.files || []);
      const filtered = dropped.filter(matchesAccept);
      setFiles(filtered.length ? filtered : dropped);
    }}
  >
    <span className="flex items-center gap-3 font-black"><Upload size={20} /> {heading}</span>
    <input aria-label={ariaLabel} className="sr-only" type="file" accept={accept} multiple={multiple} onChange={(event) => setFiles(Array.from(event.target.files || []))} />
    <span className="text-sm font-semibold text-neutral-500">{files.length ? files.map((file) => file.name).join(", ") : "No file selected"}</span>
  </label>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-[var(--border)] pb-2 last:border-b-0 last:pb-0 sm:grid-cols-[140px_1fr]">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="break-words text-[var(--foreground)]">{value}</dd>
    </div>
  );
}

function Input({ label, value, onChange, placeholder = "", helper = "", type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; helper?: string; type?: string }) {
  return <label className="grid gap-2"><span className="text-xs font-black uppercase text-neutral-500">{label}</span><input className="field-input" type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />{helper && <span className="text-xs font-semibold text-neutral-500">{helper}</span>}</label>;
}

function Textarea({ label, value, onChange, rows = 8 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return <label className="grid gap-2"><span className="text-xs font-black uppercase text-neutral-500">{label}</span><textarea className="field-input resize-y leading-6" rows={rows} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Select({ label, value, onChange, options, labels = options }: { label: string; value: string; onChange: (value: string) => void; options: string[]; labels?: string[] }) {
  return <label className="grid gap-2"><span className="text-xs font-black uppercase text-neutral-500">{label}</span><select className="field-input" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option, index) => <option key={option} value={option}>{labels[index]}</option>)}</select></label>;
}

function Range({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-2"><span className="text-xs font-black uppercase text-neutral-500">{label}: {value}</span><input type="range" min="0.25" max="0.95" step="0.05" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="surface-card flex items-center gap-3 rounded-2xl px-4 py-3 font-bold"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}

function usePendingHandler(onClick: () => unknown) {
  const [pending, setPending] = useState(false);
  const handleClick = async () => {
    if (pending) return;
    try {
      setPending(true);
      await onClick();
    } finally {
      setPending(false);
    }
  };
  return { pending, handleClick };
}

function PrimaryButton({ label, onClick, disabled = false }: { label: string; onClick: () => unknown; disabled?: boolean }) {
  const { pending, handleClick } = usePendingHandler(onClick);
  const isDownload = label.toLowerCase().startsWith("download");
  const busyLabel = isDownload ? "Downloading…" : "Working…";
  const Idle = isDownload ? Download : Zap;

  return (
    <LiquidButton className="primary-button" onClick={handleClick} disabled={pending || disabled} aria-busy={pending}>
      {pending ? <Loader2 className="animate-spin" size={17} /> : <Idle size={17} />}
      {pending ? busyLabel : label}
    </LiquidButton>
  );
}

function SecondaryButton({ label, onClick }: { label: string; onClick: () => unknown }) {
  const { pending, handleClick } = usePendingHandler(onClick);
  return <button className="secondary-button" type="button" onClick={handleClick} disabled={pending} aria-busy={pending}>{label}</button>;
}

function EmptyState({ query, onPick }: { query: string; onPick?: (term: string) => void }) {
  const runSuggestion = (term: string) => {
    if (onPick) {
      onPick(term);
      return;
    }
    sessionStorage.setItem("myfilekit:lastSearch", term);
    window.dispatchEvent(new CustomEvent("myfilekit:search", { detail: term }));
  };

  return (
    <div className="surface-card rounded-3xl border-dashed border-neutral-300 p-10 text-center">
      <p className="font-display text-2xl font-black">No tools found for “{query}”</p>
      <p className="mx-auto mt-2 max-w-xl font-semibold text-neutral-500">Try a shorter task name or one of the common searches below.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {quickSearches.map((term) => (
          <button key={term} className="quick-chip" type="button" onClick={() => runSuggestion(term)}>
            {term}
          </button>
        ))}
      </div>
    </div>
  );
}

function PageHeader({ eyebrow, title, subtitle, icon: Icon, badges = [] }: { eyebrow: string; title: string; subtitle: string; icon: any; badges?: string[] }) {
  return (
    <header className="page-header">
      <div className="flex min-w-0 items-start gap-4">
        <span className="icon-tile page-header-icon grid place-items-center rounded-2xl"><Icon size={24} /></span>
        <div className="min-w-0">
          <p className="moss-text text-xs font-black uppercase">{eyebrow}</p>
          <h1 className="font-display page-title font-black">{title}</h1>
          <p className="mt-2 max-w-3xl font-semibold leading-7 text-neutral-600">{subtitle}</p>
          {badges.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {badges.map((badge) => (
                <span key={badge} className="tag-badge rounded-full px-3 py-1 text-xs font-black uppercase">{badge}</span>
              ))}
            </div>
          )}
        </div>
      </div>
      <Toolbar />
    </header>
  );
}

function Toolbar() {
  return (
    <div className="page-toolbar flex flex-wrap items-center justify-end gap-2" aria-label="Page navigation">
      <div className="flex flex-wrap gap-2">
        <button className="nav-action nav-action-icon" type="button" aria-label="Go back" title="Back" onClick={() => history.back()}><ArrowLeft size={18} /></button>
        <button className="nav-action nav-action-icon" type="button" aria-label="Go forward" title="Forward" onClick={() => history.forward()}><ArrowRight size={18} /></button>
        <a className="nav-action nav-action-icon" aria-label="Dashboard" title="Dashboard" href="#dashboard"><LayoutDashboard size={18} /></a>
      </div>
    </div>
  );
}

function ToolRenderer({ tool }: { tool: Tool }) {
  if (tool.id === "invoice-generator-tool") return <InvoiceLauncher />;
  if (tool.id === "gst-invoice-tool") return <GstInvoiceTool />;
  if (tool.id === "pos-billing-tool") return <PosBillingTool />;
  if (tool.id === "gst-filing-prep-tool") return <GstFilingPrepTool tool={tool} />;
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
  if (tool.id === "add-signature-to-pdf-tool") return <AddSignatureToPdfTool tool={tool} />;
  if (tool.id === "annotate-pdf-tool") return <AnnotatePdfTool tool={tool} />;
  if (tool.id === "pdf-page-numbers-tool") return <PdfPageNumbersTool tool={tool} />;
  if (tool.id === "watermark-pdf-tool") return <WatermarkPdfTool tool={tool} />;
  if (tool.id === "pdf-metadata-cleaner-tool") return <PdfMetadataCleanerTool tool={tool} />;
  if (tool.id === "pdf-to-image-tool") return <PdfToImageTool tool={tool} />;
  if (tool.id === "extract-text-tool") return <ExtractTextTool tool={tool} />;
  if (tool.id === "summarize-pdf-tool") return <SummarizePdfTool tool={tool} />;
  if (tool.id === "chat-with-pdf-tool") return <ChatWithPdfTool tool={tool} />;
  if (tool.id === "translate-pdf-tool") return <TranslatePdfTool tool={tool} />;
  if (tool.id === "compress-pdf-tool") return <CompressPdfTool tool={tool} />;
  if (tool.id === "pdf-to-zip-tool") return <PdfToZipTool tool={tool} />;
  if (tool.id === "flatten-pdf-tool") return <FlattenPdfTool tool={tool} />;
  if (tool.id === "invert-pdf-tool") return <InvertPdfTool tool={tool} />;
  if (tool.id === "images-to-pdf-tool") return <PdfFileTool tool={tool} action="Create PDF" multiple accept="image/jpeg,image/png,image/webp" run={(files) => imagesToPdf(files).then((bytes) => downloadBytes(bytes, "myfilekit-images.pdf", "application/pdf"))} />;
  if (tool.id === "organize-pages-tool") return <OrganizePagesTool tool={tool} />;
  if (tool.id === "crop-resize-pdf-tool") return <CropResizePdfTool tool={tool} />;
  if (tool.id === "headers-footers-tool") return <HeadersFootersTool tool={tool} />;
  if (tool.id === "fill-pdf-form-tool") return <FillPdfFormTool tool={tool} />;
  if (tool.id === "redact-pdf-tool") return <RedactPdfTool tool={tool} />;
  if (tool.id === "auto-redact-pii-tool") return <AutoRedactPiiTool tool={tool} />;
  if (tool.id === "privacy-scanner-tool") return <PrivacyScannerTool tool={tool} />;
  if (tool.id === "pdf-analyzer-tool") return <PdfAnalyzerTool tool={tool} />;
  if (tool.id === "sanitize-pdf-tool") return <SanitizePdfTool tool={tool} />;
  if (tool.id === "extract-images-tool") return <ExtractImagesTool tool={tool} />;
  if (tool.id === "create-pdf-tool") return <CreatePdfTool />;
  if (tool.id === "repair-pdf-tool") return <RepairPdfTool tool={tool} />;
  if (tool.id === "fingerprint-pdf-tool") return <FingerprintPdfTool tool={tool} />;
  if (tool.id === "encrypt-pdf-tool") return <EncryptPdfTool tool={tool} />;
  if (tool.id === "remove-password-tool") return <RemovePasswordTool tool={tool} />;
  if (tool.id === "unlock-pdf-tool") return <UnlockPdfTool tool={tool} />;
  if (tool.id === "sign-pdf-tool") return <SignPdfTool tool={tool} />;
  if (tool.id === "verify-signature-tool") return <VerifySignatureTool tool={tool} />;
  if (["compress-image-tool", "convert-image-tool"].includes(tool.id)) return <ImageOutputTool tool={tool} mode={tool.id === "compress-image-tool" ? "compress" : "convert"} />;
  if (tool.id === "batch-compress-images-tool") return <BatchImageTool tool={tool} mode="compress" />;
  if (tool.id === "batch-resize-images-tool") return <BatchImageTool tool={tool} mode="resize" />;
  if (tool.id === "resize-image-tool") return <ResizeImageTool tool={tool} />;
  if (tool.id === "crop-image-tool") return <CropImageTool tool={tool} />;
  if (tool.id === "rotate-flip-image-tool") return <RotateFlipImageTool tool={tool} />;
  if (tool.id === "add-text-to-image-tool") return <AddTextToImageTool tool={tool} />;
  if (tool.id === "image-metadata-inspector-tool") return <ImageMetadataInspectorTool tool={tool} />;
  if (tool.id === "add-signature-to-image-tool") return <AddSignatureToImageTool tool={tool} />;
  if (tool.id === "draw-signature-tool") return <DrawSignatureTool />;
  if (tool.id === "type-signature-tool") return <TypeSignatureTool />;
  if (tool.id === "text-to-pdf-tool") return <TextToPdfTool />;
  if (tool.id === "markdown-preview-tool") return <MarkdownTool />;
  if (tool.id === "markdown-to-pdf-tool") return <MarkdownToPdfTool />;
  if (tool.id === "csv-to-pdf-tool") return <CsvToPdfTool />;
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
  if (tool.id === "audio-to-pdf-tool") return <AudioToPdfTool />;
  if (tool.id === "equation-to-image-tool") return <EquationToImageTool />;
  if (tool.id === "handwriting-to-pdf-tool") return <HandwritingToPdfTool tool={tool} />;
  if (tool.id === "scan-to-pdf-tool") return <ScanToPdfTool />;
  if (tool.id === "json-formatter-tool") return <JsonTool />;
  if (tool.id === "csv-to-json-tool") return <CsvToJsonTool />;
  if (tool.id === "json-to-csv-tool") return <JsonToCsvTool />;
  if (tool.id === "json-to-yaml-tool") return <JsonToYamlTool />;
  if (tool.id === "url-codec-tool") return <UrlCodecTool />;
  if (tool.id === "diff-checker-tool") return <DiffCheckerTool />;
  if (tool.id === "word-counter-tool") return <WordCounterTool />;
  if (tool.id === "metadata-cleaner") return <MetadataCleanerTool tool={tool} />;
  if (tool.id === "base64-tool") return <Base64Tool />;
  if (tool.id === "file-hash-tool") return <FileHashTool tool={tool} />;
  if (tool.id === "hash-compare-tool") return <HashCompareTool tool={tool} />;
  if (tool.id === "password-generator-tool") return <PasswordGeneratorTool />;
  if (tool.id === "qr-code-generator-tool") return <QrCodeTool />;
  if (tool.id === "p2p-share-tool") return <P2pShareTool tool={tool} />;
  if (tool.id === "collab-whiteboard-tool") return <WhiteboardTool />;
  return <StatusBox status={{ tone: "error", message: "This tool renderer is missing." }} />;
}

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
          return `Preview ready for ${pages.length} selected page${pages.length === 1 ? "" : "s"}.`;
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
          <p className="text-xs font-black uppercase text-neutral-500">Generated PDF</p>
          <p className="mt-1 font-black text-[var(--foreground)]">{result.filename}</p>
          <p className="mt-1 text-sm font-semibold text-neutral-500">{result.pages} page{result.pages === 1 ? "" : "s"} from {result.sourceName}</p>
        </div>
        <span className="tag-badge rounded-full px-3 py-1 text-xs font-black uppercase">{formatBytes(result.blob.size)}</span>
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
  return <ToolForm status={status} onReset={() => { setFiles([]); setText(""); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      This places new text on top of the PDF. It does not rewrite existing embedded PDF text.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Input label="Text" value={text} onChange={setText} />
    <div className="grid gap-3 sm:grid-cols-4"><Input label="Page" value={page} onChange={setPage} type="number" /><Input label="X" value={x} onChange={setX} type="number" /><Input label="Y" value={y} onChange={setY} type="number" /><Input label="Size" value={size} onChange={setSize} type="number" /></div>
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
      const { loadPdfDocument } = await import("./lib/pdfjs");
      const loaded = await loadPdfDocument(buffer.slice());
      if (cancelled) { try { await loaded.destroy(); } catch { /* ignore */ } return "Ready."; }
      setFileName(file.name);
      setPageCount(loaded.numPages);
      setCurrentPage(1);
      setDoc(loaded);
      return `Loaded ${file.name} — ${loaded.numPages} page${loaded.numPages === 1 ? "" : "s"}. Click any text on the page to edit it.`;
    });
    return () => { cancelled = true; };
  }, [files, tool.file]);

  // Render the current page to a backdrop image and extract its clickable runs.
  useEffect(() => {
    if (!doc) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { renderPdfPageToCanvas, pdfjs } = await import("./lib/pdfjs");
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
      <div className="surface-muted wabi-card-edge grid gap-1 p-4 text-sm font-semibold leading-6 text-neutral-600">
        <p className="text-xs font-black uppercase text-neutral-500">How this works — and its limits</p>
        <p className="text-[var(--foreground)]">Click a line of existing text, edit the string, and Apply. On export the original glyphs are covered with a rectangle in the sampled background colour and your new text is drawn on top at the same spot.</p>
        <ul className="ml-4 list-disc">
          <li>This is an <strong>overlay edit, not a reflow</strong>: text does not re-wrap. A longer replacement can overflow its box; a shorter one leaves a gap. Only the clicked run changes — nothing around it moves.</li>
          <li>Font matching is <strong>approximate</strong> (Helvetica / Times / Courier substitute). The original embedded font is not reused, so glyph shapes and spacing may differ slightly.</li>
          <li>The original text is <strong>visually covered, not stripped</strong> from the file — for permanent removal use <a className="underline" href="#redact-pdf-tool">Redact PDF</a>.</li>
          <li>Needs a real text layer. Scanned / image-only PDFs have no text runs — run <a className="underline" href="#ocr-pdf-tool">OCR / Searchable PDF</a> first.</li>
          <li>Replacement text is <strong>Latin-1 only</strong> (no CJK or emoji).</li>
        </ul>
      </div>

      <FileControl accept="application/pdf" files={files} setFiles={setFiles} />

      {doc && pageCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button className="secondary-button" type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}><ArrowLeft size={16} /> Prev</button>
            <span className="text-sm font-black tabular-nums">Page {currentPage} / {pageCount}</span>
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
          <p className="text-xs font-black uppercase text-neutral-500">Selected text · page {currentPage}</p>
          <p className="break-words rounded-lg border border-[var(--border)] bg-[var(--paper-soft)] px-3 py-2 font-mono text-sm text-neutral-600">{selectedRun.str}</p>
          <label className="grid gap-2">
            <span className="text-xs font-black uppercase text-neutral-500">Replacement text (leave empty to delete)</span>
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
                <span className="text-xs font-black uppercase text-neutral-500">p{edit.page}</span>
                <span className="min-w-0 break-words font-mono text-neutral-500 line-through">{edit.original}</span>
                <ArrowRight size={14} />
                <span className="min-w-0 break-words font-mono text-[var(--foreground)]">{edit.text || "(deleted)"}</span>
                <button className="ml-auto text-xs font-black uppercase text-[var(--danger-fg)] hover:underline" type="button" onClick={() => removeEdit(key)}>Remove</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <PrimaryButton label="Apply edits & download" disabled={editList.length === 0} onClick={() => runSafely(setStatus, async () => {
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
        return `Applied ${editList.length} edit${editList.length === 1 ? "" : "s"} to ${fileName}. Remember: text was overlaid, not reflowed.`;
      })} />

      <ResultConsequenceNote>Edits are applied by covering and redrawing — the surrounding text is never re-flowed, and the original text remains in the file underneath the cover. For permanent removal of sensitive text, use Redact PDF instead.</ResultConsequenceNote>
    </ToolForm>
  );
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
  return <ToolForm status={status} onReset={() => { setFiles([]); setSignatures([]); setStatus(initialStatus); }}>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} label="Choose PDF" />
    <FileControl accept="image/jpeg,image/png,image/webp" files={signatures} setFiles={setSignatures} label="Choose signature image" />
    <div className="grid gap-3 sm:grid-cols-4"><Input label="Page" value={page} onChange={setPage} type="number" /><Input label="X" value={x} onChange={setX} type="number" /><Input label="Y" value={y} onChange={setY} type="number" /><Input label="Width" value={width} onChange={setWidth} type="number" /></div>
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
      const { loadPdfDocument } = await import("./lib/pdfjs");
      const loaded = await loadPdfDocument(buffer.slice());
      if (cancelled) { try { await loaded.destroy(); } catch { /* ignore */ } return "Ready."; }
      setFileName(file.name);
      setPageCount(loaded.numPages);
      setCurrentPage(1);
      setDoc(loaded);
      return `Loaded ${file.name} — ${loaded.numPages} page${loaded.numPages === 1 ? "" : "s"}. Pick a tool and mark up the page.`;
    });
    return () => { cancelled = true; };
  }, [files, tool.file]);

  // Render the current page to a backdrop image.
  useEffect(() => {
    if (!doc) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { renderPdfPageToCanvas } = await import("./lib/pdfjs");
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
        <p className="text-xs font-black uppercase text-neutral-500">How this works — and its limits</p>
        <p className="text-[var(--foreground)]">Pick a tool, mark up the page, navigate pages, then export. Your markup is <strong>flattened (burned) into the page</strong> on export.</p>
        <ul className="ml-4 list-disc">
          <li>Flattened markup renders <strong>identically in every reader</strong> and cannot be tampered with as data — but it is <strong>not reader-editable</strong> (no selectable /Annot objects). Edit here before exporting.</li>
          <li>The original page content stays intact <strong>underneath</strong> the markup; a highlight is drawn as a translucent marker over it.</li>
          <li>Text notes and sticky notes are <strong>Latin-1 only</strong> (no CJK or emoji).</li>
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
                className={`rounded-full border px-3 py-1.5 text-xs font-black uppercase transition ${activeTool === t.id ? "border-[var(--moss)] bg-[var(--moss)] text-white" : "border-[var(--line)] bg-[var(--paper-soft)] text-neutral-600 hover:border-[var(--moss)]"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            {activeTool === "highlight" && (
              <div className="grid gap-2">
                <span className="text-xs font-black uppercase text-neutral-500">Highlight colour</span>
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
              <span className="text-sm font-black tabular-nums">Page {currentPage} / {pageCount}</span>
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

      <ResultConsequenceNote>Annotations are flattened (burned) into the page on export — they render the same in every reader, but are not reader-editable annotation objects. Keep this working file open if you still need to move or delete marks. For permanent removal of underlying content, use Redact PDF.</ResultConsequenceNote>
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

function PdfMetadataCleanerTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      This removes common PDF document metadata fields such as title, author, subject, keywords, creator, and producer. It does not claim to redact page content or hidden objects.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PrimaryButton label="Clean PDF metadata" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const bytes = await cleanPdfMetadata(file);
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-metadata-cleaned`, "pdf"), "application/pdf");
      return `Common document metadata cleaned from ${file.name}.`;
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
      const images = await pdfToImages(file, { format, dpi: Number(dpi), quality: Number(quality) });
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

function ExtractTextTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setText(""); setStatus(initialStatus); }}>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PrimaryButton label="Extract text" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const extracted = await extractPdfText(file);
      setText(extracted);
      return extracted.trim()
        ? "Extracted text from the PDF."
        : "No selectable text found — this PDF is likely scanned images.";
    })} />
    <Textarea label="Extracted text" value={text} onChange={setText} rows={12} />
    <div className="flex flex-wrap gap-2">
      <SecondaryButton label="Copy" onClick={() => runSafely(setStatus, async () => { await copyText(text); return "Copied."; })} />
      <SecondaryButton label="Download .txt" onClick={() => runSafely(setStatus, async () => {
        downloadText(requireOutput(text), `${safeFilename(files[0]?.name || "extracted")}-text`, "txt");
        return "Text file ready to download.";
      })} />
    </div>
  </ToolForm>;
}

type LlmSettings = ReturnType<typeof readLlmSettings>;
type SummaryResult = ReturnType<typeof summarizeText>;
type PassageIndex = ReturnType<typeof buildPassageIndex>;
type PassageHit = ReturnType<typeof searchPassages>[number];
type QaEntry = { id: number; question: string; hits: PassageHit[]; answer: string };

const NO_PDF_TEXT_MESSAGE = "No selectable text found — this PDF is likely scanned images. Run the OCR / Searchable PDF tool first, then use the searchable PDF it produces.";

/**
 * Optional bring-your-own-LLM settings, stored in localStorage on this device.
 * Off by default; while it is off no tool in this app makes a network request.
 */
function LlmEndpointPanel({ settings, onChange }: { settings: LlmSettings; onChange: (next: LlmSettings) => void }) {
  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState("");
  const [panelStatus, setPanelStatus] = useState(initialStatus);
  const configured = isLlmConfigured(settings);
  const origin = endpointOrigin(settings.baseUrl);

  return (
    <div className="surface-muted wabi-card-edge grid gap-3 p-4 text-sm font-semibold leading-6 text-neutral-600">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black uppercase text-neutral-500">Optional AI endpoint — {configured ? "on" : "off"}</p>
        <button className="secondary-button" type="button" onClick={() => setOpen(!open)}>{open ? "Hide settings" : "Settings"}</button>
      </div>
      <p>
        {configured
          ? `Your own endpoint is switched on. When you press an AI button, the document text is sent to ${origin} and is no longer local. Nothing is sent until you press one.`
          : "This tool is fully local. You can optionally point it at your own OpenAI-compatible endpoint; until you do, nothing leaves this device."}
      </p>
      {open && (
        <div className="grid gap-3">
          <p className="text-xs font-semibold text-neutral-500">
            The key is stored only in this browser's localStorage, is never placed in a URL, and is only ever sent as an Authorization header to the endpoint you enter.
            MyFileKit ships a strict Content-Security-Policy that blocks every outbound connection, so a custom endpoint only works on a deploy where you have added
            <span className="whitespace-pre"> connect-src 'self' &lt;your origin&gt; </span>
            to index.html and public/_headers.
          </p>
          <Input label="Base URL" value={baseUrl} onChange={setBaseUrl} placeholder="https://api.example.com/v1" helper="Requests go to <base URL>/chat/completions." />
          <Input label="Model" value={model} onChange={setModel} placeholder="gpt-4o-mini" />
          <Input label="API key" value={apiKey} onChange={setApiKey} type="password" helper={settings.apiKey ? `Saved key: ${maskApiKey(settings.apiKey)}. Leave blank to keep it.` : "Stored on this device only."} />
          <StatusBox status={panelStatus} />
          <div className="flex flex-wrap gap-2">
            <SecondaryButton label="Save and enable" onClick={() => runSafely(setPanelStatus, async () => {
              const next = saveLlmSettings({ enabled: true, baseUrl, model, apiKey: apiKey || settings.apiKey });
              onChange(next);
              setApiKey("");
              return `Enabled. AI actions will send text to ${endpointOrigin(next.baseUrl)}.`;
            })} />
            <SecondaryButton label="Turn off and forget" onClick={() => runSafely(setPanelStatus, async () => {
              onChange(clearLlmSettings());
              setBaseUrl("");
              setModel("");
              setApiKey("");
              return "Endpoint cleared. Everything is local again.";
            })} />
          </div>
        </div>
      )}
    </div>
  );
}

function KeywordChips({ keywords }: { keywords: SummaryResult["keywords"] }) {
  if (!keywords.length) return null;
  return (
    <div className="grid gap-2">
      <p className="text-xs font-black uppercase text-neutral-500">Top keywords</p>
      <div className="flex flex-wrap gap-2">
        {keywords.map((keyword) => (
          <span key={keyword.term} className="tag-badge rounded-full px-3 py-1 text-xs font-black">{keyword.term} · {keyword.count}</span>
        ))}
      </div>
    </div>
  );
}

/** Highlights matched terms with React nodes, so document text is never raw HTML. */
function HighlightedPassage({ text, terms }: { text: string; terms: string[] }) {
  return (
    <p className="text-sm font-semibold leading-6 text-[var(--foreground)]">
      {highlightSegments(text, terms).map((segment, position) => (
        segment.match
          ? <mark key={position} className="rounded bg-[color-mix(in_srgb,var(--primary)_22%,transparent)] px-0.5 text-[var(--foreground)]">{segment.text}</mark>
          : <span key={position}>{segment.text}</span>
      ))}
    </p>
  );
}

function SummarizePdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [length, setLength] = useState("5");
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [aiSummary, setAiSummary] = useState("");
  const [settings, setSettings] = useState<LlmSettings>(() => readLlmSettings());
  const [status, setStatus] = useState(initialStatus);

  const lengthOptions = ["3", "5", "10", "p10", "p25"];
  const lengthLabels = ["3 sentences", "5 sentences", "10 sentences", "10% of the document", "25% of the document"];
  const baseName = safeFilename(files[0]?.name || "document");

  const summaryDocument = () => {
    if (!result) throw new Error("Summarise a PDF first.");
    const lines = [
      `Summary of ${files[0]?.name || "document"}`,
      `${result.stats.returned} of ${result.stats.sentenceCount} sentences · ${result.stats.wordCount} words in the source`,
      "",
      ...result.sentences.map((sentence, position) => `${position + 1}. ${sentence.text}`),
      "",
      `Keywords: ${result.keywords.map((keyword) => keyword.term).join(", ")}`,
    ];
    if (aiSummary) lines.push("", "Abstractive summary from your own endpoint:", aiSummary);
    return lines.join("\n");
  };

  const reset = () => {
    setFiles([]);
    setText("");
    setResult(null);
    setAiSummary("");
    setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Extracts the PDF's text, then ranks its sentences with a local TextRank graph over TF-IDF similarity and returns the most central ones, skipping near-duplicates. This is an <strong>extractive</strong> summary: every sentence is copied verbatim from the document, so nothing is invented — but it will not read like freshly written prose.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={(next) => { setFiles(next); setText(""); setResult(null); setAiSummary(""); }} />
    <Select label="Summary length" value={length} onChange={setLength} options={lengthOptions} labels={lengthLabels} />
    <PrimaryButton label="Summarise PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      let source = text;
      if (!source.trim()) {
        source = await extractPdfText(file, { onProgress: pageProgress(setStatus, "Reading") });
        if (!source.trim()) throw new Error(NO_PDF_TEXT_MESSAGE);
        setText(source);
      }
      setStatus({ tone: "idle", message: "Ranking sentences…" });
      const options = length.startsWith("p") ? { percent: Number(length.slice(1)) } : { sentences: Number(length) };
      const summary = summarizeText(source, options);
      setResult(summary);
      setAiSummary("");
      return `Kept ${summary.stats.returned} of ${summary.stats.sentenceCount} sentences.`;
    })} />
    {result && (
      <div className="surface-card grid gap-4 rounded-3xl p-5">
        <div>
          <p className="text-xs font-black uppercase text-neutral-500">Extractive summary</p>
          <ol className="mt-2 grid list-decimal gap-2 pl-5 text-sm font-semibold leading-6 text-[var(--foreground)]">
            {result.sentences.map((sentence) => <li key={sentence.index}>{sentence.text}</li>)}
          </ol>
        </div>
        <KeywordChips keywords={result.keywords} />
        <p className="text-xs font-semibold text-neutral-500">
          {result.stats.wordCount} words · {result.stats.sentenceCount} sentences · ranked {result.stats.graphSentences} candidates
        </p>
      </div>
    )}
    <div className="flex flex-wrap gap-2">
      <SecondaryButton label="Copy summary" onClick={() => runSafely(setStatus, async () => { await copyText(result?.summary || ""); return "Copied."; })} />
      <SecondaryButton label="Download .txt" onClick={() => runSafely(setStatus, async () => {
        downloadText(requireOutput(summaryDocument()), `${baseName}-summary`, "txt");
        return "Text file ready to download.";
      })} />
      <SecondaryButton label="Download .pdf" onClick={() => runSafely(setStatus, async () => {
        downloadBytes(await textToPdf(requireOutput(summaryDocument())), withExtension(`${baseName}-summary`, "pdf"), "application/pdf");
        return "Summary PDF ready to download.";
      })} />
    </div>
    <LlmEndpointPanel settings={settings} onChange={setSettings} />
    {isLlmConfigured(settings) && (
      <div className="grid gap-3">
        <PrimaryButton label={`Abstractive summary (sends text to ${endpointOrigin(settings.baseUrl)})`} onClick={() => runSafely(setStatus, async () => {
          const source = requireOutput(text);
          const { system, prompt, truncated } = buildSummaryPrompt(source);
          setStatus({ tone: "idle", message: `Sending the document text to ${endpointOrigin(settings.baseUrl)}…` });
          const answer = await requestChatCompletion({ settings, system, prompt });
          setAiSummary(answer);
          return truncated ? "Abstractive summary received (the document was truncated to fit)." : "Abstractive summary received.";
        })} />
        {aiSummary && (
          <div className="surface-card grid gap-2 rounded-3xl p-5">
            <p className="text-xs font-black uppercase text-neutral-500">Abstractive summary — generated off this device</p>
            <p className="whitespace-pre-line text-sm font-semibold leading-6 text-[var(--foreground)]">{aiSummary}</p>
          </div>
        )}
      </div>
    )}
  </ToolForm>;
}

function ChatWithPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [index, setIndex] = useState<PassageIndex | null>(null);
  const [question, setQuestion] = useState("");
  const [topN, setTopN] = useState("3");
  const [history, setHistory] = useState<QaEntry[]>([]);
  const [settings, setSettings] = useState<LlmSettings>(() => readLlmSettings());
  const [status, setStatus] = useState(initialStatus);

  const baseName = safeFilename(files[0]?.name || "document");
  const configured = isLlmConfigured(settings);

  const transcript = () => {
    if (!history.length) throw new Error("Ask a question first.");
    return [`Questions about ${files[0]?.name || "document"}`, ""].concat(
      [...history].reverse().flatMap((entry) => [
        `Q: ${entry.question}`,
        ...entry.hits.map((hit) => `  [page ${hit.page}] ${hit.chunk.text}`),
        ...(entry.answer ? ["", `  Generated answer (from your endpoint): ${entry.answer}`] : []),
        "",
      ])
    ).join("\n");
  };

  const generateAnswer = (entry: QaEntry) => runSafely(setStatus, async () => {
    const { system, prompt } = buildAnswerPrompt(entry.question, entry.hits);
    setStatus({ tone: "idle", message: `Sending ${entry.hits.length} passages to ${endpointOrigin(settings.baseUrl)}…` });
    const answer = await requestChatCompletion({ settings, system, prompt });
    setHistory((current) => current.map((item) => (item.id === entry.id ? { ...item, answer } : item)));
    return "Answer generated from the retrieved passages.";
  });

  const reset = () => {
    setFiles([]);
    setIndex(null);
    setQuestion("");
    setHistory([]);
    setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      By default this is a <strong>local search</strong>, not a chatbot. It indexes the PDF page by page with BM25 and returns the passages that best match your question, with page numbers and matched terms highlighted. It does not write prose and it never invents an answer — you read the source text and judge it yourself.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={(next) => { setFiles(next); setIndex(null); setHistory([]); }} />
    <PrimaryButton label="Index this PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const pages: { page: number; text: string }[] = [];
      await extractPdfText(file, {
        onProgress: pageProgress(setStatus, "Reading"),
        onPage: (page: number, pageText: string) => pages.push({ page, text: pageText }),
      });
      if (!pages.some((page) => page.text.trim())) throw new Error(NO_PDF_TEXT_MESSAGE);
      setStatus({ tone: "idle", message: "Building the search index…" });
      const built = buildPassageIndex(chunkPages(pages));
      if (!built.count) throw new Error("This PDF has text but no passages long enough to search.");
      setIndex(built);
      setHistory([]);
      return `Indexed ${built.count} passage${built.count === 1 ? "" : "s"} across ${built.pageCount} page${built.pageCount === 1 ? "" : "s"}. Ask a question.`;
    })} />
    <Input label="Your question" value={question} onChange={setQuestion} placeholder="What is the payment deadline?" helper={index ? `${index.count} passages indexed. Follow-up questions re-search the same index.` : "Index a PDF first."} />
    <Select label="Passages to return" value={topN} onChange={setTopN} options={["3", "5", "8"]} labels={["Top 3", "Top 5", "Top 8"]} />
    <PrimaryButton label="Find answer passages" disabled={!index} onClick={() => runSafely(setStatus, async () => {
      if (!index) throw new Error("Index a PDF before asking a question.");
      if (!question.trim()) throw new Error("Type a question first.");
      const hits = searchPassages(index, question, { limit: Number(topN) });
      if (!hits.length) throw new Error("No passage in this PDF matches those words. Try different terms.");
      setHistory((current) => [{ id: current.length + 1, question: question.trim(), hits, answer: "" }, ...current]);
      return `Found ${hits.length} passage${hits.length === 1 ? "" : "s"} on page${hits.length === 1 ? "" : "s"} ${[...new Set(hits.map((hit) => hit.page))].join(", ")}.`;
    })} />
    {history.map((entry) => (
      <div key={entry.id} className="surface-card grid gap-3 rounded-3xl p-5">
        <p className="text-xs font-black uppercase text-neutral-500">Question</p>
        <p className="text-sm font-black text-[var(--foreground)]">{entry.question}</p>
        {entry.hits.map((hit) => (
          <div key={hit.chunk.id} className="surface-muted wabi-card-edge grid gap-1 p-4">
            <p className="text-xs font-black uppercase text-neutral-500">Page {hit.page} · relevance {hit.score.toFixed(2)}</p>
            <HighlightedPassage text={hit.chunk.text} terms={hit.matchedTerms} />
          </div>
        ))}
        {configured && <SecondaryButton label={`Generate an answer from these passages (sends them to ${endpointOrigin(settings.baseUrl)})`} onClick={() => generateAnswer(entry)} />}
        {entry.answer && (
          <div className="surface-muted wabi-card-edge grid gap-1 p-4">
            <p className="text-xs font-black uppercase text-neutral-500">Generated answer — produced off this device</p>
            <p className="whitespace-pre-line text-sm font-semibold leading-6 text-[var(--foreground)]">{entry.answer}</p>
          </div>
        )}
      </div>
    ))}
    <div className="flex flex-wrap gap-2">
      <SecondaryButton label="Copy history" onClick={() => runSafely(setStatus, async () => { await copyText(transcript()); return "Copied."; })} />
      <SecondaryButton label="Download .txt" onClick={() => runSafely(setStatus, async () => {
        downloadText(requireOutput(transcript()), `${baseName}-questions`, "txt");
        return "Text file ready to download.";
      })} />
      <SecondaryButton label="Download .pdf" onClick={() => runSafely(setStatus, async () => {
        downloadBytes(await textToPdf(requireOutput(transcript())), withExtension(`${baseName}-questions`, "pdf"), "application/pdf");
        return "Q&A PDF ready to download.";
      })} />
    </div>
    <LlmEndpointPanel settings={settings} onChange={setSettings} />
  </ToolForm>;
}

const TRANSLATE_LANGUAGES = [
  "Arabic", "Bengali", "Chinese (Simplified)", "Dutch", "English", "French", "German",
  "Gujarati", "Hindi", "Indonesian", "Italian", "Japanese", "Kannada", "Korean",
  "Malayalam", "Marathi", "Portuguese", "Punjabi", "Russian", "Spanish", "Tamil",
  "Telugu", "Thai", "Turkish", "Ukrainian", "Vietnamese",
];

function TranslatePdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("Spanish");
  const [translation, setTranslation] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [settings, setSettings] = useState<LlmSettings>(() => readLlmSettings());
  const [status, setStatus] = useState(initialStatus);

  const configured = isLlmConfigured(settings);
  const baseName = safeFilename(files[0]?.name || "document");

  const reset = () => {
    setFiles([]); setText(""); setTranslation(""); setProgress(null); setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Extracting the PDF's text is <strong>100% local</strong>. Translation is not: it needs your own OpenAI-compatible endpoint, configured below and <strong>off by default</strong>. Until you turn one on, nothing is sent and no translation happens — this tool does not pretend to translate offline. Long documents are split into ordered chunks that fit the model, translated one at a time, and reassembled.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={(next) => { setFiles(next); setText(""); setTranslation(""); setProgress(null); }} label="Choose the PDF to translate" />
    <Select label="Translate into" value={language} onChange={setLanguage} options={TRANSLATE_LANGUAGES} />
    <SecondaryButton label="Extract text (local)" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const source = await extractPdfText(file, { onProgress: pageProgress(setStatus, "Reading") });
      if (!source.trim()) throw new Error(NO_PDF_TEXT_MESSAGE);
      setText(source);
      setTranslation("");
      return `Extracted ${source.length.toLocaleString()} characters. ${configured ? "Press Translate to send them to your endpoint." : "Configure your endpoint below to translate."}`;
    })} />
    {text && (
      <div className="surface-card grid gap-2 rounded-3xl p-5">
        <p className="text-xs font-black uppercase text-neutral-500">Extracted text (local, not yet sent anywhere)</p>
        <p className="max-h-40 overflow-auto whitespace-pre-line text-sm font-semibold leading-6 text-[var(--foreground)]">{text.slice(0, 2000)}{text.length > 2000 ? "\n…" : ""}</p>
      </div>
    )}
    <LlmEndpointPanel settings={settings} onChange={setSettings} />
    {configured ? (
      <PrimaryButton label={`Translate to ${language} (sends text to ${endpointOrigin(settings.baseUrl)})`} onClick={() => runSafely(setStatus, async () => {
        let source = text;
        if (!source.trim()) {
          const [file] = validateFiles(files, tool.file);
          source = await extractPdfText(file, { onProgress: pageProgress(setStatus, "Reading") });
          if (!source.trim()) throw new Error(NO_PDF_TEXT_MESSAGE);
          setText(source);
        }
        setTranslation("");
        setProgress({ done: 0, total: 1 });
        const result = await translateDocument(source, {
          settings,
          targetLanguage: language,
          onProgress: (done: number, total: number) => setProgress({ done, total }),
        });
        setTranslation(result.text);
        setProgress(null);
        return `Translated ${result.chunks} chunk${result.chunks === 1 ? "" : "s"} into ${language} via ${endpointOrigin(settings.baseUrl)}.`;
      })} />
    ) : (
      <p className="text-sm font-semibold leading-6 text-neutral-600">
        No endpoint is configured, so translation is unavailable. Open the panel above, add your own OpenAI-compatible endpoint, and allow its origin in <span className="whitespace-pre">connect-src</span>. Nothing leaves this device until you do.
      </p>
    )}
    {progress && <ProgressBar value={progress.done} total={progress.total} label={`Translating chunk ${Math.min(progress.done + 1, progress.total)} of ${progress.total} into ${language}`} />}
    {translation && (
      <div className="surface-card grid gap-3 rounded-3xl p-5">
        <p className="text-xs font-black uppercase text-neutral-500">Translation — {language} · generated off this device</p>
        <p className="whitespace-pre-line text-sm font-semibold leading-6 text-[var(--foreground)]">{translation}</p>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton label="Copy translation" onClick={() => runSafely(setStatus, async () => { await copyText(translation); return "Copied."; })} />
          <SecondaryButton label="Download .txt" onClick={() => runSafely(setStatus, async () => {
            downloadText(requireOutput(translation), `${baseName}-${safeFilename(language)}`, "txt");
            return "Text file ready to download.";
          })} />
          <SecondaryButton label="Download .pdf" onClick={() => runSafely(setStatus, async () => {
            downloadBytes(await textToPdf(requireOutput(translation)), withExtension(`${baseName}-${safeFilename(language)}`, "pdf"), "application/pdf");
            return "Translated PDF ready to download.";
          })} />
        </div>
      </div>
    )}
    {translation && <ResultConsequenceNote>This translation was produced by <strong>your own endpoint</strong>, off this device — its accuracy and privacy are whatever that endpoint provides. A machine translation is a draft, not a certified translation. The text export uses Latin-1 fonts, so a PDF export of a non-Latin script may not render; use the .txt export for those.</ResultConsequenceNote>}
  </ToolForm>;
}

function CompressPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState("0.6");
  const [dpi, setDpi] = useState("120");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      This rasterises each page to a JPEG image, so selectable text becomes part of the image. Best for image-heavy or scanned PDFs.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Select label="Resolution (DPI)" value={dpi} onChange={setDpi} options={["96", "120", "150", "200"]} labels={["96 · smallest", "120 · default", "150 · sharp", "200 · sharpest"]} />
    <Range label="JPEG quality" value={quality} onChange={setQuality} />
    <PrimaryButton label="Compress PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const { bytes, before, after } = await rasterCompressPdf(file, { quality: Number(quality), dpi: Number(dpi) });
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-compressed`, "pdf"), "application/pdf");
      const saved = before > 0 ? Math.round((1 - after / before) * 100) : 0;
      return after >= before
        ? `Original: ${formatBytes(before)}\nOutput: ${formatBytes(after)}\nNote: the output is not smaller — this PDF may already be optimised. Try a lower DPI or quality.`
        : `Original: ${formatBytes(before)}\nOutput: ${formatBytes(after)}\nSaved about ${saved}%.`;
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
      const bytes = await flattenPdf(file, { dpi: Number(dpi) });
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
      const bytes = await invertPdf(file, { dpi: Number(dpi) });
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
        <PrimaryButton label="Fill & download PDF" onClick={() => runSafely(setStatus, async () => {
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
  const [areas, setAreas] = useState("1, 10, 10, 40, 8");
  const [dpi, setDpi] = useState("150");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Redaction rasterises the whole PDF to images and paints opaque black boxes on the listed areas, so covered content is permanently removed — not just hidden. Selectable text is lost.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
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

type PiiRect = { page: number; x: number; y: number; w: number; h: number };
type PiiHit = { id: string; page: number; type: string; value: string; masked: string; confidence: number; note: string; rects: PiiRect[] };
type PiiScan = {
  pages: number;
  pagesWithText: number;
  hasTextLayer: boolean;
  offPageItems: number;
  hits: PiiHit[];
  summary: { total: number; high: number; types: Array<{ type: string; label: string; count: number; high: number }> };
};
type PdfStructureScan = {
  pages: number;
  encrypted: boolean;
  info: Record<string, string>;
  xmp: { present: boolean; bytes: number; fields: Array<{ label: string; value: string }> };
  attachments: Array<{ name: string; type: string; description?: string; size: number }>;
  embeddedFileStreams: number;
  embeddedFileBytes: number;
  signatures: Array<{ name: string; reason: string }>;
  links: Array<{ page: number; subtype: string; uri: string }>;
  invisibleText: Array<{ page: number; invisible: number; whiteOnWhite: number }>;
  contentTruncated: boolean;
};

// redactPdf accepts { dpi, onProgress }, but the type inferred from that plain
// JS module only surfaces the defaulted `dpi`, so the progress callback is
// passed through this typed alias rather than being dropped.
const redactPdfWithProgress = redactPdf as (
  file: File,
  rects: PiiRect[],
  options: { dpi: number; onProgress: (page: number, total: number) => void }
) => Promise<Uint8Array>;

// Values are shown masked unless the operator explicitly reveals them, and no
// PII value is ever written into a status message, a filename, or the console.
function piiDisplayValue(hit: PiiHit, reveal: boolean) {
  return reveal ? hit.value : hit.masked;
}

function confidenceTone(confidence: number) {
  if (confidence >= PII_CONFIDENCE.HIGH) return "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger-fg)]";
  if (confidence >= PII_CONFIDENCE.MEDIUM) return "border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning-fg)]";
  return "border-[var(--line)] bg-[var(--paper-soft)] text-[var(--stone)]";
}

function ConfidenceTag({ confidence }: { confidence: number }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black uppercase ${confidenceTone(confidence)}`}>{confidenceLabel(confidence)}</span>;
}

function groupHitsByType(hits: PiiHit[]) {
  const groups = new Map<string, PiiHit[]>();
  for (const hit of hits) {
    const list = groups.get(hit.type) || [];
    list.push(hit);
    groups.set(hit.type, list);
  }
  return [...groups.entries()]
    .map(([type, list]) => ({ type, label: PII_TYPE_LABELS[type as keyof typeof PII_TYPE_LABELS] || type, hits: list }))
    .sort((a, b) => b.hits.length - a.hits.length || a.label.localeCompare(b.label));
}

function AutoRedactPiiTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [scan, setScan] = useState<PiiScan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reveal, setReveal] = useState(false);
  const [dpi, setDpi] = useState("150");
  const [redacted, setRedacted] = useState(false);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => {
    setFiles([]);
    setScan(null);
    setSelected(new Set());
    setReveal(false);
    setRedacted(false);
    setStatus(initialStatus);
  };

  // Scanning happens page by page as soon as a file is chosen, so a long
  // document reports progress instead of freezing behind one blocking call.
  useEffect(() => {
    let cancelled = false;
    setScan(null);
    setSelected(new Set());
    setReveal(false);
    setRedacted(false);
    if (!files.length) return undefined;

    runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const result = (await extractPdfPiiHits(file, { onProgress: pageProgress(setStatus, "Scanning") })) as PiiScan;
      if (cancelled) return "Ready.";
      setScan(result);
      if (!result.hasTextLayer) {
        return `No selectable text was found on any of the ${result.pages} page${result.pages === 1 ? "" : "s"}. This looks like a scan, so there is nothing to match patterns against — run OCR / Searchable PDF first, then come back.`;
      }
      const preselect = result.hits.filter((hit) => hit.confidence >= PII_CONFIDENCE.HIGH && isPersonalType(hit.type) && hit.rects.length > 0);
      setSelected(new Set(preselect.map((hit) => hit.id)));
      return `Scanned ${result.pages} page${result.pages === 1 ? "" : "s"}: ${result.summary.total} pattern match${result.summary.total === 1 ? "" : "es"}, ${result.summary.high} high confidence. ${preselect.length} high-confidence personal value${preselect.length === 1 ? " is" : "s are"} pre-selected — review every box before redacting.`;
    });

    return () => {
      cancelled = true;
    };
  }, [files, tool.file]);

  const groups = useMemo(() => groupHitsByType(scan?.hits || []), [scan]);
  const selectedHits = useMemo(() => (scan?.hits || []).filter((hit) => selected.has(hit.id)), [scan, selected]);
  const selectedRects = useMemo(() => selectedHits.flatMap((hit) => hit.rects), [selectedHits]);

  const toggleHit = (hit: PiiHit, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(hit.id);
      else next.delete(hit.id);
      return next;
    });
  };

  const toggleType = (hits: PiiHit[], checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const hit of hits) {
        if (!hit.rects.length) continue;
        if (checked) next.add(hit.id);
        else next.delete(hit.id);
      }
      return next;
    });
  };

  return (
    <ToolForm status={status} onReset={reset}>
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        Finds Aadhaar (Verhoeff-checked), PAN, payment cards (Luhn-checked), GSTIN, IFSC, account numbers, passport numbers, emails, phone numbers, dates of birth, IPs and URLs in the PDF's text layer, then permanently removes the ones you tick. Redaction rasterises every page to an image and paints opaque boxes over the matches, so the text underneath is genuinely gone — the honest trade is that the output is flattened: selectable text, links, and form fields are lost for the whole document. Nothing leaves this browser.
      </div>
      <FileControl accept="application/pdf" files={files} setFiles={setFiles} />

      {scan && !scan.hasTextLayer && (
        <div className="surface-card wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
          <p className="font-black text-[var(--foreground)]">No text layer</p>
          <p className="mt-1">This PDF has no extractable text, so pattern detection has nothing to read. Run <a className="underline" href="#ocr-pdf-tool">OCR / Searchable PDF</a> to add a text layer, then scan the OCR'd copy here. If you only need to cover regions you can see, use <a className="underline" href="#redact-pdf-tool">Redact PDF</a> with manual coordinates.</p>
        </div>
      )}

      {scan && scan.hasTextLayer && (
        <div className="surface-card wabi-card-edge grid gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-black">Matches found</p>
              <p className="mt-1 text-sm font-semibold text-neutral-500">
                {scan.summary.total} match{scan.summary.total === 1 ? "" : "es"} across {scan.pagesWithText} page{scan.pagesWithText === 1 ? "" : "s"} with text · {scan.summary.high} high confidence · {selected.size} selected ({selectedRects.length} area{selectedRects.length === 1 ? "" : "s"} to paint)
              </p>
            </div>
            <Checkbox label={reveal ? "Values revealed" : "Reveal full values"} checked={reveal} onChange={setReveal} />
          </div>
          {groups.length ? (
            <div className="grid gap-3">
              {groups.map((group) => {
                const selectable = group.hits.filter((hit) => hit.rects.length > 0);
                const allSelected = selectable.length > 0 && selectable.every((hit) => selected.has(hit.id));
                return (
                  <div key={group.type} className="surface-muted wabi-card-edge grid gap-2 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-black text-[var(--foreground)]">{group.label} · {group.hits.length}</p>
                      <Checkbox label={allSelected ? `Deselect all ${group.label}` : `Select all ${group.label}`} checked={allSelected} onChange={(checked) => toggleType(group.hits, checked)} />
                    </div>
                    <div className="grid gap-1">
                      {group.hits.map((hit) => (
                        <label key={hit.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-semibold text-neutral-600">
                          <input type="checkbox" checked={selected.has(hit.id)} disabled={!hit.rects.length} onChange={(event) => toggleHit(hit, event.target.checked)} />
                          <span className="text-xs font-black uppercase text-neutral-500">p{hit.page}</span>
                          <span className="break-all font-mono text-[var(--foreground)]">{piiDisplayValue(hit, reveal)}</span>
                          <ConfidenceTag confidence={hit.confidence} />
                          {hit.rects.length ? <span className="text-xs">{hit.rects.length} area{hit.rects.length === 1 ? "" : "s"}</span> : <span className="text-xs text-[var(--danger-fg)]">no rectangle found — redact this one manually</span>}
                          {hit.note ? <span className="text-xs text-neutral-500">{hit.note}</span> : null}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm font-semibold text-neutral-500">No known patterns matched. That is not proof the document is clean — names, addresses, and free-text details are not detectable by pattern.</p>
          )}
          <div className="surface-muted wabi-card-edge p-3 text-sm font-semibold leading-6 text-neutral-600">
            A match is located through pdf.js text items, and one item can hold more characters than the match itself. When a match covers only part of an item the WHOLE item rectangle is painted, so neighbouring characters on that run are lost too. That is deliberate: over-redacting beats leaving half an Aadhaar number visible. Check every page of the output before you share it.
          </div>
        </div>
      )}

      <Select label="Output resolution (DPI)" value={dpi} onChange={setDpi} options={["120", "150", "200", "300"]} labels={["120 · smaller", "150 · default", "200 · high", "300 · print"]} />
      <PrimaryButton label="Redact selected matches" onClick={() => runSafely(setStatus, async () => {
        const [file] = validateFiles(files, tool.file);
        if (!scan) throw new Error("Wait for the scan to finish first.");
        if (!scan.hasTextLayer) throw new Error("This PDF has no text layer to scan. Run OCR / Searchable PDF first.");
        if (!selectedHits.length) throw new Error("Tick at least one match to redact.");
        if (!selectedRects.length) throw new Error("The selected matches have no page rectangles, so nothing can be painted. Use Redact PDF with manual coordinates instead.");
        const bytes = await redactPdfWithProgress(file, selectedRects, { dpi: Number(dpi), onProgress: pageProgress(setStatus, "Rasterising") });
        downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-redacted`, "pdf"), "application/pdf");
        const pages = new Set(selectedRects.map((rect) => rect.page)).size;
        setRedacted(true);
        return `Painted ${selectedRects.length} area${selectedRects.length === 1 ? "" : "s"} for ${selectedHits.length} match${selectedHits.length === 1 ? "" : "es"} across ${pages} page${pages === 1 ? "" : "s"}, then rebuilt every page as an image.`;
      })} />
      {redacted && <ResultConsequenceNote>The covered text is gone from the output, and the whole document is now flattened. Verify the result before sharing.</ResultConsequenceNote>}
    </ToolForm>
  );
}

function PrivacyScannerTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [scan, setScan] = useState<PiiScan | null>(null);
  const [structure, setStructure] = useState<PdfStructureScan | null>(null);
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => {
    setFiles([]);
    setScan(null);
    setStructure(null);
    setReveal(false);
    setStatus(initialStatus);
  };

  useEffect(() => {
    let cancelled = false;
    setScan(null);
    setStructure(null);
    setReveal(false);
    if (!files.length) return undefined;

    runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const textScan = (await extractPdfPiiHits(file, { onProgress: pageProgress(setStatus, "Reading") })) as PiiScan;
      if (cancelled) return "Ready.";
      const documentScan = (await scanPdfStructure(file, { onProgress: pageProgress(setStatus, "Inspecting") })) as PdfStructureScan;
      if (cancelled) return "Ready.";
      setScan(textScan);
      setStructure(documentScan);
      const notes: string[] = [];
      if (!textScan.hasTextLayer) notes.push("no text layer (scanned document — pattern scanning needs OCR first)");
      if (documentScan.encrypted) notes.push("encrypted");
      if (documentScan.attachments.length || documentScan.embeddedFileStreams) notes.push("carries embedded files");
      if (documentScan.invisibleText.length) notes.push("contains hidden or invisible text");
      return `Scanned ${documentScan.pages} page${documentScan.pages === 1 ? "" : "s"}: ${textScan.summary.high} high-confidence personal-data match${textScan.summary.high === 1 ? "" : "es"} of ${textScan.summary.total} total${notes.length ? `; ${notes.join("; ")}` : ""}. Nothing was uploaded and no file was modified.`;
    });

    return () => {
      cancelled = true;
    };
  }, [files, tool.file]);

  const groups = useMemo(() => groupHitsByType(scan?.hits || []), [scan]);
  const destinations = useMemo(() => (scan?.hits || []).filter((hit) => hit.type === "url" || hit.type === "ipv4" || hit.type === "ipv6"), [scan]);
  const reportText = useMemo(() => {
    if (!scan || !structure || !files.length) return "";
    return buildPrivacyReportText({ fileName: files[0].name, fileSize: files[0].size, scan, structure, reveal });
  }, [scan, structure, files, reveal]);

  return (
    <ToolForm status={status} onReset={reset}>
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        A read-only privacy audit: personal-data patterns with page numbers, Info-dictionary and XMP metadata leaks, invisible or off-page text, link destinations, embedded files, encryption, and signature entries. Your file is never modified and never leaves this browser. Values are masked until you reveal them.
      </div>
      <FileControl accept="application/pdf" files={files} setFiles={setFiles} />

      {scan && structure && (
        <>
          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-black">Overview</p>
              <Checkbox label={reveal ? "Values revealed" : "Reveal full values"} checked={reveal} onChange={setReveal} />
            </div>
            <dl className="grid gap-2 text-sm font-semibold text-neutral-600 lg:grid-cols-2">
              <InfoRow label="Pages" value={String(structure.pages)} />
              <InfoRow label="Pages with text" value={`${scan.pagesWithText}${scan.hasTextLayer ? "" : " (no text layer — run OCR to scan a scan)"}`} />
              <InfoRow label="Pattern matches" value={`${scan.summary.total} total · ${scan.summary.high} high confidence`} />
              <InfoRow label="Encrypted" value={structure.encrypted ? "Yes" : "No"} />
              <InfoRow label="Signature entries" value={String(structure.signatures.length)} />
              <InfoRow label="Embedded files" value={`${structure.attachments.length} named · ${structure.embeddedFileStreams} stream${structure.embeddedFileStreams === 1 ? "" : "s"}`} />
              <InfoRow label="Link annotations" value={String(structure.links.length)} />
              <InfoRow label="Hidden-text pages" value={String(structure.invisibleText.length)} />
            </dl>
            <div className="flex flex-wrap gap-2">
              <SecondaryButton label="Download .txt report" onClick={() => {
                if (!reportText) throw new Error("Scan a file first.");
                downloadText(reportText, `${safeFilename(files[0].name)}-privacy-report`, "txt");
              }} />
              <SecondaryButton label="Download .pdf report" onClick={async () => {
                if (!reportText) throw new Error("Scan a file first.");
                try {
                  const bytes = await textToPdf(reportText);
                  downloadBytes(bytes, withExtension(`${safeFilename(files[0].name)}-privacy-report`, "pdf"), "application/pdf");
                } catch {
                  throw new Error("The PDF report supports Latin-1 characters only, and this document contains characters outside it. Download the .txt report instead.");
                }
              }} />
            </div>
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <p className="font-black">1 · Personal data patterns</p>
            {groups.length ? (
              <div className="grid gap-3">
                {groups.map((group) => (
                  <div key={group.type} className="surface-muted wabi-card-edge grid gap-2 p-3">
                    <p className="font-black text-[var(--foreground)]">{group.label} · {group.hits.length}</p>
                    <div className="grid gap-1">
                      {group.hits.map((hit) => (
                        <div key={hit.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-semibold text-neutral-600">
                          <span className="text-xs font-black uppercase text-neutral-500">p{hit.page}</span>
                          <span className="break-all font-mono text-[var(--foreground)]">{piiDisplayValue(hit, reveal)}</span>
                          <ConfidenceTag confidence={hit.confidence} />
                          {hit.note ? <span className="text-xs text-neutral-500">{hit.note}</span> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm font-semibold text-neutral-500">No known patterns matched.</p>
            )}
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <p className="font-black">2 · Document metadata</p>
            <dl className="grid gap-2 text-sm font-semibold text-neutral-600 lg:grid-cols-2">
              {Object.entries(structure.info).map(([key, value]) => (
                <InfoRow key={key} label={(key === "Author" || key === "Creator") && value ? `${key} ⚠` : key} value={value || "Not set"} />
              ))}
            </dl>
            {(structure.info.Author || structure.info.Creator) && (
              <p className="text-sm font-semibold text-neutral-500">Author and Creator name the person and the software that produced this file. Clear them with PDF Metadata Cleaner before sharing externally.</p>
            )}
            <p className="font-black">XMP packet</p>
            {structure.xmp.present ? (
              <dl className="grid gap-2 text-sm font-semibold text-neutral-600">
                <InfoRow label="Size" value={`${structure.xmp.bytes} bytes`} />
                {structure.xmp.fields.length
                  ? structure.xmp.fields.map((field) => <InfoRow key={field.label} label={field.label} value={field.value} />)
                  : <InfoRow label="Fields" value="Present, but no common identity field was recognised." />}
              </dl>
            ) : (
              <p className="text-sm font-semibold text-neutral-500">No XMP packet is present.</p>
            )}
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <p className="font-black">3 · Hidden and invisible text</p>
            {structure.invisibleText.length ? (
              <dl className="grid gap-2 text-sm font-semibold text-neutral-600">
                {structure.invisibleText.map((entry) => (
                  <InfoRow key={entry.page} label={`Page ${entry.page}`} value={`${entry.invisible} text run(s) in rendering mode 3 (invisible) · ${entry.whiteOnWhite} near-white fill`} />
                ))}
              </dl>
            ) : (
              <p className="text-sm font-semibold text-neutral-500">The operator scan found no invisible or near-white text.</p>
            )}
            {scan.offPageItems > 0 && <p className="text-sm font-semibold text-neutral-600">{scan.offPageItems} text item(s) sit outside the visible page box — content a reader cannot see but a text extractor can.</p>}
            <p className="text-sm font-semibold text-neutral-500">This is a heuristic: it tracks rendering mode and fill colour through the content stream without evaluating the full graphics state, so it can miss cases and can also flag legitimate ones. An OCR'd document uses invisible text on purpose.{structure.contentTruncated ? " A very large content stream was only partially scanned." : ""}</p>
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <p className="font-black">4 · Destinations: links, URLs and IPs</p>
            {destinations.length || structure.links.length ? (
              <dl className="grid gap-2 text-sm font-semibold text-neutral-600">
                {destinations.map((hit) => <InfoRow key={hit.id} label={`Page ${hit.page} · in text`} value={hit.value} />)}
                {structure.links.map((link, index) => <InfoRow key={`${link.page}-${index}`} label={`Page ${link.page} · /${link.subtype} annotation`} value={link.uri} />)}
              </dl>
            ) : (
              <p className="text-sm font-semibold text-neutral-500">No URLs, IP addresses, or link annotations were found.</p>
            )}
            <p className="text-sm font-semibold text-neutral-500">Destinations are shown in full even when values are masked — you need to read them to judge them. They are not opened or contacted.</p>
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <p className="font-black">5 · Attachments, protection and signatures</p>
            <dl className="grid gap-2 text-sm font-semibold text-neutral-600">
              {structure.attachments.map((attachment, index) => (
                <InfoRow key={`${attachment.name}-${index}`} label={`Attachment · ${attachment.type}`} value={`${attachment.name}${attachment.size ? ` · ${formatBytes(attachment.size)} stored` : ""}${attachment.description ? ` · ${attachment.description}` : ""}`} />
              ))}
              {structure.embeddedFileStreams > 0 && <InfoRow label="/EmbeddedFile streams" value={`${structure.embeddedFileStreams} · ${formatBytes(structure.embeddedFileBytes)} stored`} />}
              {!structure.attachments.length && !structure.embeddedFileStreams && <InfoRow label="Attachments" value="None found" />}
              <InfoRow label="Encrypted" value={structure.encrypted ? "Yes — this file carries PDF encryption" : "No"} />
              {structure.signatures.length
                ? structure.signatures.map((signature, index) => <InfoRow key={`${signature.name}-${index}`} label="Signature entry" value={`${signature.name}${signature.reason ? ` · ${signature.reason}` : ""}`} />)
                : <InfoRow label="Digital signature" value="No signature entry found" />}
            </dl>
            <p className="text-sm font-semibold text-neutral-500">A signature entry means the file claims to be signed. This tool does not verify the cryptography behind it.</p>
          </div>

          <div className="surface-card wabi-card-edge grid gap-2 p-4 text-sm font-semibold leading-6 text-neutral-600">
            <p className="font-black text-[var(--foreground)]">6 · What this means</p>
            <p>{scan.summary.high} match{scan.summary.high === 1 ? "" : "es"} passed a checksum or a context rule, so treat those as real findings. The other {scan.summary.total - scan.summary.high} are medium or low confidence and need your judgement.</p>
            <p>There is no risk score here on purpose: a single number would hide what actually matters. The findings above are the report.</p>
            <p className="font-black text-[var(--foreground)]">Limits, plainly stated</p>
            <p>This finds common patterns only. It cannot guarantee it found every piece of sensitive data. Names, addresses, salary and health details, text inside images, anything inside an attachment, and text in encodings pdf.js cannot map are not detected. Only Aadhaar, payment cards and GSTIN carry a checksum; PAN, IFSC and passport are shape rules, so a part number shaped like one is reported as a match. Passport and bank-account shapes are so generic that low-confidence hits there will include false positives. A dotted quad like 1.2.3.4 is reported as an IP even when it is a version number.</p>
          </div>
        </>
      )}
    </ToolForm>
  );
}

type AnalyzerFinding = { id: number; indicator: string; severity: string; where: string | null; why: string; evidence: string };
type AnalyzerReport = {
  fileSize: number; sha256: string; version: string; pageCount: number | null; objectCount: number;
  linearized: boolean; hasSignature: boolean; encrypted: boolean; objStmCount: number; startxrefCount: number;
  eofCount: number; parseError: string | null; truncated: boolean; findings: AnalyzerFinding[];
  embeddedFiles: { objNum: number; name: string; size: number; magic: string; executable: boolean }[];
  verdict: { level: string; headline: string; summary: string; counts: { critical: number; high: number; medium: number; low: number; info: number } };
};

function severityTone(severity: string) {
  if (severity === "Critical") return "border-[var(--danger-strong)] bg-[var(--danger-strong-bg)] text-[var(--danger-strong-fg)]";
  if (severity === "High") return "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger-fg)]";
  if (severity === "Medium") return "border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning-fg)]";
  // Low + Info are neutral — chroma is reserved for danger (Critical/High=red, Medium=amber).
  return "border-[var(--line)] bg-[var(--paper-soft)] text-[var(--stone)]";
}

function SeverityTag({ severity }: { severity: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black uppercase ${severityTone(severity)}`}>{severity}</span>;
}

function verdictTone(level: string) {
  if (level === "suspicious") return "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger-fg)]";
  if (level === "caution") return "border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning-fg)]";
  return "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success-fg)]";
}

function PdfAnalyzerTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<AnalyzerReport | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => {
    setFiles([]);
    setReport(null);
    setStatus(initialStatus);
  };

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    if (!files.length) return undefined;

    runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = (await analyzePdfBytes(bytes, {
        onProgress: (step: number, total: number) => setStatus({ tone: "idle", message: `Analysing ${file.name} — step ${step} of ${total}…`, progress: { value: step, total, label: "Analysing…" } }),
      })) as AnalyzerReport;
      if (cancelled) return "Ready.";
      setReport(result);
      const c = result.verdict.counts;
      return `${result.verdict.headline}. ${c.critical} critical, ${c.high} high, ${c.medium} medium indicator(s). Nothing was uploaded and the file was never executed.`;
    });

    return () => { cancelled = true; };
  }, [files, tool.file]);

  const reportText = useMemo(() => {
    if (!report || !files.length) return "";
    return buildAnalyzerReportText(report, { fileName: files[0].name });
  }, [report, files]);

  return (
    <ToolForm status={status} onReset={reset}>
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        Static, byte-level triage of a suspicious PDF. It reads the raw bytes — it never opens, renders, executes, or evals anything in the file, and nothing leaves this browser. Built for the case where a PDF must NOT be sent to any online scanner. This is triage to guide your judgement, not a malware verdict.
      </div>
      <FileControl accept="application/pdf" files={files} setFiles={setFiles} />

      {report && (
        <>
          <div className={`wabi-card-edge grid gap-2 rounded-2xl border p-4 ${verdictTone(report.verdict.level)}`}>
            <p className="text-xs font-black uppercase tracking-wide">Triage verdict</p>
            <p className="text-lg font-black">{report.verdict.headline}</p>
            <p className="text-sm font-semibold leading-6">{report.verdict.summary}</p>
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-black">Structure (facts, not verdicts)</p>
            </div>
            <dl className="grid gap-2 text-sm font-semibold text-neutral-600 lg:grid-cols-2">
              <InfoRow label="SHA-256" value={report.sha256} />
              <InfoRow label="Size" value={formatBytes(report.fileSize)} />
              <InfoRow label="PDF version" value={report.version} />
              <InfoRow label="Pages (best-effort)" value={report.pageCount == null ? "unknown" : String(report.pageCount)} />
              <InfoRow label="Objects" value={String(report.objectCount)} />
              <InfoRow label="Object streams (/ObjStm)" value={String(report.objStmCount)} />
              <InfoRow label="Linearized" value={report.linearized ? "Yes" : "No"} />
              <InfoRow label="Encrypted" value={report.encrypted ? "Yes" : "No"} />
              <InfoRow label="Digital signature" value={report.hasSignature ? "Present (cryptography not verified)" : "None"} />
              <InfoRow label="startxref / %%EOF" value={`${report.startxrefCount} / ${report.eofCount}`} />
            </dl>
            {report.parseError && <p className="text-sm font-semibold text-amber-700 [.dark_&]:text-[#f3d79b]">{report.parseError}</p>}
            {report.truncated && <p className="text-sm font-semibold text-amber-700 [.dark_&]:text-[#f3d79b]">The file does not end cleanly at %%EOF — it may be truncated or carry data appended after the PDF.</p>}
            <div className="flex flex-wrap gap-2">
              <SecondaryButton label="Download .txt report" onClick={() => {
                if (!reportText) throw new Error("Analyse a file first.");
                downloadText(reportText, `${safeFilename(files[0].name)}-analysis`, "txt");
              }} />
              <SecondaryButton label="Download .pdf report" onClick={async () => {
                if (!reportText) throw new Error("Analyse a file first.");
                try {
                  const bytes = await textToPdf(reportText);
                  downloadBytes(bytes, withExtension(`${safeFilename(files[0].name)}-analysis`, "pdf"), "application/pdf");
                } catch {
                  throw new Error("The PDF report supports Latin-1 characters only, and this analysis contains characters outside it. Download the .txt report instead.");
                }
              }} />
            </div>
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-black">Findings</p>
              <p className="text-xs font-black uppercase text-neutral-500">
                {report.verdict.counts.critical}C · {report.verdict.counts.high}H · {report.verdict.counts.medium}M · {report.verdict.counts.low}L · {report.verdict.counts.info}I
              </p>
            </div>
            {report.findings.length ? (
              <div className="grid gap-2">
                {report.findings.map((finding) => (
                  <div key={finding.id} className="surface-muted wabi-card-edge grid gap-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityTag severity={finding.severity} />
                      <span className="font-black text-[var(--foreground)]">{finding.indicator}</span>
                      {finding.where ? <span className="text-xs font-semibold text-neutral-500">{finding.where}</span> : null}
                    </div>
                    <p className="text-sm font-semibold leading-6 text-neutral-600">{finding.why}</p>
                    {finding.evidence ? (
                      <pre className="max-h-64 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--paper-soft)] px-3 py-2 text-xs leading-5 text-[var(--foreground)] whitespace-pre-wrap break-all">{finding.evidence}</pre>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm font-semibold text-neutral-500">No indicators were detected by the static byte-level scan. That is not proof of safety — see the limits below.</p>
            )}
            <p className="text-sm font-semibold text-neutral-500">Extracted evidence — scripts, commands, URLs, attachment names — is shown as inert, escaped text. It is never executed, opened, or contacted.</p>
          </div>

          <div className="surface-card wabi-card-edge grid gap-2 p-4 text-sm font-semibold leading-6 text-neutral-600">
            <p className="font-black text-[var(--foreground)]">Limits, plainly stated</p>
            <p>This reads bytes; it does not run the file. It will miss novel or heavy obfuscation, payloads behind unsupported filters or encryption, exploits that live inside malformed object internals, and anything that only reveals itself when the PDF is opened in a real reader. There is deliberately no numeric "threat score": the findings above are the report, and the call is yours. When in doubt, detonate the file in an isolated sandbox.</p>
          </div>
        </>
      )}
    </ToolForm>
  );
}

type SanitizeReport = { counts: Record<string, number>; removed: { category: string; label: string; count: number }[]; total: number; clean: boolean; removeAttachments: boolean };
type SanitizeResult = { bytes: Uint8Array; report: SanitizeReport; before: number; residual: AnalyzerFinding[] };

function SanitizePdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [removeAttachments, setRemoveAttachments] = useState(true);
  const [result, setResult] = useState<SanitizeResult | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => { setFiles([]); setRemoveAttachments(true); setResult(null); setStatus(initialStatus); };

  const filename = files.length ? withExtension(`${safeFilename(files[0].name)}-sanitized`, "pdf") : "sanitized.pdf";

  return (
    <ToolForm status={status} onReset={reset}>
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        The active counterpart to the PDF Analyser. It opens the PDF and removes active-content threats at the object level — document open actions, additional actions, JavaScript, Launch/SubmitForm/ImportData actions, embedded files, and RichMedia/3D/movie annotations — then reports exactly what it stripped. It removes the same categories the Analyser flags, so re-analysing the cleaned file reports none of them. Everything happens in this browser.
      </div>
      <FileControl accept="application/pdf" files={files} setFiles={(next) => { setFiles(next); setResult(null); setStatus(initialStatus); }} />
      <Checkbox label="Remove embedded files / attachments" checked={removeAttachments} onChange={(value) => { setRemoveAttachments(value); setResult(null); }} />

      <PrimaryButton label="Sanitize PDF" onClick={() => runSafely(setStatus, async () => {
        const [file] = validateFiles(files, tool.file);
        const inputBytes = new Uint8Array(await file.arrayBuffer());
        setStatus({ tone: "idle", message: "Scanning for active content…", progress: { value: 1, total: 3, label: "Analysing original" } });
        const beforeReport = (await analyzePdfBytes(inputBytes)) as AnalyzerReport;
        const beforeActive = residualActiveContent(beforeReport);
        setStatus({ tone: "idle", message: "Stripping active content…", progress: { value: 2, total: 3, label: "Sanitising" } });
        const { bytes, report } = await sanitizePdf(inputBytes, { removeAttachments });
        setStatus({ tone: "idle", message: "Verifying with the Analyser…", progress: { value: 3, total: 3, label: "Re-analysing" } });
        const afterReport = (await analyzePdfBytes(bytes)) as AnalyzerReport;
        const residual = residualActiveContent(afterReport);
        setResult({ bytes, report: report as SanitizeReport, before: beforeActive.length, residual });
        if (report.clean) return "Nothing to remove — no active-content threats were found. A clean, re-saved copy is ready.";
        return `Removed ${report.total} active-content item${report.total === 1 ? "" : "s"}. The Analyser now reports ${residual.length} active-content indicator${residual.length === 1 ? "" : "s"} in the output.`;
      })} />

      {result && (
        <>
          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <p className="font-black">Removal report</p>
            {result.report.clean ? (
              <p className="text-sm font-semibold text-neutral-600">Nothing to remove — this PDF carried no OpenAction, additional actions, JavaScript, launch/submit actions, embedded files, or multimedia annotations. A re-saved copy is ready below.</p>
            ) : (
              <ul className="grid gap-1 text-sm font-semibold text-neutral-600">
                {result.report.removed.map((item) => (
                  <li key={item.category} className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-1 last:border-b-0">
                    <span className="text-[var(--foreground)]">{item.label}</span>
                    <span className="tabular-nums font-black">{item.count}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className={`wabi-card-edge grid gap-1 rounded-2xl border p-3 text-sm font-semibold ${result.residual.length ? verdictTone("caution") : verdictTone("clean")}`}>
              <p className="text-xs font-black uppercase tracking-wide">Cross-check with the PDF Analyser</p>
              <p>Active-content indicators: {result.before} before → {result.residual.length} after.</p>
              {result.residual.length > 0 && (
                <p>Residual (could not be removed — likely inside an encrypted or unusual stream): {result.residual.map((finding) => finding.indicator).join(", ")}.</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <SecondaryButton label="Download .txt report" onClick={() => {
                if (!files.length) throw new Error("Sanitize a file first.");
                downloadText(buildSanitizeReportText(result.report, { fileName: files[0].name }), `${safeFilename(files[0].name)}-sanitize-report`, "txt");
              }} />
            </div>
          </div>
          <PrimaryButton label="Download sanitized PDF" onClick={() => runSafely(setStatus, async () => {
            downloadBytes(result.bytes, filename, "application/pdf");
            return `${filename} downloaded.`;
          })} />
          {status.tone === "success" && <ResultConsequenceNote>Sanitizing rewrites the file to drop active content; it does not decode or neutralise an exploit hidden inside an image, font, or encrypted stream. For an untrusted file, still triage it with the PDF Analyser and detonate in a sandbox when in doubt.</ResultConsequenceNote>}
        </>
      )}
    </ToolForm>
  );
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
              <p className="text-xs font-black uppercase text-neutral-500">Images</p>
              <ul className="grid gap-1">
                {result.images.map((image) => <li key={image.name} className="flex flex-wrap items-center justify-between gap-2"><span className="break-words text-[var(--foreground)]">{image.name}</span><span className="text-xs text-neutral-500">{image.kind} · {formatBytes(image.bytes.length)}</span></li>)}
              </ul>
            </div>
          )}
          {result.attachments.length > 0 && (
            <div className="grid gap-1 text-sm font-semibold text-neutral-600">
              <p className="text-xs font-black uppercase text-neutral-500">Attachments</p>
              <ul className="grid gap-1">
                {result.attachments.map((attachment) => <li key={attachment.name} className="flex flex-wrap items-center justify-between gap-2"><span className="break-words text-[var(--foreground)]">{attachment.name}</span><span className="text-xs text-neutral-500">{formatBytes(attachment.size)}</span></li>)}
              </ul>
            </div>
          )}
          {result.skipped.length > 0 && (
            <div className="grid gap-1 text-sm font-semibold text-neutral-600">
              <p className="text-xs font-black uppercase text-neutral-500">Skipped</p>
              <ul className="grid gap-1">
                {result.skipped.map((entry, index) => <li key={index} className="break-words text-neutral-500">{entry.width && entry.height ? `${entry.width}×${entry.height}: ` : ""}{entry.reason}</li>)}
              </ul>
            </div>
          )}
          {(result.images.length > 0 || result.attachments.length > 0) && (
            <PrimaryButton label="Download ZIP" onClick={() => runSafely(setStatus, async () => {
              const zipped = buildExtractionZip(result);
              downloadBytes(zipped, zipName, "application/zip");
              return `${zipName} downloaded (${result.images.length + result.attachments.length} file${result.images.length + result.attachments.length === 1 ? "" : "s"}).`;
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

function FingerprintPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Embeds a unique, invisible identifier in the PDF metadata (Producer, Keywords, and a custom field) so a leaked copy can be traced back. Visible page content is not changed.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PrimaryButton label="Fingerprint PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const { bytes, id } = await fingerprintPdf(file);
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-fingerprinted`, "pdf"), "application/pdf");
      return `Embedded fingerprint id:\n${id}\nKeep this id to identify this copy later.`;
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
        <p className="text-xs font-black uppercase text-neutral-500">Current outline</p>
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
            <span className="text-xs font-black uppercase text-neutral-500">Field</span>
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

/** Rasterises `src` onto a fresh w×h white canvas and returns its pixel data. */
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
  const { loadPdfDocument, renderPdfPageToCanvas } = await import("./lib/pdfjs");
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
 * Rasterises each page, estimates (or applies an override) skew angle, rotates
 * the page image to straighten it, and rebuilds an image-based PDF. Output pages
 * are images, so text is no longer selectable. Browser-only.
 */
async function deskewPdf(
  file: File,
  { dpi = 150, overrideAngle, onProgress }: { dpi?: number; overrideAngle?: number | null; onProgress?: (page: number, total: number) => void }
) {
  const { PDFDocument } = getPdfLib();
  const { loadPdfDocument, renderPdfPageToCanvas } = await import("./lib/pdfjs");
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
                <p className="text-xs font-black uppercase text-neutral-500">A: {result.pageCountA}p · B: {result.pageCountB}p</p>
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
                      <p className="text-sm font-black text-[var(--foreground)]">Page {entry.page} — +{entry.added} / -{entry.removed} line(s)</p>
                      <pre className="max-h-64 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--paper-soft)] px-3 py-2 text-xs leading-5 whitespace-pre-wrap break-words">
                        {entry.rows
                          .filter((row) => row.type !== "same")
                          .slice(0, 60)
                          .map((row, index) => (
                            <div key={index} className={row.type === "added" ? "text-[var(--success-fg)]" : "text-red-700 [.dark_&]:text-[#f8b4b4]"}>
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
      Auto-straightens skewed scans. Each page is rasterised, its skew angle is estimated with a projection-profile method (the angle that lines the text rows up into the sharpest horizontal profile), and the page is rotated to correct it. Because it works on rendered pages, the output pages become images — text is no longer selectable. Leave the override blank to auto-detect per page.
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
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [report, setReport] = useState<{ applied: string[]; removed: string[]; conformance: string } | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => { setFiles([]); setRaster(false); setTitle(""); setAuthor(""); setReport(null); setStatus(initialStatus); };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Best-effort archival hygiene — <strong>not</strong> a certified, veraPDF-validated PDF/A conversion. It adds an sRGB OutputIntent with an embedded ICC profile, writes XMP metadata carrying the PDF/A conformance identifier, sets the document Info, /ID, and /MarkInfo, and strips things PDF/A forbids where it can (JavaScript, auto-run OpenAction, and Launch actions). True PDF/A also needs every font embedded and a strict validation pass, which a browser cannot guarantee — so this does not claim compliance it cannot prove.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Checkbox label="Guaranteed self-contained (rasterise every page)" checked={raster} onChange={setRaster} />
    {raster && (
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        Rasterising renders each page to an image, which removes any missing-font or transparency risk — the most reliable client-side path — but makes text non-selectable. You can re-add a searchable text layer afterwards with the OCR / Searchable PDF tool.
      </div>
    )}
    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="Title (optional)" value={title} onChange={setTitle} placeholder="Document title" />
      <Input label="Author (optional)" value={author} onChange={setAuthor} placeholder="Author" />
    </div>
    <PrimaryButton label="Prepare for archiving" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const originalBytes = new Uint8Array(await file.arrayBuffer());
      let source = originalBytes;
      if (raster) {
        // Refuse encrypted originals with a clear message before rasterising.
        await assertPdfDecryptable(originalBytes);
        source = await rasterRebuild(file, { format: "png", onProgress: pageProgress(setStatus, "Rasterising") });
      }
      const { bytes, report: prepReport } = await archivalPrepPdf(source, { title: title.trim(), author: author.trim() });
      if (raster) prepReport.removed.unshift("rasterised all pages (text no longer selectable)");
      setReport(prepReport);
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-archival`, "pdf"), "application/pdf");
      return `Prepped for archiving (${prepReport.conformance}). Applied ${prepReport.applied.length} change(s); removed ${prepReport.removed.length} item(s). This is best-effort hygiene, not certified PDF/A.`;
    })} />

    {report && (
      <div className="surface-card wabi-card-edge grid gap-3 p-4">
        <p className="font-black">What was done — {report.conformance}</p>
        <div className="grid gap-1 text-sm font-semibold text-neutral-600">
          <p className="text-xs font-black uppercase text-neutral-500">Applied</p>
          {report.applied.map((item, index) => <p key={index} className="text-[var(--foreground)]">• {item}</p>)}
        </div>
        <div className="grid gap-1 text-sm font-semibold text-neutral-600">
          <p className="text-xs font-black uppercase text-neutral-500">Removed</p>
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
  verdict: { level: "pass" | "warn" | "fail"; headline: string; summary: string };
  stats: Record<string, any>;
};
type A11yFigure = { page: number; id: string; alt: string; decorative: boolean };
type A11yAnalysis = { textBlocks: any[]; figures: A11yFigure[]; textLayer: { characters: number; pageCount: number }; pageCount: number };

function a11yStatusTone(status: A11yStatus) {
  if (status === "fail") return "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger-fg)]";
  if (status === "warn") return "border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning-fg)]";
  if (status === "pass") return "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success-fg)]";
  return "border-[var(--line)] bg-[var(--paper-soft)] text-[var(--stone)]";
}

function A11yStatusTag({ status }: { status: A11yStatus }) {
  const label = status === "pass" ? "PASS" : status === "warn" ? "WARN" : status === "fail" ? "FAIL" : "INFO";
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black uppercase ${a11yStatusTone(status)}`}>{label}</span>;
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
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        Audits a PDF against PDF/UA and WCAG basics that a machine can verify — tagging, title, language, image alt text, extractable text, encryption permissions, reading order, and headings. Everything runs locally in this browser. This does <strong>not</strong> replace a manual audit: colour contrast, whether alt text is meaningful, and whether the reading order is logically correct all need human judgement.
      </div>
      <FileControl accept="application/pdf" files={files} setFiles={setFiles} />

      {report && (
        <>
          <div className={`wabi-card-edge grid gap-2 rounded-2xl border p-4 ${verdictTone(report.verdict.level)}`}>
            <p className="text-xs font-black uppercase tracking-wide">Accessibility verdict</p>
            <p className="text-lg font-black">{report.verdict.headline}</p>
            <p className="text-sm font-semibold leading-6">{report.verdict.summary}</p>
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-black">Checks</p>
              <p className="text-xs font-black uppercase text-neutral-500">{report.summary.pass}P · {report.summary.warn}W · {report.summary.fail}F</p>
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
          Remediates a PDF toward PDF/UA as far as is reliably automatable: sets the document language, title, and window-bar title, marks it tagged, and builds a basic <strong>real</strong> structure tree (headings and paragraphs in reading order, in an invisible tagged text layer) plus alt text for images. Automated tagging gets structure, language, title, and alt-text scaffolding right, but a perfect reading order and correct semantic tags for complex layouts (multi-column, tables, forms) still need a manual pass in a full authoring tool. This does <strong>not</strong> claim certified PDF/UA conformance.
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
                      <p className="text-xs font-black uppercase text-neutral-500">{figure.id}</p>
                      <Input label="Alt text" value={figure.alt} onChange={(value) => updateFigure(index, { alt: value, decorative: value.trim() ? false : figure.decorative })} placeholder="Describe the image" />
                      <Checkbox label="Decorative (no alt text needed)" checked={figure.decorative} onChange={(checked) => updateFigure(index, { decorative: checked, alt: checked ? "" : figure.alt })} />
                    </div>
                  ))}
                </>
              ) : (
                <p className="text-sm font-semibold text-neutral-500">No image XObjects were detected, so no alt text is needed.</p>
              )}
            </div>

            <PrimaryButton label="Make accessible & download" onClick={remediate} />
          </>
        )}
      </div>
      <ToolMetaPanel status={status} onReset={reset}>
        {before && (
          <div className="surface-card wabi-card-edge grid gap-2 p-4">
            <p className="text-xs font-black uppercase text-neutral-500">{after ? "Before → after" : "Before (current)"}</p>
            <div className="flex flex-wrap items-center gap-3 text-sm font-black">
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
              <p className="text-xs font-black uppercase text-neutral-500">What I set</p>
              {remediation.applied.map((item, index) => <p key={index} className="text-[var(--foreground)]">• {item}</p>)}
            </div>
            <div className="grid gap-1 text-sm font-semibold text-neutral-600">
              <p className="text-xs font-black uppercase text-neutral-500">What still needs human review</p>
              {remediation.review.map((item, index) => <p key={index} className="text-[var(--foreground)]">• {item}</p>)}
            </div>
          </div>
        )}
      </ToolMetaPanel>
    </div>
  );
}

// The crypt layer reports permissions as a plain object keyed by name; these
// casts give the JSX a typed view of it without pulling type annotations into
// the service.
const permissionLabels = PDF_PERMISSION_LABELS as Record<string, string>;
const permissionKeys = Object.keys(permissionLabels);
const encryptionAlgorithms = PDF_ENCRYPTION_ALGORITHMS as Record<string, { label: string; internal?: boolean }>;
const offeredAlgorithmIds = Object.keys(encryptionAlgorithms).filter((id) => !encryptionAlgorithms[id].internal);
const allPermissionsAllowed = ALL_PERMISSIONS_ALLOWED as Record<string, boolean>;

function listPermissions(flags: Record<string, boolean>, wanted: boolean) {
  return permissionKeys.filter((key) => Boolean(flags[key]) === wanted).map((key) => permissionLabels[key].toLowerCase());
}

function PasswordField({ label, value, onChange, helper = "" }: { label: string; value: string; onChange: (value: string) => void; helper?: string }) {
  return <label className="grid gap-2">
    <span className="text-xs font-black uppercase text-neutral-500">{label}</span>
    <input className="field-input" type="password" value={value} onChange={(event) => onChange(event.target.value)} autoComplete="new-password" spellCheck={false} />
    {helper && <span className="text-xs font-semibold text-neutral-500">{helper}</span>}
  </label>;
}

function EncryptPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [algorithm, setAlgorithm] = useState("aes-256");
  const [permissions, setPermissions] = useState<Record<string, boolean>>({ ...allPermissionsAllowed });
  const [status, setStatus] = useState(initialStatus);

  // Passwords live only in this component's state and are never logged or
  // stored. Drop them on unmount as well as on reset.
  const forgetPasswords = () => {
    setPassword("");
    setConfirmation("");
    setOwnerPassword("");
  };
  useEffect(() => forgetPasswords, []);

  return <ToolForm status={status} onReset={() => {
    setFiles([]);
    forgetPasswords();
    setAlgorithm("aes-256");
    setPermissions({ ...allPermissionsAllowed });
    setStatus(initialStatus);
  }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Applies the standard PDF security handler here in this browser, so any reader — Acrobat, Preview, Chrome — will ask for the password before opening the file. There is no recovery route: if the password is lost, the document cannot be opened again by anyone, including you.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PasswordField label="Password to open the PDF" value={password} onChange={setPassword} />
    <PasswordField label="Confirm password" value={confirmation} onChange={setConfirmation} />
    <PasswordField label="Owner password (optional)" value={ownerPassword} onChange={setOwnerPassword} helper="A second, different password that can change the permissions below. Leave it blank to reuse the password above." />
    <Select label="Encryption" value={algorithm} onChange={setAlgorithm} options={offeredAlgorithmIds} labels={offeredAlgorithmIds.map((id) => encryptionAlgorithms[id].label)} />
    {algorithm === "rc4-128" && (
      <p className="text-xs font-black uppercase text-red-700 [.dark_&]:text-[#f8b4b4]">RC4 is broken and offers no real protection. Only pick it for a reader too old to handle AES.</p>
    )}
    <fieldset className="grid gap-2">
      <legend className="text-xs font-black uppercase text-neutral-500">Allow anyone with the password to</legend>
      {permissionKeys.map((key) => (
        <Checkbox
          key={key}
          label={permissionLabels[key]}
          checked={Boolean(permissions[key])}
          onChange={(value) => setPermissions((current) => ({ ...current, [key]: value }))}
        />
      ))}
    </fieldset>
    <PrimaryButton label="Encrypt PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      if (!password) throw new Error("Enter a password to open the PDF with.");
      if (password !== confirmation) throw new Error("The two passwords do not match.");
      if (ownerPassword && ownerPassword === password) throw new Error("The owner password must be different from the open password.");
      const result = await encryptPdf(file, { userPassword: password, ownerPassword, algorithm, permissions });
      downloadBytes(result.bytes, withExtension(`${safeFilename(file.name)}-encrypted`, "pdf"), "application/pdf");
      const blocked = listPermissions(result.permissions as Record<string, boolean>, false);
      return `Encrypted with ${result.algorithm}.\n${blocked.length ? `Not allowed: ${blocked.join(", ")}.` : "All permissions allowed."}`;
    })} />
    {status.tone === "success" && <ResultConsequenceNote>Store the password somewhere safe — it cannot be recovered.</ResultConsequenceNote>}
  </ToolForm>;
}

function RemovePasswordTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState(initialStatus);

  const forgetPassword = () => setPassword("");
  useEffect(() => forgetPassword, []);

  return <ToolForm status={status} onReset={() => { setFiles([]); forgetPassword(); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      This decrypts a PDF you can already open, with a password you already know, and saves an identical copy that needs no password. Text, fonts, images, and structure are kept — nothing is rasterised. It does not crack, guess, or bypass anything: a wrong password just fails. Use it only on documents you are entitled to decrypt.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PasswordField label="Current PDF password" value={password} onChange={setPassword} helper="Either the password that opens the PDF or its owner password will work." />
    <PrimaryButton label="Remove password" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      if (!password) throw new Error("Enter the PDF's current password.");
      const result = await decryptPdf(file, password);
      downloadBytes(result.bytes, withExtension(`${safeFilename(file.name)}-no-password`, "pdf"), "application/pdf");
      return `Removed ${result.algorithm} encryption from ${file.name}.`;
    })} />
    {status.tone === "success" && <ResultConsequenceNote>The copy you just downloaded opens without a password.</ResultConsequenceNote>}
  </ToolForm>;
}

function UnlockPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Some PDFs open freely but block printing, copying, or editing behind an owner password. This removes those restrictions and saves an unrestricted copy. It is not the same as Remove Password: if the PDF asks for a password just to open it, use Remove Password instead, with the password you already have. Use this only on documents you have the right to unlock.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PrimaryButton label="Unlock PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const result = await unlockPdf(file);
      downloadBytes(result.bytes, withExtension(`${safeFilename(file.name)}-unlocked`, "pdf"), "application/pdf");
      const restored = listPermissions(result.permissionsBefore as Record<string, boolean>, false);
      return `Removed ${result.algorithm} owner-password restrictions from ${file.name}.\n${restored.length ? `Restored: ${restored.join(", ")}.` : "That PDF was encrypted but had no restrictions set."}`;
    })} />
    {status.tone === "success" && <ResultConsequenceNote>The copy you downloaded has its owner-password restrictions removed — printing, copying, and editing are open to anyone who has it.</ResultConsequenceNote>}
  </ToolForm>;
}

const CERT_FILE_OPTIONS = { maxFiles: 1, maxSize: 8 * 1024 * 1024, extensions: ["p12", "pfx"], types: ["application/x-pkcs12", "application/pkcs12"] };

function SignPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [certFiles, setCertFiles] = useState<File[]>([]);
  const [password, setPassword] = useState("");
  const [signerName, setSignerName] = useState("");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [visible, setVisible] = useState(false);
  const [page, setPage] = useState("1");
  const [useTimestamp, setUseTimestamp] = useState(false);
  const [tsaUrl, setTsaUrl] = useState("");
  const [timestamped, setTimestamped] = useState(false);
  const [status, setStatus] = useState(initialStatus);

  // The certificate password lives only in this component's state — never
  // logged, persisted, or sent anywhere. Drop it on reset and on unmount.
  const forgetPassword = () => setPassword("");
  useEffect(() => forgetPassword, []);

  return <ToolForm status={status} onReset={() => {
    setFiles([]); setCertFiles([]); forgetPassword();
    setSignerName(""); setReason(""); setLocation(""); setVisible(false); setPage("1");
    setUseTimestamp(false); setTsaUrl(""); setTimestamped(false);
    setStatus(initialStatus);
  }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Applies a real cryptographic signature — a detached PKCS#7 / CMS SignedData over the document's bytes (SHA-256), added through an incremental update so any signatures already on the file stay valid. This is not a picture of a signature: it proves the document has not changed since signing and identifies the signer by their certificate. Signing runs entirely in this browser; the certificate and its password never leave this page. By default there is no trusted timestamp, so the signing time is self-asserted — turn on the optional RFC 3161 timestamp below to have a third-party authority attest the time.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} label="Choose the PDF to sign" />
    <FileControl accept=".p12,.pfx,application/x-pkcs12" files={certFiles} setFiles={setCertFiles} label="Choose your certificate (.p12 / .pfx)" />
    <PasswordField label="Certificate password" value={password} onChange={setPassword} helper="Held only in this page's memory — never logged, stored, or transmitted. Cleared when you reset or leave." />
    <Input label="Signer name (optional)" value={signerName} onChange={setSignerName} helper="Shown in the signature. Defaults to the certificate's common name." />
    <Input label="Reason (optional)" value={reason} onChange={setReason} placeholder="e.g. I approve this document" />
    <Input label="Location (optional)" value={location} onChange={setLocation} placeholder="e.g. Bengaluru, IN" />
    <Checkbox label="Add a visible signature block (lower-left of the chosen page)" checked={visible} onChange={setVisible} />
    {visible && <Input label="Page for the visible block" value={page} onChange={setPage} type="number" helper="1 is the first page." />}
    <div className="surface-muted wabi-card-edge grid gap-3 p-4 text-sm font-semibold leading-6 text-neutral-600">
      <Checkbox label="Add a trusted RFC 3161 timestamp (contacts a third-party TSA over the network)" checked={useTimestamp} onChange={setUseTimestamp} />
      {useTimestamp ? (
        <div className="grid gap-2">
          <p className="text-xs font-semibold text-neutral-500">
            This is the one network request signing makes, and only because you asked: a SHA-256 hash of your signature (never the document) is POSTed to the TSA you enter. The default Content-Security-Policy blocks all outbound connections, so a TSA only works on a deploy where you have added <span className="whitespace-pre">connect-src 'self' &lt;TSA origin&gt;</span> to index.html and public/_headers. If it is blocked, the error tells you exactly what to add. With the box unticked, signing stays 100% local.
          </p>
          <Input label="TSA URL (RFC 3161)" value={tsaUrl} onChange={setTsaUrl} placeholder="https://freetsa.org/tsr" helper="Your own or a public RFC 3161 timestamp authority endpoint." />
        </div>
      ) : (
        <p className="text-xs font-semibold text-neutral-500">Off: signing is 100% local and the signing time is self-asserted.</p>
      )}
    </div>
    <PrimaryButton label="Sign PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const [cert] = validateFiles(certFiles, CERT_FILE_OPTIONS);
      if (!password) throw new Error("Enter the certificate password.");
      if (useTimestamp && !tsaUrl.trim()) throw new Error("Enter the TSA URL, or turn off the trusted timestamp.");
      const pageIndex = Math.max(1, parseInt(page, 10) || 1) - 1;
      const result = await signPdf(file, {
        p12: cert, password,
        name: signerName.trim(), reason: reason.trim(), location: location.trim(),
        visible, pageIndex,
        timestamp: useTimestamp, tsaUrl: tsaUrl.trim(),
      });
      downloadBytes(result.bytes, withExtension(`${safeFilename(file.name)}-signed`, "pdf"), "application/pdf");
      setTimestamped(Boolean(result.timestamp));
      const trust = result.selfSigned
        ? "This certificate is self-signed, so a reader will report \"signature valid, signer identity unknown\" until you add the certificate to its trust store."
        : "A reader will mark the signer trusted only if it already trusts the certificate's issuing CA.";
      const where = result.visible ? ` A visible block was drawn on page ${result.signedPage} of ${result.pageCount}.` : "";
      const time = result.timestamp
        ? `TSA-attested time ${result.timestamp.time ? new Date(result.timestamp.time).toLocaleString() : "(granted)"} from ${result.timestamp.tsa || "the TSA"}.`
        : `Signing time (self-asserted) ${result.signingTime.toLocaleString()}.`;
      return `Signed as ${result.subjectCommonName || "the certificate holder"} · serial ${result.serialHex}.\nDetached PKCS#7/CMS, SHA-256. ${time}${where}\n${trust}`;
    })} />
    {status.tone === "success" && (timestamped
      ? <ResultConsequenceNote>This signature carries a trusted RFC 3161 timestamp, so the signing time is attested by the TSA rather than self-asserted. Whether a reader shows the signature as "trusted" still depends on that reader trusting the certificate's CA (and the TSA's).</ResultConsequenceNote>
      : <ResultConsequenceNote>The signature proves document integrity and signer identity, but it is <strong>not</strong> timestamped by a trusted authority — the signing time is asserted by whoever signed. Turn on the RFC 3161 timestamp to have a TSA attest it. Whether a reader shows the signature as "trusted" depends on that reader trusting the certificate's CA.</ResultConsequenceNote>)}
  </ToolForm>;
}

const SIGNATURE_VERDICTS: Record<string, { label: string; tone: string }> = {
  valid: { label: "Valid — document unchanged since signing", tone: "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success-fg)]" },
  "valid-partial": { label: "Valid for the signed revision — bytes were added afterwards", tone: "border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning-fg)]" },
  modified: { label: "Document MODIFIED after signing", tone: "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger-fg)]" },
  invalid: { label: "Signature INVALID", tone: "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger-fg)]" },
  unsupported: { label: "Not verified (unsupported key type)", tone: "border-[var(--line)] bg-[var(--paper-soft)] text-[var(--stone)]" },
};

function SignatureCard({ sig, index }: { sig: any; index: number }) {
  const verdict = SIGNATURE_VERDICTS[sig.verdict] || SIGNATURE_VERDICTS.invalid;
  const fmtDate = (value: any) => {
    if (!value) return "—";
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  };
  return (
    <div className="surface-card grid gap-3 rounded-3xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-black uppercase text-neutral-500">Signature {index + 1} · field {sig.fieldName}</span>
        <span className={`rounded-full border px-3 py-1 text-xs font-black ${verdict.tone}`}>{verdict.label}</span>
      </div>
      <p className="text-sm font-semibold leading-6 text-[var(--foreground)]">{sig.detail}</p>
      <dl className="grid gap-2 text-sm">
        <InfoRow label="Signer (CN)" value={sig.subjectCommonName || "—"} />
        <InfoRow label="Issuer (CN)" value={`${sig.issuerCommonName || "—"}${sig.selfSigned ? " · self-signed" : ""}`} />
        <InfoRow label="Serial" value={sig.serialHex || "—"} />
        <InfoRow label="Certificate valid" value={`${fmtDate(sig.notBefore)} → ${fmtDate(sig.notAfter)}`} />
        <InfoRow label="Signing time" value={sig.signingTime ? fmtDate(sig.signingTime) : (sig.declaredSigningTime || "—")} />
        <InfoRow label="Timestamp" value={sig.timestamp?.present
          ? `TSA-attested ${sig.timestamp.time ? fmtDate(sig.timestamp.time) : "(time unreadable)"}${sig.timestamp.tsaCommonName ? ` · ${sig.timestamp.tsaCommonName}` : ""}${sig.timestamp.imprintMatches === false ? " · WARNING: token does not cover this signature" : ""}`
          : "None — signing time is self-asserted"} />
        <InfoRow label="Digest" value={`${sig.hashName || "SHA-256"} · integrity ${sig.integrity ? "matches" : "MISMATCH"}`} />
        <InfoRow label="Coverage" value={sig.coversWholeDocument ? "entire document" : "part of the document (additions after signing)"} />
        <InfoRow label="Type" value={sig.subFilter || "adbe.pkcs7.detached"} />
      </dl>
    </div>
  );
}

function VerifySignatureTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<any | null>(null);
  const [status, setStatus] = useState(initialStatus);

  return <ToolForm status={status} onReset={() => { setFiles([]); setReport(null); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Checks the digital signatures in a PDF. For each one it recomputes the SHA-256 digest over the signed byte ranges, verifies the PKCS#7 / CMS signature against the signer's certificate, and reports who signed, when, and whether the document changed after signing — all in this browser.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PrimaryButton label="Verify signatures" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      setReport(null);
      const result = await verifyPdfSignatures(file);
      setReport(result);
      if (!result.count) return "No digital signatures found in this PDF.";
      const good = result.signatures.filter((s: any) => s.verdict === "valid").length;
      const bad = result.signatures.filter((s: any) => s.verdict === "modified" || s.verdict === "invalid").length;
      return `Found ${result.count} signature${result.count === 1 ? "" : "s"}: ${good} valid, ${bad} failing.`;
    })} />
    {report && report.count > 0 && (
      <div className="grid gap-3">
        {report.signatures.map((sig: any, index: number) => <SignatureCard key={index} sig={sig} index={index} />)}
      </div>
    )}
    <ResultConsequenceNote>This is an offline check. It proves the signature maths and the signer certificate's self-consistency only. It does <strong>not</strong> validate a trust chain to a trusted root (no certificate-authority store is bundled) and does <strong>not</strong> check revocation (no OCSP/CRL lookup — that would require network access, which this tool never uses). "Valid" here means the cryptography holds and the document is unchanged, not that the signer's identity has been vouched for by a CA.</ResultConsequenceNote>
  </ToolForm>;
}

function ImageOutputTool({ tool, mode }: { tool: Tool; mode: "compress" | "convert" }) {
  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState("image/jpeg");
  const [quality, setQuality] = useState("0.82");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <FileControl accept="image/jpeg,image/png,image/webp" files={files} setFiles={setFiles} />
    <Select label="Output format" value={format} onChange={setFormat} options={["image/jpeg", "image/png", "image/webp"]} labels={["JPEG", "PNG", "WebP"]} />
    {mode === "compress" && format !== "image/png" && <Range label="Quality" value={quality} onChange={setQuality} />}
    {mode === "compress" && format === "image/png" && (
      <p className="text-xs font-semibold text-neutral-500">PNG is lossless, so the quality setting does not apply. Choose JPEG or WebP to trade quality for a smaller file.</p>
    )}
    <PrimaryButton label={mode === "compress" ? "Compress image" : "Convert image"} onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const blob = mode === "compress"
        ? await compressImage(file, format, Number(quality))
        : await exportCanvas(await imageToCanvas(file), format, 0.92);
      downloadBlob(blob, withExtension(`${safeFilename(file.name)}-${mode}`, imageExt(format)));
      const grew = mode === "compress" && blob.size >= file.size;
      return `Original: ${formatBytes(file.size)}\nOutput: ${formatBytes(blob.size)}${grew ? "\nNote: the output is not smaller than the original. The source may already be optimized — try JPEG or WebP output." : ""}`;
    })} />
  </ToolForm>;
}

function BatchImageTool({ tool, mode }: { tool: Tool; mode: "compress" | "resize" }) {
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState("0.82");
  const [width, setWidth] = useState("1200");
  const [height, setHeight] = useState("800");
  const [preserve, setPreserve] = useState(true);
  const [format, setFormat] = useState("image/jpeg");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <FileControl accept="image/jpeg,image/png,image/webp" multiple files={files} setFiles={setFiles} />
    <Select label="Output format" value={format} onChange={setFormat} options={["image/jpeg", "image/png", "image/webp"]} labels={["JPEG", "PNG", "WebP"]} />
    {mode === "compress" ? <Range label="Quality" value={quality} onChange={setQuality} /> : (
      <>
        <div className="grid gap-3 sm:grid-cols-2"><Input label="Width" value={width} onChange={setWidth} type="number" /><Input label="Height" value={height} onChange={setHeight} type="number" /></div>
        <Checkbox label="Preserve aspect ratio" checked={preserve} onChange={setPreserve} />
      </>
    )}
    <PrimaryButton label={mode === "compress" ? "Compress batch" : "Resize batch"} onClick={() => runSafely(setStatus, async () => {
      const valid = validateFiles(files, tool.file);
      let totalBefore = 0;
      let totalAfter = 0;
      const outputs: Record<string, Uint8Array> = {};
      for (const [index, file] of valid.entries()) {
        totalBefore += file.size;
        const blob = mode === "compress"
          ? await compressImage(file, format, Number(quality))
          : await exportCanvas(await resizeImage(file, Number(width), Number(height), preserve), format, 0.88);
        totalAfter += blob.size;
        const filename = withExtension(`${String(index + 1).padStart(2, "0")}-${safeFilename(file.name)}-${mode}`, imageExt(format));
        outputs[filename] = new Uint8Array(await blob.arrayBuffer());
      }
      const zipped = zipSync(outputs, { level: 0 });
      const zipBuffer = new ArrayBuffer(zipped.byteLength);
      new Uint8Array(zipBuffer).set(zipped);
      downloadBlob(new Blob([zipBuffer], { type: "application/zip" }), `myfilekit-${mode}-images.zip`);
      return `Processed ${valid.length} image${valid.length === 1 ? "" : "s"} into one ZIP file.\nBefore: ${formatBytes(totalBefore)}\nAfter: ${formatBytes(totalAfter)}`;
    })} />
  </ToolForm>;
}

function ResizeImageTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [width, setWidth] = useState("1200");
  const [height, setHeight] = useState("800");
  const [format, setFormat] = useState("image/jpeg");
  const [preserve, setPreserve] = useState(true);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <FileControl accept="image/jpeg,image/png,image/webp" files={files} setFiles={setFiles} />
    <div className="grid gap-3 sm:grid-cols-2"><Input label="Width" value={width} onChange={setWidth} type="number" /><Input label="Height" value={height} onChange={setHeight} type="number" /></div>
    <Checkbox label="Preserve aspect ratio" checked={preserve} onChange={setPreserve} />
    <Select label="Output format" value={format} onChange={setFormat} options={["image/jpeg", "image/png", "image/webp"]} labels={["JPEG", "PNG", "WebP"]} />
    <PrimaryButton label="Resize image" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const canvas = await resizeImage(file, Number(width), Number(height), preserve);
      const blob = await exportCanvas(canvas, format, 0.88);
      downloadBlob(blob, withExtension(`${safeFilename(file.name)}-resized`, imageExt(format)));
      return `Output: ${canvas.width}×${canvas.height}, ${formatBytes(blob.size)}`;
    })} />
  </ToolForm>;
}

function CropImageTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [values, setValues] = useState({ x: "0", y: "0", width: "500", height: "500" });
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <FileControl accept="image/jpeg,image/png,image/webp" files={files} setFiles={setFiles} />
    <div className="grid gap-3 sm:grid-cols-4">{(["x", "y", "width", "height"] as const).map((key) => <Input key={key} label={key.toUpperCase()} value={values[key]} onChange={(value) => setValues({ ...values, [key]: value })} type="number" />)}</div>
    <PrimaryButton label="Crop image" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const canvas = await cropImage(file, values.x, values.y, values.width, values.height);
      const blob = await exportCanvas(canvas, "image/png");
      downloadBlob(blob, withExtension(`${safeFilename(file.name)}-cropped`, "png"));
      return `Cropped to ${canvas.width}×${canvas.height}.`;
    })} />
  </ToolForm>;
}

function RotateFlipImageTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [rotation, setRotation] = useState("90");
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <FileControl accept="image/jpeg,image/png,image/webp" files={files} setFiles={setFiles} />
    <Select label="Rotation" value={rotation} onChange={setRotation} options={["90", "180", "270"]} />
    <div className="grid gap-2 sm:grid-cols-2"><Checkbox label="Flip horizontal" checked={flipX} onChange={setFlipX} /><Checkbox label="Flip vertical" checked={flipY} onChange={setFlipY} /></div>
    <PrimaryButton label="Export image" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const canvas = await rotateFlipImage(file, rotation, flipX, flipY);
      const blob = await exportCanvas(canvas, "image/png");
      downloadBlob(blob, withExtension(`${safeFilename(file.name)}-rotated`, "png"));
      return `Output: ${canvas.width}×${canvas.height}.`;
    })} />
  </ToolForm>;
}

function AddTextToImageTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("MyFileKit");
  const [x, setX] = useState("40");
  const [y, setY] = useState("80");
  const [size, setSize] = useState("48");
  const [color, setColor] = useState("#111827");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setText(""); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      This overlays new text onto the image pixels. It does not OCR or replace existing text already baked into a PNG.
    </div>
    <FileControl accept="image/jpeg,image/png,image/webp" files={files} setFiles={setFiles} />
    <Input label="Text" value={text} onChange={setText} />
    <div className="grid gap-3 sm:grid-cols-4"><Input label="X" value={x} onChange={setX} type="number" /><Input label="Y" value={y} onChange={setY} type="number" /><Input label="Size" value={size} onChange={setSize} type="number" /><Input label="Color" value={color} onChange={setColor} type="color" /></div>
    <PrimaryButton label="Add text to image" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const canvas = await addTextToImage(file, { text, x: Number(x), y: Number(y), size: Number(size), color });
      const blob = await exportCanvas(canvas, "image/png");
      downloadBlob(blob, withExtension(`${safeFilename(file.name)}-text-added`, "png"));
      return `Text added to ${file.name}.`;
    })} />
  </ToolForm>;
}

function AddSignatureToImageTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [signatures, setSignatures] = useState<File[]>([]);
  const [x, setX] = useState("40");
  const [y, setY] = useState("40");
  const [width, setWidth] = useState("280");
  const [opacity, setOpacity] = useState("1");
  const [status, setStatus] = useState(initialStatus);
  const imageOptions = { maxFiles: 1, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] };
  return <ToolForm status={status} onReset={() => { setFiles([]); setSignatures([]); setStatus(initialStatus); }}>
    <FileControl accept="image/jpeg,image/png,image/webp" files={files} setFiles={setFiles} label="Choose base image" />
    <FileControl accept="image/jpeg,image/png,image/webp" files={signatures} setFiles={setSignatures} label="Choose signature image" />
    <div className="grid gap-3 sm:grid-cols-4"><Input label="X" value={x} onChange={setX} type="number" /><Input label="Y" value={y} onChange={setY} type="number" /><Input label="Width" value={width} onChange={setWidth} type="number" /><Input label="Opacity" value={opacity} onChange={setOpacity} type="number" /></div>
    <PrimaryButton label="Add signature to image" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const [signature] = validateFiles(signatures, imageOptions);
      const canvas = await addSignatureToImage(file, signature, { x: Number(x), y: Number(y), width: Number(width), opacity: Number(opacity) });
      const blob = await exportCanvas(canvas, "image/png");
      downloadBlob(blob, withExtension(`${safeFilename(file.name)}-signed`, "png"));
      return `Signature added to ${file.name}.`;
    })} />
  </ToolForm>;
}

type MetadataImageInfo = {
  name: string;
  type: string;
  size: number;
  width: number;
  height: number;
  lastModified: number;
};

type MetadataReport = {
  format: string;
  metadataCount: number;
  containers: Array<{ type: string; detail: string; removable: boolean }>;
  groups: Array<{ title: string; items: Array<{ label: string; value: string; sensitive?: boolean }> }>;
  privacy: Record<string, boolean>;
  warnings: string[];
};

function ImageMetadataInspectorTool({ tool }: { tool: Tool }) {
  return <ImageMetadataTool tool={tool} canClean={false} />;
}

function MetadataCleanerTool({ tool }: { tool: Tool }) {
  return <ImageMetadataTool tool={tool} canClean />;
}

function ImageMetadataTool({ tool, canClean }: { tool: Tool; canClean: boolean }) {
  const [files, setFiles] = useState<File[]>([]);
  const [info, setInfo] = useState<MetadataImageInfo | null>(null);
  const [report, setReport] = useState<MetadataReport | null>(null);
  const [cleaned, setCleaned] = useState<{ blob: Blob; filename: string } | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => {
    setFiles([]);
    setInfo(null);
    setReport(null);
    setCleaned(null);
    setStatus(initialStatus);
  };

  useEffect(() => {
    let cancelled = false;
    setCleaned(null);
    setInfo(null);
    setReport(null);
    if (!files.length) return undefined;

    runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const [dimensions, metadata] = await Promise.all([imageDimensions(file), inspectImageMetadata(file)]);
      if (cancelled) return "Ready.";
      setInfo({
        name: file.name,
        type: file.type || "Unknown image type",
        size: file.size,
        width: dimensions.width,
        height: dimensions.height,
        lastModified: file.lastModified,
      });
      setReport(metadata);
      return metadata.metadataCount
        ? `Found ${metadata.metadataCount} metadata detail${metadata.metadataCount === 1 ? "" : "s"} locally. Review and clean when ready.`
        : "Image validated locally. No embedded metadata was detected by the local parser.";
    });

    return () => {
      cancelled = true;
    };
  }, [files, tool.file]);

  const clean = () => runSafely(setStatus, async () => {
    const [file] = validateFiles(files, tool.file);
    const outputType = file.type || "image/png";
    const blob = await cleanImageMetadata(file, outputType);
    const filename = withExtension(`${safeFilename(file.name)}-cleaned`, imageExt(outputType));
    setCleaned({ blob, filename });
    return "The cleaned image is re-encoded locally in your browser. Most embedded metadata is removed, but browser-based cleaning may not preserve every original encoding detail.";
  });

  return (
    <ToolForm status={status} onReset={reset}>
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        {canClean
          ? "Full local image metadata workflow for JPG/JPEG, PNG, and WebP: inspect EXIF/XMP/ICC/IPTC-style containers where present, review sensitive fields like GPS, then re-encode a cleaned copy in your browser."
          : "Read EXIF, XMP, ICC, GPS, and container metadata from JPG/JPEG, PNG, and WebP images locally. This inspector does not upload, alter, or store your file."}
      </div>
      <FileControl accept="image/jpeg,image/png,image/webp" files={files} setFiles={setFiles} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="surface-card wabi-card-edge p-4">
          <p className="font-black">Detected file info</p>
          {info ? (
            <dl className="mt-3 grid gap-2 text-sm font-semibold text-neutral-600">
              <InfoRow label="File name" value={info.name} />
              <InfoRow label="File type" value={info.type} />
              <InfoRow label="File size" value={formatBytes(info.size)} />
              <InfoRow label="Dimensions" value={`${info.width}×${info.height}px`} />
              <InfoRow label="Last modified" value={info.lastModified ? new Date(info.lastModified).toLocaleString() : "Not available"} />
            </dl>
          ) : (
            <p className="mt-3 text-sm font-semibold text-neutral-500">Choose a supported image to inspect basic browser file info.</p>
          )}
        </div>
        <div className="surface-card wabi-card-edge p-4">
          <p className="font-black">Privacy scan</p>
          {report ? (
            <div className="mt-3 grid gap-3 text-sm font-semibold text-neutral-600">
              <InfoRow label="Container" value={report.format} />
              <InfoRow label="Metadata details" value={String(report.metadataCount)} />
              <InfoRow label="GPS/location" value={report.privacy.hasGps ? "Detected" : "Not detected"} />
              <InfoRow label="Camera/device" value={report.privacy.hasCamera ? "Detected" : "Not detected"} />
              <InfoRow label="XMP" value={report.privacy.hasXmp ? "Detected" : "Not detected"} />
              <InfoRow label="ICC profile" value={report.privacy.hasIccProfile ? "Detected" : "Not detected"} />
            </div>
          ) : (
            <p className="mt-3 text-sm font-semibold text-neutral-500">Metadata scan results will appear here after upload.</p>
          )}
        </div>
      </div>
      {report && (
        <div className="surface-card wabi-card-edge grid gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-black">Detected metadata</p>
            <SecondaryButton label="Download JSON report" onClick={() => downloadText(metadataReportToJson(report), "metadata-report", "json", "application/json;charset=utf-8")} />
          </div>
          {report.warnings.length > 0 && (
            <div className="surface-muted wabi-card-edge p-3 text-sm font-semibold leading-6 text-neutral-600">
              {report.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          )}
          {report.containers.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {report.containers.map((container, index) => (
                <div key={`${container.type}-${index}`} className="surface-muted wabi-card-edge p-3 text-sm font-semibold text-neutral-600">
                  <p className="font-black text-[var(--ink)]">{container.type}</p>
                  <p className="mt-1">{container.detail}</p>
                </div>
              ))}
            </div>
          )}
          {report.groups.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {report.groups.map((group) => (
                <div key={group.title} className="surface-muted wabi-card-edge p-4">
                  <p className="font-black capitalize">{group.title}</p>
                  <dl className="mt-3 grid gap-2 text-sm font-semibold text-neutral-600">
                    {group.items.map((item, index) => (
                      <InfoRow key={`${item.label}-${index}`} label={item.sensitive ? `${item.label} ⚠` : item.label} value={String(item.value)} />
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm font-semibold text-neutral-500">No readable embedded metadata fields were detected.</p>
          )}
        </div>
      )}
      {canClean && (
        <div className="surface-card wabi-card-edge p-4">
          <p className="font-black">Cleaned result</p>
          {cleaned && info ? (
              <div className="mt-3 grid gap-3 text-sm font-semibold text-neutral-600">
                <InfoRow label="Before" value={formatBytes(info.size)} />
                <InfoRow label="After" value={formatBytes(cleaned.blob.size)} />
                <InfoRow label="Output" value={cleaned.filename} />
                <SecondaryButton label="Download cleaned image" onClick={() => downloadBlob(cleaned.blob, cleaned.filename)} />
              </div>
          ) : (
            <p className="mt-3 text-sm font-semibold text-neutral-500">Cleaned image details will appear here after processing.</p>
          )}
        </div>
      )}
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        Privacy note: the selected image and metadata report are processed locally in this browser session. MyFileKit does not upload it, store it, track it, or log metadata contents.
      </div>
      {canClean && <PrimaryButton label="Clean metadata and re-encode image" onClick={clean} />}
    </ToolForm>
  );
}

function DrawSignatureTool() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasInkRef = useRef(false);
  const [color, setColor] = useState("#111111");
  const [size, setSize] = useState("4");
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let drawing = false;
    const pointFromEvent = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * (canvas.width / rect.width),
        y: (event.clientY - rect.top) * (canvas.height / rect.height),
      };
    };
    const start = (event: PointerEvent) => {
      event.preventDefault();
      drawing = true;
      hasInkRef.current = true;
      canvas.setPointerCapture?.(event.pointerId);
      const { x, y } = pointFromEvent(event);
      ctx.beginPath();
      ctx.moveTo(x, y);
    };
    const draw = (event: PointerEvent) => {
      if (!drawing) return;
      event.preventDefault();
      const { x, y } = pointFromEvent(event);
      ctx.strokeStyle = color;
      ctx.lineWidth = Number(size);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineTo(x, y);
      ctx.stroke();
    };
    const stop = () => { drawing = false; };
    canvas.addEventListener("pointerdown", start);
    canvas.addEventListener("pointermove", draw);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("pointerleave", stop);
    window.addEventListener("pointerup", stop);
    return () => {
      canvas.removeEventListener("pointerdown", start);
      canvas.removeEventListener("pointermove", draw);
      canvas.removeEventListener("pointercancel", stop);
      canvas.removeEventListener("pointerleave", stop);
      window.removeEventListener("pointerup", stop);
    };
  }, [color, size]);

  return <ToolForm status={status} onReset={() => { canvasRef.current?.getContext("2d")?.clearRect(0, 0, 900, 260); hasInkRef.current = false; setStatus(initialStatus); }}>
    <canvas ref={canvasRef} className="surface-card h-auto min-h-44 w-full touch-none rounded-3xl border-dashed border-neutral-400" width={900} height={260} />
    <div className="grid gap-3 sm:grid-cols-2"><Input label="Color" value={color} onChange={setColor} type="color" /><Input label="Thickness" value={size} onChange={setSize} type="number" /></div>
    <PrimaryButton label="Download PNG" onClick={() => runSafely(setStatus, async () => {
      if (!hasInkRef.current || !canvasRef.current) throw new Error("Draw a signature before downloading.");
      downloadBlob(await canvasToBlob(canvasRef.current, "image/png"), "signature.png");
      return "Signature ready to download.";
    })} />
  </ToolForm>;
}

function TypeSignatureTool() {
  const [name, setName] = useState("");
  const [style, setStyle] = useState("cursive");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setName(""); setStatus(initialStatus); }}>
    <Input label="Name" value={name} onChange={setName} placeholder="Type your name" />
    <Select label="Style" value={style} onChange={setStyle} options={["cursive", "serif", "monospace"]} labels={["Cursive", "Serif", "Monospace"]} />
    <PrimaryButton label="Download PNG" onClick={() => runSafely(setStatus, async () => {
      if (!name.trim()) throw new Error("Enter a name before downloading a signature.");
      const canvas = document.createElement("canvas");
      canvas.width = 900; canvas.height = 260;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser cannot create a signature image.");
      ctx.font = `72px ${style}`;
      ctx.fillText(name.trim(), 40, 145);
      downloadBlob(await canvasToBlob(canvas, "image/png"), "typed-signature.png");
      return "Signature ready to download.";
    })} />
  </ToolForm>;
}

function TextToPdfTool() {
  const [text, setText] = useState("Paste text here...");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setText(""); setStatus(initialStatus); }}>
    <Textarea label="Text" value={text} onChange={setText} rows={14} />
    <PrimaryButton label="Download PDF" onClick={() => runSafely(setStatus, async () => { downloadBytes(await textToPdf(text), "myfilekit-text.pdf", "application/pdf"); return "PDF downloaded."; })} />
  </ToolForm>;
}

function MarkdownTool() {
  const [markdown, setMarkdown] = useState("# Heading\n\n- Item");
  const html = simpleMarkdownToHtml(markdown);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setMarkdown(""); setStatus(initialStatus); }}>
    <Textarea label="Markdown" value={markdown} onChange={setMarkdown} rows={10} />
    <div className="surface-card wabi-card-edge grid gap-3 p-4">{renderMarkdownPreview(markdown)}</div>
    <PrimaryButton label="Download HTML" onClick={() => runSafely(setStatus, async () => {
      if (!markdown.trim()) throw new Error("Add Markdown before downloading.");
      downloadText(html, "markdown-preview", "html", "text/html;charset=utf-8");
      return "HTML downloaded.";
    })} />
  </ToolForm>;
}

function renderMarkdownPreview(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const nodes: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems;
    listItems = [];
    nodes.push(<ul key={`list-${nodes.length}`} className="list-disc pl-5 text-sm font-semibold leading-7 text-neutral-700">{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>);
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    if (trimmed.startsWith("- ")) {
      listItems.push(trimmed.slice(2));
      return;
    }
    flushList();
    if (trimmed.startsWith("# ")) {
      nodes.push(<h1 key={index} className="font-display text-2xl font-black">{trimmed.slice(2)}</h1>);
    } else if (trimmed.startsWith("## ")) {
      nodes.push(<h2 key={index} className="font-display text-xl font-black">{trimmed.slice(3)}</h2>);
    } else {
      nodes.push(<p key={index} className="text-sm font-semibold leading-7 text-neutral-700">{trimmed}</p>);
    }
  });
  flushList();

  return nodes.length ? nodes : <p className="text-sm font-semibold text-neutral-500">Markdown preview will appear here.</p>;
}

function MarkdownToPdfTool() {
  const [markdown, setMarkdown] = useState("# MyFileKit\n\nThis Markdown becomes a clean, crisp PDF.\n\n## Features\n\n- Headings render larger and bold\n- Bullet lists are indented\n- Long paragraphs wrap neatly inside the page margins");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setMarkdown(""); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Builds vector text with pdf-lib, so the PDF stays crisp at any zoom. Supports Latin-1 characters only (no CJK/emoji).
    </div>
    <Textarea label="Markdown" value={markdown} onChange={setMarkdown} rows={12} />
    <div className="surface-card wabi-card-edge grid gap-3 p-4">{renderMarkdownPreview(markdown)}</div>
    <PrimaryButton label="Download PDF" onClick={() => runSafely(setStatus, async () => {
      downloadBytes(await markdownToPdf(markdown), "myfilekit-markdown.pdf", "application/pdf");
      return "Markdown PDF downloaded.";
    })} />
  </ToolForm>;
}

function CsvToPdfTool() {
  const [csv, setCsv] = useState("name,role,city\nAlex,Engineer,London\nSam,Designer,Berlin\nJordan,Product Manager,San Francisco");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setCsv(""); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      The first row becomes a bold header. Long cells wrap and the table paginates across pages. Supports Latin-1 characters only.
    </div>
    <Textarea label="CSV" value={csv} onChange={setCsv} rows={12} />
    <PrimaryButton label="Download PDF" onClick={() => runSafely(setStatus, async () => {
      downloadBytes(await csvToPdf(csv), "myfilekit-table.pdf", "application/pdf");
      return "CSV table PDF downloaded.";
    })} />
  </ToolForm>;
}

function HtmlToPdfTool() {
  const [html, setHtml] = useState("<h1>Hello from MyFileKit</h1>\n<p>Paste any HTML here. It renders locally in a sandboxed frame.</p>\n<ul><li>Scripts never run</li><li>Remote resources are blocked</li></ul>");
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [status, setStatus] = useState(initialStatus);
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}body{padding:24px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;line-height:1.5}img,table{max-width:100%}</style></head><body>${html}</body></html>`;
  return <ToolForm status={status} onReset={() => { setHtml(""); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      HTML is rendered locally in a sandboxed frame with scripts disabled. Remote images, styles, and network requests are blocked, so no external content is fetched or executed.
    </div>
    <Textarea label="HTML" value={html} onChange={setHtml} rows={10} />
    <div className="grid gap-2">
      <span className="text-xs font-black uppercase text-neutral-500">Local preview</span>
      <iframe
        ref={frameRef}
        title="Sandboxed HTML preview"
        sandbox="allow-same-origin"
        srcDoc={srcDoc}
        className="surface-card wabi-card-edge h-80 w-full rounded-3xl bg-white"
      />
    </div>
    <PrimaryButton label="Download PDF" onClick={() => runSafely(setStatus, async () => {
      if (!html.trim()) throw new Error("Paste some HTML first.");
      const html2canvas = getHtml2Canvas();
      const doc = frameRef.current?.contentDocument;
      if (!doc?.body) throw new Error("The preview is not ready yet. Wait a moment and try again.");
      await doc.fonts?.ready?.catch(() => {});
      const canvas = await html2canvas(doc.body, { backgroundColor: "#ffffff", scale: 2, useCORS: false, logging: false });
      downloadBytes(await canvasToPdf(canvas), "myfilekit-html.pdf", "application/pdf");
      return "HTML PDF downloaded.";
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
    const height = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, 1);
    iframe.style.height = `${height}px`;
    return await html2canvas(doc.body, {
      backgroundColor: "#ffffff",
      scale,
      useCORS: false,
      logging: false,
      width: widthPx,
      windowWidth: widthPx,
    });
  } finally {
    iframe.remove();
  }
}

function WordToPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Converts a Word .docx locally: styles, headings, bold/italic, lists, tables, and embedded images are preserved as faithfully as possible, then rendered to a PDF in your browser. Legacy .doc files must be re-saved as .docx first.
    </div>
    <FileControl accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" files={files} setFiles={setFiles} label="Choose or drop a Word file" />
    <PrimaryButton label="Download PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      setStatus({ tone: "idle", message: "Reading document…" });
      const html = sanitizeHtmlForOffline(await docxToHtml(file));
      setStatus({ tone: "idle", message: "Rendering PDF…" });
      const canvas = await renderHtmlToCanvas(html);
      downloadBytes(await canvasToPdf(canvas), withExtension(`${safeFilename(file.name)}`, "pdf"), "application/pdf");
      return "Word document converted to PDF.";
    })} />
  </ToolForm>;
}

function ExcelToPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Reads .xlsx, .xls, or .csv locally with SheetJS and renders every sheet as a table in one PDF. Wide sheets are scaled to fit the page width, so very large tables render smaller.
    </div>
    <FileControl accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" files={files} setFiles={setFiles} label="Choose or drop a spreadsheet" />
    <PrimaryButton label="Download PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      setStatus({ tone: "idle", message: "Reading workbook…" });
      const sheets = await readWorkbookSheets(file);
      setStatus({ tone: "idle", message: `Rendering ${sheets.length} sheet${sheets.length === 1 ? "" : "s"}…` });
      const canvas = await renderHtmlToCanvas(sheetsToHtml(sheets));
      downloadBytes(await canvasToPdf(canvas), withExtension(`${safeFilename(file.name)}`, "pdf"), "application/pdf");
      return `Converted ${sheets.length} sheet${sheets.length === 1 ? "" : "s"} to PDF.`;
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
    <PrimaryButton label="Download PDF" onClick={() => runSafely(setStatus, async () => {
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

// Shared per-page progress reporter for the export tools below.
function pageProgress(setStatus: (status: Status) => void, verb: string) {
  return (page: number, total: number) => setStatus({
    tone: "idle",
    message: `${verb} page ${page} of ${total}…`,
    progress: { value: page, total, label: `${verb}…` },
  });
}

function PdfToWordTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Text-focused conversion: each line of selectable text becomes a Word paragraph, blank space becomes a blank line, and every PDF page ends with a page break. Multi-column layouts, tables, and images are not reproduced. A scanned PDF has no selectable text — run OCR first.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PrimaryButton label="Download .docx" onClick={() => runSafely(setStatus, async () => {
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
    <PrimaryButton label="Download .xlsx" onClick={() => runSafely(setStatus, async () => {
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
    <PrimaryButton label="Download .html" onClick={() => runSafely(setStatus, async () => {
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
          ? `Read ${pages} page${pages === 1 ? "" : "s"} and downloaded a searchable PDF.`
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

function AudioToPdfTool() {
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [title, setTitle] = useState("Transcript");
  const [listening, setListening] = useState(false);
  const [onDeviceOnly, setOnDeviceOnly] = useState(true);
  const [status, setStatus] = useState(initialStatus);
  const recognizer = useRef<any>(null);
  const support = speechRecognitionSupport();

  // Capability is detected synchronously; the note is plain honesty about what
  // pressing "Start dictation" will actually do in this browser.
  const engineNote = !support.supported
    ? "This browser has no built-in speech recognition, so dictation is unavailable here. Paste or type the transcript below — that path is fully offline."
    : onDeviceOnly
      ? support.canRunOnDevice
        ? "Dictation will ask this browser to recognise speech on your device. If it cannot, it stops with an error rather than sending your audio anywhere."
        : "This browser cannot keep recognition on your device, so dictation is blocked while the box below is ticked. Untick it to allow cloud recognition, or paste the transcript instead."
      : "Heads up: with on-device recognition off, this browser may send your audio to its vendor's servers. Every other MyFileKit tool stays local — paste or type the transcript instead if you need a fully offline path.";

  const stopListening = () => {
    recognizer.current?.stop();
    recognizer.current = null;
    setListening(false);
    setInterim("");
  };

  // Always release the microphone when the tool unmounts.
  useEffect(() => () => { recognizer.current?.stop(); recognizer.current = null; }, []);

  const reset = () => {
    stopListening();
    setTranscript("");
    setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Two ways in: dictate with your microphone using the browser's own speech recognition, or paste a transcript you already have. The PDF is always built locally. The microphone is released as soon as you stop or leave this tool.
    </div>
    <StatusBox status={{ tone: support.supported ? "idle" : "error", message: engineNote }} />
    <Checkbox label="Require on-device recognition (never send audio to a server)" checked={onDeviceOnly} onChange={setOnDeviceOnly} />
    <div className="flex flex-wrap gap-2">
      {listening
        ? <SecondaryButton label="Stop dictation" onClick={stopListening} />
        : <SecondaryButton label="Start dictation" onClick={() => runSafely(setStatus, async () => {
            if (recognizer.current) throw new Error("Already listening.");
            const instance = await createSpeechRecognizer({
              requireOnDevice: onDeviceOnly,
              onTranscript: ({ final, interim: partial }: { final: string; interim: string }) => {
                if (final.trim()) setTranscript((previous) => (previous ? `${previous} ${final.trim()}` : final.trim()));
                setInterim(partial);
              },
              onError: (message: string) => setStatus({ tone: "error", message }),
              onEnd: () => { setListening(false); setInterim(""); },
            });
            recognizer.current = instance;
            instance.start();
            setListening(true);
            return instance.local
              ? "Listening on-device. Speak, then stop when you are done."
              : "Listening. Speak, then stop when you are done.";
          })} />}
    </div>
    {listening && interim && <p className="text-sm font-semibold italic text-neutral-500">Hearing: {interim}</p>}
    <Input label="PDF title" value={title} onChange={setTitle} placeholder="Transcript" />
    <Textarea label="Transcript" value={transcript} onChange={setTranscript} rows={12} />
    <PrimaryButton label="Download PDF" onClick={() => runSafely(setStatus, async () => {
      const body = requireOutput(transcript);
      const heading = title.trim() || "Transcript";
      const document = `${heading}\n${new Date().toLocaleString()}\n\n${body.trim()}\n`;
      downloadBytes(await textToPdf(document), withExtension(heading, "pdf"), "application/pdf");
      return "Transcript PDF ready.";
    })} />
  </ToolForm>;
}

const equationExamples = ["E = mc^2", "\\frac{a}{b}", "\\sqrt{x^2 + y^2}", "\\sum_{i=1}^{n} i", "\\int_0^\\infty e^{-x}\\,dx"];

function EquationToImageTool() {
  const [latex, setLatex] = useState("E = mc^2");
  const [format, setFormat] = useState("png");
  const [transparent, setTransparent] = useState(true);
  const [scale, setScale] = useState("4");
  const [error, setError] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const mathRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = mathRef.current;
    if (!element) return;
    try {
      katex.render(latex.trim() || "\\,", element, { throwOnError: true, displayMode: true });
      setError("");
    } catch (renderError: any) {
      setError(renderError?.message || "Invalid LaTeX.");
    }
  }, [latex]);

  return <ToolForm status={status} onReset={() => { setLatex(""); setError(""); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Renders LaTeX with KaTeX entirely in your browser — fonts are bundled locally, so nothing is fetched from the network.
    </div>
    <Textarea label="LaTeX equation" value={latex} onChange={setLatex} rows={4} />
    <div className="flex flex-wrap gap-2">
      {equationExamples.map((example) => (
        <button key={example} type="button" className="quick-chip" onClick={() => setLatex(example)}>{example}</button>
      ))}
    </div>
    <div className="surface-card wabi-card-edge grid min-h-28 place-items-center overflow-x-auto p-6">
      <div ref={mathRef} />
    </div>
    {error && <StatusBox status={{ tone: "error", message: `Invalid LaTeX: ${error}` }} />}
    <div className="grid gap-3 sm:grid-cols-3">
      <Select label="Format" value={format} onChange={setFormat} options={["png", "jpg"]} labels={["PNG", "JPG"]} />
      <Select label="Scale" value={scale} onChange={setScale} options={["2", "4", "6"]} labels={["2× · standard", "4× · sharp", "6× · large"]} />
      {format === "png" && <Checkbox label="Transparent background" checked={transparent} onChange={setTransparent} />}
    </div>
    <PrimaryButton label="Download image" onClick={() => runSafely(setStatus, async () => {
      if (!latex.trim()) throw new Error("Enter a LaTeX equation first.");
      if (error) throw new Error(`Invalid LaTeX: ${error}`);
      const element = mathRef.current;
      if (!element) throw new Error("The equation preview is not ready yet.");
      const html2canvas = getHtml2Canvas();
      await document.fonts?.ready?.catch(() => {});
      const type = format === "png" ? "image/png" : "image/jpeg";
      const useTransparent = format === "png" && transparent;
      const canvas = await html2canvas(element, {
        backgroundColor: useTransparent ? null : "#ffffff",
        scale: Number(scale),
        logging: false,
      });
      downloadBlob(await canvasToBlob(canvas, type), withExtension("myfilekit-equation", format));
      return `Equation image downloaded as ${format.toUpperCase()}.`;
    })} />
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
        <p className="text-xs font-black uppercase text-neutral-500">Captured pages · {thumbs.length}</p>
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

function JsonTool() {
  const [input, setInput] = useState('{"hello":"world"}');
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const transform = (spaces: number) => runSafely(setStatus, async () => { const next = JSON.stringify(JSON.parse(input), null, spaces); setOutput(next); return spaces ? "JSON formatted." : "JSON minified."; });
  return <ToolForm status={status} onReset={() => { setInput(""); setOutput(""); setStatus(initialStatus); }}>
    <Textarea label="JSON input" value={input} onChange={setInput} rows={10} />
    <Textarea label="Result" value={output} onChange={setOutput} rows={10} />
    <div className="flex flex-wrap gap-2">
      <PrimaryButton label="Format" onClick={() => transform(2)} />
      <SecondaryButton label="Minify" onClick={() => transform(0)} />
      <SecondaryButton label="Copy" onClick={() => runSafely(setStatus, async () => { await copyText(requireOutput(output || input)); return "Copied."; })} />
      <SecondaryButton label="Download JSON" onClick={() => runSafely(setStatus, async () => { downloadText(requireOutput(output || input), "formatted", "json", "application/json;charset=utf-8"); return "JSON ready to download."; })} />
    </div>
  </ToolForm>;
}

function CsvToJsonTool() {
  const [input, setInput] = useState("name,email\nAlex,alex@example.com");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setInput(""); setOutput(""); setStatus(initialStatus); }}>
    <Textarea label="CSV input" value={input} onChange={setInput} rows={9} />
    <Textarea label="JSON output" value={output} onChange={setOutput} rows={10} />
    <div className="flex flex-wrap gap-2">
      <PrimaryButton label="Convert" onClick={() => runSafely(setStatus, async () => { setOutput(JSON.stringify(csvToJson(input), null, 2)); return "CSV converted."; })} />
      <SecondaryButton label="Copy" onClick={() => runSafely(setStatus, async () => { await copyText(requireOutput(output)); return "Copied."; })} />
      <SecondaryButton label="Download JSON" onClick={() => runSafely(setStatus, async () => { downloadText(requireOutput(output), "converted", "json", "application/json;charset=utf-8"); return "JSON ready to download."; })} />
    </div>
  </ToolForm>;
}

function JsonToCsvTool() {
  const [input, setInput] = useState('[{"name":"Alex","email":"alex@example.com"}]');
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setInput(""); setOutput(""); setStatus(initialStatus); }}>
    <Textarea label="JSON input" value={input} onChange={setInput} rows={9} />
    <Textarea label="CSV output" value={output} onChange={setOutput} rows={10} />
    <div className="flex flex-wrap gap-2"><PrimaryButton label="Convert" onClick={() => runSafely(setStatus, async () => { setOutput(jsonToCsv(input)); return "JSON converted."; })} /><SecondaryButton label="Copy" onClick={() => runSafely(setStatus, async () => { await copyText(requireOutput(output)); return "Copied."; })} /><SecondaryButton label="Download CSV" onClick={() => runSafely(setStatus, async () => { downloadText(requireOutput(output), "converted", "csv", "text/csv;charset=utf-8"); return "CSV ready to download."; })} /></div>
  </ToolForm>;
}

function JsonToYamlTool() {
  const [input, setInput] = useState('{"name":"MyFileKit","local":true,"tools":["pdf","image","data"]}');
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setInput(""); setOutput(""); setStatus(initialStatus); }}>
    <Textarea label="JSON input" value={input} onChange={setInput} rows={9} />
    <Textarea label="YAML output" value={output} onChange={setOutput} rows={10} />
    <div className="flex flex-wrap gap-2">
      <PrimaryButton label="Convert to YAML" onClick={() => runSafely(setStatus, async () => { setOutput(jsonToYaml(input)); return "JSON converted to YAML."; })} />
      <SecondaryButton label="Copy" onClick={() => runSafely(setStatus, async () => { await copyText(requireOutput(output)); return "Copied."; })} />
      <SecondaryButton label="Download YAML" onClick={() => runSafely(setStatus, async () => { downloadText(requireOutput(output), "converted", "yaml", "text/yaml;charset=utf-8"); return "YAML ready to download."; })} />
    </div>
  </ToolForm>;
}

function UrlCodecTool() {
  const [input, setInput] = useState("https://example.com/search?q=MyFileKit tools");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setInput(""); setOutput(""); setStatus(initialStatus); }}>
    <Textarea label="Input" value={input} onChange={setInput} rows={7} />
    <Textarea label="Output" value={output} onChange={setOutput} rows={7} />
    <div className="flex flex-wrap gap-2">
      <PrimaryButton label="Encode URL text" onClick={() => runSafely(setStatus, async () => { if (!input.trim()) throw new Error("Enter text to encode."); setOutput(urlEncode(input)); return "URL text encoded."; })} />
      <SecondaryButton label="Decode URL text" onClick={() => runSafely(setStatus, async () => { setOutput(urlDecode(input)); return "URL text decoded."; })} />
    </div>
  </ToolForm>;
}

function DiffCheckerTool() {
  const [left, setLeft] = useState("Line one\nLine two");
  const [right, setRight] = useState("Line one\nLine two updated");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setLeft(""); setRight(""); setOutput(""); setStatus(initialStatus); }}>
    <div className="grid gap-4 lg:grid-cols-2">
      <Textarea label="Original" value={left} onChange={setLeft} rows={9} />
      <Textarea label="Changed" value={right} onChange={setRight} rows={9} />
    </div>
    <Textarea label="Diff output" value={output} onChange={setOutput} rows={10} />
    <div className="flex flex-wrap gap-2">
      <PrimaryButton label="Compare text" onClick={() => runSafely(setStatus, async () => { const rows = lineDiff(left, right); setOutput(diffToText(rows)); return `${rows.filter((row) => row.type !== "same").length} changed line entries found.`; })} />
      <SecondaryButton label="Copy" onClick={() => runSafely(setStatus, async () => { await copyText(requireOutput(output)); return "Copied."; })} />
      <SecondaryButton label="Download diff" onClick={() => runSafely(setStatus, async () => { downloadText(requireOutput(output), "text-diff", "diff", "text/plain;charset=utf-8"); return "Diff ready to download."; })} />
    </div>
  </ToolForm>;
}

function WordCounterTool() {
  const [input, setInput] = useState("Paste or type text here.");
  const stats = textStats(input);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setInput(""); setStatus(initialStatus); }}>
    <Textarea label="Text" value={input} onChange={setInput} rows={12} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {[
        ["Words", stats.words],
        ["Characters", stats.characters],
        ["No spaces", stats.charactersNoSpaces],
        ["Lines", stats.lines],
        ["Read time", `${stats.readingMinutes} min`],
      ].map(([label, value]) => (
        <div key={label} className="surface-card wabi-card-edge p-4">
          <p className="text-xs font-black uppercase text-neutral-500">{label}</p>
          <p className="mt-1 font-display text-2xl font-black">{value}</p>
        </div>
      ))}
    </div>
  </ToolForm>;
}

function Base64Tool() {
  const [input, setInput] = useState("Hello MyFileKit");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setInput(""); setOutput(""); setStatus(initialStatus); }}>
    <Textarea label="Input" value={input} onChange={setInput} rows={7} />
    <Textarea label="Output" value={output} onChange={setOutput} rows={7} />
    <div className="flex flex-wrap gap-2"><PrimaryButton label="Encode" onClick={() => runSafely(setStatus, async () => { if (!input.trim()) throw new Error("Enter text to encode."); setOutput(base64Encode(input)); return "Encoded."; })} /><SecondaryButton label="Decode" onClick={() => runSafely(setStatus, async () => { setOutput(base64Decode(input)); return "Decoded."; })} /><SecondaryButton label="Copy" onClick={() => runSafely(setStatus, async () => { await copyText(requireOutput(output)); return "Copied."; })} /></div>
  </ToolForm>;
}

function FileHashTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setOutput(""); setStatus(initialStatus); }}>
    <FileControl accept="*/*" files={files} setFiles={setFiles} />
    <Textarea label="SHA-256" value={output} onChange={setOutput} rows={3} />
    <PrimaryButton label="Generate SHA-256" onClick={() => runSafely(setStatus, async () => { const [file] = validateFiles(files, tool.file); setOutput(await sha256File(file)); return `Hashed ${file.name}.`; })} />
  </ToolForm>;
}

function HashCompareTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setExpected(""); setActual(""); setStatus(initialStatus); }}>
    <FileControl accept="*/*" files={files} setFiles={setFiles} />
    <Input label="Expected SHA-256" value={expected} onChange={setExpected} placeholder="Paste expected checksum" />
    <Textarea label="Actual SHA-256" value={actual} onChange={setActual} rows={3} />
    <PrimaryButton label="Compare hash" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const digest = await sha256File(file);
      setActual(digest);
      const normalized = expected.trim().toLowerCase().replace(/\s+/g, "");
      if (!normalized) return `Hash generated for ${file.name}. Paste an expected hash to compare.`;
      return normalized === digest ? "Hash match. File integrity check passed." : "Hash mismatch. The file does not match the expected SHA-256.";
    })} />
  </ToolForm>;
}

function PasswordGeneratorTool() {
  const [mode, setMode] = useState<"password" | "passphrase">("password");
  const [length, setLength] = useState("20");
  const [lower, setLower] = useState(true);
  const [upper, setUpper] = useState(true);
  const [numbers, setNumbers] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [minimumNumbers, setMinimumNumbers] = useState("1");
  const [minimumSymbols, setMinimumSymbols] = useState("1");
  const [avoidAmbiguous, setAvoidAmbiguous] = useState(true);
  const [words, setWords] = useState("6");
  const [separator, setSeparator] = useState("-");
  const [capitalise, setCapitalise] = useState(true);
  const [includeNumber, setIncludeNumber] = useState(true);
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const strength = passwordStrength(output);
  const modeLabel = mode === "password" ? "password" : "passphrase";
  const selectMode = (nextMode: "password" | "passphrase") => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setOutput("");
    setStatus(initialStatus);
  };
  const reset = () => {
    setMode("password");
    setLength("20");
    setLower(true);
    setUpper(true);
    setNumbers(true);
    setSymbols(true);
    setMinimumNumbers("1");
    setMinimumSymbols("1");
    setAvoidAmbiguous(true);
    setWords("6");
    setSeparator("-");
    setCapitalise(true);
    setIncludeNumber(true);
    setOutput("");
    setStatus(initialStatus);
  };
  const generate = () => runSafely(setStatus, async () => {
    const value = mode === "password"
      ? generatePassword({
          length: Number(length), lower, upper, numbers, symbols,
          minimumNumbers: Number(minimumNumbers), minimumSymbols: Number(minimumSymbols), avoidAmbiguous,
        })
      : generatePassphrase({ words: Number(words), separator, capitalise, includeNumber });
    setOutput(value);
    return `${mode === "password" ? "Password" : "Passphrase"} generated locally.`;
  });
  return <ToolForm status={status} onReset={reset}>
    <div className="generator-mode-switch" role="tablist" aria-label="Generator type">
      <button className={`generator-mode-button ${mode === "password" ? "is-active" : ""}`} role="tab" aria-selected={mode === "password"} type="button" onClick={() => selectMode("password")}>Password</button>
      <button className={`generator-mode-button ${mode === "passphrase" ? "is-active" : ""}`} role="tab" aria-selected={mode === "passphrase"} type="button" onClick={() => selectMode("passphrase")}>Passphrase</button>
    </div>
    <div className="password-output-panel" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-[.08em] text-neutral-500">Generated {modeLabel}</p>
        <span className={`password-strength strength-${strength.score}`}>{strength.label}{strength.bits ? ` · ~${strength.bits} bits` : ""}</span>
      </div>
      <p className="password-output-value">{output || "Generate a private value when ready."}</p>
    </div>
    {mode === "password" ? (
      <div className="grid gap-4">
        <div className="surface-card wabi-card-edge grid gap-4 p-4">
          <Input label="Length" value={length} onChange={setLength} type="number" helper="Choose between 8 and 128 characters. 16 or more is recommended." />
          <div className="password-option-grid">
            <Checkbox label="A–Z" checked={upper} onChange={setUpper} />
            <Checkbox label="a–z" checked={lower} onChange={setLower} />
            <Checkbox label="0–9" checked={numbers} onChange={setNumbers} />
            <Checkbox label="Symbols" checked={symbols} onChange={setSymbols} />
          </div>
        </div>
        <div className="surface-card wabi-card-edge grid gap-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Minimum numbers" value={minimumNumbers} onChange={setMinimumNumbers} type="number" helper="Set 0 to make numbers optional." />
            <Input label="Minimum symbols" value={minimumSymbols} onChange={setMinimumSymbols} type="number" helper="Set 0 to make symbols optional." />
          </div>
          <Checkbox label="Avoid ambiguous characters (I, l, 1, O, 0)" checked={avoidAmbiguous} onChange={setAvoidAmbiguous} />
        </div>
      </div>
    ) : (
      <div className="surface-card wabi-card-edge grid gap-4 p-4">
        <Input label="Number of words" value={words} onChange={setWords} type="number" helper="Choose between 3 and 20 words. Six or more is recommended." />
        <Input label="Word separator" value={separator} onChange={setSeparator} helper="Use a short separator such as - or ." />
        <div className="password-option-grid">
          <Checkbox label="Capitalise words" checked={capitalise} onChange={setCapitalise} />
          <Checkbox label="Add a two-digit number" checked={includeNumber} onChange={setIncludeNumber} />
        </div>
      </div>
    )}
    <div className="flex flex-wrap gap-2">
      <PrimaryButton label={`Generate ${modeLabel}`} onClick={generate} />
      <SecondaryButton label={`Copy ${modeLabel}`} onClick={() => runSafely(setStatus, async () => { await copyText(requireOutput(output)); return `${mode === "password" ? "Password" : "Passphrase"} copied.`; })} />
    </div>
  </ToolForm>;
}

function QrCodeTool() {
  const [input, setInput] = useState("https://github.com/indranilroy99/myfilekit");
  const [dataUrl, setDataUrl] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setInput(""); setDataUrl(""); setStatus(initialStatus); }}>
    <Textarea label="Text or link" value={input} onChange={setInput} rows={5} />
    {dataUrl && <img className="surface-card wabi-card-edge mx-auto aspect-square w-full max-w-xs p-4" src={dataUrl} alt="Generated QR code" />}
    <div className="flex flex-wrap gap-2">
      <PrimaryButton label="Generate QR code" onClick={() => runSafely(setStatus, async () => { if (!input.trim()) throw new Error("Enter text or a link first."); setDataUrl(await QRCode.toDataURL(input, { width: 720, margin: 2, errorCorrectionLevel: "M" })); return "QR code generated locally."; })} />
      {dataUrl && <SecondaryButton label="Download PNG" onClick={() => runSafely(setStatus, async () => { const blob = await (await fetch(dataUrl)).blob(); downloadBlob(blob, "myfilekit-qr-code.png"); return "QR code downloaded."; })} />}
    </div>
  </ToolForm>;
}

// --- Sharing & Collaboration --------------------------------------------------
//
// Both tools below share one transport: a WebRTC DataChannel set up by hand.
// There is no signaling server (and cannot be — connect-src is 'self'), so each
// side produces one text code and the users pass those codes to each other.

type PeerLink = ReturnType<typeof createPeerLink>;
type PeerFrame = { kind: number; seq: number; payload: Uint8Array };
type TransferProgressState = { label: string; sent: number; total: number; rate: number };
type ReceivedFile = { filename: string; size: number; type: string; verified: boolean; blob: Blob };

// Everything received stays in memory until the user downloads it, so cap the
// whole session, not only each file.
const P2P_SESSION_BUDGET = 512 * 1024 * 1024;
const ICE_HELP = "Nothing is built in. Any server you enter here is contacted directly by your browser, so it will learn your IP address. One per line: stun:host:port, or turn:host:port|username|password.";
const NO_ICE_HELP = "Off by default, so no third party is contacted. Without a STUN or TURN server the connection uses local network addresses only — both devices should be on the same Wi-Fi or LAN.";

function IceServerPanel({ enabled, setEnabled, value, onChange }: { enabled: boolean; setEnabled: (value: boolean) => void; value: string; onChange: (value: string) => void }) {
  return (
    <div className="surface-card wabi-card-edge grid gap-3 p-4">
      <Checkbox label="Use my own STUN/TURN server (contacts a third party)" checked={enabled} onChange={setEnabled} />
      {enabled ? <Textarea label="ICE servers" value={value} onChange={onChange} rows={3} /> : null}
      <p className="text-xs font-semibold leading-5 text-neutral-500">{enabled ? ICE_HELP : NO_ICE_HELP}</p>
    </div>
  );
}

function PeerCodeBox({ title, hint, code, onCopy }: { title: string; hint: string; code: string; onCopy: () => unknown }) {
  return (
    <div className="surface-muted wabi-card-edge grid gap-3 p-4">
      <div>
        <p className="text-xs font-black uppercase text-neutral-500">{title}</p>
        <p className="mt-1 text-sm font-semibold leading-6 text-neutral-600">{hint}</p>
      </div>
      <textarea
        className="field-input resize-y break-all font-mono text-xs leading-5"
        rows={4}
        value={code}
        readOnly
        aria-label={title}
        onFocus={(event) => event.currentTarget.select()}
      />
      <SecondaryButton label="Copy code" onClick={onCopy} />
    </div>
  );
}

function TransferProgressBar({ progress }: { progress: TransferProgressState }) {
  const percent = progressPercent(progress.sent, progress.total);
  return (
    <div className="surface-card wabi-card-edge grid gap-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-bold">
        <span className="min-w-0 break-all">{progress.label}</span>
        <span className="tabular-nums text-neutral-500">
          {percent}% · {formatBytes(progress.sent)} / {formatBytes(progress.total)}{progress.rate > 0 ? ` · ${formatBytes(progress.rate)}/s` : ""}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--paper-soft)]" role="progressbar" aria-label={progress.label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-[var(--moss)]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

// Polls instead of waiting on an event, because a DataChannel that never opens
// (blocked by NAT, no ICE server) gives us nothing to listen for.
function waitForPeerOpen(link: PeerLink, timeoutMs = 45000) {
  return new Promise<void>((resolve, reject) => {
    if (link.isOpen()) {
      resolve();
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (link.isOpen()) {
        window.clearInterval(timer);
        resolve();
        return;
      }
      if (link.isClosed()) {
        window.clearInterval(timer);
        reject(new Error("The connection closed before it opened. Both sides need to reset and swap fresh codes."));
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer);
        reject(new Error("The direct connection could not be established. With no STUN/TURN server both devices must be on the same network — check that, or add your own server above and swap fresh codes."));
      }
    }, 250);
  });
}

function P2pShareTool({ tool }: { tool: Tool }) {
  const maxFileCount = (tool.file as { maxFiles?: number }).maxFiles || 1;
  const [role, setRole] = useState("sender");
  const [files, setFiles] = useState<File[]>([]);
  const [iceEnabled, setIceEnabled] = useState(false);
  const [iceText, setIceText] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [answerCode, setAnswerCode] = useState("");
  const [pastedCode, setPastedCode] = useState("");
  const [connected, setConnected] = useState(false);
  const [progress, setProgress] = useState<TransferProgressState | null>(null);
  const [received, setReceived] = useState<ReceivedFile[]>([]);
  const [status, setStatus] = useState(initialStatus);

  const linkRef = useRef<PeerLink | null>(null);
  const cancelRef = useRef(false);
  const assemblerRef = useRef<ReturnType<typeof createAssembler> | null>(null);
  const metaRef = useRef<ReturnType<typeof normalizeIncomingMeta> | null>(null);
  const ackRef = useRef<{ resolve: (ok: boolean) => void; reject: (error: Error) => void } | null>(null);
  const startedRef = useRef(0);
  const paintedRef = useRef(0);
  const acceptedBytesRef = useRef(0);

  // One place that releases the connection, used by reset, cancel, and unmount,
  // so an RTCPeerConnection and DataChannel can never outlive the tool.
  const releaseLink = () => {
    const pending = ackRef.current;
    ackRef.current = null;
    pending?.reject(new Error("The transfer was stopped."));
    linkRef.current?.close();
    linkRef.current = null;
    assemblerRef.current = null;
    metaRef.current = null;
  };

  useEffect(() => () => {
    ackRef.current = null;
    linkRef.current?.close();
    linkRef.current = null;
    assemblerRef.current = null;
    metaRef.current = null;
  }, []);

  const finishIncoming = async () => {
    const assembler = assemblerRef.current;
    const meta = metaRef.current;
    if (!assembler || !meta) throw new Error("Your peer said a file had finished before sending it.");
    assemblerRef.current = null;
    metaRef.current = null;
    const bytes = assembler.finish();
    const { verified } = await verifyBytes(bytes, meta.hash);
    // Held as a Blob, never opened: the only way out is the download button.
    setReceived((current) => [...current, { filename: meta.name, size: meta.size, type: meta.type, verified, blob: new Blob([bytes], { type: meta.type }) }]);
    setProgress(null);
    try {
      linkRef.current?.sendFrame(encodeJsonFrame(FRAME_KIND.ACK, { index: meta.index, ok: verified }));
    } catch {
      // The peer may have gone; the file is already safe on this side.
    }
    setStatus(verified
      ? { tone: "success", message: `Received ${meta.name} (${formatBytes(meta.size)}). SHA-256 matches the sender's — the copy is intact. Download it below.` }
      : { tone: "error", message: `Received ${meta.name}, but its SHA-256 does not match what the sender announced. Do not trust this copy — ask them to send it again.` });
  };

  const handleFrame = (frame: PeerFrame) => {
    try {
      if (frame.kind === FRAME_KIND.META) {
        // Everything in here is attacker-controlled: name, size, type, hash.
        const meta = normalizeIncomingMeta(decodeJsonFrame(frame), { maxBytes: MAX_TRANSFER_BYTES });
        // Received files are held in memory until downloaded, so the session as
        // a whole has a budget, not just each individual file.
        if (acceptedBytesRef.current + meta.size > P2P_SESSION_BUDGET) {
          throw new Error(`This session has already accepted ${formatBytes(acceptedBytesRef.current)} and cannot hold ${meta.name} as well. Download what you have, reset, and reconnect.`);
        }
        acceptedBytesRef.current += meta.size;
        metaRef.current = meta;
        assemblerRef.current = createAssembler({ size: meta.size });
        startedRef.current = Date.now();
        paintedRef.current = 0;
        setProgress({ label: `Receiving ${meta.name}`, sent: 0, total: meta.size, rate: 0 });
        setStatus({ tone: "idle", message: `Receiving ${meta.name} (${formatBytes(meta.size)}) — file ${meta.index + 1} of ${meta.total}.` });
        return;
      }
      if (frame.kind === FRAME_KIND.CHUNK) {
        const assembler = assemblerRef.current;
        const meta = metaRef.current;
        if (!assembler || !meta) throw new Error("Your peer sent file data before saying what it was sending.");
        const bytes = assembler.push(frame);
        const now = Date.now();
        if (now - paintedRef.current > 150 || bytes === meta.size) {
          paintedRef.current = now;
          setProgress({ label: `Receiving ${meta.name}`, sent: bytes, total: meta.size, rate: transferRate(bytes, now - startedRef.current) });
        }
        return;
      }
      if (frame.kind === FRAME_KIND.FILE_END) {
        void finishIncoming().catch((error: any) => {
          assemblerRef.current = null;
          metaRef.current = null;
          setProgress(null);
          setStatus({ tone: "error", message: error?.message || "The incoming file could not be completed." });
        });
        return;
      }
      if (frame.kind === FRAME_KIND.ACK) {
        const body = decodeJsonFrame(frame);
        const pending = ackRef.current;
        ackRef.current = null;
        pending?.resolve(body.ok === true);
        return;
      }
      if (frame.kind === FRAME_KIND.CANCEL) {
        assemblerRef.current = null;
        metaRef.current = null;
        setProgress(null);
        const pending = ackRef.current;
        ackRef.current = null;
        pending?.reject(new Error("Your peer cancelled the transfer."));
        setStatus({ tone: "error", message: "Your peer cancelled the transfer." });
        return;
      }
      throw new Error("Your peer sent a message this tool does not use.");
    } catch (error: any) {
      assemblerRef.current = null;
      metaRef.current = null;
      setProgress(null);
      setStatus({ tone: "error", message: error?.message || "Your peer sent something unexpected." });
    }
  };

  const openLink = () => {
    if (linkRef.current) throw new Error("A connection is already set up here. Reset to start a new one.");
    const link = createPeerLink({
      iceServersText: iceEnabled ? iceText : "",
      onFrame: handleFrame,
      onOpen: () => setConnected(true),
      onClose: () => {
        setConnected(false);
        const pending = ackRef.current;
        ackRef.current = null;
        if (pending || assemblerRef.current) {
          pending?.reject(new Error("Your peer disconnected before the transfer finished."));
          assemblerRef.current = null;
          metaRef.current = null;
          setProgress(null);
          setStatus({ tone: "error", message: "Your peer disconnected before the transfer finished. Nothing partial was saved." });
        } else {
          setStatus((current) => current.tone === "error" ? current : { tone: "idle", message: "The peer connection closed. Reset to start another transfer." });
        }
      },
      onError: (error: any) => setStatus({ tone: "error", message: error?.message || "The peer connection reported a problem." }),
    });
    linkRef.current = link;
    return link;
  };

  const awaitAck = (timeoutMs = 180000) => new Promise<boolean>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      ackRef.current = null;
      reject(new Error("Your peer did not confirm the file in time."));
    }, timeoutMs);
    ackRef.current = {
      resolve: (ok: boolean) => {
        window.clearTimeout(timer);
        resolve(ok);
      },
      reject: (error: Error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    };
  });

  const createInvite = () => runSafely(setStatus, async () => {
    if (!webrtcSupported()) throw new Error("This browser has no WebRTC support, so direct transfers are not available here.");
    const valid = validateFiles(files, tool.file);
    const code = await openLink().createInvite();
    setInviteCode(code);
    return `Invite code ready for ${valid.length} file${valid.length === 1 ? "" : "s"}. Send the code to your peer over a channel you already trust, then paste the answer code they send back.`;
  });

  const sendFiles = () => runSafely(setStatus, async () => {
    const link = linkRef.current;
    if (!link) throw new Error("Create an invite code first.");
    const valid = validateFiles(files, tool.file);
    if (!link.isOpen()) {
      await link.acceptAnswer(pastedCode);
      setStatus({ tone: "idle", message: "Answer accepted. Opening the direct connection…" });
      await waitForPeerOpen(link);
    }
    cancelRef.current = false;
    let verifiedCount = 0;
    for (let index = 0; index < valid.length; index += 1) {
      const file = valid[index];
      startedRef.current = Date.now();
      paintedRef.current = 0;
      setStatus({ tone: "idle", message: `Sending ${file.name} — file ${index + 1} of ${valid.length}.` });
      const ack = awaitAck();
      await sendFileOverLink(link, file, {
        index,
        total: valid.length,
        shouldCancel: () => cancelRef.current,
        onProgress: ({ sent, total, elapsedMs }: { sent: number; total: number; elapsedMs: number }) => {
          const now = Date.now();
          if (now - paintedRef.current <= 150 && sent !== total) return;
          paintedRef.current = now;
          setProgress({ label: `Sending ${file.name}`, sent, total, rate: transferRate(sent, elapsedMs) });
        },
      });
      setStatus({ tone: "idle", message: `Sent ${file.name}. Waiting for your peer to verify it…` });
      if (await ack) verifiedCount += 1;
    }
    setProgress(null);
    return verifiedCount === valid.length
      ? `Sent ${valid.length} file${valid.length === 1 ? "" : "s"}. Your peer verified every SHA-256 — the copies match.`
      : `Sent ${valid.length} file${valid.length === 1 ? "" : "s"}, but only ${verifiedCount} passed your peer's SHA-256 check. Send the rest again.`;
  });

  const createAnswer = () => runSafely(setStatus, async () => {
    if (!webrtcSupported()) throw new Error("This browser has no WebRTC support, so direct transfers are not available here.");
    const code = await openLink().acceptInvite(pastedCode);
    setAnswerCode(code);
    return "Answer code ready. Send it back to whoever gave you the invite code, then leave this page open — files start arriving once the connection opens.";
  });

  const cancelTransfer = () => runSafely(setStatus, async () => {
    cancelRef.current = true;
    releaseLink();
    setConnected(false);
    setProgress(null);
    // Codes are single-use: a closed connection cannot be revived from them.
    setInviteCode("");
    setAnswerCode("");
    setPastedCode("");
    return "Transfer cancelled and the connection closed. Files already received stay listed below; start a new exchange with fresh codes.";
  });

  const reset = () => {
    cancelRef.current = true;
    releaseLink();
    setFiles([]);
    setInviteCode("");
    setAnswerCode("");
    setPastedCode("");
    setConnected(false);
    setProgress(null);
    setReceived([]);
    acceptedBytesRef.current = 0;
    setStatus(initialStatus);
  };

  const switchRole = (next: string) => {
    cancelRef.current = true;
    releaseLink();
    setRole(next);
    setInviteCode("");
    setAnswerCode("");
    setPastedCode("");
    setConnected(false);
    setProgress(null);
    setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge grid gap-2 p-4 text-sm font-semibold leading-6 text-neutral-600">
      <p>Files travel straight from one browser to the other over an encrypted WebRTC data channel. There is no server in the middle and nothing is uploaded — but you have to hand your peer one code yourself, because MyFileKit has no backend to do it for you.</p>
      <p className="text-neutral-500">Works best when both devices are on the same network. Up to {Math.round(MAX_TRANSFER_BYTES / (1024 * 1024))} MB per file, {maxFileCount} files per session, sent one after another.</p>
    </div>

    <Select label="I am the" value={role} onChange={switchRole} options={["sender", "receiver"]} labels={["Sender — I have the files", "Receiver — I was given a code"]} />
    <IceServerPanel enabled={iceEnabled} setEnabled={setIceEnabled} value={iceText} onChange={setIceText} />

    {role === "sender" ? <>
      <FileControl accept="*/*" multiple files={files} setFiles={setFiles} label="Choose or drop the files to send" />
      {inviteCode
        ? <PeerCodeBox title="Step 1 · your invite code" hint="Send this whole code to your peer through a channel you already trust — chat, email, a shared note." code={inviteCode} onCopy={() => runSafely(setStatus, async () => { await copyText(inviteCode); return "Invite code copied."; })} />
        : <PrimaryButton label="Create invite code" onClick={createInvite} />}
      {inviteCode ? <>
        <Textarea label="Step 2 · paste your peer's answer code" value={pastedCode} onChange={setPastedCode} rows={4} />
        <div className="flex flex-wrap gap-2">
          <PrimaryButton label="Connect and send" onClick={sendFiles} />
          <SecondaryButton label="Cancel transfer" onClick={cancelTransfer} />
        </div>
      </> : null}
    </> : <>
      <Textarea label="Step 1 · paste the invite code you were given" value={pastedCode} onChange={setPastedCode} rows={4} />
      {answerCode
        ? <PeerCodeBox title="Step 2 · your answer code" hint="Send this whole code back to the sender. The transfer starts on its own once they paste it." code={answerCode} onCopy={() => runSafely(setStatus, async () => { await copyText(answerCode); return "Answer code copied."; })} />
        : <PrimaryButton label="Create answer code" onClick={createAnswer} />}
      {answerCode ? <SecondaryButton label="Cancel transfer" onClick={cancelTransfer} /> : null}
    </>}

    <p className="text-xs font-black uppercase text-neutral-500">{connected ? "Connected to peer" : "Not connected"}</p>
    {progress ? <TransferProgressBar progress={progress} /> : null}

    {received.length > 0 ? (
      <div className="surface-card wabi-card-edge grid gap-3 p-4">
        <p className="text-xs font-black uppercase text-neutral-500">Received files · {received.length}</p>
        {received.map((item, index) => (
          <div key={`${item.filename}-${index}`} className="grid gap-2 border-b border-[var(--border)] pb-3 last:border-b-0 last:pb-0">
            <p className="break-all text-sm font-bold text-[var(--foreground)]">{item.filename}</p>
            <p className="text-xs font-semibold text-neutral-500">
              {formatBytes(item.size)} · {item.type} · {item.verified ? "SHA-256 verified" : "SHA-256 MISMATCH — do not trust this copy"}
            </p>
            <div>
              <SecondaryButton label="Download file" onClick={() => runSafely(setStatus, async () => {
                downloadBlob(item.blob, item.filename);
                return `Saved ${item.filename}.`;
              })} />
            </div>
          </div>
        ))}
        <p className="text-xs font-semibold leading-5 text-neutral-500">Received files are never opened or run here — the name has been stripped of any path and the only action offered is a download. Check anything you did not expect before opening it.</p>
      </div>
    ) : null}
  </ToolForm>;
}

function WhiteboardTool() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const sizeRef = useRef({ width: 1, height: 1 });
  const strokesRef = useRef<any[]>([]);
  const redoRef = useRef<any[]>([]);
  const activeRef = useRef<any>(null);
  const sentRef = useRef(0);
  const broadcastRef = useRef(0);
  const remoteRef = useRef(new Map<string, any>());
  const linkRef = useRef<PeerLink | null>(null);
  const penRef = useRef({ mode: "pen", color: "#111111", width: 4 });

  const [mode, setMode] = useState("pen");
  const [color, setColor] = useState("#111111");
  const [width, setWidth] = useState("4");
  const [counts, setCounts] = useState({ strokes: 0, redo: 0 });
  const [pairing, setPairing] = useState(false);
  const [role, setRole] = useState("host");
  const [iceEnabled, setIceEnabled] = useState(false);
  const [iceText, setIceText] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [answerCode, setAnswerCode] = useState("");
  const [pastedCode, setPastedCode] = useState("");
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    penRef.current = { mode, color, width: Math.max(1, Math.min(64, Number(width) || 4)) };
  }, [mode, color, width]);

  const syncCounts = () => setCounts({ strokes: strokesRef.current.length, redo: redoRef.current.length });

  const repaint = () => {
    if (contextRef.current) renderBoard(contextRef.current, strokesRef.current, sizeRef.current);
  };

  // Backing store follows the CSS box times devicePixelRatio, so lines stay
  // crisp; a resize repaints from the stroke model, so nothing is lost.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const resize = () => {
      const rect = wrapper.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const prepared = prepareCanvas(canvas, { width: rect.width, height: rect.height });
      contextRef.current = prepared.context;
      sizeRef.current = { width: prepared.width, height: prepared.height };
      renderBoard(prepared.context, strokesRef.current, sizeRef.current);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);
    return () => {
      observer.disconnect();
      contextRef.current = null;
    };
  }, []);

  const sendStroke = (stroke: any, final: boolean) => {
    const link = linkRef.current;
    if (!link?.isOpen()) {
      sentRef.current = stroke.points.length;
      return;
    }
    if (!final && stroke.points.length <= sentRef.current) return;
    try {
      link.sendFrame(encodeJsonFrame(FRAME_KIND.STROKE, serializeStrokeChunk(stroke, sentRef.current, final)));
      sentRef.current = stroke.points.length;
    } catch {
      // A peer that vanished must never interrupt local drawing.
    }
  };

  // Pointer Events cover mouse, trackpad, touch, and stylus (with pressure) in
  // one path. Registered once: live pen settings are read through penRef.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const down = (event: PointerEvent) => {
      const context = contextRef.current;
      if (!context || activeRef.current) return;
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      const pen = penRef.current;
      const stroke = createStroke({
        color: pen.color,
        width: pen.width / Math.max(1, sizeRef.current.width),
        erase: pen.mode === "eraser",
      });
      if (strokesRef.current.length >= MAX_STROKES) {
        setStatus({ tone: "error", message: `This board is full at ${MAX_STROKES} strokes. Export it, then clear the board to keep drawing.` });
        return;
      }
      addStrokePoint(stroke, pointFromEvent(canvas, event));
      activeRef.current = stroke;
      sentRef.current = 0;
      broadcastRef.current = 0;
      redoRef.current = [];
      strokesRef.current.push(stroke);
      drawStrokeSegment(context, stroke, sizeRef.current, 0);
      syncCounts();
    };

    const move = (event: PointerEvent) => {
      const stroke = activeRef.current;
      const context = contextRef.current;
      if (!stroke || !context) return;
      event.preventDefault();
      const from = Math.max(0, stroke.points.length - 1);
      const coalesced = event.getCoalescedEvents?.() || [];
      for (const sample of coalesced.length ? coalesced : [event]) addStrokePoint(stroke, pointFromEvent(canvas, sample));
      drawStrokeSegment(context, stroke, sizeRef.current, from);
      const now = Date.now();
      if (now - broadcastRef.current > 60) {
        broadcastRef.current = now;
        sendStroke(stroke, false);
      }
    };

    const up = () => {
      const stroke = activeRef.current;
      if (!stroke) return;
      sendStroke(stroke, true);
      activeRef.current = null;
      syncCounts();
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

  useEffect(() => () => {
    linkRef.current?.close();
    linkRef.current = null;
  }, []);

  const handleFrame = (frame: PeerFrame) => {
    try {
      if (frame.kind === FRAME_KIND.STROKE) {
        const chunk = deserializeStrokeChunk(decodeJsonFrame(frame));
        // Namespace the peer's ids so a crafted id cannot reach a local stroke.
        chunk.stroke.id = `peer-${chunk.stroke.id}`;
        const existing = remoteRef.current.get(chunk.stroke.id) || null;
        if (!existing && strokesRef.current.length >= MAX_STROKES) throw new Error(`This board is full at ${MAX_STROKES} strokes, so new strokes from your peer are being ignored. Export and clear to carry on.`);
        const merged = mergeStrokeChunk(existing, chunk);
        const position = existing ? strokesRef.current.indexOf(existing) : -1;
        if (position >= 0) strokesRef.current[position] = merged.stroke;
        else strokesRef.current.push(merged.stroke);
        if (merged.final) remoteRef.current.delete(merged.stroke.id);
        else remoteRef.current.set(merged.stroke.id, merged.stroke);
        if (contextRef.current) drawStrokeSegment(contextRef.current, merged.stroke, sizeRef.current, merged.from);
        syncCounts();
        return;
      }
      if (frame.kind === FRAME_KIND.STROKE_UNDO) {
        const body = decodeJsonFrame(frame);
        const id = `peer-${String(body.i ?? "").slice(0, 64)}`;
        strokesRef.current = strokesRef.current.filter((stroke) => stroke.id !== id);
        remoteRef.current.delete(id);
        repaint();
        syncCounts();
        return;
      }
      if (frame.kind === FRAME_KIND.BOARD_CLEAR) {
        strokesRef.current = strokesRef.current.filter((stroke) => !stroke.remote);
        remoteRef.current.clear();
        repaint();
        syncCounts();
        setStatus({ tone: "idle", message: "Your peer cleared their strokes. Your own work is untouched." });
        return;
      }
      throw new Error("Your peer sent a message this tool does not use.");
    } catch (error: any) {
      setStatus({ tone: "error", message: error?.message || "Your peer sent something unexpected. Your own drawing is unaffected." });
    }
  };

  const openLink = () => {
    if (linkRef.current) throw new Error("A pairing is already set up here. Turn pairing off and on again to start over.");
    const link = createPeerLink({
      iceServersText: iceEnabled ? iceText : "",
      onFrame: handleFrame,
      onOpen: () => setConnected(true),
      onClose: () => {
        setConnected(false);
        setStatus({ tone: "idle", message: "Your peer disconnected. Everything already on your board stays, and you can keep drawing." });
      },
      onError: (error: any) => setStatus({ tone: "error", message: error?.message || "The peer connection reported a problem." }),
    });
    linkRef.current = link;
    return link;
  };

  const releaseLink = () => {
    linkRef.current?.close();
    linkRef.current = null;
    remoteRef.current.clear();
    setConnected(false);
  };

  const undo = () => runSafely(setStatus, async () => {
    for (let index = strokesRef.current.length - 1; index >= 0; index -= 1) {
      const stroke = strokesRef.current[index];
      if (stroke.remote) continue;
      strokesRef.current.splice(index, 1);
      redoRef.current.push(stroke);
      repaint();
      syncCounts();
      try {
        if (linkRef.current?.isOpen()) linkRef.current.sendFrame(encodeJsonFrame(FRAME_KIND.STROKE_UNDO, { i: stroke.id }));
      } catch {
        // Local undo already happened; the peer will fall out of sync at worst.
      }
      return "Undid your last stroke.";
    }
    throw new Error("There is nothing of yours left to undo.");
  });

  const redo = () => runSafely(setStatus, async () => {
    const stroke = redoRef.current.pop();
    if (!stroke) throw new Error("There is nothing to redo.");
    strokesRef.current.push(stroke);
    repaint();
    syncCounts();
    sentRef.current = 0;
    sendStroke(stroke, true);
    return "Redid a stroke.";
  });

  const clearBoard = () => runSafely(setStatus, async () => {
    if (!strokesRef.current.length) throw new Error("The board is already empty.");
    strokesRef.current = [];
    redoRef.current = [];
    remoteRef.current.clear();
    repaint();
    syncCounts();
    try {
      if (linkRef.current?.isOpen()) linkRef.current.sendFrame(encodeJsonFrame(FRAME_KIND.BOARD_CLEAR, {}));
    } catch {
      // Best effort: the local board is already clear.
    }
    return "Board cleared.";
  });

  const exportSize = () => {
    const scale = Math.min(3, Math.max(1, 1800 / Math.max(1, sizeRef.current.width)));
    return { width: Math.round(sizeRef.current.width * scale), height: Math.round(sizeRef.current.height * scale) };
  };

  const withExportCanvas = async (use: (canvas: HTMLCanvasElement) => Promise<void>) => {
    if (!strokesRef.current.length) throw new Error("Draw something before exporting.");
    const canvas = exportBoardCanvas(strokesRef.current, { ...exportSize(), background: "#ffffff" });
    try {
      await use(canvas);
    } finally {
      // Drop the offscreen pixels as soon as the export is encoded.
      canvas.width = 1;
      canvas.height = 1;
    }
  };

  const exportPng = () => runSafely(setStatus, async () => {
    await withExportCanvas(async (canvas) => {
      downloadBlob(await canvasToBlob(canvas, "image/png"), "myfilekit-whiteboard.png");
    });
    return "Whiteboard exported as PNG.";
  });

  const exportPdf = () => runSafely(setStatus, async () => {
    await withExportCanvas(async (canvas) => {
      downloadBytes(await canvasToPdf(canvas), "myfilekit-whiteboard.pdf", "application/pdf");
    });
    return "Whiteboard exported as PDF.";
  });

  const togglePairing = (next: boolean) => {
    if (!next) releaseLink();
    setPairing(next);
    setInviteCode("");
    setAnswerCode("");
    setPastedCode("");
    setStatus(initialStatus);
  };

  const switchRole = (next: string) => {
    releaseLink();
    setRole(next);
    setInviteCode("");
    setAnswerCode("");
    setPastedCode("");
    setStatus(initialStatus);
  };

  const createInvite = () => runSafely(setStatus, async () => {
    if (!webrtcSupported()) throw new Error("This browser has no WebRTC support, so pairing is not available here. Solo drawing still works.");
    const code = await openLink().createInvite();
    setInviteCode(code);
    return "Invite code ready. Send it to your peer, then paste the answer code they send back.";
  });

  const acceptAnswer = () => runSafely(setStatus, async () => {
    const link = linkRef.current;
    if (!link) throw new Error("Create an invite code first.");
    await link.acceptAnswer(pastedCode);
    await waitForPeerOpen(link);
    return "Paired. New strokes from both sides now appear on both boards.";
  });

  const createAnswer = () => runSafely(setStatus, async () => {
    if (!webrtcSupported()) throw new Error("This browser has no WebRTC support, so pairing is not available here. Solo drawing still works.");
    const code = await openLink().acceptInvite(pastedCode);
    setAnswerCode(code);
    return "Answer code ready. Send it back to whoever gave you the invite code.";
  });

  const reset = () => {
    releaseLink();
    strokesRef.current = [];
    redoRef.current = [];
    activeRef.current = null;
    repaint();
    syncCounts();
    setPairing(false);
    setInviteCode("");
    setAnswerCode("");
    setPastedCode("");
    setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div ref={wrapperRef} className="surface-card wabi-card-edge relative w-full overflow-hidden rounded-3xl border-dashed border-neutral-300" style={{ aspectRatio: "3 / 2" }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" aria-label="Whiteboard drawing surface" />
    </div>

    <div className="grid gap-3 sm:grid-cols-3">
      <Select label="Tool" value={mode} onChange={setMode} options={["pen", "eraser"]} labels={["Pen", "Eraser"]} />
      <Input label="Colour" value={color} onChange={setColor} type="color" />
      <Input label="Thickness (px)" value={width} onChange={setWidth} type="number" helper="1 to 64. Stylus pressure varies it." />
    </div>

    <div className="flex flex-wrap gap-2">
      <SecondaryButton label="Undo" onClick={undo} />
      <SecondaryButton label="Redo" onClick={redo} />
      <SecondaryButton label="Clear board" onClick={clearBoard} />
      <PrimaryButton label="Download PNG" onClick={exportPng} />
      <SecondaryButton label="Download PDF" onClick={exportPdf} />
    </div>
    <p className="text-xs font-semibold text-neutral-500">{counts.strokes} stroke{counts.strokes === 1 ? "" : "s"} on the board · {counts.redo} available to redo</p>

    <Checkbox label="Draw with one peer (optional)" checked={pairing} onChange={togglePairing} />
    {pairing ? <>
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        Pairing opens the same direct connection the P2P File Share tool uses: you swap one code each, by hand, and strokes travel browser-to-browser. Works best on the same network. Your peer's strokes are drawn slightly lighter, and nothing you have already drawn is ever lost if they drop off.
      </div>
      <Select label="I am the" value={role} onChange={switchRole} options={["host", "guest"]} labels={["Host — I create the invite code", "Guest — I was given a code"]} />
      <IceServerPanel enabled={iceEnabled} setEnabled={setIceEnabled} value={iceText} onChange={setIceText} />
      {role === "host" ? <>
        {inviteCode
          ? <PeerCodeBox title="Step 1 · your invite code" hint="Send this whole code to your peer through a channel you already trust." code={inviteCode} onCopy={() => runSafely(setStatus, async () => { await copyText(inviteCode); return "Invite code copied."; })} />
          : <PrimaryButton label="Create invite code" onClick={createInvite} />}
        {inviteCode ? <>
          <Textarea label="Step 2 · paste your peer's answer code" value={pastedCode} onChange={setPastedCode} rows={4} />
          <PrimaryButton label="Connect" onClick={acceptAnswer} />
        </> : null}
      </> : <>
        <Textarea label="Step 1 · paste the invite code you were given" value={pastedCode} onChange={setPastedCode} rows={4} />
        {answerCode
          ? <PeerCodeBox title="Step 2 · your answer code" hint="Send this whole code back to the host. Drawing syncs as soon as they paste it." code={answerCode} onCopy={() => runSafely(setStatus, async () => { await copyText(answerCode); return "Answer code copied."; })} />
          : <PrimaryButton label="Create answer code" onClick={createAnswer} />}
      </>}
      <p className="text-xs font-black uppercase text-neutral-500">{connected ? "Paired with peer" : "Not paired"}</p>
    </> : null}
  </ToolForm>;
}

// --- Business Tools -----------------------------------------------------------

type GstLineItem = { description: string; hsn: string; qty: string; unit: string; rate: string; discountPercent: string; gstRate: string };

const stateCodeOptions = Object.keys(STATE_CODES).sort((a, b) => Number(a) - Number(b));
const stateCodeLabels = stateCodeOptions.map((code) => `${code} - ${(STATE_CODES as Record<string, string>)[code]}`);
const emptyGstLine: GstLineItem = { description: "", hsn: "", qty: "1", unit: "NOS", rate: "", discountPercent: "0", gstRate: "18" };

function MiniField({ label, value, onChange, type = "text", placeholder = "" }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return <label className="grid gap-1">
    <span className="text-[10px] font-black uppercase tracking-wide text-neutral-500">{label}</span>
    <input className="field-input" type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
  </label>;
}

function AmountRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex items-baseline justify-between gap-4 ${strong ? "border-t border-[var(--border)] pt-2 font-black" : "font-bold"}`}>
    <span className={strong ? "" : "text-neutral-500"}>{label}</span>
    <span className="tabular-nums">{value}</span>
  </div>;
}

function GstInvoiceTool() {
  const today = new Date().toISOString().slice(0, 10);
  const [sellerName, setSellerName] = useState("");
  const [sellerAddress, setSellerAddress] = useState("");
  const [sellerGstin, setSellerGstin] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [buyerGstin, setBuyerGstin] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [placeOfSupply, setPlaceOfSupply] = useState("27");
  const [items, setItems] = useState<GstLineItem[]>([{ ...emptyGstLine }]);
  const [status, setStatus] = useState(initialStatus);

  const payload = useMemo(() => ({
    seller: { name: sellerName, address: sellerAddress, gstin: sellerGstin },
    buyer: { name: buyerName, address: buyerAddress, gstin: buyerGstin, state: placeOfSupply },
    invoiceNo,
    invoiceDate,
    placeOfSupply,
    items: items.map((item) => ({ ...item, discountPercent: item.discountPercent, gstRate: item.gstRate })),
  }), [sellerName, sellerAddress, sellerGstin, buyerName, buyerAddress, buyerGstin, invoiceNo, invoiceDate, placeOfSupply, items]);

  const preview = useMemo(() => {
    try {
      return { invoice: computeGstInvoice(payload), error: "" };
    } catch (error: any) {
      return { invoice: null, error: error?.message || "Complete the invoice details." };
    }
  }, [payload]);

  const invoice = preview.invoice as any;
  const updateItem = (index: number, key: keyof GstLineItem, value: string) =>
    setItems((previous) => previous.map((item, position) => (position === index ? { ...item, [key]: value } : item)));

  const reset = () => {
    setSellerName(""); setSellerAddress(""); setSellerGstin("");
    setBuyerName(""); setBuyerAddress(""); setBuyerGstin("");
    setInvoiceNo(""); setInvoiceDate(today); setPlaceOfSupply("27");
    setItems([{ ...emptyGstLine }]);
    setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Builds an Indian GST tax invoice in this browser. The state code in each GSTIN decides the split: same state means CGST + SGST at half the rate each, different states mean IGST at the full rate. Reverse charge, GST cess, TDS/TCS, and composition-scheme invoices are not handled.
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="Seller name" value={sellerName} onChange={setSellerName} placeholder="Your business name" />
      <Input label="Seller GSTIN" value={sellerGstin} onChange={setSellerGstin} placeholder="27ABCDE1234F1Z5" />
    </div>
    <Textarea label="Seller address" value={sellerAddress} onChange={setSellerAddress} rows={3} />

    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="Buyer name" value={buyerName} onChange={setBuyerName} placeholder="Customer name" />
      <Input label="Buyer GSTIN (leave blank if unregistered)" value={buyerGstin} onChange={setBuyerGstin} placeholder="29ABCDE1234F1Z5" />
    </div>
    <Textarea label="Buyer address" value={buyerAddress} onChange={setBuyerAddress} rows={3} />

    <div className="grid gap-3 sm:grid-cols-3">
      <Input label="Invoice number" value={invoiceNo} onChange={setInvoiceNo} placeholder="INV-2026-001" />
      <Input label="Invoice date" value={invoiceDate} onChange={setInvoiceDate} type="date" />
      <Select label="Place of supply" value={placeOfSupply} onChange={setPlaceOfSupply} options={stateCodeOptions} labels={stateCodeLabels} />
    </div>

    <div className="grid gap-3">
      <p className="text-xs font-black uppercase text-neutral-500">Line items</p>
      {items.map((item, index) => (
        <div key={index} className="surface-card wabi-card-edge grid gap-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-black uppercase text-neutral-500">Item {index + 1}</span>
            {items.length > 1 && <button className="secondary-button" type="button" onClick={() => setItems((previous) => previous.filter((_, position) => position !== index))}>Remove</button>}
          </div>
          <MiniField label="Description" value={item.description} onChange={(value) => updateItem(index, "description", value)} placeholder="Consulting services" />
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <MiniField label="HSN/SAC" value={item.hsn} onChange={(value) => updateItem(index, "hsn", value)} placeholder="998311" />
            <MiniField label="Qty" value={item.qty} onChange={(value) => updateItem(index, "qty", value)} type="number" />
            <MiniField label="Unit" value={item.unit} onChange={(value) => updateItem(index, "unit", value)} placeholder="NOS" />
            <MiniField label="Rate" value={item.rate} onChange={(value) => updateItem(index, "rate", value)} type="number" />
            <MiniField label="Discount %" value={item.discountPercent} onChange={(value) => updateItem(index, "discountPercent", value)} type="number" />
            <MiniField label="GST %" value={item.gstRate} onChange={(value) => updateItem(index, "gstRate", value)} type="number" />
          </div>
        </div>
      ))}
      <SecondaryButton label="Add line item" onClick={() => setItems((previous) => [...previous, { ...emptyGstLine }])} />
    </div>

    {invoice ? (
      <div className="surface-card wabi-card-edge grid gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-black">{invoice.supplyType}</p>
          <span className="tag-badge rounded-full px-3 py-1 text-xs font-black uppercase">{invoice.lines.length} line{invoice.lines.length === 1 ? "" : "s"}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm font-semibold">
            <thead className="text-xs font-black uppercase text-neutral-500">
              <tr><th className="py-1">Description</th><th className="py-1 text-right">Taxable</th>{invoice.interState ? <th className="py-1 text-right">IGST</th> : <><th className="py-1 text-right">CGST</th><th className="py-1 text-right">SGST</th></>}<th className="py-1 text-right">Total</th></tr>
            </thead>
            <tbody>
              {invoice.lines.map((line: any) => (
                <tr key={line.index} className="border-t border-[var(--border)]">
                  <td className="py-1 pr-2">{line.description}</td>
                  <td className="py-1 text-right tabular-nums">{formatAmount(line.taxable)}</td>
                  {invoice.interState ? <td className="py-1 text-right tabular-nums">{formatAmount(line.igst)}</td> : <><td className="py-1 text-right tabular-nums">{formatAmount(line.cgst)}</td><td className="py-1 text-right tabular-nums">{formatAmount(line.sgst)}</td></>}
                  <td className="py-1 text-right tabular-nums">{formatAmount(line.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-1 text-sm">
          <AmountRow label="Taxable value" value={formatAmount(invoice.totals.taxable)} />
          {invoice.interState
            ? <AmountRow label="IGST" value={formatAmount(invoice.totals.igst)} />
            : <><AmountRow label="CGST" value={formatAmount(invoice.totals.cgst)} /><AmountRow label="SGST" value={formatAmount(invoice.totals.sgst)} /></>}
          <AmountRow label="Round off" value={formatAmount(invoice.totals.roundOff)} />
          <AmountRow label="Grand total (INR)" value={formatAmount(invoice.totals.grandTotal)} strong />
        </div>
        <p className="text-sm font-bold">{invoice.amountInWords}</p>
        {invoice.warnings.length > 0 && (
          <ul className="grid gap-1 text-sm font-semibold text-amber-700 [.dark_&]:text-amber-300">
            {invoice.warnings.map((warning: string) => <li key={warning}>Warning: {warning}</li>)}
          </ul>
        )}
      </div>
    ) : (
      <p className="text-sm font-semibold text-neutral-500">{preview.error}</p>
    )}

    <PrimaryButton label="Download invoice PDF" onClick={() => runSafely(setStatus, async () => {
      const computed: any = computeGstInvoice(payload);
      downloadBytes(await gstInvoicePdf(computed), withExtension(`gst-invoice-${safeFilename(computed.invoiceNo)}`, "pdf"), "application/pdf");
      return `${computed.supplyType} invoice ready. Grand total INR ${formatAmount(computed.totals.grandTotal)}.`;
    })} />
  </ToolForm>;
}

type PosCatalogueItem = { id: string; name: string; price: string; taxPercent: string };
type PosCartLine = { name: string; price: string; taxPercent: string; qty: number };

const posCatalogueStorageKey = "myfilekit:posCatalogue";

function loadPosCatalogue(): PosCatalogueItem[] {
  try {
    const stored = JSON.parse(localStorage.getItem(posCatalogueStorageKey) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((item) => item && typeof item === "object")
      .map((item: any) => ({ id: String(item.id || ""), name: String(item.name || ""), price: String(item.price ?? ""), taxPercent: String(item.taxPercent ?? "0") }))
      .filter((item) => item.name);
  } catch {
    return [];
  }
}

function savePosCatalogue(catalogue: PosCatalogueItem[]) {
  try {
    localStorage.setItem(posCatalogueStorageKey, JSON.stringify(catalogue));
  } catch {
    // The catalogue is a convenience; storage may be unavailable in private mode.
  }
}

function PosBillingTool() {
  const [catalogue, setCatalogue] = useState<PosCatalogueItem[]>([]);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newTax, setNewTax] = useState("0");
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [discountPercent, setDiscountPercent] = useState("0");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [cashTendered, setCashTendered] = useState("");
  const [shopName, setShopName] = useState("MyFileKit Store");
  const [shopGstin, setShopGstin] = useState("");
  const [bills, setBills] = useState<any[]>([]);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => { setCatalogue(loadPosCatalogue()); }, []);

  const updateCatalogue = (next: PosCatalogueItem[]) => { setCatalogue(next); savePosCatalogue(next); };

  const preview = useMemo(() => {
    try {
      // Priced with a non-cash mode so an empty "cash received" box never blocks
      // the running total; the cash check runs again on save.
      return { bill: computePosBill({ items: cart, discountPercent, paymentMode: "card" }), error: "" };
    } catch (error: any) {
      return { bill: null, error: error?.message || "Add items to start a bill." };
    }
  }, [cart, discountPercent]);

  const bill = preview.bill as any;
  const payable = bill ? Number(bill.totals.payable) : 0;
  const tendered = Number(cashTendered);
  const change = paymentMode === "cash" && cashTendered.trim() && Number.isFinite(tendered) ? tendered - payable : null;
  const session = summarisePosSession(bills) as any;
  const visible = catalogue.filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()));

  const addToCart = (item: PosCatalogueItem) => setCart((previous) => {
    const index = previous.findIndex((line) => line.name === item.name && line.price === item.price);
    if (index === -1) return [...previous, { name: item.name, price: item.price, taxPercent: item.taxPercent, qty: 1 }];
    return previous.map((line, position) => (position === index ? { ...line, qty: line.qty + 1 } : line));
  });

  const setQty = (index: number, delta: number) => setCart((previous) => previous
    .map((line, position) => (position === index ? { ...line, qty: line.qty + delta } : line))
    .filter((line) => line.qty > 0));

  const reset = () => {
    setCart([]); setDiscountPercent("0"); setPaymentMode("cash"); setCashTendered(""); setSearch("");
    setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Counter billing that runs entirely in this browser. The item catalogue is saved in this browser's local storage only — it is never uploaded, and clearing site data removes it. Bills below are kept for this session only.
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="Shop name (printed on the receipt)" value={shopName} onChange={setShopName} />
      <Input label="Shop GSTIN (optional)" value={shopGstin} onChange={setShopGstin} />
    </div>

    <div className="surface-card wabi-card-edge grid gap-3 p-4">
      <p className="text-xs font-black uppercase text-neutral-500">Item catalogue ({catalogue.length})</p>
      <div className="grid gap-2 sm:grid-cols-4">
        <MiniField label="Name" value={newName} onChange={setNewName} placeholder="Filter coffee" />
        <MiniField label="Price" value={newPrice} onChange={setNewPrice} type="number" />
        <MiniField label="Tax %" value={newTax} onChange={setNewTax} type="number" />
        <div className="flex items-end">
          <SecondaryButton label="Save item" onClick={() => runSafely(setStatus, async () => {
            const name = newName.trim();
            if (!name) throw new Error("Enter an item name.");
            const price = Number(newPrice);
            if (!Number.isFinite(price) || price < 0) throw new Error("Enter a price of zero or more.");
            const tax = Number(newTax || 0);
            if (!Number.isFinite(tax) || tax < 0 || tax > 100) throw new Error("Tax must be between 0 and 100 percent.");
            const id = `${Date.now()}-${catalogue.length}`;
            updateCatalogue([...catalogue.filter((item) => item.name.toLowerCase() !== name.toLowerCase()), { id, name, price: String(price), taxPercent: String(tax) }]);
            setNewName(""); setNewPrice(""); setNewTax("0");
            return `Saved "${name}" to this browser's catalogue.`;
          })} />
        </div>
      </div>
      <Input label="Search catalogue" value={search} onChange={setSearch} placeholder="Type to filter" />
      {visible.length ? (
        <div className="flex flex-wrap gap-2">
          {visible.map((item) => (
            <div key={item.id} className="surface-muted wabi-card-edge flex items-center gap-2 px-3 py-2 text-sm font-bold">
              <button className="text-left hover:underline" type="button" onClick={() => addToCart(item)}>{item.name} · {formatAmount(Number(item.price))}{Number(item.taxPercent) ? ` · ${item.taxPercent}%` : ""}</button>
              <button className="text-xs font-black uppercase text-neutral-500 hover:underline" type="button" aria-label={`Remove ${item.name} from the catalogue`} onClick={() => updateCatalogue(catalogue.filter((entry) => entry.id !== item.id))}>Del</button>
            </div>
          ))}
        </div>
      ) : <p className="text-sm font-semibold text-neutral-500">{catalogue.length ? "No catalogue item matches that search." : "No saved items yet. Add one above."}</p>}
    </div>

    <div className="surface-card wabi-card-edge grid gap-3 p-4">
      <p className="text-xs font-black uppercase text-neutral-500">Current bill</p>
      {cart.length ? cart.map((line, index) => (
        <div key={`${line.name}-${index}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2 text-sm font-bold last:border-b-0">
          <span>{line.name} · {formatAmount(Number(line.price))}</span>
          <span className="flex items-center gap-2">
            <button className="secondary-button" type="button" aria-label={`Reduce ${line.name}`} onClick={() => setQty(index, -1)}>-</button>
            <span className="tabular-nums">{line.qty}</span>
            <button className="secondary-button" type="button" aria-label={`Add another ${line.name}`} onClick={() => setQty(index, 1)}>+</button>
          </span>
        </div>
      )) : <p className="text-sm font-semibold text-neutral-500">Click a catalogue item to start a bill.</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniField label="Bill discount %" value={discountPercent} onChange={setDiscountPercent} type="number" />
        <Select label="Payment mode" value={paymentMode} onChange={setPaymentMode} options={["cash", "card", "upi"]} labels={["Cash", "Card", "UPI"]} />
        {paymentMode === "cash" ? <MiniField label="Cash received" value={cashTendered} onChange={setCashTendered} type="number" /> : <div />}
      </div>

      {bill ? (
        <div className="grid gap-1 text-sm">
          <AmountRow label="Subtotal" value={formatAmount(bill.totals.subtotal)} />
          {Number(bill.totals.discount) ? <AmountRow label={`Discount (${discountPercent}%)`} value={`-${formatAmount(bill.totals.discount)}`} /> : null}
          <AmountRow label="Taxable" value={formatAmount(bill.totals.taxable)} />
          <AmountRow label="Tax" value={formatAmount(bill.totals.tax)} />
          <AmountRow label="Round off" value={formatAmount(bill.totals.roundOff)} />
          <AmountRow label="Payable (INR)" value={formatAmount(bill.totals.payable)} strong />
          {change !== null && <AmountRow label={change < 0 ? "Short by" : "Change"} value={formatAmount(Math.abs(change))} />}
        </div>
      ) : <p className="text-sm font-semibold text-neutral-500">{preview.error}</p>}

      <PrimaryButton label="Save bill & download receipt" onClick={() => runSafely(setStatus, async () => {
        const billNo = `B${String(bills.length + 1).padStart(4, "0")}`;
        const saved: any = computePosBill({
          items: cart,
          discountPercent,
          paymentMode,
          cashTendered: paymentMode === "cash" ? cashTendered : null,
          billNo,
          createdAt: new Date().toLocaleString(),
        });
        downloadBytes(await posReceiptPdf(saved, { shopName, gstin: shopGstin }), withExtension(`receipt-${billNo}`, "pdf"), "application/pdf");
        setBills((previous) => [saved, ...previous]);
        setCart([]);
        setCashTendered("");
        setDiscountPercent("0");
        return saved.totals.change == null
          ? `Bill ${billNo} saved. Payable INR ${formatAmount(saved.totals.payable)}.`
          : `Bill ${billNo} saved. Payable INR ${formatAmount(saved.totals.payable)}, change INR ${formatAmount(saved.totals.change)}.`;
      })} />
    </div>

    <div className="surface-card wabi-card-edge grid gap-2 p-4">
      <p className="text-xs font-black uppercase text-neutral-500">This session ({session.bills} bill{session.bills === 1 ? "" : "s"})</p>
      <AmountRow label="Session total (INR)" value={formatAmount(session.total)} strong />
      <p className="text-sm font-semibold text-neutral-500">Cash {formatAmount(session.byMode.cash)} · Card {formatAmount(session.byMode.card)} · UPI {formatAmount(session.byMode.upi)} · Tax {formatAmount(session.tax)} · {session.items} item{session.items === 1 ? "" : "s"}</p>
      {bills.map((entry) => (
        <div key={entry.billNo} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2 text-sm font-bold">
          <span>{entry.billNo} · {entry.createdAt} · {entry.paymentMode.toUpperCase()}</span>
          <span className="tabular-nums">{formatAmount(entry.totals.payable)}</span>
        </div>
      ))}
    </div>
  </ToolForm>;
}

function GstFilingPrepTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [status, setStatus] = useState(initialStatus);

  const baseName = safeFilename(files[0]?.name || "gstr1-summary");
  const requireSummary = () => {
    if (!summary) throw new Error("Import a sales file first.");
    return summary;
  };

  return <ToolForm status={status} onReset={() => { setFiles([]); setSummary(null); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Reads a CSV or XLSX sales register and prepares a GSTR-1-style summary locally: B2B (buyer GSTIN present) vs B2C, rate-wise totals, and a "needs review" list. It does not file anything with the government and is not a substitute for the GST portal or your accountant. Expected columns: invoice no, date, buyer GSTIN, place of supply, taxable value, GST rate, CGST, SGST, IGST.
    </div>
    <FileControl accept="text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" files={files} setFiles={(next) => { setFiles(next); setSummary(null); }} label="Choose or drop a .csv, .xlsx, or .xls sales register" />
    <PrimaryButton label="Build summary" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const rows = await readInvoiceRows(file);
      const result: any = summariseGstr1(rows);
      setSummary(result);
      return `Summarised ${result.rowCount} row${result.rowCount === 1 ? "" : "s"}: ${result.b2b.rows} B2B, ${result.b2c.rows} B2C, ${result.needsReview.length} needing review.`;
    })} />

    {summary && (
      <div className="surface-card wabi-card-edge grid gap-4 p-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm font-semibold">
            <thead className="text-xs font-black uppercase text-neutral-500">
              <tr><th className="py-1">Section</th><th className="py-1 text-right">Invoices</th><th className="py-1 text-right">Taxable</th><th className="py-1 text-right">CGST</th><th className="py-1 text-right">SGST</th><th className="py-1 text-right">IGST</th><th className="py-1 text-right">Total tax</th></tr>
            </thead>
            <tbody>
              {[["B2B", summary.b2b], ["B2C", summary.b2c], ["Total", summary.totals]].map(([label, bucket]: any) => (
                <tr key={label} className="border-t border-[var(--border)]">
                  <td className="py-1 pr-2">{label}</td>
                  <td className="py-1 text-right tabular-nums">{bucket.invoices}</td>
                  <td className="py-1 text-right tabular-nums">{formatAmount(bucket.taxable)}</td>
                  <td className="py-1 text-right tabular-nums">{formatAmount(bucket.cgst)}</td>
                  <td className="py-1 text-right tabular-nums">{formatAmount(bucket.sgst)}</td>
                  <td className="py-1 text-right tabular-nums">{formatAmount(bucket.igst)}</td>
                  <td className="py-1 text-right tabular-nums">{formatAmount(bucket.tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-1">
          <p className="text-xs font-black uppercase text-neutral-500">Rate-wise</p>
          {summary.rateWise.map((slab: any) => (
            <AmountRow key={String(slab.rate)} label={`${slab.rate === null ? "unknown" : slab.rate}% · taxable ${formatAmount(slab.taxable)}`} value={formatAmount(slab.tax)} />
          ))}
        </div>

        <div className="grid gap-2">
          <p className="text-xs font-black uppercase text-neutral-500">Needs review ({summary.needsReview.length})</p>
          {summary.needsReview.length ? summary.needsReview.map((item: any) => (
            <div key={`${item.row}-${item.invoiceNo}`} className="surface-muted wabi-card-edge p-3 text-sm font-semibold">
              <p className="font-black">Row {item.row} · {item.invoiceNo}</p>
              <ul className="mt-1 grid gap-1 text-neutral-600">{item.issues.map((issue: string) => <li key={issue}>{issue}</li>)}</ul>
            </div>
          )) : <p className="text-sm font-semibold text-neutral-500">No malformed GSTINs, bad dates, or tax mismatches were found.</p>}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <SecondaryButton label="Download CSV" onClick={() => runSafely(setStatus, async () => {
            downloadText(gstr1SummaryCsv(requireSummary()), `${baseName}-gstr1`, "csv", "text/csv;charset=utf-8");
            return "CSV summary downloaded.";
          })} />
          <SecondaryButton label="Download XLSX" onClick={() => runSafely(setStatus, async () => {
            downloadBytes(await gstr1SummaryXlsx(requireSummary()), withExtension(`${baseName}-gstr1`, "xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            return "XLSX summary downloaded.";
          })} />
          <PrimaryButton label="Download PDF" onClick={() => runSafely(setStatus, async () => {
            downloadBytes(await gstr1SummaryPdf(requireSummary(), { sourceName: files[0]?.name }), withExtension(`${baseName}-gstr1`, "pdf"), "application/pdf");
            return "PDF summary downloaded.";
          })} />
        </div>
      </div>
    )}
  </ToolForm>;
}

type WorkflowStep = { op: string; options: Record<string, string> };

const workflowOps = workflowOpList() as { id: string; label: string; hint: string; browserOnly: boolean; fields: { key: string; label: string; type: string; options?: string[]; placeholder?: string }[] }[];
const workflowOpIds = workflowOps.map((op) => op.id);
const workflowOpLabels = workflowOps.map((op) => `${op.label}${op.browserOnly ? " (rasterises pages)" : ""}`);
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
      Chain PDF operations over one file: each step's output PDF becomes the next step's input. Steps marked "rasterises pages" turn text into page images, so put them last if you want selectable text earlier in the chain. Merge is not available here because it needs more than one input file.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={(next) => { setFiles(next); setOutput(null); setProgress([]); }} />

    <div className="grid gap-2">
      <p className="text-xs font-black uppercase text-neutral-500">Presets — one click fills a chain you can still edit</p>
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
      return `${output.filename} downloaded.`;
    })} />}
  </ToolForm>;
}

const batchOps = batchOpList() as { id: string; label: string; hint: string; accepts: string; browserOnly: boolean; fields: { key: string; label: string; type: string; options?: string[]; placeholder?: string }[] }[];
const batchOpIds = batchOps.map((op) => op.id);
const batchOpLabels = batchOps.map((op) => `${op.label}${op.browserOnly ? " (rasterises)" : ""}`);
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
      return `${only.name} downloaded.`;
    }
    const zipped = zipOutputs(result.outputs);
    const zipName = withExtension(`myfilekit-batch-${definition.id}`, "zip");
    downloadBytes(zipped, zipName, "application/zip");
    return `${zipName} downloaded (${result.outputs.length} files).`;
  });

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Apply one operation across many files at once — up to {MAX_BATCH_FILES}. Each file is processed on its own: if one fails, the rest keep going, and you get a report of which succeeded and which did not. Successful results download together as a ZIP (or as a single file when there is only one). Operations marked "rasterises" turn PDF text into page images.
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
            <p className="text-xs font-black uppercase text-neutral-500">Succeeded ({result.outputs.length})</p>
            <ul className="grid gap-1">
              {result.outputs.map((item) => <li key={item.name} className="break-words text-[var(--foreground)]">{item.name}</li>)}
            </ul>
          </div>
        )}
        {result.failures.length > 0 && (
          <div className="grid gap-1">
            <p className="text-xs font-black uppercase text-red-700 [.dark_&]:text-[#f8b4b4]">Failed / skipped ({result.failures.length})</p>
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
        <p className="text-xs font-black uppercase text-neutral-500">Presets — one click fills a chain you can still edit</p>
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
      return `${only.name} downloaded.`;
    }
    const zipName = withExtension("myfilekit-batch-workflow", "zip");
    downloadBytes(zipOutputs(result.outputs), zipName, "application/zip");
    return `${zipName} downloaded (${result.outputs.length} files).`;
  });

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Build a workflow once — a chain of steps, or a one-click preset — and run it over many PDFs at once, up to {MAX_WORKFLOW_BATCH_FILES}. Each file goes through the identical pipeline; if one file fails, the rest keep going and you get a per-file report. Successful results download together as a ZIP (or as a single PDF when there is only one). Steps marked "rasterises pages" turn text into page images.
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
            <p className="text-xs font-black uppercase text-neutral-500">Succeeded ({result.outputs.length})</p>
            <ul className="grid gap-1">
              {result.outputs.map((item) => <li key={item.name} className="break-words text-[var(--foreground)]">{item.name}</li>)}
            </ul>
          </div>
        )}
        {result.failures.length > 0 && (
          <div className="grid gap-1">
            <p className="text-xs font-black uppercase text-red-700 [.dark_&]:text-[#f8b4b4]">Failed / skipped ({result.failures.length})</p>
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

function InvoiceLauncher() {
  const features = [
    "Customizable template library",
    "Editable invoice, receipt, quote, and estimate wording",
    "Tax, discount, TDS, GST/VAT, HSN/SAC, and reverse-charge fields",
    "Bank, UPI, card, crypto, and custom payment instructions",
    "Logo upload, signature drawing, watermark, footer, and print/PDF export",
    "Show/hide controls for almost every invoice section",
  ];

  return (
    <div className="surface-card wabi-card-edge grid gap-5 p-5">
      <div>
        <p className="text-xs font-black uppercase text-neutral-500">Business document editor</p>
        <h3 className="mt-1 font-display text-2xl font-black">One invoice editor, fully customizable</h3>
        <p className="mt-2 max-w-2xl font-semibold leading-7 text-neutral-700">
          Receipts, quotes, and estimates are handled as invoice-style business documents inside the full editor, instead of split into weaker duplicate tools.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {features.map((feature) => (
          <div key={feature} className="surface-muted wabi-card-edge px-4 py-3 text-sm font-bold text-neutral-700">{feature}</div>
        ))}
      </div>
      <a className="primary-button w-fit" href="/invoice-generator/index.html">Open invoice editor</a>
    </div>
  );
}

function MissingPage() {
  return <div className="surface-panel wabi-edge p-10 text-center"><h1 className="font-display text-4xl font-black">Page not found</h1><a className="primary-button mx-auto mt-5 w-fit" href="#dashboard">Return to dashboard</a></div>;
}

function findToolById(id: string) {
  return tools.find((tool: Tool) => tool.id === id);
}

function activePrimaryNavIndex(hash: string) {
  if (!hash || hash === "#dashboard" || hash === "#browse-tools") return 0;
  const route = routeForHash(hash);
  const category = route.type === "category" ? route.category : route.type === "tool" ? route.tool.category : "";
  const navCategoryIndex = categories.findIndex((item) => item === category);
  return navCategoryIndex >= 0 ? navCategoryIndex + 1 : 0;
}

function readSessionValue(key: string) {
  try {
    return sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeSessionValue(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable in private or locked-down browser contexts.
  }
}

function readThemePreference(): ThemeMode {
  try {
    const stored = localStorage.getItem(themeStorageKey);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage may be unavailable in private or locked-down browser contexts.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function loadRecentToolIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(recentToolsStorageKey) || "[]");
    return Array.isArray(ids) ? ids.map(String) : [];
  } catch {
    return [];
  }
}

function loadRecentTools() {
  return loadRecentToolIds().map(findToolById).filter(Boolean).slice(0, 6) as Tool[];
}

function saveRecentTool(id: string) {
  const nextIds = [id, ...loadRecentToolIds().filter((item) => item !== id)].slice(0, 6);
  try {
    localStorage.setItem(recentToolsStorageKey, JSON.stringify(nextIds));
    window.dispatchEvent(new Event("myfilekit:recent-tools"));
  } catch {
    // Recent tools are optional and should never block the app.
  }
}

function fileTypeLabel(tool: Tool) {
  const file = tool.file as { extensions?: string[]; types?: string[] };
  const extensions = file.extensions || [];
  if (extensions.length) return extensions.slice(0, 4).join("/").toUpperCase();
  if (file.types?.includes("application/pdf")) return "PDF";
  if (file.types?.some((type) => type.startsWith("image/"))) return "Image";
  return "";
}

function multiFileLabel(tool: Tool) {
  const file = tool.file as { maxFiles?: number };
  return file.maxFiles && file.maxFiles > 1 ? "Multiple files" : "";
}

function iconForTool(tool: Tool) {
  if (tool.category === "PDF Tools") return FileText;
  if (tool.category === "Image Tools") return Image;
  if (tool.category === "Business Tools") return ReceiptText;
  if (tool.category === "Signature Tools") return PenLine;
  if (tool.category === "Security & Privacy") return ShieldCheck;
  if (tool.category === "Sharing & Collaboration") return Share2;
  if (tool.id.includes("rotate")) return RotateCw;
  if (tool.id.includes("crop") || tool.id.includes("split")) return Scissors;
  if (tool.id.includes("hash")) return Hash;
  return Sparkles;
}

async function runSafely(setStatus: (status: Status) => void, task: () => Promise<string>) {
  try {
    setStatus({ tone: "idle", message: "Processing..." });
    setStatus({ tone: "success", message: await task() });
  } catch (error: any) {
    setStatus({ tone: "error", message: error?.message || "Something went wrong." });
  }
}

async function sha256File(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type));
  if (!blob) throw new Error("This browser could not export the image.");
  return blob;
}

function requireOutput(value: string) {
  if (!value.trim()) throw new Error("Generate a result before downloading.");
  return value;
}

async function copyText(value: string) {
  const text = requireOutput(value);
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is not available in this browser.");
  await navigator.clipboard.writeText(text);
}

function imageExt(type: string) {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
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
