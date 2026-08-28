// Cryptographic PDF signing and verification.
//
// Unlike the "Add Signature to PDF" tool (which stamps a picture of a
// signature), this produces a real PKCS#7 / CMS *detached* digital signature
// over the document's bytes, added through an incremental update so any bytes
// that were already there — including earlier signatures — are left untouched.
//
// The signature dictionary carries /ByteRange and /Contents placeholders; once
// the file is laid out we measure the two spans the signature covers (the whole
// file except the /Contents hex string), hash them (SHA-256), produce the CMS
// SignedData with the certificate's private key, and drop the DER hex into
// /Contents. A conformant reader (Acrobat, Preview, poppler) then recognises the
// file as digitally signed.
//
// The ASN.1, PKCS#12 and CMS work is done by pkijs + asn1js; every hash and
// signature runs through WebCrypto (globalThis.crypto.subtle), which exists in
// both browsers and modern Node, so this file behaves identically in tests and
// in the app. No network is used: we can prove the signature math and the
// signer certificate's self-consistency, but we deliberately do NOT validate a
// trust chain to a trusted root (no CA store is bundled) or check revocation
// (that would need OCSP/CRL fetches). Callers surface that limit to the user.
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { decompressSync } from "fflate";

// ---------------------------------------------------------------------------
// WebCrypto engine for pkijs
// ---------------------------------------------------------------------------

const webcrypto = globalThis.crypto;

// pkijs stores its crypto engine in one of two places depending on whether it
// thinks it is in a browser (`typeof window !== "undefined"`) or Node. Test
// harnesses that define `globalThis.window` (to host pdf-lib) flip that check
// after this module first loads, so the engine can end up written to the store
// the current environment no longer reads from. Setting it lazily on each use —
// only when the current environment reports none — keeps it correct in browsers,
// in plain Node, and in Node-with-a-window-shim alike.
function engine() {
  if (!webcrypto?.subtle) throw new Error("This environment has no WebCrypto (crypto.subtle), which PDF signing needs.");
  let current = null;
  try { current = pkijs.getCrypto(); } catch { current = null; }
  if (!current) pkijs.setEngine("myfilekit", new pkijs.CryptoEngine({ name: "myfilekit", crypto: webcrypto }));
  return pkijs.getCrypto(true);
}

// ---------------------------------------------------------------------------
// OIDs
// ---------------------------------------------------------------------------

const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingTime: "1.2.840.113549.1.9.5",
  timeStampToken: "1.2.840.113549.1.9.16.2.14", // id-aa-timeStampToken (RFC 3161, unsigned attr)
  sha256: "2.16.840.1.101.3.4.2.1",
  commonName: "2.5.4.3",
  organization: "2.5.4.10",
  rsaEncryption: "1.2.840.113549.1.1.1",
  ecPublicKey: "1.2.840.10045.2.1",
  certBag: "1.2.840.113549.1.12.10.1.3",
  keyBag: "1.2.840.113549.1.12.10.1.1",
  shroudedKeyBag: "1.2.840.113549.1.12.10.1.2",
};

const HASH_BY_OID = {
  "1.3.14.3.2.26": "SHA-1",
  "2.16.840.1.101.3.4.2.1": "SHA-256",
  "2.16.840.1.101.3.4.2.2": "SHA-384",
  "2.16.840.1.101.3.4.2.3": "SHA-512",
};

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("Expected bytes.");
}

async function readFileBytes(source) {
  if (source && typeof source.arrayBuffer === "function") return new Uint8Array(await source.arrayBuffer());
  return toBytes(source);
}

