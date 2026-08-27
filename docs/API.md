# MyFileKit Programmatic API

MyFileKit ships a stable, namespaced JavaScript API over the exact same services
the app uses. Import it from the module, or use `window.MyFileKit` in the
browser.

```js
import { MyFileKit } from "myfilekit";
// or, in the browser after the app loads:
const api = window.MyFileKit;

const mergedBytes = await MyFileKit.pdf.merge([fileA, fileB]);
```

## This is a LOCAL, client-side API — the privacy differentiator

Unlike the **server-side** APIs of iLovePDF or Stirling PDF — where you upload
your file to their machine and authenticate with a key — the MyFileKit API runs
**100% in your own browser or Node process**:

- **No server.** Every method is a local computation.
- **No upload.** Your bytes never leave the process. `window.MyFileKit` opens no
  network connection of any kind.
- **No key.** There is nothing to sign up for and nothing to configure.

The pure pdf-lib methods (`merge`, `split`, `encrypt`, `sanitize`,
`archivalPrep`, …) work in **Node** as well as the browser. Methods that need a
browser engine (canvas / pdf.js / tesseract — `compress`, `toImages`,
`extractText`, `ocr.*`, `image.*`) throw a clear error if called outside one.

**Inputs** are a `File`, `Blob`, `Uint8Array`, or `ArrayBuffer` (coerced for
you). **Outputs** are `Uint8Array` PDF bytes for the pure transforms, or a
result object (`{ bytes, report }`, `{ text, pages, bytes }`, `[{ name, blob }]`,
…) where the underlying service returns one.

---

## `MyFileKit.pdf`

| Method | Signature | Description |
| --- | --- | --- |
| `merge` | `merge(files) → Uint8Array` | Combine several PDFs into one. |
| `split` | `split(file, ranges) → Uint8Array` | Pull pages into one new PDF; `ranges` is `"1-3,5"` (1-based) or a 0-based index array. |
| `extractPages` | `extractPages(file, indexes) → Uint8Array` | Keep only these 0-based page indexes. |
| `deletePages` | `deletePages(file, indexes) → Uint8Array` | Remove these 0-based page indexes. |
| `rotate` | `rotate(file, degrees, indexes?) → Uint8Array` | Rotate the given pages (or all) by a multiple of 90°. |
| `organize` | `organize(file, order) → Uint8Array` | Reorder / duplicate / drop pages by a page-order string (`"3,1,2"`). |
| `cropResize` | `cropResize(file, options) → Uint8Array` | Scale to a standard size or apply a margin crop. |
| `addText` | `addText(file, text, options) → Uint8Array` | Stamp brand-new text onto a page. |
| `watermark` | `watermark(file, text, options) → Uint8Array` | Stamp a diagonal text watermark on every page. |
| `pageNumbers` | `pageNumbers(file, options) → Uint8Array` | Add centred page numbers. |
| `bates` | `bates(file, options) → { bytes, first, last, count }` | Stamp continuous legal Bates numbers. |
| `headersFooters` | `headersFooters(file, options) → Uint8Array` | Draw custom header/footer text. |
| `cleanMetadata` | `cleanMetadata(file) → Uint8Array` | Remove Info, XMP, and private app data. |
| `readFormFields` | `readFormFields(file) → Array` | Read an AcroForm's fields. |
| `fillForm` | `fillForm(file, values, flatten?) → Uint8Array` | Fill (and optionally flatten) an AcroForm. |
| `smartSplit` | `smartSplit(file, options) → { zipped, partCount }` | Split into several files (every N / parts / at pages / by bookmark). |
| `impose` | `impose(file, options) → { bytes }` | N-up or saddle-stitch booklet imposition. |
| `extractAssets` | `extractAssets(file, options) → object` | Extract embedded images + file attachments. |
| `extractAssetsZip` | `extractAssetsZip(result) → Uint8Array` | Bundle an `extractAssets` result into a ZIP. |
| `fromText` | `fromText(text) → Uint8Array` | Build a PDF from plain text. |
| `fromImages` | `fromImages(files) → Uint8Array` | Build a PDF from JPG/PNG/WebP images. |
| `compress` | `compress(file, options) → { bytes, before, after }` | Shrink by rasterising pages. *(browser)* |
| `flatten` | `flatten(file, options) → Uint8Array` | Rebuild a flat, non-interactive PDF. *(browser)* |
| `invert` | `invert(file, options) → Uint8Array` | Invert page colours for dark-mode reading. *(browser)* |
| `toImages` | `toImages(file, options) → [{ name, blob }]` | Render each page to an image blob. *(browser)* |
| `toZip` | `toZip(file, options) → { zipped, pages }` | Burst into one single-page PDF per page, zipped. |
| `extractText` | `extractText(file, options) → string` | Extract selectable text, page by page. *(browser)* |
| `redact` | `redact(file, rects, options) → { bytes }` | Permanently redact rectangles by rasterising. *(browser)* |
| `repair` | `repair(file, options) → { bytes }` | Best-effort repair / re-save. |
| `fingerprint` | `fingerprint(file, options) → { bytes, id }` | Embed an invisible traceable identifier. |
| `encrypt` | `encrypt(file, options) → { bytes }` | Password-protect with AES-256/128. |
| `decrypt` | `decrypt(file, password) → { bytes }` | Decrypt a PDF you can open. |
| `unlock` | `unlock(file) → { bytes }` | Remove owner-password restrictions. |
| `sanitize` | `sanitize(input, options) → { bytes, report }` | Strip active-content threats at the object level. |
| `archivalPrep` | `archivalPrep(input, options) → { bytes, report }` | Best-effort PDF/A-2b archival prep (sRGB OutputIntent, PDF/A XMP, `/ID`, `/Lang`). |
| `sign` | `sign(file, options) → object` | Cryptographically sign with a PKCS#12 certificate. |
| `verify` | `verify(file) → object` | Verify every digital signature (offline maths only). |

