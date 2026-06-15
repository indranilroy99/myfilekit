import { actionRow, button, el, field, fileInput, numberInput, selectInput, statusMessage, textArea, textInput } from "../utils/dom.js";
import { formatBytes, parsePageRanges, simpleMarkdownToHtml } from "../utils/format.js";
import { safeFilename, withExtension } from "../utils/safe-filename.js";
import { validateFiles } from "../services/file-validator.js";
import { downloadBlob, downloadBytes, downloadText } from "../services/download.service.js";
import { cropImage, exportCanvas, imageToCanvas, resizeImage, rotateFlipImage, compressImage as compressImageBlob } from "../services/image.service.js";
import { csvToJson, jsonToCsv } from "../services/csv.service.js";
import { deletePdfPages, extractPdfPages, imagesToPdf, mergePdfs, rotatePdfPages, textToPdf } from "../services/pdf.service.js";

export function renderTool(tool) {
  if (tool.id === "invoice-generator-tool") return invoiceLauncher();
  if (tool.id === "merge-pdf-tool") return pdfTool(tool, "Merge PDFs", async (files) => downloadBytes(await mergePdfs(files), "myfilekit-merged.pdf", "application/pdf"), true);
  if (tool.id === "split-pdf-tool") return pageRangePdfTool(tool, "Extract pages", (file, pages) => extractPdfPages(file, pages), "extracted");
  if (tool.id === "delete-pdf-pages-tool") return pageRangePdfTool(tool, "Delete pages", (file, pages) => deletePdfPages(file, pages), "pages-deleted");
  if (tool.id === "rotate-pdf-tool") return rotatePdfTool(tool);
  if (tool.id === "images-to-pdf-tool") return pdfTool(tool, "Create PDF", async (files) => downloadBytes(await imagesToPdf(files), "myfilekit-images.pdf", "application/pdf"), true);
  if (tool.id === "compress-image-tool") return imageOutputTool(tool, "Compress image", async (file, controls) => compressImageBlob(file, controls.format.value, Number(controls.quality.value)), true);
  if (tool.id === "resize-image-tool") return resizeImageTool(tool);
  if (tool.id === "convert-image-tool") return imageOutputTool(tool, "Convert image", async (file, controls) => exportCanvas(await imageToCanvas(file), controls.format.value, 0.92), false);
  if (tool.id === "crop-image-tool") return cropImageTool(tool);
  if (tool.id === "rotate-flip-image-tool") return rotateFlipImageTool(tool);
  if (tool.id === "receipt-generator-tool") return documentGenerator("Receipt Generator", "Receipt", ["Merchant", "Customer", "Payment method", "Reference"]);
  if (tool.id === "quote-generator-tool") return documentGenerator("Quote / Estimate Generator", "Quote", ["Business", "Client", "Valid until", "Terms"]);
  if (tool.id === "draw-signature-tool") return drawSignatureTool();
  if (tool.id === "type-signature-tool") return typeSignatureTool();
  if (tool.id === "text-to-pdf-tool") return textToPdfTool();
  if (tool.id === "markdown-preview-tool") return markdownTool();
  if (tool.id === "json-formatter-tool") return jsonFormatterTool();
  if (tool.id === "csv-to-json-tool") return csvToJsonTool();
  if (tool.id === "json-to-csv-tool") return jsonToCsvTool();
  if (tool.id === "base64-tool") return base64Tool();
  if (tool.id === "file-hash-tool") return fileHashTool(tool);
  throw new Error(`Missing renderer for ${tool.id}`);
}

function pdfTool(tool, actionText, process, multiple) {
  const input = fileInput("pdfInput", "application/pdf", multiple);
  const status = statusMessage("toolStatus");
  const run = button(actionText, { primary: true });
  const reset = button("Reset");
  run.addEventListener("click", () => runTask(status, async () => {
    const files = validateFiles(input.files, tool.file);
    await process(files);
    return `Processed ${files.length} file${files.length === 1 ? "" : "s"}.`;
  }));
  reset.addEventListener("click", () => { input.value = ""; status.textContent = "Ready."; });
  return panel([field("Choose PDF file", input), actionRow(run, reset), status]);
}

