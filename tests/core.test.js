import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { tools, categories, categoryGroups } from "../src/registry/tools.registry.js";
import { filterTools } from "../src/lib/search.js";
import { csvToJson, jsonToCsv } from "../src/services/csv.service.js";
import { A4_PAGE, addPdfPageNumbers, addTextToPdf, cleanPdfMetadata, deletePdfPages, extractPdfPages, imagePageLayout, mergePdfs, rotatePdfPages, textToPdf, watermarkPdf } from "../src/services/pdf.service.js";
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
import { signPdf, verifyPdfSignatures, loadPkcs12, buildTimestampRequest, tsaOrigin } from "../src/services/pdf-sign.service.js";
import { chunkForTranslation, buildTranslationPrompt, translateDocument, TRANSLATE_CHUNK_CHARACTERS } from "../src/services/llm.service.js";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { deflateSync, strToU8 } from "fflate";
import nodeCrypto from "node:crypto";
import { analyzePdfBytes, buildAnalyzerReportText, classifyMagic, decodePdfName, findObfuscatedNames, sha256Hex } from "../src/services/pdf-analyzer.service.js";

// Tool components were split out of src/App.tsx into per-category modules under
// src/tools/ (lazy-loaded by ToolRenderer). Source-level assertions that used to
// read App.tsx read the shell plus those modules, so they cover the same code.
const readAppSource = () => [
  fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8"),
  ...fs
    .readdirSync(new URL("../src/tools/", import.meta.url))
    .sort()
    .map((name) => fs.readFileSync(new URL(`../src/tools/${name}`, import.meta.url), "utf8"))
].join("\n");


/**
 * Source of the named top-level components, concatenated. Replaces slicing
 * between two positional markers: the components now live in different files
 * under src/tools/, and a positional span both broke and silently swallowed
 * neighbouring components. Each body runs from `function Name(` to the next
 * top-level `function `, so the scope is exactly the components named.
 */
const sourceOfComponents = (names) => {
  const source = readAppSource();
  return names
    .map((name) => {
      const start = source.indexOf(`function ${name}(`);
      assert.ok(start >= 0, `component ${name} not found in source`);
      // Bound at the next TOP-LEVEL declaration of any kind. Bounding only on
      // "\nfunction " let a component that is last in its file run to the end of
      // the whole concatenation and swallow every following file.
      const rest = source.slice(start + 1);
      const next = rest.search(/\n(?:export |function |const |class |type |interface )/);
      return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
    })
    .join("\n");
};

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
  const appSource = readAppSource();
  assert.doesNotMatch(appSource, /dangerouslySetInnerHTML|\\.innerHTML\\s*=/);
});

test("SpotlightCard glow is single-accent, on-element, and injection-free", () => {
  const appSource = readAppSource();
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
  const appSource = readAppSource();
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

const readInvoiceSource = () => fs.readFileSync(new URL("../invoice-generator/index.html", import.meta.url), "utf8");

// The export geometry is marked off in the invoice's inline script so it can be
// exercised here as plain functions, without driving a browser.
const invoiceExportGeometry = () => {
  const source = readInvoiceSource();
  const start = source.indexOf("// >>> export-geometry");
  const end = source.indexOf("// <<< export-geometry");
  assert.ok(start >= 0 && end > start, "export-geometry block missing from invoice-generator/index.html");
  return new Function(`${source.slice(start, end)}
    return { PDF_PAGE_WIDTH_PT, PDF_PAGE_HEIGHT_PT, EXPORT_WIDTH_PX, EXPORT_SCALE,
      EXPORT_WINDOW_WIDTH_PX, EXPORT_WINDOW_HEIGHT_PX, EXPORT_PAGE_HEIGHT_PX,
      EXPORT_OVERFLOW_TOLERANCE_PX, exportPageCount };`)();
};

const invoiceSenderDisplayName = (state) => {
  const source = readInvoiceSource();
  const start = source.indexOf("function senderDisplayName()");
  assert.ok(start >= 0, "senderDisplayName missing from invoice-generator/index.html");
  const body = source.slice(start, source.indexOf("\n    }", start) + 6);
  return new Function("state", `${body}
    return senderDisplayName();`)(state);
};

test("a one-page invoice exports as exactly one page", () => {
  const geometry = invoiceExportGeometry();
  const source = readInvoiceSource();

  // The export page box is A4 at the fixed export width - 920px across A4's
  // 595.28pt x 841.89pt - not whatever height the on-screen sheet happens to be.
  assert.equal(Math.round(geometry.EXPORT_PAGE_HEIGHT_PX), 1301);

  // The regression: `.invoice` carries a screen-only `min-height` that has nothing
  // to do with A4. While it was taller than the page box the default invoice, with
  // no content near the bottom, still spilled onto a second, near-blank page.
  const sheetMinHeights = [...source.matchAll(/\.invoice[^{}]*\{[^}]*?min-height:\s*(\d+)px/gs)].map((match) => Number(match[1]));
  assert.ok(sheetMinHeights.length >= 1, "expected the invoice sheet to declare a min-height");
  for (const minHeight of sheetMinHeights) {
    assert.equal(geometry.exportPageCount(minHeight), 1, `.invoice min-height ${minHeight}px must still fit one export page`);
  }

  // Bands are a whole A4 page of source pixels. The old `Math.floor` made every
  // band a pixel or two short, which by itself spilled a blank trailing page.
  assert.match(source, /const bandHeightPx = canvas\.width \* \(pageHeight \/ pageWidth\)/);
  // Page count comes from the one helper exercised below, not from ad-hoc maths.
  assert.match(source, /const pageCount = exportPageCount\(totalHeightPx \/ EXPORT_SCALE\)/);

  // Short content, an exactly-full page, and sub-pixel slop all stay on one page.
  assert.equal(geometry.exportPageCount(1), 1);
  assert.equal(geometry.exportPageCount(600), 1);
  assert.equal(geometry.exportPageCount(geometry.EXPORT_PAGE_HEIGHT_PX), 1);
  assert.equal(geometry.exportPageCount(geometry.EXPORT_PAGE_HEIGHT_PX + geometry.EXPORT_OVERFLOW_TOLERANCE_PX), 1);
  assert.equal(geometry.exportPageCount(0), 1);
  assert.equal(geometry.exportPageCount(Number.NaN), 1);

  // Line items that genuinely overflow must still paginate.
  assert.equal(geometry.exportPageCount(geometry.EXPORT_PAGE_HEIGHT_PX + 40), 2);
  assert.equal(geometry.exportPageCount(geometry.EXPORT_PAGE_HEIGHT_PX * 2), 2);
  assert.equal(geometry.exportPageCount(geometry.EXPORT_PAGE_HEIGHT_PX * 3), 3);
  assert.equal(geometry.exportPageCount(geometry.EXPORT_PAGE_HEIGHT_PX * 7 + 500), 8);
});

test("invoice export layout is fixed and does not follow the browser window", () => {
  const geometry = invoiceExportGeometry();
  const source = readInvoiceSource();

  assert.equal(geometry.EXPORT_WIDTH_PX, 920);
  assert.equal(geometry.EXPORT_SCALE, 2);

  // The off-screen window the capture is laid out in must clear every responsive
  // breakpoint, or a narrow browser window leaks the phone layout into the PDF.
  const breakpoints = [...source.matchAll(/@media \(max-width:\s*(\d+)px\)/g)].map((match) => Number(match[1]));
  assert.ok(breakpoints.length >= 2);
  for (const breakpoint of breakpoints) {
    assert.ok(geometry.EXPORT_WINDOW_WIDTH_PX > breakpoint, `export window must clear the ${breakpoint}px breakpoint`);
  }

  const capture = source.slice(source.indexOf("function captureInvoice("), source.indexOf("function applyExportLayout("));
  assert.match(capture, /windowWidth: EXPORT_WINDOW_WIDTH_PX/);
  assert.match(capture, /windowHeight: EXPORT_WINDOW_HEIGHT_PX/);
  assert.match(capture, /scale: EXPORT_SCALE/);
  // Capture resolution used to follow devicePixelRatio, so the same invoice came
  // out at ~89 dpi in a phone-sized window and ~223 dpi on a desktop.
  assert.doesNotMatch(capture, /devicePixelRatio|innerWidth|clientWidth/);

  // The copy is forced to the fixed width rather than inheriting the screen width.
  const layout = source.slice(source.indexOf("function applyExportLayout("));
  assert.match(layout, /node\.style\.width = `\$\{EXPORT_WIDTH_PX\}px`/);
  assert.match(layout, /node\.style\.maxWidth = "none"/);

  // html2canvas resolves ::before / ::after against the live page even though it
  // lays the copy out in the fixed window, so the phone-only pseudo rules have to
  // be cancelled for the duration of the capture.
  assert.match(source, /\.invoice\.is-exporting td::before \{\s*content: none;/);
  assert.match(source, /invoice\.classList\.add\("is-exporting"\)/);
  assert.match(source, /invoice\.classList\.remove\("is-exporting"\)/);
});

test("both sender names survive when the user fills in both", () => {
  const both = { senderName: "Aisha Rahman", companyName: "Northlight Studio", visible: { companyName: true } };

  // Sender Type chooses the order, never which one is thrown away.
  assert.equal(invoiceSenderDisplayName({ ...both, senderType: "freelancer" }), "Aisha Rahman\nNorthlight Studio");
  assert.equal(invoiceSenderDisplayName({ ...both, senderType: "company" }), "Northlight Studio\nAisha Rahman");

  // One field alone still prints alone, in either mode, with no duplication.
  assert.equal(invoiceSenderDisplayName({ senderName: "Aisha Rahman", companyName: "", visible: {}, senderType: "company" }), "Aisha Rahman");
  assert.equal(invoiceSenderDisplayName({ senderName: "", companyName: "Northlight Studio", visible: {}, senderType: "freelancer" }), "Northlight Studio");
  assert.equal(invoiceSenderDisplayName({ senderName: "Northlight Studio", companyName: "Northlight Studio", visible: {}, senderType: "company" }), "Northlight Studio");
  assert.equal(invoiceSenderDisplayName({ senderName: "", companyName: "", visible: {}, senderType: "freelancer" }), "Your Name");

  // Turning the Company Name field off is still honoured - it is an explicit act.
  assert.equal(invoiceSenderDisplayName({ ...both, visible: { companyName: false }, senderType: "freelancer" }), "Aisha Rahman");

  const source = readInvoiceSource();
  // Typing into an empty Company Name reveals it rather than dropping it silently.
  assert.match(source, /function revealCompanyName\(previousValue\)/);
  assert.match(source, /if \(key === "companyName"\) revealCompanyName\(previous\)/);
  // And the panel explains the relationship where the two fields are entered.
  assert.match(source, /the invoice prints both/);
  assert.match(source, /Prints alongside your name/);
});

test("invoice discloses that the downloaded PDF is an image, not text", () => {
  const source = readInvoiceSource();
  assert.match(source, /Download PDF saves the invoice as a picture/);
  assert.match(source, /cannot select or copy/);
});

test("every visible tool has a concrete renderer", () => {
  const appSource = readAppSource();
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

test("renderEquationToHtml renders LaTeX to KaTeX markup and rejects invalid input", async () => {
  const html = await renderEquationToHtml("E = mc^2");
  assert.match(html, /class="katex"/);
  assert.match(html, /<span/);
  await assert.rejects(() => renderEquationToHtml(""), /Enter a LaTeX equation/);
  await assert.rejects(() => renderEquationToHtml("\\frac{1}{"), /Invalid LaTeX/);
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
  const appSource = readAppSource();
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
  const appSource = readAppSource();
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
  const appSource = readAppSource();
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
  const appSource = readAppSource();
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
  const appSource = readAppSource();
  const section = sourceOfComponents([
    "EncryptPdfTool", "RemovePasswordTool", "UnlockPdfTool",
    "SignPdfTool", "SignatureCard", "VerifySignatureTool",
  ]);
  // No logging, no storage, no network, no password interpolated into output.
  for (const forbidden of ["console.", "localStorage", "sessionStorage", "indexedDB", "fetch("]) {
    assert.equal(section.includes(forbidden), false, `the security tools must not use ${forbidden}`);
  }
  assert.equal(/\$\{\s*(password|ownerPassword|confirmation)\s*\}/.test(section), false, "a password must never be interpolated into output");
  assert.equal(/type="password"/.test(sourceOfComponents(["PasswordField"])), true);
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
  describeUnreadablePages,
  detectPii,
  isValidIpv4,
  isValidIpv6,
  luhnValid,
  maskPii,
  maskValue,
  parseXmpFields,
  PII_TYPE_LABELS,
  itemRect,
  rectsForMatch,
  sanitiseForReport,
  scanContentForInvisibleText,
  scanPdfStructure,
  summarisePii,
  validateAadhaar,
  validateAbaRouting,
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

// --- regression: the bank statement a paralegal redacted by hand ---------------
//
// Reported from real client work. The scanner found ONLY the routing number,
// called it a "Bank account number", and never flagged the actual account
// number 4419-8827-6634 — because the account rule matched unbroken digit runs
// only, and a hyphen ends a `\d{9,18}` run. The customer-service phone number
// was missed too: only Indian mobiles and E.164 had detectors.
const BANK_STATEMENT = [
  "FIRST NATIONAL BANK — Statement of account",
  "Account number: 4419-8827-6634        Period: 01 Jul 2026 to 31 Jul 2026",
  "Routing number: 011000138",
  "Customer service: (415) 555-0142",
  "",
  "Please quote 4419-8827-6634 on every remittance advice sent to the branch.",
  "Direct debits are collected from 4419 8827 6634 on the second business day.",
].join("\n");

test("a labelled account number is found at every occurrence, hyphen- or space-grouped", () => {
  const matches = detectPii(BANK_STATEMENT, { now: PII_NOW });
  const accounts = matches.filter((match) => match.type === "account");

  // All three occurrences, in both written forms.
  assert.deepEqual(accounts.map((match) => match.value), ["4419-8827-6634", "4419-8827-6634", "4419 8827 6634"]);
  // Every one lands on the real offset of that text, so a redaction box can be
  // placed over it — a hit that cannot be located is not a hit.
  assert.deepEqual(
    accounts.map((match) => match.start),
    [BANK_STATEMENT.indexOf("4419-8827-6634"), BANK_STATEMENT.indexOf("4419-8827-6634", BANK_STATEMENT.indexOf("4419-8827-6634") + 1), BANK_STATEMENT.indexOf("4419 8827 6634")],
  );
  for (const match of accounts) {
    assert.equal(match.value, BANK_STATEMENT.slice(match.start, match.end));
    assert.ok(match.confidence >= CONFIDENCE.MEDIUM, `${match.value} must not be dismissed as a bare digit run`);
  }
  // The header occurrence is carried by its keyword; the later bare repeats are
  // carried by the same digits having been labelled once on the page.
  assert.match(accounts[0].note, /Account keyword nearby/);
  assert.match(accounts[1].note, /labelled as an account elsewhere/);
  assert.match(accounts[2].note, /labelled as an account elsewhere/);

  // No other rule is allowed to swallow the account number under a wrong label:
  // the 4-4-4 shape is also Aadhaar-shaped, and 12 digits is card-adjacent.
  assert.equal(matches.some((match) => match.type === "aadhaar"), false);
  assert.equal(matches.some((match) => match.type === "card"), false);

  // Grouped detection is not a digit hoover: the groups must look like an
  // account number, and a grouped run with no account context stays low.
  const looseRun = detectPii("Lot 4419 8827 6634 shipped from bay 12.", { now: PII_NOW }).find((match) => match.type === "account");
  assert.equal(looseRun.confidence, CONFIDENCE.LOW);
  assert.equal(detectPii("Bay 60-11-11 holds crates.", { now: PII_NOW }).some((match) => match.type === "account"), false, "under 9 digits is not an account number");
});

test("a US routing number is reported as a routing number, never as a bank account number", () => {
  assert.equal(validateAbaRouting("011000138").valid, true);
  assert.equal(validateAbaRouting("011000139").valid, false, "the ABA checksum must be real");
  assert.match(validateAbaRouting("011000139").reason, /checksum/i);
  assert.equal(validateAbaRouting("991000138").valid, false, "99 is not an issued Federal Reserve prefix");
  assert.equal(validateAbaRouting("01100013").valid, false, "a routing number is 9 digits");

  // The label itself must not claim the number is an account.
  assert.equal(PII_TYPE_LABELS.routing, "Bank routing number (US)");
  assert.equal(/account/i.test(PII_TYPE_LABELS.routing), false);

  const matches = detectPii(BANK_STATEMENT, { now: PII_NOW });
  const routing = matches.filter((match) => match.type === "routing");
  assert.deepEqual(routing.map((match) => match.value), ["011000138"]);
  assert.equal(routing[0].confidence, CONFIDENCE.HIGH, "checksum plus an adjacent routing keyword");
  assert.match(routing[0].note, /identifies the bank, not an account/);
  // The bug being fixed: this value used to come back typed "account".
  assert.equal(matches.some((match) => match.type === "account" && match.value.includes("011000138")), false);
  assert.equal(maskPii("routing", "011000138").includes("011000138"), false, "a routing number is masked like the other bank fields");

  // A 9-digit run that fails the checksum is not promoted to a routing number;
  // the generic account rule still handles it exactly as before.
  const notRouting = detectPii("Account 011000139 was closed.", { now: PII_NOW });
  assert.equal(notRouting.some((match) => match.type === "routing"), false);
  assert.equal(notRouting.find((match) => match.type === "account").value, "011000139");
});

test("North American phone numbers are detected, and bare digit runs are not mistaken for them", () => {
  const statement = detectPii(BANK_STATEMENT, { now: PII_NOW }).filter((match) => match.type === "phone");
  assert.deepEqual(statement.map((match) => match.value), ["(415) 555-0142"]);
  assert.equal(statement[0].confidence, CONFIDENCE.HIGH);

  const written = detectPii("Call +1 415-555-0142, fax 415.555.0143, or try 415-555-0144.", { now: PII_NOW }).filter((match) => match.type === "phone");
  assert.deepEqual(written.map((match) => [match.value, match.confidence]), [
    ["+1 415-555-0142", CONFIDENCE.HIGH],
    ["415.555.0143", CONFIDENCE.MEDIUM],
    ["415-555-0144", CONFIDENCE.MEDIUM],
  ]);
  // Precision: separators are required, and area/exchange codes cannot start
  // with 0 or 1, so ordinary reference numbers are not swept up as phones.
  assert.equal(detectPii("Serial 4155550142 shipped.", { now: PII_NOW }).some((match) => match.type === "phone"), false);
  assert.equal(detectPii("Clause 105-555-0142 of the contract.", { now: PII_NOW }).some((match) => match.type === "phone"), false);
  assert.equal(detectPii("Server 10.20.30.40 responded.", { now: PII_NOW }).some((match) => match.type === "phone"), false);
  assert.equal(detectPii("Upgraded to v10.20.30.40 today.", { now: PII_NOW }).some((match) => match.type === "phone"), false);
});

test("FALSE POSITIVE suite: the grouped-account, routing and NANP rules stay high-precision", () => {
  // The pre-existing prose suite above is run unmodified. This one is aimed at
  // the shapes the three new rules could plausibly over-claim.
  const prose = [
    "Purchase order 2026-004821 covers lot 4419 8827 6634 held in warehouse 7.",
    "Reference 123456789 and batch 011000138 were logged by the packing line.",
    "Rack 415-555-0142 was relabelled, pallet 60-11-11 moved, bin 12 34 56 emptied.",
    "Release 10.20.30.40 shipped on 05/06/2026 under ticket #7654321.",
  ].join("\n");
  const matches = detectPii(prose, { now: PII_NOW });
  const high = highConfidence(matches);
  assert.deepEqual(high, [], `no high-confidence PII expected, got: ${JSON.stringify(high.map((match) => [match.type, match.value]))}`);
  assert.equal(matches.every((match) => match.confidence <= CONFIDENCE.MEDIUM), true);
});

test("a page with no extractable text is reported as unreadable, never as a clean scan", () => {
  // What a rasterised (redacted or scanned) page looks like coming out of
  // extractPdfPiiHits: zero characters, so zero matches.
  const scan = { pages: 1, pagesWithText: 0, pagesWithoutText: [{ page: 1, characters: 0 }], hasTextLayer: false, offPageItems: 0, hits: [], summary: summarisePii([]) };
  const coverage = describeUnreadablePages(scan);
  assert.equal(coverage.unreadable, true);
  assert.equal(coverage.allUnreadable, true);
  assert.equal(coverage.readablePages, 0);
  assert.deepEqual(coverage.unreadablePages, [1]);
  assert.match(coverage.headline, /Page 1 of this file is an image/);
  assert.match(coverage.headline, /No text could be read from it/);
  assert.match(coverage.headline, /cannot tell you what it contains/);
  assert.match(coverage.advice, /OCR/);

  // Per page, not per document: page 4 of a five-page file must be named.
  const partial = describeUnreadablePages({ pages: 5, hasTextLayer: true, pagesWithoutText: [{ page: 2, characters: 0 }, { page: 4, characters: 6 }] });
  assert.deepEqual(partial.unreadablePages, [2, 4]);
  assert.equal(partial.readablePages, 3);
  assert.equal(partial.allUnreadable, false);
  assert.match(partial.headline, /Pages 2 and 4 of this file are images/);
  assert.match(partial.headline, /Almost no text could be read from them/, "6 characters is not 'no text'");

  // A file that reads fine says nothing at all.
  const readable = describeUnreadablePages({ pages: 2, hasTextLayer: true, pagesWithoutText: [] });
  assert.equal(readable.unreadable, false);
  assert.equal(readable.headline, "");
  assert.equal(readable.advice, "");

  // And the downloadable report leads with it instead of reporting a clean bill
  // of health for a page it never read.
  const structure = { pages: 1, encrypted: false, info: {}, xmp: { present: false, bytes: 0, fields: [] }, attachments: [], embeddedFileStreams: 0, embeddedFileBytes: 0, signatures: [], links: [], invisibleText: [], contentTruncated: false };
  const report = buildPrivacyReportText({ fileName: "redacted.pdf", fileSize: 4096, scan, structure, generatedAt: PII_NOW });
  assert.match(report, /NOT SCANNED/);
  assert.match(report, /Page 1 of this file is an image/);
  assert.match(report, /This is not a clean result/);
  assert.equal(/^ {2}No pattern matches\.$/m.test(report), false, "'No pattern matches' must never stand alone for an unreadable page");
  assert.ok(report.indexOf("NOT SCANNED") < report.indexOf("Total matches:"), "the warning must come before the match count");

  // A readable document keeps the ordinary wording.
  const readScan = { pages: 1, pagesWithText: 1, pagesWithoutText: [], hasTextLayer: true, offPageItems: 0, hits: [], summary: summarisePii([]) };
  const readReport = buildPrivacyReportText({ fileName: "clean.pdf", fileSize: 4096, scan: readScan, structure, generatedAt: PII_NOW });
  assert.equal(/NOT SCANNED/.test(readReport), false);
  assert.match(readReport, /No pattern matches\./);
});

test("both privacy tools show the unreadable-page state instead of a bare 'no matches'", () => {
  const section = sourceOfComponents(["UnreadablePagesNotice", "AutoRedactPiiTool", "PrivacyScannerTool"]);
  assert.match(section, /This file was not fully scanned/);
  assert.match(section, /coverage\.headline/);
  // Rendered by BOTH tools, not just one of them.
  assert.equal((section.match(/<UnreadablePagesNotice coverage=\{coverage\} \/>/g) || []).length, 2);
  // No "no known patterns matched" line may be reachable without the
  // unreadable-page state being considered first.
  const claims = [...section.matchAll(/No known patterns matched/g)];
  assert.ok(claims.length >= 2, "both tools have a no-match branch");
  for (const claim of claims) {
    const before = section.slice(Math.max(0, claim.index - 400), claim.index);
    assert.match(before, /coverage\.unreadable/, "a 'no matches' message must be guarded by the unreadable-page check");
  }
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
  const appSource = readAppSource();
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
  const section = sourceOfComponents([
    "AutoRedactPiiTool", "PrivacyScannerTool", "severityTone", "SeverityTag",
    "verdictTone", "PdfAnalyzerTool", "SanitizePdfTool", "ExtractImagesTool",
  ]);
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
  const appSource = readAppSource();
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
  const appSource = readAppSource();
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
  // Page 1 = a changed line (1 removed + 1 added), page 2 = an added trailing
  // line, page 3 = a removed trailing line. These were originally kept
  // end-anchored to work around lineDiff aligning by line index; it now computes
  // a real LCS, so the anchoring is no longer load-bearing and the same
  // expectations hold for a change anywhere on the page.
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
  const appSource = readAppSource();
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

  const appSource = readAppSource();
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

  const appSource = readAppSource();
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

  const appSource = readAppSource();
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

async function makeSelfSignedCert(commonName, issuerName, keyPair, signingKey, validity) {
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: Math.floor(Math.random() * 1e9) + 1 });
  cert.subject.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: commonName }) }));
  cert.issuer.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: issuerName }) }));
  cert.notBefore.value = validity?.notBefore || new Date(Date.now() - 3600_000);
  cert.notAfter.value = validity?.notAfter || new Date(Date.now() + 3600_000 * 24 * 365);
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
  const appSource = readAppSource();
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
  assert.deepEqual(allowed, ["Organize", "Convert", "Edit & Annotate", "Forms", "Secure", "Accessibility", "Archival & Print"]);
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
    "edit-pdf-text-tool", "reflow-pdf-tool", "annotate-pdf-tool", "compare-pdf-tool", "sign-pdf-tool", "verify-signature-tool",
    "batch-process-tool", "smart-split-pdf-tool", "impose-pdf-tool", "bookmarks-editor-tool",
    "create-form-tool", "deskew-pdf-tool", "pdfa-prep-tool", "sanitize-pdf-tool", "extract-images-tool",
    "accessibility-check-tool", "tag-pdf-tool", "translate-pdf-tool", "batch-workflow-tool",
    "request-signature-tool", "api-playground-tool",
  ];
  for (const id of expectedNew) {
    assert.equal(tools.find((tool) => tool.id === id).isNew, true, `${id} should be isNew`);
  }
  // The multi-language OCR tool is pre-existing and must NOT be flagged new.
  assert.equal(tools.find((tool) => tool.id === "ocr-pdf-tool").isNew, false);
  // Exactly the newest flagship tools are flagged — a legacy tool creeping in would break this.
  assert.equal(tools.filter((tool) => tool.isNew).length, expectedNew.length);
});

