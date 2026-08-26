import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tools, categories } from "../src/registry/tools.registry.js";
import { csvToJson, jsonToCsv } from "../src/services/csv.service.js";
import { addPdfPageNumbers, addTextToPdf, cleanPdfMetadata, deletePdfPages, extractPdfPages, mergePdfs, rotatePdfPages, textToPdf, watermarkPdf } from "../src/services/pdf.service.js";
import { validateFiles } from "../src/services/file-validator.js";
import { inspectImageMetadataBuffer } from "../src/services/metadata.service.js";
import { base64Decode, base64Encode, diffToText, generatePassphrase, generatePassword, jsonToYaml, lineDiff, passwordStrength, textStats, urlDecode, urlEncode } from "../src/services/text-tools.service.js";
import { csvToPdf, markdownToPdf, renderEquationToHtml } from "../src/services/convert.service.js";
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
  assert.equal(routeForHash("#browse-tools").type, "browse");
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

test("image metadata inspector is available in Image Tools and discoverable by EXIF terms", () => {
  const inspector = tools.find((tool) => tool.id === "image-metadata-inspector-tool");
  assert.ok(inspector);
  assert.equal(inspector.category, "Image Tools");
  assert.equal(inspector.route, "#image-metadata-inspector-tool");
  assert.deepEqual(inspector.acceptedTypes, ["image/jpeg", "image/png", "image/webp"]);
  assert.match([...inspector.keywords, inspector.name, inspector.description].join(" ").toLowerCase(), /exif extractor/);
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

test("spotlight cards are reusable, wired into tool cards, and avoid inline HTML injection", () => {
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const spotlightSource = fs.readFileSync(new URL("../src/components/ui/spotlight-card.tsx", import.meta.url), "utf8");

  assert.match(appSource, /import \{ GlowCard/);
  assert.match(appSource, /<GlowCard customSize/);
  assert.match(spotlightSource, /export function GlowCard/);
  assert.match(spotlightSource, /glowColor/);
  assert.doesNotMatch(spotlightSource, /dangerouslySetInnerHTML|\\.innerHTML\\s*=/);
});

test("liquid buttons provide standard button semantics without SVG filter effects", () => {
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const buttonSource = fs.readFileSync(new URL("../src/components/ui/liquid-glass-button.tsx", import.meta.url), "utf8");

  assert.match(appSource, /import \{ LiquidButton \}/);
  assert.match(appSource, /<LiquidButton className="primary-button"/);
  assert.match(buttonSource, /forwardRef<HTMLButtonElement/);
  assert.match(buttonSource, /type=\{type\}/);
  assert.doesNotMatch(buttonSource, /dangerouslySetInnerHTML|<filter|feTurbulence|backdropFilter/);
});

test("pdf-render service imports in Node and exposes the six new tool functions", async () => {
  // Importing must not blow up even though the service uses pdf.js under the
  // hood — pdf.js (and its Vite `?url` worker) is loaded lazily in the browser.
  const service = await import("../src/services/pdf-render.service.js");
  for (const fn of ["pdfToImages", "extractPdfText", "compressPdf", "pdfToZip", "flattenPdf", "invertPdf"]) {
    assert.equal(typeof service[fn], "function", `${fn} should be exported`);
  }
});

test("pdfToZip splits a PDF into one single-page PDF per page inside a ZIP", async () => {
  // pdf-lib-only path (no canvas), so it is fully unit-testable in Node.
  const { PDFDocument } = window.PDFLib;
  const source = await PDFDocument.create();
  for (let i = 0; i < 3; i += 1) source.addPage([200, 200]);
  const bytes = await source.save();
  const file = { arrayBuffer: async () => bytes.slice().buffer };

  const { pdfToZip } = await import("../src/services/pdf-render.service.js");
  const { unzipSync } = await import("fflate");
  const { zipped, pages } = await pdfToZip(file);
  assert.equal(pages, 3);

  const entries = unzipSync(zipped);
  assert.deepEqual(Object.keys(entries).sort(), ["page-1.pdf", "page-2.pdf", "page-3.pdf"]);
  for (const name of Object.keys(entries)) {
    const doc = await PDFDocument.load(entries[name]);
    assert.equal(doc.getPageCount(), 1);
  }
});

test("new PDF render tools are registered under sensible categories", () => {
  const expected = {
    "pdf-to-image-tool": "PDF Tools",
    "extract-text-tool": "Text & Data Tools",
    "compress-pdf-tool": "PDF Tools",
    "pdf-to-zip-tool": "PDF Tools",
    "flatten-pdf-tool": "PDF Tools",
    "invert-pdf-tool": "PDF Tools",
  };
  for (const [id, category] of Object.entries(expected)) {
    const found = tools.find((tool) => tool.id === id);
    assert.ok(found, `${id} should be registered`);
    assert.equal(found.category, category);
    assert.ok(categories.includes(category));
    assert.equal(found.status, "available");
    assert.equal(found.localProcessing, true);
  }
});

test("pdf.js worker is bundled locally (no CDN) and the service loads it lazily", () => {
  // Rendering itself needs a browser canvas, so it cannot run in Node. Instead
  // we lock in the offline guarantee at the source level.
  const libSource = fs.readFileSync(new URL("../src/lib/pdfjs.ts", import.meta.url), "utf8");
  // Worker is bundled locally via Vite's `?worker` import and handed to pdf.js
  // through `workerPort` (so pdf.js never guesses the worker type and hangs).
  assert.match(libSource, /pdf\.worker\.min\.mjs\?worker/);
  assert.match(libSource, /GlobalWorkerOptions\.workerPort\s*=/);
  assert.doesNotMatch(libSource, /cdnjs|unpkg|jsdelivr|https?:\/\//);

  const serviceSource = fs.readFileSync(new URL("../src/services/pdf-render.service.js", import.meta.url), "utf8");
  assert.match(serviceSource, /import\(["']\.\.\/lib\/pdfjs["']\)/);
  assert.doesNotMatch(serviceSource, /^import .*from ["']\.\.\/lib\/pdfjs["']/m);
});

test("invoice defaults are neutral and drafts are not persisted", () => {
  const invoiceSource = fs.readFileSync(new URL("../invoice-generator/index.html", import.meta.url), "utf8");
  assert.match(invoiceSource, /senderName:\s*"Your name"/);
  assert.match(invoiceSource, /clientName:\s*"Client name"/);
  assert.match(invoiceSource, /bankName:\s*""/);
  assert.match(invoiceSource, /accountNumber:\s*""/);
  assert.match(invoiceSource, /ifscCode:\s*""/);
  assert.match(invoiceSource, /upiId:\s*""/);

  assert.doesNotMatch(invoiceSource, /localStorage\.setItem\(|sessionStorage\.setItem\(/);
  assert.match(invoiceSource, /localStorage\.removeItem\(key\)/);
  assert.match(invoiceSource, /sessionStorage\.removeItem\(key\)/);
  assert.match(invoiceSource, /Private session/);
});

test("every visible tool has a concrete renderer", () => {
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  for (const tool of tools) {
    assert.equal(appSource.includes(`"${tool.id}"`), true, `${tool.name} is missing from ToolRenderer`);
  }
});

test("file validation checks count, type, extension, and size", () => {
  const file = new File(["hello"], "sample.pdf", { type: "application/pdf" });
  assert.equal(validateFiles([file], { maxFiles: 1, types: ["application/pdf"], extensions: ["pdf"] })[0].name, "sample.pdf");
  assert.throws(() => validateFiles([], { maxFiles: 1 }), /Choose a file/);
  assert.throws(() => validateFiles([file, file], { maxFiles: 1 }), /no more than 1/);
  assert.throws(() => validateFiles([file], { maxFiles: 1, types: ["image/png"], extensions: ["png"] }), /not a supported/);
});

test("file validation accepts known extensions when the browser MIME is empty or generic", () => {
  const emptyMime = new File(["webp"], "image.webp", { type: "" });
  const genericMime = new File(["webp"], "image.webp", { type: "application/octet-stream" });
  const options = { maxFiles: 1, types: ["image/webp"], extensions: ["webp"] };
  assert.equal(validateFiles([emptyMime], options)[0].name, "image.webp");
  assert.equal(validateFiles([genericMime], options)[0].name, "image.webp");
  const wrongExt = new File(["exe"], "malware.exe", { type: "" });
  assert.throws(() => validateFiles([wrongExt], options), /not a supported file type/);
});

test("CSV disambiguation avoids collisions with real _n columns", () => {
  const rows = csvToJson("a,a_2,a\n1,2,3");
  assert.deepEqual(Object.keys(rows[0]), ["a", "a_2", "a_3"]);
  assert.deepEqual(rows[0], { a: "1", a_2: "2", a_3: "3" });
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

test("metadata inspector reads PNG text and WebP XMP metadata locally", () => {
  const pngReport = inspectImageMetadataBuffer(makePngWithText("Author", "MyFileKit"), {
    name: "sample.png",
    type: "image/png",
    size: 1
  });
  assert.equal(pngReport.format, "PNG");
  assert.equal(pngReport.privacy.hasPngText, true);
  assert.equal(pngReport.groups.some((group) => group.items.some((item) => item.label === "Author" && item.value === "MyFileKit")), true);

  const webpReport = inspectImageMetadataBuffer(makeWebpXmp('<x:xmpmeta xmp:CreatorTool="CameraApp" xmp:CreateDate="2026-06-16T10:00:00Z"></x:xmpmeta>'), {
    name: "sample.webp",
    type: "image/webp",
    size: 1
  });
  assert.equal(webpReport.format, "WebP");
  assert.equal(webpReport.privacy.hasXmp, true);
  assert.equal(webpReport.privacy.hasWebpMetadata, true);
  assert.equal(webpReport.groups.some((group) => group.items.some((item) => item.label === "Creator tool" && item.value === "CameraApp")), true);
});

test("metadata inspector reads JPEG EXIF camera and GPS fields locally", () => {
  const report = inspectImageMetadataBuffer(makeJpegWithExifGps(), {
    name: "photo.jpg",
    type: "image/jpeg",
    size: 1
  });

  assert.equal(report.format, "JPEG");
  assert.equal(report.privacy.hasExif, true);
  assert.equal(report.privacy.hasCamera, true);
  assert.equal(report.privacy.hasGps, true);
  assert.equal(report.warnings.some((warning) => /GPS\/location metadata detected/i.test(warning)), true);
  assert.equal(report.groups.some((group) => group.title.includes("GPS") && group.items.some((item) => item.label === "Decimal coordinates")), true);
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

  const numbered = await window.PDFLib.PDFDocument.load(await addPdfPageNumbers(mergedFile, { prefix: "Page " }));
  assert.equal(numbered.getPageCount(), 2);

  const watermarked = await window.PDFLib.PDFDocument.load(await watermarkPdf(mergedFile, "DRAFT"));
  assert.equal(watermarked.getPageCount(), 2);

  const annotated = await window.PDFLib.PDFDocument.load(await addTextToPdf(mergedFile, "Approved", { page: 1, x: 72, y: 720 }));
  assert.equal(annotated.getPageCount(), 2);
  await assert.rejects(() => addTextToPdf(mergedFile, "Approved", { page: 99 }), /between 1 and 2/);

  merged.setTitle("Private project");
  merged.setAuthor("Private author");
  const metadataFile = new File([await merged.save()], "metadata.pdf", { type: "application/pdf" });
  const cleanedBytes = await cleanPdfMetadata(metadataFile);
  const cleaned = await window.PDFLib.PDFDocument.load(cleanedBytes, { updateMetadata: false });
  assert.equal(cleaned.getPageCount(), 2);
  assert.equal(cleaned.getTitle(), undefined);
  assert.equal(cleaned.getAuthor(), undefined);
  assert.equal(cleaned.getProducer(), undefined);
  assert.equal(new TextDecoder().decode(cleanedBytes).includes("Private project"), false);
});

test("text and utility tools transform data locally", () => {
  assert.match(jsonToYaml('{"name":"MyFileKit","tools":["pdf","image"],"local":true}'), /name: MyFileKit/);
  assert.equal(urlDecode(urlEncode("a b+c")), "a b+c");
  assert.deepEqual(textStats("one two\nthree"), { words: 3, characters: 13, charactersNoSpaces: 11, lines: 2, readingMinutes: 1 });
  assert.equal(textStats("").readingMinutes, 0);
  assert.equal(diffToText(lineDiff("same\nold", "same\nnew")), "  same\n- old\n+ new");
  assert.equal(base64Decode(base64Encode("Hello, 世界")), "Hello, 世界");
  const password = generatePassword({ length: 24, symbols: true, minimumNumbers: 2, minimumSymbols: 2, avoidAmbiguous: true });
  assert.equal(password.length, 24);
  assert.match(password, /[a-z]/);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[0-9]/);
  assert.match(password, /[^a-zA-Z0-9]/);
  assert.equal((password.match(/\d/g) || []).length >= 2, true);
  assert.equal((password.match(/[^a-zA-Z0-9]/g) || []).length >= 2, true);
  assert.doesNotMatch(password, /[Il1O0o]/);
  const withoutNumbers = generatePassword({ length: 8, numbers: false, minimumNumbers: 1 });
  assert.equal(withoutNumbers.length, 8);
  assert.doesNotMatch(withoutNumbers, /\d/);
  const passphrase = generatePassphrase({ words: 6, separator: "-", capitalise: true, includeNumber: true });
  assert.equal(passphrase.split("-").length, 7);
  assert.match(passphrase, /^[A-Z][a-z]+-/);
  assert.equal(passwordStrength(password).score >= 3, true);
  assert.equal(passwordStrength("").label, "Not generated");
});

function makePngWithText(keyword, value) {
  const text = encode(`${keyword}\u0000${value}`);
  return concatBytes([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("tEXt", text),
    pngChunk("IEND", new Uint8Array())
  ]).buffer;
}

function pngChunk(type, data) {
  const chunk = new Uint8Array(12 + data.length);
  writeU32be(chunk, 0, data.length);
  chunk.set(encode(type), 4);
  chunk.set(data, 8);
  return chunk;
}

function makeWebpXmp(xmp) {
  const data = encode(xmp);
  const padding = data.length % 2;
  const riffSize = 4 + 8 + data.length + padding;
  const bytes = new Uint8Array(8 + riffSize);
  bytes.set(encode("RIFF"), 0);
  writeU32le(bytes, 4, riffSize);
  bytes.set(encode("WEBP"), 8);
  bytes.set(encode("XMP "), 12);
  writeU32le(bytes, 16, data.length);
  bytes.set(data, 20);
  return bytes.buffer;
}

function makeJpegWithExifGps() {
  const tiff = makeExifTiff();
  const payload = concatBytes([encode("Exif\u0000\u0000"), tiff]);
  const segmentLength = payload.length + 2;
  const bytes = new Uint8Array(2 + 2 + 2 + payload.length + 2);
  bytes.set([0xff, 0xd8], 0);
  bytes.set([0xff, 0xe1], 2);
  writeU16be(bytes, 4, segmentLength);
  bytes.set(payload, 6);
  bytes.set([0xff, 0xd9], 6 + payload.length);
  return bytes.buffer;
}

function makeExifTiff() {
  const bytes = new Uint8Array(188);
  bytes.set(encode("II"), 0);
  writeU16le(bytes, 2, 42);
  writeU32le(bytes, 4, 8);
  writeU16le(bytes, 8, 4);
  writeIfdEntry(bytes, 10, 0x010f, 2, 6, 62);
  writeIfdEntry(bytes, 22, 0x0110, 2, 8, 68);
  writeIfdEntry(bytes, 34, 0x0131, 2, 10, 76);
  writeIfdEntry(bytes, 46, 0x8825, 4, 1, 86);
  writeU32le(bytes, 58, 0);
  bytes.set(encode("Canon\u0000"), 62);
  bytes.set(encode("TestCam\u0000"), 68);
  bytes.set(encode("MyFileKit\u0000"), 76);

  writeU16le(bytes, 86, 4);
  writeIfdEntry(bytes, 88, 0x0001, 2, 2, "N\u0000");
  writeIfdEntry(bytes, 100, 0x0002, 5, 3, 140);
  writeIfdEntry(bytes, 112, 0x0003, 2, 2, "E\u0000");
  writeIfdEntry(bytes, 124, 0x0004, 5, 3, 164);
  writeU32le(bytes, 136, 0);
  writeRationals(bytes, 140, [[12, 1], [34, 1], [0, 1]]);
  writeRationals(bytes, 164, [[56, 1], [7, 1], [0, 1]]);
  return bytes;
}

function writeIfdEntry(bytes, offset, tag, type, count, value) {
  writeU16le(bytes, offset, tag);
  writeU16le(bytes, offset + 2, type);
  writeU32le(bytes, offset + 4, count);
  if (typeof value === "string") {
    bytes.set(encode(value).slice(0, 4), offset + 8);
  } else {
    writeU32le(bytes, offset + 8, value);
  }
}

function writeRationals(bytes, offset, values) {
  values.forEach(([numerator, denominator], index) => {
    const next = offset + index * 8;
    writeU32le(bytes, next, numerator);
    writeU32le(bytes, next + 4, denominator);
  });
}

function encode(value) {
  return new TextEncoder().encode(value);
}

function concatBytes(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function writeU16be(bytes, offset, value) {
  new DataView(bytes.buffer).setUint16(offset, value, false);
}

function writeU16le(bytes, offset, value) {
  new DataView(bytes.buffer).setUint16(offset, value, true);
}

function writeU32be(bytes, offset, value) {
  new DataView(bytes.buffer).setUint32(offset, value, false);
}

function writeU32le(bytes, offset, value) {
  new DataView(bytes.buffer).setUint32(offset, value, true);
}

test("jsonToYaml quotes string values that look like YAML 1.1 booleans, null, and numbers", () => {
  const yaml = jsonToYaml('{"a":"yes","b":"-5","c":"~","d":"off","e":"1e5","f":"plain"}');
  assert.match(yaml, /a: "yes"/);
  assert.match(yaml, /b: "-5"/);
  assert.match(yaml, /c: "~"/);
  assert.match(yaml, /d: "off"/);
  assert.match(yaml, /e: "1e5"/);
  assert.match(yaml, /f: plain/);
});

test("jsonToCsv rejects arrays of primitives with a clear error", () => {
  assert.throws(() => jsonToCsv('["a","b"]'), /array of objects/);
  assert.throws(() => jsonToCsv('[{"a":1},null]'), /array of objects/);
  assert.throws(() => jsonToCsv('[[1,2]]'), /array of objects/);
  assert.equal(jsonToCsv('[{"a":"1","b":"2"}]'), "a,b\n1,2");
});

test("PDF text tools raise a friendly error for non-Latin-1 input", async () => {
  await assert.rejects(() => textToPdf("你好世界"), /Latin-1 characters only/);
  const latinPdf = new File([await textToPdf("ok")], "p.pdf", { type: "application/pdf" });
  await assert.rejects(() => watermarkPdf(latinPdf, "秘密"), /Latin-1 characters only/);
});

// --- Phase 2: pdf-edit.service.js -----------------------------------------
// Pure pdf-lib logic is unit-tested here. The redact and repair-fallback paths
// rely on pdf.js canvas rasterising, so they are browser-only and covered by
// the manual test checklist instead.

test("parsePageOrder handles reorder, ranges, duplication, and validates bounds", async () => {
  const { parsePageOrder } = await import("../src/services/pdf-edit.service.js");
  assert.deepEqual(parsePageOrder("3,1,2,5-7", 7), [2, 0, 1, 4, 5, 6]);
  assert.deepEqual(parsePageOrder("3-1", 3), [2, 1, 0]);
  assert.deepEqual(parsePageOrder("2,2,2", 3), [1, 1, 1]);
  assert.throws(() => parsePageOrder("", 3), /Enter a page order/);
  assert.throws(() => parsePageOrder("9", 3), /outside 1–3/);
  assert.throws(() => parsePageOrder("1-9", 3), /outside 1–3/);
  assert.throws(() => parsePageOrder("x", 3), /not a valid page/);
});

test("organizePdfPages rebuilds a PDF in the requested order", async () => {
  const { organizePdfPages } = await import("../src/services/pdf-edit.service.js");
  const { PDFDocument } = window.PDFLib;
  const source = await PDFDocument.create();
  for (let i = 0; i < 3; i += 1) source.addPage([200, 200]);
  const file = new File([await source.save()], "src.pdf", { type: "application/pdf" });

  const reordered = await PDFDocument.load(await organizePdfPages(file, "3,1"));
  assert.equal(reordered.getPageCount(), 2);
  const duplicated = await PDFDocument.load(await organizePdfPages(file, "1,1,1,2"));
  assert.equal(duplicated.getPageCount(), 4);
});

test("createPdf builds blank pages and text pages locally", async () => {
  const { createPdf, PAGE_SIZES } = await import("../src/services/pdf-edit.service.js");
  const { PDFDocument } = window.PDFLib;

  const blank = await PDFDocument.load(await createPdf({ mode: "blank", size: "A4", count: 3 }));
  assert.equal(blank.getPageCount(), 3);
  const { width } = blank.getPage(0).getSize();
  assert.ok(Math.abs(width - PAGE_SIZES.A4[0]) < 0.01);

  const fromText = await PDFDocument.load(await createPdf({ mode: "text", text: "Hello local PDF" }));
  assert.ok(fromText.getPageCount() >= 1);

  await assert.rejects(() => createPdf({ mode: "blank", count: 0 }), /at least 1/);
  await assert.rejects(() => createPdf({ mode: "blank", count: 999 }), /200 pages or fewer/);
});

test("cropResizePdf resizes to a preset and crops a margin", async () => {
  const { cropResizePdf, PAGE_SIZES } = await import("../src/services/pdf-edit.service.js");
  const { PDFDocument } = window.PDFLib;
  const source = await PDFDocument.create();
  source.addPage([200, 200]);
  const file = new File([await source.save()], "src.pdf", { type: "application/pdf" });

  const resized = await PDFDocument.load(await cropResizePdf(file, { mode: "resize", size: "Letter" }));
  const size = resized.getPage(0).getSize();
  assert.ok(Math.abs(size.width - PAGE_SIZES.Letter[0]) < 0.01);
  assert.ok(Math.abs(size.height - PAGE_SIZES.Letter[1]) < 0.01);

  const cropped = await PDFDocument.load(await cropResizePdf(file, { mode: "crop", marginMm: 10 }));
  assert.ok(cropped.getPage(0).getSize().width < 200);
  await assert.rejects(() => cropResizePdf(file, { mode: "crop", marginMm: 100 }), /Margin is too large/);
});

test("addHeadersFooters draws on every page and requires some text", async () => {
  const { addHeadersFooters } = await import("../src/services/pdf-edit.service.js");
  const { PDFDocument } = window.PDFLib;
  const source = await PDFDocument.create();
  source.addPage([400, 400]);
  source.addPage([400, 400]);
  const file = new File([await source.save()], "src.pdf", { type: "application/pdf" });

  const stamped = await PDFDocument.load(await addHeadersFooters(file, { header: "Report", footer: "Page {n} of {total}", align: "right" }));
  assert.equal(stamped.getPageCount(), 2);
  await assert.rejects(() => addHeadersFooters(file, { header: "", footer: "" }), /header and\/or footer/);
});

test("readPdfFormFields and fillPdfForm read, fill, and flatten an AcroForm", async () => {
  const { readPdfFormFields, fillPdfForm } = await import("../src/services/pdf-edit.service.js");
  const { PDFDocument } = window.PDFLib;

  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const form = doc.getForm();
  const nameField = form.createTextField("full_name");
  nameField.addToPage(page, { x: 40, y: 200, width: 200, height: 20 });
  const agree = form.createCheckBox("agree");
  agree.addToPage(page, { x: 40, y: 160, width: 15, height: 15 });
  const formFile = new File([await doc.save()], "form.pdf", { type: "application/pdf" });

  const fields = await readPdfFormFields(formFile);
  assert.equal(fields.length, 2);
  assert.deepEqual(fields.find((f) => f.name === "full_name"), { name: "full_name", type: "text", value: "" });
  assert.deepEqual(fields.find((f) => f.name === "agree"), { name: "agree", type: "checkbox", checked: false });

  const filled = await PDFDocument.load(await fillPdfForm(formFile, { full_name: "Ada Lovelace", agree: true }, false));
  assert.equal(filled.getForm().getTextField("full_name").getText(), "Ada Lovelace");
  assert.equal(filled.getForm().getCheckBox("agree").isChecked(), true);

  const flattened = await PDFDocument.load(await fillPdfForm(formFile, { full_name: "Ada" }, true));
  assert.equal(flattened.getForm().getFields().length, 0);

  const plain = new File([await (await PDFDocument.create()).save()], "plain.pdf", { type: "application/pdf" });
  assert.deepEqual(await readPdfFormFields(plain), []);
  await assert.rejects(() => fillPdfForm(plain, {}, false), /no fillable form fields/);
});

test("fingerprintPdf embeds a traceable id in metadata without changing pages", async () => {
  const { fingerprintPdf, generateFingerprintId } = await import("../src/services/pdf-edit.service.js");
  const { PDFDocument } = window.PDFLib;

  assert.match(generateFingerprintId(), /^[0-9a-f]{32}$/);

  const source = await PDFDocument.create();
  source.addPage([200, 200]);
  const file = new File([await source.save()], "src.pdf", { type: "application/pdf" });

  const { bytes, id } = await fingerprintPdf(file);
  assert.match(id, /^[0-9a-f]{32}$/);
  // Keywords survive any reload; the Producer is only preserved when the reader
  // does not re-stamp metadata (pdf-lib overwrites Producer when updateMetadata
  // is left at its default true).
  const stamped = await PDFDocument.load(bytes);
  assert.equal(stamped.getPageCount(), 1);
  assert.match(stamped.getKeywords(), new RegExp(`mfk-fpid:${id}`));
  const preserved = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.match(preserved.getProducer(), new RegExp(id));
});

// --- Phase 3: convert.service.js ------------------------------------------
// Pure pdf-lib and KaTeX logic is unit-tested here. The html2canvas, camera
// (getUserMedia), and canvas enhancement paths are browser-only and covered by
// the manual test checklist instead.

test("markdownToPdf lays out headings, lists, and paragraphs into a valid PDF", async () => {
  const md = "# Title\n\n## Section\n\n- one\n- two\n\n" + "word ".repeat(2000).trim();
  const doc = await window.PDFLib.PDFDocument.load(await markdownToPdf(md));
  // The long paragraph must overflow onto a second page.
  assert.ok(doc.getPageCount() >= 2);
  await assert.rejects(() => markdownToPdf(""), /Add Markdown/);
  await assert.rejects(() => markdownToPdf("# 你好世界"), /Latin-1 characters only/);
});

test("csvToPdf builds a paginated table from generated CSV data", async () => {
  const header = "id,name,note";
  const many = Array.from({ length: 200 }, (_, i) => `${i + 1},Person ${i + 1},"row, ${i + 1}"`).join("\n");
  const multi = await window.PDFLib.PDFDocument.load(await csvToPdf(`${header}\n${many}`));
  assert.ok(multi.getPageCount() > 1, "200 rows should span multiple pages");

  const small = await window.PDFLib.PDFDocument.load(await csvToPdf("a,b\n1,2"));
  assert.equal(small.getPageCount(), 1);

  await assert.rejects(() => csvToPdf(""), /Add CSV content/);
});

test("renderEquationToHtml renders LaTeX to KaTeX markup and rejects invalid input", () => {
  const html = renderEquationToHtml("E = mc^2");
  assert.match(html, /class="katex"/);
  assert.match(html, /<span/);
  assert.throws(() => renderEquationToHtml(""), /Enter a LaTeX equation/);
  assert.throws(() => renderEquationToHtml("\\frac{1}{"), /Invalid LaTeX/);
});

test("Phase 3 conversion tools are registered under sensible categories with renderers", () => {
  const expected = {
    "markdown-to-pdf-tool": "Text & Data Tools",
    "csv-to-pdf-tool": "Text & Data Tools",
    "html-to-pdf-tool": "PDF Tools",
    "equation-to-image-tool": "Image Tools",
    "handwriting-to-pdf-tool": "PDF Tools",
    "scan-to-pdf-tool": "PDF Tools",
  };
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  for (const [id, category] of Object.entries(expected)) {
    const found = tools.find((tool) => tool.id === id);
    assert.ok(found, `${id} should be registered`);
    assert.equal(found.category, category);
    assert.ok(categories.includes(category));
    assert.equal(found.status, "available");
    assert.equal(found.localProcessing, true);
    assert.equal(appSource.includes(`"${id}"`), true, `${id} is missing from ToolRenderer`);
  }
});

test("Phase 2 PDF tools are registered under sensible categories with renderers", () => {
  const expected = {
    "organize-pages-tool": "PDF Tools",
    "crop-resize-pdf-tool": "PDF Tools",
    "headers-footers-tool": "PDF Tools",
    "fill-pdf-form-tool": "PDF Tools",
    "redact-pdf-tool": "PDF Tools",
    "create-pdf-tool": "PDF Tools",
    "repair-pdf-tool": "PDF Tools",
    "fingerprint-pdf-tool": "Privacy Tools",
  };
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  for (const [id, category] of Object.entries(expected)) {
    const found = tools.find((tool) => tool.id === id);
    assert.ok(found, `${id} should be registered`);
    assert.equal(found.category, category);
    assert.ok(categories.includes(category));
    assert.equal(found.status, "available");
    assert.equal(found.localProcessing, true);
    assert.equal(appSource.includes(`"${id}"`), true, `${id} is missing from ToolRenderer`);
  }
});

// --- Phase 4a: office.service.js (Word/Excel/PowerPoint/eBook -> PDF) ----------
// docx/xlsx parsing and pptx/epub unzip+parse run in Node here. The html2canvas
// render + PDF paginate paths are browser-only (they need a DOM/canvas) and are
// covered by the manual test checklist instead.

test("Phase 4a office tools are registered under PDF Tools with renderers", () => {
  const expected = ["word-to-pdf-tool", "excel-to-pdf-tool", "powerpoint-to-pdf-tool", "ebook-to-pdf-tool"];
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  for (const id of expected) {
    const found = tools.find((tool) => tool.id === id);
    assert.ok(found, `${id} should be registered`);
    assert.equal(found.category, "PDF Tools");
    assert.equal(found.status, "available");
    assert.equal(found.localProcessing, true);
    assert.equal(appSource.includes(`"${id}"`), true, `${id} is missing from ToolRenderer`);
  }
});

test("sanitizeHtmlForOffline strips scripts, event handlers, and remote references", async () => {
  const { sanitizeHtmlForOffline } = await import("../src/services/office.service.js");
  const dirty = '<p onclick="steal()">hi</p><script>alert(1)</script><img src="https://evil.com/x.png"><a href="//cdn.example/x">y</a><link rel="stylesheet" href="http://x/y.css">';
  const clean = sanitizeHtmlForOffline(dirty);
  assert.doesNotMatch(clean, /<script/i);
  assert.doesNotMatch(clean, /onclick/i);
  assert.doesNotMatch(clean, /evil\.com/);
  assert.doesNotMatch(clean, /cdn\.example/);
  assert.doesNotMatch(clean, /<link/i);
  assert.match(clean, /hi<\/p>/);
});

test("readWorkbookSheets reads a generated workbook to rows and sheetsToHtml builds tables", async () => {
  // SheetJS is vendored (assets/vendor/xlsx.full.min.js, v0.20.3) instead of the
  // npm package, which is frozen at a version with unfixed advisories. Load the
  // same vendored bundle here, mirroring how pdf-lib is loaded above.
  const xlsxCode = fs.readFileSync(new URL("../assets/vendor/xlsx.full.min.js", import.meta.url), "utf8");
  const XLSX = new Function(`${xlsxCode}; return XLSX;`)();
  const { readWorkbookSheets, sheetsToHtml } = await import("../src/services/office.service.js");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Name", "Score"], ["Ada", 99], ["Alan", 87]]), "Marks");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["City"], ["Pune"]]), "Cities");
  // XLSX.write with type "array" returns an ArrayBuffer directly.
  const out = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const file = { name: "book.xlsx", arrayBuffer: async () => out };

  const sheets = await readWorkbookSheets(file);
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].name, "Marks");
  assert.deepEqual(sheets[0].rows[0], ["Name", "Score"]);
  assert.equal(String(sheets[0].rows[1][0]), "Ada");
  assert.equal(sheets[1].name, "Cities");

  const html = sheetsToHtml(sheets);
  assert.match(html, /<h2>Marks<\/h2>/);
  assert.match(html, /<th>Name<\/th>/);
  assert.match(html, /<td>Ada<\/td>/);
  assert.match(html, /<h2>Cities<\/h2>/);
});

test("docxToHtml converts a minimal docx to semantic HTML and rejects legacy .doc", async () => {
  const { zipSync, strToU8 } = await import("fflate");
  const { docxToHtml } = await import("../src/services/office.service.js");
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello Title</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold text</w:t></w:r></w:p></w:body></w:document>';
  const zipped = zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "word/document.xml": strToU8(document),
  });
  const file = { name: "sample.docx", arrayBuffer: async () => zipped.slice().buffer };
  const html = await docxToHtml(file);
  assert.match(html, /Hello Title/);
  assert.match(html, /<strong>Bold text<\/strong>/);

  await assert.rejects(() => docxToHtml({ name: "old.doc", arrayBuffer: async () => new ArrayBuffer(0) }), /Legacy \.doc/);
});

test("pptxToSlides extracts slide size, title text, and inlined images", async () => {
  const { zipSync, strToU8 } = await import("fflate");
  const { pptxToSlides } = await import("../src/services/office.service.js");
  const presentation = '<p:presentation xmlns:p="p"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>';
  const slide = '<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>' +
    '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="7772400" cy="1470025"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Slide Title</a:t></a:r></a:p></p:txBody></p:sp>' +
    '<p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill><p:spPr><a:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="3000000" cy="2000000"/></a:xfrm></p:spPr></p:pic>' +
    '</p:spTree></p:cSld></p:sld>';
  const slideRels = '<Relationships xmlns="r"><Relationship Id="rId1" Type="image" Target="../media/image1.png"/></Relationships>';
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const zipped = zipSync({
    "ppt/presentation.xml": strToU8(presentation),
    "ppt/slides/slide1.xml": strToU8(slide),
    "ppt/slides/_rels/slide1.xml.rels": strToU8(slideRels),
    "ppt/media/image1.png": png,
  });
  const file = { name: "deck.pptx", arrayBuffer: async () => zipped.slice().buffer };
  const { slideWidthEmu, slides } = await pptxToSlides(file);
  assert.equal(slideWidthEmu, 12192000);
  assert.equal(slides.length, 1);

  const textElement = slides[0].elements.find((element) => element.type === "text");
  assert.ok(textElement);
  assert.equal(textElement.title, true);
  assert.equal(textElement.paragraphs[0].text, "Slide Title");
  assert.ok(textElement.box && Math.abs(textElement.box.x - 838200 / 12192000) < 1e-9);

  const imageElement = slides[0].elements.find((element) => element.type === "image");
  assert.ok(imageElement);
  assert.match(imageElement.dataUrl, /^data:image\/png;base64,/);

  await assert.rejects(() => pptxToSlides({ name: "old.ppt", arrayBuffer: async () => new ArrayBuffer(0) }), /Legacy \.ppt/);
});

test("epubToHtml concatenates spine chapters, inlines images, and strips scripts/remote refs", async () => {
  const { zipSync, strToU8 } = await import("fflate");
  const { epubToHtml } = await import("../src/services/office.service.js");
  const container = '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  const opf = '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="chap1" href="chapter1.xhtml" media-type="application/xhtml+xml"/><item id="chap2" href="chapter2.xhtml" media-type="application/xhtml+xml"/><item id="img1" href="images/pic.png" media-type="image/png"/></manifest><spine><itemref idref="chap1"/><itemref idref="chap2"/></spine></package>';
  const chapter1 = '<html><body><h1>Chapter One</h1><p>First chapter text.</p><img src="images/pic.png"/><script>alert("x")</script><a href="http://evil.com/track">remote</a></body></html>';
  const chapter2 = '<html><body><h1>Chapter Two</h1><p>Second chapter text.</p></body></html>';
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
  const zipped = zipSync({
    "mimetype": strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(container),
    "OEBPS/content.opf": strToU8(opf),
    "OEBPS/chapter1.xhtml": strToU8(chapter1),
    "OEBPS/chapter2.xhtml": strToU8(chapter2),
    "OEBPS/images/pic.png": png,
  });
  const file = { name: "book.epub", arrayBuffer: async () => zipped.slice().buffer };
  const html = await epubToHtml(file);
  assert.match(html, /Chapter One/);
  assert.match(html, /First chapter text/);
  assert.match(html, /Chapter Two/);
  // Chapters kept in spine order.
  assert.ok(html.indexOf("Chapter One") < html.indexOf("Chapter Two"));
  // Image inlined, script and remote link stripped for offline safety.
  assert.match(html, /src="data:image\/png;base64,/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /evil\.com/);

  await assert.rejects(() => epubToHtml({ name: "notepub.txt", arrayBuffer: async () => new ArrayBuffer(0) }), /Only \.epub/);
});

// --- Phase 4b exports (PDF -> Word / Excel / HTML / EPUB) ---------------------
// The pdf.js-backed readers are browser-only (Vite `?worker` import), so these
// tests drive the pure document builders with synthetic positioned text items.
// OCR (tesseract.js worker + WebAssembly), speech synthesis, and microphone
// speech recognition are browser-only too and are covered by the manual test
// checklist rather than here.

// Two ruled rows of a table: three columns at x = 50 / 200 / 400.
function syntheticTableItems() {
  const row = (y, cells) => cells.map(([x, text]) => ({ text, x, y, width: text.length * 5, height: 10 }));
  return [
    ...row(100, [[50, "Name"], [200, "Role"], [400, "City"]]),
    ...row(120, [[50, "Ada"], [200, "Engineer"], [400, "London"]]),
    ...row(140, [[50, "Grace"], [200, "Admiral"], [400, "New York"]]),
  ];
}

test("groupItemsIntoLines groups by vertical proximity and orders runs left to right", async () => {
  const { groupItemsIntoLines } = await import("../src/services/export.service.js");
  const items = [
    { text: "world", x: 60, y: 100, width: 30, height: 10 },
    { text: "Hello", x: 10, y: 101, width: 30, height: 10 },
    { text: "Second", x: 10, y: 140, width: 30, height: 10 },
  ];
  const lines = groupItemsIntoLines(items);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, "Hello world");
  assert.equal(lines[1].text, "Second");
});

test("linesToText inserts a blank line where the PDF had vertical space", async () => {
  const { groupItemsIntoLines, linesToText } = await import("../src/services/export.service.js");
  const items = [
    { text: "Heading", x: 10, y: 100, width: 40, height: 10 },
    { text: "Body line", x: 10, y: 112, width: 40, height: 10 },
    { text: "New block", x: 10, y: 200, width: 40, height: 10 },
  ];
  assert.equal(linesToText(groupItemsIntoLines(items)), "Heading\nBody line\n\nNew block");
});

test("itemsToTableRows clusters positioned items into table rows and columns", async () => {
  const { itemsToTableRows } = await import("../src/services/export.service.js");
  const rows = itemsToTableRows(syntheticTableItems());
  assert.deepEqual(rows, [
    ["Name", "Role", "City"],
    ["Ada", "Engineer", "London"],
    ["Grace", "Admiral", "New York"],
  ]);

  // A loose tolerance collapses neighbouring columns rather than inventing them.
  const loose = itemsToTableRows(syntheticTableItems(), { columnTolerance: 500 });
  assert.equal(loose[0].length, 1);
});

test("buildDocx writes a real .docx with a page break between pages", async () => {
  const { unzipSync, strFromU8 } = await import("fflate");
  const { buildDocx } = await import("../src/services/export.service.js");
  const bytes = await buildDocx(["First page line\n\nAfter a blank line", "Second page"], { title: "Unit test" });

  // A .docx is an OOXML zip: check the parts Word requires are present.
  const entries = unzipSync(bytes);
  assert.ok(entries["[Content_Types].xml"], "missing [Content_Types].xml");
  assert.ok(entries["word/document.xml"], "missing word/document.xml");
  const document = strFromU8(entries["word/document.xml"]);
  assert.match(document, /First page line/);
  assert.match(document, /After a blank line/);
  assert.match(document, /Second page/);
  assert.match(document, /w:br[^>]*w:type="page"/);

  await assert.rejects(() => buildDocx(["", "   "]), /No selectable text/);
});

test("buildEpub stores mimetype first and uncompressed, with a parseable OPF", async () => {
  const { unzipSync, strFromU8 } = await import("fflate");
  const { buildEpub } = await import("../src/services/export.service.js");
  const { bytes, chapters } = await buildEpub(["Page one text", "Page two text"], { title: "My Book", author: "Ada" });
  assert.equal(chapters, 2);

  // OCF requires `mimetype` to be the archive's first entry, stored (method 0).
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(bytes[8] | (bytes[9] << 8), 0, "mimetype must be stored, not deflated");
  const nameLength = bytes[26] | (bytes[27] << 8);
  assert.equal(strFromU8(bytes.slice(30, 30 + nameLength)), "mimetype");
  assert.equal(strFromU8(bytes.slice(30 + nameLength, 30 + nameLength + 20)), "application/epub+zip");

  const entries = unzipSync(bytes);
  assert.ok(entries["META-INF/container.xml"]);
  const container = strFromU8(entries["META-INF/container.xml"]);
  const rootfile = container.match(/<rootfile\b[^>]*full-path="([^"]+)"/);
  assert.ok(rootfile);
  assert.equal(rootfile[1], "EPUB/package.opf");

  const opf = strFromU8(entries[rootfile[1]]);
  assert.match(opf, /<package[^>]*version="3\.0"/);
  assert.match(opf, /<dc:title>My Book<\/dc:title>/);
  assert.match(opf, /<dc:creator>Ada<\/dc:creator>/);
  assert.match(opf, /properties="nav"/);

  // Every spine itemref must resolve to a manifest item that exists in the zip.
  const manifest = new Map([...opf.matchAll(/<item\b[^>]*id="([^"]+)"[^>]*href="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(spine.length >= 3);
  for (const id of spine) {
    const href = manifest.get(id);
    assert.ok(href, `spine references unknown manifest id ${id}`);
    assert.ok(entries[`EPUB/${href}`], `manifest href missing from archive: ${href}`);
  }
  assert.match(strFromU8(entries["EPUB/page-1.xhtml"]), /Page one text/);

  assert.throws(() => buildEpub([]), /No selectable text/);
});

test("buildEpub escapes PDF text and metadata so no markup can be injected", async () => {
  const { unzipSync, strFromU8 } = await import("fflate");
  const { buildEpub } = await import("../src/services/export.service.js");
  const { bytes } = await buildEpub(['<script>alert("x")</script> & "quoted"'], { title: '</dc:title><evil/>' });
  const entries = unzipSync(bytes);
  const chapter = strFromU8(entries["EPUB/page-1.xhtml"]);
  assert.doesNotMatch(chapter, /<script/);
  assert.match(chapter, /&lt;script&gt;/);
  assert.match(chapter, /&amp; &quot;quoted&quot;/);
  const opf = strFromU8(entries["EPUB/package.opf"]);
  assert.doesNotMatch(opf, /<evil\/>/);
  assert.match(opf, /&lt;\/dc:title&gt;/);
});

test("buildHtmlDocument emits a self-contained page with every string escaped", async () => {
  const { buildHtmlDocument } = await import("../src/services/export.service.js");
  const html = buildHtmlDocument(
    [
      {
        number: 1,
        width: 595.28,
        height: 841.89,
        items: [{ text: '<img src=x onerror="alert(1)">', x: 10, y: 100, width: 50, height: 12 }],
      },
    ],
    { title: '</title><script>alert(1)</script>' }
  );
  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  // Offline-safe: no remote references of any kind.
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(html, /width:595\.28px/);
  assert.match(html, /font-size:12px/);
});

test("splitTextForSpeech chunks on sentence boundaries and respects the limit", async () => {
  const { splitTextForSpeech } = await import("../src/services/audio.service.js");
  assert.deepEqual(splitTextForSpeech(""), []);
  // Sentences are packed up to the limit, then split.
  assert.deepEqual(splitTextForSpeech("One. Two. Three.", 10), ["One. Two.", "Three."]);
  const long = splitTextForSpeech("word ".repeat(200), 50);
  assert.ok(long.length > 1);
  assert.equal(long.every((chunk) => chunk.length <= 50), true);
  // Chunking must never drop content, including words longer than the limit.
  assert.equal(long.join(" "), "word ".repeat(200).trim());
  assert.equal(splitTextForSpeech("a".repeat(25), 10).join(""), "a".repeat(25));
});

test("Phase 4b tools are registered, routable, and discoverable", () => {
  const expected = {
    "pdf-to-word-tool": "PDF Tools",
    "pdf-to-excel-tool": "PDF Tools",
    "pdf-to-html-tool": "PDF Tools",
    "pdf-to-epub-tool": "PDF Tools",
    "ocr-pdf-tool": "PDF Tools",
    "pdf-to-audio-tool": "PDF Tools",
    "audio-to-pdf-tool": "Text & Data Tools",
  };
  for (const [id, category] of Object.entries(expected)) {
    const entry = tools.find((item) => item.id === id);
    assert.ok(entry, `missing tool ${id}`);
    assert.equal(entry.category, category);
    assert.equal(entry.status, "available");
    assert.equal(entry.localProcessing, true);
    assert.equal(routeForHash(entry.route).tool.id, id);
  }
  const ocr = tools.find((item) => item.id === "ocr-pdf-tool");
  assert.deepEqual(ocr.acceptedTypes, ["application/pdf", "image/jpeg", "image/png", "image/webp"]);
});
