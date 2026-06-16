const textDecoder = new TextDecoder("utf-8", { fatal: false });

const TIFF_TYPES = {
  1: { name: "BYTE", size: 1 },
  2: { name: "ASCII", size: 1 },
  3: { name: "SHORT", size: 2 },
  4: { name: "LONG", size: 4 },
  5: { name: "RATIONAL", size: 8 },
  7: { name: "UNDEFINED", size: 1 },
  9: { name: "SLONG", size: 4 },
  10: { name: "SRATIONAL", size: 8 }
};

const TIFF_TAGS = {
  0x010e: "Image description",
  0x010f: "Camera make",
  0x0110: "Camera model",
  0x0112: "Orientation",
  0x011a: "X resolution",
  0x011b: "Y resolution",
  0x0128: "Resolution unit",
  0x0131: "Software",
  0x0132: "Modified date",
  0x013b: "Artist",
  0x8298: "Copyright",
  0x8769: "EXIF pointer",
  0x8825: "GPS pointer"
};

const EXIF_TAGS = {
  0x829a: "Exposure time",
  0x829d: "F number",
  0x8822: "Exposure program",
  0x8827: "ISO speed",
  0x9000: "EXIF version",
  0x9003: "Original date",
  0x9004: "Digitized date",
  0x9201: "Shutter speed",
  0x9202: "Aperture",
  0x9203: "Brightness",
  0x9204: "Exposure bias",
  0x9205: "Max aperture",
  0x9207: "Metering mode",
  0x9209: "Flash",
  0x920a: "Focal length",
  0xa001: "Color space",
  0xa002: "Pixel width",
  0xa003: "Pixel height",
  0xa405: "Focal length in 35mm",
  0xa430: "Camera owner",
  0xa431: "Camera serial number",
  0xa432: "Lens specification",
  0xa433: "Lens make",
  0xa434: "Lens model",
  0xa435: "Lens serial number"
};

const GPS_TAGS = {
  0x0000: "GPS version",
  0x0001: "Latitude ref",
  0x0002: "Latitude",
  0x0003: "Longitude ref",
  0x0004: "Longitude",
  0x0005: "Altitude ref",
  0x0006: "Altitude",
  0x0007: "GPS timestamp",
  0x000d: "Speed ref",
  0x000e: "Speed",
  0x0010: "Image direction ref",
  0x0011: "Image direction",
  0x001d: "GPS date"
};

export async function inspectImageMetadata(file) {
  const buffer = await file.arrayBuffer();
  return inspectImageMetadataBuffer(buffer, {
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified
  });
}

export function inspectImageMetadataBuffer(buffer, file = {}) {
  const bytes = new Uint8Array(buffer);
  const report = createReport(file, detectFormat(bytes, file));

  try {
    if (report.format === "JPEG") inspectJpeg(bytes, report);
    else if (report.format === "PNG") inspectPng(bytes, report);
    else if (report.format === "WebP") inspectWebp(bytes, report);
    else report.warnings.push("Unsupported image container for metadata inspection.");
  } catch (error) {
    report.warnings.push(`Metadata scan stopped early: ${error.message}`);
  }

  finalizeReport(report);
  return report;
}

export function metadataReportToJson(report) {
  return JSON.stringify(report, null, 2);
}

function createReport(file, format) {
  return {
    fileName: file.name || "",
    mimeType: file.type || "",
    fileSize: file.size || 0,
    lastModified: file.lastModified || 0,
    format,
    metadataCount: 0,
    containers: [],
    groups: [],
    privacy: {
      hasExif: false,
      hasGps: false,
      hasCamera: false,
      hasSoftware: false,
      hasXmp: false,
      hasIccProfile: false,
      hasPngText: false,
      hasWebpMetadata: false
    },
    warnings: []
  };
}

function detectFormat(bytes, file) {
  const type = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "JPEG";
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return "PNG";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "WebP";
  if (type.includes("jpeg") || /\.jpe?g$/.test(name)) return "JPEG";
  if (type.includes("png") || name.endsWith(".png")) return "PNG";
  if (type.includes("webp") || name.endsWith(".webp")) return "WebP";
  return "Unknown";
}

