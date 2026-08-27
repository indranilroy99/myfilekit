# Changelog

All notable MyFileKit changes are documented here. The project uses semantic versioning.

## 3.13.0 - 2026-08-27

### Added

- **Multi-language OCR** (Phase 7): OCR / Searchable PDF now lets you pick the recognition language, or a combination such as `eng+hin`, instead of English only. Eight new models are vendored locally alongside English — Hindi, Spanish, French, German, Portuguese, Simplified Chinese, Arabic, and Russian — all from `@tesseract.js-data/<code>@1.0.0` (variant `4.0.0_best_int`), byte-verified against the already-vendored English core. The picker only offers languages that have a vendored model and shows the one-time download size; only the selected language is fetched, only when OCR runs, from the local path, so there is no CDN traffic and the eager bundle does not grow.

### Security

- Each new model's sha256 is pinned in `scripts/security-audit.js` and its path in the build check, so the release gate now verifies all 17 vendored OCR assets. The `tesseract/` directory is about 27 MB on disk (+12.4 MB for the added models). Five new tests assert every model exists as an integrity-checked gzip, that the language list is one-to-one with the vendored directory, and that the service still names no CDN or `tessdata` URL. `npm audit` remains at zero vulnerabilities.

## 3.12.0 - 2026-08-27

### Added

- **Digital Signature and Verify Signature** (Phase 6): real cryptographic PDF signing, replacing the previous behaviour of only stamping a signature image. Digital Signature loads a PKCS#12 (`.p12`/`.pfx`) plus password, adds a signature dictionary via an incremental update that leaves the original bytes and any existing signatures untouched, SHA-256s the ByteRange spans, and produces a detached CMS `SignedData` (signed attributes: contentType, signingTime, messageDigest) carrying the certificate and any chain from the p12. Optional visible appearance. Verify Signature recomputes the ByteRange digest and CMS signature per field and reports integrity (unchanged versus modified-after-signing), signer CN/issuer/serial/validity, and signing time. Output is recognised as digitally signed by real readers and was independently confirmed with poppler `pdfsig`.

### Security

- Dependency gate held: `node-forge` was **rejected** (seven high-severity advisories, no fixed version) to keep the repo at zero vulnerabilities. `pkijs` + `asn1js` (WebCrypto-based, audit-clean, identical in Node and the browser) are used instead.
- Honest limits are stated in the UI: self-signed certificates show as valid with unknown identity; offline verification is cryptographic-integrity only and does not validate a trust chain to a root (no CA store) or check revocation (no OCSP/CRL); signatures are not RFC 3161 timestamped; RSA keys only (EC refused, not mishandled).
- Eight new tests (199 total) cover the sign→verify round trip, tampering a covered byte (reported as modified), tampering `/Contents` (invalid), a wrong password (clean error), ByteRange coverage, an unsigned file, chain carry-through, and an object-stream PDF.

## 3.11.0 - 2026-08-27

### Added

- **Annotate PDF** (Phase 5): a real markup layer on top of the existing Add Text and Add Signature tools — highlight, freehand ink (DPI-correct, decimated), rectangle/ellipse/line/arrow, text notes, and sticky notes with a leader line, with select/move/delete, undo/redo, and page navigation. Export burns the markup into page content via pdf-lib (highlights drawn first with a Multiply blend so text stays readable).

### Security

- New `src/services/annotate.service.js` treats all annotation input as untrusted: coordinates are clamped to the page, widths and font sizes are bounded, colours are validated with an accent fallback, note text is control-stripped and truncated, freehand is decimated to at most 2000 points, and each page is capped at 500 annotations. Seven new tests (191 total) cover the hostile-input normaliser, the content-stream output, the screen-to-page y-flip, and the non-Latin friendly error.

### Changed

- Annotations are labelled in the UI as flattened markup: they render identically everywhere and cannot be tampered with as data, but are not reader-editable `/Annot` objects; removal routes to Redact PDF, and note text is Latin-1.

## 3.10.0 - 2026-08-27

### Added

- **Edit PDF Text** (Phase 4): edit, replace, or delete existing text in a PDF. pdf.js locates each text run (position, size, font); on export pdf-lib covers the original glyphs with a background-sampled rectangle and redraws the new text at the same baseline and size with a base-14 substitute font. Multi-run, multi-page edits in one session. The coordinate transform was verified empirically against a known-position PDF including a `/Rotate 90` page.

### Changed

