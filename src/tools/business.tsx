// Business tools. Loaded on demand by ToolRenderer in src/App.tsx.
import { useEffect, useMemo, useState } from "react";
import { safeFilename, withExtension } from "../utils/safe-filename.js";
import { validateFiles } from "../services/file-validator.js";
import { downloadBytes, downloadText } from "../services/download.service.js";
import { STATE_CODES, computeGstInvoice, computePosBill, formatAmount, gstInvoicePdf, gstr1SummaryCsv, gstr1SummaryPdf, gstr1SummaryXlsx, posReceiptPdf, readInvoiceRows, summariseGstr1, summarisePosSession } from "../services/business.service.js";
import { initialStatus, ToolForm, StatusBox, FileControl, Input, Textarea, Select, PrimaryButton, SecondaryButton, MiniField, runSafely } from "./shared";
import type { Tool } from "./shared";

type GstLineItem = { description: string; hsn: string; qty: string; unit: string; rate: string; discountPercent: string; gstRate: string };

const stateCodeOptions = Object.keys(STATE_CODES).sort((a, b) => Number(a) - Number(b));
const stateCodeLabels = stateCodeOptions.map((code) => `${code} - ${(STATE_CODES as Record<string, string>)[code]}`);
const emptyGstLine: GstLineItem = { description: "", hsn: "", qty: "1", unit: "NOS", rate: "", discountPercent: "0", gstRate: "18" };

function AmountRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex items-baseline justify-between gap-4 ${strong ? "border-t border-[var(--border)] pt-2 font-black" : "font-bold"}`}>
    <span className={strong ? "" : "text-neutral-500"}>{label}</span>
    <span className="tabular-nums">{value}</span>
  </div>;
}

function GstInvoiceTool() {
  const today = new Date().toISOString().slice(0, 10);
  const [sellerName, setSellerName] = useState("");
  const [sellerAddress, setSellerAddress] = useState("");
  const [sellerGstin, setSellerGstin] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [buyerGstin, setBuyerGstin] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [placeOfSupply, setPlaceOfSupply] = useState("27");
  const [items, setItems] = useState<GstLineItem[]>([{ ...emptyGstLine }]);
  const [status, setStatus] = useState(initialStatus);

  const payload = useMemo(() => ({
    seller: { name: sellerName, address: sellerAddress, gstin: sellerGstin },
    buyer: { name: buyerName, address: buyerAddress, gstin: buyerGstin, state: placeOfSupply },
    invoiceNo,
    invoiceDate,
    placeOfSupply,
    items: items.map((item) => ({ ...item, discountPercent: item.discountPercent, gstRate: item.gstRate })),
  }), [sellerName, sellerAddress, sellerGstin, buyerName, buyerAddress, buyerGstin, invoiceNo, invoiceDate, placeOfSupply, items]);

  const preview = useMemo(() => {
    try {
      return { invoice: computeGstInvoice(payload), error: "" };
    } catch (error: any) {
      return { invoice: null, error: error?.message || "Complete the invoice details." };
    }
  }, [payload]);

  const invoice = preview.invoice as any;
  const updateItem = (index: number, key: keyof GstLineItem, value: string) =>
    setItems((previous) => previous.map((item, position) => (position === index ? { ...item, [key]: value } : item)));

  const reset = () => {
    setSellerName(""); setSellerAddress(""); setSellerGstin("");
    setBuyerName(""); setBuyerAddress(""); setBuyerGstin("");
    setInvoiceNo(""); setInvoiceDate(today); setPlaceOfSupply("27");
    setItems([{ ...emptyGstLine }]);
    setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Builds an Indian GST tax invoice in this browser. The state code in each GSTIN decides the split: same state means CGST + SGST at half the rate each, different states mean IGST at the full rate. Reverse charge, GST cess, TDS/TCS, and composition-scheme invoices are not handled.
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="Seller name" value={sellerName} onChange={setSellerName} placeholder="Your business name" />
      <Input label="Seller GSTIN" value={sellerGstin} onChange={setSellerGstin} placeholder="27ABCDE1234F1Z5" />
    </div>
    <Textarea label="Seller address" value={sellerAddress} onChange={setSellerAddress} rows={3} />

    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="Buyer name" value={buyerName} onChange={setBuyerName} placeholder="Customer name" />
      <Input label="Buyer GSTIN (leave blank if unregistered)" value={buyerGstin} onChange={setBuyerGstin} placeholder="29ABCDE1234F1Z5" />
    </div>
    <Textarea label="Buyer address" value={buyerAddress} onChange={setBuyerAddress} rows={3} />

    <div className="grid gap-3 sm:grid-cols-3">
      <Input label="Invoice number" value={invoiceNo} onChange={setInvoiceNo} placeholder="INV-2026-001" />
      <Input label="Invoice date" value={invoiceDate} onChange={setInvoiceDate} type="date" />
      <Select label="Place of supply" value={placeOfSupply} onChange={setPlaceOfSupply} options={stateCodeOptions} labels={stateCodeLabels} />
    </div>

    <div className="grid gap-3">
      <p className="text-xs font-bold uppercase text-neutral-500">Line items</p>
      {items.map((item, index) => (
        <div key={index} className="surface-card wabi-card-edge grid gap-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase text-neutral-500">Item {index + 1}</span>
            {items.length > 1 && <button className="secondary-button" type="button" onClick={() => setItems((previous) => previous.filter((_, position) => position !== index))}>Remove</button>}
          </div>
          <MiniField label="Description" value={item.description} onChange={(value) => updateItem(index, "description", value)} placeholder="Consulting services" />
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <MiniField label="HSN/SAC" value={item.hsn} onChange={(value) => updateItem(index, "hsn", value)} placeholder="998311" />
            <MiniField label="Qty" value={item.qty} onChange={(value) => updateItem(index, "qty", value)} type="number" />
            <MiniField label="Unit" value={item.unit} onChange={(value) => updateItem(index, "unit", value)} placeholder="NOS" />
            <MiniField label="Rate" value={item.rate} onChange={(value) => updateItem(index, "rate", value)} type="number" />
            <MiniField label="Discount %" value={item.discountPercent} onChange={(value) => updateItem(index, "discountPercent", value)} type="number" />
            <MiniField label="GST %" value={item.gstRate} onChange={(value) => updateItem(index, "gstRate", value)} type="number" />
          </div>
        </div>
      ))}
      <SecondaryButton label="Add line item" onClick={() => setItems((previous) => [...previous, { ...emptyGstLine }])} />
    </div>

    {invoice ? (
      <div className="surface-card wabi-card-edge grid gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-black">{invoice.supplyType}</p>
          <span className="tag-badge rounded-full px-3 py-1 text-xs font-bold uppercase">{invoice.lines.length} line{invoice.lines.length === 1 ? "" : "s"}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm font-semibold">
            <thead className="text-xs font-bold uppercase text-neutral-500">
              <tr><th className="py-1">Description</th><th className="py-1 text-right">Taxable</th>{invoice.interState ? <th className="py-1 text-right">IGST</th> : <><th className="py-1 text-right">CGST</th><th className="py-1 text-right">SGST</th></>}<th className="py-1 text-right">Total</th></tr>
            </thead>
            <tbody>
              {invoice.lines.map((line: any) => (
                <tr key={line.index} className="border-t border-[var(--border)]">
                  <td className="py-1 pr-2">{line.description}</td>
                  <td className="py-1 text-right tabular-nums">{formatAmount(line.taxable)}</td>
                  {invoice.interState ? <td className="py-1 text-right tabular-nums">{formatAmount(line.igst)}</td> : <><td className="py-1 text-right tabular-nums">{formatAmount(line.cgst)}</td><td className="py-1 text-right tabular-nums">{formatAmount(line.sgst)}</td></>}
                  <td className="py-1 text-right tabular-nums">{formatAmount(line.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-1 text-sm">
          <AmountRow label="Taxable value" value={formatAmount(invoice.totals.taxable)} />
          {invoice.interState
            ? <AmountRow label="IGST" value={formatAmount(invoice.totals.igst)} />
            : <><AmountRow label="CGST" value={formatAmount(invoice.totals.cgst)} /><AmountRow label="SGST" value={formatAmount(invoice.totals.sgst)} /></>}
          <AmountRow label="Round off" value={formatAmount(invoice.totals.roundOff)} />
          <AmountRow label="Grand total (INR)" value={formatAmount(invoice.totals.grandTotal)} strong />
        </div>
        <p className="text-sm font-bold">{invoice.amountInWords}</p>
        {invoice.warnings.length > 0 && (
          <ul className="grid gap-1 text-sm font-semibold text-amber-700 [.dark_&]:text-amber-300">
            {invoice.warnings.map((warning: string) => <li key={warning}>Warning: {warning}</li>)}
          </ul>
        )}
      </div>
    ) : (
      <p className="text-sm font-semibold text-neutral-500">{preview.error}</p>
    )}

    <PrimaryButton label="Download invoice PDF" onClick={() => runSafely(setStatus, async () => {
      const computed: any = computeGstInvoice(payload);
      downloadBytes(await gstInvoicePdf(computed), withExtension(`gst-invoice-${safeFilename(computed.invoiceNo)}`, "pdf"), "application/pdf");
      return `${computed.supplyType} invoice ready. Grand total INR ${formatAmount(computed.totals.grandTotal)}.`;
    })} />
  </ToolForm>;
}

type PosCatalogueItem = { id: string; name: string; price: string; taxPercent: string };
type PosCartLine = { name: string; price: string; taxPercent: string; qty: number };

const posCatalogueStorageKey = "myfilekit:posCatalogue";

function loadPosCatalogue(): PosCatalogueItem[] {
  try {
    const stored = JSON.parse(localStorage.getItem(posCatalogueStorageKey) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((item) => item && typeof item === "object")
      .map((item: any) => ({ id: String(item.id || ""), name: String(item.name || ""), price: String(item.price ?? ""), taxPercent: String(item.taxPercent ?? "0") }))
      .filter((item) => item.name);
  } catch {
    return [];
  }
}

function savePosCatalogue(catalogue: PosCatalogueItem[]) {
  try {
    localStorage.setItem(posCatalogueStorageKey, JSON.stringify(catalogue));
  } catch {
    // The catalogue is a convenience; storage may be unavailable in private mode.
  }
}

function PosBillingTool() {
  const [catalogue, setCatalogue] = useState<PosCatalogueItem[]>([]);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newTax, setNewTax] = useState("0");
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [discountPercent, setDiscountPercent] = useState("0");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [cashTendered, setCashTendered] = useState("");
  const [shopName, setShopName] = useState("MyFileKit Store");
  const [shopGstin, setShopGstin] = useState("");
  const [bills, setBills] = useState<any[]>([]);
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => { setCatalogue(loadPosCatalogue()); }, []);

  const updateCatalogue = (next: PosCatalogueItem[]) => { setCatalogue(next); savePosCatalogue(next); };

  const preview = useMemo(() => {
    try {
      // Priced with a non-cash mode so an empty "cash received" box never blocks
      // the running total; the cash check runs again on save.
      return { bill: computePosBill({ items: cart, discountPercent, paymentMode: "card" }), error: "" };
    } catch (error: any) {
      return { bill: null, error: error?.message || "Add items to start a bill." };
    }
  }, [cart, discountPercent]);

  const bill = preview.bill as any;
  const payable = bill ? Number(bill.totals.payable) : 0;
  const tendered = Number(cashTendered);
  const change = paymentMode === "cash" && cashTendered.trim() && Number.isFinite(tendered) ? tendered - payable : null;
  const session = summarisePosSession(bills) as any;
  const visible = catalogue.filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()));

  const addToCart = (item: PosCatalogueItem) => setCart((previous) => {
    const index = previous.findIndex((line) => line.name === item.name && line.price === item.price);
    if (index === -1) return [...previous, { name: item.name, price: item.price, taxPercent: item.taxPercent, qty: 1 }];
    return previous.map((line, position) => (position === index ? { ...line, qty: line.qty + 1 } : line));
  });

  const setQty = (index: number, delta: number) => setCart((previous) => previous
    .map((line, position) => (position === index ? { ...line, qty: line.qty + delta } : line))
    .filter((line) => line.qty > 0));

  const reset = () => {
    setCart([]); setDiscountPercent("0"); setPaymentMode("cash"); setCashTendered(""); setSearch("");
    setStatus(initialStatus);
  };

  return <ToolForm status={status} onReset={reset}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Counter billing that runs entirely in this browser. The item catalogue is saved in this browser's local storage only — it is never uploaded, and clearing site data removes it. Bills below are kept for this session only.
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <Input label="Shop name (printed on the receipt)" value={shopName} onChange={setShopName} />
      <Input label="Shop GSTIN (optional)" value={shopGstin} onChange={setShopGstin} />
    </div>

    <div className="surface-card wabi-card-edge grid gap-3 p-4">
      <p className="text-xs font-bold uppercase text-neutral-500">Item catalogue ({catalogue.length})</p>
      <div className="grid gap-2 sm:grid-cols-4">
        <MiniField label="Name" value={newName} onChange={setNewName} placeholder="Filter coffee" />
        <MiniField label="Price" value={newPrice} onChange={setNewPrice} type="number" />
        <MiniField label="Tax %" value={newTax} onChange={setNewTax} type="number" />
        <div className="flex items-end">
          <SecondaryButton label="Save item" onClick={() => runSafely(setStatus, async () => {
            const name = newName.trim();
            if (!name) throw new Error("Enter an item name.");
            const price = Number(newPrice);
            if (!Number.isFinite(price) || price < 0) throw new Error("Enter a price of zero or more.");
            const tax = Number(newTax || 0);
            if (!Number.isFinite(tax) || tax < 0 || tax > 100) throw new Error("Tax must be between 0 and 100 percent.");
            const id = `${Date.now()}-${catalogue.length}`;
            updateCatalogue([...catalogue.filter((item) => item.name.toLowerCase() !== name.toLowerCase()), { id, name, price: String(price), taxPercent: String(tax) }]);
            setNewName(""); setNewPrice(""); setNewTax("0");
            return `Saved "${name}" to this browser's catalogue.`;
          })} />
        </div>
      </div>
      <Input label="Search catalogue" value={search} onChange={setSearch} placeholder="Type to filter" />
      {visible.length ? (
        <div className="flex flex-wrap gap-2">
          {visible.map((item) => (
            <div key={item.id} className="surface-muted wabi-card-edge flex items-center gap-2 px-3 py-2 text-sm font-bold">
              <button className="text-left hover:underline" type="button" onClick={() => addToCart(item)}>{item.name} · {formatAmount(Number(item.price))}{Number(item.taxPercent) ? ` · ${item.taxPercent}%` : ""}</button>
              <button className="text-xs font-bold uppercase text-neutral-500 hover:underline" type="button" aria-label={`Remove ${item.name} from the catalogue`} onClick={() => updateCatalogue(catalogue.filter((entry) => entry.id !== item.id))}>Del</button>
            </div>
          ))}
        </div>
      ) : <p className="text-sm font-semibold text-neutral-500">{catalogue.length ? "No catalogue item matches that search." : "No saved items yet. Add one above."}</p>}
    </div>

    <div className="surface-card wabi-card-edge grid gap-3 p-4">
      <p className="text-xs font-bold uppercase text-neutral-500">Current bill</p>
      {cart.length ? cart.map((line, index) => (
        <div key={`${line.name}-${index}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2 text-sm font-bold last:border-b-0">
          <span>{line.name} · {formatAmount(Number(line.price))}</span>
          <span className="flex items-center gap-2">
            <button className="secondary-button" type="button" aria-label={`Reduce ${line.name}`} onClick={() => setQty(index, -1)}>-</button>
            <span className="tabular-nums">{line.qty}</span>
            <button className="secondary-button" type="button" aria-label={`Add another ${line.name}`} onClick={() => setQty(index, 1)}>+</button>
          </span>
        </div>
      )) : <p className="text-sm font-semibold text-neutral-500">Click a catalogue item to start a bill.</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniField label="Bill discount %" value={discountPercent} onChange={setDiscountPercent} type="number" />
        <Select label="Payment mode" value={paymentMode} onChange={setPaymentMode} options={["cash", "card", "upi"]} labels={["Cash", "Card", "UPI"]} />
        {paymentMode === "cash" ? <MiniField label="Cash received" value={cashTendered} onChange={setCashTendered} type="number" /> : <div />}
      </div>

      {bill ? (
        <div className="grid gap-1 text-sm">
          <AmountRow label="Subtotal" value={formatAmount(bill.totals.subtotal)} />
          {Number(bill.totals.discount) ? <AmountRow label={`Discount (${discountPercent}%)`} value={`-${formatAmount(bill.totals.discount)}`} /> : null}
          <AmountRow label="Taxable" value={formatAmount(bill.totals.taxable)} />
          <AmountRow label="Tax" value={formatAmount(bill.totals.tax)} />
          <AmountRow label="Round off" value={formatAmount(bill.totals.roundOff)} />
          <AmountRow label="Payable (INR)" value={formatAmount(bill.totals.payable)} strong />
          {change !== null && <AmountRow label={change < 0 ? "Short by" : "Change"} value={formatAmount(Math.abs(change))} />}
        </div>
      ) : <p className="text-sm font-semibold text-neutral-500">{preview.error}</p>}

      <PrimaryButton label="Save bill and make receipt" onClick={() => runSafely(setStatus, async () => {
        const billNo = `B${String(bills.length + 1).padStart(4, "0")}`;
        const saved: any = computePosBill({
          items: cart,
          discountPercent,
          paymentMode,
          cashTendered: paymentMode === "cash" ? cashTendered : null,
          billNo,
          createdAt: new Date().toLocaleString(),
        });
        downloadBytes(await posReceiptPdf(saved, { shopName, gstin: shopGstin }), withExtension(`receipt-${billNo}`, "pdf"), "application/pdf");
        setBills((previous) => [saved, ...previous]);
        setCart([]);
        setCashTendered("");
        setDiscountPercent("0");
        return saved.totals.change == null
          ? `Bill ${billNo} saved. Payable INR ${formatAmount(saved.totals.payable)}.`
          : `Bill ${billNo} saved. Payable INR ${formatAmount(saved.totals.payable)}, change INR ${formatAmount(saved.totals.change)}.`;
      })} />
    </div>

    <div className="surface-card wabi-card-edge grid gap-2 p-4">
      <p className="text-xs font-bold uppercase text-neutral-500">This session ({session.bills} bill{session.bills === 1 ? "" : "s"})</p>
      <AmountRow label="Session total (INR)" value={formatAmount(session.total)} strong />
      <p className="text-sm font-semibold text-neutral-500">Cash {formatAmount(session.byMode.cash)} · Card {formatAmount(session.byMode.card)} · UPI {formatAmount(session.byMode.upi)} · Tax {formatAmount(session.tax)} · {session.items} item{session.items === 1 ? "" : "s"}</p>
      {bills.map((entry) => (
        <div key={entry.billNo} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2 text-sm font-bold">
          <span>{entry.billNo} · {entry.createdAt} · {entry.paymentMode.toUpperCase()}</span>
          <span className="tabular-nums">{formatAmount(entry.totals.payable)}</span>
        </div>
      ))}
    </div>
  </ToolForm>;
}

function GstFilingPrepTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [status, setStatus] = useState(initialStatus);

  const baseName = safeFilename(files[0]?.name || "gstr1-summary");
  const requireSummary = () => {
    if (!summary) throw new Error("Import a sales file first.");
    return summary;
  };

  return <ToolForm status={status} onReset={() => { setFiles([]); setSummary(null); setStatus(initialStatus); }}>
    <div className="surface-muted wabi-card-edge p-4 text-sm font-semibold leading-6 text-neutral-600">
      Reads a CSV or XLSX sales register and prepares a GSTR-1-style summary locally: B2B (buyer GSTIN present) vs B2C, rate-wise totals, and a "needs review" list. It does not file anything with the government and is not a substitute for the GST portal or your accountant. Expected columns: invoice no, date, buyer GSTIN, place of supply, taxable value, GST rate, CGST, SGST, IGST.
    </div>
    <FileControl accept="text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" files={files} setFiles={(next) => { setFiles(next); setSummary(null); }} label="Choose or drop a .csv, .xlsx, or .xls sales register" />
    <PrimaryButton label="Build summary" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const rows = await readInvoiceRows(file);
      const result: any = summariseGstr1(rows);
      setSummary(result);
      return `Summarised ${result.rowCount} row${result.rowCount === 1 ? "" : "s"}: ${result.b2b.rows} B2B, ${result.b2c.rows} B2C, ${result.needsReview.length} needing review.`;
    })} />

    {summary && (
      <div className="surface-card wabi-card-edge grid gap-4 p-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm font-semibold">
            <thead className="text-xs font-bold uppercase text-neutral-500">
              <tr><th className="py-1">Section</th><th className="py-1 text-right">Invoices</th><th className="py-1 text-right">Taxable</th><th className="py-1 text-right">CGST</th><th className="py-1 text-right">SGST</th><th className="py-1 text-right">IGST</th><th className="py-1 text-right">Total tax</th></tr>
            </thead>
            <tbody>
              {[["B2B", summary.b2b], ["B2C", summary.b2c], ["Total", summary.totals]].map(([label, bucket]: any) => (
                <tr key={label} className="border-t border-[var(--border)]">
                  <td className="py-1 pr-2">{label}</td>
                  <td className="py-1 text-right tabular-nums">{bucket.invoices}</td>
                  <td className="py-1 text-right tabular-nums">{formatAmount(bucket.taxable)}</td>
                  <td className="py-1 text-right tabular-nums">{formatAmount(bucket.cgst)}</td>
                  <td className="py-1 text-right tabular-nums">{formatAmount(bucket.sgst)}</td>
                  <td className="py-1 text-right tabular-nums">{formatAmount(bucket.igst)}</td>
                  <td className="py-1 text-right tabular-nums">{formatAmount(bucket.tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-1">
          <p className="text-xs font-bold uppercase text-neutral-500">Rate-wise</p>
          {summary.rateWise.map((slab: any) => (
            <AmountRow key={String(slab.rate)} label={`${slab.rate === null ? "unknown" : slab.rate}% · taxable ${formatAmount(slab.taxable)}`} value={formatAmount(slab.tax)} />
          ))}
        </div>

        <div className="grid gap-2">
          <p className="text-xs font-bold uppercase text-neutral-500">Needs review ({summary.needsReview.length})</p>
          {summary.needsReview.length ? summary.needsReview.map((item: any) => (
            <div key={`${item.row}-${item.invoiceNo}`} className="surface-muted wabi-card-edge p-3 text-sm font-semibold">
              <p className="font-black">Row {item.row} · {item.invoiceNo}</p>
              <ul className="mt-1 grid gap-1 text-neutral-600">{item.issues.map((issue: string) => <li key={issue}>{issue}</li>)}</ul>
            </div>
          )) : <p className="text-sm font-semibold text-neutral-500">No malformed GSTINs, bad dates, or tax mismatches were found.</p>}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <SecondaryButton label="Download CSV" onClick={() => runSafely(setStatus, async () => {
            downloadText(gstr1SummaryCsv(requireSummary()), `${baseName}-gstr1`, "csv", "text/csv;charset=utf-8");
            return "CSV summary ready.";
          })} />
          <SecondaryButton label="Download XLSX" onClick={() => runSafely(setStatus, async () => {
            downloadBytes(await gstr1SummaryXlsx(requireSummary()), withExtension(`${baseName}-gstr1`, "xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            return "XLSX summary ready.";
          })} />
          <PrimaryButton label="Download PDF" onClick={() => runSafely(setStatus, async () => {
            downloadBytes(await gstr1SummaryPdf(requireSummary(), { sourceName: files[0]?.name }), withExtension(`${baseName}-gstr1`, "pdf"), "application/pdf");
            return "PDF summary ready.";
          })} />
        </div>
      </div>
    )}
  </ToolForm>;
}

function InvoiceLauncher() {
  const features = [
    "Customizable template library",
    "Editable invoice, receipt, quote, and estimate wording",
    "Tax, discount, TDS, GST/VAT, HSN/SAC, and reverse-charge fields",
    "Bank, UPI, card, crypto, and custom payment instructions",
    "Logo upload, signature drawing, watermark, footer, and print/PDF export",
    "Show/hide controls for almost every invoice section",
  ];

  return (
    <div className="surface-card wabi-card-edge grid gap-5 p-5">
      <div>
        <p className="text-xs font-bold uppercase text-neutral-500">Business document editor</p>
        <h3 className="mt-1 font-display text-2xl font-black">One invoice editor, fully customizable</h3>
        <p className="mt-2 max-w-2xl font-semibold leading-7 text-neutral-700">
          Receipts, quotes, and estimates are handled as invoice-style business documents inside the full editor, instead of split into weaker duplicate tools.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {features.map((feature) => (
          <div key={feature} className="surface-muted wabi-card-edge px-4 py-3 text-sm font-bold text-neutral-700">{feature}</div>
        ))}
      </div>
      <a className="primary-button w-fit" href="/invoice-generator/index.html">Open invoice editor</a>
    </div>
  );
}

export default function BusinessTools({ tool }: { tool: Tool }) {
  if (tool.id === "invoice-generator-tool") return <InvoiceLauncher />;
  if (tool.id === "gst-invoice-tool") return <GstInvoiceTool />;
  if (tool.id === "pos-billing-tool") return <PosBillingTool />;
  if (tool.id === "gst-filing-prep-tool") return <GstFilingPrepTool tool={tool} />;
  return <StatusBox status={{ tone: "error", message: "This tool renderer is missing." }} />;
}
