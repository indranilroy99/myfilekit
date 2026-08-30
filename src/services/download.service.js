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
      // The Blob itself, so a consumer can reuse the result as the next input
      // without re-fetching the object URL — `connect-src 'self'` does not
      // cover blob:, so fetch() on it is blocked by our own CSP.
      blob,
    },
  }));
  // Deliberately does NOT click a link.
  //
  // Every one of the ~109 result paths in this app used to write a file into
  // the user's Downloads folder the instant an operation finished — before they
  // had seen the result, and whether or not they wanted to keep it. Redact was
  // the worst case: it destroys content irreversibly, saved the output
  // automatically, and then advised "verify nothing sensitive remains before
  // sharing" about a file that was already on disk.
  //
  // The event above hands the result to the UI, which shows it and offers a
  // Download the user presses. Saving a file is the user's decision.
  return { url, filename, size: blob.size || 0, mimeType: blob.type || "application/octet-stream" };
}

export function downloadBytes(bytes, filename, mimeType) {
  downloadBlob(new Blob([bytes], { type: mimeType }), filename);
}

export function downloadText(text, name, extension, mimeType = "text/plain;charset=utf-8") {
  downloadBlob(new Blob([text], { type: mimeType }), withExtension(name, extension));
}
