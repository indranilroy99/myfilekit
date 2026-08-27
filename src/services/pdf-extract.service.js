// Extract Images & Attachments — pulls the EMBEDDED raster images (image
// XObjects) and embedded file attachments actually stored inside a PDF (NOT page
// renders) and bundles them into a ZIP.
//
// Decoding strategy (lossless where feasible, honest where not):
//   - DCTDecode image XObjects are already JPEG files — their stored bytes are
//     written straight out as .jpg (no re-encode, byte-for-byte).
//   - FlateDecode raster (8-bit DeviceGray / DeviceRGB) is inflated to raw
//     samples and wrapped in a lossless PNG.
//   - Anything else (CMYK, indexed, non-8-bit, JPXDecode, CCITTFax, JBIG2, or a
//     sample count that does not match Width×Height×channels) is reported as
//     skipped rather than guessed at.
// Repeated image XObjects are de-duplicated by content hash. Pure pdf-lib +
// fflate, so this path is unit-testable in Node.

import { zipSync, zlibSync, decompressSync } from "fflate";
import { getPdfLib } from "./pdf.service.js";
import { safeFilename } from "../utils/safe-filename.js";

// Upper bound on inflated bytes we are willing to materialise from a single
// untrusted FlateDecode stream. A crafted, highly-compressible stream can inflate
// to gigabytes and OOM the tab; mirror the Analyser's MAX_INFLATE bound and refuse
// to decode anything past this. 64 MB is comfortably larger than a legitimate
// large raster while staying bounded against a decompression bomb.
const MAX_INFLATE_BYTES = 64 * 1024 * 1024;

// Returns true when a FlateDecode stream inflates to more than `cap` bytes, using
// a probe buffer one byte over the cap: fflate truncates its output to the buffer,
// so a returned length past `cap` means the true size exceeds it. Never throws:
// non-inflatable bytes (e.g. an uncompressed raster, which cannot amplify anyway)
// return false so the caller falls back to pdf-lib's own decoder.
function flateInflateExceeds(stored, cap) {
  if (!stored || !stored.length) return false;
  try {
    const probe = decompressSync(new Uint8Array(stored), { out: new Uint8Array(cap + 1) });
    return probe.length > cap;
  } catch {
    return false;
  }
}

// --- filters / dict helpers ---------------------------------------------------

