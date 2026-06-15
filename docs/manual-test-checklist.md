# Manual Test Checklist

Run the app with:

```bash
npm run dev
```

Open `http://localhost:4173`.

## Dashboard

- Search `merge pdf` and confirm Merge PDF is shown.
- Search `compress image` and confirm Compress Image is shown.
- Search `invoice` and confirm Invoice Generator is shown.
- Search `signature` and confirm signature tools are shown.
- Search a nonsense query and confirm the empty state appears.
- Click every visible card and confirm it opens a real tool route.
- Use the header Dashboard link to return home.

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

## Business And Signature Tools

- Open the invoice generator and confirm the editor loads.
- Export a receipt HTML file.
- Export a quote HTML file.
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
