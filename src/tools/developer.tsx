// Developer tools. Loaded on demand by ToolRenderer in src/App.tsx.
import { useState } from "react";
import QRCode from "qrcode";
import { validateFiles } from "../services/file-validator.js";
import { downloadBlob, downloadBytes } from "../services/download.service.js";
import { MyFileKit } from "../api/myfilekit.js";
import { base64Decode, base64Encode, generatePassphrase, generatePassword, passwordStrength } from "../services/text-tools.service.js";
import { initialStatus, ToolForm, StatusBox, FileControl, Input, Textarea, Checkbox, PrimaryButton, SecondaryButton, runSafely, dataUrlToBlob, requireOutput, copyText } from "./shared";
import type { Tool } from "./shared";

// Developer API playground. Documents the local, client-side MyFileKit API and
// proves it works end to end: pick 2+ PDFs, merge them THROUGH the API
// (window.MyFileKit.pdf.merge), and download the result — no server, no upload.
const API_EXAMPLE_CODE = `// 100% local — no server, no upload, no key.\n// The same object is available as window.MyFileKit.\nimport { MyFileKit } from "myfilekit";\n\nconst merged = await MyFileKit.pdf.merge([fileA, fileB]);\n// merged is a Uint8Array of PDF bytes, produced in this process.\n\nconst pages = await MyFileKit.pdf.split(file, "1-3,5");\nconst { bytes } = await MyFileKit.pdf.encrypt(file, { userPassword: "hunter2" });\nconst text = await MyFileKit.pdf.extractText(file);`;

function apiSurface() {
  // Enumerate the live API so the docs cannot drift from the real object.
  const groups: { name: string; methods: string[] }[] = [];
  for (const [key, value] of Object.entries(MyFileKit as Record<string, any>)) {
    if (typeof value !== "object" || value === null) continue;
    const methods: string[] = [];
    for (const [name, member] of Object.entries(value)) {
      if (typeof member === "function") methods.push(`${name}()`);
      else if (member && typeof member === "object") {
        for (const sub of Object.keys(member)) {
          if (typeof (member as any)[sub] === "function") methods.push(`${name}.${sub}()`);
        }
      }
    }
    if (methods.length) groups.push({ name: `MyFileKit.${key}`, methods });
  }
  return groups;
}

function ApiPlaygroundTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState(initialStatus);
  const groups = apiSurface();
  const onWindow = typeof window !== "undefined" && Boolean((window as any).MyFileKit);

  return (
    <ToolForm status={status} onReset={() => { setFiles([]); setStatus(initialStatus); }}>
      <div className="surface-muted wabi-card-edge grid gap-1 p-4 text-sm font-semibold leading-6 text-neutral-600">
        <p className="text-xs font-bold uppercase text-neutral-500">The privacy differentiator</p>
        <p className="text-[var(--foreground)]">MyFileKit ships a <strong>local, client-side</strong> programmatic API. Unlike iLovePDF or Stirling PDF — whose APIs are server-side and require you to upload your file and hold a key — this one runs 100% in your own browser or Node process. There is <strong>no server, no upload, and no key</strong>; your bytes never leave the process. Every method wraps the same service the matching tool uses.</p>
        <p>It is exposed here as <code className="font-mono">window.MyFileKit</code> {onWindow ? "(loaded on this page)" : ""} and as an <code className="font-mono">import</code> from the module. Full reference: <a className="underline" href="https://github.com/indranilroy99/myfilekit/blob/main/docs/API.md" target="_blank" rel="noreferrer">docs/API.md</a>.</p>
      </div>

      <div className="surface-card wabi-card-edge grid gap-2 p-4">
        <p className="font-black">API surface</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((group) => (
            <div key={group.name} className="grid gap-1">
              <p className="font-mono text-xs font-bold text-[var(--foreground)]">{group.name}</p>
              <p className="font-mono text-xs leading-5 text-neutral-500">{group.methods.join(", ")}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="surface-card wabi-card-edge grid gap-2 p-4">
        <p className="font-black">Example</p>
        <pre className="overflow-auto rounded-lg border border-[var(--border)] bg-[var(--paper-soft)] p-3 font-mono text-xs leading-5 text-neutral-600"><code>{API_EXAMPLE_CODE}</code></pre>
      </div>

      <div className="surface-card wabi-card-edge grid gap-3 p-4">
        <p className="font-black">Live example — merge PDFs through the API</p>
        <p className="text-sm font-semibold leading-6 text-neutral-600">Pick two or more PDFs. This calls <code className="font-mono">window.MyFileKit.pdf.merge(files)</code> — the exact API a developer would call — and downloads the merged bytes, proving the API works end to end.</p>
        <FileControl accept="application/pdf" multiple files={files} setFiles={setFiles} label="Choose PDFs to merge" />
        <PrimaryButton label="Run the merge example" onClick={() => runSafely(setStatus, async () => {
          const valid = validateFiles(files, tool.file);
          if (valid.length < 2) throw new Error("Choose at least two PDFs to merge.");
          const api = (typeof window !== "undefined" && (window as any).MyFileKit) || MyFileKit;
          const merged = await api.pdf.merge(valid);
          downloadBytes(merged, "myfilekit-api-merged.pdf", "application/pdf");
          return `Merged ${valid.length} PDFs through MyFileKit.pdf.merge — entirely in this browser.`;
        })} />
      </div>
    </ToolForm>
  );
}

function Base64Tool() {
  const [input, setInput] = useState("Hello MyFileKit");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setInput(""); setOutput(""); setStatus(initialStatus); }}>
    <Textarea label="Input" value={input} onChange={setInput} rows={7} />
    <Textarea label="Output" value={output} onChange={setOutput} rows={7} />
    <div className="flex flex-wrap gap-2"><PrimaryButton label="Encode" onClick={() => runSafely(setStatus, async () => { if (!input.trim()) throw new Error("Enter text to encode."); setOutput(base64Encode(input)); return "Encoded."; })} /><SecondaryButton label="Decode" onClick={() => runSafely(setStatus, async () => { setOutput(base64Decode(input)); return "Decoded."; })} /><SecondaryButton label="Copy" onClick={() => runSafely(setStatus, async () => { await copyText(requireOutput(output)); return "Copied."; })} /></div>
  </ToolForm>;
}

function FileHashTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setOutput(""); setStatus(initialStatus); }}>
    <FileControl accept="*/*" files={files} setFiles={setFiles} />
    <Textarea label="SHA-256" value={output} onChange={setOutput} rows={3} />
    <PrimaryButton label="Generate SHA-256" onClick={() => runSafely(setStatus, async () => { const [file] = validateFiles(files, tool.file); setOutput(await sha256File(file)); return `Hashed ${file.name}.`; })} />
  </ToolForm>;
}

function HashCompareTool({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setFiles([]); setExpected(""); setActual(""); setStatus(initialStatus); }}>
    <FileControl accept="*/*" files={files} setFiles={setFiles} />
    <Input label="Expected SHA-256" value={expected} onChange={setExpected} placeholder="Paste expected checksum" />
    <Textarea label="Actual SHA-256" value={actual} onChange={setActual} rows={3} />
    <PrimaryButton label="Compare hash" onClick={() => runSafely(setStatus, async () => {
      const [file] = validateFiles(files, tool.file);
      const digest = await sha256File(file);
      setActual(digest);
      const normalized = expected.trim().toLowerCase().replace(/\s+/g, "");
      if (!normalized) return `Hash generated for ${file.name}. Paste an expected hash to compare.`;
      return normalized === digest ? "Hash match. File integrity check passed." : "Hash mismatch. The file does not match the expected SHA-256.";
    })} />
  </ToolForm>;
}