function bufOf(u8) {
  const bytes = toBytes(u8);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function concatBytes(parts) {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function latin1Bytes(text) {
  const value = String(text ?? "");
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff;
  return out;
}

function hexOf(bytes) {
  let out = "";
  const view = toBytes(bytes);
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, "0");
  return out;
}

function indexOfSequence(bytes, needle, from) {
  const limit = bytes.length - needle.length;
  outer: for (let i = Math.max(0, from); i <= limit; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function matchesSequence(bytes, needle, at) {
  if (at < 0 || at + needle.length > bytes.length) return false;
  for (let j = 0; j < needle.length; j++) {
    if (bytes[at + j] !== needle[j]) return false;
  }
  return true;
}

async function digestBytes(hashName, data) {
  return new Uint8Array(await webcrypto.subtle.digest(hashName, bufOf(data)));
}

// PDF date string, e.g. D:20260827093000+05'30'.
function pdfDate(date) {
  const pad = (value, width = 2) => String(Math.abs(value)).padStart(width, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const tz = offsetMinutes === 0 ? "Z" : `${sign}${pad(offsetMinutes / 60 | 0)}'${pad(offsetMinutes % 60)}'`;
  return `D:${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${tz}`;
}

// ---------------------------------------------------------------------------
// Minimal PDF reader. Deliberately read-only and just complete enough to find
// the catalog, the first page, an existing AcroForm, the trailer, and every
// signature dictionary. It never rewrites the file: signing only ever APPENDS.
// ---------------------------------------------------------------------------

const NULL_OBJECT = { k: "null" };
const mkName = (value) => ({ k: "name", v: value });
const mkNum = (value) => ({ k: "num", v: value });
const mkRef = (num, gen = 0) => ({ k: "ref", num, gen });
const mkDict = (entries = []) => ({ k: "dict", v: new Map(entries) });
const mkArray = (items = []) => ({ k: "array", v: items });

function isWhitespaceByte(byte) {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}
function isDelimiterByte(byte) {
  return byte === 0x28 || byte === 0x29 || byte === 0x3c || byte === 0x3e
    || byte === 0x5b || byte === 0x5d || byte === 0x7b || byte === 0x7d
    || byte === 0x2f || byte === 0x25;
}
function isDigitByte(byte) {
  return byte >= 0x30 && byte <= 0x39;
}

const KEYWORD_STREAM = latin1Bytes("stream");
const KEYWORD_ENDSTREAM = latin1Bytes("endstream");
const KEYWORD_TRAILER = latin1Bytes("trailer");
const KEYWORD_XREF = latin1Bytes("xref");
const KEYWORD_STARTXREF = latin1Bytes("startxref");

class Lexer {
  constructor(bytes, position = 0) {
    this.b = bytes;
    this.pos = position;
  }
  skipWhitespace() {
    while (this.pos < this.b.length) {
      const byte = this.b[this.pos];
      if (isWhitespaceByte(byte)) { this.pos++; continue; }
      if (byte === 0x25) {
        while (this.pos < this.b.length && this.b[this.pos] !== 10 && this.b[this.pos] !== 13) this.pos++;
        continue;
      }
      return;
    }
  }
  readRegularRun() {
    const start = this.pos;
    while (this.pos < this.b.length && !isWhitespaceByte(this.b[this.pos]) && !isDelimiterByte(this.b[this.pos])) this.pos++;
    return this.b.subarray(start, this.pos);
  }
  readName() {
    this.pos++;
    const raw = this.readRegularRun();
    let out = "";
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === 0x23 && i + 2 < raw.length) {
        const code = parseInt(String.fromCharCode(raw[i + 1], raw[i + 2]), 16);
        if (Number.isFinite(code)) { out += String.fromCharCode(code); i += 2; continue; }
      }
      out += String.fromCharCode(raw[i]);
    }
    return mkName(out);
  }
  readLiteralString() {
    this.pos++;
    const out = [];
    let depth = 1;
    while (this.pos < this.b.length) {
      const byte = this.b[this.pos++];
      if (byte === 0x5c) {
        const next = this.b[this.pos++];
        if (next === 0x6e) out.push(10);
        else if (next === 0x72) out.push(13);
        else if (next === 0x74) out.push(9);
        else if (next === 0x62) out.push(8);
        else if (next === 0x66) out.push(12);
        else if (next === 10) { /* continuation */ }
        else if (next === 13) { if (this.b[this.pos] === 10) this.pos++; }
        else if (next >= 0x30 && next <= 0x37) {
          let value = next - 0x30;
          for (let i = 0; i < 2; i++) {
            const digit = this.b[this.pos];
            if (digit >= 0x30 && digit <= 0x37) { value = value * 8 + (digit - 0x30); this.pos++; }
            else break;
          }
          out.push(value & 0xff);
        } else out.push(next);
        continue;
      }
      if (byte === 0x28) { depth++; out.push(byte); continue; }
      if (byte === 0x29) { depth--; if (!depth) return { k: "str", v: new Uint8Array(out), hex: false }; out.push(byte); continue; }
      out.push(byte);
    }
    throw new Error("This PDF has an unterminated string.");
  }
  readHexString() {
    this.pos++;
    let digits = "";
    while (this.pos < this.b.length && this.b[this.pos] !== 0x3e) {
      const char = String.fromCharCode(this.b[this.pos++]);
      if (/[0-9a-fA-F]/.test(char)) digits += char;
    }
    this.pos++;
    if (digits.length % 2) digits += "0";
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16);
    return { k: "str", v: out, hex: true };
  }
  readArray() {
    this.pos++;
    const items = [];
    for (;;) {
      this.skipWhitespace();
      if (this.pos >= this.b.length) throw new Error("This PDF has an unterminated array.");
      if (this.b[this.pos] === 0x5d) { this.pos++; return mkArray(items); }
      items.push(this.readObject());
    }
  }
  readDict() {
    this.pos += 2;
    const entries = new Map();
    for (;;) {
      this.skipWhitespace();
      if (this.pos >= this.b.length) throw new Error("This PDF has an unterminated dictionary.");
      if (this.b[this.pos] === 0x3e && this.b[this.pos + 1] === 0x3e) { this.pos += 2; break; }
      if (this.b[this.pos] !== 0x2f) { this.readObject(); continue; }
      const key = this.readName().v;
      this.skipWhitespace();
      entries.set(key, this.readObject());
    }
    const dictionary = { k: "dict", v: entries };
    this.skipWhitespace();
    if (matchesSequence(this.b, KEYWORD_STREAM, this.pos)) return this.readStream(dictionary);
    return dictionary;
  }
  readStream(dictionary) {
    this.pos += KEYWORD_STREAM.length;
    if (this.b[this.pos] === 13) this.pos++;
    if (this.b[this.pos] === 10) this.pos++;
    const dataStart = this.pos;
    const endIndex = indexOfSequence(this.b, KEYWORD_ENDSTREAM, dataStart);
    if (endIndex < 0) throw new Error("This PDF has an unterminated stream.");
    let end = endIndex;
    if (end > dataStart && this.b[end - 1] === 10) { end--; if (end > dataStart && this.b[end - 1] === 13) end--; }
    else if (end > dataStart && this.b[end - 1] === 13) end--;
    this.pos = endIndex + KEYWORD_ENDSTREAM.length;
    return { k: "stream", dict: dictionary, raw: this.b.subarray(dataStart, end), dataStart };
  }
  readNumberOrRef() {
    const start = this.pos;
    if (this.b[this.pos] === 0x2b || this.b[this.pos] === 0x2d) this.pos++;
    while (this.pos < this.b.length && (isDigitByte(this.b[this.pos]) || this.b[this.pos] === 0x2e)) this.pos++;
    const text = String.fromCharCode(...this.b.subarray(start, this.pos));
    const value = Number(text);
    if (!Number.isFinite(value)) throw new Error(`This PDF has an unreadable number ("${text}").`);
    if (Number.isInteger(value) && value >= 0 && !text.includes(".")) {
      const save = this.pos;
      const reference = this.tryReadReferenceTail(value);
      if (reference) return reference;
      this.pos = save;
    }
    return { k: "num", v: value, raw: text };
  }
  tryReadReferenceTail(objectNumber) {
    this.skipWhitespace();
    if (!isDigitByte(this.b[this.pos])) return null;
    const genStart = this.pos;
    while (this.pos < this.b.length && isDigitByte(this.b[this.pos])) this.pos++;
    const gen = Number(String.fromCharCode(...this.b.subarray(genStart, this.pos)));
    this.skipWhitespace();
    if (this.b[this.pos] !== 0x52) return null;
    const after = this.b[this.pos + 1];
    if (after !== undefined && !isWhitespaceByte(after) && !isDelimiterByte(after)) return null;
    this.pos++;
    return { k: "ref", num: objectNumber, gen };
  }
  readObject() {
    this.skipWhitespace();
    if (this.pos >= this.b.length) throw new Error("This PDF ended in the middle of an object.");
    const byte = this.b[this.pos];
    if (byte === 0x2f) return this.readName();
    if (byte === 0x28) return this.readLiteralString();
    if (byte === 0x5b) return this.readArray();
    if (byte === 0x3c) { if (this.b[this.pos + 1] === 0x3c) return this.readDict(); return this.readHexString(); }
    if (isDigitByte(byte) || byte === 0x2b || byte === 0x2d || byte === 0x2e) return this.readNumberOrRef();
    const word = String.fromCharCode(...this.readRegularRun());
    if (word === "true") return { k: "bool", v: true };
    if (word === "false") return { k: "bool", v: false };
    if (word === "null") return NULL_OBJECT;
    if (!word) { this.pos++; return NULL_OBJECT; }
    throw new Error(`This PDF contains an unexpected token ("${word.slice(0, 24)}").`);
  }
}

function findObjectHeader(bytes, from) {
  for (let i = from; i + 2 < bytes.length; i++) {
    if (bytes[i] !== 0x6f || bytes[i + 1] !== 0x62 || bytes[i + 2] !== 0x6a) continue;
    const after = bytes[i + 3];
    if (after !== undefined && !isWhitespaceByte(after) && !isDelimiterByte(after)) continue;
    let p = i - 1;
    while (p >= 0 && isWhitespaceByte(bytes[p])) p--;
    const genEnd = p;
    while (p >= 0 && isDigitByte(bytes[p])) p--;
    if (p === genEnd) continue;
    const genStart = p + 1;
    while (p >= 0 && isWhitespaceByte(bytes[p])) p--;
    const numEnd = p;
    while (p >= 0 && isDigitByte(bytes[p])) p--;
    if (p === numEnd) continue;
    const numStart = p + 1;
    if (numStart > 0 && !isWhitespaceByte(bytes[numStart - 1]) && !isDelimiterByte(bytes[numStart - 1])) continue;
    const objectNumber = Number(String.fromCharCode(...bytes.subarray(numStart, numEnd + 1)));
    const gen = Number(String.fromCharCode(...bytes.subarray(genStart, genEnd + 1)));
    if (!Number.isInteger(objectNumber) || !Number.isInteger(gen)) continue;
    return { num: objectNumber, gen, bodyStart: i + 3 };
  }
  return null;
}

// Scan the whole file front-to-back for `N G obj`. A later definition of an
// object number wins, which is exactly how incremental updates are meant to be
// read, so the objects we resolve are always the current ones.
function scanIndirectObjects(bytes) {
  const objects = new Map();
  const streams = [];
  let position = 0;
  while (position < bytes.length) {
    const header = findObjectHeader(bytes, position);
    if (!header) break;
    const lexer = new Lexer(bytes, header.bodyStart);
    let object;
    try { object = lexer.readObject(); }
    catch { position = header.bodyStart + 1; continue; }
    objects.set(header.num, { num: header.num, gen: header.gen, obj: object });
    if (object.k === "stream") streams.push(object);
    position = Math.max(lexer.pos, header.bodyStart + 1);
  }
  return { objects, streams };
}

function resolve(doc, object) {
  let current = object;
  for (let hops = 0; hops < 32; hops++) {
    if (current?.k !== "ref") return current ?? NULL_OBJECT;
    current = doc.objects.get(current.num)?.obj;
    if (current === undefined) return NULL_OBJECT;
  }
  return NULL_OBJECT;
}
function dictGet(doc, dictionary, key) {
  if (dictionary?.k === "stream") return resolve(doc, dictionary.dict.v.get(key));
  if (dictionary?.k !== "dict") return NULL_OBJECT;
  return resolve(doc, dictionary.v.get(key));
}
function numberValue(object, fallback = null) { return object?.k === "num" ? object.v : fallback; }
function nameValue(object) { return object?.k === "name" ? object.v : null; }

function applyStreamLengths(doc, bytes) {
  for (const stream of doc.streams) {
    const length = numberValue(dictGet(doc, stream, "Length"));
    if (!Number.isInteger(length) || length < 0) continue;
    if (stream.dataStart + length > bytes.length) continue;
    let after = stream.dataStart + length;
    while (after < bytes.length && isWhitespaceByte(bytes[after])) after++;
    if (!matchesSequence(bytes, KEYWORD_ENDSTREAM, after)) continue;
    stream.raw = bytes.subarray(stream.dataStart, stream.dataStart + length);
  }
}

function readStartXref(bytes) {
  const tailStart = Math.max(0, bytes.length - 2048);
  let index = -1;
  for (;;) {
    const next = indexOfSequence(bytes, KEYWORD_STARTXREF, index < 0 ? tailStart : index + 1);
    if (next < 0) break;
    index = next;
  }
  if (index < 0) return null;
  try { return numberValue(new Lexer(bytes, index + KEYWORD_STARTXREF.length).readObject()); }
  catch { return null; }
}

function readTrailerAt(doc, bytes, offset) {
  const lexer = new Lexer(bytes, offset);
  lexer.skipWhitespace();
  if (matchesSequence(bytes, KEYWORD_XREF, lexer.pos)) {
    const trailerIndex = indexOfSequence(bytes, KEYWORD_TRAILER, lexer.pos);
    if (trailerIndex < 0) return null;
    try {
      const value = new Lexer(bytes, trailerIndex + KEYWORD_TRAILER.length).readObject();
      return value.k === "dict" ? value.v : null;
    } catch { return null; }
  }
  const header = findObjectHeader(bytes, Math.max(0, offset - 1));
  if (!header || header.bodyStart > offset + 64) return null;
  const object = doc.objects.get(header.num)?.obj;
  if (object?.k === "stream") return object.dict.v;
  if (object?.k === "dict") return object.v;
  return null;
}

function findTrailer(doc, bytes) {
  const merged = new Map();
  const absorb = (source) => {
    if (!source) return;
    for (const [key, value] of source) if (!merged.has(key)) merged.set(key, value);
  };
  const seen = new Set();
  let offset = readStartXref(bytes);
  while (Number.isInteger(offset) && offset >= 0 && offset < bytes.length && !seen.has(offset)) {
    seen.add(offset);
    const section = readTrailerAt(doc, bytes, offset);
    if (!section) break;
    absorb(section);
    const hybrid = section.get("XRefStm");
    if (hybrid?.k === "num" && !seen.has(hybrid.v)) { seen.add(hybrid.v); absorb(readTrailerAt(doc, bytes, hybrid.v)); }
    const prev = section.get("Prev");
    offset = prev?.k === "num" ? prev.v : null;
  }
  if (!merged.has("Root")) {
    for (const entry of doc.objects.values()) {
      if (nameValue(dictGet(doc, entry.obj, "Type")) === "XRef") absorb(entry.obj.dict.v);
    }
  }
  if (!merged.has("Root")) {
    for (const entry of doc.objects.values()) {
      if (nameValue(dictGet(doc, entry.obj, "Type")) === "Catalog") { merged.set("Root", mkRef(entry.num, entry.gen)); break; }
    }
  }
  return merged;
}

// FlateDecode + PNG/TIFF predictor, only enough for object streams.
function undoPredictor(data, predictor, colors, bitsPerComponent, columns) {
  if (predictor <= 1) return data;
  const bpp = Math.max(1, Math.ceil((colors * bitsPerComponent) / 8));
  const rowLength = Math.ceil((colors * bitsPerComponent * columns) / 8);
  if (predictor === 2) {
    if (bitsPerComponent !== 8) throw new Error("Unsupported TIFF predictor in this PDF.");
    const out = new Uint8Array(data);
    for (let row = 0; row + rowLength <= out.length; row += rowLength) {
      for (let i = bpp; i < rowLength; i++) out[row + i] = (out[row + i] + out[row + i - bpp]) & 0xff;
    }
    return out;
  }
  const rows = Math.floor(data.length / (rowLength + 1));
  const out = new Uint8Array(rows * rowLength);
  let previous = new Uint8Array(rowLength);
  for (let row = 0; row < rows; row++) {
    const base = row * (rowLength + 1);
    const filter = data[base];
    const current = new Uint8Array(data.subarray(base + 1, base + 1 + rowLength));
    for (let i = 0; i < rowLength; i++) {
      const left = i >= bpp ? current[i - bpp] : 0;
      const up = previous[i];
      const upLeft = i >= bpp ? previous[i - bpp] : 0;
      if (filter === 1) current[i] = (current[i] + left) & 0xff;
      else if (filter === 2) current[i] = (current[i] + up) & 0xff;
      else if (filter === 3) current[i] = (current[i] + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const dLeft = Math.abs(p - left), dUp = Math.abs(p - up), dUpLeft = Math.abs(p - upLeft);
        const predicted = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
        current[i] = (current[i] + predicted) & 0xff;
      }
    }
    out.set(current, row * rowLength);
    previous = current;
  }
  return out;
}

function decodeStream(doc, stream) {
  let data = stream.raw;
  const filterObject = dictGet(doc, stream, "Filter");
  const filters = filterObject.k === "name" ? [filterObject.v]
    : filterObject.k === "array" ? filterObject.v.map((item) => nameValue(resolve(doc, item))).filter(Boolean) : [];
  filters.forEach((filterName, index) => {
    if (filterName === "FlateDecode" || filterName === "Fl") {
      try { data = decompressSync(data); }
      catch (error) { throw new Error(`This PDF has a stream that could not be decompressed (${error?.message || "inflate failed"}).`); }
    } else {
      throw new Error(`This PDF uses the ${filterName} stream filter, which signing cannot decode.`);
    }
    let parms = dictGet(doc, stream, "DecodeParms");
    if (parms.k === "null") parms = dictGet(doc, stream, "DP");
    if (parms.k === "array") parms = resolve(doc, parms.v[index]);
    if (parms.k === "dict") {
      const predictor = numberValue(dictGet(doc, parms, "Predictor"), 1);
      if (predictor > 1) {
        data = undoPredictor(data, predictor,
          numberValue(dictGet(doc, parms, "Colors"), 1),
          numberValue(dictGet(doc, parms, "BitsPerComponent"), 8),
          numberValue(dictGet(doc, parms, "Columns"), 1));
      }
    }
  });
  return data;
}

// Pull ordinary objects out of object streams so the catalog / pages / form can
// be resolved even when a producer compressed them. Reading only; the original
// file bytes are never modified by signing.
function unpackObjectStreams(doc) {
  for (const entry of [...doc.objects.values()]) {
    const object = entry.obj;
    if (object.k !== "stream") continue;
    if (nameValue(dictGet(doc, object, "Type")) !== "ObjStm") continue;
    const count = numberValue(dictGet(doc, object, "N"), 0);
    const first = numberValue(dictGet(doc, object, "First"), 0);
    let data;
    try { data = decodeStream(doc, object); } catch { continue; }
    const headerLexer = new Lexer(data, 0);
    const pairs = [];
    let ok = true;
    for (let i = 0; i < count; i++) {
      const objectNumber = numberValue(headerLexer.readObject());
      const offset = numberValue(headerLexer.readObject());
      if (objectNumber === null || offset === null) { ok = false; break; }
      pairs.push([objectNumber, offset]);
    }
    if (!ok) continue;
    for (const [objectNumber, offset] of pairs) {
      if (doc.objects.has(objectNumber)) continue; // a top-level definition is newer
      try {
        const inner = new Lexer(data, first + offset).readObject();
        doc.objects.set(objectNumber, { num: objectNumber, gen: 0, obj: inner });
      } catch { /* skip a damaged entry */ }
    }
  }
}

function parsePdf(bytes) {
  const limit = Math.min(bytes.length, 1024);
  if (indexOfSequence(bytes.subarray(0, limit), latin1Bytes("%PDF-"), 0) < 0) {
    throw new Error("That file does not look like a PDF (no %PDF- header).");
  }
  const { objects, streams } = scanIndirectObjects(bytes);
  const doc = { bytes, objects, streams, trailer: new Map() };
  applyStreamLengths(doc, bytes);
  doc.trailer = findTrailer(doc, bytes);
  if (!doc.objects.size) throw new Error("No PDF objects could be read from that file.");
  unpackObjectStreams(doc);
  if (!doc.trailer.has("Root")) throw new Error("This PDF has no readable document catalog (/Root). Try Repair PDF first.");
  return doc;
}

// ---------------------------------------------------------------------------
// Object serialiser (only for the handful of objects we append)
// ---------------------------------------------------------------------------

function encodeName(value) {
  let out = "/";
  for (const char of String(value)) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code >= 0x7f || isDelimiterByte(code) || char === "#") out += `#${code.toString(16).padStart(2, "0")}`;
    else out += char;
  }
  return out;
}
function encodeString(object) {
  if (object.hex) return `<${hexOf(object.v)}>`;
  let out = "(";
  for (let i = 0; i < object.v.length; i++) {
    const byte = object.v[i];
    if (byte === 0x28) out += "\\(";
    else if (byte === 0x29) out += "\\)";
    else if (byte === 0x5c) out += "\\\\";
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(byte);
  }
  return `${out})`;
}
function encodeNumber(object) {
  if (typeof object.raw === "string" && Number(object.raw) === object.v) return object.raw;
  if (Number.isInteger(object.v)) return String(object.v);
  return String(Number(object.v.toFixed(6)));
}
function encodeObject(object, chunks) {
  if (!object || object.k === "null") { chunks.push(latin1Bytes("null")); return; }
  if (object.k === "bool") { chunks.push(latin1Bytes(object.v ? "true" : "false")); return; }
  if (object.k === "num") { chunks.push(latin1Bytes(encodeNumber(object))); return; }
  if (object.k === "name") { chunks.push(latin1Bytes(encodeName(object.v))); return; }
  if (object.k === "str") { chunks.push(latin1Bytes(encodeString(object))); return; }
  if (object.k === "ref") { chunks.push(latin1Bytes(`${object.num} ${object.gen} R`)); return; }
  if (object.k === "array") {
    chunks.push(latin1Bytes("["));
    object.v.forEach((item, index) => { if (index) chunks.push(latin1Bytes(" ")); encodeObject(item, chunks); });
    chunks.push(latin1Bytes("]"));
    return;
  }
  if (object.k === "dict") {
    chunks.push(latin1Bytes("<<"));
    object.v.forEach((value, key) => {
      chunks.push(latin1Bytes(encodeName(key)));
      chunks.push(latin1Bytes(" "));
      encodeObject(value, chunks);
      chunks.push(latin1Bytes(" "));
    });
    chunks.push(latin1Bytes(">>"));
    return;
  }
  if (object.k === "stream") {
    object.dict.v.set("Length", mkNum(object.raw.length));
    encodeObject(object.dict, chunks);
    chunks.push(latin1Bytes("\nstream\n"));
    chunks.push(object.raw);
    chunks.push(latin1Bytes("\nendstream"));
    return;
  }
  throw new Error("Cannot write an unknown PDF object.");
}
function serializeObjectBody(object) {
  const chunks = [];
  encodeObject(object, chunks);
  return concatBytes(chunks);
}

