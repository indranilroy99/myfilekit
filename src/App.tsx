import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
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
  Sun,
  Upload,
  Zap,
} from "lucide-react";
import { FlowButton } from "@/components/ui/flow-button";
import { Icons } from "@/components/ui/icons";
import { LimelightNav, type NavItem } from "@/components/ui/limelight-nav";
import { NeuralNoise } from "@/components/ui/neural-noise";
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
import { base64Decode, base64Encode, diffToText, generatePassphrase, generatePassword, jsonToYaml, lineDiff, passwordStrength, textStats, urlDecode, urlEncode } from "./services/text-tools.service.js";

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

export default function App() {
  const [hash, setHash] = useState(window.location.hash || "#dashboard");
  const [theme, setTheme] = useState<ThemeMode>(() => readThemePreference());

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

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--ink)]">
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
  const primaryNavItems = useMemo<NavItem[]>(() => [
    { id: "dashboard", icon: <LayoutDashboard />, label: "Dashboard", onClick: () => { window.location.hash = "#dashboard"; } },
    ...categories.slice(0, 4).map((category) => {
      const Icon = categoryIcons[category];
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
            <FlowButton text="Browse tools" onClick={() => { window.location.hash = "#browse-tools"; }} />
          </div>
        </div>
      </header>
      <main id="app-main" className="mx-auto w-full max-w-screen-2xl px-5 pb-16 pt-7 sm:px-6 lg:px-10 2xl:max-w-[1680px] 2xl:px-0">
        {children}
      </main>
    </>
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
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        window.location.hash = "#dashboard";
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    window.addEventListener("myfilekit:recent-tools", handleRecentTools);
    window.addEventListener("storage", handleRecentTools);
    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("myfilekit:recent-tools", handleRecentTools);
      window.removeEventListener("storage", handleRecentTools);
      window.removeEventListener("keydown", handleShortcut);
    };
  }, []);

  return (
    <div className="dashboard-page">
      <section className={`hero-panel surface-panel wabi-edge overflow-hidden ${isSearching ? "hero-panel-searching" : ""}`}>
        <NeuralNoise className="hero-neural" color={[0.05, 0.11, 0.18]} opacity={0.055} speed={0.00008} />
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
          {tool.localProcessing && <span className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">{compact ? "Local" : "Local processing"}</span>}
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
        badges={[`${categoryTools.length} workflows`, "Local processing"]}
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
        badges={["Local processing", fileTypeLabel(tool), multiFileLabel(tool), tool.category].filter(Boolean)}
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
  return <p role="status" aria-live="polite" className={`min-h-12 whitespace-pre-line rounded-2xl border px-4 py-3 text-sm font-bold ${status.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : status.tone === "success" ? "border-[#b9c6a7] bg-[#edf4e3] text-[#31412f]" : "border-[var(--line)] bg-[var(--paper-soft)] text-[var(--stone)]"}`}>{status.message}</p>;
}

function FileControl({ accept, multiple = false, files, setFiles }: { accept: string; multiple?: boolean; files: File[]; setFiles: (files: File[]) => void }) {
  return <label
    className="surface-card grid cursor-pointer gap-3 rounded-3xl border-dashed border-neutral-300 p-5 transition hover:border-[var(--moss)]"
    onDragOver={(event) => event.preventDefault()}
    onDrop={(event) => {
      event.preventDefault();
      setFiles(Array.from(event.dataTransfer.files || []));
    }}
  >
    <span className="flex items-center gap-3 font-black"><Upload size={20} /> Choose or drop file{multiple ? "s" : ""}</span>
    <input aria-label={`Choose ${multiple ? "files" : "file"}`} className="sr-only" type="file" accept={accept} multiple={multiple} onChange={(event) => setFiles(Array.from(event.target.files || []))} />
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

function PrimaryButton({ label, onClick }: { label: string; onClick: () => void }) {
  if (label.toLowerCase().startsWith("download")) {
    return <AnimatedDownloadButton label={label} onClick={onClick} />;
  }

  return <LiquidButton className="primary-button" onClick={onClick}><Zap size={17} />{label}</LiquidButton>;
}

function SecondaryButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button className="secondary-button" type="button" onClick={onClick}>{label}</button>;
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
  if (tool.id === "images-to-pdf-tool") return <PdfFileTool tool={tool} action="Create PDF" multiple accept="image/jpeg,image/png,image/webp" run={(files) => imagesToPdf(files).then((bytes) => downloadBytes(bytes, "myfilekit-images.pdf", "application/pdf"))} />;
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
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <FileControl accept="image/jpeg,image/png,image/webp" files={signatures} setFiles={setSignatures} />
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

function ImageOutputTool({ tool, mode }: { tool: Tool; mode: "compress" | "convert" }) {
  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState("image/jpeg");
  const [quality, setQuality] = useState("0.82");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <FileControl accept="image/jpeg,image/png,image/webp" files={files} setFiles={setFiles} />
    <Select label="Output format" value={format} onChange={setFormat} options={["image/jpeg", "image/png", "image/webp"]} labels={["JPEG", "PNG", "WebP"]} />
    {mode === "compress" && <Range label="Quality" value={quality} onChange={setQuality} />}
    <PrimaryButton label={mode === "compress" ? "Compress image" : "Convert image"} onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const blob = mode === "compress"
        ? await compressImage(file, format, Number(quality))
        : await exportCanvas(await imageToCanvas(file), format, 0.92);
      downloadBlob(blob, withExtension(`${safeFilename(file.name)}-${mode}`, imageExt(format)));
      return `Original: ${formatBytes(file.size)}\nOutput: ${formatBytes(blob.size)}`;
    })} />
  </ToolForm>;
}

