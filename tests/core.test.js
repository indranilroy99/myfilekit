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

// --- Phase 5: Business tools --------------------------------------------------

const business = await import("../src/services/business.service.js");
const SELLER_MH = "27AAAAA0000A1Z2";
const BUYER_MH = "27BBBBB1111B1ZN";
const BUYER_KA = "29AAAAA0000A1ZY";

const gstItems = [
  { description: "Design retainer", hsn: "998311", qty: 3, unit: "NOS", rate: 111.11, discountPercent: 0, gstRate: 5 },
  { description: "Support plan", hsn: "998313", qty: 1, unit: "NOS", rate: 1000, discountPercent: 0, gstRate: 18 },
];

test("GSTIN validation checks shape, state code, and checksum without blocking", () => {
  const good = business.validateGstin(SELLER_MH);
  assert.equal(good.valid, true);
  assert.equal(good.stateCode, "27");

  const badChecksum = business.validateGstin("27AAAAA0000A1Z0");
  assert.equal(badChecksum.valid, false);
  assert.match(badChecksum.reason, /Checksum character should be "2"/);

  assert.match(business.validateGstin("27AAAAA0000A1Z").reason, /15 characters \(got 14\)/);
  assert.match(business.validateGstin("2AAAAA0000A1Z25").reason, /format looks wrong/);
  assert.match(business.validateGstin("77AAAAA0000A1Z2").reason, /not a known GST state code/);

  const absent = business.validateGstin("");
  assert.equal(absent.present, false);
  assert.equal(absent.valid, false);

  // Lower case input is normalised, not rejected.
  assert.equal(business.validateGstin(SELLER_MH.toLowerCase()).valid, true);
  assert.equal(business.resolveStateCode("", "27 - Maharashtra"), "27");
  assert.equal(business.resolveStateCode("", "Karnataka"), "29");
  assert.equal(business.resolveStateCode("", ""), "");
});

test("amount in words uses Indian numbering (lakh / crore)", () => {
  assert.equal(business.amountInWords(125000), "One Lakh Twenty Five Thousand");
  assert.equal(business.amountInWords(0), "Zero");
  assert.equal(business.amountInWords(7), "Seven");
  assert.equal(business.amountInWords(100), "One Hundred");
  assert.equal(business.amountInWords(1530), "One Thousand Five Hundred Thirty");
  assert.equal(business.amountInWords(101000000), "Ten Crore Ten Lakh");
  assert.equal(business.amountInWords(1234.56), "One Thousand Two Hundred Thirty Four and Fifty Six Paise");
  assert.equal(business.amountInWords(-50.5), "Minus Fifty and Fifty Paise");
  assert.throws(() => business.amountInWords("abc"), /valid number/);
});

test("GST invoice splits intra-state supplies into CGST + SGST at half the rate", () => {
  const invoice = business.computeGstInvoice({
    seller: { name: "Acme Studio", address: "Pune", gstin: SELLER_MH },
    buyer: { name: "Beta Retail", address: "Mumbai", gstin: BUYER_MH },
    invoiceNo: "INV-2026-001",
    invoiceDate: "2026-04-01",
    placeOfSupply: "27",
    items: gstItems,
  });

  assert.equal(invoice.interState, false);
  assert.equal(invoice.supplyType, "Intra-state (CGST + SGST)");
  assert.equal(invoice.totals.igst, 0);
  // Half the slab each: 5% -> 2.5 + 2.5, 18% -> 9 + 9.
  assert.equal(invoice.lines[0].cgstRate, 2.5);
  assert.equal(invoice.lines[1].sgstRate, 9);
  assert.equal(invoice.totals.taxable, 1333.33);
  assert.equal(invoice.totals.cgst, 98.33);
  assert.equal(invoice.totals.sgst, 98.33);
  assert.equal(invoice.totals.tax, 196.66);
  assert.equal(invoice.totals.beforeRound, 1529.99);
  assert.equal(invoice.totals.roundOff, 0.01);
  assert.equal(invoice.totals.grandTotal, 1530);
  assert.equal(invoice.amountInWords, "INR One Thousand Five Hundred Thirty Only");
});

test("GST invoice charges IGST at the full rate for inter-state supplies", () => {
  const invoice = business.computeGstInvoice({
    seller: { name: "Acme Studio", gstin: SELLER_MH },
    buyer: { name: "Gamma Traders", gstin: BUYER_KA },
    invoiceNo: "INV-2026-002",
    placeOfSupply: "29",
    items: gstItems,
  });

  assert.equal(invoice.interState, true);
  assert.equal(invoice.supplyType, "Inter-state (IGST)");
  assert.equal(invoice.totals.cgst, 0);
  assert.equal(invoice.totals.sgst, 0);
  assert.equal(invoice.lines[0].igstRate, 5);
  assert.equal(invoice.totals.igst, 196.67);
  assert.equal(invoice.totals.taxable, 1333.33);
  assert.equal(invoice.totals.beforeRound, 1530);
  assert.equal(invoice.totals.roundOff, 0);
  assert.equal(invoice.totals.grandTotal, 1530);
});

