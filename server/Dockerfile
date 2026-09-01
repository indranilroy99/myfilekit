# MyFileKit conversion server.
#
# Exists for one job: LibreOffice produces PDFs with real, selectable text where
# a browser can only rasterise. Ghostscript and OCRmyPDF are installed for the
# compress and OCR endpoints; the server probes for each at runtime and reports
# honestly through /api/health rather than failing mid-conversion.
FROM node:22-slim

# --no-install-recommends keeps this from pulling a desktop environment.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer libreoffice-calc libreoffice-impress \
      fonts-dejavu fonts-liberation \
      ghostscript \
      ocrmypdf tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY convert.js index.js ./

# Unprivileged: a converter that shells out to LibreOffice should never be root.
USER node

ENV PORT=8081
EXPOSE 8081

# The app talks to /api on its own origin, so a reverse proxy in front of this
# is expected — that is what keeps the browser's connect-src 'self' intact.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8081)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
