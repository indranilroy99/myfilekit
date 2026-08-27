# Security Policy

MyFileKit is a local-first static web application built with Vite, React, TypeScript, and Tailwind CSS. It does not include application servers, user accounts, sessions, cookies, databases, analytics, or remote file storage.

## Supported Version

Security fixes are applied to the latest release on the `main` branch.

## Processing Boundary

- Supported files are processed in the active browser session.
- The app does not intentionally transmit selected files to a backend. P2P File Share and Whiteboard send data directly to one peer the user invites by hand; see "Direct Peer Connections" below.
- PDF processing uses a local vendored copy of `pdf-lib`.
- Invoice capture uses a local vendored copy of `html2canvas`.
- Spreadsheet reading and writing use a local vendored copy of SheetJS `0.20.3`. The npm `xlsx` package is not used: it is frozen at `0.18.5`, which carries unfixed prototype-pollution and ReDoS advisories.
- OCR uses a local vendored copy of the tesseract engine and nine language models — English, Hindi, Spanish, French, German, Portuguese, Simplified Chinese, Arabic, and Russian (about 27 MB on disk in total; only the selected language's model is fetched, and only when an OCR tool runs). It is configured with explicit local worker, core, and language paths and `workerBlobURL: false`, so recognition never reaches a CDN. Every model is integrity-checked by sha256 in `npm run security:audit`.
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

## Optional Server-Backed Features (off by default)

The **Request e-Signature** tool is a Tier 3 feature: it inherently needs a
server, so it is optional, off by default, and is the only tool that uploads the
selected PDF off the device — and only to a signing backend the operator has
deployed and configured. It mirrors the bring-your-own-LLM opt-in above:

- The backend base URL and any API key are stored only in that browser's
  `localStorage`. The key is never logged, never written into a URL or query
  string, and is masked in the UI. It is sent only as an `Authorization: Bearer`
  header on a request the user explicitly triggered. The PDF travels only in the
  request body, never in a URL.
- Nothing is uploaded until the operator configures a backend, enables it, and a
  user presses **Send for signature**. `requestEnvelope` and `getEnvelopeStatus`
  in `src/services/esign.service.js` refuse before reaching `fetch` when the
  settings are absent or disabled, so a default install cannot make the request
  at all. A test asserts zero network calls in that state.
- The tool is labelled in-UI as uploading the PDF off the device, names the
  destination origin on the button, and carries a persistent note that the
  operator's backend — not MyFileKit — then holds the PDF and signer emails.
- The shipped policy pins `connect-src 'self'` in both `index.html` and
  `public/_headers`, so a browser blocks the backend on the default build.
  **This policy is intentional and is not relaxed for this tool.** An operator who
  wants it on their own deploy must add `connect-src 'self' https://their-backend.example`
  to both files and rebuild. Until then the tool catches the block and says
  exactly which files to change.
- A deployable, dependency-free reference backend is in `reference-backend/`
  (not part of the app build, adds no dependency to the app), and the full
  operator guide — deploy steps, cloud-import (Google Drive / Dropbox) OAuth
  stub, and the operator's own retention/encryption/TLS responsibilities once
  they hold user PDFs — is in `docs/TIER3-OPTIONAL-BACKEND.md`.

**The default build ships with these features OFF and `connect-src 'self'`, so a
default install never uploads.**

## Direct Peer Connections (P2P File Share, Whiteboard)

These two tools are the only ones whose data can leave the device, and only to the one peer the user hands a code to. They still involve no MyFileKit server.

- **Signaling is manual, by design.** There is no signaling server and none can be added without a backend. The initiator's browser produces a deflate + base64url code containing its own session description, the user passes that code to their peer through a channel they already trust, and the peer's answer code comes back the same way. `connect-src 'self'` stays as it is; WebRTC is not governed by that directive, and neither tool makes an HTTP, WebSocket, or `EventSource` call — a test in `tests/core.test.js` asserts that no such call and no STUN/TURN/`ws(s)` host appears in either service.
- **No third-party server is baked in.** The default `RTCPeerConnection` is created with an empty `iceServers` list, so only local-network candidates are gathered. A user may add their own STUN/TURN servers: the field is off by default, restricted to the `stun:`, `stuns:`, `turn:`, and `turns:` schemes, capped at four entries, requires credentials for TURN, and is labelled in the UI as contacting a third party that will learn their IP address. `https://` and `wss://` entries are refused.
- **ICE gathering completes before a code is produced** (vanilla ICE), with a five-second timeout so a browser that never reports completion cannot hang the tool.
- **The remote peer is untrusted input.** Peer data reaches the app only as binary frames through `decodeFrame`; a text message is rejected. Received filenames are reduced to their final path segment plus a short extension and passed through `safeFilename`; MIME types must match a strict token pattern or become `application/octet-stream`; peer strings are stripped of control characters and bidi overrides. Nothing from a peer is ever rendered as HTML or used as a URL, and a received file is only ever offered as a download — it is never opened, previewed, or executed.
- **Transfers are size-bounded and integrity-checked.** Announced sizes above 256 MB per file, or 512 MB per session, are refused with a clear message before anything is allocated. Chunks must arrive in order and may not exceed the announced size. Each side computes a SHA-256 with `crypto.subtle` independently, and a mismatch is reported as a mismatch rather than presented as a good file.
- **Signaling codes are bounded too.** A code longer than 24,000 characters is refused before decoding, and decompression writes into a fixed 128 KB buffer, so a crafted code cannot expand into a large allocation.
- **Whiteboard strokes from a peer** have their colour validated against a hex pattern, their width and coordinates clamped into range, and their point and stroke counts capped before anything touches a canvas. Peer stroke ids are namespaced, so a crafted id cannot address a local stroke. A peer disconnecting, cancelling, or clearing never removes local work.
- **Everything is released on reset, cancel, and unmount:** the `RTCPeerConnection`, the `RTCDataChannel` and its handlers, the pointer and resize listeners, the `ResizeObserver`, offscreen export canvases, and generated object URLs.

WebRTC data channels are encrypted (DTLS) between the two peers. That protects the transfer in flight; it does not vouch for who is on the other end. A code shared over a channel an attacker controls can be used by that attacker instead of the intended peer, and a received file is only as trustworthy as the person who sent it.

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
