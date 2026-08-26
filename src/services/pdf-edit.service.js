import { getPdfLib, loadPdf, textToPdf } from "./pdf.service.js";
import { rasterRebuild } from "./pdf-render.service.js";

// Common page sizes in PDF points (1pt = 1/72 inch).
export const PAGE_SIZES = {
  A4: [595.28, 841.89],
  A3: [841.89, 1190.55],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008],
};

function mmToPoints(mm) {
  return (finiteNumber(mm, "Measurement") * 72) / 25.4;
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a valid number.`);
  return number;
}

function positiveNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number <= 0) throw new Error(`${label} must be greater than zero.`);
  return number;
}

function nonNegativeNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number < 0) throw new Error(`${label} cannot be negative.`);
  return number;
}

// pdf-lib's standard fonts only cover WinAnsi (Latin-1). Turn its cryptic
// "WinAnsi cannot encode ..." error into a clear, user-facing message. Mirrors
// the helper pattern in pdf.service.js.
function drawTextSafe(page, text, options) {
  try {
    page.drawText(text, options);
  } catch (error) {
    throw latin1Error(error);
  }
}

// Measuring text throws the very same encoding error as drawing it, so any
// measurement taken before drawTextSafe needs the same guard.
function measureSafe(font, text, size) {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch (error) {
    throw latin1Error(error);
  }
}

function latin1Error(error, fieldName) {
  if (/cannot encode|WinAnsi/i.test(String(error?.message))) {
    const where = fieldName ? ` Check the "${fieldName}" field.` : "";
    return new Error(`This PDF text tool supports Latin-1 characters only (no CJK/emoji).${where}`);
  }
  return error;
}

/**
 * Parses an order string like "3,1,2,5-7" into zero-based page indexes. Supports
 * reordering, duplication, and (by omission) deletion. Ranges may ascend or
 * descend. Pure function — unit-testable in Node.
 */
export function parsePageOrder(orderString, pageCount) {
  const value = String(orderString || "").trim();
  if (!value) throw new Error("Enter a page order, e.g. 3,1,2,5-7.");
  const indexes = [];
  const assertInRange = (page) => {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new Error(`Page ${page} is outside 1–${pageCount}.`);
    }
  };
  for (const rawPart of value.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      assertInRange(start);
      assertInRange(end);
      const step = start <= end ? 1 : -1;
      for (let page = start; step > 0 ? page <= end : page >= end; page += step) indexes.push(page - 1);
    } else if (/^\d+$/.test(part)) {
      const page = Number(part);
      assertInRange(page);
      indexes.push(page - 1);
    } else {
      throw new Error(`"${part}" is not a valid page or range.`);
    }
  }
  if (!indexes.length) throw new Error("Enter at least one page.");
  return indexes;
}

/** Rebuilds a PDF with its pages reordered / duplicated / deleted. */
export async function organizePdfPages(file, orderString) {
  const { PDFDocument } = getPdfLib();
  const source = await loadPdf(file);
  const order = parsePageOrder(orderString, source.getPageCount());
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, order);
  pages.forEach((page) => output.addPage(page));
  return output.save();
}

/**
 * Scales pages to a target size (preset or custom mm) or applies a uniform
 * margin crop via the page media/crop boxes.
 */
export async function cropResizePdf(file, options = {}) {
  const { mode = "resize", size = "A4", customWidthMm, customHeightMm, marginMm = 10 } = options;
  const pdf = await loadPdf(file);
  const pages = pdf.getPages();

  if (mode === "crop") {
    const margin = mmToPoints(nonNegativeNumber(marginMm, "Margin"));
    pages.forEach((page) => {
      const { width, height } = page.getSize();
      const w = width - margin * 2;
      const h = height - margin * 2;
      if (w <= 0 || h <= 0) throw new Error("Margin is too large for this page size.");
      page.setCropBox(margin, margin, w, h);
      page.setMediaBox(margin, margin, w, h);
    });
    return pdf.save();
  }

  let target;
  if (size === "custom") {
    target = [mmToPoints(positiveNumber(customWidthMm, "Custom width")), mmToPoints(positiveNumber(customHeightMm, "Custom height"))];
  } else {
    target = PAGE_SIZES[size];
    if (!target) throw new Error("Choose a valid page size.");
  }
  pages.forEach((page) => {
    const { width, height } = page.getSize();
    page.scale(target[0] / width, target[1] / height);
  });
  return pdf.save();
}

/**
 * Draws a header and/or footer on every page. Supports left/center/right
 * alignment and {n}/{total} page-number tokens.
 */
export async function addHeadersFooters(file, options = {}) {
  const { StandardFonts, rgb } = getPdfLib();
  const header = String(options.header || "");
  const footer = String(options.footer || "");
  if (!header.trim() && !footer.trim()) throw new Error("Enter header and/or footer text.");
  const align = ["left", "center", "right"].includes(options.align) ? options.align : "center";
  const size = positiveNumber(options.fontSize ?? 10, "Font size");
  const margin = nonNegativeNumber(options.margin ?? 28, "Margin");

  const pdf = await loadPdf(file);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const total = pages.length;
  const color = rgb(0.12, 0.16, 0.24);

  const resolve = (template, pageNumber) => template.replace(/\{n\}/g, String(pageNumber)).replace(/\{total\}/g, String(total));
  const xFor = (text, width) => {
    if (align === "left") return margin;
    const textWidth = measureSafe(font, text, size);
    if (align === "right") return Math.max(margin, width - margin - textWidth);
    return Math.max(margin, (width - textWidth) / 2);
  };

  pages.forEach((page, index) => {
    const { width, height } = page.getSize();
    if (header.trim()) {
      const text = resolve(header, index + 1);
      drawTextSafe(page, text, { x: xFor(text, width), y: height - margin, size, font, color });
    }
    if (footer.trim()) {
      const text = resolve(footer, index + 1);
      drawTextSafe(page, text, { x: xFor(text, width), y: margin, size, font, color });
    }
  });
  return pdf.save();
}

/**
 * Reads AcroForm fields as plain descriptors the UI can render. Returns an empty
 * array when the PDF has no interactive form.
 */
export async function readPdfFormFields(file) {
  const { PDFTextField, PDFCheckBox } = getPdfLib();
  const pdf = await loadPdf(file);
  const fields = pdf.getForm().getFields();
  return fields.map((field) => {
    const name = field.getName();
    if (field instanceof PDFTextField) {
      return { name, type: "text", value: field.getText() || "" };
    }
    if (field instanceof PDFCheckBox) {
      return { name, type: "checkbox", checked: field.isChecked() };
    }
    return { name, type: "unsupported" };
  });
}

/**
 * Sets text/checkbox field values and optionally flattens the form so the values
 * become permanent page content.
 */
export async function fillPdfForm(file, values = {}, flatten = false) {
  const { PDFTextField, PDFCheckBox } = getPdfLib();
  const pdf = await loadPdf(file);
  const form = pdf.getForm();
  const fields = form.getFields();
  if (!fields.length) throw new Error("This PDF has no fillable form fields.");

  const filled = [];
  for (const field of fields) {
    const name = field.getName();
    if (!(name in values)) continue;
    try {
      if (field instanceof PDFTextField) {
        field.setText(String(values[name] ?? ""));
        filled.push(name);
      } else if (field instanceof PDFCheckBox) {
        if (values[name]) field.check();
        else field.uncheck();
      }
    } catch (error) {
      throw latin1Error(error, name);
    }
  }
  // pdf-lib builds field appearances during flatten/save, so the encoding error
  // surfaces here rather than at setText — name the field that caused it.
  try {
    if (flatten) form.flatten();
    return await pdf.save();
  } catch (error) {
    throw latin1Error(error, filled.find((name) => [...String(values[name] ?? "")].some((char) => char.codePointAt(0) > 0xff)));
  }
}

/**
 * Builds a PDF from scratch: either blank pages of a chosen size/count, or text
 * that is wrapped into pages (reusing pdf.service textToPdf).
 */
export async function createPdf(options = {}) {
  const { mode = "blank", size = "A4", count = 1, text = "" } = options;
  if (mode === "text") return textToPdf(text);

  const { PDFDocument } = getPdfLib();
  const dimensions = size === "custom"
    ? [mmToPoints(positiveNumber(options.customWidthMm, "Custom width")), mmToPoints(positiveNumber(options.customHeightMm, "Custom height"))]
    : PAGE_SIZES[size];
  if (!dimensions) throw new Error("Choose a valid page size.");
  const pageCount = Math.floor(finiteNumber(count, "Page count"));
  if (pageCount < 1) throw new Error("Enter a page count of at least 1.");
  if (pageCount > 200) throw new Error("Choose 200 pages or fewer.");

  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index++) pdf.addPage([dimensions[0], dimensions[1]]);
  return pdf.save();
}

/** Generates a random, URL-safe hex fingerprint id. */
export function generateFingerprintId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Embeds an invisible, traceable identifier into a PDF via metadata (Producer,
 * Keywords, and a custom Info field). Non-destructive to visible page content.
 * Returns the new bytes plus the generated id.
 */
export async function fingerprintPdf(file, options = {}) {
  const { PDFName, PDFString } = getPdfLib();
  const id = options.id || generateFingerprintId();
  const pdf = await loadPdf(file);

  const existingKeywords = pdf.getKeywords();
  const keywords = [`mfk-fpid:${id}`];
  if (existingKeywords) keywords.unshift(existingKeywords);
  pdf.setKeywords(keywords);
  pdf.setProducer(`MyFileKit Fingerprint ${id}`);

  // Also store it as a dedicated custom Info dictionary entry.
  const infoRef = pdf.context.trailerInfo.Info;
  const infoDict = infoRef ? pdf.context.lookup(infoRef) : undefined;
  if (infoDict && typeof infoDict.set === "function") {
    infoDict.set(PDFName.of("MyFileKitFingerprint"), PDFString.of(id));
  }

  // Save without updateMetadata so pdf-lib does not overwrite our Producer.
  const bytes = await pdf.save({ updateMetadata: false });
  return { bytes, id };
}

/**
 * Permanently redacts rectangles (page + x,y,w,h in %) by painting opaque black
 * boxes onto rasterised pages. Reuses pdf-render rasterRebuild so the covered
 * content is truly gone (the output is flattened to images). Browser-only.
 */
export async function redactPdf(file, rects, { dpi = 150, onProgress } = {}) {
  const list = Array.isArray(rects) ? rects : [];
  if (!list.length) throw new Error("Add at least one redaction area.");

  const byPage = new Map();
  for (const rect of list) {
    const page = Math.floor(finiteNumber(rect.page, "Page"));
    if (page < 1) throw new Error("Redaction page must be 1 or greater.");
    const x = clampPercent(rect.x, "X");
    const y = clampPercent(rect.y, "Y");
    const w = positiveNumber(rect.w, "Width");
    const h = positiveNumber(rect.h, "Height");
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page).push({ x, y, w, h });
  }

  return rasterRebuild(file, {
    format: "png",
    dpi,
    onProgress,
    transform: (canvas, context, pageNumber) => {
      const rectsForPage = byPage.get(pageNumber);
      if (!rectsForPage) return;
      context.fillStyle = "#000000";
      for (const rect of rectsForPage) {
        context.fillRect(
          (rect.x / 100) * canvas.width,
          (rect.y / 100) * canvas.height,
          (rect.w / 100) * canvas.width,
          (rect.h / 100) * canvas.height
        );
      }
    },
  });
}

/**
 * Best-effort repair: loads leniently with pdf-lib and re-saves a normalised
 * copy. If pdf-lib cannot parse the file at all, falls back to pdf.js to
 * rebuild whatever pages it can render. Returns bytes plus a human summary of
 * what was recovered.
 */
export async function repairPdf(file, { dpi = 150, onProgress } = {}) {
  const { PDFDocument } = getPdfLib();
  try {
    const pdf = await PDFDocument.load(await file.arrayBuffer(), {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
      updateMetadata: false,
    });
    const pageCount = pdf.getPageCount();
    if (!pageCount) throw new Error("No readable pages found.");
    const bytes = await pdf.save({ useObjectStreams: true });
    return { bytes, method: "pdf-lib", pages: pageCount, message: `Re-saved a normalised copy with ${pageCount} page${pageCount === 1 ? "" : "s"}.` };
  } catch (pdfLibError) {
    // pdf-lib gave up — try to rebuild from rasterised pages via pdf.js.
    try {
      const bytes = await rasterRebuild(file, { format: "png", dpi, onProgress });
      const { PDFDocument: OutDoc } = getPdfLib();
      const rebuilt = await OutDoc.load(bytes);
      const pages = rebuilt.getPageCount();
      return { bytes, method: "pdf.js", pages, message: `pdf-lib could not parse this file, so pages were rebuilt from rendered images (${pages} page${pages === 1 ? "" : "s"}). Text is no longer selectable.` };
    } catch (renderError) {
      throw new Error(`This PDF is too damaged to recover. (${String(pdfLibError?.message || renderError?.message || "unknown error")})`);
    }
  }
}

function clampPercent(value, label) {
  const number = finiteNumber(value, label);
  if (number < 0 || number > 100) throw new Error(`${label} must be between 0 and 100.`);
  return number;
}
