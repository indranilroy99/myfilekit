#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "index.html",
  "assets/css/app.css",
  "assets/myfilekit-logo.svg",
  "assets/vendor/pdf-lib.min.js",
  "src/main.js",
  "src/router.js",
  "src/registry/tools.registry.js",
  "src/tools/tool-implementations.js",
  "invoice-generator/index.html",
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "docs/manual-test-checklist.md"
];

let failed = false;

for (const file of requiredFiles) {
  const exists = fs.existsSync(path.join(root, file));
  process.stdout.write(`${exists ? "OK" : "Missing"}: ${file}\n`);
  if (!exists) failed = true;
}

const jsFiles = walk(path.join(root, "src")).filter((file) => file.endsWith(".js"));
for (const file of [...jsFiles, path.join(root, "scripts", "setup.js"), path.join(root, "scripts", "serve.js"), path.join(root, "scripts", "security-audit.js")]) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout);
  } else {
    process.stdout.write(`Syntax OK: ${path.relative(root, file)}\n`);
  }
}

const invoiceHtml = fs.readFileSync(path.join(root, "invoice-generator", "index.html"), "utf8");
const invoiceScript = invoiceHtml.match(/<script>([\s\S]*?)<\/script>/);
if (!invoiceScript) {
  failed = true;
  process.stderr.write("Missing inline invoice script\n");
} else {
  try {
    new vm.Script(invoiceScript[1]);
    process.stdout.write("Syntax OK: invoice-generator/index.html inline script\n");
  } catch (error) {
    failed = true;
    process.stderr.write(`${error.message}\n`);
  }
}

const dashboardHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
if (/unpkg|cdn\.|https:\/\/|coming soon|ai-assisted|ai tools/i.test(dashboardHtml)) {
  failed = true;
  process.stderr.write("Dashboard HTML contains remote, coming-soon, or AI wording that should not be visible.\n");
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(resolved) : resolved;
  });
}

process.exit(failed ? 1 : 0);
