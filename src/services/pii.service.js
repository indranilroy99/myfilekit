import { validateGstin } from "./business.service.js";
import { getPdfLib } from "./pdf.service.js";

// pdf.js is loaded lazily (same reason as pdf-render.service.js): this module
// must stay importable in Node for unit tests, where the Vite-only `?worker`
// import inside ../lib/pdfjs cannot resolve.
async function getPdfjs() {
  return import("../lib/pdfjs");
}

// --- confidence ---------------------------------------------------------------

/**
 * Three honest buckets rather than a fake percentage:
 *  HIGH   — a checksum or a structural rule proves the value is well-formed
 *           (Verhoeff, Luhn, GST mod-36, a valid PAN entity character, an
 *           explicit +91/E.164 prefix, a keyword right next to the value).
 *  MEDIUM — the shape matches and the context is suggestive, but nothing proves
 *           it (a bare 10-digit mobile, a standalone birthdate-looking date).
 *  LOW    — shape only. These are expected to include false positives; they are
 *           shown so a human can decide, never treated as findings.
 */
export const CONFIDENCE = { HIGH: 0.95, MEDIUM: 0.65, LOW: 0.35 };

export function confidenceLabel(confidence) {
  if (confidence >= CONFIDENCE.HIGH) return "high";
  if (confidence >= CONFIDENCE.MEDIUM) return "medium";
  return "low";
}

export const PII_TYPE_LABELS = {
  aadhaar: "Aadhaar number",
  pan: "PAN (India)",
  card: "Payment card number",
  gstin: "GSTIN",
  ifsc: "IFSC code",
  account: "Bank account number",
  routing: "Bank routing number (US)",
  passport: "Passport number (India)",
  email: "Email address",
  phone: "Phone number",
  dob: "Date of birth",
  ipv4: "IPv4 address",
  ipv6: "IPv6 address",
  url: "URL",
};

// Types that identify a person or an account. These are masked everywhere by
// default. URLs and IP addresses are document destinations the reader has to be
// able to read, so they are reported verbatim (documented in the UI + report).
const PERSONAL_TYPES = new Set(["aadhaar", "pan", "card", "gstin", "ifsc", "account", "routing", "passport", "email", "phone", "dob"]);

export function isPersonalType(type) {
  return PERSONAL_TYPES.has(type);
}

// --- Verhoeff (Aadhaar) -------------------------------------------------------

// Dihedral group D5 multiplication table.
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
// Permutation table applied by position.
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
// Multiplicative inverse in D5.
const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/** True when a digit string (checksum digit last) satisfies the Verhoeff check. */
export function verhoeffValid(digits) {
  const value = String(digits || "");
  if (!/^\d+$/.test(value)) return false;
  let checksum = 0;
  const reversed = [...value].reverse();
  for (let index = 0; index < reversed.length; index++) {
    checksum = VERHOEFF_D[checksum][VERHOEFF_P[index % 8][Number(reversed[index])]];
  }
  return checksum === 0;
}

/** Verhoeff check digit for a payload that does not yet carry one. */
export function verhoeffCheckDigit(payload) {
  const value = String(payload || "");
  if (!/^\d+$/.test(value)) throw new Error("Verhoeff input must be digits only.");
  let checksum = 0;
  const reversed = [...value].reverse();
  for (let index = 0; index < reversed.length; index++) {
    checksum = VERHOEFF_D[checksum][VERHOEFF_P[(index + 1) % 8][Number(reversed[index])]];
  }
  return VERHOEFF_INV[checksum];
}

/**
 * Aadhaar: exactly 12 digits, never starting with 0 or 1 (UIDAI reserves those),
 * and the last digit must be the Verhoeff checksum of the first 11.
 */
export function validateAadhaar(value) {
  const digits = String(value || "").replace(/[\s-]/g, "");
  if (!/^\d{12}$/.test(digits)) return { valid: false, reason: "Aadhaar must be 12 digits." };
  if (digits[0] === "0" || digits[0] === "1") return { valid: false, reason: "Aadhaar never starts with 0 or 1." };
  if (!verhoeffValid(digits)) return { valid: false, reason: "Verhoeff checksum failed." };
  return { valid: true, reason: "" };
}

// --- PAN ----------------------------------------------------------------------

// 4th character = holder type. P individual, C company, H HUF, A AOP, B BOI,
// G government, J artificial juridical person, L local authority, F firm/LLP,
// T trust. Anything else is not an issued PAN shape.
const PAN_ENTITY_TYPES = {
  P: "Individual",
  C: "Company",
  H: "HUF",
  A: "Association of persons",
  B: "Body of individuals",
  G: "Government",
  J: "Artificial juridical person",
  L: "Local authority",
  F: "Firm / LLP",
  T: "Trust",
};

export function validatePan(value) {
  const pan = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return { valid: false, entity: "", reason: "PAN must be 5 letters, 4 digits, 1 letter." };
  const entity = PAN_ENTITY_TYPES[pan[3]] || "";
  if (!entity) return { valid: false, entity: "", reason: `"${pan[3]}" is not a valid PAN entity type character.` };
  return { valid: true, entity, reason: "" };
}

// --- payment cards ------------------------------------------------------------

