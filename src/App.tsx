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
  ShieldCheck,
  Sparkles,
  Loader2,
  Menu,
  Sun,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { FlowButton } from "@/components/ui/flow-button";
import { Icons } from "@/components/ui/icons";
import { LimelightNav, type NavItem } from "@/components/ui/limelight-nav";
import { NumberedPagination } from "@/components/ui/pagination";
import { GlowCard, type GlowColor } from "@/components/ui/spotlight-card";
import AnimatedDownloadButton from "@/components/ui/download-hover-button";
import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { categories, tools } from "./registry/tools.registry.js";
import { categoryRoute, routeForHash } from "./lib/routing";
import { formatBytes, parsePageRanges, simpleMarkdownToHtml } from "./utils/format.js";
import { safeFilename, withExtension } from "./utils/safe-filename.js";
import { validateFiles } from "./services/file-validator.js";
import { downloadBlob, downloadBytes, downloadText, revokeDownloadUrl } from "./services/download.service.js";
import { csvToJson, jsonToCsv } from "./services/csv.service.js";
import { addSignatureToImage, addTextToImage, cleanImageMetadata, compressImage, cropImage, exportCanvas, imageDimensions, imageToCanvas, resizeImage, rotateFlipImage } from "./services/image.service.js";
import { inspectImageMetadata, metadataReportToJson } from "./services/metadata.service.js";
import { addPdfPageNumbers, addSignatureImageToPdf, addTextToPdf, cleanPdfMetadata, deletePdfPages, extractPdfPages, imagesToPdf, loadPdf, mergePdfs, rotatePdfPages, textToPdf, watermarkPdf } from "./services/pdf.service.js";
import { compressPdf as rasterCompressPdf, extractPdfText, flattenPdf, invertPdf, pdfToImages, pdfToZip } from "./services/pdf-render.service.js";
import { addHeadersFooters, createPdf, cropResizePdf, fillPdfForm, fingerprintPdf, organizePdfPages, readPdfFormFields, redactPdf, repairPdf } from "./services/pdf-edit.service.js";
import { base64Decode, base64Encode, diffToText, generatePassphrase, generatePassword, jsonToYaml, lineDiff, passwordStrength, textStats, urlDecode, urlEncode } from "./services/text-tools.service.js";
import { canvasToPdf, canvasesToPdf, csvToPdf, markdownToPdf } from "./services/convert.service.js";
import { captureVideoFrame, enhanceCanvas, getHtml2Canvas, startCameraStream, stopCameraStream } from "./services/capture.service.js";
import { docxToHtml, epubToHtml, pptxToSlides, readWorkbookSheets, sanitizeHtmlForOffline, sheetsToHtml } from "./services/office.service.js";
import { pdfToDocx, pdfToEpub, pdfToHtml, pdfToXlsx } from "./services/export.service.js";
import { OCR_ENGINE_SIZE_LABEL, mergeSearchablePdfPages, ocrImages, ocrPdf, terminateOcrWorker } from "./services/ocr.service.js";
import { createSpeechRecognizer, getSpeechSynthesis, loadSpeechVoices, speechRecognitionSupport, speechSynthesisSupported, splitTextForSpeech } from "./services/audio.service.js";

type Tool = (typeof tools)[number];
type Status = { tone: "idle" | "success" | "error"; message: string };
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
  "Privacy Tools": ShieldCheck,
  "Developer Utilities": Hash,
};

const categoryDetails: Record<string, { description: string; accent: string }> = {
  "PDF Tools": { description: "Merge, split, rotate, and create PDFs in your browser.", accent: "PDF" },
  "Image Tools": { description: "Compress, resize, convert, crop, and rotate everyday images.", accent: "Image" },
  "Business Tools": { description: "Create polished invoices with templates, tax, payments, signatures, and brand controls.", accent: "Business" },
  "Signature Tools": { description: "Draw or type signatures and export them as PNG files.", accent: "Signature" },
  "Text & Data Tools": { description: "Format JSON, convert CSV, preview Markdown, and create PDFs from text.", accent: "Data" },
  "Privacy Tools": { description: "Clean supported image metadata locally in your browser.", accent: "Privacy" },
  "Developer Utilities": { description: "Handle hashes, Base64, and small file checks without leaving the page.", accent: "Utility" },
};

