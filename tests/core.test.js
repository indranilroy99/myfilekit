import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tools, categories } from "../src/registry/tools.registry.js";
import { csvToJson, jsonToCsv } from "../src/services/csv.service.js";
import { addPdfPageNumbers, addTextToPdf, cleanPdfMetadata, deletePdfPages, extractPdfPages, mergePdfs, rotatePdfPages, textToPdf, watermarkPdf } from "../src/services/pdf.service.js";
import { validateFiles } from "../src/services/file-validator.js";
import { inspectImageMetadataBuffer } from "../src/services/metadata.service.js";
import { base64Decode, base64Encode, diffToText, generatePassphrase, generatePassword, jsonToYaml, lineDiff, passwordStrength, textStats, urlDecode, urlEncode } from "../src/services/text-tools.service.js";
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
  assert.throws(() => generatePassword({ length: 8, numbers: false, minimumNumbers: 1 }), /Enable numbers/);
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
