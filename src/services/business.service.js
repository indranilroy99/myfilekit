// Business tools: Indian GST tax invoices, POS counter billing, GSTR-1 filing
// preparation, and the PDF workflow pipeline.
//
// Everything here is 100% local and never touches the network. All money math is
// done in integer paise so displayed components always reconcile with the total
// (no 0.01 drift), and every pure function is unit-testable in Node.

import { getPdfLib, loadPdf, addPdfPageNumbers, cleanPdfMetadata, extractPdfPages, rotatePdfPages, watermarkPdf } from "./pdf.service.js";
import { organizePdfPages, cropResizePdf } from "./pdf-edit.service.js";
import { compressPdf, flattenPdf, invertPdf } from "./pdf-render.service.js";
import { archivalPrepPdf } from "./pdf-review.service.js";
import { batesNumberPdf } from "./pdf-advanced.service.js";
import { sanitizePdf } from "./pdf-sanitize.service.js";
import { loadXlsx } from "./office.service.js";
import { parseCsv } from "./csv.service.js";
import { parsePageRanges } from "../utils/format.js";

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 42;

// --- Money helpers (integer paise everywhere) ---------------------------------

/** Rupees (or any 2dp amount) -> integer paise. Throws on non-numeric input. */
export function toPaise(amount, label = "Amount") {
  const number = Number(amount);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a valid number.`);
  return Math.round(number * 100);
}

/** Integer paise -> a 2dp number safe to display and to sum in JS. */
export function fromPaise(paise) {
  return Math.round(paise) / 100;
}

export function formatAmount(value) {
  const number = Number(value) || 0;
  const negative = number < 0;
  const [whole, fraction] = Math.abs(number).toFixed(2).split(".");
  // Indian grouping: last three digits, then pairs.
  const head = whole.length > 3 ? whole.slice(0, whole.length - 3) : "";
  const tail = whole.slice(-3);
  const grouped = head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${tail}` : tail;
  return `${negative ? "-" : ""}${grouped}.${fraction}`;
}

// --- Amount in words (Indian numbering: thousand / lakh / crore) --------------

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below100(value) {
  if (value < 20) return ONES[value];
  const unit = value % 10;
  return unit ? `${TENS[Math.floor(value / 10)]} ${ONES[unit]}` : TENS[Math.floor(value / 10)];
}

function indianWords(value) {
  if (value === 0) return "";
  if (value >= 10000000) return `${indianWords(Math.floor(value / 10000000))} Crore${tail(value % 10000000)}`;
  if (value >= 100000) return `${below100(Math.floor(value / 100000))} Lakh${tail(value % 100000)}`;
  if (value >= 1000) return `${below100(Math.floor(value / 1000))} Thousand${tail(value % 1000)}`;
  if (value >= 100) return `${ONES[Math.floor(value / 100)]} Hundred${tail(value % 100)}`;
  return below100(value);
}

function tail(rest) {
  const words = indianWords(rest);
  return words ? ` ${words}` : "";
}

/**
 * Indian-format amount in words. 125000 -> "One Lakh Twenty Five Thousand".
 * Paise are appended as "... and Fifty Paise" only when non-zero.
 */
export function amountInWords(amount) {
  const paise = toPaise(amount, "Amount in words");
  const sign = paise < 0 ? "Minus " : "";
  const absolute = Math.abs(paise);
  const rupees = Math.floor(absolute / 100);
  const fraction = absolute % 100;
  const words = indianWords(rupees) || "Zero";
  return `${sign}${words}${fraction ? ` and ${indianWords(fraction)} Paise` : ""}`;
}

// --- GSTIN validation ---------------------------------------------------------

// 2-digit state code + 10-char PAN + entity digit + 'Z' + checksum character.
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const CHECKSUM_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const STATE_CODES = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan",
  "09": "Uttar Pradesh", 10: "Bihar", 11: "Sikkim", 12: "Arunachal Pradesh",
  13: "Nagaland", 14: "Manipur", 15: "Mizoram", 16: "Tripura",
  17: "Meghalaya", 18: "Assam", 19: "West Bengal", 20: "Jharkhand",
  21: "Odisha", 22: "Chhattisgarh", 23: "Madhya Pradesh", 24: "Gujarat",
  25: "Daman and Diu", 26: "Dadra and Nagar Haveli and Daman and Diu", 27: "Maharashtra", 28: "Andhra Pradesh (old)",
  29: "Karnataka", 30: "Goa", 31: "Lakshadweep", 32: "Kerala",
  33: "Tamil Nadu", 34: "Puducherry", 35: "Andaman and Nicobar Islands", 36: "Telangana",
  37: "Andhra Pradesh", 38: "Ladakh", 97: "Other Territory", 99: "Centre Jurisdiction",
};

export function stateName(code) {
  return STATE_CODES[String(code)] || "";
}

/** Luhn mod-36 checksum used by GSTIN (last character). */
function gstinChecksum(first14) {
  const mod = CHECKSUM_ALPHABET.length;
  let factor = 2;
  let sum = 0;
  for (let index = 13; index >= 0; index -= 1) {
    const point = CHECKSUM_ALPHABET.indexOf(first14[index]);
    if (point < 0) return "";
    const product = factor * point;
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(product / mod) + (product % mod);
  }
  return CHECKSUM_ALPHABET[(mod - (sum % mod)) % mod];
}

/**
 * Non-blocking GSTIN check. Returns { value, present, valid, stateCode, reason }
 * so callers can warn instead of refusing to build a document.
 */
export function validateGstin(gstin) {
  const value = String(gstin || "").trim().toUpperCase();
  if (!value) return { value: "", present: false, valid: false, stateCode: "", reason: "No GSTIN provided." };
  if (value.length !== 15) return { value, present: true, valid: false, stateCode: "", reason: `GSTIN must be 15 characters (got ${value.length}).` };
  if (!GSTIN_SHAPE.test(value)) return { value, present: true, valid: false, stateCode: "", reason: "GSTIN format looks wrong (expected 2-digit state code, 10-character PAN, entity digit, 'Z', checksum)." };
  const stateCode = value.slice(0, 2);
  if (!STATE_CODES[stateCode] && !STATE_CODES[Number(stateCode)]) {
    return { value, present: true, valid: false, stateCode, reason: `State code "${stateCode}" is not a known GST state code.` };
  }
  const expected = gstinChecksum(value.slice(0, 14));
  if (expected && expected !== value[14]) {
    return { value, present: true, valid: false, stateCode, reason: `Checksum character should be "${expected}".` };
  }
  return { value, present: true, valid: true, stateCode, reason: "" };
}

/** Leading 2-digit state code from a GSTIN, a "27" code, or "27 - Maharashtra". */
export function resolveStateCode(gstin, fallback = "") {
  const checked = validateGstin(gstin);
  if (checked.stateCode) return checked.stateCode;
  const text = String(fallback || "").trim();
  const digits = text.match(/^(\d{1,2})/);
  if (digits) {
    const padded = digits[1].padStart(2, "0");
    if (STATE_CODES[padded] || STATE_CODES[Number(padded)]) return padded;
  }
  const lower = text.toLowerCase();
  for (const [code, name] of Object.entries(STATE_CODES)) {
    if (name.toLowerCase() === lower) return String(code).padStart(2, "0");
  }
  return "";
}

// --- GST invoice --------------------------------------------------------------

const STANDARD_SLABS = [0, 0.25, 3, 5, 12, 18, 28];

/**
 * Computes a full Indian GST tax invoice.
 *
 * Tax split: when the seller's and the buyer's state codes match the supply is
 * intra-state and the GST rate is halved into CGST + SGST; otherwise it is
 * inter-state and the full rate is charged as IGST.
 *
 * Discount on a line is a percentage of that line's gross value.
 */