function BatchImageTool({ tool, mode }: { tool: Tool; mode: "compress" | "resize" }) {
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState("0.82");
  const [width, setWidth] = useState("1200");
  const [height, setHeight] = useState("800");
  const [format, setFormat] = useState("image/jpeg");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <FileControl accept="image/jpeg,image/png,image/webp" multiple files={files} setFiles={setFiles} />
    <Select label="Output format" value={format} onChange={setFormat} options={["image/jpeg", "image/png", "image/webp"]} labels={["JPEG", "PNG", "WebP"]} />
    {mode === "compress" ? <Range label="Quality" value={quality} onChange={setQuality} /> : <div className="grid gap-3 sm:grid-cols-2"><Input label="Width" value={width} onChange={setWidth} type="number" /><Input label="Height" value={height} onChange={setHeight} type="number" /></div>}
    <PrimaryButton label={mode === "compress" ? "Compress batch" : "Resize batch"} onClick={() => runSafely(setStatus, async () => {
      const valid = validateFiles(files, tool.file);
      let totalBefore = 0;
      let totalAfter = 0;
      const outputs: Record<string, Uint8Array> = {};
      for (const [index, file] of valid.entries()) {
        totalBefore += file.size;
        const blob = mode === "compress"
          ? await compressImage(file, format, Number(quality))
          : await exportCanvas(await resizeImage(file, Number(width), Number(height), true), format, 0.88);
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
    <FileControl accept="image/jpeg,image/png,image/webp" files={files} setFiles={setFiles} />
    <FileControl accept="image/jpeg,image/png,image/webp" files={signatures} setFiles={setSignatures} />
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
    <PrimaryButton label="Download HTML" onClick={() => { downloadText(html, "markdown-preview", "html", "text/html;charset=utf-8"); setStatus({ tone: "success", message: "HTML downloaded." }); }} />
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

function JsonTool() {
  const [input, setInput] = useState('{"hello":"world"}');
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const transform = (spaces: number) => runSafely(setStatus, async () => { const next = JSON.stringify(JSON.parse(input), null, spaces); setOutput(next); return spaces ? "JSON formatted." : "JSON minified."; });
  return <ToolForm status={status} onReset={() => { setInput(""); setOutput(""); setStatus(initialStatus); }}>
    <Textarea label="JSON input" value={input} onChange={setInput} rows={10} />
    <Textarea label="Result" value={output} onChange={setOutput} rows={10} />
    <div className="flex flex-wrap gap-2"><PrimaryButton label="Format" onClick={() => transform(2)} /><SecondaryButton label="Minify" onClick={() => transform(0)} /><SecondaryButton label="Download JSON" onClick={() => downloadText(output || input, "formatted", "json", "application/json;charset=utf-8")} /></div>
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
    <div className="flex flex-wrap gap-2"><PrimaryButton label="Convert" onClick={() => runSafely(setStatus, async () => { setOutput(jsonToCsv(input)); return "JSON converted."; })} /><SecondaryButton label="Download CSV" onClick={() => runSafely(setStatus, async () => { downloadText(requireOutput(output), "converted", "csv", "text/csv;charset=utf-8"); return "CSV ready to download."; })} /></div>
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
      <PrimaryButton label="Encode URL text" onClick={() => { setOutput(urlEncode(input)); setStatus({ tone: "success", message: "URL text encoded." }); }} />
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
    <div className="flex flex-wrap gap-2"><PrimaryButton label="Encode" onClick={() => { setOutput(base64Encode(input)); setStatus({ tone: "success", message: "Encoded." }); }} /><SecondaryButton label="Decode" onClick={() => runSafely(setStatus, async () => { setOutput(base64Decode(input)); return "Decoded."; })} /></div>
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
      {dataUrl && <SecondaryButton label="Download PNG" onClick={async () => { const blob = await (await fetch(dataUrl)).blob(); downloadBlob(blob, "myfilekit-qr-code.png"); }} />}
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
  return tools.filter((tool: Tool) => parts.every((part) => searchableText(tool).includes(part)));
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
  const navCategoryIndex = categories.slice(0, 4).findIndex((item) => item === category);
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

function glowColorForTool(tool: Tool): GlowColor {
  if (tool.category === "Image Tools") return "green";
  if (tool.category === "Business Tools") return "orange";
  if (tool.category === "Signature Tools") return "purple";
  if (tool.category === "Privacy Tools") return "green";
  if (tool.category === "Developer Utilities") return "purple";
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