- Stated plainly in the UI: this is overlay editing, not reflow. Surrounding text never moves, so a longer replacement can overflow and a shorter one leaves a gap; the font is an approximate base-14 substitution; the original text is visually covered but still in the file (routes to Redact PDF for true removal); scanned pages route to OCR; Latin-1 only. Five new tests (184 total).

## 3.9.0 - 2026-08-27

### Added

- **Batch Processing** (Phase 3): apply one operation to up to 100 files and download all results as a ZIP, closing the multi-file gap that Workflow Builder (single-file) left open. New `src/services/batch.service.js` provides a named-op registry and a `runBatch` loop with per-file error isolation, a file-type guard, and a file-count cap. Ten ops (rotate, page numbers, watermark, metadata-clean, encrypt, compress, flatten, image compress, convert, resize) reuse the existing single-file service functions unchanged, so batch output matches the single-file tools exactly. Files run sequentially with determinate progress; a per-file failure is recorded and the batch continues; the end report lists succeeded versus failed with reasons. Six new tests (179 total).

## 3.8.0 - 2026-08-27

### Added

- **Compare PDFs** (Phase 2): per-page text diff (added/removed/changed with the differing page list) plus a browser visual pixel diff that tints changed regions; handles identical files, differing page counts, and text-less pages.
- **Deskew / Straighten** (Phase 2): a projection-profile skew estimator (maximising horizontal-projection variance over −10…+10°, verified to recover synthetic +4° and −3° within tolerance) that then rasterises and rotates each page straight, with a manual angle override.
- **PDF/A Archival Prep** (Phase 2): best-effort archival hygiene, explicitly **not** certified PDF/A. Adds an sRGB OutputIntent with an embedded ICC profile, XMP with the pdfaid part/conformance identifier, and Info/MarkInfo/ID; strips OpenAction, `/AA`, `/Names/JavaScript`, and JavaScript/Launch actions and reports them; refuses encrypted input. Optional raster mode for a guaranteed self-contained file. Does not claim font embedding or a validation pass. Nine new tests (173 total).

## 3.7.0 - 2026-08-27

### Added

- **Smart Split PDF** (Phase 1): split by every-N pages, K equal parts, at specific pages, or one file per top-level bookmark; outputs a ZIP of parts.
- **Bates Numbering** (Phase 1): legal sequential stamping with prefix, zero-padding, suffix, position, and start page/number; reports the first and last Bates numbers.
- **N-up / Booklet** (Phase 1): imposition via `embedPage` — 2/4/6/8/9/16-up grids and correct booklet fold ordering (8 pages → `[8,1,2,7,6,3,4,5]`, padded to multiples of four).
- **Bookmarks / Outline** (Phase 1): build or replace the `/Outlines` tree (one level of nesting) with correct First/Last/Count/Parent/Next/Prev/Dest links.
- **Create PDF Form** (Phase 1): design fillable text/checkbox/dropdown/radio fields onto a PDF or blank page; the output is fillable by real readers and by the existing Fill PDF Form tool (verified round-trip).
- All five live in `src/services/pdf-advanced.service.js`, are offline and pure/Node-testable, and add no new dependencies. Twelve new tests (164 total). Honest limits: outline nesting is one level deep, imposition needs pages with content, and destination resolution is best-effort for exotic dest forms.

## 3.6.2 - 2026-08-27

### Added

- Reusable `Input` and `Label` form primitives (OriginUI/shadcn class names, resolved through the existing Tailwind v4 `@theme` map so they render on the single-accent palette with no new tokens or dependencies), plus a dependency-free `cn()` in `src/lib/utils.ts`. 152 tests pass, build clean.

## 3.6.1 - 2026-08-27

### Changed

- Rebuilt the tool-card spotlight glow the right way: a single accent hue via `color-mix(var(--primary)...)` with no hue-sweep, styled by a scoped `.spotlight-card::before` in CSS (no injected markup), driven by an element-scoped React `onPointerMove` instead of a document-level listener per card. Respects `prefers-reduced-motion` and sits below the content link so it never affects interaction. Replaces the previously removed rainbow/per-card-global-listener version.

## 3.6.0 - 2026-08-27

### Fixed

- **Search was broken.** `filterTools` required every whitespace token to be a substring, so queries like "unlock my pdf" or "check this pdf for malware" returned zero results and the flagship tools were unfindable. Search now strips stopwords, scores content tokens (name > keyword > description), and maps security intent (malware → Analyser, unlock → Remove Password, redact/pii → Auto-Redact, protect → Encrypt). Extracted to `src/lib/search.js` so it is Node-testable.

