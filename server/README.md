# Conversion server

Three jobs a browser genuinely cannot do well. Each number below was measured
through the endpoint, not estimated:

| Job | In the browser | Here |
|---|---|---|
| Office to PDF | 0 extractable characters — the text becomes a picture | 88 characters, real selectable text |
| Compress an image-heavy PDF | turns pages into JPEGs | 2,431,436 → 402,022 bytes (83% smaller) |
| Compress a text PDF | usually **grows** the file, and destroys the text | 16,136 → 11,401 bytes, `128450.00` still extracts |
| OCR | recognises words | deskews and cleans the page first, and positions the invisible text to match the image |

Everything the browser does well stays in the browser. Nothing here runs unless
the user picks it for that one file.

## What it does not do

- It does not store anything. Each request gets a private temp directory that is
  removed in a `finally` block, whether the conversion succeeded or not.
- It does not log file contents or filenames.
- It never puts a caller-supplied name on a path or a command line; it generates
  its own. Every external tool is spawned with an argument array, never a shell.

## The input gate, and why it is stricter than it looks

`gs` and `ocrmypdf` are not file converters, they are **interpreters**. Hand
Ghostscript a `.ps` and it executes the PostScript program inside, which can
open files. So both endpoints require the `%PDF-` header before anything is
written to disk, and `gs` additionally runs with `-dSAFER` and `-P-`.

Verified, not assumed: a `.ps` whose program tries to write `/tmp/mfk-pwned.txt`
is refused with **415**, and no file appears. There is a test for it.

Everything that reaches a command line is an **allowlist lookup**, never a
sanitised string — the Office extension, the compression preset, and the OCR
language. A value not on the list is refused before the tool is spawned.

## Two refusals worth knowing about

- **Compressing can make a file bigger.** Ghostscript's `/printer` preset did
  exactly that to an already-optimised test file. The server returns the
  *original* bytes with `X-Compressed: false`, and the UI says nothing changed.
  A larger file behind a success message is a lie the client cannot detect.
- **OCR never stacks text layers.** Running OCR over a page that already has
  text leaves two overlapping layers, so every word extracts twice. The server
  always passes either `--skip-text` or `--redo-ocr`, never neither, and never
  `--force-ocr` (which would rasterise a good text layer away).

## Why the app still ships `connect-src 'self'`

The API is served from the **same origin** as the app, under `/api`. That was a
deliberate choice: the single `connect-src 'self'` line in `index.html` is the
auditable proof that a default build cannot send a document anywhere, and a test
pins it. Relaxing the policy to add a feature would have traded the guarantee
for convenience — a same-origin API keeps both. In development, Vite proxies
`/api` through to this server, so the client code needs no second origin either.

## Run it

```bash
node server/index.js          # needs `soffice` on PATH for real conversions
```

```bash
docker build -t myfilekit-converter server/
docker run -p 8081:8081 myfilekit-converter
```

`GET /api/health` reports which converters this host actually has, so the UI
offers server conversion only when it will work:

```json
{ "ok": true, "capabilities": { "office": true, "ghostscript": false, "ocr": false },
  "retention": "none — files are deleted when the request finishes" }
```

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | capabilities, limits, accepted extensions, retention |
| POST | `/api/office-to-pdf` | body is the raw file; extension in `X-File-Extension` |
| POST | `/api/compress-pdf` | `X-Compression-Level: small\|balanced\|quality`; replies with `X-Original-Bytes` and `X-Compressed` |
| POST | `/api/ocr-pdf` | `X-Ocr-Language` (e.g. `eng`, `hin+eng`), `X-Ocr-Redo`; replies with `X-Ocr-Text-Chars` |

Limits: 100 MB per file, 120 s per conversion, 20 requests per minute per IP.
The rate limit is crude on purpose — a real deployment fronts this with a proxy
that does it properly.

## Before this is hosted for other people

The app tells users their file is "deleted when the request finishes". The code
above is what makes that true, but a hosted service owes more than working code,
and none of the following is done yet:

- [ ] **A privacy notice** users can read before they press the button, saying
      what is received, that it is not stored, and who operates the server.
      The claim is already on the landing page; the notice has to back it.
- [ ] **TLS**, terminated in front of this. It speaks plain HTTP by design.
- [ ] **Abuse handling** — the in-process rate limit is per instance and resets
      on restart. It is a speed bump, not a control.
- [ ] **Resource isolation.** LibreOffice and Ghostscript are large programs
      parsing untrusted input. Run them in a container with no network, a
      read-only root filesystem, and a memory cap — the Dockerfile is the
      starting point, not the finished job.
- [ ] **A decision about logs.** Nothing logs file contents today. Whatever the
      reverse proxy in front logs is a separate decision, and IP addresses in an
      access log are personal data in most of the places this would be used.
