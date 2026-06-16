export function getPdfLib() {
  if (!window.PDFLib) throw new Error("PDF engine failed to load.");
  return window.PDFLib;
}

export async function loadPdf(file) {
  const { PDFDocument } = getPdfLib();
  return PDFDocument.load(await file.arrayBuffer());
}

export async function mergePdfs(files) {
  const { PDFDocument } = getPdfLib();
  const merged = await PDFDocument.create();
  for (const file of files) {
    const source = await loadPdf(file);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return merged.save();
}

export async function extractPdfPages(file, pageIndexes) {
  const { PDFDocument } = getPdfLib();
  const source = await loadPdf(file);
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, pageIndexes);
  pages.forEach((page) => output.addPage(page));
  return output.save();
}

export async function deletePdfPages(file, pageIndexesToRemove) {
  const source = await loadPdf(file);
  const remove = new Set(pageIndexesToRemove);
  const keep = source.getPageIndices().filter((index) => !remove.has(index));
  if (!keep.length) throw new Error("Cannot remove every page from a PDF.");
  return extractPdfPages(file, keep);
}

export async function rotatePdfPages(file, pageIndexes, degrees) {
  const { PDFDocument, degrees: pdfDegrees } = getPdfLib();
  const source = await loadPdf(file);
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, source.getPageIndices());
  const selected = new Set(pageIndexes);
  pages.forEach((page, index) => {
    if (selected.has(index)) page.setRotation(pdfDegrees(degrees));
    output.addPage(page);
  });
  return output.save();
}

export async function addTextToPdf(file, text, options = {}) {
  const { StandardFonts, rgb } = getPdfLib();
  const pdf = await loadPdf(file);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();
  const pageIndex = clamp(Number(options.page || 1), 1, pages.length) - 1;
  const page = pages[pageIndex];
  const label = String(text || "").trim();
  if (!label) throw new Error("Enter text to add.");
  page.drawText(label, {
    x: Number(options.x || 72),
    y: Number(options.y || 720),
    size: Number(options.size || 18),
    font,
    color: rgb(0.05, 0.09, 0.16),
  });
  return pdf.save();
}

export async function addSignatureImageToPdf(pdfFile, imageFile, options = {}) {
  const pdf = await loadPdf(pdfFile);
  const pages = pdf.getPages();
  const pageIndex = clamp(Number(options.page || 1), 1, pages.length) - 1;
  const page = pages[pageIndex];
  const imageBytes = new Uint8Array(await imageFile.arrayBuffer());
  const image = imageFile.type === "image/png"
    ? await pdf.embedPng(imageBytes)
    : await pdf.embedJpg(await canvasJpegBytes(imageFile));
  const width = Number(options.width || 180);
  const height = Math.max(1, width * (image.height / image.width));
  page.drawImage(image, {
    x: Number(options.x || 72),
    y: Number(options.y || 96),
    width,
    height,
  });
  return pdf.save();
}

export async function addPdfPageNumbers(file, options = {}) {
  const { StandardFonts, rgb } = getPdfLib();
  const pdf = await loadPdf(file);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();
  const fontSize = Number(options.fontSize || 10);
  const prefix = String(options.prefix || "");
  pages.forEach((page, index) => {
    const { width } = page.getSize();
    const text = `${prefix}${index + 1}`;
    page.drawText(text, {
      x: width / 2 - (text.length * fontSize * 0.25),
      y: Number(options.margin || 24),
      size: fontSize,
      font,
      color: rgb(0.12, 0.16, 0.24),
    });
  });
  return pdf.save();
}

export async function watermarkPdf(file, text, options = {}) {
  const { StandardFonts, rgb, degrees: pdfDegrees } = getPdfLib();
  const pdf = await loadPdf(file);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const label = String(text || "Watermark").trim();
  if (!label) throw new Error("Enter watermark text.");
  const size = Number(options.size || 48);
  const opacity = clamp(Number(options.opacity || 0.18), 0.05, 0.6);
  pdf.getPages().forEach((page) => {
    const { width, height } = page.getSize();
    page.drawText(label, {
      x: width * 0.18,
      y: height * 0.48,
      size,
      font,
      color: rgb(0.1, 0.16, 0.28),
      opacity,
      rotate: pdfDegrees(Number(options.rotation || -32)),
    });
  });
  return pdf.save();
}

export async function cleanPdfMetadata(file) {
  const pdf = await loadPdf(file);
  const now = new Date();
  pdf.setTitle("");
  pdf.setAuthor("");
  pdf.setSubject("");
  pdf.setKeywords([]);
  pdf.setProducer("MyFileKit");
  pdf.setCreator("MyFileKit");
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);
  return pdf.save();
}

export async function textToPdf(text) {
  const { PDFDocument, StandardFonts, rgb } = getPdfLib();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 54;
  const fontSize = 11;
  const lineHeight = 16;
  const maxChars = 86;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  String(text || "").split(/\r?\n/).forEach((paragraph) => {
    const lines = wrapText(paragraph || " ", maxChars);
    lines.forEach((line) => {
      if (y < margin) {
        page = pdf.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.05, 0.05, 0.05) });
      y -= lineHeight;
    });
  });
  return pdf.save();
}

export async function imagesToPdf(files) {
  const { PDFDocument } = getPdfLib();
  const pdf = await PDFDocument.create();
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const image = file.type === "image/png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(await canvasJpegBytes(file));
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  return pdf.save();
}

async function canvasJpegBytes(file) {
  if (file.type === "image/jpeg") return new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  return new Uint8Array(await blob.arrayBuffer());
}

function wrapText(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    if ((line + " " + word).trim().length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  });
  lines.push(line);
  return lines;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
