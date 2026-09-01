# Conversion server

The browser cannot convert an Office document without turning its text into a
picture. Measured on the same `.docx`: the client-side path yields **0
extractable characters**; this server yields **88** — real, selectable text.
That gap is the only reason this exists.

## What it does not do

- It does not store anything. Each request gets a private temp directory that is
  removed in a `finally` block, whether the conversion succeeded or not.
- It does not log file contents or filenames.
- It never puts a caller-supplied name on a path or a command line; it generates
  its own. Every external tool is spawned with an argument array, never a shell.

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

Limits: 100 MB per file, 120 s per conversion, 20 requests per minute per IP.
The rate limit is crude on purpose — a real deployment fronts this with a proxy
that does it properly.
