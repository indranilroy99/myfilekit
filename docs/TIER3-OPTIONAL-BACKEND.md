# Tier 3 — optional, server-backed features (OFF by default)

MyFileKit is a **100% local**, static web app. Every tool in the default build
processes your files in the browser and uploads nothing. The **default build
ships with `connect-src 'self'`**, which blocks every outbound connection, so a
default install never uploads a file — full stop.

This document covers **Tier 3** features, which are the deliberate exception.
They inherently need a server or a third party, so they are:

- **Off by default.** Nothing runs until an operator configures them.
- **Clearly labelled in-UI** as leaving the device.
- **Blocked by the shipped CSP** until the operator adds their own origin.
- **Never a weakening of the default guarantee** — a fresh install still uploads
  nothing, and there is no hosted MyFileKit backend anywhere.

Today the Tier-3 surface is one tool: **Request e-Signature**.

## What "Request e-Signature" does

It sends a PDF to other people to sign, through a signing backend **the operator
deploys themselves**. It is the **only** MyFileKit tool that uploads the selected
PDF off the device, and only to that operator-configured backend.

It mirrors the existing bring-your-own-LLM opt-in pattern exactly:

- Settings (backend base URL + optional API key) live only in this browser's
  `localStorage`. The key is never logged, never put in a URL, and is only ever
  sent as an `Authorization: Bearer` header.
- `src/services/esign.service.js` **refuses before it reaches `fetch`** whenever
  the backend is missing or disabled, so an unconfigured install cannot upload a
  PDF even if the code path is triggered by mistake. A test in
  `tests/core.test.js` asserts zero network calls in that state.
- On a CSP/network block, the tool reports the **exact** `connect-src` line to
  add, naming both files, instead of a generic failure.

## What an operator must do to make it live

This is scaffold + reference, **not** a turnkey hosted feature. Three steps, all
performed by the operator on a deploy they control:

1. **Deploy a signing backend.** A minimal, dependency-free reference lives in
   [`../reference-backend/`](../reference-backend/) — endpoints, run steps, and a
   production checklist are in its README. Serve it over **HTTPS**.
2. **Allow the backend origin in the CSP.** In **both** `index.html` and
   `public/_headers`, change:

   ```
   connect-src 'self'
   ```

   to:

   ```
   connect-src 'self' https://your-backend.example
   ```

   Then rebuild (`npm run build`) and redeploy MyFileKit. **Do not** relax any
   other directive. Until this is done the browser blocks the tool and it says
   which files to edit.
3. **Wire the operator-owned pieces** the reference stubs: real email delivery to
   signers, real signing/sealing of the final PDF, a persistent + encrypted
   store, and (optionally) cloud import via the operator's own OAuth app. These
   are `TODO`s in the reference backend and a documented stub in its README —
   they need the operator's own accounts and credentials, so they cannot ship
   pre-wired.

Then, in the Request e-Signature tool: open **Settings**, enter the backend base
URL (and API key if set), and **Save and enable**.

## Cloud import (Google Drive / Dropbox) — reference stub

Importing the source PDF from Google Drive or Dropbox instead of the local disk
needs the operator's **own OAuth client** and additional CSP allowances, so it is
documented as a client-side stub rather than shipped. The full sketch (Google
Picker + Dropbox Chooser) and the exact `script-src`/`connect-src`/`frame-src`
additions are in the reference backend README, under *"Optional: import the PDF
from Google Drive / Dropbox"*. It changes nothing about the privacy story:
nothing is uploaded until the user presses **Send for signature**, and the only
destination is the operator's own backend.

## Security considerations

Turning this on moves data off the device, so the operator inherits real
responsibilities:

- **The operator now holds user PDFs and signer emails.** MyFileKit does not —
  there is no MyFileKit server. Encrypt PDFs **at rest**, serve over **TLS**, and
  define a **retention policy** that deletes envelopes when a workflow completes.
- **Authenticate.** Set an API key on the backend and in the tool; require the
  per-signer token on sign/download. The reference uses unguessable ids and
  tokens but is otherwise open by design — harden it before real use.
- **Lock CORS down.** Set `ALLOWED_ORIGIN` to the exact MyFileKit origin, never
  `*`, in production.
- **Treat uploads as untrusted.** The backend should verify the `%PDF-` magic and
  re-scan for active content (MyFileKit's own Sanitize PDF tool is a good local
  pre-step for the sender).
- **Do not over-claim.** The reference's "final signed PDF" is the original bytes
  plus an audit record; it is **not** a cryptographically sealed document. Apply
  real signing/sealing before presenting output as legally binding.

## The default guarantee, restated

None of the above affects a default install. With the shipped
`connect-src 'self'`, the Request e-Signature tool is inert: it uploads nothing,
creates no envelope, and the service refuses before any network call. A fresh
`npm run build` produces exactly that. See [`../SECURITY.md`](../SECURITY.md) →
*"Optional server-backed features (off by default)"*.