/** Luhn (mod-10) check over a digit string. */
export function luhnValid(digits) {
  const value = String(digits || "");
  if (!/^\d+$/.test(value) || value.length < 2) return false;
  let sum = 0;
  let double = false;
  for (let index = value.length - 1; index >= 0; index--) {
    let digit = Number(value[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Brand from the IIN prefix and length. Returns "" when no known range matches
 * (the number may still be a valid Luhn card — reported as "Unknown brand").
 */
export function cardBrand(digits) {
  const value = String(digits || "");
  const length = value.length;
  const starts = (prefix) => value.startsWith(prefix);
  const inRange = (from, to, size) => {
    const head = Number(value.slice(0, size));
    return Number.isFinite(head) && head >= from && head <= to;
  };
  if (starts("4") && [13, 16, 19].includes(length)) return "Visa";
  if (length === 15 && (starts("34") || starts("37"))) return "American Express";
  if (length === 16 && inRange(51, 55, 2)) return "Mastercard";
  if (length === 16 && inRange(2221, 2720, 4)) return "Mastercard";
  // RuPay's 60/508/6521/6522 ranges overlap Discover's 60xx/65xx space. Only
  // the most specific prefixes can be told apart without an IIN table, so 6011
  // is resolved to Discover first, then the RuPay prefixes, then the rest of
  // Discover. Brand naming inside the shared 65xx space is approximate.
  if (length >= 16 && length <= 19 && starts("6011")) return "Discover";
  if (length === 16 && (starts("60") || starts("6521") || starts("6522") || starts("508"))) return "RuPay";
  if (length >= 16 && length <= 19 && (starts("65") || inRange(644, 649, 3) || inRange(622126, 622925, 6))) return "Discover";
  return "";
}

// --- other formats ------------------------------------------------------------

/** IFSC: 4-letter bank code, a literal 0, then 6 alphanumerics (branch). */
export function validateIfsc(value) {
  const ifsc = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return { valid: false, reason: "IFSC must be 4 letters, a 0, then 6 alphanumerics." };
  return { valid: true, reason: "" };
}

/**
 * US bank routing number (ABA / RTN): 9 digits, an issued Federal Reserve
 * routing symbol in the first two digits, and the weighted mod-10 checksum.
 *
 * This exists because a routing number identifies the BANK, not the customer's
 * account. Reporting one as a "Bank account number" — which the generic 9-18
 * digit account rule used to do — is a factual error in a redaction tool, and
 * it hides the fact that the actual account number was never found.
 */
export function validateAbaRouting(value) {
  const digits = String(value || "").replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(digits)) return { valid: false, reason: "A routing number is 9 digits." };
  const prefix = Number(digits.slice(0, 2));
  // 00-12 Federal Reserve, 21-32 thrift, 61-72 electronic, 80 traveller's cheque.
  const issued = prefix <= 12 || (prefix >= 21 && prefix <= 32) || (prefix >= 61 && prefix <= 72) || prefix === 80;
  if (!issued) return { valid: false, reason: `${digits.slice(0, 2)} is not an issued Federal Reserve routing symbol.` };
  const d = [...digits].map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  if (sum % 10 !== 0) return { valid: false, reason: "ABA checksum failed." };
  return { valid: true, reason: "" };
}

/** Indian passport: one letter (no Q, no X, no Z) then 7 digits. */
export function validateIndianPassport(value) {
  const passport = String(value || "").trim().toUpperCase();
  if (!/^[A-PR-WY][0-9]{7}$/.test(passport)) return { valid: false, reason: "Indian passport is one letter (A-P, R-W, Y) followed by 7 digits." };
  return { valid: true, reason: "" };
}

/** IPv4 with real octet bounds (rejects 999.1.1.1 and 1.2.3.4.5). */
export function isValidIpv4(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** IPv6, including one optional "::" run and a trailing IPv4 tail. */
export function isValidIpv6(value) {
  const address = String(value || "").trim();
  if (!address || /[^0-9A-Fa-f:.]/.test(address)) return false;
  const halves = address.split("::");
  if (halves.length > 2) return false;
  const groupsOf = (part) => (part === "" ? [] : part.split(":"));
  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  const all = [...head, ...tail];
  let count = all.length;
  for (let index = 0; index < all.length; index++) {
    const group = all[index];
    if (group.includes(".")) {
      // An IPv4 tail is only legal as the very last group and takes 2 groups.
      if (index !== all.length - 1 || !isValidIpv4(group)) return false;
      count += 1;
      continue;
    }
    if (!/^[0-9A-Fa-f]{1,4}$/.test(group)) return false;
  }
  if (halves.length === 2) return count <= 7;
  return count === 8;
}

// --- masking ------------------------------------------------------------------

/**
 * Masks all but the last `keep` alphanumerics, preserving separators so the
 * shape stays recognisable: "1234 5678 9012" -> "XXXX XXXX 9012".
 */
export function maskValue(value, keep = 4) {
  const text = String(value ?? "");
  const alnumTotal = (text.match(/[A-Za-z0-9]/g) || []).length;
  const keepFrom = Math.max(0, alnumTotal - Math.max(0, keep));
  let seen = 0;
  return [...text]
    .map((char) => {
      if (!/[A-Za-z0-9]/.test(char)) return char;
      seen += 1;
      return seen > keepFrom ? char : "X";
    })
    .join("");
}

function maskEmail(value) {
  const text = String(value ?? "");
  const at = text.lastIndexOf("@");
  if (at <= 0) return maskValue(text, 0);
  const local = text.slice(0, at);
  const domain = text.slice(at + 1);
  const maskedLocal = `${local[0]}${"*".repeat(Math.max(1, local.length - 1))}`;
  const parts = domain.split(".");
  const maskedDomain = parts
    .map((part, index) => (index === parts.length - 1 ? part : `${part[0]}${"*".repeat(Math.max(1, part.length - 1))}`))
    .join(".");
  return `${maskedLocal}@${maskedDomain}`;
}

/** Display form of a match: masked for personal types, verbatim for URL/IP. */
export function maskPii(type, value) {
  if (!isPersonalType(type)) return String(value ?? "");
  if (type === "email") return maskEmail(value);
  if (type === "dob") return maskValue(value, 0);
  if (type === "pan" || type === "gstin" || type === "ifsc" || type === "passport") return maskValue(value, 3);
  return maskValue(value, 4);
}

// C0 and C1 control characters, built from escape sequences so this source file
// itself stays plain ASCII.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f]+", "g");

/**
 * Strips control characters and flattens newlines out of untrusted document
 * text before it lands in a plain-text report, so document content can never
 * forge report lines or terminal escapes.
 */
export function sanitiseForReport(value) {
  return String(value ?? "")
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- detectors ----------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// The DOB keyword must sit immediately before the date (only separators
// between), otherwise one "born on" earlier in the paragraph would promote
// every later date on the page.
const DOB_KEYWORDS = /\b(?:d\.?o\.?b\.?|date of birth|birth ?date|born(?: on)?|birthday)\b\s*[:=-]?\s*$/i;
const PHONE_KEYWORDS = /\b(phone|mobile|tel|telephone|contact|whatsapp|cell|mob)\b/i;
const ACCOUNT_KEYWORDS = /\b(a\/c|acct|account)\b/i;
const ROUTING_KEYWORDS = /\b(routing|aba|rtn|transit)\b/i;
const PASSPORT_KEYWORDS = /\bpassport\b/i;
const IFSC_SHAPE = /(?<![A-Z0-9])[A-Z]{4}0[A-Z0-9]{6}(?![A-Z0-9])/;

function contextBefore(text, start, span = 40) {
  return text.slice(Math.max(0, start - span), start);
}

function contextAround(text, start, end, span = 60) {
  return text.slice(Math.max(0, start - span), Math.min(text.length, end + span));
}

function isRealDate(day, month, year) {
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Collects date matches with their parsed year, from numeric (d/m/y, y-m-d) and
 * "12 March 1984" forms. One linear pass per pattern.
 */
function findDates(text) {
  const found = [];
  const push = (start, end, year) => found.push({ start, end, value: text.slice(start, end), year });

  for (const match of text.matchAll(/(?<![\d])(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?![\d])/g)) {
    const [, a, b, rawYear] = match;
    let year = Number(rawYear);
    if (rawYear.length === 2) year += year <= 30 ? 2000 : 1900;
    // Accept either d/m/y or m/d/y — whichever is a real calendar date.
    if (isRealDate(Number(a), Number(b), year) || isRealDate(Number(b), Number(a), year)) {
      push(match.index, match.index + match[0].length, year);
    }
  }
  for (const match of text.matchAll(/(?<![\d])(\d{4})-(\d{2})-(\d{2})(?![\d])/g)) {
    const year = Number(match[1]);
    if (isRealDate(Number(match[3]), Number(match[2]), year)) push(match.index, match.index + match[0].length, year);
  }
  for (const match of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4})\b/g)) {
    const monthIndex = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase());
    if (monthIndex < 0) continue;
    const year = Number(match[3]);
    if (isRealDate(Number(match[1]), monthIndex + 1, year)) push(match.index, match.index + match[0].length, year);
  }
  return found;
}

/**
 * Runs every detector over one text block.
 *
 * Returns `{ type, value, confidence, start, end, note }` per hit, sorted by
 * position. `start`/`end` are offsets into `text`, so a caller holding a map of
 * text offsets to page rectangles can locate every hit.
 *
 * Overlapping hits are resolved by type priority (a GSTIN wins over the PAN
 * embedded inside it; a card number wins over the generic account-number rule),
 * so the same digits are never reported twice under different labels.
 */
export function detectPii(text, options = {}) {
  const source = String(text || "");
  if (!source) return [];
  const now = options.now ? new Date(options.now) : new Date();
  const currentYear = now.getUTCFullYear();
  const candidates = [];
  const add = (type, start, end, confidence, note = "") => {
    candidates.push({ type, value: source.slice(start, end), confidence, start, end, note });
  };

  // GSTIN — 2-digit state code, embedded PAN, entity digit, Z, mod-36 checksum.
  for (const match of source.matchAll(/(?<![A-Z0-9])\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9](?![A-Z0-9])/g)) {
    const checked = validateGstin(match[0]);
    add("gstin", match.index, match.index + match[0].length, checked.valid ? CONFIDENCE.HIGH : CONFIDENCE.LOW, checked.valid ? "State code, PAN and mod-36 checksum all valid." : checked.reason);
  }

  // Payment cards — 13-19 digits with optional single spaces/dashes, Luhn-checked.
  for (const match of source.matchAll(/(?<![\d])\d(?:[ -]?\d){12,18}(?![\d])/g)) {
    const digits = match[0].replace(/[ -]/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    if (!luhnValid(digits)) continue;
    const brand = cardBrand(digits);
    add("card", match.index, match.index + match[0].length, CONFIDENCE.HIGH, `Luhn valid · ${brand || "Unknown brand"} · ${digits.length} digits`);
  }

  // Aadhaar — 12 digits, 4-4-4 spacing tolerated, Verhoeff-checked.
  for (const match of source.matchAll(/(?<![\d])\d{4}[ -]?\d{4}[ -]?\d{4}(?![\d])/g)) {
    const checked = validateAadhaar(match[0]);
    if (!checked.valid) continue;
    add("aadhaar", match.index, match.index + match[0].length, CONFIDENCE.HIGH, "Verhoeff checksum valid.");
  }

  // PAN — entity-type character decides confidence.
  for (const match of source.matchAll(/(?<![A-Z0-9])[A-Z]{5}\d{4}[A-Z](?![A-Z0-9])/g)) {
    const checked = validatePan(match[0]);
    add("pan", match.index, match.index + match[0].length, checked.valid ? CONFIDENCE.HIGH : CONFIDENCE.LOW, checked.valid ? `Entity type: ${checked.entity}` : checked.reason);
  }

  // IFSC.
  for (const match of source.matchAll(/(?<![A-Z0-9])[A-Z]{4}0[A-Z0-9]{6}(?![A-Z0-9])/g)) {
    add("ifsc", match.index, match.index + match[0].length, CONFIDENCE.HIGH, `Bank code ${match[0].slice(0, 4)}`);
  }

  // Email.
  for (const match of source.matchAll(/[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,24}/g)) {
    add("email", match.index, match.index + match[0].length, CONFIDENCE.HIGH);
  }

  // Phone — +91/0091/91 prefixed or bare 10-digit starting 6-9 (optionally
  // written as 5+5, "98765 43210"), plus E.164.
  for (const match of source.matchAll(/(?<![\d+])(?:(\+91|0091|91)[ -]?)?([6-9]\d{4}[ -]?\d{5})(?![\d])/g)) {
    const prefixed = Boolean(match[1]);
    const keyword = PHONE_KEYWORDS.test(contextBefore(source, match.index));
    add("phone", match.index, match.index + match[0].length, prefixed || keyword ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM, prefixed ? "India country code present." : keyword ? "Phone keyword nearby." : "Bare 10-digit Indian mobile shape — could be an order or reference number.");
  }
  for (const match of source.matchAll(/(?<![\d+])\+[1-9]\d{7,14}(?![\d])/g)) {
    add("phone", match.index, match.index + match[0].length, CONFIDENCE.HIGH, "E.164 international format.");
  }
  // North American (NANP) 3-3-4: "(415) 555-0142", "415-555-0142", "+1 415.555.0142".
  // Previously only Indian mobiles and E.164 were detected, so every US-style
  // number on a document went unreported despite "phone numbers" being claimed.
  // A separator between the exchange and the line number is REQUIRED: a bare
  // 10-digit run is an order or reference number far more often than a phone
  // number, and the bare case is already covered by the Indian rule above.
  for (const match of source.matchAll(/(?<![\d+.])(?:\+1[ .-]?)?(?:\(([2-9]\d{2})\)[ .-]?|([2-9]\d{2})[ .-])([2-9]\d{2})[ .-](\d{4})(?![\d])(?!\.\d)/g)) {
    const prefixed = match[0].startsWith("+1");
    const parenthesised = Boolean(match[1]);
    const keyword = PHONE_KEYWORDS.test(contextBefore(source, match.index));
    add(
      "phone",
      match.index,
      match.index + match[0].length,
      prefixed || parenthesised || keyword ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM,
      prefixed ? "North American number with the +1 country code."
        : keyword ? "Phone keyword nearby."
        : parenthesised ? "Parenthesised area code — North American phone convention."
        : "North American 3-3-4 phone shape with separators."
    );
  }

  // Date of birth — keyword-adjacent dates, plus standalone plausible birthdates.
  for (const date of findDates(source)) {
    const keyword = DOB_KEYWORDS.test(contextBefore(source, date.start, 30));
    const plausible = date.year >= 1900 && date.year <= currentYear - 13;
    if (keyword) add("dob", date.start, date.end, CONFIDENCE.HIGH, "Date of birth keyword immediately before the date.");
    else if (plausible) add("dob", date.start, date.end, CONFIDENCE.MEDIUM, `Standalone date with a birth-plausible year (${date.year}).`);
  }

  // IPv4 — real octets, and not part of a dotted version string.
  for (const match of source.matchAll(/(?<![\w.])\d{1,3}(?:\.\d{1,3}){3}(?![\w.])/g)) {
    if (!isValidIpv4(match[0])) continue;
    const before = contextBefore(source, match.index, 12);
    if (/\b(v|version|ver|rev|build|release)\s*$/i.test(before)) continue;
    add("ipv4", match.index, match.index + match[0].length, CONFIDENCE.HIGH);
  }

  // IPv6.
  for (const match of source.matchAll(/(?<![:\w.])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f.]{0,4}(?![:\w])/g)) {
    if (!isValidIpv6(match[0])) continue;
    add("ipv6", match.index, match.index + match[0].length, CONFIDENCE.HIGH);
  }

  // URLs and mailto links. Sentence punctuation is trimmed off the tail so the
  // reported destination is the URL, not "https://x.example," with a comma.
  const trimUrl = (value) => value.replace(/[.,;:!?'"]+$/, "");
  for (const match of source.matchAll(/\b(?:https?|ftp):\/\/[^\s<>"'()[\]]+/gi)) {
    add("url", match.index, match.index + trimUrl(match[0]).length, CONFIDENCE.HIGH);
  }
  for (const match of source.matchAll(/\bmailto:[^\s<>"'()[\]]+/gi)) {
    add("url", match.index, match.index + trimUrl(match[0]).length, CONFIDENCE.HIGH);
  }

  // Passport — shape alone is very weak, so only a nearby keyword lifts it.
  for (const match of source.matchAll(/(?<![A-Z0-9])[A-PR-WY]\d{7}(?![A-Z0-9])/g)) {
    const keyword = PASSPORT_KEYWORDS.test(contextBefore(source, match.index));
    add("passport", match.index, match.index + match[0].length, keyword ? CONFIDENCE.HIGH : CONFIDENCE.LOW, keyword ? "Passport keyword nearby." : "Shape only — one letter plus 7 digits is a very common reference-number shape.");
  }

  // US routing numbers — run before the account rule and outrank it, so a
  // checksum-valid RTN is never reported as somebody's account number.
  for (const match of source.matchAll(/(?<![\d])\d{9}(?![\d])/g)) {
    if (!validateAbaRouting(match[0]).valid) continue;
    const end = match.index + match[0].length;
    const keyword = ROUTING_KEYWORDS.test(contextAround(source, match.index, end, 40));
    add(
      "routing",
      match.index,
      end,
      keyword ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM,
      keyword
        ? "ABA checksum valid and a routing/ABA keyword sits beside it. This identifies the bank, not an account."
        : "9 digits with a valid ABA checksum and an issued Federal Reserve prefix — most likely a routing number, which identifies a bank rather than an account."
    );
  }

  // Bank account numbers — 9-18 digits, either as one unbroken run or written in
  // hyphen/space separated groups ("4419-8827-6634", "4419 8827 6634"). The
  // grouped forms used to be invisible here: a hyphen ends a `\d{9,18}` run, so
  // a labelled 12-digit account number split 4-4-4 produced three 4-digit runs
  // and no match at all. Groups are capped at 6 digits so the grouped pass only
  // recognises numbers actually written in groups; unbroken runs stay with the
  // rule they always had.
  const accountRuns = [];
  const pushRun = (start, end) => {
    const digits = source.slice(start, end).replace(/[ -]/g, "");
    if (digits.length < 9 || digits.length > 18) return;
    const around = contextAround(source, start, end);
    accountRuns.push({ start, end, digits, nearIfsc: IFSC_SHAPE.test(around), nearKeyword: ACCOUNT_KEYWORDS.test(around) });
  };
  for (const match of source.matchAll(/(?<![\d])\d{9,18}(?![\d])/g)) pushRun(match.index, match.index + match[0].length);
  for (const match of source.matchAll(/(?<![\d])\d{2,6}(?:-\d{2,6})+(?![\d])/g)) pushRun(match.index, match.index + match[0].length);
  for (const match of source.matchAll(/(?<![\d])\d{2,6}(?: \d{2,6})+(?![\d])/g)) pushRun(match.index, match.index + match[0].length);

  // An account number is usually labelled once (in a header) and then repeated
  // bare in a table or a footer. Those later repeats carry no keyword of their
  // own, so without this they would be reported as anonymous digit runs and a
  // reviewer would skip them — leaving the same number unredacted further down
  // the page. Evidence found anywhere in this text block is applied to every
  // occurrence of the same digits.
  const labelledAccounts = new Set(accountRuns.filter((run) => run.nearIfsc || run.nearKeyword).map((run) => run.digits));
  for (const run of accountRuns) {
    const labelledElsewhere = !run.nearIfsc && !run.nearKeyword && labelledAccounts.has(run.digits);
    add(
      "account",
      run.start,
      run.end,
      run.nearIfsc || run.nearKeyword || labelledElsewhere ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW,
      run.nearIfsc ? "An IFSC code appears next to this number."
        : run.nearKeyword ? "Account keyword nearby."
        : labelledElsewhere ? "The same number is labelled as an account elsewhere on this page."
        : "Digit run only — no account context found."
    );
  }

  return resolveOverlaps(candidates);
}

// Earlier types win when two hits cover the same characters.
// "routing" sits above "account": both can claim the same 9 digits, and the one
// backed by a checksum wins so the label is right.
const TYPE_PRIORITY = ["gstin", "card", "aadhaar", "email", "url", "ifsc", "pan", "phone", "ipv4", "ipv6", "dob", "passport", "routing", "account"];

function resolveOverlaps(candidates) {
  const accepted = [];
  const ordered = [...candidates].sort((a, b) => {
    const priority = TYPE_PRIORITY.indexOf(a.type) - TYPE_PRIORITY.indexOf(b.type);
    if (priority !== 0) return priority;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.start - b.start;
  });
  for (const candidate of ordered) {
    const clash = accepted.some((item) => candidate.start < item.end && item.start < candidate.end);
    if (!clash) accepted.push(candidate);
  }
  return accepted.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Counts by type (total and high-confidence), for the report header. */
export function summarisePii(matches) {
  const byType = new Map();
  for (const match of matches || []) {
    const entry = byType.get(match.type) || { type: match.type, label: PII_TYPE_LABELS[match.type] || match.type, count: 0, high: 0 };
    entry.count += 1;
    if (match.confidence >= CONFIDENCE.HIGH) entry.high += 1;
    byType.set(match.type, entry);
  }
  const types = [...byType.values()].sort((a, b) => b.high - a.high || b.count - a.count || a.label.localeCompare(b.label));
  return {
    total: (matches || []).length,
    high: types.reduce((sum, entry) => sum + entry.high, 0),
    types,
  };
}

// --- unreadable pages ---------------------------------------------------------

/**
 * A page with fewer extractable characters than this is treated as unreadable.
 * A rasterised page yields exactly 0; the small allowance covers a page whose
 * only text layer is a stamp or a page number, which tells a reader nothing
 * about the page content either.
 */
export const MIN_PAGE_TEXT_CHARS = 12;

function formatPageList(pages, limit = 10) {
  const shown = pages.slice(0, limit);
  const rest = pages.length - shown.length;
  const joined = shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : String(shown[0]);
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : joined;
}

/**
 * Turns a scan into an explicit statement about the pages nothing could be read
 * from.
 *
 * This exists because "no known patterns matched" reads as a clean bill of
 * health, and on a rasterised page it is nothing of the kind: the scanner would
 * say exactly the same thing whether a redaction box landed correctly or missed
 * and left an account number sitting in plain sight. A page with no text layer
 * has not been scanned, and the UI has to say so in those words.
 *
 * Accepts a scan from `extractPdfPiiHits`; an older scan without
 * `pagesWithoutText` falls back to the whole-document `hasTextLayer` flag.
 */
export function describeUnreadablePages(scan) {
  const pages = Number(scan?.pages) || 0;
  let entries = Array.isArray(scan?.pagesWithoutText) ? scan.pagesWithoutText : null;
  if (!entries) {
    entries = scan && scan.hasTextLayer === false && pages > 0
      ? Array.from({ length: pages }, (unused, index) => ({ page: index + 1, characters: 0 }))
      : [];
  }
  const unreadablePages = entries.map((entry) => Number(entry.page)).filter((page) => Number.isFinite(page));
  const unreadable = unreadablePages.length > 0;
  const allUnreadable = unreadable && pages > 0 && unreadablePages.length >= pages;
  const empty = entries.every((entry) => !Number(entry.characters));
  const plural = unreadablePages.length !== 1;
  const headline = !unreadable
    ? ""
    : `${plural ? "Pages" : "Page"} ${formatPageList(unreadablePages)} of this file ${plural ? "are images" : "is an image"}. ${empty ? "No text could be read" : "Almost no text could be read"} from ${plural ? "them" : "it"}, so this scan cannot tell you what ${plural ? "they contain" : "it contains"}.`;
  const advice = !unreadable
    ? ""
    : `Open ${plural ? "those pages" : "that page"} and read ${plural ? "them" : "it"} yourself, or run OCR / Searchable PDF to add a text layer and scan the OCR'd copy. A "no matches" result means nothing here.`;
  return {
    pages,
    unreadablePages,
    readablePages: Math.max(0, pages - unreadablePages.length),
    unreadable,
    allUnreadable,
    headline,
    advice,
  };
}

// --- offset -> rectangle mapping ---------------------------------------------

/**
 * Maps a text match onto the page rectangles that must be painted over.
 *
 * pdf.js reports one rectangle per text ITEM, not per character, and an item can
 * hold anything from one glyph to a whole line. A match therefore often covers
 * only part of an item. There is no safe way to redact half an item from the
 * item rectangle alone (glyph advances are not exposed), so this returns the
 * WHOLE rectangle of every item the match touches. That deliberately over-redacts
 * — neighbouring characters in the same item are lost — because the alternative
 * is leaving part of a PII value visible.
 *
 * `items` must be sorted by `start` and non-overlapping (as produced by
 * extractPdfPiiHits). Linear in the number of overlapping items via binary
 * search, so a 200-page document stays linear overall.
 */
export function rectsForMatch(items, start, end) {
  if (!Array.isArray(items) || !items.length || end <= start) return [];
  let low = 0;
  let high = items.length - 1;
  let first = items.length;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (items[mid].end > start) {
      first = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  const rects = [];
  for (let index = first; index < items.length && items[index].start < end; index++) {
    if (items[index].rect) rects.push(items[index].rect);
  }
  return rects;
}

// --- browser: text + coordinates ---------------------------------------------

// Exported for tests: this box decides where an irreversible, flattening
// redaction lands, so "it looked right on screen" is not enough evidence.
export function itemRect(pdfjs, viewport, item) {
  // Item transform is in PDF user space; compose it with the viewport transform
  // to land in top-left-origin viewport space, then express the box as page
  // percentages so it survives the DPI scaling done by rasterRebuild.
  const transform = pdfjs.Util.transform(viewport.transform, item.transform);
  const height = Math.abs(item.height) || Math.hypot(transform[2], transform[3]) || 8;
  const width = Math.abs(item.width) || 1;

  // The run is not necessarily horizontal. `item.width` and `item.height` are
  // lengths along the run's OWN axes, so on a /Rotate 90 page — a scanned
  // landscape statement, say — treating them as across-and-down puts a
  // horizontal bar beside vertical text: measured 0% coverage of the target,
  // after which rasterRebuild bakes the still-legible value into an image and
  // the tool reports the text as gone. Build the quad along the real axes and
  // take its bounding box; at 0 degrees this reduces to the old maths exactly.
  const angle = Math.atan2(transform[1], transform[0]);
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  // Perpendicular, from the baseline towards the top of the glyph box.
  const upX = dirY;
  const upY = -dirX;
  const originX = transform[4];
  const originY = transform[5];
  const cornerX = [originX, originX + width * dirX, originX + width * dirX + height * upX, originX + height * upX];
  const cornerY = [originY, originY + width * dirY, originY + width * dirY + height * upY, originY + height * upY];
  const left = Math.min(...cornerX);
  const top = Math.min(...cornerY);
  const boxWidth = Math.max(...cornerX) - left;
  const boxHeight = Math.max(...cornerY) - top;

  // Allow a little for descenders, scaled off the smaller side so a vertical run
  // is padded by the same visual amount as a horizontal one.
  const pad = Math.min(2, Math.min(boxWidth, boxHeight) * 0.25);
  const x = ((left - pad) / viewport.width) * 100;
  const y = ((top - pad) / viewport.height) * 100;
  const w = ((boxWidth + pad * 2) / viewport.width) * 100;
  const h = ((boxHeight + pad * 2) / viewport.height) * 100;
  return {
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y)),
    w: Math.max(0.2, Math.min(100, w)),
    h: Math.max(0.2, Math.min(100, h)),
    outsidePage: left + boxWidth < -1 || left > viewport.width + 1 || top + boxHeight < -1 || top > viewport.height + 1,
  };
}

/**
 * Reads every page's text with per-item rectangles, runs the detectors, and
 * returns locatable hits. Browser-only (pdf.js rendering coordinates).
 *
 * Each hit carries `rects` in the percentage form that `redactPdf` expects, so
 * the caller can hand the user's selection straight to it.
 */
export async function extractPdfPiiHits(file, { onProgress, now } = {}) {
  const { pdfjs, loadPdfDocument } = await getPdfjs();
  const pdf = await loadPdfDocument(file);
  const hits = [];
  let charactersWithText = 0;
  let pagesWithText = 0;
  let offPageItems = 0;
  const pagesWithoutText = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = [];
      let text = "";
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        const start = text.length;
        text += item.str;
        if (item.str) {
          const rect = itemRect(pdfjs, viewport, item);
          if (rect.outsidePage) offPageItems += 1;
          items.push({ start, end: text.length, rect });
        }
        if (item.hasEOL) text += "\n";
        else if (item.str && !item.str.endsWith(" ")) text += " ";
      }
      const pageText = text;
      const characters = pageText.trim().length;
      if (characters) {
        pagesWithText += 1;
        charactersWithText += characters;
      }
      // Recorded per page, not just counted: a five-page file where page 3 is a
      // scan must be able to say "page 3", not "one page had no text".
      if (characters < MIN_PAGE_TEXT_CHARS) pagesWithoutText.push({ page: pageNumber, characters });
      const matches = detectPii(pageText, { now });
      for (const match of matches) {
        hits.push({
          id: `p${pageNumber}-${match.start}-${match.type}`,
          page: pageNumber,
          type: match.type,
          value: match.value,
          masked: maskPii(match.type, match.value),
          confidence: match.confidence,
          note: match.note || "",
          rects: rectsForMatch(items, match.start, match.end).map((rect) => ({ page: pageNumber, x: rect.x, y: rect.y, w: rect.w, h: rect.h })),
        });
      }
      page.cleanup();
      onProgress?.(pageNumber, pdf.numPages);
    }
    return {
      pages: pdf.numPages,
      pagesWithText,
      pagesWithoutText,
      hasTextLayer: charactersWithText > 0,
      offPageItems,
      hits,
      summary: summarisePii(hits),
    };
  } finally {
    await pdf.destroy();
  }
}

// --- pdf-lib: document structure ---------------------------------------------

function decodeLatin1(bytes) {
  let out = "";
  const chunk = 8192;
  for (let index = 0; index < bytes.length; index += chunk) {
    out += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return out;
}

/** Removes PDF string literals so operator scanning cannot be fooled by text. */
function stripPdfStrings(content) {
  let out = "";
  let depth = 0;
  let hex = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (depth > 0) {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) out += " () ";
      }
      continue;
    }
    if (hex) {
      if (char === ">") {
        hex = false;
        out += " () ";
      }
      continue;
    }
    if (char === "(") {
      depth = 1;
      continue;
    }
    if (char === "<" && content[index + 1] !== "<") {
      hex = true;
      continue;
    }
    out += char;
  }
  return out;
}

const MAX_CONTENT_SCAN = 4 * 1024 * 1024;

/**
 * Scans one page's content stream for text that a reader cannot see: text
 * rendering mode 3 (invisible) and near-white fills. Heuristic by nature — it
 * tracks the operators linearly and does not evaluate the full graphics state
 * (patterns, ICC/Separation colour spaces, clipping and covering shapes are not
 * modelled), so it can both miss cases and flag legitimate ones (OCR layers use
 * mode 3 on purpose).
 */
export function scanContentForInvisibleText(content) {
  const scanned = content.length > MAX_CONTENT_SCAN ? content.slice(0, MAX_CONTENT_SCAN) : content;
  const tokens = stripPdfStrings(scanned).split(/[\s]+/);
  let renderMode = 0;
  let fill = 0;
  let invisible = 0;
  let whiteOnWhite = 0;
  const stack = [];
  const numberAt = (index) => {
    const value = Number(tokens[index]);
    return Number.isFinite(value) ? value : null;
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "q") stack.push({ renderMode, fill });
    else if (token === "Q") {
      const previous = stack.pop();
      if (previous) {
        renderMode = previous.renderMode;
        fill = previous.fill;
      }
    } else if (token === "Tr") {
      const mode = numberAt(index - 1);
      if (mode !== null) renderMode = mode;
    } else if (token === "g") {
      const gray = numberAt(index - 1);
      if (gray !== null) fill = gray;
    } else if (token === "rg") {
      const r = numberAt(index - 3);
      const g = numberAt(index - 2);
      const b = numberAt(index - 1);
      if (r !== null && g !== null && b !== null) fill = Math.min(r, g, b);
    } else if (token === "k") {
      const c = numberAt(index - 4);
      const m = numberAt(index - 3);
      const y = numberAt(index - 2);
      const kValue = numberAt(index - 1);
      if (c !== null && m !== null && y !== null && kValue !== null) fill = Math.max(0, 1 - Math.max(c, m, y, kValue));
    } else if (token === "Tj" || token === "TJ" || token === "'" || token === '"') {
      if (renderMode === 3 || renderMode === 7) invisible += 1;
      else if (fill >= 0.97) whiteOnWhite += 1;
    }
  }
  const truncated = content.length > MAX_CONTENT_SCAN;
  return { invisible, whiteOnWhite, truncated };
}

function pdfStringValue(object) {
  if (!object) return "";
  if (typeof object.decodeText === "function") {
    try {
      return object.decodeText();
    } catch {
      return "";
    }
  }
  if (typeof object.asString === "function") {
    try {
      return object.asString();
    } catch {
      return "";
    }
  }
  return String(object);
}

function readInfoDict(pdf) {
  const read = (fn) => {
    try {
      const value = fn();
      if (value instanceof Date) return value.toISOString();
      return value ? String(value) : "";
    } catch {
      return "";
    }
  };
  return {
    Title: read(() => pdf.getTitle()),
    Author: read(() => pdf.getAuthor()),
    Subject: read(() => pdf.getSubject()),
    Keywords: read(() => pdf.getKeywords()),
    Creator: read(() => pdf.getCreator()),
    Producer: read(() => pdf.getProducer()),
    CreationDate: read(() => pdf.getCreationDate()),
    ModificationDate: read(() => pdf.getModificationDate()),
  };
}

const XMP_FIELDS = [
  ["Author (dc:creator)", /<dc:creator>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i],
  ["Title (dc:title)", /<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i],
  ["Creator tool (xmp:CreatorTool)", /<xmp:CreatorTool[^>]*>([\s\S]*?)<\/xmp:CreatorTool>/i],
  ["Producer (pdf:Producer)", /<pdf:Producer[^>]*>([\s\S]*?)<\/pdf:Producer>/i],
  ["Document ID (xmpMM:DocumentID)", /<xmpMM:DocumentID[^>]*>([\s\S]*?)<\/xmpMM:DocumentID>/i],
  ["Created (xmp:CreateDate)", /<xmp:CreateDate[^>]*>([\s\S]*?)<\/xmp:CreateDate>/i],
  ["Modified (xmp:ModifyDate)", /<xmp:ModifyDate[^>]*>([\s\S]*?)<\/xmp:ModifyDate>/i],
];

/** Pulls the common identity fields out of an XMP packet. */
export function parseXmpFields(xmp) {
  const text = String(xmp || "");
  const fields = [];
  for (const [label, pattern] of XMP_FIELDS) {
    const match = text.match(pattern);
    const value = match ? sanitiseForReport(match[1]) : "";
    if (value) fields.push({ label, value });
  }
  // Attribute form: <rdf:Description xmp:CreatorTool="..." />
  for (const match of text.matchAll(/\b(dc:creator|xmp:CreatorTool|pdf:Producer|dc:title)\s*=\s*"([^"]*)"/g)) {
    const value = sanitiseForReport(match[2]);
    if (value && !fields.some((field) => field.value === value)) fields.push({ label: `${match[1]} (attribute)`, value });
  }
  return fields;
}