export function computeGstInvoice(input = {}) {
  const seller = input.seller || {};
  const buyer = input.buyer || {};
  const items = Array.isArray(input.items) ? input.items : [];

  const sellerName = String(seller.name || "").trim();
  const buyerName = String(buyer.name || "").trim();
  const invoiceNo = String(input.invoiceNo || "").trim();
  if (!sellerName) throw new Error("Enter the seller (your business) name.");
  if (!buyerName) throw new Error("Enter the buyer name.");
  if (!invoiceNo) throw new Error("Enter an invoice number.");

  const rows = items.filter((item) => String(item?.description || "").trim() || Number(item?.qty) || Number(item?.rate));
  if (!rows.length) throw new Error("Add at least one line item.");

  const warnings = [];
  const sellerGstin = validateGstin(seller.gstin);
  const buyerGstin = validateGstin(buyer.gstin);
  if (!sellerGstin.present) warnings.push("Seller GSTIN is empty — a tax invoice normally needs one.");
  else if (!sellerGstin.valid) warnings.push(`Seller GSTIN "${sellerGstin.value}" looks wrong: ${sellerGstin.reason}`);
  if (buyerGstin.present && !buyerGstin.valid) warnings.push(`Buyer GSTIN "${buyerGstin.value}" looks wrong: ${buyerGstin.reason}`);

  const sellerStateCode = resolveStateCode(seller.gstin, seller.state);
  const placeOfSupplyCode = resolveStateCode("", input.placeOfSupply || buyer.state);
  const buyerStateCode = buyerGstin.stateCode || placeOfSupplyCode;
  if (!sellerStateCode) warnings.push("Seller state code could not be determined, so CGST/SGST vs IGST was assumed inter-state.");
  if (!buyerStateCode) warnings.push("Place of supply state code is missing, so CGST/SGST vs IGST was assumed inter-state.");
  if (buyerGstin.stateCode && placeOfSupplyCode && buyerGstin.stateCode !== placeOfSupplyCode) {
    warnings.push(`Buyer GSTIN state (${buyerGstin.stateCode}) and place of supply (${placeOfSupplyCode}) differ — IGST/CGST split follows the buyer GSTIN.`);
  }
  const interState = !(sellerStateCode && buyerStateCode && sellerStateCode === buyerStateCode);

  let taxablePaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  let discountPaise = 0;

  const lines = rows.map((item, index) => {
    const label = `Line ${index + 1}`;
    const description = String(item.description || "").trim() || `Item ${index + 1}`;
    const qty = Number(item.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`${label}: quantity must be greater than zero.`);
    const rate = Number(item.rate);
    if (!Number.isFinite(rate) || rate < 0) throw new Error(`${label}: rate must be zero or more.`);
    const discountPercent = item.discountPercent === "" || item.discountPercent == null ? 0 : Number(item.discountPercent);
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) throw new Error(`${label}: discount must be between 0 and 100 percent.`);
    const gstRate = item.gstRate === "" || item.gstRate == null ? 0 : Number(item.gstRate);
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) throw new Error(`${label}: GST rate must be between 0 and 100 percent.`);
    if (!STANDARD_SLABS.includes(gstRate)) warnings.push(`${label}: ${gstRate}% is not a standard GST slab (${STANDARD_SLABS.join("/")}%).`);

    const grossPaise = Math.round(qty * toPaise(rate, `${label} rate`));
    const lineDiscountPaise = Math.round((grossPaise * discountPercent) / 100);
    const lineTaxablePaise = grossPaise - lineDiscountPaise;
    // Each tax component is rounded on its own and the line tax is their sum, so
    // components always add up to the printed tax and total.
    const lineCgst = interState ? 0 : Math.round((lineTaxablePaise * gstRate) / 200);
    const lineSgst = interState ? 0 : lineCgst;
    const lineIgst = interState ? Math.round((lineTaxablePaise * gstRate) / 100) : 0;
    const lineTax = lineCgst + lineSgst + lineIgst;

    taxablePaise += lineTaxablePaise;
    discountPaise += lineDiscountPaise;
    cgstPaise += lineCgst;
    sgstPaise += lineSgst;
    igstPaise += lineIgst;

    return {
      index: index + 1,
      description,
      hsn: String(item.hsn || "").trim(),
      unit: String(item.unit || "").trim() || "NOS",
      qty,
      rate: fromPaise(toPaise(rate, `${label} rate`)),
      discountPercent,
      gross: fromPaise(grossPaise),
      discount: fromPaise(lineDiscountPaise),
      taxable: fromPaise(lineTaxablePaise),
      gstRate,
      cgstRate: interState ? 0 : gstRate / 2,
      sgstRate: interState ? 0 : gstRate / 2,
      igstRate: interState ? gstRate : 0,
      cgst: fromPaise(lineCgst),
      sgst: fromPaise(lineSgst),
      igst: fromPaise(lineIgst),
      tax: fromPaise(lineTax),
      total: fromPaise(lineTaxablePaise + lineTax),
    };
  });

  const taxPaise = cgstPaise + sgstPaise + igstPaise;
  const beforeRoundPaise = taxablePaise + taxPaise;
  const grandTotalPaise = Math.round(beforeRoundPaise / 100) * 100;
  const roundOffPaise = grandTotalPaise - beforeRoundPaise;

  return {
    invoiceNo,
    invoiceDate: String(input.invoiceDate || "").trim(),
    seller: { name: sellerName, address: String(seller.address || "").trim(), gstin: sellerGstin.value, stateCode: sellerStateCode },
    buyer: { name: buyerName, address: String(buyer.address || "").trim(), gstin: buyerGstin.value, stateCode: buyerStateCode },
    placeOfSupply: placeOfSupplyCode ? `${placeOfSupplyCode} - ${stateName(placeOfSupplyCode)}` : String(input.placeOfSupply || "").trim(),
    interState,
    supplyType: interState ? "Inter-state (IGST)" : "Intra-state (CGST + SGST)",
    lines,
    totals: {
      discount: fromPaise(discountPaise),
      taxable: fromPaise(taxablePaise),
      cgst: fromPaise(cgstPaise),
      sgst: fromPaise(sgstPaise),
      igst: fromPaise(igstPaise),
      tax: fromPaise(taxPaise),
      beforeRound: fromPaise(beforeRoundPaise),
      roundOff: fromPaise(roundOffPaise),
      grandTotal: fromPaise(grandTotalPaise),
    },
    amountInWords: `INR ${amountInWords(fromPaise(grandTotalPaise))} Only`,
    warnings,
  };
}

