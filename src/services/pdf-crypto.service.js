// PDF standard security handler (ISO 32000-1 §7.6, plus the PDF 2.0 / Adobe
// Extension Level 3 revision 6 AES-256 handler). Implemented here rather than
// pulled from a dependency so the whole thing stays local and auditable.
//
// Primitives: MD5 and RC4 are written out below (WebCrypto has no MD5, and RC4
// is a handful of lines). SHA-256/384/512 and AES-CBC come from WebCrypto via
// `globalThis.crypto.subtle`, which exists both in browsers and in modern Node,
// so this file runs unchanged in both.
//
// The crypt layer works at the PDF object level: the file is parsed into
// indirect objects, every string and stream is decrypted or encrypted with its
// own object key, and the file is written back out with a classic cross-
// reference table. Object streams are unpacked so nothing stays hidden inside a
// compressed container, and cross-reference streams are dropped in favour of the
// table we write ourselves.
import { decompressSync } from "fflate";

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

const EMPTY = new Uint8Array(0);
const ZERO_IV = new Uint8Array(16);

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("Expected PDF bytes.");
}

async function readFileBytes(source) {
  if (source && typeof source.arrayBuffer === "function") return new Uint8Array(await source.arrayBuffer());
  return toBytes(source);
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

function int32le(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, value | 0, true);
  return out;
}

function randomBytes(length) {
  const out = new Uint8Array(length);
  const source = globalThis.crypto;
  if (!source?.getRandomValues) throw new Error("This environment has no secure random source, which PDF encryption needs.");
  source.getRandomValues(out);
  return out;
}

function hexOf(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

// ---------------------------------------------------------------------------
// MD5 (RFC 1321). WebCrypto deliberately does not offer it, and the pre-AES
// revisions of the security handler are built entirely on it.
// ---------------------------------------------------------------------------

const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// K[i] = floor(abs(sin(i + 1)) * 2^32), derived rather than transcribed so a
// typo cannot silently produce a wrong-but-plausible digest.
const MD5_SINES = Int32Array.from({ length: 64 }, (_unused, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 4294967296));

export function md5(input) {
  const message = toBytes(input);
  const bitLength = message.length * 8;
  const padded = new Uint8Array(((message.length + 8) >> 6) * 64 + 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLength >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 4294967296), true);

  let a0 = 0x67452301 | 0;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476 | 0;
  const words = new Int32Array(16);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getInt32(offset + i * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (f + a + MD5_SINES[i] + words[g]) | 0;
      const shift = MD5_SHIFTS[i];
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const digest = new Uint8Array(16);
  const digestView = new DataView(digest.buffer);
  digestView.setInt32(0, a0, true);
  digestView.setInt32(4, b0, true);
  digestView.setInt32(8, c0, true);
  digestView.setInt32(12, d0, true);
  return digest;
}

// ---------------------------------------------------------------------------
// RC4. Broken by modern standards; only ever used to READ legacy files and, if
// the caller explicitly asks for it, to write a clearly-labelled legacy file.
// ---------------------------------------------------------------------------

export function rc4(key, data) {
  const keyBytes = toBytes(key);
  const input = toBytes(data);
  if (!keyBytes.length) throw new Error("RC4 needs a non-empty key.");
  const state = new Uint8Array(256);
  for (let i = 0; i < 256; i++) state[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i] + keyBytes[i % keyBytes.length]) & 0xff;
    const swap = state[i];
    state[i] = state[j];
    state[j] = swap;
  }
  const out = new Uint8Array(input.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i < input.length; i++) {
    x = (x + 1) & 0xff;
    y = (y + state[x]) & 0xff;
    const swap = state[x];
    state[x] = state[y];
    state[y] = swap;
    out[i] = input[i] ^ state[(state[x] + state[y]) & 0xff];
  }
  return out;
}

// ---------------------------------------------------------------------------
// WebCrypto: SHA-2 and AES-CBC
// ---------------------------------------------------------------------------

function subtle() {
  const source = globalThis.crypto;
  if (!source?.subtle) throw new Error("This environment has no WebCrypto (crypto.subtle), which PDF encryption needs.");
  return source.subtle;
}

async function sha(bits, data) {
  return new Uint8Array(await subtle().digest(`SHA-${bits}`, toBytes(data)));
}

async function aesKey(rawKey) {
  return subtle().importKey("raw", toBytes(rawKey), "AES-CBC", false, ["encrypt", "decrypt"]);
}

// WebCrypto's AES-CBC always appends a PKCS#7 block on encrypt. Several places
// in the security handler need raw, unpadded CBC (the revision 6 hash, the
// AES-256 key wrap, the /Perms block), so we let WebCrypto add its block and
// then drop it. `data.length` must be a multiple of 16.
async function aesCbcEncryptNoPad(rawKey, iv, data) {
  const input = toBytes(data);
  if (input.length % 16 !== 0) throw new Error("Unpadded AES-CBC needs a whole number of blocks.");
  const cipher = new Uint8Array(await subtle().encrypt({ name: "AES-CBC", iv: toBytes(iv) }, await aesKey(rawKey), input));
  return cipher.subarray(0, input.length);
}

// AES-ECB on one block == AES-CBC with an all-zero IV, keeping only the first
// output block. WebCrypto exposes no ECB mode, and revision 5/6 needs it.
async function aesEcbEncryptBlock(rawKey, block) {
  return aesCbcEncryptNoPad(rawKey, ZERO_IV, toBytes(block).subarray(0, 16));
}

// Unpadded AES-CBC decryption. WebCrypto insists on validating (and stripping)
// PKCS#7 padding, so we append one synthetic block chosen to decrypt to a full,
// valid padding block: WebCrypto strips exactly that block and hands back the
// bytes we actually asked about. Requires only the AES-CBC primitive.
async function aesCbcDecryptNoPad(rawKey, iv, data) {
  const input = toBytes(data);
  if (!input.length) return EMPTY;
  if (input.length % 16 !== 0) throw new Error("Unpadded AES-CBC needs a whole number of blocks.");
  const lastBlock = input.subarray(input.length - 16);
  const target = new Uint8Array(16);
  for (let i = 0; i < 16; i++) target[i] = lastBlock[i] ^ 16;
  const synthetic = await aesEcbEncryptBlock(rawKey, target);
  const extended = new Uint8Array(input.length + 16);
  extended.set(input);
  extended.set(synthetic, input.length);
  const plain = new Uint8Array(await subtle().decrypt({ name: "AES-CBC", iv: toBytes(iv) }, await aesKey(rawKey), extended));
  return plain.subarray(0, input.length);
}

// Stream/string payload form: a 16-byte random IV followed by PKCS#7-padded
// CBC ciphertext (ISO 32000-1 §7.6.2).
async function aesEncryptPayload(rawKey, data) {
  const input = toBytes(data);
  const iv = randomBytes(16);
  const padLength = 16 - (input.length % 16);
  const padded = new Uint8Array(input.length + padLength);
  padded.set(input);
  padded.fill(padLength, input.length);
  const body = await aesCbcEncryptNoPad(rawKey, iv, padded);
  return concatBytes([iv, body]);
}

