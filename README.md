# MyFileKit

MyFileKit is a privacy-first, browser-based toolkit for PDF, image, business, signature, document, security, and AI-assisted tools. It combines multiple small utilities into one dashboard with fast search and local file processing wherever possible.

The project is currently a vanilla HTML, CSS, and JavaScript application. It does not require a frontend framework or a build step.

## Available Tools

- Invoice Generator: full invoice editor with templates, custom fields, payment details, TDS, signatures, logo controls, and print/PDF export.
- Compress Image: browser-based image compression for JPG, PNG, and WebP.
- Merge PDF: combines multiple PDFs in the browser.
- Split PDF: exports PDF pages as separate files in the browser.

PDF merge and split use `pdf-lib` from a CDN. The dashboard itself remains static and can be opened directly from disk.

## Coming Soon Tools

MyFileKit already shows the planned tool library, but planned tools are intentionally marked as `Coming soon` and do not pretend to process files.

Categories include:

- PDF Tools
- Image Tools
- Business Tools
- Signature Tools
- Document Tools
- Security Tools
- AI Tools

## Privacy Model

The current working tools process files in the browser wherever possible. Files selected in the dashboard are not uploaded to a MyFileKit server because this project does not currently include a backend.

Some future tools, such as OCR, PDF repair, Office conversion, and AI document analysis, may require backend services. Those tools are marked as planned until a safe implementation exists.

## Screenshots

Screenshots will be added after the interface stabilizes.

## Tech Stack

- HTML
- CSS
- JavaScript
- `pdf-lib` via CDN for browser-side PDF merge and split
- Node.js scripts for local setup checks and a lightweight development server

## Project Structure

```text
.
├── assets/
│   ├── css/
│   │   └── app.css
│   ├── js/
│   │   ├── app.js
│   │   └── tools-registry.js
│   └── myfilekit-logo.svg
├── invoice-generator/
│   └── index.html
├── scripts/
│   ├── build-check.js
│   ├── serve.js
│   └── setup.js
├── index.html
├── package.json
├── setup.ps1
└── setup.sh
```

## Installation

Clone the repository:

```bash
git clone https://github.com/indranilroy99/myfilekit.git
cd myfilekit
```

Node.js 18 or later is recommended for the local development server. The app can also be opened directly by loading `index.html` in a browser.

## macOS

```bash
chmod +x setup.sh
./setup.sh
npm run dev
```

Open:

```text
http://localhost:4173
```

Alternative:

```bash
python3 -m http.server 4173
```

## Windows

From PowerShell:

```powershell
.\setup.ps1
npm run dev
```

Open:

```text
http://localhost:4173
```

Alternative: use the VS Code Live Server extension and open the project folder.

## Linux

```bash
chmod +x setup.sh
./setup.sh
npm run dev
```

Open:

```text
http://localhost:4173
```

Alternative:

```bash
python3 -m http.server 4173
```

## npm Scripts

```bash
npm run setup
npm run dev
npm run preview
npm run build
```

- `setup` checks the operating system, Node.js version, npm availability, and required project files.
- `dev` starts a small local static server on port `4173`.
- `preview` runs the same local server.
- `build` checks required files and JavaScript syntax. There is no compiled production build yet.

## Dashboard Search

The dashboard search filters tools by name, category, description, badges, and keywords.

Try searches such as:

- `merge pdf`
- `compress image`
- `invoice`
- `split pdf`
- `signature`
- `resize image`
- `convert jpg`
- `receipt`

When search is empty, tools are grouped by category. When search has a value, matching tools are shown as search results, with available tools first.

## Troubleshooting

If `npm run dev` fails:

- Confirm Node.js 18 or later is installed.
- Run `node scripts/setup.js` for diagnostics.
- Try another port with `PORT=5000 npm run dev` on macOS/Linux.
- On Windows PowerShell, use `$env:PORT=5000; npm run dev`.

If PDF tools say the engine is still loading:

- Wait a moment and try again.
- Confirm the browser can load `https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js`.
- Use the local dev server rather than opening files directly if your browser blocks CDN scripts from `file://` pages.

## Development Guidelines

- Keep the dashboard driven by `assets/js/tools-registry.js`.
- Mark unfinished tools as `coming-soon`.
- Do not add placeholder actions that appear to process files.
- Prefer browser-side processing when practical.
- Keep dependencies minimal.
- Keep copy precise and avoid claims that are not implemented.
- Preserve direct `index.html` usage where possible.

## Roadmap

- Add dedicated pages for available tools.
- Implement image resize and image format conversion.
- Add Images to PDF and PDF to Images.
- Add PDF rotate, reorder, watermark, and page-number tools.
- Add signature drawing and signature-to-PDF workflows.
- Add quote, receipt, and estimate generators.
- Evaluate backend support for Office conversion, OCR, PDF repair, redaction, and AI-assisted tools.

