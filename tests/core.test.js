import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tools, categories } from "../src/registry/tools.registry.js";
import { csvToJson, jsonToCsv } from "../src/services/csv.service.js";
import { deletePdfPages, extractPdfPages, mergePdfs, rotatePdfPages, textToPdf } from "../src/services/pdf.service.js";
import { validateFiles } from "../src/services/file-validator.js";
import { formatBytes, parsePageRanges, simpleMarkdownToHtml } from "../src/utils/format.js";
import { safeFilename, withExtension } from "../src/utils/safe-filename.js";
import { routeForHash } from "../src/router.js";

const pdfLibCode = fs.readFileSync(new URL("../assets/vendor/pdf-lib.min.js", import.meta.url), "utf8");
const loadPdfLib = new Function(`${pdfLibCode}; return PDFLib;`);
globalThis.window = { PDFLib: loadPdfLib() };

test("registry only exposes available working tools", () => {
  assert.ok(tools.length >= 20);
  assert.ok(categories.length >= 6);
  assert.equal(tools.every((tool) => tool.status === "available"), true);
  assert.equal(tools.some((tool) => /coming soon|coming-soon|ai-assisted|ai tools/i.test(JSON.stringify(tool))), false);
});

test("registered tool routes resolve", () => {
  for (const tool of tools) {
    const route = routeForHash(tool.route);
    assert.equal(route.type, "tool");
    assert.equal(route.tool.id, tool.id);
  }
  const metadataRoute = routeForHash("#metadata-cleaner-tool");
  assert.equal(metadataRoute.type, "tool");
  assert.equal(metadataRoute.tool.id, "metadata-cleaner");
  assert.equal(routeForHash("#dashboard").type, "dashboard");
  assert.equal(routeForHash("#missing-tool").type, "missing");
});

test("metadata cleaner is available and discoverable", () => {
  const metadataTool = tools.find((tool) => tool.id === "metadata-cleaner");
  assert.ok(metadataTool);
  assert.equal(metadataTool.status, "available");
  assert.equal(metadataTool.route, "#metadata-cleaner-tool");
  assert.equal(metadataTool.category, "Privacy Tools");
  assert.ok(categories.includes("Privacy Tools"));
  const searchableText = [metadataTool.name, metadataTool.description, metadataTool.category, ...metadataTool.keywords, ...metadataTool.badges].join(" ").toLowerCase();
  for (const query of ["metadata", "exif", "privacy"]) {
    assert.match(searchableText, new RegExp(query));
  }
});

test("page range parsing converts user-facing pages to zero-based indexes", () => {
  assert.deepEqual(parsePageRanges("1-3, 5", 6), [0, 1, 2, 4]);
  assert.throws(() => parsePageRanges("0", 6), /outside/);
  assert.throws(() => parsePageRanges("", 6), /Enter/);
});

test("CSV and JSON converters handle quoted values", () => {
  const rows = csvToJson('name,note\n"MyFileKit","fast, local"');
  assert.deepEqual(rows, [{ name: "MyFileKit", note: "fast, local" }]);
  assert.equal(jsonToCsv(JSON.stringify(rows)), 'name,note\nMyFileKit,"fast, local"');
});

test("format and filename helpers keep outputs predictable", () => {
  assert.equal(formatBytes(1536), "1.50 KB");
  assert.equal(safeFilename("../bad file?.pdf"), "bad-file");
  assert.equal(withExtension("report.pdf", "pdf"), "report.pdf");
  assert.equal(withExtension("report", "pdf"), "report.pdf");
});

test("markdown preview escapes user HTML", () => {
  const html = simpleMarkdownToHtml("# Hi\n<script>alert(1)</script>");
  assert.match(html, /<h1>Hi<\/h1>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("React shell does not use dangerous user-controlled HTML injection", () => {
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /dangerouslySetInnerHTML|\\.innerHTML\\s*=/);
});

test("file validation checks count, type, extension, and size", () => {
  const file = new File(["hello"], "sample.pdf", { type: "application/pdf" });
  assert.equal(validateFiles([file], { maxFiles: 1, types: ["application/pdf"], extensions: ["pdf"] })[0].name, "sample.pdf");
  assert.throws(() => validateFiles([], { maxFiles: 1 }), /Choose a file/);
  assert.throws(() => validateFiles([file, file], { maxFiles: 1 }), /no more than 1/);
  assert.throws(() => validateFiles([file], { maxFiles: 1, types: ["image/png"], extensions: ["png"] }), /not a supported/);
});

test("metadata cleaner validates supported image types and safe output names", () => {
  const metadataTool = tools.find((tool) => tool.id === "metadata-cleaner");
  const jpg = new File(["jpg"], "photo.jpg", { type: "image/jpeg" });
  const png = new File(["png"], "screen.png", { type: "image/png" });
  const webp = new File(["webp"], "image.webp", { type: "image/webp" });
  const pdf = new File(["pdf"], "document.pdf", { type: "application/pdf" });
  const options = metadataTool.file;

  assert.equal(validateFiles([jpg], options)[0].name, "photo.jpg");
  assert.equal(validateFiles([png], options)[0].name, "screen.png");
  assert.equal(validateFiles([webp], options)[0].name, "image.webp");
  assert.throws(() => validateFiles([pdf], options), /not a supported file type/);
  assert.equal(withExtension(`${safeFilename("../private photo?.jpg")}-cleaned`, "jpg"), "private-photo-cleaned.jpg");
});

test("PDF services create valid local outputs", async () => {
  const first = new File([await textToPdf("First page")], "first.pdf", { type: "application/pdf" });
  const second = new File([await textToPdf("Second page")], "second.pdf", { type: "application/pdf" });

  const mergedBytes = await mergePdfs([first, second]);
  const merged = await window.PDFLib.PDFDocument.load(mergedBytes);
  assert.equal(merged.getPageCount(), 2);

  const mergedFile = new File([mergedBytes], "merged.pdf", { type: "application/pdf" });
  const extracted = await window.PDFLib.PDFDocument.load(await extractPdfPages(mergedFile, [1]));
  assert.equal(extracted.getPageCount(), 1);

  const deleted = await window.PDFLib.PDFDocument.load(await deletePdfPages(mergedFile, [0]));
  assert.equal(deleted.getPageCount(), 1);

  const rotated = await window.PDFLib.PDFDocument.load(await rotatePdfPages(mergedFile, [0], 90));
  assert.equal(rotated.getPage(0).getRotation().angle, 90);
});