function inspectJpeg(bytes, report) {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) break;
    const length = readU16(bytes, offset, false);
    const start = offset + 2;
    const end = Math.min(start + length - 2, bytes.length);
    if (end <= start) break;
    const segment = bytes.subarray(start, end);

    if (marker === 0xe1 && ascii(segment, 0, 6) === "Exif\u0000\u0000") {
      report.privacy.hasExif = true;
      addContainer(report, "EXIF", "JPEG APP1 EXIF block");
      addTiffGroups(report, segment, 6, "EXIF");
    } else if (marker === 0xe1 && ascii(segment, 0, 28) === "http://ns.adobe.com/xap/1.0/") {
      report.privacy.hasXmp = true;
      addContainer(report, "XMP", "JPEG APP1 XMP block");
      addXmpGroup(report, segment.subarray(29), "XMP");
    } else if (marker === 0xe2) {
      report.privacy.hasIccProfile = true;
      addContainer(report, "ICC profile", "JPEG APP2 color profile");
    } else if (marker === 0xed) {
      addContainer(report, "Photoshop/IPTC", "JPEG APP13 metadata block");
    } else if (marker >= 0xe0 && marker <= 0xef) {
      addContainer(report, `APP${marker - 0xe0}`, `JPEG application segment 0x${marker.toString(16)}`);
    }
    offset = end;
  }
}

function inspectPng(bytes, report) {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset, false);
    const type = ascii(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;
    const chunk = bytes.subarray(dataStart, dataEnd);

    if (type === "tEXt") {
      report.privacy.hasPngText = true;
      addContainer(report, "PNG text", "tEXt chunk");
      addPngText(report, chunk, "PNG tEXt");
    } else if (type === "iTXt") {
      report.privacy.hasPngText = true;
      addContainer(report, "PNG international text", "iTXt chunk");
      addPngText(report, chunk, "PNG iTXt");
    } else if (type === "zTXt") {
      report.privacy.hasPngText = true;
      addContainer(report, "PNG compressed text", "zTXt chunk");
      addGroup(report, "PNG zTXt", [{ label: "Compressed text chunk", value: "Present. Browser preview does not decompress this field yet." }]);
    } else if (type === "eXIf") {
      report.privacy.hasExif = true;
      addContainer(report, "EXIF", "PNG eXIf chunk");
      addTiffGroups(report, chunk, 0, "EXIF");
    } else if (type === "iCCP") {
      report.privacy.hasIccProfile = true;
      addContainer(report, "ICC profile", "PNG iCCP chunk");
      addGroup(report, "Color profile", [{ label: "ICC profile", value: readNullTerminated(chunk, 0).text || "Present" }]);
    } else if (type === "pHYs") {
      addContainer(report, "Pixel density", "PNG pHYs chunk");
      if (chunk.length >= 9) {
        addGroup(report, "PNG density", [
          { label: "Pixels per unit X", value: String(readU32(chunk, 0, false)) },
          { label: "Pixels per unit Y", value: String(readU32(chunk, 4, false)) },
          { label: "Unit", value: chunk[8] === 1 ? "Meter" : "Unknown" }
        ]);
      }
    } else if (type === "tIME") {
      addContainer(report, "Timestamp", "PNG tIME chunk");
    }
    offset = dataEnd + 4;
  }
}

function inspectWebp(bytes, report) {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const length = readU32(bytes, offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = Math.min(dataStart + length, bytes.length);
    const chunk = bytes.subarray(dataStart, dataEnd);

    if (type === "EXIF") {
      report.privacy.hasExif = true;
      report.privacy.hasWebpMetadata = true;
      addContainer(report, "EXIF", "WebP EXIF chunk");
      addTiffGroups(report, chunk, 0, "EXIF");
    } else if (type === "XMP ") {
      report.privacy.hasXmp = true;
      report.privacy.hasWebpMetadata = true;
      addContainer(report, "XMP", "WebP XMP chunk");
      addXmpGroup(report, chunk, "XMP");
    } else if (type === "ICCP") {
      report.privacy.hasIccProfile = true;
      report.privacy.hasWebpMetadata = true;
      addContainer(report, "ICC profile", "WebP ICCP chunk");
    } else if (type === "VP8X" && chunk.length >= 10) {
      addGroup(report, "WebP container", [
        { label: "ICC profile flag", value: Boolean(chunk[0] & 0x20) ? "Present" : "Not set" },
        { label: "EXIF flag", value: Boolean(chunk[0] & 0x08) ? "Present" : "Not set" },
        { label: "XMP flag", value: Boolean(chunk[0] & 0x04) ? "Present" : "Not set" }
      ]);
    }
    offset = dataEnd + (length % 2);
  }
}

