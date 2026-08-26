# Security Policy

MyFileKit is a local-first static web application built with Vite, React, TypeScript, and Tailwind CSS. It does not include application servers, user accounts, sessions, cookies, databases, analytics, or remote file storage.

## Supported Version

Security fixes are applied to the latest release on the `main` branch.

## Processing Boundary

- Supported files are processed in the active browser session.
- The app does not intentionally transmit selected files to a backend.
- PDF processing uses a local vendored copy of `pdf-lib`.
- Invoice capture uses a local vendored copy of `html2canvas`.
- Spreadsheet reading and writing use a local vendored copy of SheetJS `0.20.3`. The npm `xlsx` package is not used: it is frozen at `0.18.5`, which carries unfixed prototype-pollution and ReDoS advisories.
- OCR uses a local vendored copy of the tesseract engine and English model (about 14 MB on disk, loaded only when an OCR tool runs). It is configured with explicit local worker, core, and language paths and `workerBlobURL: false`, so recognition never reaches a CDN.
- PDF rasterising uses the pdf.js worker bundled from the local build output, not a CDN.
- Every vendored asset above has its SHA-256 pinned in `scripts/security-audit.js`, which `npm run security:audit` verifies.
- Camera (Scan to PDF) and microphone (Audio to PDF dictation) are used only after an explicit user action, and the media tracks are released on stop, reset, and unmount.
- Generated object URLs are short-lived and revoked when replaced, reset, or unmounted.
- Theme and recently used tool identifiers may be stored in `localStorage`; file contents are not.

Local processing reduces network exposure. It does not guarantee that an untrusted input file is harmless, that every hidden metadata object has been removed, or that a generated output is appropriate to open in another application.

## Application Controls

- The HTML entry points use a restrictive Content Security Policy for scripts, frames, objects, forms, images, and local assets.
- Production pages do not load remote fonts, analytics, or CDN scripts.
- User-controlled values are rendered through React or escaped before document export.
- File type, file count, file size, numeric ranges, and page selections are validated before processing.
- Dashboard cards are generated from a central registry and are only visible when their routes have working implementations.

## Optional Bring-Your-Own LLM Endpoint

PDF Summarizer and Ask Your PDF are fully local by default. PDF Summarizer ranks sentences with a TextRank graph built in the browser; Ask Your PDF retrieves passages with a BM25 index built in the browser. Neither needs a network connection, a model download, or an account.

Both tools also expose an optional adapter for an OpenAI-compatible endpoint the user owns. It is off unless a user configures it, and it changes the processing boundary when used:

- The endpoint base URL, model name, and API key are stored only in that browser's `localStorage`. The key is never logged, never written into a URL or query string, and is masked in the UI. It is sent only as an `Authorization: Bearer` header on a request the user explicitly triggered.
- Nothing is transmitted until the user saves an endpoint, enables it, and presses an AI button. `requestChatCompletion` in `src/services/llm.service.js` refuses before reaching `fetch` when the settings are absent or disabled, so a default install cannot make the request at all.
- The AI buttons are labelled with the destination origin, and the results are labelled as produced off the device. PDF Summarizer sends the extracted document text; Ask Your PDF sends only the retrieved passages plus the question.
- The shipped policy pins `connect-src 'self'` in both `index.html` and `public/_headers`, so a browser blocks every custom endpoint on the default build. **This policy is intentional and is not relaxed for these tools.** An operator who wants the adapter on their own deploy must add `connect-src 'self' https://their-endpoint.example` to both files and rebuild. Until then the tools catch the block and say exactly which files to change rather than reporting a generic network failure.

## Required Hosting Headers

An HTML `<meta>` policy cannot enforce every response-level security control. Configure the static host to send headers similar to these:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(self), microphone=(self), geolocation=(), payment=(), usb=()
```

Serve production deployments over HTTPS. Hosts that manage TLS should also enable an appropriate `Strict-Transport-Security` policy after confirming every subdomain is HTTPS-ready.

## Dependency Review

Run:

```bash
npm run security:audit
npm run preflight
```

The security audit verifies required local browser engines and runs `npm audit --audit-level=moderate`. Review package-lock changes and new install scripts before accepting dependency updates.

## Secure Development Rules

- Do not add remote production scripts or silently upload files.
- Do not render untrusted raw HTML.
- Do not expose a tool until its route and primary output work end to end.
- Keep format support and metadata-cleaning claims precise.
- Sanitize generated filenames and revoke object URLs.
- Never commit tokens, credentials, private keys, or local `.env` files.

## Reporting A Vulnerability

Do not open a public issue for a vulnerability that could put users at risk. Contact the repository owner privately and include the affected route, browser, operating system, reproduction steps, impact, and any suggested mitigation. Please do not include real confidential files in a report.