function pageRangePdfTool(tool, actionText, process, suffix) {
  const input = fileInput("pdfInput", "application/pdf");
  const ranges = textInput("pageRanges", "Example: 1-3,5,8");
  const status = statusMessage("toolStatus");
  const run = button(actionText, { primary: true });
  const reset = button("Reset");
  run.addEventListener("click", () => runTask(status, async () => {
    const [file] = validateFiles(input.files, tool.file);
    const pdf = await window.PDFLib.PDFDocument.load(await file.arrayBuffer());
    const pages = parsePageRanges(ranges.value, pdf.getPageCount());
    const bytes = await process(file, pages);
    downloadBytes(bytes, withExtension(`${safeFilename(file.name)}-${suffix}`, "pdf"), "application/pdf");
    return `Processed ${pages.length} selected page${pages.length === 1 ? "" : "s"}.`;
  }));
  reset.addEventListener("click", () => { input.value = ""; ranges.value = ""; status.textContent = "Ready."; });
  return panel([field("PDF file", input), field("Pages", ranges, "Use comma-separated pages or ranges."), actionRow(run, reset), status]);
}

function rotatePdfTool(tool) {
  const input = fileInput("pdfInput", "application/pdf");
  const ranges = textInput("pageRanges", "Leave blank for all pages");
  const degrees = selectInput("degrees", [["90", "90 degrees"], ["180", "180 degrees"], ["270", "270 degrees"]]);
  const status = statusMessage("toolStatus");
  const run = button("Rotate PDF", { primary: true });
  const reset = button("Reset");
  run.addEventListener("click", () => runTask(status, async () => {
    const [file] = validateFiles(input.files, tool.file);
    const pdf = await window.PDFLib.PDFDocument.load(await file.arrayBuffer());
    const pages = ranges.value.trim() ? parsePageRanges(ranges.value, pdf.getPageCount()) : pdf.getPageIndices();
    downloadBytes(await rotatePdfPages(file, pages, Number(degrees.value)), withExtension(`${safeFilename(file.name)}-rotated`, "pdf"), "application/pdf");
    return `Rotated ${pages.length} page${pages.length === 1 ? "" : "s"}.`;
  }));
  reset.addEventListener("click", () => { input.value = ""; ranges.value = ""; status.textContent = "Ready."; });
  return panel([field("PDF file", input), field("Pages", ranges), field("Rotation", degrees), actionRow(run, reset), status]);
}

function imageOutputTool(tool, actionText, process, includeQuality) {
  const input = fileInput("imageInput", "image/jpeg,image/png,image/webp");
  const format = selectInput("format", [["image/jpeg", "JPEG"], ["image/png", "PNG"], ["image/webp", "WebP"]]);
  const quality = el("input", { id: "quality", type: "range", min: "0.25", max: "0.95", step: "0.05", value: "0.82" });
  const status = statusMessage("toolStatus");
  const run = button(actionText, { primary: true });
  const reset = button("Reset");
  run.addEventListener("click", () => runTask(status, async () => {
    const [file] = validateFiles(input.files, tool.file);
    const blob = await process(file, { format, quality });
    downloadBlob(blob, withExtension(`${safeFilename(file.name)}-${actionText.toLowerCase().split(" ")[0]}`, ext(format.value)));
    return `Original: ${formatBytes(file.size)}\nOutput: ${formatBytes(blob.size)}`;
  }));
  reset.addEventListener("click", () => { input.value = ""; status.textContent = "Ready."; });
  return panel([field("Image file", input), field("Output format", format), includeQuality ? field("Quality", quality) : el("span"), actionRow(run, reset), status]);
}

function resizeImageTool(tool) {
  const input = fileInput("imageInput", "image/jpeg,image/png,image/webp");
  const width = numberInput("width", 1200);
  const height = numberInput("height", 800);
  const preserve = el("input", { id: "preserve", type: "checkbox", checked: true });
  const format = selectInput("format", [["image/jpeg", "JPEG"], ["image/png", "PNG"], ["image/webp", "WebP"]]);
  const status = statusMessage("toolStatus");
  const run = button("Resize image", { primary: true });
  const reset = button("Reset");
  run.addEventListener("click", () => runTask(status, async () => {
    const [file] = validateFiles(input.files, tool.file);
    const canvas = await resizeImage(file, Number(width.value), Number(height.value), preserve.checked);
    const blob = await exportCanvas(canvas, format.value, 0.88);
    downloadBlob(blob, withExtension(`${safeFilename(file.name)}-resized`, ext(format.value)));
    return `Output: ${canvas.width}×${canvas.height}, ${formatBytes(blob.size)}`;
  }));
  reset.addEventListener("click", () => { input.value = ""; status.textContent = "Ready."; });
  return panel([field("Image file", input), field("Width", width), field("Height", height), labelCheckbox("Preserve aspect ratio", preserve), field("Output format", format), actionRow(run, reset), status]);
}