// ---------------------------------------------------------------------------
// PKCS#12 loading
// ---------------------------------------------------------------------------

function certCommonName(cert, which) {
  const rdn = which === "issuer" ? cert.issuer : cert.subject;
  const cn = rdn.typesAndValues.find((t) => t.type === OID.commonName);
  const org = rdn.typesAndValues.find((t) => t.type === OID.organization);
  const pick = cn || org;
  return pick ? String(pick.value.valueBlock.value) : "";
}
function certSerialHex(cert) {
  return hexOf(new Uint8Array(cert.serialNumber.valueBlock.valueHexView)).replace(/^0+(?=..)/, "") || "0";
}

/**
 * Parses a PKCS#12 (.p12/.pfx) file. Returns the signing certificate, any extra
 * chain certificates, and the private key imported for WebCrypto signing.
 * A wrong password throws a clear, specific error and nothing else leaks.
 */
export async function loadPkcs12(source, password) {
  const eng = engine();
  const der = await readFileBytes(source);
  const pwBuf = bufOf(new TextEncoder().encode(String(password ?? "")));

  const asn1 = asn1js.fromBER(bufOf(der));
  if (asn1.offset === -1) throw new Error("That does not look like a PKCS#12 (.p12/.pfx) file.");

  let pfx;
  try { pfx = new pkijs.PFX({ schema: asn1.result }); }
  catch { throw new Error("That does not look like a PKCS#12 (.p12/.pfx) file."); }

  try {
    await pfx.parseInternalValues({ password: pwBuf, checkIntegrity: true }, eng);
  } catch (error) {
    // A bad MAC is by far the most common cause and means a wrong password.
    if (/integrity/i.test(error?.message || "")) throw new Error("Wrong certificate password: the .p12/.pfx integrity check failed.");
    throw new Error("Could not open that .p12/.pfx file. Check the password and that the file is a PKCS#12 certificate.");
  }

  const safe = pfx.parsedValue?.authenticatedSafe;
  if (!safe) throw new Error("That PKCS#12 file has no readable contents.");
  try {
    await safe.parseInternalValues({ safeContents: safe.safeContents.map(() => ({ password: pwBuf })) }, eng);
  } catch (error) {
    if (/integrity|padding|decrypt/i.test(error?.message || "")) throw new Error("Wrong certificate password: could not decrypt the .p12/.pfx contents.");
    throw new Error("Could not read the contents of that .p12/.pfx file.");
  }

  const certs = [];
  let privateKeyInfo = null;
  for (const contents of safe.parsedValue.safeContents) {
    for (const bag of contents.value.safeBags) {
      const value = bag.bagValue;
      if (value instanceof pkijs.CertBag) {
        if (value.parsedValue instanceof pkijs.Certificate) certs.push(value.parsedValue);
      } else if (value instanceof pkijs.PKCS8ShroudedKeyBag) {
        try { await value.parseInternalValues({ password: pwBuf }, eng); }
        catch { throw new Error("Wrong certificate password: could not decrypt the private key."); }
        privateKeyInfo = value.parsedValue;
      } else if (value instanceof pkijs.PrivateKeyInfo || value instanceof pkijs.KeyBag) {
        privateKeyInfo = value.parsedValue || value;
      }
    }
  }
  if (!privateKeyInfo) throw new Error("That .p12/.pfx has no private key, so it cannot sign.");
  if (!certs.length) throw new Error("That .p12/.pfx has no certificate, so the signer identity is unknown.");

  // The signing certificate is the one whose public key matches the private
  // key; in practice it is the leaf. Order chain certs after it.
  const signerCert = certs[0];
  const chain = certs.slice(1);

  const pkcs8 = privateKeyInfo.toSchema().toBER();
  const keyAlgOid = privateKeyInfo.privateKeyAlgorithm.algorithmId;
  if (keyAlgOid !== OID.rsaEncryption) {
    // Signing and offline verification are implemented for RSA only. Refusing
    // is more honest than emitting a signature this tool cannot itself verify.
    throw new Error("This certificate uses a non-RSA key, which this tool does not sign with. Use an RSA certificate.");
  }
  const privateKey = await webcrypto.subtle.importKey("pkcs8", pkcs8, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);

  return {
    signerCert,
    chain,
    allCerts: certs,
    privateKey,
    keyType: "RSA",
    subjectCommonName: certCommonName(signerCert, "subject"),
    issuerCommonName: certCommonName(signerCert, "issuer"),
    serialHex: certSerialHex(signerCert),
  };
}