test("GST invoice components reconcile with the printed total at 2dp", () => {
  const invoice = business.computeGstInvoice({
    seller: { name: "Acme", gstin: SELLER_MH },
    buyer: { name: "Beta", gstin: BUYER_MH },
    invoiceNo: "R-1",
    placeOfSupply: "27",
    // Deliberately awkward money: 7 x 33.335 with a 7.5% discount at 12% GST.
    items: [
      { description: "Odd unit", qty: 7, rate: 33.33, discountPercent: 7.5, gstRate: 12 },
      { description: "Third", qty: 3, rate: 33.33, discountPercent: 0, gstRate: 5 },
      { description: "Exempt", qty: 1, rate: 99.99, discountPercent: 0, gstRate: 0 },
    ],
  });

  const paise = (value) => Math.round(value * 100);
  // Every line: taxable + tax == total, and the tax components add to the tax.
  for (const line of invoice.lines) {
    assert.equal(paise(line.cgst) + paise(line.sgst) + paise(line.igst), paise(line.tax));
    assert.equal(paise(line.taxable) + paise(line.tax), paise(line.total));
    assert.equal(paise(line.gross) - paise(line.discount), paise(line.taxable));
  }
  // Totals are the exact sums of the lines (no 0.01 drift).
  assert.equal(paise(invoice.totals.taxable), invoice.lines.reduce((sum, line) => sum + paise(line.taxable), 0));
  assert.equal(paise(invoice.totals.cgst), invoice.lines.reduce((sum, line) => sum + paise(line.cgst), 0));
  assert.equal(paise(invoice.totals.tax), paise(invoice.totals.cgst) + paise(invoice.totals.sgst) + paise(invoice.totals.igst));
  assert.equal(paise(invoice.totals.beforeRound), paise(invoice.totals.taxable) + paise(invoice.totals.tax));
  assert.equal(paise(invoice.totals.grandTotal), paise(invoice.totals.beforeRound) + paise(invoice.totals.roundOff));
  // Round-off never exceeds half a rupee, and the grand total is a whole rupee.
  assert.ok(Math.abs(invoice.totals.roundOff) <= 0.5);
  assert.equal(paise(invoice.totals.grandTotal) % 100, 0);
});

test("GST invoice warns on suspicious GSTINs and rejects impossible inputs", () => {
  const invoice = business.computeGstInvoice({
    seller: { name: "Acme", gstin: "27AAAAA0000A1Z0" },
    buyer: { name: "Walk-in customer" },
    invoiceNo: "INV-3",
    placeOfSupply: "27",
    items: [{ description: "Item", qty: 1, rate: 100, gstRate: 7 }],
  });
  assert.match(invoice.warnings.join(" "), /Seller GSTIN .* looks wrong/);
  assert.match(invoice.warnings.join(" "), /not a standard GST slab/);
  // No buyer GSTIN: the place of supply decides intra vs inter-state.
  assert.equal(invoice.interState, false);

  const base = { seller: { name: "A", gstin: SELLER_MH }, buyer: { name: "B" }, invoiceNo: "X", placeOfSupply: "27" };
  assert.throws(() => business.computeGstInvoice({ ...base, items: [] }), /at least one line item/);
  assert.throws(() => business.computeGstInvoice({ ...base, seller: { name: "" }, items: gstItems }), /seller \(your business\) name/);
  assert.throws(() => business.computeGstInvoice({ ...base, invoiceNo: "", items: gstItems }), /invoice number/);
  assert.throws(() => business.computeGstInvoice({ ...base, items: [{ description: "x", qty: 0, rate: 10, gstRate: 5 }] }), /quantity must be greater than zero/);
  assert.throws(() => business.computeGstInvoice({ ...base, items: [{ description: "x", qty: 1, rate: 10, gstRate: 120 }] }), /GST rate must be between 0 and 100/);
  assert.throws(() => business.computeGstInvoice({ ...base, items: [{ description: "x", qty: 1, rate: 10, discountPercent: 150, gstRate: 5 }] }), /discount must be between 0 and 100/);
});

