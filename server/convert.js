/**
 * Conversion helpers that shell out to system tools.
 *
 * Every external command is spawned with an ARGUMENT ARRAY and never through a
 * shell, and every filename is one we generated — a user-supplied name never
 * reaches a command line or a path. That is the whole attack surface of this
 * server, so it is closed here rather than at the route.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

/** Hard ceilings. A conversion that exceeds them is killed, not queued. */
export const LIMITS = {
  maxBytes: 100 * 1024 * 1024,
  timeoutMs: 120_000,
};

/** Extensions LibreOffice is allowed to open. An allowlist, never a denylist. */
export const OFFICE_EXTENSIONS = new Set([
  "doc", "docx", "odt", "rtf",
  "xls", "xlsx", "ods", "csv",
  "ppt", "pptx", "odp",
]);

export function isToolAvailable(command) {
  return new Promise((resolve) => {
    const probe = spawn(command, ["--version"], { stdio: "ignore" });
    probe.on("error", () => resolve(false));
    probe.on("close", (code) => resolve(code === 0));
  });
}

/** Which server-side conversions this host can actually perform. */
export async function capabilities() {
  const [office, ghostscript, ocr] = await Promise.all([
    isToolAvailable("soffice"),
    isToolAvailable("gs"),
    isToolAvailable("ocrmypdf"),
  ]);
  return { office, ghostscript, ocr };
}

/**
 * Run a command with a timeout, no shell, and no inherited stdio.
 * Rejects with the tool's own stderr, trimmed — never a raw stack.
 */
export function run(command, args, { timeoutMs = LIMITS.timeoutMs, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(new Error(`${command} could not be started: ${error.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (exit ${code}). ${stderr.trim().slice(0, 300)}`));
    });
  });
}

/** A private working directory per request, removed whether or not we succeed. */
export async function withScratch(task) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mfk-"));
  try {
    return await task(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Office document to PDF, via LibreOffice.
 *
 * This is the reason the server exists: the browser can only rasterise a
 * document, so its output has no selectable text. LibreOffice produces real
 * text, real fonts and real tables.
 *
 * @param {Buffer} input
 * @param {string} extension e.g. "docx" — validated against an allowlist
 */
export async function officeToPdf(input, extension) {
  const ext = String(extension || "").toLowerCase().replace(/^\./, "");
  if (!OFFICE_EXTENSIONS.has(ext)) {
    throw Object.assign(new Error(`This server does not convert .${ext} files.`), { status: 415 });
  }
  if (!Buffer.isBuffer(input) || !input.length) {
    throw Object.assign(new Error("No file was received."), { status: 400 });
  }
  if (input.length > LIMITS.maxBytes) {
    throw Object.assign(new Error(`That file is larger than the ${Math.round(LIMITS.maxBytes / 1024 / 1024)} MB limit.`), { status: 413 });
  }

  return withScratch(async (dir) => {
    // Our own name, so nothing the user chose reaches a path or a command line.
    const stem = crypto.randomBytes(8).toString("hex");
    const source = path.join(dir, `${stem}.${ext}`);
    await fs.writeFile(source, input);
    // -env:UserInstallation isolates the profile so concurrent conversions do
    // not fight over one LibreOffice user directory, which is the classic way
    // this silently returns nothing under load.
    await run("soffice", [
      `-env:UserInstallation=file://${path.join(dir, "profile")}`,
      "--headless", "--norestore", "--invisible", "--nolockcheck",
      "--convert-to", "pdf:writer_pdf_Export",
      "--outdir", dir,
      source,
    ], { cwd: dir });
    const produced = path.join(dir, `${stem}.pdf`);
    const bytes = await fs.readFile(produced).catch(() => null);
    if (!bytes || !bytes.length) {
      throw Object.assign(new Error("The converter produced no output. The document may be password-protected or corrupt."), { status: 422 });
    }
    return bytes;
  });
}