/** Renders a computed GST invoice as a vector-text PDF. */
export async function gstInvoicePdf(invoice) {
  const { PDFDocument, StandardFonts, rgb } = getPdfLib();
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.08, 0.1, 0.15);
  const muted = rgb(0.42, 0.45, 0.5);

  const sheet = createSheet(pdf, { regular, bold, ink });
  sheet.heading("TAX INVOICE", 16);
  sheet.gap(6);

  const halfWidth = (A4.width - MARGIN * 2) / 2 - 6;
  const topY = sheet.cursor();
  sheet.block(MARGIN, topY, halfWidth, [
    { text: "Supplier", size: 8, color: muted },
    { text: invoice.seller.name, size: 11, bold: true },
    ...addressLines(invoice.seller.address).map((line) => ({ text: line, size: 9 })),
    { text: `GSTIN: ${invoice.seller.gstin || "-"}`, size: 9, bold: true },
    { text: `State code: ${invoice.seller.stateCode || "-"} ${stateName(invoice.seller.stateCode)}`.trim(), size: 8, color: muted },
  ]);
  const rightY = sheet.block(MARGIN + halfWidth + 12, topY, halfWidth, [
    { text: "Invoice details", size: 8, color: muted },
    { text: `Invoice no: ${invoice.invoiceNo}`, size: 10, bold: true },
    { text: `Invoice date: ${invoice.invoiceDate || "-"}`, size: 9 },
    { text: `Place of supply: ${invoice.placeOfSupply || "-"}`, size: 9 },
    { text: `Supply type: ${invoice.supplyType}`, size: 9, bold: true },
  ]);
  sheet.moveTo(Math.min(sheet.cursor(), rightY));
  sheet.gap(10);

  sheet.block(MARGIN, sheet.cursor(), A4.width - MARGIN * 2, [
    { text: "Recipient", size: 8, color: muted },
    { text: invoice.buyer.name, size: 11, bold: true },
    ...addressLines(invoice.buyer.address).map((line) => ({ text: line, size: 9 })),
    { text: `GSTIN: ${invoice.buyer.gstin || "Unregistered"}`, size: 9, bold: true },
  ]);
  sheet.gap(12);

  const columns = invoice.interState
    ? [
      { label: "#", width: 20, align: "right" },
      { label: "Description", width: 150 },
      { label: "HSN/SAC", width: 52 },
      { label: "Qty", width: 34, align: "right" },
      { label: "Unit", width: 30 },
      { label: "Rate", width: 52, align: "right" },
      { label: "Disc %", width: 34, align: "right" },
      { label: "Taxable", width: 58, align: "right" },
      { label: "IGST %", width: 34, align: "right" },
      { label: "IGST", width: 47, align: "right" },
    ]
    : [
      { label: "#", width: 18, align: "right" },
      { label: "Description", width: 122 },
      { label: "HSN/SAC", width: 48 },
      { label: "Qty", width: 30, align: "right" },
      { label: "Unit", width: 26 },
      { label: "Rate", width: 46, align: "right" },
      { label: "Disc %", width: 30, align: "right" },
      { label: "Taxable", width: 52, align: "right" },
      { label: "CGST", width: 57, align: "right" },
      { label: "SGST", width: 57, align: "right" },
    ];

  const body = invoice.lines.map((line) => invoice.interState
    ? [String(line.index), line.description, line.hsn || "-", trimNumber(line.qty), line.unit, formatAmount(line.rate), trimNumber(line.discountPercent), formatAmount(line.taxable), trimNumber(line.igstRate), formatAmount(line.igst)]
    : [String(line.index), line.description, line.hsn || "-", trimNumber(line.qty), line.unit, formatAmount(line.rate), trimNumber(line.discountPercent), formatAmount(line.taxable), formatAmount(line.cgst), formatAmount(line.sgst)]);

  sheet.table(columns, body);
  sheet.gap(10);

  const totalRows = [
    ["Taxable value", formatAmount(invoice.totals.taxable)],
    ...(invoice.interState
      ? [["IGST", formatAmount(invoice.totals.igst)]]
      : [["CGST", formatAmount(invoice.totals.cgst)], ["SGST", formatAmount(invoice.totals.sgst)]]),
    ["Round off", formatAmount(invoice.totals.roundOff)],
    ["Grand total (INR)", formatAmount(invoice.totals.grandTotal)],
  ];
  sheet.totals(totalRows);
  sheet.gap(8);
  sheet.paragraph(`Amount in words: ${invoice.amountInWords}`, { size: 9, bold: true });
  sheet.gap(6);
  sheet.paragraph("Prepared locally in MyFileKit. Reverse charge, TCS/TDS, and GST cess are not applied by this tool.", { size: 8, color: muted });
  return pdf.save();
}

function addressLines(address) {
  return String(address || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function trimNumber(value) {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(3)));
}

// --- POS billing --------------------------------------------------------------

/**
 * Computes one counter bill. Items are { name, price, taxPercent, qty }; the
 * bill-level discount percentage is spread across lines by largest remainder so
 * the line taxable values always add back up to the discounted subtotal.
 */
export function computePosBill(input = {}) {
  const items = (Array.isArray(input.items) ? input.items : []).filter((item) => Number(item?.qty) > 0);
  if (!items.length) throw new Error("Add at least one item to the bill.");

  const discountPercent = input.discountPercent === "" || input.discountPercent == null ? 0 : Number(input.discountPercent);
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) throw new Error("Bill discount must be between 0 and 100 percent.");

  const paymentMode = String(input.paymentMode || "cash").toLowerCase();
  if (!["cash", "card", "upi"].includes(paymentMode)) throw new Error("Payment mode must be cash, card, or UPI.");

  const grossPaise = [];
  const prepared = items.map((item, index) => {
    const label = `Item ${index + 1}`;
    const qty = Number(item.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`${label}: quantity must be greater than zero.`);
    const pricePaise = toPaise(item.price, `${label} price`);
    if (pricePaise < 0) throw new Error(`${label}: price cannot be negative.`);
    const taxPercent = item.taxPercent === "" || item.taxPercent == null ? 0 : Number(item.taxPercent);
    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) throw new Error(`${label}: tax must be between 0 and 100 percent.`);
    const gross = Math.round(qty * pricePaise);
    grossPaise.push(gross);
    return { name: String(item.name || "").trim() || `Item ${index + 1}`, qty, price: fromPaise(pricePaise), taxPercent, gross };
  });

  const subtotalPaise = grossPaise.reduce((sum, value) => sum + value, 0);
  const discountPaise = Math.round((subtotalPaise * discountPercent) / 100);
  const shares = allocate(discountPaise, grossPaise);

  let taxablePaise = 0;
  let taxPaise = 0;
  const lines = prepared.map((item, index) => {
    const lineTaxable = item.gross - shares[index];
    const lineTax = Math.round((lineTaxable * item.taxPercent) / 100);
    taxablePaise += lineTaxable;
    taxPaise += lineTax;
    return {
      name: item.name,
      qty: item.qty,
      price: item.price,
      taxPercent: item.taxPercent,
      gross: fromPaise(item.gross),
      discount: fromPaise(shares[index]),
      taxable: fromPaise(lineTaxable),
      tax: fromPaise(lineTax),
      total: fromPaise(lineTaxable + lineTax),
    };
  });

  const beforeRoundPaise = taxablePaise + taxPaise;
  const payablePaise = Math.round(beforeRoundPaise / 100) * 100;
  const roundOffPaise = payablePaise - beforeRoundPaise;

  let tenderedPaise = null;
  let changePaise = null;
  if (paymentMode === "cash") {
    if (input.cashTendered === "" || input.cashTendered == null) throw new Error("Enter the cash amount received.");
    tenderedPaise = toPaise(input.cashTendered, "Cash received");
    if (tenderedPaise < payablePaise) throw new Error(`Cash received is short by INR ${formatAmount(fromPaise(payablePaise - tenderedPaise))}.`);
    changePaise = tenderedPaise - payablePaise;
  }

  return {
    billNo: String(input.billNo || "").trim(),
    createdAt: String(input.createdAt || "").trim(),
    lines,
    paymentMode,
    discountPercent,
    totals: {
      subtotal: fromPaise(subtotalPaise),
      discount: fromPaise(discountPaise),
      taxable: fromPaise(taxablePaise),
      tax: fromPaise(taxPaise),
      beforeRound: fromPaise(beforeRoundPaise),
      roundOff: fromPaise(roundOffPaise),
      payable: fromPaise(payablePaise),
      tendered: tenderedPaise == null ? null : fromPaise(tenderedPaise),
      change: changePaise == null ? null : fromPaise(changePaise),
    },
    itemCount: lines.reduce((sum, line) => sum + line.qty, 0),
  };
}

