import { useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { Accessibility, ArrowLeft, ArrowRight, ChevronDown, ChevronRight, Combine, FileArchive, FileCheck, FileSignature, FileText, FolderSearch, Hash, EyeOff, Image, Languages, Layers3, LayoutDashboard, Moon, PenLine, Pencil, ReceiptText, RotateCw, ScanSearch, Scissors, Search, Share2, ShieldCheck, Sparkles, Tags, Menu, Sun, Upload, X, Zap } from "lucide-react";
import { categories, categoryGroups, tools } from "./registry/tools.registry.js";
import { stashWorkspaceFiles, clearWorkspaceFilesUnless, setActiveTool } from "./lib/workspace-handoff";
import { ErrorBoundary } from "./components/ErrorBoundary";
import LandingPage from "./components/LandingPage";
import EditorPage, { editorKindFor } from "./components/EditorPage";
import DocumentView from "./components/DocumentView";
import { categoryRoute, routeForHash, SELECT_MODE_BY_TOOL } from "./lib/routing";
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

const categoryDetails: Record<string, { description: string; accent: string; related?: string[] }> = {
  "PDF Tools": { description: "Merge, split, rotate, and create PDFs in your browser.", accent: "PDF" },
  "Image Tools": { description: "Compress, resize, convert, crop, and rotate everyday images.", accent: "Image" },
  "Business Tools": { description: "Invoices, Indian GST tax invoices, counter billing, and GSTR-1 filing prep.", accent: "Business" },
  "Signature Tools": {
    description: "Draw or type signatures and export them as PNG files.",
    accent: "Signature",
    related: ["add-signature-to-pdf-tool", "sign-pdf-tool", "verify-signature-tool", "request-signature-tool"],
  },
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

/**
 * Where a bare URL lands.
 *
 * This was hard-coded to "#dashboard", overriding the router's own "#home", so
 * a first-time visitor never saw the landing page at all — the headline, the
 * reason this exists instead of an upload site, the whole argument — and it was
 * reachable only by clicking a sidebar link nobody had a reason to click.
 *
 * Someone who has already used a tool knows what this is and wants the
 * workspace, so recentTools is the signal: no new storage key, and it cannot
 * mark a bouncing first-time visitor as a returning one.
 */
function initialHash(): string {
  if (window.location.hash) return window.location.hash;
  try {
    return loadRecentTools().length ? "#dashboard" : "#home";
  } catch {
    // Storage unavailable (private mode). Show the pitch — the safer default.
    return "#home";
  }
}

export default function App() {
  const [hash, setHash] = useState(initialHash);
  const [theme, setTheme] = useState<ThemeMode>(() => readThemePreference());
  const isInitialRoute = useRef(true);

  useEffect(() => {
    const syncHash = () => {
      const next = window.location.hash || initialHash();
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
      <a className="menubar-brand" href="#home" aria-label="MyFileKit — home">MyFileKit</a>
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
      {/* Same rule as the tool panel's badge: the blanket claim is only printed
          where it holds. NETWORK_NOTES is the one list of tools that touch the
          network, so the sidebar, the status bar and the badge cannot drift. */}
      <p className="sidebar-foot">
        {NETWORK_NOTES[activeToolId] ? "This tool sends data off your device." : "Files are processed here, never uploaded."}
      </p>
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
  const relatedElsewhere = (category ? categoryDetails[category]?.related || [] : [])
    .map(findToolById)
    .filter(Boolean) as Tool[];

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
        {relatedElsewhere.length ? (
          <section className="index-section">
            <div className="index-head">
              <h2>Related tools in other categories</h2>
              <span>{relatedElsewhere.length}</span>
            </div>
            <div className="index-grid">
              {relatedElsewhere.map((tool: Tool) => {
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
        ) : null}
      </div>
    </>
  );
}


/**
 * Preview for an image being worked on. Its own component so the object URL is
 * created and revoked with the element rather than leaking on every file change.
 */
function ImageStage({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  if (!url) return null;
  return <div className="editor-image-stage"><img src={url} alt={`Preview of ${file.name}`} /></div>;
}

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
  // The result wins over the input when there is one: after a tool runs, the
  // page shows what the tool produced. Cleared as soon as a new file is chosen.
  const activeFile = docs.__result || Object.values(docs).find(Boolean) || null;
  // Does this tool take a file at all? Text-only tools (JSON formatter, password
  // generator) have nothing to preview and keep the single column.
  const previewable = (() => {
    // The registry's `file` shape varies by tool (some declare only maxSize), so
    // read it defensively rather than asserting a type it does not always have.
    const spec = tool.file as { extensions?: string[] } | undefined;
    const exts = Array.isArray(spec?.extensions) ? spec.extensions : [];
    return exts.some((ext) => ["pdf", "jpg", "jpeg", "png", "webp"].includes(String(ext).toLowerCase()));
  })();

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
        // Any change to the chosen file invalidates a previous result: the pane
        // must never show document A's output beside document B's name.
        const next = { ...current };
        delete next.__result;
        if (detail.file) next[detail.source] = detail.file;
        else delete next[detail.source];
        return next;
      });
    };
    window.addEventListener("myfilekit:active-file", onActive);
    return () => window.removeEventListener("myfilekit:active-file", onActive);
  }, []);

  /**
   * Show the tool's OUTPUT in the preview pane.
   *
   * The pane rendered whatever FileControl published, which is always the input
   * and is never republished. So applying a watermark left the largest surface
   * on screen showing the un-watermarked original, next to a card reading
   * "Done — ready to save". A preview that silently shows the wrong document is
   * worse than no preview: it reads as "the tool did nothing".
   */
  useEffect(() => {
    const onReady = (event: Event) => {
      const d = (event as CustomEvent<{ filename: string; blob?: Blob }>).detail;
      if (!d?.blob || !/\.pdf$/i.test(d.filename || "")) return;
      setDocs((current) => ({ ...current, __result: new File([d.blob!], d.filename, { type: "application/pdf" }) }));
    };
    window.addEventListener("myfilekit:download-ready", onReady);
    return () => window.removeEventListener("myfilekit:download-ready", onReady);
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
      {/*
        The two-column class and the document pane must agree. They did not: the
        class applied on `activeFile || previewable` while the pane below renders
        only when `previewable`. A text-only tool that EMITS a pdf sets
        activeFile from its result, so ~15 tools (Text to PDF, Markdown to PDF,
        CSV to PDF, the invoice tools…) collapsed to a 380px column beside 654px
        of nothing the moment they succeeded. My change; caught by the
        architecture review, not by me.
      */}
      <div className={`tool-shell ${previewable ? "tool-shell-doc" : ""}`}>
        <div className="tool-canvas">
          <p className="doc-bar-meta" style={{ marginBottom: 12 }}>{tool.description}</p>
          {/* Keyed by tool id: several tools share one renderer (Split/Delete Pages
              both render PageRangeTool), and without a key React keeps the same
              instance across the route change — the previous tool's files, page
              ranges and result would carry over into the next tool. */}
          <ToolRenderer key={tool.id} tool={tool} />
        </div>
        {/*
          The document pane is present from the moment you open a file-taking
          tool, not conjured once a file lands. A layout that rearranges itself
          mid-task reads as unfinished, and an empty canvas states the shape of
          the work: settings on the left, your document on the right.
        */}
        {previewable ? (
          <section className="tool-document" aria-label={activeFile ? `Preview of ${activeFile.name}` : "Document preview"}>
            {!activeFile ? (
              <div className="doc-view doc-view-empty">
                <p className="doc-empty-title">Your document appears here</p>
                <p className="doc-empty-hint">Choose a file on the left to see it.</p>
              </div>
            ) : editorKindFor(activeFile.name) === "image" ? (
              // DocumentView renders PDF pages only, so an image needs its own
              // stage — the same one the editor uses.
              <ImageStage file={activeFile} />
            ) : (
              <DocumentView file={activeFile} selectMode={SELECT_MODE_BY_TOOL[tool.id] || null} regions={regions} />
            )}
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
  "remove-blank-pages-tool": "pdf",
  "remove-pdf-images-tool": "pdf",
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

