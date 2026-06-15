export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index ? 2 : 0)} ${units[index]}`;
}

export function parsePageRanges(input, pageCount) {
  const text = String(input || "").trim();
  if (!text) throw new Error("Enter at least one page or range.");
  const pages = new Set();
  text.split(",").forEach((part) => {
    const token = part.trim();
    if (!token) return;
    const match = token.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error(`Invalid page range: ${token}`);
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start < 1 || end < 1 || start > end || end > pageCount) {
      throw new Error(`Page range ${token} is outside this document.`);
    }
    for (let page = start; page <= end; page += 1) pages.add(page - 1);
  });
  if (!pages.size) throw new Error("No pages selected.");
  return [...pages].sort((a, b) => a - b);
}

export function simpleMarkdownToHtml(markdown) {
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => {
      const escaped = escapeHtml(line);
      if (/^###\s+/.test(line)) return `<h3>${escapeHtml(line.replace(/^###\s+/, ""))}</h3>`;
      if (/^##\s+/.test(line)) return `<h2>${escapeHtml(line.replace(/^##\s+/, ""))}</h2>`;
      if (/^#\s+/.test(line)) return `<h1>${escapeHtml(line.replace(/^#\s+/, ""))}</h1>`;
      if (/^-\s+/.test(line)) return `<p>• ${escapeHtml(line.replace(/^-\s+/, ""))}</p>`;
      return escaped ? `<p>${escaped}</p>` : "";
    })
    .join("\n");
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

