# MyFileKit

MyFileKit is a local-first browser toolkit for common PDF, image, invoice, signature, privacy, text, data, and developer workflows. It combines 38 working tools in one searchable interface and processes selected files in the browser wherever the underlying format allows it.

[![Version](https://img.shields.io/badge/version-3.0.23-2563eb)](./package.json)
[![Tests](https://img.shields.io/badge/tests-15%20passing-16a34a)](./tests/core.test.js)
[![Security](https://img.shields.io/badge/npm%20audit-0%20known%20vulnerabilities-16a34a)](./SECURITY.md)

## Product Principles

- **Local-first:** supported workflows run without a server upload path.
- **Working tools only:** every visible tool card opens an implemented workflow.
- **Clear exports:** processed files expose review, download, and print actions where the output format supports them.
- **Honest scope:** the interface does not advertise unfinished converters, universal editing, or unsupported file formats.
- **Portable:** the project runs with Node.js on macOS, Windows, and Linux.

## Available Tools

| Category | Tools |
| --- | --- |
| PDF (9) | Merge PDF, Split / Extract PDF Pages, Delete PDF Pages, Rotate PDF Pages, Add Text to PDF, Add Signature to PDF, Add PDF Page Numbers, Watermark PDF, Images to PDF |
| Image (8) | Compress Image, Batch Compress Images, Resize Image, Batch Resize Images, Convert Image, Crop Image, Rotate / Flip Image, Add Text to Image |
| Business (1) | Invoice Generator |
| Signature (3) | Draw Signature, Type Signature, Add Signature to Image |
| Text & Data (9) | Text to PDF, Markdown Preview, JSON Formatter, CSV to JSON, JSON to CSV, JSON to YAML, URL Encode / Decode, Text Diff Checker, Word Counter |
| Privacy (2) | EXIF & Metadata Cleaner, PDF Metadata Cleaner |
| Developer Utilities (6) | Base64 Encode / Decode, File Hash Generator, Hash Compare, Password Generator, QR Code Generator, Filename Cleaner |

The image metadata cleaner inspects supported JPEG, PNG, and WebP files, exports a local report, and re-encodes pixels to remove most embedded metadata. Re-encoding may change file size or encoding details. The PDF metadata cleaner removes common document information fields; it does not sanitize visible content, attachments, or every possible custom PDF object.

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

Deploy the generated `dist/` directory to any static host. The build includes the React dashboard, the invoice editor, and the local PDF and invoice-capture engines. Navigation uses URL hashes, so static hosts do not need route rewrites for tool pages.

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
| `npm run test` | Runs registry, route, validation, conversion, security-helper, PDF, and metadata tests. |
| `npm run security:audit` | Verifies local assets and runs `npm audit --audit-level=moderate`. |
| `npm run preflight` | Runs the complete release gate. |

The browser QA checklist is in [docs/manual-test-checklist.md](./docs/manual-test-checklist.md).
Release notes are maintained in [CHANGELOG.md](./CHANGELOG.md).

## Architecture

```text
src/registry/tools.registry.js   Tool names, routes, categories, keywords, and capabilities
src/App.tsx                      Dashboard, category pages, tool pages, and hash navigation
src/services/                    PDF, image, download, metadata, and text/data operations
invoice-generator/index.html     Standalone invoice editor and preview-matched PDF export
assets/vendor/                   Local browser engines used by PDF and invoice workflows
scripts/                         Setup, build, version, and security release checks
tests/                           Node.js regression tests
```

The dashboard is rendered from the central registry. Recently used tools and theme preference are stored in browser `localStorage`; selected file contents and generated outputs are not persisted there.

## Privacy And Security

MyFileKit has no application backend, account system, analytics integration, or remote file storage. File contents stay in the active browser session unless a user explicitly downloads an output.

This local-first model reduces network exposure, but it does not make untrusted files inherently safe. Keep the browser updated, avoid opening suspicious outputs, and review [SECURITY.md](./SECURITY.md) before deploying publicly.

## Current Boundaries

MyFileKit does not currently claim full existing-PDF text editing, OCR-based image text replacement, Office document conversion, encrypted PDF unlock/protection, background removal, or universal metadata removal. Those workflows require format-specific engines and validation beyond the current browser implementation, so they are not shown as tools.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md), run `npm run preflight`, and keep every visible registry entry connected to a working route. Security reports should follow [SECURITY.md](./SECURITY.md).

## Versioning

The current version is `3.0.23`. See [CHANGELOG.md](./CHANGELOG.md) and use the repository scripts to create intentional releases:

```bash
npm run version:patch
npm run version:minor
npm run version:major
```