function cropImageTool(tool) {
  const input = fileInput("imageInput", "image/jpeg,image/png,image/webp");
  const x = numberInput("x", 0);
  const y = numberInput("y", 0);
  const width = numberInput("width", 500, 1);
  const height = numberInput("height", 500, 1);
  const status = statusMessage("toolStatus");
  const run = button("Crop image", { primary: true });
  const reset = button("Reset");
  run.addEventListener("click", () => runTask(status, async () => {
    const [file] = validateFiles(input.files, tool.file);
    const canvas = await cropImage(file, x.value, y.value, width.value, height.value);
    const blob = await exportCanvas(canvas, "image/png");
    downloadBlob(blob, withExtension(`${safeFilename(file.name)}-cropped`, "png"));
    return `Cropped to ${canvas.width}×${canvas.height}.`;
  }));
  reset.addEventListener("click", () => { input.value = ""; status.textContent = "Ready."; });
  return panel([field("Image file", input), field("X", x), field("Y", y), field("Width", width), field("Height", height), actionRow(run, reset), status]);
}

function rotateFlipImageTool(tool) {
  const input = fileInput("imageInput", "image/jpeg,image/png,image/webp");
  const rotation = selectInput("rotation", [["90", "90 degrees"], ["180", "180 degrees"], ["270", "270 degrees"]]);
  const flipX = el("input", { id: "flipX", type: "checkbox" });
  const flipY = el("input", { id: "flipY", type: "checkbox" });
  const status = statusMessage("toolStatus");
  const run = button("Export image", { primary: true });
  const reset = button("Reset");
  run.addEventListener("click", () => runTask(status, async () => {
    const [file] = validateFiles(input.files, tool.file);
    const canvas = await rotateFlipImage(file, rotation.value, flipX.checked, flipY.checked);
    const blob = await exportCanvas(canvas, "image/png");
    downloadBlob(blob, withExtension(`${safeFilename(file.name)}-rotated`, "png"));
    return `Output: ${canvas.width}×${canvas.height}.`;
  }));
  reset.addEventListener("click", () => { input.value = ""; status.textContent = "Ready."; });
  return panel([field("Image file", input), field("Rotation", rotation), labelCheckbox("Flip horizontal", flipX), labelCheckbox("Flip vertical", flipY), actionRow(run, reset), status]);
}

function documentGenerator(title, documentName, detailLabels) {
  const fields = detailLabels.map((label) => [label, textInput(label.toLowerCase().replace(/\s+/g, "-"))]);
  const items = textArea("items", "Item, quantity, price\nConsulting, 1, 5000");
  const status = statusMessage("toolStatus");
  const run = button(`Export ${documentName}`, { primary: true });
  const reset = button("Reset");
  run.addEventListener("click", () => runTask(status, async () => {
    const html = printableDocument(title, Object.fromEntries(fields.map(([label, input]) => [label, input.value])), items.value);
    downloadText(html, documentName.toLowerCase(), "html", "text/html;charset=utf-8");
    return `${documentName} HTML exported. Open it in a browser and print to PDF.`;
  }));
  reset.addEventListener("click", () => {
    fields.forEach(([, input]) => { input.value = ""; });
    items.value = "";
    status.textContent = "Ready.";
  });
  return panel([...fields.map(([label, input]) => field(label, input)), field("Items", items), actionRow(run, reset), status]);
}

function drawSignatureTool() {
  const canvas = el("canvas", { className: "signature-pad", width: "900", height: "260" });
  const color = el("input", { id: "color", type: "color", value: "#111111" });
  const size = numberInput("size", 4, 1);
  const status = statusMessage("toolStatus");
  let drawing = false;
  const ctx = canvas.getContext("2d");
  ctx.lineCap = "round";
  canvas.addEventListener("pointerdown", (event) => { drawing = true; ctx.beginPath(); ctx.moveTo(event.offsetX, event.offsetY); });
  canvas.addEventListener("pointermove", (event) => { if (!drawing) return; ctx.strokeStyle = color.value; ctx.lineWidth = Number(size.value); ctx.lineTo(event.offsetX, event.offsetY); ctx.stroke(); });
  window.addEventListener("pointerup", () => { drawing = false; });
  const save = button("Download PNG", { primary: true });
  const clear = button("Clear");
  save.addEventListener("click", () => canvas.toBlob((blob) => { downloadBlob(blob, "signature.png"); status.textContent = "Signature downloaded."; }));
  clear.addEventListener("click", () => { ctx.clearRect(0, 0, canvas.width, canvas.height); status.textContent = "Cleared."; });
  return panel([canvas, field("Color", color), field("Thickness", size), actionRow(save, clear), status]);
}

