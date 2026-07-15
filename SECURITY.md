# Security Policy

MyFileKit is a local-first static web application built with Vite, React, TypeScript, and Tailwind CSS. It does not include application servers, user accounts, sessions, cookies, databases, analytics, or remote file storage.

## Supported Version

Security fixes are applied to the latest release on the `main` branch.

## Processing Boundary

- Supported files are processed in the active browser session.
- The app does not intentionally transmit selected files to a backend.
- PDF processing uses a local vendored copy of `pdf-lib`.
- Invoice capture uses a local vendored copy of `html2canvas`.
- Generated object URLs are short-lived and revoked when replaced, reset, or unmounted.
- Theme and recently used tool identifiers may be stored in `localStorage`; file contents are not.

Local processing reduces network exposure. It does not guarantee that an untrusted input file is harmless, that every hidden metadata object has been removed, or that a generated output is appropriate to open in another application.

## Application Controls

- The HTML entry points use a restrictive Content Security Policy for scripts, frames, objects, forms, images, and local assets.
- Production pages do not load remote fonts, analytics, or CDN scripts.
- User-controlled values are rendered through React or escaped before document export.
- File type, file count, file size, numeric ranges, and page selections are validated before processing.
- Dashboard cards are generated from a central registry and are only visible when their routes have working implementations.

## Required Hosting Headers

An HTML `<meta>` policy cannot enforce every response-level security control. Configure the static host to send headers similar to these:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
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