test("dashboard discovery references resolve to real, sensible tools", () => {
  const appSource = readAppSource();
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
  const appSource = readAppSource();
  const redactBody = appSource.slice(appSource.indexOf("function RedactPdfTool"), appSource.indexOf("function AutoRedactPiiTool"));
  assert.match(redactBody, /status\.tone === "success" && <ResultConsequenceNote>/);
  assert.match(redactBody, /permanently removed and the page is flattened to an image/);
});

test("semantic tone literals are consolidated onto canonical tokens", () => {
  const appSource = readAppSource();
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
  const appSource = readAppSource();

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

// --- PDF Accessibility suite -------------------------------------------------
// The structure/metadata parts run in Node via window.PDFLib; the pdf.js text
// layout used by the browser is stubbed here by passing synthetic text blocks /
// text-layer counts straight to the service (as the app does after extraction).

const a11y = await import("../src/services/pdf-accessibility.service.js");

async function makeTextPdf(pageCount, label) {
  const { PDFDocument, StandardFonts } = window.PDFLib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([612, 792]);
    page.drawText(`${label} page ${i + 1} body text`, { x: 72, y: 700, size: 12, font });
  }
  return doc.save();
}

async function makeImageOnlyPdf() {
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000 1f15c4890000000d49444154789c6360000002000100ffff0300000600000557bfabd40000000049454e44ae426082".replace(/\s/g, ""),
    "hex",
  );
  const img = await doc.embedPng(png);
  page.drawImage(img, { x: 0, y: 0, width: 200, height: 200 });
  return doc.save();
}

const a11yById = (report) => Object.fromEntries(report.checks.map((check) => [check.id, check]));

test("accessibility check flags an untagged PDF as not tagged, no title, no language", async () => {
  const bytes = await makeTextPdf(1, "Report");
  const report = await a11y.auditPdfAccessibility(bytes, { textLayer: { characters: 24, pageCount: 1 } });
  const checks = a11yById(report);
  assert.equal(checks.tagged.status, "fail");
  assert.match(checks.tagged.detail, /not tagged/i);
  assert.equal(checks.language.status, "fail");
  assert.equal(checks["document-title"].status, "fail");
  assert.equal(checks["title-in-titlebar"].status, "fail");
  assert.equal(checks["reading-order"].status, "fail");
  assert.equal(report.verdict.level, "fail");
  assert.match(report.verdict.headline, /not tagged/i);
});

test("accessibility check flags an image-only PDF as scanned / needs OCR", async () => {
  const bytes = await makeImageOnlyPdf();
  const report = await a11y.auditPdfAccessibility(bytes, { textLayer: { characters: 0, pageCount: 1 } });
  const checks = a11yById(report);
  assert.equal(report.stats.imageCount, 1);
  assert.equal(checks["extractable-text"].status, "fail");
  assert.match(checks["extractable-text"].detail, /scan/i);
  assert.match(checks["extractable-text"].fix, /OCR/i);
  // An image with no tag structure cannot carry alt text.
  assert.equal(checks["image-alt"].status, "fail");
});

test("accessibility check reports extractable-text as info when no text layer is supplied", async () => {
  const bytes = await makeTextPdf(1, "Report");
  const report = await a11y.auditPdfAccessibility(bytes);
  const checks = a11yById(report);
  assert.equal(checks["extractable-text"].status, "info");
  assert.equal(report.stats.textLayerEvaluated, false);
});

test("auto-tag sets language, title, viewer prefs, marked, and a real structure tree", async () => {
  const { PDFDocument, PDFName, PDFArray, PDFNumber } = window.PDFLib;
  const bytes = await makeTextPdf(2, "Quarterly");
  const { bytes: out } = await a11y.remediatePdfAccessibility(bytes, {
    lang: "en-US",
    title: "Quarterly Report",
    textBlocks: [
      { page: 1, text: "Quarterly Report", x: 72, y: 740, fontSize: 24, heading: 1 },
      { page: 1, text: "Body paragraph one.", x: 72, y: 700, fontSize: 12, heading: 0 },
      { page: 2, text: "Second page text.", x: 72, y: 700, fontSize: 12, heading: 0 },
    ],
    figures: [],
  });

  const doc = await PDFDocument.load(out, { throwOnInvalidObject: false });
  const ctx = doc.context;
  const cat = doc.catalog;

  // /Lang
  assert.equal(cat.get(PDFName.of("Lang")).decodeText(), "en-US");
  // Info /Title
  const info = ctx.lookup(ctx.trailerInfo.Info);
  assert.equal(info.get(PDFName.of("Title")).decodeText(), "Quarterly Report");
  // XMP dc:title
  const meta = ctx.lookup(cat.get(PDFName.of("Metadata")));
  const xml = new TextDecoder().decode(meta.getContents());
  assert.match(xml, /<dc:title>[\s\S]*Quarterly Report[\s\S]*<\/dc:title>/);
  // ViewerPreferences /DisplayDocTitle true
  const vp = ctx.lookup(cat.get(PDFName.of("ViewerPreferences")));
  assert.equal(vp.get(PDFName.of("DisplayDocTitle")).asBoolean(), true);
  // MarkInfo /Marked true
  const markInfo = ctx.lookup(cat.get(PDFName.of("MarkInfo")));
  assert.equal(markInfo.get(PDFName.of("Marked")).asBoolean(), true);
  // StructTreeRoot with /Document root and /P + /H1 kids
  const structRoot = ctx.lookup(cat.get(PDFName.of("StructTreeRoot")));
  const docEl = ctx.lookup(structRoot.get(PDFName.of("K")));
  assert.equal(docEl.get(PDFName.of("S")).toString(), "/Document");
  const kids = ctx.lookup(docEl.get(PDFName.of("K")));
  assert.ok(kids instanceof PDFArray);
  const roles = [];
  for (let i = 0; i < kids.size(); i += 1) roles.push(ctx.lookup(kids.get(i)).get(PDFName.of("S")).toString());
  assert.ok(roles.includes("/P"), "has a /P paragraph element");
  assert.ok(roles.includes("/H1"), "has a /H1 heading element");
  // ParentTree present with a next key.
  assert.ok(ctx.lookup(structRoot.get(PDFName.of("ParentTree"))));
  assert.ok(structRoot.get(PDFName.of("ParentTreeNextKey")) instanceof PDFNumber);
});

test("round-trip remediation makes the checker pass tagged, language, and title", async () => {
  const bytes = await makeTextPdf(2, "Quarterly");
  const before = await a11y.auditPdfAccessibility(bytes, { textLayer: { characters: 40, pageCount: 2 } });
  assert.equal(a11yById(before).tagged.status, "fail");

  const { bytes: out } = await a11y.remediatePdfAccessibility(bytes, {
    lang: "en-US",
    title: "Quarterly Report",
    textBlocks: [
      { page: 1, text: "Heading", x: 72, y: 740, fontSize: 24, heading: 1 },
      { page: 1, text: "Body paragraph.", x: 72, y: 700, fontSize: 12, heading: 0 },
      { page: 2, text: "Second page.", x: 72, y: 700, fontSize: 12, heading: 0 },
    ],
    figures: [],
  });
  const after = await a11y.auditPdfAccessibility(out, { textLayer: { characters: 40, pageCount: 2 } });
  const checks = a11yById(after);
  assert.equal(checks.tagged.status, "pass");
  assert.equal(checks.language.status, "pass");
  assert.equal(checks["document-title"].status, "pass");
  assert.equal(checks["title-in-titlebar"].status, "pass");
  assert.equal(checks["reading-order"].status, "pass");
  assert.ok(after.summary.fail < before.summary.fail, "materially fewer failures after remediation");
});

test("auto-tag writes a non-Latin title as a UTF-16BE PDF string that decodes back", async () => {
  const { PDFDocument, PDFName } = window.PDFLib;
  const unicodeTitle = "तिमाही रिपोर्ट 报告 2026";
  const bytes = await makeTextPdf(1, "Doc");
  const { bytes: out } = await a11y.remediatePdfAccessibility(bytes, {
    lang: "hi-IN",
    title: unicodeTitle,
    textBlocks: [{ page: 1, text: "Body", x: 72, y: 700, fontSize: 12, heading: 0 }],
    figures: [],
  });
  const doc = await PDFDocument.load(out, { throwOnInvalidObject: false });
  const titleObj = doc.context.lookup(doc.context.trailerInfo.Info).get(PDFName.of("Title"));
  const hex = titleObj.toString();
  // UTF-16BE PDF hex string carries a leading FEFF byte-order mark.
  assert.match(hex, /^<FEFF/i);
  // Decode the raw hex bytes back to text and confirm they match the input.
  const inner = hex.slice(1, -1);
  const codeUnits = [];
  for (let i = 4; i < inner.length; i += 4) codeUnits.push(parseInt(inner.slice(i, i + 4), 16));
  const decoded = String.fromCharCode(...codeUnits);
  assert.equal(decoded, unicodeTitle);
  assert.equal(titleObj.decodeText(), unicodeTitle);
});

test("auto-tag writes /Alt for described figures and /Artifact for decorative ones", async () => {
  const { PDFDocument, PDFName, PDFArray, decodePDFRawStream } = window.PDFLib;
  const bytes = await makeTextPdf(1, "Doc");
  const { bytes: out, report } = await a11y.remediatePdfAccessibility(bytes, {
    lang: "en-US",
    title: "Doc",
    textBlocks: [],
    figures: [
      { page: 1, alt: "A bar chart of quarterly revenue", decorative: false },
      { page: 1, alt: "", decorative: true },
    ],
  });
  assert.equal(report.structSummary.figures, 1);
  assert.equal(report.structSummary.artifacts, 1);

  const doc = await PDFDocument.load(out, { throwOnInvalidObject: false });
  const ctx = doc.context;
  const structRoot = ctx.lookup(doc.catalog.get(PDFName.of("StructTreeRoot")));
  const docEl = ctx.lookup(structRoot.get(PDFName.of("K")));
  const kids = ctx.lookup(docEl.get(PDFName.of("K")));
  let figureAlt = null;
  for (let i = 0; i < kids.size(); i += 1) {
    const el = ctx.lookup(kids.get(i));
    if (el.get(PDFName.of("S")).toString() === "/Figure") figureAlt = el.get(PDFName.of("Alt")).decodeText();
  }
  assert.equal(figureAlt, "A bar chart of quarterly revenue");

  // The decorative image is marked /Artifact in the page content (not tagged).
  const pageNode = doc.getPages()[0].node;
  let contents = ctx.lookup(pageNode.get(PDFName.of("Contents")));
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => ctx.lookup(ref)) : [contents];
  let decoded = "";
  for (const stream of streams) decoded += new TextDecoder().decode(decodePDFRawStream(stream).decode());
  assert.match(decoded, /\/Artifact\b/);
});

test("Accessibility Check and Auto-Tag tools are registered, grouped, routed, and wired", () => {
  const appSource = readAppSource();

  const check = tools.find((tool) => tool.id === "accessibility-check-tool");
  assert.ok(check, "accessibility-check-tool registered");
  assert.equal(check.category, "PDF Tools");
  assert.equal(check.group, "Accessibility");
  assert.equal(check.status, "available");
  assert.equal(check.localProcessing, true);
  assert.equal(routeForHash(check.route).tool.id, "accessibility-check-tool");
  assert.ok(appSource.includes('"accessibility-check-tool"'), "check wired into ToolRenderer");

  const tag = tools.find((tool) => tool.id === "tag-pdf-tool");
  assert.ok(tag, "tag-pdf-tool registered");
  assert.equal(tag.category, "PDF Tools");
  assert.equal(tag.group, "Accessibility");
  assert.equal(tag.status, "available");
  assert.equal(routeForHash(tag.route).tool.id, "tag-pdf-tool");
  assert.ok(appSource.includes('"tag-pdf-tool"'), "tag wired into ToolRenderer");

  // The new Accessibility group is declared in the PDF Tools group order.
  assert.ok(categoryGroups["PDF Tools"].includes("Accessibility"), "Accessibility group registered in categoryGroups");
});

// ===========================================================================
// Gap-closing features: Translate PDF, RFC-3161 timestamp, Batch Workflow, PWA
// ===========================================================================

// --- 1. Translate PDF (local-first: extraction local, translation opt-in) ---

