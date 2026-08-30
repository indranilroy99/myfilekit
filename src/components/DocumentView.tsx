import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Minus, Plus } from "lucide-react";
import { loadPdfDocument, renderPdfPageToCanvas } from "../lib/pdfjs";
import { boxFromDrag, boxToPercent, boxToPoints, isMeaningful, pointToPdf } from "../lib/page-geometry";

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
  /**
   * Let the user mark the page directly: drag a rectangle (Redact) or click a
   * point (Add Text). The selection is published on `myfilekit:region-selected`
   * carrying BOTH percentages and PDF points, so each tool takes the units its
   * own service already expects.
   */
  selectMode?: "rect" | "point" | null;
  /** Regions to draw back onto the page, as percentages. */
  regions?: { page: number; x: number; y: number; w: number; h: number }[];
};

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

type Selection = {
  page: number;
  percent: { x: number; y: number; w: number; h: number };
  points: { x: number; y: number; w: number; h: number };
  /** Page width in points, so a tool can warn when its content will not fit. */
  pageWidth?: number;
};

function emitSelection(detail: Selection) {
  window.dispatchEvent(new CustomEvent("myfilekit:region-selected", { detail }));
}

export function DocumentView({ file, page, onPageChange, onPageCount, selectMode = null, regions = [] }: Props) {
  const [doc, setDoc] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [current, setCurrent] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(2);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const stageRef = useRef<HTMLDivElement | null>(null);
  const renderToken = useRef(0);
  const [drag, setDrag] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Anchor plus the page it was started on: a drag released after the page
  // changed must belong to the page it began on, not the one now showing.
  const dragStart = useRef<{ x: number; y: number; page: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Keyboard marking: dragging cannot be the only way to mark an area.
  // Backed by a ref as well as state — the handler must read the CURRENT box,
  // not the one from the last committed render, or a quick sequence of key
  // presses reads a stale value and never commits. (Same class of bug as the
  // pointerup path.)
  const [keyBox, setKeyBoxState] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const keyBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const setKeyBox = (next: { x: number; y: number; w: number; h: number } | null) => {
    keyBoxRef.current = next;
    setKeyBoxState(next);
  };

  const commitBox = (page: number, box: { x: number; y: number; w: number; h: number }) => {
    const percent = boxToPercent(box);
    emitSelection({ page, percent, points: boxToPoints(box, pagePoints.w, pagePoints.h) });
    setAnnouncement(`Area marked on page ${page}: ${percent.x}% ${percent.y}%, ${percent.w} by ${percent.h} percent.`);
  };
  const [pagePoints, setPagePoints] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

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
        const sized = await doc.getPage(current);
        const base = sized.getViewport({ scale: 1 });
        const canvas = await renderPdfPageToCanvas(doc, current, ZOOMS[zoomIndex] * 1.5);
        // A newer render started while this one was in flight.
        if (token !== renderToken.current) return;
        setPagePoints({ w: base.width, h: base.height });
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
        <div className="doc-stage-inner-wrap">
          <div ref={stageRef} className="doc-stage-inner" />
          {selectMode ? (
            <div
              className={`doc-select-layer doc-select-${selectMode}`}
              role="group"
              aria-label={selectMode === "rect"
                ? "Page area marker. Drag to mark an area, or press Enter then use the arrow keys."
                : "Click the page to place text"}
              tabIndex={0}
              onPointerDown={(event) => {
                if (selectMode !== "rect") return;
                const box = event.currentTarget.getBoundingClientRect();
                dragStart.current = {
                  x: (event.clientX - box.left) / box.width,
                  y: (event.clientY - box.top) / box.height,
                  page: current,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (selectMode !== "rect" || !dragStart.current) return;
                const box = event.currentTarget.getBoundingClientRect();
                setDrag(boxFromDrag(dragStart.current, {
                  x: (event.clientX - box.left) / box.width,
                  y: (event.clientY - box.top) / box.height,
                }));
              }}
              onPointerUp={(event) => {
                if (selectMode !== "rect") return;
                // Computed from the ref and this event, NOT from `drag` state:
                // a fast drag can release before React commits the move.
                const start = dragStart.current;
                dragStart.current = null;
                setDrag(null);
                if (!start) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                const box = boxFromDrag(start, {
                  x: (event.clientX - bounds.left) / bounds.width,
                  y: (event.clientY - bounds.top) / bounds.height,
                });
                if (!isMeaningful(box)) return;
                commitBox(start.page, box);
              }}
              // A cancelled gesture (touch pan, window blur) must not strand the
              // anchor, or the next stray pointerup emits a box nobody drew.
              onPointerCancel={() => { dragStart.current = null; setDrag(null); }}
              onLostPointerCapture={() => { dragStart.current = null; setDrag(null); }}
              onKeyDown={(event) => {
                if (selectMode !== "rect") return;
                const step = event.shiftKey ? 0.05 : 0.02;
                const active = keyBoxRef.current;
                const box = active || { x: 0.4, y: 0.4, w: 0.2, h: 0.1 };
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (!active) { setKeyBox(box); setAnnouncement("Marking started. Arrow keys move, Shift with arrows resizes, Enter confirms, Escape cancels."); return; }
                  if (isMeaningful(active)) commitBox(current, active);
                  setKeyBox(null);
                  return;
                }
                if (event.key === "Escape") { setKeyBox(null); setAnnouncement("Marking cancelled."); return; }
                if (!active) return;
                const moves: Record<string, [number, number]> = {
                  ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
                };
                const delta = moves[event.key];
                if (!delta) return;
                event.preventDefault();
                setKeyBox(event.shiftKey
                  ? { ...box, w: Math.max(0.02, Math.min(1 - box.x, box.w + delta[0])), h: Math.max(0.02, Math.min(1 - box.y, box.h + delta[1])) }
                  : { ...box, x: Math.min(1 - box.w, Math.max(0, box.x + delta[0])), y: Math.min(1 - box.h, Math.max(0, box.y + delta[1])) });
              }}
              onClick={(event) => {
                if (selectMode !== "point") return;
                const box = event.currentTarget.getBoundingClientRect();
                const point = { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
                const pdf = pointToPdf(point, pagePoints.w, pagePoints.h);
                emitSelection({ page: current, percent: { x: Math.round(point.x * 1000) / 10, y: Math.round(point.y * 1000) / 10, w: 0, h: 0 }, points: { ...pdf, w: 0, h: 0 }, pageWidth: pagePoints.w });
                setAnnouncement(`Point placed on page ${current}.`);
              }}
            >
              {regions.filter((r) => r.page === current).map((r, i) => (
                <span key={i} className="doc-region" style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }} />
              ))}
              {drag ? <span className="doc-region doc-region-live" style={{ left: `${drag.x * 100}%`, top: `${drag.y * 100}%`, width: `${drag.w * 100}%`, height: `${drag.h * 100}%` }} /> : null}
              {keyBox ? <span className="doc-region doc-region-live" style={{ left: `${keyBox.x * 100}%`, top: `${keyBox.y * 100}%`, width: `${keyBox.w * 100}%`, height: `${keyBox.h * 100}%` }} /> : null}
            </div>
          ) : null}
        </div>
      </div>

      <span className="sr-only" aria-live="polite">{announcement}</span>

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
