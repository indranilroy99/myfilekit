# Changelog

All notable MyFileKit changes are documented here. The project uses semantic versioning.

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