function typeSignatureTool() {
  const name = textInput("name", "Type your name");
  const style = selectInput("style", [["cursive", "Cursive"], ["serif", "Serif"], ["mono", "Monospace"]]);
  const status = statusMessage("toolStatus");
  const run = button("Download PNG", { primary: true });
  const reset = button("Reset");
  run.addEventListener("click", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 260;
    const ctx = canvas.getContext("2d");
    ctx.font = `72px ${style.value === "mono" ? "monospace" : style.value === "serif" ? "serif" : "cursive"}`;
    ctx.fillText(name.value || "Signature", 40, 145);
    canvas.toBlob((blob) => { downloadBlob(blob, "typed-signature.png"); status.textContent = "Signature downloaded."; });
  });
  reset.addEventListener("click", () => { name.value = ""; style.value = "cursive"; status.textContent = "Ready."; });
  return panel([field("Name", name), field("Style", style), actionRow(run, reset), status]);
}

function textToPdfTool() {
  const input = textArea("text", "Paste text here...", 14);
  const status = statusMessage("toolStatus");
  const run = button("Download PDF", { primary: true });
  const reset = button("Reset");
  run.addEventListener("click", () => runTask(status, async () => {
    downloadBytes(await textToPdf(input.value), "myfilekit-text.pdf", "application/pdf");
    return "PDF downloaded.";
  }));
  reset.addEventListener("click", () => { input.value = ""; status.textContent = "Ready."; });
  return panel([field("Text", input), actionRow(run, reset), status]);
}

function markdownTool() {
  const input = textArea("markdown", "# Heading\n\n- Item", 10);
  const preview = el("div", { className: "preview-box" });
  const status = statusMessage("toolStatus");
  const update = () => { preview.innerHTML = simpleMarkdownToHtml(input.value); };
  input.addEventListener("input", update);
  update();
  const copy = button("Copy HTML", { primary: true });
  const save = button("Download HTML");
  const reset = button("Reset");
  copy.addEventListener("click", async () => { await navigator.clipboard.writeText(preview.innerHTML); status.textContent = "HTML copied."; });
  save.addEventListener("click", () => { downloadText(preview.innerHTML, "markdown-preview", "html", "text/html;charset=utf-8"); status.textContent = "HTML downloaded."; });
  reset.addEventListener("click", () => { input.value = ""; update(); status.textContent = "Ready."; });
  return panel([field("Markdown", input), preview, actionRow(copy, save, reset), status]);
}

function jsonFormatterTool() {
  const input = textArea("json", '{"hello":"world"}', 12);
  const output = textArea("output", "", 12);
  const status = statusMessage("toolStatus");
  const format = button("Format", { primary: true });
  const minify = button("Minify");
  const save = button("Download JSON");
  const reset = button("Reset");
  format.addEventListener("click", () => runJson(status, input, output, 2));
  minify.addEventListener("click", () => runJson(status, input, output, 0));
  save.addEventListener("click", () => { downloadText(output.value || input.value, "formatted", "json", "application/json;charset=utf-8"); status.textContent = "JSON downloaded."; });
  reset.addEventListener("click", () => { input.value = ""; output.value = ""; status.textContent = "Ready."; });
  return panel([field("JSON input", input), field("Result", output), actionRow(format, minify, save, reset), status]);
}

function csvToJsonTool() {
  const input = textArea("csv", "name,email\nIndranil,hello@example.com", 10);
  const output = textArea("json", "", 12);
  const status = statusMessage("toolStatus");
  const run = button("Convert", { primary: true });
  const save = button("Download JSON");
  const reset = button("Reset");
  run.addEventListener("click", () => runTask(status, async () => { output.value = JSON.stringify(csvToJson(input.value), null, 2); return "CSV converted."; }));
  save.addEventListener("click", () => { downloadText(output.value, "converted", "json", "application/json;charset=utf-8"); status.textContent = "JSON downloaded."; });
  reset.addEventListener("click", () => { input.value = ""; output.value = ""; status.textContent = "Ready."; });
  return panel([field("CSV input", input), field("JSON output", output), actionRow(run, save, reset), status]);
}