/**
 * Reads the privacy-relevant structure of a PDF with pdf-lib: metadata, XMP,
 * link destinations, embedded files, encryption, signatures, and invisible-text
 * heuristics. No rendering, so this path is unit-testable in Node.
 */
export async function scanPdfStructure(file, { onProgress } = {}) {
  const { PDFDocument, PDFName, PDFArray, PDFRawStream, PDFDict, decodePDFRawStream } = getPdfLib();
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });

  const info = readInfoDict(pdf);
  const catalog = pdf.catalog;

  // XMP packet.
  let xmpRaw = "";
  try {
    const metadata = catalog.lookup(PDFName.of("Metadata"));
    if (metadata instanceof PDFRawStream) xmpRaw = decodeLatin1(decodePDFRawStream(metadata).decode());
  } catch {
    xmpRaw = "";
  }
  const xmp = { present: Boolean(xmpRaw), fields: parseXmpFields(xmpRaw), bytes: xmpRaw.length };

  // Signatures + embedded files, found by walking the object graph once.
  const attachments = [];
  const signatures = [];
  // An attachment normally appears twice in the object graph: once as a
  // /Filespec (the named entry a reader shows) and once as the /EmbeddedFile
  // stream holding the bytes. Filespecs are listed by name; the raw streams are
  // only counted, so one attachment is not reported as two.
  let embeddedFileStreams = 0;
  let embeddedFileBytes = 0;
  try {
    for (const [, object] of pdf.context.enumerateIndirectObjects()) {
      if (object instanceof PDFRawStream) {
        const subtype = object.dict?.get?.(PDFName.of("Type"));
        if (subtype && String(subtype) === "/EmbeddedFile") {
          embeddedFileStreams += 1;
          embeddedFileBytes += object.contents?.length || 0;
        }
        continue;
      }
      if (!(object instanceof PDFDict)) continue;
      const type = object.get(PDFName.of("Type"));
      const fieldType = object.get(PDFName.of("FT"));
      if (type && String(type) === "/Filespec") {
        const name = sanitiseForReport(pdfStringValue(object.lookup(PDFName.of("UF")) || object.lookup(PDFName.of("F"))));
        const description = sanitiseForReport(pdfStringValue(object.lookup(PDFName.of("Desc"))));
        let size = 0;
        try {
          const embedded = object.lookup(PDFName.of("EF"));
          const stream = embedded instanceof PDFDict ? embedded.lookup(PDFName.of("F")) : null;
          if (stream instanceof PDFRawStream) size = stream.contents?.length || 0;
        } catch {
          size = 0;
        }
        attachments.push({ name: name || "(unnamed)", type: "Filespec", description, size });
      }
      if ((type && String(type) === "/Sig") || (fieldType && String(fieldType) === "/Sig")) {
        const name = sanitiseForReport(pdfStringValue(object.lookup(PDFName.of("Name")) || object.lookup(PDFName.of("T"))));
        const reason = sanitiseForReport(pdfStringValue(object.lookup(PDFName.of("Reason"))));
        signatures.push({ name: name || "(unnamed)", reason });
      }
    }
  } catch {
    // A malformed object graph must not sink the whole report.
  }

  // Per-page: link annotations, attachment annotations, invisible text.
  const pages = pdf.getPages();
  const links = [];
  const invisibleText = [];
  let contentTruncated = false;
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const pageNumber = index + 1;
    try {
      const annots = page.node.Annots();
      if (annots instanceof PDFArray) {
        for (let annotIndex = 0; annotIndex < annots.size(); annotIndex++) {
          const annot = annots.lookup(annotIndex);
          if (!(annot instanceof PDFDict)) continue;
          const subtype = annot.get(PDFName.of("Subtype"));
          const subtypeName = subtype ? String(subtype).replace("/", "") : "Unknown";
          const action = annot.lookup(PDFName.of("A"));
          let uri = "";
          if (action instanceof PDFDict) {
            const actionType = action.get(PDFName.of("S"));
            if (actionType && String(actionType) === "/URI") uri = sanitiseForReport(pdfStringValue(action.lookup(PDFName.of("URI"))));
            if (actionType && String(actionType) === "/Launch") uri = sanitiseForReport(pdfStringValue(action.lookup(PDFName.of("F"))));
          }
          if (uri) links.push({ page: pageNumber, subtype: subtypeName, uri });
        }
      }
    } catch {
      // Ignore unreadable annotation arrays.
    }

    try {
      const contents = page.node.Contents();
      const streams = [];
      if (contents instanceof PDFArray) {
        for (let streamIndex = 0; streamIndex < contents.size(); streamIndex++) {
          const stream = contents.lookup(streamIndex);
          if (stream instanceof PDFRawStream) streams.push(stream);
        }
      } else if (contents instanceof PDFRawStream) {
        streams.push(contents);
      }
      let invisible = 0;
      let whiteOnWhite = 0;
      for (const stream of streams) {
        const scan = scanContentForInvisibleText(decodeLatin1(decodePDFRawStream(stream).decode()));
        invisible += scan.invisible;
        whiteOnWhite += scan.whiteOnWhite;
        if (scan.truncated) contentTruncated = true;
      }
      if (invisible || whiteOnWhite) invisibleText.push({ page: pageNumber, invisible, whiteOnWhite });
    } catch {
      // Unparseable / unsupported stream filters are skipped, not fatal.
    }
    onProgress?.(pageNumber, pages.length);
  }

  return {
    pages: pages.length,
    encrypted: Boolean(pdf.isEncrypted),
    info,
    xmp,
    attachments,
    embeddedFileStreams,
    embeddedFileBytes,
    signatures,
    links,
    invisibleText,
    contentTruncated,
  };
}