test("GST invoice PDF renders as a real PDF", async () => {
  const invoice = business.computeGstInvoice({
    seller: { name: "Acme Studio", address: "12 Hill Road\nPune 411001", gstin: SELLER_MH },
    buyer: { name: "Gamma Traders", address: "Bengaluru", gstin: BUYER_KA },
    invoiceNo: "INV-2026-002",
    invoiceDate: "2026-04-01",
    placeOfSupply: "29",
    items: gstItems,
  });
  const bytes = await business.gstInvoicePdf(invoice);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  const pdf = await window.PDFLib.PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 1);
});

test("POS bill totals, discount allocation, and cash change are exact", () => {
  const bill = business.computePosBill({
    items: [
      { name: "Filter coffee", price: 120, taxPercent: 5, qty: 2 },
      { name: "Cake slice", price: 250, taxPercent: 18, qty: 1 },
    ],
    discountPercent: 10,
    paymentMode: "cash",
    cashTendered: 500,
    billNo: "B0001",
  });

  assert.equal(bill.totals.subtotal, 490);
  assert.equal(bill.totals.discount, 49);
  assert.equal(bill.totals.taxable, 441);
  assert.equal(bill.totals.tax, 51.3);
  assert.equal(bill.totals.beforeRound, 492.3);
  assert.equal(bill.totals.roundOff, -0.3);
  assert.equal(bill.totals.payable, 492);
  assert.equal(bill.totals.tendered, 500);
  assert.equal(bill.totals.change, 8);
  assert.equal(bill.itemCount, 3);

  const paise = (value) => Math.round(value * 100);
  // The allocated line discounts add back up to the bill discount exactly.
  assert.equal(bill.lines.reduce((sum, line) => sum + paise(line.discount), 0), paise(bill.totals.discount));
  assert.equal(bill.lines.reduce((sum, line) => sum + paise(line.taxable), 0), paise(bill.totals.taxable));
  assert.equal(paise(bill.totals.taxable) + paise(bill.totals.tax), paise(bill.totals.beforeRound));
  assert.equal(paise(bill.totals.payable), paise(bill.totals.beforeRound) + paise(bill.totals.roundOff));

  // Card and UPI bills never ask for cash, and short cash is refused.
  const card = business.computePosBill({ items: [{ name: "Tea", price: 20, taxPercent: 0, qty: 1 }], paymentMode: "card" });
  assert.equal(card.totals.change, null);
  assert.equal(card.totals.payable, 20);
  assert.throws(() => business.computePosBill({ items: [{ name: "Tea", price: 20, qty: 1 }], paymentMode: "cash", cashTendered: 10 }), /short by INR 10\.00/);
  assert.throws(() => business.computePosBill({ items: [], paymentMode: "card" }), /at least one item/);
  assert.throws(() => business.computePosBill({ items: [{ name: "Tea", price: 20, qty: 1 }], paymentMode: "cheque" }), /cash, card, or UPI/);

  const session = business.summarisePosSession([bill, card]);
  assert.equal(session.bills, 2);
  assert.equal(session.total, 512);
  assert.equal(session.byMode.cash, 492);
  assert.equal(session.byMode.card, 20);
});

test("POS receipt PDF is an 80mm thermal-width page", async () => {
  const bill = business.computePosBill({
    items: [{ name: "Filter coffee", price: 120, taxPercent: 5, qty: 2 }],
    discountPercent: 0,
    paymentMode: "cash",
    cashTendered: 300,
    billNo: "B0001",
    createdAt: "2026-04-01 10:00",
  });
  const bytes = await business.posReceiptPdf(bill, { shopName: "Corner Cafe", gstin: SELLER_MH });
  const pdf = await window.PDFLib.PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(Math.round(pdf.getPage(0).getSize().width), 227);
});

const gstr1Rows = [
  ["Invoice No", "Invoice Date", "Buyer GSTIN", "Place of Supply", "Taxable Value", "GST Rate", "CGST", "SGST", "IGST"],
  ["INV-1", "01/04/2026", BUYER_MH, "27", 1000, 18, 90, 90, 0],
  ["INV-2", "02/04/2026", BUYER_KA, "29", 2000, 18, 0, 0, 360],
  ["INV-3", "03/04/2026", "", "27", 500, 5, 12.5, 12.5, 0],
  ["INV-4", "04/04/2026", BUYER_MH, "27", 1000, 18, 50, 50, 0],
  ["INV-5", "32/04/2026", "27INVALIDGST", "27", 100, 5, 2.5, 2.5, 0],
];