function PasswordGeneratorTool() {
  const [mode, setMode] = useState<"password" | "passphrase">("password");
  const [length, setLength] = useState("20");
  const [lower, setLower] = useState(true);
  const [upper, setUpper] = useState(true);
  const [numbers, setNumbers] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [minimumNumbers, setMinimumNumbers] = useState("1");
  const [minimumSymbols, setMinimumSymbols] = useState("1");
  const [avoidAmbiguous, setAvoidAmbiguous] = useState(true);
  const [words, setWords] = useState("6");
  const [separator, setSeparator] = useState("-");
  const [capitalise, setCapitalise] = useState(true);
  const [includeNumber, setIncludeNumber] = useState(true);
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const strength = passwordStrength(output);
  const modeLabel = mode === "password" ? "password" : "passphrase";
  const selectMode = (nextMode: "password" | "passphrase") => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setOutput("");
    setStatus(initialStatus);
  };
  const reset = () => {
    setMode("password");
    setLength("20");
    setLower(true);
    setUpper(true);
    setNumbers(true);
    setSymbols(true);
    setMinimumNumbers("1");
    setMinimumSymbols("1");
    setAvoidAmbiguous(true);
    setWords("6");
    setSeparator("-");
    setCapitalise(true);
    setIncludeNumber(true);
    setOutput("");
    setStatus(initialStatus);
  };
  const generate = () => runSafely(setStatus, async () => {
    const value = mode === "password"
      ? generatePassword({
          length: Number(length), lower, upper, numbers, symbols,
          minimumNumbers: Number(minimumNumbers), minimumSymbols: Number(minimumSymbols), avoidAmbiguous,
        })
      : generatePassphrase({ words: Number(words), separator, capitalise, includeNumber });
    setOutput(value);
    return `${mode === "password" ? "Password" : "Passphrase"} generated locally.`;
  });
  return <ToolForm status={status} onReset={reset}>
    <div className="generator-mode-switch" role="tablist" aria-label="Generator type">
      <button className={`generator-mode-button ${mode === "password" ? "is-active" : ""}`} role="tab" aria-selected={mode === "password"} type="button" onClick={() => selectMode("password")}>Password</button>
      <button className={`generator-mode-button ${mode === "passphrase" ? "is-active" : ""}`} role="tab" aria-selected={mode === "passphrase"} type="button" onClick={() => selectMode("passphrase")}>Passphrase</button>
    </div>
    <div className="password-output-panel" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[.08em] text-neutral-500">Generated {modeLabel}</p>
        <span className={`password-strength strength-${strength.score}`}>{strength.label}{strength.bits ? ` · ~${strength.bits} bits` : ""}</span>
      </div>
      <p className="password-output-value">{output || "Generate a private value when ready."}</p>
    </div>
    {mode === "password" ? (
      <div className="grid gap-4">
        <div className="surface-card wabi-card-edge grid gap-4 p-4">
          <Input label="Length" value={length} onChange={setLength} type="number" helper="Choose between 8 and 128 characters. 16 or more is recommended." />
          <div className="password-option-grid">
            <Checkbox label="A–Z" checked={upper} onChange={setUpper} />
            <Checkbox label="a–z" checked={lower} onChange={setLower} />
            <Checkbox label="0–9" checked={numbers} onChange={setNumbers} />
            <Checkbox label="Symbols" checked={symbols} onChange={setSymbols} />
          </div>
        </div>
        <div className="surface-card wabi-card-edge grid gap-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Minimum numbers" value={minimumNumbers} onChange={setMinimumNumbers} type="number" helper="Set 0 to make numbers optional." />
            <Input label="Minimum symbols" value={minimumSymbols} onChange={setMinimumSymbols} type="number" helper="Set 0 to make symbols optional." />
          </div>
          <Checkbox label="Avoid ambiguous characters (I, l, 1, O, 0)" checked={avoidAmbiguous} onChange={setAvoidAmbiguous} />
        </div>
      </div>
    ) : (
      <div className="surface-card wabi-card-edge grid gap-4 p-4">
        <Input label="Number of words" value={words} onChange={setWords} type="number" helper="Choose between 3 and 20 words. Six or more is recommended." />
        <Input label="Word separator" value={separator} onChange={setSeparator} helper="Use a short separator such as - or ." />
        <div className="password-option-grid">
          <Checkbox label="Capitalise words" checked={capitalise} onChange={setCapitalise} />
          <Checkbox label="Add a two-digit number" checked={includeNumber} onChange={setIncludeNumber} />
        </div>
      </div>
    )}
    <div className="flex flex-wrap gap-2">
      <PrimaryButton label={`Generate ${modeLabel}`} onClick={generate} />
      <SecondaryButton label={`Copy ${modeLabel}`} onClick={() => runSafely(setStatus, async () => { await copyText(requireOutput(output)); return `${mode === "password" ? "Password" : "Passphrase"} copied.`; })} />
    </div>
  </ToolForm>;
}

function QrCodeTool() {
  const [input, setInput] = useState("https://github.com/indranilroy99/myfilekit");
  const [dataUrl, setDataUrl] = useState("");
  const [status, setStatus] = useState(initialStatus);
  return <ToolForm status={status} onReset={() => { setInput(""); setDataUrl(""); setStatus(initialStatus); }}>
    <Textarea label="Text or link" value={input} onChange={setInput} rows={5} />
    {dataUrl && <img className="surface-card wabi-card-edge mx-auto aspect-square w-full max-w-xs p-4" src={dataUrl} alt="Generated QR code" />}
    <div className="flex flex-wrap gap-2">
      <PrimaryButton label="Generate QR code" onClick={() => runSafely(setStatus, async () => { if (!input.trim()) throw new Error("Enter text or a link first."); setDataUrl(await QRCode.toDataURL(input, { width: 720, margin: 2, errorCorrectionLevel: "M" })); return "QR code generated locally."; })} />
      {dataUrl && <SecondaryButton label="Download PNG" onClick={() => runSafely(setStatus, async () => { downloadBlob(dataUrlToBlob(dataUrl), "myfilekit-qr-code.png"); return "QR code saved as a PNG."; })} />}
    </div>
  </ToolForm>;
}

// --- Sharing & Collaboration --------------------------------------------------
//
// Both tools below share one transport: a WebRTC DataChannel set up by hand.
// There is no signaling server (and cannot be — connect-src is 'self'), so each
// side produces one text code and the users pass those codes to each other.

async function sha256File(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function DeveloperTools({ tool }: { tool: Tool }) {
  if (tool.id === "api-playground-tool") return <ApiPlaygroundTool tool={tool} />;
  if (tool.id === "base64-tool") return <Base64Tool />;
  if (tool.id === "file-hash-tool") return <FileHashTool tool={tool} />;
  if (tool.id === "hash-compare-tool") return <HashCompareTool tool={tool} />;
  if (tool.id === "password-generator-tool") return <PasswordGeneratorTool />;
  if (tool.id === "qr-code-generator-tool") return <QrCodeTool />;
  return <StatusBox status={{ tone: "error", message: "This tool renderer is missing." }} />;
}
