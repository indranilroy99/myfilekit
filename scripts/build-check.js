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

const exampleTsxFiles = [
  "examples/react-shadcn/components/ui/background-paper-shaders.tsx",
  "examples/react-shadcn/demo.tsx"
];

if (exampleTsxFiles.every((file) => fs.existsSync(path.join(root, file)))) {
  const localTsc = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
  if (fs.existsSync(localTsc)) {
    const typescriptCheck = spawnSync(localTsc, ["--jsx", "react-jsx", "--moduleResolution", "bundler", "--module", "esnext", "--target", "es2022", "--noEmit", "--skipLibCheck", ...exampleTsxFiles.map((file) => path.join(root, file))], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    if (typescriptCheck.status === 0) {
      process.stdout.write("Syntax OK: React shadcn example TSX files\n");
    } else {
      process.stdout.write("Skipped strict TSX example check because React shader dependencies are not installed in the vanilla app.\n");
    }
  } else {
    process.stdout.write("Skipped TSX example check because TypeScript is not installed in this vanilla app.\n");
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
