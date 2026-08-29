# MyFileKit — UI/Security Overhaul

Branch: `overhaul/ui-sec` (off `main`). One commit per phase. **No new dependencies.**
Business logic, file-parsing services, `node_modules`, and the lockfile were not modified.
Gates green throughout: **306 tests pass · production build ✓ · `npm run security:audit` OK · `npm audit` 0 vulnerabilities.**

Motivation: the dashboard was already clean, but the **tool workspace** — the surface people actually use — read as vibe-coded: a `STATUS: Ready.` debug box, a thin low-affordance dropzone, and no result screen (files downloaded silently). Fixed at the **shared skeleton** level, so all 100+ tools inherit the change.

---

## Phase 1 — Workspace redesign (P0) — commit `09e9495`

Files: `src/App.tsx` (+141/-), `src/styles.css` (+150).

- **Removed the `STATUS: Ready.` panel.** Status is calm by default; it surfaces only on active work, error, or a success with no download.
- **Result card promoted** out of the status footnote: "Done — ready to save" with filename, size, Download / Preview / Print / Start over.
- **Dropzone redesigned** (`FileControl`): tall, iconful, accepted-types hint, Browse CTA — replacing the "No file selected" strip.
- **File list**: name + size + remove, with reorder for multi-file tools (page order for Merge). Chips live outside the `<label>` and zero-file drops are ignored, so a reorder drag can never clear the selection.
- **Trust line** replaces the robotic processing note: "Runs entirely in your browser — your files never leave this device."

---

## Phase 2 — Independent critic board (P0/P1) — commit `aa1f19f`

Three separate subagents each reviewed **only** the Phase-1 diff + the invariants (not the design reasoning), writing `reviews/{ux,a11y,design-systems}.md` (BLOCKER/MAJOR/MINOR, file:line). **Every BLOCKER and MAJOR fixed**; a resolution line was appended to each finding.

Files: `src/App.tsx` (+82), `src/styles.css` (+82), `reviews/*.md`.

Findings: **3 BLOCKER, 12 MAJOR, 12 MINOR.**

Notable fixes:
- **Single-accent (BLOCKER):** the result card was a full green treatment mixing two unrelated greens → de-greened (border `--line`, bg `--card`, check `--primary`); success reads via the check + label.
- **Keyboard/touch reorder (BLOCKER):** HTML5 drag was mouse-only, keyboard-inoperable for Merge where order = page order → added up/down move buttons (aria-labelled, disabled at ends, 44px); drag kept as enhancement.
- **Touch targets (BLOCKER):** 28px remove + move buttons → shared `.icon-button` 44×44.
- **Screen-reader announce (MAJOR):** result card is `role="status" aria-live="polite"`; sr-only live region announces file count; focus returns to the input after a removal.
- **App-wide dark-mode AA (MAJOR):** every primary button was `#3b82f6` on `#fafafa` = **3.52:1** → `#2563eb` ≈ **4.95:1**.
- **Token/grid discipline (MAJOR×6):** `color-mix` on `--primary` (no raw blue), dark surfaces reuse the slate rgba tokens, 4px-grid gaps, `--danger-fg` hover, `--card` fills, `--radius-*`.
- **Hierarchy/focus/copy (MAJOR/MINOR):** filename → `font-semibold` (head heaviest), distinct `:focus-within` ring, trust line hidden when the result shows, de-shouted the hint.

Deliberately declined (documented in `reviews/*.md`): a drag insertion-line indicator (buttons are now the primary path), making the Browse CTA a second focusable button (avoids dual focus targets), and composing `.result-card` from `.surface-muted` (kept dedicated for clarity).

---

## Phase 3 — Security sweep + CSP verification (P0) — commit `788de7d`

Files: `src/App.tsx` (+4/-), `src/lib/pdfjs.ts` (+4/-), `reviews/security.md`.