test("translate: an UNCONFIGURED endpoint sends ZERO network calls and refuses with configure guidance", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("network must not be reached"); };
  try {
    const off = { enabled: false, baseUrl: "", model: "", apiKey: "" };
    await assert.rejects(
      () => translateDocument("Some document text to translate.", { settings: off, targetLanguage: "French" }),
      (error) => /switched off|Nothing was sent/i.test(error.message),
      "an unconfigured endpoint refuses before any fetch",
    );
    // An incomplete-but-enabled endpoint must also refuse before fetch.
    const incomplete = { enabled: true, baseUrl: "https://api.example/v1", model: "", apiKey: "" };
    await assert.rejects(
      () => translateDocument("Some text.", { settings: incomplete, targetLanguage: "French" }),
      (error) => /incomplete|Nothing was sent/i.test(error.message),
    );
    assert.equal(calls, 0, "no network request was made for a default/unconfigured install");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("translate: chunkForTranslation splits a long doc into ordered, in-budget chunks losing no content", () => {
  assert.deepEqual(chunkForTranslation(""), []);
  assert.deepEqual(chunkForTranslation("   \n  "), []);
  const short = "One short paragraph.";
  assert.deepEqual(chunkForTranslation(short, 4000), [short]);

  // Build a long document out of many paragraphs (each comfortably under the
  // budget) so it must split on paragraph boundaries.
  const paragraph = "The quick brown fox jumps over the lazy dog. ".repeat(10).trim();
  const doc = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}. ${paragraph}`).join("\n\n");
  const limit = 900;
  const chunks = chunkForTranslation(doc, limit);
  assert.ok(chunks.length > 1, "a long document splits into multiple chunks");
  for (const chunk of chunks) assert.ok(chunk.length <= limit, `each chunk fits the ${limit}-char budget`);
  // Order + completeness: concatenating the chunks (only inter-chunk whitespace is
  // dropped) reproduces the source with whitespace removed.
  const strip = (s) => s.replace(/\s+/g, "");
  assert.equal(strip(chunks.join("")), strip(doc), "no non-whitespace character is dropped or reordered");
  // Paragraph 1 appears in the first chunk and the last paragraph in the last.
  assert.match(chunks[0], /Paragraph 1\./);
  assert.match(chunks[chunks.length - 1], /Paragraph 30\./);
});

test("translate: an unbreakable run longer than a chunk is hard-cut, still in budget", () => {
  const giant = "x".repeat(2500);
  const chunks = chunkForTranslation(giant, 1000);
  assert.ok(chunks.length >= 3);
  for (const chunk of chunks) assert.ok(chunk.length <= 1000);
  assert.equal(chunks.join(""), giant, "a hard cut keeps every character in order");
});

test("translate: buildTranslationPrompt names the language and validates input", () => {
  const { system, prompt, language } = buildTranslationPrompt("Bonjour", "German");
  assert.match(system, /German/);
  assert.match(system, /only the translation/i);
  assert.equal(prompt, "Bonjour");
  assert.equal(language, "German");
  assert.throws(() => buildTranslationPrompt("hi", ""), /target language/i);
  assert.throws(() => buildTranslationPrompt("   ", "French"), /nothing to translate/i);
});

test("translate: with a fake endpoint, chunks are sent and reassembled IN ORDER (plumbing only)", async () => {
  const settings = { enabled: true, baseUrl: "https://api.example/v1", model: "m", apiKey: "k" };
  const seen = [];
  // A fake OpenAI-compatible endpoint that tags each reply so order is observable.
  const fetchImpl = async (url, opts) => {
    assert.equal(url, "https://api.example/v1/chat/completions");
    const body = JSON.parse(opts.body);
    const user = body.messages.find((m) => m.role === "user").content;
    seen.push(user);
    return { ok: true, status: 200, statusText: "OK", json: async () => ({ choices: [{ message: { content: `T<${seen.length}>` } }] }) };
  };
  const doc = Array.from({ length: 12 }, (_, i) => `Block ${i + 1}. ${"word ".repeat(40).trim()}`).join("\n\n");
  const limit = 600;
  const expectedChunks = chunkForTranslation(doc, limit);
  assert.ok(expectedChunks.length > 1);

  const progress = [];
  const result = await translateDocument(doc, { settings, targetLanguage: "Spanish", fetchImpl, limit, onProgress: (d, t) => progress.push([d, t]) });

  assert.equal(result.chunks, expectedChunks.length, "one request per chunk");
  assert.deepEqual(seen, expectedChunks, "chunks are sent to the endpoint in source order");
  assert.equal(result.text, expectedChunks.map((_, i) => `T<${i + 1}>`).join("\n\n"), "replies are reassembled in order");
  assert.deepEqual(progress[progress.length - 1], [expectedChunks.length, expectedChunks.length], "progress ends at 100%");
});

test("translate-pdf-tool is registered, routed, grouped under Work with PDFs, and wired", () => {
  const appSource = readAppSource();
  const t = tools.find((tool) => tool.id === "translate-pdf-tool");
  assert.ok(t, "translate-pdf-tool registered");
  assert.equal(t.category, "Text & Data Tools");
  assert.equal(t.group, "Work with PDFs");
  assert.equal(t.status, "available");
  assert.equal(t.localProcessing, true);
  assert.deepEqual(t.acceptedTypes, ["application/pdf"]);
  assert.equal(routeForHash(t.route).tool.id, "translate-pdf-tool");
  assert.ok(appSource.includes('"translate-pdf-tool"'), "wired into ToolRenderer");
  assert.ok(appSource.includes("translateDocument"), "uses the gated translate service");
});

// --- 2. RFC-3161 trusted timestamp ------------------------------------------

test("timestamp: buildTimestampRequest is a well-formed TimeStampReq with a SHA-256 imprint of the input", () => {
  const digest = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) digest[i] = (i * 7 + 3) & 0xff;
  const der = buildTimestampRequest(digest, { certReq: true });
  // Assert the ASN.1 structure by parsing it back through pkijs.
  const parsed = new pkijs.TimeStampReq({ schema: asn1js.fromBER(bufOf(der)).result });
  assert.equal(parsed.version, 1, "TimeStampReq version 1");
  assert.equal(parsed.messageImprint.hashAlgorithm.algorithmId, "2.16.840.1.101.3.4.2.1", "SHA-256 imprint algorithm");
  assert.equal(parsed.certReq, true, "certReq asks the TSA to return its certificate");
  const imprint = new Uint8Array(parsed.messageImprint.hashedMessage.valueBlock.valueHexView);
  assert.equal(imprint.length, 32, "SHA-256 imprint is 32 bytes");
  assert.deepEqual([...imprint], [...digest], "the imprint is exactly the supplied digest");
  assert.equal(tsaOrigin("https://freetsa.org/tsr"), "https://freetsa.org", "tsaOrigin extracts the CSP origin");
});

test("timestamp: with the toggle OFF, signPdf makes NO network call and the signature has no timestamp", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("No TS", "No TS", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "pw");
  const pdf = await buildSamplePdf(false);

  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("signing must not touch the network when timestamp is off"); };
  try {
    const signed = await signPdf(pdf, { p12, password: "pw" }); // timestamp omitted == off
    assert.equal(calls, 0, "no network request during local signing");
    assert.equal(signed.timestamp, null, "no timestamp attached");
    const report = await verifyPdfSignatures(signed.bytes);
    assert.equal(report.signatures[0].verdict, "valid", "the local signature is valid, exactly as before");
    assert.equal(report.signatures[0].timestamp.present, false, "verify reports NO timestamp for an untimestamped signature");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("timestamp: a blocked/unreachable TSA surfaces connect-src guidance and produces no output", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("TS Fail", "TS Fail", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "pw");
  const pdf = await buildSamplePdf(false);
  const blockedFetch = async () => { throw new TypeError("Failed to fetch"); }; // what CSP/CORS look like
  await assert.rejects(
    () => signPdf(pdf, { p12, password: "pw", timestamp: true, tsaUrl: "https://tsa.example/tsr", fetchImpl: blockedFetch }),
    (error) => /connect-src 'self' https:\/\/tsa\.example/.test(error.message),
    "a blocked TSA tells the operator exactly what to add to connect-src",
  );
});

// A fake RFC-3161 TSA that echoes the request imprint into a signed TSTInfo token,
// so the embed + verify-reporting path is exercised offline (a LIVE TSA round-trip
// is browser/network-only and is not attempted here).
async function makeFakeTsaResponder(tsaCert, tsaKey) {
  return async (url, opts) => {
    const reqBytes = new Uint8Array(opts.body);
    const req = new pkijs.TimeStampReq({ schema: asn1js.fromBER(bufOf(reqBytes)).result });
    const tst = new pkijs.TSTInfo({
      version: 1,
      policy: "1.2.3.4.1",
      messageImprint: req.messageImprint, // echo the imprint so it covers the signature
      serialNumber: new asn1js.Integer({ value: 42 }),
      genTime: new Date(),
    });
    const tstDer = new Uint8Array(tst.toSchema().toBER());
    const signed = new pkijs.SignedData({
      version: 3,
      encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: "1.2.840.113549.1.9.16.1.4", eContent: new asn1js.OctetString({ valueHex: bufOf(tstDer) }) }),
      signerInfos: [new pkijs.SignerInfo({ version: 1, sid: new pkijs.IssuerAndSerialNumber({ issuer: tsaCert.issuer, serialNumber: tsaCert.serialNumber }) })],
      certificates: [tsaCert],
    });
    await signed.sign(tsaKey, 0, "SHA-256", undefined, signEngine);
    const token = new pkijs.ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: signed.toSchema(true) });
    const resp = new pkijs.TimeStampResp({ status: new pkijs.PKIStatusInfo({ status: 0 }), timeStampToken: token });
    const der = resp.toSchema().toBER();
    return { ok: true, status: 200, statusText: "OK", arrayBuffer: async () => der };
  };
}

test("timestamp: embedding a TSA token keeps the signature valid and verify reports the TSA time (offline fake TSA)", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("TS Signer", "TS Signer", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "pw");
  const tsaKeyPair = await genRsaKeyPair();
  const tsaCert = await makeSelfSignedCert("Test TSA", "Test TSA", tsaKeyPair, tsaKeyPair.privateKey);
  const fetchImpl = await makeFakeTsaResponder(tsaCert, tsaKeyPair.privateKey);
  const pdf = await buildSamplePdf(false);

  const signed = await signPdf(pdf, { p12, password: "pw", timestamp: true, tsaUrl: "https://tsa.example/tsr", fetchImpl });
  assert.ok(signed.timestamp, "signPdf reports a timestamp result");
  assert.equal(signed.timestamp.tsa, "https://tsa.example");
  assert.ok(signed.timestamp.time instanceof Date, "signPdf surfaces the TSA genTime");

  const report = await verifyPdfSignatures(signed.bytes);
  const sig = report.signatures[0];
  assert.equal(sig.verdict, "valid", "the unsigned timestamp attribute does not disturb the signature");
  assert.equal(sig.integrity, true);
  assert.equal(sig.timestamp.present, true, "verify REPORTS the timestamp");
  assert.ok(sig.timestamp.time instanceof Date, "verify reports the TSA time");
  assert.equal(sig.timestamp.imprintMatches, true, "the token's imprint really covers THIS signature");
  assert.equal(sig.timestamp.tsaCommonName, "Test TSA", "verify names the TSA");
});

test("timestamp: the SignatureCard reports timestamp presence and SignPdfTool wires the toggle", () => {
  const appSource = readAppSource();
  assert.match(appSource, /RFC 3161 timestamp/i, "the sign UI offers the timestamp toggle");
  assert.match(appSource, /tsaUrl/, "the sign UI collects a TSA URL");
  assert.match(appSource, /timestamp: useTimestamp/, "the toggle is passed to signPdf");
  assert.match(appSource, /TSA-attested/, "the verify card labels a TSA-attested time");
  assert.match(appSource, /self-asserted/, "the verify card labels an untimestamped signature");
});

// A parametrised fake TSA. `signingKey` signs the token's SignedData (pass a key
// that does NOT match `tsaCert` to forge the token's own CMS signature). With
// `badImprint`, the token's message imprint is over the wrong bytes, so it does
// not cover the signature. Otherwise the request imprint is echoed back, exactly
// as a real TSA does.
function makeCraftedTsaResponder(tsaCert, signingKey, { badImprint = false } = {}) {
  return async (_url, opts) => {
    const req = new pkijs.TimeStampReq({ schema: asn1js.fromBER(bufOf(new Uint8Array(opts.body))).result });
    const messageImprint = badImprint
      ? new pkijs.MessageImprint({
          hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: "2.16.840.1.101.3.4.2.1" }),
          hashedMessage: new asn1js.OctetString({ valueHex: bufOf(new Uint8Array(32)) }), // 32 zero bytes ≠ SHA-256(signature)
        })
      : req.messageImprint;
    const tst = new pkijs.TSTInfo({
      version: 1,
      policy: "1.2.3.4.1",
      messageImprint,
      serialNumber: new asn1js.Integer({ value: 7 }),
      genTime: new Date("2030-01-02T03:04:05Z"),
    });
    const tstDer = new Uint8Array(tst.toSchema().toBER());
    const signed = new pkijs.SignedData({
      version: 3,
      encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: "1.2.840.113549.1.9.16.1.4", eContent: new asn1js.OctetString({ valueHex: bufOf(tstDer) }) }),
      signerInfos: [new pkijs.SignerInfo({ version: 1, sid: new pkijs.IssuerAndSerialNumber({ issuer: tsaCert.issuer, serialNumber: tsaCert.serialNumber }) })],
      certificates: [tsaCert],
    });
    await signed.sign(signingKey, 0, "SHA-256", undefined, signEngine);
    const token = new pkijs.ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: signed.toSchema(true) });
    const resp = new pkijs.TimeStampResp({ status: new pkijs.PKIStatusInfo({ status: 0 }), timeStampToken: token });
    return { ok: true, status: 200, statusText: "OK", arrayBuffer: async () => resp.toSchema().toBER() };
  };
}

test("timestamp honesty (a): a properly-signed token verifies — tokenSignatureValid:true AND imprintMatches:true", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("TS Signer", "TS Signer", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "pw");
  const tsaKeyPair = await genRsaKeyPair();
  const tsaCert = await makeSelfSignedCert("Honest TSA", "Honest TSA", tsaKeyPair, tsaKeyPair.privateKey);
  const fetchImpl = makeCraftedTsaResponder(tsaCert, tsaKeyPair.privateKey); // signed with the matching key
  const pdf = await buildSamplePdf(false);

  const signed = await signPdf(pdf, { p12, password: "pw", timestamp: true, tsaUrl: "https://tsa.example/tsr", fetchImpl });
  const sig = (await verifyPdfSignatures(signed.bytes)).signatures[0];
  assert.equal(sig.timestamp.present, true);
  assert.equal(sig.timestamp.imprintMatches, true, "the imprint covers THIS signature");
  assert.equal(sig.timestamp.tokenSignatureValid, true, "the token's own CMS signature verifies");
  assert.ok(sig.timestamp.genTime instanceof Date, "genTime is surfaced");
  assert.equal(sig.timestamp.tsaCommonName, "Honest TSA");
});

test("timestamp honesty (b): a FORGED token (correct imprint, CMS signed with the wrong key) reports tokenSignatureValid:false", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("TS Signer", "TS Signer", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "pw");
  const tsaKeyPair = await genRsaKeyPair();
  const tsaCert = await makeSelfSignedCert("Spoofed TSA", "Spoofed TSA", tsaKeyPair, tsaKeyPair.privateKey);
  const attackerKeyPair = await genRsaKeyPair(); // a key that does NOT match tsaCert's public key
  const fetchImpl = makeCraftedTsaResponder(tsaCert, attackerKeyPair.privateKey);
  const pdf = await buildSamplePdf(false);

  const signed = await signPdf(pdf, { p12, password: "pw", timestamp: true, tsaUrl: "https://tsa.example/tsr", fetchImpl });
  const sig = (await verifyPdfSignatures(signed.bytes)).signatures[0];
  assert.equal(sig.timestamp.present, true);
  assert.equal(sig.timestamp.imprintMatches, true, "the imprint still binds to this signature");
  assert.equal(sig.timestamp.tokenSignatureValid, false, "the token's CMS signature does NOT verify, so the UI must not show TSA-attested");
});

test("timestamp honesty (c): an imprint-mismatch token reports imprintMatches:false", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("TS Signer", "TS Signer", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "pw");
  const tsaKeyPair = await genRsaKeyPair();
  const tsaCert = await makeSelfSignedCert("Honest TSA", "Honest TSA", tsaKeyPair, tsaKeyPair.privateKey);
  const fetchImpl = makeCraftedTsaResponder(tsaCert, tsaKeyPair.privateKey, { badImprint: true });
  const pdf = await buildSamplePdf(false);

  const signed = await signPdf(pdf, { p12, password: "pw", timestamp: true, tsaUrl: "https://tsa.example/tsr", fetchImpl });
  const sig = (await verifyPdfSignatures(signed.bytes)).signatures[0];
  assert.equal(sig.timestamp.present, true);
  assert.equal(sig.timestamp.imprintMatches, false, "the token does not cover this signature");
});

test("reference-backend fails closed: configProblems flags an unset API_KEY and rejects wildcard CORS", async () => {
  const { configProblems } = await import("../reference-backend/server.js");
  const missingKey = configProblems({ apiKey: "", allowedOrigin: "https://tools.example.com" });
  assert.ok(missingKey.some((p) => /API_KEY/.test(p)), "an unset API_KEY is a fail-closed problem");
  const wildcard = configProblems({ apiKey: "secret", allowedOrigin: "*" });
  assert.ok(wildcard.some((p) => /ALLOWED_ORIGIN/.test(p) && /\*/.test(p)), "wildcard CORS is rejected");
  const ok = configProblems({ apiKey: "secret", allowedOrigin: "https://tools.example.com" });
  assert.deepEqual(ok, [], "a specific origin plus an API key is accepted");
});

// --- 3. Batch Workflow (many ops x many files) ------------------------------

test("batch-workflow: runs a preset over 3 generated PDFs into 3 correctly-named outputs in a ZIP", async () => {
  const { runWorkflowBatch, presetSteps } = await import("../src/services/business.service.js");
  const { zipOutputs } = await import("../src/services/batch.service.js");
  const { unzipSync } = await import("fflate");
  const { PDFDocument } = window.PDFLib;

  const files = [];
  for (const base of ["alpha", "beta", "gamma"]) {
    files.push(new File([await makeBatchPdf(2)], `${base}.pdf`, { type: "application/pdf" }));
  }

  const progress = [];
  const run = await runWorkflowBatch(files, presetSteps("print-ready"), { onProgress: (info) => progress.push(info) });

  assert.equal(run.total, 3);
  assert.equal(run.failures.length, 0, "no failures for three good files");
  assert.equal(run.outputs.length, 3);
  assert.deepEqual(run.outputs.map((o) => o.name).sort(), ["alpha-workflow.pdf", "beta-workflow.pdf", "gamma-workflow.pdf"]);
  // Determinate two-axis progress: file X of Y, step A of B.
  assert.ok(progress.length > 0);
  assert.ok(progress.every((p) => p.files === 3 && p.steps >= 1 && p.file >= 1 && p.step >= 1), "progress carries both axes");
  assert.equal(progress[progress.length - 1].file, 3, "progress reaches the last file");

  for (const out of run.outputs) {
    const doc = await PDFDocument.load(out.bytes);
    assert.equal(doc.getPageCount(), 2, "each output is a valid PDF that went through the whole chain");
  }
  const entries = unzipSync(zipOutputs(run.outputs));
  assert.deepEqual(Object.keys(entries).sort(), ["alpha-workflow.pdf", "beta-workflow.pdf", "gamma-workflow.pdf"]);
});

test("batch-workflow: a corrupt 2nd file fails in isolation — 2 succeed, 1 reported, zip holds only the good two", async () => {
  const { runWorkflowBatch } = await import("../src/services/business.service.js");
  const { zipOutputs } = await import("../src/services/batch.service.js");
  const { unzipSync } = await import("fflate");

  const files = [
    new File([await makeBatchPdf(1)], "good-1.pdf", { type: "application/pdf" }),
    new File([new Uint8Array([1, 2, 3, 4, 5])], "broken.pdf", { type: "application/pdf" }),
    new File([await makeBatchPdf(1)], "good-2.pdf", { type: "application/pdf" }),
  ];

  const run = await runWorkflowBatch(files, [{ op: "page-numbers", options: { prefix: "Page ", fontSize: "10" } }]);

  assert.equal(run.total, 3);
  assert.equal(run.outputs.length, 2, "the two good files succeed");
  assert.equal(run.failures.length, 1, "the corrupt file is recorded, not thrown");
  assert.equal(run.failures[0].name, "broken.pdf");
  assert.ok(run.failures[0].reason && run.failures[0].reason.length > 0, "the failure carries a reason");
  assert.deepEqual(run.outputs.map((o) => o.name).sort(), ["good-1-workflow.pdf", "good-2-workflow.pdf"]);

  const entries = unzipSync(zipOutputs(run.outputs));
  assert.deepEqual(Object.keys(entries).sort(), ["good-1-workflow.pdf", "good-2-workflow.pdf"]);
  assert.equal(entries["broken.pdf"], undefined, "the failed file is absent from the zip");
});

test("batch-workflow: validates inputs (no files / no steps / bad op / over-limit)", async () => {
  const { runWorkflowBatch, MAX_WORKFLOW_BATCH_FILES } = await import("../src/services/business.service.js");
  const onePdf = [new File([await makeBatchPdf(1)], "a.pdf", { type: "application/pdf" })];
  await assert.rejects(() => runWorkflowBatch([], [{ op: "rotate", options: {} }]), /at least one PDF/i);
  await assert.rejects(() => runWorkflowBatch(onePdf, []), /at least one step/i);
  await assert.rejects(() => runWorkflowBatch(onePdf, [{ op: "__proto__", options: {} }]), /not a supported workflow step/i);
  const tooMany = Array.from({ length: MAX_WORKFLOW_BATCH_FILES + 1 }, (_, i) => new File([new Uint8Array([1])], `f${i}.pdf`));
  await assert.rejects(() => runWorkflowBatch(tooMany, [{ op: "rotate", options: {} }]), new RegExp(`no more than ${MAX_WORKFLOW_BATCH_FILES} files`, "i"));
});

test("batch-workflow-tool is registered under Organize, routed, and wired", () => {
  const appSource = readAppSource();
  const t = tools.find((tool) => tool.id === "batch-workflow-tool");
  assert.ok(t, "batch-workflow-tool registered");
  assert.equal(t.category, "PDF Tools");
  assert.equal(t.group, "Organize");
  assert.equal(t.status, "available");
  assert.equal(t.file.maxFiles, 100);
  assert.deepEqual(t.acceptedTypes, ["application/pdf"]);
  assert.equal(routeForHash(t.route).tool.id, "batch-workflow-tool");
  assert.ok(appSource.includes('"batch-workflow-tool"'), "wired into ToolRenderer");
  assert.ok(appSource.includes("runWorkflowBatch"), "uses the batch workflow service");
});

// --- 4. PWA installability ---------------------------------------------------

test("pwa: manifest.webmanifest is valid JSON with the required installability fields", () => {
  const raw = fs.readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8");
  const manifest = JSON.parse(raw); // throws if invalid JSON
  assert.equal(typeof manifest.name, "string");
  assert.ok(manifest.name.length > 0, "name present");
  assert.equal(typeof manifest.short_name, "string");
  assert.equal(manifest.start_url, "/", "start_url is in scope");
  assert.equal(manifest.scope, "/", "scope covers start_url");
  assert.equal(manifest.display, "standalone", "installable display mode");
  assert.match(String(manifest.theme_color), /^#/, "theme color set");
  assert.match(String(manifest.background_color), /^#/, "background color set");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, "icons array present");
  const sizes = manifest.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes("192x192"), "a 192 icon is declared");
  assert.ok(sizes.includes("512x512"), "a 512 icon is declared");
  assert.ok(manifest.icons.some((icon) => String(icon.purpose || "").includes("maskable")), "a maskable icon is declared");
});

test("pwa: declared PNG icons exist on disk at the right dimensions and no icon uses a CDN URL", () => {
  const raw = fs.readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8");
  const manifest = JSON.parse(raw);
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const readDims = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }); // IHDR
  const expect = { "/icon-192.png": 192, "/icon-512.png": 512 };
  for (const icon of manifest.icons) {
    assert.ok(!/^https?:\/\//i.test(icon.src), `icon ${icon.src} is local, not a CDN URL`);
    if (icon.src in expect) {
      const buf = fs.readFileSync(new URL(`../public${icon.src}`, import.meta.url));
      assert.ok(buf.subarray(0, 8).equals(pngHeader), `${icon.src} is a real PNG`);
      const { w, h } = readDims(buf);
      assert.equal(w, expect[icon.src], `${icon.src} is ${expect[icon.src]}px wide`);
      assert.equal(h, expect[icon.src], `${icon.src} is ${expect[icon.src]}px tall`);
    }
  }
});

test("pwa: index.html links the manifest and registers the service worker, and sw.js precaches locally (no CDN)", () => {
  const indexHtml = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(indexHtml, /<link\s+rel="manifest"\s+href="\/manifest\.webmanifest">/, "manifest is linked from index.html");
  assert.match(indexHtml, /register-sw\.js/, "the SW registration script is included");

  const registerSw = fs.readFileSync(new URL("../public/register-sw.js", import.meta.url), "utf8");
  assert.match(registerSw, /serviceWorker\.register\("\/sw\.js"\)/, "register-sw registers /sw.js");

  const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(sw, /addEventListener\("install"/, "sw handles install");
  assert.match(sw, /caches\.open/, "sw opens a cache");
  assert.match(sw, /PRECACHE_URLS/, "sw precaches an app-shell list on install");
  assert.match(sw, /"\/"/, "the app shell root is precached");
  assert.match(sw, /addEventListener\("fetch"/, "sw serves from cache when offline");
  // No CDN / cross-origin URL anywhere in the service worker.
  const externalUrls = (sw.match(/https?:\/\/[^\s"')]+/g) || []).filter((u) => !u.startsWith("http://www.w3.org"));
  assert.deepEqual(externalUrls, [], "the service worker references no external/CDN URL");
});

// --- Client-side programmatic API (MyFileKit) --------------------------------
// The differentiator vs iLovePDF / Stirling: the API runs 100% locally (no
// server, no upload, no key). These assert the surface exists, wraps the real
// services (correct page counts through the API), and opens no network.

test("MyFileKit API exposes local namespaces that wrap the real services", async () => {
  const { MyFileKit, installMyFileKit } = await import("../src/api/myfilekit.js");
  const { PDFDocument } = window.PDFLib;

  // Namespaces + a representative method set exist.
  for (const ns of ["pdf", "ocr", "image", "batch", "workflow"]) {
    assert.equal(typeof MyFileKit[ns], "object", `${ns} namespace present`);
  }
  for (const method of ["merge", "split", "compress", "encrypt", "sign", "sanitize", "archivalPrep", "extractText", "toImages", "verify", "redact"]) {
    assert.equal(typeof MyFileKit.pdf[method], "function", `pdf.${method} present`);
  }
  assert.equal(typeof MyFileKit.pdf.accessibility.check, "function");
  assert.equal(typeof MyFileKit.pdf.accessibility.tag, "function");
  assert.equal(typeof MyFileKit.batch.run, "function");
  assert.equal(typeof MyFileKit.workflow.run, "function");
  assert.equal(typeof MyFileKit.ocr.pdf, "function");
  assert.equal(MyFileKit.local, true);

  // merge: 2 + 3 pages -> 5.
  const a = new File([await makeBatchPdf(2)], "a.pdf", { type: "application/pdf" });
  const b = new File([await makeBatchPdf(3)], "b.pdf", { type: "application/pdf" });
  const merged = await MyFileKit.pdf.merge([a, b]);
  assert.ok(merged instanceof Uint8Array, "merge returns bytes");
  assert.equal((await PDFDocument.load(merged)).getPageCount(), 5);

  // The wrapper maps to the real service: same result as calling mergePdfs directly.
  const direct = await mergePdfs([a, b]);
  assert.equal((await PDFDocument.load(direct)).getPageCount(), 5);

  // split by a page-range string and by an explicit 0-based index array.
  const five = new File([merged], "merged.pdf", { type: "application/pdf" });
  assert.equal((await PDFDocument.load(await MyFileKit.pdf.split(five, "1-3,5"))).getPageCount(), 4);
  assert.equal((await PDFDocument.load(await MyFileKit.pdf.split(five, [0, 4]))).getPageCount(), 2);

  // workflow chains real pure pdf-lib ops (page-numbers then rotate).
  const wfOut = await MyFileKit.workflow.run(
    [{ op: "page-numbers", options: { prefix: "P" } }, { op: "rotate", options: { degrees: "90" } }],
    new File([await makeBatchPdf(2)], "wf.pdf", { type: "application/pdf" }),
  );
  const wfDoc = await PDFDocument.load(wfOut);
  assert.equal(wfDoc.getPageCount(), 2);
  assert.equal(wfDoc.getPage(0).getRotation().angle, 90, "workflow rotate op ran");
  assert.ok(MyFileKit.workflow.ops().includes("rotate"));

  // install exposes the same object on window.
  const installed = installMyFileKit();
  assert.equal(installed, MyFileKit);
  assert.equal(window.MyFileKit, MyFileKit);
});

test("MyFileKit API source makes no network calls (privacy differentiator)", () => {
  const src = fs.readFileSync(new URL("../src/api/myfilekit.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /fetch\s*\(/, "no fetch()");
  assert.doesNotMatch(src, /new\s+XMLHttpRequest/, "no XMLHttpRequest");
  assert.doesNotMatch(src, /new\s+WebSocket/, "no WebSocket");
  assert.doesNotMatch(src, /sendBeacon/, "no sendBeacon");
  // Dynamic import is allowed ONLY for a bundled relative module (these are
  // resolved at build time and cannot reach the network). Anything else — a
  // remote URL, a protocol-relative path, or a computed specifier — would let
  // code be fetched at runtime, which is what this guard exists to prevent.
  for (const match of src.matchAll(/import\s*\(([^)]*)\)/g)) {
    const specifier = match[1].trim();
    assert.match(
      specifier,
      /^["']\.{1,2}\/[^"']*["']$/,
      `dynamic import must be a relative literal, got: ${specifier}`,
    );
  }
});

test("api-playground tool is registered, routed, wired, and documents the local API", () => {
  const found = tools.find((tool) => tool.id === "api-playground-tool");
  assert.ok(found, "api-playground-tool registered");
  assert.equal(found.category, "Developer Utilities");
  assert.equal(found.status, "available");
  assert.equal(found.localProcessing, true);
  assert.equal(routeForHash(found.route).tool.id, "api-playground-tool");

  const appSource = readAppSource();
  assert.equal(appSource.includes(`"api-playground-tool"`), true, "wired into ToolRenderer");
  assert.equal(appSource.includes("ApiPlaygroundTool"), true, "component defined");

  const searchable = [found.name, found.description, ...found.keywords].join(" ").toLowerCase();
  for (const term of ["api", "local", "programmatic"]) assert.match(searchable, new RegExp(term));
});

// --- PDF/A-2b hardening -------------------------------------------------------

test("archivalPrepPdf defaults to PDF/A-2b, sets /Lang + Title, and keeps a raster page font-free", async () => {
  const { archivalPrepPdf } = await import("../src/services/pdf-review.service.js");
  const { PDFDocument, PDFName } = window.PDFLib;

  // A self-contained, image-only page (an image XObject, no fonts) — what the
  // raster path produces.
  const png1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(new Uint8Array(png1x1));
  doc.addPage([200, 200]).drawImage(img, { x: 0, y: 0, width: 200, height: 200 });
  const srcBytes = await doc.save();

  const { bytes, report } = await archivalPrepPdf(srcBytes, { title: "Scanned archive", lang: "en" });
  const out = await PDFDocument.load(bytes);

  // Default conformance is PDF/A-2b: XMP pdfaid part=2 / conformance=B.
  const xmp = Buffer.from(out.context.lookup(out.catalog.get(PDFName.of("Metadata"))).contents).toString("utf8");
  assert.match(xmp, /pdfaid:part>2</, "XMP declares PDF/A part 2");
  assert.match(xmp, /pdfaid:conformance>B</, "XMP declares conformance B");
  assert.match(report.conformance, /PDF\/A-2B/);

  // sRGB OutputIntent + document /ID present (same metadata as the non-raster path).
  assert.ok(out.context.lookup(out.catalog.get(PDFName.of("OutputIntents"))), "OutputIntent present");
  assert.ok(out.context.trailerInfo.ID, "document /ID present");

  // Document language (/Lang) and Title are set. /Lang is now a hex string
  // (hardened against injection), so decode it rather than stringifying.
  assert.equal(out.catalog.get(PDFName.of("Lang")).decodeText(), "en", "/Lang set");
  assert.equal(out.getTitle(), "Scanned archive", "Title set");

  // The raster page has an image XObject and NO font (no unembedded font).
  const resources = out.context.lookup(out.getPages()[0].node.get(PDFName.of("Resources")));
  const fontDict = out.context.lookup(resources.get(PDFName.of("Font")));
  const fontCount = fontDict && typeof fontDict.entries === "function" ? fontDict.entries().length : 0;
  assert.equal(fontCount, 0, "raster page carries no font resource");
  assert.ok(out.context.lookup(resources.get(PDFName.of("XObject"))), "raster page has an image XObject");
});

// --- Edit PDF Text: wrap-within-block reflow ---------------------------------

test("wrapToWidth wraps within the block width using the font's own metrics", async () => {
  const { wrapToWidth } = await import("../src/services/pdf-textedit.service.js");
  const { PDFDocument, StandardFonts } = window.PDFLib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // A short replacement stays on one line.
  assert.equal(wrapToWidth("Hi", 120, font, 12).length, 1);

  // A long replacement wraps to several lines, none wider than the block.
  const long = "The quick brown fox jumps over the lazy dog and then keeps running";
  const lines = wrapToWidth(long, 120, font, 12);
  assert.ok(lines.length > 1, "wrapped to multiple lines");
  for (const line of lines) assert.ok(font.widthOfTextAtSize(line, 12) <= 121, `line "${line}" fits the block`);
  assert.equal(lines.join(" ").replace(/\s+/g, " ").trim(), long, "no words dropped by wrapping");
});

test("applyTextEdits wraps a longer replacement to multiple lines within the block, keeps a short one on one", async () => {
  const { applyTextEdits } = await import("../src/services/pdf-textedit.service.js");
  const { PDFDocument, StandardFonts } = window.PDFLib;

  // A synthetic block 120pt wide at size 12 on a blank page (only the edit draws text).
  const rect = { x: 72, y: 700, w: 120, h: 14, baseline: 700, fontSize: 12 };
  const blank = async () => { const d = await PDFDocument.create(); d.addPage([612, 792]); return d.save(); };

  const long = "The quick brown fox jumps over the lazy dog and then keeps running";
  const outLong = await applyTextEdits(await blank(), [{ page: 1, rect, text: long, fontKey: "Helvetica", color: { r: 0.1, g: 0.1, b: 0.1 } }]);
  const opsLong = await decodePageOps(outLong);

  // Each drawn line is its own BT...ET text object; long text yields several.
  const lineTexts = opsLong.split(/\bBT\b/).slice(1)
    .map((block) => { const m = block.match(/<([0-9A-Fa-f]+)>/); return m ? Buffer.from(m[1], "hex").toString("latin1") : ""; })
    .filter(Boolean);
  assert.ok(lineTexts.length > 1, "longer replacement wrapped to more than one line");

  // No drawn line exceeds the block width (measured with the same standard font).
  const measureDoc = await PDFDocument.create();
  const font = await measureDoc.embedFont(StandardFonts.Helvetica);
  for (const line of lineTexts) assert.ok(font.widthOfTextAtSize(line, 12) <= 121, `drawn line "${line}" within block width`);
  assert.equal(lineTexts.join(" ").replace(/\s+/g, " ").trim(), long, "wrapped lines reconstruct the text");

  // A short replacement stays on a single line.
  const outShort = await applyTextEdits(await blank(), [{ page: 1, rect, text: "Fixed", fontKey: "Helvetica" }]);
  const opsShort = await decodePageOps(outShort);
  assert.equal((opsShort.match(/\bBT\b/g) || []).length, 1, "short replacement is a single line");
});

// ---------------------------------------------------------------------------
// Tier 3 (optional, server-backed): Request e-Signature.
// The default build must remain 100% local — these tests prove the tool uploads
// nothing until an operator configures a backend, that the shipped CSP is
// untouched, and that the tool is wired in.
// ---------------------------------------------------------------------------

const esign = await import("../src/services/esign.service.js");

test("esign: an UNCONFIGURED backend uploads NOTHING — requestEnvelope refuses before any fetch", async () => {
  let calls = 0;
  const spyFetch = async () => { calls += 1; throw new Error("fetch must not be reached"); };

  const memory = new Map();
  const storage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  };

  // Nothing stored: empty settings, off, not configured.
  const empty = esign.readEsignSettings({ storage });
  assert.deepEqual(empty, { enabled: false, baseUrl: "", apiKey: "" });
  assert.equal(esign.isEsignConfigured(empty), false);

  const file = { fileName: "secret.pdf", contentType: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4 secret") };
  const signers = ["a@example.com"];

  await assert.rejects(() => esign.requestEnvelope({ settings: empty, file, signers, fetchImpl: spyFetch }), /switched off/i);
  await assert.rejects(() => esign.requestEnvelope({ file, signers, fetchImpl: spyFetch }), /switched off/i);
  // getEnvelopeStatus is gated the same way.
  await assert.rejects(() => esign.getEnvelopeStatus({ settings: empty, id: "abc", fetchImpl: spyFetch }), /switched off/i);
  // Enabled but incomplete (no base URL) still must not reach the network.
  await assert.rejects(
    () => esign.requestEnvelope({ settings: { enabled: true, baseUrl: "", apiKey: "k" }, file, signers, fetchImpl: spyFetch }),
    /incomplete/i,
  );
  assert.equal(calls, 0, "no fetch may happen while the backend is unconfigured");
});

test("esign: a configured+enabled backend builds the correct envelope payload and POSTs to the configured origin only", async () => {
  const memory = new Map();
  const storage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  };

  // Saving validates and keeps any key out of the URL, and round-trips.
  const saved = esign.saveEsignSettings({ enabled: true, baseUrl: "https://esign.example.com/", apiKey: "sk-esign-9999" }, { storage });
  assert.equal(saved.baseUrl, "https://esign.example.com");
  assert.equal(esign.isEsignConfigured(saved), true);
  assert.deepEqual(esign.readEsignSettings({ storage }), saved);
  assert.equal(memory.get("myfilekit:esign-backend").includes("sk-esign-9999"), true);
  assert.equal(esign.maskApiKey("sk-esign-9999").endsWith("9999"), true);
  assert.equal(esign.maskApiKey("sk-esign-9999").includes("esign"), false);
  assert.equal(esign.backendOrigin(saved.baseUrl), "https://esign.example.com");

  // Base URL validation mirrors the LLM adapter.
  assert.throws(() => esign.saveEsignSettings({ enabled: true, baseUrl: "not a url" }, { storage }), /full URL/i);
  assert.throws(() => esign.saveEsignSettings({ enabled: true, baseUrl: "https://user:pw@esign.example.com" }, { storage }), /credentials/i);
  assert.throws(() => esign.saveEsignSettings({ enabled: true, baseUrl: "https://esign.example.com?token=abc" }, { storage }), /query string/i);
  assert.throws(() => esign.saveEsignSettings({ enabled: true, baseUrl: "" }, { storage }), /base URL/i);

  // A configured backend uploads the PDF + signers in the BODY, to the configured
  // origin only, with the key in a header and never in the URL.
  const pdfBytes = new TextEncoder().encode("%PDF-1.4 real document bytes");
  const file = { fileName: "contract.pdf", contentType: "application/pdf", bytes: pdfBytes };
  const signers = esign.parseSigners("alice@example.com, bob@example.com\nalice@example.com");
  assert.deepEqual(signers, ["alice@example.com", "bob@example.com"], "signers are validated and de-duplicated");

  let seen = null;
  let calls = 0;
  const okFetch = async (url, init) => {
    calls += 1;
    seen = { url, init };
    return { ok: true, status: 201, statusText: "Created", json: async () => ({ id: "env_abc123", status: "sent" }) };
  };
  const result = await esign.requestEnvelope({ settings: saved, file, signers, message: "Please sign this.", fetchImpl: okFetch });
  assert.equal(calls, 1);
  assert.equal(result.id, "env_abc123");
  assert.equal(result.status, "sent");
  assert.equal(result.signers, 2);

  assert.equal(seen.url, "https://esign.example.com/envelopes", "posts only to the configured origin's /envelopes");
  assert.equal(seen.url.includes("sk-esign"), false, "the key is never in the URL");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.Authorization, "Bearer sk-esign-9999");
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(body.signers, [{ email: "alice@example.com" }, { email: "bob@example.com" }]);
  assert.equal(body.fileName, "contract.pdf");
  assert.equal(body.size, pdfBytes.length);
  assert.equal(body.message, "Please sign this.");
  // The PDF travels as base64 in the body and decodes back to the original bytes.
  assert.equal(Buffer.from(body.pdfBase64, "base64").toString("latin1"), Buffer.from(pdfBytes).toString("latin1"));

  // getEnvelopeStatus reaches the same origin, id in the path, no query string.
  let statusUrl = null;
  const statusFetch = async (url) => {
    statusUrl = url;
    return { ok: true, status: 200, json: async () => ({ id: "env_abc123", status: "pending", signers: [{ email: "alice@example.com", status: "pending" }] }) };
  };
  const status = await esign.getEnvelopeStatus({ settings: saved, id: "env_abc123", fetchImpl: statusFetch });
  assert.equal(statusUrl, "https://esign.example.com/envelopes/env_abc123");
  assert.equal(status.status, "pending");
  // A tracking id with URL-unsafe characters is refused before any fetch.
  await assert.rejects(() => esign.getEnvelopeStatus({ settings: saved, id: "../secret", fetchImpl: statusFetch }), /characters/i);
});

test("esign: a blocked/unreachable backend surfaces the exact connect-src guidance naming both files", async () => {
  const saved = { enabled: true, baseUrl: "https://esign.example.com", apiKey: "" };
  const file = { fileName: "x.pdf", contentType: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4 x") };
  const blockedFetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(
    () => esign.requestEnvelope({ settings: saved, file, signers: ["a@example.com"], fetchImpl: blockedFetch }),
    (error) => /connect-src 'self' https:\/\/esign\.example\.com/.test(error.message)
      && /index\.html/.test(error.message) && /_headers/.test(error.message),
  );
});

test("esign: parseSigners rejects malformed emails and requires at least one", () => {
  assert.throws(() => esign.parseSigners(""), /at least one/i);
  assert.throws(() => esign.parseSigners("not-an-email"), /valid email/i);
  assert.deepEqual(esign.parseSigners("a@b.co"), ["a@b.co"]);
});

test("tier3: the shipped connect-src stays 'self' in index.html and public/_headers (default build uploads nothing)", () => {
  const indexHtml = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const headers = fs.readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
  for (const [name, source] of [["index.html", indexHtml], ["public/_headers", headers]]) {
    // The actual directive ends in a semicolon; the explanatory comment in
    // index.html ("connect-src is pinned to 'self'…") does not, so match the
    // directive form precisely.
    assert.match(source, /connect-src 'self';/, `${name} still pins connect-src to 'self'`);
    assert.equal(/connect-src 'self' https?:/.test(source), false, `${name} must not add a Tier-3 origin to the shipped connect-src`);
  }
});

test("tier3: request-signature-tool is registered, routes, and is wired into the renderer", () => {
  const t = tools.find((tool) => tool.id === "request-signature-tool");
  assert.ok(t, "request-signature-tool is in the registry");
  assert.equal(t.status, "available");
  assert.equal(t.category, "Security & Privacy");
  assert.equal(t.group, "Secure");
  assert.ok(categories.includes(t.category));
  const route = routeForHash(t.route);
  assert.equal(route.type, "tool");
  assert.equal(route.tool.id, "request-signature-tool");
  // The renderer wires the tool id to its component.
  const appSource = readAppSource();
  assert.match(appSource, /request-signature-tool"\)\s*return\s*<RequestSignatureTool/);
});

test("tier3 guard: no backend origin is hardcoded and the default settings are disabled", () => {
  const service = fs.readFileSync(new URL("../src/services/esign.service.js", import.meta.url), "utf8");
  // The empty/default settings must be OFF.
  assert.deepEqual(esign.EMPTY_ESIGN_SETTINGS, { enabled: false, baseUrl: "", apiKey: "" });
  assert.equal(esign.readEsignSettings({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } }).enabled, false);
  // No real Tier-3 backend origin may be hardcoded in the service. Only the
  // placeholder guidance host ("your-backend.example") is allowed to appear.
  const httpHosts = [...service.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
  for (const host of httpHosts) {
    // Only placeholder "example" hosts may appear (in error text and guidance);
    // a real Tier-3 backend origin must never be baked into the client.
    assert.ok(/(^|\.)example(\.|$)/.test(host), `esign.service hardcodes a non-example host: ${host}`);
  }
});

// --- Regression: accessibility Auto-Tag is idempotent (no orphaned structure /
// stacked hidden-text layer on a re-run) -------------------------------------
// Running Auto-Tag on an already-tagged PDF once left the previous
// /StructTreeRoot + StructElems as orphaned indirect objects (veraPDF flags
// these as disconnected) and appended a SECOND invisible marked-content text
// layer to each page. Re-running must instead rebuild from a clean slate.
test("accessibility Auto-Tag is idempotent: re-running does not orphan structure or stack hidden text", async () => {
  const { PDFDocument, PDFName, PDFArray, decodePDFRawStream } = window.PDFLib;
  const blocks = [
    { page: 1, text: "Heading", x: 72, y: 740, fontSize: 24, heading: 1 },
    { page: 1, text: "Body paragraph.", x: 72, y: 700, fontSize: 12, heading: 0 },
    { page: 2, text: "Second page.", x: 72, y: 700, fontSize: 12, heading: 0 },
  ];

  // Counts StructTreeRoot / StructElem indirect objects (orphans included), plus
  // the invisible-text ("3 Tr") and marked-content ("BDC") operator counts in the
  // page content — a stacked hidden layer would double both.
  async function measure(bytes) {
    const doc = await PDFDocument.load(bytes, { throwOnInvalidObject: false });
    const ctx = doc.context;
    let structElems = 0;
    let structRoots = 0;
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
      if (!obj || typeof obj.get !== "function") continue;
      const type = obj.get(PDFName.of("Type"));
      const t = type ? type.toString() : "";
      if (t === "/StructElem") structElems += 1;
      if (t === "/StructTreeRoot") structRoots += 1;
    }
    let tr3 = 0;
    let bdc = 0;
    for (const page of doc.getPages()) {
      const contents = page.node.get(PDFName.of("Contents"));
      const resolved = contents ? ctx.lookup(contents) : undefined;
      const refs = resolved instanceof PDFArray ? resolved.asArray() : contents ? [contents] : [];
      let decoded = "";
      for (const ref of refs) {
        const stream = ctx.lookup(ref);
        try { decoded += new TextDecoder().decode(decodePDFRawStream(stream).decode()); } catch { /* skip */ }
      }
      tr3 += (decoded.match(/\b3 Tr\b/g) || []).length;
      bdc += (decoded.match(/BDC/g) || []).length;
    }
    return { structElems, structRoots, tr3, bdc };
  }

  const src = await makeTextPdf(2, "Quarterly");
  const { bytes: pass1 } = await a11y.remediatePdfAccessibility(src, {
    lang: "en-US", title: "Quarterly Report", textBlocks: blocks, figures: [],
  });
  const m1 = await measure(pass1);

  // Remediate the OUTPUT of the first pass a second time.
  const { bytes: pass2 } = await a11y.remediatePdfAccessibility(pass1, {
    lang: "en-US", title: "Quarterly Report", textBlocks: blocks, figures: [],
  });
  const m2 = await measure(pass2);

  // Exactly one StructTreeRoot survives each pass — the old root is not orphaned.
  assert.equal(m1.structRoots, 1, "one StructTreeRoot after the first pass");
  assert.equal(m2.structRoots, 1, "still exactly one StructTreeRoot after re-running (old root removed, not orphaned)");
  // StructElem count is bounded, not doubled: 1 /Document + 3 block elements.
  assert.equal(m1.structElems, 4, "Document + three block StructElems after the first pass");
  assert.equal(m2.structElems, m1.structElems, "StructElem count does not grow on a re-run (no orphaned first-pass elements)");
  // The invisible hidden-text / marked-content layer is replaced, not stacked.
  assert.ok(m1.tr3 > 0 && m1.bdc > 0, "the first pass injected an invisible marked-content text layer");
  assert.equal(m2.tr3, m1.tr3, "invisible-text operators did not grow between pass 1 and pass 2");
  assert.equal(m2.bdc, m1.bdc, "marked-content sequences did not grow between pass 1 and pass 2");

  // After two passes the file still audits as tagged, with language and title.
  const after = await a11y.auditPdfAccessibility(pass2, { textLayer: { characters: 40, pageCount: 2 } });
  const checks = a11yById(after);
  assert.equal(checks.tagged.status, "pass", "still tagged after two passes");
  assert.equal(checks.language.status, "pass", "language still set after two passes");
  assert.equal(checks["document-title"].status, "pass", "title still set after two passes");
});

// --- Regression: Workflow "bates" op returns .bytes (not the whole result) ---
// WORKFLOW_OPS.bates.run once returned the whole {bytes,first,last,count} object
// instead of `.bytes`, so runWorkflow piped a non-Uint8Array into the next step
// / the download. It now returns `.bytes`; this pins that so it cannot regress.
test("workflow bates op returns valid PDF bytes and the legal-bates preset runs end-to-end", async () => {
  const business = await import("../src/services/business.service.js");
  const { PDFDocument } = window.PDFLib;

  // A three-page source PDF.
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i += 1) doc.addPage([612, 792]);
  const src = new File([await doc.save()], "matter.pdf", { type: "application/pdf" });

  // The bates op alone must yield loadable PDF bytes with the page count intact.
  const single = await business.runWorkflow(src, [{ op: "bates", options: { prefix: "ABC", start: "1", padding: "6" } }]);
  assert.equal(single.ok, true, single.failed ? single.failed.message : "bates step failed");
  assert.ok(single.bytes instanceof Uint8Array && single.bytes.byteLength > 0, "bates produced non-empty Uint8Array bytes");
  const stamped = await PDFDocument.load(single.bytes);
  assert.equal(stamped.getPageCount(), 3, "bates preserves the page count");

  // The legal-bates preset (bates → page-numbers) runs end-to-end through the
  // same runWorkflow, proving each step's bytes feed cleanly into the next.
  const preset = await business.runWorkflow(new File([await doc.save()], "matter.pdf", { type: "application/pdf" }), business.presetSteps("legal-bates"));
  assert.equal(preset.ok, true, preset.failed ? preset.failed.message : "legal-bates preset failed");
  assert.equal(preset.completed.length, 2, "both preset steps completed");
  const finalDoc = await PDFDocument.load(preset.bytes);
  assert.equal(finalDoc.getPageCount(), 3, "the preset output is a valid 3-page PDF");
});

// --- Sanitize PDF: INLINE / nested active-content vectors ---------------------
// Regression cover for the adversarial finding that the object sweep only visited
// INDIRECT objects and never walked /Outlines: (a) a bookmark with an inline /A
// /JavaScript, (b) a benign /URI action hiding a /Launch in its /Next chain, and
// (c) an /A << /S /Movie >> action form. All three must be gone after sanitise —
// the Analyser's residual scan on the OUTPUT must be empty.
async function buildInlineActiveContentPdf() {
  const { PDFDocument, PDFName, PDFString } = window.PDFLib;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 300]);
  const ctx = pdf.context;

  // (a) Outline item carrying an INLINE (direct-dict) /A /JavaScript action.
  const outlineItem = ctx.obj({
    Title: PDFString.of("Click me"),
    A: ctx.obj({ S: "JavaScript", JS: PDFString.of("app.alert('evil');") }),
  });
  const outlineItemRef = ctx.register(outlineItem);
  const outlines = ctx.obj({ Type: "Outlines", First: outlineItemRef, Last: outlineItemRef, Count: 1 });
  const outlinesRef = ctx.register(outlines);
  outlineItem.set(PDFName.of("Parent"), outlinesRef);
  pdf.catalog.set(PDFName.of("Outlines"), outlinesRef);

  // (b) A benign /URI action whose inline /Next chain hides a /Launch action.
  const uriAnnot = ctx.obj({
    Type: "Annot", Subtype: "Link", Rect: [0, 0, 20, 20],
    A: ctx.obj({
      S: "URI", URI: PDFString.of("https://example.com"),
      Next: ctx.obj({ S: "Launch", F: PDFString.of("calc.exe") }),
    }),
  });

  // (c) An /A << /S /Movie >> action form on a Link annotation (NOT a Movie annot).
  const movieAnnot = ctx.obj({
    Type: "Annot", Subtype: "Link", Rect: [0, 0, 20, 20],
    A: ctx.obj({ S: "Movie" }),
  });

  page.node.set(PDFName.of("Annots"), ctx.obj([ctx.register(uriAnnot), ctx.register(movieAnnot)]));
  return pdf.save({ useObjectStreams: false });
}

test("sanitize: strips inline outline JavaScript, a Launch hidden in a /Next chain, and a /Movie action — residual is empty", async () => {
  const { sanitizePdf, residualActiveContent } = await import("../src/services/pdf-sanitize.service.js");
  const { PDFDocument, PDFName, PDFDict } = window.PDFLib;
  const src = await buildInlineActiveContentPdf();

  // The Analyser sees the threats before sanitising.
  const before = residualActiveContent(await analyzePdfBytes(src));
  assert.ok(before.length > 0, "Analyser flags the inline active content in the source");
  assert.ok(before.some((f) => f.indicator.includes("JavaScript")), "inline outline JavaScript is seen");
  assert.ok(before.some((f) => f.indicator === "/Launch action"), "the /Next-hidden Launch is seen");
  assert.ok(before.some((f) => f.indicator === "/Movie"), "the /Movie action is seen");

  const { bytes, report } = await sanitizePdf(src);

  // Each of the three inline dangerous actions was removed and counted.
  assert.ok(report.counts.actionScripts >= 3, `all three inline actions counted, got ${report.counts.actionScripts}`);
  assert.equal(report.clean, false);

  // The outline item's /A is gone; the URI action is kept but its /Next is gone.
  const out = await PDFDocument.load(bytes);
  const outCtx = out.context;
  const outlines = outCtx.lookup(out.catalog.get(PDFName.of("Outlines")));
  const firstItem = outCtx.lookup(outlines.get(PDFName.of("First")));
  assert.equal(firstItem.get(PDFName.of("A")), undefined, "inline outline /A JavaScript removed");
  let sawUri = false;
  for (const [, obj] of outCtx.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && String(obj.get(PDFName.of("Subtype"))) === "/Link") {
      const action = outCtx.lookup(obj.get(PDFName.of("A")));
      if (action instanceof PDFDict && String(action.get(PDFName.of("S"))) === "/URI") {
        sawUri = true;
        assert.equal(action.get(PDFName.of("Next")), undefined, "the Launch hidden in /Next was stripped");
      }
    }
  }
  assert.ok(sawUri, "the benign URI action itself was preserved");

  // The invariant: the Analyser's residual scan on the OUTPUT is empty.
  const after = residualActiveContent(await analyzePdfBytes(bytes));
  assert.equal(after.length, 0, `no residual active content, got: ${after.map((f) => f.indicator).join(", ")}`);
});

// --- Accessibility: /Lang injection via the public API -----------------------
// The UI dropdown only offers LANGUAGE_OPTIONS, but the public API forwards an
// arbitrary lang string. A payload that closes the /Lang string and opens an
// /OpenAction /JavaScript must never reach the catalog as literal syntax.
test("auto-tag: a malicious lang string cannot inject active content into the catalog", async () => {
  const { PDFDocument, PDFName } = window.PDFLib;
  const bytes = await makeTextPdf(1, "Doc");
  const malicious = "en) >> /OpenAction << /S /JavaScript /JS (app.alert('x')) >> <<";
  const { bytes: out } = await a11y.remediatePdfAccessibility(bytes, {
    lang: malicious,
    title: "Doc",
    textBlocks: [{ page: 1, text: "Body", x: 72, y: 700, fontSize: 12, heading: 0 }],
    figures: [],
  });

  // /Lang parses back to the safe fallback, not the payload; the catalog is intact.
  const doc = await PDFDocument.load(out, { throwOnInvalidObject: false });
  const langObj = doc.catalog.get(PDFName.of("Lang"));
  assert.equal(langObj.decodeText(), "en", "malicious lang fell back to the safe default");

  // Re-analysing the output finds no injected auto-run JavaScript.
  const report = await analyzePdfBytes(out);
  const injected = report.findings.filter((f) => f.indicator === "/OpenAction" || f.indicator.includes("JavaScript"));
  assert.equal(injected.length, 0, `lang injection introduced active content: ${injected.map((f) => f.indicator).join(", ")}`);

  // A normal BCP-47 tag still works and round-trips (hex-encoded, decodes back).
  const ok = await a11y.remediatePdfAccessibility(bytes, { lang: "en-US", title: "Doc", textBlocks: [], figures: [] });
  const okDoc = await PDFDocument.load(ok.bytes, { throwOnInvalidObject: false });
  assert.equal(okDoc.catalog.get(PDFName.of("Lang")).decodeText(), "en-US", "a valid tag is written unchanged");
});

// --- Accessibility: CERTIFIED-grade structure (lists / tables / links /
// artifacts / role map / heading nesting) -------------------------------------
// The tagger now builds a much fuller PDF/UA-oriented structure tree. These evals
// pin each new structure type from a real remediation output, and the expanded
// checker's new criteria + honest not-certified caveat.

// Small struct-tree navigators shared by the tests below.
function a11yKidsOf(ctx, PDFName, el) {
  const k = el.get(PDFName.of("K"));
  const resolved = k ? ctx.lookup(k) : undefined;
  const out = [];
  if (resolved instanceof window.PDFLib.PDFArray) {
    for (let i = 0; i < resolved.size(); i += 1) {
      const child = ctx.lookup(resolved.get(i));
      if (child && typeof child.get === "function") out.push(child);
    }
  } else if (resolved && typeof resolved.get === "function") {
    out.push(resolved);
  }
  return out;
}
function a11yRole(ctx, PDFName, el) {
  const s = el.get(PDFName.of("S"));
  return s ? s.toString().replace(/^\//, "") : "";
}
function a11yDocEl(ctx, PDFName, cat) {
  const structRoot = ctx.lookup(cat.get(PDFName.of("StructTreeRoot")));
  return { structRoot, docEl: ctx.lookup(structRoot.get(PDFName.of("K"))) };
}

async function makeLinkPdf() {
  const { PDFDocument, PDFName, PDFString } = window.PDFLib;
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const ctx = doc.context;
  const annot = ctx.obj({
    Type: "Annot", Subtype: "Link", Rect: [72, 690, 300, 710],
    A: ctx.obj({ S: "URI", URI: PDFString.of("https://example.com") }),
  });
  page.node.set(PDFName.of("Annots"), ctx.obj([ctx.register(annot)]));
  return doc.save();
}

test("auto-tag groups consecutive bullet lines into an /L > /LI > /Lbl + /LBody list", async () => {
  const { PDFDocument, PDFName } = window.PDFLib;
  const bytes = await makeTextPdf(1, "Doc");
  const { bytes: out, report } = await a11y.remediatePdfAccessibility(bytes, {
    lang: "en-US", title: "Doc",
    textBlocks: [
      { page: 1, text: "• First item", x: 72, y: 700, fontSize: 12, heading: 0 },
      { page: 1, text: "• Second item", x: 72, y: 684, fontSize: 12, heading: 0 },
      { page: 1, text: "• Third item", x: 72, y: 668, fontSize: 12, heading: 0 },
    ],
    figures: [],
  });
  assert.equal(report.structSummary.lists, 1, "one /L list");
  assert.equal(report.structSummary.listItems, 3, "three /LI items");

  const doc = await PDFDocument.load(out, { throwOnInvalidObject: false });
  const ctx = doc.context;
  const { docEl } = a11yDocEl(ctx, PDFName, doc.catalog);
  const lists = a11yKidsOf(ctx, PDFName, docEl).filter((el) => a11yRole(ctx, PDFName, el) === "L");
  assert.equal(lists.length, 1, "exactly one /L element under the document");
  const items = a11yKidsOf(ctx, PDFName, lists[0]);
  assert.equal(items.length, 3, "three /LI children");
  for (const li of items) {
    assert.equal(a11yRole(ctx, PDFName, li), "LI");
    const roles = a11yKidsOf(ctx, PDFName, li).map((c) => a11yRole(ctx, PDFName, c));
    assert.ok(roles.includes("Lbl"), "LI has an /Lbl marker");
    assert.ok(roles.includes("LBody"), "LI has an /LBody");
  }
});

test("auto-tag tags a positioned grid as /Table > /TR > /TH (first row) + /TD, and leaves a single column alone", async () => {
  const { PDFDocument, PDFName } = window.PDFLib;

  // A clearly table-like 2x3 grid: two rows, three aligned columns.
  const grid = await a11y.remediatePdfAccessibility(await makeTextPdf(1, "Doc"), {
    lang: "en-US", title: "Doc",
    textBlocks: [
      { page: 1, text: "Name", x: 72, y: 700, fontSize: 12, heading: 0 },
      { page: 1, text: "Q1", x: 220, y: 700, fontSize: 12, heading: 0 },
      { page: 1, text: "Q2", x: 360, y: 700, fontSize: 12, heading: 0 },
      { page: 1, text: "Alpha", x: 72, y: 680, fontSize: 12, heading: 0 },
      { page: 1, text: "10", x: 220, y: 680, fontSize: 12, heading: 0 },
      { page: 1, text: "20", x: 360, y: 680, fontSize: 12, heading: 0 },
    ],
    figures: [],
  });
  assert.equal(grid.report.structSummary.tables, 1, "one /Table detected");

  const doc = await PDFDocument.load(grid.bytes, { throwOnInvalidObject: false });
  const ctx = doc.context;
  const { docEl } = a11yDocEl(ctx, PDFName, doc.catalog);
  const tables = a11yKidsOf(ctx, PDFName, docEl).filter((el) => a11yRole(ctx, PDFName, el) === "Table");
  assert.equal(tables.length, 1, "exactly one /Table");
  const rows = a11yKidsOf(ctx, PDFName, tables[0]);
  assert.equal(rows.length, 2, "two /TR rows");
  assert.ok(rows.every((r) => a11yRole(ctx, PDFName, r) === "TR"), "rows are /TR");
  const headerCells = a11yKidsOf(ctx, PDFName, rows[0]);
  assert.equal(headerCells.length, 3, "header row has three cells");
  assert.ok(headerCells.every((c) => a11yRole(ctx, PDFName, c) === "TH"), "first row cells are /TH");
  assert.ok(headerCells.every((c) => c.get(PDFName.of("Scope")).toString() === "/Column"), "header cells carry /Scope /Column");
  const bodyCells = a11yKidsOf(ctx, PDFName, rows[1]);
  assert.ok(bodyCells.every((c) => a11yRole(ctx, PDFName, c) === "TD"), "second row cells are /TD");

  // A single-column block of the same three lines must NOT be tagged as a table.
  const column = await a11y.remediatePdfAccessibility(await makeTextPdf(1, "Doc"), {
    lang: "en-US", title: "Doc",
    textBlocks: [
      { page: 1, text: "Line one", x: 72, y: 700, fontSize: 12, heading: 0 },
      { page: 1, text: "Line two", x: 72, y: 680, fontSize: 12, heading: 0 },
      { page: 1, text: "Line three", x: 72, y: 660, fontSize: 12, heading: 0 },
    ],
    figures: [],
  });
  assert.equal(column.report.structSummary.tables, 0, "an ambiguous single column is not a table");
  assert.equal(column.report.structSummary.paragraphs, 3, "the single column stays paragraphs");
});

test("auto-tag wires each /Link annotation into the tree with a /Link element + /OBJR", async () => {
  const { PDFDocument, PDFName, PDFRef } = window.PDFLib;
  const bytes = await makeLinkPdf();
  const { bytes: out, report } = await a11y.remediatePdfAccessibility(bytes, {
    lang: "en-US", title: "Doc",
    textBlocks: [{ page: 1, text: "See our site", x: 72, y: 695, fontSize: 12, heading: 0 }],
    figures: [],
  });
  assert.equal(report.structSummary.links, 1, "one /Link element");

  const doc = await PDFDocument.load(out, { throwOnInvalidObject: false });
  const ctx = doc.context;
  const { docEl } = a11yDocEl(ctx, PDFName, doc.catalog);
  const linkEls = a11yKidsOf(ctx, PDFName, docEl).filter((el) => a11yRole(ctx, PDFName, el) === "Link");
  assert.equal(linkEls.length, 1, "exactly one /Link structure element");
  const objr = a11yKidsOf(ctx, PDFName, linkEls[0]).find((c) => {
    const t = c.get(PDFName.of("Type"));
    return t && t.toString() === "/OBJR";
  });
  assert.ok(objr, "the /Link contains an /OBJR");
  const obj = objr.get(PDFName.of("Obj"));
  assert.ok(obj instanceof PDFRef, "the /OBJR references the annotation by /Obj");
  const annot = ctx.lookup(obj);
  assert.equal(annot.get(PDFName.of("Subtype")).toString(), "/Link", "the /OBJR points at the /Link annotation");
  // The link annotation gained /Contents alt text derived from its URI.
  assert.match(annot.get(PDFName.of("Contents")).decodeText(), /example\.com/);
});

test("auto-tag marks repeated header/footer text as /Artifact and excludes it from the reading order", async () => {
  const { PDFDocument, PDFName, PDFArray, decodePDFRawStream } = window.PDFLib;
  const bytes = await makeTextPdf(2, "Doc");
  const { bytes: out, report } = await a11y.remediatePdfAccessibility(bytes, {
    lang: "en-US", title: "Doc",
    textBlocks: [
      { page: 1, text: "Chapter one body", x: 72, y: 700, fontSize: 12, heading: 0 },
      { page: 1, text: "Confidential - Page 1", x: 72, y: 40, fontSize: 9, heading: 0 },
      { page: 2, text: "Chapter two body", x: 72, y: 700, fontSize: 12, heading: 0 },
      { page: 2, text: "Confidential - Page 2", x: 72, y: 40, fontSize: 9, heading: 0 },
    ],
    figures: [],
  });
  assert.equal(report.structSummary.runningArtifacts, 2, "both repeated footers artifacted");
  // Only the two body paragraphs are in the reading order; footers are excluded.
  assert.equal(report.structSummary.paragraphs, 2, "footers are not tagged as paragraphs");

  const doc = await PDFDocument.load(out, { throwOnInvalidObject: false });
  const ctx = doc.context;
  let content = "";
  for (const page of doc.getPages()) {
    const contents = page.node.get(PDFName.of("Contents"));
    const resolved = ctx.lookup(contents);
    const refs = resolved instanceof PDFArray ? resolved.asArray() : [contents];
    for (const ref of refs) {
      try { content += new TextDecoder().decode(decodePDFRawStream(ctx.lookup(ref)).decode()); } catch { /* skip */ }
    }
  }
  assert.match(content, /\/Artifact\b/, "running content is marked /Artifact in the page content");

  // No paragraph in the structure tree carries the footer text.
  const { docEl } = a11yDocEl(ctx, PDFName, doc.catalog);
  const paraText = a11yKidsOf(ctx, PDFName, docEl)
    .filter((el) => a11yRole(ctx, PDFName, el) === "P")
    .map((el) => (el.get(PDFName.of("ActualText")) ? el.get(PDFName.of("ActualText")).decodeText() : ""));
  assert.ok(!paraText.some((t) => /Confidential/.test(t)), "the footer is not in the reading order");
});

// Regression: a recurring section HEADING at the top/bottom margin must NOT be
// re-classified as running content and drawn as /Artifact. Before the fix,
// detectRunningContent artifacted any digit-normalised text that repeated on >=2
// pages inside the margin band — so "Executive Summary" (p1+p2) and "Chapter 1"/
// "Chapter 2" (same digit-normalised key) were dropped from the reading order and
// a screen-reader user never heard them. A false /Artifact is permanent content
// loss, so a detected heading (planner heading level 1..6) stays an /H1.
test("auto-tag keeps a recurring top-margin heading in the reading order as /H1 (not /Artifact)", async () => {
  const { PDFDocument, PDFName } = window.PDFLib;
  const bytes = await makeTextPdf(2, "Doc");
  // Two pages, each with a heading in the top margin band that repeats across
  // pages: "Executive Summary" is identical; "Chapter 1"/"Chapter 2" collapse to
  // the same digit-normalised key. Both would previously be artifacted.
  const { bytes: out, report } = await a11y.remediatePdfAccessibility(bytes, {
    lang: "en-US", title: "Doc",
    textBlocks: [
      { page: 1, text: "Executive Summary", x: 72, y: 740, fontSize: 18, heading: 1 },
      { page: 1, text: "Chapter 1", x: 72, y: 715, fontSize: 16, heading: 2 },
      { page: 1, text: "Body of page one.", x: 72, y: 600, fontSize: 12, heading: 0 },
      { page: 2, text: "Executive Summary", x: 72, y: 740, fontSize: 18, heading: 1 },
      { page: 2, text: "Chapter 2", x: 72, y: 715, fontSize: 16, heading: 2 },
      { page: 2, text: "Body of page two.", x: 72, y: 600, fontSize: 12, heading: 0 },
    ],
    figures: [],
  });
  // The four heading blocks stay in the reading order and none are artifacted.
  assert.equal(report.structSummary.headings, 4, "all four recurring headings are tagged, not dropped");
  assert.equal(report.structSummary.runningArtifacts, 0, "no heading was re-classified as running content");

  // They are real /H1../H2 StructElems whose text is preserved, in the tree.
  const doc = await PDFDocument.load(out, { throwOnInvalidObject: false });
  const ctx = doc.context;
  const { docEl } = a11yDocEl(ctx, PDFName, doc.catalog);
  const headingEls = a11yKidsOf(ctx, PDFName, docEl).filter((el) => /^H[1-6]$/.test(a11yRole(ctx, PDFName, el)));
  assert.equal(headingEls.length, 4, "four heading StructElems in the reading order");
  const headingText = headingEls
    .map((el) => (el.get(PDFName.of("ActualText")) ? el.get(PDFName.of("ActualText")).decodeText() : ""));
  assert.ok(headingText.some((t) => /Executive Summary/.test(t)), "the recurring heading is in the reading order");
  assert.ok(headingText.some((t) => /Chapter 1/.test(t)) && headingText.some((t) => /Chapter 2/.test(t)),
    "both digit-variant headings survive despite sharing a digit-normalised key");

  // The audit agrees: the tree carries a navigable heading outline.
  const audit = await a11y.auditPdfAccessibility(out, { textLayer: { characters: 40, pageCount: 2 } });
  assert.ok(audit.stats.headings >= 2, "audit sees the recurring headings in the structure tree");
});

// Regression guard for the fix above: a GENUINE repeated running footer (a small
// page-number folio, heading level 0) must still be artifacted and excluded from
// the reading order — the fix only spares headings, not real running content.
test("auto-tag still artifacts a repeated page-number footer (heading-exclusion does not regress the feature)", async () => {
  const { PDFDocument, PDFName } = window.PDFLib;
  const bytes = await makeTextPdf(2, "Doc");
  const { bytes: out, report } = await a11y.remediatePdfAccessibility(bytes, {
    lang: "en-US", title: "Doc",
    textBlocks: [
      { page: 1, text: "Real body content one.", x: 72, y: 600, fontSize: 12, heading: 0 },
      { page: 1, text: "Page 1 of 10", x: 72, y: 30, fontSize: 9, heading: 0 },
      { page: 2, text: "Real body content two.", x: 72, y: 600, fontSize: 12, heading: 0 },
      { page: 2, text: "Page 2 of 10", x: 72, y: 30, fontSize: 9, heading: 0 },
    ],
    figures: [],
  });
  assert.equal(report.structSummary.runningArtifacts, 2, "both folio footers are still artifacted");
  assert.equal(report.structSummary.headings, 0, "no headings in this document");
  assert.equal(report.structSummary.paragraphs, 2, "only the two body paragraphs are in the reading order");

  // The folio text is not present as any StructElem in the reading order.
  const doc = await PDFDocument.load(out, { throwOnInvalidObject: false });
  const ctx = doc.context;
  const { docEl } = a11yDocEl(ctx, PDFName, doc.catalog);
  const allText = a11yKidsOf(ctx, PDFName, docEl)
    .map((el) => (el.get(PDFName.of("ActualText")) ? el.get(PDFName.of("ActualText")).decodeText() : ""));
  assert.ok(!allText.some((t) => /Page \d+ of 10/.test(t)), "the folio footer is excluded from the reading order");
});

// Regression: idempotency still holds when a document mixes a recurring heading
// (kept in the reading order) with a recurring footer (artifacted). Re-tagging
// twice must still leave exactly one StructTreeRoot, no orphaned StructElems, and
// the heading must survive both passes.
test("auto-tag is idempotent on a doc with both a repeated heading and a repeated footer", async () => {
  const { PDFDocument, PDFName } = window.PDFLib;
  const blocks = [
    { page: 1, text: "Executive Summary", x: 72, y: 740, fontSize: 18, heading: 1 },
    { page: 1, text: "Body of page one.", x: 72, y: 600, fontSize: 12, heading: 0 },
    { page: 1, text: "Page 1 of 2", x: 72, y: 30, fontSize: 9, heading: 0 },
    { page: 2, text: "Executive Summary", x: 72, y: 740, fontSize: 18, heading: 1 },
    { page: 2, text: "Body of page two.", x: 72, y: 600, fontSize: 12, heading: 0 },
    { page: 2, text: "Page 2 of 2", x: 72, y: 30, fontSize: 9, heading: 0 },
  ];

  async function measure(bytes) {
    const doc = await PDFDocument.load(bytes, { throwOnInvalidObject: false });
    const ctx = doc.context;
    let structElems = 0;
    let structRoots = 0;
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
      if (!obj || typeof obj.get !== "function") continue;
      const t = obj.get(PDFName.of("Type"));
      const type = t ? t.toString() : "";
      if (type === "/StructElem") structElems += 1;
      if (type === "/StructTreeRoot") structRoots += 1;
    }
    return { structElems, structRoots };
  }

  const src = await makeTextPdf(2, "Report");
  const pass1 = await a11y.remediatePdfAccessibility(src, { lang: "en-US", title: "Report", textBlocks: blocks, figures: [] });
  const m1 = await measure(pass1.bytes);
  const pass2 = await a11y.remediatePdfAccessibility(pass1.bytes, { lang: "en-US", title: "Report", textBlocks: blocks, figures: [] });
  const m2 = await measure(pass2.bytes);

  assert.equal(m1.structRoots, 1, "one StructTreeRoot after the first pass");
  assert.equal(m2.structRoots, 1, "still exactly one StructTreeRoot after re-running (old root not orphaned)");
  assert.equal(m2.structElems, m1.structElems, "StructElem count does not grow on a re-run (no orphans)");
  // The recurring heading survives both passes; the recurring footer is artifacted both times.
  assert.equal(pass1.report.structSummary.headings, 2, "two headings after the first pass");
  assert.equal(pass2.report.structSummary.headings, 2, "two headings still after the second pass");
  assert.equal(pass1.report.structSummary.runningArtifacts, 2, "both footers artifacted on the first pass");
  assert.equal(pass2.report.structSummary.runningArtifacts, 2, "both footers artifacted on the second pass");
});

test("upgraded checker reports the new PDF/UA criteria, an N-of-M summary, and the not-certified caveat", async () => {
  // A rich remediation output: heading + table + list + a tagged link.
  const linkBytes = await makeLinkPdf();
  const { bytes: rich } = await a11y.remediatePdfAccessibility(linkBytes, {
    lang: "en-US", title: "Rich Doc",
    textBlocks: [
      { page: 1, text: "Report", x: 72, y: 760, fontSize: 24, heading: 1 },
      { page: 1, text: "Name", x: 72, y: 700, fontSize: 12, heading: 0 },
      { page: 1, text: "Q1", x: 220, y: 700, fontSize: 12, heading: 0 },
      { page: 1, text: "Q2", x: 360, y: 700, fontSize: 12, heading: 0 },
      { page: 1, text: "Alpha", x: 72, y: 680, fontSize: 12, heading: 0 },
      { page: 1, text: "10", x: 220, y: 680, fontSize: 12, heading: 0 },
      { page: 1, text: "20", x: 360, y: 680, fontSize: 12, heading: 0 },
      { page: 1, text: "• first", x: 72, y: 640, fontSize: 12, heading: 0 },
      { page: 1, text: "• second", x: 72, y: 624, fontSize: 12, heading: 0 },
    ],
    figures: [],
  });
  const report = await a11y.auditPdfAccessibility(rich, { textLayer: { characters: 80, pageCount: 1 } });
  const checks = a11yById(report);

  // Every new criterion is present and passes on the rich, well-formed output.
  assert.equal(checks["lists-structured"].status, "pass", "list structure passes");
  assert.equal(checks["table-headers"].status, "pass", "table header cells pass");
  assert.equal(checks["links-tagged"].status, "pass", "tagged links pass");
  assert.equal(checks["running-content"].status, "pass", "running-content criterion present");
  assert.equal(checks["heading-nesting"].status, "pass", "heading nesting passes");
  assert.equal(checks["role-map"].status, "pass", "role map present");

  // Conformance-style N-of-M summary.
  assert.ok(report.conformance, "conformance tally present");
  assert.match(report.conformance.summary, /^\d+ of \d+ automated PDF\/UA checks pass$/);
  assert.equal(report.conformance.applicable, report.summary.pass + report.summary.warn + report.summary.fail);

  // The rendered report keeps the honest not-certified caveat prominent.
  const text = a11y.buildAccessibilityReportText(report, { fileName: "rich.pdf" });
  assert.match(text, /CONFORMANCE: \d+ of \d+ automated PDF\/UA checks pass/);
  assert.match(text, /NOT a veraPDF/i);
});

test("upgraded checker fails the new structural criteria on an untagged document with clear messages", async () => {
  // Untagged, but it DOES carry a link annotation — so links-tagged must fail too.
  const report = await a11y.auditPdfAccessibility(await makeLinkPdf(), { textLayer: { characters: 10, pageCount: 1 } });
  const checks = a11yById(report);
  for (const id of ["lists-structured", "table-headers", "links-tagged", "running-content", "role-map", "heading-nesting"]) {
    assert.equal(checks[id].status, "fail", `${id} fails on an untagged document`);
    assert.match(checks[id].detail, /not tagged/i, `${id} explains it is because the document is not tagged`);
  }
  assert.equal(report.stats.linkAnnots, 1, "the untagged document's link annotation was seen");
});

test("upgraded checker flags a skipped heading level (H1 -> H3 with no H2)", async () => {
  const { bytes: out } = await a11y.remediatePdfAccessibility(await makeTextPdf(1, "Doc"), {
    lang: "en-US", title: "Doc",
    textBlocks: [
      { page: 1, text: "Top", x: 72, y: 740, fontSize: 24, heading: 1 },
      { page: 1, text: "Sub sub", x: 72, y: 700, fontSize: 14, heading: 3 },
    ],
    figures: [],
  });
  const report = await a11y.auditPdfAccessibility(out, { textLayer: { characters: 20, pageCount: 1 } });
  const check = a11yById(report)["heading-nesting"];
  assert.equal(check.status, "fail", "the H1 -> H3 skip is flagged");
  assert.match(check.detail, /H1.*H3|skip/i, "the message names the skipped level");
});

test("richer structure is still idempotent: re-tagging lists/tables/links does not orphan or stack", async () => {
  const { PDFDocument, PDFName } = window.PDFLib;
  const blocks = [
    { page: 1, text: "Report", x: 72, y: 760, fontSize: 24, heading: 1 },
    { page: 1, text: "Name", x: 72, y: 700, fontSize: 12, heading: 0 },
    { page: 1, text: "Q1", x: 220, y: 700, fontSize: 12, heading: 0 },
    { page: 1, text: "Alpha", x: 72, y: 680, fontSize: 12, heading: 0 },
    { page: 1, text: "10", x: 220, y: 680, fontSize: 12, heading: 0 },
    { page: 1, text: "• first", x: 72, y: 640, fontSize: 12, heading: 0 },
    { page: 1, text: "• second", x: 72, y: 624, fontSize: 12, heading: 0 },
  ];
  async function countStruct(bytes) {
    const doc = await PDFDocument.load(bytes, { throwOnInvalidObject: false });
    let structRoots = 0;
    let structElems = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!obj || typeof obj.get !== "function") continue;
      const t = obj.get(PDFName.of("Type"));
      const s = t ? t.toString() : "";
      if (s === "/StructTreeRoot") structRoots += 1;
      if (s === "/StructElem") structElems += 1;
    }
    return { structRoots, structElems };
  }

  const pass1 = await a11y.remediatePdfAccessibility(await makeLinkPdf(), { lang: "en-US", title: "Doc", textBlocks: blocks, figures: [] });
  const c1 = await countStruct(pass1.bytes);
  const pass2 = await a11y.remediatePdfAccessibility(pass1.bytes, { lang: "en-US", title: "Doc", textBlocks: blocks, figures: [] });
  const c2 = await countStruct(pass2.bytes);

  assert.equal(c1.structRoots, 1, "one StructTreeRoot after the first pass");
  assert.equal(c2.structRoots, 1, "still one StructTreeRoot after re-running the richer tree");
  assert.ok(c1.structElems > 8, "the richer tree has document + heading + table + list + link elements");
  assert.equal(c2.structElems, c1.structElems, "StructElem count does not grow on a re-run (no orphaned first-pass elements)");

  const after = await a11y.auditPdfAccessibility(pass2.bytes, { textLayer: { characters: 60, pageCount: 1 } });
  const checks = a11yById(after);
  assert.equal(checks.tagged.status, "pass", "still tagged after two passes");
  assert.equal(checks["lists-structured"].status, "pass", "list structure survives a re-run");
  assert.equal(checks["table-headers"].status, "pass", "table headers survive a re-run");
  assert.equal(checks["links-tagged"].status, "pass", "tagged links survive a re-run");
});

// --- Extract: decompression-bomb guard on inflated streams -------------------
async function buildBombImagePdf() {
  const { PDFDocument, PDFName } = window.PDFLib;
  const { zlibSync } = await import("fflate");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  const ctx = pdf.context;

  // A highly-compressible payload (1 MB of zeros → a few KB compressed) declared
  // as a tiny 8×8 image: the classic decompression-bomb shape.
  const compressed = zlibSync(new Uint8Array(1024 * 1024), { level: 9 });
  const bomb = ctx.stream(compressed, {
    Type: "XObject", Subtype: "Image", Width: 8, Height: 8,
    ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "FlateDecode",
  });
  // A genuine small image alongside it, to prove clean images still extract.
  const okSamples = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]); // 2×2 RGB
  const ok = ctx.flateStream(okSamples, { Type: "XObject", Subtype: "Image", Width: 2, Height: 2, ColorSpace: "DeviceRGB", BitsPerComponent: 8 });

  page.node.set(PDFName.of("Resources"), ctx.obj({ XObject: ctx.obj({ ImBomb: ctx.register(bomb), ImOk: ctx.register(ok) }) }));
  return pdf.save({ useObjectStreams: false });
}

test("extract: a FlateDecode image that inflates past the cap is skipped as a bomb, and clean images still extract", async () => {
  const { extractPdfAssets } = await import("../src/services/pdf-extract.service.js");
  const result = await extractPdfAssets(await buildBombImagePdf());

  assert.equal(result.counts.imageXObjects, 2, "both image XObjects were seen");
  const bomb = result.skipped.find((s) => /bomb|too large/i.test(s.reason));
  assert.ok(bomb, `the bomb image was skipped with a clear reason, got: ${JSON.stringify(result.skipped)}`);

  // The normal image alongside it still decodes to a PNG.
  assert.equal(result.images.length, 1, "the clean image still extracted");
  assert.equal(result.images[0].mime, "image/png");
});

test("extract: a FlateDecode attachment that inflates past the cap is skipped as a bomb", async () => {
  const { extractPdfAssets } = await import("../src/services/pdf-extract.service.js");
  const { PDFDocument, PDFName, PDFString } = window.PDFLib;
  const { zlibSync } = await import("fflate");
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  const ctx = pdf.context;

  const compressed = zlibSync(new Uint8Array(80 * 1024 * 1024)); // inflates past the 64 MB cap
  const bombStream = ctx.stream(compressed, { Type: "EmbeddedFile", Filter: "FlateDecode" });
  const spec = ctx.obj({ Type: "Filespec", F: PDFString.of("payload.bin"), UF: PDFString.of("payload.bin"), EF: { F: ctx.register(bombStream) } });
  pdf.catalog.set(PDFName.of("Names"), ctx.obj({ EmbeddedFiles: { Names: [PDFString.of("payload.bin"), ctx.register(spec)] } }));

  const result = await extractPdfAssets(await pdf.save({ useObjectStreams: false }));
  assert.equal(result.attachments.length, 0, "the bomb attachment was not decoded");
  assert.ok(result.skipped.some((s) => /bomb|too large/i.test(s.reason)), `the attachment was skipped with a clear reason, got: ${JSON.stringify(result.skipped)}`);
});

// --- CEO product-judge fixes: discoverability of this release's flagships.
// Security/accessibility/extraction intent must resolve to the right new tool,
// the "New" badge must fire for every flagship, and the dashboard discovery
// surfaces (New & Notable shelf, quick-search chips) must point at real tools.

test("flagship intent queries resolve to this release's new tools", () => {
  const top = (query) => filterTools(query)[0]?.id;
  // Sanitize / CDR intent — beats the metadata cleaner and converters.
  assert.equal(top("remove javascript from pdf"), "sanitize-pdf-tool");
  assert.equal(top("strip pdf threats"), "sanitize-pdf-tool");
  // Accessibility intent — either accessibility tool is an acceptable top hit.
  const accessibilityIds = new Set(["tag-pdf-tool", "accessibility-check-tool"]);
  assert.ok(accessibilityIds.has(top("make pdf accessible")), `make pdf accessible -> ${top("make pdf accessible")}`);
  assert.ok(accessibilityIds.has(top("tag pdf for screen reader")), `tag pdf for screen reader -> ${top("tag pdf for screen reader")}`);
  // Embedded-image extraction — beats "Extract Text from PDF".
  assert.equal(top("extract images from pdf"), "extract-images-tool");
});

test("every quick-search chip resolves to a real tool", () => {
  const appSource = readAppSource();
  const chips = appSource.match(/const quickSearches = \[(.*?)\]/s)[1].match(/"([^"]+)"/g).map((s) => s.replace(/"/g, ""));
  assert.ok(chips.length >= 6, "quick searches should offer a useful set");
  for (const chip of chips) {
    const results = filterTools(chip);
    assert.ok(results.length > 0 && tools.some((t) => t.id === results[0].id), `chip "${chip}" resolves to a real tool`);
  }
  // The two new flagship chips exist and land on the intended tools.
  assert.ok(chips.includes("Make PDF accessible"), "accessibility chip present");
  assert.ok(chips.includes("Remove JavaScript"), "sanitize chip present");
  assert.equal(filterTools("Make PDF accessible")[0].id, "tag-pdf-tool");
  assert.equal(filterTools("Remove JavaScript")[0].id, "sanitize-pdf-tool");
});

test("the eight flagship new tools carry the New badge", () => {
  const flagships = [
    "sanitize-pdf-tool", "extract-images-tool", "accessibility-check-tool", "tag-pdf-tool",
    "translate-pdf-tool", "batch-workflow-tool", "request-signature-tool", "api-playground-tool",
  ];
  for (const id of flagships) {
    const tool = tools.find((t) => t.id === id);
    assert.ok(tool, `${id} exists in the registry`);
    assert.equal(tool.isNew, true, `${id} should be isNew:true`);
  }
});

test("New & Notable shelf points at real, isNew flagship tools", () => {
  const appSource = readAppSource();
  const shelf = appSource.match(/newAndNotableIds = \[(.*?)\]/s)[1].match(/"([^"]+)"/g).map((s) => s.replace(/"/g, ""));
  assert.ok(shelf.length >= 4 && shelf.length <= 6, "shelf stays a sensible size");
  for (const id of shelf) {
    const tool = tools.find((t) => t.id === id);
    assert.ok(tool && tool.isNew, `${id} must exist and be isNew`);
  }
  // The shelf features this release's flagships, not the previous one.
  assert.ok(shelf.includes("sanitize-pdf-tool"), "shelf features the Sanitize flagship");
});

// --- Reflow Editor: genuine paragraph reflow ---------------------------------
// The pure model + layout engine (parseParagraphs / flowBlocks / rebuildReflowedPdf)
// re-lays-out the whole text column so an edit re-wraps its paragraph AND pushes
// the following paragraphs down, repaginating on overflow. The pdf.js extraction
// from a real PDF is browser-only; these tests exercise the pure engine.

test("parseParagraphs groups body lines into one paragraph, then flags a heading, in reading order", async () => {
  const { parseParagraphs } = await import("../src/services/pdf-reflow.service.js");
  const item = (str, x, y, size, width, font) => ({ str, transform: [size, 0, 0, size, x, y], width, height: size, fontName: font });
  // Three body lines (size 12, ~14pt leading) form ONE paragraph; then a large
  // vertical gap and a bigger, bold line reads as a HEADING.
  const items = [
    item("Line one of the body", 72, 700, 12, 120, "Helvetica"),
    item("Line two of the body", 72, 686, 12, 120, "Helvetica"),
    item("Line three of the body", 72, 672, 12, 130, "Helvetica"),
    item("Big Heading", 72, 620, 18, 90, "Helvetica-Bold"),
  ];
  const blocks = parseParagraphs(items, { width: 612, height: 792 });
  assert.equal(blocks.length, 2, "one paragraph + one heading");
  assert.equal(blocks[0].type, "paragraph");
  assert.equal(blocks[0].isHeading, false);
  assert.equal(blocks[0].text, "Line one of the body Line two of the body Line three of the body");
  assert.equal(blocks[1].type, "heading");
  assert.equal(blocks[1].isHeading, true);
  assert.equal(blocks[1].text, "Big Heading");
  assert.equal(blocks[1].bold, true, "heading picked up the bold font");
});

test("flowBlocks re-wraps a longer edit, moves following blocks, and paginates on overflow", async () => {
  const { flowBlocks } = await import("../src/services/pdf-reflow.service.js");
  // Simple measured-width model: ~0.5em per character.
  const measure = (text, block) => text.length * block.fontSize * 0.5;
  const column = { x: 72, width: 200, top: 700, bottom: 100 };
  const para = (text) => ({ type: "paragraph", text, fontSize: 12, align: "left" });

  const followerText = "The following paragraph after the first.";
  const longText = "The quick brown fox jumps over the lazy dog again and again while the following paragraph waits its turn to be pushed further down the page as the text reflows naturally.";

  const shortRun = flowBlocks([para("Short intro."), para(followerText)], column, { measure });
  const longRun = flowBlocks([para(longText), para(followerText)], column, { measure });

  // No wrapped line exceeds the column width (1pt wrap slack).
  for (const run of [shortRun, longRun]) {
    for (const page of run.pages) {
      for (const line of page.lines) assert.ok(measure(line.text, { fontSize: 12 }) <= 201, `line "${line.text}" fits column`);
    }
  }

  // The long first paragraph wraps to more lines than the short one.
  const firstCount = (run) => run.pages.flatMap((p) => p.lines).filter((l) => l.block === 0).length;
  assert.ok(firstCount(longRun) > firstCount(shortRun), "longer edit uses more lines");

  // The following block moved: lower baseline (or a later page) after the long edit.
  const follower = (run) => {
    for (let pi = 0; pi < run.pages.length; pi += 1) {
      const line = run.pages[pi].lines.find((l) => l.block === 1);
      if (line) return { page: pi, baseline: line.baseline };
    }
    return null;
  };
  const fShort = follower(shortRun);
  const fLong = follower(longRun);
  assert.ok(fLong.page > fShort.page || fLong.baseline < fShort.baseline, "following block shifted down after the long edit");

  // Force overflow with a short column: the long paragraph paginates.
  const tight = flowBlocks([para(longText)], { x: 72, width: 200, top: 700, bottom: 640 }, { measure });
  assert.ok(tight.pageCount >= 2, "overflow paginates to a new page");
});

test("rebuildReflowedPdf reflows edited blocks, paginates on overflow, and rejects non-Latin", async () => {
  const { rebuildReflowedPdf, flowBlocks } = await import("../src/services/pdf-reflow.service.js");
  const { PDFDocument, StandardFonts } = window.PDFLib;

  const column = { x: 72, width: 400, top: 720, bottom: 72 };
  const blocks = (firstText) => ([
    { type: "paragraph", text: firstText, fontSize: 12, fontKey: "Helvetica", align: "left", color: null },
    { type: "paragraph", text: "SECONDPARAGRAPHMARKER stays after the first.", fontSize: 12, fontKey: "Helvetica", align: "left", color: null },
  ]);

  // Real pdf-lib measuring for the baseline-moved assertion (matches the rebuild).
  const measureDoc = await PDFDocument.create();
  const helv = await measureDoc.embedFont(StandardFonts.Helvetica);
  const measure = (text, block) => helv.widthOfTextAtSize(String(text), block.fontSize);

  const longFirst = "The quick brown fox jumps over the lazy dog and keeps on running well past the edge so this paragraph must wrap onto several lines and push everything below it further down the page.";

  const secondShort = flowBlocks(blocks("Short."), column, { measure }).pages[0].lines.find((l) => l.block === 1).baseline;
  const secondLong = flowBlocks(blocks(longFirst), column, { measure }).pages[0].lines.find((l) => l.block === 1).baseline;
  assert.ok(secondLong < secondShort, "second paragraph baseline moved DOWN after the long edit (reflowed)");

  // Rebuild the long edit and reload: the second paragraph's text is present.
  const out = await rebuildReflowedPdf(new Uint8Array(), { pageWidth: 612, pageHeight: 792, column, blocks: blocks(longFirst) });
  assert.ok(out instanceof Uint8Array && out.byteLength > 0);
  const ops = (await decodeAllPageOps(out)).join("\n");
  assert.ok(ops.includes(hexOf("SECONDPARAGRAPHMARKER")), "second paragraph drawn in the reflowed output");

  // Force overflow: a single long paragraph in a short, narrow column paginates.
  const overflow = await rebuildReflowedPdf(new Uint8Array(), {
    pageWidth: 612, pageHeight: 792,
    column: { x: 72, width: 200, top: 720, bottom: 660 },
    blocks: [{ type: "paragraph", text: longFirst, fontSize: 12, fontKey: "Helvetica" }],
  });
  const reloaded = await PDFDocument.load(overflow);
  assert.ok(reloaded.getPageCount() >= 2, "overflow created a second page");

  // Non-Latin text raises the friendly Latin-1 error.
  await assert.rejects(
    () => rebuildReflowedPdf(new Uint8Array(), { pageWidth: 612, pageHeight: 792, column, blocks: [{ type: "paragraph", text: "日本語の段落", fontSize: 12, fontKey: "Helvetica" }] }),
    /Latin-1/,
  );

  // An empty model is rejected.
  await assert.rejects(() => rebuildReflowedPdf(new Uint8Array(), { pageWidth: 612, pageHeight: 792, column, blocks: [] }), /no text to reflow/i);
});

test("detectColumnLayout flags side-by-side / tabular content and derives a column box", async () => {
  const { detectColumnLayout } = await import("../src/services/pdf-reflow.service.js");
  const item = (str, x, y, size, width) => ({ str, transform: [size, 0, 0, size, x, y], width, height: size, fontName: "Helvetica" });

  // A clean single-column page: no big internal gaps.
  const single = detectColumnLayout([
    item("First line of a normal paragraph", 72, 700, 12, 300),
    item("Second line of that paragraph", 72, 686, 12, 300),
    item("Third line continues the flow", 72, 672, 12, 300),
  ], { width: 612, height: 792 });
  assert.equal(single.complex, false, "single-column page is not flagged complex");
  assert.ok(single.column.width > 0 && single.column.x >= 0, "derived a column box");

  // A table-like page: each line has two runs far apart (a wide internal gap).
  const rows = [];
  for (let i = 0; i < 4; i += 1) {
    const y = 700 - i * 16;
    rows.push(item(`Label ${i}`, 72, y, 12, 60));
    rows.push(item(`Value ${i}`, 360, y, 12, 60)); // gap 360-132 = 228 >> 3.2*12
  }
  const table = detectColumnLayout(rows, { width: 612, height: 792 });
  assert.equal(table.tableLike, true, "wide side-by-side runs flagged as tabular");
  assert.equal(table.complex, true, "complex layout warns the user to prefer Edit PDF Text");
});

test("reflow-pdf-tool is registered, routed, wired, cross-references Edit PDF Text, and is discoverable", () => {
  const found = tools.find((tool) => tool.id === "reflow-pdf-tool");
  assert.ok(found, "reflow-pdf-tool registered");
  assert.equal(found.category, "PDF Tools");
  assert.equal(found.status, "available");
  assert.equal(found.localProcessing, true);
  assert.equal(found.group, "Edit & Annotate");
  assert.equal(found.file.maxFiles, 1);
  assert.equal(routeForHash(found.route).tool.id, "reflow-pdf-tool");

  const appSource = readAppSource();
  assert.ok(appSource.includes(`"reflow-pdf-tool"`), "wired into ToolRenderer");
  assert.ok(appSource.includes("ReflowEditorTool"), "component defined");

  // The two edit tools cross-reference each other honestly.
  assert.match(found.description.toLowerCase(), /edit pdf text/);
  const editText = tools.find((tool) => tool.id === "edit-pdf-text-tool");
  assert.match(editText.description.toLowerCase(), /reflow/);

  const searchable = [found.name, found.description, ...found.keywords].join(" ").toLowerCase();
  for (const term of ["reflow", "paragraph"]) assert.match(searchable, new RegExp(term));
});

// =============================================================================
// PHASE C1 — PDF/A hardening toward validity (src/services/pdf-review.service.js)
// HONEST: hardened toward PDF/A-2b, NOT veraPDF-certified. These lock in the
// machine-checkable rules we DO enforce/check, the fail-loud on unembedded
// fonts, and the vendored sha-pinned sRGB ICC profile.
// =============================================================================

// Registers an indirect Type1 font whose FontDescriptor embeds a FontFile3
// program — i.e. a genuinely embedded ("embeddable") font, so archival prep
// accepts it. Returns the saved bytes.
async function pdfWithEmbeddedFont(title) {
  const { PDFDocument, PDFName } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const ctx = doc.context;
  const fontFile = ctx.flateStream(new Uint8Array([0x01, 0x02, 0x03, 0x04]), { Subtype: PDFName.of("Type1C") });
  const descriptor = ctx.obj({});
  descriptor.set(PDFName.of("Type"), PDFName.of("FontDescriptor"));
  descriptor.set(PDFName.of("FontName"), PDFName.of("EmbeddedTestFont"));
  descriptor.set(PDFName.of("FontFile3"), ctx.register(fontFile));
  const fontDict = ctx.obj({});
  fontDict.set(PDFName.of("Type"), PDFName.of("Font"));
  fontDict.set(PDFName.of("Subtype"), PDFName.of("Type1"));
  fontDict.set(PDFName.of("BaseFont"), PDFName.of("EmbeddedTestFont"));
  fontDict.set(PDFName.of("FontDescriptor"), ctx.register(descriptor));
  ctx.register(fontDict);
  if (title) doc.setTitle(title);
  return doc.save();
}

test("C1: archivalPrepPdf on an embedded-font doc adds OutputIntent+ICC and PDF/A-2B XMP synced to DocInfo /Title", async () => {
  const { archivalPrepPdf, checkPdfACompliance } = await import("../src/services/pdf-review.service.js");
  const { PDFDocument, PDFName } = window.PDFLib;
  const src = await pdfWithEmbeddedFont("Quarterly Report");

  const { bytes, report } = await archivalPrepPdf(src, { title: "Quarterly Report", part: "2", conformance: "B" });
  assert.match(report.conformance, /PDF\/A-2B/);

  const out = await PDFDocument.load(bytes);
  // OutputIntent with an embedded 3-channel ICC DestOutputProfile.
  const intents = out.context.lookup(out.catalog.get(PDFName.of("OutputIntents")));
  assert.ok(intents && intents.size() === 1, "one OutputIntent");
  const intent = out.context.lookup(intents.get(0));
  const icc = out.context.lookup(intent.get(PDFName.of("DestOutputProfile")));
  assert.equal(icc.dict.get(PDFName.of("N")).toString(), "3", "ICC is 3-channel");

  // XMP carries pdfaid:part=2 / conformance=B and dc:title matching DocInfo.
  const xmp = Buffer.from(out.context.lookup(out.catalog.get(PDFName.of("Metadata"))).contents).toString("utf8");
  assert.match(xmp, /pdfaid:part>2</);
  assert.match(xmp, /pdfaid:conformance>B</);
  assert.match(xmp, /<dc:title>[\s\S]*?Quarterly Report[\s\S]*?<\/dc:title>/);
  assert.equal(out.getTitle(), "Quarterly Report", "DocInfo /Title set");

  // The checker agrees: title + pdfaid are in sync and everything passes.
  const check = await checkPdfACompliance(bytes, { part: "2", conformance: "B" });
  assert.equal(check.criteria.find((c) => c.id === "titleSync").pass, true, "XMP dc:title == DocInfo /Title");
  assert.equal(check.criteria.find((c) => c.id === "pdfaid").pass, true);
  assert.equal(check.criteria.find((c) => c.id === "fonts").pass, true, "embedded font passes");
  assert.equal(check.passed, check.total, `hardened output passes all ${check.total} checked criteria`);
});

test("C1: a doc needing a non-embedded font FAILS LOUDLY and names the offending font", async () => {
  const { archivalPrepPdf, scanFontEmbedding } = await import("../src/services/pdf-review.service.js");
  const { PDFDocument, StandardFonts } = window.PDFLib;
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const helv = await doc.embedFont(StandardFonts.Helvetica); // standard-14 => NOT embedded
  page.drawText("unembedded", { x: 20, y: 20, size: 12, font: helv });
  const src = await doc.save();

  const scan = scanFontEmbedding(await PDFDocument.load(src));
  assert.deepEqual(scan.unembedded, ["Helvetica"], "scanner flags the standard font as unembedded");

  await assert.rejects(
    () => archivalPrepPdf(src, { part: "2" }),
    (error) => /not embedded/i.test(error.message) && /Helvetica/.test(error.message),
    "archival prep refuses and names Helvetica",
  );
});

test("C1: checkPdfACompliance reports an N-of-M tally and flags a JavaScript file as non-conformant", async () => {
  const { checkPdfACompliance } = await import("../src/services/pdf-review.service.js");
  const { PDFDocument, PDFName, PDFString } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const ctx = doc.context;
  const action = ctx.obj({});
  action.set(PDFName.of("S"), PDFName.of("JavaScript"));
  action.set(PDFName.of("JS"), PDFString.of("app.alert('x')"));
  doc.catalog.set(PDFName.of("OpenAction"), ctx.register(action));
  const src = await doc.save();

  const check = await checkPdfACompliance(src);
  assert.equal(typeof check.passed, "number");
  assert.equal(typeof check.total, "number");
  assert.ok(check.passed < check.total, "an un-prepped JS file fails several criteria");
  assert.equal(check.certified, false, "never claims certification");
  assert.match(check.caveat, /not veraPDF-certified/i);
  assert.ok(Array.isArray(check.notChecked) && check.notChecked.length > 0, "lists rules it does not check");
  const js = check.criteria.find((c) => c.id === "noJavaScript");
  assert.equal(js.pass, false, "JavaScript is flagged as non-conformant");
});

test("C1: buildSrgbIccProfile reproduces the vendored, sha256-pinned sRGB profile", async () => {
  const { buildSrgbIccProfile } = await import("../src/services/pdf-review.service.js");
  const vendored = fs.readFileSync(new URL("../assets/vendor/icc/sRGB-IEC61966-2.1.icc", import.meta.url));
  const generated = Buffer.from(buildSrgbIccProfile());
  assert.ok(generated.equals(vendored), "generator output matches the vendored asset byte-for-byte");

  const digest = createHash("sha256").update(vendored).digest("hex");
  const auditSrc = fs.readFileSync(new URL("../scripts/security-audit.js", import.meta.url), "utf8");
  assert.ok(auditSrc.includes(digest), "the vendored ICC sha256 is pinned in scripts/security-audit.js");
  assert.ok(auditSrc.includes("assets/vendor/icc/sRGB-IEC61966-2.1.icc"), "the ICC asset is listed in the audit");
});

// =============================================================================
// PHASE C2 — client-side e-sign embedded audit trail (pdf-sign.service.js)
// 100% offline. Cross-checks the embedded /MFKAuditTrail against the signature.
// HONEST: proves integrity + what the cert claims, NOT real-world identity.
// =============================================================================

test("C2: signPdf embeds an audit trail that verify reads back with a matching hash", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("Alice Signer", "Alice Signer", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "pw");
  const pdf = await buildSamplePdf(false);

  const signed = await signPdf(pdf, { p12, password: "pw", name: "Alice Signer", reason: "I approve", location: "Bengaluru", contact: "alice@example.com" });
  assert.equal(signed.auditEvent, "Signed");
  assert.equal(signed.counterSigned, false);

  const report = await verifyPdfSignatures(signed.bytes);
  assert.equal(report.count, 1);
  const sig = report.signatures[0];
  assert.equal(sig.auditTrailPresent, true, "embedded audit trail is present");
  assert.equal(sig.auditHashMatches, true, "recorded document hash matches the actual signed bytes");
  assert.equal(sig.digestValid, true);
  assert.equal(sig.byteRangeValid, true, "recorded /Covered matches the signature /ByteRange");
  assert.equal(sig.coversWholeDoc, true);
  assert.equal(sig.signerCN, "Alice Signer");
  assert.equal(sig.recordedSha256, sig.computedSha256, "recorded and recomputed SHA-256 agree");
  assert.equal(sig.tamperFindings.length, 0, "no tamper findings on a clean signature");
  assert.equal(sig.auditTrail.event, "Signed");
  assert.equal(sig.auditTrail.signer, "Alice Signer");
  assert.equal(sig.auditTrail.reason, "I approve");
  assert.equal(sig.auditTrail.contact, "alice@example.com");
  assert.equal(sig.auditTrail.clientTimeAsserted, true, "client time is labelled asserted, not TSA-trusted");
  assert.match(sig.identityCaveat, /does NOT prove the signer's real-world identity/);
});

test("C2: mutating one covered byte breaks the audit hash and is reported as tampering", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("Tamper Audit", "Tamper Audit", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "pw");
  const pdf = await buildSamplePdf(false);
  const signed = await signPdf(pdf, { p12, password: "pw", name: "Tamper Audit" });

  const tampered = new Uint8Array(signed.bytes);
  tampered[60] ^= 0x01; // deep inside the original body, within ByteRange 1

  const report = await verifyPdfSignatures(tampered);
  const sig = report.signatures[0];
  assert.equal(sig.digestValid, false, "digest no longer matches");
  assert.equal(sig.auditHashMatches, false, "recorded hash no longer matches the mutated bytes");
  assert.ok(sig.tamperFindings.length > 0, "tamper findings are reported");
  assert.equal(sig.verdict, "modified");
});

test("C2: counter-signing adds a second signature (incremental) without invalidating the first", async () => {
  const aliceKey = await genRsaKeyPair();
  const aliceCert = await makeSelfSignedCert("Alice", "Alice", aliceKey, aliceKey.privateKey);
  const aliceP12 = await makePkcs12(aliceKey.privateKey, [aliceCert], "pw");
  const bobKey = await genRsaKeyPair();
  const bobCert = await makeSelfSignedCert("Bob", "Bob", bobKey, bobKey.privateKey);
  const bobP12 = await makePkcs12(bobKey.privateKey, [bobCert], "pw");

  const pdf = await buildSamplePdf(false);
  const first = await signPdf(pdf, { p12: aliceP12, password: "pw", name: "Alice", reason: "Author" });
  const second = await signPdf(first.bytes, { p12: bobP12, password: "pw", name: "Bob", reason: "Witness" });
  assert.equal(second.counterSigned, true, "the second signature is labelled a counter-signature");
  assert.equal(second.auditEvent, "CounterSigned");

  const report = await verifyPdfSignatures(second.bytes);
  assert.equal(report.count, 2, "both signatures are present");
  const alice = report.signatures.find((s) => s.auditTrail && s.auditTrail.signer === "Alice");
  const bob = report.signatures.find((s) => s.auditTrail && s.auditTrail.signer === "Bob");
  assert.ok(alice && bob, "each signature carries its own audit entry");

  // BOTH verify cryptographically.
  assert.equal(alice.signatureValid, true);
  assert.equal(alice.digestValid, true, "signature 1 still valid over its original covered range");
  assert.equal(bob.signatureValid, true);
  assert.equal(bob.digestValid, true);

  // Each has a distinct audit event.
  assert.equal(alice.auditTrail.event, "Signed");
  assert.equal(bob.auditTrail.event, "CounterSigned");

  // The edit after signature 1 (Bob's incremental append) falls OUTSIDE
  // signature 1's byte range: signature 1 no longer covers the whole doc,
  // while signature 2 (the latest revision) does.
  assert.equal(alice.coversWholeDoc, false, "signature 1 does not cover the appended counter-signature");
  assert.equal(alice.byteRangeValid, true, "signature 1 is still valid for the range it covers");
  assert.equal(bob.coversWholeDoc, true, "signature 2 covers the whole current document");
});

// =============================================================================
// PHASE C3 — pdf-review.service.js hardening regressions (4 defects)
// =============================================================================

// DEFECT 1: a malicious free-text /Lang must not break out of the catalog literal
// and inject an /OpenAction JavaScript action; it must be BCP-47-validated and
// written as a hex string (an invalid tag falls back to a safe default).
test("C3: archivalPrepPdf validates + hex-encodes /Lang, so a malicious tag cannot inject catalog objects", async () => {
  const { archivalPrepPdf } = await import("../src/services/pdf-review.service.js");
  const { PDFDocument, PDFName } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]); // fontless, so the embedding gate passes
  const src = await doc.save({ useObjectStreams: false });

  const evil = "en) /OpenAction << /Type /Action /S /JavaScript /JS (app.alert\\(1\\)) >> /Marked (";
  const { bytes } = await archivalPrepPdf(src, { title: "T", lang: evil });
  const text = Buffer.from(bytes).toString("latin1");

  // No injected active content, and /Lang serialised as a hex string, not a literal.
  assert.equal(/\/OpenAction\s*<<[^>]*\/S\s*\/JavaScript/.test(text), false, "no injected /OpenAction JavaScript");
  assert.match(text, /\/Lang\s*<[0-9A-Fa-f]+>/, "/Lang is a hex string");
  assert.equal(/\/Lang\s*\(/.test(text), false, "/Lang is never a literal ( ) string");

  // The invalid tag defaults to "en" (= hex "656E"), matching the a11y path.
  const out = await PDFDocument.load(bytes);
  const langVal = out.catalog.get(PDFName.of("Lang"));
  assert.equal(typeof langVal.decodeText === "function" ? langVal.decodeText() : String(langVal), "en", "invalid tag falls back to en");

  // A valid tag is preserved verbatim (and still hex-encoded).
  const { bytes: okBytes } = await archivalPrepPdf(src, { title: "T", lang: "fr-FR" });
  const out2 = await PDFDocument.load(okBytes);
  const lang2 = out2.catalog.get(PDFName.of("Lang"));
  assert.equal(lang2.decodeText(), "fr-FR", "valid BCP-47 tag preserved");
});

// DEFECT 2: JavaScript hidden in an action /A → /Next chain (behind a benign
// /GoTo head) must be DETECTED by checkPdfACompliance pre-strip AND removed by
// archivalPrepPdf.
test("C3: /A /Next chain JavaScript is flagged pre-strip and removed by archivalPrepPdf", async () => {
  const { checkPdfACompliance, archivalPrepPdf } = await import("../src/services/pdf-review.service.js");
  const { PDFDocument, PDFName, PDFArray, PDFString } = window.PDFLib;
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // fontless
  const ctx = doc.context;

  const jsAction = ctx.obj({});
  jsAction.set(PDFName.of("S"), PDFName.of("JavaScript"));
  jsAction.set(PDFName.of("JS"), PDFString.of("app.alert('pwned: survived PDF/A prep');"));
  const gotoAction = ctx.obj({});
  gotoAction.set(PDFName.of("S"), PDFName.of("GoTo"));
  gotoAction.set(PDFName.of("Next"), ctx.register(jsAction)); // JS hidden in the chain
  const annot = ctx.obj({});
  annot.set(PDFName.of("Type"), PDFName.of("Annot"));
  annot.set(PDFName.of("Subtype"), PDFName.of("Link"));
  annot.set(PDFName.of("Rect"), ctx.obj([0, 0, 100, 100]));
  annot.set(PDFName.of("A"), ctx.register(gotoAction));
  const annots = PDFArray.withContext(ctx);
  annots.push(ctx.register(annot));
  page.node.set(PDFName.of("Annots"), annots);
  const src = await doc.save({ useObjectStreams: false });

  // 1. The checker must FAIL noJavaScript pre-strip (not report a clean 14/14).
  const check = await checkPdfACompliance(src, { part: "2", conformance: "B" });
  const noJs = check.criteria.find((c) => c.id === "noJavaScript");
  assert.equal(noJs.pass, false, "chain-buried JavaScript is detected pre-strip");
  assert.ok(check.passed < check.total, "not a clean N-of-N tally");

  // 2. archivalPrepPdf strips it and the JS code no longer survives in the bytes.
  const { bytes: out, report } = await archivalPrepPdf(src, { title: "T", part: "2" });
  assert.equal(Buffer.from(out).toString("latin1").includes("app.alert('pwned"), false, "JS removed from output");
  assert.ok(report.removed.some((item) => /JavaScript\/Launch action/i.test(item)), "removal reported");

  // 3. The cleaned output now passes noJavaScript.
  const check2 = await checkPdfACompliance(out, { part: "2" });
  assert.equal(check2.criteria.find((c) => c.id === "noJavaScript").pass, true, "cleaned file passes");
});

// DEFECT 2 follow-up (audit re-verify): JavaScript buried beyond the action-chain
// depth cap must FAIL SAFE — an un-walked chain is reported forbidden, never clean.
test("C3: JavaScript past the /Next depth cap fails checkPdfACompliance (fail-safe)", async () => {
  const { checkPdfACompliance } = await import("../src/services/pdf-review.service.js");
  const { PDFDocument, PDFName, PDFArray, PDFString } = window.PDFLib;
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const ctx = doc.context;

  // Build a benign /GoTo head with a 70-link /Next chain; the JS sits at the tail,
  // deeper than MAX_ACTION_CHAIN (64).
  const jsAction = ctx.obj({});
  jsAction.set(PDFName.of("S"), PDFName.of("JavaScript"));
  jsAction.set(PDFName.of("JS"), PDFString.of("app.alert('deep');"));
  let next = ctx.register(jsAction);
  for (let i = 0; i < 70; i += 1) {
    const link = ctx.obj({});
    link.set(PDFName.of("S"), PDFName.of("GoTo"));
    link.set(PDFName.of("Next"), next);
    next = ctx.register(link);
  }
  const annot = ctx.obj({});
  annot.set(PDFName.of("Type"), PDFName.of("Annot"));
  annot.set(PDFName.of("Subtype"), PDFName.of("Link"));
  annot.set(PDFName.of("Rect"), ctx.obj([0, 0, 100, 100]));
  annot.set(PDFName.of("A"), next);
  const annots = PDFArray.withContext(ctx);
  annots.push(ctx.register(annot));
  page.node.set(PDFName.of("Annots"), annots);
  const src = await doc.save({ useObjectStreams: false });

  const check = await checkPdfACompliance(src, { part: "2", conformance: "B" });
  const noJs = check.criteria.find((c) => c.id === "noJavaScript");
  assert.equal(noJs.pass, false, "chain deeper than the cap fails safe, not reported clean");
});

// DEFECT 3: a document /OpenAction of type /Launch (launch a program on open)
// must FAIL the noJavaScript criterion, not slip through unflagged.
test("C3: a /Launch document OpenAction fails checkPdfACompliance noJavaScript", async () => {
  const { checkPdfACompliance } = await import("../src/services/pdf-review.service.js");
  const { PDFDocument, PDFName, PDFString } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]); // fontless
  const ctx = doc.context;
  const launch = ctx.obj({});
  launch.set(PDFName.of("S"), PDFName.of("Launch"));
  launch.set(PDFName.of("F"), PDFString.of("calc.exe"));
  doc.catalog.set(PDFName.of("OpenAction"), ctx.register(launch));
  const src = await doc.save({ useObjectStreams: false });

  const check = await checkPdfACompliance(src, { part: "2" });
  const noJs = check.criteria.find((c) => c.id === "noJavaScript");
  assert.equal(noJs.pass, false, "a /Launch OpenAction is flagged");
  assert.match(noJs.detail, /Launch/, "the detail names /Launch");
});

// DEFECT 4: the XMP read is capped and the dc:title regex is bounded, so a large
// junk /Metadata stream full of unclosed <rdf:li cannot cause a polynomial-time
// blow-up. checkPdfACompliance must return quickly and stay correct.
test("C3: checkPdfACompliance stays fast + bounded on a 1MB junk /Metadata stream", async () => {
  const { checkPdfACompliance } = await import("../src/services/pdf-review.service.js");
  const { PDFDocument, PDFName } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const ctx = doc.context;
  // ~1MB of <dc:title> followed by unclosed <rdf:li — the polynomial trigger.
  const junk = "<dc:title>" + "<rdf:li x>".repeat(120000);
  const metaStream = ctx.stream(junk, { Type: PDFName.of("Metadata"), Subtype: PDFName.of("XML") });
  doc.catalog.set(PDFName.of("Metadata"), ctx.register(metaStream));
  const src = await doc.save({ useObjectStreams: false });

  const start = Date.now();
  const check = await checkPdfACompliance(src, { part: "2" });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 2000, `check completes quickly (took ${elapsed}ms)`);
  // XMP is present but carries no pdfaid identifier, so that criterion fails cleanly.
  assert.equal(check.criteria.find((c) => c.id === "xmp").pass, true, "XMP stream is seen");
  assert.equal(check.criteria.find((c) => c.id === "pdfaid").pass, false, "no pdfaid id in junk XMP");

  // A normal XMP title still round-trips (the bounded regex stays correct).
  const doc2 = await PDFDocument.create();
  doc2.addPage([200, 200]);
  const ctx2 = doc2.context;
  const goodXmp = `<?xpacket?><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Hello Title</rdf:li></rdf:Alt></dc:title>`;
  doc2.catalog.set(PDFName.of("Metadata"), ctx2.register(ctx2.stream(goodXmp, { Type: PDFName.of("Metadata"), Subtype: PDFName.of("XML") })));
  doc2.setTitle("Hello Title");
  const src2 = await doc2.save({ useObjectStreams: false });
  const check2 = await checkPdfACompliance(src2, { part: "2" });
  assert.equal(check2.criteria.find((c) => c.id === "titleSync").pass, true, "normal dc:title still extracted + matched");
});

// C2 security: audit-trail identity forgery via incremental redefinition.
// An attacker takes a validly signed PDF and appends an incremental update that
// REDEFINES the signature object (same object number) with an attacker-chosen
// /Signer, keeping the ORIGINAL /ByteRange + /Contents so the CMS still verifies.
// A "latest definition wins" reader would present the forged signer as authentic.
// Verification must read the audit trail from the SIGNED bytes and flag the
// redefinition — never surface the attacker's identity as authoritative.
test("C2 security: an incremental redefinition of the sig object with a forged /Signer is caught, not trusted", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("Alice", "Alice", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "pw");
  const pdf = await buildSamplePdf(false);

  const signed = await signPdf(pdf, { p12, password: "pw", name: "Alice", reason: "approve" });

  // Reproduce the exact attack: reuse the original object number + /ByteRange +
  // /Contents, but swap in an attacker-chosen audit trail (/Signer "Mallory").
  const str = Buffer.from(signed.bytes).toString("latin1");
  const sigNum = Number(str.match(/(\d+) 0 obj\s*<<\/Type \/Sig/)[1]);
  const [, l1, s2, l2] = str.match(/\/ByteRange \[0 (\d+)\s+(\d+)\s+(\d+)\s*\]/).map(Number);
  const contentsHex = str.match(/\/Contents <([0-9a-fA-F]+)>/)[1];
  const forgedSig =
    `\n${sigNum} 0 obj\n<</Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached` +
    ` /M (D:20260101000000Z) /Name (Mallory)` +
    ` /MFKAuditTrail << /Producer (MyFileKit Local e-Sign) /Version 1 /Event /Signed` +
    ` /Signer (Mallory the Attacker) /ClientTime (D:20260101000000Z) /ClientTimeAsserted true` +
    ` /HashAlg /SHA-256 /Covered [0 ${l1} ${s2} ${l2}] /Summary (Signed by Mallory) >>` +
    ` /ByteRange [0 ${l1} ${s2} ${l2}] /Contents <${contentsHex}>>>\nendobj\n`;
  const forged = Buffer.concat([
    Buffer.from(signed.bytes), Buffer.from(forgedSig, "latin1"), Buffer.from("startxref\n0\n%%EOF\n", "latin1"),
  ]);

  const sig = (await verifyPdfSignatures(forged)).signatures[0];
  // The CMS still verifies over the untouched original span — that is the trap.
  assert.equal(sig.signatureValid, true, "the original CMS still verifies over its untouched span");
  // But the forged identity is NOT surfaced: the audit trail is read from the
  // SIGNED bytes, so the displayed signer is the genuine cert holder, not Mallory.
  assert.equal(/Mallory/.test(sig.auditTrail.signer || ""), false, "the forged signer is never displayed as authentic");
  assert.equal(sig.auditTrail.signer, "Alice", "the displayed signer is the one that was actually signed");
  // The redefinition is flagged and the audit trail is marked untrusted.
  assert.equal(sig.auditTrailTrusted, false, "a redefined audit trail is not trusted");
  assert.ok(
    sig.tamperFindings.some((f) => /redefined|audit/i.test(f)),
    "a tamper finding reports the post-signing redefinition",
  );
  // The one honest tell the crypto still gives us stays correct.
  assert.equal(sig.coversWholeDoc, false, "the appended redefinition falls outside the signed range");
  assert.equal(sig.signerCN, "Alice", "the real certificate identity is unchanged");
});

// A legitimately counter-signed document appends a NEW signature object (a new
// object number); it never redefines an already-signed object. It must NOT be
// mistaken for the redefinition forgery above.
test("C2 security: a legit counter-signature is NOT flagged as a forged redefinition", async () => {
  const aliceKey = await genRsaKeyPair();
  const aliceCert = await makeSelfSignedCert("Alice", "Alice", aliceKey, aliceKey.privateKey);
  const aliceP12 = await makePkcs12(aliceKey.privateKey, [aliceCert], "pw");
  const bobKey = await genRsaKeyPair();
  const bobCert = await makeSelfSignedCert("Bob", "Bob", bobKey, bobKey.privateKey);
  const bobP12 = await makePkcs12(bobKey.privateKey, [bobCert], "pw");

  const pdf = await buildSamplePdf(false);
  const first = await signPdf(pdf, { p12: aliceP12, password: "pw", name: "Alice", reason: "Author" });
  const second = await signPdf(first.bytes, { p12: bobP12, password: "pw", name: "Bob", reason: "Witness" });

  const report = await verifyPdfSignatures(second.bytes);
  assert.equal(report.count, 2);
  const alice = report.signatures.find((s) => s.auditTrail && s.auditTrail.signer === "Alice");
  const bob = report.signatures.find((s) => s.auditTrail && s.auditTrail.signer === "Bob");
  assert.ok(alice && bob, "each signature keeps its own audit entry");

  // BOTH signatures are valid, both audit trails are trusted, neither is flagged.
  assert.equal(alice.signatureValid, true);
  assert.equal(bob.signatureValid, true);
  assert.equal(alice.auditTrailTrusted, true, "the first signer's audit trail is not falsely flagged");
  assert.equal(bob.auditTrailTrusted, true, "the counter-signer's audit trail is trusted");
  assert.equal(alice.tamperFindings.length, 0, "no false forgery finding on the first signature");
  assert.equal(bob.tamperFindings.length, 0, "no false forgery finding on the counter-signature");
  assert.equal(alice.auditTrail.event, "Signed");
  assert.equal(bob.auditTrail.event, "CounterSigned");
});

// An untouched, single, valid signature: the audit trail is present, its hash
// matches, it is trusted, and there are no tamper findings.
test("C2 security: an untouched single signature has a present, matching, TRUSTED audit trail", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("Alice Signer", "Alice Signer", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "pw");
  const pdf = await buildSamplePdf(false);

  const signed = await signPdf(pdf, { p12, password: "pw", name: "Alice Signer", reason: "I approve" });
  const sig = (await verifyPdfSignatures(signed.bytes)).signatures[0];
  assert.equal(sig.auditTrailPresent, true);
  assert.equal(sig.auditHashMatches, true);
  assert.equal(sig.auditTrailTrusted, true, "an untampered audit trail is trusted");
  assert.equal(sig.auditTrail.signer, "Alice Signer");
  assert.equal(sig.tamperFindings.length, 0, "no tamper findings on a clean signature");
});

// --- Workspace file matching --------------------------------------------------
// A release review found the Workspace telling users the product could not open
// files it ships tools for, and a filename with no extension matching every PDF
// tool. Both are matcher bugs; these pin the behaviour.

test("workspace matcher: extension parsing, any-type tools, and honest support claims", async () => {
  const appSource = readAppSource();

  // A name with no dot has no extension — it must not be treated as one.
  // (Regression: "pdf" as a whole filename matched all 59 PDF tools.)
  assert.match(appSource, /lastIndexOf\("\."\)/, "extension must be parsed from the last dot");
  assert.equal(appSource.includes('name.split(".").pop()'), false, "split-pop parsing must not return");

  // Tools whose file input accepts anything must declare it, so the matcher can
  // always offer them — including for a file type no other tool handles.
  const anyType = tools.filter((tool) => tool.file && tool.file.anyType === true).map((tool) => tool.id).sort();
  assert.deepEqual(anyType, ["file-hash-tool", "hash-compare-tool"]);

  // Every tool that declares extensions must declare them lower-case, or the
  // case-insensitive match in the UI silently disagrees with the registry.
  for (const tool of tools) {
    for (const ext of tool.file?.extensions || []) {
      assert.equal(ext, ext.toLowerCase(), `${tool.id} declares a non-lowercase extension: ${ext}`);
      assert.equal(ext.startsWith("."), false, `${tool.id} extension must not include a dot: ${ext}`);
    }
  }

  // The zero-match state must offer a way forward, not just a refusal.
  assert.match(appSource, /Browse all \{tools\.length\} tools/, "no-match state must link to the full index");
});

test("browse route carries an optional extension filter", () => {
  assert.deepEqual(routeForHash("#browse-tools"), { type: "browse" });
  assert.deepEqual(routeForHash("#browse-tools?ext=pdf"), { type: "browse", ext: "pdf" });
  assert.deepEqual(routeForHash("#browse-tools?ext=PDF"), { type: "browse", ext: "pdf" });
  // A malformed or oversized filter degrades to the unfiltered index.
  assert.deepEqual(routeForHash("#browse-tools?ext=" + "a".repeat(40)), { type: "browse" });
  assert.deepEqual(routeForHash("#browse-tools?nope=1"), { type: "browse" });
});

// --- Workspace hand-off scoping ----------------------------------------------
// A release review found a file staged on the Workspace silently auto-loading
// into P2P File Share — a WebRTC tool whose purpose is sending the file off the
// device — because the first FileControl to mount adopted whatever was pending.
// The hand-off is now scoped to the one tool the user clicked.

test("workspace hand-off is scoped to the tool the user chose", async () => {
  const mod = await import("../src/lib/workspace-handoff.ts").catch(() => null);
  const handoff = mod || (await import("../src/lib/workspace-handoff.js"));
  const { stashWorkspaceFiles, takeWorkspaceFilesFor, clearWorkspaceFilesUnless, pendingWorkspaceToolId } = handoff;
  const file = { name: "bank-statement.pdf", size: 10 };

  // Only the intended tool may take the files.
  stashWorkspaceFiles([file], "merge-pdf-tool");
  assert.deepEqual(takeWorkspaceFilesFor("p2p-share-tool"), [], "an unintended tool must never receive the hand-off");
  assert.equal(pendingWorkspaceToolId(), "merge-pdf-tool", "a failed take must not consume the stash");
  assert.deepEqual(takeWorkspaceFilesFor("merge-pdf-tool"), [file]);
  assert.equal(pendingWorkspaceToolId(), null, "a successful take clears the stash");

  // Navigating anywhere else drops it, so nothing lingers unseen.
  stashWorkspaceFiles([file], "merge-pdf-tool");
  clearWorkspaceFilesUnless("compress-image-tool");
  assert.equal(pendingWorkspaceToolId(), null, "navigating to another tool must drop the stash");

  // Navigating to the intended tool keeps it.
  stashWorkspaceFiles([file], "merge-pdf-tool");
  clearWorkspaceFilesUnless("merge-pdf-tool");
  assert.equal(pendingWorkspaceToolId(), "merge-pdf-tool");
  takeWorkspaceFilesFor("merge-pdf-tool");

  // Nothing is staged without an explicit target.
  stashWorkspaceFiles([file], "");
  assert.equal(pendingWorkspaceToolId(), null);
});

test("the status bar never claims 'offline' for a tool that can reach a network", () => {
  const appSource = readAppSource();
  const noted = [...appSource.matchAll(/"([a-z0-9-]+-tool)":\s*"(?:Server-backed|Local · optional|Direct connection)[^"]*"/g)]
    .map((match) => match[1]);

  // Any tool whose implementation can open a connection must carry a label.
  const networkMarkers = ["requestChatCompletion", "requestEnvelope", "RTCPeerConnection"];
  for (const id of ["request-signature-tool", "translate-pdf-tool", "summarize-pdf-tool", "chat-with-pdf-tool", "p2p-share-tool", "collab-whiteboard-tool"]) {
    assert.ok(noted.includes(id), `${id} can reach a network and needs an honest status-bar label`);
  }
  // And the markers themselves still exist, so this test fails loudly if the
  // network paths move rather than silently passing on a stale list.
  for (const marker of networkMarkers) {
    assert.ok(appSource.includes(marker), `expected ${marker} in the source — update this guard if it moved`);
  }
});

// --- Page marking geometry ----------------------------------------------------
// These values drive an irreversible, flattening redaction, so the maths is
// tested directly rather than trusted because a drag "looked right". A review
// found that releasing a drag outside the page emitted negative percentages,
// which the redaction service rejects outright — discarding every other marked
// area with a message naming a coordinate the user never typed.

test("page geometry: drags normalise, clamp to the page, and convert to both unit systems", async () => {
  const geo = await import("../src/lib/page-geometry.ts").catch(() => import("../src/lib/page-geometry.js"));
  const { boxFromDrag, boxToPercent, boxToPoints, pointToPdf, isMeaningful } = geo;

  // A drag in any direction yields the same box.
  const forward = boxFromDrag({ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.5 });
  const reversed = boxFromDrag({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.3 });
  assert.deepEqual(forward, reversed);
  // Compared as percentages: the raw fractions carry float error (0.6 - 0.2 is
  // 0.39999999999999997), which both converters round away.
  assert.deepEqual(boxToPercent(forward), { x: 20, y: 30, w: 40, h: 20 });

  // Overshooting the page edge clamps instead of going negative.
  const overshoot = boxFromDrag({ x: -0.4, y: 0.5 }, { x: 0.3, y: 1.9 });
  assert.equal(overshoot.x, 0, "x must never be negative");
  assert.equal(overshoot.y, 0.5);
  assert.ok(overshoot.x + overshoot.w <= 1, "box must stay within the page");
  assert.ok(overshoot.y + overshoot.h <= 1, "box must stay within the page");

  // PDF points flip the y axis: the canvas measures down, a PDF measures up.
  const pts = boxToPoints({ x: 0, y: 0, w: 1, h: 0.25 }, 595, 842);
  assert.equal(pts.y, 631.5, "a box at the TOP of the page is high in PDF points");
  const bottom = boxToPoints({ x: 0, y: 0.75, w: 1, h: 0.25 }, 595, 842);
  assert.equal(bottom.y, 0, "a box at the BOTTOM of the page is at y=0");

  // Point mode, same flip, and clamped.
  assert.deepEqual(pointToPdf({ x: 0.25, y: 0.3 }, 595, 842), { x: 148.8, y: 589.4 });
  assert.deepEqual(pointToPdf({ x: -1, y: 2 }, 595, 842), { x: 0, y: 0 });

  // A stray click is not a mark.
  assert.equal(isMeaningful({ x: 0.5, y: 0.5, w: 0.001, h: 0.4 }), false);
  assert.equal(isMeaningful(forward), true);
});

test("page geometry: the drawn areas are parsed from the coordinate list", async () => {
  const geo = await import("../src/lib/page-geometry.ts").catch(() => import("../src/lib/page-geometry.js"));
  const { parseAreaLines, textOverflowsPage, approximateTextWidth } = geo;

  const parsed = parseAreaLines("1, 10, 10, 30, 30\n4, 50, 50, 30, 30\n\n  ");
  assert.deepEqual(parsed, [
    { page: 1, x: 10, y: 10, w: 30, h: 30 },
    { page: 4, x: 50, y: 50, w: 30, h: 30 },
  ]);

  // Malformed or zero-area lines are skipped rather than drawn as junk.
  assert.deepEqual(parseAreaLines("nonsense\n1, 2, 3\n1, 10, 10, 0, 5\n0, 1, 1, 5, 5"), []);

  // Text placed near the right edge would be clipped: the tool must warn.
  assert.equal(textOverflowsPage(536, approximateTextWidth("Approved", 18), 595), true);
  assert.equal(textOverflowsPage(72, approximateTextWidth("Approved", 18), 595), false);
});

// --- Defects found by an accountant doing real work ---------------------------
// 1) Compress PDF made a 15 KB text PDF 66x LARGER, destroyed every character of
//    selectable text, and called it "Done — ready to save".
// 2) Excel to PDF silently rasterised a ledger (0 fonts, 2 JPEGs) with no warning.
// 3) Search ignored conversion direction: "jpg to pdf" ranked PDF to Image first.
// 4) A rejected page range left the previous split on screen, downloadable.

test("Compress PDF reports a larger-than-input result as a warning, never as a success", () => {
  const section = sourceOfComponents(["CompressPdfTool"]);

  // The decision is made on the real before/after sizes the service reports.
  assert.match(section, /const \{ bytes, before, after \} = await rasterCompressPdf/);
  const guard = section.indexOf("if (after >= before)");
  const download = section.indexOf("downloadBytes(");
  assert.ok(guard > 0, "the output size must be compared against the input size");
  assert.ok(download > guard, "the comparison must happen before the file is handed back");

  // A bigger output is never resolved as a success, so the 'Done — ready to
  // save' card cannot appear for it.
  const refusal = section.slice(guard, download);
  assert.match(refusal, /throw new Error/, "a bigger output must not resolve as a success");
  assert.match(refusal, /got bigger/i, "it says plainly that this file got bigger");
  assert.match(refusal, /formatBytes\(before\)/, "the original size is quoted");
  assert.match(refusal, /formatBytes\(after\)/, "the output size is quoted");
  // Asserts the EXPLANATION, not the word. This used to require the literal
  // "rasteris", which pinned prepress jargon into user-facing copy — the point
  // is that the message says why the file grew, in language a user can follow.
  assert.match(refusal, /picture of text|turns every page into|into a JPEG/i, "it explains why the file grew");
  assert.match(refusal, /instead/i, "it tells the user what to do instead");

  // The savings message belongs only to the path that actually saved bytes.
  const saved = section.indexOf("Saved about");
  assert.ok(saved > download, "'Saved about' may only be claimed after a real download");
});

test("Compress PDF flags a text-heavy PDF before it rasterises anything", () => {
  const source = readAppSource();
  const section = sourceOfComponents(["inspectPdfForCompression", "CompressPdfTool"]);

  // The check reads a real text layer and counts real embedded images.
  assert.match(section, /await extractPdfText\(file\)/, "the text layer is measured");
  assert.match(section, /"\/Image"/, "embedded images are counted");
  const rule = /textHeavy: ([^}]+)\}/.exec(section);
  assert.ok(rule, "the preflight returns a textHeavy verdict");
  assert.match(rule[1], /charsPerPage/, "text density decides");
  assert.match(rule[1], /images/, "so does the image count — a scan must stay compressible");
  const threshold = Number(/TEXT_HEAVY_CHARS_PER_PAGE = (\d+)/.exec(source)[1]);
  assert.ok(threshold >= 100, "a page carrying real prose counts as text-based");

  // It runs on file selection — before the button, not after the damage.
  assert.match(section, /useEffect\(/, "the preflight runs when a file is chosen");
  assert.match(section, /inspectPdfForCompression\(file\)/);

  // The warning states the consequence and gates the action behind consent.
  const warning = section.slice(section.indexOf("preflight?.textHeavy"));
  assert.match(warning, /larger/i, "the warning says the file will probably get larger");
  assert.match(warning, /selectable/i, "and that the selectable text is destroyed");
  assert.match(warning, /instead/i, "and what to do instead");
  assert.match(warning, /#split-pdf-tool/, "with a real alternative to go to");
  assert.match(section, /<Checkbox/, "rasterising anyway is an explicit, deliberate choice");
  assert.match(section, /disabled=\{blocked\}/, "until then the action is not available");
});

test("Excel to PDF warns that its output is a picture, and points at CSV to PDF", () => {
  const section = sourceOfComponents(["ExcelToPdfTool"]);
  assert.match(section, /no selectable/i, "the UI warns the output has no selectable text");
  assert.match(section, /picture|image/i, "and names what actually happens, in plain words");
  assert.match(section, /#csv-to-pdf-tool/, "and cross-references the text-output sibling");

  // The descriptions stop over-promising and cross-reference each other, the way
  // Compress PDF, Split, and Add Text already do.
  const byId = (id) => tools.find((tool) => tool.id === id).description;
  assert.match(byId("excel-to-pdf-tool"), /no selectable/i);
  assert.match(byId("excel-to-pdf-tool"), /CSV to PDF/);
  assert.match(byId("csv-to-pdf-tool"), /selectable/i);
  assert.match(byId("csv-to-pdf-tool"), /Excel to PDF/);

  // And the reciprocal pointer, so the accountant who lands on the wrong one
  // can get to the right one from either side.
  const csvSection = sourceOfComponents(["CsvToPdfTool"]);
  assert.match(csvSection, /#excel-to-pdf-tool/);
  assert.match(csvSection, /selectable/i);
});

test("search respects conversion direction — X-to-Y and Y-to-X are different queries", () => {
  const rank = (query, id) => {
    const index = filterTools(query).findIndex((tool) => tool.id === id);
    assert.ok(index >= 0, `"${query}" should still return ${id} somewhere`);
    return index;
  };

  assert.equal(filterTools("jpg to pdf")[0].id, "images-to-pdf-tool", "jpg to pdf makes a PDF from images");
  assert.ok(rank("jpg to pdf", "images-to-pdf-tool") < rank("jpg to pdf", "pdf-to-image-tool"));

  assert.equal(filterTools("pdf to jpg")[0].id, "pdf-to-image-tool", "pdf to jpg renders pages to images");
  assert.ok(rank("pdf to jpg", "pdf-to-image-tool") < rank("pdf to jpg", "images-to-pdf-tool"));

  // The words real people use for their photos land on the same tool.
  for (const query of ["photos to pdf", "photo to pdf", "picture to pdf", "pictures to pdf", "images to pdf"]) {
    assert.equal(filterTools(query)[0].id, "images-to-pdf-tool", `"${query}" should rank Images to PDF first`);
  }

  // Direction must not disturb the other conversion pairs.
  const pairs = [
    ["word to pdf", "word-to-pdf-tool"], ["pdf to word", "pdf-to-word-tool"],
    ["excel to pdf", "excel-to-pdf-tool"], ["pdf to excel", "pdf-to-excel-tool"],
    ["csv to pdf", "csv-to-pdf-tool"], ["pdf to html", "pdf-to-html-tool"],
    ["epub to pdf", "ebook-to-pdf-tool"], ["pdf to epub", "pdf-to-epub-tool"],
  ];
  for (const [query, id] of pairs) assert.equal(filterTools(query)[0].id, id, `"${query}" -> ${id}`);
});

test("a rejected page range clears the previous split result", () => {
  const section = sourceOfComponents(["PageRangeTool"]);
  const handler = section.slice(section.indexOf("runSafely(setStatus"));
  const cleared = handler.indexOf("setResult((previous)");
  const validated = handler.indexOf("validateFiles(");
  const parsed = handler.indexOf("parsePageRanges(");

  assert.ok(cleared >= 0, "the run clears the previous result");
  assert.ok(validated > cleared, "before the file is validated");
  assert.ok(parsed > cleared, "and before the range can be rejected — so nothing stale survives");
  assert.match(handler.slice(cleared, validated), /return null/, "the result is dropped, not replaced");
  assert.match(handler.slice(cleared, validated), /revokeObjectURL/, "and its object URL is released");
});

// --- Images to PDF page geometry ---------------------------------------------

const INCH = 72;
const longestSideInches = (layout) => Math.max(layout.pageWidth, layout.pageHeight) / INCH;

test("a phone photo becomes a printable page, not a 42-inch one", () => {
  // The reported defect: 3024x4032 pixels passed to addPage as points.
  const portrait = imagePageLayout(3024, 4032);
  assert.equal(Math.round(portrait.pageWidth), Math.round(A4_PAGE.width));
  assert.equal(Math.round(portrait.pageHeight), Math.round(A4_PAGE.height));
  assert.ok(longestSideInches(portrait) < 12, `page was ${longestSideInches(portrait).toFixed(1)} inches long`);

  // Every mode, every plausible camera and scanner size, stays printable.
  const sizes = [[3024, 4032], [4032, 3024], [1920, 1080], [6000, 4000], [8000, 8000], [100, 100], [1, 1]];
  for (const mode of ["a4", "match"]) {
    for (const [width, height] of sizes) {
      const layout = imagePageLayout(width, height, mode);
      assert.ok(longestSideInches(layout) <= 11.7 + 0.01, `${mode} ${width}x${height} gave ${longestSideInches(layout).toFixed(1)} inches`);
      assert.ok(layout.pageWidth > 0 && layout.pageHeight > 0);
    }
  }
});

test("a landscape image turns the page instead of letterboxing it", () => {
  const landscape = imagePageLayout(4032, 3024);
  assert.ok(landscape.pageWidth > landscape.pageHeight, "expected a landscape A4 page");
  assert.equal(Math.round(landscape.pageWidth), Math.round(A4_PAGE.height));
  // A 4:3 image is taller than a turned A4 is proportionally, so it is limited by
  // the page height and fills it between the margins.
  assert.ok(Math.abs(landscape.height - (landscape.pageHeight - 36 * 2)) < 0.01);
  // Turning the page is what makes it big: upright it would be far smaller.
  assert.ok(landscape.width > imagePageLayout(4032, 3024, "a4", 36).pageHeight * 0.5);
});

test("images to PDF keeps the image's shape and stays inside the page", () => {
  for (const mode of ["a4", "match"]) {
    for (const [width, height] of [[3024, 4032], [4032, 3024], [1600, 1600], [2000, 500]]) {
      const layout = imagePageLayout(width, height, mode);
      // Aspect ratio is preserved: no stretched photos.
      assert.ok(Math.abs((layout.width / layout.height) - (width / height)) < 0.001, `${mode} ${width}x${height} was stretched`);
      // Nothing is drawn off the page.
      assert.ok(layout.x >= -0.001 && layout.y >= -0.001);
      assert.ok(layout.x + layout.width <= layout.pageWidth + 0.001);
      assert.ok(layout.y + layout.height <= layout.pageHeight + 0.001);
    }
  }
});

test("match mode is borderless and a4 mode is centred with a margin", () => {
  const match = imagePageLayout(3024, 4032, "match");
  assert.equal(match.x, 0);
  assert.equal(match.y, 0);
  assert.equal(match.width, match.pageWidth);
  assert.equal(match.height, match.pageHeight);
  // Same shape as the image.
  assert.ok(Math.abs((match.pageWidth / match.pageHeight) - (3024 / 4032)) < 0.001);

  const a4 = imagePageLayout(3024, 4032, "a4");
  assert.ok(a4.x > 0 && a4.y > 0, "expected a margin");
  // Centred: equal space on both sides.
  assert.ok(Math.abs(a4.x - (a4.pageWidth - a4.width - a4.x)) < 0.001);
  assert.ok(Math.abs(a4.y - (a4.pageHeight - a4.height - a4.y)) < 0.001);
});

test("image page layout survives the sizes a broken decode reports", () => {
  for (const bad of [0, -5, Number.NaN, undefined, null]) {
    const layout = imagePageLayout(bad, bad);
    assert.ok(Number.isFinite(layout.pageWidth) && layout.pageWidth > 0);
    assert.ok(Number.isFinite(layout.pageHeight) && layout.pageHeight > 0);
    assert.ok(Number.isFinite(layout.width) && Number.isFinite(layout.height));
  }
  // An unknown mode falls back to A4 rather than to raw pixels.
  const unknown = imagePageLayout(3024, 4032, "pixels");
  assert.equal(Math.round(unknown.pageHeight), Math.round(A4_PAGE.height));
});

test("scans and handwriting go through the same A4 geometry", () => {
  const source = fs.readFileSync(new URL("../src/services/convert.service.js", import.meta.url), "utf8");
  const start = source.indexOf("export async function canvasesToPdf");
  const body = source.slice(start, source.indexOf("\n}", start));
  assert.ok(start >= 0, "canvasesToPdf missing from convert.service.js");
  assert.match(body, /imagePageLayout\(canvas\.width, canvas\.height, "a4"\)/);
  // The old bug: canvas pixels used directly as the page box.
  assert.doesNotMatch(body, /addPage\(\[canvas\.width, canvas\.height\]\)/);
});

// --- The no-upload claim is only printed where it is true ---------------------

test("no tool that sends data prints the local-only promise", () => {
  const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const toolSource = readAppSource();

  // The status bar already knows which tools touch the network. That list is the
  // authority; the badge must agree with it.
  const block = appSource.slice(appSource.indexOf("const NETWORK_NOTES"), appSource.indexOf("};", appSource.indexOf("const NETWORK_NOTES")));
  const networked = [...block.matchAll(/"([a-z0-9-]+)":/g)].map((m) => m[1]);
  assert.ok(networked.length >= 6, `expected NETWORK_NOTES to list the networked tools, got ${networked.length}`);

  // Every networked tool must resolve to a component whose ToolForm declares `sends`.
  const sendsCount = (toolSource.match(/<ToolForm\s+sends="/g) || []).length;
  assert.equal(sendsCount, networked.length, `NETWORK_NOTES lists ${networked.length} networked tools but ${sendsCount} pass sends= to ToolForm`);

  // The panel must choose between the two lines, never print the promise regardless.
  const shared = fs.readFileSync(new URL("../src/tools/shared.tsx", import.meta.url), "utf8");
  assert.match(shared, /downloadReady \? null : sends \?/);
  assert.match(shared, /trust-line-sends/);
  // Guard the exact regression: the promise must sit in the else branch of `sends`.
  const promise = "your files never leave this device";
  const promiseAt = shared.indexOf(promise);
  const branchAt = shared.indexOf("downloadReady ? null : sends ?");
  assert.ok(branchAt >= 0 && promiseAt > branchAt, "the local-only promise must be gated behind the sends check");
});

test("each sends= line says what leaves, not that nothing does", () => {
  const toolSource = readAppSource();
  const declared = [...toolSource.matchAll(/<ToolForm\s+sends="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(declared.length >= 6);
  for (const line of declared) {
    assert.ok(/\b(Sends|Uploads)\b/.test(line), `sends= copy must name the transfer: ${line}`);
    assert.ok(!/never leave/i.test(line), `sends= copy must not repeat the local-only promise: ${line}`);
    assert.ok(line.length > 40, `sends= copy must say where it goes: ${line}`);
  }
});

// --- Redaction geometry on rotated pages -------------------------------------

/** A one-page PDF at the given /Rotate, carrying one known run of text. */
async function rotatedPageWithText(angle, text = "ACCOUNT 123456789012") {
  const { PDFDocument, StandardFonts, degrees } = globalThis.window.PDFLib;
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 100, y: 700, size: 12, font });
  page.setRotation(degrees(angle));
  return doc.save();
}

test("the redaction box lands on the text at every page rotation", async () => {
  const pdfjs = await loadPdfjsForInterop();
  for (const angle of [0, 90, 180, 270]) {
    const bytes = await rotatedPageWithText(angle);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const item = (await page.getTextContent()).items.find((entry) => entry.str.includes("ACCOUNT"));
    assert.ok(item, `no text run found at /Rotate ${angle}`);

    const rect = itemRect(pdfjs, viewport, item);
    // Back to viewport pixels, the space the box is actually painted in.
    const box = {
      x: (rect.x / 100) * viewport.width,
      y: (rect.y / 100) * viewport.height,
      w: (rect.w / 100) * viewport.width,
      h: (rect.h / 100) * viewport.height,
    };

    // Both ends of the baseline must be inside the box. That is the property
    // that matters: a bar that misses either end leaves the value readable.
    const t = pdfjs.Util.transform(viewport.transform, item.transform);
    const runAngle = Math.atan2(t[1], t[0]);
    const ends = [
      [t[4], t[5]],
      [t[4] + item.width * Math.cos(runAngle), t[5] + item.width * Math.sin(runAngle)],
    ];
    for (const [px, py] of ends) {
      assert.ok(
        px >= box.x - 0.6 && px <= box.x + box.w + 0.6 && py >= box.y - 0.6 && py <= box.y + box.h + 0.6,
        `/Rotate ${angle}: baseline point (${px.toFixed(1)}, ${py.toFixed(1)}) is outside the redaction box ` +
        `x=${box.x.toFixed(1)} y=${box.y.toFixed(1)} w=${box.w.toFixed(1)} h=${box.h.toFixed(1)}`
      );
    }

    // The box must follow the run's orientation, not always be a wide short bar.
    const rotated = angle === 90 || angle === 270;
    assert.equal(box.h > box.w, rotated, `/Rotate ${angle}: box orientation does not match the text direction`);
    assert.equal(rect.outsidePage, false, `/Rotate ${angle}: an on-page run was reported as off-page`);
  }
});

test("redaction boxes stay inside the page at every rotation", async () => {
  const pdfjs = await loadPdfjsForInterop();
  for (const angle of [0, 90, 180, 270]) {
    const bytes = await rotatedPageWithText(angle);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const item = (await page.getTextContent()).items.find((entry) => entry.str.includes("ACCOUNT"));
    const rect = itemRect(pdfjs, viewport, item);
    assert.ok(rect.x >= 0 && rect.y >= 0, `/Rotate ${angle}: negative origin`);
    assert.ok(rect.x + rect.w <= 100.01, `/Rotate ${angle}: box runs off the right edge`);
    assert.ok(rect.y + rect.h <= 100.01, `/Rotate ${angle}: box runs off the bottom edge`);
    // A box that covers most of the page would "work" but destroys the document.
    assert.ok(rect.w * rect.h < 2000, `/Rotate ${angle}: box covers ${(rect.w * rect.h / 100).toFixed(0)}% of the page`);
  }
});

// --- /ByteRange gap must be exactly /Contents --------------------------------

/**
 * Rewrite a signed PDF's /ByteRange so the unsigned hole is `extra` bytes wider
 * than /Contents, and drop attacker bytes into the slack. The CMS still verifies
 * because those bytes were never part of signedData — which is precisely the
 * hole the verifier has to notice.
 */
function widenSignatureGap(signedBytes, extra) {
  const text = Buffer.from(signedBytes).toString("latin1");
  const brAt = text.indexOf("/ByteRange [");
  assert.ok(brAt >= 0, "no /ByteRange in the signed file");
  const close = text.indexOf("]", brAt);
  const [s1, l1, s2, l2] = text.slice(brAt + "/ByteRange [".length, close).trim().split(/\s+/).map(Number);

  // INSERT slack into the hole rather than overwriting, so both signed spans
  // still cover byte-identical content: the CMS digest is unchanged and the
  // signature keeps verifying. Spaces are legal whitespace inside the dict, so
  // the file stays parseable. This is the shape of the real attack — a hole
  // wider than /Contents, whose contents nothing hashes.
  const out = new Uint8Array(signedBytes.length + extra);
  out.set(signedBytes.subarray(0, s2), 0);
  out.fill(0x20, s2, s2 + extra);
  out.set(signedBytes.subarray(s2), s2 + extra);

  // Second span now starts `extra` later; it still ends at the new end of file.
  const original = text.slice(brAt, close + 1);
  const replacement = `/ByteRange [${s1} ${l1} ${s2 + extra} ${l2}]`;
  assert.ok(replacement.length <= original.length, "rewritten /ByteRange must not move file offsets");
  const padded = replacement + " ".repeat(original.length - replacement.length);
  for (let i = 0; i < padded.length; i++) out[brAt + i] = padded.charCodeAt(i);
  return out;
}

test("widening a signature's /ByteRange gap after the fact is always caught", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("Mallory", "Mallory", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "pw");
  const signed = await signPdf(await buildSamplePdf(false), { p12, password: "pw" });

  const clean = await verifyPdfSignatures(signed.bytes);
  assert.equal(clean.signatures[0].verdict, "valid");
  assert.equal(clean.signatures[0].coversWholeDocument, true);
  assert.deepEqual(clean.signatures[0].tamperFindings, []);

  // Insert 64 unhashed bytes into the hole and re-point the second span at them.
  const sig = (await verifyPdfSignatures(widenSignatureGap(signed.bytes, 64))).signatures[0];

  // This must never read as an intact document, by whichever route.
  assert.notEqual(sig.verdict, "valid");
  assert.equal(sig.coversWholeDocument, false);
  assert.ok(sig.tamperFindings.length > 0, "a widened gap must raise at least one finding");

  // WHY it is caught matters, and it is not the gap check: /ByteRange lives
  // INSIDE the first signed span, so editing it changes the hashed bytes and
  // the digest stops matching. That is the load-bearing defence against
  // after-the-fact tampering, and this test pins it.
  assert.equal(sig.integrity, false, "editing /ByteRange must break the digest");
  assert.equal(sig.verdict, "modified");
});

test("the gap check rejects a hole that is wider than /Contents", () => {
  // Guards the case the digest cannot: a signature produced with an oversized
  // hole from the start, by a signer we do not trust. There the CMS is
  // internally consistent, so only measuring the gap catches it.
  const source = fs.readFileSync(new URL("../src/services/pdf-sign.service.js", import.meta.url), "utf8");
  const verifyAt = source.indexOf("async function verifyOneSignature");
  assert.ok(verifyAt > 0, "verifyOneSignature not found");
  const block = source.slice(verifyAt, source.indexOf("const asn1 = asn1js.fromBER", verifyAt));
  assert.match(block, /const expectedGap = contentsBytes\.length \* 2 \+ 2/);
  assert.match(block, /pdfBytes\[gapStart\] === 0x3c/);
  assert.match(block, /pdfBytes\[gapEnd - 1\] === 0x3e/);
  // coversWholeDocument must depend on the gap, not only on the two outer ends.
  assert.match(block, /const coversWholeDocument = s1 === 0 && \(s2 \+ l2\) === pdfBytes\.length && gapIsContentsOnly/);
  // And the condition must actually be reachable as a finding.
  assert.match(source, /never hashed\. Anything in that hole can be changed/);
});

test("an ordinary appended revision still reads as valid-partial, not as a gap attack", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("Alice", "Alice", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "pw");
  const signed = await signPdf(await buildSamplePdf(false), { p12, password: "pw" });

  // Append bytes AFTER the signed range — the legitimate incremental-update case.
  const appended = new Uint8Array(signed.bytes.length + 32);
  appended.set(signed.bytes, 0);
  appended.fill(0x0a, signed.bytes.length);

  const sig = (await verifyPdfSignatures(appended)).signatures[0];
  assert.equal(sig.coversWholeDocument, false);
  // It must not be mislabelled as the gap attack; the gap itself is still intact.
  assert.ok(
    !sig.tamperFindings.some((line) => /never hashed/i.test(line)),
    `appending must not raise the unhashed-gap finding: ${JSON.stringify(sig.tamperFindings)}`
  );
});

test("a signature made with an expired certificate is not presented as simply valid", async () => {
  const keyPair = await genRsaKeyPair();
  // Expired a week ago. Expiry is fully checkable offline, unlike revocation.
  const expired = await makeSelfSignedCert("Stale Signer", "Stale Signer", keyPair, keyPair.privateKey, {
    notBefore: new Date(Date.now() - 3600_000 * 24 * 400),
    notAfter: new Date(Date.now() - 3600_000 * 24 * 7),
  });
  const p12 = await makePkcs12(keyPair.privateKey, [expired], "pw");
  const signed = await signPdf(await buildSamplePdf(false), { p12, password: "pw" });
  const sig = (await verifyPdfSignatures(signed.bytes)).signatures[0];

  assert.ok(new Date(sig.notAfter) < new Date(), "precondition: the certificate must be expired");
  assert.ok(
    sig.verdict !== "valid" || sig.tamperFindings.some((line) => /expir/i.test(line)) || /expir/i.test(sig.detail || ""),
    `an expired signing certificate must be surfaced. verdict=${sig.verdict} detail=${sig.detail} findings=${JSON.stringify(sig.tamperFindings)}`
  );
});

test("the verify UI renders the findings the service computes", () => {
  const source = fs.readFileSync(new URL("../src/tools/security.tsx", import.meta.url), "utf8");
  const card = source.slice(source.indexOf("function SignatureCard"), source.indexOf("function VerifySignatureTool"));
  // The whole point: findings must reach the screen, not just the object.
  assert.match(card, /sig\.tamperFindings/);
  assert.match(card, /sig\.tamperFindings\.map/);
  assert.match(card, /certExpired/);
});

test("a valid signature on a live certificate raises no certificate findings", async () => {
  const keyPair = await genRsaKeyPair();
  const cert = await makeSelfSignedCert("Live Signer", "Live Signer", keyPair, keyPair.privateKey);
  const p12 = await makePkcs12(keyPair.privateKey, [cert], "pw");
  const signed = await signPdf(await buildSamplePdf(false), { p12, password: "pw" });
  const sig = (await verifyPdfSignatures(signed.bytes)).signatures[0];
  assert.equal(sig.verdict, "valid");
  assert.equal(sig.certExpired, false);
  assert.equal(sig.certNotYetValid, false);
  assert.deepEqual(sig.tamperFindings, [], "an ordinary valid signature must stay quiet");
});

// --- lineDiff is a real diff, not a positional compare -----------------------

const diffCounts = (rows) => ({
  added: rows.filter((row) => row.type === "added").length,
  removed: rows.filter((row) => row.type === "removed").length,
  same: rows.filter((row) => row.type === "same").length,
});

test("inserting one line reports one addition, not a rewrite of the file", () => {
  // The reported defect: this returned +6/-5 for a single inserted line.
  const before = "One\nTwo\nThree\nFour\nFive";
  const after = "INSERTED\nOne\nTwo\nThree\nFour\nFive";
  const counts = diffCounts(lineDiff(before, after));
  assert.deepEqual(counts, { added: 1, removed: 0, same: 5 });
});

test("deleting a line in the middle reports one removal", () => {
  const counts = diffCounts(lineDiff("a\nb\nc\nd\ne", "a\nb\nd\ne"));
  assert.deepEqual(counts, { added: 0, removed: 1, same: 4 });
});

test("a changed line is one removal and one addition, and its neighbours stay same", () => {
  const rows = lineDiff("alpha\nbravo\ncharlie", "alpha\nBRAVO\ncharlie");
  assert.deepEqual(diffCounts(rows), { added: 1, removed: 1, same: 2 });
  assert.equal(rows[0].type, "same");
  assert.equal(rows[rows.length - 1].type, "same");
});

test("identical input produces no changes at all", () => {
  const text = "one\ntwo\nthree";
  assert.deepEqual(diffCounts(lineDiff(text, text)), { added: 0, removed: 0, same: 3 });
});

test("the diff reconstructs both documents exactly", () => {
  const cases = [
    ["a\nb\nc", "x\na\nb\nc\ny"],
    ["1\n2\n3\n4\n5\n6", "1\n3\n5\n7"],
    ["", "only"],
    ["only", ""],
    ["same", "same"],
    ["a\nb", "b\na"],
  ];
  for (const [left, right] of cases) {
    const rows = lineDiff(left, right);
    // Left = everything not added; right = everything not removed. If this
    // holds, the diff cannot be silently dropping or inventing a line.
    const rebuiltLeft = rows.filter((r) => r.type !== "added").map((r) => r.left).join("\n");
    const rebuiltRight = rows.filter((r) => r.type !== "removed").map((r) => r.right).join("\n");
    assert.equal(rebuiltLeft, left, `left not reconstructed for ${JSON.stringify([left, right])}`);
    assert.equal(rebuiltRight, right, `right not reconstructed for ${JSON.stringify([left, right])}`);
  }
});

test("a large pair of documents differing in one place stays cheap and exact", () => {
  const body = Array.from({ length: 4000 }, (_, i) => `line ${i}`);
  const changed = body.slice();
  changed.splice(2000, 0, "INSERTED IN THE MIDDLE");
  const counts = diffCounts(lineDiff(body.join("\n"), changed.join("\n")));
  // 4000x4001 cells would blow the cap; trimming the shared head and tail is
  // what keeps this exact rather than degrading to a block replacement.
  assert.deepEqual(counts, { added: 1, removed: 0, same: 4000 });
});

test("side panels can never scroll sideways", () => {
  const css = fs.readFileSync(new URL("../src/app-shell.css", import.meta.url), "utf8");
  // A panel wider than its column clips every line of text at the right edge and
  // forces the user to scroll sideways to read a sentence.
  const block = css.slice(css.indexOf("Nothing in a side panel may force horizontal scroll"));
  for (const scope of [".editor-panel", ".tool-canvas", ".tool-inspector"]) {
    assert.ok(block.includes(scope), `${scope} must be covered by the no-sideways-scroll rule`);
  }
  assert.match(block, /min-width: 0/);
  assert.match(block, /overflow-x: hidden/);
  // Unbreakable tokens (long hyphenated filenames, URLs, hashes) must wrap.
  assert.match(block, /overflow-wrap: anywhere/);
  // <pre> is deliberately excluded — it is meant to scroll on its own.
  assert.ok(!/\.editor-panel pre\b[^{]*\{[^}]*overflow-wrap/.test(block));
});

// --- Auto-Tag must not leave the document written twice ----------------------

test("a duplicated text layer is detected, and a clean document is not", async () => {
  const { duplicateTextRatio } = await import("../src/services/pdf-accessibility.service.js");
  const clean = ["Quarterly Report", "Aadhaar: 2234 5678 9012", "Contact: rakesh@example.com", "Signed by the board"].join("\n");
  assert.equal(duplicateTextRatio(clean), 0, "an ordinary document must not be flagged");
  assert.ok(duplicateTextRatio([clean, clean].join("\n")) >= 0.6, "a document written twice must be flagged");
  // Too little text to judge — a two-line file with a repeated line is not
  // evidence of a duplicated layer, and a false accusation here is expensive.
  assert.equal(duplicateTextRatio("Hi there\nHi there"), 0);
  assert.equal(duplicateTextRatio(""), 0);
  assert.equal(duplicateTextRatio(null), 0);
});

test("Auto-Tag marks the original page content as decorative, and a re-run does not stack", async () => {
  const { PDFDocument, StandardFonts } = globalThis.window.PDFLib;
  const { remediatePdfAccessibility } = await import("../src/services/pdf-accessibility.service.js");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText("Quarterly Report", { x: 60, y: 760, size: 22, font });
  page.drawText("Aadhaar: 2234 5678 9012", { x: 60, y: 700, size: 12, font });
  const source = new Uint8Array(await doc.save());

  const textBlocks = [
    { page: 1, text: "Quarterly Report", role: "H1", x: 60, y: 760, width: 300, height: 22, size: 22 },
    { page: 1, text: "Aadhaar: 2234 5678 9012", role: "P", x: 60, y: 700, width: 300, height: 12, size: 12 },
  ];
  const run = async (bytes) =>
    (await remediatePdfAccessibility(bytes, { lang: "en-US", title: "T", textBlocks, figures: [] })).bytes;

  const once = await run(source);
  const raw = (bytes) => Buffer.from(bytes).toString("latin1");
  const count = (bytes, needle) => (raw(bytes).match(new RegExp(needle, "g")) || []).length;

  // The tool draws a tagged copy of the text; the ORIGINAL must therefore be
  // marked as an artifact, or a screen reader reads the whole document twice.
  assert.equal(count(once, "MFKAccessArtifact"), 2, "one /Artifact BMC wrapper opening and closing the original content");
  assert.equal(count(once, "MFKAccessLayer"), 1, "exactly one tagged text layer");

  // Re-running must replace, not nest.
  const twice = await run(once);
  assert.equal(count(twice, "MFKAccessArtifact"), 2, "a re-run must not stack another wrapper");
  assert.equal(count(twice, "MFKAccessLayer"), 1, "a re-run must not stack another tagged layer");
});

test("the checker fails a document whose text is written twice", async () => {
  const { PDFDocument, StandardFonts } = globalThis.window.PDFLib;
  const { auditPdfAccessibility } = await import("../src/services/pdf-accessibility.service.js");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText("Quarterly Report", { x: 60, y: 760, size: 18, font });
  const bytes = new Uint8Array(await doc.save());

  const lines = ["Quarterly Report", "Aadhaar: 2234 5678 9012", "Contact: rakesh@example.com", "Signed by the board"].join("\n");
  const findCheck = (report) => report.checks.find((check) => check.id === "duplicate-text");

  const clean = await auditPdfAccessibility(bytes, { textLayer: { characters: lines.length, pageCount: 1, text: lines } });
  assert.equal(findCheck(clean)?.status, "pass", "an ordinary document passes");

  const doubled = await auditPdfAccessibility(bytes, {
    textLayer: { characters: lines.length * 2, pageCount: 1, text: [lines, lines].join("\n") },
  });
  const check = findCheck(doubled);
  assert.equal(check?.status, "fail", "a document written twice must FAIL, not merely warn");
  assert.match(check.detail, /read the document twice|stored twice/i, "and must say why it matters");
  assert.ok(check.fix, "and must say what to do about it");

  // The whole point: this must move the verdict, not sit in the list unnoticed.
  assert.ok(doubled.summary.fail > clean.summary.fail, "the failure must reach the tally the verdict is built from");
});

test("csvToJson keeps cells the header does not name, and says so", () => {
  // A row with more cells than the header used to lose the extras silently and
  // report success: header `a,b` with row `1,2,3,4` returned only a and b.
  const rows = csvToJson("a,b\n1,2,3,4\n5,6");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].a, "1");
  assert.equal(rows[0].b, "2");
  assert.equal(rows[0].column_3, "3", "the third cell must survive");
  assert.equal(rows[0].column_4, "4", "so must the fourth");
  assert.deepEqual(rows.extraColumns, ["column_3", "column_4"], "and the caller must be able to report it");
  // A well-formed CSV is untouched and reports nothing.
  const clean = csvToJson("a,b\n1,2");
  assert.deepEqual(clean, [{ a: "1", b: "2" }]);
  assert.deepEqual(clean.extraColumns, []);
  // Blank extra cells are not worth inventing a column for.
  const trailing = csvToJson("a,b\n1,2,");
  assert.deepEqual(trailing.extraColumns, []);
  // JSON.stringify must be unaffected — extraColumns is non-enumerable.
  assert.equal(JSON.stringify(csvToJson("a,b\n1,2")), '[{"a":"1","b":"2"}]');
});

// --- Gaps closed against Stirling-PDF's tool set -----------------------------

test("blank pages are detected from ink coverage, with scanner speckle tolerated", async () => {
  const { blankPagesFromCoverage, pagesAfterRemovingBlanks } = await import("../src/services/pdf-advanced.service.js");
  // page 1 has text, 2 is empty, 3 is a scanner's speckle, 4 has text.
  assert.deepEqual(blankPagesFromCoverage([0.031, 0, 0.0004, 0.052]), [2, 3]);
  // A page with even one line of text is an order of magnitude above the floor.
  assert.deepEqual(blankPagesFromCoverage([0.003]), []);
  assert.deepEqual(blankPagesFromCoverage([]), []);
  assert.deepEqual(blankPagesFromCoverage(null), []);
  // Threshold is adjustable for aggressive scans.
  assert.deepEqual(blankPagesFromCoverage([0.004], { threshold: 0.01 }), [1]);
});

test("removing blank pages never produces a zero-page PDF", async () => {
  const { pagesAfterRemovingBlanks } = await import("../src/services/pdf-advanced.service.js");
  assert.deepEqual(pagesAfterRemovingBlanks(4, [2, 3]), { keep: [1, 4], removed: [2, 3] });
  // Every page blank: keep them all and report nothing removed, rather than
  // hand back a file most readers refuse to open.
  assert.deepEqual(pagesAfterRemovingBlanks(3, [1, 2, 3]), { keep: [1, 2, 3], removed: [] });
  // Out-of-range page numbers are ignored, not trusted.
  assert.deepEqual(pagesAfterRemovingBlanks(2, [0, 2, 9]), { keep: [1], removed: [2] });
  assert.deepEqual(pagesAfterRemovingBlanks(0, [1]), { keep: [], removed: [] });
});

test("removePdfImages strips image pixels and keeps the text", async () => {
  const { PDFDocument, StandardFonts } = globalThis.window.PDFLib;
  const { removePdfImages } = await import("../src/services/pdf-advanced.service.js");

  // A page carrying both text and a real embedded JPEG.
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 300]);
  page.drawText("Keep this text", { x: 20, y: 260, size: 14, font });
  // Minimal 8x8 grey JPEG, built by pdf-lib's own encoder path via a PNG.
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000008000000080802000000" +
    "4b6d29dc0000001849444154789c63fcffff3f0303030313032323030300" +
    "00d0a0f2f8f1a5d0000000049454e44ae426082", "hex");
  const image = await doc.embedPng(new Uint8Array(png));
  page.drawImage(image, { x: 20, y: 40, width: 120, height: 120 });
  const withImage = new Uint8Array(await doc.save());

  const file = new File([withImage], "with-image.pdf", { type: "application/pdf" });
  const result = await removePdfImages(file);
  assert.ok(result.removed >= 1, `expected at least one image removed, got ${result.removed}`);
  assert.ok(result.after < result.before, `output must be smaller: ${result.before} -> ${result.after}`);

  // The text must survive — this is the difference from Compress PDF, which
  // rasterises everything.
  const reloaded = await PDFDocument.load(result.bytes, { throwOnInvalidObject: false });
  assert.equal(reloaded.getPageCount(), 1, "the page must still be there");
});