### `MyFileKit.pdf.accessibility`

| Method | Signature | Description |
| --- | --- | --- |
| `check` | `check(input, options) → object` | Audit against PDF/UA + WCAG basics. |
| `tag` | `tag(input, params) → object` | Auto-tag toward PDF/UA (language, title, structure tree, alt text). |

## `MyFileKit.ocr`

| Method | Signature | Description |
| --- | --- | --- |
| `pdf` | `pdf(file, options) → { text, pages, bytes }` | OCR a scanned PDF and rebuild a searchable PDF. *(browser)* |
| `images` | `images(images, options) → Array` | OCR a list of image blobs. *(browser)* |

## `MyFileKit.image`

| Method | Signature | Description |
| --- | --- | --- |
| `compress` | `compress(file, type, quality) → Blob` | Re-encode an image at a chosen quality. *(browser)* |
| `convert` | `convert(file, type, quality) → Blob` | Convert an image to another format. *(browser)* |
| `resize` | `resize(file, width, height, options?) → Uint8Array` | Resize an image, returning encoded bytes. *(browser)* |

## `MyFileKit.batch`

| Method | Signature | Description |
| --- | --- | --- |
| `run` | `run(op, files, options?, runtime?) → { opId, total, outputs, failures }` | Apply ONE operation across MANY files, isolating per-file failures. |
| `zip` | `zip(outputs) → Uint8Array` | Bundle batch outputs into a ZIP. |

## `MyFileKit.workflow`

| Method | Signature | Description |
| --- | --- | --- |
| `ops` | `ops() → string[]` | List the chainable workflow operation ids. |
| `run` | `run(steps, file) → Uint8Array` | Run a chain of `{ op, options }` steps; each step's output feeds the next. |

## `MyFileKit.extractText`

`extractText(file, options) → string` — convenience alias for `pdf.extractText`.

---

## Examples

### Merge, then split (Node or browser)

```js
import { MyFileKit } from "myfilekit";

const merged = await MyFileKit.pdf.merge([fileA, fileB]); // Uint8Array
const firstThreeAndFifth = await MyFileKit.pdf.split(mergedFile, "1-3,5");
```

### Encrypt and clean metadata

```js
const { bytes } = await MyFileKit.pdf.encrypt(file, { userPassword: "hunter2", algorithm: "aes-256" });
const cleaned = await MyFileKit.pdf.cleanMetadata(file); // Uint8Array
```

### Archive to PDF/A-2b (self-contained)

```js
const { bytes, report } = await MyFileKit.pdf.archivalPrep(file, { title: "Report", lang: "en" });
// report.conformance === "PDF/A-2B (best-effort, not validated)"
// Run veraPDF to certify before relying on it for legal compliance.
```

### Run a workflow, then a batch

```js
const stamped = await MyFileKit.workflow.run(
  [{ op: "watermark", options: { text: "DRAFT" } }, { op: "page-numbers" }],
  file,
);

const result = await MyFileKit.batch.run("rotate", files, { degrees: "90" });
const zip = MyFileKit.batch.zip(result.outputs); // Uint8Array
```

### Browser global

```html
<script type="module" src="/src/main.tsx"></script>
<script type="module">
  // After the app loads, the same object is on window.
  const merged = await window.MyFileKit.pdf.merge([fileA, fileB]);
</script>
```
