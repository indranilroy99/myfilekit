#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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

const audit = spawnSync("npm", ["audit", "--audit-level=moderate"], { cwd: root, encoding: "utf8" });
if (audit.status === 0) {
  process.stdout.write("npm audit OK\n");
} else {
  failed = true;
  process.stderr.write(audit.stdout || audit.stderr);
}

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
if (!html.includes("Content-Security-Policy") || !html.includes("X-Content-Type-Options")) {
  process.stderr.write("Missing baseline browser security headers/meta tags in index.html.\n");
  failed = true;
}

process.exit(failed ? 1 : 0);
