# MyFileKit — Security Audit

**Scope:** `overhaul/ui-sec` UI overhaul diff (`git diff main..overhaul/ui-sec` — `src/App.tsx` ToolMetaPanel/FileControl, `src/styles.css`, `src/services/download.service.js`) plus app-wide surfaces (XSS, filenames/traversal, SVG, pdf.js worker, postMessage/iframe, object URLs, error boundary, CSP).
**Model:** 100% client-side, local-first, strict CSP.
**Verdict:** No exploitable (Critical/High/Med) issues found. The overhaul is clean; every peer/attacker-controlled string is sanitized and rendered as React text. Findings below are all Low/Info hardening or positive confirmations.
**`npm audit 2>&1 | tail -1`:** `found 0 vulnerabilities`

---

## Severity summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 3 |
| Info | 5 |

Real, exploitable issues: **0**. Everything below is defense-in-depth or confirmation of a clean surface.

---

## Overhaul diff (branch `overhaul/ui-sec`)

The diff touches only presentation + result-card wiring. Security-relevant observations, all clean:

- **`FileControl` renders `file.name` and `title={file.name}`** (`src/App.tsx:7840` pattern; new chip list ~`src/App.tsx:1055-1075` in the diff). Rendered as a React text child / `title` attribute → React auto-escapes. No raw-HTML sink. **Clean.**
- **Result card renders `downloadReady.filename` as text** (`src/App.tsx:935`) and `formatBytes(downloadReady.size)` (`:936`). Text nodes, not HTML. **Clean.**
- **Result card Preview link** (`src/App.tsx:942`): `href={downloadReady.url}` (blob:) with `target="_blank" rel="noopener noreferrer"`. Correct. **Clean.**
- **Object-URL lifecycle in `ToolMetaPanel`** (`src/App.tsx:892-918`): revokes the previous URL on replace (`:897`), on unmount (`:906`), and on reset (`:914`). No leak / no use-after-revoke. **Clean.**
- **`styles.css` diff** is pure styling. No security surface.

---

## 1. XSS — CLEAN

Grep of all of `src/` for `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(` returned **no runtime DOM sinks**. Only hit: `new Function` (see Info-2). Every attacker-influenced string (PDF metadata, filenames, peer file names) reaches the DOM only as a React text child or a text attribute (`title=`, `alt=`), which React escapes.

- `file.name` / received `item.filename` (`src/App.tsx:7840`) and `downloadReady.filename` (`:935`) — text nodes. Clean.

### Finding L-1 (Low, defense-in-depth) — HTML-to-PDF paste is not run through the HTML sanitizer
`src/App.tsx:6377` builds `srcDoc = ...${html}...` from raw user-pasted HTML and injects it into a preview iframe (`:6385-6391`) that is **`sandbox="allow-same-origin"` with no `allow-scripts`**. Because scripts cannot run in a scriptless sandbox and the page CSP (`script-src 'self'`) also applies, pasted `<script>`/`onerror=` **cannot execute** — this is not exploitable today. Risk is latent: if a future edit adds `allow-scripts` to that iframe, it becomes script execution in the app origin.
**Attack/impact:** none currently; latent foot-gun.
**Fix:** pass the paste through the existing `sanitizeHtmlForOffline()` (`src/services/office.service.js:335`) before interpolation, as the Word/PPTX/EPUB paths already do — belt-and-braces so the safety does not rest solely on the sandbox attribute staying scriptless.

---

## 2. Filenames / path traversal — CLEAN