// ---------------------------------------------------------------------------
// Detached CMS (PKCS#7) SignedData
// ---------------------------------------------------------------------------

// Build the SignedData over `dataToSign`, with signed attributes (contentType,
// signingTime, messageDigest). pkijs signs the DER of the signed attributes; we
// compute and insert the messageDigest ourselves so the attribute is correct.
// Returns the live pkijs objects so an OPTIONAL RFC-3161 timestamp (an *unsigned*
// attribute, so it does not disturb the signature) can be attached before the
// CMS is serialised.
async function buildDetachedCms(dataToSign, signingDate, key, signerCert, chainCerts) {
  const eng = engine();
  const hashName = "SHA-256";
  const digest = await digestBytes(hashName, dataToSign);

  const signedAttrs = new pkijs.SignedAndUnsignedAttributes({
    type: 0,
    attributes: [
      new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: OID.data })] }),
      new pkijs.Attribute({ type: OID.signingTime, values: [new asn1js.UTCTime({ valueDate: signingDate })] }),
      new pkijs.Attribute({ type: OID.messageDigest, values: [new asn1js.OctetString({ valueHex: bufOf(digest) })] }),
    ],
  });

  const signedData = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
    signerInfos: [new pkijs.SignerInfo({
      version: 1,
      sid: new pkijs.IssuerAndSerialNumber({ issuer: signerCert.issuer, serialNumber: signerCert.serialNumber }),
      signedAttrs,
    })],
    certificates: [signerCert, ...chainCerts],
  });

  await signedData.sign(key.privateKey, 0, hashName, new ArrayBuffer(0), eng);
  return { signedData, signerInfo: signedData.signerInfos[0] };
}

function serializeCms(signedData) {
  const contentInfo = new pkijs.ContentInfo({ contentType: OID.signedData, content: signedData.toSchema(true) });
  return new Uint8Array(contentInfo.toSchema().toBER());
}

// ---------------------------------------------------------------------------
// RFC 3161 trusted timestamp (OPTIONAL). Off by default; when on, this is the
// ONE network call the signer makes — a POST to the user's own / a public TSA.
// The TSA never sees the document, only a SHA-256 hash of the CMS signature.
// ---------------------------------------------------------------------------

export function tsaOrigin(tsaUrl) {
  try { return new URL(String(tsaUrl || "")).origin; } catch { return ""; }
}

/** The exact CSP change an operator has to make to allow a TSA. */
export function tsaCspGuidance(tsaUrl) {
  const origin = tsaOrigin(tsaUrl) || "https://your-tsa.example";
  return `Add "connect-src 'self' ${origin}" to the Content-Security-Policy in both index.html and public/_headers, then rebuild and redeploy. The default MyFileKit policy allows no outbound connections on purpose, so a TSA only works on a deploy you control.`;
}

/**
 * Builds a DER-encoded RFC-3161 TimeStampReq whose message imprint is the given
 * SHA-256 digest. Exported so its ASN.1 structure is unit-testable. `certReq`
 * asks the TSA to return its certificate inside the token.
 */
export function buildTimestampRequest(messageImprintDigest, { nonce, certReq = true } = {}) {
  const digest = toBytes(messageImprintDigest);
  const request = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
      hashedMessage: new asn1js.OctetString({ valueHex: bufOf(digest) }),
    }),
    certReq,
  });
  if (nonce) request.nonce = new asn1js.Integer({ valueHex: bufOf(toBytes(nonce)) });
  return new Uint8Array(request.toSchema().toBER());
}

// Pull { genTime, tsaCommonName, imprintDigest } out of an RFC-3161 token
// (a CMS ContentInfo whose eContent is a TSTInfo). Best-effort; returns null on
// anything unparseable so verification never crashes on a weird token.
function readTstInfo(tokenContentInfo) {
  try {
    const signed = new pkijs.SignedData({ schema: tokenContentInfo.content });
    const eContent = signed.encapContentInfo?.eContent;
    if (!eContent) return null;
    // The encapsulated TSTInfo can be a primitive OR a constructed OCTET STRING.
    // A constructed one has an empty valueHexView, so fall back to getValue(),
    // which concatenates the chunks.
    let der = new Uint8Array(eContent.valueBlock.valueHexView);
    if (!der.length && typeof eContent.getValue === "function") der = new Uint8Array(eContent.getValue());
    if (!der.length) return null;
    const asn1 = asn1js.fromBER(bufOf(der));
    if (asn1.offset === -1) return null;
    const tst = new pkijs.TSTInfo({ schema: asn1.result });
    let tsaCommonName = "";
    const tsaCert = (signed.certificates || []).find((c) => c instanceof pkijs.Certificate);
    if (tsaCert) tsaCommonName = certCommonName(tsaCert, "subject");
    return {
      genTime: tst.genTime instanceof Date ? tst.genTime : null,
      tsaCommonName,
      imprintDigest: tst.messageImprint ? new Uint8Array(tst.messageImprint.hashedMessage.valueBlock.valueHexView) : null,
      hashAlgorithm: tst.messageImprint?.hashAlgorithm?.algorithmId || "",
    };
  } catch {
    return null;
  }
}

// Verify the timestamp token's OWN CMS SignedData signature over its TSTInfo,
// using the TSA certificate embedded in the token, and confirm the token's
// imprint really is over `imprintedBytes` (this signature). pkijs verifies both
// at once for a TSTInfo-carrying token when given the imprinted data. A `true`
// result proves the token is cryptographically intact and bound to THIS
// signature — it does NOT prove the TSA is trusted: we hold no CA store and make
// no network calls, the same honest limit as the signer certificate. Any parse
// or verification failure counts as not verified.
async function verifyTimestampTokenSignature(tokenContentInfo, imprintedBytes) {
  try {
    const signed = new pkijs.SignedData({ schema: tokenContentInfo.content });
    // The encapsulated TSTInfo may decode as a CONSTRUCTED OCTET STRING, whose
    // valueHexView is empty; pkijs's own verify reads that view directly and
    // then fails to parse the TSTInfo. Re-wrap it as a primitive OCTET STRING
    // (the same fallback readTstInfo uses) so verification sees the real bytes.
    const eContent = signed.encapContentInfo?.eContent;
    if (eContent && !eContent.valueBlock.valueHexView?.byteLength && typeof eContent.getValue === "function") {
      signed.encapContentInfo.eContent = new asn1js.OctetString({ valueHex: eContent.getValue() });
    }
    // For a TSTInfo token pkijs also re-checks the imprint against `data`, so a
    // token that does not cover this signature verifies as false — which is what
    // we want. `data` is the CMS signature the imprint is taken over.
    const result = await signed.verify({ signer: 0, data: bufOf(imprintedBytes) }, engine());
    return result === true;
  } catch {
    return false;
  }
}

/**
 * Requests a timestamp token over `signatureBytes` (the CMS SignerInfo signature)
 * from `tsaUrl`. This is a real network POST of application/timestamp-query. A
 * blocked/unreachable TSA surfaces the same actionable connect-src guidance the
 * LLM adapter uses. `fetchImpl` keeps the happy path testable without a live TSA.
 */
