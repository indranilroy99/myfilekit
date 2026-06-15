# MyFileKit

MyFileKit is a privacy-first, browser-based toolkit for PDF, image, business, signature, text, data, and developer utilities. It combines practical file tools into one clean dashboard with fast search and local file processing wherever possible.

The app is intentionally simple to run and host: vanilla HTML, CSS, and JavaScript with no frontend framework, no build step, no backend, no database, and no account system.

## Working Tools

- PDF: Merge PDF, Split / Extract PDF Pages, Delete PDF Pages, Rotate PDF Pages, Images to PDF.
- Image: Compress Image, Resize Image, Convert Image, Crop Image, Rotate / Flip Image.
- Business: Invoice Generator, Receipt Generator, Quote / Estimate Generator.
- Signature: Draw Signature, Type Signature.
- Text & Data: Text to PDF, Markdown Preview, JSON Formatter, CSV to JSON, JSON to CSV.
- Developer Utilities: Base64 Encode / Decode, File Hash Generator.

Only working tools are shown on the dashboard. Planned tools should stay out of the product UI until they have a real implementation.

## Privacy Model

Supported tools run in the browser using local files selected by the user. MyFileKit does not include a server upload path, tracking code, authentication flow, or remote file storage.

Some browser capabilities vary by browser and operating system. Use the local dev server for the most reliable behavior with JavaScript modules and vendored assets.

## Tech Stack

- HTML
- CSS
- JavaScript modules
- Local vendored `pdf-lib` for browser-side PDF operations
- Node.js scripts for setup, checks, tests, and a lightweight static dev server

## Project Structure

```text
.
├── assets/
│   ├── css/app.css
│   ├── myfilekit-logo.svg
│   └── vendor/pdf-lib.min.js
├── docs/
│   ├── manual-test-checklist.md
│   └── react-shadcn-component-integration.md
├── invoice-generator/
│   └── index.html
├── scripts/
│   ├── build-check.js
│   ├── security-audit.js
│   ├── serve.js
│   └── setup.js
├── src/
│   ├── components/
│   ├── registry/
│   ├── services/
│   ├── tools/
│   ├── utils/
│   ├── main.js
│   └── router.js
├── tests/
├── index.html
├── package.json
├── setup.ps1
└── setup.sh
```

## Run Locally

Clone the repository:

```bash
git clone https://github.com/indranilroy99/myfilekit.git
cd myfilekit
```

Node.js 18 or later is recommended.

### macOS

```bash
chmod +x setup.sh
./setup.sh
npm run dev
```

Open `http://localhost:4173`, or the next local URL printed by the dev server if that port is already busy.

### Windows

From PowerShell:

```powershell
.\setup.ps1
npm run dev
```

Open `http://localhost:4173`, or the next local URL printed by the dev server if that port is already busy.

### Linux

```bash
chmod +x setup.sh
./setup.sh
npm run dev
```

Open `http://localhost:4173`, or the next local URL printed by the dev server if that port is already busy.

## npm Scripts

```bash
npm run setup
npm run dev
npm run check
npm run test
npm run security:audit
npm run preflight
```

- `setup` checks the operating system, Node.js version, npm availability, and important project files.
- `dev` starts a local static server on port `4173`, falling forward to the next available port when needed.
- `check` validates required files and JavaScript syntax.
- `test` runs Node.js unit tests for the registry and core helpers.
- `security:audit` checks the local security baseline and vendored assets.
- `preflight` runs the full local verification set.

## Dashboard Search

The dashboard search filters tools by name, category, description, badge, and keyword.

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

## Development Guidelines

- Keep the dashboard driven by `src/registry/tools.registry.js`.
- Keep each visible dashboard card connected to a working route.
- Do not show unfinished tools as selectable dashboard cards.
- Keep file processing local whenever practical.
- Prefer small service modules over repeated logic in tool UI code.
- Keep copy precise and avoid claims that are not implemented.
- Run `npm run preflight` before pushing.