/**
 * Splits `total` paise across `weights` so the parts sum to exactly `total`
 * (largest-remainder method).
 */
function allocate(total, weights) {
  const sum = weights.reduce((value, weight) => value + weight, 0);
  if (!total || !sum) return weights.map(() => 0);
  const exact = weights.map((weight) => (total * weight) / sum);
  const parts = exact.map((value) => Math.floor(value));
  let remainder = total - parts.reduce((value, part) => value + part, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let step = 0; remainder > 0 && step < order.length; step += 1) {
    parts[order[step].index] += 1;
    remainder -= 1;
  }
  return parts;
}

const RECEIPT_WIDTH = 226.77; // 80 mm thermal roll, in PostScript points.

/** Compact thermal-style receipt PDF (one tall page, 80mm wide). */
export async function posReceiptPdf(bill, options = {}) {
  const { PDFDocument, StandardFonts, rgb } = getPdfLib();
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.05, 0.06, 0.09);
  const margin = 12;
  const innerWidth = RECEIPT_WIDTH - margin * 2;

  const rows = [];
  const push = (left, right = "", { size = 8, weight = "regular", align = "split" } = {}) => rows.push({ left, right, size, weight, align });
  const rule = () => rows.push({ rule: true });

  push(String(options.shopName || "MyFileKit Store"), "", { size: 11, weight: "bold", align: "center" });
  if (options.shopLine) push(String(options.shopLine), "", { size: 7, align: "center" });
  if (options.gstin) push(`GSTIN: ${options.gstin}`, "", { size: 7, align: "center" });
  rule();
  push(`Bill ${bill.billNo || "-"}`, bill.createdAt || "", { size: 7 });
  push(`Payment: ${bill.paymentMode.toUpperCase()}`, `${bill.itemCount} item${bill.itemCount === 1 ? "" : "s"}`, { size: 7 });
  rule();
  for (const line of bill.lines) {
    push(line.name, formatAmount(line.total), { size: 8, weight: "bold" });
    push(`  ${trimNumber(line.qty)} x ${formatAmount(line.price)}${line.taxPercent ? ` @ ${trimNumber(line.taxPercent)}% tax` : ""}`, "", { size: 7 });
  }
  rule();
  push("Subtotal", formatAmount(bill.totals.subtotal), { size: 8 });
  if (bill.totals.discount) push(`Discount (${trimNumber(bill.discountPercent)}%)`, `-${formatAmount(bill.totals.discount)}`, { size: 8 });
  push("Taxable", formatAmount(bill.totals.taxable), { size: 8 });
  push("Tax", formatAmount(bill.totals.tax), { size: 8 });
  if (bill.totals.roundOff) push("Round off", formatAmount(bill.totals.roundOff), { size: 8 });
  push("TOTAL", formatAmount(bill.totals.payable), { size: 10, weight: "bold" });
  if (bill.totals.tendered != null) {
    push("Cash", formatAmount(bill.totals.tendered), { size: 8 });
    push("Change", formatAmount(bill.totals.change), { size: 8, weight: "bold" });
  }
  rule();
  push("Thank you. Prepared locally in MyFileKit.", "", { size: 6, align: "center" });

  const height = rows.reduce((total, row) => total + (row.rule ? 6 : row.size * 1.5), margin * 2);
  const page = pdf.addPage([RECEIPT_WIDTH, Math.max(120, height)]);
  let y = Math.max(120, height) - margin;

  for (const row of rows) {
    if (row.rule) {
      y -= 3;
      page.drawLine({ start: { x: margin, y }, end: { x: margin + innerWidth, y }, thickness: 0.5, color: rgb(0.6, 0.62, 0.66) });
      y -= 3;
      continue;
    }
    const font = row.weight === "bold" ? bold : regular;
    y -= row.size * 1.5;
    if (row.align === "center") {
      const width = safeWidth(font, row.left, row.size);
      drawSafeText(page, row.left, { x: margin + (innerWidth - width) / 2, y, size: row.size, font, color: ink });
      continue;
    }
    const rightWidth = row.right ? safeWidth(font, row.right, row.size) : 0;
    const leftText = clipToWidth(font, row.left, row.size, innerWidth - rightWidth - 4);
    drawSafeText(page, leftText, { x: margin, y, size: row.size, font, color: ink });
    if (row.right) drawSafeText(page, row.right, { x: margin + innerWidth - rightWidth, y, size: row.size, font, color: ink });
  }
  return pdf.save();
}

/** Daily roll-up for the session's saved bills. */
export function summarisePosSession(bills) {
  const list = Array.isArray(bills) ? bills : [];
  let payablePaise = 0;
  let taxPaise = 0;
  let discountPaise = 0;
  let items = 0;
  const byMode = { cash: 0, card: 0, upi: 0 };
  for (const bill of list) {
    payablePaise += toPaise(bill?.totals?.payable ?? 0, "Bill total");
    taxPaise += toPaise(bill?.totals?.tax ?? 0, "Bill tax");
    discountPaise += toPaise(bill?.totals?.discount ?? 0, "Bill discount");
    items += Number(bill?.itemCount) || 0;
    const mode = String(bill?.paymentMode || "cash").toLowerCase();
    if (mode in byMode) byMode[mode] += toPaise(bill?.totals?.payable ?? 0, "Bill total");
  }
  return {
    bills: list.length,
    items,
    tax: fromPaise(taxPaise),
    discount: fromPaise(discountPaise),
    total: fromPaise(payablePaise),
    byMode: { cash: fromPaise(byMode.cash), card: fromPaise(byMode.card), upi: fromPaise(byMode.upi) },
  };
}

// --- GST filing prep (GSTR-1 style summary) -----------------------------------

const COLUMN_MATCHERS = [
  ["invoiceNo", /^(invoice|inv|bill)[\s_-]*(no|num|number|#)?$/],
  ["invoiceDate", /^(invoice|inv|bill)?[\s_-]*date$/],
  ["gstin", /gstin|gst[\s_-]*(no|number)|buyer[\s_-]*gst/],
  ["placeOfSupply", /place[\s_-]*of[\s_-]*supply|^pos$|^state$/],
  ["taxable", /taxable/],
  ["rate", /^(gst[\s_-]*)?rate/],
  ["cgst", /^cgst/],
  ["sgst", /^(sgst|utgst)/],
  ["igst", /^igst/],
];

function normaliseHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[()%.]/g, "").trim();
}

/** Maps a header row onto the fields we need. Returns { field: columnIndex }. */
export function mapGstr1Columns(header) {
  const map = {};
  (header || []).forEach((cell, index) => {
    const name = normaliseHeader(cell);
    if (!name) return;
    for (const [field, pattern] of COLUMN_MATCHERS) {
      if (map[field] === undefined && pattern.test(name)) {
        map[field] = index;
        return;
      }
    }
  });
  return map;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(String(value).replace(/[,\s]/g, "").replace(/^INR/i, ""));
  return Number.isFinite(number) ? number : null;
}

/** Accepts Date objects, Excel serial numbers, dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd. */
export function normaliseInvoiceDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { ok: true, iso: value.toISOString().slice(0, 10) };
  }
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: false, iso: "", reason: "Invoice date is missing." };
  if (/^\d+(\.\d+)?$/.test(raw) && Number(raw) > 59 && Number(raw) < 100000) {
    // Excel serial date (1900 system, accounting for its phantom leap day).
    const date = new Date(Date.UTC(1899, 11, 30) + Number(raw) * 86400000);
    return { ok: true, iso: date.toISOString().slice(0, 10) };
  }
  const dmy = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  const ymd = raw.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  let year;
  let month;
  let day;
  if (ymd) {
    [, year, month, day] = ymd.map(Number);
  } else if (dmy) {
    [, day, month, year] = dmy.map(Number);
    if (year < 100) year += 2000;
  } else {
    return { ok: false, iso: "", reason: `Invoice date "${raw}" is not a recognised date (use dd/mm/yyyy or yyyy-mm-dd).` };
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return { ok: false, iso: "", reason: `Invoice date "${raw}" has an out-of-range day or month.` };
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { ok: false, iso: "", reason: `Invoice date "${raw}" is not a real calendar date.` };
  return { ok: true, iso: date.toISOString().slice(0, 10) };
}

