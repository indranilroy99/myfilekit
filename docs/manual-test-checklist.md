# Manual Test Checklist

Run the app with:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:4173`.

## Dashboard

- Confirm the professional MyFileKit logo renders in the header and hero.
- Confirm the header uses user-facing product copy and does not show release/version labels.
- Confirm the dashboard uses the premium utility theme: light cinematic background, glass surfaces, softer depth, refined typography, and fewer hard divider lines.
- Confirm the dashboard hero includes a subtle monochrome WebGL hills background behind the product copy.
- Confirm the main dashboard search is centered inside the hero and the product-quality cards appear below the tool library.
- Confirm Popular Tools appears above the full category library.
- Open one tool, return to the dashboard, and confirm Recently Used appears.
- Search `merge pdf` and confirm Merge PDF is shown.
- Search `compress image` and confirm Compress Image is shown.
- Search `invoice` and confirm Invoice Generator is shown.
- Search `signature` and confirm signature tools are shown.
- Click a quick search chip and confirm it filters the dashboard.
- Press `Cmd+K` on macOS or `Ctrl+K` on Windows/Linux and confirm the dashboard search receives focus.
- Press `Escape` inside the dashboard search and confirm the query clears.
- On desktop, open the header search dock, search `json`, press Enter, and confirm the dashboard filters to JSON tools.
- Search a nonsense query and confirm the empty state appears with suggested searches.
- Click every visible card and confirm it opens a real tool route.

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
- Convert two images into a PDF.

## Image Tools

- Compress a JPG or PNG and confirm a new image downloads.
- Resize an image with aspect ratio enabled.
- Convert one image to another supported format.
- Crop an image with numeric controls.
- Rotate and flip an image.

## Privacy Tools

- Search `metadata`, `exif`, and `privacy`; confirm Metadata Cleaner appears.
- Open Metadata Cleaner and confirm the local-processing privacy note is visible.
- Upload a JPG with metadata and confirm file name, type, size, dimensions, and last modified date appear.
- Click Clean metadata and confirm before/after file size appears.
- Download the cleaned image and confirm the filename ends with `-cleaned`.
- Upload an unsupported file such as PDF or TXT and confirm it is rejected clearly.
- Check Metadata Cleaner on mobile and confirm upload, file info, result, and action buttons do not overlap.

## Business And Signature Tools

- Open the invoice generator and confirm the premium editor loads.
- Confirm the invoice launcher mentions templates, tax/TDS, payment details, logo controls, signatures, and show/hide customization.
- Draw a signature and download PNG.
- Type a signature and download PNG.

## Text, Data, And Developer Tools

- Convert text to PDF.
- Preview Markdown and download HTML.
- Format and minify valid JSON.
- Convert CSV to JSON.
- Convert JSON array data to CSV.
- Encode and decode Base64 text.
- Generate a SHA-256 hash for a local file.

## Responsive Checks

- Test desktop width.
- Test tablet width.
- Test mobile width.
- Confirm cards, forms, buttons, and text do not overlap.