function addTiffGroups(report, bytes, tiffStart, labelPrefix) {
  const parsed = parseTiff(bytes, tiffStart);
  for (const group of parsed.groups) addGroup(report, `${labelPrefix} ${group.title}`, group.items);
  if (parsed.gps) {
    report.privacy.hasGps = true;
    report.warnings.push("GPS/location metadata detected. Review before sharing this image.");
  }
  if (parsed.camera) report.privacy.hasCamera = true;
  if (parsed.software) report.privacy.hasSoftware = true;
}

function parseTiff(bytes, tiffStart) {
  if (tiffStart + 8 > bytes.length) return { groups: [] };
  const endian = ascii(bytes, tiffStart, 2);
  const little = endian === "II";
  if (!little && endian !== "MM") return { groups: [] };
  const magic = readU16(bytes, tiffStart + 2, little);
  if (magic !== 42) return { groups: [] };
  const ifd0Offset = readU32(bytes, tiffStart + 4, little);
  const parsed = { groups: [], gps: false, camera: false, software: false };
  const ifd0 = parseIfd(bytes, tiffStart, ifd0Offset, little, TIFF_TAGS);
  if (ifd0.items.length) parsed.groups.push({ title: "image", items: ifd0.items });
  parsed.camera = ifd0.items.some((item) => /camera make|camera model/i.test(item.label));
  parsed.software = ifd0.items.some((item) => item.label === "Software");

  const exifPointer = ifd0.raw.get(0x8769);
  if (Number.isFinite(exifPointer)) {
    const exif = parseIfd(bytes, tiffStart, exifPointer, little, EXIF_TAGS);
    if (exif.items.length) parsed.groups.push({ title: "camera", items: exif.items });
    parsed.camera = parsed.camera || exif.items.length > 0;
  }

  const gpsPointer = ifd0.raw.get(0x8825);
  if (Number.isFinite(gpsPointer)) {
    const gps = parseIfd(bytes, tiffStart, gpsPointer, little, GPS_TAGS);
    const gpsItems = gps.items;
    const coordinate = gpsCoordinate(gps.raw.get(0x0001), gps.raw.get(0x0002), gps.raw.get(0x0003), gps.raw.get(0x0004));
    if (coordinate) gpsItems.unshift({ label: "Decimal coordinates", value: coordinate, sensitive: true });
    if (gpsItems.length) {
      parsed.gps = true;
      parsed.groups.push({ title: "GPS location", items: gpsItems.map((item) => ({ ...item, sensitive: true })) });
    }
  }

  return parsed;
}

function parseIfd(bytes, tiffStart, offset, little, tagMap) {
  const raw = new Map();
  const items = [];
  const start = tiffStart + offset;
  if (offset <= 0 || start + 2 > bytes.length) return { raw, items };
  const count = readU16(bytes, start, little);
  for (let index = 0; index < count; index += 1) {
    const entry = start + 2 + index * 12;
    if (entry + 12 > bytes.length) break;
    const tag = readU16(bytes, entry, little);
    const type = readU16(bytes, entry + 2, little);
    const itemCount = readU32(bytes, entry + 4, little);
    const value = readTiffValue(bytes, tiffStart, entry + 8, type, itemCount, little);
    raw.set(tag, value);
    const label = tagMap[tag] || `Tag 0x${tag.toString(16).padStart(4, "0")}`;
    if (label.includes("pointer")) continue;
    const formatted = formatTiffValue(label, value);
    if (formatted !== "") items.push({ label, value: formatted });
  }
  return { raw, items };
}

function readTiffValue(bytes, tiffStart, valueOffset, type, count, little) {
  const definition = TIFF_TYPES[type];
  if (!definition || count > 1024) return "";
  const byteLength = definition.size * count;
  const start = byteLength <= 4 ? valueOffset : tiffStart + readU32(bytes, valueOffset, little);
  if (start < 0 || start + byteLength > bytes.length) return "";
  if (type === 2) return cleanAscii(bytes.subarray(start, start + byteLength));
  if (type === 7 && count <= 16) return cleanAscii(bytes.subarray(start, start + byteLength)) || Array.from(bytes.subarray(start, start + byteLength)).join(".");
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const next = start + index * definition.size;
    if (type === 1 || type === 7) values.push(bytes[next]);
    else if (type === 3) values.push(readU16(bytes, next, little));
    else if (type === 4) values.push(readU32(bytes, next, little));
    else if (type === 9) values.push(readI32(bytes, next, little));
    else if (type === 5 || type === 10) {
      const numerator = type === 10 ? readI32(bytes, next, little) : readU32(bytes, next, little);
      const denominator = type === 10 ? readI32(bytes, next + 4, little) : readU32(bytes, next + 4, little);
      values.push({ numerator, denominator, value: denominator ? numerator / denominator : 0 });
    }
  }
  return values.length === 1 ? values[0] : values;
}