/**
 * Builds a GSTR-1-style summary from rows of sales invoices (array-of-arrays,
 * first row = header). B2B = buyer GSTIN present; everything else is B2C.
 *
 * This only prepares a summary for filing. It does not file anything with the
 * government and is not a substitute for the GST portal or your accountant.
 */
export function summariseGstr1(rows, options = {}) {
  const tolerance = Number(options.tolerance ?? 1); // rupees
  const table = (Array.isArray(rows) ? rows : []).filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? "").trim() !== ""));
  if (table.length < 2) throw new Error("The file needs a header row and at least one invoice row.");
  const [header, ...body] = table;
  const columns = mapGstr1Columns(header);
  const missing = ["taxable", "rate"].filter((field) => columns[field] === undefined);
  if (missing.length) {
    throw new Error(`Could not find a ${missing.join(" and ")} column. Expected headers like: invoice no, date, buyer GSTIN, place of supply, taxable value, GST rate, CGST, SGST, IGST.`);
  }

  const buckets = { b2b: emptyBucket(), b2c: emptyBucket() };
  const rateMap = new Map();
  const needsReview = [];
  const invoices = new Set();

  body.forEach((row, index) => {
    const rowNumber = index + 2; // 1-based, including the header row
    const cell = (field) => (columns[field] === undefined ? "" : row[columns[field]]);
    const issues = [];

    const invoiceNo = String(cell("invoiceNo") ?? "").trim();
    if (!invoiceNo) issues.push("Invoice number is missing.");

    const gstinRaw = String(cell("gstin") ?? "").trim();
    const gstin = validateGstin(gstinRaw);
    if (gstin.present && !gstin.valid) issues.push(`Buyer GSTIN "${gstin.value}" is malformed: ${gstin.reason}`);

    const dateCheck = normaliseInvoiceDate(cell("invoiceDate"));
    if (!dateCheck.ok) issues.push(dateCheck.reason);

    const taxable = toNumberOrNull(cell("taxable"));
    if (taxable === null) issues.push("Taxable value is missing or not a number.");
    else if (taxable < 0) issues.push("Taxable value is negative.");
    const rate = toNumberOrNull(cell("rate"));
    if (rate === null) issues.push("GST rate is missing or not a number.");

    const cgst = toNumberOrNull(cell("cgst")) || 0;
    const sgst = toNumberOrNull(cell("sgst")) || 0;
    const igst = toNumberOrNull(cell("igst")) || 0;
    if (igst && (cgst || sgst)) issues.push("Row carries both IGST and CGST/SGST.");

    if (taxable !== null && rate !== null) {
      const expected = (taxable * rate) / 100;
      const reported = cgst + sgst + igst;
      if (Math.abs(expected - reported) > tolerance) {
        issues.push(`Tax ${formatAmount(reported)} does not match taxable x rate (${formatAmount(expected)}).`);
      }
    }

    const isB2b = gstin.present;
    const bucket = isB2b ? buckets.b2b : buckets.b2c;
    const taxablePaise = taxable === null ? 0 : toPaise(taxable, "Taxable value");
    const cgstPaise = toPaise(cgst, "CGST");
    const sgstPaise = toPaise(sgst, "SGST");
    const igstPaise = toPaise(igst, "IGST");

    bucket.rows += 1;
    bucket.taxable += taxablePaise;
    bucket.cgst += cgstPaise;
    bucket.sgst += sgstPaise;
    bucket.igst += igstPaise;
    if (invoiceNo) bucket.invoices.add(invoiceNo);
    if (invoiceNo) invoices.add(invoiceNo);

    const slab = rate === null ? "unknown" : String(rate);
    if (!rateMap.has(slab)) rateMap.set(slab, { rate: rate === null ? null : rate, ...emptyBucket() });
    const slabBucket = rateMap.get(slab);
    slabBucket.rows += 1;
    slabBucket.taxable += taxablePaise;
    slabBucket.cgst += cgstPaise;
    slabBucket.sgst += sgstPaise;
    slabBucket.igst += igstPaise;
    if (invoiceNo) slabBucket.invoices.add(invoiceNo);

    if (issues.length) {
      needsReview.push({ row: rowNumber, invoiceNo: invoiceNo || "(no invoice no)", gstin: gstin.value, issues });
    }
  });

  const rateWise = [...rateMap.values()]
    .map(sealBucket)
    .sort((a, b) => (a.rate ?? 999) - (b.rate ?? 999));
  const totals = mergeBuckets([buckets.b2b, buckets.b2c]);

  return {
    rowCount: body.length,
    invoiceCount: invoices.size,
    b2b: sealBucket(buckets.b2b),
    b2c: sealBucket(buckets.b2c),
    rateWise,
    totals,
    needsReview,
    columns,
    disclaimer: "Summary prepared locally for GSTR-1 filing. MyFileKit does not file anything with the government.",
  };
}

function emptyBucket() {
  return { rows: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, invoices: new Set() };
}

function sealBucket(bucket) {
  return {
    ...(bucket.rate === undefined ? {} : { rate: bucket.rate }),
    rows: bucket.rows,
    invoices: bucket.invoices.size,
    taxable: fromPaise(bucket.taxable),
    cgst: fromPaise(bucket.cgst),
    sgst: fromPaise(bucket.sgst),
    igst: fromPaise(bucket.igst),
    tax: fromPaise(bucket.cgst + bucket.sgst + bucket.igst),
    total: fromPaise(bucket.taxable + bucket.cgst + bucket.sgst + bucket.igst),
  };
}

function mergeBuckets(list) {
  const merged = emptyBucket();
  for (const bucket of list) {
    merged.rows += bucket.rows;
    merged.taxable += bucket.taxable;
    merged.cgst += bucket.cgst;
    merged.sgst += bucket.sgst;
    merged.igst += bucket.igst;
    for (const invoice of bucket.invoices) merged.invoices.add(invoice);
  }
  return sealBucket(merged);
}

/** Reads sales-invoice rows out of a CSV or XLSX file as an array-of-arrays. */
export async function readInvoiceRows(file) {
  const name = String(file?.name || "").toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (name.endsWith(".csv") || file?.type === "text/csv") {
    const text = new TextDecoder().decode(bytes);
    return parseCsv(text);
  }
  const XLSX = await loadXlsx();
  let workbook;
  try {
    workbook = XLSX.read(bytes, { type: "array", cellDates: true });
  } catch {
    throw new Error("This file could not be read as a spreadsheet. Supported formats are .csv, .xlsx, and .xls.");
  }
  const sheetName = (workbook.SheetNames || [])[0];
  if (!sheetName) throw new Error("No sheets were found in this workbook.");
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: false, defval: "" });
}

