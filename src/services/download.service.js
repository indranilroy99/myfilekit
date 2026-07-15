import { withExtension } from "../utils/safe-filename.js";

export function revokeDownloadUrl(url) {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Ignore browser cleanup failures.
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  window.dispatchEvent(new CustomEvent("myfilekit:download-ready", {
    detail: {
      filename,
      mimeType: blob.type || "application/octet-stream",
      size: blob.size || 0,
      url,
    },
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  return { url, filename, size: blob.size || 0, mimeType: blob.type || "application/octet-stream" };
}

export function downloadBytes(bytes, filename, mimeType) {
  downloadBlob(new Blob([bytes], { type: mimeType }), filename);
}

export function downloadText(text, name, extension, mimeType = "text/plain;charset=utf-8") {
  downloadBlob(new Blob([text], { type: mimeType }), withExtension(name, extension));
}