function filterNames(dict, PDFName, PDFArray) {
  const filter = dict.get(PDFName.of("Filter"));
  if (!filter) return [];
  if (filter instanceof PDFArray) {
    const out = [];
    for (let i = 0; i < filter.size(); i += 1) out.push(String(filter.get(i)).replace(/^\//, ""));
    return out;
  }
  return [String(filter).replace(/^\//, "")];
}

function numberOf(value) {
  if (value == null) return null;
  if (typeof value.asNumber === "function") {
    try { return value.asNumber(); } catch { /* fall through */ }
  }
  const n = Number(String(value));
  return Number.isFinite(n) ? n : null;
}

/** Resolves an image's colour channels for the 8-bit cases PNG can carry losslessly. */
function colorChannels(dict, ctx, PDFName, PDFArray, PDFRawStream) {
  let space = dict.get(PDFName.of("ColorSpace")) || dict.get(PDFName.of("CS"));
  const resolved = ctx.lookup(space);
  if (resolved instanceof PDFArray && resolved.size() >= 1) {
    const family = String(resolved.get(0)).replace(/^\//, "");
    if (family === "ICCBased") {
      const stream = ctx.lookup(resolved.get(1));
      const n = stream && stream.dict ? numberOf(stream.dict.get(PDFName.of("N"))) : null;
      return n === 1 ? { channels: 1 } : n === 3 ? { channels: 3 } : { channels: 0, reason: `unsupported ICC colour space (${n ?? "?"} channels)` };
    }
    return { channels: 0, reason: `unsupported colour space (${family})` };
  }
  const name = space ? String(space).replace(/^\//, "") : "";
  if (name === "DeviceGray" || name === "CalGray" || name === "G") return { channels: 1 };
  if (name === "DeviceRGB" || name === "CalRGB" || name === "RGB") return { channels: 3 };
  if (name === "DeviceCMYK" || name === "CMYK") return { channels: 0, reason: "CMYK images cannot be saved losslessly as PNG" };
  return { channels: 0, reason: name ? `unsupported colour space (${name})` : "unknown colour space" };
}

// --- minimal, dependency-free PNG encoder (8-bit gray / RGB) ------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u32be(value) {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function pngChunk(type, data) {
  const typeBytes = new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32be(data.length), 0);
  out.set(body, 4);
  out.set(u32be(crc32(body)), 4 + body.length);
  return out;
}

/** Encodes 8-bit gray (1ch) or RGB (3ch) samples as a lossless PNG. */
function encodePng(width, height, channels, samples) {
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0; // filter type 0 (None)
    raw.set(samples.subarray(row * stride, row * stride + stride), row * (stride + 1) + 1);
  }
  const idat = zlibSync(raw, { level: 6 });
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 1 ? 0 : 2; // colour type: 0 gray, 2 RGB
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { png.set(part, offset); offset += part.length; }
  return png;
}

// --- attachment name handling -------------------------------------------------

function pdfStringValue(object) {
  if (!object) return "";
  if (typeof object.decodeText === "function") { try { return object.decodeText(); } catch { /* fall */ } }
  if (typeof object.asString === "function") { try { return object.asString(); } catch { /* fall */ } }
  return String(object);
}

/** Sanitises an attachment filename while preserving its original extension. */
function safeAttachmentName(raw, fallback) {
  const base = String(raw || "").split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).replace(/[^a-z0-9]+/gi, "").slice(0, 12) : "";
  const stem = safeFilename(dot > 0 ? base.slice(0, dot) : base, fallback);
  return ext ? `${stem}.${ext.toLowerCase()}` : stem;
}

// --- main extraction ----------------------------------------------------------

/**
 * Extracts embedded raster images and file attachments from PDF bytes.
 *
 * @param {Uint8Array|ArrayBuffer|{arrayBuffer:Function}} input
 * @param {{ onProgress?: (done:number,total:number)=>void }} [options]
 * @returns {Promise<{ images: {name,bytes,mime,kind}[], attachments: {name,bytes,size}[], skipped: {reason,width?,height?,filters?}[], counts: object }>}
 */
export async function extractPdfAssets(input, options = {}) {
  const { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, decodePDFRawStream } = getPdfLib();
  const { onProgress } = options;
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input instanceof ArrayBuffer ? input : await input.arrayBuffer());

  let pdf;
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
  } catch (error) {
    if (/encrypt/i.test(String(error?.message))) {
      throw new Error("This PDF is encrypted. Remove the password first (use Remove Password), then extract images.");
    }
    throw error;
  }

  const ctx = pdf.context;
  const objects = [...ctx.enumerateIndirectObjects()];

  // First pass: collect candidate image XObjects and attachment Filespecs.
  const imageStreams = [];
  const attachments = [];
  const skipped = []; // items refused (unsupported codec, or too large / bomb)
  const seenAttachmentNames = new Map();
  for (const [, obj] of objects) {
    if (obj instanceof PDFRawStream && obj.dict) {
      if (String(obj.dict.get(PDFName.of("Subtype"))) === "/Image") imageStreams.push(obj);
      continue;
    }
    if (obj instanceof PDFDict && String(obj.get(PDFName.of("Type"))) === "/Filespec") {
      const rawName = pdfStringValue(obj.lookup(PDFName.of("UF")) || obj.lookup(PDFName.of("F")));
      const ef = obj.lookup(PDFName.of("EF"));
      const stream = ef instanceof PDFDict ? ef.lookup(PDFName.of("F")) || ef.lookup(PDFName.of("UF")) : null;
      if (!(stream instanceof PDFRawStream)) continue;
      // Bomb guard: refuse to inflate an attachment whose FlateDecode stream blows
      // past the cap, instead of decoding it into gigabytes of memory.
      const efFilters = filterNames(stream.dict, PDFName, PDFArray);
      const efFlate = efFilters.length > 0 && efFilters.every((f) => f === "FlateDecode" || f === "Fl");
      if (efFlate && flateInflateExceeds(stream.contents, MAX_INFLATE_BYTES)) {
        skipped.push({ reason: "attachment stream is too large / possible decompression bomb", filters: efFilters });
        continue;
      }
      let fileBytes;
      try { fileBytes = decodePDFRawStream(stream).decode(); } catch { fileBytes = stream.contents || new Uint8Array(0); }
      let name = safeAttachmentName(rawName, `attachment-${attachments.length + 1}`);
      const dupCount = seenAttachmentNames.get(name) || 0;
      seenAttachmentNames.set(name, dupCount + 1);
      if (dupCount > 0) {
        const dot = name.lastIndexOf(".");
        name = dot > 0 ? `${name.slice(0, dot)}-${dupCount}${name.slice(dot)}` : `${name}-${dupCount}`;
      }
      attachments.push({ name, bytes: new Uint8Array(fileBytes), size: fileBytes.length });
    }
  }

  // Second pass: decode images, de-duplicating repeated XObjects by content hash.
  const images = [];
  const seenImageHashes = new Set();
  const total = imageStreams.length;
  for (let index = 0; index < imageStreams.length; index += 1) {
    const stream = imageStreams[index];
    onProgress?.(index, total);
    const dict = stream.dict;
    const stored = stream.contents || new Uint8Array(0);
    const hash = crc32(stored);
    if (seenImageHashes.has(hash)) continue; // identical XObject reused across pages
    seenImageHashes.add(hash);

    const filters = filterNames(dict, PDFName, PDFArray);
    const width = numberOf(dict.get(PDFName.of("Width")) || dict.get(PDFName.of("W")));
    const height = numberOf(dict.get(PDFName.of("Height")) || dict.get(PDFName.of("H")));

    if (filters.length === 1 && (filters[0] === "DCTDecode" || filters[0] === "DCT")) {
      images.push({ bytes: new Uint8Array(stored), mime: "image/jpeg", ext: "jpg", kind: "JPEG (DCTDecode, stored losslessly)" });
      continue;
    }

    const flateOnly = filters.every((f) => f === "FlateDecode" || f === "Fl");
    if (!filters.length || flateOnly) {
      const bpc = numberOf(dict.get(PDFName.of("BitsPerComponent")) || dict.get(PDFName.of("BPC")));
      const { channels, reason } = colorChannels(dict, ctx, PDFName, PDFArray, PDFRawStream);
      if (width && height && bpc === 8 && (channels === 1 || channels === 3)) {
        const expected = width * height * channels;
        // Bomb guard: a legit 8-bit raster inflates to width×height×channels bytes
        // (plus at most one predictor byte per row). Bound the inflate to that,
        // capped by MAX_INFLATE_BYTES, so a crafted highly-compressible stream that
        // inflates to gigabytes is skipped instead of OOMing the tab. Only decode
        // once we know the true inflated size is within the cap.
        const inflateCap = Math.min(MAX_INFLATE_BYTES, expected + height + 64);
        if (flateInflateExceeds(stored, inflateCap)) {
          skipped.push({ reason: "decompressed image is too large / possible decompression bomb", width, height, filters });
          continue;
        }
        let samples;
        try { samples = decodePDFRawStream(stream).decode(); } catch { samples = null; }
        if (samples && samples.length >= expected) {
          images.push({ bytes: encodePng(width, height, channels, samples.subarray(0, expected)), mime: "image/png", ext: "png", kind: `PNG (FlateDecode ${channels === 1 ? "gray" : "RGB"})` });
          continue;
        }
        skipped.push({ reason: samples ? "decoded sample count did not match Width×Height×channels" : "stream could not be inflated", width, height, filters });
        continue;
      }
      skipped.push({ reason: reason || (bpc !== 8 ? `unsupported bit depth (${bpc ?? "?"})` : "unsupported raster image"), width, height, filters });
      continue;
    }

    skipped.push({ reason: `unsupported image codec (${filters.join(" → ") || "none"})`, width, height, filters });
  }

  // Assign sequential names now that duplicates are gone.
  const pad = String(Math.max(1, images.length)).length;
  images.forEach((image, index) => {
    image.name = `image-${String(index + 1).padStart(pad, "0")}.${image.ext}`;
  });

  return {
    images,
    attachments,
    skipped,
    counts: { imageXObjects: imageStreams.length, extractedImages: images.length, attachments: attachments.length, skipped: skipped.length },
  };
}

/** Bundles an extractPdfAssets result into a ZIP: images/ and attachments/. Pure. */
export function buildExtractionZip(result) {
  const entries = {};
  for (const image of result.images || []) entries[`images/${image.name}`] = image.bytes;
  for (const attachment of result.attachments || []) entries[`attachments/${attachment.name}`] = attachment.bytes;
  if (!Object.keys(entries).length) throw new Error("There is nothing to bundle — no images or attachments were extracted.");
  return zipSync(entries, { level: 6 });
}
