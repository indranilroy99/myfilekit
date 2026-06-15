export function safeFilename(name, fallback = "myfilekit-file") {
  const cleaned = String(name || fallback)
    .split(/[\\/]/)
    .pop()
    .replace(/\.[^.]*$/, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

export function withExtension(name, extension) {
  return `${safeFilename(name)}.${String(extension).replace(/^\./, "")}`;
}