/** Flat rows (array-of-arrays) for the downloadable summary. */
export function gstr1SummaryRows(summary) {
  const rows = [
    ["GSTR-1 style summary (prepared locally, not filed)"],
    [],
    ["Section", "Invoices", "Rows", "Taxable value", "CGST", "SGST", "IGST", "Total tax", "Invoice value"],
    ["B2B (buyer GSTIN present)", summary.b2b.invoices, summary.b2b.rows, summary.b2b.taxable, summary.b2b.cgst, summary.b2b.sgst, summary.b2b.igst, summary.b2b.tax, summary.b2b.total],
    ["B2C (no buyer GSTIN)", summary.b2c.invoices, summary.b2c.rows, summary.b2c.taxable, summary.b2c.cgst, summary.b2c.sgst, summary.b2c.igst, summary.b2c.tax, summary.b2c.total],
    ["Total", summary.totals.invoices, summary.totals.rows, summary.totals.taxable, summary.totals.cgst, summary.totals.sgst, summary.totals.igst, summary.totals.tax, summary.totals.total],
    [],
    ["Rate slab (%)", "Invoices", "Rows", "Taxable value", "CGST", "SGST", "IGST", "Total tax", "Invoice value"],
  ];
  for (const slab of summary.rateWise) {
    rows.push([slab.rate === null ? "unknown" : slab.rate, slab.invoices, slab.rows, slab.taxable, slab.cgst, slab.sgst, slab.igst, slab.tax, slab.total]);
  }
  rows.push([], ["Needs review", summary.needsReview.length]);
  if (summary.needsReview.length) {
    rows.push(["Row", "Invoice no", "Buyer GSTIN", "Issues"]);
    for (const item of summary.needsReview) rows.push([item.row, item.invoiceNo, item.gstin, item.issues.join(" ")]);
  }
  return rows;
}

export function gstr1SummaryCsv(summary) {
  return gstr1SummaryRows(summary)
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function gstr1SummaryXlsx(summary) {
  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(gstr1SummaryRows(summary)), "Summary");
  const reviewRows = [["Row", "Invoice no", "Buyer GSTIN", "Issues"], ...summary.needsReview.map((item) => [item.row, item.invoiceNo, item.gstin, item.issues.join(" ")])];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(reviewRows), "Needs review");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}

export async function gstr1SummaryPdf(summary, options = {}) {
  const { PDFDocument, StandardFonts, rgb } = getPdfLib();
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const sheet = createSheet(pdf, { regular, bold, ink: rgb(0.08, 0.1, 0.15) });
  const muted = rgb(0.42, 0.45, 0.5);

  sheet.heading("GSTR-1 SUMMARY (PREPARED LOCALLY)", 14);
  sheet.paragraph(`Source: ${options.sourceName || "imported invoices"} — ${summary.rowCount} row${summary.rowCount === 1 ? "" : "s"}, ${summary.invoiceCount} invoice number${summary.invoiceCount === 1 ? "" : "s"}.`, { size: 9, color: muted });
  sheet.gap(10);

  const sectionColumns = [
    { label: "Section", width: 150 },
    { label: "Invoices", width: 48, align: "right" },
    { label: "Taxable", width: 66, align: "right" },
    { label: "CGST", width: 58, align: "right" },
    { label: "SGST", width: 58, align: "right" },
    { label: "IGST", width: 58, align: "right" },
    { label: "Total tax", width: 62, align: "right" },
  ];
  sheet.table(sectionColumns, [
    ["B2B (buyer GSTIN present)", String(summary.b2b.invoices), formatAmount(summary.b2b.taxable), formatAmount(summary.b2b.cgst), formatAmount(summary.b2b.sgst), formatAmount(summary.b2b.igst), formatAmount(summary.b2b.tax)],
    ["B2C (no buyer GSTIN)", String(summary.b2c.invoices), formatAmount(summary.b2c.taxable), formatAmount(summary.b2c.cgst), formatAmount(summary.b2c.sgst), formatAmount(summary.b2c.igst), formatAmount(summary.b2c.tax)],
    ["Total", String(summary.totals.invoices), formatAmount(summary.totals.taxable), formatAmount(summary.totals.cgst), formatAmount(summary.totals.sgst), formatAmount(summary.totals.igst), formatAmount(summary.totals.tax)],
  ]);
  sheet.gap(12);

  sheet.paragraph("Rate-wise summary", { size: 10, bold: true });
  sheet.gap(4);
  sheet.table(
    [{ label: "Rate %", width: 60, align: "right" }, ...sectionColumns.slice(1)],
    summary.rateWise.map((slab) => [
      slab.rate === null ? "unknown" : trimNumber(slab.rate),
      String(slab.invoices),
      formatAmount(slab.taxable),
      formatAmount(slab.cgst),
      formatAmount(slab.sgst),
      formatAmount(slab.igst),
      formatAmount(slab.tax),
    ])
  );
  sheet.gap(12);

  sheet.paragraph(`Needs review: ${summary.needsReview.length} row${summary.needsReview.length === 1 ? "" : "s"}`, { size: 10, bold: true });
  sheet.gap(4);
  if (summary.needsReview.length) {
    sheet.table(
      [{ label: "Row", width: 36, align: "right" }, { label: "Invoice no", width: 92 }, { label: "Buyer GSTIN", width: 108 }, { label: "Issues", width: 275 }],
      summary.needsReview.map((item) => [String(item.row), item.invoiceNo, item.gstin || "-", item.issues.join(" ")])
    );
  } else {
    sheet.paragraph("No malformed GSTINs, bad dates, or tax mismatches were found.", { size: 9, color: muted });
  }
  sheet.gap(10);
  sheet.paragraph(summary.disclaimer, { size: 8, color: muted });
  return pdf.save();
}

// --- Workflow builder ---------------------------------------------------------

function pdfFileFromBytes(bytes, name) {
  return new File([bytes], name, { type: "application/pdf" });
}

/**
 * The PDF operations that can be chained. Every `run` takes a PDF file and
 * returns PDF bytes, so the output of one step is the input of the next.
 * `browserOnly` ops rasterise pages through pdf.js + canvas.
 */