async function requestTimestampToken(tsaUrl, signatureBytes, { fetchImpl, signal } = {}) {
  const url = String(tsaUrl || "").trim();
  if (!url) throw new Error("Enter the URL of an RFC 3161 timestamp authority (TSA).");
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("The TSA URL must be a full URL, for example https://freetsa.org/tsr"); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("The TSA URL must use https:// (or http:// for a local TSA).");

  const digest = await digestBytes("SHA-256", signatureBytes);
  const nonce = new Uint8Array(16);
  webcrypto.getRandomValues(nonce);
  const requestDer = buildTimestampRequest(digest, { nonce, certReq: true });

  const request = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!request) throw new Error("This environment has no fetch API, so a TSA cannot be contacted.");

  let response;
  try {
    response = await request(url, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/timestamp-query", Accept: "application/timestamp-reply" },
      body: bufOf(requestDer),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("The timestamp request was cancelled.");
    throw new Error(`The browser blocked or could not reach the timestamp authority at ${tsaOrigin(url) || "the TSA"}. ${tsaCspGuidance(url)} If the policy already allows it, check that the TSA is reachable and sends CORS headers.`);
  }
  if (!response.ok) {
    throw new Error(`The timestamp authority answered ${response.status}${response.statusText ? ` ${response.statusText}` : ""}. Check the TSA URL and that it speaks RFC 3161.`);
  }

  const replyBytes = new Uint8Array(await response.arrayBuffer());
  const asn1 = asn1js.fromBER(bufOf(replyBytes));
  if (asn1.offset === -1) throw new Error("The timestamp authority's reply is not valid DER.");
  let resp;
  try { resp = new pkijs.TimeStampResp({ schema: asn1.result }); }
  catch { throw new Error("The timestamp authority's reply is not a valid RFC 3161 TimeStampResp."); }
  const statusValue = resp.status?.status;
  // 0 = granted, 1 = grantedWithMods; anything else is a rejection.
  if (statusValue !== 0 && statusValue !== 1) {
    throw new Error(`The timestamp authority rejected the request (PKIStatus ${statusValue ?? "unknown"}).`);
  }
  if (!resp.timeStampToken) throw new Error("The timestamp authority granted the request but returned no token.");
  return resp.timeStampToken; // a pkijs.ContentInfo
}

// ---------------------------------------------------------------------------
// Visible signature appearance (a Form XObject)
// ---------------------------------------------------------------------------

function appearanceStream(rectWidth, rectHeight, lines) {
  const parts = [];
  // A light border, then each text line.
  parts.push("q");
  parts.push("0.55 0.55 0.55 RG 0.75 w");
  parts.push(`0.75 0.75 ${(rectWidth - 1.5).toFixed(2)} ${(rectHeight - 1.5).toFixed(2)} re S`);
  parts.push("Q");
  parts.push("BT");
  const fontSize = 9;
  const leading = 11;
  let y = rectHeight - 12;
  for (const [text, bold] of lines) {
    const font = bold ? "/HelvB" : "/Helv";
    parts.push(`${font} ${fontSize} Tf`);
    parts.push("0.1 0.1 0.1 rg");
    parts.push(`1 0 0 1 6 ${y.toFixed(2)} Tm`);
    parts.push(`(${pdfLiteral(text)}) Tj`);
    y -= leading;
  }
  parts.push("ET");
  return latin1Bytes(parts.join("\n"));
}
function pdfLiteral(text) {
  return String(text ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[\r\n]+/g, " ");
}

// ---------------------------------------------------------------------------
// First-page lookup
// ---------------------------------------------------------------------------

// Walk the page tree in order, returning { ref, obj, entry } for each leaf page.
function collectPages(doc) {
  const catalog = resolve(doc, doc.trailer.get("Root"));
  if (catalog.k !== "dict") throw new Error("This PDF's document catalog is unreadable.");
  const pages = [];
  const seen = new Set();
  const walk = (nodeRef, depth) => {
    if (depth > 64) return;
    const node = resolve(doc, nodeRef);
    if (node.k !== "dict") return;
    const type = nameValue(dictGet(doc, node, "Type"));
    const kids = dictGet(doc, node, "Kids");
    if (type === "Page" || (kids.k !== "array" && type !== "Pages")) {
      let ref = nodeRef.k === "ref" ? nodeRef : null;
      if (!ref) for (const entry of doc.objects.values()) if (entry.obj === node) { ref = mkRef(entry.num, entry.gen); break; }
      if (ref && !seen.has(ref.num)) { seen.add(ref.num); pages.push({ ref, obj: node, entry: doc.objects.get(ref.num) }); }
      return;
    }
    if (kids.k === "array") for (const kid of kids.v) walk(kid, depth + 1);
  };
  walk(dictGet(doc, catalog, "Pages"), 0);
  if (!pages.length) {
    for (const entry of doc.objects.values()) {
      if (entry.obj.k === "dict" && nameValue(dictGet(doc, entry.obj, "Type")) === "Page") {
        pages.push({ ref: mkRef(entry.num, entry.gen), obj: entry.obj, entry });
      }
    }
  }
  if (!pages.length) throw new Error("This PDF has no readable pages to place a signature on.");
  return { pages, catalog, catalogRef: doc.trailer.get("Root") };
}

function pageMediaBox(doc, pageObj) {
  let box = dictGet(doc, pageObj, "MediaBox");
  if (box.k !== "array") return [0, 0, 612, 792];
  const values = box.v.map((item) => numberValue(resolve(doc, item), 0));
  if (values.length !== 4) return [0, 0, 612, 792];
  return values;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

const CONTENTS_BYTES = 16384; // 32 KB of hex; ample for RSA-4096 plus a chain.
const BYTERANGE_SLOT = 10;    // fixed-width decimal slot per ByteRange number.

/**
 * Signs a PDF with a detached PKCS#7/CMS signature via an incremental update.
 *
 * options: { p12, password, name, reason, location, visible, page, rect }
 *   - rect: [x, y, width, height] in PDF points for a visible appearance.
 */
export async function signPdf(pdfSource, options = {}) {
  const pdfBytes = await readFileBytes(pdfSource);
  const key = options.loadedKey || await loadPkcs12(options.p12, options.password);

  const doc = parsePdf(pdfBytes);
  if (doc.trailer.get("Encrypt")) {
    throw new Error("This PDF is encrypted. Remove its password first (Remove Password), then sign the copy.");
  }
  const prevStartXref = readStartXref(pdfBytes);
  if (!Number.isInteger(prevStartXref) || prevStartXref < 0) {
    throw new Error("Could not locate this PDF's cross-reference table. Try Repair PDF first, then sign.");
  }

  const { pages, catalog, catalogRef } = collectPages(doc);
  if (catalogRef?.k !== "ref") throw new Error("This PDF's catalog is not an indirect object and cannot be updated.");
  const pageIndex = Math.min(Math.max(0, Number(options.pageIndex) || 0), pages.length - 1);
  const { ref: pageRef, obj: pageObj, entry: pageEntry } = pages[pageIndex];
  if (!pageEntry) throw new Error("The chosen page is not an indirect object and cannot be updated.");

  // Allocate fresh object numbers above everything already in the file.
  let maxNum = 0;
  for (const number of doc.objects.keys()) maxNum = Math.max(maxNum, number);
  let nextNum = maxNum + 1;
  const alloc = () => nextNum++;

  const sigNum = alloc();
  const widgetNum = alloc();
  const visible = Boolean(options.visible);
  const apNum = visible ? alloc() : 0;
  const acroFormNum = alloc();

  const signingDate = new Date();
  const signerName = String(options.name || key.subjectCommonName || "").trim();

  // --- The signature widget annotation (a merged field + widget) ---
  const rect = visible ? normaliseRect(options.rect, pageMediaBox(doc, pageObj)) : [0, 0, 0, 0];
  const widgetEntries = [
    ["Type", mkName("Annot")],
    ["Subtype", mkName("Widget")],
    ["FT", mkName("Sig")],
    ["T", mkStr(`Signature-${Date.now()}`)],
    ["V", mkRef(sigNum)],
    ["P", pageRef],
    ["F", mkNum(visible ? 4 : 132)], // 4 = Print; 132 = Print+Hidden for invisible
    ["Rect", mkArray(rect.map((n) => mkNum(n)))],
  ];
  if (visible) widgetEntries.push(["AP", mkDict([["N", mkRef(apNum)]])]);
  const widgetObj = mkDict(widgetEntries);

  // --- Audit trail: first signature is "Signed"; if the incoming PDF already
  // carries a signature, this one is a "CounterSigned" event. ---
  const isCounterSign = documentHasSignature(doc);
  const contact = String(options.contact || "").trim();
  const summaryParts = [
    `${isCounterSign ? "Counter-signed" : "Signed"} by ${signerName || "(unnamed)"}`,
  ];
  if (options.reason) summaryParts.push(`Reason: ${String(options.reason)}`);
  if (options.location) summaryParts.push(`Location: ${String(options.location)}`);
  summaryParts.push(`${signingDate.toISOString().replace(/\.\d+Z$/, "Z")} (client-asserted time)`);
  summaryParts.push("Integrity: SHA-256 of the covered bytes, recorded in the CMS signature");
  const audit = {
    event: isCounterSign ? "CounterSigned" : "Signed",
    contact,
    summary: summaryParts.join(" | "),
  };

  // --- The signature dictionary is emitted by hand so /ByteRange and /Contents
  // stay fixed-width and locatable for patching. ---
  const sigDictText = buildSigDictText(signingDate, signerName, options.reason, options.location, audit);

  // --- AcroForm: merge into any existing one, else create it ---
  const existingAcroForm = dictGet(doc, catalog, "AcroForm");
  const acroFormEntries = new Map();
  const existingFields = [];
  let sigFlags = 3;
  if (existingAcroForm.k === "dict") {
    existingAcroForm.v.forEach((value, k) => acroFormEntries.set(k, value));
    const fields = dictGet(doc, existingAcroForm, "Fields");
    if (fields.k === "array") for (const item of fields.v) existingFields.push(item);
    const flags = numberValue(dictGet(doc, existingAcroForm, "SigFlags"), 0);
    sigFlags = (flags | 3) >>> 0;
  }
  acroFormEntries.set("Fields", mkArray([...existingFields, mkRef(widgetNum)]));
  acroFormEntries.set("SigFlags", mkNum(sigFlags));
  const acroFormObj = { k: "dict", v: acroFormEntries };

  // --- Overrides: page (add /Annots) and catalog (point /AcroForm at ours) ---
  const pageOverride = cloneDict(pageObj);
  const existingAnnots = dictGet(doc, pageObj, "Annots");
  const annotItems = existingAnnots.k === "array" ? [...existingAnnots.v] : [];
  annotItems.push(mkRef(widgetNum));
  pageOverride.v.set("Annots", mkArray(annotItems));

  const catalogOverride = cloneDict(catalog);
  catalogOverride.v.set("AcroForm", mkRef(acroFormNum));

  // --- Assemble the incremental section with placeholders ---
  const emit = [];
  emit.push({ num: sigNum, gen: 0, body: latin1Bytes(sigDictText) });
  emit.push({ num: widgetNum, gen: 0, body: serializeObjectBody(widgetObj) });
  if (visible) {
    const rectW = rect[2] - rect[0];
    const rectH = rect[3] - rect[1];
    const lines = buildAppearanceLines(signerName, options.reason, options.location, signingDate);
    const content = appearanceStream(rectW, rectH, lines);
    const fontDict = mkDict([
      ["Helv", mkDict([["Type", mkName("Font")], ["Subtype", mkName("Type1")], ["BaseFont", mkName("Helvetica")]])],
      ["HelvB", mkDict([["Type", mkName("Font")], ["Subtype", mkName("Type1")], ["BaseFont", mkName("Helvetica-Bold")]])],
    ]);
    const apDict = mkDict([
      ["Type", mkName("XObject")],
      ["Subtype", mkName("Form")],
      ["FormType", mkNum(1)],
      ["BBox", mkArray([mkNum(0), mkNum(0), mkNum(rectW), mkNum(rectH)])],
      ["Resources", mkDict([["Font", fontDict]])],
    ]);
    const apStream = { k: "stream", dict: apDict, raw: content };
    emit.push({ num: apNum, gen: 0, body: serializeObjectBody(apStream) });
  }
  emit.push({ num: acroFormNum, gen: 0, body: serializeObjectBody(acroFormObj) });
  emit.push({ num: pageEntry.num, gen: pageEntry.gen, body: serializeObjectBody(pageOverride) });
  emit.push({ num: doc.objects.get(catalogRef.num).num, gen: doc.objects.get(catalogRef.num).gen, body: serializeObjectBody(catalogOverride) });

  const built = assembleIncrementalUpdate(pdfBytes, emit, {
    catalogRef,
    prevStartXref,
    idPair: existingIdPair(doc),
  });

  // --- Measure ByteRange, patch it, sign, optionally timestamp, inject the CMS ---
  const withByteRange = fillByteRange(built.bytes, built.sigDictOffset);
  const { signedData, signerInfo } = await buildDetachedCms(withByteRange.signedData, signingDate, key, key.signerCert, key.chain);

  // OPTIONAL: attach a trusted RFC-3161 timestamp as an unsigned attribute. This
  // is the only network call signing ever makes, and only when the caller asks.
  let timestamp = null;
  if (options.timestamp) {
    const signatureBytes = new Uint8Array(signerInfo.signature.valueBlock.valueHexView);
    const token = await requestTimestampToken(options.tsaUrl, signatureBytes, { fetchImpl: options.fetchImpl, signal: options.signal });
    signerInfo.unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
      type: 1,
      attributes: [new pkijs.Attribute({ type: OID.timeStampToken, values: [token.toSchema()] })],
    });
    const info = readTstInfo(token);
    timestamp = { tsa: tsaOrigin(options.tsaUrl), time: info?.genTime || null, tsaCommonName: info?.tsaCommonName || "" };
  }

  const cmsDer = serializeCms(signedData);
  if (cmsDer.length > CONTENTS_BYTES) {
    throw new Error(`The signature is larger than the reserved space (${cmsDer.length} > ${CONTENTS_BYTES} bytes).${options.timestamp ? " The timestamp token pushed it over the limit — try a TSA that omits its certificate, or a smaller certificate chain." : " This certificate chain is unusually large."}`);
  }
  injectContents(withByteRange.bytes, withByteRange.contentsOpen, cmsDer);

  return {
    bytes: withByteRange.bytes,
    subjectCommonName: key.subjectCommonName,
    issuerCommonName: key.issuerCommonName,
    serialHex: key.serialHex,
    keyType: key.keyType,
    chainLength: key.chain.length,
    signingTime: signingDate,
    timestamp,
    visible,
    signedPage: pageIndex + 1,
    pageCount: pages.length,
    selfSigned: key.subjectCommonName === key.issuerCommonName,
    auditEvent: audit.event,
    counterSigned: isCounterSign,
  };
}

