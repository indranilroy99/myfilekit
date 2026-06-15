import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  ChevronRight,
  Download,
  FileArchive,
  FileText,
  Hash,
  Image,
  LayoutDashboard,
  PenLine,
  ReceiptText,
  RotateCw,
  Scissors,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { AnimatedLogo } from "./components/AnimatedLogo";
import { ExpandingSearchDock } from "@/components/ui/expanding-search-dock-shadcnui";
import { GLSLHills } from "@/components/ui/glsl-hills";
import { categories, tools } from "./registry/tools.registry.js";
import { categoryRoute, routeForHash } from "./lib/routing";
import { formatBytes, parsePageRanges, simpleMarkdownToHtml } from "./utils/format.js";
import { safeFilename, withExtension } from "./utils/safe-filename.js";
import { validateFiles } from "./services/file-validator.js";
import { downloadBlob, downloadBytes, downloadText } from "./services/download.service.js";
import { csvToJson, jsonToCsv } from "./services/csv.service.js";
import { compressImage, cropImage, exportCanvas, imageToCanvas, resizeImage, rotateFlipImage } from "./services/image.service.js";
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
  "Developer Utilities": Hash,
};

const categoryDetails: Record<string, { description: string; accent: string }> = {
  "PDF Tools": { description: "Merge, split, rotate, and create PDFs in your browser.", accent: "PDF" },
  "Image Tools": { description: "Compress, resize, convert, crop, and rotate everyday images.", accent: "Image" },
  "Business Tools": { description: "Create clean invoices, receipts, quotes, and estimates.", accent: "Business" },
  "Signature Tools": { description: "Draw or type signatures and export them as PNG files.", accent: "Signature" },
  "Text & Data Tools": { description: "Format JSON, convert CSV, preview Markdown, and create PDFs from text.", accent: "Data" },
  "Developer Utilities": { description: "Handle hashes, Base64, and small file checks without leaving the page.", accent: "Utility" },
};

const featureHighlights = [
  ["Local-first processing", "Supported tools run in your browser without unnecessary uploads."],
  ["Search-first workspace", "Find PDF, image, business, signature, and data tools by name or task."],
  ["Essential tools in one place", "Keep common file work close without installing separate utilities."],
  ["Built for everyday files", "Clean controls, clear status messages, and practical export actions."],
  ["Works on your computer", "Use the toolkit in a modern browser on macOS, Windows, and Linux."],
  ["Working tools only", "Every visible card opens a real tool, so the dashboard stays clear and useful."],
];

const popularToolIds = [
  "merge-pdf-tool",
  "compress-image-tool",
  "resize-image-tool",
  "invoice-generator-tool",
  "json-formatter-tool",
  "file-hash-tool",
];

