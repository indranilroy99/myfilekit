import { useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { Accessibility, ArrowLeft, ArrowRight, ChevronDown, ChevronRight, Combine, FileArchive, FileCheck, FileSignature, FileText, FolderSearch, Hash, EyeOff, Image, Languages, Layers3, LayoutDashboard, Moon, PenLine, Pencil, ReceiptText, RotateCw, ScanSearch, Scissors, Search, Share2, ShieldCheck, Sparkles, Tags, Menu, Sun, Upload, X, Zap } from "lucide-react";
import { Icons } from "@/components/ui/icons";
import { NumberedPagination } from "@/components/ui/pagination";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { categories, categoryGroups, tools } from "./registry/tools.registry.js";
import { stashWorkspaceFiles, clearWorkspaceFilesUnless, setActiveTool } from "./lib/workspace-handoff";
import { ErrorBoundary } from "./components/ErrorBoundary";
import LandingPage from "./components/LandingPage";
import EditorPage from "./components/EditorPage";
import DocumentView from "./components/DocumentView";
import { categoryRoute, routeForHash } from "./lib/routing";
import { filterTools, searchableText } from "./lib/search.js";
import { formatBytes } from "./utils/format.js";
import { StatusBox } from "./tools/shared";
import type { Tool } from "./tools/shared";

type ThemeMode = "light" | "dark";
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
  "Security & Privacy": { description: "Redact PII, run a privacy audit, and triage suspicious PDFs for malware — plus encrypt, unlock, and clean metadata, all locally in your browser.", accent: "Security" },
  "Developer Utilities": { description: "Handle hashes, Base64, and small file checks without leaving the page.", accent: "Utility" },
  "Sharing & Collaboration": { description: "Send files browser-to-browser and sketch together over a direct connection — still no server.", accent: "Sharing" },
};

const quickSearches = ["Edit PDF text", "Annotate PDF", "Sign PDF", "Compare PDFs", "Make PDF accessible", "Remove JavaScript", "Redact PII", "Check for malware", "Encrypt PDF", "Merge PDF", "Compress Image", "Invoice"];
const recentToolsStorageKey = "myfilekit:recentTools";
const themeStorageKey = "myfilekit:theme";
// Popular = established staples only. New tools live in the New & Notable shelf
// below; the runtime !isNew guard in Dashboard keeps the two shelves disjoint even
// if a tool here is later flagged isNew.
const popularToolIds = ["auto-redact-pii-tool", "compress-pdf-tool", "pdf-analyzer-tool", "pdf-to-word-tool", "merge-pdf-tool", "compress-image-tool", "invoice-generator-tool", "file-hash-tool"];
// The newest flagship tools, surfaced in a "New & Notable" shelf on the dashboard.
const newAndNotableIds = ["sanitize-pdf-tool", "accessibility-check-tool", "tag-pdf-tool", "translate-pdf-tool", "batch-workflow-tool", "extract-images-tool"];
const browseToolsPageSize = 10;

// Set by Cmd/Ctrl+K when it navigates to the dashboard from another route, so the
// dashboard can focus its search input on mount instead of racing a fixed timeout.
let pendingSearchFocus = false;

