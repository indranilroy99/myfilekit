// Shared tool primitives: form chrome, inputs, buttons and small helpers used by
// more than one tool module (and by the app shell). Kept free of tool-specific
// logic so it stays small — this module loads with the entry chunk.
import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Download, GripVertical, Eye, Printer, Radio, ShieldCheck, Loader2, Upload, X, Zap } from "lucide-react";
import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { tools } from "../registry/tools.registry.js";
import { formatBytes } from "../utils/format.js";
import { revokeDownloadUrl } from "../services/download.service.js";
import { takeWorkspaceFilesForActive } from "../lib/workspace-handoff";

type Tool = (typeof tools)[number];
type Status = { tone: "idle" | "success" | "error"; message: string; progress?: { value: number; total: number; label: string } };
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

function ToolMetaPanel({ status, onReset, children, sends }: { status: Status; onReset: () => void; children?: React.ReactNode; sends?: string }) {
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

    // A new file selection invalidates the previous result. Without this the
    // card survived the change: run Redact, pick a different PDF, and the panel
    // still offered "Done — ready to save" with the FIRST document's filename
    // and a live Download button — one click from saving the wrong document's
    // redaction. Thirteen tools hand-rolled a per-file reset of their own state
    // and none could reach this card, because it is private to this component.
    const handleFileChange = () => {
      setDownloadReady((current) => {
        if (current?.url) revokeDownloadUrl(current.url);
        return null;
      });
    };

    window.addEventListener("myfilekit:download-ready", handleDownloadReady);
    window.addEventListener("myfilekit:active-file", handleFileChange);
    return () => {
      window.removeEventListener("myfilekit:download-ready", handleDownloadReady);
      window.removeEventListener("myfilekit:active-file", handleFileChange);
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

  // Calm by default: the shouty "STATUS / Ready." box only appears when there is
  // something to say — an error, active work, or a success with no download card.
  const isIdle = status.tone === "idle" && status.message === "Ready." && !status.progress;
  const showStatusBox = !isIdle && !(status.tone === "success" && downloadReady);
  const hasState = !isIdle || Boolean(downloadReady);

  // Hiding the box on success cost real information. Tools write their findings
  // into the success message — "Output: 1200x1600", "Note: the output is not
  // smaller than the original", "Cropped to 1x1" — and every one of them was
  // computed and then discarded the instant a download card rendered. That is
  // exactly how a wrong result gets reported as a success, and it has already
  // hidden one shipped defect (Compress PDF returning a larger file).
  // The message now rides inside the result card, which keeps the surface calm
  // while putting the detail where the user is already looking.
  const successNote = status.tone === "success" && downloadReady && status.message && status.message !== "Ready."
    ? status.message
    : "";

  return (
    <aside className="tool-form-status">
      {downloadReady ? (
        <div className="result-card" role="status" aria-live="polite">
          <div className="result-card-head">
            <span className="result-card-check" aria-hidden="true"><CheckCircle2 size={18} /></span>
            <span>Done — ready to save</span>
          </div>
          <div>
            <p className="break-words font-semibold text-[var(--foreground)]">{downloadReady.filename}</p>
            <p className="mt-1 text-xs font-semibold text-neutral-500">{formatBytes(downloadReady.size)} · stayed on this device</p>
            {successNote ? <p className="result-card-note">{successNote}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="primary-button no-underline" href={downloadReady.url} download={downloadReady.filename}>
              <Download size={16} /> Download
            </a>
            {canReview ? <a className="secondary-button no-underline" href={downloadReady.url} target="_blank" rel="noopener noreferrer">
              <Eye size={16} /> Preview
            </a> : null}
            {canPrint ? <button className="secondary-button" type="button" onClick={() => printDownloadUrl(downloadReady.url)}>
              <Printer size={16} /> Print
            </button> : null}
            <button className="secondary-button" type="button" onClick={resetPanel}>Start over</button>
          </div>
        </div>
      ) : null}
      {showStatusBox ? (
        <div>
          <StatusBox status={status} />
          {status.progress ? <ProgressBar value={status.progress.value} total={status.progress.total} label={status.progress.label} /> : null}
        </div>
      ) : null}
      {children}
      {/*
        The blanket promise is only printed where it is true. On a tool that
        sends something, the same slot carries what leaves instead — a product
        whose whole pitch is one sentence cannot afford to print that sentence
        above a send button.
      */}
      {downloadReady ? null : sends ? (
        <p className="trust-line trust-line-sends">
          <Radio size={14} aria-hidden="true" />
          <span>{sends}</span>
        </p>
      ) : (
        <p className="trust-line">
          <ShieldCheck size={14} aria-hidden="true" />
          <span>Runs entirely in your browser — your files never leave this device.</span>
        </p>
      )}
      {hasState && !downloadReady ? <SecondaryButton label="Reset" onClick={resetPanel} /> : null}
    </aside>
  );
}

/**
 * `sends` names what this tool puts on the network, for the handful of tools
 * that put anything there at all. Omitted — the case for ~99 of 105 tools — the
 * panel shows the local-only badge.
 *
 * It is a prop rather than a lookup because the claim has to be impossible to
 * get wrong by default: a new networked tool that forgets to pass it is a
 * visible bug in its own file, not a silent false statement inherited from a
 * shared component.
 */
function ToolForm({ children, status, onReset, sends }: { children: React.ReactNode; status: Status; onReset: () => void; sends?: string }) {
  return (
    <div className="tool-form-grid">
      <div className="tool-form-actions">
        {children}
      </div>
      <ToolMetaPanel status={status} onReset={onReset} sends={sends} />
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
      <p className="text-xs font-bold uppercase text-neutral-500">Keep in mind</p>
      <p className="text-[var(--foreground)]">{children}</p>
    </div>
  );
}

/** Short, human hint describing what the dropzone accepts (e.g. "PDF files"). */
function acceptHint(accept: string, multiple: boolean): string {
  const list = accept.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!list.length || list.includes("*/*")) return `Any file${multiple ? "s" : ""}`;
  const names = new Set<string>();
  for (const rule of list) {
    if (rule === "application/pdf") names.add("PDF");
    else if (rule.startsWith("image/")) names.add("images");
    else if (rule.includes("spreadsheet") || rule.includes("excel") || rule === "text/csv") names.add("spreadsheets");
    else if (rule.startsWith("text/")) names.add("text");
    else if (rule.includes("word") || rule.includes("document")) names.add("documents");
    else names.add(rule.split("/").pop() || rule);
  }
  return [...names].join(", ");
}

function FileControl({ accept, multiple = false, files, setFiles, label }: { accept: string; multiple?: boolean; files: File[]; setFiles: (files: File[]) => void; label?: string }) {
  const [isDragging, setIsDragging] = useState(false);
  const controlId = useId();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const heading = label || `Drag & drop ${multiple ? "files" : "a file"} here`;
  const ariaLabel = label || `Choose ${multiple ? "files" : "file"}`;
  const acceptList = accept.split(",").map((item) => item.trim()).filter(Boolean);
  const matchesAccept = (file: File) => {
    if (!acceptList.length || acceptList.includes("*/*")) return true;
    return acceptList.some((rule) => rule === file.type || (rule.endsWith("/*") && file.type.startsWith(rule.slice(0, -1))));
  };
  // Adopt files the user staged on the Workspace *for this tool*, so "drop a
  // file to start" actually starts. Scoped to the tool the user clicked: a
  // hand-off must never load itself into a tool that was merely opened next —
  // several tools accept any file type, including the P2P sender.
  useEffect(() => {
    if (files.length) return;
    const handed = takeWorkspaceFilesForActive().filter(matchesAccept);
    if (handed.length) setFiles(multiple ? handed : handed.slice(0, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ...and again if one is announced later. No dependency array on purpose: the
  // handler must close over the current setFiles and accept list, and this
  // component has already shipped two stale-closure bugs.
  useEffect(() => {
    const onHandoff = () => {
      const handed = takeWorkspaceFilesForActive().filter(matchesAccept);
      if (handed.length) setFiles(multiple ? handed : handed.slice(0, 1));
    };
    window.addEventListener("myfilekit:workspace-file", onHandoff);
    return () => window.removeEventListener("myfilekit:workspace-file", onHandoff);
  });
  // Publish the PDF this control holds so the page can render it beside the
  // form. Tagged with the control's own id: a tool with two file inputs (the
  // PDF and the .p12 in Digital Signature) must not have one clear the other.
  useEffect(() => {
    const first = files[0];
    const isPdf = Boolean(first && (first.type === "application/pdf" || /\.pdf$/i.test(first.name)));
    window.dispatchEvent(new CustomEvent("myfilekit:active-file", {
      detail: { source: controlId, file: isPdf ? first : null },
    }));
  }, [files, controlId]);

  const removeAt = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
    // Keep keyboard focus inside the control after the removed row unmounts.
    requestAnimationFrame(() => wrapRef.current?.querySelector<HTMLElement>("input[type=file]")?.focus());
  };
  // Reorder within the selected list (e.g. page order for Merge). Exposed as
  // keyboard/touch-operable up/down buttons; pointer drag is a progressive
  // enhancement. Chips live outside the <label> so a drag never reaches the
  // dropzone's file-drop.
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || to >= files.length) return;
    const next = files.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setFiles(next);
  };
  return (
    <div className="grid gap-3" ref={wrapRef}>
      {/*
        Once a file is chosen the big drop target is dead space: it repeats an
        affordance the user has already used, and pushes the controls they came
        for below the fold. In the editor, where the panel is a fixed column
        beside the document, it cost roughly a third of the visible options
        area. Collapsed to a single row that still accepts a drop and still
        opens the picker, so replacing the file is one click either way.
      */}
      <label
        className={`dropzone ${files.length ? "dropzone-compact" : ""} ${isDragging ? "dropzone-active" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          const dropped = Array.from(event.dataTransfer.files || []);
          if (!dropped.length) return; // ignore a stray reorder-drag; never clear the selection
          const filtered = dropped.filter(matchesAccept);
          setFiles(filtered.length ? filtered : dropped);
        }}
      >
        <input aria-label={ariaLabel} className="sr-only" type="file" accept={accept} multiple={multiple} onChange={(event) => setFiles(Array.from(event.target.files || []))} />
        {files.length ? (
          <>
            <span className="dropzone-tile" aria-hidden="true"><Upload size={15} /></span>
            <span className="dropzone-title">{multiple ? "Add or replace files" : "Replace file"}</span>
            <span className="dropzone-cta">Browse</span>
          </>
        ) : (
          <>
            <span className="dropzone-tile" aria-hidden="true"><Upload size={22} /></span>
            <span className="dropzone-title">{heading}</span>
            <span className="dropzone-hint">{acceptHint(accept, multiple)}</span>
            <span className="dropzone-cta">Browse files</span>
          </>
        )}
      </label>
      <span className="sr-only" aria-live="polite">{files.length ? `${files.length} file${files.length === 1 ? "" : "s"} selected` : "No files selected"}</span>
      {files.length ? (
        <>
          {multiple && files.length > 1 ? <p className="file-list-hint">Reorder with the arrows (or drag) — this is the output order.</p> : null}
          <ul className="file-list" aria-label="Selected files">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className={`file-chip ${dragIndex === index ? "file-chip-dragging" : ""}`}
                draggable={multiple}
                onDragStart={multiple ? (() => setDragIndex(index)) : undefined}
                onDragOver={multiple ? ((event) => event.preventDefault()) : undefined}
                onDrop={multiple ? ((event) => { event.preventDefault(); if (dragIndex !== null) reorder(dragIndex, index); setDragIndex(null); }) : undefined}
                onDragEnd={multiple ? (() => setDragIndex(null)) : undefined}
              >
                {multiple ? <span className="file-chip-grip" aria-hidden="true"><GripVertical size={15} /></span> : null}
                <span className="file-chip-name" title={file.name}>{file.name}</span>
                <span className="file-chip-size tabular-nums">{formatBytes(file.size)}</span>
                {multiple ? (
                  <span className="file-chip-move">
                    <button type="button" className="icon-button" aria-label={`Move ${file.name} up`} disabled={index === 0} onClick={() => reorder(index, index - 1)}><ChevronUp size={16} /></button>
                    <button type="button" className="icon-button" aria-label={`Move ${file.name} down`} disabled={index === files.length - 1} onClick={() => reorder(index, index + 1)}><ChevronDown size={16} /></button>
                  </span>
                ) : null}
                <button type="button" className="icon-button file-chip-remove" aria-label={`Remove ${file.name}`} onClick={() => removeAt(index)}><X size={15} /></button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
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
  return <label className="grid gap-2"><span className="text-xs font-bold uppercase text-neutral-500">{label}</span><input className="field-input" type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />{helper && <span className="text-xs font-semibold text-neutral-500">{helper}</span>}</label>;
}

function Textarea({ label, value, onChange, rows = 8 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return <label className="grid gap-2"><span className="text-xs font-bold uppercase text-neutral-500">{label}</span><textarea className="field-input resize-y leading-6" rows={rows} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Select({ label, value, onChange, options, labels = options }: { label: string; value: string; onChange: (value: string) => void; options: string[]; labels?: string[] }) {
  return <label className="grid gap-2"><span className="text-xs font-bold uppercase text-neutral-500">{label}</span><select className="field-input" value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option, index) => <option key={option} value={option}>{labels[index]}</option>)}</select></label>;
}

function Range({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-2"><span className="text-xs font-bold uppercase text-neutral-500">{label}: {value}</span><input type="range" min="0.25" max="0.95" step="0.05" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
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

function verdictTone(level: string) {
  if (level === "suspicious") return "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger-fg)]";
  if (level === "caution") return "border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning-fg)]";
  return "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success-fg)]";
}

// Shared per-page progress reporter for the export tools below.
function pageProgress(setStatus: (status: Status) => void, verb: string) {
  return (page: number, total: number) => setStatus({
    tone: "idle",
    message: `${verb} page ${page} of ${total}…`,
    progress: { value: page, total, label: `${verb}…` },
  });
}

function MiniField({ label, value, onChange, type = "text", placeholder = "" }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return <label className="grid gap-1">
    <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">{label}</span>
    <input className="field-input" type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
  </label>;
}

async function runSafely(setStatus: (status: Status) => void, task: () => Promise<string>) {
  try {
    setStatus({ tone: "idle", message: "Processing..." });
    setStatus({ tone: "success", message: await task() });
  } catch (error: any) {
    setStatus({ tone: "error", message: error?.message || "Something went wrong." });
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type));
  if (!blob) throw new Error("This browser could not export the image.");
  return blob;
}

/**
 * Turn a data: URL into a Blob WITHOUT fetch().
 *
 * `fetch(dataUrl)` is the obvious way to do this and it does not work here: the
 * app ships `connect-src 'self'`, which covers data: and blob: URLs too, so the
 * request is blocked by our own policy. It fails as a bare "Failed to fetch",
 * which looks like a network problem and is not one — there is no network.
 *
 * This has now caught three separate features (the editor's "keep editing this
 * result", the QR download, and the invoice export path), so it lives here with
 * the reason attached rather than being rediscovered a fourth time.
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) throw new Error("That is not a data URL.");
  const header = dataUrl.slice(5, comma);
  const mimeType = header.replace(/;base64$/i, "") || "application/octet-stream";
  const payload = dataUrl.slice(comma + 1);
  if (!/;base64$/i.test(header)) return new Blob([decodeURIComponent(payload)], { type: mimeType });
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
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


export type { Tool, Status, DownloadReady };
export { initialStatus, printDownloadUrl, ToolMetaPanel, ToolForm, ProgressBar, StatusBox, ResultConsequenceNote, acceptHint, FileControl, InfoRow, Input, Textarea, Select, Range, Checkbox, usePendingHandler, PrimaryButton, SecondaryButton, verdictTone, pageProgress, MiniField, runSafely, canvasToBlob, dataUrlToBlob, requireOutput, copyText, imageExt };