// --- report -------------------------------------------------------------------

function line(label, value) {
  return `${label}: ${sanitiseForReport(value) || "—"}`;
}

/**
 * Builds the downloadable plain-text report. PII values are masked unless
 * `reveal` is explicitly true, and every value taken from the document is
 * sanitised so untrusted content cannot forge report structure.
 *
 * @param {{ fileName?: string, fileSize?: number, scan?: any, structure?: any, reveal?: boolean, generatedAt?: string | number | Date }} [options]
 */
export function buildPrivacyReportText(options = {}) {
  const { fileName, fileSize, scan, structure, reveal = false, generatedAt } = options;
  const rows = [];
  const stamp = generatedAt ? new Date(generatedAt) : new Date();
  rows.push("MyFileKit — Privacy Scanner report");
  rows.push("Generated entirely in the browser. Nothing was uploaded.");
  rows.push(`Generated: ${stamp.toISOString()}`);
  rows.push(line("File", fileName));
  if (Number.isFinite(fileSize)) rows.push(`Size: ${fileSize} bytes`);
  rows.push(`Pages: ${structure?.pages ?? scan?.pages ?? "unknown"}`);
  rows.push(`PII values shown: ${reveal ? "REVEALED (handle this file as sensitive)" : "masked"}`);
  rows.push("");

  rows.push("== 1. Personal data patterns ==");
  const summary = scan?.summary || summarisePii(scan?.hits || []);
  const coverage = describeUnreadablePages(scan);
  // The unreadable-page warning comes before the counts on purpose: a "0
  // matches" line above it would be read as a clean result.
  if (coverage.unreadable) {
    rows.push(`NOT SCANNED — ${coverage.headline}`);
    rows.push(`  ${coverage.advice}`);
    rows.push(`  Pages with no readable text: ${coverage.unreadablePages.length} of ${coverage.pages || "unknown"}${coverage.readablePages ? ` (${coverage.readablePages} page(s) were scanned)` : ""}.`);
  }
  rows.push(`Total matches: ${summary.total} (high confidence: ${summary.high})`);
  if (!scan?.hasTextLayer) rows.push("No extractable text layer was found — a scanned document cannot be pattern-scanned without OCR.");
  for (const entry of summary.types) rows.push(`  ${entry.label}: ${entry.count} (high: ${entry.high})`);
  rows.push("");
  for (const hit of scan?.hits || []) {
    const shown = reveal ? sanitiseForReport(hit.value) : hit.masked;
    rows.push(`  p${hit.page} · ${PII_TYPE_LABELS[hit.type] || hit.type} · ${confidenceLabel(hit.confidence)} · ${shown}${hit.note ? ` · ${sanitiseForReport(hit.note)}` : ""}`);
  }
  if (!(scan?.hits || []).length) {
    rows.push(coverage.allUnreadable ? "  Nothing was matched because nothing could be read. This is not a clean result." : "  No pattern matches.");
  }
  rows.push("");

  rows.push("== 2. Document metadata ==");
  for (const [key, value] of Object.entries(structure?.info || {})) rows.push(`  ${line(key, value)}`);
  if (structure?.info?.Author || structure?.info?.Creator) rows.push("  NOTE: Author/Creator fields identify who made this file.");
  rows.push(`  XMP packet: ${structure?.xmp?.present ? `present (${structure.xmp.bytes} bytes)` : "not present"}`);
  for (const field of structure?.xmp?.fields || []) rows.push(`    ${line(field.label, field.value)}`);
  rows.push("");

  rows.push("== 3. Hidden or invisible text ==");
  if (!(structure?.invisibleText || []).length) rows.push("  None detected by the operator scan.");
  for (const entry of structure?.invisibleText || []) {
    rows.push(`  p${entry.page}: ${entry.invisible} invisible (rendering mode 3) · ${entry.whiteOnWhite} near-white fill`);
  }
  if (Number.isFinite(scan?.offPageItems) && scan.offPageItems > 0) rows.push(`  ${scan.offPageItems} text item(s) positioned outside the visible page box.`);
  if (structure?.contentTruncated) rows.push("  NOTE: a very large content stream was only partially scanned.");
  rows.push("");

  rows.push("== 4. Links, URLs and IP addresses ==");
  const destinations = (scan?.hits || []).filter((hit) => hit.type === "url" || hit.type === "ipv4" || hit.type === "ipv6");
  if (!destinations.length && !(structure?.links || []).length) rows.push("  None found.");
  for (const hit of destinations) rows.push(`  p${hit.page} · text · ${sanitiseForReport(hit.value)}`);
  for (const link of structure?.links || []) rows.push(`  p${link.page} · /${link.subtype} annotation · ${sanitiseForReport(link.uri)}`);
  rows.push("");

  rows.push("== 5. Attachments and embedded files ==");
  if (!(structure?.attachments || []).length && !structure?.embeddedFileStreams) rows.push("  None found.");
  for (const attachment of structure?.attachments || []) {
    rows.push(`  ${sanitiseForReport(attachment.name || attachment.type)} · ${attachment.type}${attachment.size ? ` · ${attachment.size} bytes` : ""}`);
  }
  if (structure?.embeddedFileStreams) rows.push(`  /EmbeddedFile streams: ${structure.embeddedFileStreams} (${structure.embeddedFileBytes} compressed bytes)`);
  rows.push("");

  rows.push("== 6. Protection ==");
  rows.push(`  Encrypted: ${structure?.encrypted ? "yes" : "no"}`);
  rows.push(`  Digital signature entries: ${(structure?.signatures || []).length}`);
  for (const signature of structure?.signatures || []) rows.push(`    ${line(signature.name, signature.reason || "no reason given")}`);
  rows.push("");

  rows.push("== 7. What this means ==");
  if (coverage.unreadable) rows.push(`  ${coverage.headline} ${coverage.advice}`);
  rows.push(`  ${summary.high} high-confidence personal-data match(es) survived checksum/context validation.`);
  rows.push(`  ${summary.total - summary.high} further match(es) are medium or low confidence and need a human decision.`);
  rows.push("  Limits — read this: this scan finds COMMON patterns only. It cannot guarantee it found every piece of");
  rows.push("  sensitive data. Names, addresses, health and salary details, text inside images, data in attachments,");
  rows.push("  and anything in an unsupported encoding are NOT detected. PAN, IFSC and passport formats have no");
  rows.push("  checksum, so a part code shaped like one is reported as a match. There is no risk score here on purpose:");
  rows.push("  the findings above are the report.");
  return `${rows.join("\n")}\n`;
}
