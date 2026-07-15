#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const productionDependencyCount = Object.keys(packageJson.dependencies || {}).length;
const developmentDependencyCount = Object.keys(packageJson.devDependencies || {}).length;
const requiredLocalAssets = {
  "assets/vendor/pdf-lib.min.js": "0f9a5cad07941f0826586c94e089d89b918c46e5c17cf2d5a3c6f666e3bc694f",
  "assets/vendor/html2canvas.min.js": "e87e550794322e574a1fda0c1549a3c70dae5a93d9113417a429016838eab8cb",
};
let failed = false;

process.stdout.write("Security audit\n");
process.stdout.write("==============\n");
process.stdout.write(`Production npm dependencies: ${productionDependencyCount}\n`);
process.stdout.write(`Development npm dependencies: ${developmentDependencyCount}\n`);

for (const [asset, expectedDigest] of Object.entries(requiredLocalAssets)) {
  const assetPath = path.join(root, asset);
  if (!fs.existsSync(assetPath)) {
    process.stdout.write(`Missing: ${asset}\n`);
    failed = true;
    continue;
  }
  const digest = createHash("sha256").update(fs.readFileSync(assetPath)).digest("hex");
  const valid = digest === expectedDigest;
  process.stdout.write(`${valid ? "Integrity OK" : "Integrity mismatch"}: ${asset}\n`);
  if (!valid) failed = true;
}

const audit = spawnSync("npm", ["audit", "--audit-level=moderate"], { cwd: root, encoding: "utf8" });
if (audit.status === 0) {
  process.stdout.write("npm audit OK\n");
} else {
  failed = true;
  process.stderr.write(audit.stdout || audit.stderr);
}

for (const entrypoint of ["index.html", "invoice-generator/index.html"]) {
  const html = fs.readFileSync(path.join(root, entrypoint), "utf8");
  if (!html.includes("Content-Security-Policy") || !html.includes('name="referrer" content="no-referrer"')) {
    process.stderr.write(`Missing enforceable in-document browser policy in ${entrypoint}.\n`);
    failed = true;
  }
  if (/(?:src|href)=["']https?:\/\//i.test(html)) {
    process.stderr.write(`Remote production asset found in ${entrypoint}.\n`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