export default function App() {
  const [hash, setHash] = useState(() => window.location.hash || "#dashboard");
  const [theme, setTheme] = useState<ThemeMode>(() => readThemePreference());
  const isInitialRoute = useRef(true);

  useEffect(() => {
    const syncHash = () => {
      const next = window.location.hash || "#dashboard";
      // A staged hand-off survives exactly one navigation: into its own tool.
      const route = routeForHash(next);
      clearWorkspaceFilesUnless(route.type === "tool" ? route.tool.id : route.type === "editor" ? "editor" : "");
      setHash(next);
    };
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
  const routeTitle = route.type === "home" ? "MyFileKit"
    : route.type === "editor" ? "Editor"
    : route.type === "dashboard" ? "Workspace"
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
    <div className="app" data-route={route.type}>
      <span aria-live="polite" className="sr-only">{routeTitle}</span>
      <MenuBar hash={hash} theme={theme} onToggleTheme={() => setTheme((current) => current === "dark" ? "light" : "dark")} />
      <div className="workbench">
        <SideBar hash={hash} />
        <main className="worksurface" id="app-main" tabIndex={-1}>
          {route.type === "home" && <LandingPage featured={popularToolIds.map(findToolById).filter(Boolean).slice(0, 6) as any} />}
          {route.type === "editor" && <EditorPage renderTool={(tool: Tool) => <ToolRenderer key={tool.id} tool={tool} />} />}
          {route.type === "dashboard" && <WorkspaceHome />}
          {route.type === "browse" && <ToolIndex ext={route.ext} />}
          {route.type === "category" && <ToolIndex category={route.category} />}
          {route.type === "tool" && <ToolPage tool={route.tool} />}
          {route.type === "missing" && <MissingPage />}
        </main>
      </div>
      <StatusBar route={route} />
    </div>
  );
}

/** Application menu bar: brand, tool mega-menu, global search, theme. */
// Menus mirror how the work is actually organised, not the registry's shape.
// Module scope: a literal rebuilt per render would invalidate ToolMegaMenu's memo.
const MENUS: { id: string; label: string; categories: string[] }[] = [
  { id: "pdf", label: "PDF", categories: ["PDF Tools"] },
  { id: "convert", label: "Convert & Data", categories: ["Text & Data Tools"] },
  { id: "image", label: "Image", categories: ["Image Tools"] },
  { id: "secure", label: "Security", categories: ["Security & Privacy"] },
  { id: "more", label: "More", categories: ["Business Tools", "Signature Tools", "Developer Utilities", "Sharing & Collaboration"] },
];

function MenuBar({ hash, theme, onToggleTheme }: { hash: string; theme: ThemeMode; onToggleTheme: () => void }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLElement | null>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  // Panel geometry, measured from whichever trigger is open — click OR hover.
  const [menuBox, setMenuBox] = useState<{ left: number; space: number } | null>(null);
  const activeCategory = useMemo(() => {
    const route = routeForHash(hash);
    return route.type === "category" ? route.category : route.type === "tool" ? route.tool.category : "";
  }, [hash]);

  useEffect(() => { setOpenMenu(null); }, [hash]);

  // Measured on open (any path) and on resize, never only on the click handler:
  // hover-switching used to inherit the previous trigger's numbers.
  useLayoutEffect(() => {
    if (!openMenu) { setMenuBox(null); return undefined; }
    const measure = () => {
      const trigger = triggerRefs.current[openMenu];
      const bar = barRef.current;
      if (!trigger || !bar) return;
      const t = trigger.getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      setMenuBox({
        left: Math.max(8, Math.round(t.left - b.left)),
        space: Math.max(240, Math.round(window.innerWidth - t.left - 8)),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [openMenu]);

  useEffect(() => {
    if (!openMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const trigger = triggerRefs.current[openMenu];
      setOpenMenu(null);
      trigger?.focus(); // never strand focus on <body>
    };
    const onDown = (event: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [openMenu]);

  return (
    <header className="menubar" ref={barRef as any}>
      <a className="menubar-brand" href="#dashboard">MyFileKit <span>local</span></a>
      {MENUS.map((menu) => {
        const isOpen = openMenu === menu.id;
        const owns = menu.categories.includes(activeCategory);
        return (
          <div key={menu.id} className="menu-anchor">
            <button
              type="button"
              ref={(node) => { triggerRefs.current[menu.id] = node; }}
              className={`menubar-item ${owns ? "menubar-item-active" : ""}`}
              aria-haspopup="true"
              aria-expanded={isOpen}
              aria-controls={`menu-${menu.id}`}
              onClick={(event) => {
                // Anchor right when the trigger sits past the midpoint, so a wide
                // panel cannot run off the edge with no way to scroll to it.
                setOpenMenu(isOpen ? null : menu.id);
                window.dispatchEvent(new Event("myfilekit:close-search"));
              }}
              // Hover only switches between menus for a real pointer, and never
              // while focus is inside the open popup (it would unmount the
              // focused link and drop focus to <body>).
              onMouseEnter={() => {
                if (!openMenu || openMenu === menu.id) return;
                if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
                if (barRef.current?.querySelector(".menu-pop")?.contains(document.activeElement)) return;
                setOpenMenu(menu.id);
              }}
            >
              {menu.label}<ChevronDown size={12} aria-hidden="true" />
            </button>
            {isOpen ? <ToolMegaMenu id={`menu-${menu.id}`} categories={menu.categories} label={menu.label} box={menuBox} /> : null}
          </div>
        );
      })}
      <span className="menubar-spacer" />
      <GlobalSearch />
      <button type="button" className="menubar-icon" onClick={onToggleTheme} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} title="Toggle theme">
        {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
      </button>
    </header>
  );
}

/** Sejda-style multi-column tool menu: every tool listed as text, grouped. */
function ToolMegaMenu({ id, categories, label, box }: { id: string; categories: string[]; label: string; box: { left: number; space: number } | null }) {
  const columns = useMemo(() => {
    const out: { title: string; items: Tool[] }[] = [];
    for (const category of categories) {
      const inCategory = tools.filter((tool: Tool) => tool.category === category);
      const groups = (categoryGroups as Record<string, string[]>)[category];
      if (groups) {
        for (const group of groups) {
          const items = inCategory.filter((tool: Tool) => tool.group === group);
          if (items.length) out.push({ title: group, items });
        }
        const ungrouped = inCategory.filter((tool: Tool) => !tool.group || !groups.includes(tool.group));
        if (ungrouped.length) out.push({ title: "Other", items: ungrouped });
      } else if (inCategory.length) {
        out.push({ title: category.replace(" Tools", ""), items: inCategory });
      }
    }
    return out;
  }, [categories]);

  return (
    <nav className="menu-pop" id={id} aria-label={`${label} tools`} style={box ? ({ "--menu-left": `${box.left}px`, "--menu-space": `${box.space}px` } as React.CSSProperties) : undefined}>
      {columns.map((column) => (
        <div className="menu-col" key={column.title}>
          <p className="menu-col-title">{column.title}</p>
          {column.items.map((tool: Tool) => {
            const Icon = iconForTool(tool);
            return (
              <a key={tool.id} className={`menu-link ${tool.isNew ? "menu-link-new" : ""}`} href={tool.route}>
                <Icon size={13} aria-hidden="true" />{tool.name}
              </a>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function GlobalSearch() {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => (query.trim() ? filterTools(query).slice(0, 8) : []), [query]);
  useEffect(() => {
    const close = () => setQuery("");
    window.addEventListener("myfilekit:close-search", close);
    return () => window.removeEventListener("myfilekit:close-search", close);
  }, []);
  return (
    <div className="search-anchor" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setQuery(""); }}>
      <div className="sidebar-search" style={{ padding: 0, border: 0 }}>
        <input
          type="search"
          name="tool-search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Search all tools"
          placeholder="Search tools…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0]) { window.location.hash = matches[0].route; setQuery(""); }
            if (event.key === "Escape") { setQuery(""); } // keep focus in the field
          }}
          style={{ flex: "1 1 160px", minWidth: 0, maxWidth: 210 }}
        />
      </div>
      {matches.length ? (
        <nav className="menu-pop search-pop" aria-label="Search results">
          <span className="sr-only" aria-live="polite">{matches.length} tool{matches.length === 1 ? "" : "s"} match</span>
          {matches.map((tool: Tool) => {
            const Icon = iconForTool(tool);
            return (
              <a key={tool.id} className="menu-link" href={tool.route} onClick={() => setQuery("")}>
                <Icon size={13} aria-hidden="true" />{tool.name}
              </a>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}

/** Fixed left rail: high-level context only — never a second copy of the tool
 * list shown in the canvas. Tool access is the menubar mega-menu (all 105) and,
 * inside a tool, the inspector rail of siblings. */
function SideBar({ hash }: { hash: string }) {
  const [recent, setRecent] = useState<Tool[]>(() => loadRecentTools());
  const route = routeForHash(hash);
  const activeCategory = route.type === "category" ? route.category : route.type === "tool" ? route.tool.category : "";
  const activeToolId = route.type === "tool" ? route.tool.id : "";

  useEffect(() => {
    const sync = () => setRecent(loadRecentTools());
    window.addEventListener("myfilekit:recent-tools", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("myfilekit:recent-tools", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return (
    <nav className="sidebar" aria-label="Workspace navigation">
      <div className="sidebar-scroll">
        <p className="sidebar-group">Library</p>
        <a className={`sidebar-link ${route.type === "home" ? "sidebar-link-active" : ""}`} href="#home" aria-current={route.type === "home" ? "page" : undefined}>
          <Sparkles size={14} aria-hidden="true" />Home
        </a>
        <a className={`sidebar-link ${route.type === "dashboard" ? "sidebar-link-active" : ""}`} href="#dashboard" aria-current={route.type === "dashboard" ? "page" : undefined}>
          <LayoutDashboard size={14} aria-hidden="true" />Workspace
        </a>
        <a className={`sidebar-link ${route.type === "editor" ? "sidebar-link-active" : ""}`} href="#editor" aria-current={route.type === "editor" ? "page" : undefined}>
          <FileText size={14} aria-hidden="true" />Editor
        </a>
        <a className={`sidebar-link ${route.type === "browse" ? "sidebar-link-active" : ""}`} href="#browse-tools" aria-current={route.type === "browse" ? "page" : undefined}>
          <FolderSearch size={14} aria-hidden="true" />All tools
        </a>

        <p className="sidebar-group">Categories</p>
        {categories.map((category: string) => {
          const Icon = categoryIcons[category] || Sparkles;
          const isActive = category === activeCategory;
          return (
            <a
              key={category}
              className={`sidebar-link ${isActive ? "sidebar-link-active" : ""}`}
              href={categoryRoute(category)}
              aria-current={isActive ? (route.type === "category" ? "page" : "location") : undefined}
            >
              <Icon size={14} aria-hidden="true" />{category.replace(" Tools", "")}
            </a>
          );
        })}

        {recent.length ? (
          <>
            <p className="sidebar-group">Recent</p>
            {recent.map((tool: Tool) => {
              const Icon = iconForTool(tool);
              return (
                <a
                  key={tool.id}
                  className={`sidebar-link ${tool.id === activeToolId ? "sidebar-link-active" : ""}`}
                  href={tool.route}
                  aria-current={tool.id === activeToolId ? "page" : undefined}
                >
                  <Icon size={14} aria-hidden="true" />{tool.name}
                </a>
              );
            })}
          </>
        ) : null}
      </div>
      <p className="sidebar-foot">Files are processed here, never uploaded.</p>
    </nav>
  );
}

// The status bar must never contradict a tool's own copy, so every tool that can
// open a connection gets an accurate label instead of "Offline".
// Maintained by hand. A test asserts these six are present and that the network
// call sites still exist, but it CANNOT detect a seventh tool gaining a network
// path — add the tool here when you add the path.
const NETWORK_NOTES: Record<string, string> = {
  // Uploads the PDF, to a backend the operator deploys. Off by default.
  "request-signature-tool": "Server-backed · only when you configure it",
  // Bring-your-own AI endpoint: fully local until the user configures one.
  "translate-pdf-tool": "Local · optional AI endpoint, off by default",
  "summarize-pdf-tool": "Local · optional AI endpoint, off by default",
  "chat-with-pdf-tool": "Local · optional AI endpoint, off by default",
  // Direct browser-to-browser: no server, but not "offline" either.
  "p2p-share-tool": "Direct connection · no server",
  "collab-whiteboard-tool": "Direct connection · no server",
};

function StatusBar({ route }: { route: ReturnType<typeof routeForHash> }) {
  const networkNote = route.type === "tool" ? NETWORK_NOTES[route.tool.id] : undefined;
  const label = route.type === "tool" ? route.tool.name
    : route.type === "category" ? route.category
    : route.type === "home" ? "Home"
    : route.type === "editor" ? "Editor"
    : route.type === "dashboard" ? "Workspace"
    : route.type === "browse" ? "All tools"
    : "Not found";
  return (
    <footer className="statusbar">
      <span className="statusbar-dot" aria-hidden="true" />
      <span>{networkNote || "Offline · nothing uploaded"}</span>
      <span className="doc-bar-sep" aria-hidden="true" />
      <span>{label}</span>
      <span className="statusbar-right">
        <span>{tools.length} tools</span>
      </span>
    </footer>
  );
}



/** Tools whose declared file support matches this filename's extension. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function toolsForFilename(name: string): Tool[] {
  const ext = extensionOf(name);
  return tools.filter((tool: Tool) => {
    const file = tool.file as { extensions?: string[]; anyType?: boolean } | undefined;
    if (file?.anyType) return true; // works on any bytes (hashing, fingerprinting)
    if (!ext) return false;
    return Boolean(file?.extensions?.some((item: string) => item.toLowerCase() === ext));
  });
}

/** Every extension any tool declares — used to tell the user what is accepted. */
function supportedExtensions(): string[] {
  const out = new Set<string>();
  for (const tool of tools as Tool[]) {
    for (const ext of ((tool.file as { extensions?: string[] })?.extensions || [])) out.add(ext.toLowerCase());
  }
  return [...out].sort();
}

/** The landing surface: a workspace, not a directory. Drop a file and the tools
 * that can act on it are offered; nothing is uploaded and nothing is retained —
 * only the name and size are read, to match tools and show what you picked. */
function WorkspaceHome() {
  const [dropped, setDropped] = useState<{ files: File[] } | null>(null);
  const [isOver, setIsOver] = useState(false);
  const primary = dropped?.files[0] || null;
  const matches = useMemo(() => (primary ? toolsForFilename(primary.name) : []), [primary]);
  const quick = popularToolIds.map(findToolById).filter(Boolean) as Tool[];

  const take = (list: FileList | null) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    setDropped({ files });
  };
  // Stage the files only for the tool the user actually clicks. Staging at drop
  // time let an unrelated tool adopt them — including the P2P sender.
  const openWith = (tool: Tool) => { if (dropped) stashWorkspaceFiles(dropped.files, tool.id); };

  return (
    <>
      <div className="doc-bar">
        <h1>Workspace</h1>
        <span className="doc-bar-sep" aria-hidden="true" />
        <span className="doc-bar-meta">{tools.length} tools · nothing leaves this device</span>
        <span className="doc-bar-actions">
          <a className="secondary-button" href="#browse-tools">Browse all tools</a>
        </span>
      </div>

      <div className="workspace">
        <section className="workspace-main">
          <label
            className={`workspace-drop ${isOver ? "dropzone-active" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setIsOver(true); }}
            onDragOver={(event) => { event.preventDefault(); setIsOver(true); }}
            onDragLeave={(event) => { event.preventDefault(); setIsOver(false); }}
            onDrop={(event) => { event.preventDefault(); setIsOver(false); take(event.dataTransfer.files); }}
          >
            <input className="sr-only" type="file" aria-label="Choose a file to work on" onChange={(event) => take(event.target.files)} />
            <span className="dropzone-tile" aria-hidden="true"><Upload size={22} /></span>
            <span className="workspace-drop-title">Drop a file to start</span>
            <span className="dropzone-hint">PDF · images · office · text</span>
            <span className="dropzone-cta">Choose a file</span>
          </label>

          {dropped && primary ? (
            <div className="workspace-file" role="status" aria-live="polite">
              <div className="workspace-file-head">
                <FileText size={15} aria-hidden="true" />
                <span className="file-chip-name" title={primary.name}>{primary.name}</span>
                <span className="file-chip-size">{formatBytes(primary.size)}</span>
                {dropped.files.length > 1 ? <span className="file-chip-size">+{dropped.files.length - 1} more</span> : null}
                <button type="button" className="icon-button" aria-label="Clear selected file" onClick={() => { setDropped(null); clearWorkspaceFilesUnless(""); }}><X size={15} /></button>
              </div>
              <p className="inspector-title">
                {matches.length
                  ? `${matches.length} tool${matches.length === 1 ? "" : "s"} can work on this`
                  : `No tool here opens ${extensionOf(primary.name) ? "." + extensionOf(primary.name) : "this"} files`}
              </p>
              {matches.length ? null : (
                <p className="workspace-hint">
                  MyFileKit works with {supportedExtensions().map((ext) => "." + ext).join(", ")}.{" "}
                  <a href="#browse-tools">Browse all {tools.length} tools</a> or choose a different file above.
                </p>
              )}
              {matches.length ? (
              <div className="index-grid">
                {matches.slice(0, 12).map((tool: Tool) => {
                  const Icon = iconForTool(tool);
                  return (
                    <a className="index-row" key={tool.id} href={tool.route} onClick={() => openWith(tool)}>
                      <Icon size={14} aria-hidden="true" />
                      <span className="index-row-name">{tool.name}</span>
                      {tool.isNew ? <span className="index-new">NEW</span> : null}
                      <span className="index-row-desc">{tool.description}</span>
                    </a>
                  );
                })}
              </div>
              ) : null}
              {matches.length > 12 ? <p className="workspace-more"><a href={`#browse-tools?ext=${extensionOf(primary.name)}`}>See all {matches.length} tools for .{extensionOf(primary.name)}</a></p> : null}
            </div>
          ) : (
            <p className="workspace-hint">Your file is read in this browser to match it with tools. It is never uploaded, and nothing about it is saved.</p>
          )}

          <div className="index-head" style={{ marginTop: 20 }}>
            <h2>Common tasks</h2>
            <span>{quick.length}</span>
          </div>
          <div className="index-grid">
            {quick.map((tool: Tool) => {
              const Icon = iconForTool(tool);
              return (
                <a className="index-row" key={tool.id} href={tool.route}>
                  <Icon size={14} aria-hidden="true" />
                  <span className="index-row-name">{tool.name}</span>
                  {tool.isNew ? <span className="index-new">NEW</span> : null}
                  <span className="index-row-desc">{tool.description}</span>
                </a>
              );
            })}
          </div>
        </section>

      </div>
    </>
  );
}

/** Dense, scannable tool index — a text list, not a bento grid. */
function ToolIndex({ category, ext }: { category?: string; ext?: string } = {}) {
  const sections = useMemo(() => {
    const base = category ? tools.filter((tool: Tool) => tool.category === category) : tools;
    const scoped = ext ? base.filter((tool: Tool) => toolsForFilename(`f.${ext}`).includes(tool)) : base;
    if (category) {
      const groups = (categoryGroups as Record<string, string[]>)[category];
      if (!groups) return [{ title: category, items: scoped }];
      const out = groups
        .map((group) => ({ title: group, items: scoped.filter((tool: Tool) => tool.group === group) }))
        .filter((section) => section.items.length);
      const rest = scoped.filter((tool: Tool) => !tool.group || !groups.includes(tool.group));
      if (rest.length) out.push({ title: "Other", items: rest });
      return out;
    }
    return categories
      .map((name: string) => ({ title: name, items: scoped.filter((tool: Tool) => tool.category === name) }))
      .filter((section) => section.items.length);
  }, [category, ext]);

  const toolCount = sections.reduce((sum, section) => sum + section.items.length, 0);

  return (
    <>
      <div className="doc-bar">
        <h1>{category || "All tools"}</h1>
        <span className="doc-bar-sep" aria-hidden="true" />
        <span className="doc-bar-meta">{toolCount} tools · every file stays on this device</span>
        {ext ? (
          <span className="doc-bar-actions">
            <a className="secondary-button" href="#browse-tools">Filtered by .{ext} — clear</a>
          </span>
        ) : null}
      </div>
      <div className="tool-index">
        {sections.map((section) => (
          <section className="index-section" key={section.title}>
            <div className="index-head">
              <h2>{section.title}</h2>
              <span>{section.items.length}</span>
            </div>
            <div className="index-grid">
              {section.items.map((tool: Tool) => {
                const Icon = iconForTool(tool);
                return (
                  <a className="index-row" key={tool.id} href={tool.route}>
                    <Icon size={14} aria-hidden="true" />
                    <span className="index-row-name">{tool.name}</span>
                    {tool.isNew ? <span className="index-new">NEW</span> : null}
                    <span className="index-row-desc">{tool.description}</span>
                  </a>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
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
            <a
              href="#dashboard"
              aria-current={activeNavIndex === 0 ? "page" : undefined}
              className={`rounded-full px-3 py-2 text-sm no-underline transition hover:bg-[var(--paper-soft)] ${activeNavIndex === 0 ? "font-bold text-[var(--ink)] underline decoration-2 underline-offset-8" : "font-semibold text-neutral-500 hover:text-[var(--ink)]"}`}
            >
              Dashboard
            </a>
            <ToolsMenu items={primaryNavItems.slice(1)} active={activeNavIndex > 0} activeIndex={activeNavIndex - 1} />
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

/** Desktop "Tools" dropdown: the eight category links, collapsed out of the top
 * bar so the header reads product-grade instead of sitemap. Accessible: real
 * button with aria-expanded/haspopup, Escape and outside-click close, closes on
 * route change (each item is a plain <a>). */
function ToolsMenu({ items, active, activeIndex }: { items: { id: string; label: string; href: string }[]; active: boolean; activeIndex: number }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onHash = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("hashchange", onHash);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("hashchange", onHash);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`flex items-center gap-1 rounded-full px-3 py-2 text-sm transition hover:bg-[var(--paper-soft)] ${active ? "font-bold text-[var(--ink)] underline decoration-2 underline-offset-8" : "font-semibold text-neutral-500 hover:text-[var(--ink)]"}`}
      >
        Tools <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? (
        <div role="menu" aria-label="Tool categories" className="tools-menu">
          {items.map((item, index) => (
            <a
              key={item.id}
              role="menuitem"
              href={item.href}
              aria-current={active && index === activeIndex ? "page" : undefined}
              className={`tools-menu-item ${active && index === activeIndex ? "tools-menu-item-active" : ""}`}
            >
              {item.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
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
      <span className="hidden text-sm font-bold xl:inline">{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}

function Dashboard() {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState(() => readSessionValue("myfilekit:lastSearch"));
  const [recentTools, setRecentTools] = useState<Tool[]>(() => loadRecentTools());
  const matches = useMemo(() => filterTools(query), [query]);
  const isSearching = Boolean(query.trim());
  const popularTools = (popularToolIds.map(findToolById).filter(Boolean) as Tool[]).filter((tool) => !tool.isNew);
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
                  <p className="app-badge mx-auto w-fit text-xs font-bold uppercase">Local-first file toolkit</p>
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
            <span className="block text-sm font-bold">{label}</span>
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
          <a className="moss-text text-sm font-bold no-underline" href={categoryRoute(title)}>
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
          {tool.isNew && <span className="new-badge rounded-full px-2.5 py-1 text-[11px] font-bold uppercase">New</span>}
          <span className="tag-badge category-badge rounded-full px-2.5 py-1 text-[11px] font-bold uppercase">{primaryBadge}</span>
          {!compact && visibleBadges.map((badge: string) => <span key={badge} className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-bold uppercase">{badge}</span>)}
          {!compact && multiFile && <span className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-bold uppercase">{multiFile}</span>}
          {!compact && fileTypeLabel(tool) && <span className="tag-badge rounded-full px-2.5 py-1 text-[11px] font-bold uppercase">{fileTypeLabel(tool)}</span>}
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
            <p className="text-sm font-bold text-neutral-500">
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

// Tools whose input is a place on the page, so the page itself becomes the
// control: drag an area to redact, click a point to place text.
const SELECT_MODE_BY_TOOL: Record<string, "rect" | "point"> = {
  "redact-pdf-tool": "rect",
  "add-text-to-pdf-tool": "point",
};

function ToolPage({ tool }: { tool: Tool }) {
  const related = tools.filter((item: Tool) => item.category === tool.category && item.id !== tool.id);
  const Icon = iconForTool(tool);
  // The PDF currently loaded in this tool, published by FileControl. Keyed by
  // the control that owns it so a second file input cannot clear the first.
  const [docs, setDocs] = useState<Record<string, File>>({});
  // Areas drawn on the page. Published by the tool from its OWN coordinate list,
  // so the preview always matches what will actually be applied — an
  // append-only echo silently diverged from it (and could never be undone).
  const [regions, setRegions] = useState<{ page: number; x: number; y: number; w: number; h: number }[]>([]);
  const activeFile = Object.values(docs)[0] || null;

  useEffect(() => {
    saveRecentTool(tool.id);
  }, [tool.id]);

  // Tool change starts a clean document context.
  useEffect(() => { setDocs({}); setRegions([]); }, [tool.id]);

  useEffect(() => {
    const onAreas = (event: Event) => {
      const d = (event as CustomEvent<{ areas: { page: number; x: number; y: number; w: number; h: number }[] }>).detail;
      setRegions(Array.isArray(d?.areas) ? d.areas : []);
    };
    window.addEventListener("myfilekit:marked-areas", onAreas);
    return () => window.removeEventListener("myfilekit:marked-areas", onAreas);
  }, []);

  // A different document starts with a clean page: stale marks must never be
  // shown over, or applied to, a file they were not drawn on.
  useEffect(() => { setRegions([]); }, [activeFile]);

  useEffect(() => {
    const onActive = (event: Event) => {
      const detail = (event as CustomEvent<{ source: string; file: File | null }>).detail;
      if (!detail?.source) return;
      setDocs((current) => {
        if (detail.file) return { ...current, [detail.source]: detail.file };
        if (!(detail.source in current)) return current;
        const next = { ...current };
        delete next[detail.source];
        return next;
      });
    };
    window.addEventListener("myfilekit:active-file", onActive);
    return () => window.removeEventListener("myfilekit:active-file", onActive);
  }, []);

  return (
    <>
      <div className="doc-bar">
        <Icon size={15} aria-hidden="true" />
        <h1>{tool.name}</h1>
        <span className="doc-bar-sep" aria-hidden="true" />
        <span className="doc-bar-meta">{tool.category.replace(" Tools", "")}{fileTypeLabel(tool) ? ` · ${fileTypeLabel(tool)}` : ""}{multiFileLabel(tool) ? ` · ${multiFileLabel(tool)}` : ""}</span>
        <span className="doc-bar-actions">
          <a className="secondary-button" href={categoryRoute(tool.category)}>{tool.category.replace(" Tools", "")}</a>
        </span>
      </div>
      <div className={`tool-shell ${activeFile ? "tool-shell-doc" : ""}`}>
        <div className="tool-canvas">
          <p className="doc-bar-meta" style={{ marginBottom: 12 }}>{tool.description}</p>
          {/* Keyed by tool id: several tools share one renderer (Split/Delete Pages
              both render PageRangeTool), and without a key React keeps the same
              instance across the route change — the previous tool's files, page
              ranges and result would carry over into the next tool. */}
          <ToolRenderer key={tool.id} tool={tool} />
        </div>
        {activeFile ? (
          <section className="tool-document" aria-label={`Preview of ${activeFile.name}`}>
            <DocumentView file={activeFile} selectMode={SELECT_MODE_BY_TOOL[tool.id] || null} regions={regions} />
          </section>
        ) : null}
        <aside className="tool-inspector" aria-label="Related tools">
          <p className="inspector-title">More in {tool.category.replace(" Tools", "")}</p>
          {related.slice(0, 14).map((item: Tool) => {
            const RelatedIcon = iconForTool(item);
            return (
              <a className="index-row" key={item.id} href={item.route}>
                <RelatedIcon size={13} aria-hidden="true" />
                <span className="index-row-name">{item.name}</span>
                {item.isNew ? <span className="index-new">NEW</span> : null}
              </a>
            );
          })}
        </aside>
      </div>
    </>
  );
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
          <p className="moss-text text-xs font-bold uppercase">{eyebrow}</p>
          <h1 className="font-display page-title font-black">{title}</h1>
          <p className="mt-2 max-w-3xl font-semibold leading-7 text-neutral-600">{subtitle}</p>
          {badges.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {badges.map((badge) => (
                <span key={badge} className="tag-badge rounded-full px-3 py-1 text-xs font-bold uppercase">{badge}</span>
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

const toolModules = {
  "pdf": lazy(() => import("./tools/pdf")),
  "security": lazy(() => import("./tools/security")),
  "text-data": lazy(() => import("./tools/text-data")),
  "image": lazy(() => import("./tools/image")),
  "signature": lazy(() => import("./tools/signature")),
  "business": lazy(() => import("./tools/business")),
  "developer": lazy(() => import("./tools/developer")),
  "sharing": lazy(() => import("./tools/sharing")),
};

const toolModuleById: Record<string, keyof typeof toolModules> = {
  "invoice-generator-tool": "business",
  "gst-invoice-tool": "business",
  "pos-billing-tool": "business",
  "gst-filing-prep-tool": "business",
  "workflow-builder-tool": "pdf",
  "batch-process-tool": "pdf",
  "batch-workflow-tool": "pdf",
  "smart-split-pdf-tool": "pdf",
  "bates-numbering-tool": "pdf",
  "impose-pdf-tool": "pdf",
  "bookmarks-editor-tool": "pdf",
  "create-form-tool": "pdf",
  "compare-pdf-tool": "pdf",
  "deskew-pdf-tool": "pdf",
  "pdfa-prep-tool": "pdf",
  "accessibility-check-tool": "pdf",
  "tag-pdf-tool": "pdf",
  "merge-pdf-tool": "pdf",
  "split-pdf-tool": "pdf",
  "delete-pdf-pages-tool": "pdf",
  "rotate-pdf-tool": "pdf",
  "add-text-to-pdf-tool": "pdf",
  "edit-pdf-text-tool": "pdf",
  "reflow-pdf-tool": "pdf",
  "add-signature-to-pdf-tool": "pdf",
  "annotate-pdf-tool": "pdf",
  "pdf-page-numbers-tool": "pdf",
  "watermark-pdf-tool": "pdf",
  "pdf-metadata-cleaner-tool": "security",
  "pdf-to-image-tool": "pdf",
  "extract-text-tool": "text-data",
  "summarize-pdf-tool": "text-data",
  "chat-with-pdf-tool": "text-data",
  "translate-pdf-tool": "text-data",
  "compress-pdf-tool": "pdf",
  "pdf-to-zip-tool": "pdf",
  "flatten-pdf-tool": "pdf",
  "invert-pdf-tool": "pdf",
  "images-to-pdf-tool": "pdf",
  "organize-pages-tool": "pdf",
  "crop-resize-pdf-tool": "pdf",
  "headers-footers-tool": "pdf",
  "fill-pdf-form-tool": "pdf",
  "redact-pdf-tool": "pdf",
  "auto-redact-pii-tool": "security",
  "privacy-scanner-tool": "security",
  "pdf-analyzer-tool": "security",
  "sanitize-pdf-tool": "security",
  "extract-images-tool": "pdf",
  "create-pdf-tool": "pdf",
  "repair-pdf-tool": "pdf",
  "fingerprint-pdf-tool": "security",
  "encrypt-pdf-tool": "security",
  "remove-password-tool": "security",
  "unlock-pdf-tool": "security",
  "sign-pdf-tool": "security",
  "verify-signature-tool": "security",
  "request-signature-tool": "security",
  "compress-image-tool": "image",
  "convert-image-tool": "image",
  "batch-compress-images-tool": "image",
  "batch-resize-images-tool": "image",
  "resize-image-tool": "image",
  "crop-image-tool": "image",
  "rotate-flip-image-tool": "image",
  "add-text-to-image-tool": "image",
  "image-metadata-inspector-tool": "image",
  "add-signature-to-image-tool": "signature",
  "draw-signature-tool": "signature",
  "type-signature-tool": "signature",
  "text-to-pdf-tool": "text-data",
  "markdown-preview-tool": "text-data",
  "markdown-to-pdf-tool": "text-data",
  "csv-to-pdf-tool": "text-data",
  "html-to-pdf-tool": "pdf",
  "word-to-pdf-tool": "pdf",
  "excel-to-pdf-tool": "pdf",
  "powerpoint-to-pdf-tool": "pdf",
  "ebook-to-pdf-tool": "pdf",
  "pdf-to-word-tool": "pdf",
  "pdf-to-excel-tool": "pdf",
  "pdf-to-html-tool": "pdf",
  "pdf-to-epub-tool": "pdf",
  "ocr-pdf-tool": "pdf",
  "pdf-to-audio-tool": "pdf",
  "audio-to-pdf-tool": "text-data",
  "equation-to-image-tool": "image",
  "handwriting-to-pdf-tool": "pdf",
  "scan-to-pdf-tool": "pdf",
  "json-formatter-tool": "text-data",
  "csv-to-json-tool": "text-data",
  "json-to-csv-tool": "text-data",
  "json-to-yaml-tool": "text-data",
  "url-codec-tool": "text-data",
  "diff-checker-tool": "text-data",
  "word-counter-tool": "text-data",
  "metadata-cleaner": "security",
  "api-playground-tool": "developer",
  "base64-tool": "developer",
  "file-hash-tool": "developer",
  "hash-compare-tool": "developer",
  "password-generator-tool": "developer",
  "qr-code-generator-tool": "developer",
  "p2p-share-tool": "sharing",
  "collab-whiteboard-tool": "sharing",
};

function ToolRenderer({ tool }: { tool: Tool }) {
  // Declared before the lazy module mounts, so its FileControl can adopt a file
  // staged for this tool whether we are on a tool route or inside the editor.
  setActiveTool(tool.id);
  const moduleId = toolModuleById[tool.id];
  if (!moduleId) return <StatusBox status={{ tone: "error", message: "This tool renderer is missing." }} />;
  const ToolModule = toolModules[moduleId];
  return (
    // Its own boundary: a tool chunk that fails to load (typically an old page
    // held across a redeploy) must break this pane only, not replace the whole
    // shell — nav, search and all — with the app-level error page.
    <ErrorBoundary
      key={tool.id}
      fallback={
        <div className="grid min-h-40 place-items-center gap-3 text-center">
          <p role="alert" className="text-sm font-bold text-[var(--foreground)]">This tool could not be loaded.</p>
          <p className="text-xs text-[var(--stone)]">If the app was updated while this page was open, reloading will fix it.</p>
          <button type="button" className="secondary-button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      }
    >
      <Suspense fallback={<div className="grid min-h-40 place-items-center"><p role="status" aria-live="polite" className="text-sm font-bold text-[var(--stone)]">Loading tool…</p></div>}>
        <ToolModule tool={tool} />
      </Suspense>
    </ErrorBoundary>
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

// Per-tool icon overrides so common tools don't collapse onto one category glyph
// (e.g. four PDF tools all showing FileText). Keyed by id; checked before the
// category fallback below.
const toolIconOverrides: Record<string, typeof FileText> = {
  "sign-pdf-tool": FileSignature,
  "verify-signature-tool": FileCheck,
  "merge-pdf-tool": Combine,
  "edit-pdf-text-tool": Pencil,
  "accessibility-check-tool": Accessibility,
  "tag-pdf-tool": Tags,
  "auto-redact-pii-tool": EyeOff,
  "pdf-analyzer-tool": ScanSearch,
  "translate-pdf-tool": Languages,
};

function iconForTool(tool: Tool) {
  if (toolIconOverrides[tool.id]) return toolIconOverrides[tool.id];
  if (tool.id.includes("rotate")) return RotateCw;
  if (tool.id.includes("crop") || tool.id.includes("split")) return Scissors;
  if (tool.id.includes("hash")) return Hash;
  if (tool.category === "PDF Tools") return FileText;
  if (tool.category === "Image Tools") return Image;
  if (tool.category === "Business Tools") return ReceiptText;
  if (tool.category === "Signature Tools") return PenLine;
  if (tool.category === "Security & Privacy") return ShieldCheck;
  if (tool.category === "Sharing & Collaboration") return Share2;
  if (tool.category === "Text & Data Tools") return FileText;
  if (tool.category === "Developer Utilities") return Hash;
  return Sparkles;
}