`safeFilename` (`src/utils/safe-filename.js:1-12`) pops the basename off any `\` / `/` path, strips the extension, restricts to `[a-z0-9._-]`, trims leading/trailing `-`, caps at 80 chars, and rejects dot-only stems (`.`/`..`). `withExtension` (`:14-16`) rebuilds a single controlled extension.

- **Peer-supplied names** (fully attacker-controlled) pass through `sanitizeReceivedFilename` (`src/services/webrtc.service.js:246-252`) → `safeFilename`, applied in `normalizeIncomingMeta` (`:279`) before the name is ever stored or used. The received-file download uses that sanitized name (`src/App.tsx:7592`, `:7846`). No `../`, control chars, or overlong names survive. **Clean.**
- The new download-ready path (`src/services/download.service.js:12-30`) sets `link.download = filename` on an `<a>`; the browser's `download` attribute uses only the basename regardless, and callers pass `safeFilename`/`withExtension` output. **Clean.**
- `FileControl` input `file.name` is display-only; output names are derived by each tool via `safeFilename`, not taken raw from the input. **Clean.**

---

## 3. SVG upload — CLEAN

No tool exposes `image/svg+xml` in an upload `accept`, and there is **no inline-SVG DOM injection anywhere** (no `innerHTML`). The only SVG handling is in the Office converters (`src/services/office.service.js:375`, `:315-327`), which embed referenced SVGs as `data:image/svg+xml;base64,...` inside an `<img>` in a **scriptless** sandboxed render iframe (`renderHtmlToCanvas`, `src/App.tsx:6413-6442`). SVG loaded via `<img>` never executes scripts, and the sandbox + CSP block it regardless. **Clean.**

---

## 4. pdf.js worker — CLEAN

`src/lib/pdfjs.ts:8-14` imports the worker via Vite's `?worker` (`pdfjs-dist/build/pdf.worker.min.mjs?worker`) → compiled to a **same-origin hashed local asset**, and sets `GlobalWorkerOptions.workerPort` eagerly at module load. No CDN / no `workerSrc` string URL. The strict `script-src 'self'` would block a CDN worker anyway.

### Finding L-2 (Low, defense-in-depth) — `isEvalSupported` not explicitly disabled
`loadPdfDocument` (`src/lib/pdfjs.ts:32-43`) calls `pdfjs.getDocument({ data: bytes })` without `isEvalSupported: false`. pdf.js defaults `isEvalSupported` to `true` and will use `Function()` for some font paths. It is **already neutralized** because the CSP has no `'unsafe-eval'` in `script-src`, so the browser blocks the eval and pdf.js falls back. Not exploitable.
**Fix (hardening):** pass `isEvalSupported: false` (and `isOffscreenCanvasSupported` as desired) so the behavior is explicit and does not depend solely on CSP.

---

## 5. postMessage / iframe — CLEAN

- **No `window.postMessage` calls and no `message` event listeners** anywhere in `src/`. The P2P and whiteboard tools use **WebRTC data channels**, not postMessage, so there is no cross-origin message trust to get wrong.
- The WebRTC `onmessage` handler (`src/services/webrtc.service.js:421-430`) **rejects any string payload** and only accepts binary frames via `decodeFrame`; the decoded metadata is then validated/sanitized in `normalizeIncomingMeta` (`:270-285`). No origin/`event.data` is trusted blindly.
- **Sandboxed iframes:** the HTML preview (`src/App.tsx:6388`) and offscreen render (`:6416`) both use `sandbox="allow-same-origin"` with **no `allow-scripts`**.

### Finding L-3 (Low, defense-in-depth) — PDF preview / print iframes have no `sandbox`
`printDownloadUrl` (`src/App.tsx:103-105`) and the PDF preview frame (`src/App.tsx:1433`) load a **locally generated blob: URL** into an iframe without a `sandbox` attribute. The source is the user's own just-produced file (same-origin blob), `frame-src` is limited to `'self' blob:`, and the app itself is unframeable (`X-Frame-Options: DENY` + `frame-ancestors 'none'`), so this is not a realistic vector — the browser's native PDF viewer, not arbitrary HTML, renders the blob.
**Fix (hardening):** add `sandbox="allow-same-origin allow-modals"` (print needs the print dialog) to bound these frames explicitly.

---

## 6. Object URLs — CLEAN

`createObjectURL` results are consistently revoked:
- Result card: revoke on replace / unmount / reset (`src/App.tsx:897, 906, 914`).
- Page-render preview: `URL.revokeObjectURL` on cleanup (`src/App.tsx:1366, 1371, 1399`).
- Visual-diff tool: revoked on unmount and rebuild (`src/App.tsx:4854, 4857, 4879`).
- `download.service.js` sets `link.rel = "noopener"` on the synthetic `<a>` (`:25`); the card's Preview link uses `rel="noopener noreferrer"` (`src/App.tsx:942`).
No leak or use-after-revoke observed. **Clean.**

---

## 7. Top-level React error boundary — PRESENT (task suspicion not confirmed)

A class error boundary exists at `src/components/ErrorBoundary.tsx:11-73` (`getDerivedStateFromError` + `componentDidCatch`, privacy-first local-only logging) and **is mounted at the app root** wrapping `<App />` in `src/main.tsx:23-25`. Global `error` and `unhandledrejection` handlers are also installed (`src/main.tsx:13-19`). A tool that throws during render is caught and shows the fallback UI rather than white-screening. `runSafely` covers async actions; the boundary covers render. **No gap.**

---

## 8. CSP — STRONG (local-first confirmed)

Delivered two ways: `<meta http-equiv>` in `index.html:12` and HTTP headers in `public/_headers` / `dist/_headers` (the header set additionally carries `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(self), microphone=(self), geolocation=()`). `frame-ancestors` is correctly header-only (it is ignored in a meta tag).

### Directive enumeration — allowed vs. actually referenced

| Directive | Allowed | Actually referenced by the app | Notes |
|---|---|---|---|
| `default-src` | `'self'` | — | Backstop. |
| `script-src` | `'self'` | `/src/main.tsx`, `/assets/vendor/pdf-lib.min.js` (SRI), `/assets/vendor/html2canvas.min.js` (SRI), `/assets/vendor/xlsx.full.min.js` (dynamic), tesseract worker, `/register-sw.js`, `sw.js` — **all same-origin** | No `'unsafe-inline'`, no `'unsafe-eval'`, no CDN. Two vendor scripts carry SRI hashes (`index.html:30-31`). |
| `style-src` | `'self' 'unsafe-inline'` | bundled CSS (self) + React inline `style={}` (e.g. `ErrorBoundary.tsx:34`) + iframe `srcDoc` `<style>` | `'unsafe-inline'` is **necessary** for React inline styles and Tailwind's injected styles. Justified; cannot be dropped without refactoring inline styles to classes + nonces. |
| `img-src` | `'self' data: blob:` | logo SVG (self), rendered page canvases (blob:), QR codes + embedded office images (data:) | All schemes used. |
| `font-src` | `'self' data:` | pdf.js embedded PDF fonts handed to the browser as `data:` URLs | `data:` **necessary** — without it rasterizing tools hang (documented `index.html:6-8`). |
| `connect-src` | `'self'` | **none** (no fetch/XHR/WebSocket to any external origin) | Confirms local-first. The QR `fetch(dataUrl)` (`App.tsx:7443`) is a `data:` read, not a network egress. |
| `frame-src` | `'self' blob:` | srcdoc render iframes (self), PDF preview/print iframes (blob:) | All used. |
| `object-src` | `'none'` | — | No `<object>`/`<embed>`. |
| `base-uri` | `'self'` | — | Hardening. |
| `form-action` | `'none'` | — | No form submits (all tools are JS-driven). |
| `frame-ancestors` | `'none'` (header only) | — | Anti-clickjacking; paired with `X-Frame-Options: DENY`. |

**External origins the app is allowed to load subresources from: none (only `'self'` + `data:`/`blob:` schemes).**
**External origins actually referenced:** `github.com` (footer/nav links only — top-level navigation, not a subresource, not covered by these directives) and `freetsa.org` (see Info-1). Neither is an allowed subresource origin. **Local-first confirmed.**

---

## Info / positives

- **Info-1 — RFC 3161 timestamp (TSA) is opt-in and CSP-blocked by default.** `src/App.tsx:5580-5589` + `src/services/pdf-sign.service.js:921-935`: the only code path that would make an outbound request. It is off by default, user must tick a box and enter a TSA URL, only a SHA-256 hash of the *signature* (never the document) is POSTed, and `connect-src 'self'` **blocks it** until an operator deliberately adds the TSA origin. `freetsa.org` appears only as a placeholder. No default egress. This is a well-designed, honestly-labeled feature, not a finding.
- **Info-2 — `new Function` in `src/services/office.service.js:77` is Node-only.** It evaluates the vendored, trusted `xlsx.full.min.js` bundle in the Node/test path (`typeof window === "undefined"` branch). Not reachable in the browser, not attacker-controlled. Blocked by CSP in-browser regardless.
- **Info-3 — GitHub links use `rel="noreferrer"` without explicit `noopener`** (`src/App.tsx:648, 7256`). `noreferrer` implies `noopener`, and `target="_blank"` implies `noopener` in current browsers, so reverse-tabnabbing is not possible. Cosmetic; add `noopener` for clarity if desired.
- **Info-4 — `sanitizeHtmlForOffline` is regex-based** (`src/services/office.service.js:335-347`). Regex HTML sanitization is fragile in isolation, but here it is defense-in-depth layered under a scriptless sandboxed iframe + CSP, so a bypass has no execution sink. Acceptable given the layering.
- **Info-5 — Peer text hardening beyond XSS.** `sanitizePeerText` (`src/services/webrtc.service.js:264-268`) strips control chars and Unicode bidi-override codepoints from peer strings even though they are only rendered as text — pre-empts bidi-spoofing of surrounding UI copy. Good hygiene.

---

## Resolutions

- **L-1 — FIXED.** `HtmlToPdf` now runs the pasted HTML through `sanitizeHtmlForOffline(html)` before interpolating it into the preview iframe `srcDoc` (src/App.tsx ~6377), matching the Word/PPTX/EPUB paths. Safety no longer rests solely on the scriptless sandbox attribute.
- **L-2 — FIXED.** `loadPdfDocument` passes `isEvalSupported: false` to `pdfjs.getDocument` (src/lib/pdfjs.ts), making the no-eval behavior explicit rather than relying only on the CSP lacking 'unsafe-eval'.
- **L-3 — DECLINED (with rationale).** Adding `sandbox` to the PDF preview/print iframes risks breaking the browser's native PDF viewer (which needs its own scripting) — a real regression to working features — for no exploit benefit: the agent rated it "not a realistic vector," the frames load only the user's own same-origin `blob:` file, `frame-src` is already limited to `'self' blob:`, and the app is unframeable (`X-Frame-Options: DENY` + `frame-ancestors 'none'`). Not worth breaking preview/print to harden a non-vector.

Runtime CSP sweep (separate from this code audit): **zero SecurityPolicyViolation events across 13 production-build routes** (dashboard, merge, invoice, sanitize, analyzer, accessibility, tag, reflow, sign, p2p, json, compress-image, browse). One pre-existing non-CSP console error remains: `register-sw.js` service-worker script fetch fails under `vite preview` — cosmetic (no offline cache), unrelated to this overhaul.