### Changed

- Production-grade UI pass acting on two independent design critiques. Removed four dropped-in "vibe-coded" library components (an unlabeled expand-on-hover download circle, a morphing "modern" button, a per-card cursor-glow card, and an icon-only sliding-highlight nav) and replaced each with the existing calm system component. Enforced single-accent discipline (severity ramp neutralised, gold highlight → accent, teal background radials removed). A shared accessible progress bar now shows determinate progress for every heavy op, and weighty security consequences are shown as persistent result notes rather than transient status lines. 152 tests pass (2 new for search).

## 3.5.2 - 2026-08-26

### Added

- **PDF Analyser**: a 100% client-side static triage tool for suspicious PDFs — the file is never uploaded, parsed by a trusting parser, or executed. Reads raw bytes and tolerates malformed structure, and reports active content (`/JavaScript`, `/JS` in literal, hex, and Flate-stream forms, `/OpenAction`, `/AA`), launch/navigation actions (`/Launch`, `/SubmitForm`, `/URI`, `/GoToR`, `/RichMedia`, …), embedded files (with name, size, SHA-256, and magic-byte class), obfuscation and evasion (`#xx` name-hex decoding, rare filter chains, object streams inflated and rescanned), and structure anomalies (multiple `%%EOF`, appended data, `/Encrypt`). The verdict is honest and non-numeric, always paired with a static-triage disclaimer. Extracted JS/HTML is shown inert as React text nodes, never executed or rendered. Bounded work (8 MB per-stream inflate cap, capped findings) so an adversarial file cannot crash or hang it. Twelve new tests (150 total).

## 3.5.1 - 2026-08-26

### Added

- **Auto-Redact PII**: detects PII with real validation (Verhoeff for Aadhaar, Luhn + IIN brand for cards, mod-36 for GSTIN, plus shape+context for PAN/IFSC/passport/phone/email/DOB/IPv4), shows every hit grouped by type with page, masked value, and confidence, and redacts by true removal (rasterise + opaque boxes, reusing the Redact PDF path). Maps a match to whole text items and over-redacts rather than leaving PII partly visible. Scanned/no-text PDFs route to OCR.
- **Privacy Scanner**: a read-only report of PII, Info-dict and XMP metadata leaks, hidden/invisible text, embedded URLs/IPs and `/URI`/`/Launch` annotations, attachments, and encryption/signature entries, with an honest "what this means" summary and no fake score. Downloads as `.txt`/`.pdf`.
- All local, no new dependency. New `src/services/pii.service.js` keeps every detector pure and Node-testable. PII is masked by default with an explicit reveal toggle. Nineteen new tests (138 total), including a false-positive suite asserting ordinary prose yields zero high-confidence hits. Honest limits stated in the UI: only Aadhaar/cards/GSTIN have real checksums; the rest are shape+context; names/addresses/free-text and anything inside images or attachments are not detected.

## 3.5.0 - 2026-08-26

### Added

- **Real PDF encryption, decryption, and unlock**, implementing the PDF standard security handler locally with no backend and no new npm dependency (MD5 and RC4 hand-written, SHA-2 and AES-CBC from WebCrypto, fflate reused for inflate). Ships three tools in the renamed **Security & Privacy** category:
  - **Encrypt PDF**: AES-256 (`/V 5 /R 6`) by default, AES-128 (R4/AESV2) for compatibility, RC4-128 as an explicitly-labelled legacy option, with user and owner passwords and real `/P` permission bits.
  - **Remove Password**: decrypts a document you can already open, at the object level (text, fonts, images, and structure preserved, nothing rasterised). It does not crack or bypass anything, and the UI says so.
  - **Unlock PDF**: strips owner-password permission restrictions from a file that opens without a user password.
- Read support for R2/R3 (RC4 40/128), R4 (RC4-128 and AES-128 with crypt filters), R5, and R6 (Algorithm 2.B), via the user or owner password. Unsupported cases are refused by name rather than silently producing a broken file. Validated against RFC 1321 (MD5), the classic RC4 vector, ISO 32000-1 permission tables, and a full byte-identical encrypt→decrypt round trip at all six revisions, and independently confirmed with pdf.js.

### Changed

- Renamed the "Privacy Tools" category to **Security & Privacy** across the registry, icons, category details, and tests; a test asserts the old name no longer appears in source.

### Fixed