test("GSTR-1 prep splits B2B/B2C, aggregates rate-wise, and flags rows needing review", () => {
  const summary = business.summariseGstr1(gstr1Rows);

  assert.equal(summary.rowCount, 5);
  assert.equal(summary.invoiceCount, 5);

  // B2B = buyer GSTIN present (even when malformed); B2C = no GSTIN at all.
  assert.equal(summary.b2b.rows, 4);
  assert.equal(summary.b2b.taxable, 4100);
  assert.equal(summary.b2b.cgst, 142.5);
  assert.equal(summary.b2b.sgst, 142.5);
  assert.equal(summary.b2b.igst, 360);
  assert.equal(summary.b2b.tax, 645);
  assert.equal(summary.b2c.rows, 1);
  assert.equal(summary.b2c.taxable, 500);
  assert.equal(summary.b2c.tax, 25);
  assert.equal(summary.totals.taxable, 4600);
  assert.equal(summary.totals.tax, 670);
  assert.equal(summary.totals.total, 5270);

  // Rate-wise summary, ascending by slab.
  assert.deepEqual(summary.rateWise.map((slab) => slab.rate), [5, 18]);
  assert.equal(summary.rateWise[0].taxable, 600);
  assert.equal(summary.rateWise[0].tax, 30);
  assert.equal(summary.rateWise[1].taxable, 4000);
  assert.equal(summary.rateWise[1].tax, 640);
  // Rate-wise totals must reconcile with the overall totals.
  assert.equal(
    summary.rateWise.reduce((sum, slab) => sum + Math.round(slab.taxable * 100), 0),
    Math.round(summary.totals.taxable * 100)
  );

  // Needs review: the mismatched-tax row and the bad-date + malformed-GSTIN row.
  assert.equal(summary.needsReview.length, 2);
  assert.equal(summary.needsReview[0].row, 5);
  assert.equal(summary.needsReview[0].invoiceNo, "INV-4");
  assert.match(summary.needsReview[0].issues.join(" "), /does not match taxable x rate/);
  assert.equal(summary.needsReview[1].row, 6);
  assert.match(summary.needsReview[1].issues.join(" "), /malformed/);
  assert.match(summary.needsReview[1].issues.join(" "), /out-of-range day or month/);
  assert.match(summary.disclaimer, /does not file anything with the government/);

  assert.throws(() => business.summariseGstr1([["Invoice No"]]), /header row and at least one invoice row/);
  assert.throws(() => business.summariseGstr1([["Invoice No", "Date"], ["INV-1", "01/04/2026"]]), /Could not find a taxable and rate column/);
});

test("invoice date parsing accepts the formats a sales register uses", () => {
  assert.equal(business.normaliseInvoiceDate("01/04/2026").iso, "2026-04-01");
  assert.equal(business.normaliseInvoiceDate("2026-04-01").iso, "2026-04-01");
  assert.equal(business.normaliseInvoiceDate("1-4-26").iso, "2026-04-01");
  assert.equal(business.normaliseInvoiceDate(new Date(Date.UTC(2026, 3, 1))).iso, "2026-04-01");
  assert.equal(business.normaliseInvoiceDate(46113).iso, "2026-04-01");
  assert.equal(business.normaliseInvoiceDate("").ok, false);
  assert.equal(business.normaliseInvoiceDate("31/02/2026").ok, false);
  assert.match(business.normaliseInvoiceDate("last Tuesday").reason, /not a recognised date/);
});

