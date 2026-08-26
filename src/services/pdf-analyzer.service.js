// PDF Analyser — static, byte-level malware/threat triage for PDFs.
//
// This module deliberately does NOT use pdf-lib or pdf.js to parse the file:
// malware routinely breaks parsers on purpose, so a parser-based scan can be
// blinded by a malformed object it refuses to load. Instead every check runs
// over the raw bytes (mapped 1:1 to a Latin-1 string, so string index ==
// byte offset) and tolerates broken structure. Nothing here executes, evals,
// or renders anything it extracts — the file is treated as hostile input and
// only ever decoded for display. The module is pure and Node-testable; only
// crypto.subtle (hashing) and fflate (inflate) are used, no network, no DOM.

import { decompressSync } from "fflate";
import { sanitiseForReport } from "./pii.service.js";

// --- caps (keep an adversarial file from hanging or exhausting memory) --------

const MAX_STREAM_INPUT = 8 * 1024 * 1024; // compressed bytes read per stream
const MAX_INFLATE = 8 * 1024 * 1024; // inflated bytes kept per stream
const MAX_OBJSTM_TOTAL = 8 * 1024 * 1024; // aggregate inflated ObjStm bytes rescanned
const MAX_JS_DISPLAY = 4000; // characters of script shown per snippet
const MAX_JS_SNIPPETS = 25;
const MAX_EMBEDDED = 100;
const MAX_URIS = 100;
const MAX_FINDINGS = 500;
const MAX_OBFUSCATED = 60;

export const SEVERITY = ["Critical", "High", "Medium", "Low", "Info"];
const SEVERITY_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 };

// --- low-level byte / string helpers -----------------------------------------

