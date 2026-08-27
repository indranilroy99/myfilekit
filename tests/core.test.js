import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { tools, categories, categoryGroups } from "../src/registry/tools.registry.js";
import { filterTools } from "../src/lib/search.js";
import { csvToJson, jsonToCsv } from "../src/services/csv.service.js";
import { addPdfPageNumbers, addTextToPdf, cleanPdfMetadata, deletePdfPages, extractPdfPages, mergePdfs, rotatePdfPages, textToPdf, watermarkPdf } from "../src/services/pdf.service.js";
import { validateFiles } from "../src/services/file-validator.js";
import { inspectImageMetadataBuffer } from "../src/services/metadata.service.js";
import { base64Decode, base64Encode, diffToText, generatePassphrase, generatePassword, jsonToYaml, lineDiff, passwordStrength, textStats, urlDecode, urlEncode } from "../src/services/text-tools.service.js";
import { csvToPdf, markdownToPdf, renderEquationToHtml } from "../src/services/convert.service.js";
import { formatBytes, parsePageRanges, simpleMarkdownToHtml } from "../src/utils/format.js";
import { safeFilename, withExtension } from "../src/utils/safe-filename.js";
import { routeForHash } from "../src/router.js";
import * as webrtc from "../src/services/webrtc.service.js";
import * as whiteboard from "../src/services/whiteboard.service.js";
import * as pdfCrypto from "../src/services/pdf-crypto.service.js";
import { signPdf, verifyPdfSignatures, loadPkcs12 } from "../src/services/pdf-sign.service.js";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { deflateSync, strToU8 } from "fflate";
import nodeCrypto from "node:crypto";
import { analyzePdfBytes, buildAnalyzerReportText, classifyMagic, decodePdfName, findObfuscatedNames, sha256Hex } from "../src/services/pdf-analyzer.service.js";

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
  assert.equal(metadataTool.category, "Security & Privacy");
  assert.ok(categories.includes("Security & Privacy"));
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

