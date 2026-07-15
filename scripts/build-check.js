#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "index.html",
  "vite.config.ts",
  "tsconfig.json",
  "src/main.tsx",
  "src/App.tsx",
  "src/styles.css",
  "src/lib/routing.ts",
  "src/router.js",
  "src/registry/tools.registry.js",
  "assets/myfilekit-logo.svg",
  "assets/vendor/pdf-lib.min.js",
  "assets/vendor/html2canvas.min.js",
  "invoice-generator/index.html",
  "README.md",
  "CHANGELOG.md",
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

for (const file of [...walk(path.join(root, "src")).filter((item) => item.endsWith(".js")), path.join(root, "scripts", "setup.js"), path.join(root, "scripts", "security-audit.js"), path.join(root, "scripts", "bump-version.js")]) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout);
  } else {
    process.stdout.write(`Syntax OK: ${path.relative(root, file)}\n`);
  }
}

const typecheck = spawnSync(commandPath("tsc"), ["--noEmit"], { cwd: root, encoding: "utf8" });
if (typecheck.status !== 0) {
  failed = true;
  process.stderr.write(typecheck.stderr || typecheck.stdout);
} else {
  process.stdout.write("TypeScript OK\n");
}

const build = spawnSync(commandPath("vite"), ["build"], { cwd: root, encoding: "utf8" });
if (build.status !== 0) {
  failed = true;
  process.stderr.write(build.stderr || build.stdout);
} else {
  process.stdout.write("Vite build OK\n");
}

for (const file of [
  "dist/index.html",
  "dist/invoice-generator/index.html",
  "dist/assets/vendor/pdf-lib.min.js",
  "dist/assets/vendor/html2canvas.min.js"
]) {
  const exists = fs.existsSync(path.join(root, file));
  process.stdout.write(`${exists ? "Built" : "Missing build output"}: ${file}\n`);
  if (!exists) failed = true;
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

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
if (!readme.includes(`The current version is \`${packageJson.version}\``) || !readme.includes(`version-${packageJson.version}-`)) {
  failed = true;
  process.stderr.write("README version does not match package.json. Run a version script or update the release documentation.\n");
}

const localReadmeLinks = [...readme.matchAll(/\]\((\.\/[^)#]+)(?:#[^)]+)?\)/g)].map((match) => match[1]);
for (const link of new Set(localReadmeLinks)) {
  if (!fs.existsSync(path.resolve(root, link))) {
    failed = true;
    process.stderr.write(`README link does not resolve: ${link}\n`);
  }
}

function commandPath(command) {
  return path.join(root, "node_modules", ".bin", process.platform === "win32" ? `${command}.cmd` : command);
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(resolved) : resolved;
  });
}

process.exit(failed ? 1 : 0);