test("GSTR-1 summary exports CSV, XLSX, and PDF locally", async () => {
  const summary = business.summariseGstr1(gstr1Rows);

  const csv = business.gstr1SummaryCsv(summary);
  assert.match(csv, /B2B \(buyer GSTIN present\),4,4,4100/);
  assert.match(csv, /B2C \(no buyer GSTIN\),1,1,500/);
  assert.match(csv, /Needs review,2/);
  assert.match(csv, /5,INV-4,27BBBBB1111B1ZN,Tax 100\.00 does not match taxable x rate \(180\.00\)\./);
  // Free-text issues quote the GSTIN they echo back, so the cell must be escaped.
  assert.match(csv, /,"Buyer GSTIN ""27INVALIDGST"" is malformed/);

  const xlsx = await business.gstr1SummaryXlsx(summary);
  assert.equal(xlsx.constructor.name, "Uint8Array");
  assert.deepEqual([...xlsx.slice(0, 2)], [0x50, 0x4b]); // ZIP container
  const { loadXlsx } = await import("../src/services/office.service.js");
  const XLSX = await loadXlsx();
  const workbook = XLSX.read(xlsx, { type: "array" });
  assert.deepEqual(workbook.SheetNames, ["Summary", "Needs review"]);

  const pdfBytes = await business.gstr1SummaryPdf(summary, { sourceName: "sales.csv" });
  assert.equal(new TextDecoder().decode(pdfBytes.slice(0, 5)), "%PDF-");
  assert.ok((await window.PDFLib.PDFDocument.load(pdfBytes)).getPageCount() >= 1);
});

test("workflow builder chains PDF operations, piping bytes between steps", async () => {
  const source = new File([await textToPdf("Workflow source\nSecond line")], "report.pdf", { type: "application/pdf" });

  const ok = await business.runWorkflow(source, [
    { op: "page-numbers", options: { prefix: "Page ", fontSize: "10" } },
    { op: "watermark", options: { text: "DRAFT", size: "40", opacity: "0.2" } },
    { op: "metadata-clean", options: {} },
  ]);
  assert.equal(ok.ok, true);
  assert.equal(ok.failed, null);
  assert.deepEqual(ok.completed.map((step) => step.op), ["page-numbers", "watermark", "metadata-clean"]);
  assert.equal(new TextDecoder().decode(ok.bytes.slice(0, 5)), "%PDF-");
  const chained = await window.PDFLib.PDFDocument.load(ok.bytes, { updateMetadata: false });
  assert.equal(chained.getPageCount(), 1);
  assert.equal(chained.getTitle(), undefined);

  // Each step really sees the previous step's output: extracting page 2 of a
  // 3-page organize result only works if the bytes were piped through.
  const organized = await business.runWorkflow(source, [
    { op: "organize", options: { order: "1,1,1" } },
    { op: "extract-pages", options: { pages: "2-3" } },
    { op: "rotate", options: { degrees: "90" } },
  ]);
  assert.equal(organized.ok, true);
  const rotated = await window.PDFLib.PDFDocument.load(organized.bytes);
  assert.equal(rotated.getPageCount(), 2);
  assert.equal(rotated.getPage(0).getRotation().angle, 90);
});

test("workflow builder reports the failing step and keeps the prior output", async () => {
  const source = new File([await textToPdf("Only one page")], "one.pdf", { type: "application/pdf" });
  const result = await business.runWorkflow(source, [
    { op: "page-numbers", options: { prefix: "Page ", fontSize: "10" } },
    { op: "extract-pages", options: { pages: "99" } },
    { op: "watermark", options: { text: "NEVER RUNS" } },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.failed.step, 2);
  assert.equal(result.failed.op, "extract-pages");
  assert.match(result.failed.message, /outside/);
  assert.equal(result.completed.length, 1);
  // The output of step 1 is still a loadable PDF the user can download.
  assert.equal((await window.PDFLib.PDFDocument.load(result.bytes)).getPageCount(), 1);

  await assert.rejects(() => business.runWorkflow(source, []), /at least one step/);
  await assert.rejects(() => business.runWorkflow(source, [{ op: "encrypt" }]), /not a supported workflow step/);
  assert.deepEqual(business.defaultStepOptions("watermark"), { text: "DRAFT", size: "48", opacity: "0.18" });
  assert.equal(business.workflowOpList().some((op) => op.id === "merge"), false);
  assert.equal(business.workflowOpList().every((op) => typeof op.label === "string" && Array.isArray(op.fields)), true);
});

test("Phase 5 business tools are registered, routable, and discoverable", () => {
  const expected = {
    "gst-invoice-tool": "Business Tools",
    "pos-billing-tool": "Business Tools",
    "gst-filing-prep-tool": "Business Tools",
    "workflow-builder-tool": "PDF Tools",
  };
  for (const [id, category] of Object.entries(expected)) {
    const entry = tools.find((item) => item.id === id);
    assert.ok(entry, `missing tool ${id}`);
    assert.equal(entry.category, category);
    assert.equal(entry.status, "available");
    assert.equal(entry.localProcessing, true);
    assert.equal(routeForHash(entry.route).tool.id, id);
  }
  assert.deepEqual(tools.find((item) => item.id === "gst-filing-prep-tool").file.extensions, ["csv", "xlsx", "xls"]);
  assert.deepEqual(tools.find((item) => item.id === "workflow-builder-tool").acceptedTypes, ["application/pdf"]);
  const gst = tools.find((item) => item.id === "gst-invoice-tool");
  assert.match([gst.name, gst.description, ...gst.keywords].join(" ").toLowerCase(), /cgst sgst/);
});

const nlp = await import("../src/services/nlp.service.js");
const llm = await import("../src/services/llm.service.js");

// --- Phase 6a: local NLP (PDF Summarizer) and passage retrieval (Ask Your PDF) ---
// Everything below runs in plain Node: the algorithms are DOM-free by design.
// Browser-only paths that are NOT covered here: pdf.js text extraction
// (extractPdfText / its new onPage callback), clipboard copy, file downloads,
// localStorage-backed settings persistence, and the React components in App.tsx.

test("sentence splitting keeps abbreviations, decimals, and URLs intact", () => {
  assert.deepEqual(
    nlp.splitSentences("Dr. Smith signed the deal. It closed at 3.5 percent."),
    ["Dr. Smith signed the deal.", "It closed at 3.5 percent."]
  );
  assert.deepEqual(
    nlp.splitSentences("Visit example.com for details. Then call us."),
    ["Visit example.com for details.", "Then call us."]
  );
  // e.g. / i.e. never end a sentence; a lower-case initialism can.
  assert.deepEqual(nlp.splitSentences("Bring fruit, e.g. apples and pears."), ["Bring fruit, e.g. apples and pears."]);
  assert.deepEqual(
    nlp.splitSentences("The meeting starts at 4 p.m. It runs for an hour."),
    ["The meeting starts at 4 p.m.", "It runs for an hour."]
  );
  // An upper-case initialism is part of a name, so no break.
  assert.deepEqual(nlp.splitSentences("The U.S. Army arrived."), ["The U.S. Army arrived."]);
  // Paragraph breaks are hard boundaries even without a terminator.
  assert.deepEqual(nlp.splitSentences("Heading one\n\nBody text follows"), ["Heading one", "Body text follows"]);
  assert.deepEqual(nlp.splitSentences("Is it ready? Yes! Ship it."), ["Is it ready?", "Yes!", "Ship it."]);
  assert.deepEqual(nlp.splitSentences("   "), []);
});

const summaryCorpus = [
  "Quarterly revenue for the payments division grew because merchant onboarding accelerated across every region.",
  "The weather in the office car park was pleasant on Tuesday.",
  "Merchant onboarding accelerated because the revenue team simplified the payments approval workflow.",
  "Somebody left a bicycle by the stairs.",
  "Payments revenue growth is expected to continue while merchant onboarding stays this fast.",
  "A stapler went missing from the third floor.",
].join(" ");

test("summariser picks salient sentences, honours the length setting, and drops near-duplicates", () => {
  const three = nlp.summarizeText(summaryCorpus, { sentences: 3 });
  assert.equal(three.sentences.length, 3);
  assert.equal(three.stats.sentenceCount, 6);
  // The topical sentences (revenue / merchant onboarding / payments) win; the
  // unrelated filler about bicycles and staplers does not.
  assert.match(three.summary, /revenue/i);
  assert.match(three.summary, /onboarding/i);
  assert.equal(/stapler|bicycle|car park/i.test(three.summary), false);
  // Selected sentences are returned in document order so the summary reads.
  assert.deepEqual([...three.sentences].map((item) => item.index).sort((a, b) => a - b), three.sentences.map((item) => item.index));

  const one = nlp.summarizeText(summaryCorpus, { sentences: 1 });
  assert.equal(one.sentences.length, 1);
  assert.equal(one.summary, one.sentences[0].text);

  // A percentage of the document is honoured too, and clamps to what exists.
  assert.equal(nlp.summarizeText(summaryCorpus, { percent: 50 }).sentences.length, 3);
  assert.equal(nlp.summarizeText(summaryCorpus, { sentences: 999 }).sentences.length <= 6, true);

  // Redundancy suppression: three restatements of one claim collapse to one.
  const repetitive = [
    "The refund policy allows returns within thirty days of delivery.",
    "Returns are allowed within thirty days of delivery under the refund policy.",
    "Within thirty days of delivery, the refund policy allows returns.",
    "Shipping is handled by an external courier partner in each city.",
  ].join(" ");
  const deduped = nlp.summarizeText(repetitive, { sentences: 3, redundancy: 0.5 });
  assert.equal(deduped.sentences.length < 3, true);
  assert.equal(deduped.sentences.filter((item) => /refund policy|returns are allowed/i.test(item.text)).length, 1);

  assert.throws(() => nlp.summarizeText("   ", { sentences: 3 }), /no text to summarise/i);
});

test("keyword extraction ranks topical terms above stopwords and one-off words", () => {
  const keywords = nlp.extractKeywords(summaryCorpus, { limit: 5 });
  const terms = keywords.map((keyword) => keyword.term);
  assert.equal(keywords.length, 5);
  assert.ok(terms.includes("merchant"));
  assert.ok(terms.includes("payment") || terms.includes("payments"));
  assert.equal(terms.includes("the"), false);
  assert.equal(terms.includes("stapler"), false);
  // Scores are ordered and every entry carries its counts.
  for (let index = 1; index < keywords.length; index += 1) {
    assert.equal(keywords[index - 1].score >= keywords[index].score, true);
  }
  assert.equal(keywords.every((keyword) => keyword.count >= 1 && keyword.sentences >= 1), true);
  assert.equal(nlp.extractKeywords("", { limit: 5 }).length, 0);
});

const retrievalPages = [
  { page: 1, text: "This agreement is made between the supplier and the buyer. It sets out the scope of work." },
  { page: 2, text: "Invoices must be paid within forty five days of receipt. Late payment attracts interest at two percent per month." },
  { page: 3, text: "Either party may terminate the agreement with ninety days written notice. Notices are sent to the registered office." },
];

test("passage chunking preserves page numbers and never merges pages", () => {
  const chunks = nlp.chunkPages(retrievalPages, { targetWords: 12, overlapSentences: 1 });
  assert.ok(chunks.length >= retrievalPages.length);
  assert.deepEqual([...new Set(chunks.map((chunk) => chunk.page))], [1, 2, 3]);
  // Each chunk's text really belongs to the page it claims.
  for (const chunk of chunks) {
    const source = retrievalPages.find((entry) => entry.page === chunk.page).text.replace(/\s+/g, " ");
    for (const sentence of nlp.splitSentences(chunk.text)) assert.ok(source.includes(sentence), `${sentence} not on page ${chunk.page}`);
  }
  assert.deepEqual(chunks.map((chunk) => chunk.id), chunks.map((_, index) => index));
  // Empty pages are skipped, and a bare string array gets 1-based page numbers.
  assert.equal(nlp.chunkPages([{ page: 1, text: "" }, { page: 2, text: "   " }]).length, 0);
  assert.equal(nlp.chunkPages(["Only page one text here."])[0].page, 1);
  assert.deepEqual(nlp.chunkPages(null), []);
});

test("BM25 ranking returns the passage that answers the question, with its page", () => {
  const index = nlp.buildPassageIndex(nlp.chunkPages(retrievalPages, { targetWords: 40 }));
  assert.equal(index.pageCount, 3);
  assert.ok(index.count >= 3);

  const payment = nlp.searchPassages(index, "When do invoices have to be paid?", { limit: 2 });
  assert.equal(payment[0].page, 2);
  assert.match(payment[0].chunk.text, /forty five days/);
  assert.ok(payment[0].matchedTerms.includes("invoice"));
  assert.ok(payment[0].score > 0);

  const notice = nlp.searchPassages(index, "How much notice is needed to terminate?", { limit: 1 });
  assert.equal(notice[0].page, 3);
  assert.match(notice[0].chunk.text, /ninety days/);

  // Scores are sorted, and the limit is respected.
  const many = nlp.searchPassages(index, "agreement payment notice supplier", { limit: 3 });
  assert.equal(many.length <= 3, true);
  for (let position = 1; position < many.length; position += 1) {
    assert.equal(many[position - 1].score >= many[position].score, true);
  }

  assert.deepEqual(nlp.searchPassages(index, "zzzunmatchedtoken", { limit: 3 }), []);
  assert.throws(() => nlp.searchPassages(index, "   "), /at least one searchable word/i);
  assert.throws(() => nlp.searchPassages(index, "the of and"), /at least one searchable word/i);
  assert.throws(() => nlp.searchPassages(nlp.buildPassageIndex([]), "invoices"), /Load a PDF/i);
});

test("highlight segments mark matched terms as data, never as HTML", () => {
  const segments = nlp.highlightSegments("Invoices must be paid <b>promptly</b>.", ["invoice"]);
  assert.deepEqual(segments.filter((segment) => segment.match).map((segment) => segment.text), ["Invoices"]);
  // The raw text is carried through verbatim, so React escapes it on render.
  assert.equal(segments.map((segment) => segment.text).join(""), "Invoices must be paid <b>promptly</b>.");
  assert.equal(nlp.highlightSegments("plain text", []).every((segment) => segment.match === false), true);
  assert.deepEqual(nlp.highlightSegments("", ["invoice"]), []);
});

test("llm.service sends nothing at all until an endpoint is configured and enabled", async () => {
  let calls = 0;
  const spyFetch = async () => { calls += 1; throw new Error("fetch must not be reached"); };

  const memory = new Map();
  const storage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  };

  // Nothing stored: empty settings, not configured.
  const empty = llm.readLlmSettings({ storage });
  assert.deepEqual(empty, { enabled: false, baseUrl: "", model: "", apiKey: "" });
  assert.equal(llm.isLlmConfigured(empty), false);

  await assert.rejects(() => llm.requestChatCompletion({ settings: empty, prompt: "secret document text", fetchImpl: spyFetch }), /switched off/i);
  await assert.rejects(() => llm.requestChatCompletion({ prompt: "secret document text", fetchImpl: spyFetch }), /switched off/i);
  // Enabled but incomplete still must not reach the network.
  await assert.rejects(
    () => llm.requestChatCompletion({ settings: { enabled: true, baseUrl: "https://api.example.com/v1", model: "", apiKey: "k" }, prompt: "text", fetchImpl: spyFetch }),
    /incomplete/i
  );
  assert.equal(calls, 0, "no fetch may happen while the endpoint is unconfigured");

  // Saving validates, keeps the key out of the URL, and round-trips.
  const saved = llm.saveLlmSettings({ enabled: true, baseUrl: "https://api.example.com/v1/", model: "local-model", apiKey: "sk-secret-1234" }, { storage });
  assert.equal(saved.baseUrl, "https://api.example.com/v1");
  assert.equal(llm.isLlmConfigured(saved), true);
  assert.deepEqual(llm.readLlmSettings({ storage }), saved);
  assert.equal(memory.get("myfilekit:llm-endpoint").includes("sk-secret-1234"), true);
  assert.equal(llm.maskApiKey("sk-secret-1234").endsWith("1234"), true);
  assert.equal(llm.maskApiKey("sk-secret-1234").includes("secret"), false);
  assert.equal(llm.endpointOrigin(saved.baseUrl), "https://api.example.com");

  assert.throws(() => llm.saveLlmSettings({ enabled: true, baseUrl: "not a url", model: "m", apiKey: "k" }, { storage }), /full URL/i);
  assert.throws(() => llm.saveLlmSettings({ enabled: true, baseUrl: "https://user:pw@api.example.com", model: "m", apiKey: "k" }, { storage }), /credentials/i);
  assert.throws(() => llm.saveLlmSettings({ enabled: true, baseUrl: "https://api.example.com/v1?key=abc", model: "m", apiKey: "k" }, { storage }), /query string/i);
  assert.throws(() => llm.saveLlmSettings({ enabled: true, baseUrl: "https://api.example.com/v1", model: "m", apiKey: "" }, { storage }), /API key/i);

  // A configured endpoint sends the key in a header only, never in the URL.
  let seen = null;
  const okFetch = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, statusText: "OK", json: async () => ({ choices: [{ message: { content: " generated answer " } }] }) };
  };
  assert.equal(await llm.requestChatCompletion({ settings: saved, system: "sys", prompt: "hello", fetchImpl: okFetch }), "generated answer");
  assert.equal(seen.url, "https://api.example.com/v1/chat/completions");
  assert.equal(seen.url.includes("sk-secret"), false);
  assert.equal(seen.init.headers.Authorization, "Bearer sk-secret-1234");
  assert.deepEqual(JSON.parse(seen.init.body).messages.map((message) => message.role), ["system", "user"]);

  // A CSP / network refusal is reported as the exact fix, naming both files.
  const blockedFetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(
    () => llm.requestChatCompletion({ settings: saved, prompt: "hello", fetchImpl: blockedFetch }),
    (error) => /connect-src/.test(error.message) && /index\.html/.test(error.message) && /_headers/.test(error.message)
  );
  await assert.rejects(
    () => llm.requestChatCompletion({ settings: saved, prompt: "hello", fetchImpl: async () => ({ ok: false, status: 401, statusText: "Unauthorized" }) }),
    /401/
  );

  // Prompts carry only what the tool promised: passages plus the question.
  const answer = llm.buildAnswerPrompt("When are invoices due?", [{ page: 2, chunk: { text: "Invoices must be paid within forty five days." } }]);
  assert.match(answer.prompt, /page 2/);
  assert.match(answer.prompt, /forty five days/);
  assert.throws(() => llm.buildAnswerPrompt("", []), /Ask a question/i);
  assert.throws(() => llm.buildAnswerPrompt("question", []), /Retrieve passages/i);
  assert.equal(llm.buildSummaryPrompt("a".repeat(llm.MAX_PROMPT_CHARACTERS + 50)).truncated, true);
  assert.throws(() => llm.buildSummaryPrompt("  "), /Extract the document text/i);

  assert.deepEqual(llm.clearLlmSettings({ storage }), { enabled: false, baseUrl: "", model: "", apiKey: "" });
  assert.equal(memory.has("myfilekit:llm-endpoint"), false);
});

test("Phase 6a summariser and Q&A tools are registered, routable, and local", () => {
  for (const id of ["summarize-pdf-tool", "chat-with-pdf-tool"]) {
    const entry = tools.find((item) => item.id === id);
    assert.ok(entry, `missing tool ${id}`);
    assert.equal(entry.category, "Text & Data Tools");
    assert.equal(entry.status, "available");
    assert.equal(entry.localProcessing, true);
    assert.equal(entry.file.maxFiles, 1);
    assert.deepEqual(entry.acceptedTypes, ["application/pdf"]);
    assert.ok(entry.badges.includes("Local"));
    assert.equal(routeForHash(entry.route).tool.id, id);
  }
  assert.match(tools.find((item) => item.id === "summarize-pdf-tool").keywords.join(" "), /summarize pdf/);
  assert.match(tools.find((item) => item.id === "chat-with-pdf-tool").keywords.join(" "), /ask your pdf/);
});
