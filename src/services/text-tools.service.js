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
  const readingMinutes = words ? Math.max(1, Math.ceil(words / 225)) : 0;
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
  const requestedLength = Number(options.length ?? 20);
  if (!Number.isFinite(requestedLength)) throw new Error("Password length must be a valid number.");
  const length = clamp(Math.trunc(requestedLength), 8, 128);
  const removeAmbiguous = options.avoidAmbiguous === true;
  const charset = {
    lower: removeAmbiguous ? "abcdefghjkmnpqrstuvwxyz" : "abcdefghijklmnopqrstuvwxyz",
    upper: removeAmbiguous ? "ABCDEFGHJKLMNPQRSTUVWXYZ" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    numbers: removeAmbiguous ? "23456789" : "0123456789",
    symbols: "!@#$%^&*()-_=+[]{};:,.?",
  };
  const pools = [
    options.lower !== false ? charset.lower : "",
    options.upper !== false ? charset.upper : "",
    options.numbers !== false ? charset.numbers : "",
    options.symbols ? charset.symbols : "",
  ].filter(Boolean);
  if (!pools.length) throw new Error("Choose at least one character set.");

  const minimumNumbers = Math.max(0, Math.trunc(Number(options.minimumNumbers ?? 0)) || 0);
  const minimumSymbols = Math.max(0, Math.trunc(Number(options.minimumSymbols ?? 0)) || 0);
  if (minimumNumbers > 0 && options.numbers === false) throw new Error("Enable numbers to require a minimum number count.");
  if (minimumSymbols > 0 && !options.symbols) throw new Error("Enable symbols to require a minimum symbol count.");

  const alphabet = pools.join("");
  const characters = pools.map((pool) => pool[randomIndex(pool.length)]);
  for (let index = 1; index < minimumNumbers; index += 1) characters.push(charset.numbers[randomIndex(charset.numbers.length)]);
  for (let index = 1; index < minimumSymbols; index += 1) characters.push(charset.symbols[randomIndex(charset.symbols.length)]);
  if (characters.length > length) throw new Error("Increase the length or reduce the required character counts.");
  while (characters.length < length) characters.push(alphabet[randomIndex(alphabet.length)]);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join("");
}

const PASSPHRASE_WORDS = [
  "amber", "anchor", "apricot", "archer", "aster", "atlas", "autumn", "bamboo", "beacon", "birch", "blossom", "breeze",
  "brook", "cabin", "cactus", "candle", "canyon", "cedar", "cipher", "cinder", "clover", "comet", "coral", "cricket",
  "dahlia", "dawn", "delta", "drift", "ember", "falcon", "fern", "fjord", "flint", "forest", "frost", "galaxy",
  "garden", "glacier", "harbor", "hazel", "horizon", "island", "jasmine", "juniper", "lagoon", "lantern", "laurel", "legend",
  "lilac", "linden", "maple", "marble", "meadow", "meteor", "mint", "monarch", "moss", "nebula", "north", "oasis",
  "oak", "opal", "orbit", "orchid", "otter", "pebble", "pepper", "pine", "prairie", "quartz", "raven", "reef",
  "river", "robin", "saffron", "sailor", "sierra", "solstice", "sparrow", "spruce", "starling", "summit", "sunset", "thistle",
  "timber", "topaz", "valley", "velvet", "violet", "voyage", "willow", "winter", "wren", "zephyr"
];

export function generatePassphrase(options = {}) {
  const requestedWords = Number(options.words ?? 6);
  if (!Number.isFinite(requestedWords)) throw new Error("Number of words must be valid.");
  const wordCount = clamp(Math.trunc(requestedWords), 3, 20);
  const separator = String(options.separator ?? "-").slice(0, 8);
  const capitalise = options.capitalise === true;
  const words = Array.from({ length: wordCount }, () => {
    const word = PASSPHRASE_WORDS[randomIndex(PASSPHRASE_WORDS.length)];
    return capitalise ? `${word[0].toUpperCase()}${word.slice(1)}` : word;
  });
  if (options.includeNumber) words.push(String(10 + randomIndex(90)));
  return words.join(separator);
}

export function passwordStrength(value) {
  const text = String(value || "");
  if (!text) return { label: "Not generated", score: 0, bits: 0 };
  let poolSize = 0;
  if (/[a-z]/.test(text)) poolSize += 26;
  if (/[A-Z]/.test(text)) poolSize += 26;
  if (/\d/.test(text)) poolSize += 10;
  if (/[^a-zA-Z0-9\s]/.test(text)) poolSize += 28;
  if (/\s|[-_]/.test(text)) poolSize = Math.max(poolSize, 48);
  const bits = Math.round(text.length * Math.log2(Math.max(poolSize, 1)));
  const score = bits >= 80 ? 4 : bits >= 60 ? 3 : bits >= 40 ? 2 : 1;
  const label = ["Not generated", "Fair", "Good", "Strong", "Very strong"][score];
  return { label, score, bits };
}

export function base64Encode(value) {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function base64Decode(value) {
  let binary;
  try {
    binary = atob(String(value ?? "").replace(/\s+/g, ""));
  } catch {
    throw new Error("This is not valid Base64 text.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("The decoded Base64 value is not valid UTF-8 text.");
  }
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

function randomIndex(length) {
  const range = 0x100000000;
  const limit = range - (range % length);
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % length;
}
