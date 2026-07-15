#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const minimumNodeMajor = 18;

function log(message = "") {
  process.stdout.write(`${message}\n`);
}

function commandVersion(command, args = ["--version"]) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function osLabel() {
  const platform = os.platform();
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return platform;
}

function nodeMajor(version) {
  return Number(String(version).replace(/^v/, "").split(".")[0]);
}

const checks = [
  ["dashboard", "index.html"],
  ["React entry", "src/main.tsx"],
  ["Tailwind styles", "src/styles.css"],
  ["Vite config", "vite.config.ts"],
  ["local PDF engine", "assets/vendor/pdf-lib.min.js"],
  ["local invoice export engine", "assets/vendor/html2canvas.min.js"],
  ["tool registry", "src/registry/tools.registry.js"],
  ["invoice generator", "invoice-generator/index.html"]
];

log("MyFileKit setup");
log("================");
log(`Detected OS: ${osLabel()} (${os.platform()} ${os.arch()})`);
log(`Detected Node.js: ${process.version}`);

if (nodeMajor(process.version) < minimumNodeMajor) {
  log("");
  log(`Node.js ${minimumNodeMajor}+ is recommended for the local dev server and checks.`);
  process.exit(1);
}

const npmVersion = commandVersion("npm");
log(`Detected npm: ${npmVersion || "not found"}`);
log("");
log("Project checks:");
const missingFiles = [];
for (const [label, file] of checks) {
  const exists = fs.existsSync(path.join(root, file));
  log(`- ${label}: ${exists ? "found" : "missing"}`);
  if (!exists) missingFiles.push(file);
}
const dependenciesInstalled = fs.existsSync(path.join(root, "node_modules"));
log(`- dependencies: ${dependenciesInstalled ? "installed" : "not installed"}`);
log("- app type: Vite + React + TypeScript + Tailwind");

if (!npmVersion) {
  log("");
  log("npm was not found. Install a Node.js distribution that includes npm, then run setup again.");
  process.exit(1);
}

if (missingFiles.length) {
  log("");
  log(`Setup cannot continue because required files are missing: ${missingFiles.join(", ")}`);
  process.exit(1);
}

log("");
log("Next commands:");
if (!dependenciesInstalled) log("- npm install");
log("- npm run dev");
log("- open the local URL printed by Vite");