test("SpotlightCard glow is single-accent, on-element, and injection-free", () => {
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const cardSource = fs.readFileSync(new URL("../src/components/ui/spotlight-card.tsx", import.meta.url), "utf8");

  // The card glow is the deliberately-rebuilt on-system version: it must NOT
  // reintroduce the old cursor-driven rainbow (a per-hue glowColorMap sweeping
  // base+xp*spread) and must NOT inject markup.
  assert.doesNotMatch(cardSource, /glowColorMap|dangerouslySetInnerHTML|<style/);
  // No multi-hue rainbow config (the old component enumerated hues + a spread).
  assert.doesNotMatch(cardSource, /glowColor\s*[:?]|spread/);
  assert.doesNotMatch(cardSource, /['"](purple|orange)['"]/);
  // Glow position comes from element-local coords; hue is the single accent (CSS).
  assert.match(cardSource, /--sx|--sy/);
  // No document-level pointer listener (the old per-card perf smell) — the
  // handler is scoped to the element via React's onPointerMove.
  assert.doesNotMatch(cardSource, /document\.addEventListener\(\s*["']pointermove/);
  assert.match(cardSource, /onPointerMove/);
  // The accent-only glow lives in scoped CSS.
  const cssSource = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(cssSource, /\.spotlight-card::before/);
  assert.match(cssSource, /var\(--primary\)/);

  assert.match(appSource, /<SpotlightCard className=\{`tool-card group/);
  assert.doesNotMatch(appSource, /dangerouslySetInnerHTML|\\.innerHTML\\s*=/);
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
    "fingerprint-pdf-tool": "Security & Privacy",
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

// --- Phase 6b: manual-signaling WebRTC transport and whiteboard ---------------
//
// Everything asserted here is the pure half of the two new services: signaling
// codes, frame framing, reassembly, hashing, sanitising, and the stroke model.
// The browser-only paths (RTCPeerConnection, DataChannel backpressure, canvas
// and devicePixelRatio rendering, pointer events) are exercised by hand in a
// real browser, because Node has neither WebRTC nor a canvas.

test("Phase 6b signaling codes round-trip and reject malformed or oversized input", () => {
  // Shaped like a real Chrome/Firefox data-channel offer with host candidates,
  // because that is what a code has to carry under vanilla ICE.
  const sdp = [
    "v=0",
    "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "m=application 51820 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 192.168.1.20",
    "a=candidate:1 1 udp 2122252543 192.168.1.20 51820 typ host generation 0 network-id 1",
    "a=candidate:2 1 udp 2122194687 10.0.0.7 51821 typ host generation 0 network-id 2",
    "a=ice-ufrag:AbCd",
    "a=ice-pwd:0123456789abcdef0123456789",
    "a=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00",
    "a=setup:actpass",
    "a=mid:0",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
    "",
  ].join("\r\n");

  const offer = webrtc.encodeSignal({ role: "offer", sdp });
  assert.ok(offer.startsWith(webrtc.SIGNAL_PREFIX));
  assert.deepEqual(webrtc.decodeSignal(offer), { role: "offer", sdp });
  // Compression earns its keep: the code is shorter than the raw SDP, and short
  // enough to paste into a chat message.
  assert.ok(offer.length < sdp.length);
  assert.ok(offer.length < webrtc.MAX_SIGNAL_CODE_CHARS);

  const answer = webrtc.encodeSignal({ role: "answer", sdp });
  assert.equal(webrtc.decodeSignal(answer).role, "answer");
  // Whitespace picked up in a copy-paste round trip through chat is tolerated.
  assert.deepEqual(webrtc.decodeSignal(`  ${offer.slice(0, 20)}\n${offer.slice(20)}  `), { role: "offer", sdp });

  assert.throws(() => webrtc.encodeSignal({ role: "offer", sdp: "" }), /empty connection description/i);
  assert.throws(() => webrtc.encodeSignal({ role: "host", sdp }), /offer or an answer/i);

  assert.throws(() => webrtc.decodeSignal(""), /Paste a code first/i);
  assert.throws(() => webrtc.decodeSignal("just some text"), /MyFileKit connection code/i);
  assert.throws(() => webrtc.decodeSignal(webrtc.SIGNAL_PREFIX), /empty after its prefix/i);
  assert.throws(() => webrtc.decodeSignal(`${webrtc.SIGNAL_PREFIX}****`), /could not be read/i);
  assert.throws(() => webrtc.decodeSignal(`${webrtc.SIGNAL_PREFIX}${"A".repeat(webrtc.MAX_SIGNAL_CODE_CHARS + 1)}`), /too long/i);
  // A truncated code must fail loudly rather than half-connect.
  assert.throws(() => webrtc.decodeSignal(offer.slice(0, offer.length - 12)), /could not be read|damaged|cut short/i);

  const forge = (payload) => webrtc.SIGNAL_PREFIX + webrtc.base64UrlEncode(deflateSync(strToU8(JSON.stringify(payload))));
  assert.throws(() => webrtc.decodeSignal(forge({ v: 2, role: "offer", sdp })), /different version/i);
  assert.throws(() => webrtc.decodeSignal(forge({ v: 1, role: "offer" })), /usable connection description/i);
  assert.throws(() => webrtc.decodeSignal(forge({ v: 1, role: "offer", sdp: "not an sdp" })), /usable connection description/i);
  assert.throws(() => webrtc.decodeSignal(forge({ v: 1, role: "operator", sdp })), /invite or an answer/i);
  assert.throws(() => webrtc.decodeSignal(forge([1, 2, 3])), /connection description/i);
  // A small code that would inflate past the ceiling is refused, not expanded.
  assert.throws(() => webrtc.decodeSignal(forge({ v: 1, role: "offer", sdp: `v=0${"A".repeat(400000)}` })), /damaged|cut short|could not be read/i);
});

test("Phase 6b base64url encoding round-trips every byte length", () => {
  for (const length of [0, 1, 2, 3, 4, 5, 17, 255, 1024]) {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) bytes[index] = (index * 37 + 11) % 256;
    assert.deepEqual(webrtc.base64UrlDecode(webrtc.base64UrlEncode(bytes)), bytes);
  }
  // URL-safe alphabet only: no +, /, or = padding, so chat clients cannot
  // reflow or linkify a code into something that no longer decodes.
  assert.equal(/[+/=]/.test(webrtc.base64UrlEncode(new Uint8Array([251, 239, 190, 255, 0, 16]))), false);
});

test("Phase 6b chunk framing and reassembly produce identical bytes", () => {
  const source = new Uint8Array(webrtc.CHUNK_SIZE * 3 + 517);
  for (let index = 0; index < source.length; index += 1) source[index] = (index * 31 + 7) % 256;

  const chunks = webrtc.chunkBytes(source, webrtc.CHUNK_SIZE);
  assert.equal(chunks.length, 4);
  assert.equal(chunks[3].length, 517);

  const assembler = webrtc.createAssembler({ size: source.length });
  chunks.forEach((chunk, seq) => {
    const wire = webrtc.encodeFrame(webrtc.FRAME_KIND.CHUNK, seq, chunk);
    assert.equal(wire.length, chunk.length + webrtc.FRAME_HEADER_BYTES);
    const frame = webrtc.decodeFrame(wire);
    assert.equal(frame.kind, webrtc.FRAME_KIND.CHUNK);
    assert.equal(frame.seq, seq);
    assembler.push(frame);
  });
  assert.equal(assembler.complete, true);
  assert.deepEqual(assembler.finish(), source);

  // Empty files still complete cleanly.
  assert.equal(webrtc.createAssembler({ size: 0 }).finish().length, 0);

  // JSON control frames survive the same envelope.
  const meta = { name: "report.pdf", size: source.length, type: "application/pdf", hash: "a".repeat(64), index: 0, total: 2 };
  assert.deepEqual(webrtc.decodeJsonFrame(webrtc.decodeFrame(webrtc.encodeJsonFrame(webrtc.FRAME_KIND.META, meta))), meta);

  // Protocol violations from an untrusted peer are refused, never absorbed.
  assert.throws(() => webrtc.decodeFrame(new Uint8Array([1, 2])), /too short/i);
  assert.throws(() => webrtc.decodeFrame(new Uint8Array([99, 0, 0, 0, 0])), /does not understand/i);
  assert.throws(() => webrtc.createAssembler({ size: 8 }).push(webrtc.decodeFrame(webrtc.encodeJsonFrame(webrtc.FRAME_KIND.META, {}))), /Expected file data/i);
  assert.throws(() => webrtc.createAssembler({ size: 8 }).push(webrtc.decodeFrame(webrtc.encodeFrame(webrtc.FRAME_KIND.CHUNK, 3, new Uint8Array(4)))), /out of order/i);
  assert.throws(() => webrtc.createAssembler({ size: 4 }).push(webrtc.decodeFrame(webrtc.encodeFrame(webrtc.FRAME_KIND.CHUNK, 0, new Uint8Array(9)))), /more data than it announced/i);
  assert.throws(() => webrtc.createAssembler({ size: 4 }).finish(), /ended before the whole file/i);
  assert.throws(() => webrtc.createAssembler({ size: webrtc.MAX_TRANSFER_BYTES + 1 }), /larger than the .* limit/i);
  assert.throws(() => webrtc.createAssembler({ size: -1 }), /invalid file size/i);
});

test("Phase 6b SHA-256 verification catches a corrupted chunk", async () => {
  const source = new Uint8Array(webrtc.CHUNK_SIZE * 2);
  for (let index = 0; index < source.length; index += 1) source[index] = index % 251;
  const announced = await webrtc.sha256Hex(source);
  assert.match(announced, /^[0-9a-f]{64}$/);

  const rebuild = (mutate) => {
    const assembler = webrtc.createAssembler({ size: source.length });
    webrtc.chunkBytes(source, webrtc.CHUNK_SIZE).forEach((chunk, seq) => {
      const copy = Uint8Array.from(chunk);
      if (mutate) mutate(copy, seq);
      assembler.push(webrtc.decodeFrame(webrtc.encodeFrame(webrtc.FRAME_KIND.CHUNK, seq, copy)));
    });
    return assembler.finish();
  };

  const clean = await webrtc.verifyBytes(rebuild(null), announced);
  assert.equal(clean.verified, true);
  assert.equal(clean.hash, announced);

  // One flipped bit in the second chunk is caught.
  const corrupt = await webrtc.verifyBytes(rebuild((copy, seq) => { if (seq === 1) copy[42] ^= 0x01; }), announced);
  assert.equal(corrupt.verified, false);
  assert.notEqual(corrupt.hash, announced);

  // A peer that announces no usable hash never counts as verified.
  assert.equal((await webrtc.verifyBytes(source, "nope")).verified, false);
  assert.equal((await webrtc.verifyBytes(source, "")).verified, false);
});

test("Phase 6b treats peer-supplied file metadata as untrusted", () => {
  // Received names lose any path, keep only a conservative extension, and go
  // through the app's own filename sanitiser.
  assert.equal(webrtc.sanitizeReceivedFilename("quarterly report.pdf"), "quarterly-report.pdf");
  assert.equal(webrtc.sanitizeReceivedFilename("../../../etc/passwd"), "passwd");
  assert.equal(webrtc.sanitizeReceivedFilename("..\\..\\Windows\\System32\\evil.exe"), "evil.exe");
  assert.equal(webrtc.sanitizeReceivedFilename("/absolute/path/file.txt"), "file.txt");
  assert.equal(webrtc.sanitizeReceivedFilename(""), "myfilekit-received");
  assert.equal(webrtc.sanitizeReceivedFilename(null), "myfilekit-received");
  // Markup and shell metacharacters cannot survive: the last path segment wins,
  // then the app's own sanitiser reduces it to [a-z0-9._-].
  assert.equal(webrtc.sanitizeReceivedFilename("<script>alert(1)</script>.png"), "script.png");
  assert.equal(webrtc.sanitizeReceivedFilename('a"b;rm -rf /.txt'), "myfilekit-received.txt");
  assert.equal(webrtc.sanitizeReceivedFilename("photo;rm -rf ~.jpg"), "photo-rm--rf.jpg");
  assert.equal(webrtc.sanitizeReceivedFilename(`${"n".repeat(200)}.pdf`).length <= 84, true);
  assert.equal(/[\\/]/.test(webrtc.sanitizeReceivedFilename("x/y/z")), false);

  assert.equal(webrtc.sanitizeMimeType("application/pdf"), "application/pdf");
  assert.equal(webrtc.sanitizeMimeType("TEXT/Plain"), "text/plain");
  assert.equal(webrtc.sanitizeMimeType("text/html; <script>"), "application/octet-stream");
  assert.equal(webrtc.sanitizeMimeType(undefined), "application/octet-stream");

  // Bidi overrides and control characters cannot rewrite how the UI text reads.
  assert.equal(webrtc.sanitizePeerText("plain label"), "plain label");
  const hostileText = ["bidi", String.fromCharCode(0x202e), "flip", String.fromCharCode(0), "null"].join("");
  assert.equal(webrtc.sanitizePeerText(hostileText), "bidiflipnull");
  assert.equal(webrtc.sanitizePeerText("x".repeat(500)).length, 200);

  const meta = webrtc.normalizeIncomingMeta({ name: "../boot/kernel.bin", size: 1024, type: "text/html; <script>", hash: "F".repeat(64), index: 3, total: 4 });
  assert.deepEqual(meta, { name: "kernel.bin", size: 1024, type: "application/octet-stream", hash: "", index: 3, total: 4 });
  assert.equal(webrtc.normalizeIncomingMeta({ name: "a.txt", size: 0 }).total, 1);
  assert.equal(webrtc.normalizeIncomingMeta({ name: "a.txt", size: 5, hash: "b".repeat(64) }).hash, "b".repeat(64));
  assert.throws(() => webrtc.normalizeIncomingMeta(null), /unexpected shape/i);
  assert.throws(() => webrtc.normalizeIncomingMeta({ size: "lots" }), /invalid file size/i);
  assert.throws(() => webrtc.normalizeIncomingMeta({ size: -5 }), /invalid file size/i);
  assert.throws(() => webrtc.normalizeIncomingMeta({ size: webrtc.MAX_TRANSFER_BYTES + 1 }), /over the .* limit/i);
});

test("Phase 6b ships no built-in ICE servers and validates the ones a user adds", () => {
  // The default is genuinely empty: nothing is contacted unless a user types it.
  assert.deepEqual(webrtc.parseIceServers(""), []);
  assert.deepEqual(webrtc.parseIceServers(undefined), []);
  assert.deepEqual(webrtc.parseIceServers("   \n  "), []);

  assert.deepEqual(webrtc.parseIceServers("stun:stun.example.org:3478"), [{ urls: "stun:stun.example.org:3478" }]);
  assert.deepEqual(webrtc.parseIceServers("turn:relay.example.org:3478|alice|s3cret"), [
    { urls: "turn:relay.example.org:3478", username: "alice", credential: "s3cret" },
  ]);
  assert.equal(webrtc.parseIceServers("stun:a.example:3478\nstuns:b.example:5349").length, 2);

  assert.throws(() => webrtc.parseIceServers("https://tracker.example.com"), /must start with stun/i);
  assert.throws(() => webrtc.parseIceServers("wss://signal.example.com"), /must start with stun/i);
  assert.throws(() => webrtc.parseIceServers("turn:relay.example.org"), /needs credentials/i);
  assert.throws(() => webrtc.parseIceServers('stun:a b"c'), /must start with stun|not a valid/i);
  assert.throws(() => webrtc.parseIceServers(Array(webrtc.MAX_ICE_SERVERS + 2).fill("stun:a.example:1").join("\n")), /no more than/i);

  assert.equal(webrtc.transferRate(1024, 1000), 1024);
  assert.equal(webrtc.transferRate(1024, 0), 0);
  assert.equal(webrtc.progressPercent(50, 200), 25);
  assert.equal(webrtc.progressPercent(0, 0), 0);
  assert.equal(webrtc.progressPercent(10, 0), 100);
});

test("Phase 6b whiteboard strokes serialise and deserialise without drift", () => {
  const stroke = whiteboard.createStroke({ color: "#2563eb", width: 0.006 });
  whiteboard.addStrokePoint(stroke, { x: 0.1234, y: 0.5678, pressure: 0.42 });
  whiteboard.addStrokePoint(stroke, { x: 0.4321, y: 0.8765, pressure: 0 });
  // Out-of-range input is clamped into board space instead of being trusted.
  whiteboard.addStrokePoint(stroke, { x: 4, y: -3, pressure: 9 });

  const round = whiteboard.deserializeStroke(whiteboard.serializeStroke(stroke));
  assert.equal(round.id, stroke.id);
  assert.equal(round.color, "#2563eb");
  assert.equal(round.erase, false);
  assert.equal(Math.abs(round.width - stroke.width) < 1e-5, true);
  assert.equal(round.points.length, 3);
  assert.deepEqual(round.points[0], { x: 0.1234, y: 0.5678, pressure: 0.42 });
  assert.deepEqual(round.points[2], { x: 1, y: 0, pressure: 1 });

  const eraser = whiteboard.createStroke({ erase: true, width: 999 });
  whiteboard.addStrokePoint(eraser, { x: 0.5, y: 0.5 });
  const eraserRound = whiteboard.deserializeStroke(whiteboard.serializeStroke(eraser));
  assert.equal(eraserRound.erase, true);
  assert.equal(eraserRound.width, whiteboard.MAX_STROKE_WIDTH);

  // A whole board round-trips through the save/load format.
  const board = whiteboard.deserializeBoard(whiteboard.serializeBoard([stroke, eraser]));
  assert.equal(board.length, 2);
  assert.equal(whiteboard.countPoints(board), 4);
  assert.deepEqual(whiteboard.serializeBoard(board), whiteboard.serializeBoard([stroke, eraser]));

  assert.throws(() => whiteboard.deserializeBoard("not json"), /could not be read/i);
  assert.throws(() => whiteboard.deserializeBoard(JSON.stringify({ v: 99, strokes: [] })), /different version/i);
  assert.throws(() => whiteboard.deserializeBoard(JSON.stringify({ v: 1 })), /no strokes/i);
});

test("Phase 6b whiteboard treats peer strokes as untrusted and merges live fragments", () => {
  // A peer controls every field. Colours outside #rgb/#rrggbb, absurd widths,
  // and broken point lists are refused or clamped, never handed to a canvas.
  const hostile = whiteboard.deserializeStroke({ i: "x", c: "url(javascript:alert(1))", w: 1e9, e: 1, p: [0.5, 0.5, 0] }, { remote: true });
  assert.equal(hostile.color, "#111111");
  assert.equal(hostile.width, whiteboard.MAX_STROKE_WIDTH);
  assert.equal(hostile.remote, true);
  assert.throws(() => whiteboard.deserializeStroke({ p: [0.1, 0.2] }), /incomplete point list/i);
  assert.throws(() => whiteboard.deserializeStroke({ p: "0.1,0.2,0" }), /without any points/i);
  assert.throws(() => whiteboard.deserializeStroke(null), /unexpected shape/i);
  assert.throws(() => whiteboard.deserializeStroke({ p: new Array(3 * (whiteboard.MAX_POINTS_PER_STROKE + 1)).fill(0) }), /too many points/i);

  // Live fragments: the sender streams the tail of a stroke, the receiver
  // appends it and learns which segment is new so it can draw only that.
  const source = whiteboard.createStroke({ color: "#111111", width: 0.004 });
  whiteboard.addStrokePoint(source, { x: 0, y: 0 });
  whiteboard.addStrokePoint(source, { x: 0.2, y: 0.2 });

  const first = whiteboard.deserializeStrokeChunk(whiteboard.serializeStrokeChunk(source, 0, false));
  const opened = whiteboard.mergeStrokeChunk(null, first);
  assert.equal(opened.stroke.points.length, 2);
  assert.equal(opened.from, 0);
  assert.equal(opened.final, false);

  whiteboard.addStrokePoint(source, { x: 0.4, y: 0.5 });
  const second = whiteboard.deserializeStrokeChunk(whiteboard.serializeStrokeChunk(source, 2, true));
  const closed = whiteboard.mergeStrokeChunk(opened.stroke, second);
  assert.equal(closed.stroke.points.length, 3);
  assert.equal(closed.from, 1);
  assert.equal(closed.final, true);
  assert.deepEqual(closed.stroke.points.map((point) => point.x), [0, 0.2, 0.4]);

  // A duplicated fragment is idempotent rather than doubling the line.
  const replay = whiteboard.mergeStrokeChunk(closed.stroke, whiteboard.deserializeStrokeChunk(whiteboard.serializeStrokeChunk(source, 2, true)));
  assert.equal(replay.stroke.points.length, 3);

  // A fragment that skips ahead means the boards diverged, so it is refused.
  assert.throws(() => whiteboard.mergeStrokeChunk(closed.stroke, { stroke: source, offset: 99, final: false }), /out of order/i);
  assert.throws(() => whiteboard.mergeStrokeChunk(null, { stroke: source, offset: 5, final: false }), /before its start/i);
  assert.throws(() => whiteboard.deserializeStrokeChunk({ p: [], o: -1 }), /invalid position/i);
});

test("Phase 6b sharing tools are registered, routable, and backend-free", () => {
  assert.ok(categories.includes("Sharing & Collaboration"));
  for (const id of ["p2p-share-tool", "collab-whiteboard-tool"]) {
    const entry = tools.find((item) => item.id === id);
    assert.ok(entry, `missing tool ${id}`);
    assert.equal(entry.category, "Sharing & Collaboration");
    assert.equal(entry.status, "available");
    assert.equal(entry.localProcessing, true);
    assert.equal(routeForHash(entry.route).tool.id, id);
    assert.ok(entry.badges.includes("Sharing"));
  }
  const share = tools.find((item) => item.id === "p2p-share-tool");
  assert.equal(share.file.maxFiles, 10);
  assert.equal(share.file.maxSize, 256 * 1024 * 1024);
  assert.deepEqual(share.acceptedTypes, []);

  // Guard the core promise: no signaling server and no public STUN/TURN host is
  // baked into either service, and neither makes an HTTP call.
  for (const file of ["../src/services/webrtc.service.js", "../src/services/whiteboard.service.js"]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.equal(/stuns?:[a-z0-9-]+\.[a-z0-9.-]+/i.test(source), false, `${file} hardcodes a STUN host`);
    assert.equal(/turns?:[a-z0-9-]+\.[a-z0-9.-]+/i.test(source), false, `${file} hardcodes a TURN host`);
    assert.equal(/wss?:\/\//i.test(source), false, `${file} hardcodes a signaling socket`);
    assert.equal(/https?:\/\//i.test(source), false, `${file} hardcodes an HTTP endpoint`);
    assert.equal(/\bfetch\s*\(|XMLHttpRequest|EventSource/.test(source), false, `${file} makes an HTTP call`);
  }
});

// --- PDF wrapping, encoding guards, and XMP cleaning ----------------------
// textToPdf writes its lines as hex strings inside flate-compressed content
// streams, so these helpers read the lines that were actually drawn.
const TEXT_PDF_PAGE_WIDTH = 612;
const TEXT_PDF_MARGIN = 54;
const TEXT_PDF_MAX_WIDTH = TEXT_PDF_PAGE_WIDTH - TEXT_PDF_MARGIN * 2;
const TEXT_PDF_FONT_SIZE = 11;

async function drawnPdfTextLines(bytes) {
  const { PDFDocument, decodePDFRawStream } = window.PDFLib;
  const doc = await PDFDocument.load(bytes);
  const lines = [];
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const streams = typeof contents.asArray === "function"
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
    for (const stream of streams) {
      const decoded = new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
      for (const match of decoded.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
        lines.push(match[1].replace(/../g, (pair) => String.fromCharCode(parseInt(pair, 16))));
      }
    }
  }
  return lines;
}

async function helveticaMeasurer() {
  const { PDFDocument, StandardFonts } = window.PDFLib;
  const probe = await PDFDocument.create();
  const font = await probe.embedFont(StandardFonts.Helvetica);
  return (line) => font.widthOfTextAtSize(line, TEXT_PDF_FONT_SIZE);
}

test("textToPdf wraps by measured width, so wide uppercase text stays inside the margins", async () => {
  const measure = await helveticaMeasurer();
  // 86 characters of this notice measure 585pt — wider than the 504pt printable
  // area — so a character-count wrap clipped the tail off the page.
  const notice = "NOTICE TO ALL EMPLOYEES REGARDING WAREHOUSE SAFETY AND COMPLIANCE REQUIREMENTS FOR THE NEW QUARTER";
  const noticeLines = await drawnPdfTextLines(await textToPdf(notice));
  assert.ok(noticeLines.length >= 2);
  for (const line of noticeLines) {
    assert.ok(measure(line) <= TEXT_PDF_MAX_WIDTH, `line overruns the printable width: ${measure(line)}pt`);
  }
  assert.equal(noticeLines.join(" "), notice);

  // "W" is the widest Helvetica glyph: 86 of them measure 893pt.
  const wideLines = await drawnPdfTextLines(await textToPdf("W".repeat(300)));
  assert.ok(wideLines.length >= 6);
  for (const line of wideLines) {
    assert.ok(measure(line) <= TEXT_PDF_MAX_WIDTH, `line overruns the printable width: ${measure(line)}pt`);
  }
  assert.equal(wideLines.join(""), "W".repeat(300));
});

test("textToPdf splits an over-long token without dropping characters or stalling", async () => {
  const measure = await helveticaMeasurer();
  const token = "Mixed-Token-1234567890".repeat(400).slice(0, 8000);
  assert.equal(token.length, 8000);

  const started = Date.now();
  const bytes = await textToPdf(token);
  const elapsed = Date.now() - started;
  // A linear walk-back to find each cut point is quadratic and freezes the tab;
  // the binary search keeps an 8000-character token well under a second.
  assert.ok(elapsed < 1000, `wrapping 8000 characters took ${elapsed}ms`);

  const lines = await drawnPdfTextLines(bytes);
  assert.equal(lines.join(""), token);
  for (const line of lines) {
    assert.ok(measure(line) <= TEXT_PDF_MAX_WIDTH, `line overruns the printable width: ${measure(line)}pt`);
  }

  // A long token surrounded by ordinary words keeps every character too.
  const mixed = `lead words ${"Q".repeat(500)} trailing words`;
  const mixedLines = await drawnPdfTextLines(await textToPdf(mixed));
  assert.equal(mixedLines.join(" ").replace(/\s+/g, ""), mixed.replace(/\s+/g, ""));
});

test("addHeadersFooters raises the friendly Latin-1 error for every alignment", async () => {
  const { addHeadersFooters } = await import("../src/services/pdf-edit.service.js");
  const { PDFDocument } = window.PDFLib;
  const source = await PDFDocument.create();
  source.addPage([400, 400]);
  const file = new File([await source.save()], "src.pdf", { type: "application/pdf" });

  // Measuring the text throws the same cryptic pdf-lib error as drawing it, and
  // it runs first — including for "left", where the measurement is discarded.
  for (const align of ["center", "left", "right"]) {
    await assert.rejects(() => addHeadersFooters(file, { header: "报告", align }), /Latin-1 characters only/);
  }
  await assert.rejects(() => addHeadersFooters(file, { footer: "页 {n}" }), /Latin-1 characters only/);
  await assert.doesNotReject(() => addHeadersFooters(file, { header: "Report", align: "left" }));
});

test("fillPdfForm raises the friendly Latin-1 error and names the field", async () => {
  const { fillPdfForm } = await import("../src/services/pdf-edit.service.js");
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const field = doc.getForm().createTextField("full_name");
  field.addToPage(page, { x: 40, y: 200, width: 200, height: 20 });
  const file = new File([await doc.save()], "form.pdf", { type: "application/pdf" });

  for (const flatten of [false, true]) {
    await assert.rejects(() => fillPdfForm(file, { full_name: "名前" }, flatten), /Latin-1 characters only/);
    await assert.rejects(() => fillPdfForm(file, { full_name: "名前" }, flatten), /"full_name"/);
  }
});

test("cleanPdfMetadata removes the XMP packet as well as the Info dictionary", async () => {
  const { PDFDocument, PDFName } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.setAuthor("Info-Jane");
  doc.setTitle("Info-Title");
  const xmp = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">'
    + '<rdf:RDF><rdf:Description dc:creator="XMP-JANE-DOE" xmp:CreatorTool="Word"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(doc.context.stream(xmp, { Type: "Metadata", Subtype: "XML" })));
  const original = await doc.save();
  assert.equal(new TextDecoder("latin1").decode(original).includes("XMP-JANE-DOE"), true);

  const cleanedBytes = await cleanPdfMetadata(new File([original], "xmp.pdf", { type: "application/pdf" }));
  assert.equal(new TextDecoder("latin1").decode(cleanedBytes).includes("XMP-JANE-DOE"), false);

  const cleaned = await PDFDocument.load(cleanedBytes, { updateMetadata: false });
  assert.equal(cleaned.catalog.get(PDFName.of("Metadata")), undefined);
  assert.equal(cleaned.getAuthor(), undefined);
  assert.equal(cleaned.getTitle(), undefined);
  assert.equal(cleaned.getPageCount(), 1);
});

// --- Regression: XML attribute parsing in pptx/epub containers -----------------
// Attribute ORDER is not significant in XML, either quote style is legal, and
// EPUB hrefs are URL-encoded per spec. These lock in all three.

test("epubToHtml resolves percent-encoded chapter and image hrefs", async () => {
  const { zipSync, strToU8 } = await import("fflate");
  const { epubToHtml } = await import("../src/services/office.service.js");
  const container = '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

  // (a) One chapter and one image whose hrefs are percent-encoded while the ZIP
  // entries carry the literal spaces.
  const opfOne = '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="c1" href="Chapter%2001.xhtml" media-type="application/xhtml+xml"/><item id="img1" href="images/my%20pic.png" media-type="image/png"/></manifest><spine><itemref idref="c1"/></spine></package>';
  const one = zipSync({
    "META-INF/container.xml": strToU8(container),
    "OEBPS/content.opf": strToU8(opfOne),
    "OEBPS/Chapter 01.xhtml": strToU8('<html><body><p>Encoded chapter text.</p><img src="images/my%20pic.png"/></body></html>'),
    "OEBPS/images/my pic.png": png,
  });
  const htmlOne = await epubToHtml({ name: "one.epub", arrayBuffer: async () => one.slice().buffer });
  assert.match(htmlOne, /Encoded chapter text/);
  assert.match(htmlOne, /src="data:image\/png;base64,/);

  // (b) The silent case: only the MIDDLE chapter is encoded, so a miss used to
  // drop it while still reporting success. All three must come back, in order.
  const opfThree = '<package xmlns="http://www.idpf.org/2007/opf"><manifest>' +
    '<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="c2" href="ch%202.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="c3" href="ch3.xhtml" media-type="application/xhtml+xml"/>' +
    '</manifest><spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine></package>';
  const three = zipSync({
    "META-INF/container.xml": strToU8(container),
    "OEBPS/content.opf": strToU8(opfThree),
    "OEBPS/ch1.xhtml": strToU8("<html><body><p>Chapter ONE</p></body></html>"),
    "OEBPS/ch 2.xhtml": strToU8("<html><body><p>Chapter TWO</p></body></html>"),
    "OEBPS/ch3.xhtml": strToU8("<html><body><p>Chapter THREE</p></body></html>"),
  });
  const htmlThree = await epubToHtml({ name: "three.epub", arrayBuffer: async () => three.slice().buffer });
  assert.match(htmlThree, /Chapter ONE/);
  assert.match(htmlThree, /Chapter TWO/);
  assert.match(htmlThree, /Chapter THREE/);
  assert.ok(htmlThree.indexOf("Chapter ONE") < htmlThree.indexOf("Chapter TWO"));
  assert.ok(htmlThree.indexOf("Chapter TWO") < htmlThree.indexOf("Chapter THREE"));

  // (c) Non-ASCII names arrive percent-encoded too.
  const opfAccent = '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="c1" href="chap%C3%AEtre.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>';
  const accent = zipSync({
    "META-INF/container.xml": strToU8(container),
    "OEBPS/content.opf": strToU8(opfAccent),
    "OEBPS/chapître.xhtml": strToU8("<html><body><p>Accented chapter.</p></body></html>"),
  });
  const htmlAccent = await epubToHtml({ name: "accent.epub", arrayBuffer: async () => accent.slice().buffer });
  assert.match(htmlAccent, /Accented chapter/);

  // A literal "%20" in the ZIP entry name must still resolve (raw fallback).
  const opfLiteral = '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="c1" href="ch%2001.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>';
  const literal = zipSync({
    "META-INF/container.xml": strToU8(container),
    "OEBPS/content.opf": strToU8(opfLiteral),
    "OEBPS/ch%2001.xhtml": strToU8("<html><body><p>Literal percent chapter.</p></body></html>"),
  });
  const htmlLiteral = await epubToHtml({ name: "literal.epub", arrayBuffer: async () => literal.slice().buffer });
  assert.match(htmlLiteral, /Literal percent chapter/);
});

test("epubToHtml reads <item> in any attribute order and with either quote style", async () => {
  const { zipSync, strToU8 } = await import("fflate");
  const { epubToHtml } = await import("../src/services/office.service.js");
  const container = '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  const items = [
    '<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>',
    '<item id="c1" media-type="application/xhtml+xml" href="ch1.xhtml"/>',
    '<item href="ch1.xhtml" id="c1" media-type="application/xhtml+xml"/>',
    '<item media-type="application/xhtml+xml" href="ch1.xhtml" id="c1"/>',
    '<item href="ch1.xhtml" media-type="application/xhtml+xml" id="c1"/>',
    "<item id='c1' href='ch1.xhtml' media-type='application/xhtml+xml'/>",
  ];
  for (const item of items) {
    const opf = `<package xmlns="http://www.idpf.org/2007/opf"><manifest>${item}</manifest><spine><itemref idref="c1"/></spine></package>`;
    const zipped = zipSync({
      "META-INF/container.xml": strToU8(container),
      "OEBPS/content.opf": strToU8(opf),
      "OEBPS/ch1.xhtml": strToU8("<html><body><p>Order independent.</p></body></html>"),
    });
    const html = await epubToHtml({ name: "order.epub", arrayBuffer: async () => zipped.slice().buffer });
    assert.match(html, /Order independent/, `failed for ${item}`);
  }
});

test("epubToHtml accepts single-quoted container, manifest, and image attributes", async () => {
  const { zipSync, strToU8 } = await import("fflate");
  const { epubToHtml } = await import("../src/services/office.service.js");
  const container = "<?xml version='1.0'?><container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'><rootfiles><rootfile full-path='OEBPS/content.opf' media-type='application/oebps-package+xml'/></rootfiles></container>";
  const opf = "<package xmlns='http://www.idpf.org/2007/opf'><manifest><item id='c1' href='ch1.xhtml' media-type='application/xhtml+xml'/><item id='img1' href='images/pic.png' media-type='image/png'/></manifest><spine><itemref idref='c1'/></spine></package>";
  const zipped = zipSync({
    "META-INF/container.xml": strToU8(container),
    "OEBPS/content.opf": strToU8(opf),
    "OEBPS/ch1.xhtml": strToU8("<html><body><p>Single quoted.</p><img src='images/pic.png'/></body></html>"),
    "OEBPS/images/pic.png": Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]),
  });
  const html = await epubToHtml({ name: "quotes.epub", arrayBuffer: async () => zipped.slice().buffer });
  assert.match(html, /Single quoted/);
  assert.match(html, /src="data:image\/png;base64,/);
});

test("pptxToSlides parses DrawingML in any attribute order and with either quote style", async () => {
  const { zipSync, strToU8 } = await import("fflate");
  const { pptxToSlides } = await import("../src/services/office.service.js");
  // cy before cx: a 16:9 deck must NOT fall back to the 4:3 default (9144000).
  const presentation = '<p:presentation xmlns:p="p"><p:sldSz cy="6858000" cx="12192000"/></p:presentation>';
  const slide = '<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>' +
    // y before x / cy before cx, plus an <a:extLst><a:ext uri=...> ahead of the
    // real <a:ext> (PowerPoint writes these) which must not shadow the geometry.
    '<p:sp><p:nvSpPr><p:cNvPr><a:extLst><a:ext uri="{FF2B5EF4}"/></a:extLst></p:cNvPr><p:nvPr><p:ph type=\'title\'/></p:nvPr></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off y="200" x="100"/><a:ext cy="400" cx="300"/></a:xfrm></p:spPr>' +
    '<p:txBody><a:p><a:r><a:t>Reversed Title</a:t></a:r></a:p></p:txBody></p:sp>' +
    // Single-quoted r:embed and geometry.
    "<p:pic><p:blipFill><a:blip r:embed='rId1'/></p:blipFill><p:spPr><a:xfrm><a:off x='1000000' y='2000000'/><a:ext cx='3000000' cy='2000000'/></a:xfrm></p:spPr></p:pic>" +
    '</p:spTree></p:cSld></p:sld>';
  // Id last, exactly as generators other than PowerPoint emit it.
  const slideRels = '<Relationships xmlns="r"><Relationship Target="../media/image1.png" Type="image" Id="rId1"/></Relationships>';
  const zipped = zipSync({
    "ppt/presentation.xml": strToU8(presentation),
    "ppt/slides/slide1.xml": strToU8(slide),
    "ppt/slides/_rels/slide1.xml.rels": strToU8(slideRels),
    "ppt/media/image1.png": Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 8]),
  });
  const file = { name: "reversed.pptx", arrayBuffer: async () => zipped.slice().buffer };
  const { slideWidthEmu, slideHeightEmu, slides } = await pptxToSlides(file);
  assert.equal(slideWidthEmu, 12192000);
  assert.equal(slideHeightEmu, 6858000);
  assert.notEqual(slideWidthEmu, 9144000); // the 4:3 default would be the wrong aspect ratio

  const textElement = slides[0].elements.find((element) => element.type === "text");
  assert.ok(textElement && textElement.box, "reversed <a:off>/<a:ext> should still give a box");
  assert.equal(textElement.title, true); // single-quoted <p:ph type='title'/>
  assert.equal(textElement.paragraphs[0].text, "Reversed Title");
  assert.ok(Math.abs(textElement.box.x - 100 / 12192000) < 1e-12);
  assert.ok(Math.abs(textElement.box.y - 200 / 6858000) < 1e-12);
  assert.ok(Math.abs(textElement.box.w - 300 / 12192000) < 1e-12);
  assert.ok(Math.abs(textElement.box.h - 400 / 6858000) < 1e-12);

  const imageElement = slides[0].elements.find((element) => element.type === "image");
  assert.ok(imageElement, "Relationship with Id last should still map to the picture");
  assert.match(imageElement.dataUrl, /^data:image\/png;base64,/);
  assert.ok(imageElement.box && Math.abs(imageElement.box.x - 1000000 / 12192000) < 1e-12);
});

test("readWorkbookSheets rejects binary masquerading as a spreadsheet and still reads csv", async () => {
  const { readWorkbookSheets } = await import("../src/services/office.service.js");
  // A PDF renamed .xlsx used to come back as a one-column sheet of PDF source
  // via SheetJS's plain-text fallback.
  const pdf = strToU8("%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
  await assert.rejects(
    () => readWorkbookSheets({ name: "report.xlsx", arrayBuffer: async () => pdf.slice().buffer }),
    /could not be read as a spreadsheet/
  );
  const binary = new Uint8Array(512);
  for (let index = 0; index < binary.length; index += 1) binary[index] = (index * 7) % 256;
  await assert.rejects(
    () => readWorkbookSheets({ name: "blob.xlsx", arrayBuffer: async () => binary.slice().buffer }),
    /could not be read as a spreadsheet/
  );
  // Real text input keeps working.
  const csv = strToU8("Name,Score\nAda,99\n");
  const sheets = await readWorkbookSheets({ name: "marks.csv", arrayBuffer: async () => csv.slice().buffer });
  assert.deepEqual(sheets[0].rows[0], ["Name", "Score"]);
  assert.equal(String(sheets[0].rows[1][0]), "Ada");
});

test("pdf exports report an actionable error when the file is not a readable PDF", () => {
  // extractPositionedPages needs pdf.js (browser-only Vite `?worker` import), so
  // like the pdf.js worker test above this locks the guarantee in at the source
  // level: the load is wrapped and the raw pdf.js message never reaches the user.
  const source = fs.readFileSync(new URL("../src/services/export.service.js", import.meta.url), "utf8");
  assert.match(source, /pdf = await loadPdfDocument\(file\);\s*\}\s*catch/);
  assert.match(source, /This file could not be read as a PDF\. If it is damaged, try the Repair PDF tool first\./);
});

// --- Long-token wrapping, workflow ids, filename stems, LLM gate --------------

// Counts how many times `charCode` is actually drawn into a PDF, by inflating
// every content stream and reading the hex strings pdf-lib feeds to Tj. Used to
// prove the line breaker neither drops nor duplicates characters.
async function drawnCharacterCount(bytes, charCode) {
  const { unzlibSync } = await import("fflate");
  const buffer = Buffer.from(bytes);
  let total = 0;
  let index = 0;
  for (;;) {
    const start = buffer.indexOf("\nstream\n", index);
    if (start === -1) break;
    const end = buffer.indexOf("\nendstream", start);
    if (end === -1) break;
    let content = "";
    try {
      content = Buffer.from(unzlibSync(new Uint8Array(buffer.subarray(start + 8, end)))).toString("latin1");
    } catch {
      content = "";
    }
    for (const [, hex] of content.matchAll(/<([0-9a-fA-F]*)>\s*Tj/g)) {
      for (let at = 0; at + 1 < hex.length; at += 2) {
        if (parseInt(hex.slice(at, at + 2), 16) === charCode) total += 1;
      }
    }
    index = end + 1;
  }
  return total;
}

const LONG_TOKEN_BUDGET_MS = 1500;

test("markdownToPdf breaks a very long unbroken token quickly and losslessly", async () => {
  const token = "x".repeat(8000);
  const started = performance.now();
  const bytes = await markdownToPdf(token);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < LONG_TOKEN_BUDGET_MS, `8000-character token took ${Math.round(elapsed)}ms (budget ${LONG_TOKEN_BUDGET_MS}ms)`);
  const doc = await window.PDFLib.PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 1);
  // Every character survives the break: none dropped, none duplicated.
  assert.equal(await drawnCharacterCount(bytes, 0x78), 8000);
});

test("csvToPdf wraps a single very wide cell quickly", async () => {
  const started = performance.now();
  const bytes = await csvToPdf(`a,b\n${"x".repeat(4000)},2`);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < LONG_TOKEN_BUDGET_MS, `4000-character cell took ${Math.round(elapsed)}ms (budget ${LONG_TOKEN_BUDGET_MS}ms)`);
  assert.ok((await window.PDFLib.PDFDocument.load(bytes)).getPageCount() >= 1);
  assert.equal(await drawnCharacterCount(bytes, 0x78), 4000);
});

test("gstInvoicePdf wraps a very long item description quickly and losslessly", async () => {
  const invoiceFor = (description) => business.computeGstInvoice({
    seller: { name: "Studio", gstin: SELLER_MH, state: "27" },
    buyer: { name: "Client", gstin: BUYER_MH },
    invoiceNo: "INV-LONG-1",
    items: [{ description, hsn: "998311", qty: 1, unit: "NOS", rate: 100, discountPercent: 0, gstRate: 18 }],
  });
  // Baseline: the invoice chrome ("Taxable value" and friends) draws its own
  // "z"-free text, so measure one description character and compare.
  const baseline = await drawnCharacterCount(await business.gstInvoicePdf(invoiceFor("z")), 0x7a);
  const started = performance.now();
  const bytes = await business.gstInvoicePdf(invoiceFor("z".repeat(8000)));
  const elapsed = performance.now() - started;
  assert.ok(elapsed < LONG_TOKEN_BUDGET_MS, `8000-character description took ${Math.round(elapsed)}ms (budget ${LONG_TOKEN_BUDGET_MS}ms)`);
  assert.ok((await window.PDFLib.PDFDocument.load(bytes)).getPageCount() >= 1);
  assert.equal(await drawnCharacterCount(bytes, 0x7a) - baseline, 7999);
});

test("workflow steps only accept own workflow op ids", async () => {
  const source = new File([await textToPdf("workflow guard")], "guard.pdf", { type: "application/pdf" });
  for (const op of ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"]) {
    // Inherited keys must be rejected up front, not blow up inside the run.
    await assert.rejects(() => business.runWorkflow(source, [{ op }]), /not a supported workflow step/);
    const error = assert.throws(() => business.defaultStepOptions(op), /not a supported workflow step/);
    assert.equal(error instanceof TypeError, false, `${op} raised a TypeError`);
  }
  // A real op still resolves.
  assert.deepEqual(business.defaultStepOptions("watermark"), { text: "DRAFT", size: "48", opacity: "0.18" });
});

test("safeFilename never returns a dot-only, path-like stem", () => {
  for (const input of [".", "..", "...", "....", "../..", "./."]) {
    const result = safeFilename(input);
    assert.equal(/^\.+$/.test(result), false, `${input} produced "${result}"`);
    assert.equal(result, "myfilekit-file");
  }
  assert.equal(safeFilename("..", "peer-file"), "peer-file");
  assert.equal(webrtc.sanitizeReceivedFilename(".."), "myfilekit-received");
  // Unchanged behaviour for ordinary names.
  assert.equal(safeFilename("../../etc/passwd"), "passwd");
  assert.equal(webrtc.sanitizeReceivedFilename("<script>alert(1)</script>.png"), "script.png");
});

test("llm.service refuses to send unless enabled is strictly true", async () => {
  let calls = 0;
  const spyFetch = async () => { calls += 1; throw new Error("fetch must not be reached"); };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = spyFetch;
  try {
    for (const enabled of ["true", 1, {}, "false", [], "yes"]) {
      const settings = { enabled, baseUrl: "https://api.example.com/v1", model: "m", apiKey: "k" };
      assert.equal(llm.isLlmConfigured(settings), false, `enabled=${JSON.stringify(enabled)} must not count as configured`);
      await assert.rejects(
        () => llm.requestChatCompletion({ settings, prompt: "secret document text" }),
        /switched off/i,
        `enabled=${JSON.stringify(enabled)} must be refused`
      );
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(calls, 0, "no fetch may happen unless the endpoint is explicitly enabled");
});

// --- PDF standard security handler (src/services/pdf-crypto.service.js) -------
// This is security code, so it is exercised hard here in Node: known-answer
// tests for the primitives, full encrypt/decrypt round trips at every revision
// the writer supports, permission-bit arithmetic, and clear refusals. The
// encryptor is also validated against pdf.js, a third-party implementation, so
// "it round-trips through my own decryptor" is never the only evidence.

const HEX = (bytes) => Buffer.from(bytes).toString("hex");
const MARKER = "MyFileKit crypto marker ZQ7";

async function cryptoSamplePdf(pages = 3) {
  const { PDFDocument, StandardFonts } = window.PDFLib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pages; index++) {
    const page = doc.addPage([400, 300]);
    page.drawText(`Confidential page ${index + 1}`, { x: 40, y: 240, size: 18, font });
    page.drawText(MARKER, { x: 40, y: 200, size: 11, font });
  }
  doc.setTitle("Crypto Round Trip");
  doc.setAuthor("MyFileKit Tester");
  return new Uint8Array(await doc.save());
}

// Every inflatable stream in the file, base64'd and sorted: a byte-level
// fingerprint of the document's actual content, independent of object numbering.
async function decodedStreamFingerprint(bytes) {
  const { PDFDocument, PDFRawStream, decodePDFRawStream } = window.PDFLib;
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const out = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    try {
      out.push(Buffer.from(decodePDFRawStream(object).decode()).toString("base64"));
    } catch {
      out.push(Buffer.from(object.contents).toString("base64"));
    }
  }
  return out.sort();
}

let pdfjsForInterop;
async function loadPdfjsForInterop() {
  if (!pdfjsForInterop) pdfjsForInterop = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsForInterop;
}

async function pdfjsPageTexts(bytes, password) {
  const pdfjs = await loadPdfjsForInterop();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), password, verbosity: 0, isEvalSupported: false }).promise;
  const texts = [];
  for (let page = 1; page <= doc.numPages; page++) {
    texts.push((await doc.getPage(page)).getTextContent ? (await (await doc.getPage(page)).getTextContent()).items.map((item) => item.str).join("") : "");
  }
  await doc.destroy();
  return texts;
}

test("md5 and rc4 match published known answers", () => {
  assert.equal(HEX(pdfCrypto.md5(new Uint8Array(0))), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(HEX(pdfCrypto.md5(strToU8("abc"))), "900150983cd24fb0d6963f7d28e17f72");
  assert.equal(HEX(pdfCrypto.md5(strToU8("message digest"))), "f96b697d7cb7938d525a2f31aaf161d0");
  assert.equal(HEX(pdfCrypto.md5(strToU8("The quick brown fox jumps over the lazy dog"))), "9e107d9d372bb6826bd81d3542a419d6");
  // 55/56/64-byte inputs straddle MD5's padding boundary, where a length bug hides.
  assert.equal(HEX(pdfCrypto.md5(strToU8("a".repeat(55)))), "ef1772b6dff9a122358552954ad0df65");
  assert.equal(HEX(pdfCrypto.md5(strToU8("a".repeat(56)))), "3b0c8ac703f828b04c6c197006d17218");
  assert.equal(HEX(pdfCrypto.md5(strToU8("a".repeat(64)))), "014842d480b571495a4a0363793f7367");
  // RC4 test vector from the original specification.
  assert.equal(HEX(pdfCrypto.rc4(strToU8("Key"), strToU8("Plaintext"))), "bbf316e8d940af0ad3");
  assert.equal(HEX(pdfCrypto.rc4(strToU8("Secret"), strToU8("Attack at dawn"))), "45a01f645fc35b383552544b9bf5");
  // RC4 is its own inverse.
  assert.equal(Buffer.from(pdfCrypto.rc4(strToU8("k"), pdfCrypto.rc4(strToU8("k"), strToU8("round trip")))).toString(), "round trip");
});

test("the password padding string matches ISO 32000-1 Table 21", () => {
  assert.equal(pdfCrypto.PDF_PAD_STRING.length, 32);
  assert.equal(
    HEX(pdfCrypto.PDF_PAD_STRING),
    "28bf4e5e4e758a41640" + "04e56fffa01082e2e00b6d0683e802f0ca9fe6453697a"
  );
});

test("the object-level rewrite is lossless on its own, before any crypto", async () => {
  // The parser/serialiser is the riskiest half of this service, so it is tested
  // apart from the crypt layer: same pages, same metadata, same stream bytes,
  // with pdf-lib's object streams and cross-reference stream unpacked into a
  // classic table.
  const original = await cryptoSamplePdf(4);
  assert.equal(Buffer.from(original).includes("/ObjStm"), true);
  const rewritten = await pdfCrypto.rewritePdfObjects(original);
  assert.equal(Buffer.from(rewritten.bytes).includes("/ObjStm"), false);
  assert.equal(Buffer.from(rewritten.bytes).includes("/Type /XRef"), false);
  assert.match(Buffer.from(rewritten.bytes.subarray(0, 9)).toString("latin1"), /^%PDF-1\.\d/);
  // A classic table: object 0 heads the free list, then one 20-byte entry each.
  assert.match(Buffer.from(rewritten.bytes).toString("latin1"), /\nxref\n0 \d+\n0000000000 65535 f \n(\d{10} 00000 n \n)+trailer\n/);
  assert.match(Buffer.from(rewritten.bytes).toString("latin1"), /startxref\n\d+\n%%EOF\n$/);
  const reloaded = await window.PDFLib.PDFDocument.load(rewritten.bytes, { updateMetadata: false });
  assert.equal(reloaded.getPageCount(), 4);
  assert.equal(reloaded.getTitle(), "Crypto Round Trip");
  assert.deepEqual(await decodedStreamFingerprint(rewritten.bytes), await decodedStreamFingerprint(original));
  assert.deepEqual(await pdfjsPageTexts(rewritten.bytes), await pdfjsPageTexts(original));
});

test("permission bits map to the /P integer the spec describes", () => {
  // ISO 32000-1 Table 22 numbers the bits from 1; bit N has value 2^(N-1).
  assert.deepEqual(pdfCrypto.PDF_PERMISSION_BITS, {
    print: 3,
    modify: 4,
    copy: 5,
    annotate: 6,
    fillForms: 9,
    accessibility: 10,
    assemble: 11,
    printHighQuality: 12,
  });
  const all = pdfCrypto.permissionsToP(pdfCrypto.ALL_PERMISSIONS_ALLOWED);
  // Bits 1-2 clear, every other bit set.
  assert.equal(all, -4);
  assert.equal(all & 1, 0);
  assert.equal(all & 2, 0);
  const bits = { print: 4, modify: 8, copy: 16, annotate: 32, fillForms: 256, accessibility: 512, assemble: 1024, printHighQuality: 2048 };
  for (const [permission, bit] of Object.entries(bits)) {
    const p = pdfCrypto.permissionsToP({ ...pdfCrypto.ALL_PERMISSIONS_ALLOWED, [permission]: false });
    assert.equal(p & bit, 0, `${permission} should clear bit value ${bit}`);
    assert.equal(all & bit, bit, `${permission} should be set when everything is allowed`);
    // Only that one bit moves.
    assert.equal(p | bit, all, `${permission} cleared more than its own bit`);
    assert.equal(pdfCrypto.pToPermissions(p)[permission], false);
  }
  assert.deepEqual(pdfCrypto.pToPermissions(all), { ...pdfCrypto.ALL_PERMISSIONS_ALLOWED });
});

test("AES-256 (revision 6) encrypt/decrypt is a lossless round trip", async () => {
  const original = await cryptoSamplePdf();
  const before = await decodedStreamFingerprint(original);

  const encrypted = await pdfCrypto.encryptPdf(original, { userPassword: "hunter2", ownerPassword: "owner-secret", algorithm: "aes-256" });
  assert.match(encrypted.algorithm, /AES-256/);
  assert.equal(encrypted.version, 5);
  assert.equal(encrypted.revision, 6);

  // The document really is encrypted: its plaintext marker is gone from the
  // bytes, and pdf-lib refuses to read the file without a password.
  assert.equal(Buffer.from(encrypted.bytes).includes(MARKER), false);
  assert.equal(Buffer.from(encrypted.bytes).includes("/AESV3"), true);
  await assert.rejects(() => window.PDFLib.PDFDocument.load(encrypted.bytes), /encrypted/i);

  // pdf-lib's writer uses object streams and a cross-reference stream; the
  // crypt layer unpacks both, so nothing stays hidden in a compressed container.
  assert.equal(Buffer.from(original).includes("/ObjStm"), true);
  assert.equal(Buffer.from(encrypted.bytes).includes("/ObjStm"), false);

  const decrypted = await pdfCrypto.decryptPdf(encrypted.bytes, "hunter2");
  const reloaded = await window.PDFLib.PDFDocument.load(decrypted.bytes, { updateMetadata: false });
  assert.equal(reloaded.getPageCount(), 3);
  assert.equal(reloaded.getTitle(), "Crypto Round Trip");
  assert.equal(reloaded.getAuthor(), "MyFileKit Tester");
  assert.deepEqual(await decodedStreamFingerprint(decrypted.bytes), before);

  // The owner password reaches the same file key.
  const viaOwner = await pdfCrypto.decryptPdf(encrypted.bytes, "owner-secret");
  assert.deepEqual(await decodedStreamFingerprint(viaOwner.bytes), before);
});

test("AES-128 (revision 4, AESV2) encrypt/decrypt is a lossless round trip", async () => {
  const original = await cryptoSamplePdf(2);
  const before = await decodedStreamFingerprint(original);
  const encrypted = await pdfCrypto.encryptPdf(original, { userPassword: "correct horse", algorithm: "aes-128" });
  assert.equal(encrypted.version, 4);
  assert.equal(encrypted.revision, 4);
  assert.equal(Buffer.from(encrypted.bytes).includes("/AESV2"), true);
  assert.equal(Buffer.from(encrypted.bytes).includes(MARKER), false);
  const decrypted = await pdfCrypto.decryptPdf(encrypted.bytes, "correct horse");
  assert.equal((await window.PDFLib.PDFDocument.load(decrypted.bytes, { updateMetadata: false })).getPageCount(), 2);
  assert.deepEqual(await decodedStreamFingerprint(decrypted.bytes), before);
});

test("every RC4 revision the writer supports also reads back losslessly", async () => {
  const original = await cryptoSamplePdf(1);
  const before = await decodedStreamFingerprint(original);
  // rc4-128 is /V 4 with an RC4 crypt filter; the -r3 and -r2 variants exist so
  // the /V 2 (RC4-128) and /V 1 (RC4-40) read paths are covered by real files.
  const expected = {
    "rc4-128": { version: 4, revision: 4, keyBits: 128 },
    "rc4-128-r3": { version: 2, revision: 3, keyBits: 128 },
    "rc4-40-r2": { version: 1, revision: 2, keyBits: 40 },
    "aes-256-r5": { version: 5, revision: 5, keyBits: 256 },
  };
  for (const [algorithm, shape] of Object.entries(expected)) {
    const encrypted = await pdfCrypto.encryptPdf(original, { userPassword: "legacy-pw", ownerPassword: "legacy-owner", algorithm });
    assert.equal(encrypted.version, shape.version, `${algorithm} /V`);
    assert.equal(encrypted.revision, shape.revision, `${algorithm} /R`);
    assert.equal(Buffer.from(encrypted.bytes).includes(MARKER), false, `${algorithm} left plaintext behind`);
    const info = await pdfCrypto.inspectPdfEncryption(encrypted.bytes);
    assert.equal(info.encrypted, true);
    assert.equal(info.keyBits, shape.keyBits, `${algorithm} key length`);
    assert.equal(info.opensWithoutPassword, false);
    for (const password of ["legacy-pw", "legacy-owner"]) {
      const decrypted = await pdfCrypto.decryptPdf(encrypted.bytes, password);
      assert.deepEqual(await decodedStreamFingerprint(decrypted.bytes), before, `${algorithm} via ${password}`);
    }
  }
});

test("a wrong password is refused identically for every revision and produces no output", async () => {
  const original = await cryptoSamplePdf(1);
  const messages = new Set();
  for (const algorithm of ["aes-256", "aes-128", "rc4-128", "rc4-128-r3", "rc4-40-r2", "aes-256-r5"]) {
    const encrypted = await pdfCrypto.encryptPdf(original, { userPassword: "right", ownerPassword: "owner", algorithm });
    for (const attempt of ["wrong", "", "Right", "right ", "owne"]) {
      const error = await pdfCrypto.decryptPdf(encrypted.bytes, attempt).then(
        (result) => new Error(`${algorithm}/"${attempt}" produced ${result.bytes.length} bytes instead of failing`),
        (thrown) => thrown
      );
      assert.match(error.message, /does not open this PDF/, `${algorithm} with "${attempt}"`);
      messages.add(error.message);
    }
  }
  // One message for every failure: nothing reveals whether the user or the owner
  // password was the near miss, or which revision rejected it.
  assert.equal(messages.size, 1);
});

test("encrypting with printing disallowed clears the right /P bit and it survives a re-read", async () => {
  const original = await cryptoSamplePdf(1);
  const permissions = { ...pdfCrypto.ALL_PERMISSIONS_ALLOWED, print: false, copy: false };
  const encrypted = await pdfCrypto.encryptPdf(original, { userPassword: "pw", algorithm: "aes-256", permissions });
  assert.equal(encrypted.p & 4, 0, "print bit (value 4) must be clear");
  assert.equal(encrypted.p & 16, 0, "copy bit (value 16) must be clear");
  assert.equal(encrypted.p & 8, 8, "modify bit (value 8) must stay set");
  assert.equal(encrypted.permissions.print, false);
  assert.equal(encrypted.permissions.modify, true);

  // Readable straight off the file without the password...
  const inspected = await pdfCrypto.inspectPdfEncryption(encrypted.bytes);
  assert.equal(inspected.p, encrypted.p);
  assert.equal(inspected.permissions.print, false);
  assert.equal(inspected.permissions.copy, false);
  assert.equal(inspected.permissions.annotate, true);

  // ...and unchanged after decrypting with it.
  const decrypted = await pdfCrypto.decryptPdf(encrypted.bytes, "pw");
  assert.equal(decrypted.p, encrypted.p);
  assert.deepEqual(decrypted.permissions, encrypted.permissions);
});

test("unlockPdf strips the /Encrypt dictionary and makes permissions permissive", async () => {
  const original = await cryptoSamplePdf(2);
  const before = await decodedStreamFingerprint(original);
  // An owner password with an empty user password: opens freely, but restricted.
  const restricted = await pdfCrypto.encryptPdf(original, {
    userPassword: "",
    ownerPassword: "boss",
    algorithm: "aes-256",
    permissions: { ...pdfCrypto.ALL_PERMISSIONS_ALLOWED, print: false, copy: false, modify: false },
  });
  assert.equal((await pdfCrypto.inspectPdfEncryption(restricted.bytes)).opensWithoutPassword, true);

  const unlocked = await pdfCrypto.unlockPdf(restricted.bytes);
  assert.equal(Buffer.from(unlocked.bytes).includes("/Encrypt"), false);
  assert.equal(Buffer.from(unlocked.bytes).includes("/AESV3"), false);
  assert.equal(unlocked.p, -4);
  assert.deepEqual(unlocked.permissions, { ...pdfCrypto.ALL_PERMISSIONS_ALLOWED });
  assert.deepEqual(unlocked.permissionsBefore, pdfCrypto.pToPermissions(restricted.p));
  assert.equal((await pdfCrypto.inspectPdfEncryption(unlocked.bytes)).encrypted, false);
  assert.equal((await window.PDFLib.PDFDocument.load(unlocked.bytes, { updateMetadata: false })).getPageCount(), 2);
  assert.deepEqual(await decodedStreamFingerprint(unlocked.bytes), before);

  // The same holds at every revision, including the RC4 ones, where an empty
  // user password takes a completely different code path (Algorithm 2 vs 2.A).
  for (const algorithm of ["aes-128", "rc4-128", "rc4-128-r3", "rc4-40-r2"]) {
    const legacy = await pdfCrypto.encryptPdf(original, {
      userPassword: "",
      ownerPassword: "boss",
      algorithm,
      permissions: { ...pdfCrypto.ALL_PERMISSIONS_ALLOWED, print: false },
    });
    assert.equal((await pdfCrypto.inspectPdfEncryption(legacy.bytes)).opensWithoutPassword, true, algorithm);
    const opened = await pdfCrypto.unlockPdf(legacy.bytes);
    assert.equal(opened.p, -4, algorithm);
    assert.equal(opened.permissionsBefore.print, false, algorithm);
    assert.deepEqual(await decodedStreamFingerprint(opened.bytes), before, algorithm);
  }

  // A PDF that needs a password to open is not this tool's job, and it says so.
  const needsPassword = await pdfCrypto.encryptPdf(original, { userPassword: "needed", algorithm: "aes-256" });
  await assert.rejects(() => pdfCrypto.unlockPdf(needsPassword.bytes), /needs a password just to open it/);
  // Neither is an unencrypted file.
  await assert.rejects(() => pdfCrypto.unlockPdf(original), /no encryption/);
});

test("unsupported or damaged /Encrypt dictionaries are refused clearly, never guessed at", async () => {
  const original = await cryptoSamplePdf(1);
  const encrypted = await pdfCrypto.encryptPdf(original, { userPassword: "pw", algorithm: "aes-256" });
  const patch = (from, to) => new Uint8Array(Buffer.from(Buffer.from(encrypted.bytes).toString("latin1").replace(from, to), "latin1"));

  const cases = [
    [patch("/V 5", "/V 3"), /\/V 3, which this tool does not support/],
    [patch("/R 6", "/R 9"), /\/R 9, which this tool does not support/],
    [patch("/Filter /Standard", "/Filter /Adobe.PubSec"), /Adobe\.PubSec security handler/],
    [patch("/CFM /AESV3", "/CFM /Nonsense"), /Nonsense crypt filter method/],
    [patch("/StmF /StdCF", "/StmF /NoSuchFilter"), /crypt filter \/NoSuchFilter, but does not define it/],
  ];
  for (const [bytes, expected] of cases) {
    await assert.rejects(() => pdfCrypto.decryptPdf(bytes, "pw"), expected);
  }

  // A nonsense crypt-filter key length is refused rather than used. (/V 5 pins
  // the key at 256 bits by definition, so this only applies from /V 4 down.)
  const aes128 = await pdfCrypto.encryptPdf(original, { userPassword: "pw", algorithm: "aes-128" });
  const shortKey = new Uint8Array(Buffer.from(Buffer.from(aes128.bytes).toString("latin1").replace("/Length 16", "/Length 2"), "latin1"));
  await assert.rejects(() => pdfCrypto.decryptPdf(shortKey, "pw"), /which is out of range/);

  // Not a PDF at all, and a PDF with no objects: both fail fast rather than hang.
  await assert.rejects(() => pdfCrypto.decryptPdf(strToU8("this is not a pdf"), "pw"), /does not look like a PDF/);
  await assert.rejects(() => pdfCrypto.decryptPdf(strToU8("%PDF-1.7\ntrailer<<>>\n%%EOF"), "pw"), /No PDF objects/);
  // And an unencrypted PDF is not silently re-emitted as if it had been decrypted.
  await assert.rejects(() => pdfCrypto.decryptPdf(original, "pw"), /is not encrypted/);
  // Nor is an already-encrypted PDF silently double-encrypted.
  await assert.rejects(() => pdfCrypto.encryptPdf(encrypted.bytes, { userPassword: "new" }), /already password protected/);
  // An empty password on both fields is refused before any work happens.
  await assert.rejects(() => pdfCrypto.encryptPdf(original, { userPassword: "", ownerPassword: "" }), /Enter a password/);
  await assert.rejects(() => pdfCrypto.encryptPdf(original, { userPassword: "pw", algorithm: "des" }), /Unknown PDF encryption algorithm/);
});

test("pdf.js opens what encryptPdf writes, and rejects the wrong password", async () => {
  const original = await cryptoSamplePdf(2);
  const expectedText = await pdfjsPageTexts(original);
  assert.match(expectedText[0], /MyFileKit crypto marker ZQ7/);

  for (const algorithm of ["aes-256", "aes-128", "rc4-128", "rc4-128-r3", "rc4-40-r2", "aes-256-r5"]) {
    const encrypted = await pdfCrypto.encryptPdf(original, { userPassword: "hunter2", ownerPassword: "owner-secret", algorithm });
    // A third-party implementation reads the same content back out.
    assert.deepEqual(await pdfjsPageTexts(encrypted.bytes, "hunter2"), expectedText, `${algorithm} with the user password`);
    assert.deepEqual(await pdfjsPageTexts(encrypted.bytes, "owner-secret"), expectedText, `${algorithm} with the owner password`);
    await assert.rejects(() => pdfjsPageTexts(encrypted.bytes, "wrong"), /Incorrect Password/, `${algorithm} wrong password`);
    await assert.rejects(() => pdfjsPageTexts(encrypted.bytes, undefined), /No password given/, `${algorithm} missing password`);
    // And our own decryptor's output is readable with no password at all.
    const decrypted = await pdfCrypto.decryptPdf(encrypted.bytes, "hunter2");
    assert.deepEqual(await pdfjsPageTexts(decrypted.bytes), expectedText, `${algorithm} after decryptPdf`);
  }
});

test("pdf.js sees the permission bits encryptPdf wrote", async () => {
  const pdfjs = await loadPdfjsForInterop();
  const original = await cryptoSamplePdf(1);
  const encrypted = await pdfCrypto.encryptPdf(original, {
    userPassword: "pw",
    ownerPassword: "own",
    algorithm: "aes-256",
    permissions: { ...pdfCrypto.ALL_PERMISSIONS_ALLOWED, print: false, copy: false },
  });
  const doc = await pdfjs.getDocument({ data: new Uint8Array(encrypted.bytes), password: "pw", verbosity: 0, isEvalSupported: false }).promise;
  const granted = await doc.getPermissions();
  await doc.destroy();
  assert.equal(granted.includes(pdfjs.PermissionFlag.PRINT), false);
  assert.equal(granted.includes(pdfjs.PermissionFlag.COPY), false);
  assert.equal(granted.includes(pdfjs.PermissionFlag.MODIFY_CONTENTS), true);
  assert.equal(granted.includes(pdfjs.PermissionFlag.ASSEMBLE), true);
});

test("the three security tools are registered under Security & Privacy with renderers", () => {
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const expected = { "encrypt-pdf-tool": "Encrypt PDF", "remove-password-tool": "Remove Password", "unlock-pdf-tool": "Unlock PDF" };
  for (const [id, name] of Object.entries(expected)) {
    const found = tools.find((tool) => tool.id === id);
    assert.ok(found, `${id} should be registered`);
    assert.equal(found.name, name);
    assert.equal(found.category, "Security & Privacy");
    assert.equal(found.status, "available");
    assert.equal(found.localProcessing, true);
    assert.deepEqual(found.acceptedTypes, ["application/pdf"]);
    assert.equal(routeForHash(found.route).tool.id, id);
    assert.equal(appSource.includes(`"${id}"`), true, `${id} is missing from ToolRenderer`);
  }
  // The rename is complete: the old category name survives nowhere.
  assert.equal(categories.includes("Security & Privacy"), true);
  assert.equal(categories.includes("Privacy Tools"), false);
  assert.equal(tools.some((tool) => tool.category === "Privacy Tools"), false);
  assert.equal(appSource.includes("Privacy Tools"), false);
  assert.equal(fs.readFileSync(new URL("../src/registry/tools.registry.js", import.meta.url), "utf8").includes("Privacy Tools"), false);
  // The pre-existing privacy tools moved across with it.
  for (const id of ["pdf-metadata-cleaner-tool", "metadata-cleaner", "fingerprint-pdf-tool"]) {
    assert.equal(tools.find((tool) => tool.id === id).category, "Security & Privacy", id);
  }
});

test("the security tools never write a password into their status text or filenames", () => {
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const start = appSource.indexOf("function EncryptPdfTool");
  const end = appSource.indexOf("function ImageOutputTool");
  assert.ok(start > 0 && end > start);
  const section = appSource.slice(start, end);
  // No logging, no storage, no network, no password interpolated into output.
  for (const forbidden of ["console.", "localStorage", "sessionStorage", "indexedDB", "fetch("]) {
    assert.equal(section.includes(forbidden), false, `the security tools must not use ${forbidden}`);
  }
  assert.equal(/\$\{\s*(password|ownerPassword|confirmation)\s*\}/.test(section), false, "a password must never be interpolated into output");
  assert.equal(/type="password"/.test(appSource.slice(appSource.indexOf("function PasswordField"), start)), true);
  // Passwords are cleared on reset and on unmount.
  assert.equal(section.includes("useEffect(() => forgetPasswords, [])"), true);
  assert.equal(section.includes("useEffect(() => forgetPassword, [])"), true);
});


// --- PII detection, redaction mapping, and the privacy scanner ----------------
// ESM imports are hoisted, so this import belongs with the block it serves.
import {
  CONFIDENCE,
  buildPrivacyReportText,
  cardBrand,
  confidenceLabel,
  detectPii,
  isValidIpv4,
  isValidIpv6,
  luhnValid,
  maskPii,
  maskValue,
  parseXmpFields,
  rectsForMatch,
  sanitiseForReport,
  scanContentForInvisibleText,
  scanPdfStructure,
  summarisePii,
  validateAadhaar,
  validateIfsc,
  validateIndianPassport,
  validatePan,
  verhoeffCheckDigit,
  verhoeffValid,
} from "../src/services/pii.service.js";

// A fixed "now" keeps the birthdate-plausibility window deterministic.
const PII_NOW = "2026-08-27T00:00:00Z";

// Aadhaar-shaped numbers whose 12th digit is the real Verhoeff check digit.
const VALID_AADHAAR = ["234567890124", "789012345674", "998877665548"];

const highConfidence = (matches) => matches.filter((match) => match.confidence >= CONFIDENCE.HIGH);
const typesOf = (matches) => matches.map((match) => match.type);

test("Verhoeff: valid Aadhaar numbers pass and every single-digit mutation fails", () => {
  for (const aadhaar of VALID_AADHAAR) {
    assert.equal(verhoeffValid(aadhaar), true, `${aadhaar} should satisfy Verhoeff`);
    assert.equal(validateAadhaar(aadhaar).valid, true);
    // The check digit is genuinely derived, not assumed.
    assert.equal(String(verhoeffCheckDigit(aadhaar.slice(0, 11))), aadhaar[11]);
    // Any single-digit change must break the checksum. This is what proves the
    // checksum is real rather than a 12-digit regex in disguise.
    for (let index = 0; index < aadhaar.length; index++) {
      for (let digit = 0; digit <= 9; digit++) {
        if (String(digit) === aadhaar[index]) continue;
        const mutated = `${aadhaar.slice(0, index)}${digit}${aadhaar.slice(index + 1)}`;
        assert.equal(verhoeffValid(mutated), false, `mutation ${mutated} must fail Verhoeff`);
      }
    }
  }
});

test("Aadhaar rejects reserved leading digits, wrong lengths, and unchecksummed runs", () => {
  // 0/1 are reserved by UIDAI: even a Verhoeff-valid number is not an Aadhaar.
  for (const lead of ["0", "1"]) {
    const payload = `${lead}2345678901`;
    const number = `${payload}${verhoeffCheckDigit(payload)}`;
    assert.equal(verhoeffValid(number), true, "the constructed number is checksum-valid");
    assert.equal(validateAadhaar(number).valid, false);
    assert.match(validateAadhaar(number).reason, /never starts with 0 or 1/);
  }
  assert.equal(validateAadhaar("23456789012").valid, false, "11 digits is not an Aadhaar");
  assert.equal(validateAadhaar("2345678901245").valid, false, "13 digits is not an Aadhaar");
  assert.equal(validateAadhaar("234567890123").valid, false, "wrong check digit");
  // Spaced 4-4-4 input is accepted, which is how Aadhaar is usually printed.
  assert.equal(validateAadhaar("2345 6789 0124").valid, true);
});

test("Luhn: known brand test numbers pass with the right brand and mutations fail", () => {
  const cards = [
    ["4111111111111111", "Visa"],
    ["4012888888881", "Visa"],
    ["5500005555555559", "Mastercard"],
    ["2223000048410010", "Mastercard"],
    ["371449635398431", "American Express"],
    ["6011111111111117", "Discover"],
    ["6521000000000007", "RuPay"],
  ];
  for (const [number, brand] of cards) {
    assert.equal(luhnValid(number), true, `${number} should pass Luhn`);
    assert.equal(cardBrand(number), brand, `${number} should be ${brand}`);
    // Every single-digit mutation must fail Luhn (mod-10 catches all of them).
    for (let index = 0; index < number.length; index++) {
      for (let digit = 0; digit <= 9; digit++) {
        if (String(digit) === number[index]) continue;
        const mutated = `${number.slice(0, index)}${digit}${number.slice(index + 1)}`;
        assert.equal(luhnValid(mutated), false, `mutation ${mutated} must fail Luhn`);
      }
    }
  }
  assert.equal(luhnValid("1234567890123456"), false);
  assert.equal(cardBrand("9999999999999999"), "", "an unknown IIN reports no brand");
});

test("card detection accepts printed spacing and reports the brand", () => {
  const matches = detectPii("Card 4111 1111 1111 1111 charged today.", { now: PII_NOW });
  const card = matches.find((match) => match.type === "card");
  assert.ok(card);
  assert.equal(card.value, "4111 1111 1111 1111");
  assert.equal(card.confidence, CONFIDENCE.HIGH);
  assert.match(card.note, /Luhn valid/);
  assert.match(card.note, /Visa/);
  // A 16-digit run that fails Luhn is never reported as a card.
  const notACard = detectPii("Docket 4000123456789012 dispatched.", { now: PII_NOW });
  assert.equal(notACard.some((match) => match.type === "card"), false);
});

test("GSTIN reuses the existing validator, and PAN entity type drives confidence", () => {
  const good = detectPii("GSTIN 27AAPFU0939F1ZV on the invoice.", { now: PII_NOW }).find((match) => match.type === "gstin");
  assert.ok(good);
  assert.equal(good.confidence, CONFIDENCE.HIGH);
  // Same shape, wrong mod-36 checksum character: flagged but demoted.
  const bad = detectPii("GSTIN 27AAPFU0939F1ZW on the invoice.", { now: PII_NOW }).find((match) => match.type === "gstin");
  assert.ok(bad);
  assert.equal(bad.confidence, CONFIDENCE.LOW);
  assert.match(bad.note, /Checksum character/);

  assert.equal(validatePan("ABCPD1234E").valid, true);
  assert.equal(validatePan("ABCPD1234E").entity, "Individual");
  assert.equal(validatePan("ABCFD1234E").entity, "Firm / LLP");
  assert.equal(validatePan("ABCDE1234Z").valid, false, "D is not a PAN entity type");
  const pan = detectPii("PAN ABCDE1234Z belongs to nobody.", { now: PII_NOW }).find((match) => match.type === "pan");
  assert.ok(pan);
  assert.equal(pan.confidence, CONFIDENCE.LOW);
  const validPan = detectPii("PAN ABCPD1234E on file.", { now: PII_NOW }).find((match) => match.type === "pan");
  assert.equal(validPan.confidence, CONFIDENCE.HIGH);
  assert.match(validPan.note, /Individual/);
});

test("IFSC, passport, and account-number context rules behave", () => {
  assert.equal(validateIfsc("HDFC0001234").valid, true);
  assert.equal(validateIfsc("HDFC1001234").valid, false, "the 5th character must be 0");
  assert.equal(validateIfsc("HDF0001234").valid, false);

  assert.equal(validateIndianPassport("K1234567").valid, true);
  assert.equal(validateIndianPassport("Q1234567").valid, false, "Q is not issued");
  assert.equal(validateIndianPassport("X1234567").valid, false, "X is not issued");
  assert.equal(validateIndianPassport("K123456").valid, false);

  // Passport shape alone stays low; the keyword lifts it.
  const bare = detectPii("Token A7654321 was issued.", { now: PII_NOW }).find((match) => match.type === "passport");
  assert.equal(bare.confidence, CONFIDENCE.LOW);
  const keyed = detectPii("Passport K1234567 expires soon.", { now: PII_NOW }).find((match) => match.type === "passport");
  assert.equal(keyed.confidence, CONFIDENCE.HIGH);

  // A digit run near an IFSC or an account keyword is worth more than one alone.
  const withIfsc = detectPii("A/C 000123456789012 IFSC HDFC0001234", { now: PII_NOW }).find((match) => match.type === "account");
  assert.equal(withIfsc.confidence, CONFIDENCE.MEDIUM);
  const alone = detectPii("Reference 000123456789012 logged.", { now: PII_NOW }).find((match) => match.type === "account");
  assert.equal(alone.confidence, CONFIDENCE.LOW);
});

test("IP address validation enforces octet bounds and IPv6 grammar", () => {
  assert.equal(isValidIpv4("10.20.30.40"), true);
  assert.equal(isValidIpv4("255.255.255.255"), true);
  assert.equal(isValidIpv4("999.1.1.1"), false);
  assert.equal(isValidIpv4("256.1.1.1"), false);
  assert.equal(isValidIpv4("1.2.3"), false);
  assert.equal(isValidIpv4("1.2.3.4.5"), false);
  assert.equal(detectPii("Host 999.1.1.1 is invalid.", { now: PII_NOW }).some((match) => match.type === "ipv4"), false);
  assert.equal(detectPii("Server 10.20.30.40 responded.", { now: PII_NOW }).some((match) => match.type === "ipv4"), true);
  // A dotted quad after a version word is treated as a version, not an address.
  assert.equal(detectPii("Upgraded to v10.20.30.40 today.", { now: PII_NOW }).some((match) => match.type === "ipv4"), false);

  assert.equal(isValidIpv6("2001:0db8:85a3:0000:0000:8a2e:0370:7334"), true);
  assert.equal(isValidIpv6("fe80::1"), true);
  assert.equal(isValidIpv6("::1"), true);
  assert.equal(isValidIpv6("2001::85a3::7334"), false, "only one :: run is legal");
  assert.equal(isValidIpv6("2001:0db8:85a3:0000:0000:8a2e:0370:7334:9999"), false);
  assert.equal(isValidIpv6("12:34"), false);
  assert.equal(isValidIpv6("::ffff:10.20.30.40"), true);
  assert.equal(isValidIpv6("::ffff:999.1.1.1"), false);
});

test("email and phone edge cases", () => {
  const emails = detectPii("Write to priya.sharma+tax@example.co.in or ops@sub.domain.example.org.", { now: PII_NOW }).filter((match) => match.type === "email");
  assert.deepEqual(emails.map((match) => match.value), ["priya.sharma+tax@example.co.in", "ops@sub.domain.example.org"]);
  assert.equal(detectPii("not-an-email@ or @nope.com or a@b", { now: PII_NOW }).some((match) => match.type === "email"), false);

  // +91 and E.164 are high confidence; a bare 10-digit mobile is only medium
  // unless a phone word sits next to it.
  const prefixed = detectPii("Call +91 98765 43210 now.", { now: PII_NOW }).find((match) => match.type === "phone");
  assert.equal(prefixed.value, "+91 98765 43210");
  assert.equal(prefixed.confidence, CONFIDENCE.HIGH);
  const e164 = detectPii("Ring +14155552671 tomorrow.", { now: PII_NOW }).find((match) => match.type === "phone");
  assert.equal(e164.confidence, CONFIDENCE.HIGH);
  const bare = detectPii("The batch id is 9876543210 for this run.", { now: PII_NOW }).find((match) => match.type === "phone");
  assert.equal(bare.confidence, CONFIDENCE.MEDIUM);
  const keyed = detectPii("Mobile 9876543210", { now: PII_NOW }).find((match) => match.type === "phone");
  assert.equal(keyed.confidence, CONFIDENCE.HIGH);
  // A 10-digit run starting below 6 is not an Indian mobile.
  assert.equal(detectPii("Serial 1234567890 shipped.", { now: PII_NOW }).some((match) => match.type === "phone"), false);
});

test("date of birth needs an adjacent keyword or a birth-plausible year", () => {
  const keyed = detectPii("D.O.B: 14/08/1984", { now: PII_NOW }).find((match) => match.type === "dob");
  assert.equal(keyed.confidence, CONFIDENCE.HIGH);
  const standalone = detectPii("Signed 14/08/1984 in Pune.", { now: PII_NOW }).find((match) => match.type === "dob");
  assert.equal(standalone.confidence, CONFIDENCE.MEDIUM);
  // A keyword earlier in the paragraph must not promote later dates.
  const later = detectPii("Born on 1984-08-14, joined 2020-01-02.", { now: PII_NOW }).filter((match) => match.type === "dob");
  assert.deepEqual(later.map((match) => [match.value, match.confidence]), [["1984-08-14", CONFIDENCE.HIGH]]);
  // Impossible calendar dates are not dates.
  assert.equal(detectPii("Batch 31/02/1990 failed.", { now: PII_NOW }).some((match) => match.type === "dob"), false);
});

test("FALSE POSITIVE suite: ordinary business prose yields zero high-confidence PII", () => {
  const prose = [
    "Invoice INV-2026-004821 was raised on 12 March 2026 for order number 100200300400.",
    "Version 4.2.1 of the SDK shipped with build 20260115 and SKU 10.20.30 in release v10.20.30.40.",
    "Reference 987654321098765 and dispatch docket 4000123456789012 are internal identifiers.",
    "Purchase order PO/2026/0099 covers part codes ABCDE1234Z and QRST-9876-W.",
    "Serial numbers 1234567890, 12345678901234567 and 5500005555555550 were rejected by QA.",
    "The meeting is on 05/06/2026 at 10:30, contract clause 12.4.5 applies, ticket #7654321.",
    "Warehouse bay 60-11-11 holds 6011111111111116 units of stock keeping unit 371449635398430.",
  ].join("\n");
  const matches = detectPii(prose, { now: PII_NOW });
  const high = highConfidence(matches);
  assert.deepEqual(high, [], `no high-confidence PII expected, got: ${JSON.stringify(high.map((match) => [match.type, match.value]))}`);
  // The digit runs are still surfaced, but only as low-confidence candidates.
  assert.equal(matches.every((match) => match.confidence <= CONFIDENCE.MEDIUM), true);
  assert.equal(matches.some((match) => match.type === "card"), false, "no Luhn-valid card in this prose");
  assert.equal(matches.some((match) => match.type === "aadhaar"), false, "no Verhoeff-valid Aadhaar in this prose");
  assert.equal(matches.some((match) => match.type === "gstin" && match.confidence >= CONFIDENCE.HIGH), false);
});

test("real PII in a page of text is found once per value with the right label", () => {
  const page = [
    `Aadhaar: ${VALID_AADHAAR[0].slice(0, 4)} ${VALID_AADHAAR[0].slice(4, 8)} ${VALID_AADHAAR[0].slice(8)}`,
    "PAN ABCPD1234E · GSTIN 27AAPFU0939F1ZV · IFSC HDFC0001234 · A/C 000123456789012",
    "Card 4111 1111 1111 1111 · priya.sharma@example.co.in · Mobile +91 98765 43210",
    "D.O.B: 14/08/1984 · Passport K1234567 · host 10.20.30.40 · https://example.com/report",
  ].join("\n");
  const matches = detectPii(page, { now: PII_NOW });
  const found = typesOf(matches);
  for (const type of ["aadhaar", "pan", "gstin", "ifsc", "account", "card", "email", "phone", "dob", "passport", "ipv4", "url"]) {
    assert.ok(found.includes(type), `${type} should be detected`);
  }
  // Overlap resolution: the PAN inside the GSTIN is not double-reported.
  assert.equal(found.filter((type) => type === "pan").length, 1);
  assert.equal(found.filter((type) => type === "gstin").length, 1);
  const summary = summarisePii(matches);
  assert.equal(summary.total, matches.length);
  assert.equal(summary.high, highConfidence(matches).length);
  assert.ok(summary.types.length >= 10);
  assert.equal(confidenceLabel(CONFIDENCE.HIGH), "high");
  assert.equal(confidenceLabel(CONFIDENCE.MEDIUM), "medium");
  assert.equal(confidenceLabel(CONFIDENCE.LOW), "low");
});

test("masking hides personal values, keeps destinations readable, and never leaks raw PII", () => {
  assert.equal(maskValue("2345 6789 0124"), "XXXX XXXX 0124");
  assert.equal(maskValue("4111111111111111"), "XXXXXXXXXXXX1111");
  assert.equal(maskPii("aadhaar", "2345 6789 0124"), "XXXX XXXX 0124");
  assert.equal(maskPii("card", "4111 1111 1111 1111"), "XXXX XXXX XXXX 1111");
  assert.equal(maskPii("dob", "14/08/1984"), "XX/XX/XXXX");
  assert.equal(maskPii("email", "priya.sharma@example.co.in").includes("priya.sharma"), false);
  assert.match(maskPii("email", "priya.sharma@example.co.in"), /^p\*+@/);
  // URLs and IPs stay readable on purpose: the reader has to judge them.
  assert.equal(maskPii("url", "https://example.com/x"), "https://example.com/x");
  assert.equal(maskPii("ipv4", "10.20.30.40"), "10.20.30.40");
  // Untrusted document text cannot forge report structure.
  assert.equal(sanitiseForReport("Author\n== 7. What this means =="), "Author == 7. What this means ==");
  assert.equal(sanitiseForReport("bell\u0007and\u001b[31mred"), "bell and [31mred");
});

test("the default privacy report is masked and contains no raw PII value", () => {
  const aadhaar = `${VALID_AADHAAR[1].slice(0, 4)} ${VALID_AADHAAR[1].slice(4, 8)} ${VALID_AADHAAR[1].slice(8)}`;
  const text = `Aadhaar ${aadhaar}, card 4111 1111 1111 1111, mail priya.sharma@example.co.in, mobile +91 98765 43210`;
  const matches = detectPii(text, { now: PII_NOW });
  const scan = {
    pages: 1,
    pagesWithText: 1,
    hasTextLayer: true,
    offPageItems: 0,
    hits: matches.map((match, index) => ({ id: `h${index}`, page: 1, ...match, masked: maskPii(match.type, match.value) })),
    summary: summarisePii(matches),
  };
  const structure = { pages: 1, encrypted: false, info: { Author: "Priya Sharma" }, xmp: { present: false, bytes: 0, fields: [] }, attachments: [], embeddedFileStreams: 0, embeddedFileBytes: 0, signatures: [], links: [], invisibleText: [], contentTruncated: false };

  const masked = buildPrivacyReportText({ fileName: "salary.pdf", fileSize: 1234, scan, structure, generatedAt: PII_NOW });
  for (const raw of [aadhaar, VALID_AADHAAR[1], "4111 1111 1111 1111", "4111111111111111", "priya.sharma@example.co.in", "+91 98765 43210"]) {
    assert.equal(masked.includes(raw), false, `the default report must not contain ${raw.slice(0, 4)}…`);
  }
  assert.match(masked, /PII values shown: masked/);
  assert.match(masked, /XXXX XXXX/);
  assert.match(masked, /cannot guarantee it found every piece of/);
  assert.equal(/risk score/i.test(masked), true, "the report says why there is no score");

  // Revealing is explicit, and says so in the header.
  const revealed = buildPrivacyReportText({ fileName: "salary.pdf", fileSize: 1234, scan, structure, reveal: true, generatedAt: PII_NOW });
  assert.match(revealed, /PII values shown: REVEALED/);
  assert.equal(revealed.includes("4111 1111 1111 1111"), true);
});

test("match-to-rectangle mapping covers whole text items, so redacted text cannot survive", () => {
  // Simulates one page of pdf.js text items. Rasterising and painting is
  // browser-only (canvas), so this asserts the layer that decides WHAT gets
  // painted: after the covered items are dropped, the PII must be unreachable.
  const parts = ["Aadhaar: ", "2345 6789 0124", " — verified"];
  let cursor = 0;
  const items = parts.map((part, index) => {
    const entry = { start: cursor, end: cursor + part.length, rect: { x: 10 * index, y: 20, w: 12, h: 4 } };
    cursor += part.length;
    return entry;
  });
  const text = parts.join("");
  const match = detectPii(text, { now: PII_NOW }).find((hit) => hit.type === "aadhaar");
  assert.ok(match);
  const rects = rectsForMatch(items, match.start, match.end);
  assert.equal(rects.length, 1);
  assert.deepEqual(rects[0], items[1].rect);
  const remaining = items.filter((item) => !rects.includes(item.rect)).map((item) => text.slice(item.start, item.end)).join("");
  assert.equal(remaining.includes("2345 6789 0124"), false, "the redacted value is gone from what is left");
  assert.equal(remaining.includes("2345"), false);

  // Partial coverage: when a match sits inside a larger item, the WHOLE item is
  // returned. Over-redaction is the deliberate trade — never leave part of a
  // PII value visible.
  const wide = [{ start: 0, end: 30, rect: { x: 1, y: 1, w: 50, h: 5 } }];
  const wideText = "ID2345 6789 0124 and more text";
  const wideMatch = detectPii(wideText, { now: PII_NOW }).find((hit) => hit.type === "aadhaar");
  assert.ok(wideMatch);
  assert.deepEqual(rectsForMatch(wide, wideMatch.start, wideMatch.end), [wide[0].rect]);
  // A match spanning two items paints both.
  const split = [
    { start: 0, end: 8, rect: { x: 1, y: 1, w: 5, h: 5 } },
    { start: 8, end: 22, rect: { x: 6, y: 1, w: 5, h: 5 } },
  ];
  assert.equal(rectsForMatch(split, 4, 12).length, 2);
  assert.deepEqual(rectsForMatch(split, 100, 120), [], "a match past the last item maps to nothing");
  assert.deepEqual(rectsForMatch([], 0, 5), []);
});

test("content-stream scan finds invisible (Tr 3) and near-white text without being fooled by strings", () => {
  const invisible = scanContentForInvisibleText("BT /F1 12 Tf 3 Tr 20 150 Td (hidden) Tj ET");
  assert.equal(invisible.invisible, 1);
  assert.equal(invisible.whiteOnWhite, 0);
  const white = scanContentForInvisibleText("BT 1 1 1 rg /F1 12 Tf 20 150 Td (secret) Tj ET");
  assert.equal(white.whiteOnWhite, 1);
  const normal = scanContentForInvisibleText("BT 0 g /F1 12 Tf 20 150 Td (visible) Tj ET");
  assert.equal(normal.invisible, 0);
  assert.equal(normal.whiteOnWhite, 0);
  // "3 Tr" inside a shown string must not be read as an operator.
  const decoy = scanContentForInvisibleText("BT 0 g /F1 12 Tf 20 150 Td (mode 3 Tr explained) Tj ET");
  assert.equal(decoy.invisible, 0);
  // q/Q restores the state, so an invisible run does not bleed past its scope.
  const scoped = scanContentForInvisibleText("q BT 3 Tr (a) Tj ET Q BT (b) Tj ET");
  assert.equal(scoped.invisible, 1);
});

test("XMP parsing surfaces author and creator-tool leaks in both element and attribute form", () => {
  const element = parseXmpFields('<rdf:Description><dc:creator><rdf:Seq><rdf:li>Priya Sharma</rdf:li></rdf:Seq></dc:creator><xmp:CreatorTool>Acme Payroll 9.1</xmp:CreatorTool></rdf:Description>');
  assert.deepEqual(element.map((field) => field.value), ["Priya Sharma", "Acme Payroll 9.1"]);
  const attribute = parseXmpFields('<rdf:Description xmp:CreatorTool="Acme Payroll 9.1" pdf:Producer="Acme PDF" />');
  assert.deepEqual(attribute.map((field) => field.value), ["Acme Payroll 9.1", "Acme PDF"]);
  assert.deepEqual(parseXmpFields(""), []);
});

// Builds a PDF that deliberately carries every structural privacy problem the
// scanner is supposed to report. Pure pdf-lib, so it runs in Node.
async function buildLeakyPdf() {
  const { PDFDocument, PDFName, PDFString, StandardFonts, rgb } = window.PDFLib;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 300]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Visible line", { x: 20, y: 250, size: 12, font });
  page.drawText("White secret", { x: 20, y: 200, size: 12, font, color: rgb(1, 1, 1) });

  const hidden = pdf.context.stream("BT /F1 12 Tf 3 Tr 20 150 Td (hidden text) Tj ET");
  page.node.normalizedEntries().Contents.push(pdf.context.register(hidden));

  const annot = pdf.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [20, 240, 200, 260],
    A: { Type: "Action", S: "URI", URI: PDFString.of("https://tracker.example.com/leak?id=42") },
  });
  page.node.set(PDFName.of("Annots"), pdf.context.obj([pdf.context.register(annot)]));

  const fileStream = pdf.context.flateStream("secret attachment payload", { Type: "EmbeddedFile", Subtype: "text/plain" });
  const spec = pdf.context.obj({ Type: "Filespec", F: PDFString.of("payroll.csv"), UF: PDFString.of("payroll.csv"), EF: { F: pdf.context.register(fileStream) } });
  const specRef = pdf.context.register(spec);
  pdf.catalog.set(PDFName.of("Names"), pdf.context.obj({ EmbeddedFiles: { Names: [PDFString.of("payroll.csv"), specRef] } }));

  const signature = pdf.context.obj({ Type: "Sig", Name: PDFString.of("Priya Sharma"), Reason: PDFString.of("Approved") });
  pdf.context.register(signature);

  const xmp = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><rdf:Description><dc:creator><rdf:Seq><rdf:li>Priya Sharma</rdf:li></rdf:Seq></dc:creator><xmp:CreatorTool>Acme Payroll 9.1</xmp:CreatorTool></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  pdf.catalog.set(PDFName.of("Metadata"), pdf.context.register(pdf.context.stream(xmp, { Type: "Metadata", Subtype: "XML" })));
  pdf.setTitle("Salary statement");
  pdf.setAuthor("Priya Sharma");
  pdf.setCreator("Acme Payroll 9.1");
  return pdf.save({ updateMetadata: false });
}

test("privacy scanner reports metadata, XMP, hidden text, links, attachments and signatures", async () => {
  const structure = await scanPdfStructure(await buildLeakyPdf());

  assert.equal(structure.pages, 1);
  assert.equal(structure.encrypted, false);
  assert.equal(structure.info.Author, "Priya Sharma");
  assert.equal(structure.info.Creator, "Acme Payroll 9.1");
  assert.equal(structure.info.Title, "Salary statement");

  // XMP author leak is surfaced explicitly.
  assert.equal(structure.xmp.present, true);
  const xmpAuthor = structure.xmp.fields.find((field) => /dc:creator/.test(field.label));
  assert.ok(xmpAuthor, "the XMP author must be surfaced");
  assert.equal(xmpAuthor.value, "Priya Sharma");
  assert.ok(structure.xmp.fields.some((field) => field.value === "Acme Payroll 9.1"));

  // Invisible (Tr 3) and near-white text on page 1.
  assert.equal(structure.invisibleText.length, 1);
  assert.equal(structure.invisibleText[0].page, 1);
  assert.equal(structure.invisibleText[0].invisible >= 1, true);
  assert.equal(structure.invisibleText[0].whiteOnWhite >= 1, true);

  // /URI link destination is listed.
  assert.deepEqual(structure.links, [{ page: 1, subtype: "Link", uri: "https://tracker.example.com/leak?id=42" }]);

  // The embedded file is reported once by name, plus the raw stream count.
  assert.equal(structure.attachments.length, 1);
  assert.equal(structure.attachments[0].name, "payroll.csv");
  assert.equal(structure.attachments[0].type, "Filespec");
  assert.ok(structure.attachments[0].size > 0);
  assert.equal(structure.embeddedFileStreams, 1);

  // Signature entry is reported (its cryptography is NOT verified).
  assert.equal(structure.signatures.length, 1);
  assert.equal(structure.signatures[0].name, "Priya Sharma");

  // And the whole thing renders into a report without leaking structure.
  const report = buildPrivacyReportText({
    fileName: "leaky.pdf",
    fileSize: 2048,
    scan: { pages: 1, pagesWithText: 1, hasTextLayer: true, offPageItems: 0, hits: [], summary: summarisePii([]) },
    structure,
    generatedAt: PII_NOW,
  });
  assert.match(report, /Author: Priya Sharma/);
  assert.match(report, /rendering mode 3/);
  assert.match(report, /tracker\.example\.com/);
  assert.match(report, /payroll\.csv/);
  assert.match(report, /Digital signature entries: 1/);
});

test("a clean PDF scans clean", async () => {
  const { PDFDocument } = window.PDFLib;
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  const structure = await scanPdfStructure(await pdf.save());
  assert.equal(structure.encrypted, false);
  assert.deepEqual(structure.attachments, []);
  assert.equal(structure.embeddedFileStreams, 0);
  assert.deepEqual(structure.links, []);
  assert.deepEqual(structure.signatures, []);
  assert.deepEqual(structure.invisibleText, []);
  assert.equal(structure.xmp.present, false);
});

test("Auto-Redact PII and Privacy Scanner are registered, routed, and rendered", () => {
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const expected = { "auto-redact-pii-tool": "Auto-Redact PII", "privacy-scanner-tool": "Privacy Scanner" };
  for (const [id, name] of Object.entries(expected)) {
    const found = tools.find((tool) => tool.id === id);
    assert.ok(found, `${id} should be registered`);
    assert.equal(found.name, name);
    assert.equal(found.category, "Security & Privacy");
    assert.equal(found.status, "available");
    assert.equal(found.localProcessing, true);
    assert.deepEqual(found.acceptedTypes, ["application/pdf"]);
    assert.equal(found.file.maxFiles, 1);
    assert.equal(routeForHash(found.route).tool.id, id);
    assert.equal(appSource.includes(`"${id}"`), true, `${id} is missing from ToolRenderer`);
  }
  // Discoverable by the words a user would actually type.
  const redact = tools.find((tool) => tool.id === "auto-redact-pii-tool");
  const searchable = [redact.name, redact.description, ...redact.keywords].join(" ").toLowerCase();
  for (const query of ["pii", "aadhaar", "redact"]) assert.match(searchable, new RegExp(query));

  // The new components stay local and never log PII.
  const start = appSource.indexOf("function AutoRedactPiiTool");
  const end = appSource.indexOf("function CreatePdfTool");
  assert.ok(start > 0 && end > start);
  const section = appSource.slice(start, end);
  for (const forbidden of ["console.", "localStorage", "sessionStorage", "indexedDB", "fetch(", "innerHTML", "dangerouslySetInnerHTML"]) {
    assert.equal(section.includes(forbidden), false, `the PII tools must not use ${forbidden}`);
  }
  // Redaction honesty and the OCR route for scans are both stated in the UI.
  assert.match(section, /flattened/);
  assert.match(section, /#ocr-pdf-tool/);
  assert.match(section, /cannot guarantee it found every piece of sensitive data/);
});

// --- PDF Analyser (static malware/threat triage) ------------------------------

const latin1 = (text) => Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
const paBytes = (...parts) => {
  const arrays = parts.map((part) => (typeof part === "string" ? latin1(part) : part));
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) { out.set(arr, offset); offset += arr.length; }
  return out;
};
const paStream = (num, dict, dataBytes) => paBytes(`${num} 0 obj ${dict}\nstream\n`, dataBytes, "\nendstream endobj\n");

test("PDF Analyser: /OpenAction + literal /JavaScript is extracted and flagged High", async () => {
  const pdf = latin1(`%PDF-1.7
1 0 obj << /Type /Catalog /OpenAction 2 0 R /Pages 3 0 R >> endobj
2 0 obj << /S /JavaScript /JS (app.alert\\("pwned"\\); this.exportDataObject\\({cName:"x"\\});) >> endobj
3 0 obj << /Type /Pages /Kids [4 0 R] /Count 1 >> endobj
4 0 obj << /Type /Page /Parent 3 0 R >> endobj
startxref
0
%%EOF`);
  const report = await analyzePdfBytes(pdf);
  const js = report.findings.find((f) => f.indicator.includes("JavaScript"));
  assert.ok(js, "JavaScript indicator present");
  assert.equal(js.severity, "High");
  assert.match(js.evidence, /app\.alert/);
  assert.ok(report.findings.some((f) => f.indicator === "/OpenAction" && f.severity === "High"));
  assert.equal(report.verdict.level, "suspicious");
  assert.match(report.verdict.headline, /Suspicious/);
});

test("PDF Analyser: JavaScript inside a FlateDecode stream is inflated and shown", async () => {
  const script = "var payload = 'flate-hidden'; app.launchURL('http://c2.example');";
  const compressed = deflateSync(strToU8(script));
  const pdf = paBytes(
    `%PDF-1.7\n1 0 obj << /Type /Catalog /OpenAction 2 0 R >> endobj\n2 0 obj << /S /JavaScript /JS 5 0 R >> endobj\n`,
    paStream(5, `<< /Filter /FlateDecode /Length ${compressed.length} >>`, compressed),
    `4 0 obj << /Type /Page >> endobj\nstartxref\n0\n%%EOF`,
  );
  const report = await analyzePdfBytes(pdf);
  const js = report.findings.find((f) => f.indicator.includes("JavaScript") && /flate-hidden/.test(f.evidence));
  assert.ok(js, "flate-decoded JS extracted");
  assert.equal(js.severity, "High");
});

test("PDF Analyser: /Launch action is Critical and shows the command", async () => {
  const pdf = latin1(`%PDF-1.5
1 0 obj << /Type /Catalog /OpenAction 2 0 R >> endobj
2 0 obj << /Type /Action /S /Launch /Win << /F (cmd.exe /c calc.exe) >> >> endobj
4 0 obj << /Type /Page >> endobj
startxref
0
%%EOF`);
  const report = await analyzePdfBytes(pdf);
  const launch = report.findings.find((f) => f.indicator === "/Launch action");
  assert.ok(launch, "launch detected");
  assert.equal(launch.severity, "Critical");
  assert.match(launch.evidence, /calc\.exe/);
});

test("PDF Analyser: name obfuscation /J#61vaScript is decoded and flagged", async () => {
  assert.equal(decodePdfName("J#61vaScript"), "JavaScript");
  const obf = findObfuscatedNames("<< /S /J#61vaScript /JS (x()) >>");
  assert.ok(obf.some((n) => n.decoded === "/JavaScript"));
  const pdf = latin1(`%PDF-1.4
1 0 obj << /Type /Catalog /OpenAction 2 0 R >> endobj
2 0 obj << /S /J#61vaScript /JS (evil();) >> endobj
4 0 obj << /Type /Page >> endobj
%%EOF`);
  const report = await analyzePdfBytes(pdf);
  const obfFinding = report.findings.find((f) => f.indicator.includes("Name obfuscation"));
  assert.ok(obfFinding, "obfuscation flagged");
  assert.equal(obfFinding.severity, "High");
  assert.match(obfFinding.evidence, /JavaScript/);
  // The obfuscated keyword is still resolved to real JS.
  assert.ok(report.findings.some((f) => f.indicator.includes("JavaScript") && /evil/.test(f.evidence)));
});

test("PDF Analyser: an embedded file starting with MZ is flagged as an executable", async () => {
  const exe = latin1("MZ\x90\x00\x03\x00\x00\x00This-is-a-fake-pe");
  const pdf = paBytes(
    `%PDF-1.6\n1 0 obj << /Type /Catalog /Names 2 0 R >> endobj\n2 0 obj << /Type /Filespec /F (invoice.exe) /EF << /F 5 0 R >> >> endobj\n`,
    paStream(5, `<< /Type /EmbeddedFile /Length ${exe.length} >>`, exe),
    `4 0 obj << /Type /Page >> endobj\nstartxref\n0\n%%EOF`,
  );
  const report = await analyzePdfBytes(pdf);
  assert.equal(report.embeddedFiles.length, 1);
  assert.equal(report.embeddedFiles[0].executable, true);
  assert.match(report.embeddedFiles[0].magic, /MZ|PE/);
  assert.equal(report.embeddedFiles[0].name, "invoice.exe");
  const finding = report.findings.find((f) => f.indicator.includes("Embedded file"));
  assert.equal(finding.severity, "Critical");
  assert.equal(classifyMagic(exe).executable, true);
});

test("PDF Analyser: /URI action lists its destination", async () => {
  const pdf = latin1(`%PDF-1.7
1 0 obj << /Type /Catalog >> endobj
6 0 obj << /S /URI /URI (http://phish.example/login) >> endobj
4 0 obj << /Type /Page >> endobj
%%EOF`);
  const report = await analyzePdfBytes(pdf);
  const uri = report.findings.find((f) => f.indicator === "/URI actions");
  assert.ok(uri, "URI detected");
  assert.match(uri.evidence, /phish\.example/);
});

test("PDF Analyser: stacked stream filters are flagged", async () => {
  const pdf = paBytes(
    `%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n`,
    paStream(5, `<< /Filter [/ASCIIHexDecode /FlateDecode] /Length 8 >>`, latin1("garbage!")),
    `4 0 obj << /Type /Page >> endobj\n%%EOF`,
  );
  const report = await analyzePdfBytes(pdf);
  assert.ok(report.findings.some((f) => f.indicator === "Stacked stream filters"));
});

test("PDF Analyser: multiple %%EOF / startxref markers are flagged as appended data", async () => {
  const pdf = latin1(`%PDF-1.7
1 0 obj << /Type /Catalog >> endobj
4 0 obj << /Type /Page >> endobj
startxref
9
%%EOF
5 0 obj << /Type /Page >> endobj
startxref
120
%%EOF`);
  const report = await analyzePdfBytes(pdf);
  assert.ok(report.eofCount >= 2);
  assert.ok(report.findings.some((f) => f.indicator.includes("Multiple %%EOF")));
});

test("PDF Analyser: a plain benign PDF yields no high-risk indicators (false-positive guard)", async () => {
  const { PDFDocument } = window.PDFLib;
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 300]);
  pdf.addPage([300, 300]);
  const report = await analyzePdfBytes(await pdf.save());
  assert.equal(report.verdict.counts.critical, 0);
  assert.equal(report.verdict.counts.high, 0);
  assert.notEqual(report.verdict.level, "suspicious");
  assert.match(report.verdict.headline, /No high-risk indicators|Caution/);
  assert.equal(report.findings.some((f) => f.severity === "Critical" || f.severity === "High"), false);
});

test("PDF Analyser: truncated and garbage input never throw and still report", async () => {
  const garbage = latin1("this is definitely not a pdf \x00\x01\x02 <<>> stream");
  const g = await analyzePdfBytes(garbage);
  assert.ok(g.parseError, "missing header noted");
  assert.equal(typeof g.sha256, "string");
  assert.equal(g.sha256.length, 64);

  const truncated = latin1("%PDF-1.7\n1 0 obj << /S /JavaScript /JS (app.alert('unterminated");
  const t = await analyzePdfBytes(truncated);
  assert.ok(t.truncated, "no clean EOF noted");
  assert.ok(t.findings.some((f) => f.indicator.includes("JavaScript")));
  assert.equal(typeof buildAnalyzerReportText(t, { fileName: "x.pdf" }), "string");
});

test("PDF Analyser: SHA-256 matches node:crypto", async () => {
  const data = latin1("The quick brown fox");
  const expected = nodeCrypto.createHash("sha256").update(Buffer.from(data)).digest("hex");
  assert.equal(await sha256Hex(data), expected);
});

test("PDF Analyser is registered, routed, and rendered", () => {
  const found = tools.find((tool) => tool.id === "pdf-analyzer-tool");
  assert.ok(found, "pdf-analyzer-tool registered");
  assert.equal(found.name, "PDF Analyser");
  assert.equal(found.category, "Security & Privacy");
  assert.equal(found.status, "available");
  assert.equal(found.localProcessing, true);
  assert.deepEqual(found.acceptedTypes, ["application/pdf"]);
  assert.equal(found.file.maxFiles, 1);
  assert.equal(routeForHash(found.route).tool.id, "pdf-analyzer-tool");
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.equal(appSource.includes('"pdf-analyzer-tool"'), true);
  const searchable = [found.name, found.description, ...found.keywords].join(" ").toLowerCase();
  for (const query of ["malware", "javascript", "triage"]) assert.match(searchable, new RegExp(query));
});

test("search strips stopwords and resolves natural security queries to the right tool", () => {
  const cases = [
    ["unlock my pdf", "unlock-pdf-tool"],
    ["check this pdf for malware", "pdf-analyzer-tool"],
    ["remove pii", "auto-redact-pii-tool"],
    ["password protect", "encrypt-pdf-tool"],
  ];
  for (const [query, expectedId] of cases) {
    const results = filterTools(query);
    assert.ok(results.length > 0, `"${query}" should return results`);
    const topIds = results.slice(0, 3).map((tool) => tool.id);
    assert.ok(topIds.includes(expectedId), `"${query}" should surface ${expectedId} in the top results, got ${topIds.join(", ")}`);
    assert.equal(results[0].id, expectedId, `"${query}" should rank ${expectedId} first, got ${results[0].id}`);
  }
});

test("search stopword-only queries fall back to the full tool list", () => {
  assert.equal(filterTools("how do i").length, tools.length);
});

// --- Advanced PDF tools (Phase 1): smart split, Bates, imposition, outline,
// form creation. Pure pdf-lib + fflate logic, unit-testable in Node against the
// same vendored bundle loaded above.

async function makeContentPdf(pageCount, tag = "p") {
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([200, 300]);
    page.drawText(`${tag}${i + 1}`, { x: 20, y: 250, size: 24, font, color: rgb(0, 0, 0) });
  }
  return new File([await doc.save()], "content.pdf", { type: "application/pdf" });
}

async function unzipPdfPageCounts(zipped) {
  const { unzipSync } = await import("fflate");
  const { PDFDocument } = window.PDFLib;
  const entries = unzipSync(zipped);
  const names = Object.keys(entries).sort();
  const counts = [];
  for (const name of names) counts.push((await PDFDocument.load(entries[name])).getPageCount());
  return { names, counts };
}

test("computeSplitGroups: every-N, equal parts (with remainder), and split-at-pages", async () => {
  const { computeSplitGroups } = await import("../src/services/pdf-advanced.service.js");
  // every N: ceil(P/N) parts, last shorter
  const everyN = computeSplitGroups({ mode: "everyN", pageCount: 10, everyN: 4 });
  assert.equal(everyN.length, 3);
  assert.deepEqual(everyN.map((g) => g.length), [4, 4, 2]);
  assert.deepEqual(everyN[0], [0, 1, 2, 3]);

  // K equal parts with a remainder: 10 into 3 -> 4,3,3
  const equal = computeSplitGroups({ mode: "equalParts", pageCount: 10, parts: 3 });
  assert.deepEqual(equal.map((g) => g.length), [4, 3, 3]);
  assert.equal(equal.reduce((sum, g) => sum + g.length, 0), 10);
  assert.deepEqual(equal[2], [7, 8, 9]);

  // split at pages 5 and 8 (1-based) over 10 pages -> [1-4],[5-7],[8-10]
  const at = computeSplitGroups({ mode: "atPages", pageCount: 10, atPages: [5, 8] });
  assert.deepEqual(at.map((g) => g[0] + 1), [1, 5, 8]);
  assert.deepEqual(at.map((g) => g.length), [4, 3, 3]);

  assert.throws(() => computeSplitGroups({ mode: "equalParts", pageCount: 2, parts: 5 }), /Cannot split/);
  assert.throws(() => computeSplitGroups({ mode: "atPages", pageCount: 5, atPages: [9] }), /between 2 and 5/);
  assert.throws(() => computeSplitGroups({ mode: "everyN", pageCount: 5, everyN: 0 }), /at least 1/);
});

test("smartSplitPdf writes valid part PDFs with the expected page counts (incl. 1-page)", async () => {
  const { smartSplitPdf } = await import("../src/services/pdf-advanced.service.js");
  const file = await makeContentPdf(10);

  const everyN = await smartSplitPdf(file, { mode: "everyN", everyN: 4 });
  assert.equal(everyN.partCount, 3);
  let unzipped = await unzipPdfPageCounts(everyN.zipped);
  assert.deepEqual(unzipped.counts, [4, 4, 2]);
  assert.match(unzipped.names[0], /part-1\.pdf$/);

  const equal = await smartSplitPdf(file, { mode: "equalParts", parts: 3 });
  unzipped = await unzipPdfPageCounts(equal.zipped);
  assert.deepEqual(unzipped.counts, [4, 3, 3]);

  const at = await smartSplitPdf(file, { mode: "atPages", atPages: "5, 8" });
  unzipped = await unzipPdfPageCounts(at.zipped);
  assert.deepEqual(unzipped.counts, [4, 3, 3]);

  // 1-page input still splits into a single valid part.
  const single = await smartSplitPdf(await makeContentPdf(1), { mode: "everyN", everyN: 4 });
  assert.equal(single.partCount, 1);
  assert.deepEqual((await unzipPdfPageCounts(single.zipped)).counts, [1]);
});

test("smartSplitPdf bookmark mode splits at top-level outline pages, or explains its absence", async () => {
  const { smartSplitPdf, setOutline } = await import("../src/services/pdf-advanced.service.js");
  const plain = await makeContentPdf(9);
  await assert.rejects(() => smartSplitPdf(plain, { mode: "bookmarks" }), /no top-level bookmarks/);

  // Add an outline at pages 1, 4, 7, then split by bookmark.
  const { bytes } = await setOutline(plain, [
    { title: "One", page: 1, level: 0 },
    { title: "Two", page: 4, level: 0 },
    { title: "Three", page: 7, level: 0 },
  ]);
  const withOutline = new File([bytes], "outlined.pdf", { type: "application/pdf" });
  const split = await smartSplitPdf(withOutline, { mode: "bookmarks" });
  assert.equal(split.partCount, 3);
  const { counts } = await unzipPdfPageCounts(split.zipped);
  assert.deepEqual(counts, [3, 3, 3]);
});

test("formatBates pads correctly and never truncates a wider number", async () => {
  const { formatBates } = await import("../src/services/pdf-advanced.service.js");
  assert.equal(formatBates("ABC", 1, 6, ""), "ABC000001");
  assert.equal(formatBates("ABC", 42, 6, "-X"), "ABC000042-X");
  // Number wider than the pad renders in full (no truncation).
  assert.equal(formatBates("ABC", 1234567, 6, ""), "ABC1234567");
  assert.equal(formatBates("", 5, 0, ""), "5");
});

test("batesNumberPdf increments with prefix+padding, reports first/last, rejects non-Latin", async () => {
  const { batesNumberPdf } = await import("../src/services/pdf-advanced.service.js");
  const { PDFDocument } = window.PDFLib;
  const file = await makeContentPdf(3);

  const res = await batesNumberPdf(file, { prefix: "ABC", start: 1, padding: 6, position: "bottom-right", fontSize: 10, startPage: 1 });
  assert.equal(res.count, 3);
  assert.equal(res.first, "ABC000001");
  assert.equal(res.last, "ABC000003");
  assert.equal((await PDFDocument.load(res.bytes)).getPageCount(), 3);

  // start page partway through: only later pages stamped, numbering starts at `start`.
  const partial = await batesNumberPdf(file, { prefix: "P", start: 100, padding: 4, startPage: 2 });
  assert.equal(partial.count, 2);
  assert.equal(partial.first, "P0100");
  assert.equal(partial.last, "P0101");

  // Non-Latin prefix -> friendly error (not a raw pdf-lib crash).
  await assert.rejects(() => batesNumberPdf(file, { prefix: "机密", start: 1, padding: 6 }), /Latin-1 characters only/);

  // 1-page input.
  const one = await batesNumberPdf(await makeContentPdf(1), { prefix: "A", start: 1, padding: 3 });
  assert.equal(one.count, 1);
  assert.equal(one.first, "A001");
});

test("computeBookletOrder produces the correct saddle-stitch sequence and pads to multiples of 4", async () => {
  const { computeBookletOrder } = await import("../src/services/pdf-advanced.service.js");
  const eight = computeBookletOrder(8);
  assert.equal(eight.padded, 8);
  assert.deepEqual(eight.order, [8, 1, 2, 7, 6, 3, 4, 5]);

  const four = computeBookletOrder(4);
  assert.deepEqual(four.order, [4, 1, 2, 3]);

  // 6 pages pad up to 8; the two highest slots (7, 8) are blank fillers.
  const six = computeBookletOrder(6);
  assert.equal(six.padded, 8);
  assert.equal(six.order.length, 8);
  assert.deepEqual(six.order.filter((n) => n > 6).sort((a, b) => a - b), [7, 8]);
});

test("imposePdf N-up yields ceil(P/N) sheets each embedding the source pages", async () => {
  const { imposePdf } = await import("../src/services/pdf-advanced.service.js");
  const { PDFDocument, PDFName } = window.PDFLib;
  const file = await makeContentPdf(8);

  const res = await imposePdf(file, { mode: "nup", n: 4, pageSize: "A4", orientation: "portrait" });
  assert.equal(res.sheets, 2);
  const doc = await PDFDocument.load(res.bytes);
  assert.equal(doc.getPageCount(), 2);
  // Each sheet embeds 4 source pages as XObjects.
  for (let i = 0; i < 2; i += 1) {
    const xobj = doc.getPage(i).node.Resources().get(PDFName.of("XObject"));
    assert.equal(xobj.keys().length, 4, `sheet ${i} should embed 4 pages`);
  }

  // Booklet on the same 8-page doc: 8 slots -> 4 printable sides, 2 sheets.
  const booklet = await imposePdf(file, { mode: "booklet", pageSize: "A4" });
  assert.equal(booklet.sheets, 2);
  assert.equal(booklet.outputPages, 4);
  assert.equal((await PDFDocument.load(booklet.bytes)).getPageCount(), 4);

  // 1-page input: single N-up sheet.
  const one = await imposePdf(await makeContentPdf(1), { mode: "nup", n: 4 });
  assert.equal(one.sheets, 1);
  await assert.rejects(() => imposePdf(file, { mode: "nup", n: 5 }), /2, 4, 6, 8, 9, or 16/);
});

test("parseOutlineInput parses titles, pages, nesting, and rejects bad lines", async () => {
  const { parseOutlineInput } = await import("../src/services/pdf-advanced.service.js");
  const entries = parseOutlineInput("Intro | 1\n  Background | 2\nChapter 2 | 5", 10);
  assert.deepEqual(entries, [
    { title: "Intro", page: 1, level: 0 },
    { title: "Background", page: 2, level: 1 },
    { title: "Chapter 2", page: 5, level: 0 },
  ]);
  assert.throws(() => parseOutlineInput("No separator here", 5), /Title \| pageNumber/);
  assert.throws(() => parseOutlineInput("Bad | 99", 5), /outside 1–5/);
  assert.throws(() => parseOutlineInput("", 5), /at least one/);
});

test("setOutline writes an /Outlines tree that reloads with correct pages and nesting", async () => {
  const { setOutline, readOutline } = await import("../src/services/pdf-advanced.service.js");
  const { PDFDocument, PDFName, PDFDict } = window.PDFLib;
  const file = await makeContentPdf(6);

  const { bytes, topLevel, total } = await setOutline(file, [
    { title: "Introduction", page: 1, level: 0 },
    { title: "Details", page: 3, level: 1 },
    { title: "Conclusion", page: 6, level: 0 },
  ]);
  assert.equal(topLevel, 2);
  assert.equal(total, 3);

  const reloaded = await PDFDocument.load(bytes);
  const outlinesRef = reloaded.catalog.get(PDFName.of("Outlines"));
  const outlines = reloaded.context.lookup(outlinesRef);
  assert.ok(outlines instanceof PDFDict, "/Outlines dictionary exists");
  assert.equal(outlines.get(PDFName.of("Count")).toString(), "2");

  // Re-read via the service: destinations resolve to the intended pages.
  const outFile = new File([bytes], "out.pdf", { type: "application/pdf" });
  const read = await readOutline(outFile);
  assert.deepEqual(read, [
    { title: "Introduction", page: 1, level: 0 },
    { title: "Details", page: 3, level: 1 },
    { title: "Conclusion", page: 6, level: 0 },
  ]);

  // The nested child's /Parent points at its top-level entry (not the root).
  const rpages = reloaded.getPages();
  const top1 = reloaded.context.lookup(outlines.get(PDFName.of("First")));
  const child = reloaded.context.lookup(top1.get(PDFName.of("First")));
  assert.equal(reloaded.context.lookup(child.get(PDFName.of("Parent"))), top1);
  const childDest = reloaded.context.lookup(child.get(PDFName.of("Dest")));
  assert.equal(rpages.findIndex((p) => p.ref === childDest.get(0)), 2);
});

test("createFormPdf builds fillable fields that round-trip through fillPdfForm", async () => {
  const { createFormPdf } = await import("../src/services/pdf-advanced.service.js");
  const { fillPdfForm } = await import("../src/services/pdf-edit.service.js");
  const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } = window.PDFLib;

  const { bytes, fieldCount } = await createFormPdf(null, [
    { type: "text", name: "full_name", page: 1, x: 10, y: 10, w: 50, h: 5, unit: "percent" },
    { type: "checkbox", name: "agree", page: 1, x: 10, y: 20, w: 4, h: 3, unit: "percent" },
    { type: "dropdown", name: "colour", page: 1, x: 10, y: 30, w: 40, h: 4, unit: "percent", options: ["Red", "Green", "Blue"] },
    { type: "radio", name: "plan", page: 1, x: 10, y: 45, w: 30, h: 20, unit: "percent", options: ["Basic", "Pro"] },
  ], { pageSize: "A4" });
  assert.equal(fieldCount, 4);

  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  const byName = Object.fromEntries(form.getFields().map((f) => [f.getName(), f]));
  assert.ok(byName.full_name instanceof PDFTextField);
  assert.ok(byName.agree instanceof PDFCheckBox);
  assert.ok(byName.colour instanceof PDFDropdown);
  assert.ok(byName.plan instanceof PDFRadioGroup);
  assert.deepEqual(byName.colour.getOptions().sort(), ["Blue", "Green", "Red"]);

  // Cross-tool eval: fill the text + checkbox via the existing Fill PDF Form tool.
  const formFile = new File([bytes], "created-form.pdf", { type: "application/pdf" });
  const filled = await PDFDocument.load(await fillPdfForm(formFile, { full_name: "Ada Lovelace", agree: true }, false));
  assert.equal(filled.getForm().getTextField("full_name").getText(), "Ada Lovelace");
  assert.equal(filled.getForm().getCheckBox("agree").isChecked(), true);
});

test("createFormPdf validates fields onto an uploaded PDF and rejects bad input", async () => {
  const { createFormPdf } = await import("../src/services/pdf-advanced.service.js");
  const { PDFDocument, PDFTextField } = window.PDFLib;
  const base = await makeContentPdf(2);

  // Add a field onto page 2 of an existing PDF.
  const { bytes } = await createFormPdf(base, [
    { type: "text", name: "note", page: 2, x: 10, y: 10, w: 60, h: 6, unit: "percent" },
  ]);
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 2);
  assert.ok(doc.getForm().getFields()[0] instanceof PDFTextField);

  await assert.rejects(() => createFormPdf(null, []), /at least one form field/);
  await assert.rejects(() => createFormPdf(null, [{ type: "text", name: "a.b", page: 1, x: 1, y: 1, w: 10, h: 5 }]), /only letters/);
  await assert.rejects(() => createFormPdf(null, [{ type: "text", name: "d", page: 1, x: 1, y: 1, w: 10, h: 5 }, { type: "text", name: "d", page: 1, x: 1, y: 20, w: 10, h: 5 }]), /Duplicate field/);
  await assert.rejects(() => createFormPdf(null, [{ type: "dropdown", name: "one", page: 1, x: 1, y: 1, w: 10, h: 5, options: ["only"] }]), /at least two options/);
  await assert.rejects(() => createFormPdf(base, [{ type: "text", name: "off", page: 9, x: 1, y: 1, w: 10, h: 5 }]), /page 9/);
});

test("advanced PDF tools are registered, routed, and rendered", () => {
  const ids = ["smart-split-pdf-tool", "bates-numbering-tool", "impose-pdf-tool", "bookmarks-editor-tool", "create-form-tool"];
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  for (const id of ids) {
    const found = tools.find((tool) => tool.id === id);
    assert.ok(found, `${id} registered`);
    assert.equal(found.category, "PDF Tools");
    assert.equal(found.status, "available");
    assert.equal(found.localProcessing, true);
    assert.deepEqual(found.acceptedTypes, ["application/pdf"]);
    assert.equal(routeForHash(found.route).tool.id, id);
    assert.equal(appSource.includes(`"${id}"`), true, `${id} wired into ToolRenderer`);
  }
});

// =============================================================================
// PHASE 2 — Compare PDFs, Deskew, PDF/A prep (src/services/pdf-review.service.js)
// Pure logic is unit-tested here. Browser-only paths noted below are NOT tested
// in Node: the compare VISUAL pixel-diff and the deskew page RASTER/rotate both
// need canvas + pdf.js, and the PDF/A "guaranteed self-contained" RASTER mode
// uses rasterRebuild (canvas). The archival hygiene itself is pure pdf-lib and
// IS tested. The skew ESTIMATOR is pure and IS tested on synthetic bitmaps.
// =============================================================================

test("comparePdfText: reports per-page added/removed/changed lines and flags differing pages", async () => {
  const { comparePdfText } = await import("../src/services/pdf-review.service.js");
  // lineDiff aligns by line index, so each scenario is kept end-anchored to stay
  // clean: page 1 = a changed line (1 removed + 1 added), page 2 = an added
  // trailing line, page 3 = a removed trailing line.
  const a = ["keep\nold\nfoot", "one\ntwo", "x\ny\nz"];
  const b = ["keep\nnew\nfoot", "one\ntwo\nthree", "x\ny"];
  const result = comparePdfText(a, b);

  assert.equal(result.identical, false);
  assert.deepEqual(result.differingPages, [1, 2, 3]);
  const page1 = result.pages.find((p) => p.page === 1);
  assert.equal(page1.status, "changed");
  assert.equal(page1.removed, 1); // old
  assert.equal(page1.added, 1); // new
  const page2 = result.pages.find((p) => p.page === 2);
  assert.equal(page2.status, "changed");
  assert.equal(page2.added, 1); // three
  assert.equal(page2.removed, 0);
  const page3 = result.pages.find((p) => p.page === 3);
  assert.equal(page3.status, "changed");
  assert.equal(page3.removed, 1); // z
  assert.equal(page3.added, 0);
  assert.equal(result.totals.changedPages, 3);
  assert.equal(result.totals.added, 2);
  assert.equal(result.totals.removed, 2);
});

test("comparePdfText: identical inputs report no differences", async () => {
  const { comparePdfText, comparePdfReportText } = await import("../src/services/pdf-review.service.js");
  const pages = ["alpha\nbeta", "gamma"];
  const result = comparePdfText(pages, pages.slice());
  assert.equal(result.identical, true);
  assert.equal(result.totals.changedPages, 0);
  assert.match(comparePdfReportText(result), /No differences found/);
});

test("comparePdfText: different page counts report extra and missing pages", async () => {
  const { comparePdfText } = await import("../src/services/pdf-review.service.js");
  // A has 3 pages, B has 1 → pages 2,3 are missing from B.
  const shrunk = comparePdfText(["one", "two", "three"], ["one"]);
  assert.deepEqual(shrunk.removedPages, [2, 3]);
  assert.deepEqual(shrunk.addedPages, []);
  assert.equal(shrunk.pages.find((p) => p.page === 2).status, "removed");
  assert.equal(shrunk.identical, false);

  // A has 1 page, B has 3 → pages 2,3 are extra in B.
  const grown = comparePdfText(["one"], ["one", "two", "three"]);
  assert.deepEqual(grown.addedPages, [2, 3]);
  assert.deepEqual(grown.removedPages, []);
  assert.equal(grown.pages.find((p) => p.page === 3).status, "added");
});

test("comparePdfText: text-less pages (scanned) are flagged for visual-only diff", async () => {
  const { comparePdfText } = await import("../src/services/pdf-review.service.js");
  const result = comparePdfText(["", "text"], ["", "text"]);
  assert.deepEqual(result.textlessPages, [1]);
  // A textless page is not itself a text difference; identical text otherwise.
  assert.equal(result.pages.find((p) => p.page === 1).status, "textless");
  assert.equal(result.identical, true);
});

test("estimateSkewAngle recovers a known synthetic skew (+4°, -3°), ~0° straight, and 0 for blank", async () => {
  const { estimateSkewAngle } = await import("../src/services/pdf-review.service.js");
  // Build a darkness matrix of horizontal 3px-thick "text" lines rotated by deg
  // about the centre. Higher value = more ink, matching the estimator contract.
  const makeSkewedTextMatrix = (w, h, deg, gap = 12) => {
    const g = new Uint8Array(w * h);
    const cx = (w - 1) / 2;
    const cy = (h - 1) / 2;
    const t = (deg * Math.PI) / 180;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    for (let sy = 8; sy < h - 8; sy += gap) {
      for (let band = 0; band < 3; band += 1) {
        const yy = sy + band;
        for (let sx = 10; sx < w - 10; sx += 1) {
          const dx = sx - cx;
          const dy = yy - cy;
          const ox = Math.round(cx + dx * cos - dy * sin);
          const oy = Math.round(cy + dx * sin + dy * cos);
          if (ox >= 0 && ox < w && oy >= 0 && oy < h) g[oy * w + ox] = 255;
        }
      }
    }
    return g;
  };
  const W = 300;
  const H = 360;
  assert.ok(Math.abs(estimateSkewAngle(makeSkewedTextMatrix(W, H, 0), W, H)) <= 0.75, "straight ~0");
  assert.ok(Math.abs(estimateSkewAngle(makeSkewedTextMatrix(W, H, 4), W, H) - 4) <= 0.75, "recovers +4");
  assert.ok(Math.abs(estimateSkewAngle(makeSkewedTextMatrix(W, H, -3), W, H) + 3) <= 0.75, "recovers -3");
  // A blank (no ink) image returns 0 without throwing.
  assert.equal(estimateSkewAngle(new Uint8Array(W * H), W, H), 0);
});

test("buildSrgbIccProfile produces a structurally valid sRGB ICC profile", async () => {
  const { buildSrgbIccProfile } = await import("../src/services/pdf-review.service.js");
  const icc = buildSrgbIccProfile();
  const sizeField = (icc[0] << 24) | (icc[1] << 16) | (icc[2] << 8) | icc[3];
  assert.equal(sizeField, icc.length, "header size field matches byte length");
  assert.equal(String.fromCharCode(icc[36], icc[37], icc[38], icc[39]), "acsp", "acsp signature present");
});

test("archivalPrepPdf (non-raster) adds OutputIntent + PDF/A XMP, strips JS/OpenAction, and sets ID/MarkInfo", async () => {
  const { archivalPrepPdf } = await import("../src/services/pdf-review.service.js");
  const { PDFDocument, PDFName, PDFString } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const ctx = doc.context;
  // A document-level JavaScript OpenAction and a /Names /JavaScript name tree.
  const openAction = ctx.obj({});
  openAction.set(PDFName.of("S"), PDFName.of("JavaScript"));
  openAction.set(PDFName.of("JS"), PDFString.of("app.alert('hi')"));
  doc.catalog.set(PDFName.of("OpenAction"), ctx.register(openAction));
  const namesDict = ctx.obj({});
  namesDict.set(PDFName.of("JavaScript"), ctx.register(ctx.obj({})));
  doc.catalog.set(PDFName.of("Names"), ctx.register(namesDict));
  const srcBytes = await doc.save();

  const { bytes, report } = await archivalPrepPdf(srcBytes, { title: "My & <Report>", author: "Tester", part: "1", conformance: "B" });

  const out = await PDFDocument.load(bytes);
  // OutputIntent present with an ICC profile stream (N = 3).
  const intents = out.context.lookup(out.catalog.get(PDFName.of("OutputIntents")));
  assert.ok(intents && intents.size() === 1, "one OutputIntent");
  const intent = out.context.lookup(intents.get(0));
  assert.equal(intent.get(PDFName.of("S")).toString(), "/GTS_PDFA1");
  const iccStream = out.context.lookup(intent.get(PDFName.of("DestOutputProfile")));
  assert.equal(iccStream.dict.get(PDFName.of("N")).toString(), "3", "ICC is 3-channel");

  // XMP metadata carries the PDF/A conformance identifier (and escapes the title).
  const metaStream = out.context.lookup(out.catalog.get(PDFName.of("Metadata")));
  const xmp = Buffer.from(metaStream.contents).toString("utf8");
  assert.match(xmp, /pdfaid:part>1</);
  assert.match(xmp, /pdfaid:conformance>B</);
  assert.match(xmp, /My &amp; &lt;Report&gt;/, "user title is XML-escaped");

  // Forbidden auto-run / JavaScript entries are gone.
  assert.equal(out.catalog.get(PDFName.of("OpenAction")), undefined);
  const outNames = out.context.lookup(out.catalog.get(PDFName.of("Names")));
  assert.equal(outNames.get(PDFName.of("JavaScript")), undefined);

  // Document /ID and /MarkInfo are set.
  assert.ok(out.context.trailerInfo.ID, "document /ID present");
  assert.ok(out.catalog.get(PDFName.of("MarkInfo")), "/MarkInfo present");

  assert.ok(report.applied.some((item) => /OutputIntent/i.test(item)));
  assert.ok(report.removed.some((item) => /OpenAction/i.test(item)));
  assert.ok(report.removed.some((item) => /JavaScript/i.test(item)));
});

test("archivalPrepPdf refuses an encrypted PDF with a friendly message", async () => {
  const { archivalPrepPdf, assertPdfDecryptable } = await import("../src/services/pdf-review.service.js");
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const { bytes } = await pdfCrypto.encryptPdf(new File([await doc.save()], "s.pdf", { type: "application/pdf" }), { userPassword: "pw" });
  await assert.rejects(() => archivalPrepPdf(bytes, {}), /encrypted/i);
  await assert.rejects(() => assertPdfDecryptable(bytes), /encrypted/i);
});

test("Phase 2 review tools are registered, routed, and rendered", () => {
  const ids = ["compare-pdf-tool", "deskew-pdf-tool", "pdfa-prep-tool"];
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  for (const id of ids) {
    const found = tools.find((tool) => tool.id === id);
    assert.ok(found, `${id} registered`);
    assert.equal(found.category, "PDF Tools");
    assert.equal(found.status, "available");
    assert.equal(found.localProcessing, true);
    assert.equal(routeForHash(found.route).tool.id, id);
    assert.equal(appSource.includes(`"${id}"`), true, `${id} wired into ToolRenderer`);
  }
  // Compare accepts two files.
  assert.equal(tools.find((t) => t.id === "compare-pdf-tool").file.maxFiles, 2);
});

// --- Phase 3: Batch Processing ------------------------------------------------

async function makeBatchPdf(pages = 1) {
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([200, 200]);
  return doc.save();
}

test("batch: runs a pure pdf-lib op over many files, names each output, and zips them", async () => {
  const { runBatch, zipOutputs } = await import("../src/services/batch.service.js");
  const { unzipSync } = await import("fflate");
  const { PDFDocument } = window.PDFLib;

  const files = [];
  for (const base of ["alpha", "beta", "gamma"]) {
    files.push(new File([await makeBatchPdf(2)], `${base}.pdf`, { type: "application/pdf" }));
  }

  const seen = [];
  const run = await runBatch(files, "rotate", { degrees: "90" }, { onProgress: (info) => seen.push(info.current) });

  assert.equal(run.total, 3);
  assert.equal(run.failures.length, 0);
  assert.equal(run.outputs.length, 3);
  assert.deepEqual(seen, [1, 2, 3], "determinate progress fires once per file, in order");
  assert.deepEqual(run.outputs.map((o) => o.name).sort(), ["alpha-rotated.pdf", "beta-rotated.pdf", "gamma-rotated.pdf"]);

  for (const out of run.outputs) {
    const doc = await PDFDocument.load(out.bytes);
    assert.equal(doc.getPageCount(), 2, "each output is a valid 2-page PDF");
    assert.equal(doc.getPage(0).getRotation().angle, 90, "the rotate op actually ran");
  }

  const entries = unzipSync(zipOutputs(run.outputs));
  assert.deepEqual(Object.keys(entries).sort(), ["alpha-rotated.pdf", "beta-rotated.pdf", "gamma-rotated.pdf"]);
  const reloaded = await PDFDocument.load(entries["beta-rotated.pdf"]);
  assert.equal(reloaded.getPageCount(), 2);
});

test("batch: a corrupt file fails without aborting the batch, and the zip holds only the good outputs", async () => {
  const { runBatch, zipOutputs } = await import("../src/services/batch.service.js");
  const { unzipSync } = await import("fflate");
  const { PDFDocument } = window.PDFLib;

  const files = [
    new File([await makeBatchPdf(1)], "good-1.pdf", { type: "application/pdf" }),
    new File([new Uint8Array([1, 2, 3, 4, 5])], "broken.pdf", { type: "application/pdf" }),
    new File([await makeBatchPdf(1)], "good-2.pdf", { type: "application/pdf" }),
  ];

  const run = await runBatch(files, "page-numbers", { prefix: "Page ", fontSize: "10" });

  assert.equal(run.total, 3);
  assert.equal(run.outputs.length, 2, "the run completes with the two good files");
  assert.equal(run.failures.length, 1, "the corrupt file is recorded, not thrown");
  assert.equal(run.failures[0].name, "broken.pdf");
  assert.ok(run.failures[0].reason && run.failures[0].reason.length > 0, "the failure carries a reason");
  assert.deepEqual(run.outputs.map((o) => o.name).sort(), ["good-1-numbered.pdf", "good-2-numbered.pdf"]);

  const entries = unzipSync(zipOutputs(run.outputs));
  assert.deepEqual(Object.keys(entries).sort(), ["good-1-numbered.pdf", "good-2-numbered.pdf"]);
  assert.equal(entries["broken.pdf"], undefined, "the failed file is absent from the zip");
});

test("batch: a PDF op flags and skips a non-PDF while the PDFs still succeed", async () => {
  const { runBatch } = await import("../src/services/batch.service.js");

  const files = [
    new File([await makeBatchPdf(1)], "doc-a.pdf", { type: "application/pdf" }),
    new File([new Uint8Array([137, 80, 78, 71])], "picture.png", { type: "image/png" }),
    new File([await makeBatchPdf(1)], "doc-b.pdf", { type: "application/pdf" }),
  ];

  const run = await runBatch(files, "metadata-clean", {});

  assert.equal(run.outputs.length, 2);
  assert.deepEqual(run.outputs.map((o) => o.name).sort(), ["doc-a-clean.pdf", "doc-b-clean.pdf"]);
  assert.equal(run.failures.length, 1);
  assert.equal(run.failures[0].name, "picture.png");
  assert.match(run.failures[0].reason, /not a pdf/i);
});

test("batch: rejects an over-limit file count with a clear message", async () => {
  const { runBatch, MAX_BATCH_FILES } = await import("../src/services/batch.service.js");
  const tooMany = Array.from({ length: MAX_BATCH_FILES + 1 }, (_, i) => new File(["x"], `f-${i}.pdf`, { type: "application/pdf" }));
  await assert.rejects(() => runBatch(tooMany, "rotate", { degrees: "90" }), new RegExp(`no more than ${MAX_BATCH_FILES} files`, "i"));
  // An unknown op id is rejected too (prototype-safe lookup).
  await assert.rejects(() => runBatch([new File(["x"], "f.pdf")], "__proto__", {}), /not a supported batch operation/i);
  await assert.rejects(() => runBatch([], "rotate", {}), /at least one file/i);
});

test("batch-process tool is registered, routed, rendered, and exposes sensible ops", () => {
  const found = tools.find((tool) => tool.id === "batch-process-tool");
  assert.ok(found, "batch-process-tool registered");
  assert.equal(found.category, "PDF Tools");
  assert.equal(found.status, "available");
  assert.equal(found.localProcessing, true);
  assert.equal(found.file.maxFiles, 100);
  assert.equal(routeForHash(found.route).tool.id, "batch-process-tool");

  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.equal(appSource.includes(`"batch-process-tool"`), true, "wired into ToolRenderer");
  assert.equal(appSource.includes("BatchProcessTool"), true, "component defined");

  const searchable = [found.name, found.description, ...found.keywords].join(" ").toLowerCase();
  for (const term of ["batch", "bulk", "multi"]) assert.match(searchable, new RegExp(term));
});

test("batch op registry is well-formed with both pdf-lib and browser-only ops", async () => {
  const { batchOpList, defaultBatchOptions, batchAcceptFor } = await import("../src/services/batch.service.js");
  const ops = batchOpList();
  const ids = ops.map((op) => op.id);
  for (const id of ["rotate", "page-numbers", "watermark", "metadata-clean", "encrypt", "compress", "flatten", "image-compress", "image-convert", "image-resize"]) {
    assert.ok(ids.includes(id), `${id} exposed`);
  }
  // Every op has an accepts of pdf|image and default options resolve.
  for (const op of ops) {
    assert.ok(op.accepts === "pdf" || op.accepts === "image");
    assert.equal(typeof defaultBatchOptions(op.id), "object");
  }
  assert.equal(batchAcceptFor("rotate"), "application/pdf");
  assert.equal(batchAcceptFor("image-convert"), "image/jpeg,image/png,image/webp");
  // At least one pure pdf-lib op and one browser-only op exist.
  assert.ok(ops.some((op) => !op.browserOnly));
  assert.ok(ops.some((op) => op.browserOnly));
});

// --- Edit PDF Text (in-place overlay editing) ---------------------------------

test("mapPdfFontToStandard maps base-14 / subset font names to family + style", async () => {
  const { mapPdfFontToStandard, standardFontKey } = await import("../src/services/pdf-textedit.service.js");
  assert.deepEqual(mapPdfFontToStandard("Helvetica-Bold"), { family: "Helvetica", bold: true, italic: false });
  // Subset prefix stripped; ",Bold" -> bold; Arial -> sans (Helvetica).
  assert.deepEqual(mapPdfFontToStandard("ABCDEF+Arial,Bold"), { family: "Helvetica", bold: true, italic: false });
  assert.deepEqual(mapPdfFontToStandard("TimesNewRomanPS-ItalicMT"), { family: "Times", bold: false, italic: true });
  assert.deepEqual(mapPdfFontToStandard("CourierNew"), { family: "Courier", bold: false, italic: false });
  assert.deepEqual(mapPdfFontToStandard("Wingdings"), { family: "Helvetica", bold: false, italic: false });
  // Descriptor -> pdf-lib StandardFonts key.
  assert.equal(standardFontKey({ family: "Helvetica", bold: true, italic: false }), "HelveticaBold");
  assert.equal(standardFontKey({ family: "Times", bold: false, italic: true }), "TimesRomanItalic");
  assert.equal(standardFontKey({ family: "Courier", bold: true, italic: true }), "CourierBoldOblique");
  assert.equal(standardFontKey({ family: "Times", bold: false, italic: false }), "TimesRoman");
});

test("textItemToPageRect converts a pdf.js transform to a pdf-lib rect (0deg and 90deg pages)", async () => {
  const { textItemToPageRect } = await import("../src/services/pdf-textedit.service.js");
  // 0deg page (height 792). "Invoice 12345" drawn at pdf-lib (72, 700) size 24
  // is reported by pdf.js as transform [24,0,0,24,72,700] (verified empirically).
  const a = textItemToPageRect([24, 0, 0, 24, 72, 700], 149.42, 24, 792, 0);
  assert.equal(a.x, 72);
  assert.equal(a.baseline, 700);
  assert.equal(a.fontSize, 24);
  assert.equal(a.angle, 0);
  // Cover box: bottom = baseline - descent (24 * 0.22 = 5.28); height = font + descent.
  assert.ok(Math.abs(a.y - 694.72) < 1e-9, `y ${a.y}`);
  assert.ok(Math.abs(a.w - 149.42) < 1e-9, `w ${a.w}`);
  assert.ok(Math.abs(a.h - 29.28) < 1e-9, `h ${a.h}`);

  // 90deg (/Rotate) page: pdf-lib draws in UNROTATED space and the viewer rotates
  // at display time, so the baseline maps identically — NO y-flip. Verified on a
  // real /Rotate 90 PDF: drawing at (100, 500) yields transform [18,0,0,18,100,500].
  const b = textItemToPageRect([18, 0, 0, 18, 100, 500], 88.06, 18, 792, 90);
  assert.equal(b.x, 100);
  assert.equal(b.baseline, 500);
  assert.equal(b.fontSize, 18);
  assert.ok(Math.abs(b.y - 496.04) < 1e-9, `y ${b.y}`); // 500 - 18*0.22
  assert.ok(Math.abs(b.w - 88.06) < 1e-9, `w ${b.w}`);

  // A run rotated 90deg in its OWN matrix reports angle 90 and swaps w/h so the
  // cover box still encloses it.
  const c = textItemToPageRect([0, 20, -20, 0, 300, 400], 60, 20, 792, 0);
  assert.equal(c.fontSize, 20);
  assert.equal(c.angle, 90);
  assert.ok(Math.abs(c.w - (20 + 20 * 0.22)) < 1e-9, `w ${c.w}`); // height + descent
  assert.ok(Math.abs(c.h - 60) < 1e-9, `h ${c.h}`); // original width

  assert.throws(() => textItemToPageRect([1, 2, 3], 10, 10, 792, 0), /position data/);
});

// Decodes every content stream of a saved single-page PDF to raw operator text.
async function decodePageOps(bytes) {
  const { unzlibSync, inflateSync } = await import("fflate");
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.load(bytes);
  const refs = doc.getPages()[0].node.Contents().asArray();
  const decode = (raw) => {
    for (const fn of [unzlibSync, inflateSync]) {
      try { return new TextDecoder("latin1").decode(fn(raw)); } catch { /* try next */ }
    }
    return new TextDecoder("latin1").decode(raw);
  };
  return refs.map((ref) => decode(doc.context.lookup(ref).contents)).join("\n");
}

const hexOf = (s) => Buffer.from(s, "latin1").toString("hex").toUpperCase();

async function buildInvoicePdf() {
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("Invoice 12345", { x: 72, y: 700, size: 24, font, color: rgb(0.1, 0.1, 0.1) });
  return doc.save();
}

test("applyTextEdits covers the original region and redraws the new string", async () => {
  const { applyTextEdits, textItemToPageRect } = await import("../src/services/pdf-textedit.service.js");
  const src = await buildInvoicePdf();
  const rect = textItemToPageRect([24, 0, 0, 24, 72, 700], 149.42, 24, 792, 0);
  const out = await applyTextEdits(src, [{
    page: 1, rect, text: "Invoice 99999", fontKey: "Helvetica",
    color: { r: 0.1, g: 0.1, b: 0.1 }, background: { r: 1, g: 1, b: 1 },
  }]);
  assert.ok(out instanceof Uint8Array && out.byteLength > 0);
  const ops = await decodePageOps(out);
  // New string is drawn (pdf-lib writes text as a hex-encoded show string).
  assert.ok(ops.includes(hexOf("Invoice 99999")), "new string drawn");
  // A white cover rectangle is filled over the original region.
  assert.match(ops, /1 1 1 rg/, "white cover fill");
  assert.match(ops, /72 694\.72 cm/, "cover translated to the run's region");
  assert.match(ops, /\nh\nf\n/, "rectangle path closed and filled");
});

test("applyTextEdits: delete leaves only the cover, multi-edit applies all, bad rect + non-Latin rejected", async () => {
  const { applyTextEdits, textItemToPageRect } = await import("../src/services/pdf-textedit.service.js");
  const rect = textItemToPageRect([24, 0, 0, 24, 72, 700], 149.42, 24, 792, 0);

  // Delete (empty text) => cover fill present, no drawn text run added by the edit.
  const del = await applyTextEdits(await buildInvoicePdf(), [{ page: 1, rect, text: "", background: { r: 1, g: 1, b: 1 } }]);
  const delOps = await decodePageOps(del);
  assert.match(delOps, /1 1 1 rg/, "cover drawn for delete");
  assert.ok(!delOps.includes(hexOf("REPLACED")), "no stray text for delete");

  // Two edits on one page both land.
  const rect2 = textItemToPageRect([24, 0, 0, 24, 72, 640], 149.42, 24, 792, 0);
  const multi = await applyTextEdits(await buildInvoicePdf(), [
    { page: 1, rect, text: "First edit", fontKey: "Helvetica" },
    { page: 1, rect: rect2, text: "Second edit", fontKey: "Helvetica" },
  ]);
  const multiOps = await decodePageOps(multi);
  assert.ok(multiOps.includes(hexOf("First edit")), "first edit drawn");
  assert.ok(multiOps.includes(hexOf("Second edit")), "second edit drawn");

  // A rect outside the page is rejected.
  const off = { x: 5000, y: 5000, w: 100, h: 20, baseline: 5000, fontSize: 12 };
  const forOff = await buildInvoicePdf();
  await assert.rejects(() => applyTextEdits(forOff, [{ page: 1, rect: off, text: "x" }]), /outside the page bounds/);

  // A non-Latin replacement raises the friendly Latin-1 error.
  const forCjk = await buildInvoicePdf();
  await assert.rejects(() => applyTextEdits(forCjk, [{ page: 1, rect, text: "日本語", fontKey: "Helvetica" }]), /Latin-1/);

  // No edits at all is rejected.
  const forEmpty = await buildInvoicePdf();
  await assert.rejects(() => applyTextEdits(forEmpty, []), /No text edits/);
});

test("edit-pdf-text tool is registered, routed, wired into ToolRenderer, and discoverable", () => {
  const found = tools.find((tool) => tool.id === "edit-pdf-text-tool");
  assert.ok(found, "edit-pdf-text-tool registered");
  assert.equal(found.category, "PDF Tools");
  assert.equal(found.status, "available");
  assert.equal(found.localProcessing, true);
  assert.equal(found.file.maxFiles, 1);
  assert.equal(routeForHash(found.route).tool.id, "edit-pdf-text-tool");

  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.equal(appSource.includes(`"edit-pdf-text-tool"`), true, "wired into ToolRenderer");
  assert.equal(appSource.includes("EditPdfTextTool"), true, "component defined");

  const searchable = [found.name, found.description, ...found.keywords].join(" ").toLowerCase();
  for (const term of ["edit", "replace", "text"]) assert.match(searchable, new RegExp(term));
});

// --- Annotate PDF (highlight / ink / shapes / notes / callouts) ---------------

// Decodes every content stream of EACH page of a saved PDF to operator text.
async function decodeAllPageOps(bytes) {
  const { unzlibSync, inflateSync } = await import("fflate");
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.load(bytes);
  const decode = (raw) => {
    for (const fn of [unzlibSync, inflateSync]) {
      try { return new TextDecoder("latin1").decode(fn(raw)); } catch { /* try next */ }
    }
    return new TextDecoder("latin1").decode(raw);
  };
  return doc.getPages().map((page) => page.node.Contents().asArray().map((ref) => decode(doc.context.lookup(ref).contents)).join("\n"));
}

async function buildBlankPdf(pageCount = 2, size = [612, 792]) {
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) doc.addPage(size);
  return doc.save();
}

test("annotate normaliser clamps a hostile annotation to safe ranges", async () => {
  const svc = await import("../src/services/annotate.service.js");
  const page = { width: 612, height: 792 };

  // Hostile freehand ink: poison colour, absurd width, 100k out-of-range points.
  const ink = svc.normalizeAnnotation({
    type: "ink",
    color: "javascript:alert(1)",
    width: 1e9,
    points: Array.from({ length: 100000 }, (_, i) => ({ x: i % 2 ? -50 : 9999, y: i % 3 ? 9999 : -50 })),
  }, page);
  assert.equal(ink.color, svc.ACCENT_HEX, "poison colour falls back to accent");
  assert.equal(ink.width, svc.MAX_STROKE_WIDTH, "absurd width clamped to max");
  assert.ok(ink.points.length <= svc.MAX_INK_POINTS, `points capped (${ink.points.length})`);
  assert.ok(ink.points.every((p) => p.x >= 0 && p.x <= 612 && p.y >= 0 && p.y <= 792), "every point clamped onto the page");

  // Hostile note: off-page coords, 5000-char text, giant font.
  const note = svc.normalizeAnnotation({ type: "note", x: -50, y: 9999, text: "z".repeat(5000), size: 1e9, color: "not-a-colour" }, page);
  assert.equal(note.x, 0, "negative x clamped to 0");
  assert.equal(note.y, 792, "over-height y clamped to page height");
  assert.equal(note.text.length, svc.MAX_TEXT_LENGTH, "note text truncated to the cap");
  assert.equal(note.size, svc.MAX_FONT_SIZE, "font size clamped to max");
  assert.equal(note.color, "#111827", "invalid note colour falls back to the note default");

  // A control-character injection in note text is stripped (built at runtime so the source stays clean).
  const dirty = svc.normalizeAnnotation({ type: "note", x: 10, y: 10, text: `a${String.fromCharCode(1)}${String.fromCharCode(2)}bc` }, page);
  assert.equal(dirty.text, "abc", "control characters stripped from note text");

  // Highlight colour outside the functional palette falls back to the accent.
  const hi = svc.normalizeAnnotation({ type: "highlight", x: 10, y: 10, w: 1e9, h: 1e9, color: "#ffffff", opacity: 5 }, page);
  assert.equal(hi.color, svc.ACCENT_HEX, "off-palette highlight colour -> accent");
  assert.ok(hi.w <= 612 && hi.h <= 792, "highlight box clamped within the page");
  assert.ok(hi.opacity <= svc.MAX_HIGHLIGHT_OPACITY, "highlight opacity clamped");

  // Unknown type is dropped entirely.
  assert.equal(svc.normalizeAnnotation({ type: "script", x: 0, y: 0 }, page), null, "unknown type rejected");

  // Per-page count cap.
  const many = svc.normalizeAnnotations(Array.from({ length: svc.MAX_ANNOTATIONS_PER_PAGE + 50 }, () => ({ type: "note", x: 1, y: 1, text: "x" })), page);
  assert.equal(many.length, svc.MAX_ANNOTATIONS_PER_PAGE, "annotation count capped per page");
});

test("annotate decimatePoints reduces a 50k stroke below the cap and keeps the endpoints", async () => {
  const { decimatePoints, MAX_INK_POINTS } = await import("../src/services/annotate.service.js");
  const pts = Array.from({ length: 50000 }, (_, i) => ({ x: i, y: i * 2 }));
  const out = decimatePoints(pts);
  assert.ok(out.length <= MAX_INK_POINTS, `reduced below cap (${out.length})`);
  assert.ok(out.length > 1, "not collapsed to a single point");
  assert.deepEqual(out[0], pts[0], "first point preserved");
  assert.deepEqual(out[out.length - 1], pts[pts.length - 1], "last point preserved");
  // A short stroke is returned untouched.
  const short = [{ x: 1, y: 1 }, { x: 2, y: 2 }];
  assert.deepEqual(decimatePoints(short), short);
});

test("annotate screenToPagePoint maps a top-origin screen pixel to bottom-origin page y", async () => {
  const { screenToPagePoint } = await import("../src/services/annotate.service.js");
  // Top-left of the page image (0,0) at 2x scale -> top of a 792pt page (y = height).
  const topLeft = screenToPagePoint({ px: 0, py: 0 }, { scale: 2, pageWidth: 612, pageHeight: 792 });
  assert.equal(topLeft.x, 0);
  assert.equal(topLeft.y, 792, "screen top maps to page top (bottom-origin y = height)");
  // A pixel 184px down at 2x is 92pt down from the top -> y = 792 - 92 = 700.
  const mid = screenToPagePoint({ px: 144, py: 184 }, { scale: 2, pageWidth: 612, pageHeight: 792 });
  assert.equal(mid.x, 72, "x = px / scale");
  assert.equal(mid.y, 700, "y flipped to bottom-origin");
  // Off-canvas pixels clamp onto the page.
  const off = screenToPagePoint({ px: -100, py: 99999 }, { scale: 2, pageWidth: 612, pageHeight: 792 });
  assert.equal(off.x, 0);
  assert.equal(off.y, 0, "a pixel far below the page clamps to y = 0");
});

test("applyAnnotations burns a highlight, a line, and a note onto the correct pages", async () => {
  const svc = await import("../src/services/annotate.service.js");
  const src = await buildBlankPdf(2);
  const out = await svc.applyAnnotations(src, {
    1: [
      { type: "highlight", x: 50, y: 700, w: 200, h: 18, color: "#facc15" },
      { type: "line", x1: 50, y1: 120, x2: 300, y2: 120, color: "#2563eb", width: 2 },
      { type: "note", x: 50, y: 400, text: "Note on page one", size: 14, color: "#111827" },
    ],
    2: [{ type: "note", x: 60, y: 500, text: "Second page note", size: 12 }],
  }, [{ width: 612, height: 792 }, { width: 612, height: 792 }]);
  assert.ok(out instanceof Uint8Array && out.byteLength > 0);

  const pages = await decodeAllPageOps(out);
  // Page 1: highlight -> a filled rectangle path; line -> a stroked path; note -> a hex show-string.
  assert.match(pages[0], /\bf\b/, "page 1 has a fill (highlight rectangle)");
  assert.match(pages[0], /\bS\b/, "page 1 has a stroked path (line)");
  assert.ok(pages[0].includes(hexOf("Note on page one")), "page 1 note show-string present");
  // Page 2 has its own note and NOT page 1's.
  assert.ok(pages[1].includes(hexOf("Second page note")), "page 2 note present");
  assert.ok(!pages[1].includes(hexOf("Note on page one")), "page 1 note does not leak onto page 2");
  assert.ok(!pages[0].includes(hexOf("Second page note")), "page 2 note does not leak onto page 1");
});

test("applyAnnotations: non-Latin note raises the friendly error, empty and bad-page inputs rejected", async () => {
  const svc = await import("../src/services/annotate.service.js");
  const src = await buildBlankPdf(2);

  await assert.rejects(() => svc.applyAnnotations(src, { 1: [{ type: "note", x: 50, y: 50, text: "日本語のメモ" }] }), /Latin-1 characters only/);
  await assert.rejects(() => svc.applyAnnotations(src, { 1: [{ type: "callout", x: 40, y: 400, w: 180, h: 70, text: "报告说明" }] }), /Latin-1 characters only/);

  // A page index beyond the document is rejected, naming the page and the count.
  await assert.rejects(() => svc.applyAnnotations(src, { 5: [{ type: "note", x: 1, y: 1, text: "x" }] }), /page 5, which does not exist/);
  await assert.rejects(() => svc.applyAnnotations(src, { 0: [{ type: "note", x: 1, y: 1, text: "x" }] }), /does not exist/);

  // No annotations at all is rejected.
  await assert.rejects(() => svc.applyAnnotations(src, {}), /No annotations to apply/);
});

test("applyAnnotations draws shapes, arrows, ink and a sticky callout without error", async () => {
  const svc = await import("../src/services/annotate.service.js");
  const src = await buildBlankPdf(1);
  const out = await svc.applyAnnotations(src, {
    1: [
      { type: "rect", x: 40, y: 600, w: 120, h: 80, color: "#dc2626", width: 2, fill: "#dc2626", fillOpacity: 0.2 },
      { type: "ellipse", x: 200, y: 600, w: 120, h: 80, color: "#16a34a", width: 3 },
      { type: "arrow", x1: 40, y1: 300, x2: 240, y2: 360, color: "#2563eb", width: 2 },
      { type: "ink", points: Array.from({ length: 40 }, (_, i) => ({ x: 300 + i * 3, y: 300 + Math.sin(i) * 20 })), color: "#7c3aed", width: 2 },
      { type: "callout", x: 350, y: 500, w: 180, h: 70, text: "Please review this section carefully", size: 11, tx: 300, ty: 450 },
    ],
  });
  assert.ok(out instanceof Uint8Array && out.byteLength > 0, "export produced bytes");
  const [ops] = await decodeAllPageOps(out);
  // A filled+stroked box (rect with fill, callout box) emits the `B` operator.
  assert.match(ops, /\b[fB]\b/, "a fill is emitted (rect fill / callout box)");
  assert.match(ops, /\bS\b/, "stroked paths emitted (ellipse / arrow / ink / line)");
  assert.ok(ops.includes(hexOf("Please review this")), "callout text drawn");
});

test("annotate-pdf tool is registered, routed, wired into ToolRenderer, and discoverable", () => {
  const found = tools.find((tool) => tool.id === "annotate-pdf-tool");
  assert.ok(found, "annotate-pdf-tool registered");
  assert.equal(found.category, "PDF Tools");
  assert.equal(found.status, "available");
  assert.equal(found.localProcessing, true);
  assert.equal(found.file.maxFiles, 1);
  assert.equal(routeForHash(found.route).tool.id, "annotate-pdf-tool");

  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.equal(appSource.includes(`"annotate-pdf-tool"`), true, "wired into ToolRenderer");
  assert.equal(appSource.includes("AnnotatePdfTool"), true, "component defined");

  const searchable = [found.name, found.description, ...found.keywords].join(" ").toLowerCase();
  for (const term of ["annotate", "highlight", "markup"]) assert.match(searchable, new RegExp(term));
});

// ---------------------------------------------------------------------------
// Cryptographic PDF signing + verification (pdf-sign.service.js).
// The pdf-sign service sets the pkijs WebCrypto engine on import; reuse it here
// to build a self-signed certificate + PKCS#12 with no network and no OpenSSL.
// ---------------------------------------------------------------------------

// This test file defines globalThis.window (to host pdf-lib), which makes pkijs
// read its engine from the browser-style store, so set it here after that shim
// is in place rather than relying on the service's import-time registration.
pkijs.setEngine("myfilekit-tests", new pkijs.CryptoEngine({ name: "myfilekit-tests", crypto: globalThis.crypto }));
const signEngine = pkijs.getCrypto(true);
const bufOf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const strBuf = (s) => new TextEncoder().encode(s).buffer;

async function genRsaKeyPair() {
  const alg = pkijs.getAlgorithmParameters("RSASSA-PKCS1-v1_5", "generateKey");
  if ("hash" in alg.algorithm) alg.algorithm.hash.name = "SHA-256";
  alg.algorithm.modulusLength = 2048;
  return signEngine.generateKey(alg.algorithm, true, alg.usages);
}

async function makeSelfSignedCert(commonName, issuerName, keyPair, signingKey) {
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: Math.floor(Math.random() * 1e9) + 1 });
  cert.subject.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: commonName }) }));
  cert.issuer.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: issuerName }) }));
  cert.notBefore.value = new Date(Date.now() - 3600_000);
  cert.notAfter.value = new Date(Date.now() + 3600_000 * 24 * 365);
  await cert.subjectPublicKeyInfo.importKey(keyPair.publicKey, signEngine);
  await cert.sign(signingKey, "SHA-256", signEngine);
  return cert;
}

async function makePkcs12(privateKey, certs, password) {
  const pkcs8 = new Uint8Array(await signEngine.exportKey("pkcs8", privateKey));
  const pw = strBuf(password);
  const certBags = certs.map((cert, i) => new pkijs.SafeBag({
    bagId: "1.2.840.113549.1.12.10.1.3",
    bagValue: new pkijs.CertBag({ parsedValue: cert }),
    bagAttributes: [new pkijs.Attribute({ type: "1.2.840.113549.1.9.20", values: [new asn1js.BmpString({ value: `c${i}` })] })],
  }));
  const keyBag = new pkijs.SafeBag({
    bagId: "1.2.840.113549.1.12.10.1.2",
    bagValue: new pkijs.PKCS8ShroudedKeyBag({ parsedValue: new pkijs.PrivateKeyInfo({ schema: asn1js.fromBER(bufOf(pkcs8)).result }) }),
    bagAttributes: [new pkijs.Attribute({ type: "1.2.840.113549.1.9.20", values: [new asn1js.BmpString({ value: "k" })] })],
  });
  await keyBag.bagValue.makeInternalValues({ password: pw, contentEncryptionAlgorithm: { name: "AES-CBC", length: 256 }, hmacHashAlgorithm: "SHA-256", iterationCount: 2048 }, signEngine);
  const pfx = new pkijs.PFX({
    parsedValue: {
      integrityMode: 0,
      authenticatedSafe: new pkijs.AuthenticatedSafe({
        parsedValue: {
          safeContents: [
            { privacyMode: 0, value: new pkijs.SafeContents({ safeBags: certBags }) },
            { privacyMode: 0, value: new pkijs.SafeContents({ safeBags: [keyBag] }) },
          ],
        },
      }),
    },
  });
  await pfx.parsedValue.authenticatedSafe.makeInternalValues({ safeContents: [{}, {}] }, signEngine);
  await pfx.makeInternalValues({ password: pw, iterations: 2048, pbkdf2HashAlgorithm: "SHA-256", hmacHashAlgorithm: "SHA-256" }, signEngine);
  return new Uint8Array(pfx.toSchema().toBER());
}

async function buildSamplePdf(useObjectStreams = false) {
  const doc = await globalThis.window.PDFLib.PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText("MyFileKit signing test document", { x: 72, y: 700, size: 18 });
  page.drawText("The quick brown fox jumps over the lazy dog.", { x: 72, y: 660, size: 12 });
  return doc.save({ useObjectStreams });
}

test("sign-pdf + verify-signature: real detached CMS signature round-trips and reports the signer", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("Alice Signer", "Alice Signer", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "correct-horse");
  const pdf = await buildSamplePdf(false);

  const signed = await signPdf(pdf, { p12, password: "correct-horse", reason: "I approve", location: "Bengaluru", visible: true });
  assert.ok(signed.bytes.byteLength > pdf.byteLength, "signing appends an incremental update");
  assert.equal(signed.subjectCommonName, "Alice Signer");
  assert.equal(signed.chainLength, 0);

  const report = await verifyPdfSignatures(signed.bytes);
  assert.equal(report.count, 1, "one signature present");
  const sig = report.signatures[0];
  assert.equal(sig.signatureValid, true, "CMS signature verifies");
  assert.equal(sig.integrity, true, "document digest matches (integrity OK)");
  assert.equal(sig.coversWholeDocument, true, "the whole document is covered");
  assert.equal(sig.verdict, "valid");
  assert.equal(sig.subjectCommonName, "Alice Signer", "signer CN extracted");
  assert.equal(sig.issuerCommonName, "Alice Signer", "issuer CN extracted");
  assert.ok(sig.serialHex && sig.serialHex.length > 0, "serial extracted");
  assert.ok(sig.notBefore instanceof Date && sig.notAfter instanceof Date, "validity dates extracted");
  assert.ok(sig.signingTime instanceof Date, "signing time present");
  assert.match(sig.declaredSigningTime || "", /^D:\d{14}/, "signature dictionary /M date present");
});

test("sign-pdf: ByteRange covers the whole file except the /Contents hex string", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("Range Test", "Range Test", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "pw");
  const pdf = await buildSamplePdf(false);
  const signed = await signPdf(pdf, { p12, password: "pw" });

  const text = Buffer.from(signed.bytes).toString("latin1");
  const match = text.match(/\/ByteRange \[0 (\d+)\s+(\d+)\s+(\d+)\s*\]/);
  assert.ok(match, "ByteRange array present with four numbers starting at 0");
  const length1 = Number(match[1]);
  const start2 = Number(match[2]);
  const length2 = Number(match[3]);

  const open = text.indexOf("/Contents <") + "/Contents <".length - 1; // index of '<'
  const close = text.indexOf(">", open);                                 // index of '>'
  assert.equal(length1, open, "range 1 ends exactly at the opening '<'");
  assert.equal(start2, close + 1, "range 2 begins exactly after the closing '>'");
  assert.equal(start2 + length2, signed.bytes.byteLength, "range 2 runs to end of file");
  // /Contents is a hex string of the declared reserved length.
  assert.equal(close - open - 1, 16384 * 2, "Contents is a hex string of the reserved length");
  assert.match(text.slice(open + 1, open + 41), /^[0-9a-f]+$/, "Contents holds hex digits");
});

test("verify-signature: flipping a byte in a covered region is detected as MODIFIED", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("Tamper Test", "Tamper Test", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "pw");
  const pdf = await buildSamplePdf(false);
  const signed = await signPdf(pdf, { p12, password: "pw" });

  // Offset 60 is deep inside the original PDF body, always within ByteRange 1.
  const tampered = new Uint8Array(signed.bytes);
  tampered[60] ^= 0x01;

  const report = await verifyPdfSignatures(tampered);
  assert.equal(report.count, 1, "signature still parsed after tamper");
  assert.equal(report.signatures[0].integrity, false, "digest no longer matches");
  assert.equal(report.signatures[0].verdict, "modified", "reported as MODIFIED, not valid");
  assert.notEqual(report.signatures[0].verdict, "valid");
});

test("verify-signature: corrupting a byte inside /Contents fails the signature", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("Contents Tamper", "Contents Tamper", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "pw");
  const pdf = await buildSamplePdf(false);
  const signed = await signPdf(pdf, { p12, password: "pw" });

  const text = Buffer.from(signed.bytes).toString("latin1");
  const open = text.indexOf("/Contents <") + "/Contents <".length; // first hex digit of the CMS
  const tampered = new Uint8Array(signed.bytes);
  tampered[open + 2] = tampered[open + 2] === 0x41 ? 0x42 : 0x41; // flip a DER hex nibble

  const report = await verifyPdfSignatures(tampered);
  assert.equal(report.count, 1);
  const sig = report.signatures[0];
  assert.equal(sig.verdict === "invalid" || sig.signatureValid === false, true, "corrupted CMS does not verify");
});

test("sign-pdf: a wrong .p12 password throws a clear error and produces no output", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("Pw Test", "Pw Test", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "the-real-password");
  const pdf = await buildSamplePdf(false);

  await assert.rejects(
    () => signPdf(pdf, { p12, password: "wrong-password" }),
    (error) => /password/i.test(error.message),
    "wrong certificate password is rejected with a password-specific message",
  );
  await assert.rejects(() => loadPkcs12(p12, "also-wrong"), /password/i);
});

test("verify-signature: a PDF with no signatures reports none (not an error)", async () => {
  const pdf = await buildSamplePdf(false);
  const report = await verifyPdfSignatures(pdf);
  assert.equal(report.count, 0);
  assert.deepEqual(report.signatures, []);
});

test("sign-pdf: a certificate chain in the .p12 is carried into the CMS", async () => {
  const caKey = await genRsaKeyPair();
  const ca = await makeSelfSignedCert("Test Root CA", "Test Root CA", caKey, caKey.privateKey);
  const leafKey = await genRsaKeyPair();
  const leaf = await makeSelfSignedCert("Leaf Signer", "Test Root CA", leafKey, caKey.privateKey);
  const p12 = await makePkcs12(leafKey.privateKey, [leaf, ca], "pw");
  const pdf = await buildSamplePdf(true); // object-stream PDF exercises the ObjStm reader too

  const signed = await signPdf(pdf, { p12, password: "pw" });
  assert.equal(signed.chainLength, 1, "the intermediate/root is included alongside the leaf");
  assert.equal(signed.subjectCommonName, "Leaf Signer");

  const report = await verifyPdfSignatures(signed.bytes);
  assert.equal(report.signatures[0].signatureValid, true);
  assert.equal(report.signatures[0].integrity, true);
  assert.equal(report.signatures[0].issuerCommonName, "Test Root CA", "issuer read from the leaf certificate");
  assert.equal(report.signatures[0].verdict, "valid");
});

test("sign-pdf-tool and verify-signature-tool are registered, routed, and wired into ToolRenderer", () => {
  for (const id of ["sign-pdf-tool", "verify-signature-tool"]) {
    const found = tools.find((tool) => tool.id === id);
    assert.ok(found, `${id} registered`);
    assert.equal(found.category, "Security & Privacy");
    assert.equal(found.status, "available");
    assert.equal(found.localProcessing, true);
    assert.equal(routeForHash(found.route).tool.id, id);
  }
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.equal(appSource.includes(`"sign-pdf-tool"`), true, "sign tool wired into ToolRenderer");
  assert.equal(appSource.includes(`"verify-signature-tool"`), true, "verify tool wired into ToolRenderer");
  assert.equal(appSource.includes("SignPdfTool"), true);
  assert.equal(appSource.includes("VerifySignatureTool"), true);
});

// --- Phase 7: OCR multi-language support -------------------------------------
// Actual recognition needs a browser (tesseract.js worker + WebAssembly), so it
// is not exercised here. These tests lock in the vendored-model integrity, the
// config/param plumbing that IS Node-reachable, the UI/model list agreement, and
// the source-level offline guarantee.

// The expected sha256 for a vendored asset, read from the release gate itself,
// so these tests catch any model that was corrupted or swapped after vendoring.
function registeredAssetDigest(assetPath) {
  const auditSource = fs.readFileSync(new URL("../scripts/security-audit.js", import.meta.url), "utf8");
  const match = auditSource.match(
    new RegExp(`"${assetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":\\s*"([0-9a-f]{64})"`)
  );
  return match ? match[1] : null;
}

test("every vendored OCR language model is a real, integrity-checked gzip file", async () => {
  const { OCR_LANGUAGES } = await import("../src/services/ocr.service.js");
  assert.ok(OCR_LANGUAGES.length >= 2, "more than English should be vendored");
  for (const { code, file, sizeBytes } of OCR_LANGUAGES) {
    const relativePath = `assets/vendor/tesseract/lang/${file}`;
    const modelPath = new URL(`../${relativePath}`, import.meta.url);
    assert.ok(fs.existsSync(modelPath), `${code}: ${file} exists on disk`);
    const bytes = fs.readFileSync(modelPath);
    assert.ok(bytes.length > 0, `${code}: model is non-empty`);
    assert.equal(bytes.length, sizeBytes, `${code}: OCR_LANGUAGES sizeBytes matches the file on disk`);
    // gzip magic bytes 1f 8b — the model is shipped gzipped, as the worker expects.
    assert.equal(bytes[0], 0x1f, `${code}: gzip magic byte 0`);
    assert.equal(bytes[1], 0x8b, `${code}: gzip magic byte 1`);
    // sha256 must match the value registered in the security-audit release gate,
    // so a corrupted or replaced model is caught before it can ship.
    const expected = registeredAssetDigest(relativePath);
    assert.ok(expected, `${code}: sha256 is registered in security-audit.js`);
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, expected, `${code}: model sha256 matches the registered integrity value`);
  }
});

test("the OCR language list and the vendored models are exactly in sync", async () => {
  const { OCR_LANGUAGES } = await import("../src/services/ocr.service.js");
  const langDir = new URL("../assets/vendor/tesseract/lang/", import.meta.url);
  const onDisk = new Set(fs.readdirSync(langDir).filter((name) => name.endsWith(".traineddata.gz")));
  const listed = new Set(OCR_LANGUAGES.map((entry) => entry.file));
  // No UI option without a local model...
  for (const file of listed) assert.ok(onDisk.has(file), `${file} is offered but not vendored`);
  // ...and no orphan model without a UI option.
  for (const file of onDisk) assert.ok(listed.has(file), `${file} is vendored but has no language option`);
  assert.equal(listed.size, onDisk.size, "OCR_LANGUAGES and the vendored lang dir match one-to-one");
});

test("resolveOcrLang validates codes, dedupes, supports combos, and falls back to English", async () => {
  const { resolveOcrLang, DEFAULT_OCR_LANG } = await import("../src/services/ocr.service.js");
  assert.equal(DEFAULT_OCR_LANG, "eng");
  // Default / passthrough of a known code.
  assert.equal(resolveOcrLang("eng"), "eng");
  assert.equal(resolveOcrLang("hin"), "hin");
  // Multi-language strings Tesseract understands are preserved in order.
  assert.equal(resolveOcrLang("hin+eng"), "hin+eng");
  assert.equal(resolveOcrLang(["eng", "hin"]), "eng+hin");
  // Duplicates collapse.
  assert.equal(resolveOcrLang("eng+eng"), "eng");
  // Unknown codes (no local model) are dropped; a clear English fallback remains.
  assert.equal(resolveOcrLang("klingon"), "eng");
  assert.equal(resolveOcrLang("hin+klingon"), "hin");
  assert.equal(resolveOcrLang(""), "eng");
  assert.equal(resolveOcrLang(undefined), "eng");
});

test("ocr.service points Tesseract at the LOCAL vendored dir and threads the lang code through", () => {
  const serviceSource = fs.readFileSync(new URL("../src/services/ocr.service.js", import.meta.url), "utf8");
  // langPath is the same-origin vendored directory, never a remote host.
  assert.match(serviceSource, /const LANG_PATH = `\$\{VENDOR_BASE\}\/lang`/);
  assert.match(serviceSource, /VENDOR_BASE = "\/assets\/vendor\/tesseract"/);
  // The resolved language code(s) are handed to createWorker with the local langPath.
  assert.match(serviceSource, /createWorker\(resolved, 1, \{/);
  assert.match(serviceSource, /langPath: LANG_PATH/);
  // gzip stays on so the vendored *.gz models load, and the blob-URL worker
  // (which the CSP would block) stays off.
  assert.match(serviceSource, /gzip: true/);
  assert.match(serviceSource, /workerBlobURL: false/);
  // The lang option is threaded from the public API down into the worker.
  assert.match(serviceSource, /async function getWorker\(lang = DEFAULT_OCR_LANG\)/);
  assert.match(serviceSource, /getWorker\(lang\)/);
});

test("OCR stays offline: the service names no CDN / tessdata / http(s) URL", () => {
  const serviceSource = fs.readFileSync(new URL("../src/services/ocr.service.js", import.meta.url), "utf8");
  // Mirror of the pdf.js offline guard: no remote loader of any kind in the OCR
  // path. Comments legitimately mention "the CDN serves"/gzip, so the assertion
  // targets actual URL forms and known tessdata hosts, not the word "CDN".
  assert.doesNotMatch(serviceSource, /https?:\/\//);
  assert.doesNotMatch(serviceSource, /tessdata|cdnjs|unpkg|jsdelivr/i);
});

// --- IA / discovery / naming (post 38->96 tool growth) ----------------------

test("every PDF tool has a valid sub-group from the allowed set (no PDF tool left ungrouped)", () => {
  const allowed = categoryGroups["PDF Tools"];
  assert.deepEqual(allowed, ["Organize", "Convert", "Edit & Annotate", "Forms", "Secure", "Archival & Print"]);
  const pdfTools = tools.filter((tool) => tool.category === "PDF Tools");
  assert.ok(pdfTools.length >= 46, `expected the full PDF page, saw ${pdfTools.length}`);
  for (const tool of pdfTools) {
    assert.ok(allowed.includes(tool.group), `${tool.id} has invalid/missing group ${JSON.stringify(tool.group)}`);
  }
  // The groups actually used must be a subset of the declared order (used for rendering).
  const usedGroups = new Set(pdfTools.map((tool) => tool.group));
  for (const group of usedGroups) assert.ok(allowed.includes(group));
});

test("Text & Data tools are fully grouped too", () => {
  const allowed = categoryGroups["Text & Data Tools"];
  const textTools = tools.filter((tool) => tool.category === "Text & Data Tools");
  for (const tool of textTools) {
    assert.ok(allowed.includes(tool.group), `${tool.id} has invalid/missing group ${JSON.stringify(tool.group)}`);
  }
});

test("isNew is boolean everywhere and flags the newest tools", () => {
  for (const tool of tools) assert.equal(typeof tool.isNew, "boolean");
  const expectedNew = [
    "edit-pdf-text-tool", "annotate-pdf-tool", "compare-pdf-tool", "sign-pdf-tool", "verify-signature-tool",
    "batch-process-tool", "smart-split-pdf-tool", "impose-pdf-tool", "bookmarks-editor-tool",
    "create-form-tool", "deskew-pdf-tool", "pdfa-prep-tool", "sanitize-pdf-tool", "extract-images-tool",
  ];
  for (const id of expectedNew) {
    assert.equal(tools.find((tool) => tool.id === id).isNew, true, `${id} should be isNew`);
  }
  // The multi-language OCR tool is pre-existing and must NOT be flagged new.
  assert.equal(tools.find((tool) => tool.id === "ocr-pdf-tool").isNew, false);
  // Exactly the newest ~13 tools are flagged (12 here) — a legacy tool creeping in would break this.
  assert.equal(tools.filter((tool) => tool.isNew).length, expectedNew.length);
});

test("dashboard discovery references resolve to real, sensible tools", () => {
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  // New quick chips exist and a couple of new tools are in the popular/new shelves.
  for (const chip of ["Edit PDF text", "Annotate PDF", "Sign PDF", "Compare PDFs"]) {
    assert.ok(appSource.includes(`"${chip}"`), `quick chip ${chip} missing`);
  }
  for (const id of ["edit-pdf-text-tool", "sign-pdf-tool"]) {
    assert.ok(appSource.includes(id), `popular/new shelf should reference ${id}`);
  }
  assert.match(appSource, /newAndNotableIds/);
  assert.match(appSource, /New & Notable/);
  // Every id in the new & notable shelf resolves to a tool that is actually isNew.
  const shelf = appSource.match(/newAndNotableIds = \[(.*?)\]/s)[1].match(/"([^"]+)"/g).map((s) => s.replace(/"/g, ""));
  assert.ok(shelf.length >= 4 && shelf.length <= 6);
  for (const id of shelf) {
    const tool = tools.find((t) => t.id === id);
    assert.ok(tool && tool.isNew, `${id} in New & Notable shelf must exist and be isNew`);
  }
});

test("flagship search terms resolve to the right tool", () => {
  const top = (query) => filterTools(query)[0];
  assert.equal(top("edit pdf text").id, "edit-pdf-text-tool");
  assert.equal(top("annotate pdf").id, "annotate-pdf-tool");
  assert.equal(top("compare pdfs").id, "compare-pdf-tool");
  // "sign pdf" is the everyday, visual signing action (not the cryptographic tool).
  assert.equal(top("sign pdf").id, "add-signature-to-pdf-tool");
  // The cryptographic tool is discoverable by its own name.
  assert.equal(top("digital signature").id, "sign-pdf-tool");
});

test("confusable tool pairs carry disambiguating cross-references", () => {
  const byId = (id) => tools.find((tool) => tool.id === id).description;
  // Add Text vs Edit PDF Text vs Annotate
  assert.match(byId("add-text-to-pdf-tool"), /Edit PDF Text/);
  assert.match(byId("add-text-to-pdf-tool"), /Annotate PDF/);
  assert.match(byId("edit-pdf-text-tool"), /Add Text to PDF/);
  assert.match(byId("annotate-pdf-tool"), /Edit PDF Text/);
  // Add Signature (non-cryptographic) vs Digital Signature vs Verify
  assert.match(byId("add-signature-to-pdf-tool"), /not a cryptographic signature/i);
  assert.match(byId("add-signature-to-pdf-tool"), /Digital Signature/);
  assert.match(byId("sign-pdf-tool"), /Add Signature to PDF/);
  assert.match(byId("verify-signature-tool"), /Digital Signature/);
  // Split vs Smart Split vs PDF to ZIP
  assert.match(byId("split-pdf-tool"), /Smart Split PDF/);
  assert.match(byId("smart-split-pdf-tool"), /Split \/ Extract PDF Pages/);
  assert.match(byId("pdf-to-zip-tool"), /Smart Split PDF|Split \/ Extract PDF Pages/);
  // Page numbers vs Headers & Footers vs Bates
  assert.match(byId("pdf-page-numbers-tool"), /Headers & Footers/);
  assert.match(byId("pdf-page-numbers-tool"), /Bates Numbering/);
  assert.match(byId("headers-footers-tool"), /Add PDF Page Numbers/);
  assert.match(byId("bates-numbering-tool"), /Add PDF Page Numbers|Headers & Footers/);
  // Fill vs Create form
  assert.match(byId("fill-pdf-form-tool"), /Create PDF Form/);
  assert.match(byId("create-form-tool"), /Fill PDF Form/);
});

test("Redact PDF has a persistent post-result consequence note", () => {
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const redactBody = appSource.slice(appSource.indexOf("function RedactPdfTool"), appSource.indexOf("function AutoRedactPiiTool"));
  assert.match(redactBody, /status\.tone === "success" && <ResultConsequenceNote>/);
  assert.match(redactBody, /permanently removed and the page is flattened to an image/);
});

test("semantic tone literals are consolidated onto canonical tokens", () => {
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  // The near-duplicate drifts the critics flagged are gone...
  assert.doesNotMatch(appSource, /#31631f/);        // added-line green drift
  assert.doesNotMatch(appSource, /#f59e0b/);        // edited-run raw amber
  assert.doesNotMatch(appSource, /#7a5a1e|#241c0f|#f3d79a/); // valid-partial dark drift
  // ...replaced by the canonical tokens.
  assert.match(appSource, /text-\[var\(--success-fg\)\]/);
  assert.match(appSource, /color-mix\(in_srgb,var\(--warning\)_20%/);
  assert.match(appSource, /border-\[var\(--warning\)\] bg-\[var\(--warning-bg\)\] text-\[var\(--warning-fg\)\]/);
});

test("Input/Label primitives mirror the app's .field-input look", () => {
  const inputSource = fs.readFileSync(new URL("../src/components/ui/input.tsx", import.meta.url), "utf8");
  const labelSource = fs.readFileSync(new URL("../src/components/ui/label.tsx", import.meta.url), "utf8");
  // Aligned to .field-input: 44px, card bg, --input border, 8px radius, focus ring.
  assert.match(inputSource, /h-11/);
  assert.match(inputSource, /bg-card/);
  assert.match(inputSource, /border-input/);
  assert.match(inputSource, /rounded-lg/);
  assert.match(inputSource, /focus-visible:ring-\[3px\]/);
  assert.doesNotMatch(inputSource, /bg-background/); // the old divergent look is gone
  assert.match(inputSource, /field-input/);          // comment noting the mirror
  assert.match(labelSource, /field-input/);
});

// --- Sanitize PDF -------------------------------------------------------------

// Builds a PDF carrying every active-content threat Sanitize is meant to strip:
// a JavaScript /OpenAction, a /Names /JavaScript name tree, a catalog /AA, a
// /Launch action on a link annotation, and an embedded file attachment.
async function buildActiveContentPdf() {
  const { PDFDocument, PDFName, PDFString } = window.PDFLib;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 300]);
  const ctx = pdf.context;

  const openAction = ctx.obj({ S: "JavaScript", JS: PDFString.of("app.alert('open');") });
  pdf.catalog.set(PDFName.of("OpenAction"), ctx.register(openAction));

  const wcAction = ctx.obj({ S: "JavaScript", JS: PDFString.of("this.print();") });
  pdf.catalog.set(PDFName.of("AA"), ctx.obj({ WC: ctx.register(wcAction) }));

  const nameTreeAction = ctx.obj({ S: "JavaScript", JS: PDFString.of("doc.evil();") });
  const nameTree = ctx.obj({ Names: [PDFString.of("Doc"), ctx.register(nameTreeAction)] });

  const fileStream = ctx.flateStream("secret attachment payload", { Type: "EmbeddedFile" });
  const spec = ctx.obj({ Type: "Filespec", F: PDFString.of("payload.bin"), UF: PDFString.of("payload.bin"), EF: { F: ctx.register(fileStream) } });
  const specRef = ctx.register(spec);

  const namesDict = ctx.obj({});
  namesDict.set(PDFName.of("JavaScript"), ctx.register(nameTree));
  namesDict.set(PDFName.of("EmbeddedFiles"), ctx.obj({ Names: [PDFString.of("payload.bin"), specRef] }));
  pdf.catalog.set(PDFName.of("Names"), ctx.register(namesDict));

  const launch = ctx.obj({ S: "Launch", Win: ctx.obj({ F: PDFString.of("cmd.exe /c calc.exe") }) });
  const annot = ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 20, 20], A: ctx.register(launch) });
  page.node.set(PDFName.of("Annots"), ctx.obj([ctx.register(annot)]));

  return pdf.save({ useObjectStreams: false });
}

function countFilespecs(pdf) {
  const { PDFName, PDFDict, PDFRawStream } = window.PDFLib;
  let filespecs = 0;
  let embeddedStreams = 0;
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && String(obj.get(PDFName.of("Type"))) === "/Filespec") filespecs += 1;
    if (obj instanceof PDFRawStream && String(obj.dict?.get?.(PDFName.of("Type"))) === "/EmbeddedFile") embeddedStreams += 1;
  }
  return { filespecs, embeddedStreams };
}

test("sanitize: strips OpenAction, /AA, /Names JavaScript, Launch action, and attachments — and the Analyser agrees", async () => {
  const { sanitizePdf, residualActiveContent } = await import("../src/services/pdf-sanitize.service.js");
  const { PDFDocument, PDFName, PDFDict } = window.PDFLib;
  const src = await buildActiveContentPdf();

  // The Analyser sees the threats before sanitising.
  const before = residualActiveContent(await analyzePdfBytes(src));
  assert.ok(before.length > 0, "Analyser flags active content in the source");

  const { bytes, report } = await sanitizePdf(src, { removeAttachments: true });

  // The removal report counts each category.
  assert.equal(report.counts.openAction, 1);
  assert.equal(report.counts.documentJavaScript, 1);
  assert.ok(report.counts.additionalActions >= 1, "catalog /AA counted");
  assert.ok(report.counts.actionScripts >= 1, "JavaScript/Launch actions counted");
  assert.equal(report.counts.embeddedFiles, 1);
  assert.equal(report.clean, false);
  assert.ok(report.total >= 5);

  // Reloading with pdf-lib shows every entry is gone.
  const out = await PDFDocument.load(bytes);
  assert.equal(out.catalog.get(PDFName.of("OpenAction")), undefined);
  assert.equal(out.catalog.get(PDFName.of("AA")), undefined);
  const names = out.context.lookup(out.catalog.get(PDFName.of("Names")));
  if (names instanceof PDFDict) {
    assert.equal(names.get(PDFName.of("JavaScript")), undefined);
    assert.equal(names.get(PDFName.of("EmbeddedFiles")), undefined);
  }
  assert.deepEqual(countFilespecs(out), { filespecs: 0, embeddedStreams: 0 }, "attachment objects removed");

  // The Analyser and Sanitize agree: re-analysing the output reports none of them.
  const after = residualActiveContent(await analyzePdfBytes(bytes));
  assert.equal(after.length, 0, `no residual active content, got: ${after.map((f) => f.indicator).join(", ")}`);
});

test("sanitize: a clean PDF reports nothing to remove", async () => {
  const { sanitizePdf } = await import("../src/services/pdf-sanitize.service.js");
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const { report } = await sanitizePdf(await doc.save());
  assert.equal(report.clean, true);
  assert.equal(report.total, 0);
  assert.deepEqual(report.removed, []);
});

test("sanitize: refuses an encrypted PDF with a friendly message", async () => {
  const { sanitizePdf } = await import("../src/services/pdf-sanitize.service.js");
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const { bytes } = await pdfCrypto.encryptPdf(new File([await doc.save()], "s.pdf", { type: "application/pdf" }), { userPassword: "pw" });
  await assert.rejects(() => sanitizePdf(bytes), /encrypted/i);
});

test("sanitize: keep-attachments keeps the embedded file while still stripping JavaScript", async () => {
  const { sanitizePdf } = await import("../src/services/pdf-sanitize.service.js");
  const { PDFDocument, PDFName } = window.PDFLib;
  const { bytes, report } = await sanitizePdf(await buildActiveContentPdf(), { removeAttachments: false });

  assert.equal(report.counts.embeddedFiles, 0, "no attachment removed");
  assert.ok(report.counts.actionScripts >= 1, "JavaScript still stripped");
  assert.equal(report.counts.openAction, 1);

  const out = await PDFDocument.load(bytes);
  assert.equal(out.catalog.get(PDFName.of("OpenAction")), undefined, "OpenAction still stripped");
  assert.equal(countFilespecs(out).filespecs, 1, "attachment kept");
});

// --- Extract Images & Attachments --------------------------------------------

// A recognisable, byte-controlled "JPEG" (SOI + payload + EOI). The extractor
// treats DCTDecode image XObjects as opaque JPEG bytes and copies them verbatim.
const SOURCE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 10, 20, 30, 40, 50, 60, 0xff, 0xd9]);

async function buildAssetPdf() {
  const { PDFDocument, PDFName, PDFString } = window.PDFLib;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  const ctx = pdf.context;

  const jpegDict = { Type: "XObject", Subtype: "Image", Width: 4, Height: 1, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode" };
  const jpeg1 = ctx.register(ctx.stream(SOURCE_JPEG, jpegDict));
  const jpeg2 = ctx.register(ctx.stream(SOURCE_JPEG.slice(), jpegDict)); // identical → must de-dupe

  const rgbSamples = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]); // 2×2 RGB
  const flateImg = ctx.register(ctx.flateStream(rgbSamples, { Type: "XObject", Subtype: "Image", Width: 2, Height: 2, ColorSpace: "DeviceRGB", BitsPerComponent: 8 }));

  page.node.set(PDFName.of("Resources"), ctx.obj({ XObject: ctx.obj({ Im0: jpeg1, Im1: jpeg2, Im2: flateImg }) }));

  const fileStream = ctx.flateStream("hello attachment", { Type: "EmbeddedFile" });
  const spec = ctx.obj({ Type: "Filespec", F: PDFString.of("notes.txt"), UF: PDFString.of("notes.txt"), EF: { F: ctx.register(fileStream) } });
  pdf.catalog.set(PDFName.of("Names"), ctx.obj({ EmbeddedFiles: { Names: [PDFString.of("notes.txt"), ctx.register(spec)] } }));

  return pdf.save({ useObjectStreams: false });
}

test("extract: pulls embedded JPEG + attachment, de-dupes, rebuilds Flate raster to PNG, and zips them", async () => {
  const { extractPdfAssets, buildExtractionZip } = await import("../src/services/pdf-extract.service.js");
  const { unzipSync, strFromU8 } = await import("fflate");
  const result = await extractPdfAssets(await buildAssetPdf());

  assert.equal(result.counts.imageXObjects, 3, "three image XObjects seen");
  assert.equal(result.images.length, 2, "identical JPEG de-duplicated to one, plus the PNG");

  const jpeg = result.images.find((image) => image.mime === "image/jpeg");
  assert.ok(jpeg, "a JPEG was extracted");
  assert.deepEqual(jpeg.bytes, SOURCE_JPEG, "JPEG bytes copied verbatim");
  assert.match(jpeg.name, /^image-\d+\.jpg$/);

  const png = result.images.find((image) => image.mime === "image/png");
  assert.ok(png, "a PNG was rebuilt from FlateDecode raster");
  assert.deepEqual([...png.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "valid PNG signature");

  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0].name, "notes.txt");
  assert.equal(strFromU8(result.attachments[0].bytes), "hello attachment");

  const entries = unzipSync(buildExtractionZip(result));
  assert.deepEqual(entries[`images/${jpeg.name}`], SOURCE_JPEG, "zip carries the JPEG bytes");
  assert.equal(strFromU8(entries["attachments/notes.txt"]), "hello attachment", "zip carries the attachment");
});

test("extract: a PDF with no embedded images or attachments is reported clearly", async () => {
  const { extractPdfAssets, buildExtractionZip } = await import("../src/services/pdf-extract.service.js");
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const result = await extractPdfAssets(await doc.save());
  assert.equal(result.counts.imageXObjects, 0);
  assert.equal(result.images.length, 0);
  assert.equal(result.attachments.length, 0);
  assert.throws(() => buildExtractionZip(result), /nothing to bundle/);
});

// --- Workflow presets ---------------------------------------------------------

test("workflow presets map to non-empty step lists whose op ids all exist, with every field filled", async () => {
  const business = await import("../src/services/business.service.js");
  assert.ok(business.WORKFLOW_PRESETS.length >= 6, "the six requested presets exist");
  for (const preset of business.WORKFLOW_PRESETS) {
    const steps = business.presetSteps(preset.id);
    assert.ok(Array.isArray(steps) && steps.length > 0, `${preset.id} has a non-empty step list`);
    for (const step of steps) {
      assert.equal(Object.hasOwn(business.WORKFLOW_OPS, step.op), true, `${preset.id} → op "${step.op}" exists in WORKFLOW_OPS`);
      // Every field the op declares has a value in the pre-filled step.
      for (const field of business.WORKFLOW_OPS[step.op].fields) {
        assert.ok(step.options[field.key] !== undefined, `${preset.id} → ${step.op}.${field.key} is filled`);
      }
    }
  }
  assert.throws(() => business.presetSteps("no-such-preset"), /not a known workflow preset/);
  // The new ops backing the presets are registered.
  const opIds = business.workflowOpList().map((op) => op.id);
  for (const id of ["sanitize", "standardize", "bates", "pdfa"]) assert.ok(opIds.includes(id), `${id} op registered`);
});

test("workflow preset runs end-to-end through runWorkflow", async () => {
  const business = await import("../src/services/business.service.js");
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const source = new File([await doc.save()], "doc.pdf", { type: "application/pdf" });

  // "Print Ready" = standardize A4 + page numbers, both pure pdf-lib (no raster).
  const result = await business.runWorkflow(source, business.presetSteps("print-ready"));
  assert.equal(result.ok, true, result.failed ? result.failed.message : "");
  assert.equal(result.completed.length, 2);

  const out = await PDFDocument.load(result.bytes);
  const { width, height } = out.getPage(0).getSize();
  assert.ok(Math.abs(width - 595.28) < 1 && Math.abs(height - 841.89) < 1, "standardized to A4");
});

test("Sanitize PDF and Extract Images tools are registered, routed, and wired", () => {
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  const sanitize = tools.find((tool) => tool.id === "sanitize-pdf-tool");
  assert.ok(sanitize, "sanitize-pdf-tool registered");
  assert.equal(sanitize.category, "Security & Privacy");
  assert.equal(sanitize.group, "Secure");
  assert.equal(sanitize.status, "available");
  assert.equal(sanitize.localProcessing, true);
  assert.equal(routeForHash(sanitize.route).tool.id, "sanitize-pdf-tool");
  assert.ok(appSource.includes('"sanitize-pdf-tool"'), "sanitize wired into ToolRenderer");

  const extract = tools.find((tool) => tool.id === "extract-images-tool");
  assert.ok(extract, "extract-images-tool registered");
  assert.equal(extract.category, "PDF Tools");
  assert.equal(extract.group, "Organize");
  assert.equal(extract.status, "available");
  assert.equal(extract.localProcessing, true);
  assert.equal(routeForHash(extract.route).tool.id, "extract-images-tool");
  assert.ok(appSource.includes('"extract-images-tool"'), "extract wired into ToolRenderer");
});
