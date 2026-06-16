# MyFileKit

MyFileKit is a privacy-first, browser-based toolkit for PDF, image, business, signature, text, data, and developer utilities. It brings everyday file workflows into one clean dashboard with fast search and local processing wherever possible.

## Version

Current app version: `3.0.8`

Use the version scripts for future changes:

```bash
npm run version:patch
npm run version:minor
npm run version:major
```

Use patch versions such as `2.0.1` and `2.0.2` for small fixes. Use a major version such as `3.0.0` for a major product upgrade.

## Working Tools

- PDF: Merge PDF, Split / Extract PDF Pages, Delete PDF Pages, Rotate PDF Pages, Images to PDF.
- Image: Compress Image, Resize Image, Convert Image, Crop Image, Rotate / Flip Image.
- Business: Invoice Generator with premium templates, payment details, tax/TDS fields, signatures, logo controls, and customizable invoice-style document wording.
- Signature: Draw Signature, Type Signature.
- Text & Data: Text to PDF, Markdown Preview, JSON Formatter, CSV to JSON, JSON to CSV.
- Privacy: EXIF & Metadata Cleaner inspects EXIF, XMP, ICC, GPS, and container metadata in supported image files, exports a local JSON report, and re-encodes a cleaned copy in your browser.
- Developer Utilities: Base64 Encode / Decode, File Hash Generator.

Only working tools are shown in the dashboard. Planned tools stay out of the product UI until they have real implementations.

## UX

- Dashboard-first command center layout that keeps the landing page focused.
- Centered Spotlight-style dashboard search with inline results and quick action chips.
- Popular tools and recently used tools for faster repeat work.
- Category overview cards for PDF, image, business, signature, privacy, text/data, and developer tools.
- Privacy and trust strip for local-first processing, no unnecessary uploads, organized tools, and search-first workflow.
- Dedicated Browse Tools page for the full searchable tool library.
- Searchable category pages for narrowing tools inside one workflow family.
- Tool pages include Back, Forward, Dashboard, category navigation, and related tools.
- Clean text-only MyFileKit wordmark in the product shell.
- Premium utility visual system with a warm light background, clean cards, subtle borders, refined typography, and fewer hard divider lines.

## Privacy Model

Supported tools run in the browser using local files selected by the user. MyFileKit does not include a server upload path, tracking code, authentication flow, or remote file storage.

## Tech Stack

- React
- TypeScript
- Tailwind CSS
- Vite
- lucide-react
- framer-motion
- Local vendored `pdf-lib` for browser-side PDF operations
- Node.js tests and release checks

## Project Structure

```text
.
├── assets/
│   ├── myfilekit-logo.svg
│   └── vendor/pdf-lib.min.js
├── docs/
│   ├── manual-test-checklist.md
│   └── react-shadcn-component-integration.md
├── invoice-generator/
│   └── index.html
├── scripts/
│   ├── build-check.js
│   ├── bump-version.js
│   ├── security-audit.js
│   └── setup.js
├── src/
│   ├── components/
│   │   └── ui/
│   ├── lib/
│   ├── registry/
│   ├── services/
│   ├── utils/
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── tests/
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Run Locally

Clone the repository:

```bash
git clone https://github.com/indranilroy99/myfilekit.git
cd myfilekit
```

Node.js 18 or later is required.

### macOS

```bash
chmod +x setup.sh
./setup.sh
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:4173`.

### Windows

From PowerShell:

```powershell
.\setup.ps1
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:4173`.

### Linux

```bash
chmod +x setup.sh
./setup.sh
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:4173`.

## npm Scripts

```bash
npm run setup
npm run dev
npm run build
npm run check
npm run test
npm run security:audit
npm run preflight
```

- `setup` checks OS, Node.js, npm, installed dependencies, and important files.
- `dev` starts the Vite development server.
- `build` creates a production Vite build.
- `check` validates required files, JavaScript syntax, TypeScript, Vite build, and invoice inline script syntax.
- `test` runs Node.js tests for registry, routing helpers, CSV/JSON helpers, filename helpers, file validation, and PDF services.
- `security:audit` validates local security assumptions and runs `npm audit`.
- `preflight` runs the release gate.

## Dashboard Search

The dashboard search filters tools by name, category, description, badge, and keyword.

Use `Cmd+K` on macOS or `Ctrl+K` on Windows/Linux to focus the dashboard search. Opening a tool adds it to the Recently Used section stored in browser `localStorage`.

Try:

- `merge pdf`
- `compress image`
- `invoice`
- `split pdf`
- `signature`
- `resize image`
- `convert jpg`
- `receipt`
- `json`
- `hash`
- `metadata`
- `exif`
- `privacy`

## Roadmap

These items are planned for future releases and are not shown as working tools until implemented:

- PDF metadata viewer and cleaner
- Office document metadata cleaner
- Batch metadata cleaner
- Metadata editing where format support is reliable
- HEIC and TIFF metadata cleaner

## Development Guidelines

- Keep the dashboard driven by `src/registry/tools.registry.js`.
- Keep each visible dashboard card connected to a working route.
- Do not show unfinished tools as selectable dashboard cards.
- Keep file processing local whenever practical.
- Prefer focused service modules for reusable file logic.
- Keep copy precise and avoid claims that are not implemented.
- Run `npm run preflight` before pushing.