function mkStr(text) {
  return { k: "str", v: latin1Bytes(text), hex: false };
}
function cloneDict(dictObject) {
  const copy = new Map();
  dictObject.v.forEach((value, key) => copy.set(key, value));
  return { k: "dict", v: copy };
}
function normaliseRect(rect, mediaBox) {
  if (Array.isArray(rect) && rect.length === 4 && rect.every((n) => Number.isFinite(Number(n)))) {
    const [x, y, w, h] = rect.map(Number);
    return [x, y, x + w, y + h];
  }
  // Default: a box in the lower-left corner of the page.
  const [mx0, my0] = [mediaBox[0], mediaBox[1]];
  return [mx0 + 36, my0 + 36, mx0 + 36 + 220, my0 + 36 + 64];
}
function buildAppearanceLines(name, reason, location, date) {
  const lines = [];
  lines.push([`Digitally signed`, true]);
  if (name) lines.push([`by ${name}`, false]);
  if (reason) lines.push([`Reason: ${reason}`, false]);
  if (location) lines.push([`Location: ${location}`, false]);
  lines.push([`Date: ${date.toISOString().replace("T", " ").slice(0, 19)} UTC`, false]);
  return lines;
}
// True when the parsed document already carries at least one signature dict —
// used to label a fresh signature as a counter-signature in its audit trail.
function documentHasSignature(doc) {
  for (const entry of doc.objects.values()) {
    const object = entry.obj;
    if (object.k !== "dict") continue;
    const isSig = nameValue(dictGet(doc, object, "Type")) === "Sig"
      || nameValue(dictGet(doc, object, "Filter")) === "Adobe.PPKLite";
    if (isSig && dictGet(doc, object, "ByteRange").k === "array" && object.v.get("Contents")?.k === "str") {
      return true;
    }
  }
  return false;
}

function buildSigDictText(date, name, reason, location, audit) {
  const slot = "0".repeat(BYTERANGE_SLOT);
  const range = `[0 ${slot} ${slot} ${slot}]`;
  let text = "<</Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached";
  text += ` /M (${pdfDate(date)})`;
  if (name) text += ` /Name (${pdfLiteral(name)})`;
  if (reason) text += ` /Reason (${pdfLiteral(reason)})`;
  if (location) text += ` /Location (${pdfLiteral(location)})`;
  // --- Embedded, tamper-evident audit trail (/MFKAuditTrail) ---------------
  // This whole sub-dictionary sits INSIDE the signature's ByteRange, so the
  // CMS signature protects it: any edit to a recorded field breaks the
  // signature. /Covered mirrors /ByteRange (filled, pre-signing, by
  // fillByteRange) so verification can confirm the recorded range matches the
  // signature's own /ByteRange. The document hash itself is not duplicated
  // here — it IS the CMS message digest (SHA-256 of the covered bytes), which
  // verification recomputes and cross-checks. Storing a second copy inside the
  // signed span would be self-referential; the CMS digest is the honest anchor.
  text += " /MFKAuditTrail <<";
  text += " /Producer (MyFileKit Local e-Sign)";
  text += " /Version 1";
  text += ` /Event /${audit.event}`; // "Signed" or "CounterSigned"
  if (name) text += ` /Signer (${pdfLiteral(name)})`;
  if (reason) text += ` /Reason (${pdfLiteral(reason)})`;
  if (location) text += ` /Location (${pdfLiteral(location)})`;
  if (audit.contact) text += ` /Contact (${pdfLiteral(audit.contact)})`;
  text += ` /ClientTime (${pdfDate(date)})`;
  text += " /ClientTimeAsserted true"; // NOT a trusted timestamp unless an RFC-3161 token is attached
  text += " /HashAlg /SHA-256";
  text += ` /Covered ${range}`;
  text += ` /Summary (${pdfLiteral(audit.summary)})`;
  text += " >>";
  text += ` /ByteRange ${range}`;
  text += ` /Contents <${"0".repeat(CONTENTS_BYTES * 2)}>`;
  text += ">>";
  return text;
}

