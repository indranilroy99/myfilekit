# Security

MyFileKit is a local-first browser app built with Vite, React, TypeScript, and Tailwind. The current product does not include server uploads, user accounts, sessions, cookies, databases, or remote file storage.

## Local-First Boundary

- Supported files are processed in the browser session.
- The app does not intentionally transmit selected files to a backend.
- PDF processing uses a vendored local copy of `pdf-lib`.
- The dashboard uses a Content Security Policy, disables framing, and avoids remote scripts.

## Dependency Security

Run:

```bash
npm run security:audit
```

This checks important local assets and runs `npm audit --audit-level=moderate`.

## Secure Development Rules

- Do not add remote CDN scripts to production pages.
- Do not use raw HTML rendering with untrusted input unless the content is escaped first.
- Do not add visible tools before they work end to end.
- Validate file type, count, and size before processing.
- Keep dependencies intentional and review new packages before release.

## Reporting Issues

For a private security report, contact the repository owner directly. Please include the affected route, browser, operating system, reproduction steps, and expected impact.