Independent security agent audited the diff + app-wide surfaces (XSS, filename traversal, SVG, pdf.js worker, postMessage/iframe, object URLs, error boundary, CSP).

**Severity: 0 Critical · 0 High · 0 Medium · 3 Low · 5 Info.** Zero exploitable issues.

- **XSS:** no `innerHTML`/`dangerouslySetInnerHTML`/`document.write` runtime sinks; all attacker-controlled strings render as escaped React text.
- **Filenames:** `safeFilename` neutralizes traversal/charset/length; peer names sanitized before any download.
- **pdf.js worker:** bundled same-origin (`?worker`), no CDN.
- **postMessage/iframe:** no `message` listeners; WebRTC rejects string payloads; render iframes are scriptless-sandboxed.
- **Error boundary:** top-level React `ErrorBoundary` present at the app root — a render throw shows a fallback, not a white screen.

Hardening applied:
- **L-1 FIXED** — `HtmlToPdf` paste now runs through `sanitizeHtmlForOffline` before the preview iframe `srcDoc`.
- **L-2 FIXED** — `loadPdfDocument` passes `isEvalSupported: false` (explicit no-eval).
- **L-3 DECLINED (documented)** — sandboxing the PDF preview/print iframes would break the native PDF viewer for no exploit benefit (non-vector; same-origin blob only; app unframeable via `X-Frame-Options: DENY` + `frame-ancestors 'none'`).

### CSP — runtime verified

**Zero `SecurityPolicyViolation` events across 13 production-build routes** (dashboard, merge, invoice, sanitize, analyzer, accessibility, tag, reflow, sign, p2p, json, compress-image, browse).

Final policy (`index.html` meta + `public/_headers`):

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';
frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'
```
Headers additionally: `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(self), microphone=(self), geolocation=()`.

**External subresource origins allowed: none** (`'self'` + `data:`/`blob:` only). `connect-src 'self'` = no external network egress (the RFC-3161 TSA feature is opt-in and CSP-blocked by default). `'unsafe-inline'` on `style-src` is necessary for React inline styles; `font-src data:` is necessary for pdf.js embedded fonts. Neither can be dropped without a refactor; both documented.

---

## New dependencies

**None.** No `package.json` / lockfile changes.

---

## Phase 4 — Premium feel (P1) — commit `80e9a42`

Files: `src/App.tsx`, `src/styles.css`.

- **Navigation:** the 8 flat category links (sitemap look) collapsed into Dashboard + an accessible **`Tools ▾` dropdown** (aria-haspopup/expanded, Escape/outside-click/route-change close, 44px items, active category highlighted).
- **Typography discipline:** buttons 900→700 weight and 42→44px min-height; every small-size 900 label/badge → bold. `font-black` instances 181 → 66, reserved for headings/display only.
- **Dark elevation step:** nested card/muted surfaces sit at `#17171a` on the `#111113` panel (scoped to dark; light verified unchanged) — depth without shadows/glow.
- Verified live: menu behavior, computed weights/sizes, elevation values, light-theme intact.
- Skipped within P1 (documented): mobile sticky CTA (layout-risk > evidence of need).

---

## Deliberately not done

- **L-3** iframe sandbox (see above).
- **Non-client features** (cloud import, native apps) remain out of scope by prior decision.
- One pre-existing, non-CSP console error remains: `register-sw.js` service-worker fetch fails under `vite preview` (cosmetic; no offline cache; unrelated to this overhaul).

---

## Verification summary

| Gate | Result |
|---|---|
| `npm run check` (types) | OK |
| `npm test` | 306 pass / 0 fail |
| `npm run build` | ✓ built |
| `npm run security:audit` | OK (SRI + sha256 pins verified) |
| `npm audit` | 0 vulnerabilities |
| CSP runtime sweep | 0 violations / 13 routes |
| Critic BLOCKER+MAJOR | 15/15 fixed |
| Security Critical/High/Med | 0 |

Total: **8 files changed, +868 / -40** across three commits.