// Build `\n N G obj\n<body>\nendobj\n ... xref ... trailer ... startxref ...`.
function assembleIncrementalUpdate(pdfBytes, emit, { catalogRef, prevStartXref, idPair }) {
  const chunks = [];
  let length = pdfBytes.length;
  chunks.push(pdfBytes);
  // Original files usually end with %%EOF and maybe a newline; ensure a clean
  // separator so our first object header is unambiguous.
  const needsNewline = pdfBytes[pdfBytes.length - 1] !== 10;
  if (needsNewline) { const nl = latin1Bytes("\n"); chunks.push(nl); length += nl.length; }

  const offsets = new Map();
  let sigDictOffset = -1;
  for (const object of emit) {
    const header = latin1Bytes(`${object.num} ${object.gen} obj\n`);
    offsets.set(object.num, length);
    chunks.push(header); length += header.length;
    if (object.body === emit[0].body) sigDictOffset = length; // start of the sig dict body
    chunks.push(object.body); length += object.body.length;
    const footer = latin1Bytes("\nendobj\n");
    chunks.push(footer); length += footer.length;
  }

  // Classic cross-reference section listing only the changed objects.
  const xrefOffset = length;
  const sorted = [...emit].sort((a, b) => a.num - b.num);
  const lines = ["xref\n"];
  let index = 0;
  while (index < sorted.length) {
    let runEnd = index;
    while (runEnd + 1 < sorted.length && sorted[runEnd + 1].num === sorted[runEnd].num + 1) runEnd++;
    const runStart = sorted[index].num;
    const count = runEnd - index + 1;
    lines.push(`${runStart} ${count}\n`);
    for (let i = index; i <= runEnd; i++) {
      const entry = sorted[i];
      lines.push(`${String(offsets.get(entry.num)).padStart(10, "0")} ${String(entry.gen).padStart(5, "0")} n\r\n`);
    }
    index = runEnd + 1;
  }
  const xrefText = latin1Bytes(lines.join(""));
  chunks.push(xrefText); length += xrefText.length;

  let highest = 0;
  for (const object of emit) highest = Math.max(highest, object.num);
  const size = highest + 1;

  const trailer = mkDict([
    ["Size", mkNum(size)],
    ["Root", catalogRef],
    ["Prev", mkNum(prevStartXref)],
    ["ID", mkArray([{ k: "str", v: idPair[0], hex: true }, { k: "str", v: idPair[1], hex: true }])],
  ]);
  const trailerText = concatBytes([latin1Bytes("trailer\n"), serializeObjectBody(trailer), latin1Bytes(`\nstartxref\n${xrefOffset}\n%%EOF\n`)]);
  chunks.push(trailerText); length += trailerText.length;

  return { bytes: concatBytes(chunks), sigDictOffset };
}

function existingIdPair(doc) {
  const id = resolve(doc, doc.trailer.get("ID"));
  const first = id.k === "array" && id.v[0] ? resolve(doc, id.v[0]) : null;
  const second = id.k === "array" && id.v[1] ? resolve(doc, id.v[1]) : null;
  const rand = () => { const out = new Uint8Array(16); webcrypto.getRandomValues(out); return out; };
  return [first?.k === "str" ? first.v : rand(), second?.k === "str" ? second.v : rand()];
}

