export const tools = [
  tool("merge-pdf-tool", "Merge PDF", "PDF Tools", "Combine multiple PDFs into one file.", ["merge pdf", "combine pdf", "join pdf"], ["PDF", "Local"], { maxFiles: 20, types: ["application/pdf"], extensions: ["pdf"] }),
  tool("split-pdf-tool", "Split / Extract PDF Pages", "PDF Tools", "Extract selected pages from one PDF.", ["split pdf", "extract pages", "page ranges"], ["PDF", "Local"], { maxFiles: 1, types: ["application/pdf"], extensions: ["pdf"] }),
  tool("delete-pdf-pages-tool", "Delete PDF Pages", "PDF Tools", "Remove selected pages from a PDF.", ["delete pages", "remove pdf pages"], ["PDF", "Local"], { maxFiles: 1, types: ["application/pdf"], extensions: ["pdf"] }),
  tool("rotate-pdf-tool", "Rotate PDF Pages", "PDF Tools", "Rotate all or selected PDF pages.", ["rotate pdf", "turn pages"], ["PDF", "Local"], { maxFiles: 1, types: ["application/pdf"], extensions: ["pdf"] }),
  tool("images-to-pdf-tool", "Images to PDF", "PDF Tools", "Create a PDF from JPG, PNG, or WebP images.", ["jpg to pdf", "png to pdf", "image pdf"], ["PDF", "Image", "Local"], { maxFiles: 20, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] }),
  tool("compress-image-tool", "Compress Image", "Image Tools", "Reduce JPG, PNG, or WebP file size.", ["compress image", "compress jpg", "optimize image"], ["Image", "Local"], { maxFiles: 1, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] }),
  tool("resize-image-tool", "Resize Image", "Image Tools", "Resize an image with optional aspect-ratio lock.", ["resize image", "scale image", "image dimensions"], ["Image", "Local"], { maxFiles: 1, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] }),
  tool("convert-image-tool", "Convert Image", "Image Tools", "Convert images between JPG, PNG, and WebP.", ["convert image", "jpg png webp"], ["Image", "Local"], { maxFiles: 1, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] }),
  tool("crop-image-tool", "Crop Image", "Image Tools", "Crop an image using numeric controls.", ["crop image", "trim image"], ["Image", "Local"], { maxFiles: 1, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] }),
  tool("rotate-flip-image-tool", "Rotate / Flip Image", "Image Tools", "Rotate or flip an image and export it.", ["rotate image", "flip image"], ["Image", "Local"], { maxFiles: 1, types: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] }),
  tool("invoice-generator-tool", "Invoice Generator", "Business Tools", "Open the professional invoice generator.", ["invoice", "tax invoice", "bill"], ["Business"]),
  tool("receipt-generator-tool", "Receipt Generator", "Business Tools", "Create a printable receipt from item rows.", ["receipt", "payment receipt"], ["Business", "Local"]),
  tool("quote-generator-tool", "Quote / Estimate Generator", "Business Tools", "Create a printable quote or estimate.", ["quote", "estimate", "proposal"], ["Business", "Local"]),
  tool("draw-signature-tool", "Draw Signature", "Signature Tools", "Draw a signature and download it as PNG.", ["draw signature", "signature pad"], ["Signature", "Local"]),
  tool("type-signature-tool", "Type Signature", "Signature Tools", "Type a name, choose a style, and download a PNG signature.", ["type signature", "signature png"], ["Signature", "Local"]),
  tool("text-to-pdf-tool", "Text to PDF", "Text & Data Tools", "Convert plain text into a PDF.", ["text pdf", "plain text pdf"], ["Text", "PDF", "Local"]),
  tool("markdown-preview-tool", "Markdown Preview", "Text & Data Tools", "Preview Markdown and copy or download HTML.", ["markdown", "md preview", "html"], ["Text", "Local"]),
  tool("json-formatter-tool", "JSON Formatter", "Text & Data Tools", "Validate, format, and minify JSON.", ["json format", "json validate", "json minify"], ["Data", "Local"]),
  tool("csv-to-json-tool", "CSV to JSON", "Text & Data Tools", "Convert CSV text or files to JSON.", ["csv json", "convert csv"], ["Data", "Local"]),
  tool("json-to-csv-tool", "JSON to CSV", "Text & Data Tools", "Convert a JSON array of objects to CSV.", ["json csv", "convert json"], ["Data", "Local"]),
  tool("base64-tool", "Base64 Encode / Decode", "Developer Utilities", "Encode text or decode Base64.", ["base64", "encode", "decode"], ["Developer", "Local"]),
  tool("file-hash-tool", "File Hash Generator", "Developer Utilities", "Generate a SHA-256 hash for a local file.", ["hash", "sha256", "checksum"], ["Developer", "Local"], { maxFiles: 1 })
];

export const categories = [
  "PDF Tools",
  "Image Tools",
  "Business Tools",
  "Signature Tools",
  "Text & Data Tools",
  "Developer Utilities"
];

function tool(id, name, category, description, keywords, badges, file = {}) {
  return {
    id,
    name,
    category,
    description,
    keywords,
    route: `#${id}`,
    status: "available",
    badges,
    file: {
      maxSize: 30 * 1024 * 1024,
      ...file
    },
    localProcessing: true
  };
}

