export function jsonToYaml(input) {
  const value = typeof input === "string" ? JSON.parse(input) : input;
  return toYaml(value).trimEnd() + "\n";
}

export function urlEncode(value) {
  return encodeURIComponent(String(value || ""));
}

export function urlDecode(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    throw new Error("This is not valid URL-encoded text.");
  }
}

export function textStats(text) {
  const value = String(text || "");
  const words = value.trim() ? value.trim().split(/\s+/).filter(Boolean).length : 0;
  const characters = value.length;
  const charactersNoSpaces = value.replace(/\s/g, "").length;
  const lines = value ? value.split(/\r?\n/).length : 0;
  const readingMinutes = Math.max(1, Math.ceil(words / 225));
  return { words, characters, charactersNoSpaces, lines, readingMinutes };
}

export function lineDiff(left, right) {
  const a = String(left || "").split(/\r?\n/);
  const b = String(right || "").split(/\r?\n/);
  const rows = [];
  const max = Math.max(a.length, b.length);
  for (let index = 0; index < max; index += 1) {
    if (a[index] === b[index]) rows.push({ type: "same", left: a[index] ?? "", right: b[index] ?? "" });
    else {
      if (a[index] !== undefined) rows.push({ type: "removed", left: a[index], right: "" });
      if (b[index] !== undefined) rows.push({ type: "added", left: "", right: b[index] });
    }
  }
  return rows;
}

export function diffToText(rows) {
  return rows.map((row) => {
    if (row.type === "same") return `  ${row.left}`;
    if (row.type === "removed") return `- ${row.left}`;
    return `+ ${row.right}`;
  }).join("\n");
}

export function generatePassword(options = {}) {
  const length = clamp(Number(options.length || 20), 8, 128);
  const pools = [
    options.lower !== false ? "abcdefghijkmnopqrstuvwxyz" : "",
    options.upper !== false ? "ABCDEFGHJKLMNPQRSTUVWXYZ" : "",
    options.numbers !== false ? "23456789" : "",
    options.symbols ? "!@#$%^&*()-_=+[]{};:,.?" : "",
  ].filter(Boolean);
  if (!pools.length) throw new Error("Choose at least one character set.");
  const alphabet = pools.join("");
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function cleanFilenameList(input) {
  return String(input || "")
    .split(/\r?\n/)
    .map((line) => safePortableName(line))
    .filter(Boolean)
    .join("\n");
}

export function safePortableName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "";
  const extensionMatch = trimmed.match(/(\.[a-z0-9]{1,12})$/i);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : "";
  const base = (extension ? trimmed.slice(0, -extension.length) : trimmed)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\-\s]+|[.\-\s]+$/g, "")
    .slice(0, 96);
  return `${base || "file"}${extension}`;
}

function toYaml(value, depth = 0) {
  const indent = "  ".repeat(depth);
  if (Array.isArray(value)) {
    if (!value.length) return `${indent}[]\n`;
    return value.map((item) => {
      if (isPlainObject(item) || Array.isArray(item)) return `${indent}-\n${toYaml(item, depth + 1)}`;
      return `${indent}- ${formatYamlScalar(item)}\n`;
    }).join("");
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (!entries.length) return `${indent}{}\n`;
    return entries.map(([key, item]) => {
      const safeKey = /^[a-zA-Z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
      if (isPlainObject(item) || Array.isArray(item)) return `${indent}${safeKey}:\n${toYaml(item, depth + 1)}`;
      return `${indent}${safeKey}: ${formatYamlScalar(item)}\n`;
    }).join("");
  }
  return `${indent}${formatYamlScalar(value)}\n`;
}

function formatYamlScalar(value) {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  if (!text || /[:#\n\r\t]|^\s|\s$|^(true|false|null|\d)/i.test(text)) return JSON.stringify(text);
  return text;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
