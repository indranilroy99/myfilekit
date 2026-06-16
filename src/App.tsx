import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Download,
  FileArchive,
  FileText,
  FolderSearch,
  Hash,
  Image,
  Layers3,
  LayoutDashboard,
  PenLine,
  ReceiptText,
  RotateCw,
  Scissors,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  Zap,
} from "lucide-react";
import { FlowButton } from "@/components/ui/flow-button";
import { Icons } from "@/components/ui/icons";
import { LimelightNav, type NavItem } from "@/components/ui/limelight-nav";
import { NeuralNoise } from "@/components/ui/neural-noise";
import { GlowCard, type GlowColor } from "@/components/ui/spotlight-card";
import AnimatedDownloadButton from "@/components/ui/download-hover-button";
import { categories, tools } from "./registry/tools.registry.js";
import { categoryRoute, routeForHash } from "./lib/routing";
import { formatBytes, parsePageRanges, simpleMarkdownToHtml } from "./utils/format.js";
import { safeFilename, withExtension } from "./utils/safe-filename.js";
import { validateFiles } from "./services/file-validator.js";
import { downloadBlob, downloadBytes, downloadText } from "./services/download.service.js";
import { csvToJson, jsonToCsv } from "./services/csv.service.js";
import { cleanImageMetadata, compressImage, cropImage, exportCanvas, imageDimensions, imageToCanvas, resizeImage, rotateFlipImage } from "./services/image.service.js";
import { inspectImageMetadata, metadataReportToJson } from "./services/metadata.service.js";
import { deletePdfPages, extractPdfPages, imagesToPdf, loadPdf, mergePdfs, rotatePdfPages, textToPdf } from "./services/pdf.service.js";

type Tool = (typeof tools)[number];
type Status = { tone: "idle" | "success" | "error"; message: string };

const initialStatus: Status = { tone: "idle", message: "Ready." };
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
const popularToolIds = ["merge-pdf-tool", "compress-image-tool", "resize-image-tool", "invoice-generator-tool", "json-formatter-tool", "file-hash-tool"];

export default function App() {
  const [hash, setHash] = useState(window.location.hash || "#dashboard");

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash || "#dashboard");
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const route = routeForHash(hash);

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--ink)]">
      <Shell hash={hash}>
        {route.type === "dashboard" && <Dashboard />}
        {route.type === "browse" && <BrowseToolsPage />}
        {route.type === "category" && <CategoryPage category={route.category} />}
        {route.type === "tool" && <ToolPage tool={route.tool} />}
        {route.type === "missing" && <MissingPage />}
      </Shell>
    </div>
  );
}

