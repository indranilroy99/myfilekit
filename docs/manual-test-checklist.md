# Manual Test Checklist

Run the app with:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:4173`.

## Dashboard

- Confirm the MyFileKit text wordmark renders in the header and hero without a separate icon mark.
- Confirm the header uses user-facing product copy and does not show release/version labels.
- Confirm the dashboard uses the premium utility theme: warm light background, clean cards, subtle borders, softer depth, refined typography, and fewer hard divider lines.
- Confirm the dashboard hero keeps visual texture subtle and does not overpower the product copy.
- Confirm the main dashboard search is centered inside the hero and search results appear directly below it.
- Confirm Popular Tools appears below the hero.
- Confirm Recently Used stays hidden until a tool has been opened.
- Confirm category overview cards link to each tool category.
- Confirm the privacy and trust strip appears below the category cards.
- Confirm the full tool library is not dumped on the landing page.
- Click Browse tools and confirm the full searchable tool library opens.
- Open one tool, return to the dashboard, and confirm Recently Used appears.
- Search `merge pdf` and confirm Merge PDF is shown.
- Search `compress image` and confirm Compress Image is shown.
- Search `invoice` and confirm Invoice Generator is shown.
- Search `signature` and confirm signature tools are shown.
- Click a quick search chip and confirm it filters the dashboard.
- Press `Cmd+K` on macOS or `Ctrl+K` on Windows/Linux and confirm the dashboard search receives focus.
- Press `Escape` inside the dashboard search and confirm the query clears.
- Search `json`, press Enter, and confirm the best matching JSON tool route opens.
- Search a nonsense query and confirm the empty state appears with suggested searches.
- Click every visible card and confirm it opens a real tool route.
- Open a category page, use the category search field, and confirm the visible cards filter within that category.
- Open Browse Tools, search `metadata`, and confirm the tool library filters across categories.

## Navigation

- Click Dashboard and confirm it returns home.
- Click PDF in the top navigation and confirm all PDF tools are listed.
- Click Image in the top navigation and confirm all image tools are listed.
- Open a tool and confirm icon-only Back, Forward, Dashboard, and category links are visible.
- Use browser back and forward across two tool pages.

## PDF Tools

- Merge two small PDFs and download the merged file.
- Extract pages from one PDF using `1` or `1-2`.
- Delete one page from a multi-page PDF.
- Rotate a PDF and download the result.
- Add new text to a PDF and download the result.
- Add a signature image to a PDF and download the result.
- Add page numbers to a PDF and download the result.
- Add a text watermark to a PDF and download the result.
- Convert two images into a PDF.

## Image Tools

- Compress a JPG or PNG and confirm a new image downloads.
- Batch compress two images and confirm both outputs download.
- Resize an image with aspect ratio enabled.
- Batch resize two images and confirm both outputs download.
- Convert one image to another supported format.
- Crop an image with numeric controls.
- Rotate and flip an image.
- Add new text to an image and confirm a PNG downloads.
- Confirm Add Text to Image explains that it overlays text and does not OCR/replace existing baked-in text.

## Privacy Tools

- Search `metadata`, `exif`, `gps`, and `privacy`; confirm EXIF & Metadata Cleaner appears.
- Open Metadata Cleaner and confirm the local-processing privacy note is visible.
- Upload a JPG with EXIF/GPS metadata and confirm file name, type, size, dimensions, last modified date, privacy scan, and detected metadata sections appear.
- Upload a PNG or WebP with metadata and confirm detected containers such as PNG text, XMP, or ICC appear when present.
- Download the JSON report and confirm it contains the detected metadata summary.
- Click Clean metadata and confirm before/after file size appears.
- Download the cleaned image and confirm the filename ends with `-cleaned`.
- Upload an unsupported file such as PDF or TXT and confirm it is rejected clearly.
- Open PDF Metadata Cleaner, upload a PDF, clean it, and confirm a `-metadata-cleaned.pdf` file downloads.
- Check Metadata Cleaner on mobile and confirm upload, file info, result, and action buttons do not overlap.

## Business And Signature Tools

- Open the invoice generator and confirm the premium editor loads.
- Confirm the invoice launcher mentions templates, tax/TDS, payment details, logo controls, signatures, and show/hide customization.
- Draw a signature and download PNG.
- Type a signature and download PNG.
- Add a signature image to a photo and confirm a PNG downloads.

## Text, Data, And Developer Tools

- Convert text to PDF.
- Preview Markdown and download HTML.
- Format and minify valid JSON.
- Convert CSV to JSON.
- Convert JSON array data to CSV.
- Convert JSON to YAML and download the YAML output.
- Encode and decode URL text.
- Compare two text blocks and download the diff.
- Count words, characters, lines, and reading time.
- Encode and decode Base64 text.
- Generate a SHA-256 hash for a local file.
- Compare a file SHA-256 hash against an expected value.
- Generate a local password and copy it.
- Generate a QR code and download PNG.
- Clean unsafe filenames and download the list.

## Responsive Checks

- Test desktop width.
- Test tablet width.
- Test mobile width.
- Confirm cards, forms, buttons, and text do not overlap.
