window.MyFileKitTools = [
  {
    id: "merge-pdf",
    name: "Merge PDF",
    category: "PDF Tools",
    description: "Combine multiple PDF files into one document.",
    keywords: ["combine pdf", "join pdf", "merge documents"],
    status: "available",
    route: "#merge-pdf-tool",
    icon: "PDF",
    badges: ["Available", "Local processing", "PDF"]
  },
  {
    id: "split-pdf",
    name: "Split PDF",
    category: "PDF Tools",
    description: "Split a PDF into separate page files.",
    keywords: ["extract pages", "separate pdf", "cut pdf"],
    status: "available",
    route: "#split-pdf-tool",
    icon: "CUT",
    badges: ["Available", "Local processing", "PDF"]
  },
  {
    id: "compress-pdf",
    name: "Compress PDF",
    category: "PDF Tools",
    description: "Reduce PDF file size for sharing.",
    keywords: ["shrink pdf", "reduce pdf", "optimize pdf"],
    status: "coming-soon",
    icon: "ZIP",
    badges: ["Coming soon", "PDF"]
  },
  {
    id: "pdf-to-images",
    name: "PDF to Images",
    category: "PDF Tools",
    description: "Export PDF pages as image files.",
    keywords: ["pdf to jpg", "pdf to png", "export pages"],
    status: "coming-soon",
    icon: "IMG",
    badges: ["Coming soon", "PDF"]
  },
  {
    id: "images-to-pdf",
    name: "Images to PDF",
    category: "PDF Tools",
    description: "Create a PDF from image files.",
    keywords: ["jpg to pdf", "png to pdf", "image pdf"],
    status: "coming-soon",
    icon: "PDF",
    badges: ["Coming soon", "PDF", "Image"]
  },
  {
    id: "rotate-pdf",
    name: "Rotate PDF",
    category: "PDF Tools",
    description: "Rotate selected pages and save a new PDF.",
    keywords: ["turn pdf", "page rotation"],
    status: "coming-soon",
    icon: "ROT",
    badges: ["Coming soon", "PDF"]
  },
  {
    id: "reorder-pdf-pages",
    name: "Reorder PDF Pages",
    category: "PDF Tools",
    description: "Move pages into a new order.",
    keywords: ["organize pdf", "sort pages", "arrange pages"],
    status: "coming-soon",
    icon: "ORD",
    badges: ["Coming soon", "PDF"]
  },
  {
    id: "unlock-pdf",
    name: "Unlock PDF",
    category: "PDF Tools",
    description: "Remove password protection when you have permission.",
    keywords: ["remove password", "decrypt pdf"],
    status: "coming-soon",
    icon: "KEY",
    badges: ["Coming soon", "PDF", "Security"]
  },
  {
    id: "protect-pdf",
    name: "Protect PDF",
    category: "PDF Tools",
    description: "Add password protection to a PDF.",
    keywords: ["password pdf", "encrypt pdf", "secure document"],
    status: "coming-soon",
    icon: "SEC",
    badges: ["Coming soon", "PDF", "Security"]
  },
  {
    id: "add-page-numbers",
    name: "Add Page Numbers",
    category: "PDF Tools",
    description: "Add page numbers to PDF pages.",
    keywords: ["number pages", "footer", "pagination"],
    status: "coming-soon",
    icon: "123",
    badges: ["Coming soon", "PDF"]
  },
  {
    id: "watermark-pdf",
    name: "Watermark PDF",
    category: "PDF Tools",
    description: "Add text or image watermarks to a PDF.",
    keywords: ["stamp pdf", "brand pdf", "confidential"],
    status: "coming-soon",
    icon: "WM",
    badges: ["Coming soon", "PDF"]
  },
  {
    id: "compress-image",
    name: "Compress Image",
    category: "Image Tools",
    description: "Reduce JPG, PNG, or WebP image file size.",
    keywords: ["compress jpg", "compress png", "reduce image", "optimize image"],
    status: "available",
    route: "#compress-image-tool",
    icon: "IMG",
    badges: ["Available", "Local processing", "Image"]
  },
  {
    id: "resize-image",
    name: "Resize Image",
    category: "Image Tools",
    description: "Change image width and height.",
    keywords: ["scale image", "dimensions", "photo resize"],
    status: "coming-soon",
    icon: "SIZ",
    badges: ["Coming soon", "Image"]
  },
  {
    id: "convert-image",
    name: "Convert Image",
    category: "Image Tools",
    description: "Convert between common image formats.",
    keywords: ["jpg png webp", "image format", "convert jpg"],
    status: "coming-soon",
    icon: "CNV",
    badges: ["Coming soon", "Image"]
  },
  {
    id: "crop-image",
    name: "Crop Image",
    category: "Image Tools",
    description: "Crop an image to a selected area.",
    keywords: ["trim image", "crop photo"],
    status: "coming-soon",
    icon: "CRP",
    badges: ["Coming soon", "Image"]
  },
  {
    id: "jpg-to-png",
    name: "JPG to PNG",
    category: "Image Tools",
    description: "Convert JPG images to PNG.",
    keywords: ["jpeg to png", "transparent output"],
    status: "coming-soon",
    icon: "PNG",
    badges: ["Coming soon", "Image"]
  },
  {
    id: "png-to-jpg",
    name: "PNG to JPG",
    category: "Image Tools",
    description: "Convert PNG images to JPG.",
    keywords: ["png jpeg", "smaller image"],
    status: "coming-soon",
    icon: "JPG",
    badges: ["Coming soon", "Image"]
  },
  {
    id: "webp-converter",
    name: "WebP Converter",
    category: "Image Tools",
    description: "Convert images to or from WebP.",
    keywords: ["webp jpg", "webp png", "modern image"],
    status: "coming-soon",
    icon: "WEB",
    badges: ["Coming soon", "Image"]
  },
  {
    id: "remove-background",
    name: "Remove Background",
    category: "Image Tools",
    description: "Remove the background from an image.",
    keywords: ["cutout", "transparent background", "product photo"],
    status: "coming-soon",
    icon: "BG",
    badges: ["Coming soon", "Image"]
  },
  {
    id: "invoice-generator",
    name: "Invoice Generator",
    category: "Business Tools",
    description: "Create a professional invoice with templates, payments, TDS, and signatures.",
    keywords: ["invoice", "bill", "freelancer invoice", "tax invoice"],
    status: "available",
    route: "invoice-generator/index.html",
    icon: "INV",
    badges: ["Available", "Business"]
  },
  {
    id: "quote-generator",
    name: "Quote Generator",
    category: "Business Tools",
    description: "Prepare client quotes and service proposals.",
    keywords: ["quotation", "proposal", "pricing"],
    status: "coming-soon",
    icon: "QTE",
    badges: ["Coming soon", "Business"]
  },
  {
    id: "receipt-generator",
    name: "Receipt Generator",
    category: "Business Tools",
    description: "Create receipts for completed payments.",
    keywords: ["receipt", "payment proof", "paid"],
    status: "coming-soon",
    icon: "RCT",
    badges: ["Coming soon", "Business"]
  },
  {
    id: "estimate-generator",
    name: "Estimate Generator",
    category: "Business Tools",
    description: "Create estimates before work begins.",
    keywords: ["estimate", "job quote", "scope"],
    status: "coming-soon",
    icon: "EST",
    badges: ["Coming soon", "Business"]
  },
  {
    id: "purchase-order-generator",
    name: "Purchase Order Generator",
    category: "Business Tools",
    description: "Prepare purchase orders for suppliers.",
    keywords: ["po", "purchase order", "supplier"],
    status: "coming-soon",
    icon: "PO",
    badges: ["Coming soon", "Business"]
  },
  {
    id: "business-card-maker",
    name: "Business Card Maker",
    category: "Business Tools",
    description: "Design simple business cards.",
    keywords: ["visiting card", "contact card", "brand card"],
    status: "coming-soon",
    icon: "CARD",
    badges: ["Coming soon", "Business"]
  },
  {
    id: "draw-signature",
    name: "Draw Signature",
    category: "Signature Tools",
    description: "Draw and download a signature.",
    keywords: ["signature pad", "sign", "digital signature"],
    status: "coming-soon",
    icon: "SIG",
    badges: ["Coming soon", "Signature"]
  },
  {
    id: "upload-signature",
    name: "Upload Signature",
    category: "Signature Tools",
    description: "Clean up an uploaded signature image.",
    keywords: ["signature image", "transparent signature"],
    status: "coming-soon",
    icon: "UP",
    badges: ["Coming soon", "Signature"]
  },
  {
    id: "add-signature-to-pdf",
    name: "Add Signature to PDF",
    category: "Signature Tools",
    description: "Place a signature onto a PDF.",
    keywords: ["sign pdf", "signature pdf", "contract"],
    status: "coming-soon",
    icon: "PDF",
    badges: ["Coming soon", "Signature", "PDF"]
  },
  {
    id: "download-signature-png",
    name: "Download Signature as PNG",
    category: "Signature Tools",
    description: "Export a drawn signature as PNG.",
    keywords: ["signature png", "transparent png"],
    status: "coming-soon",
    icon: "PNG",
    badges: ["Coming soon", "Signature"]
  },
  {
    id: "word-to-pdf",
    name: "Word to PDF",
    category: "Document Tools",
    description: "Convert Word documents to PDF.",
    keywords: ["docx pdf", "office to pdf"],
    status: "coming-soon",
    icon: "DOC",
    badges: ["Coming soon", "Document"]
  },
  {
    id: "pdf-to-word",
    name: "PDF to Word",
    category: "Document Tools",
    description: "Convert PDF content to editable Word format.",
    keywords: ["pdf docx", "editable pdf"],
    status: "coming-soon",
    icon: "DOC",
    badges: ["Coming soon", "Document", "PDF"]
  },
  {
    id: "text-extractor",
    name: "Text Extractor",
    category: "Document Tools",
    description: "Extract selectable text from supported files.",
    keywords: ["extract text", "copy text", "document text"],
    status: "coming-soon",
    icon: "TXT",
    badges: ["Coming soon", "Document"]
  },
  {
    id: "document-converter",
    name: "Document Converter",
    category: "Document Tools",
    description: "Convert supported document formats.",
    keywords: ["convert document", "file converter"],
    status: "coming-soon",
    icon: "CNV",
    badges: ["Coming soon", "Document"]
  },
  {
    id: "markdown-to-pdf",
    name: "Markdown to PDF",
    category: "Document Tools",
    description: "Render Markdown files as PDF documents.",
    keywords: ["md pdf", "readme pdf"],
    status: "coming-soon",
    icon: "MD",
    badges: ["Coming soon", "Document"]
  },
  {
    id: "redact-pdf",
    name: "Redact PDF",
    category: "Security Tools",
    description: "Remove sensitive content from PDF pages.",
    keywords: ["blackout pdf", "hide sensitive data"],
    status: "coming-soon",
    icon: "RED",
    badges: ["Coming soon", "Security", "PDF"]
  },
  {
    id: "remove-metadata",
    name: "Remove Metadata",
    category: "Security Tools",
    description: "Remove hidden file metadata where supported.",
    keywords: ["metadata cleaner", "privacy", "exif"],
    status: "coming-soon",
    icon: "META",
    badges: ["Coming soon", "Security"]
  },
  {
    id: "summarize-document",
    name: "Summarize Document",
    category: "AI Tools",
    description: "Summarize long documents after AI support is added.",
    keywords: ["summary", "summarizer", "shorten document"],
    status: "coming-soon",
    icon: "AI",
    badges: ["Coming soon", "AI"]
  },
  {
    id: "rewrite-text",
    name: "Rewrite Text",
    category: "AI Tools",
    description: "Rewrite pasted text in a selected tone.",
    keywords: ["paraphrase", "improve writing", "rewrite"],
    status: "coming-soon",
    icon: "TXT",
    badges: ["Coming soon", "AI"]
  },
  {
    id: "extract-key-points",
    name: "Extract Key Points",
    category: "AI Tools",
    description: "Pull key points from a document.",
    keywords: ["bullets", "highlights", "important points"],
    status: "coming-soon",
    icon: "KEY",
    badges: ["Coming soon", "AI"]
  },
  {
    id: "ocr-extract-text",
    name: "OCR / Extract Text",
    category: "AI Tools",
    description: "Extract text from scanned pages or images.",
    keywords: ["ocr", "scan text", "image text"],
    status: "coming-soon",
    icon: "OCR",
    badges: ["Coming soon", "AI", "Document"]
  }
];