async function aesDecryptPayload(rawKey, data) {
  const input = toBytes(data);
  if (input.length <= 16) return EMPTY;
  const iv = input.subarray(0, 16);
  const body = input.subarray(16);
  const usable = body.length - (body.length % 16);
  if (!usable) return EMPTY;
  const plain = await aesCbcDecryptNoPad(rawKey, iv, body.subarray(0, usable));
  const padByte = plain[plain.length - 1];
  // Strip padding leniently: a producer that pads badly should still yield a
  // readable stream rather than a hard failure.
  if (padByte >= 1 && padByte <= 16 && padByte <= plain.length) return plain.subarray(0, plain.length - padByte);
  return plain;
}

// ---------------------------------------------------------------------------
// Permissions (/P). Bits are numbered from 1 in the spec; bit N has value
// 2^(N-1). Bits 1-2 are always clear, every other reserved bit is always set.
// ---------------------------------------------------------------------------

export const PDF_PERMISSION_BITS = {
  print: 3,
  modify: 4,
  copy: 5,
  annotate: 6,
  fillForms: 9,
  accessibility: 10,
  assemble: 11,
  printHighQuality: 12,
};

export const PDF_PERMISSION_LABELS = {
  print: "Print the document",
  modify: "Change the document",
  copy: "Copy text and graphics",
  annotate: "Add or change annotations",
  fillForms: "Fill in form fields",
  accessibility: "Extract text for accessibility",
  assemble: "Assemble the document (insert, rotate, delete pages)",
  printHighQuality: "Print at high quality",
};

export const ALL_PERMISSIONS_ALLOWED = Object.freeze(
  Object.fromEntries(Object.keys(PDF_PERMISSION_BITS).map((key) => [key, true]))
);

const PERMISSION_BASE = -1 & ~1 & ~2; // every reserved bit set, bits 1-2 clear

export function permissionsToP(allowed = {}) {
  let value = PERMISSION_BASE;
  for (const [name, bit] of Object.entries(PDF_PERMISSION_BITS)) {
    if (allowed[name] === false) value &= ~(1 << (bit - 1));
  }
  return value | 0;
}

export function pToPermissions(value) {
  const p = Number(value) | 0;
  const out = {};
  for (const [name, bit] of Object.entries(PDF_PERMISSION_BITS)) {
    out[name] = (p & (1 << (bit - 1))) !== 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Standard security handler
// ---------------------------------------------------------------------------

// ISO 32000-1 Table 21: the 32-byte password padding string.
export const PDF_PAD_STRING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56,
  0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

// Private copy, so a caller poking at the exported constant cannot change how
// passwords are padded.
const PAD = new Uint8Array(PDF_PAD_STRING);

const WRONG_PASSWORD = "That password does not open this PDF. Check it and try again.";

// Algorithm 2 step (a): pad or truncate the password to exactly 32 bytes.
function padPassword(password) {
  const bytes = latin1Bytes(password);
  const out = new Uint8Array(32);
  const used = Math.min(bytes.length, 32);
  out.set(bytes.subarray(0, used));
  out.set(PAD.subarray(0, 32 - used), used);
  return out;
}

function xorEachByte(bytes, value) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ value;
  return out;
}

// Algorithm 2: file encryption key from the (already padded) user password.
function legacyFileKey(paddedPassword, params) {
  const parts = [paddedPassword, toBytes(params.o).subarray(0, 32), int32le(params.p), toBytes(params.idFirst)];
  if (params.r >= 4 && !params.encryptMetadata) parts.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
  let digest = md5(concatBytes(parts));
  const keyLength = params.r === 2 ? 5 : params.keyLength;
  if (params.r >= 3) {
    for (let i = 0; i < 50; i++) digest = md5(digest.subarray(0, keyLength));
  }
  return digest.subarray(0, keyLength);
}

// Algorithms 4 and 5: the /U value for a given file key.
function legacyUserValue(fileKey, idFirst, r) {
  if (r === 2) return rc4(fileKey, PAD);
  let value = md5(concatBytes([PAD, toBytes(idFirst)]));
  value = rc4(fileKey, value);
  for (let i = 1; i <= 19; i++) value = rc4(xorEachByte(fileKey, i), value);
  const out = new Uint8Array(32);
  out.set(value.subarray(0, 16));
  // Spec: "the remaining 16 bytes ... are arbitrary padding". Reuse the padding
  // string so the same inputs always produce the same file.
  out.set(PAD.subarray(0, 16), 16);
  return out;
}

// Algorithm 3 steps (a)-(d): the RC4 key derived from an owner password.
function legacyOwnerKey(password, r, keyLength) {
  let digest = md5(padPassword(password));
  const used = r === 2 ? 5 : keyLength;
  if (r >= 3) {
    for (let i = 0; i < 50; i++) digest = md5(digest);
  }
  return digest.subarray(0, used);
}

// Algorithm 3: the /O value.
function legacyOwnerValue(ownerPassword, userPassword, r, keyLength) {
  const key = legacyOwnerKey(ownerPassword || userPassword, r, keyLength);
  let value = rc4(key, padPassword(userPassword));
  if (r >= 3) {
    for (let i = 1; i <= 19; i++) value = rc4(xorEachByte(key, i), value);
  }
  return value;
}

// Algorithm 7 steps (a)-(b): recover the padded user password from /O.
function legacyRecoverUserPassword(ownerPassword, o, r, keyLength) {
  const key = legacyOwnerKey(ownerPassword, r, keyLength);
  let value = toBytes(o).subarray(0, 32);
  if (r === 2) return rc4(key, value);
  for (let i = 19; i >= 0; i--) value = rc4(xorEachByte(key, i), value);
  return value;
}

// Algorithm 6: does this file key reproduce the stored /U?
function legacyUserValueMatches(fileKey, params) {
  const computed = legacyUserValue(fileKey, params.idFirst, params.r);
  const stored = toBytes(params.u);
  const compare = params.r === 2 ? 32 : 16;
  if (stored.length < compare) return false;
  return bytesEqual(computed.subarray(0, compare), stored.subarray(0, compare));
}

// Algorithms 6 and 7 together: try the password as the user password, then as
// the owner password. Returns the file key, or null. Callers must not reveal
// which of the two matched.
function authenticateLegacy(password, params) {
  const asUser = legacyFileKey(padPassword(password), params);
  if (legacyUserValueMatches(asUser, params)) return asUser;
  const recovered = legacyRecoverUserPassword(password, params.o, params.r, params.r === 2 ? 5 : params.keyLength);
  const asOwner = legacyFileKey(recovered, params);
  if (legacyUserValueMatches(asOwner, params)) return asOwner;
  return null;
}

// Revision 5/6 passwords are UTF-8 (SASLprep in the spec; we do not normalise,
// which only matters for passwords containing exotic Unicode) capped at 127 bytes.
function unicodePassword(password) {
  const bytes = new TextEncoder().encode(String(password ?? ""));
  return bytes.length > 127 ? bytes.subarray(0, 127) : bytes;
}

// Algorithm 2.B: the revision 6 hardened hash. Revision 5 stops at the first
// SHA-256.
async function hardenedHash(passwordBytes, salt, userBytes, r) {
  let k = (await sha(256, concatBytes([passwordBytes, salt, userBytes]))).subarray(0, 32);
  if (r === 5) return k;
  let e = new Uint8Array([0]);
  let round = 0;
  while (round < 64 || e[e.length - 1] > round - 32) {
    const combined = concatBytes([passwordBytes, k, userBytes]);
    const k1 = new Uint8Array(combined.length * 64);
    for (let i = 0; i < 64; i++) k1.set(combined, i * combined.length);
    e = await aesCbcEncryptNoPad(k.subarray(0, 16), k.subarray(16, 32), k1);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i];
    const remainder = sum % 3;
    k = remainder === 0 ? await sha(256, e) : remainder === 1 ? await sha(384, e) : await sha(512, e);
    round++;
  }
  return k.subarray(0, 32);
}