function Shell({ children, hash }: { children: React.ReactNode; hash: string }) {
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

  return (
    <>
      <header className="site-header sticky top-0 z-30 backdrop-blur-xl">
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

function Dashboard() {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState(() => readSessionValue("myfilekit:lastSearch"));
  const [recentTools, setRecentTools] = useState<Tool[]>(() => loadRecentTools());
  const matches = useMemo(() => filterTools(query), [query]);
  const isSearching = Boolean(query.trim());
  const popularTools = popularToolIds.map(findToolById).filter(Boolean) as Tool[];
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

      {!isSearching && recentTools.length > 0 && (
        <section className="dashboard-shelf">
          <SectionHeader title="Recently Used" subtitle="Quickly jump back into your last tools." />
          <div className="dashboard-tool-row">
            {recentTools.map((tool) => <ToolCard key={tool.id} tool={tool} compact />)}
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
    ["Easy to extend", "New tools are added through one registry so the dashboard stays consistent."],
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
  return (
    <GlowCard customSize glowColor={glowColorForTool(tool)} className={`tool-card group p-0 transition hover:-translate-y-1 ${compact ? "min-h-40" : "min-h-52"}`}>
      <a href={tool.route} className={`tool-card-link gap-4 rounded-3xl p-5 transition focus-visible:-translate-y-1 ${compact ? "min-h-40" : "min-h-52"}`}>
        <div className="flex items-start justify-between gap-3">
          <span className="icon-tile grid h-12 w-12 place-items-center rounded-2xl transition group-hover:rotate-3">
            <Icon size={21} />
          </span>
          <span className="tool-arrow" aria-hidden="true">Open <ChevronRight size={15} /></span>
        </div>
        <div>
          <h4 className="text-lg font-black">{tool.name}</h4>
          <p className={`tool-description mt-1 text-sm font-semibold leading-6 text-neutral-600 ${compact ? "tool-description-compact" : ""}`}>{tool.description}</p>
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          <span className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">{categoryDetails[tool.category]?.accent || tool.category}</span>
          {visibleBadges.map((badge: string) => <span key={badge} className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">{badge}</span>)}
          {tool.localProcessing && <span className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">Local processing</span>}
          {multiFile && <span className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">{multiFile}</span>}
          {fileTypeLabel(tool) && <span className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">{fileTypeLabel(tool)}</span>}
        </div>
      </a>
    </GlowCard>
  );
}

function BrowseToolsPage() {
  const [query, setQuery] = useState("");
  const isSearching = Boolean(query.trim());
  const visibleTools = useMemo(() => filterTools(query), [query]);
  const grouped = categories
    .map((category) => [category, visibleTools.filter((tool: Tool) => tool.category === category)] as const)
    .filter(([, items]) => items.length);

  return (
    <div className="grid gap-6">
      <Toolbar title="Browse Tools" subtitle="All MyFileKit workflows in one searchable library" />
      <section className="surface-panel wabi-edge p-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="moss-text text-xs font-black uppercase">Tool library</p>
            <h1 className="font-display text-4xl font-black">Find the right workflow</h1>
            <p className="mt-1 max-w-2xl font-semibold text-neutral-500">
              Browse by category or search by task, file type, or outcome.
            </p>
          </div>
          <span className="local-badge inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black">
            <ShieldCheck size={16} />
            Local-first
          </span>
        </div>
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
      <Toolbar title={category} subtitle={`${categoryTools.length} available workflows`} />
      <section className="surface-panel wabi-edge p-6">
        <div className="mb-6 flex items-start gap-3">
          <span className="icon-tile grid h-14 w-14 place-items-center rounded-2xl"><Icon size={24} /></span>
          <div>
            {details && <p className="moss-text text-xs font-black uppercase">{details.accent}</p>}
            <h1 className="font-display text-4xl font-black">{category}</h1>
            <p className="mt-1 max-w-2xl font-semibold text-neutral-500">{details?.description || "Choose any working tool below."}</p>
          </div>
        </div>
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
      <Toolbar title={tool.name} subtitle={tool.category} />
      <section className="grid gap-6">
        <div className="surface-panel wabi-edge tool-page-panel p-5 md:p-7">
          <div className="mb-6 flex items-start gap-4">
            <span className="icon-tile grid h-14 w-14 place-items-center rounded-2xl"><Icon size={24} /></span>
            <div>
              <p className="moss-text text-xs font-black uppercase">Dashboard / {tool.category}</p>
              <h1 className="font-display text-4xl font-black">{tool.name}</h1>
              <p className="mt-2 max-w-2xl font-semibold leading-7 text-neutral-600">{tool.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="local-badge rounded-full px-3 py-1 text-xs font-black uppercase">Local processing</span>
                {fileTypeLabel(tool) && <span className="tag-badge rounded-full px-3 py-1 text-xs font-black uppercase">{fileTypeLabel(tool)}</span>}
                {multiFileLabel(tool) && <span className="tag-badge rounded-full px-3 py-1 text-xs font-black uppercase">{multiFileLabel(tool)}</span>}
                <span className="tag-badge rounded-full px-3 py-1 text-xs font-black uppercase">{tool.category}</span>
              </div>
              <p className="mt-3 text-sm font-semibold text-neutral-500">For supported tools, selected files stay in your browser session.</p>
            </div>
          </div>
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

function ToolMetaPanel({ status, onReset }: { status: Status; onReset: () => void }) {
  return (
    <aside className="tool-form-status">
      <div>
        <p className="text-xs font-black uppercase text-neutral-500">Status</p>
        <StatusBox status={status} />
      </div>
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        Supported files are processed locally in this browser session. Reset clears the current form state.
      </div>
      <SecondaryButton label="Reset" onClick={onReset} />
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

  return <button className="primary-button" type="button" onClick={onClick}><Download size={17} />{label}</button>;
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

function Toolbar({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase text-neutral-500">MyFileKit</p>
        <p className="font-display text-2xl font-black">{title}</p>
        <p className="text-sm font-semibold text-neutral-500">{subtitle}</p>
      </div>
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
  if (tool.id === "images-to-pdf-tool") return <PdfFileTool tool={tool} action="Create PDF" multiple accept="image/jpeg,image/png,image/webp" run={(files) => imagesToPdf(files).then((bytes) => downloadBytes(bytes, "myfilekit-images.pdf", "application/pdf"))} />;
  if (["compress-image-tool", "convert-image-tool"].includes(tool.id)) return <ImageOutputTool tool={tool} mode={tool.id === "compress-image-tool" ? "compress" : "convert"} />;
  if (tool.id === "resize-image-tool") return <ResizeImageTool tool={tool} />;
  if (tool.id === "crop-image-tool") return <CropImageTool tool={tool} />;
  if (tool.id === "rotate-flip-image-tool") return <RotateFlipImageTool tool={tool} />;
  if (tool.id === "draw-signature-tool") return <DrawSignatureTool />;
  if (tool.id === "type-signature-tool") return <TypeSignatureTool />;
  if (tool.id === "text-to-pdf-tool") return <TextToPdfTool />;
  if (tool.id === "markdown-preview-tool") return <MarkdownTool />;
  if (tool.id === "json-formatter-tool") return <JsonTool />;
  if (tool.id === "csv-to-json-tool") return <CsvToJsonTool />;
  if (tool.id === "json-to-csv-tool") return <JsonToCsvTool />;
  if (tool.id === "metadata-cleaner") return <MetadataCleanerTool tool={tool} />;
  if (tool.id === "base64-tool") return <Base64Tool />;
  if (tool.id === "file-hash-tool") return <FileHashTool tool={tool} />;
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
  return <ToolForm status={status} onReset={() => { setFiles([]); setRanges(""); setStatus(initialStatus); }}>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <Input label="Pages" value={ranges} onChange={setRanges} placeholder="Example: 1-3,5,8" helper="Use comma-separated pages or ranges." />
    <PrimaryButton label={action} onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const pdf = await loadPdf(file);
      const pages = parsePageRanges(ranges, pdf.getPageCount());
      const bytes = await run(file, pages);
      downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-${suffix}`, "pdf"), "application/pdf");
      return `Processed ${pages.length} selected page${pages.length === 1 ? "" : "s"}.`;
    })} />
  </ToolForm>;
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

function MetadataCleanerTool({ tool }: { tool: Tool }) {
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
        Full local image metadata workflow for JPG/JPEG, PNG, and WebP: inspect EXIF/XMP/ICC/IPTC-style containers where present, review sensitive fields like GPS, then re-encode a cleaned copy in your browser.
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
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        Privacy note: the selected image and metadata report are processed locally in this browser session. MyFileKit does not upload it, store it, track it, or log metadata contents.
      </div>
      <PrimaryButton label="Clean metadata and re-encode image" onClick={clean} />
    </ToolForm>
  );
}

function DrawSignatureTool() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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

  return <ToolForm status={status} onReset={() => { canvasRef.current?.getContext("2d")?.clearRect(0, 0, 900, 260); setStatus(initialStatus); }}>
    <canvas ref={canvasRef} className="surface-card h-auto min-h-44 w-full touch-none rounded-3xl border-dashed border-neutral-400" width={900} height={260} />
    <div className="grid gap-3 sm:grid-cols-2"><Input label="Color" value={color} onChange={setColor} type="color" /><Input label="Thickness" value={size} onChange={setSize} type="number" /></div>
    <PrimaryButton label="Download PNG" onClick={() => canvasRef.current?.toBlob((blob) => { if (blob) downloadBlob(blob, "signature.png"); setStatus({ tone: "success", message: "Signature downloaded." }); })} />
  </ToolForm>;
}

function TypeSignatureTool() {
  const [name, setName] = useState("");
  const [style, setStyle] = useState("cursive");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setName(""); setStatus(initialStatus); }}>
    <Input label="Name" value={name} onChange={setName} placeholder="Type your name" />
    <Select label="Style" value={style} onChange={setStyle} options={["cursive", "serif", "monospace"]} labels={["Cursive", "Serif", "Monospace"]} />
    <PrimaryButton label="Download PNG" onClick={() => {
      const canvas = document.createElement("canvas");
      canvas.width = 900; canvas.height = 260;
      const ctx = canvas.getContext("2d")!;
      ctx.font = `72px ${style}`;
      ctx.fillText(name || "Signature", 40, 145);
      canvas.toBlob((blob) => { if (blob) downloadBlob(blob, "typed-signature.png"); setStatus({ tone: "success", message: "Signature downloaded." }); });
    }} />
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
  const [input, setInput] = useState("name,email\nIndranil,hello@example.com");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setInput(""); setOutput(""); setStatus(initialStatus); }}>
    <Textarea label="CSV input" value={input} onChange={setInput} rows={9} />
    <Textarea label="JSON output" value={output} onChange={setOutput} rows={10} />
    <PrimaryButton label="Convert" onClick={() => runSafely(setStatus, async () => { setOutput(JSON.stringify(csvToJson(input), null, 2)); return "CSV converted."; })} />
  </ToolForm>;
}

function JsonToCsvTool() {
  const [input, setInput] = useState('[{"name":"Indranil","email":"hello@example.com"}]');
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setInput(""); setOutput(""); setStatus(initialStatus); }}>
    <Textarea label="JSON input" value={input} onChange={setInput} rows={9} />
    <Textarea label="CSV output" value={output} onChange={setOutput} rows={10} />
    <div className="flex flex-wrap gap-2"><PrimaryButton label="Convert" onClick={() => runSafely(setStatus, async () => { setOutput(jsonToCsv(input)); return "JSON converted."; })} /><SecondaryButton label="Download CSV" onClick={() => downloadText(output, "converted", "csv", "text/csv;charset=utf-8")} /></div>
  </ToolForm>;
}

function Base64Tool() {
  const [input, setInput] = useState("Hello MyFileKit");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setInput(""); setOutput(""); setStatus(initialStatus); }}>
    <Textarea label="Input" value={input} onChange={setInput} rows={7} />
    <Textarea label="Output" value={output} onChange={setOutput} rows={7} />
    <div className="flex flex-wrap gap-2"><PrimaryButton label="Encode" onClick={() => { setOutput(btoa(unescape(encodeURIComponent(input)))); setStatus({ tone: "success", message: "Encoded." }); }} /><SecondaryButton label="Decode" onClick={() => runSafely(setStatus, async () => { setOutput(decodeURIComponent(escape(atob(input)))); return "Decoded."; })} /></div>
  </ToolForm>;
}

function FileHashTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setOutput(""); setStatus(initialStatus); }}>
    <FileControl accept="*/*" files={files} setFiles={setFiles} />
    <Textarea label="SHA-256" value={output} onChange={setOutput} rows={3} />
    <PrimaryButton label="Generate SHA-256" onClick={() => runSafely(setStatus, async () => { const [file] = validateFiles(files, tool.file); const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer()); setOutput([...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")); return `Hashed ${file.name}.`; })} />
  </ToolForm>;
}

function InvoiceLauncher() {
  const features = [
    "Premium template library",
    "Editable invoice, receipt, quote, and estimate wording",
    "Tax, discount, TDS, GST/VAT, HSN/SAC, and reverse-charge fields",
    "Bank, UPI, card, crypto, and custom payment instructions",
    "Logo upload, signature drawing, watermark, footer, and print/PDF export",
    "Show/hide controls for almost every invoice section",
  ];

  return (
    <div className="surface-card wabi-card-edge grid gap-5 p-5">
      <div>
        <p className="text-xs font-black uppercase text-neutral-500">Premium business document editor</p>
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
      <a className="primary-button w-fit" href="/invoice-generator/index.html">Open premium invoice editor</a>
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

function imageExt(type: string) {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
}
