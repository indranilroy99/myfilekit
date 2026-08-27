# MyFileKit e-Signature — reference backend

A minimal, **dependency-free** (Node stdlib only) signing backend for the
optional **Request e-Signature** tool in MyFileKit.

> This directory is **not** part of the MyFileKit app build and adds **no npm
> dependency** to the app. It is a reference you deploy yourself. Once you run
> it, **you hold other people's PDFs and email addresses** — read the security
> notes below and in the header of `server.js` before using it for anything real.

MyFileKit is 100% local by default and stays that way. The Request e-Signature
tool is the one deliberate exception, and it does nothing until an operator both
deploys a backend like this one **and** allows its origin in the MyFileKit
Content-Security-Policy. See [`../docs/TIER3-OPTIONAL-BACKEND.md`](../docs/TIER3-OPTIONAL-BACKEND.md).

## Endpoints

| Method | Path                       | Purpose                                                  |
| ------ | -------------------------- | -------------------------------------------------------- |
| POST   | `/envelopes`               | Accept `{ fileName, contentType, size, pdfBase64, signers, message }`, store it, return `{ id, status }`, and "email" each signer a signing link (stubbed to `console.log`). |
| GET    | `/envelopes/:id`           | The envelope's status and per-signer status.             |
| POST   | `/envelopes/:id/sign`      | A signer submits `{ email, token, signatureName }`.      |
| GET    | `/envelopes/:id/download`  | The final PDF once every signer has signed.              |

The request/response shapes match exactly what `src/services/esign.service.js`
sends and expects, so the shipped MyFileKit client talks to this backend as-is.

## Run it locally

This server **fails closed**: it refuses to start unless both `API_KEY` and
`ALLOWED_ORIGIN` are set (and `ALLOWED_ORIGIN` is a specific origin, not `*`).
There is no wildcard-CORS or no-auth default, so a copy-paste deploy cannot
accidentally expose an open, unauthenticated backend.

```bash
cd reference-backend
API_KEY=$(openssl rand -hex 32) ALLOWED_ORIGIN=http://localhost:5173 node server.js   # or: npm start
```

It listens on `http://localhost:4444` by default. Configure with env vars:

| Env var          | Default    | Meaning                                                                                      |
| ---------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `PORT`           | `4444`     | Port to listen on.                                                                           |
| `ALLOWED_ORIGIN` | *(required)* | CORS origin — your exact MyFileKit origin, e.g. `https://tools.example.com`. `*` is rejected. |
| `API_KEY`        | *(required)* | Shared secret; every request must send `Authorization: Bearer <API_KEY>`.                  |

Starting without them prints exactly what is missing and exits non-zero:

```text
[esign] refusing to start — insecure configuration:
  • API_KEY is not set. …
  • ALLOWED_ORIGIN is not set. …
```

Quick smoke test with the client's payload shape:

```bash
# Create an envelope from a base64 PDF
curl -sX POST http://localhost:4444/envelopes \
  -H 'Content-Type: application/json' \
  -d '{"fileName":"demo.pdf","pdfBase64":"'"$(base64 -i demo.pdf)"'","signers":[{"email":"a@example.com"}],"message":"Please sign"}'
# → {"id":"…","status":"sent","signers":[…]}
```

## Point MyFileKit at it

1. Deploy this backend somewhere with **HTTPS** (see below).
2. In MyFileKit's `index.html` **and** `public/_headers`, change
   `connect-src 'self'` to `connect-src 'self' https://your-backend.example`,
   then rebuild and redeploy MyFileKit. Without this the browser blocks every
   request and the tool tells the user exactly which files to edit.
3. In the Request e-Signature tool, open **Settings**, enter your backend base
   URL (and API key if you set one), and **Save and enable**.

## Deploy checklist (production)

- [ ] **TLS only.** Terminate HTTPS (a reverse proxy such as Caddy/Nginx, or a
      platform that does it for you). The PDF is in the request body.
- [ ] **Set `ALLOWED_ORIGIN`** to your exact MyFileKit origin — not `*`.
- [ ] **Set `API_KEY`** (and configure the same key in the MyFileKit tool) so
      random callers cannot create envelopes.
- [ ] **Replace the in-memory store** with a real store, **encrypted at rest**.
- [ ] **Require the per-signer token** on the sign and download routes (the
      reference already checks it on `/sign`; extend it as your flow needs).
- [ ] **Send real email** in `createEnvelope` (the `TODO` there) via your
      provider.
- [ ] **Implement real signing** in `finalizeEnvelope` (the `TODO` there): stamp
      a visible signature and/or apply a cryptographic seal (PAdES). The
      reference returns the original bytes plus an audit record and must not be
      presented as a legally sealed document.
- [ ] **Define a retention policy** and delete envelopes when done.

### Deploying behind Caddy (example)

```
esign.example.com {
    reverse_proxy localhost:4444
}
```

Then run the backend with:

```bash
ALLOWED_ORIGIN=https://tools.example.com API_KEY=$(openssl rand -hex 24) node server.js
```

## Optional: import the PDF from Google Drive / Dropbox

Some operators want the "choose a PDF" step to pull from cloud storage instead
of the local disk. That needs **the operator's own OAuth app** (client id, and a
CSP allowance for the picker origins), so it is documented as a stub rather than
shipped. This runs **client-side in MyFileKit**, not in this backend, and is
still gated by the same CSP rule.

**Google Drive (Picker API)** — create an OAuth client + API key in Google Cloud,
add the picker origins to MyFileKit's `connect-src`/`script-src`, then:

```js
// Reference sketch — runs in the browser after the operator has loaded the
// Google Picker script (which itself needs a CSP script-src allowance).
function openDrivePicker(oauthToken, apiKey, onPicked) {
  const view = new google.picker.DocsView()
    .setMimeTypes("application/pdf");
  const picker = new google.picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(oauthToken)        // obtained via the operator's OAuth client
    .setDeveloperKey(apiKey)
    .setCallback((data) => {
      if (data.action !== google.picker.Action.PICKED) return;
      const fileId = data.docs[0].id;
      // Download the bytes with the same OAuth token, then hand them to
      // requestEnvelope({ file: { bytes, fileName, contentType } , … }).
      fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${oauthToken}` },
      }).then((r) => r.arrayBuffer()).then((buf) => onPicked(new Uint8Array(buf)));
    })
    .build();
  picker.setVisible(true);
}
```

CSP additions the operator must make for the above (in `index.html` **and**
`public/_headers`):

```
script-src 'self' https://apis.google.com;
connect-src 'self' https://your-backend.example https://www.googleapis.com https://content.googleapis.com;
frame-src 'self' blob: https://docs.google.com;
```

**Dropbox (Chooser)** — register an app on the Dropbox developer console, add
`https://www.dropbox.com` to `script-src`/`frame-src`, load `dropins.js` with
your app key, and use `Dropbox.choose({ linkType: "direct", extensions: [".pdf"] })`;
fetch the returned `link`, then hand the bytes to `requestEnvelope` the same way.

Neither picker changes the privacy story: nothing is uploaded until the user
presses **Send for signature**, and the destination is still only the operator's
own backend.