// Algorithms 2.A / 8 / 9 in reverse: unwrap the file key with /UE or /OE.
async function authenticateAesV3(password, params) {
  const passwordBytes = unicodePassword(password);
  const u = toBytes(params.u);
  const o = toBytes(params.o);
  if (u.length < 48) throw new Error("This PDF's /U value is too short for its AES-256 security handler.");

  const userHash = await hardenedHash(passwordBytes, u.subarray(32, 40), EMPTY, params.r);
  if (bytesEqual(userHash, u.subarray(0, 32))) {
    const intermediate = await hardenedHash(passwordBytes, u.subarray(40, 48), EMPTY, params.r);
    return aesCbcDecryptNoPad(intermediate, ZERO_IV, toBytes(params.ue).subarray(0, 32));
  }

  if (o.length >= 48 && toBytes(params.oe).length >= 32) {
    const userValue = u.subarray(0, 48);
    const ownerHash = await hardenedHash(passwordBytes, o.subarray(32, 40), userValue, params.r);
    if (bytesEqual(ownerHash, o.subarray(0, 32))) {
      const intermediate = await hardenedHash(passwordBytes, o.subarray(40, 48), userValue, params.r);
      return aesCbcDecryptNoPad(intermediate, ZERO_IV, toBytes(params.oe).subarray(0, 32));
    }
  }
  return null;
}

// Algorithm 10: the /Perms check block. The 16 bytes are laid out exactly as the
// spec numbers them, so the offsets below can be read straight against it:
//   0-7   /P widened to 64 bits, low byte first (upper 32 bits all ones)
//   8     'T' or 'F' for /EncryptMetadata
//   9-11  'a', 'd', 'b'
//   12-15 random
// The block is then AES-256-encrypted in ECB mode with the file key.
async function computePerms(fileKey, p, encryptMetadata) {
  const block = new Uint8Array(16);
  block.set(int32le(p), 0);
  block.fill(0xff, 4, 8);
  block[8] = encryptMetadata ? 0x54 : 0x46;
  block[9] = 0x61;
  block[10] = 0x64;
  block[11] = 0x62;
  block.set(randomBytes(4), 12);
  return aesEcbEncryptBlock(fileKey, block);
}

// Algorithm 1: the per-object key. AESV3 uses the file key directly.
function objectKey(fileKey, num, gen, cfm) {
  if (cfm === "AESV3") return fileKey;
  const salt = cfm === "AESV2" ? [0x73, 0x41, 0x6c, 0x54] : []; // "sAlT"
  const input = new Uint8Array(fileKey.length + 5 + salt.length);
  input.set(fileKey);
  input[fileKey.length] = num & 0xff;
  input[fileKey.length + 1] = (num >> 8) & 0xff;
  input[fileKey.length + 2] = (num >> 16) & 0xff;
  input[fileKey.length + 3] = gen & 0xff;
  input[fileKey.length + 4] = (gen >> 8) & 0xff;
  if (salt.length) input.set(salt, fileKey.length + 5);
  return md5(input).subarray(0, Math.min(fileKey.length + 5, 16));
}

async function applyCrypt(mode, cfm, fileKey, num, gen, data) {
  const key = objectKey(fileKey, num, gen, cfm);
  if (cfm === "V2" || cfm === "RC4") return rc4(key, data);
  if (mode === "encrypt") return aesEncryptPayload(key, data);
  return aesDecryptPayload(key, data);
}

// ---------------------------------------------------------------------------
// PDF object model. Deliberately minimal: enough to read every object, rewrite
// its strings and streams, and write it back.
// ---------------------------------------------------------------------------

const NULL_OBJECT = { k: "null" };
const name = (value) => ({ k: "name", v: value });
const num = (value) => ({ k: "num", v: value });
const dict = (entries = []) => ({ k: "dict", v: new Map(entries) });
const hexString = (bytes) => ({ k: "str", v: toBytes(bytes), hex: true });

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
      if (isWhitespaceByte(byte)) {
        this.pos++;
        continue;
      }
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
    this.pos++; // '/'
    const raw = this.readRegularRun();
    let out = "";
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === 0x23 && i + 2 < raw.length) {
        const code = parseInt(String.fromCharCode(raw[i + 1], raw[i + 2]), 16);
        if (Number.isFinite(code)) {
          out += String.fromCharCode(code);
          i += 2;
          continue;
        }
      }
      out += String.fromCharCode(raw[i]);
    }
    return name(out);
  }

  readLiteralString() {
    this.pos++; // '('
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
        else if (next === 10) { /* line continuation */ }
        else if (next === 13) {
          if (this.b[this.pos] === 10) this.pos++;
        } else if (next >= 0x30 && next <= 0x37) {
          let value = next - 0x30;
          for (let i = 0; i < 2; i++) {
            const digit = this.b[this.pos];
            if (digit >= 0x30 && digit <= 0x37) {
              value = value * 8 + (digit - 0x30);
              this.pos++;
            } else break;
          }
          out.push(value & 0xff);
        } else out.push(next);
        continue;
      }
      if (byte === 0x28) {
        depth++;
        out.push(byte);
        continue;
      }
      if (byte === 0x29) {
        depth--;
        if (!depth) return { k: "str", v: new Uint8Array(out), hex: false };
        out.push(byte);
        continue;
      }
      if (byte === 13) {
        // An end-of-line marker inside a literal string means a single \n.
        if (this.b[this.pos] === 10) this.pos++;
        out.push(10);
        continue;
      }
      out.push(byte);
    }
    throw new Error("This PDF has an unterminated string.");
  }

  readHexString() {
    this.pos++; // '<'
    let digits = "";
    while (this.pos < this.b.length && this.b[this.pos] !== 0x3e) {
      const char = String.fromCharCode(this.b[this.pos++]);
      if (/[0-9a-fA-F]/.test(char)) digits += char;
    }
    this.pos++; // '>'
    if (digits.length % 2) digits += "0";
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16);
    return { k: "str", v: out, hex: true };
  }

  readArray() {
    this.pos++; // '['
    const items = [];
    for (;;) {
      this.skipWhitespace();
      if (this.pos >= this.b.length) throw new Error("This PDF has an unterminated array.");
      if (this.b[this.pos] === 0x5d) {
        this.pos++;
        return { k: "array", v: items };
      }
      items.push(this.readObject());
    }
  }

  readDict() {
    this.pos += 2; // '<<'
    const entries = new Map();
    for (;;) {
      this.skipWhitespace();
      if (this.pos >= this.b.length) throw new Error("This PDF has an unterminated dictionary.");
      if (this.b[this.pos] === 0x3e && this.b[this.pos + 1] === 0x3e) {
        this.pos += 2;
        break;
      }
      if (this.b[this.pos] !== 0x2f) {
        // Junk where a key should be: skip one object and keep going rather than
        // abandoning the whole file.
        this.readObject();
        continue;
      }
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
    if (end > dataStart && this.b[end - 1] === 10) {
      end--;
      if (end > dataStart && this.b[end - 1] === 13) end--;
    } else if (end > dataStart && this.b[end - 1] === 13) {
      end--;
    }
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
    if (this.b[this.pos] !== 0x52) return null; // 'R'
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
    if (byte === 0x3c) {
      if (this.b[this.pos + 1] === 0x3c) return this.readDict();
      return this.readHexString();
    }
    if (isDigitByte(byte) || byte === 0x2b || byte === 0x2d || byte === 0x2e) return this.readNumberOrRef();
    const word = String.fromCharCode(...this.readRegularRun());
    if (word === "true") return { k: "bool", v: true };
    if (word === "false") return { k: "bool", v: false };
    if (word === "null") return NULL_OBJECT;
    if (!word) {
      this.pos++;
      return NULL_OBJECT;
    }
    throw new Error(`This PDF contains an unexpected token ("${word.slice(0, 24)}").`);
  }
}

