<pre align="center">
 __  __       _____ _ _      _  ___ _ _
|  \/  |_   _|  ___(_) | ___| |/ (_) | |_
| |\/| | | | | |_  | | |/ _ \ ' /| | __|
| |  | | |_| |  _| | | |  __/ . \| | |_
|_|  |_|\__, |_|   |_|_|\___|_|\_\_|\__|
         |___/

              L O C A L - F I R S T   F I L E   T O O L K I T
</pre>

<p align="center">
  <strong>Private file work, in one local browser workspace.</strong><br />
  PDF, conversion, OCR, image, business, signature, privacy, text, data, and developer tools that run where your files already are.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#available-tools">Tools</a> ·
  <a href="#local-engines">Engines</a> ·
  <a href="#privacy-and-security">Privacy</a> ·
  <a href="#production-build">Deploy</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

[![Version](https://img.shields.io/badge/version-3.4.0-2563eb)](./package.json)
[![Tests](https://img.shields.io/badge/tests-87%20passing-16a34a)](./tests/core.test.js)
[![Tools](https://img.shields.io/badge/tools-77%20local-2563eb)](./src/registry/tools.registry.js)
[![Security](https://img.shields.io/badge/npm%20audit-0%20known%20vulnerabilities-16a34a)](./SECURITY.md)

MyFileKit is a local-first browser toolkit for common file workflows. It combines 77 working tools in one searchable interface and processes selected files in the browser wherever the underlying format allows it.

## Product Principles

- **Local-first:** supported workflows run without a server upload path.
- **Working tools only:** every visible tool card opens an implemented workflow.
- **Clear exports:** processed files expose review, download, and print actions where the output format supports them.
- **Honest scope:** the interface does not advertise unfinished converters, universal editing, or unsupported file formats.
- **Portable:** the project runs with Node.js on macOS, Windows, and Linux.

## Available Tools

77 tools across 8 categories. This table is checked against `src/registry/tools.registry.js`, which is the single source of truth for the dashboard.

| Category | Tools |
| --- | --- |
| PDF (35) | Merge PDF, Split / Extract PDF Pages, Delete PDF Pages, Rotate PDF Pages, Add Text to PDF, Add Signature to PDF, Add PDF Page Numbers, Watermark PDF, PDF to Image, Compress PDF, PDF to ZIP, Flatten PDF, Invert PDF Colours, Images to PDF, Organize Pages, Crop & Resize PDF, Headers & Footers, Fill PDF Form, Redact PDF, Create PDF, HTML to PDF, Word to PDF, Excel to PDF, PowerPoint to PDF, eBook to PDF, PDF to Word, PDF to Excel, PDF to HTML, PDF to EPUB, OCR / Searchable PDF, PDF to Audio, Handwriting to PDF, Scan to PDF, Repair PDF, Workflow Builder |
| Image (10) | Compress Image, Batch Compress Images, Resize Image, Batch Resize Images, Convert Image, Crop Image, Rotate / Flip Image, Add Text to Image, Image Metadata Inspector, Equation to Image |
| Business (4) | Invoice Generator, GST Invoice, POS Billing, GST Filing Prep |
| Signature (3) | Add Signature to Image, Draw Signature, Type Signature |
| Text & Data (15) | Extract Text from PDF, PDF Summarizer, Ask Your PDF, Text to PDF, Markdown Preview, Markdown to PDF, CSV to PDF, Audio to PDF, JSON Formatter, CSV to JSON, JSON to CSV, JSON to YAML, URL Encode / Decode, Text Diff Checker, Word Counter |
| Privacy (3) | PDF Metadata Cleaner, PDF Fingerprint, EXIF & Metadata Cleaner |
| Developer Utilities (5) | Base64 Encode / Decode, File Hash Generator, Hash Compare, Password Generator, QR Code Generator |
| Sharing & Collaboration (2) | P2P File Share, Whiteboard |

Image Metadata Inspector reads EXIF, XMP, ICC, GPS, and container metadata from supported JPEG, PNG, and WebP files locally, without changing the source file. EXIF & Metadata Cleaner uses the same local inspection capability and can re-encode a cleaned image copy; re-encoding may change file size or encoding details. The PDF metadata cleaner removes common document information fields; it does not sanitize visible content, attachments, or every possible custom PDF object. PDF Fingerprint embeds a traceable identifier in PDF metadata; it is a provenance marker, not a steganographic or tamper-proof mark.

P2P File Share and Whiteboard are the only tools whose data can leave the device, and only to the one peer you hand a code to. There is still no server: WebRTC signaling is manual, so you generate an invite code, pass it to your peer yourself over a channel you already trust, and paste their answer code back. No STUN or TURN server is built in, which means the connection relies on local network addresses and works reliably only when both devices are on the same network; you may supply your own STUN/TURN server (off by default, and it will see your IP address). Received files are hash-checked with SHA-256 on both ends, have their filename stripped of any path, and are only ever offered as a download.

Workflow Builder chains PDF operations into a single pipeline over one file and pipes the bytes between steps. It reports which step failed and keeps the output produced up to that point.

## Quick Start

Requirements:

- Node.js 18 or newer
- npm
- A current version of Chrome, Edge, Firefox, or Safari

```bash
git clone https://github.com/indranilroy99/myfilekit.git
cd myfilekit
npm install
npm run dev
```

Open the URL printed by Vite, normally [http://localhost:4173](http://localhost:4173).

The commands are the same on macOS, Windows PowerShell, and Linux. Optional setup helpers are also included:

```bash
# macOS or Linux
./setup.sh

# Windows PowerShell
.\setup.ps1
```

## Production Build

```bash
npm run build
npm run preview
```

Deploy the generated `dist/` directory to any static host. The build includes the React dashboard, the invoice editor, and every vendored local engine — PDF, capture, spreadsheet, and the OCR engine with its English model. The OCR assets are the bulk of the output size; see [Local Engines](#local-engines). Navigation uses URL hashes, so static hosts do not need route rewrites for tool pages.

For production hosting, configure the response headers documented in [SECURITY.md](./SECURITY.md).

## Release Checks

```bash
npm run setup
npm run check
npm run test
npm run security:audit
npm run preflight
```

| Script | Purpose |
| --- | --- |
| `npm run setup` | Checks the runtime, installed dependencies, and required local assets. |
| `npm run check` | Validates source syntax, TypeScript, the Vite build, copied production assets, and the invoice script. |
| `npm run test` | Runs registry, route, validation, conversion, security-helper, PDF, Office/export, speech, GST/POS, workflow, and metadata tests. |
| `npm run security:audit` | Verifies the sha256 integrity of every vendored local asset and runs `npm audit --audit-level=moderate`. |
| `npm run preflight` | Runs the complete release gate. |

The browser QA checklist is in [docs/manual-test-checklist.md](./docs/manual-test-checklist.md).
Release notes are maintained in [CHANGELOG.md](./CHANGELOG.md).

## Architecture

```text
src/registry/tools.registry.js   Tool names, routes, categories, keywords, and capabilities
src/App.tsx                      Dashboard, category pages, tool pages, and hash navigation
src/lib/pdfjs.ts                 Lazy pdf.js loader with a locally bundled worker (no CDN)
src/lib/routing.ts               Hash-route helpers shared by the dashboard and tool pages
src/services/pdf.service.js      Core pdf-lib page operations (merge, split, rotate, text, watermark)
src/services/pdf-edit.service.js Organize, crop/resize, headers & footers, forms, repair
src/services/pdf-render.service.js  pdf.js rasterising and text extraction (image, compress, flatten, invert, redact, ZIP)
src/services/convert.service.js  Create PDF, Markdown to PDF, CSV to PDF, table layout
src/services/capture.service.js  Sandboxed HTML rendering and camera capture for HTML/Scan to PDF
src/services/office.service.js   docx / xlsx / pptx / epub readers for Office and eBook input
src/services/export.service.js   PDF text to .docx, .xlsx, .html, and .epub output builders
src/services/ocr.service.js      Local tesseract worker, OCR, and searchable-PDF rebuild
src/services/audio.service.js    Browser speech synthesis and recognition helpers
src/services/business.service.js GST invoice, POS billing, and GSTR-1-style filing summaries
src/services/                    Also image, csv, download, metadata, text-tools, and validation
invoice-generator/index.html     Standalone invoice editor and preview-matched PDF export
assets/vendor/                   Local browser engines (pdf-lib, html2canvas, SheetJS, tesseract)
scripts/                         Setup, build, version, and security release checks
tests/                           Node.js regression tests
```

The dashboard is rendered from the central registry. Recently used tools and theme preference are stored in browser `localStorage`; selected file contents and generated outputs are not persisted there.

## Local Engines

Every engine the app needs at runtime is vendored into `assets/vendor/` and served from the app's own origin. Nothing is loaded from a CDN, so tools keep working offline and the app's Content Security Policy can stay restrictive with no third-party script origins to trust.

| Engine | Used by | Why it is vendored |
| --- | --- | --- |
| `pdf-lib.min.js` | Every PDF read/write tool and the invoice export | Offline PDF construction; no remote script origin in the CSP. |
| `html2canvas.min.js` | HTML to PDF, invoice preview-matched export | Renders DOM to canvas locally so exports match the on-screen preview. |
| `xlsx.full.min.js` (SheetJS 0.20.3) | Excel to PDF, PDF to Excel, GST Filing Prep | The npm `xlsx` package is frozen at 0.18.5 with unfixed prototype-pollution and ReDoS advisories. SheetJS 0.20.3 is vendored directly from the upstream distribution instead, which keeps `npm audit` clean and gets the fixed parser. |
| `tesseract/` (tesseract.js 7.0.0 + core WASM + `eng.traineddata.gz`) | OCR / Searchable PDF | tesseract.js normally downloads its worker, WebAssembly core, and language model at run time. The engine and English model (~14 MB on disk, including three SIMD core variants) are vendored so OCR never touches a CDN. |
| `pdfjs-dist` worker (bundled via `src/lib/pdfjs.ts`) | Rasterising and text extraction | Built into the app bundle rather than fetched from a CDN, and loaded lazily. |

`scripts/security-audit.js` pins a sha256 digest for each vendored asset and fails the release gate if any file is missing or its digest changes, so a silent swap of a local engine cannot pass `npm run preflight`. The pdf-lib and html2canvas script tags additionally carry Subresource Integrity hashes.

The OCR tool is the one place the size shows: the first run in a browser session loads about 7 MB from this origin (one WebAssembly core variant plus the English model) before recognition starts. The tool states this before it begins, the load is one-time per session, and the worker is terminated when you leave the tool.

## Privacy And Security

MyFileKit has no application backend, account system, analytics integration, or remote file storage. File contents stay in the active browser session unless a user explicitly downloads an output.

This local-first model reduces network exposure, but it does not make untrusted files inherently safe. Keep the browser updated, avoid opening suspicious outputs, and review [SECURITY.md](./SECURITY.md) before deploying publicly.

## Current Boundaries

The tool list has grown, so this section lists what MyFileKit still does not do, and where a shipped tool is deliberately best-effort rather than exact.

**Not shipped at all**

- **No PDF password encryption or decryption.** pdf-lib cannot write or remove PDF encryption, and doing it properly needs a WASM crypto engine. There is no "lock PDF" or "unlock PDF" tool, and none of the existing tools should be read as protecting a document. Tools that open an already-encrypted PDF do so by ignoring its encryption, which only works for files the browser can already read.
- **No hosted AI and no multi-user sessions.** PDF Summarizer and Ask Your PDF run local extractive algorithms (TextRank and BM25); a hosted model is only ever used if you point the optional bring-your-own-LLM adapter at your own endpoint. P2P File Share and Whiteboard pair exactly two browsers by hand-carried code. There are no rooms, no persistence, no presence, no more than one peer, and no relay to fall back on, because all of those need a server.
- **No background removal, no OCR-based text replacement inside an existing image, and no full free-form editing of existing PDF text.** OCR reads text and can build a searchable layer over the original page; it does not rewrite the page.
- **No universal metadata removal.** The privacy tools cover documented image metadata containers and common PDF document-information fields only.

**Shipped, with honest limits**

- **Office and eBook conversion fidelity is best-effort.** PowerPoint layouts and EPUB CSS are approximated, not reproduced. Legacy binary `.doc` and `.ppt` files are rejected with a message asking you to re-save as `.docx` or `.pptx`. PDF to Word and PDF to EPUB are text-focused: they carry the text and page structure, not the original visual layout. PDF to Excel rebuilds tables by clustering text coordinates into columns — a heuristic that works well on ruled or tabular PDFs and poorly on free-flowing prose.
- **PDF text drawing is Latin-1 (WinAnsi) only.** The standard pdf-lib fonts cannot encode CJK characters or emoji; the affected tools say so instead of failing cryptically.
- **PDF to Audio plays but cannot export.** Playback uses the browser's own speech engine and the operating system's voices. The Web Speech API gives no access to the rendered samples, so there is no audio file to download. Audio to PDF uses browser dictation, which may be unavailable — or not fully on-device — depending on the browser; the tool warns you about what your browser actually does and always offers a manual transcript path that stays entirely offline.
- **Rasterising tools discard the original selectable text.** Compress PDF, Flatten PDF, Invert PDF Colours, Redact PDF, and the searchable PDF that OCR produces all rebuild pages as images. That is what makes redaction permanent. The OCR output adds an invisible recognised-text layer back on top, so it is searchable again, but that text is the OCR engine's reading of the page rather than the source file's own.
- **Peer connections are manual and best on one network.** P2P File Share and Whiteboard have no signaling server, so you copy an invite code to your peer and paste their answer code back yourself. No STUN or TURN server is built in, so the connection is offered local network addresses only: expect it to work on the same Wi-Fi or LAN and to fail across most home routers or mobile networks unless you supply your own STUN/TURN server (off by default; anything you enter is contacted directly by your browser and will see your IP address). There is no relay, no resume, and no queue: a dropped connection stops the transfer, nothing partial is saved, and each side must generate fresh codes. Files are held in memory on both ends, capped at 256 MB each, and sent one after another. Requires a browser with WebRTC data channels; the tool says so instead of failing silently.
- **Whiteboard pairing syncs strokes, not history.** Strokes, undo, and clear are broadcast as they happen, so a peer who joins later sees only what is drawn from then on. Your own work is never removed by anything a peer does, and if they disconnect the board stays exactly as it is.
- **GST scope is deliberately narrow.** The GST tools handle CGST/SGST and IGST splits, round-off, and amount in words, in INR only. Reverse charge, GST cess, TCS/TDS, the composition scheme, and e-invoice IRN/QR generation are not applied. GST Filing Prep produces a GSTR-1-style B2B/B2C and rate-wise summary for you to file with; it does not file anything with the government.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md), run `npm run preflight`, and keep every visible registry entry connected to a working route. Security reports should follow [SECURITY.md](./SECURITY.md).

## Versioning

The current version is `3.4.0`. See [CHANGELOG.md](./CHANGELOG.md) and use the repository scripts to create intentional releases:

```bash
npm run version:patch
npm run version:minor
npm run version:major
```