function formatTiffValue(label, value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(formatSingleTiffValue).join(", ");
  if (typeof value === "object" && "value" in value) {
    if (/exposure time/i.test(label) && value.value > 0 && value.value < 1) return `1/${Math.round(1 / value.value)} sec`;
    if (/f number|aperture|max aperture/i.test(label)) return `f/${round(value.value)}`;
    if (/focal length/i.test(label)) return `${round(value.value)} mm`;
    return `${round(value.value)} (${value.numerator}/${value.denominator})`;
  }
  return String(value).trim();
}

function formatSingleTiffValue(value) {
  if (typeof value === "object" && value && "value" in value) return String(round(value.value));
  return String(value);
}

function gpsCoordinate(latRef, lat, lonRef, lon) {
  if (!Array.isArray(lat) || !Array.isArray(lon) || lat.length < 3 || lon.length < 3) return "";
  const toDegrees = (parts, ref) => {
    const degrees = parts[0].value + parts[1].value / 60 + parts[2].value / 3600;
    return ["S", "W"].includes(String(ref).trim().toUpperCase()) ? -degrees : degrees;
  };
  return `${round(toDegrees(lat, latRef), 6)}, ${round(toDegrees(lon, lonRef), 6)}`;
}

function addPngText(report, bytes, title) {
  const first = readNullTerminated(bytes, 0);
  if (!first.text) return;
  let value = "";
  if (title.includes("iTXt")) {
    const compressionFlag = bytes[first.next] || 0;
    if (compressionFlag) value = "Compressed international text present.";
    else {
      let cursor = first.next + 2;
      cursor = readNullTerminated(bytes, cursor).next;
      cursor = readNullTerminated(bytes, cursor).next;
      value = cleanAscii(bytes.subarray(cursor));
    }
  } else {
    value = cleanAscii(bytes.subarray(first.next));
  }
  addGroup(report, title, [{ label: first.text, value: value || "Present" }]);
}

function addXmpGroup(report, bytes, title) {
  const text = textDecoder.decode(bytes).replace(/\u0000/g, "").trim();
  const fields = [
    ["Creator tool", /xmp:CreatorTool=["']([^"']+)/i],
    ["Create date", /xmp:CreateDate=["']([^"']+)/i],
    ["Modify date", /xmp:ModifyDate=["']([^"']+)/i],
    ["Metadata date", /xmp:MetadataDate=["']([^"']+)/i],
    ["Camera make", /tiff:Make=["']([^"']+)/i],
    ["Camera model", /tiff:Model=["']([^"']+)/i],
    ["Author", /<dc:creator>[\s\S]*?<rdf:li>([^<]+)/i],
    ["Description", /<dc:description>[\s\S]*?<rdf:li[^>]*>([^<]+)/i]
  ].map(([label, pattern]) => {
    const match = text.match(pattern);
    return match ? { label, value: match[1].trim() } : null;
  }).filter(Boolean);
  addGroup(report, title, fields.length ? fields : [{ label: "XMP packet", value: "Present" }]);
}

function addContainer(report, type, detail) {
  report.containers.push({ type, detail, removable: true });
}

function addGroup(report, title, items) {
  const safeItems = items.filter((item) => item && item.value !== "");
  if (safeItems.length) report.groups.push({ title, items: safeItems });
}

function finalizeReport(report) {
  report.groups = report.groups
    .map((group) => ({ ...group, items: group.items.slice(0, 80) }))
    .filter((group) => group.items.length);
  report.metadataCount = report.groups.reduce((total, group) => total + group.items.length, 0) + report.containers.length;
  if (!report.metadataCount) report.warnings.push("No embedded metadata was detected by the local parser for this format.");
}

function readNullTerminated(bytes, start) {
  let end = start;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  return { text: cleanAscii(bytes.subarray(start, end)), next: Math.min(end + 1, bytes.length) };
}

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function cleanAscii(bytes) {
  return textDecoder.decode(bytes).replace(/\u0000+$/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

function readU16(bytes, offset, little) {
  if (offset + 2 > bytes.length) return 0;
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, little);
}

function readU32(bytes, offset, little) {
  if (offset + 4 > bytes.length) return 0;
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, little);
}

function readI32(bytes, offset, little) {
  if (offset + 4 > bytes.length) return 0;
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, little);
}

function round(value, decimals = 2) {
  return Number.parseFloat(Number(value).toFixed(decimals));
}
