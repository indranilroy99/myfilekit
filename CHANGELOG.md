# Changelog

All notable MyFileKit changes are documented here. The project uses semantic versioning.

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
