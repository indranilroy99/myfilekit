import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, Image as ImageIcon, RotateCcw, X } from "lucide-react";
import { tools, categoryGroups } from "../registry/tools.registry.js";
import { takeWorkspaceFilesFor, stashWorkspaceFiles } from "../lib/workspace-handoff";
import { SELECT_MODE_BY_TOOL, PAGE_SURFACE_TOOLS } from "../lib/routing";
import { formatBytes } from "../utils/format.js";
import DocumentView from "./DocumentView";

/**
 * The editor: one document stays open while tools act on it.
 *
 * The difference from the per-tool routes is continuity — you open a file once,
 * pick tools from the rail, and the result of one tool can become the input to
 * the next. Every tool component is reused verbatim (they are proven and
 * tested); the editor supplies the document and the surrounding chrome.
 */
type Tool = (typeof tools)[number];

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/** Which editor a file belongs in, from what the registry says tools accept. */
export function editorKindFor(filename: string): "pdf" | "image" | "data" | "none" {
  const ext = extensionOf(filename);
  if (ext === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  if (["csv", "xls", "xlsx", "doc", "docx", "pptx", "epub"].includes(ext)) return "data";
  return "none";
}

/** Tools that declare support for this file's extension, in registry order. */
function toolsForFile(filename: string): Tool[] {
  const ext = extensionOf(filename);
  if (!ext) return [];
  return tools.filter((tool: Tool) => {
    const file = tool.file as { extensions?: string[]; anyType?: boolean } | undefined;
    if (file?.anyType) return true;
    return Boolean(file?.extensions?.some((item: string) => item.toLowerCase() === ext));
  });
}

/** Group the rail the way the registry groups a category, so it is scannable. */
function groupTools(list: Tool[]): { title: string; items: Tool[] }[] {
  const out: { title: string; items: Tool[] }[] = [];
  const seen = new Set<string>();
  for (const tool of list) {
    const groups = (categoryGroups as Record<string, string[]>)[tool.category];
    const title = groups && tool.group ? tool.group : tool.category.replace(" Tools", "");
    if (!seen.has(title)) { seen.add(title); out.push({ title, items: [] }); }
    out.find((section) => section.title === title)!.items.push(tool);
  }
  return out;
}

export function EditorPage({ renderTool }: { renderTool: (tool: Tool) => React.ReactNode }) {
  const [file, setFile] = useState<File | null>(null);
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const [result, setResult] = useState<{ name: string; size: number; url: string; blob?: Blob } | null>(null);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [original, setOriginal] = useState<File | null>(null);
  // Areas drawn on the page, published by the tool from its OWN coordinate list
  // so what is shown is always what will be applied.
  const [regions, setRegions] = useState<{ page: number; x: number; y: number; w: number; h: number }[]>([]);
  const openedRef = useRef(false);
  // The download-ready listener is registered once, so it must not read `file`
  // or `kind` from its own closure — it would see the values from first mount.
  // This project has already shipped two stale-closure bugs; refs here.
  const fileRef = useRef<File | null>(null);
  const toolRef = useRef<Tool | null>(null);

  // The file handed over from Home or the Workspace.
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    // Staged for "editor" by the landing page or the workspace.
    const handed = takeWorkspaceFilesFor("editor");
    if (handed.length) setFile(handed[0]);
  }, []);

  const kind = file ? editorKindFor(file.name) : "none";
  // Tools that ARE a page surface; their own canvas is the document view.
  const ownsThePage = Boolean(activeTool && PAGE_SURFACE_TOOLS.has(activeTool.id));
  fileRef.current = file;
  toolRef.current = activeTool;
  const available = useMemo(() => (file ? toolsForFile(file.name) : []), [file]);
  const sections = useMemo(() => groupTools(available), [available]);

  // Preview for image documents; PDFs go through DocumentView.
  useEffect(() => {
    if (!file || kind !== "image") { setImageUrl(""); return undefined; }
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, kind]);

  /**
   * Hand the working document to a tool as it is selected, so its own file
   * input picks it up instead of asking the user to choose the file again.
   *
   * Staged synchronously here rather than in an effect: child effects run
   * BEFORE parent effects, so once a tool's lazy chunk is cached its file
   * control mounted and looked for a hand-off that had not been staged yet.
   * (It worked only for the first tool, where Suspense delayed the mount.)
   */
  const selectTool = (tool: Tool) => {
    if (file) stashWorkspaceFiles([file], tool.id);
    setActiveTool(tool);
    setResult(null);
  };

  /**
   * A tool finished. Show the result in the canvas straight away.
   *
   * It used to sit in a download card while the canvas kept rendering the
   * input, so applying a watermark changed nothing on screen: the only way to
   * see your own edit was to download it and open it elsewhere, or to click
   * "Keep editing this result", which also closed the tool you were using. In a
   * document editor the document should show the edit.
   *
   * Only adopted when the output is the same kind of document as the input — a
   * PDF that became a ZIP of images has nothing to show in a PDF canvas, so
   * that case still just offers the download.
   */
  useEffect(() => {
    const onReady = (event: Event) => {
      const d = (event as CustomEvent<{ filename: string; size: number; url: string; blob?: Blob }>).detail;
      if (!d?.url) return;
      setResult({ name: d.filename, size: d.size, url: d.url, blob: d.blob });

      const current = fileRef.current;
      const sameKind = current && d.blob && editorKindFor(d.filename) === editorKindFor(current.name)
        && editorKindFor(d.filename) !== "none";
      if (!sameKind || !d.blob) return;
      setOriginal((previous) => previous || current);
      const next = new File([d.blob], d.filename, { type: d.blob.type || current.type });
      setFile(next);
      // Hand the new document straight back to the tool still on screen, so a
      // second run builds on the first instead of re-processing the original.
      const tool = toolRef.current;
      if (tool) stashWorkspaceFiles([next], tool.id);
    };
    window.addEventListener("myfilekit:download-ready", onReady);
    return () => window.removeEventListener("myfilekit:download-ready", onReady);
  }, []);

  /** Save the document currently open, edits included. */
  const downloadCurrent = () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    // Revoked on a turn of the event loop: revoking synchronously can cancel the
    // download in some browsers before it has read the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  useEffect(() => {
    const onAreas = (event: Event) => {
      const d = (event as CustomEvent<{ areas: { page: number; x: number; y: number; w: number; h: number }[] }>).detail;
      setRegions(Array.isArray(d?.areas) ? d.areas : []);
    };
    window.addEventListener("myfilekit:marked-areas", onAreas);
    return () => window.removeEventListener("myfilekit:marked-areas", onAreas);
  }, []);

  // A different document, or a different tool, starts with a clean page: marks
  // must never be shown over — or applied to — something they were not drawn on.
  useEffect(() => { setRegions([]); }, [file, activeTool]);

  const revertToOriginal = () => {
    if (!original) return;
    setFile(original);
    setOriginal(null);
    setResult(null);
  };


  const openFile = (list: FileList | null) => {
    const picked = list && list[0];
    if (picked) { setFile(picked); setActiveTool(null); setResult(null); setOriginal(null); }
  };

  if (!file) {
    return (
      <>
        <div className="doc-bar"><h1>Editor</h1></div>
        <div className="editor-empty">
          <label className="workspace-drop">
            <input className="sr-only" type="file" aria-label="Open a file to edit" onChange={(event) => openFile(event.target.files)} />
            <span className="dropzone-tile" aria-hidden="true"><FileText size={22} /></span>
            <span className="workspace-drop-title">Open a file to edit</span>
            <span className="dropzone-hint">PDF · images · documents</span>
            <span className="dropzone-cta">Choose a file</span>
          </label>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="doc-bar">
        {kind === "image" ? <ImageIcon size={15} aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />}
        <h1>{file.name}</h1>
        <span className="doc-bar-sep" aria-hidden="true" />
        <span className="doc-bar-meta">{formatBytes(file.size)} · {available.length} tools available</span>
        {original ? <span className="doc-bar-edited">Edited — showing the result</span> : null}
        <span className="doc-bar-actions">
          {/* Save whatever is on screen, at any point — including after an edit,
              without hunting for the tool's own result card. */}
          {/* Saves the open document. A tool's own output is downloaded from its
              result card, which names the file it produced. */}
          <button type="button" className="secondary-button" onClick={downloadCurrent}>
            <Download size={15} aria-hidden="true" /> Save document
          </button>
          {original ? <button type="button" className="secondary-button" onClick={revertToOriginal}>
            <RotateCcw size={15} aria-hidden="true" /> Revert to original
          </button> : null}
          {activeTool ? <button type="button" className="secondary-button" onClick={() => setActiveTool(null)}>Close tool</button> : null}
          <button type="button" className="secondary-button" onClick={() => { setFile(null); setActiveTool(null); setResult(null); setOriginal(null); }}>
            <X size={15} aria-hidden="true" /> Close file
          </button>
        </span>
      </div>

      {/*
        No tool open means no options to show, so the column is not drawn at all
        and the document takes the width. It was spending 360px on three facts —
        name, size and type — that the doc bar directly above already states,
        while the page beside it was cropped.
      */}
      <div className={`editor-shell ${activeTool ? "" : "editor-shell-wide"} ${ownsThePage ? "editor-shell-page-tool" : ""}`}>
        {activeTool ? (
          <section
            className={`editor-panel ${ownsThePage ? "editor-panel-page" : ""}`}
            aria-label={ownsThePage ? `${activeTool.name}` : `${activeTool.name} options`}
          >
            <p className="inspector-title">{activeTool.name}</p>
            <p className="doc-bar-meta" style={{ marginBottom: 10 }}>{activeTool.description}</p>
            {renderTool(activeTool)}
          </section>
        ) : null}

        {ownsThePage ? null : (
        <section className="editor-canvas" aria-label="Document preview">
          {/*
            The editor was strictly WORSE at direct manipulation than the
            individual tool pages: those pass selectMode and regions so you can
            drag a redaction box on the page, and this one passed neither. Same
            map, same round-trip, so Redact and Add Text behave here as they do
            there.
          */}
          {/*
            A tool that draws its own interactive page replaces the preview
            rather than sitting beside it. Edit PDF Text, Annotate and Reflow
            each render a real page with click targets, pointer handling and
            undo — and they were doing it inside a 360px options column, showing
            a fraction of the page through a porthole, while an inert copy of
            the SAME page occupied the middle of the screen. Two previews, and
            the one you could actually use was the small one.
          */}
          {kind === "pdf" && !ownsThePage ? (
            <DocumentView
              file={file}
              selectMode={activeTool ? SELECT_MODE_BY_TOOL[activeTool.id] || null : null}
              regions={regions}
            />
          ) : null}
          {kind === "image" && imageUrl ? (
            <div className="editor-image-stage"><img src={imageUrl} alt={`Preview of ${file.name}`} /></div>
          ) : null}
          {kind !== "pdf" && kind !== "image" ? (
            <div className="doc-view doc-view-empty">
              <p className="doc-empty-title">No preview for this file type</p>
              <p className="doc-empty-hint">The tools on the right still work on it.</p>
            </div>
          ) : null}
        </section>
        )}

        <aside className="editor-rail" aria-label="Tools for this file">
          <p className="inspector-title">Tools</p>
          {sections.length === 0 ? <p className="doc-bar-meta">No tool declares support for this file type.</p> : null}
          {sections.map((section) => (
            <div key={section.title}>
              <p className="sidebar-group">{section.title}</p>
              {section.items.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  className={`editor-tool ${activeTool?.id === tool.id ? "editor-tool-active" : ""}`}
                  aria-pressed={activeTool?.id === tool.id}
                  onClick={() => selectTool(tool)}
                >
                  {/* No NEW badge here. Eight of them down one 232px rail is
                      not news, it is noise — and it competes with the document
                      for attention while you are trying to work on it. The
                      badge still appears where tools are browsed. */}
                  {tool.name}
                </button>
              ))}
            </div>
          ))}
        </aside>
      </div>
    </>
  );
}

export default EditorPage;
