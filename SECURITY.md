# Security

MyFileKit is a static browser app. The current product does not include server uploads, user accounts, sessions, cookies, databases, or remote file storage.

## Local-First Boundary

- Supported files are processed in the browser session.
- The app does not intentionally transmit selected files to a backend.
- The local dev server only serves files from this repository directory.
- The dashboard uses a Content Security Policy, disables framing, and avoids remote scripts.

## Secure Development Rules

- Do not add remote CDN scripts to production pages.
- Do not use `innerHTML` with untrusted input unless the content is escaped first.
- Do not add visible tools before they work end to end.
- Validate file type, count, and size before processing.
- Keep dependencies minimal and run `npm run security:audit` before release.

## Reporting Issues

For a private security report, contact the repository owner directly. Please include the affected route, browser, operating system, reproduction steps, and expected impact.
