// Security & Privacy tools. Loaded on demand by ToolRenderer in src/App.tsx.
import { useEffect, useMemo, useState } from "react";
import { formatBytes } from "../utils/format.js";
import { safeFilename, withExtension } from "../utils/safe-filename.js";
import { validateFiles } from "../services/file-validator.js";
import { downloadBytes, downloadText } from "../services/download.service.js";
import { cleanPdfMetadata, textToPdf } from "../services/pdf.service.js";
import { fingerprintPdf, redactPdf } from "../services/pdf-edit.service.js";
import { ALL_PERMISSIONS_ALLOWED, PDF_ENCRYPTION_ALGORITHMS, PDF_PERMISSION_LABELS, decryptPdf, encryptPdf, unlockPdf } from "../services/pdf-crypto.service.js";
import { CONFIDENCE as PII_CONFIDENCE, PII_TYPE_LABELS, buildPrivacyReportText, confidenceLabel, describeUnreadablePages, extractPdfPiiHits, isPersonalType, scanPdfStructure } from "../services/pii.service.js";
import { analyzePdfBytes, buildAnalyzerReportText } from "../services/pdf-analyzer.service.js";
import { sanitizePdf, buildSanitizeReportText, residualActiveContent } from "../services/pdf-sanitize.service.js";
import { backendOrigin, clearEsignSettings, getEnvelopeStatus, isEsignConfigured, maskApiKey as maskEsignApiKey, parseSigners, readEsignSettings, requestEnvelope, saveEsignSettings } from "../services/esign.service.js";
import { initialStatus, ToolForm, StatusBox, ResultConsequenceNote, FileControl, InfoRow, Input, Textarea, Select, Checkbox, PrimaryButton, SecondaryButton, verdictTone, pageProgress, runSafely, ToolNotes } from "./shared";
import type { Tool } from "./shared";
import { ImageMetadataTool } from "./image";

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

type PiiRect = { page: number; x: number; y: number; w: number; h: number };
type PiiHit = { id: string; page: number; type: string; value: string; masked: string; confidence: number; note: string; rects: PiiRect[] };
type PiiScan = {
  pages: number;
  pagesWithText: number;
  pagesWithoutText: Array<{ page: number; characters: number }>;
  hasTextLayer: boolean;
  offPageItems: number;
  hits: PiiHit[];
  summary: { total: number; high: number; types: Array<{ type: string; label: string; count: number; high: number }> };
};
type TextCoverage = {
  pages: number;
  unreadablePages: number[];
  readablePages: number;
  unreadable: boolean;
  allUnreadable: boolean;
  headline: string;
  advice: string;
};
const readCoverage = describeUnreadablePages as (scan: PiiScan | null) => TextCoverage;

/**
 * The page-level "this was not scanned" banner.
 *
 * Redaction turns pages into images, so the scanners routinely see a page with no text
 * layer. Reporting "no known patterns matched" for such a page is a false clean
 * bill of health: the result is identical whether the redaction box landed on
 * the account number or missed it by 5mm. Both scanners render this, in colour,
 * above their findings.
 */
function UnreadablePagesNotice({ coverage }: { coverage: TextCoverage }) {
  if (!coverage.unreadable) return null;
  return (
    <div className="wabi-card-edge grid gap-2 rounded-2xl border border-[var(--danger)] bg-[var(--danger-bg)] p-4 text-sm font-semibold leading-6 text-[var(--danger-fg)]">
      <p className="text-xs font-bold uppercase tracking-wide">This file was not fully scanned</p>
      <p className="text-base font-black">{coverage.headline}</p>
      <p>{coverage.advice}</p>
      <p>
        {coverage.unreadablePages.length} of {coverage.pages} page{coverage.pages === 1 ? "" : "s"} had no readable text
        {coverage.readablePages ? ` · ${coverage.readablePages} page${coverage.readablePages === 1 ? " was" : "s were"} scanned` : ""}.
        {" "}Add a text layer with <a className="underline" href="#ocr-pdf-tool">OCR / Searchable PDF</a>, or cover regions by eye with <a className="underline" href="#redact-pdf-tool">Redact PDF</a>.
      </p>
    </div>
  );
}
type PdfStructureScan = {
  pages: number;
  encrypted: boolean;
  info: Record<string, string>;
  xmp: { present: boolean; bytes: number; fields: Array<{ label: string; value: string }> };
  attachments: Array<{ name: string; type: string; description?: string; size: number }>;
  embeddedFileStreams: number;
  embeddedFileBytes: number;
  signatures: Array<{ name: string; reason: string }>;
  links: Array<{ page: number; subtype: string; uri: string }>;
  invisibleText: Array<{ page: number; invisible: number; whiteOnWhite: number }>;
  contentTruncated: boolean;
};

// redactPdf accepts { dpi, onProgress }, but the type inferred from that plain
// JS module only surfaces the defaulted `dpi`, so the progress callback is
// passed through this typed alias rather than being dropped.
const redactPdfWithProgress = redactPdf as (
  file: File,
  rects: PiiRect[],
  options: { dpi: number; onProgress: (page: number, total: number) => void }
) => Promise<Uint8Array>;

// Values are shown masked unless the operator explicitly reveals them, and no
// PII value is ever written into a status message, a filename, or the console.
function piiDisplayValue(hit: PiiHit, reveal: boolean) {
  return reveal ? hit.value : hit.masked;
}

function confidenceTone(confidence: number) {
  if (confidence >= PII_CONFIDENCE.HIGH) return "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger-fg)]";
  if (confidence >= PII_CONFIDENCE.MEDIUM) return "border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning-fg)]";
  return "border-[var(--line)] bg-[var(--paper-soft)] text-[var(--stone)]";
}