function jsonToCsvTool() {
  const input = textArea("json", '[{"name":"Indranil","email":"hello@example.com"}]', 10);
  const output = textArea("csv", "", 12);
  const status = statusMessage("toolStatus");
  const run = button("Convert", { primary: true });
  const save = button("Download CSV");
  const reset = button("Reset");
  run.addEventListener("click", () => runTask(status, async () => { output.value = jsonToCsv(input.value); return "JSON converted."; }));
  save.addEventListener("click", () => { downloadText(output.value, "converted", "csv", "text/csv;charset=utf-8"); status.textContent = "CSV downloaded."; });
  reset.addEventListener("click", () => { input.value = ""; output.value = ""; status.textContent = "Ready."; });
  return panel([field("JSON input", input), field("CSV output", output), actionRow(run, save, reset), status]);
}

function base64Tool() {
  const input = textArea("text", "Hello MyFileKit", 8);
  const output = textArea("output", "", 8);
  const status = statusMessage("toolStatus");
  const encode = button("Encode", { primary: true });
  const decode = button("Decode");
  const copy = button("Copy output");
  const reset = button("Reset");
  encode.addEventListener("click", () => { output.value = btoa(unescape(encodeURIComponent(input.value))); status.textContent = "Encoded."; });
  decode.addEventListener("click", () => runTask(status, async () => { output.value = decodeURIComponent(escape(atob(input.value))); return "Decoded."; }));
  copy.addEventListener("click", async () => { await navigator.clipboard.writeText(output.value); status.textContent = "Output copied."; });
  reset.addEventListener("click", () => { input.value = ""; output.value = ""; status.textContent = "Ready."; });
  return panel([field("Input", input), field("Output", output), actionRow(encode, decode, copy, reset), status]);
}

function fileHashTool(tool) {
  const input = fileInput("fileInput", "*/*");
  const output = textArea("hash", "", 3);
  const status = statusMessage("toolStatus");
  const run = button("Generate SHA-256", { primary: true });
  const copy = button("Copy hash");
  const reset = button("Reset");
  run.addEventListener("click", () => runTask(status, async () => {
    const [file] = validateFiles(input.files, tool.file);
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    output.value = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `Hashed ${file.name}.`;
  }));
  copy.addEventListener("click", async () => { await navigator.clipboard.writeText(output.value); status.textContent = "Hash copied."; });
  reset.addEventListener("click", () => { input.value = ""; output.value = ""; status.textContent = "Ready."; });
  return panel([field("File", input), field("SHA-256", output), actionRow(run, copy, reset), status]);
}

function invoiceLauncher() {
  return panel([el("p", { text: "The invoice generator is a full editor with templates, line items, tax, discount, TDS, payment details, logo controls, and print/PDF export." }), el("a", { className: "button button-primary", href: "invoice-generator/index.html", text: "Open Invoice Generator" })]);
}

function panel(children) {
  return el("div", { className: "tool-panel tool-panel-wide" }, children);
}

function labelCheckbox(label, input) {
  return el("label", { className: "checkbox-row" }, [input, el("span", { text: label })]);
}

function ext(type) {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
}

async function runTask(status, task) {
  try {
    status.textContent = "Processing...";
    status.textContent = await task();
  } catch (error) {
    status.textContent = error.message || "Something went wrong.";
  }
}

function runJson(status, input, output, spaces) {
  runTask(status, async () => {
    output.value = JSON.stringify(JSON.parse(input.value), null, spaces);
    return spaces ? "JSON formatted." : "JSON minified.";
  });
}

function printableDocument(title, details, itemText) {
  const rows = String(itemText || "").split(/\r?\n/).filter(Boolean).map((row) => row.split(",").map((cell) => cell.trim()));
  const detailsHtml = Object.entries(details).map(([key, value]) => `<p><strong>${key}:</strong> ${escapeHtml(value)}</p>`).join("");
  const rowsHtml = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui;margin:40px;color:#111}table{width:100%;border-collapse:collapse}td{border-bottom:1px solid #ddd;padding:10px}</style></head><body><h1>${title}</h1>${detailsHtml}<table>${rowsHtml}</table></body></html>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