const quickSearches = ["Merge PDF", "Compress Image", "Invoice", "Signature", "JSON", "File Hash"];
const recentToolsStorageKey = "myfilekit:recentTools";
const themeStorageKey = "myfilekit:theme";
const popularToolIds = ["merge-pdf-tool", "compress-image-tool", "resize-image-tool", "invoice-generator-tool", "json-formatter-tool", "file-hash-tool"];
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
  const primaryNavItems = useMemo<NavItem[]>(() => [
    { id: "dashboard", icon: <LayoutDashboard />, label: "Dashboard", onClick: () => { window.location.hash = "#dashboard"; } },
    ...categories.map((category) => {
      const Icon = categoryIcons[category] || Sparkles;
      return {
        id: category,
        icon: <Icon />,
        label: category.replace(" Tools", ""),
        onClick: () => { window.location.hash = categoryRoute(category); },
      };
    }),
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
          <LimelightNav
            className="hidden lg:inline-flex"
            items={primaryNavItems}
            activeIndex={activeNavIndex}
            limelightClassName="bg-[var(--primary)]"
          />
          <div className="flex items-center gap-2">
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <div className="hidden lg:block">
              <FlowButton text="Browse tools" onClick={() => { window.location.hash = "#browse-tools"; }} />
            </div>
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

  const linkClass = "flex min-h-11 items-center rounded-2xl px-4 py-3 text-sm font-black text-[var(--ink)] no-underline transition hover:bg-[var(--paper-soft)]";

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
          <span className="font-display text-lg font-black">Menu</span>
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
        <div className="command-stat" key={label}>
          <span className="command-stat-icon"><Icon size={17} /></span>
          <span>
            <span className="block text-sm font-black">{label}</span>
            <span className="block text-xs font-bold text-neutral-500">{note}</span>
          </span>
        </div>
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
          <a key={category} className="category-card" href={categoryRoute(category)}>
            <span className="category-icon"><Icon size={19} /></span>
            <span className="grid gap-1">
              <span className="font-black">{category}</span>
              <span className="text-sm font-semibold text-neutral-500">{categoryDetails[category]?.description}</span>
            </span>
            <span className="category-count">{count}</span>
          </a>
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
          <article className="why-card" key={title}>
            <p className="font-black">{title}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-neutral-600">{description}</p>
          </article>
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
  const categoryClass = `category-${tool.category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return (
    <GlowCard customSize glowColor={glowColorForTool(tool)} className={`tool-card ${categoryClass} group p-0 transition hover:-translate-y-1 ${compact ? "min-h-40" : "min-h-52"}`}>
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
          <span className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">{primaryBadge}</span>
          {!compact && visibleBadges.map((badge: string) => <span key={badge} className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">{badge}</span>)}
          {!compact && multiFile && <span className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">{multiFile}</span>}
          {!compact && fileTypeLabel(tool) && <span className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">{fileTypeLabel(tool)}</span>}
        </div>
      </a>
    </GlowCard>
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
        <div className="tool-grid">
          {visibleTools.map((tool: Tool) => <ToolCard key={tool.id} tool={tool} />)}
        </div>
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

function StatusBox({ status }: { status: Status }) {
  const tone = status.tone === "error"
    ? "border-red-200 bg-red-50 text-red-800 [.dark_&]:border-[#7f2a2a] [.dark_&]:bg-[#2a1416] [.dark_&]:text-[#f8b4b4]"
    : status.tone === "success"
      ? "border-[#b9c6a7] bg-[#edf4e3] text-[#31412f] [.dark_&]:border-[#3f5136] [.dark_&]:bg-[#16241a] [.dark_&]:text-[#bfe3b0]"
      : "border-[var(--line)] bg-[var(--paper-soft)] text-[var(--stone)]";
  return <p role="status" aria-live="polite" className={`min-h-12 whitespace-pre-line rounded-2xl border px-4 py-3 text-sm font-bold ${tone}`}>{status.message}</p>;
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

function PrimaryButton({ label, onClick }: { label: string; onClick: () => unknown }) {
  const { pending, handleClick } = usePendingHandler(onClick);
  const isDownload = label.toLowerCase().startsWith("download");
  const busyLabel = isDownload ? "Downloading…" : "Working…";

  if (isDownload) {
    return <AnimatedDownloadButton label={pending ? busyLabel : label} onClick={handleClick} disabled={pending} />;
  }

  return (
    <LiquidButton className="primary-button" onClick={handleClick} disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 className="animate-spin" size={17} /> : <Zap size={17} />}
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
  if (tool.id === "merge-pdf-tool") return <PdfFileTool tool={tool} action="Merge PDFs" multiple run={(files) => mergePdfs(files).then((bytes) => downloadBytes(bytes, "myfilekit-merged.pdf", "application/pdf"))} />;
  if (tool.id === "split-pdf-tool") return <PageRangeTool tool={tool} action="Extract pages" suffix="extracted" run={extractPdfPages} />;
  if (tool.id === "delete-pdf-pages-tool") return <PageRangeTool tool={tool} action="Delete pages" suffix="pages-deleted" run={deletePdfPages} />;
  if (tool.id === "rotate-pdf-tool") return <RotatePdfTool tool={tool} />;
  if (tool.id === "add-text-to-pdf-tool") return <AddTextToPdfTool tool={tool} />;
  if (tool.id === "add-signature-to-pdf-tool") return <AddSignatureToPdfTool tool={tool} />;
  if (tool.id === "pdf-page-numbers-tool") return <PdfPageNumbersTool tool={tool} />;
  if (tool.id === "watermark-pdf-tool") return <WatermarkPdfTool tool={tool} />;
  if (tool.id === "pdf-metadata-cleaner-tool") return <PdfMetadataCleanerTool tool={tool} />;
  if (tool.id === "pdf-to-image-tool") return <PdfToImageTool tool={tool} />;
  if (tool.id === "extract-text-tool") return <ExtractTextTool tool={tool} />;
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
  if (tool.id === "create-pdf-tool") return <CreatePdfTool />;
  if (tool.id === "repair-pdf-tool") return <RepairPdfTool tool={tool} />;
  if (tool.id === "fingerprint-pdf-tool") return <FingerprintPdfTool tool={tool} />;
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
  </ToolForm>;
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
  return (page: number, total: number) => setStatus({ tone: "idle", message: `${verb} page ${page} of ${total}…` });
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
    setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Reads text out of scanned PDFs and photos with a local OCR engine (Tesseract, English). The engine and its language model ship with this app — {OCR_ENGINE_SIZE_LABEL} loads once from this page on first use, then your browser caches it. Nothing is uploaded. Accuracy depends on the scan: straight, high-contrast, 200–300 DPI pages read best. A searchable PDF keeps the original page image with an invisible text layer over it.
    </div>
    <FileControl accept="application/pdf,image/jpeg,image/png,image/webp" multiple files={files} setFiles={setFiles} label="Choose or drop one scanned PDF, or images" />
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
        { searchablePdf: searchable, dpi: Number(dpi), onStage }
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

function filterTools(query: string) {
  const parts = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return tools;
  const scored: Array<{ tool: Tool; score: number }> = [];
  for (const tool of tools) {
    const name = tool.name.toLowerCase();
    const keywords = (tool.keywords || []).join(" ").toLowerCase();
    const description = tool.description.toLowerCase();
    const haystack = searchableText(tool);
    let score = 0;
    let matchedAll = true;
    for (const part of parts) {
      if (!haystack.includes(part)) { matchedAll = false; break; }
      if (name === part) score += 100;
      else if (name.startsWith(part)) score += 60;
      else if (name.includes(part)) score += 40;
      else if (keywords.includes(part)) score += 20;
      else if (description.includes(part)) score += 10;
      else score += 5;
    }
    if (matchedAll) scored.push({ tool, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.tool);
}

function searchableText(tool: Tool) {
  return [tool.name, tool.category, tool.description, ...(tool.keywords || []), ...(tool.badges || []), ...(tool.acceptedTypes || [])].join(" ").toLowerCase();
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

function glowColorForTool(_tool: Tool): GlowColor {
  return "blue";
}

function iconForTool(tool: Tool) {
  if (tool.category === "PDF Tools") return FileText;
  if (tool.category === "Image Tools") return Image;
  if (tool.category === "Business Tools") return ReceiptText;
  if (tool.category === "Signature Tools") return PenLine;
  if (tool.category === "Privacy Tools") return ShieldCheck;
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
