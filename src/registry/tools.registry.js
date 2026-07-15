export const tools = [
  tool("merge-pdf-tool", "Merge PDF", "PDF Tools", "Combine multiple PDFs into one file.", ["merge pdf", "combine pdf", "join pdf"], ["PDF", "Local"], { maxFiles: 20, types: ["application/pdf"], extensions: ["pdf"] }),
  tool("split-pdf-tool", "Split / Extract PDF Pages", "PDF Tools", "Extract selected pages from one PDF.", ["split pdf", "extract pages", "page ranges"], ["PDF", "Local"], { maxFiles: 1, types: ["application/pdf"], extensions: ["pdf"] }),
  tool("delete-pdf-pages-tool", "Delete PDF Pages", "PDF Tools", "Remove selected pages from a PDF.", ["delete pages", "remove pdf pages"], ["PDF", "Local"], { maxFiles: 1, types: ["application/pdf"], extensions: ["pdf"] }),
  tool("rotate-pdf-tool", "Rotate PDF Pages", "PDF Tools", "Rotate all or selected PDF pages.", ["rotate pdf", "turn pages"], ["PDF", "Local"], { maxFiles: 1, types: ["application/pdf"], extensions: ["pdf"] }),
  tool("add-text-to-pdf-tool", "Add Text to PDF", "PDF Tools", "Place new text onto selected PDF pages.", ["edit pdf", "add text pdf", "annotate pdf", "type on pdf"], ["PDF", "Local"], { maxFiles: 1, types: ["application/pdf"], extensions: ["pdf"] }),
  tool("add-signature-to-pdf-tool", "Add Signature to PDF", "PDF Tools", "Place a signature image onto a PDF page.", ["sign pdf", "add signature pdf", "pdf signature"], ["PDF", "Signature", "Local"], { maxFiles: 1, types: ["application/pdf"], extensions: ["pdf"] }),
  tool("pdf-page-numbers-tool", "Add PDF Page Numbers", "PDF Tools", "Add simple page numbers to every PDF page.", ["page numbers", "number pdf", "footer"], ["PDF", "Local"], { maxFiles: 1, types: ["application/pdf"], extensions: ["pdf"] }),
  tool("watermark-pdf-tool", "Watermark PDF", "PDF Tools", "Apply a text watermark across PDF pages.", ["watermark pdf", "stamp pdf", "draft"], ["PDF", "Local"], { maxFiles: 1, types: ["application/pdf"], extensions: ["pdf"] }),
  tool("pdf-metadata-cleaner-tool", "PDF Metadata Cleaner", "Privacy Tools", "Remove common document metadata fields from a PDF locally.", ["pdf metadata", "clean pdf", "privacy", "author", "title"], ["Privacy", "PDF", "Local"], { maxFiles: 1, types: ["application/pdf"], extensions: ["pdf"] }),
  tool("images-to-pdf-tool", "Images to PDF", "PDF Tools", "Create a PDF from JPG, PNG, or WebP images.", ["jpg to pdf", "png to pdf", "image pdf"], ["PDF", "Image", "Local"], { maxFiles: 20, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] }),
  tool("compress-image-tool", "Compress Image", "Image Tools", "Reduce JPG, PNG, or WebP file size.", ["compress image", "compress jpg", "optimize image"], ["Image", "Local"], { maxFiles: 1, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] }),
  tool("batch-compress-images-tool", "Batch Compress Images", "Image Tools", "Compress multiple JPG, PNG, or WebP images locally.", ["batch compress", "bulk image compress", "multiple images"], ["Image", "Local", "Batch"], { maxFiles: 20, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] }),
  tool("resize-image-tool", "Resize Image", "Image Tools", "Resize an image with optional aspect-ratio lock.", ["resize image", "scale image", "image dimensions"], ["Image", "Local"], { maxFiles: 1, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] }),
  tool("batch-resize-images-tool", "Batch Resize Images", "Image Tools", "Resize multiple images with the same settings.", ["batch resize", "bulk resize", "multiple image resize"], ["Image", "Local", "Batch"], { maxFiles: 20, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] }),
  tool("convert-image-tool", "Convert Image", "Image Tools", "Convert images between JPG, PNG, and WebP.", ["convert image", "jpg png webp"], ["Image", "Local"], { maxFiles: 1, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] }),
  tool("crop-image-tool", "Crop Image", "Image Tools", "Crop an image using numeric controls.", ["crop image", "trim image"], ["Image", "Local"], { maxFiles: 1, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] }),
  tool("rotate-flip-image-tool", "Rotate / Flip Image", "Image Tools", "Rotate or flip an image and export it.", ["rotate image", "flip image"], ["Image", "Local"], { maxFiles: 1, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] }),
  tool("add-text-to-image-tool", "Add Text to Image", "Image Tools", "Overlay new text onto JPG, PNG, or WebP images.", ["edit png text", "add text image", "caption image", "text overlay"], ["Image", "Local"], { maxFiles: 1, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] }),
  tool("add-signature-to-image-tool", "Add Signature to Image", "Signature Tools", "Place a signature image onto a photo or screenshot.", ["signature photo", "sign image", "add signature to photo"], ["Signature", "Image", "Local"], { maxFiles: 1, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] }),
  tool("invoice-generator-tool", "Invoice Generator", "Business Tools", "Create invoices with templates, taxes, payments, signatures, and brand controls.", ["invoice", "tax invoice", "bill", "receipt", "quote", "estimate", "business document"], ["Business"]),
  tool("draw-signature-tool", "Draw Signature", "Signature Tools", "Draw a signature and download it as PNG.", ["draw signature", "signature pad"], ["Signature", "Local"]),
  tool("type-signature-tool", "Type Signature", "Signature Tools", "Type a name, choose a style, and download a PNG signature.", ["type signature", "signature png"], ["Signature", "Local"]),
  tool("text-to-pdf-tool", "Text to PDF", "Text & Data Tools", "Convert plain text into a PDF.", ["text pdf", "plain text pdf"], ["Text", "PDF", "Local"]),
  tool("markdown-preview-tool", "Markdown Preview", "Text & Data Tools", "Preview Markdown and copy or download HTML.", ["markdown", "md preview", "html"], ["Text", "Local"]),
  tool("json-formatter-tool", "JSON Formatter", "Text & Data Tools", "Validate, format, and minify JSON.", ["json format", "json validate", "json minify"], ["Data", "Local"]),
  tool("csv-to-json-tool", "CSV to JSON", "Text & Data Tools", "Convert CSV text or files to JSON.", ["csv json", "convert csv"], ["Data", "Local"]),
  tool("json-to-csv-tool", "JSON to CSV", "Text & Data Tools", "Convert a JSON array of objects to CSV.", ["json csv", "convert json"], ["Data", "Local"]),
  tool("json-to-yaml-tool", "JSON to YAML", "Text & Data Tools", "Convert valid JSON into readable YAML.", ["json yaml", "convert yaml", "yaml"], ["Data", "Local"]),
  tool("url-codec-tool", "URL Encode / Decode", "Text & Data Tools", "Encode or decode URL-safe text.", ["url encode", "url decode", "percent encode"], ["Text", "Local"]),
  tool("diff-checker-tool", "Text Diff Checker", "Text & Data Tools", "Compare two text blocks line by line.", ["diff", "compare text", "line diff"], ["Text", "Local"]),
  tool("word-counter-tool", "Word Counter", "Text & Data Tools", "Count words, characters, lines, and reading time.", ["word count", "character count", "reading time"], ["Text", "Local"]),
  tool("metadata-cleaner", "EXIF & Metadata Cleaner", "Privacy Tools", "Inspect EXIF, XMP, ICC, GPS, and container metadata in supported image files, then clean them locally in your browser.", ["metadata", "exif", "privacy", "clean", "remove metadata", "image metadata", "photo metadata", "gps", "location", "camera model", "xmp", "icc"], ["Privacy", "Image", "Local processing"], { maxFiles: 1, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"], route: "#metadata-cleaner-tool" }),
  tool("base64-tool", "Base64 Encode / Decode", "Developer Utilities", "Encode text or decode Base64.", ["base64", "encode", "decode"], ["Developer", "Local"]),
  tool("file-hash-tool", "File Hash Generator", "Developer Utilities", "Generate a SHA-256 hash for a local file.", ["hash", "sha256", "checksum"], ["Developer", "Local"], { maxFiles: 1 }),
  tool("hash-compare-tool", "Hash Compare", "Developer Utilities", "Compare a file SHA-256 hash with an expected value.", ["compare hash", "checksum verify", "sha256 verify"], ["Developer", "Local"], { maxFiles: 1 }),
  tool("password-generator-tool", "Password Generator", "Developer Utilities", "Generate strong passwords locally.", ["password", "passphrase", "random"], ["Security", "Local"]),
  tool("qr-code-generator-tool", "QR Code Generator", "Developer Utilities", "Generate a downloadable QR code for text or links.", ["qr", "qr code", "upi qr", "link qr"], ["Utility", "Local"]),
  tool("filename-cleaner-tool", "Filename Cleaner", "Developer Utilities", "Clean unsafe filenames into portable names.", ["filename", "rename", "safe filename"], ["Utility", "Local"])
];

export const categories = [
  "PDF Tools",
  "Image Tools",
  "Business Tools",
  "Signature Tools",
  "Text & Data Tools",
  "Privacy Tools",
  "Developer Utilities"
];

function tool(id, name, category, description, keywords, badges, file = {}) {
  return {
    id,
    name,
    category,
    description,
    keywords,
    route: file.route || `#${id}`,
    status: "available",
    badges,
    acceptedTypes: file.types || [],
    file: {
      maxSize: 30 * 1024 * 1024,
      ...file
    },
    localProcessing: true
  };
}