export const WORKFLOW_OPS = {
  "extract-pages": {
    label: "Extract pages",
    hint: "Keep only the listed pages.",
    fields: [{ key: "pages", label: "Pages", type: "text", placeholder: "1-3,5", default: "" }],
    run: async (file, options) => {
      const pdf = await loadPdf(file);
      return extractPdfPages(file, parsePageRanges(options.pages, pdf.getPageCount()));
    },
  },
  organize: {
    label: "Organize pages",
    hint: "Reorder, duplicate, or drop pages by a page-order string.",
    fields: [{ key: "order", label: "Page order", type: "text", placeholder: "3,1,2", default: "" }],
    run: (file, options) => organizePdfPages(file, options.order),
  },
  rotate: {
    label: "Rotate pages",
    hint: "Rotate every page.",
    fields: [{ key: "degrees", label: "Rotation", type: "select", options: ["90", "180", "270"], default: "90" }],
    run: async (file, options) => {
      const pdf = await loadPdf(file);
      return rotatePdfPages(file, pdf.getPageIndices(), Number(options.degrees || 90));
    },
  },
  watermark: {
    label: "Watermark",
    hint: "Stamp diagonal text across every page.",
    fields: [
      { key: "text", label: "Watermark text", type: "text", placeholder: "DRAFT", default: "DRAFT" },
      { key: "size", label: "Size", type: "text", placeholder: "48", default: "48" },
      { key: "opacity", label: "Opacity (0.05-0.6)", type: "text", placeholder: "0.18", default: "0.18" },
    ],
    run: (file, options) => watermarkPdf(file, options.text || "DRAFT", { size: Number(options.size || 48), opacity: Number(options.opacity || 0.18) }),
  },
  "page-numbers": {
    label: "Page numbers",
    hint: "Add a centred page number to every page.",
    fields: [
      { key: "prefix", label: "Prefix", type: "text", placeholder: "Page ", default: "" },
      { key: "fontSize", label: "Font size", type: "text", placeholder: "10", default: "10" },
    ],
    run: (file, options) => addPdfPageNumbers(file, { prefix: options.prefix || "", fontSize: Number(options.fontSize || 10) }),
  },
  "metadata-clean": {
    label: "Clean metadata",
    hint: "Remove the document info dictionary.",
    fields: [],
    run: (file) => cleanPdfMetadata(file),
  },
  compress: {
    label: "Compress",
    browserOnly: true,
    hint: "Rasterise pages at a lower quality to shrink the file.",
    fields: [
      { key: "quality", label: "Quality", type: "select", options: ["0.4", "0.6", "0.8"], default: "0.6" },
      { key: "dpi", label: "DPI", type: "select", options: ["100", "120", "150"], default: "120" },
    ],
    run: (file, options) => compressPdf(file, { quality: Number(options.quality || 0.6), dpi: Number(options.dpi || 120) }),
  },
  flatten: {
    label: "Flatten",
    browserOnly: true,
    hint: "Rebuild a flat, non-interactive PDF.",
    fields: [{ key: "dpi", label: "DPI", type: "select", options: ["120", "150", "200"], default: "150" }],
    run: (file, options) => flattenPdf(file, { dpi: Number(options.dpi || 150) }),
  },
  invert: {
    label: "Invert colours",
    browserOnly: true,
    hint: "Invert page colours for dark-mode reading.",
    fields: [{ key: "dpi", label: "DPI", type: "select", options: ["120", "150", "200"], default: "150" }],
    run: (file, options) => invertPdf(file, { dpi: Number(options.dpi || 150) }),
  },
  sanitize: {
    label: "Sanitize (strip active content)",
    hint: "Remove OpenAction, /AA, JavaScript, Launch/SubmitForm actions, and attachments.",
    fields: [{ key: "attachments", label: "Attachments", type: "select", options: ["remove", "keep"], default: "remove" }],
    run: async (file, options) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await sanitizePdf(bytes, { removeAttachments: options.attachments !== "keep" });
      return result.bytes;
    },
  },
  standardize: {
    label: "Standardize page size",
    hint: "Scale every page to a standard sheet size.",
    fields: [{ key: "size", label: "Size", type: "select", options: ["A4", "Letter", "Legal"], default: "A4" }],
    run: (file, options) => cropResizePdf(file, { mode: "resize", size: options.size || "A4" }),
  },
  bates: {
    label: "Bates numbering",
    hint: "Stamp continuous legal Bates numbers on every page.",
    fields: [
      { key: "prefix", label: "Prefix", type: "text", placeholder: "ABC", default: "" },
      { key: "start", label: "Start at", type: "text", placeholder: "1", default: "1" },
      { key: "padding", label: "Digits", type: "text", placeholder: "6", default: "6" },
    ],
    run: (file, options) => batesNumberPdf(file, { prefix: options.prefix || "", start: Number(options.start || 1), padding: Number(options.padding || 6), position: "bottom-right" }),
  },
  pdfa: {
    label: "PDF/A archival prep",
    hint: "Best-effort archival hygiene: sRGB OutputIntent, PDF/A XMP id, and strip active content.",
    fields: [],
    run: async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await archivalPrepPdf(bytes, {});
      return result.bytes;
    },
  },
};

/**
 * One-click Workflow Builder presets. Each maps to a chain of ids that already
 * exist in WORKFLOW_OPS, so a preset always runs end-to-end through runWorkflow.
 * The chips only pre-fill steps; the user can still edit them before running.
 */
export const WORKFLOW_PRESETS = [
  { id: "email-ready", label: "Email Ready", hint: "Flatten, then compress to a small, portable file.", steps: [{ op: "flatten", options: { dpi: "150" } }, { op: "compress", options: { quality: "0.6", dpi: "120" } }] },
  { id: "confidential", label: "Confidential", hint: "Strip active content, clean metadata, and flatten so text is no longer selectable.", steps: [{ op: "sanitize", options: { attachments: "remove" } }, { op: "metadata-clean", options: {} }, { op: "flatten", options: { dpi: "150" } }] },
  { id: "print-ready", label: "Print Ready", hint: "Standardize to A4, then add page numbers.", steps: [{ op: "standardize", options: { size: "A4" } }, { op: "page-numbers", options: { prefix: "", fontSize: "10" } }] },
  { id: "archive", label: "Archive", hint: "Best-effort PDF/A archival preparation.", steps: [{ op: "pdfa", options: {} }] },
  { id: "legal-bates", label: "Legal Bates", hint: "Stamp Bates numbers, then add plain page numbers.", steps: [{ op: "bates", options: { prefix: "", start: "1", padding: "6" } }, { op: "page-numbers", options: { prefix: "Page ", fontSize: "10" } }] },
  { id: "standardize-a4", label: "Standardize A4", hint: "Scale every page to A4.", steps: [{ op: "standardize", options: { size: "A4" } }] },
];

/**
 * Returns the fully-formed step list for a preset id — merging preset overrides
 * onto each op's field defaults, so every field has a value. Pure. Throws on an
 * unknown preset or a preset that references an op that does not exist.
 */
export function presetSteps(presetId) {
  const preset = WORKFLOW_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) throw new Error(`"${presetId}" is not a known workflow preset.`);
  return preset.steps.map((step) => {
    if (!Object.hasOwn(WORKFLOW_OPS, step.op)) throw new Error(`Preset "${presetId}" references unknown op "${step.op}".`);
    return { op: step.op, options: { ...defaultStepOptions(step.op), ...(step.options || {}) } };
  });
}

export function workflowOpList() {
  return Object.entries(WORKFLOW_OPS).map(([id, op]) => ({ id, label: op.label, hint: op.hint, browserOnly: Boolean(op.browserOnly), fields: op.fields }));
}

export function defaultStepOptions(opId) {
  // Own-property check only: inherited keys like "__proto__" or "toString" are
  // not workflow ops and must get the same friendly error as any other typo.
  if (!Object.hasOwn(WORKFLOW_OPS, opId)) throw new Error(`"${opId}" is not a supported workflow step.`);
  const op = WORKFLOW_OPS[opId];
  return Object.fromEntries(op.fields.map((field) => [field.key, field.default ?? ""]));
}

/**
 * Runs `steps` in order over one PDF, piping each step's bytes into the next.
 * A failing step stops the run but the last good output is still returned, so
 * the caller can offer it as a download.
 */
export async function runWorkflow(sourceFile, steps, { onStep } = {}) {
  const list = Array.isArray(steps) ? steps : [];
  if (!list.length) throw new Error("Add at least one step to the workflow.");
  for (const step of list) {
    if (!Object.hasOwn(WORKFLOW_OPS, step?.op)) throw new Error(`"${step?.op}" is not a supported workflow step.`);
  }

  const name = String(sourceFile?.name || "workflow.pdf");
  let bytes = new Uint8Array(await sourceFile.arrayBuffer());
  const completed = [];

  for (let index = 0; index < list.length; index += 1) {
    const step = list[index];
    const op = WORKFLOW_OPS[step.op];
    onStep?.({ index, step: index + 1, total: list.length, label: op.label, phase: "start" });
    try {
      const output = await op.run(pdfFileFromBytes(bytes, name), step.options || {});
      bytes = output instanceof Uint8Array ? output : new Uint8Array(output);
      completed.push({ step: index + 1, op: step.op, label: op.label, bytes: bytes.byteLength });
      onStep?.({ index, step: index + 1, total: list.length, label: op.label, phase: "done" });
    } catch (error) {
      onStep?.({ index, step: index + 1, total: list.length, label: op.label, phase: "failed" });
      return {
        ok: false,
        bytes,
        completed,
        failed: { step: index + 1, op: step.op, label: op.label, message: error?.message || "This step failed." },
      };
    }
  }
  return { ok: true, bytes, completed, failed: null };
}