const quickSearches = ["Merge PDF", "Compress Image", "Invoice", "Signature", "JSON", "File Hash"];
const recentToolsStorageKey = "myfilekit:recentTools";

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
      <Shell>
        {route.type === "dashboard" && <Dashboard />}
        {route.type === "category" && <CategoryPage category={route.category} />}
        {route.type === "tool" && <ToolPage tool={route.tool} />}
        {route.type === "missing" && <MissingPage />}
      </Shell>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const runHeaderSearch = (value: string) => {
    const nextQuery = value.trim();
    if (!nextQuery) return;
    sessionStorage.setItem("myfilekit:lastSearch", nextQuery);
    window.dispatchEvent(new CustomEvent("myfilekit:search", { detail: nextQuery }));
    window.location.hash = "#dashboard";
  };

  return (
    <>
      <header className="site-header sticky top-0 z-30 backdrop-blur-xl">
        <div className="mx-auto flex w-[min(1240px,calc(100vw-28px))] items-center justify-between gap-4 py-4">
          <a href="#dashboard" className="flex items-center gap-3 text-[var(--ink)] no-underline">
            <AnimatedLogo compact />
            <span className="leading-tight">
              <span className="block font-display text-xl font-black">MyFileKit</span>
              <span className="block text-xs font-bold uppercase text-neutral-500">Local-first tools</span>
            </span>
          </a>
          <nav className="hidden items-center gap-2 lg:flex" aria-label="Primary navigation">
            <NavPill href="#dashboard" icon={LayoutDashboard} label="Dashboard" />
            {categories.slice(0, 4).map((category) => (
              <NavPill key={category} href={categoryRoute(category)} icon={categoryIcons[category]} label={category.replace(" Tools", "")} />
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <div className="hidden md:block">
              <ExpandingSearchDock onSearch={runHeaderSearch} placeholder="Search tools..." />
            </div>
            <a className="ink-button rounded-full px-4 py-2 text-sm font-black no-underline" href="#category-pdf-tools">
              Browse tools
            </a>
          </div>
        </div>
      </header>
      <main id="app-main" className="mx-auto w-[min(1240px,calc(100vw-28px))] pb-16 pt-7">
        {children}
      </main>
    </>
  );
}

function NavPill({ href, icon: Icon, label }: { href: string; icon: any; label: string }) {
  return (
    <a className="nav-pill inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-extrabold no-underline shadow-sm transition hover:-translate-y-0.5" href={href}>
      <Icon size={16} />
      {label}
    </a>
  );
}

function Dashboard() {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState(() => sessionStorage.getItem("myfilekit:lastSearch") || "");
  const [recentTools, setRecentTools] = useState<Tool[]>(() => loadRecentTools());
  const matches = useMemo(() => filterTools(query), [query]);
  const popularTools = useMemo(() => popularToolIds.map(findToolById).filter(Boolean) as Tool[], []);
  const grouped = query
    ? [["Search results", matches] as const]
    : categories.map((category) => [category, tools.filter((tool: Tool) => tool.category === category)] as const);
  const updateQuery = (value: string) => {
    setQuery(value);
    sessionStorage.setItem("myfilekit:lastSearch", value);
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
    <div className="grid gap-8">
      <section className="hero-panel surface-panel wabi-edge overflow-hidden">
        <GLSLHills className="hero-hills" cameraZ={138} planeSize={192} speed={0.18} />
        <div className="relative z-10 mx-auto grid max-w-5xl justify-items-center gap-6 px-6 py-12 text-center md:px-10 lg:px-12 lg:py-16">
          <div className="grid justify-items-center gap-6">
            <div className="grid justify-items-center gap-4 sm:flex sm:items-center">
              <AnimatedLogo />
              <div>
                <p className="app-badge mx-auto w-fit text-xs font-black uppercase sm:mx-0">Local-first file toolkit</p>
                <h1 className="font-display text-5xl font-black md:text-7xl">MyFileKit</h1>
              </div>
            </div>
            <p className="max-w-3xl text-xl font-semibold leading-snug text-neutral-700 md:text-2xl">
              PDF, image, business, signature, and data tools — fast, private, and ready when you are.
            </p>
            <p className="max-w-2xl text-sm font-bold text-neutral-500">
              Supported tools process files locally in your browser. No unnecessary uploads.
            </p>
            <div className="spotlight-search surface-card wabi-card-edge flex w-full max-w-3xl items-center gap-3 p-3 text-left">
              <span className="icon-tile grid h-11 w-11 place-items-center rounded-2xl">
                <Search size={21} />
              </span>
              <input
                ref={searchRef}
                aria-label="Search MyFileKit tools"
                className="min-h-12 w-full bg-transparent text-lg font-semibold outline-none placeholder:text-neutral-400"
                value={query}
                onChange={(event) => updateQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") updateQuery("");
                }}
                placeholder="Search PDF, image, invoice, signature, JSON tools..."
                type="search"
              />
              <kbd className="hidden rounded-xl bg-[var(--paper-soft)] px-2.5 py-1.5 text-xs font-black text-[var(--stone)] sm:block">⌘/Ctrl K</kbd>
            </div>
            <div className="flex max-w-3xl flex-wrap justify-center gap-2">
              {quickSearches.map((term) => (
                <button key={term} className="quick-chip" type="button" onClick={() => { updateQuery(term); searchRef.current?.focus(); }}>
                  {term}
                </button>
              ))}
            </div>
            <p className="text-sm font-bold text-neutral-500">
              {query ? `${matches.length} matching tool${matches.length === 1 ? "" : "s"}` : `${tools.length} tools across ${categories.length} categories`}
            </p>
          </div>
        </div>
      </section>

      {!query && recentTools.length > 0 && (
        <section className="surface-panel wabi-edge grid gap-5 p-5 md:p-7">
          <SectionHeader title="Recently Used" subtitle="Quickly jump back into your last tools." />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {recentTools.map((tool) => <ToolCard key={tool.id} tool={tool} compact />)}
          </div>
        </section>
      )}

      {!query && (
        <section className="surface-panel wabi-edge grid gap-5 p-5 md:p-7">
          <SectionHeader title="Popular Tools" subtitle="The tools people usually reach for first." />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {popularTools.map((tool) => <ToolCard key={tool.id} tool={tool} compact />)}
          </div>
        </section>
      )}

      <section className="surface-panel wabi-edge grid gap-6 p-5 md:p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl font-black">{query ? "Search Results" : "Tool Library"}</h2>
            <p className="mt-1 font-semibold text-neutral-500">{query ? "Filtered by name, task, category, badge, and keyword." : "Every visible card opens a working tool page."}</p>
          </div>
          <span className="local-badge inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black">
            <ShieldCheck size={16} />
            Local-first
          </span>
        </div>
        {matches.length === 0 ? (
          <EmptyState query={query} />
        ) : (
          <div className="grid gap-8">
            {grouped.filter(([, items]) => items.length).map(([category, items]) => (
              <ToolSection key={category} title={category} tools={items} searchMode={Boolean(query)} />
            ))}
          </div>
        )}
      </section>

      <section className="surface-panel wabi-edge grid gap-5 p-5 md:p-7">
        <div>
          <h2 className="font-display text-3xl font-black">Why MyFileKit</h2>
          <p className="mt-1 font-semibold text-neutral-500">Quiet, practical details that keep the toolkit reliable.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {featureHighlights.map(([title, copy]) => (
            <div key={title} className="surface-card wabi-card-edge p-4">
              <p className="font-black">{title}</p>
              <p className="mt-1 text-sm font-medium leading-6 text-neutral-600">{copy}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
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

function ToolSection({ title, tools: sectionTools, searchMode = false }: { title: string; tools: Tool[]; searchMode?: boolean }) {
  const Icon = categoryIcons[title] || Sparkles;
  const details = categoryDetails[title];
  return (
    <section className="grid gap-4">
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
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sectionTools.map((tool: Tool) => <ToolCard key={tool.id} tool={tool} />)}
      </div>
    </section>
  );
}

function ToolCard({ tool, compact = false }: { tool: Tool; compact?: boolean }) {
  const Icon = iconForTool(tool);
  return (
    <a href={tool.route} className={`tool-card group grid gap-4 rounded-3xl p-5 text-[var(--ink)] no-underline transition hover:-translate-y-1 focus-visible:-translate-y-1 ${compact ? "min-h-40" : "min-h-52"}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="icon-tile grid h-12 w-12 place-items-center rounded-2xl transition group-hover:rotate-3">
          <Icon size={21} />
        </span>
        <span className="tool-arrow" aria-hidden="true">Open <ChevronRight size={15} /></span>
      </div>
      <div>
        <h4 className="text-lg font-black">{tool.name}</h4>
        <p className="mt-1 text-sm font-semibold leading-6 text-neutral-600">{tool.description}</p>
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        <span className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">{categoryDetails[tool.category]?.accent || tool.category}</span>
        {tool.localProcessing && <span className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">Local</span>}
        {fileTypeLabel(tool) && <span className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-black uppercase">{fileTypeLabel(tool)}</span>}
      </div>
    </a>
  );
}

function CategoryPage({ category }: { category: string }) {
  const categoryTools = tools.filter((tool: Tool) => tool.category === category);
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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {categoryTools.map((tool: Tool) => <ToolCard key={tool.id} tool={tool} />)}
        </div>
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
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="surface-panel wabi-edge p-5 md:p-7">
          <div className="mb-6 flex items-start gap-4">
            <span className="icon-tile grid h-14 w-14 place-items-center rounded-2xl"><Icon size={24} /></span>
            <div>
              <p className="moss-text text-xs font-black uppercase">Dashboard / {tool.category}</p>
              <h1 className="font-display text-4xl font-black">{tool.name}</h1>
              <p className="mt-2 max-w-2xl font-semibold leading-7 text-neutral-600">{tool.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="local-badge rounded-full px-3 py-1 text-xs font-black uppercase">Local processing</span>
                {fileTypeLabel(tool) && <span className="tag-badge rounded-full px-3 py-1 text-xs font-black uppercase">{fileTypeLabel(tool)}</span>}
                <span className="tag-badge rounded-full px-3 py-1 text-xs font-black uppercase">{tool.category}</span>
              </div>
              <p className="mt-3 text-sm font-semibold text-neutral-500">For supported tools, selected files stay in your browser session.</p>
            </div>
          </div>
          <div className="tool-action-panel">
            <ToolRenderer tool={tool} />
          </div>
        </div>
        <aside className="grid content-start gap-4">
          <div className="surface-muted wabi-card-edge p-5">
            <p className="flex items-center gap-2 font-black"><BadgeCheck size={18} /> Navigation</p>
            <div className="mt-4 grid gap-2">
              <a className="side-link" href="#dashboard"><LayoutDashboard size={16} /> Dashboard</a>
              <a className="side-link" href={categoryRoute(tool.category)}>All {tool.category}</a>
              <button className="side-link text-left" type="button" onClick={() => history.back()}>Back to previous page</button>
            </div>
          </div>
          {related.length > 0 && (
            <div className="surface-card wabi-card-edge p-5">
              <p className="font-black">More in {tool.category}</p>
              <div className="mt-3 grid gap-2">
                {related.map((item: Tool) => <a key={item.id} className="side-link" href={item.route}>{item.name}</a>)}
              </div>
            </div>
          )}
        </aside>
      </section>
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
        <button className="nav-action" type="button" onClick={() => history.back()}><ArrowLeft size={16} /> Back</button>
        <button className="nav-action" type="button" onClick={() => history.forward()}>Forward <ArrowRight size={16} /></button>
        <a className="nav-action" href="#dashboard"><LayoutDashboard size={16} /> Dashboard</a>
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
  if (tool.id === "receipt-generator-tool") return <BusinessDocument title="Receipt Generator" name="receipt" labels={["Merchant", "Customer", "Payment method", "Reference"]} />;
  if (tool.id === "quote-generator-tool") return <BusinessDocument title="Quote / Estimate Generator" name="quote" labels={["Business", "Client", "Valid until", "Terms"]} />;
  if (tool.id === "draw-signature-tool") return <DrawSignatureTool />;
  if (tool.id === "type-signature-tool") return <TypeSignatureTool />;
  if (tool.id === "text-to-pdf-tool") return <TextToPdfTool />;
  if (tool.id === "markdown-preview-tool") return <MarkdownTool />;
  if (tool.id === "json-formatter-tool") return <JsonTool />;
  if (tool.id === "csv-to-json-tool") return <CsvToJsonTool />;
  if (tool.id === "json-to-csv-tool") return <JsonToCsvTool />;
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

function BusinessDocument({ title, name, labels }: { title: string; name: string; labels: string[] }) {
  const [fields, setFields] = useState(Object.fromEntries(labels.map((label) => [label, ""])));
  const [items, setItems] = useState("Item, quantity, price\nConsulting, 1, 5000");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFields(Object.fromEntries(labels.map((label) => [label, ""]))); setItems(""); setStatus(initialStatus); }}>
    <div className="grid gap-3 sm:grid-cols-2">{labels.map((label) => <Input key={label} label={label} value={fields[label]} onChange={(value) => setFields({ ...fields, [label]: value })} />)}</div>
    <Textarea label="Items" value={items} onChange={setItems} />
    <PrimaryButton label={`Export ${name}`} onClick={() => runSafely(setStatus, async () => {
      downloadText(printableDocument(title, fields, items), name, "html", "text/html;charset=utf-8");
      return `${title} exported as HTML. Open it and print to PDF if needed.`;
    })} />
  </ToolForm>;
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
    <div className="surface-card wabi-card-edge p-4" dangerouslySetInnerHTML={{ __html: html }} />
    <PrimaryButton label="Download HTML" onClick={() => { downloadText(html, "markdown-preview", "html", "text/html;charset=utf-8"); setStatus({ tone: "success", message: "HTML downloaded." }); }} />
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
  return <div className="surface-card wabi-card-edge grid gap-4 p-5">
    <p className="font-semibold leading-7 text-neutral-700">The invoice generator opens the full editor with templates, line items, tax, discount, TDS, payment details, logo controls, signatures, and print/PDF export.</p>
    <a className="primary-button w-fit" href="/invoice-generator/index.html">Open Invoice Generator</a>
  </div>;
}

function ToolForm({ children, status, onReset }: { children: React.ReactNode; status: Status; onReset: () => void }) {
  return <div className="grid gap-4">
    {children}
    <div className="flex flex-wrap gap-2"><SecondaryButton label="Reset" onClick={onReset} /></div>
    <StatusBox status={status} />
  </div>;
}

function StatusBox({ status }: { status: Status }) {
  return <p role="status" aria-live="polite" className={`min-h-12 whitespace-pre-line rounded-2xl border px-4 py-3 text-sm font-bold ${status.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : status.tone === "success" ? "border-[#b9c6a7] bg-[#edf4e3] text-[#31412f]" : "border-[var(--line)] bg-[var(--paper-soft)] text-[var(--stone)]"}`}>{status.message}</p>;
}

function FileControl({ accept, multiple = false, files, setFiles }: { accept: string; multiple?: boolean; files: File[]; setFiles: (files: File[]) => void }) {
  return <label className="surface-card grid cursor-pointer gap-3 rounded-3xl border-dashed border-neutral-300 p-5 transition hover:border-[var(--moss)]">
    <span className="flex items-center gap-3 font-black"><Upload size={20} /> Choose file{multiple ? "s" : ""}</span>
    <input aria-label={`Choose ${multiple ? "files" : "file"}`} className="sr-only" type="file" accept={accept} multiple={multiple} onChange={(event) => setFiles(Array.from(event.target.files || []))} />
    <span className="text-sm font-semibold text-neutral-500">{files.length ? files.map((file) => file.name).join(", ") : "No file selected"}</span>
  </label>;
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
  return <button className="primary-button" type="button" onClick={onClick}><Download size={17} />{label}</button>;
}

function SecondaryButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button className="secondary-button" type="button" onClick={onClick}>{label}</button>;
}

function EmptyState({ query }: { query: string }) {
  const runSuggestion = (term: string) => {
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

function MissingPage() {
  return <div className="surface-panel wabi-edge p-10 text-center"><h1 className="font-display text-4xl font-black">Page not found</h1><a className="primary-button mx-auto mt-5 w-fit" href="#dashboard">Return to dashboard</a></div>;
}

function filterTools(query: string) {
  const parts = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return tools;
  return tools.filter((tool: Tool) => parts.every((part) => [tool.name, tool.category, tool.description, ...(tool.keywords || []), ...(tool.badges || [])].join(" ").toLowerCase().includes(part)));
}

function findToolById(id: string) {
  return tools.find((tool: Tool) => tool.id === id);
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
  localStorage.setItem(recentToolsStorageKey, JSON.stringify(nextIds));
  window.dispatchEvent(new Event("myfilekit:recent-tools"));
}

function fileTypeLabel(tool: Tool) {
  const file = tool.file as { extensions?: string[]; types?: string[] };
  const extensions = file.extensions || [];
  if (extensions.length) return extensions.slice(0, 3).join("/").toUpperCase();
  if (file.types?.includes("application/pdf")) return "PDF";
  if (file.types?.some((type) => type.startsWith("image/"))) return "Image";
  return "";
}

function iconForTool(tool: Tool) {
  if (tool.category === "PDF Tools") return FileText;
  if (tool.category === "Image Tools") return Image;
  if (tool.category === "Business Tools") return ReceiptText;
  if (tool.category === "Signature Tools") return PenLine;
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

function printableDocument(title: string, details: Record<string, string>, itemText: string) {
  const rows = String(itemText || "").split(/\r?\n/).filter(Boolean).map((row) => row.split(",").map((cell) => cell.trim()));
  const detailsHtml = Object.entries(details).map(([key, value]) => `<p><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</p>`).join("");
  const rowsHtml = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui;margin:40px;color:#111}table{width:100%;border-collapse:collapse}td{border-bottom:1px solid #ddd;padding:10px}</style></head><body><h1>${escapeHtml(title)}</h1>${detailsHtml}<table>${rowsHtml}</table></body></html>`;
}

function escapeHtml(value: string) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
