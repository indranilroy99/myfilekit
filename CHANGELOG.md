# Changelog

All notable MyFileKit changes are documented here. The project uses semantic versioning.

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
