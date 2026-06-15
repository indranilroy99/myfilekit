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