/** Maps bytes to a string 1:1 (index == byte offset), in chunks to avoid stack blowups. */
function decodeLatin1(bytes) {
  let out = "";
  const chunk = 8192;
  for (let index = 0; index < bytes.length; index += chunk) {
    out += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return out;
}

/** Decodes `#xx` hex escapes inside a PDF name token (`/J#61vaScript` → `/JavaScript`). */
export function decodePdfName(name) {
  return String(name).replace(/#([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

const NAME_BODY = "[^\\s\\[\\]<>(){}\\/%]";

/**
 * Returns a copy of the content with every PDF name token's `#xx` escapes
 * decoded, so keyword detection cannot be fooled by `/J#61vaScript`.
 */
function normalizeNames(content) {
  return content.replace(new RegExp(`\\/(${NAME_BODY}*)`, "g"), (whole, body) =>
    body.includes("#") ? "/" + decodePdfName(body) : whole
  );
}

/** Finds name tokens that hide an ASCII letter/digit behind a `#xx` escape. */
export function findObfuscatedNames(content) {
  const found = [];
  const seen = new Set();
  const re = new RegExp(`\\/(${NAME_BODY}*#[0-9A-Fa-f]{2}${NAME_BODY}*)`, "g");
  let match;
  while ((match = re.exec(content)) && found.length < MAX_OBFUSCATED) {
    const raw = match[1];
    const decoded = decodePdfName(raw);
    // Only flag escapes that hide a benign, unnecessary character — the classic
    // evasion trick. A `#20` (space) inside a real name is a legitimate escape,
    // but hiding a letter/digit never is.
    const hidesAlnum = [...raw.matchAll(/#([0-9A-Fa-f]{2})/g)].some((m) => /[0-9A-Za-z]/.test(String.fromCharCode(parseInt(m[1], 16))));
    if (!hidesAlnum || seen.has(decoded)) continue;
    seen.add(decoded);
    found.push({ raw: "/" + raw, decoded: "/" + decoded });
  }
  return found;
}

/** Parses a PDF literal string starting at `open` (index of `(`); returns { value, end }. */
function parseLiteralString(content, open) {
  let depth = 0;
  let out = "";
  for (let i = open; i < content.length; i++) {
    const ch = content[i];
    if (ch === "\\") {
      const next = content[i + 1];
      if (next === "n") out += "\n";
      else if (next === "r") out += "\r";
      else if (next === "t") out += "\t";
      else if (next === "b") out += "\b";
      else if (next === "f") out += "\f";
      else if (next >= "0" && next <= "7") {
        const oct = content.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] || "";
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        i += oct.length;
        continue;
      } else out += next ?? "";
      i += 1;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      if (depth === 1) continue;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return { value: out, end: i };
    }
    if (depth >= 1) out += ch;
  }
  return { value: out, end: content.length };
}

/** Parses a PDF hex string starting at `open` (index of `<`); returns { value, end }. */
function parseHexString(content, open) {
  const close = content.indexOf(">", open + 1);
  const body = content.slice(open + 1, close < 0 ? content.length : close).replace(/[^0-9A-Fa-f]/g, "");
  let out = "";
  for (let i = 0; i < body.length; i += 2) out += String.fromCharCode(parseInt(body.substr(i, 2).padEnd(2, "0"), 16));
  return { value: out, end: close < 0 ? content.length : close };
}

// --- object index & stream extraction ----------------------------------------

/** Indexes every `n g obj … endobj` by offset. One linear pass. */
function indexObjects(content) {
  const list = [];
  const map = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let match;
  while ((match = re.exec(content))) {
    list.push({ num: +match[1], gen: +match[2], start: match.index, bodyStart: re.lastIndex, end: content.length });
  }
  for (let i = 0; i < list.length; i++) {
    const obj = list[i];
    const nextStart = i + 1 < list.length ? list[i + 1].start : content.length;
    const endobj = content.indexOf("endobj", obj.bodyStart);
    obj.end = endobj >= 0 && endobj < nextStart ? endobj : nextStart;
    map.set(`${obj.num} ${obj.gen}`, obj);
    if (!map.has(String(obj.num))) map.set(String(obj.num), obj);
  }
  return { list, map };
}

/** Returns the object whose byte range covers `index`, or null. */
function objectAt(list, index) {
  for (const obj of list) if (index >= obj.start && index <= obj.end) return obj;
  return null;
}

/** The dictionary text of an object (everything before its `stream`, if any). */
function objectDict(content, obj) {
  const streamAt = content.indexOf("stream", obj.bodyStart);
  const dictEnd = streamAt >= 0 && streamAt < obj.end ? streamAt : obj.end;
  return content.slice(obj.bodyStart, dictEnd);
}

/** Ordered list of filter names on an object dict (handles single and array forms). */
function filtersOf(dict) {
  const match = dict.match(/\/Filter\s*(\[[^\]]*\]|\/[^\s\[\]<>(){}\/%]+)/);
  if (!match) return [];
  return [...match[1].matchAll(/\/([^\s\[\]<>(){}\/%]+)/g)].map((m) => decodePdfName(m[1]));
}

/**
 * Extracts and decodes an object's stream bytes, applying the filters this tool
 * understands (ASCIIHexDecode, FlateDecode/zlib/raw). Always returns bytes or
 * null; never throws. `raw` bytes are capped, inflate output is capped, and an
 * unknown/failed filter yields the best available bytes rather than nothing.
 */
function decodeObjectStream(content, bytes, obj) {
  const streamAt = content.indexOf("stream", obj.bodyStart);
  if (streamAt < 0 || streamAt > obj.end) return null;
  let start = streamAt + 6;
  if (content[start] === "\r") start += 1;
  if (content[start] === "\n") start += 1;
  let end = content.indexOf("endstream", start);
  if (end < 0) end = Math.min(content.length, start + MAX_STREAM_INPUT);
  let data = bytes.subarray(start, Math.min(end, start + MAX_STREAM_INPUT));
  const filters = filtersOf(objectDict(content, obj));
  let failed = false;
  for (const filter of filters) {
    if (filter === "ASCIIHexDecode" || filter === "AHx") {
      const hex = decodeLatin1(data).replace(/>/g, "").replace(/[^0-9A-Fa-f]/g, "");
      const out = new Uint8Array(Math.floor(hex.length / 2));
      for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
      data = out;
    } else if (filter === "FlateDecode" || filter === "Fl") {
      try {
        data = decompressSync(data, { out: new Uint8Array(MAX_INFLATE) });
      } catch {
        failed = true;
        break;
      }
    } else {
      // LZWDecode, ASCII85Decode, DCTDecode, JBIG2Decode, etc. are not applied
      // here; return what we have so the caller can still hash/magic-check it.
      failed = true;
      break;
    }
  }
  return { bytes: data, filters, decoded: !failed };
}

/** Resolves `n g R` following a token to that object, or null. */
function resolveRef(content, map, afterIndex) {
  const tail = content.slice(afterIndex, afterIndex + 40);
  const ref = tail.match(/^\s*(\d+)\s+(\d+)\s+R\b/);
  if (!ref) return null;
  return map.get(`${ref[1]} ${ref[2]}`) || map.get(ref[1]) || null;
}

// --- magic bytes --------------------------------------------------------------

/** Classifies an embedded payload by its leading bytes. Returns { kind, executable }. */
export function classifyMagic(bytes) {
  const b = bytes || new Uint8Array(0);
  const starts = (sig) => sig.every((v, i) => b[i] === v);
  if (starts([0x4d, 0x5a])) return { kind: "Windows PE executable (MZ)", executable: true };
  if (starts([0x7f, 0x45, 0x4c, 0x46])) return { kind: "Linux/ELF executable", executable: true };
  if (starts([0xca, 0xfe, 0xba, 0xbe]) || starts([0xcf, 0xfa, 0xed, 0xfe])) return { kind: "Mach-O executable", executable: true };
  if (starts([0xd0, 0xcf, 0x11, 0xe0])) return { kind: "OLE compound file (legacy Office — may carry macros)", executable: true };
  if (starts([0x50, 0x4b, 0x03, 0x04]) || starts([0x50, 0x4b, 0x05, 0x06])) return { kind: "ZIP/Office Open XML archive (may carry macros)", executable: false };
  if (starts([0x4d, 0x53, 0x43, 0x46])) return { kind: "Microsoft Cabinet (CAB)", executable: true };
  if (starts([0x23, 0x21])) return { kind: "Script with shebang (#!)", executable: true };
  if (starts([0x25, 0x50, 0x44, 0x46])) return { kind: "Nested PDF (%PDF)", executable: false };
  if (starts([0x52, 0x61, 0x72, 0x21])) return { kind: "RAR archive", executable: false };
  if (starts([0x1f, 0x8b])) return { kind: "GZIP archive", executable: false };
  return { kind: "unknown / data", executable: false };
}

const DANGEROUS_EXT = /\.(exe|dll|scr|com|pif|bat|cmd|ps1|psm1|vbs|vbe|js|jse|jar|hta|wsf|wsh|lnk|msi|msp|cpl|sh|py|reg|docm|xlsm|pptm|dotm|xlam|iso|img)$/i;

// --- hashing ------------------------------------------------------------------

/** SHA-256 of bytes as lowercase hex. Works in the browser and in Node (crypto.subtle). */
export async function sha256Hex(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const buffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- main analysis ------------------------------------------------------------

/**
 * Statically analyses PDF bytes and returns structured findings plus factual
 * structure. Never executes anything it finds. Never throws on malformed input:
 * a broken file still yields a report with `parseError`/`truncated` noted.
 *
 * @param {Uint8Array|ArrayBuffer|{arrayBuffer:Function}} input
 * @param {{ onProgress?: (step:number,total:number)=>void }} [options]
 */
export async function analyzePdfBytes(input, options = {}) {
  const { onProgress } = options;
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input instanceof ArrayBuffer ? input : await input.arrayBuffer());
  const report = {
    fileSize: bytes.length,
    sha256: "",
    version: "unknown",
    pageCount: null,
    objectCount: 0,
    linearized: false,
    hasSignature: false,
    encrypted: false,
    objStmCount: 0,
    startxrefCount: 0,
    eofCount: 0,
    parseError: null,
    truncated: false,
    findings: [],
    embeddedFiles: [],
    verdict: { level: "clean", headline: "", summary: "", counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 } },
  };

  report.sha256 = await sha256Hex(bytes);
  onProgress?.(1, 5);

  const content = decodeLatin1(bytes);
  const header = content.slice(0, 1024);
  const headerAt = content.indexOf("%PDF-");
  if (headerAt < 0) {
    report.parseError = "No %PDF- header was found. This may not be a PDF, or the header is corrupt. Byte-level indicator scanning still ran on the raw content.";
  } else {
    report.version = content.slice(headerAt + 5, headerAt + 8).match(/^\d\.\d/)?.[0] || "unknown";
  }
  report.linearized = /\/Linearized\b/.test(header);
  report.startxrefCount = (content.match(/startxref/g) || []).length;
  report.eofCount = (content.match(/%%EOF/g) || []).length;
  report.truncated = report.eofCount === 0 || !/%%EOF\s*$/.test(content.slice(-1024));

  const { list, map } = indexObjects(content);
  report.objectCount = list.length;
  onProgress?.(2, 5);

  // Expand object streams (ObjStm) so indicators hidden from a naive scan are
  // still seen. Capped in aggregate; failures are tolerated.
  let expanded = normalizeNames(content);
  let objStmScanned = 0;
  for (const obj of list) {
    const dict = objectDict(content, obj);
    if (!/\/ObjStm\b/.test(dict) && !/\/ObjStm\b/.test(decodePdfName(dict))) continue;
    report.objStmCount += 1;
    if (objStmScanned >= MAX_OBJSTM_TOTAL) continue;
    const stream = decodeObjectStream(content, bytes, obj);
    if (stream?.decoded) {
      const text = normalizeNames(decodeLatin1(stream.bytes.subarray(0, MAX_OBJSTM_TOTAL - objStmScanned)));
      expanded += "\n" + text;
      objStmScanned += stream.bytes.length;
    }
  }
  onProgress?.(3, 5);

  report.pageCount = countPages(expanded);
  report.encrypted = /\/Encrypt\b/.test(expanded) && /\btrailer\b|\/Encrypt\s+\d+\s+\d+\s+R/.test(content);
  report.hasSignature = /\/Type\s*\/Sig\b|\/FT\s*\/Sig\b|\/ByteRange\b/.test(expanded);

  const findings = [];
  const add = (indicator, severity, where, why, evidence) => {
    if (findings.length < MAX_FINDINGS) findings.push({ id: findings.length, indicator, severity, where, why, evidence: evidence ? sanitiseForReport(evidence).slice(0, MAX_JS_DISPLAY) : "" });
  };

  // --- active content: JavaScript (extract + decode) ---
  extractJavaScript(content, expanded, list, map, bytes, add);

  // --- auto-run triggers ---
  scanToken(expanded, /\/OpenAction\b/g, list, add, "/OpenAction", "High", "Runs an action automatically when the document is opened — the primary way a PDF auto-executes JavaScript or a launch action without user interaction.");
  scanToken(expanded, /\/AA\b/g, list, add, "/AA (additional actions)", "High", "Additional/auto actions fire on events such as document open/close or page open/close, and on field focus — another auto-execution path.");

  // --- launch / external / navigation actions ---
  scanLaunch(expanded, list, add);
  scanToken(expanded, /\/SubmitForm\b/g, list, add, "/SubmitForm", "Medium", "Submits form data — can exfiltrate entered data to a remote URL.");
  scanToken(expanded, /\/ImportData\b/g, list, add, "/ImportData", "Medium", "Imports external form data, which can pull in attacker-controlled content.");
  scanToken(expanded, /\/GoToR\b/g, list, add, "/GoToR", "Medium", "Remote go-to action — navigates to another (possibly remote) document.");
  scanToken(expanded, /\/GoToE\b/g, list, add, "/GoToE", "Medium", "Embedded go-to action — jumps into an embedded file.");
  scanUri(expanded, add);
  scanToken(expanded, /\/Named\b/g, list, add, "/Named action", "Low", "Invokes a named viewer action (e.g. Print, SaveAs) — usually benign but can be abused for social engineering.");
  for (const [tok, name] of [[/\/Rendition\b/g, "/Rendition"], [/\/RichMedia\b/g, "/RichMedia"], [/\/Movie\b/g, "/Movie"], [/\/Sound\b/g, "/Sound"]]) {
    scanToken(expanded, tok, list, add, name, "Medium", "Multimedia/rendition content that can trigger execution of embedded media or, historically, exploit media parsers.");
  }
  scanToken(expanded, /\/SetOCGState\b/g, list, add, "/SetOCGState", "Low", "Toggles optional-content (layer) visibility — can be used to hide or reveal content dynamically.");

  // --- forms that can carry script ---
  if (/\/XFA\b/.test(expanded)) add("/XFA form", "Medium", null, "XFA forms embed XML that can contain FormCalc/JavaScript logic. Inspect the XFA packets for scripts.", "");
  if (/\/AcroForm\b/.test(expanded) && /\/JavaScript\b|\/JS\b/.test(expanded)) add("AcroForm with JavaScript", "Medium", null, "The interactive form carries JavaScript. Many benign forms do this for validation, but it is also an execution vector.", "");

  // --- embedded / attached files ---
  scanEmbeddedFiles(content, expanded, list, map, bytes, report, add);

  // --- obfuscation / evasion ---
  for (const name of findObfuscatedNames(content)) {
    const dangerous = /^\/(JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile|Filespec|URI|SubmitForm|GoToR|GoToE|RichMedia|XFA)$/i.test(name.decoded);
    add("Name obfuscation via #xx escape", dangerous ? "High" : "Medium", null,
      "A PDF name hides an ASCII letter/digit behind a hex escape — a classic trick to slip a keyword like /JavaScript past signature-based scanners. There is no legitimate reason to encode an ordinary letter this way.",
      `${name.raw}  →  ${name.decoded}`);
  }
  scanFilters(content, list, add);

  // --- structural anomalies ---
  if (report.eofCount > 1 || report.startxrefCount > 1) {
    add("Multiple %%EOF / startxref markers", "Medium", null,
      `The file has ${report.eofCount} %%EOF and ${report.startxrefCount} startxref marker(s). This is normal for incremental updates (including signing), but is also how data is appended after the "end" of a PDF to smuggle a second payload. Compare the sections.`,
      "");
  }
  if (report.objStmCount > 0) {
    add("Object streams (/ObjStm) present", "Low", null,
      `Objects are packed inside ${report.objStmCount} compressed object stream(s). A naive byte scan cannot see objects hidden there; this tool inflated and rescanned them, but unusual filters can still hide content.`,
      "");
  }
  if (report.encrypted) {
    add("Encrypted document (/Encrypt)", "Medium", null,
      "The document is encrypted. Encrypted strings and streams cannot be fully inspected statically without the key, so JavaScript or attachments may be hidden from this scan.",
      "");
  }
  onProgress?.(4, 5);

  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.id - b.id);
  report.findings = findings;
  report.verdict = buildVerdict(report);
  onProgress?.(5, 5);
  return report;
}

// --- detectors ----------------------------------------------------------------

function countPages(content) {
  const explicit = (content.match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
  if (explicit > 0) return explicit;
  const count = content.match(/\/Type\s*\/Pages\b[\s\S]{0,200}?\/Count\s+(\d+)/);
  return count ? Number(count[1]) : null;
}

function scanToken(content, regex, list, add, indicator, severity, why) {
  const matches = [...content.matchAll(regex)];
  if (!matches.length) return;
  const objs = [...new Set(matches.map((m) => objectAt(list, m.index)?.num).filter((n) => n != null))];
  const where = objs.length ? `object${objs.length === 1 ? "" : "s"} ${objs.slice(0, 8).join(", ")}${objs.length > 8 ? "…" : ""}` : `${matches.length} occurrence${matches.length === 1 ? "" : "s"}`;
  add(indicator, severity, where, why, "");
}

function extractJavaScript(content, expanded, list, map, bytes, add) {
  const present = /\/JavaScript\b|\/JS\b/.test(expanded);
  if (!present) return;
  const snippets = [];
  const seen = new Set();
  // Work on name-normalized content so /J#61vaScript is caught, but keep offsets
  // aligned by normalizing a copy of the same length is not guaranteed; so scan
  // for both raw and decoded forms.
  const re = /\/(JS|JavaScript)\b/g;
  let match;
  const scanText = normalizeNames(content);
  while ((match = re.exec(scanText)) && snippets.length < MAX_JS_SNIPPETS) {
    let cursor = re.lastIndex;
    while (cursor < scanText.length && /\s/.test(scanText[cursor])) cursor += 1;
    const ch = scanText[cursor];
    let value = "";
    if (ch === "(") value = parseLiteralString(scanText, cursor).value;
    else if (ch === "<" && scanText[cursor + 1] !== "<") value = parseHexString(scanText, cursor).value;
    else {
      // The ref text ("5 0 R") is read from scanText (offset-consistent with the
      // cursor); the resolved object carries offsets into `content` for decoding.
      const target = resolveRef(scanText, map, cursor);
      if (target) {
        const stream = decodeObjectStream(content, bytes, target);
        if (stream) value = decodeLatin1(stream.bytes);
      }
    }
    value = sanitiseForReport(value).trim();
    if (value && !seen.has(value.slice(0, 200))) {
      seen.add(value.slice(0, 200));
      snippets.push(value.slice(0, MAX_JS_DISPLAY) + (value.length > MAX_JS_DISPLAY ? " …[truncated]" : ""));
    }
  }
  const where = (() => {
    const objs = [...new Set([...content.matchAll(/\/(JS|JavaScript)\b/g)].map((m) => objectAt(list, m.index)?.num).filter((n) => n != null))];
    return objs.length ? `object${objs.length === 1 ? "" : "s"} ${objs.slice(0, 8).join(", ")}` : null;
  })();
  const why = "Embedded JavaScript. PDF JS can call app.launchURL, exploit reader vulnerabilities, decode further payloads, or drive form/launch actions. Benign PDFs also use JS for form validation, so read the script before judging.";
  if (snippets.length) {
    for (const snippet of snippets) add("Embedded JavaScript (/JS, /JavaScript)", "High", where, why, snippet);
  } else {
    add("Embedded JavaScript (/JS, /JavaScript)", "High", where, why + " The script text could not be decoded (encrypted, unusual filter, or indirect storage) — inspect the referenced object manually.", "");
  }
}

function scanLaunch(content, list, add) {
  const matches = [...content.matchAll(/\/Launch\b/g)];
  if (!matches.length) return;
  for (const match of matches.slice(0, 10)) {
    const window = content.slice(match.index, match.index + 800);
    let command = "";
    const f = window.match(/\/(?:F|Win)\b/);
    const paren = window.indexOf("(");
    if (paren >= 0) command = parseLiteralString(window, paren).value;
    const objNum = objectAt(list, match.index)?.num;
    add("/Launch action", "Critical", objNum != null ? `object ${objNum}` : null,
      "Launches an external application or operating-system command from the PDF. This is a direct code-execution vector and is almost never legitimate in a document you received.",
      command ? `target/command: ${command}` : (f ? "a launch target is specified" : ""));
  }
}

function scanUri(content, add) {
  const matches = [...content.matchAll(/\/URI\s*\(/g)];
  if (!matches.length) return;
  const uris = [];
  const seen = new Set();
  for (const match of matches) {
    if (uris.length >= MAX_URIS) break;
    const open = match.index + match[0].length - 1;
    const value = sanitiseForReport(parseLiteralString(content, open).value).trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      uris.push(value);
    }
  }
  if (!uris.length) return;
  add("/URI actions", "Low", `${uris.length} destination${uris.length === 1 ? "" : "s"}`,
    "Link/URI actions send the user to a URL. Not executed or contacted by this tool — review the destinations yourself for phishing or payload-hosting domains.",
    uris.join("\n"));
}

function scanEmbeddedFiles(content, expanded, list, map, bytes, report, add) {
  if (!/\/EmbeddedFile\b|\/Filespec\b/.test(expanded)) return;
  // Map EmbeddedFile stream object number -> filename via /Filespec /EF references.
  const names = new Map();
  for (const obj of list) {
    const dict = decodePdfName(objectDict(content, obj));
    if (!/\/Filespec\b|\/EF\b/.test(dict)) continue;
    const nameMatch = dict.match(/\/(?:UF|F)\s*\(/);
    let filename = "";
    if (nameMatch) filename = sanitiseForReport(parseLiteralString(dict, nameMatch.index + nameMatch[0].length - 1).value).trim();
    const efRef = dict.match(/\/EF\b[\s\S]{0,120}?\/(?:F|UF)\s+(\d+)\s+(\d+)\s+R/);
    if (efRef) names.set(`${efRef[1]} ${efRef[2]}`, filename);
  }
  let count = 0;
  for (const obj of list) {
    if (count >= MAX_EMBEDDED) break;
    const dict = decodePdfName(objectDict(content, obj));
    if (!/\/EmbeddedFile\b/.test(dict)) continue;
    count += 1;
    const stream = decodeObjectStream(content, bytes, obj);
    const payload = stream?.bytes || new Uint8Array(0);
    const magic = classifyMagic(payload);
    const filename = names.get(`${obj.num} ${obj.gen}`) || names.get(String(obj.num)) || "(unnamed)";
    const badExt = DANGEROUS_EXT.test(filename);
    const suspicious = magic.executable || badExt;
    report.embeddedFiles.push({ objNum: obj.num, name: filename, size: payload.length, decoded: !!stream?.decoded, magic: magic.kind, executable: suspicious, filters: stream?.filters || [] });
  }
  for (const file of report.embeddedFiles) {
    const severity = file.executable ? "Critical" : "Medium";
    const why = file.executable
      ? "An embedded/attached file that is an executable, script, or macro-capable container. Delivering malware as a PDF attachment that the user is prompted to open is a common technique."
      : "An embedded/attached file. Attachments ride along inside the PDF and can carry any payload — extract and scan it separately.";
    add("Embedded file (/EmbeddedFile)", severity, `object ${file.objNum}`, why,
      `name: ${file.name} · ${file.size} bytes${file.decoded ? "" : " (undecoded)"} · magic: ${file.magic}`);
  }
}

function scanFilters(content, list, add) {
  const jbig2 = [...content.matchAll(/\/JBIG2Decode\b/g)];
  if (jbig2.length) {
    const objs = [...new Set(jbig2.map((m) => objectAt(list, m.index)?.num).filter((n) => n != null))];
    add("/JBIG2Decode filter", "Medium", objs.length ? `object${objs.length === 1 ? "" : "s"} ${objs.slice(0, 8).join(", ")}` : null,
      "JBIG2 is a rarely-needed image filter with a history of reader exploits (e.g. the FORCEDENTRY chain). Treat its presence in an untrusted document as suspicious.", "");
  }
  for (const obj of list) {
    const dict = decodePdfName(objectDict(content, obj));
    const filterArray = dict.match(/\/Filter\s*\[([^\]]*)\]/);
    if (!filterArray) continue;
    const filters = [...filterArray[1].matchAll(/\/([^\s\[\]<>(){}\/%]+)/g)].map((m) => m[1]);
    if (filters.length > 1) {
      const isJs = /\/(JS|JavaScript)\b/.test(dict);
      add("Stacked stream filters", isJs ? "High" : "Medium", `object ${obj.num}`,
        `A stream applies ${filters.length} chained filters (${filters.join(" → ")}). Layering filters${isJs ? " on a JavaScript stream" : ""} — especially ASCIIHexDecode/ASCII85 in front of FlateDecode — is a common way to obscure a payload from scanners.`,
        "");
    }
  }
}

function buildVerdict(report) {
  const bySeverity = (sev) => report.findings.filter((f) => f.severity === sev);
  const critical = bySeverity("Critical");
  const high = bySeverity("High");
  const medium = bySeverity("Medium");
  const reasons = [];
  const label = (f) => f.indicator.replace(/\s*\(.*\)\s*/, "").trim();
  for (const f of [...critical, ...high]) if (!reasons.includes(label(f))) reasons.push(label(f));

  let level;
  let headline;
  if (critical.length || high.length) {
    level = "suspicious";
    headline = `Suspicious — contains ${reasons.slice(0, 3).join(", ")}${reasons.length > 3 ? ", and more" : ""}`;
  } else if (medium.length) {
    level = "caution";
    headline = "Caution — active-content or structural indicators present, none high-risk";
  } else {
    level = "clean";
    headline = "No high-risk indicators found in static analysis";
  }
  const summary = "This is static triage, not a malware verdict. A clean result does NOT prove the file is safe (novel obfuscation, encrypted payloads, exploits in malformed objects, and anything needing dynamic execution can all be missed), and a flag does NOT prove malice (many benign PDFs use JavaScript, forms, and attachments). Use these indicators to decide whether to detonate the file in a sandbox or send it for deeper analysis.";
  return { level, headline, summary, counts: { critical: critical.length, high: high.length, medium: medium.length, low: bySeverity("Low").length, info: bySeverity("Info").length } };
}

// --- report -------------------------------------------------------------------

/**
 * Builds the downloadable plain-text report for an incident ticket. No clock is
 * read here (services have none); the caller may prepend a time if needed.
 */
export function buildAnalyzerReportText(report, meta = {}) {
  const rows = [];
  rows.push("MyFileKit — PDF Analyser (static triage report)");
  rows.push("Generated entirely in the browser. The file was never uploaded and never executed.");
  if (meta.fileName) rows.push(`File: ${sanitiseForReport(meta.fileName)}`);
  rows.push(`Size: ${report.fileSize} bytes`);
  rows.push(`SHA-256: ${report.sha256}`);
  rows.push("");
  rows.push(`VERDICT: ${report.verdict.headline}`);
  rows.push(report.verdict.summary);
  const c = report.verdict.counts;
  rows.push(`Findings: ${c.critical} critical · ${c.high} high · ${c.medium} medium · ${c.low} low · ${c.info} info`);
  rows.push("");

  rows.push("== Structure (facts, not verdicts) ==");
  rows.push(`  PDF version: ${report.version}`);
  rows.push(`  Pages (best-effort): ${report.pageCount ?? "unknown"}`);
  rows.push(`  Objects: ${report.objectCount}`);
  rows.push(`  Object streams (/ObjStm): ${report.objStmCount}`);
  rows.push(`  Linearized: ${report.linearized ? "yes" : "no"}`);
  rows.push(`  Encrypted: ${report.encrypted ? "yes" : "no"}`);
  rows.push(`  Digital signature present: ${report.hasSignature ? "yes (cryptography NOT verified)" : "no"}`);
  rows.push(`  startxref markers: ${report.startxrefCount} · %%EOF markers: ${report.eofCount}`);
  if (report.parseError) rows.push(`  NOTE: ${report.parseError}`);
  if (report.truncated) rows.push("  NOTE: the file does not end cleanly at %%EOF — it may be truncated or have appended data.");
  rows.push("");

  rows.push("== Findings ==");
  if (!report.findings.length) rows.push("  No indicators were detected by the static byte-level scan.");
  for (const f of report.findings) {
    rows.push(`  [${f.severity}] ${f.indicator}${f.where ? ` — ${f.where}` : ""}`);
    rows.push(`      Why: ${f.why}`);
    if (f.evidence) for (const line of f.evidence.split("\n")) rows.push(`      Evidence: ${line}`);
  }
  rows.push("");
  rows.push("== Limits of static analysis ==");
  rows.push("  This scan reads bytes; it does not run the file. It cannot catch novel or heavy obfuscation, payloads");
  rows.push("  hidden behind unsupported filters or encryption, exploits that live in malformed object internals, or");
  rows.push("  anything that only reveals itself when the PDF is opened. A clean report is not proof of safety.");
  return `${rows.join("\n")}\n`;
}
