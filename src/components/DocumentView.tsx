import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Minus, Plus } from "lucide-react";
import { loadPdfDocument, renderPdfPageToCanvas } from "../lib/pdfjs";

/**
 * A rendered PDF: page canvas, thumbnail rail, page navigation and zoom.
 *
 * This is the piece that makes the product document-centric rather than
 * form-centric — you see the file you are working on instead of describing it to
 * a form. Rendering is pdf.js against the local bundled worker; the file never
 * leaves the page.
 */
type Props = {
  file: File | null;
  /** Page the caller wants shown (1-based); the view also drives its own nav. */
  page?: number;
  onPageChange?: (page: number) => void;
  onPageCount?: (count: number) => void;
};

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function DocumentView({ file, page, onPageChange, onPageCount }: Props) {
  const [doc, setDoc] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [current, setCurrent] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(2);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const stageRef = useRef<HTMLDivElement | null>(null);
  const renderToken = useRef(0);

  // Load the document whenever the file changes.
  useEffect(() => {
    let cancelled = false;
    setThumbs({});
    setDoc(null);
    setPageCount(0);
    setCurrent(1);
    if (!file) { setStatus("idle"); return undefined; }
    setStatus("loading");
    setMessage("");
    (async () => {
      try {
        const loaded = await loadPdfDocument(file);
        if (cancelled) return;
        setDoc(loaded);
        setPageCount(loaded.numPages);
        onPageCount?.(loaded.numPages);
        setStatus("idle");
      } catch (error: any) {
        if (cancelled) return;
        setStatus("error");
        setMessage(
          /password|encrypt/i.test(String(error?.message))
            ? "This PDF is password protected. Unlock it first, then reopen it here."
            : "This file could not be displayed. It may not be a PDF, or it may be damaged.",
        );
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Follow a page the caller asked for.
  useEffect(() => {
    if (page && page >= 1 && page !== current) setCurrent(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Render the current page at the current zoom.
  useEffect(() => {
    if (!doc || !stageRef.current) return;
    const token = ++renderToken.current;
    const stage = stageRef.current;
    (async () => {
      try {
        const canvas = await renderPdfPageToCanvas(doc, current, ZOOMS[zoomIndex] * 1.5);
        // A newer render started while this one was in flight.
        if (token !== renderToken.current) return;
        canvas.className = "doc-page-canvas";
        stage.replaceChildren(canvas);
      } catch {
        if (token !== renderToken.current) return;
        stage.replaceChildren();
      }
    })();
  }, [doc, current, zoomIndex]);

  // Thumbnails, rendered small and lazily so a 500-page file does not stall.
  useEffect(() => {
    if (!doc || !pageCount) return;
    let cancelled = false;
    (async () => {
      for (let n = 1; n <= Math.min(pageCount, 60); n += 1) {
        if (cancelled) return;
        try {
          const canvas = await renderPdfPageToCanvas(doc, n, 0.22);
          if (cancelled) return;
          setThumbs((prev) => (prev[n] ? prev : { ...prev, [n]: canvas.toDataURL("image/png") }));
        } catch {
          return;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [doc, pageCount]);

  const go = (next: number) => {
    const clamped = Math.min(Math.max(1, next), Math.max(1, pageCount));
    setCurrent(clamped);
    onPageChange?.(clamped);
  };

  if (!file) {
    return (
      <div className="doc-view doc-view-empty">
        <p className="doc-empty-title">No document open</p>
        <p className="doc-empty-hint">Choose a PDF to see it here.</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="doc-view doc-view-empty">
        <p role="alert" className="doc-empty-title">Cannot display this file</p>
        <p className="doc-empty-hint">{message}</p>
      </div>
    );
  }

  return (
    <div className="doc-view">
      <div className="doc-thumbs" role="tablist" aria-label="Pages">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            role="tab"
            aria-selected={n === current}
            aria-label={`Page ${n}`}
            className={`doc-thumb ${n === current ? "doc-thumb-active" : ""}`}
            onClick={() => go(n)}
          >
            {thumbs[n] ? <img src={thumbs[n]} alt="" /> : <span className="doc-thumb-blank" />}
            <span className="doc-thumb-num">{n}</span>
          </button>
        ))}
      </div>

      <div className="doc-stage">
        {status === "loading" ? (
          <p className="doc-loading"><Loader2 className="animate-spin" size={15} aria-hidden="true" /> Opening…</p>
        ) : null}
        <div ref={stageRef} className="doc-stage-inner" />
      </div>

      <div className="doc-controls">
        <button type="button" className="icon-button" aria-label="Previous page" disabled={current <= 1} onClick={() => go(current - 1)}><ChevronUp size={15} /></button>
        <span className="doc-controls-page tabular-nums">{current} / {pageCount || "–"}</span>
        <button type="button" className="icon-button" aria-label="Next page" disabled={current >= pageCount} onClick={() => go(current + 1)}><ChevronDown size={15} /></button>
        <span className="doc-bar-sep" aria-hidden="true" />
        <button type="button" className="icon-button" aria-label="Zoom out" disabled={zoomIndex <= 0} onClick={() => setZoomIndex((z) => Math.max(0, z - 1))}><Minus size={15} /></button>
        <span className="doc-controls-page tabular-nums">{Math.round(ZOOMS[zoomIndex] * 100)}%</span>
        <button type="button" className="icon-button" aria-label="Zoom in" disabled={zoomIndex >= ZOOMS.length - 1} onClick={() => setZoomIndex((z) => Math.min(ZOOMS.length - 1, z + 1))}><Plus size={15} /></button>
      </div>
    </div>
  );
}

export default DocumentView;
