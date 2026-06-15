import { withExtension } from "../utils/safe-filename.js";

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

export function downloadBytes(bytes, filename, mimeType) {
  downloadBlob(new Blob([bytes], { type: mimeType }), filename);
}

export function downloadText(text, name, extension, mimeType = "text/plain;charset=utf-8") {
  downloadBlob(new Blob([text], { type: mimeType }), withExtension(name, extension));
}

