// Sanitize PDF — the active counterpart to the read-only PDF Analyser.
//
// Where the Analyser (pdf-analyzer.service.js) reads bytes and REPORTS active
// content, this module OPENS the PDF with pdf-lib and REMOVES it at the object
// level, then reports exactly what it stripped. The two agree on "what is a
// threat": every category Sanitize removes maps to an indicator the Analyser
// flags (see SANITIZED_ANALYZER_INDICATORS / residualActiveContent), so after a
// sanitise the Analyser reports none of them. Pure pdf-lib, so Node-testable.

import { getPdfLib } from "./pdf.service.js";

// Human-readable label per removal category (used by the UI and the .txt report).
export const SANITIZE_CATEGORIES = {
  openAction: "Document open action (/OpenAction)",
  additionalActions: "Additional actions (/AA)",
  documentJavaScript: "Document-level JavaScript (/Names /JavaScript)",
  actionScripts: "JavaScript / Launch / SubmitForm / ImportData / Rendition actions",
  embeddedFiles: "Embedded files / attachments",
  richMedia: "RichMedia / 3D / Movie / Screen / Sound annotations",
};

// The Analyser indicators that Sanitize is responsible for removing. The Sanitize
// UI and the tests filter an Analyser report to these to prove agreement: after
// a sanitise, the Analyser must report none of them.
export const SANITIZED_ANALYZER_INDICATORS = [
  "/OpenAction",
  "/AA (additional actions)",
  "Embedded JavaScript (/JS, /JavaScript)",
  "/Launch action",
  "/SubmitForm",
  "/ImportData",
  "/Rendition",
  "/Movie",
  "/Sound",
  "Embedded file (/EmbeddedFile)",
  "/RichMedia",
  "AcroForm with JavaScript",
];

/** Filters an Analyser report to the active-content findings Sanitize removes. */
export function residualActiveContent(analyzerReport) {
  const set = new Set(SANITIZED_ANALYZER_INDICATORS);
  return (analyzerReport?.findings || []).filter((finding) => set.has(finding.indicator));
}

// Action /S sub-types that execute code, launch programs, or exfiltrate data.
const DANGEROUS_ACTIONS = new Set(["JavaScript", "Launch", "SubmitForm", "ImportData", "Rendition"]);
// Annotation /Subtype values that embed or trigger multimedia / 3D execution.
const MULTIMEDIA_ANNOTS = new Set(["RichMedia", "Screen", "Movie", "Sound", "3D"]);

function isRef(value) {
  return value !== null && typeof value === "object" && "objectNumber" in value;
}