- Adversarial functional testing (~470 real-input checks across three agents) surfaced eleven defects, fixed here. Performance: `markdownToPdf`/`csvToPdf`/`gstInvoicePdf` split an over-long token one character at a time (O(N³)) — an 8000-char token froze the main thread for 52 s (156 s for GST invoices); a binary search brings both to ~50–130 ms with byte-identical output. Correctness: `textToPdf` wrapped by character count instead of width and clipped wide/uppercase lines; `cleanPdfMetadata` left the XMP packet so author/title survived a "clean"; `epubToHtml` dropped percent-encoded chapters/images; positional regexes in EPUB/PPTX parsing broke on attribute order and quote style; `readWorkbookSheets` accepted a renamed PDF as a spreadsheet. Error quality: header/footer, form-fill, and `pdfTo*` tools now give friendly messages instead of leaking pdf-lib/parse errors. Hardening: workflow op lookups use `Object.hasOwn` (rejecting `__proto__`), `safeFilename` no longer returns a dot-only stem, and the LLM gate compares `enabled !== true`. Seventeen new tests, including explicit time bounds so the performance regression cannot come back silently.

## 3.4.0 - 2026-08-26

### Added

- **P2P File Share** (`Sharing & Collaboration`): sends files straight from one browser to another over a WebRTC data channel. There is no signaling server, because there is no backend and `connect-src` is pinned to `'self'`: the sender generates a deflate+base64url invite code carrying its full local description (vanilla ICE, so gathering completes first with a 5 s timeout fallback), the user hands that code to their peer themselves, and the peer's answer code comes back the same way. Files are chunked at 16 KB with `bufferedAmountLowThreshold` backpressure, show live progress and throughput on both sides, and are verified with a SHA-256 computed independently at each end. Handles cancel, peer disconnect mid-transfer, connection failure, and several files sequentially.
- **Whiteboard** (`Sharing & Collaboration`): pointer-event canvas with pen, eraser, undo, redo, clear, and PNG/PDF export, working solo with zero setup. Strokes and pen widths are stored as fractions of the board, so the drawing survives a resize, stays crisp at any `devicePixelRatio`, and renders identically on a peer's differently sized canvas. Optional pairing reuses the same manual-signaling channel and streams stroke fragments so a peer's line appears as it is drawn, rendered slightly lighter; a peer disconnecting never removes local work.
- `src/services/webrtc.service.js` and `src/services/whiteboard.service.js`, both split into a pure, Node-testable half (signaling codes, frame framing, reassembly, hashing, sanitising, stroke model) and a browser-only half that never runs at import time.

### Security

- **No third-party server is baked in.** No STUN, TURN, or signaling host appears anywhere in the source, and a test asserts it. A user may supply their own STUN/TURN server; it is off by default, scheme-restricted to `stun:`/`stuns:`/`turn:`/`turns:`, capped at four entries, and labelled as contacting a third party that will see their IP address. Neither new service makes an HTTP call.
- **The remote peer is treated as untrusted input.** Received filenames are reduced to their last path segment plus a short extension and run through `safeFilename`; MIME types are narrowed to a strict token pattern or fall back to `application/octet-stream`; peer text is stripped of control characters and bidi overrides; incoming sizes are capped at 256 MB with a clear message. Nothing from a peer is ever rendered as HTML, and a received file is only ever offered as a download — never opened. Whiteboard strokes from a peer have colours, widths, coordinates, and point counts validated or clamped before touching a canvas. Signaling codes are length-capped before decoding and inflated into a fixed 128 KB buffer, so a crafted code cannot expand into a large allocation.
- Every `RTCPeerConnection`, `RTCDataChannel`, event listener, `ResizeObserver`, object URL, and offscreen export canvas is released on reset, cancel, and unmount.

## 3.3.0 - 2026-08-26

### Added

- **GST Invoice**: Indian tax invoice with correct intra-state CGST+SGST versus inter-state IGST split (state code derived from GSTIN), HSN/SAC codes, round-off, and amount in words using Indian lakh/crore grouping. All money is held as integer paise, so the displayed components always reconcile with the total. GSTIN validation (shape, state code, checksum) warns rather than blocks.
- **POS Billing**: counter billing with a `localStorage` item catalogue, bill-level discount, payment mode with cash-change calculation, an 80 mm thermal-style receipt PDF, and a daily session roll-up.
- **GST Filing Prep**: imports a CSV/XLSX of sales invoices and produces a GSTR-1-style B2B/B2C and rate-wise summary, plus a needs-review list for malformed GSTIN values, unparseable dates, and tax figures that do not match taxable value × rate. It prepares a summary for filing; it does not file anything with the government.
- **Workflow Builder**: chains PDF operations over a single input, piping bytes from one step to the next, with per-step progress and a failure report that keeps the output of the steps that already succeeded.