function ConfidenceTag({ confidence }: { confidence: number }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase ${confidenceTone(confidence)}`}>{confidenceLabel(confidence)}</span>;
}

function groupHitsByType(hits: PiiHit[]) {
  const groups = new Map<string, PiiHit[]>();
  for (const hit of hits) {
    const list = groups.get(hit.type) || [];
    list.push(hit);
    groups.set(hit.type, list);
  }
  return [...groups.entries()]
    .map(([type, list]) => ({ type, label: PII_TYPE_LABELS[type as keyof typeof PII_TYPE_LABELS] || type, hits: list }))
    .sort((a, b) => b.hits.length - a.hits.length || a.label.localeCompare(b.label));
}

function AutoRedactPiiTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [scan, setScan] = useState<PiiScan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reveal, setReveal] = useState(false);
  const [dpi, setDpi] = useState("150");
  const [redacted, setRedacted] = useState(false);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => {
    setFiles([]);
    setScan(null);
    setSelected(new Set());
    setReveal(false);
    setRedacted(false);
    setStatus(initialStatus);
  };

  // Scanning happens page by page as soon as a file is chosen, so a long
  // document reports progress instead of freezing behind one blocking call.
  useEffect(() => {
    let cancelled = false;
    setScan(null);
    setSelected(new Set());
    setReveal(false);
    setRedacted(false);
    if (!files.length) return undefined;

    runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const result = (await extractPdfPiiHits(file, { onProgress: pageProgress(setStatus, "Scanning") })) as PiiScan;
      if (cancelled) return "Ready.";
      setScan(result);
      const coverage = readCoverage(result);
      if (coverage.allUnreadable) {
        return `${coverage.headline} ${coverage.advice}`;
      }
      const preselect = result.hits.filter((hit) => hit.confidence >= PII_CONFIDENCE.HIGH && isPersonalType(hit.type) && hit.rects.length > 0);
      setSelected(new Set(preselect.map((hit) => hit.id)));
      // The unreadable-page warning leads the message: a match count read first
      // would be taken as covering the whole document.
      const unread = coverage.unreadable ? `${coverage.headline} ` : "";
      return `${unread}Scanned ${coverage.readablePages} of ${result.pages} page${result.pages === 1 ? "" : "s"}: ${result.summary.total} pattern match${result.summary.total === 1 ? "" : "es"}, ${result.summary.high} high confidence. ${preselect.length} high-confidence personal value${preselect.length === 1 ? " is" : "s are"} pre-selected — review every box before redacting.`;
    });

    return () => {
      cancelled = true;
    };
  }, [files, tool.file]);

  const coverage = useMemo(() => readCoverage(scan), [scan]);
  const groups = useMemo(() => groupHitsByType(scan?.hits || []), [scan]);
  const selectedHits = useMemo(() => (scan?.hits || []).filter((hit) => selected.has(hit.id)), [scan, selected]);
  const selectedRects = useMemo(() => selectedHits.flatMap((hit) => hit.rects), [selectedHits]);

  const toggleHit = (hit: PiiHit, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(hit.id);
      else next.delete(hit.id);
      return next;
    });
  };

  const toggleType = (hits: PiiHit[], checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const hit of hits) {
        if (!hit.rects.length) continue;
        if (checked) next.add(hit.id);
        else next.delete(hit.id);
      }
      return next;
    });
  };

  return (
    <ToolForm status={status} onReset={reset}>
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        Finds Aadhaar (Verhoeff-checked), PAN, payment cards (Luhn-checked), GSTIN, IFSC, account numbers (including grouped forms like 4419-8827-6634), US routing numbers (ABA-checked), passport numbers, emails, phone numbers, dates of birth, IPs and URLs in the PDF's text layer, then permanently removes the ones you tick. It reads the text layer only, so a scanned or already-flattened page is reported as unreadable rather than clean — add a text layer with <a className="underline" href="#ocr-pdf-tool">OCR / Searchable PDF</a> first. Redaction turns every page into an image and paints opaque boxes over the matches, so the text underneath is genuinely gone — the honest trade is that the output is flattened: selectable text, links, and form fields are lost for the whole document. Nothing leaves this browser.
      </div>
      <FileControl accept="application/pdf" files={files} setFiles={setFiles} />

      {scan && <UnreadablePagesNotice coverage={coverage} />}

      {scan && scan.hasTextLayer && (
        <div className="surface-card wabi-card-edge grid gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-black">Matches found</p>
              <p className="mt-1 text-sm font-semibold text-neutral-500">
                {scan.summary.total} match{scan.summary.total === 1 ? "" : "es"} across {scan.pagesWithText} page{scan.pagesWithText === 1 ? "" : "s"} with text · {scan.summary.high} high confidence · {selected.size} selected ({selectedRects.length} area{selectedRects.length === 1 ? "" : "s"} to paint)
              </p>
            </div>
            <Checkbox label={reveal ? "Values revealed" : "Reveal full values"} checked={reveal} onChange={setReveal} />
          </div>
          {groups.length ? (
            <div className="grid gap-3">
              {groups.map((group) => {
                const selectable = group.hits.filter((hit) => hit.rects.length > 0);
                const allSelected = selectable.length > 0 && selectable.every((hit) => selected.has(hit.id));
                return (
                  <div key={group.type} className="surface-muted wabi-card-edge grid gap-2 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-black text-[var(--foreground)]">{group.label} · {group.hits.length}</p>
                      <Checkbox label={allSelected ? `Deselect all ${group.label}` : `Select all ${group.label}`} checked={allSelected} onChange={(checked) => toggleType(group.hits, checked)} />
                    </div>
                    <div className="grid gap-1">
                      {group.hits.map((hit) => (
                        <label key={hit.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-semibold text-neutral-600">
                          <input type="checkbox" checked={selected.has(hit.id)} disabled={!hit.rects.length} onChange={(event) => toggleHit(hit, event.target.checked)} />
                          <span className="text-xs font-bold uppercase text-neutral-500">p{hit.page}</span>
                          <span className="break-all font-mono text-[var(--foreground)]">{piiDisplayValue(hit, reveal)}</span>
                          <ConfidenceTag confidence={hit.confidence} />
                          {hit.rects.length ? <span className="text-xs">{hit.rects.length} area{hit.rects.length === 1 ? "" : "s"}</span> : <span className="text-xs text-[var(--danger-fg)]">no rectangle found — redact this one manually</span>}
                          {hit.note ? <span className="text-xs text-neutral-500">{hit.note}</span> : null}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm font-semibold text-neutral-500">
              {coverage.unreadable
                ? `No known patterns matched on the ${coverage.readablePages} page${coverage.readablePages === 1 ? "" : "s"} that could be read. The page${coverage.unreadablePages.length === 1 ? "" : "s"} listed above ${coverage.unreadablePages.length === 1 ? "was" : "were"} not scanned at all, so this is not a clean result.`
                : "No known patterns matched. That is not proof the document is clean — names, addresses, and free-text details are not detectable by pattern."}
            </p>
          )}
          <div className="surface-muted wabi-card-edge p-3 text-sm font-semibold leading-6 text-neutral-600">
            A match is located through pdf.js text items, and one item can hold more characters than the match itself. When a match covers only part of an item the WHOLE item rectangle is painted, so neighbouring characters on that run are lost too. That is deliberate: over-redacting beats leaving half an Aadhaar number visible. Check every page of the output before you share it.
          </div>
        </div>
      )}

      <Select label="Output resolution (DPI)" value={dpi} onChange={setDpi} options={["120", "150", "200", "300"]} labels={["120 · smaller", "150 · default", "200 · high", "300 · print"]} />
      <PrimaryButton label="Redact selected matches" onClick={() => runSafely(setStatus, async () => {
        const [file] = validateFiles(files, tool.file);
        if (!scan) throw new Error("Wait for the scan to finish first.");
        if (!scan.hasTextLayer) throw new Error("This PDF has no text layer to scan. Run OCR / Searchable PDF first.");
        if (!selectedHits.length) throw new Error("Tick at least one match to redact.");
        if (!selectedRects.length) throw new Error("The selected matches have no page rectangles, so nothing can be painted. Use Redact PDF with manual coordinates instead.");
        const bytes = await redactPdfWithProgress(file, selectedRects, { dpi: Number(dpi), onProgress: pageProgress(setStatus, "Rasterising") });
        downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-redacted`, "pdf"), "application/pdf");
        const pages = new Set(selectedRects.map((rect) => rect.page)).size;
        setRedacted(true);
        return `Painted ${selectedRects.length} area${selectedRects.length === 1 ? "" : "s"} for ${selectedHits.length} match${selectedHits.length === 1 ? "" : "es"} across ${pages} page${pages === 1 ? "" : "s"}, then rebuilt every page as an image.`;
      })} />
      {redacted && <ResultConsequenceNote>The covered text is gone from the output, and the whole document is now flattened. Verify the result before sharing.</ResultConsequenceNote>}
    </ToolForm>
  );
}

function PrivacyScannerTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [scan, setScan] = useState<PiiScan | null>(null);
  const [structure, setStructure] = useState<PdfStructureScan | null>(null);
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => {
    setFiles([]);
    setScan(null);
    setStructure(null);
    setReveal(false);
    setStatus(initialStatus);
  };

  useEffect(() => {
    let cancelled = false;
    setScan(null);
    setStructure(null);
    setReveal(false);
    if (!files.length) return undefined;

    runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const textScan = (await extractPdfPiiHits(file, { onProgress: pageProgress(setStatus, "Reading") })) as PiiScan;
      if (cancelled) return "Ready.";
      const documentScan = (await scanPdfStructure(file, { onProgress: pageProgress(setStatus, "Inspecting") })) as PdfStructureScan;
      if (cancelled) return "Ready.";
      setScan(textScan);
      setStructure(documentScan);
      const textCoverage = readCoverage(textScan);
      const notes: string[] = [];
      if (documentScan.encrypted) notes.push("encrypted");
      if (documentScan.attachments.length || documentScan.embeddedFileStreams) notes.push("carries embedded files");
      if (documentScan.invisibleText.length) notes.push("contains hidden or invisible text");
      // Leading with the unreadable pages, because a match count read first is
      // taken as a statement about the whole document.
      const unread = textCoverage.unreadable ? `${textCoverage.headline} ` : "";
      return `${unread}Read ${textCoverage.readablePages} of ${documentScan.pages} page${documentScan.pages === 1 ? "" : "s"}: ${textScan.summary.high} high-confidence personal-data match${textScan.summary.high === 1 ? "" : "es"} of ${textScan.summary.total} total${notes.length ? `; ${notes.join("; ")}` : ""}. Nothing was uploaded and no file was modified.`;
    });

    return () => {
      cancelled = true;
    };
  }, [files, tool.file]);

  const coverage = useMemo(() => readCoverage(scan), [scan]);
  const groups = useMemo(() => groupHitsByType(scan?.hits || []), [scan]);
  const destinations = useMemo(() => (scan?.hits || []).filter((hit) => hit.type === "url" || hit.type === "ipv4" || hit.type === "ipv6"), [scan]);
  const reportText = useMemo(() => {
    if (!scan || !structure || !files.length) return "";
    return buildPrivacyReportText({ fileName: files[0].name, fileSize: files[0].size, scan, structure, reveal });
  }, [scan, structure, files, reveal]);

  return (
    <ToolForm status={status} onReset={reset}>
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        A read-only privacy audit: personal-data patterns with page numbers, Info-dictionary and XMP metadata leaks, invisible or off-page text, link destinations, embedded files, encryption, and signature entries. Your file is never modified and never leaves this browser. Values are masked until you reveal them.
      </div>
      <FileControl accept="application/pdf" files={files} setFiles={setFiles} />

      {scan && structure && (
        <>
          <UnreadablePagesNotice coverage={coverage} />
          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-black">Overview</p>
              <Checkbox label={reveal ? "Values revealed" : "Reveal full values"} checked={reveal} onChange={setReveal} />
            </div>
            <dl className="grid gap-2 text-sm font-semibold text-neutral-600 lg:grid-cols-2">
              <InfoRow label="Pages" value={String(structure.pages)} />
              <InfoRow label="Pages with readable text" value={`${coverage.readablePages} of ${structure.pages}${coverage.unreadable ? ` — page${coverage.unreadablePages.length === 1 ? "" : "s"} ${coverage.unreadablePages.join(", ")} could not be read` : ""}`} />
              <InfoRow label="Pattern matches" value={`${scan.summary.total} total · ${scan.summary.high} high confidence`} />
              <InfoRow label="Encrypted" value={structure.encrypted ? "Yes" : "No"} />
              <InfoRow label="Signature entries" value={String(structure.signatures.length)} />
              <InfoRow label="Embedded files" value={`${structure.attachments.length} named · ${structure.embeddedFileStreams} stream${structure.embeddedFileStreams === 1 ? "" : "s"}`} />
              <InfoRow label="Link annotations" value={String(structure.links.length)} />
              <InfoRow label="Hidden-text pages" value={String(structure.invisibleText.length)} />
            </dl>
            <div className="flex flex-wrap gap-2">
              <SecondaryButton label="Download .txt report" onClick={() => {
                if (!reportText) throw new Error("Scan a file first.");
                downloadText(reportText, `${safeFilename(files[0].name)}-privacy-report`, "txt");
              }} />
              <SecondaryButton label="Download .pdf report" onClick={async () => {
                if (!reportText) throw new Error("Scan a file first.");
                try {
                  const bytes = await textToPdf(reportText);
                  downloadBytes(bytes, withExtension(`${safeFilename(files[0].name)}-privacy-report`, "pdf"), "application/pdf");
                } catch {
                  throw new Error("The PDF report supports Latin-1 characters only, and this document contains characters outside it. Download the .txt report instead.");
                }
              }} />
            </div>
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <p className="font-black">1 · Personal data patterns</p>
            {groups.length ? (
              <div className="grid gap-3">
                {groups.map((group) => (
                  <div key={group.type} className="surface-muted wabi-card-edge grid gap-2 p-3">
                    <p className="font-black text-[var(--foreground)]">{group.label} · {group.hits.length}</p>
                    <div className="grid gap-1">
                      {group.hits.map((hit) => (
                        <div key={hit.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-semibold text-neutral-600">
                          <span className="text-xs font-bold uppercase text-neutral-500">p{hit.page}</span>
                          <span className="break-all font-mono text-[var(--foreground)]">{piiDisplayValue(hit, reveal)}</span>
                          <ConfidenceTag confidence={hit.confidence} />
                          {hit.note ? <span className="text-xs text-neutral-500">{hit.note}</span> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm font-semibold text-neutral-500">
                {coverage.unreadable
                  ? `No known patterns matched on the ${coverage.readablePages} page${coverage.readablePages === 1 ? "" : "s"} that could be read. ${coverage.headline} Treat this as "not scanned", not as "clean".`
                  : "No known patterns matched."}
              </p>
            )}
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <p className="font-black">2 · Document metadata</p>
            <dl className="grid gap-2 text-sm font-semibold text-neutral-600 lg:grid-cols-2">
              {Object.entries(structure.info).map(([key, value]) => (
                <InfoRow key={key} label={(key === "Author" || key === "Creator") && value ? `${key} ⚠` : key} value={value || "Not set"} />
              ))}
            </dl>
            {(structure.info.Author || structure.info.Creator) && (
              <p className="text-sm font-semibold text-neutral-500">Author and Creator name the person and the software that produced this file. Clear them with PDF Metadata Cleaner before sharing externally.</p>
            )}
            <p className="font-black">XMP packet</p>
            {structure.xmp.present ? (
              <dl className="grid gap-2 text-sm font-semibold text-neutral-600">
                <InfoRow label="Size" value={`${structure.xmp.bytes} bytes`} />
                {structure.xmp.fields.length
                  ? structure.xmp.fields.map((field) => <InfoRow key={field.label} label={field.label} value={field.value} />)
                  : <InfoRow label="Fields" value="Present, but no common identity field was recognised." />}
              </dl>
            ) : (
              <p className="text-sm font-semibold text-neutral-500">No XMP packet is present.</p>
            )}
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <p className="font-black">3 · Hidden and invisible text</p>
            {structure.invisibleText.length ? (
              <dl className="grid gap-2 text-sm font-semibold text-neutral-600">
                {structure.invisibleText.map((entry) => (
                  <InfoRow key={entry.page} label={`Page ${entry.page}`} value={`${entry.invisible} text run(s) in rendering mode 3 (invisible) · ${entry.whiteOnWhite} near-white fill`} />
                ))}
              </dl>
            ) : (
              <p className="text-sm font-semibold text-neutral-500">The operator scan found no invisible or near-white text.</p>
            )}
            {scan.offPageItems > 0 && <p className="text-sm font-semibold text-neutral-600">{scan.offPageItems} text item(s) sit outside the visible page box — content a reader cannot see but a text extractor can.</p>}
            <p className="text-sm font-semibold text-neutral-500">This is a heuristic: it tracks rendering mode and fill colour through the content stream without evaluating the full graphics state, so it can miss cases and can also flag legitimate ones. An OCR'd document uses invisible text on purpose.{structure.contentTruncated ? " A very large content stream was only partially scanned." : ""}</p>
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <p className="font-black">4 · Destinations: links, URLs and IPs</p>
            {destinations.length || structure.links.length ? (
              <dl className="grid gap-2 text-sm font-semibold text-neutral-600">
                {destinations.map((hit) => <InfoRow key={hit.id} label={`Page ${hit.page} · in text`} value={hit.value} />)}
                {structure.links.map((link, index) => <InfoRow key={`${link.page}-${index}`} label={`Page ${link.page} · /${link.subtype} annotation`} value={link.uri} />)}
              </dl>
            ) : (
              <p className="text-sm font-semibold text-neutral-500">No URLs, IP addresses, or link annotations were found.</p>
            )}
            <p className="text-sm font-semibold text-neutral-500">Destinations are shown in full even when values are masked — you need to read them to judge them. They are not opened or contacted.</p>
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <p className="font-black">5 · Attachments, protection and signatures</p>
            <dl className="grid gap-2 text-sm font-semibold text-neutral-600">
              {structure.attachments.map((attachment, index) => (
                <InfoRow key={`${attachment.name}-${index}`} label={`Attachment · ${attachment.type}`} value={`${attachment.name}${attachment.size ? ` · ${formatBytes(attachment.size)} stored` : ""}${attachment.description ? ` · ${attachment.description}` : ""}`} />
              ))}
              {structure.embeddedFileStreams > 0 && <InfoRow label="Embedded files" value={`${structure.embeddedFileStreams} · ${formatBytes(structure.embeddedFileBytes)} stored`} />}
              {!structure.attachments.length && !structure.embeddedFileStreams && <InfoRow label="Attachments" value="None found" />}
              <InfoRow label="Encrypted" value={structure.encrypted ? "Yes — this file carries PDF encryption" : "No"} />
              {structure.signatures.length
                ? structure.signatures.map((signature, index) => <InfoRow key={`${signature.name}-${index}`} label="Signature entry" value={`${signature.name}${signature.reason ? ` · ${signature.reason}` : ""}`} />)
                : <InfoRow label="Digital signature" value="No signature entry found" />}
            </dl>
            <p className="text-sm font-semibold text-neutral-500">A signature entry means the file claims to be signed. This tool does not verify the cryptography behind it.</p>
          </div>

          <div className="surface-card wabi-card-edge grid gap-2 p-4 text-sm font-semibold leading-6 text-neutral-600">
            <p className="font-black text-[var(--foreground)]">6 · What this means</p>
            {coverage.unreadable && <p className="text-[var(--danger-fg)]">{coverage.headline} {coverage.advice}</p>}
            <p>{scan.summary.high} match{scan.summary.high === 1 ? "" : "es"} passed a checksum or a context rule, so treat those as real findings. The other {scan.summary.total - scan.summary.high} are medium or low confidence and need your judgement.</p>
            <p>There is no risk score on purpose — a single number would hide what matters.</p>
            {/* Stays visible, and stays verbatim. This tool once reported "no
                matches" on a page it physically could not read; the sentence
                that stops a clean result being mistaken for a safe one is not a
                detail to fold away behind a disclosure. */}
            <p className="font-black text-[var(--foreground)]">This finds common patterns only. It cannot guarantee it found every piece of sensitive data.</p>
            <ToolNotes summary="What this cannot find">
              <li>Names, addresses, salary and health details — there is no pattern to match.</li>
              <li>Text inside images, and anything inside an attachment.</li>
              <li>Aadhaar, payment cards and GSTIN are checksum-verified. PAN, IFSC and passport are shape rules, so a part number shaped like one is reported.</li>
              <li>Passport and account shapes are generic, so low-confidence hits there include false positives.</li>
              <li>A version number like 1.2.3.4 is reported as an IP address.</li>
            </ToolNotes>
          </div>
        </>
      )}
    </ToolForm>
  );
}

type AnalyzerFinding = { id: number; indicator: string; severity: string; where: string | null; why: string; evidence: string };
type AnalyzerReport = {
  fileSize: number; sha256: string; version: string; pageCount: number | null; objectCount: number;
  linearized: boolean; hasSignature: boolean; encrypted: boolean; objStmCount: number; startxrefCount: number;
  eofCount: number; parseError: string | null; truncated: boolean; findings: AnalyzerFinding[];
  embeddedFiles: { objNum: number; name: string; size: number; magic: string; executable: boolean }[];
  verdict: { level: string; headline: string; summary: string; counts: { critical: number; high: number; medium: number; low: number; info: number } };
};

function severityTone(severity: string) {
  if (severity === "Critical") return "border-[var(--danger-strong)] bg-[var(--danger-strong-bg)] text-[var(--danger-strong-fg)]";
  if (severity === "High") return "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger-fg)]";
  if (severity === "Medium") return "border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning-fg)]";
  // Low + Info are neutral — chroma is reserved for danger (Critical/High=red, Medium=amber).
  return "border-[var(--line)] bg-[var(--paper-soft)] text-[var(--stone)]";
}

function SeverityTag({ severity }: { severity: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase ${severityTone(severity)}`}>{severity}</span>;
}

function PdfAnalyzerTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<AnalyzerReport | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => {
    setFiles([]);
    setReport(null);
    setStatus(initialStatus);
  };

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    if (!files.length) return undefined;

    runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = (await analyzePdfBytes(bytes, {
        onProgress: (step: number, total: number) => setStatus({ tone: "idle", message: `Analysing ${file.name} — step ${step} of ${total}…`, progress: { value: step, total, label: "Analysing…" } }),
      })) as AnalyzerReport;
      if (cancelled) return "Ready.";
      setReport(result);
      const c = result.verdict.counts;
      return `${result.verdict.headline}. ${c.critical} critical, ${c.high} high, ${c.medium} medium indicator(s). Nothing was uploaded and the file was never executed.`;
    });

    return () => { cancelled = true; };
  }, [files, tool.file]);

  const reportText = useMemo(() => {
    if (!report || !files.length) return "";
    return buildAnalyzerReportText(report, { fileName: files[0].name });
  }, [report, files]);

  return (
    <ToolForm status={status} onReset={reset}>
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        Static, byte-level triage of a suspicious PDF. It reads the raw bytes — it never opens, renders, executes, or evals anything in the file, and nothing leaves this browser. Built for the case where a PDF must NOT be sent to any online scanner. This is triage to guide your judgement, not a malware verdict.
      </div>
      <FileControl accept="application/pdf" files={files} setFiles={setFiles} />

      {report && (
        <>
          <div className={`wabi-card-edge grid gap-2 rounded-2xl border p-4 ${verdictTone(report.verdict.level)}`}>
            <p className="text-xs font-bold uppercase tracking-wide">Triage verdict</p>
            <p className="text-lg font-black">{report.verdict.headline}</p>
            <p className="text-sm font-semibold leading-6">{report.verdict.summary}</p>
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-black">Structure (facts, not verdicts)</p>
            </div>
            <dl className="grid gap-2 text-sm font-semibold text-neutral-600 lg:grid-cols-2">
              <InfoRow label="SHA-256" value={report.sha256} />
              <InfoRow label="Size" value={formatBytes(report.fileSize)} />
              <InfoRow label="PDF version" value={report.version} />
              <InfoRow label="Pages (best-effort)" value={report.pageCount == null ? "unknown" : String(report.pageCount)} />
              <InfoRow label="Objects" value={String(report.objectCount)} />
              <InfoRow label="Compressed object streams" value={String(report.objStmCount)} />
              <InfoRow label="Linearized" value={report.linearized ? "Yes" : "No"} />
              <InfoRow label="Encrypted" value={report.encrypted ? "Yes" : "No"} />
              <InfoRow label="Digital signature" value={report.hasSignature ? "Present (cryptography not verified)" : "None"} />
              <InfoRow label="startxref / %%EOF" value={`${report.startxrefCount} / ${report.eofCount}`} />
            </dl>
            {report.parseError && <p className="text-sm font-semibold text-amber-700 [.dark_&]:text-[#f3d79b]">{report.parseError}</p>}
            {report.truncated && <p className="text-sm font-semibold text-amber-700 [.dark_&]:text-[#f3d79b]">The file does not end cleanly at %%EOF — it may be truncated or carry data appended after the PDF.</p>}
            <div className="flex flex-wrap gap-2">
              <SecondaryButton label="Download .txt report" onClick={() => {
                if (!reportText) throw new Error("Analyse a file first.");
                downloadText(reportText, `${safeFilename(files[0].name)}-analysis`, "txt");
              }} />
              <SecondaryButton label="Download .pdf report" onClick={async () => {
                if (!reportText) throw new Error("Analyse a file first.");
                try {
                  const bytes = await textToPdf(reportText);
                  downloadBytes(bytes, withExtension(`${safeFilename(files[0].name)}-analysis`, "pdf"), "application/pdf");
                } catch {
                  throw new Error("The PDF report supports Latin-1 characters only, and this analysis contains characters outside it. Download the .txt report instead.");
                }
              }} />
            </div>
          </div>

          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-black">Findings</p>
              <p className="text-xs font-bold uppercase text-neutral-500">
                {report.verdict.counts.critical}C · {report.verdict.counts.high}H · {report.verdict.counts.medium}M · {report.verdict.counts.low}L · {report.verdict.counts.info}I
              </p>
            </div>
            {report.findings.length ? (
              <div className="grid gap-2">
                {report.findings.map((finding) => (
                  <div key={finding.id} className="surface-muted wabi-card-edge grid gap-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityTag severity={finding.severity} />
                      <span className="font-black text-[var(--foreground)]">{finding.indicator}</span>
                      {finding.where ? <span className="text-xs font-semibold text-neutral-500">{finding.where}</span> : null}
                    </div>
                    <p className="text-sm font-semibold leading-6 text-neutral-600">{finding.why}</p>
                    {finding.evidence ? (
                      <pre className="max-h-64 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--paper-soft)] px-3 py-2 text-xs leading-5 text-[var(--foreground)] whitespace-pre-wrap break-all">{finding.evidence}</pre>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm font-semibold text-neutral-500">No indicators were detected by the static byte-level scan. That is not proof of safety — see the limits below.</p>
            )}
            <p className="text-sm font-semibold text-neutral-500">Extracted evidence — scripts, commands, URLs, attachment names — is shown as inert, escaped text. It is never executed, opened, or contacted.</p>
          </div>

          <div className="surface-card wabi-card-edge grid gap-2 p-4 text-sm font-semibold leading-6 text-neutral-600">
            <ToolNotes summary="What this cannot find">
              <li>Heavy or novel obfuscation, and payloads behind filters this cannot decode.</li>
              <li>Exploits inside malformed object internals, or anything that only fires when a real reader opens the file.</li>
              <li>There is no threat score on purpose — the findings above are the report, and the call is yours.</li>
              <li>If in doubt, open the file in an isolated sandbox instead.</li>
            </ToolNotes>
          </div>
        </>
      )}
    </ToolForm>
  );
}

type SanitizeReport = { counts: Record<string, number>; removed: { category: string; label: string; count: number }[]; total: number; clean: boolean; removeAttachments: boolean };
type SanitizeResult = { bytes: Uint8Array; report: SanitizeReport; before: number; residual: AnalyzerFinding[] };

function SanitizePdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [removeAttachments, setRemoveAttachments] = useState(true);
  const [result, setResult] = useState<SanitizeResult | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const reset = () => { setFiles([]); setRemoveAttachments(true); setResult(null); setStatus(initialStatus); };

  const filename = files.length ? withExtension(`${safeFilename(files[0].name)}-sanitized`, "pdf") : "sanitized.pdf";

  return (
    <ToolForm status={status} onReset={reset}>
      <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
        The active counterpart to the PDF Analyser. It opens the PDF and removes active-content threats at the object level — document open actions, additional actions, JavaScript, Launch/SubmitForm/ImportData actions, embedded files, and RichMedia/3D/movie annotations — then reports exactly what it stripped. It removes the same categories the Analyser flags, so re-analysing the cleaned file reports none of them. Everything happens in this browser.
      </div>
      <FileControl accept="application/pdf" files={files} setFiles={(next) => { setFiles(next); setResult(null); setStatus(initialStatus); }} />
      <Checkbox label="Remove embedded files / attachments" checked={removeAttachments} onChange={(value) => { setRemoveAttachments(value); setResult(null); }} />

      <PrimaryButton label="Sanitize PDF" onClick={() => runSafely(setStatus, async () => {
        const [file] = validateFiles(files, tool.file);
        const inputBytes = new Uint8Array(await file.arrayBuffer());
        setStatus({ tone: "idle", message: "Scanning for active content…", progress: { value: 1, total: 3, label: "Analysing original" } });
        const beforeReport = (await analyzePdfBytes(inputBytes)) as AnalyzerReport;
        const beforeActive = residualActiveContent(beforeReport);
        setStatus({ tone: "idle", message: "Stripping active content…", progress: { value: 2, total: 3, label: "Sanitising" } });
        const { bytes, report } = await sanitizePdf(inputBytes, { removeAttachments });
        setStatus({ tone: "idle", message: "Verifying with the Analyser…", progress: { value: 3, total: 3, label: "Re-analysing" } });
        const afterReport = (await analyzePdfBytes(bytes)) as AnalyzerReport;
        const residual = residualActiveContent(afterReport);
        setResult({ bytes, report: report as SanitizeReport, before: beforeActive.length, residual });
        if (report.clean) return "Nothing to remove — no active-content threats were found. A clean, re-saved copy is ready.";
        return `Removed ${report.total} active-content item${report.total === 1 ? "" : "s"}. The Analyser now reports ${residual.length} active-content indicator${residual.length === 1 ? "" : "s"} in the output.`;
      })} />

      {result && (
        <>
          <div className="surface-card wabi-card-edge grid gap-3 p-4">
            <p className="font-black">Removal report</p>
            {result.report.clean ? (
              <p className="text-sm font-semibold text-neutral-600">Nothing to remove — this PDF carried no OpenAction, additional actions, JavaScript, launch/submit actions, embedded files, or multimedia annotations. A re-saved copy is ready below.</p>
            ) : (
              <ul className="grid gap-1 text-sm font-semibold text-neutral-600">
                {result.report.removed.map((item) => (
                  <li key={item.category} className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-1 last:border-b-0">
                    <span className="text-[var(--foreground)]">{item.label}</span>
                    <span className="tabular-nums font-black">{item.count}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className={`wabi-card-edge grid gap-1 rounded-2xl border p-3 text-sm font-semibold ${result.residual.length ? verdictTone("caution") : verdictTone("clean")}`}>
              <p className="text-xs font-bold uppercase tracking-wide">Cross-check with the PDF Analyser</p>
              <p>Active-content indicators: {result.before} before → {result.residual.length} after.</p>
              {result.residual.length > 0 && (
                <p>Residual (could not be removed — likely inside an encrypted or unusual stream): {result.residual.map((finding) => finding.indicator).join(", ")}.</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <SecondaryButton label="Download .txt report" onClick={() => {
                if (!files.length) throw new Error("Sanitize a file first.");
                downloadText(buildSanitizeReportText(result.report, { fileName: files[0].name }), `${safeFilename(files[0].name)}-sanitize-report`, "txt");
              }} />
            </div>
          </div>
          <PrimaryButton label="Download sanitized PDF" onClick={() => runSafely(setStatus, async () => {
            downloadBytes(result.bytes, filename, "application/pdf");
            return `${filename} is ready to save.`;
          })} />
          {status.tone === "success" && <ResultConsequenceNote>This removes active content. It cannot neutralise an exploit hidden inside an image, font or encrypted stream — for a suspicious file, check it in PDF Analyser first.</ResultConsequenceNote>}
        </>
      )}
    </ToolForm>
  );
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

// The crypt layer reports permissions as a plain object keyed by name; these
// casts give the JSX a typed view of it without pulling type annotations into
// the service.
const permissionLabels = PDF_PERMISSION_LABELS as Record<string, string>;
const permissionKeys = Object.keys(permissionLabels);
const encryptionAlgorithms = PDF_ENCRYPTION_ALGORITHMS as Record<string, { label: string; internal?: boolean }>;
const offeredAlgorithmIds = Object.keys(encryptionAlgorithms).filter((id) => !encryptionAlgorithms[id].internal);
const allPermissionsAllowed = ALL_PERMISSIONS_ALLOWED as Record<string, boolean>;

function listPermissions(flags: Record<string, boolean>, wanted: boolean) {
  return permissionKeys.filter((key) => Boolean(flags[key]) === wanted).map((key) => permissionLabels[key].toLowerCase());
}

function PasswordField({ label, value, onChange, helper = "" }: { label: string; value: string; onChange: (value: string) => void; helper?: string }) {
  return <label className="grid gap-2">
    <span className="text-xs font-bold uppercase text-neutral-500">{label}</span>
    <input className="field-input" type="password" value={value} onChange={(event) => onChange(event.target.value)} autoComplete="new-password" spellCheck={false} />
    {helper && <span className="text-xs font-semibold text-neutral-500">{helper}</span>}
  </label>;
}

function EncryptPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [algorithm, setAlgorithm] = useState("aes-256");
  const [permissions, setPermissions] = useState<Record<string, boolean>>({ ...allPermissionsAllowed });
  const [status, setStatus] = useState(initialStatus);

  // Passwords live only in this component's state and are never logged or
  // stored. Drop them on unmount as well as on reset.
  const forgetPasswords = () => {
    setPassword("");
    setConfirmation("");
    setOwnerPassword("");
  };
  useEffect(() => forgetPasswords, []);

  return <ToolForm status={status} onReset={() => {
    setFiles([]);
    forgetPasswords();
    setAlgorithm("aes-256");
    setPermissions({ ...allPermissionsAllowed });
    setStatus(initialStatus);
  }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Applies the standard PDF security handler here in this browser, so any reader — Acrobat, Preview, Chrome — will ask for the password before opening the file. There is no recovery route: if the password is lost, the document cannot be opened again by anyone, including you.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PasswordField label="Password to open the PDF" value={password} onChange={setPassword} />
    <PasswordField label="Confirm password" value={confirmation} onChange={setConfirmation} />
    <PasswordField label="Owner password (optional)" value={ownerPassword} onChange={setOwnerPassword} helper="A second, different password that can change the permissions below. Leave it blank to reuse the password above." />
    <Select label="Encryption" value={algorithm} onChange={setAlgorithm} options={offeredAlgorithmIds} labels={offeredAlgorithmIds.map((id) => encryptionAlgorithms[id].label)} />
    {algorithm === "rc4-128" && (
      <p className="text-xs font-bold uppercase text-[var(--danger-fg)]">RC4 is broken and offers no real protection. Only pick it for a reader too old to handle AES.</p>
    )}
    <fieldset className="grid gap-2">
      <legend className="text-xs font-bold uppercase text-neutral-500">Allow anyone with the password to</legend>
      {permissionKeys.map((key) => (
        <Checkbox
          key={key}
          label={permissionLabels[key]}
          checked={Boolean(permissions[key])}
          onChange={(value) => setPermissions((current) => ({ ...current, [key]: value }))}
        />
      ))}
    </fieldset>
    <PrimaryButton label="Encrypt PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      if (!password) throw new Error("Enter a password to open the PDF with.");
      if (password !== confirmation) throw new Error("The two passwords do not match.");
      if (ownerPassword && ownerPassword === password) throw new Error("The owner password must be different from the open password.");
      const result = await encryptPdf(file, { userPassword: password, ownerPassword, algorithm, permissions });
      downloadBytes(result.bytes, withExtension(`${safeFilename(file.name)}-encrypted`, "pdf"), "application/pdf");
      const blocked = listPermissions(result.permissions as Record<string, boolean>, false);
      return `Encrypted with ${result.algorithm}.\n${blocked.length ? `Not allowed: ${blocked.join(", ")}.` : "All permissions allowed."}`;
    })} />
    {status.tone === "success" && <ResultConsequenceNote>Store the password somewhere safe — it cannot be recovered.</ResultConsequenceNote>}
  </ToolForm>;
}

function RemovePasswordTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState(initialStatus);

  const forgetPassword = () => setPassword("");
  useEffect(() => forgetPassword, []);

  return <ToolForm status={status} onReset={() => { setFiles([]); forgetPassword(); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      This decrypts a PDF you can already open, with a password you already know, and saves an identical copy that needs no password. Text, fonts, images, and structure are kept — nothing is turned into an image. It does not crack, guess, or bypass anything: a wrong password just fails. Use it only on documents you are entitled to decrypt.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PasswordField label="Current PDF password" value={password} onChange={setPassword} helper="Either the password that opens the PDF or its owner password will work." />
    <PrimaryButton label="Remove password" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      if (!password) throw new Error("Enter the PDF's current password.");
      const result = await decryptPdf(file, password);
      downloadBytes(result.bytes, withExtension(`${safeFilename(file.name)}-no-password`, "pdf"), "application/pdf");
      return `Removed ${result.algorithm} encryption from ${file.name}.`;
    })} />
    {status.tone === "success" && <ResultConsequenceNote>The copy waiting in the result panel opens without a password. Save it somewhere you would keep the unlocked version.</ResultConsequenceNote>}
  </ToolForm>;
}

function UnlockPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Some PDFs open freely but block printing, copying, or editing behind an owner password. This removes those restrictions and saves an unrestricted copy. It is not the same as Remove Password: if the PDF asks for a password just to open it, use Remove Password instead, with the password you already have. Use this only on documents you have the right to unlock.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PrimaryButton label="Unlock PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const result = await unlockPdf(file);
      downloadBytes(result.bytes, withExtension(`${safeFilename(file.name)}-unlocked`, "pdf"), "application/pdf");
      const restored = listPermissions(result.permissionsBefore as Record<string, boolean>, false);
      return `Removed ${result.algorithm} owner-password restrictions from ${file.name}.\n${restored.length ? `Restored: ${restored.join(", ")}.` : "That PDF was encrypted but had no restrictions set."}`;
    })} />
    {status.tone === "success" && <ResultConsequenceNote>The copy waiting in the result panel has its restrictions removed — printing, copying and editing are open to anyone who gets it.</ResultConsequenceNote>}
  </ToolForm>;
}

const CERT_FILE_OPTIONS = { maxFiles: 1, maxSize: 8 * 1024 * 1024, extensions: ["p12", "pfx"], types: ["application/x-pkcs12", "application/pkcs12"] };

function SignPdfTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [certFiles, setCertFiles] = useState<File[]>([]);
  const [password, setPassword] = useState("");
  const [signerName, setSignerName] = useState("");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [visible, setVisible] = useState(false);
  const [page, setPage] = useState("1");
  const [useTimestamp, setUseTimestamp] = useState(false);
  const [tsaUrl, setTsaUrl] = useState("");
  const [timestamped, setTimestamped] = useState(false);
  const [status, setStatus] = useState(initialStatus);

  // The certificate password lives only in this component's state — never
  // logged, persisted, or sent anywhere. Drop it on reset and on unmount.
  const forgetPassword = () => setPassword("");
  useEffect(() => forgetPassword, []);

  return <ToolForm status={status} onReset={() => {
    setFiles([]); setCertFiles([]); forgetPassword();
    setSignerName(""); setReason(""); setLocation(""); setVisible(false); setPage("1");
    setUseTimestamp(false); setTsaUrl(""); setTimestamped(false);
    setStatus(initialStatus);
  }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Applies a real cryptographic signature — a detached PKCS#7 / CMS SignedData over the document's bytes (SHA-256), added through an incremental update so any signatures already on the file stay valid. This is not a picture of a signature: it proves the document has not changed since signing and identifies the signer by their certificate. Signing runs entirely in this browser; the certificate and its password never leave this page. By default there is no trusted timestamp, so the signing time is self-asserted — turn on the optional RFC 3161 timestamp below to have a third-party authority attest the time.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} label="Choose the PDF to sign" />
    <FileControl accept=".p12,.pfx,application/x-pkcs12" files={certFiles} setFiles={setCertFiles} label="Choose your certificate (.p12 / .pfx)" />
    <PasswordField label="Certificate password" value={password} onChange={setPassword} helper="Held only in this page's memory — never logged, stored, or transmitted. Cleared when you reset or leave." />
    <Input label="Signer name (optional)" value={signerName} onChange={setSignerName} helper="Shown in the signature. Defaults to the certificate's common name." />
    <Input label="Reason (optional)" value={reason} onChange={setReason} placeholder="e.g. I approve this document" />
    <Input label="Location (optional)" value={location} onChange={setLocation} placeholder="e.g. Bengaluru, IN" />
    <Checkbox label="Add a visible signature block (lower-left of the chosen page)" checked={visible} onChange={setVisible} />
    {visible && <Input label="Page for the visible block" value={page} onChange={setPage} type="number" helper="1 is the first page." />}
    <div className="surface-muted wabi-card-edge grid gap-3 p-4 text-sm font-semibold leading-6 text-neutral-600">
      <Checkbox label="Add a trusted RFC 3161 timestamp (contacts a third-party TSA over the network)" checked={useTimestamp} onChange={setUseTimestamp} />
      {useTimestamp ? (
        <div className="grid gap-2">
          <p className="text-xs font-semibold text-neutral-500">
            This is the one network request signing makes, and only because you asked: a SHA-256 hash of your signature (never the document) is POSTed to the TSA you enter. The default Content-Security-Policy blocks all outbound connections, so a TSA only works on a deploy where you have added <span className="whitespace-pre">connect-src 'self' &lt;TSA origin&gt;</span> to index.html and public/_headers. If it is blocked, the error tells you exactly what to add. With the box unticked, signing stays 100% local.
          </p>
          <Input label="TSA URL (RFC 3161)" value={tsaUrl} onChange={setTsaUrl} placeholder="https://freetsa.org/tsr" helper="Your own or a public RFC 3161 timestamp authority endpoint." />
        </div>
      ) : (
        <p className="text-xs font-semibold text-neutral-500">Off: signing is 100% local and the signing time is self-asserted.</p>
      )}
    </div>
    <PrimaryButton label="Sign PDF" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const [cert] = validateFiles(certFiles, CERT_FILE_OPTIONS);
      if (!password) throw new Error("Enter the certificate password.");
      if (useTimestamp && !tsaUrl.trim()) throw new Error("Enter the TSA URL, or turn off the trusted timestamp.");
      const pageIndex = Math.max(1, parseInt(page, 10) || 1) - 1;
      const { signPdf } = await import("../services/pdf-sign.service.js");
      const result = await signPdf(file, {
        p12: cert, password,
        name: signerName.trim(), reason: reason.trim(), location: location.trim(),
        visible, pageIndex,
        timestamp: useTimestamp, tsaUrl: tsaUrl.trim(),
      });
      downloadBytes(result.bytes, withExtension(`${safeFilename(file.name)}-signed`, "pdf"), "application/pdf");
      setTimestamped(Boolean(result.timestamp));
      const trust = result.selfSigned
        ? "This certificate is self-signed, so a reader will report \"signature valid, signer identity unknown\" until you add the certificate to its trust store."
        : "A reader will mark the signer trusted only if it already trusts the certificate's issuing CA.";
      const where = result.visible ? ` A visible block was drawn on page ${result.signedPage} of ${result.pageCount}.` : "";
      const time = result.timestamp
        ? `TSA-attested time ${result.timestamp.time ? new Date(result.timestamp.time).toLocaleString() : "(granted)"} from ${result.timestamp.tsa || "the TSA"}.`
        : `Signing time (self-asserted) ${result.signingTime.toLocaleString()}.`;
      return `Signed as ${result.subjectCommonName || "the certificate holder"} · serial ${result.serialHex}.\nDetached PKCS#7/CMS, SHA-256. ${time}${where}\n${trust}`;
    })} />
    {status.tone === "success" && (timestamped
      ? <ResultConsequenceNote>This signature carries an RFC 3161 timestamp token, so the signing time is attested by the TSA rather than self-asserted — if that TSA is trusted. We verify the token's own signature and that it covers this signature, but not the TSA's trust chain (that is done offline, with no CA store). Whether a reader shows the signature as "trusted" still depends on that reader trusting the certificate's CA and the TSA's.</ResultConsequenceNote>
      : <ResultConsequenceNote>The signature proves document integrity and signer identity, but it is <strong>not</strong> timestamped by a trusted authority — the signing time is asserted by whoever signed. Turn on the RFC 3161 timestamp to have a TSA attest it. Whether a reader shows the signature as "trusted" depends on that reader trusting the certificate's CA.</ResultConsequenceNote>)}
  </ToolForm>;
}

const SIGNATURE_VERDICTS: Record<string, { label: string; tone: string }> = {
  valid: { label: "Valid — document unchanged since signing", tone: "border-[var(--success)] bg-[var(--success-bg)] text-[var(--success-fg)]" },
  "valid-partial": { label: "Valid for the signed revision — bytes were added afterwards", tone: "border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning-fg)]" },
  modified: { label: "Document MODIFIED after signing", tone: "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger-fg)]" },
  invalid: { label: "Signature INVALID", tone: "border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger-fg)]" },
  unsupported: { label: "Not verified (unsupported key type)", tone: "border-[var(--line)] bg-[var(--paper-soft)] text-[var(--stone)]" },
};

function SignatureCard({ sig, index }: { sig: any; index: number }) {
  const verdict = SIGNATURE_VERDICTS[sig.verdict] || SIGNATURE_VERDICTS.invalid;
  const fmtDate = (value: any) => {
    if (!value) return "—";
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  };
  return (
    <div className="surface-card grid gap-3 rounded-3xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase text-neutral-500">Signature {index + 1} · field {sig.fieldName}</span>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${verdict.tone}`}>{verdict.label}</span>
      </div>
      <p className="text-sm font-semibold leading-6 text-[var(--foreground)]">{sig.detail}</p>
      <dl className="grid gap-2 text-sm">
        <InfoRow label="Signer (CN)" value={sig.subjectCommonName || "—"} />
        <InfoRow label="Issuer (CN)" value={`${sig.issuerCommonName || "—"}${sig.selfSigned ? " · self-signed" : ""}`} />
        <InfoRow label="Serial" value={sig.serialHex || "—"} />
        <InfoRow label="Certificate valid" value={`${fmtDate(sig.notBefore)} → ${fmtDate(sig.notAfter)}${sig.certExpired ? " · EXPIRED" : sig.certNotYetValid ? " · NOT YET VALID" : ""}`} />
        <InfoRow label="Signing time" value={sig.signingTime ? fmtDate(sig.signingTime) : (sig.declaredSigningTime || "—")} />
        <InfoRow label="Timestamp" value={sig.timestamp?.present
          ? (sig.timestamp.imprintMatches === false
              ? "Timestamp present — imprint mismatch (the token does not cover this signature)"
              : sig.timestamp.imprintMatches && sig.timestamp.tokenSignatureValid
                ? `TSA-attested ${sig.timestamp.genTime ? fmtDate(sig.timestamp.genTime) : "(time unreadable)"}${sig.timestamp.tsaCommonName ? ` · ${sig.timestamp.tsaCommonName}` : ""}`
                : "Timestamp present — issuer signature not verified (the token's own signature did not check out)")
          : "None — signing time is self-asserted"} />
        <InfoRow label="Digest" value={`${sig.hashName || "SHA-256"} · integrity ${sig.integrity ? "matches" : "MISMATCH"}`} />
        <InfoRow label="Coverage" value={sig.coversWholeDocument ? "entire document" : "part of the document (additions after signing)"} />
        <InfoRow label="Type" value={sig.subFilter || "adbe.pkcs7.detached"} />
      </dl>
      {/*
        The service has always computed these — an expired certificate, an
        unhashed hole in the /ByteRange, an audit trail redefined after signing —
        and nothing rendered them. A verifier that works out exactly why a
        signature cannot be trusted and then shows a green badge is worse than
        one that never checked.
      */}
      {Array.isArray(sig.tamperFindings) && sig.tamperFindings.length > 0 && (
        <div className={`grid gap-1 rounded-2xl border p-3 text-sm font-semibold leading-6 ${verdictTone("caution")}`}>
          <p className="text-xs font-bold uppercase tracking-wide">Findings</p>
          {sig.tamperFindings.map((line: string, i: number) => <p key={i}>{line}</p>)}
        </div>
      )}
    </div>
  );
}

function VerifySignatureTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<any | null>(null);
  const [status, setStatus] = useState(initialStatus);

  return <ToolForm status={status} onReset={() => { setFiles([]); setReport(null); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Checks the digital signatures in a PDF. For each one it recomputes the SHA-256 digest over the signed byte ranges, verifies the PKCS#7 / CMS signature against the signer's certificate, and reports who signed, when, and whether the document changed after signing — all in this browser.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={setFiles} />
    <PrimaryButton label="Verify signatures" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      setReport(null);
      const { verifyPdfSignatures } = await import("../services/pdf-sign.service.js");
      const result = await verifyPdfSignatures(file);
      setReport(result);
      if (!result.count) return "No digital signatures found in this PDF.";
      const good = result.signatures.filter((s: any) => s.verdict === "valid").length;
      const bad = result.signatures.filter((s: any) => s.verdict === "modified" || s.verdict === "invalid").length;
      return `Found ${result.count} signature${result.count === 1 ? "" : "s"}: ${good} valid, ${bad} failing.`;
    })} />
    {report && report.count > 0 && (
      <div className="grid gap-3">
        {report.signatures.map((sig: any, index: number) => <SignatureCard key={index} sig={sig} index={index} />)}
      </div>
    )}
    <ResultConsequenceNote>This is an offline check. It proves the signature maths and the signer certificate's self-consistency only. It does <strong>not</strong> validate a trust chain to a trusted root (no certificate-authority store is bundled) and does <strong>not</strong> check revocation (no OCSP/CRL lookup — that would require network access, which this tool never uses). "Valid" here means the cryptography holds and the document is unchanged, not that the signer's identity has been vouched for by a CA.</ResultConsequenceNote>
  </ToolForm>;
}

type EsignSettings = ReturnType<typeof readEsignSettings>;

/**
 * Optional "send for signature" backend, stored in localStorage on this device.
 * Off by default. While it is off, the Request e-Signature tool uploads nothing.
 * This is the one place in MyFileKit where a selected PDF leaves the device, and
 * only to a backend the operator has deployed and added to connect-src.
 */
function EsignBackendPanel({ settings, onChange }: { settings: EsignSettings; onChange: (next: EsignSettings) => void }) {
  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [panelStatus, setPanelStatus] = useState(initialStatus);
  const configured = isEsignConfigured(settings);
  const origin = backendOrigin(settings.baseUrl);

  return (
    <div className="surface-muted wabi-card-edge grid gap-3 p-4 text-sm font-semibold leading-6 text-neutral-600">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase text-neutral-500">Signing backend — {configured ? "on" : "off"}</p>
        <button className="secondary-button" type="button" onClick={() => setOpen(!open)}>{open ? "Hide settings" : "Settings"}</button>
      </div>
      <p>
        {configured
          ? `Your own signing backend is switched on. When you press Send for signature, the PDF is uploaded to ${origin} and is no longer local. Nothing is sent until you press it.`
          : "This tool is inactive until you point it at your own signing backend. Until you do, no PDF is uploaded and nothing leaves this device."}
      </p>
      {open && (
        <div className="grid gap-3">
          <p className="text-xs font-semibold text-neutral-500">
            The backend base URL and any API key are stored only in this browser's localStorage. The key is never placed in a URL and is only ever sent as an Authorization header to the backend you enter.
            MyFileKit ships a strict Content-Security-Policy that blocks every outbound connection, so a signing backend only works on a deploy where you have added
            <span className="whitespace-pre"> connect-src 'self' &lt;your origin&gt; </span>
            to index.html and public/_headers. See docs/TIER3-OPTIONAL-BACKEND.md and reference-backend/ for a deployable reference implementation.
          </p>
          <Input label="Backend base URL" value={baseUrl} onChange={setBaseUrl} placeholder="https://esign.example.com" helper="Envelopes are POSTed to <base URL>/envelopes." />
          <Input label="API key (optional)" value={apiKey} onChange={setApiKey} type="password" helper={settings.apiKey ? `Saved key: ${maskEsignApiKey(settings.apiKey)}. Leave blank to keep it.` : "Only if your backend requires one. Stored on this device only."} />
          <StatusBox status={panelStatus} />
          <div className="flex flex-wrap gap-2">
            <SecondaryButton label="Save and enable" onClick={() => runSafely(setPanelStatus, async () => {
              const next = saveEsignSettings({ enabled: true, baseUrl, apiKey: apiKey || settings.apiKey });
              onChange(next);
              setApiKey("");
              return `Enabled. Sending for signature will upload the PDF to ${backendOrigin(next.baseUrl)}.`;
            })} />
            <SecondaryButton label="Turn off and forget" onClick={() => runSafely(setPanelStatus, async () => {
              onChange(clearEsignSettings());
              setBaseUrl("");
              setApiKey("");
              return "Backend cleared. The tool uploads nothing again.";
            })} />
          </div>
        </div>
      )}
    </div>
  );
}

type EnvelopeResult = { id: string; status: string; signers: number };

/**
 * Request e-Signature: the client for an operator-hosted send-for-signature
 * workflow. This is the ONE tool that uploads the selected PDF off the device,
 * and only to the operator's own configured backend. Off by default; the
 * esign.service gate refuses before any fetch until a backend is configured.
 */
function RequestSignatureTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [signersText, setSignersText] = useState("");
  const [message, setMessage] = useState("");
  const [settings, setSettings] = useState<EsignSettings>(() => readEsignSettings());
  const [result, setResult] = useState<EnvelopeResult | null>(null);
  const [trackingId, setTrackingId] = useState("");
  const [statusReport, setStatusReport] = useState<{ id: string; status: string; signers: any[] } | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const configured = isEsignConfigured(settings);
  const origin = backendOrigin(settings.baseUrl);

  const reset = () => {
    setFiles([]);
    setSignersText("");
    setMessage("");
    setResult(null);
    setTrackingId("");
    setStatusReport(null);
    setStatus(initialStatus);
  };

  return <ToolForm sends="Uploads the whole PDF to the signing backend you configure. Off until you set one up." status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Send a PDF to other people to sign, through a signing backend <strong>you</strong> deploy. Unlike every other tool in MyFileKit, this one <strong>uploads your PDF off this device</strong> — to the backend you configure below and nowhere else. It is <strong>off by default</strong>: until you configure a backend, nothing is uploaded and no envelope is created. This is a scaffold client, not a hosted service; see reference-backend/ and docs/TIER3-OPTIONAL-BACKEND.md to stand one up.
    </div>
    <FileControl accept="application/pdf" files={files} setFiles={(next) => { setFiles(next); setResult(null); }} label="Choose the PDF to send for signature" />
    <Textarea label="Signer emails (one per line, or comma-separated)" value={signersText} onChange={setSignersText} rows={4} />
    <Textarea label="Message to signers (optional)" value={message} onChange={setMessage} rows={3} />
    <EsignBackendPanel settings={settings} onChange={setSettings} />
    {configured ? (
      <PrimaryButton label={`Send for signature (uploads the PDF to ${origin})`} onClick={() => runSafely(setStatus, async () => {
        const [file] = validateFiles(files, tool.file);
        const signers = parseSigners(signersText);
        const bytes = new Uint8Array(await file.arrayBuffer());
        setStatus({ tone: "idle", message: `Uploading ${file.name} to ${origin}…` });
        const envelope = await requestEnvelope({
          settings,
          file: { fileName: safeFilename(file.name) + ".pdf", contentType: "application/pdf", bytes },
          signers,
          message,
        });
        setResult(envelope);
        setTrackingId(envelope.id);
        setStatusReport(null);
        return `Envelope sent to ${envelope.signers} signer${envelope.signers === 1 ? "" : "s"}. Tracking id: ${envelope.id} (status: ${envelope.status}).`;
      })} />
    ) : (
      <StatusBox status={{ tone: "idle", message: "Configure your signing backend above to enable sending. Until then, this tool uploads nothing." }} />
    )}
    {result && (
      <div className="surface-card grid gap-2 rounded-3xl p-5">
        <p className="text-xs font-bold uppercase text-neutral-500">Envelope — uploaded to your backend</p>
        <InfoRow label="Tracking id" value={result.id} />
        <InfoRow label="Status" value={result.status} />
        <InfoRow label="Signers" value={String(result.signers)} />
      </div>
    )}
    {configured && (
      <div className="grid gap-3">
        <Input label="Check envelope status by tracking id" value={trackingId} onChange={setTrackingId} placeholder="envelope id from a previous send" />
        <SecondaryButton label={`Check status (asks ${origin})`} onClick={() => runSafely(setStatus, async () => {
          const report = await getEnvelopeStatus({ settings, id: trackingId });
          setStatusReport(report);
          return `Envelope ${report.id} is "${report.status}".`;
        })} />
        {statusReport && (
          <div className="surface-muted wabi-card-edge grid gap-2 p-4">
            <p className="text-xs font-bold uppercase text-neutral-500">Status — from your backend</p>
            <InfoRow label="Envelope" value={statusReport.id} />
            <InfoRow label="Status" value={statusReport.status} />
            {statusReport.signers.map((signer: any, index: number) => (
              <InfoRow key={index} label={`Signer ${index + 1}`} value={`${signer?.email || "?"} — ${signer?.status || "pending"}`} />
            ))}
          </div>
        )}
      </div>
    )}
    <ResultConsequenceNote>This is the only MyFileKit tool that uploads your file. The PDF and the signer email addresses are sent to the backend at <strong>{origin || "the backend you configure"}</strong>, which then holds that data — MyFileKit does not. Only send documents you are entitled to upload there, and make sure that backend encrypts at rest, serves over TLS, and has a retention policy you trust.</ResultConsequenceNote>
  </ToolForm>;
}

function MetadataCleanerTool({ tool }: { tool: Tool }) {
  return <ImageMetadataTool tool={tool} canClean />;
}

export default function SecurityTools({ tool }: { tool: Tool }) {
  if (tool.id === "pdf-metadata-cleaner-tool") return <PdfMetadataCleanerTool tool={tool} />;
  if (tool.id === "auto-redact-pii-tool") return <AutoRedactPiiTool tool={tool} />;
  if (tool.id === "privacy-scanner-tool") return <PrivacyScannerTool tool={tool} />;
  if (tool.id === "pdf-analyzer-tool") return <PdfAnalyzerTool tool={tool} />;
  if (tool.id === "sanitize-pdf-tool") return <SanitizePdfTool tool={tool} />;
  if (tool.id === "fingerprint-pdf-tool") return <FingerprintPdfTool tool={tool} />;
  if (tool.id === "encrypt-pdf-tool") return <EncryptPdfTool tool={tool} />;
  if (tool.id === "remove-password-tool") return <RemovePasswordTool tool={tool} />;
  if (tool.id === "unlock-pdf-tool") return <UnlockPdfTool tool={tool} />;
  if (tool.id === "sign-pdf-tool") return <SignPdfTool tool={tool} />;
  if (tool.id === "verify-signature-tool") return <VerifySignatureTool tool={tool} />;
  if (tool.id === "request-signature-tool") return <RequestSignatureTool tool={tool} />;
  if (tool.id === "metadata-cleaner") return <MetadataCleanerTool tool={tool} />;
  return <StatusBox status={{ tone: "error", message: "This tool renderer is missing." }} />;
}