function nameString(value) {
  return value ? String(value).replace(/^\//, "") : null;
}

const ENCRYPTED_MESSAGE =
  "This PDF is encrypted. Remove the password first (use Remove Password), then run Sanitize PDF.";

/**
 * Strips active-content threats from a PDF at the pdf-lib object level and reports
 * exactly what was removed. Refuses encrypted input.
 *
 * @param {Uint8Array|ArrayBuffer|{arrayBuffer:Function}} input
 * @param {{ removeAttachments?: boolean }} [options]  removeAttachments defaults to true
 * @returns {Promise<{ bytes: Uint8Array, report: { counts: object, removed: {category,label,count}[], total: number, clean: boolean, removeAttachments: boolean } }>}
 */
export async function sanitizePdf(input, options = {}) {
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream } = getPdfLib();
  const removeAttachments = options.removeAttachments !== false;
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input instanceof ArrayBuffer ? input : await input.arrayBuffer());

  let pdf;
  try {
    pdf = await PDFDocument.load(bytes);
  } catch (error) {
    if (/encrypt/i.test(String(error?.message))) throw new Error(ENCRYPTED_MESSAGE);
    throw error;
  }
  if (pdf.isEncrypted) throw new Error(ENCRYPTED_MESSAGE);

  const ctx = pdf.context;
  const catalog = pdf.catalog;
  const counts = { openAction: 0, additionalActions: 0, documentJavaScript: 0, actionScripts: 0, embeddedFiles: 0, richMedia: 0 };

  // Unlink a key from a dict without freeing the referenced object — the sweep
  // below deletes and counts orphaned action / attachment objects, so unlinking
  // (not deleting) here keeps each removal counted exactly once.
  const unlink = (dict, keyName) => {
    if (!dict || typeof dict.get !== "function") return false;
    const key = PDFName.of(keyName);
    if (dict.get(key) === undefined) return false;
    dict.delete(key);
    return true;
  };

  const actionTypeOf = (value) => {
    const dict = ctx.lookup(value);
    if (!(dict instanceof PDFDict)) return null;
    return nameString(dict.get(PDFName.of("S")));
  };

  // --- 1. Document catalog: OpenAction, additional actions, name trees --------
  if (unlink(catalog, "OpenAction")) counts.openAction += 1;
  if (unlink(catalog, "AA")) counts.additionalActions += 1;

  const names = ctx.lookup(catalog.get(PDFName.of("Names")));
  if (names instanceof PDFDict) {
    if (unlink(names, "JavaScript")) counts.documentJavaScript += 1;
    if (removeAttachments) unlink(names, "EmbeddedFiles"); // Filespec objects are counted in the sweep.
  }

  // --- 2. Pages: page additional actions and annotations ----------------------
  for (const page of pdf.getPages()) {
    const node = page.node;
    if (unlink(node, "AA")) counts.additionalActions += 1;

    const annots = ctx.lookup(node.get(PDFName.of("Annots")));
    if (!(annots instanceof PDFArray)) continue;
    const keep = [];
    for (let i = 0; i < annots.size(); i += 1) {
      const entry = annots.get(i);
      const annot = ctx.lookup(entry);
      if (!(annot instanceof PDFDict)) {
        keep.push(entry);
        continue;
      }
      const subtype = nameString(annot.get(PDFName.of("Subtype")));
      if (MULTIMEDIA_ANNOTS.has(subtype)) {
        if (isRef(entry)) ctx.delete(entry);
        counts.richMedia += 1;
        continue; // drop from the rebuilt array
      }
      if (subtype === "FileAttachment" && removeAttachments) {
        if (isRef(entry)) ctx.delete(entry); // its Filespec is deleted + counted in the sweep
        continue;
      }
      if (unlink(annot, "AA")) counts.additionalActions += 1;
      if (DANGEROUS_ACTIONS.has(actionTypeOf(annot.get(PDFName.of("A"))))) unlink(annot, "A");
      keep.push(entry);
    }
    if (keep.length !== annots.size()) {
      const rebuilt = PDFArray.withContext(ctx);
      for (const ref of keep) rebuilt.push(ref);
      node.set(PDFName.of("Annots"), rebuilt);
    }
  }

  // --- 3. AcroForm fields: additional actions ---------------------------------
  const acroForm = ctx.lookup(catalog.get(PDFName.of("AcroForm")));
  if (acroForm instanceof PDFDict) {
    const stack = [];
    const fields = ctx.lookup(acroForm.get(PDFName.of("Fields")));
    if (fields instanceof PDFArray) for (let i = 0; i < fields.size(); i += 1) stack.push(fields.get(i));
    let guard = 0;
    while (stack.length && guard < 10000) {
      guard += 1;
      const field = ctx.lookup(stack.pop());
      if (!(field instanceof PDFDict)) continue;
      if (unlink(field, "AA")) counts.additionalActions += 1;
      if (DANGEROUS_ACTIONS.has(actionTypeOf(field.get(PDFName.of("A"))))) unlink(field, "A");
      const kids = ctx.lookup(field.get(PDFName.of("Kids")));
      if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i += 1) stack.push(kids.get(i));
    }
  }

  // --- 4. Sweep every indirect object: delete dangerous actions + attachments -
  for (const [ref, obj] of [...ctx.enumerateIndirectObjects()]) {
    if (obj instanceof PDFRawStream) {
      if (removeAttachments && String(obj.dict?.get?.(PDFName.of("Type"))) === "/EmbeddedFile") ctx.delete(ref);
      continue;
    }
    if (!(obj instanceof PDFDict)) continue;
    const actionType = nameString(obj.get(PDFName.of("S")));
    if (DANGEROUS_ACTIONS.has(actionType)) {
      const js = obj.get(PDFName.of("JS"));
      if (isRef(js)) ctx.delete(js); // the JavaScript code stream/string object
      ctx.delete(ref);
      counts.actionScripts += 1;
      continue;
    }
    if (removeAttachments && String(obj.get(PDFName.of("Type"))) === "/Filespec") {
      ctx.delete(ref);
      counts.embeddedFiles += 1;
    }
  }

  const outBytes = await pdf.save({ useObjectStreams: false, updateMetadata: false });
  const removed = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([category, count]) => ({ category, label: SANITIZE_CATEGORIES[category], count }));
  const total = removed.reduce((sum, item) => sum + item.count, 0);
  return { bytes: outBytes, report: { counts, removed, total, clean: total === 0, removeAttachments } };
}

/** Builds the downloadable plain-text removal report. Pure. */
export function buildSanitizeReportText(report, meta = {}) {
  const rows = [];
  rows.push("MyFileKit — Sanitize PDF (active-content removal report)");
  rows.push("Processed entirely in the browser. The file was never uploaded.");
  if (meta.fileName) rows.push(`File: ${String(meta.fileName)}`);
  rows.push(`Attachments: ${report.removeAttachments ? "removed" : "kept"}`);
  rows.push("");
  if (report.clean) {
    rows.push("VERDICT: Nothing to remove — no active-content threats were found.");
    return `${rows.join("\n")}\n`;
  }
  rows.push(`VERDICT: Removed ${report.total} active-content item(s).`);
  rows.push("");
  rows.push("== Removed ==");
  for (const item of report.removed) rows.push(`  ${item.count} × ${item.label}`);
  rows.push("");
  rows.push("Sanitize removes the same active-content categories the PDF Analyser flags,");
  rows.push("so re-analysing the cleaned file reports none of them. This does not decode");
  rows.push("or neutralise exploits hidden in image/font parsers or encrypted streams.");
  return `${rows.join("\n")}\n`;
}