### Changed

- README rebuilt against the registry: the tool table, per-category counts, architecture tree, and badges now reflect all 73 tools. The "Current Boundaries" section previously claimed OCR and Office conversion were not supported, which stopped being true in 3.2.3/3.2.4; it now states the real remaining limits.
- SECURITY.md documented `Permissions-Policy: camera=(), microphone=()`, which would have blocked Scan to PDF and dictation in production. It now matches the shipped `public/_headers` (`camera=(self), microphone=(self)`) and lists every vendored engine.

## 3.2.4 - 2026-08-26

### Added

- PDF to Word (real `.docx` with page breaks), PDF to Excel (coordinate clustering into table rows), PDF to HTML (self-contained, escaped, no remote references), and PDF to EPUB (valid EPUB 3 with `mimetype` stored first, OPF spine, and nav).
- OCR / Searchable PDF using a fully offline tesseract engine, with a searchable-PDF output.
- PDF to Audio using the browser speech synthesiser, and Audio to PDF using browser dictation with an always-available manual transcript path.

### Fixed

- OCR could hang forever when the engine failed to initialise, because tesseract.js swallows that error. The worker now surfaces a clear failure instead.
- An experimental `SpeechRecognition` availability probe could wedge the renderer; replaced with a synchronous capability check plus an explicit "require on-device recognition" option.

### Security

- The OCR engine and English model are vendored locally (about 14 MB, SHA-256 pinned, `workerBlobURL: false`, explicit local worker/core/language paths) so recognition never contacts a CDN. Verified by removing the local assets and confirming a clean local-path error with no CDN fallback.
- `font-src 'self' data:` added to the CSP, because pdf.js hands the browser embedded PDF fonts as `data:` URLs while rasterising. `Permissions-Policy` now scopes camera and microphone to `(self)` so Scan to PDF and dictation work in production; geolocation stays denied.

## 3.2.3 - 2026-08-26

### Added

- Word to PDF (mammoth), Excel to PDF (per-sheet tables), PowerPoint to PDF (pptx unzip with best-effort slide layout), and eBook to PDF (EPUB spine order, images inlined, remote references stripped). Heavy parsers are lazily loaded, so the eager bundle grows by roughly 18 KB.

### Security

- SheetJS is vendored locally at `0.20.3` instead of the npm `xlsx` package, which is frozen at `0.18.5` with unfixed prototype-pollution and ReDoS advisories. `npm audit` is back to zero vulnerabilities.

## 3.2.2 - 2026-08-26

### Added

- Markdown to PDF (vector text layout), CSV to PDF (paginated table with repeating header), HTML to PDF (sandboxed iframe capture), Equation to Image (KaTeX with locally bundled fonts), Handwriting to PDF, and Scan to PDF using the device camera. Camera tracks are always released on stop, reset, and unmount.

## 3.2.1 - 2026-08-26

### Added

- Organize Pages, Crop & Resize PDF, Headers & Footers, Fill PDF Form, Redact PDF (true removal by rasterising, not just drawing boxes), Create PDF, Repair PDF, and PDF Fingerprint.

## 3.2.0 - 2026-08-26

### Added

- PDF to Image, Extract Text from PDF, Compress PDF, PDF to ZIP, Flatten PDF, and Invert PDF Colours.
- pdf.js support with the worker bundled locally through Vite (`?worker` plus an eagerly assigned `workerPort` and `worker.format: "es"`). Without the explicit worker port, pdf.js guesses the worker type, spawns a classic worker against an ESM file, and hangs.

## 3.1.1 - 2026-08-03

### Changed

- Unified the entire UI to a single accent colour: category dots, the pointer glow (previously swept the full hue wheel as the cursor moved), and the password strength meter (now monochrome intensity) all use one accent. Only functional success/error status keeps its own colour.
- Removed the "Local processing" tag and the "N workflows" label from tool and category headers.
- Unified tool-card corner radius across themes and snapped stray spacing values to the 4px grid.

### Fixed

- Transparent PNGs exported to JPEG (Convert/Compress/Resize) no longer get a black background; a white matte is applied for JPEG output only.
- JSON to YAML now quotes string values that look like YAML booleans/null/numbers (`yes`, `no`, `on`, `off`, `~`, `-5`) so they round-trip as strings.
- JSON to CSV rejects an array of primitives with a clear error instead of emitting garbage.
- PDF text tools show a friendly message for unsupported non-Latin characters instead of a cryptic encoder error.
- Password generator now honours a minimum of 0 for a character set.

