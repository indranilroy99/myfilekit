# Manual Test Checklist

Run the release build before completing this checklist:

```bash
npm install
npm run preflight
npm run build
npm run preview
```

Open the URL printed by Vite, normally `http://localhost:4173`.

## Dashboard And Navigation

- Confirm the text-only MyFileKit wordmark appears without a separate logo icon.
- Confirm the public UI contains no framework, release milestone, placeholder, AI, or coming-soon copy.
- Confirm the landing page shows the hero search, quick actions, Popular Tools, optional Recently Used, category links, privacy strip, product highlights, and footer.
- Confirm the full 38-tool library is available from Browse tools rather than being repeated on the landing page.
- Press `Cmd+K` on macOS or `Ctrl+K` on Windows/Linux and confirm the hero search receives focus.
- Search `metadata`, `invoice`, `merge pdf`, `compress image`, `signature`, `json`, and `hash`; confirm relevant results appear directly under the search.
- Press `Escape` and confirm the search clears.
- Search a nonsense phrase and confirm a helpful empty state appears.
- Open a tool, return to the dashboard, and confirm a non-duplicate Recently Used entry appears.
- Confirm browser back and forward navigation works between dashboard, category, and tool routes.
- Confirm every card on Browse tools opens a real tool page with no missing renderer or placeholder state.
- Confirm category pages show one page title and a responsive tool grid without duplicated headings.

## Theme And Responsive Layout

- Toggle dark and light themes from the header; confirm the complete page changes and the preference survives a reload.
- Test at approximately 390 px, 768 px, 1440 px, and 1920 px widths.
- Confirm forms, cards, dialogs, navigation, search results, and output actions do not overlap or overflow.
- Confirm desktop pages use the available width and mobile pages stack without horizontal scrolling.
- Confirm visible controls have keyboard focus styles and icon-only controls have accessible labels or tooltips.

## PDF Workflows

- Merge two PDFs and confirm one reviewable and downloadable PDF is produced.
- Split a multi-page PDF and confirm the selected page appears in the embedded preview before download.
- Delete a page, rotate pages, add text, add a signature, add page numbers, and add a watermark; review and download each result.
- Convert two images to one PDF and confirm page count and order.
- Upload an invalid page selection and confirm processing stops with a friendly error.
- Reset a processed tool and confirm the preview and export actions disappear.

## Image Workflows

- Compress, resize, convert, crop, rotate/flip, and add text to a supported image.
- Confirm each single-image result has review, download, and print actions.
- Batch compress two images and confirm one ZIP file downloads with two uniquely named outputs.
- Batch resize two images and confirm one ZIP file downloads with two uniquely named outputs.
- Confirm unsupported formats, oversized files, and invalid dimensions are rejected clearly.

## Privacy Workflows

- Upload a JPEG with EXIF/GPS data to Image Metadata Inspector and confirm the source file is inspected locally without a cleaning action being offered.
- Download the inspector JSON report and confirm it contains detected image metadata only.
- Upload a JPEG with EXIF/GPS data to EXIF & Metadata Cleaner and inspect detected file and metadata information.
- Repeat with supported PNG and WebP files when test fixtures are available.
- Download the metadata report and confirm it contains no unrelated browser or application data.
- Clean the image, confirm before/after sizes, review the result, and download a filename ending in `-cleaned`.
- Confirm the transparency note about browser re-encoding remains visible.
- Upload a PDF to PDF Metadata Cleaner, clean it, and confirm common title, author, subject, keyword, producer, and creator fields are absent in the output.
- Confirm neither metadata tool claims support for arbitrary file types.

## Password Generator

- Generate a password with upper/lowercase, numbers, symbols, minimum counts, and ambiguous characters excluded; verify the generated value honors the chosen settings.
- Switch to Passphrase, choose word count, separator, capitalisation, and optional number; verify the output matches the selected controls.
- Copy a generated value and confirm an empty output reports a friendly validation error.

## Invoice Generator

- Open Invoice Generator from the Business category and confirm the editor loads inside the app shell.
- Edit sender, client, line items, labels, payment details, tax/TDS, signature, branding, visibility, and layout controls.
- Click representative invoice sections and confirm the matching editor control is focused or revealed.
- Toggle optional sender, title, payment, item code, signature, footer, and decorative elements; confirm preview reflows cleanly.
- Download PDF and confirm it contains exactly one page when the preview fits one page.
- Compare the PDF with the editor preview: content, visibility, colors, typography, alignment, totals, signature, and spacing should match.
- Confirm no export-only title, footer, profile, payment text, color, or decorative element appears.
- Confirm the total due is not clipped and no blank second page is generated.
- Print from the invoice editor and confirm the print preview matches the on-screen invoice.

## Signature Workflows

- Draw a signature by pressing and dragging; hovering without a pressed pointer must not draw.
- Confirm a blank canvas cannot be downloaded as a valid signature.
- Type a non-empty signature and download PNG.
- Add a signature to an image, review the composed image, and download PNG.

## Text, Data, And Developer Workflows

- Convert text to PDF and review/download it.
- Preview Markdown and download escaped HTML.
- Format and minify valid JSON; reject invalid JSON with a friendly message.
- Convert CSV to JSON, JSON to CSV, and JSON to YAML; download generated outputs.
- Encode and decode URL and Unicode Base64 text.
- Compare two text blocks and download the diff.
- Confirm empty text reports zero reading time.
- Generate and compare SHA-256 hashes.
- Generate passwords across selected character groups and copy the result.
- Generate and download a QR code; reject empty input.
- Clean unsafe filenames and download the generated list.

## Browser And Resource Checks

- Open developer tools and confirm there are no uncaught errors during dashboard, preview, processing, reset, and download flows.
- Confirm blob previews are permitted by the Content Security Policy.
- Confirm downloads use sanitized filenames.
- Repeat representative workflows after several resets and confirm stale previews are not retained.
- Reload direct hashes such as `#dashboard`, `#browse-tools`, `#merge-pdf-tool`, and `#invoice-tool`.
- Test the production build in current Chrome or Edge and one of Firefox or Safari before a public release.
