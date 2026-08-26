export function safeFilename(name, fallback = "myfilekit-file") {
  const cleaned = String(name || fallback)
    .split(/[\\/]/)
    .pop()
    .replace(/\.[^.]*$/, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  // A dot-only stem ("." or "..") is path-like, so never let one through.
  if (!cleaned || /^\.+$/.test(cleaned)) return fallback;
  return cleaned;
}

export function withExtension(name, extension) {
  return `${safeFilename(name)}.${String(extension).replace(/^\./, "")}`;
}