### Security

- Added Subresource Integrity (SRI) hashes to the vendored pdf-lib and html2canvas scripts. Full OWASP Top 10 review (client-side threat model) found no vulnerabilities: output is escaped at every HTML sink, untrusted image parsing is bounds-checked, prototype pollution is not reachable, and CSP is restrictive.

## 3.1.0 - 2026-08-03

### Added

- Progressive Web App support: web manifest, PNG app icons, and a network-first service worker so the app loads and runs offline after the first visit.
- React error boundary plus global error handlers so a single tool failure no longer white-screens the whole app.
- Mobile navigation drawer (all categories reachable below the desktop breakpoint), with focus trap and focus restore.
- Copy buttons with confirmation on JSON, CSV, YAML, Base64, and diff outputs.
- Build-time code splitting (vendor / motion / app chunks) replacing the single large bundle.
- SEO and social metadata (description, Open Graph, Twitter card, theme-color, apple-touch-icon), MIT LICENSE, security response headers, and robots.txt.

### Changed

- All primary actions now guard against double-submission and show a working state while a task runs.
- Every category is now shown in the primary navigation (previously only four).
- Status messages, contrast, focus rings, and rounded controls are theme-aware and meet WCAG AA contrast.
- Search results are now ranked by relevance so the best match opens first.
- Invoice PDF export now paginates long invoices across A4 pages instead of crushing them onto one, and links back to the app.
- Unified the typography to a single font across light and dark themes and consolidated the CSS design system.
- Reduced-motion preferences are now respected by JavaScript-driven animations.

### Fixed

- Password generator no longer errors when the numbers or symbols character set is disabled.
- PDF rotation is now additive over any existing page rotation; transparent images no longer turn black when embedded.
- File-type validation accepts valid files whose browser MIME type is empty or generic while still rejecting mismatches.
- CSV conversion disambiguates duplicate headers without dropping columns and serializes nested values instead of `[object Object]`.
- Long unbroken tokens in Text-to-PDF now wrap instead of overrunning the page.

### Removed

- Unused decorative WebGL/glow runtime components and dead CSS.

## 3.0.26 - 2026-07-17

### Added

- Image Metadata Inspector for local, offline inspection of supported JPG, PNG, and WebP file metadata.
- Password and passphrase generator controls for character sets, minimum counts, ambiguous-character avoidance, separator choice, capitalization, and optional digits.

### Changed

- Replaced invoice sample data with neutral placeholders and disabled automatic invoice persistence.
- Improved light-mode contrast, shared action controls, and the local utility interface.

### Removed

- Filename Cleaner from the visible tool registry.

## 3.0.25 - 2026-07-15

### Changed

- Replaced the README banner with a terminal-style ASCII MyFileKit wordmark and removed the SVG badge and raw binary line.

## 3.0.24 - 2026-07-15

### Changed

- Reworked the GitHub README with the shipped MyFileKit wordmark, binary ASCII wordmark encoding, clearer repository navigation, and a concise product introduction.

## 3.0.23 - 2026-07-15

### Added

- Preview, download, and print actions for supported generated outputs.
- ZIP export for batch image compression and resizing.
- Production-build packaging for the standalone invoice editor and local browser engines.
- Regression coverage for every visible route, PDF transformations, metadata cleaning, Unicode Base64, file validation, and password generation.

### Changed

- Reworked local file validation, numeric controls, output naming, object URL ownership, and reset behavior.
- Made invoice PDF export capture the live invoice preview so downloaded layout and styling remain consistent.
- Consolidated routing helpers and removed unused experimental frontend dependencies.
- Rewrote release, setup, security, and manual QA documentation to match the shipped application.

### Fixed

- Missing production invoice and vendored engine assets.
- Blocked blob PDF previews under the dashboard Content Security Policy.
- Multi-download blocking in batch image workflows.
- Blank signature and empty-output downloads.
- PDF page-range validation, image bitmap cleanup, crop/resize validation, and metadata-cleaning behavior.
- Invoice PDF blank pages, clipped totals, export-only elements, and preview/export layout differences.

### Security

- Removed remote font dependencies from the invoice editor.
- Tightened browser policies and documented required hosting response headers.
- Verified no tracked credential files, hidden upload path, analytics integration, or known vulnerable npm packages.