// --- Shared pdf-lib layout helpers -------------------------------------------

// Small paginating sheet used by the invoice and GSTR-1 PDFs. Table drawing
// mirrors convert.service's csvToPdf (measured wrapping, repeated header row).
function createSheet(pdf, { regular, bold, ink }) {
  let page = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;

  const ensure = (needed) => {
    if (y - needed >= MARGIN) return;
    page = pdf.addPage([A4.width, A4.height]);
    y = A4.height - MARGIN;
  };

  const write = (text, { x, size, font, color }) => drawSafeText(page, text, { x, y: y - size, size, font, color: color || ink });

  return {
    cursor: () => y,
    moveTo: (value) => { y = value; },
    gap: (value) => { y -= value; },
    heading(text, size) {
      ensure(size * 1.6);
      write(text, { x: MARGIN, size, font: bold });
      y -= size * 1.6;
    },
    paragraph(text, { size = 9, bold: isBold = false, color } = {}) {
      const font = isBold ? bold : regular;
      for (const line of wrapByWidth(font, text, size, A4.width - MARGIN * 2)) {
        ensure(size * 1.45);
        write(line, { x: MARGIN, size, font, color });
        y -= size * 1.45;
      }
    },
    /** Draws a bordered block of lines and returns the y it ended at. */
    block(x, top, width, lines) {
      const padding = 6;
      let cursor = top - padding;
      const previousY = y;
      for (const line of lines) {
        const font = line.bold ? bold : regular;
        for (const text of wrapByWidth(font, line.text, line.size, width - padding * 2)) {
          drawSafeText(page, text, { x: x + padding, y: cursor - line.size, size: line.size, font, color: line.color || ink });
          cursor -= line.size * 1.4;
        }
      }
      const height = top - cursor + padding;
      page.drawRectangle({ x, y: top - height, width, height, borderColor: rgbLine(), borderWidth: 0.5 });
      y = Math.min(previousY, top - height);
      return top - height;
    },
    table(columns, rows) {
      const fontSize = 8;
      const padding = 3;
      const lineHeight = fontSize * 1.3;
      const scale = (A4.width - MARGIN * 2) / columns.reduce((sum, column) => sum + column.width, 0);
      const widths = columns.map((column) => column.width * scale);
      const totalWidth = widths.reduce((sum, width) => sum + width, 0);

      const drawRow = (cells, isHeader) => {
        const font = isHeader ? bold : regular;
        const wrapped = columns.map((column, index) => wrapByWidth(font, String(cells[index] ?? ""), fontSize, widths[index] - padding * 2));
        const rowLines = Math.max(1, ...wrapped.map((lines) => lines.length));
        const rowHeight = rowLines * lineHeight + padding * 2;
        if (y - rowHeight < MARGIN) {
          page = pdf.addPage([A4.width, A4.height]);
          y = A4.height - MARGIN;
          if (!isHeader) drawRow(columns.map((column) => column.label), true);
        }
        const top = y;
        if (isHeader) page.drawRectangle({ x: MARGIN, y: top - rowHeight, width: totalWidth, height: rowHeight, color: rgbFill() });
        let x = MARGIN;
        columns.forEach((column, index) => {
          page.drawLine({ start: { x, y: top }, end: { x, y: top - rowHeight }, thickness: 0.5, color: rgbLine() });
          let textY = top - padding - fontSize;
          for (const text of wrapped[index]) {
            const offset = column.align === "right" ? widths[index] - padding - safeWidth(font, text, fontSize) : padding;
            drawSafeText(page, text, { x: x + offset, y: textY, size: fontSize, font, color: ink });
            textY -= lineHeight;
          }
          x += widths[index];
        });
        page.drawLine({ start: { x, y: top }, end: { x, y: top - rowHeight }, thickness: 0.5, color: rgbLine() });
        page.drawLine({ start: { x: MARGIN, y: top }, end: { x: MARGIN + totalWidth, y: top }, thickness: 0.5, color: rgbLine() });
        page.drawLine({ start: { x: MARGIN, y: top - rowHeight }, end: { x: MARGIN + totalWidth, y: top - rowHeight }, thickness: 0.5, color: rgbLine() });
        y -= rowHeight;
      };

      drawRow(columns.map((column) => column.label), true);
      for (const row of rows) drawRow(row, false);
    },
    totals(rows) {
      const size = 9;
      const labelWidth = 130;
      const valueWidth = 90;
      const x = A4.width - MARGIN - labelWidth - valueWidth;
      rows.forEach((row, index) => {
        const isLast = index === rows.length - 1;
        const font = isLast ? bold : regular;
        ensure(size * 1.6);
        drawSafeText(page, row[0], { x, y: y - size, size, font, color: ink });
        const value = row[1];
        drawSafeText(page, value, { x: A4.width - MARGIN - safeWidth(font, value, size), y: y - size, size, font, color: ink });
        y -= size * 1.6;
        if (isLast) {
          page.drawLine({ start: { x, y: y + 3 }, end: { x: A4.width - MARGIN, y: y + 3 }, thickness: 0.5, color: rgbLine() });
        }
      });
    },
  };
}

function rgbLine() {
  const { rgb } = getPdfLib();
  return rgb(0.72, 0.75, 0.8);
}

function rgbFill() {
  const { rgb } = getPdfLib();
  return rgb(0.93, 0.94, 0.96);
}

function wrapByWidth(font, text, size, maxWidth) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let current = "";
  for (const word of words) {
    let token = word;
    while (safeWidth(font, token, size) > maxWidth && token.length > 1) {
      const cut = widestFittingPrefix(font, token, size, maxWidth);
      if (current) { lines.push(current); current = ""; }
      lines.push(token.slice(0, cut));
      token = token.slice(cut);
    }
    const candidate = current ? `${current} ${token}` : token;
    if (safeWidth(font, candidate, size) > maxWidth && current) {
      lines.push(current);
      current = token;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

// Longest prefix of `token` (never shorter than one character, so the caller
// always makes progress) that still fits `maxWidth`. Binary search instead of
// stepping down one character at a time: a single 8000-character token used to
// re-measure a near-full-length string thousands of times and froze the tab.
function widestFittingPrefix(font, token, size, maxWidth) {
  let low = 1;
  let high = token.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (safeWidth(font, token.slice(0, mid), size) > maxWidth) high = mid - 1;
    else low = mid;
  }
  return low;
}

function clipToWidth(font, text, size, maxWidth) {
  let value = String(text ?? "");
  if (safeWidth(font, value, size) <= maxWidth) return value;
  while (value.length > 1 && safeWidth(font, `${value}...`, size) > maxWidth) value = value.slice(0, -1);
  return `${value}...`;
}

// pdf-lib's standard fonts cover Latin-1 (WinAnsi) only; mirror the friendly
// error the other PDF services raise instead of leaking the encoder message.
function safeWidth(font, text, size) {
  try {
    return font.widthOfTextAtSize(String(text ?? ""), size);
  } catch (error) {
    if (/cannot encode|WinAnsi/i.test(String(error?.message))) {
      throw new Error("This tool supports Latin-1 characters only (no CJK/emoji).");
    }
    throw error;
  }
}

function drawSafeText(page, text, options) {
  try {
    page.drawText(String(text ?? ""), options);
  } catch (error) {
    if (/cannot encode|WinAnsi/i.test(String(error?.message))) {
      throw new Error("This tool supports Latin-1 characters only (no CJK/emoji).");
    }
    throw error;
  }
}