// Locate /ByteRange and /Contents in the assembled bytes and fill in the real
// ByteRange numbers (fixed width, so nothing shifts). Returns the two spans the
// signature must cover.
function fillByteRange(bytes, sigDictOffset) {
  const brNeedle = latin1Bytes("/ByteRange [0 ");
  const brStart = indexOfSequence(bytes, brNeedle, sigDictOffset);
  if (brStart < 0) throw new Error("Internal error: signature ByteRange placeholder not found.");
  const slot1 = brStart + brNeedle.length;
  const slot2 = slot1 + BYTERANGE_SLOT + 1;
  const slot3 = slot2 + BYTERANGE_SLOT + 1;

  const contentsNeedle = latin1Bytes("/Contents <");
  const contentsStart = indexOfSequence(bytes, contentsNeedle, sigDictOffset);
  if (contentsStart < 0) throw new Error("Internal error: signature Contents placeholder not found.");
  const contentsOpen = contentsStart + contentsNeedle.length - 1; // index of '<'
  const contentsClose = contentsOpen + 1 + CONTENTS_BYTES * 2;     // index of '>'
  if (bytes[contentsOpen] !== 0x3c || bytes[contentsClose] !== 0x3e) {
    throw new Error("Internal error: signature Contents placeholder is malformed.");
  }

  const total = bytes.length;
  const a = contentsOpen;              // length of range 1 (bytes [0, a))
  const start2 = contentsClose + 1;    // range 2 begins just after '>'
  const length2 = total - start2;

  writeSlot(bytes, slot1, a);
  writeSlot(bytes, slot2, start2);
  writeSlot(bytes, slot3, length2);

  // Mirror the same range into the audit trail's /Covered array. It lies BEFORE
  // /Contents (inside range 1), so it is filled here — before signing — and is
  // covered by the CMS signature. Its slots share the ByteRange layout.
  const covNeedle = latin1Bytes("/Covered [0 ");
  const covStart = indexOfSequence(bytes, covNeedle, sigDictOffset);
  if (covStart >= 0) {
    const c1 = covStart + covNeedle.length;
    const c2 = c1 + BYTERANGE_SLOT + 1;
    const c3 = c2 + BYTERANGE_SLOT + 1;
    writeSlot(bytes, c1, a);
    writeSlot(bytes, c2, start2);
    writeSlot(bytes, c3, length2);
  }

  const signedData = concatBytes([bytes.subarray(0, a), bytes.subarray(start2, total)]);
  return { bytes, signedData, contentsOpen };
}
function writeSlot(bytes, position, value) {
  const text = String(value);
  if (text.length > BYTERANGE_SLOT) throw new Error("Internal error: ByteRange number does not fit its slot.");
  const padded = text.padEnd(BYTERANGE_SLOT, " ");
  for (let i = 0; i < BYTERANGE_SLOT; i++) bytes[position + i] = padded.charCodeAt(i);
}
function injectContents(bytes, contentsOpen, cmsDer) {
  const hex = hexOf(cmsDer);
  const start = contentsOpen + 1;
  for (let i = 0; i < hex.length; i++) bytes[start + i] = hex.charCodeAt(i);
  // The rest of the reserved space is already '0' from the placeholder.
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

// The honest limit of a self-embedded audit trail: it proves byte integrity and
// what the signer certificate CLAIMS, never real-world identity.
const IDENTITY_CAVEAT =
  "This is a locally-signed document. The audit trail proves the covered bytes are "
  + "unchanged and records what the signer's certificate claims — it does NOT prove the "
  + "signer's real-world identity. Trusted identity needs a CA-issued certificate (and, for "
  + "time, an RFC-3161 timestamp) or the hosted multi-party e-sign flow.";

// Reads the embedded /MFKAuditTrail sub-dictionary from a signature dict. Every
// field is data written by the signer; verification cross-checks it against the
// signature, so a forged field cannot pass unless the CMS also verifies.
function readAuditTrail(doc, sigObject) {
  const at = dictGet(doc, sigObject, "MFKAuditTrail");
  if (at.k !== "dict") return { present: false };
  const str = (key) => { const v = dictGet(doc, at, key); return v.k === "str" ? decodePdfText(v.v) : null; };
  const nm = (key) => nameValue(dictGet(doc, at, key));
  const coveredObj = dictGet(doc, at, "Covered");
  const covered = coveredObj.k === "array" ? coveredObj.v.map((x) => numberValue(resolve(doc, x))) : null;
  return {
    present: true,
    producer: str("Producer"),
    event: nm("Event"),
    signer: str("Signer"),
    reason: str("Reason"),
    location: str("Location"),
    contact: str("Contact"),
    clientTime: str("ClientTime"),
    clientTimeAsserted: true,
    hashAlg: nm("HashAlg"),
    covered,
    summary: str("Summary"),
  };
}

// Find every signature dictionary in the file and, for each, recompute the
// digest over its /ByteRange and check the CMS. All maths is done locally; no
// trust chain to a root and no revocation check is attempted (see module note).
export async function verifyPdfSignatures(pdfSource) {
  const pdfBytes = await readFileBytes(pdfSource);
  const doc = parsePdf(pdfBytes);

  // Map signature dictionaries to a field name, if one references them via /V.
  const fieldNameByObj = new Map();
  for (const entry of doc.objects.values()) {
    if (entry.obj.k !== "dict") continue;
    const v = entry.obj.v.get("V");
    const t = entry.obj.v.get("T");
    if (v?.k === "ref" && t?.k === "str") fieldNameByObj.set(v.num, decodePdfText(t.v));
  }

  const signatures = [];
  for (const entry of doc.objects.values()) {
    const object = entry.obj;
    if (object.k !== "dict") continue;
    const filter = nameValue(dictGet(doc, object, "Filter"));
    const byteRange = dictGet(doc, object, "ByteRange");
    const contents = object.v.get("Contents");
    const isSig = nameValue(dictGet(doc, object, "Type")) === "Sig" || filter === "Adobe.PPKLite";
    if (!isSig || byteRange.k !== "array" || !contents || contents.k !== "str") continue;

    const range = byteRange.v.map((item) => numberValue(resolve(doc, item)));
    const audit = readAuditTrail(doc, object);
    const report = await verifyOneSignature(pdfBytes, range, contents.v, audit).catch((error) => ({
      fieldName: fieldNameByObj.get(entry.num) || "(unnamed)",
      subFilter: nameValue(dictGet(doc, object, "SubFilter")) || "",
      error: error?.message || "Could not verify this signature.",
      integrity: false,
      digestValid: false,
      signatureValid: false,
      byteRangeValid: false,
      coversWholeDoc: false,
      auditTrailPresent: audit.present,
      auditHashMatches: null,
      auditTrail: audit.present ? audit : null,
      tamperFindings: [error?.message || "Could not parse this signature."],
      identityCaveat: IDENTITY_CAVEAT,
      timestamp: { present: false },
      verdict: "invalid",
      detail: error?.message || "Could not parse this signature.",
    }));
    report.fieldName = fieldNameByObj.get(entry.num) || report.fieldName || "(unnamed)";
    report.subFilter = nameValue(dictGet(doc, object, "SubFilter")) || report.subFilter || "";
    const m = object.v.get("M");
    report.declaredSigningTime = m?.k === "str" ? decodePdfText(m.v) : null;
    signatures.push(report);
  }

  signatures.sort((a, b) => (a.fieldName || "").localeCompare(b.fieldName || ""));
  return { count: signatures.length, signatures, fileBytes: pdfBytes.length };
}

async function verifyOneSignature(pdfBytes, range, contentsBytes, audit = { present: false }) {
  if (!Array.isArray(range) || range.length < 4 || range.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error("This signature has an unreadable /ByteRange.");
  }
  const [s1, l1, s2, l2] = range;
  if (s1 + l1 > pdfBytes.length || s2 + l2 > pdfBytes.length) throw new Error("This signature's /ByteRange points outside the file.");
  const signedData = concatBytes([pdfBytes.subarray(s1, s1 + l1), pdfBytes.subarray(s2, s2 + l2)]);

  // The whole file is covered iff the two spans meet exactly at the /Contents
  // gap and reach the end of the file.
  const coversWholeDocument = s1 === 0 && (s2 + l2) === pdfBytes.length;

  const asn1 = asn1js.fromBER(bufOf(contentsBytes));
  if (asn1.offset === -1) throw new Error("The signature's CMS could not be parsed.");
  const contentInfo = new pkijs.ContentInfo({ schema: asn1.result });
  if (contentInfo.contentType !== OID.signedData) throw new Error("The signature is not CMS SignedData.");
  const signedDataCms = new pkijs.SignedData({ schema: contentInfo.content });
  const signerInfo = signedDataCms.signerInfos[0];
  if (!signerInfo) throw new Error("The signature has no signer information.");

  // Match the signer certificate by issuer + serial.
  let signerCert = null;
  if (signerInfo.sid instanceof pkijs.IssuerAndSerialNumber) {
    for (const cert of signedDataCms.certificates || []) {
      if (cert instanceof pkijs.Certificate
        && cert.issuer.isEqual(signerInfo.sid.issuer)
        && cert.serialNumber.isEqual(signerInfo.sid.serialNumber)) { signerCert = cert; break; }
    }
  }
  if (!signerCert) signerCert = (signedDataCms.certificates || []).find((c) => c instanceof pkijs.Certificate) || null;
  if (!signerCert) throw new Error("The signature carries no signer certificate.");

  const digestOid = signerInfo.digestAlgorithm.algorithmId;
  const hashName = HASH_BY_OID[digestOid] || "SHA-256";

  // Integrity: recompute the document digest and compare it against the signed
  // messageDigest attribute (or, if there are no signed attributes, the check
  // collapses into the signature verification below).
  let integrity;
  let signatureValid;
  let unsupported = false;
  let recordedDigest = null; // the SHA-256 the signature recorded for the covered bytes
  let computedDigest = null; // the SHA-256 we recompute now over the actual bytes
  const signedAttrs = signerInfo.signedAttrs;
  try {
    if (signedAttrs && signedAttrs.attributes.length) {
      const mdAttr = signedAttrs.attributes.find((a) => a.type === OID.messageDigest);
      if (!mdAttr) throw new Error("The signature is missing its message-digest attribute.");
      const signedDigest = new Uint8Array(mdAttr.values[0].valueBlock.valueHexView);
      const actualDigest = await digestBytes(hashName, signedData);
      recordedDigest = signedDigest;
      computedDigest = actualDigest;
      integrity = bytesEqual(signedDigest, actualDigest);

      // Authenticity: verify the signature over the DER of the signed attributes
      // (SET OF, tag 0x31) using the signer certificate's public key.
      const attrsDer = new Uint8Array(signedAttrs.toSchema().toBER());
      attrsDer[0] = 0x31;
      signatureValid = await verifySignature(signerCert, hashName, signerInfo.signature.valueBlock.valueHexView, attrsDer);
    } else {
      // No signed attributes: the signature is directly over the document bytes.
      computedDigest = await digestBytes(hashName, signedData);
      signatureValid = await verifySignature(signerCert, hashName, signerInfo.signature.valueBlock.valueHexView, signedData);
      integrity = signatureValid;
    }
  } catch (error) {
    if (error instanceof UnsupportedKeyError) unsupported = true;
    else throw error;
  }

  const signingTimeAttr = signedAttrs?.attributes.find((a) => a.type === OID.signingTime);
  let signingTime = null;
  if (signingTimeAttr) {
    const t = signingTimeAttr.values[0];
    signingTime = (t.toDate ? t.toDate() : t.valueBlock?.value) || null;
  }

  // RFC-3161 trusted timestamp: an unsigned attribute carrying a TSA-issued token.
  // Two independent checks: `imprintMatches` proves the token's imprint is over
  // THIS signature, and `tokenSignatureValid` proves the token's own CMS
  // signature (over its TSTInfo) is cryptographically intact. Only when BOTH hold
  // is the time genuinely TSA-attested — and even then only as strongly as the
  // reader trusts the TSA, which we cannot establish offline (no CA store).
  let timestamp = { present: false };
  const tsAttr = signerInfo.unsignedAttrs?.attributes?.find((a) => a.type === OID.timeStampToken);
  if (tsAttr && tsAttr.values[0]) {
    try {
      const tokenInfo = new pkijs.ContentInfo({ schema: tsAttr.values[0] });
      const info = readTstInfo(tokenInfo);
      const sigBytes = new Uint8Array(signerInfo.signature.valueBlock.valueHexView);
      let imprintMatches = null;
      if (info?.imprintDigest && info.hashAlgorithm && HASH_BY_OID[info.hashAlgorithm]) {
        const overSignature = await digestBytes(HASH_BY_OID[info.hashAlgorithm], sigBytes);
        imprintMatches = bytesEqual(info.imprintDigest, overSignature);
      }
      const tokenSignatureValid = await verifyTimestampTokenSignature(tokenInfo, sigBytes);
      const genTime = info?.genTime || null;
      timestamp = { present: true, genTime, time: genTime, tsaCommonName: info?.tsaCommonName || "", imprintMatches, tokenSignatureValid };
    } catch {
      timestamp = { present: true, genTime: null, time: null, tsaCommonName: "", imprintMatches: null, tokenSignatureValid: false, error: "The timestamp token could not be read." };
    }
  }

  // --- Audit-trail cross-checks (C2) ---------------------------------------
  const digestValid = integrity === true;
  // The recorded byte range is valid when it is structurally sane AND, if the
  // audit trail recorded its own /Covered copy, that copy matches the actual
  // /ByteRange (a mismatch means someone rewrote one but not the other).
  const rangeSane = Array.isArray(range) && range.length >= 4 && (s2 + l2) <= pdfBytes.length && s1 === 0;
  const coveredMatches = !audit.present || !Array.isArray(audit.covered)
    ? true
    : audit.covered.length === range.length && audit.covered.every((n, i) => n === range[i]);
  const byteRangeValid = rangeSane && coveredMatches;

  // auditHashMatches: does the SHA-256 the signature recorded for the covered
  // bytes still match a fresh hash of those bytes? (Only meaningful when an
  // audit trail is present; it is the same anchor as `integrity`, surfaced as
  // an explicit, human-facing cross-check.)
  const auditTrailPresent = Boolean(audit.present);
  const auditHashMatches = auditTrailPresent && recordedDigest ? bytesEqual(recordedDigest, computedDigest) : null;

  const tamperFindings = [];
  if (!unsupported && signatureValid && !digestValid) {
    tamperFindings.push("The covered bytes changed after signing: the recorded SHA-256 no longer matches the document.");
  }
  if (!unsupported && !signatureValid) {
    tamperFindings.push("The CMS signature does not verify against the signer certificate (signature or certificate altered).");
  }
  if (auditTrailPresent && !coveredMatches) {
    tamperFindings.push("The audit trail's recorded /Covered range does not match the signature's /ByteRange.");
  }

  let verdict;
  let detail;
  if (unsupported) {
    verdict = "unsupported";
    detail = "This signature uses a non-RSA key. This offline tool verifies RSA signatures only, so its cryptographic validity was not checked here.";
  } else if (signatureValid && integrity) {
    verdict = coversWholeDocument ? "valid" : "valid-partial";
    detail = coversWholeDocument
      ? "Signature cryptographically valid; the document is unchanged since it was signed."
      : "Signature cryptographically valid for the revision it covers, but bytes were appended after it (a later incremental update or an added signature).";
  } else if (signatureValid && !integrity) {
    verdict = "modified";
    detail = "The document has been MODIFIED after this signature was applied: the signed message digest no longer matches the document bytes.";
  } else {
    verdict = "invalid";
    detail = "Signature invalid: the CMS signature does not verify against the signer certificate's public key (the signature or certificate was altered).";
  }

  return {
    subjectCommonName: certCommonName(signerCert, "subject"),
    signerCN: certCommonName(signerCert, "subject"),
    issuerCommonName: certCommonName(signerCert, "issuer"),
    serialHex: certSerialHex(signerCert),
    notBefore: signerCert.notBefore.value,
    notAfter: signerCert.notAfter.value,
    selfSigned: signerCert.issuer.isEqual(signerCert.subject),
    signingTime,
    hashName,
    integrity,
    digestValid,
    signatureValid,
    coversWholeDocument,
    coversWholeDoc: coversWholeDocument,
    byteRange: range,
    byteRangeValid,
    contentsBytes: contentsBytes.length,
    recordedSha256: recordedDigest ? hexOf(recordedDigest) : null,
    computedSha256: computedDigest ? hexOf(computedDigest) : null,
    auditTrailPresent,
    auditHashMatches,
    auditTrail: auditTrailPresent ? audit : null,
    tamperFindings,
    identityCaveat: IDENTITY_CAVEAT,
    timestamp,
    verdict,
    detail,
  };
}

class UnsupportedKeyError extends Error {}

async function verifySignature(cert, hashName, signature, data) {
  const alg = cert.subjectPublicKeyInfo.algorithm.algorithmId;
  if (alg !== OID.rsaEncryption) {
    // Only RSA is verified offline here (matching what this tool signs).
    throw new UnsupportedKeyError("non-RSA signer key");
  }
  const spki = cert.subjectPublicKeyInfo.toSchema().toBER();
  const key = await webcrypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: hashName }, false, ["verify"]);
  return webcrypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bufOf(signature), bufOf(data));
}

function decodePdfText(bytes) {
  const view = toBytes(bytes);
  if (view.length >= 2 && view[0] === 0xfe && view[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < view.length; i += 2) out += String.fromCharCode((view[i] << 8) | view[i + 1]);
    return out;
  }
  let out = "";
  for (let i = 0; i < view.length; i++) out += String.fromCharCode(view[i]);
  return out;
}
