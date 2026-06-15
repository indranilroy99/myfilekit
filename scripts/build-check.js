#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  "index.html",
  "assets/css/app.css",
  "assets/js/tools-registry.js",
  "assets/js/app.js",
  "invoice-generator/index.html"
];

let failed = false;

for (const file of requiredFiles) {
  const exists = fs.existsSync(path.join(root, file));
  process.stdout.write(`${exists ? "OK" : "Missing"}: ${file}\n`);
  if (!exists) failed = true;
}

for (const file of ["assets/js/tools-registry.js", "assets/js/app.js"]) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout);
  } else {
    process.stdout.write(`Syntax OK: ${file}\n`);
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

process.exit(failed ? 1 : 0);
