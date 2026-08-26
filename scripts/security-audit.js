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
  "assets/vendor/xlsx.full.min.js": "cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41",
  // Vendored OCR engine (tesseract.js 7.0.0 / tesseract.js-core 7.0.0) plus the
  // English LSTM model. Vendored so OCR never reaches a CDN; see ocr.service.js.
  "assets/vendor/tesseract/tesseract.min.js": "000c27d9cd0def655f77b36c72a389c0ab13793aa31cb4d7aab56d09c0afbc7e",
  "assets/vendor/tesseract/worker.min.js": "576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d",
  "assets/vendor/tesseract/core/tesseract-core-lstm.wasm.js": "eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680",
  "assets/vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js": "c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38",
  "assets/vendor/tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js": "861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3",
  "assets/vendor/tesseract/lang/eng.traineddata.gz": "45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91",
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
