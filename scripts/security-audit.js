#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const dependencyCount = Object.keys(packageJson.dependencies || {}).length + Object.keys(packageJson.devDependencies || {}).length;
const requiredLocalAssets = ["assets/vendor/pdf-lib.min.js"];
let failed = false;

process.stdout.write("Security audit\n");
process.stdout.write("==============\n");
process.stdout.write(`Runtime npm dependencies: ${dependencyCount}\n`);

for (const asset of requiredLocalAssets) {
  const exists = fs.existsSync(path.join(root, asset));
  process.stdout.write(`${exists ? "OK" : "Missing"}: ${asset}\n`);
  if (!exists) failed = true;
}

if (dependencyCount === 0) {
  process.stdout.write("npm audit skipped: this project has no npm dependencies.\n");
} else {
  process.stdout.write("Run npm audit before release because dependencies are present.\n");
}

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
if (!html.includes("Content-Security-Policy") || !html.includes("X-Content-Type-Options")) {
  process.stderr.write("Missing baseline browser security headers/meta tags in index.html.\n");
  failed = true;
}

process.exit(failed ? 1 : 0);