// ---------------------------------------------------------------------------
// Parsing a whole file
// ---------------------------------------------------------------------------

function findObjectHeader(bytes, from) {
  for (let i = from; i + 2 < bytes.length; i++) {
    if (bytes[i] !== 0x6f || bytes[i + 1] !== 0x62 || bytes[i + 2] !== 0x6a) continue; // "obj"
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

// The file is scanned front-to-back for `N G obj` headers rather than driven by
// the cross-reference table, which makes classic tables, cross-reference
// streams, and lightly damaged files all behave the same. Parsing a stream
// consumes it up to `endstream`, so stream bytes are never mistaken for objects.
// A later definition of an object number wins, which matches how incremental
// updates are meant to be read.
function scanIndirectObjects(bytes) {
  const objects = new Map();
  const streams = [];
  let position = 0;
  while (position < bytes.length) {
    const header = findObjectHeader(bytes, position);
    if (!header) break;
    const lexer = new Lexer(bytes, header.bodyStart);
    let object;
    try {
      object = lexer.readObject();
    } catch {
      position = header.bodyStart + 1;
      continue;
    }
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

function numberValue(object, fallback = null) {
  return object?.k === "num" ? object.v : fallback;
}

function nameValue(object) {
  return object?.k === "name" ? object.v : null;
}

// /Length is frequently an indirect reference, so it can only be trusted once
// every object is parsed. Where it validates it wins over the `endstream`
// search, which is the only option for files whose /Length is wrong.
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
  const lexer = new Lexer(bytes, index + KEYWORD_STARTXREF.length);
  try {
    const value = lexer.readObject();
    return numberValue(value);
  } catch {
    return null;
  }
}

// Only the trailer dictionary is needed, never the cross-reference data itself,
// so a classic section is skipped by jumping to its `trailer` keyword and a
// cross-reference stream contributes its own dictionary.
function readTrailerAt(doc, bytes, offset) {
  const lexer = new Lexer(bytes, offset);
  lexer.skipWhitespace();
  if (matchesSequence(bytes, KEYWORD_XREF, lexer.pos)) {
    const trailerIndex = indexOfSequence(bytes, KEYWORD_TRAILER, lexer.pos);
    if (trailerIndex < 0) return null;
    const trailerLexer = new Lexer(bytes, trailerIndex + KEYWORD_TRAILER.length);
    try {
      const value = trailerLexer.readObject();
      return value.k === "dict" ? value.v : null;
    } catch {
      return null;
    }
  }
  const header = findObjectHeader(bytes, Math.max(0, offset - 1));
  if (!header || header.bodyStart > offset + 64) return null;
  const entry = doc.objects.get(header.num);
  const object = entry?.obj;
  if (object?.k === "stream") return object.dict.v;
  if (object?.k === "dict") return object.v;
  return null;
}

function findTrailer(doc, bytes) {
  const merged = new Map();
  const absorb = (source) => {
    if (!source) return;
    for (const [key, value] of source) {
      if (!merged.has(key)) merged.set(key, value);
    }
  };

  const seen = new Set();
  let offset = readStartXref(bytes);
  while (Number.isInteger(offset) && offset >= 0 && offset < bytes.length && !seen.has(offset)) {
    seen.add(offset);
    const section = readTrailerAt(doc, bytes, offset);
    if (!section) break;
    absorb(section);
    const hybrid = section.get("XRefStm");
    if (hybrid?.k === "num" && !seen.has(hybrid.v)) {
      seen.add(hybrid.v);
      absorb(readTrailerAt(doc, bytes, hybrid.v));
    }
    const prev = section.get("Prev");
    offset = prev?.k === "num" ? prev.v : null;
  }

  if (!merged.has("Root")) {
    // Fall back to every `trailer` keyword in the file, latest first.
    const offsets = [];
    for (let at = 0; ; ) {
      const found = indexOfSequence(bytes, KEYWORD_TRAILER, at);
      if (found < 0) break;
      offsets.push(found);
      at = found + KEYWORD_TRAILER.length;
    }
    for (const found of offsets.reverse()) {
      try {
        const value = new Lexer(bytes, found + KEYWORD_TRAILER.length).readObject();
        if (value.k === "dict") absorb(value.v);
      } catch {
        // Ignore an unreadable trailer and try the next one.
      }
    }
  }

  if (!merged.has("Root")) {
    for (const entry of doc.objects.values()) {
      if (entry.obj.k === "stream" && nameValue(dictGet(doc, entry.obj, "Type")) === "XRef") absorb(entry.obj.dict.v);
    }
  }

  if (!merged.has("Root")) {
    for (const entry of doc.objects.values()) {
      if (nameValue(dictGet(doc, entry.obj, "Type")) === "Catalog") {
        merged.set("Root", { k: "ref", num: entry.num, gen: entry.gen });
        break;
      }
    }
  }

  return merged;
}

function readHeader(bytes) {
  const limit = Math.min(bytes.length, 1024);
  const index = indexOfSequence(bytes.subarray(0, limit), latin1Bytes("%PDF-"), 0);
  if (index < 0) throw new Error("That file does not look like a PDF (no %PDF- header).");
  let end = index;
  while (end < bytes.length && bytes[end] !== 10 && bytes[end] !== 13) end++;
  return String.fromCharCode(...bytes.subarray(index, Math.min(end, index + 16)));
}

function parsePdf(bytes) {
  const header = readHeader(bytes);
  const { objects, streams } = scanIndirectObjects(bytes);
  const doc = { header, objects, streams, trailer: new Map() };
  applyStreamLengths(doc, bytes);
  doc.trailer = findTrailer(doc, bytes);
  if (!doc.objects.size) throw new Error("No PDF objects could be read from that file.");
  // Without a catalog there is nothing to write back out, and emitting a
  // rootless file would look like success while producing an unopenable PDF.
  if (!doc.trailer.has("Root")) throw new Error("This PDF has no readable document catalog (/Root). Try the Repair PDF tool first.");
  return doc;
}

// ---------------------------------------------------------------------------
// Stream decoding (only what object streams need)
// ---------------------------------------------------------------------------

function undoPredictor(data, predictor, colors, bitsPerComponent, columns) {
  if (predictor <= 1) return data;
  const bpp = Math.max(1, Math.ceil((colors * bitsPerComponent) / 8));
  const rowLength = Math.ceil((colors * bitsPerComponent * columns) / 8);
  if (predictor === 2) {
    if (bitsPerComponent !== 8) throw new Error("This PDF uses a TIFF predictor this tool does not support.");
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
        const dLeft = Math.abs(p - left);
        const dUp = Math.abs(p - up);
        const dUpLeft = Math.abs(p - upLeft);
        const predicted = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
        current[i] = (current[i] + predicted) & 0xff;
      }
    }
    out.set(current, row * rowLength);
    previous = current;
  }
  return out;
}

function filterNames(doc, stream) {
  const filter = dictGet(doc, stream, "Filter");
  if (filter.k === "name") return [filter.v];
  if (filter.k === "array") return filter.v.map((item) => nameValue(resolve(doc, item))).filter(Boolean);
  return [];
}

function decodeParmsAt(doc, stream, index) {
  let parms = dictGet(doc, stream, "DecodeParms");
  if (parms.k === "null") parms = dictGet(doc, stream, "DP");
  if (parms.k === "array") parms = resolve(doc, parms.v[index]);
  return parms.k === "dict" ? parms : dict();
}

function decodeStream(doc, stream) {
  let data = stream.raw;
  const filters = filterNames(doc, stream);
  filters.forEach((filterName, index) => {
    if (filterName === "FlateDecode" || filterName === "Fl") {
      try {
        data = decompressSync(data);
      } catch (error) {
        throw new Error(`This PDF has a stream that could not be decompressed (${error?.message || "inflate failed"}).`);
      }
    } else if (filterName === "Crypt") {
      return;
    } else {
      throw new Error(`This PDF uses the ${filterName} stream filter, which this tool cannot decode.`);
    }
    const parms = decodeParmsAt(doc, stream, index);
    const predictor = numberValue(dictGet(doc, parms, "Predictor"), 1);
    if (predictor > 1) {
      data = undoPredictor(
        data,
        predictor,
        numberValue(dictGet(doc, parms, "Colors"), 1),
        numberValue(dictGet(doc, parms, "BitsPerComponent"), 8),
        numberValue(dictGet(doc, parms, "Columns"), 1)
      );
    }
  });
  return data;
}

// Object streams hide ordinary objects inside a compressed container. Unpacking
// them turns every object into a plain indirect object, which is what lets this
// tool write a classic cross-reference table and drop the cross-reference
// stream entirely.
function unpackObjectStreams(doc) {
  for (const entry of [...doc.objects.values()]) {
    const object = entry.obj;
    if (object.k !== "stream") continue;
    if (nameValue(dictGet(doc, object, "Type")) !== "ObjStm") continue;
    const count = numberValue(dictGet(doc, object, "N"), 0);
    const first = numberValue(dictGet(doc, object, "First"), 0);
    const data = decodeStream(doc, object);
    const headerLexer = new Lexer(data, 0);
    const pairs = [];
    for (let i = 0; i < count; i++) {
      const objectNumber = numberValue(headerLexer.readObject());
      const offset = numberValue(headerLexer.readObject());
      if (objectNumber === null || offset === null) throw new Error("This PDF has a damaged object stream.");
      pairs.push([objectNumber, offset]);
    }
    for (const [objectNumber, offset] of pairs) {
      // A top-level definition of the same number is newer, so keep it.
      if (doc.objects.has(objectNumber)) continue;
      const inner = new Lexer(data, first + offset).readObject();
      doc.objects.set(objectNumber, { num: objectNumber, gen: 0, obj: inner });
    }
    doc.objects.delete(entry.num);
  }
}

// ---------------------------------------------------------------------------
// Walking and rewriting objects
// ---------------------------------------------------------------------------

function walkStrings(object, visit) {
  if (!object) return;
  if (object.k === "str") {
    visit(object);
    return;
  }
  if (object.k === "array") {
    object.v.forEach((item) => walkStrings(item, visit));
    return;
  }
  if (object.k === "dict") {
    object.v.forEach((value) => walkStrings(value, visit));
    return;
  }
  if (object.k === "stream") walkStrings(object.dict, visit);
}

// ---------------------------------------------------------------------------
// Writing a file back out
// ---------------------------------------------------------------------------

function encodeName(value) {
  let out = "/";
  for (const char of String(value)) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code >= 0x7f || isDelimiterByte(code) || char === "#") {
      out += `#${code.toString(16).padStart(2, "0")}`;
    } else {
      out += char;
    }
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

// Objects serialise to a mix of ASCII chunks and raw byte runs (stream bodies),
// collected in order and joined once at the end.
function encodeObject(object, chunks) {
  if (!object || object.k === "null") {
    chunks.push(latin1Bytes("null"));
    return;
  }
  if (object.k === "bool") {
    chunks.push(latin1Bytes(object.v ? "true" : "false"));
    return;
  }
  if (object.k === "num") {
    chunks.push(latin1Bytes(encodeNumber(object)));
    return;
  }
  if (object.k === "name") {
    chunks.push(latin1Bytes(encodeName(object.v)));
    return;
  }
  if (object.k === "str") {
    chunks.push(latin1Bytes(encodeString(object)));
    return;
  }
  if (object.k === "ref") {
    chunks.push(latin1Bytes(`${object.num} ${object.gen} R`));
    return;
  }
  if (object.k === "array") {
    chunks.push(latin1Bytes("["));
    object.v.forEach((item, index) => {
      if (index) chunks.push(latin1Bytes(" "));
      encodeObject(item, chunks);
    });
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
    object.dict.v.set("Length", num(object.raw.length));
    encodeObject(object.dict, chunks);
    chunks.push(latin1Bytes("\nstream\n"));
    chunks.push(object.raw);
    chunks.push(latin1Bytes("\nendstream"));
    return;
  }
  throw new Error("Cannot write an unknown PDF object.");
}

function serializePdf(doc) {
  const chunks = [];
  let length = 0;
  const push = (bytes) => {
    chunks.push(bytes);
    length += bytes.length;
  };

  const header = /^%PDF-\d\.\d/.test(doc.header) ? doc.header : "%PDF-1.7";
  push(latin1Bytes(`${header}\n`));
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const entries = [...doc.objects.values()].sort((a, b) => a.num - b.num);
  const offsets = new Map();
  for (const entry of entries) {
    offsets.set(entry.num, length);
    push(latin1Bytes(`${entry.num} ${entry.gen} obj\n`));
    const body = [];
    encodeObject(entry.obj, body);
    body.forEach(push);
    push(latin1Bytes("\nendobj\n"));
  }

  const xrefOffset = length;
  const lines = ["xref\n"];
  // Cross-reference subsections: object 0 is the free-list head, then one
  // subsection per contiguous run of the numbers we actually wrote.
  let runStart = 0;
  let run = ["0000000000 65535 f \n"];
  const flush = () => {
    lines.push(`${runStart} ${run.length}\n`);
    lines.push(...run);
  };
  let expected = 1;
  for (const entry of entries) {
    if (entry.num !== expected) {
      flush();
      runStart = entry.num;
      run = [];
    }
    run.push(`${String(offsets.get(entry.num)).padStart(10, "0")} ${String(entry.gen).padStart(5, "0")} n \n`);
    expected = entry.num + 1;
  }
  flush();
  push(latin1Bytes(lines.join("")));

  const trailerChunks = [];
  encodeObject({ k: "dict", v: doc.trailer }, trailerChunks);
  push(latin1Bytes("trailer\n"));
  trailerChunks.forEach(push);
  push(latin1Bytes(`\nstartxref\n${xrefOffset}\n%%EOF\n`));
  return concatBytes(chunks);
}

// ---------------------------------------------------------------------------
// Reading the /Encrypt dictionary
// ---------------------------------------------------------------------------

const SUPPORTED_CFM = new Set(["V2", "AESV2", "AESV3", "None", "Identity"]);

function stringBytes(object) {
  return object?.k === "str" ? object.v : EMPTY;
}

function firstIdBytes(doc) {
  const id = resolve(doc, doc.trailer.get("ID"));
  if (id.k !== "array" || !id.v.length) return EMPTY;
  return stringBytes(resolve(doc, id.v[0]));
}

function readEncryptParams(doc) {
  const encryptEntry = doc.trailer.get("Encrypt");
  if (!encryptEntry) return null;
  const encryptDict = resolve(doc, encryptEntry);
  if (encryptDict.k !== "dict") throw new Error("This PDF has an /Encrypt entry that is not a dictionary.");

  const filter = nameValue(dictGet(doc, encryptDict, "Filter"));
  if (filter && filter !== "Standard") {
    throw new Error(`This PDF uses the ${filter} security handler. Only the standard password handler is supported.`);
  }

  const v = numberValue(dictGet(doc, encryptDict, "V"), 0);
  const r = numberValue(dictGet(doc, encryptDict, "R"), 0);
  if (![1, 2, 4, 5].includes(v)) throw new Error(`This PDF uses encryption version /V ${v}, which this tool does not support.`);
  if (![2, 3, 4, 5, 6].includes(r)) throw new Error(`This PDF uses security handler revision /R ${r}, which this tool does not support.`);

  const declaredLength = numberValue(dictGet(doc, encryptDict, "Length"), v === 1 ? 40 : 128);
  let keyLength = Math.floor(declaredLength / 8);
  const encryptMetadata = dictGet(doc, encryptDict, "EncryptMetadata").k === "bool"
    ? dictGet(doc, encryptDict, "EncryptMetadata").v
    : true;

  let streamCfm = v <= 2 ? "V2" : "Identity";
  let stringCfm = streamCfm;
  if (v >= 4) {
    const cf = dictGet(doc, encryptDict, "CF");
    const stmF = nameValue(dictGet(doc, encryptDict, "StmF")) || "Identity";
    const strF = nameValue(dictGet(doc, encryptDict, "StrF")) || "Identity";
    const readFilter = (filterName) => {
      if (filterName === "Identity") return { cfm: "Identity", length: keyLength };
      const entry = dictGet(doc, cf, filterName);
      if (entry.k !== "dict") throw new Error(`This PDF names the crypt filter /${filterName}, but does not define it.`);
      const cfm = nameValue(dictGet(doc, entry, "CFM")) || "None";
      if (!SUPPORTED_CFM.has(cfm)) throw new Error(`This PDF uses the ${cfm} crypt filter method, which this tool does not support.`);
      const entryLength = numberValue(dictGet(doc, entry, "Length"), null);
      // /Length here is bytes in most files but bits in some producers' output.
      const bytes = entryLength === null ? keyLength : entryLength > 40 ? Math.floor(entryLength / 8) : entryLength;
      return { cfm: cfm === "None" ? "Identity" : cfm, length: bytes };
    };
    const stream = readFilter(stmF);
    const string = readFilter(strF);
    streamCfm = stream.cfm;
    stringCfm = string.cfm;
    keyLength = stream.cfm === "Identity" ? string.length : stream.length;
  }
  if (v === 5) {
    streamCfm = "AESV3";
    stringCfm = "AESV3";
    keyLength = 32;
  }
  if (v === 1) keyLength = 5;
  if (keyLength < 5 || keyLength > 32) throw new Error(`This PDF declares a ${keyLength * 8}-bit encryption key, which is out of range.`);

  return {
    ref: encryptEntry.k === "ref" ? encryptEntry.num : null,
    dict: encryptDict,
    v,
    r,
    keyLength,
    encryptMetadata,
    streamCfm,
    stringCfm,
    p: numberValue(dictGet(doc, encryptDict, "P"), -1) | 0,
    o: stringBytes(dictGet(doc, encryptDict, "O")),
    u: stringBytes(dictGet(doc, encryptDict, "U")),
    oe: stringBytes(dictGet(doc, encryptDict, "OE")),
    ue: stringBytes(dictGet(doc, encryptDict, "UE")),
    idFirst: firstIdBytes(doc),
  };
}

async function authenticate(password, params) {
  const key = params.v === 5 ? await authenticateAesV3(password, params) : authenticateLegacy(password, params);
  if (!key) throw new Error(WRONG_PASSWORD);
  return key;
}

// ---------------------------------------------------------------------------
// The crypt walk
// ---------------------------------------------------------------------------

function metadataObjectNumber(doc) {
  const root = doc.trailer.get("Root");
  if (root?.k !== "ref") return null;
  const catalog = doc.objects.get(root.num)?.obj;
  if (catalog?.k !== "dict") return null;
  const metadata = catalog.v.get("Metadata");
  return metadata?.k === "ref" ? metadata.num : null;
}

function hasIdentityCryptFilter(doc, stream) {
  if (!filterNames(doc, stream).includes("Crypt")) return false;
  const index = filterNames(doc, stream).indexOf("Crypt");
  const parms = decodeParmsAt(doc, stream, index);
  const filterName = nameValue(dictGet(doc, parms, "Name"));
  return !filterName || filterName === "Identity";
}

async function cryptAllObjects(doc, mode, params, fileKey, skipObjectNumbers) {
  const metadataNumber = params.encryptMetadata ? null : metadataObjectNumber(doc);
  for (const entry of doc.objects.values()) {
    if (skipObjectNumbers.has(entry.num)) continue;
    const object = entry.obj;
    // A cross-reference stream is never encrypted, dictionary included: its
    // dictionary carries the trailer's own /ID strings, which must stay as-is.
    if (nameValue(dictGet(doc, object, "Type")) === "XRef") continue;

    if (params.stringCfm !== "Identity") {
      const strings = [];
      walkStrings(object, (item) => strings.push(item));
      for (const item of strings) {
        item.v = await applyCrypt(mode, params.stringCfm, fileKey, entry.num, entry.gen, item.v);
        // Ciphertext is arbitrary bytes, so it always goes out as a hex string.
        if (mode === "encrypt") item.hex = true;
      }
    }

    if (object.k !== "stream") continue;
    if (params.streamCfm === "Identity") continue;
    if (entry.num === metadataNumber) continue;
    if (hasIdentityCryptFilter(doc, object)) continue;
    object.raw = await applyCrypt(mode, params.streamCfm, fileKey, entry.num, entry.gen, object.raw);
    object.dict.v.set("Length", num(object.raw.length));
  }
}

// ---------------------------------------------------------------------------
// Normalising a parsed file into something we can write
// ---------------------------------------------------------------------------

// Object streams and cross-reference streams are replaced by the classic table
// this tool writes, and a linearisation dictionary would only describe the old
// layout, so all three are dropped.
function dropStructuralObjects(doc) {
  for (const entry of [...doc.objects.values()]) {
    const object = entry.obj;
    const type = nameValue(dictGet(doc, object, "Type"));
    if (type === "XRef" || type === "ObjStm") {
      doc.objects.delete(entry.num);
      continue;
    }
    if (object.k === "dict" && object.v.has("Linearized")) doc.objects.delete(entry.num);
  }
}

// Renumbering to a dense 1..N with generation 0 keeps the output compact and,
// crucially, fixes the object numbers BEFORE keys are derived from them.
function renumberObjects(doc) {
  const entries = [...doc.objects.values()].sort((a, b) => a.num - b.num);
  const mapping = new Map();
  entries.forEach((entry, index) => mapping.set(entry.num, index + 1));

  const remap = (object) => {
    if (!object) return object;
    if (object.k === "ref") {
      const mapped = mapping.get(object.num);
      // A reference to an object that is not in the file already meant null.
      return mapped === undefined ? NULL_OBJECT : { k: "ref", num: mapped, gen: 0 };
    }
    if (object.k === "array") {
      object.v = object.v.map(remap);
      return object;
    }
    if (object.k === "dict") {
      object.v.forEach((value, key) => object.v.set(key, remap(value)));
      return object;
    }
    if (object.k === "stream") {
      remap(object.dict);
      return object;
    }
    return object;
  };

  const renumbered = new Map();
  for (const entry of entries) {
    remap(entry.obj);
    const number = mapping.get(entry.num);
    renumbered.set(number, { num: number, gen: 0, obj: entry.obj });
  }
  doc.objects = renumbered;
  doc.trailer.forEach((value, key) => doc.trailer.set(key, remap(value)));
  return mapping;
}

function nextObjectNumber(doc) {
  let highest = 0;
  for (const number of doc.objects.keys()) highest = Math.max(highest, number);
  return highest + 1;
}

function normalizeTrailer(doc, idBytes) {
  const kept = new Map();
  for (const key of ["Root", "Info"]) {
    const value = doc.trailer.get(key);
    if (value) kept.set(key, value);
  }
  let size = 1;
  for (const number of doc.objects.keys()) size = Math.max(size, number + 1);
  const trailer = new Map();
  trailer.set("Size", num(size));
  const root = kept.get("Root");
  if (root) trailer.set("Root", root);
  const info = kept.get("Info");
  if (info) trailer.set("Info", info);
  // /ID is never encrypted, and writing it inline keeps it that way whatever the
  // original file did.
  trailer.set("ID", { k: "array", v: [hexString(idBytes[0]), hexString(idBytes[1])] });
  doc.trailer = trailer;
}

function existingIdPair(doc) {
  const id = resolve(doc, doc.trailer.get("ID"));
  const first = id.k === "array" ? stringBytes(resolve(doc, id.v[0])) : EMPTY;
  const second = id.k === "array" && id.v.length > 1 ? stringBytes(resolve(doc, id.v[1])) : EMPTY;
  return [first.length ? first : randomBytes(16), second.length ? second : randomBytes(16)];
}

// ---------------------------------------------------------------------------
// Building an /Encrypt dictionary
// ---------------------------------------------------------------------------

export const PDF_ENCRYPTION_ALGORITHMS = {
  "aes-256": { label: "AES-256 (recommended)", v: 5, r: 6, keyLength: 32, cfm: "AESV3" },
  "aes-128": { label: "AES-128 (wider compatibility)", v: 4, r: 4, keyLength: 16, cfm: "AESV2" },
  "rc4-128": { label: "RC4 128-bit (legacy, insecure)", v: 4, r: 4, keyLength: 16, cfm: "V2" },
  // Reachable only from tests, which need real files at these revisions to
  // exercise the corresponding read paths.
  "rc4-128-r3": { label: "RC4 128-bit, revision 3 (legacy, insecure)", v: 2, r: 3, keyLength: 16, cfm: "V2", internal: true },
  "rc4-40-r2": { label: "RC4 40-bit, revision 2 (legacy, insecure)", v: 1, r: 2, keyLength: 5, cfm: "V2", internal: true },
  "aes-256-r5": { label: "AES-256, revision 5 (deprecated)", v: 5, r: 5, keyLength: 32, cfm: "AESV3", internal: true },
};

async function buildEncryption(algorithmId, userPassword, ownerPassword, p, idFirst) {
  const spec = PDF_ENCRYPTION_ALGORITHMS[algorithmId];
  if (!spec) throw new Error(`Unknown PDF encryption algorithm "${algorithmId}".`);
  const owner = ownerPassword || userPassword;
  const entries = new Map();
  entries.set("Filter", name("Standard"));
  entries.set("V", num(spec.v));
  entries.set("R", num(spec.r));
  entries.set("Length", num(spec.keyLength * 8));
  entries.set("P", num(p | 0));

  let fileKey;
  if (spec.v === 5) {
    fileKey = randomBytes(32);
    const userValidationSalt = randomBytes(8);
    const userKeySalt = randomBytes(8);
    const userPasswordBytes = unicodePassword(userPassword);
    const u = concatBytes([
      await hardenedHash(userPasswordBytes, userValidationSalt, EMPTY, spec.r),
      userValidationSalt,
      userKeySalt,
    ]);
    const ue = await aesCbcEncryptNoPad(await hardenedHash(userPasswordBytes, userKeySalt, EMPTY, spec.r), ZERO_IV, fileKey);

    const ownerValidationSalt = randomBytes(8);
    const ownerKeySalt = randomBytes(8);
    const ownerPasswordBytes = unicodePassword(owner);
    const o = concatBytes([
      await hardenedHash(ownerPasswordBytes, ownerValidationSalt, u, spec.r),
      ownerValidationSalt,
      ownerKeySalt,
    ]);
    const oe = await aesCbcEncryptNoPad(await hardenedHash(ownerPasswordBytes, ownerKeySalt, u, spec.r), ZERO_IV, fileKey);

    entries.set("U", hexString(u));
    entries.set("O", hexString(o));
    entries.set("UE", hexString(ue));
    entries.set("OE", hexString(oe));
    entries.set("Perms", hexString(await computePerms(fileKey, p, true)));
  } else {
    const o = legacyOwnerValue(owner, userPassword, spec.r, spec.keyLength);
    fileKey = legacyFileKey(padPassword(userPassword), {
      o,
      p,
      idFirst,
      r: spec.r,
      keyLength: spec.keyLength,
      encryptMetadata: true,
    });
    entries.set("O", hexString(o));
    entries.set("U", hexString(legacyUserValue(fileKey, idFirst, spec.r)));
  }

  if (spec.v >= 4) {
    entries.set("CF", dict([[
      "StdCF",
      dict([
        ["CFM", name(spec.cfm)],
        ["AuthEvent", name("DocOpen")],
        ["Length", num(spec.keyLength)],
      ]),
    ]]));
    entries.set("StmF", name("StdCF"));
    entries.set("StrF", name("StdCF"));
    entries.set("EncryptMetadata", { k: "bool", v: true });
  }

  return {
    dict: { k: "dict", v: entries },
    fileKey,
    params: {
      v: spec.v,
      r: spec.r,
      keyLength: spec.keyLength,
      encryptMetadata: true,
      streamCfm: spec.cfm,
      stringCfm: spec.cfm,
      p: p | 0,
    },
    label: spec.label,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Objects that must never be run through the crypt layer: the /Encrypt
// dictionary itself, and (in the rare files that use one) the indirect object
// holding the trailer's /ID array.
function unencryptedObjectNumbers(doc, params) {
  const skip = new Set();
  if (params?.ref !== null && params?.ref !== undefined) skip.add(params.ref);
  const id = doc.trailer.get("ID");
  if (id?.k === "ref") skip.add(id.num);
  return skip;
}

/**
 * Reads a PDF's /Encrypt dictionary without needing the password.
 */
export async function inspectPdfEncryption(source) {
  const bytes = await readFileBytes(source);
  const doc = parsePdf(bytes);
  const params = readEncryptParams(doc);
  if (!params) {
    return { encrypted: false, algorithm: "None", v: 0, r: 0, keyBits: 0, permissions: { ...ALL_PERMISSIONS_ALLOWED }, p: permissionsToP(ALL_PERMISSIONS_ALLOWED), opensWithoutPassword: true };
  }
  let opensWithoutPassword = false;
  try {
    opensWithoutPassword = Boolean(params.v === 5 ? await authenticateAesV3("", params) : authenticateLegacy("", params));
  } catch {
    opensWithoutPassword = false;
  }
  return {
    encrypted: true,
    algorithm: describeAlgorithm(params),
    v: params.v,
    r: params.r,
    keyBits: params.keyLength * 8,
    permissions: pToPermissions(params.p),
    p: params.p,
    opensWithoutPassword,
  };
}

function describeAlgorithm(params) {
  if (params.streamCfm === "AESV3") return `AES-256 (/V ${params.v} /R ${params.r})`;
  if (params.streamCfm === "AESV2") return `AES-128 (/V ${params.v} /R ${params.r})`;
  if (params.streamCfm === "Identity" && params.stringCfm === "Identity") return `Identity — nothing encrypted (/V ${params.v} /R ${params.r})`;
  return `RC4 ${params.keyLength * 8}-bit (/V ${params.v} /R ${params.r})`;
}

/**
 * Decrypts an encrypted PDF and returns an equivalent unencrypted one. Text,
 * fonts, images, and structure are preserved: nothing is rasterised.
 */
export async function decryptPdf(source, password) {
  const bytes = await readFileBytes(source);
  const doc = parsePdf(bytes);
  const params = readEncryptParams(doc);
  if (!params) throw new Error("That PDF is not encrypted, so there is no password to remove.");
  const fileKey = await authenticate(String(password ?? ""), params);

  await cryptAllObjects(doc, "decrypt", params, fileKey, unencryptedObjectNumbers(doc, params));
  unpackObjectStreams(doc);
  if (params.ref !== null) doc.objects.delete(params.ref);
  doc.trailer.delete("Encrypt");
  dropStructuralObjects(doc);
  renumberObjects(doc);
  normalizeTrailer(doc, existingIdPair(doc));

  return {
    bytes: serializePdf(doc),
    algorithm: describeAlgorithm(params),
    revision: params.r,
    version: params.v,
    permissions: pToPermissions(params.p),
    p: params.p,
    objectCount: doc.objects.size,
  };
}

/**
 * Encrypts a PDF with the standard security handler. `userPassword` is what a
 * reader will prompt for; `ownerPassword` (optional) unlocks the permissions.
 */
export async function encryptPdf(source, options = {}) {
  const userPassword = String(options.userPassword ?? "");
  const ownerPassword = String(options.ownerPassword ?? "");
  const algorithm = options.algorithm || "aes-256";
  if (!userPassword && !ownerPassword) throw new Error("Enter a password to encrypt with.");
  const spec = PDF_ENCRYPTION_ALGORITHMS[algorithm];
  if (!spec) throw new Error(`Unknown PDF encryption algorithm "${algorithm}".`);

  const bytes = await readFileBytes(source);
  const doc = parsePdf(bytes);
  if (readEncryptParams(doc)) {
    throw new Error("That PDF is already password protected. Use Remove Password on it first, then encrypt it again.");
  }

  unpackObjectStreams(doc);
  dropStructuralObjects(doc);
  renumberObjects(doc);

  const idPair = existingIdPair(doc);
  const p = permissionsToP(options.permissions || ALL_PERMISSIONS_ALLOWED);
  const encryption = await buildEncryption(algorithm, userPassword, ownerPassword, p, idPair[0]);

  await cryptAllObjects(doc, "encrypt", encryption.params, encryption.fileKey, new Set());

  const encryptNumber = nextObjectNumber(doc);
  doc.objects.set(encryptNumber, { num: encryptNumber, gen: 0, obj: encryption.dict });
  normalizeTrailer(doc, idPair);
  doc.trailer.set("Encrypt", { k: "ref", num: encryptNumber, gen: 0 });

  return {
    bytes: serializePdf(doc),
    algorithm: encryption.label,
    revision: encryption.params.r,
    version: encryption.params.v,
    permissions: pToPermissions(p),
    p,
    objectCount: doc.objects.size,
  };
}

/**
 * Removes owner-password permission restrictions from a PDF that opens without
 * a user password. Refuses (clearly) when a user password is actually required.
 */
export async function unlockPdf(source) {
  const bytes = await readFileBytes(source);
  const doc = parsePdf(bytes);
  const params = readEncryptParams(doc);
  if (!params) throw new Error("That PDF has no encryption, so it has no permission restrictions to remove.");

  const fileKey = params.v === 5 ? await authenticateAesV3("", params) : authenticateLegacy("", params);
  if (!fileKey) {
    throw new Error("This PDF needs a password just to open it, so its restrictions cannot be removed here. Use Remove Password with the password you already have.");
  }

  const before = pToPermissions(params.p);
  await cryptAllObjects(doc, "decrypt", params, fileKey, unencryptedObjectNumbers(doc, params));
  unpackObjectStreams(doc);
  if (params.ref !== null) doc.objects.delete(params.ref);
  doc.trailer.delete("Encrypt");
  dropStructuralObjects(doc);
  renumberObjects(doc);
  normalizeTrailer(doc, existingIdPair(doc));

  return {
    bytes: serializePdf(doc),
    algorithm: describeAlgorithm(params),
    revision: params.r,
    version: params.v,
    permissionsBefore: before,
    permissions: { ...ALL_PERMISSIONS_ALLOWED },
    p: permissionsToP(ALL_PERMISSIONS_ALLOWED),
    objectCount: doc.objects.size,
  };
}

/**
 * Rewrites a PDF through the same parse/serialise pipeline without touching the
 * crypt layer. Used by tests to prove the object-level rewrite is lossless.
 */
export async function rewritePdfObjects(source) {
  const bytes = await readFileBytes(source);
  const doc = parsePdf(bytes);
  if (readEncryptParams(doc)) throw new Error("That PDF is encrypted.");
  unpackObjectStreams(doc);
  dropStructuralObjects(doc);
  renumberObjects(doc);
  normalizeTrailer(doc, existingIdPair(doc));
  return { bytes: serializePdf(doc), objectCount: doc.objects.size };
}
