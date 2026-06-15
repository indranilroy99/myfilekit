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
  ["styles", "assets/css/app.css"],
  ["local PDF engine", "assets/vendor/pdf-lib.min.js"],
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

log(`Detected npm: ${commandVersion("npm") || "not found"}`);
log("");
log("Project checks:");
for (const [label, file] of checks) {
  log(`- ${label}: ${fs.existsSync(path.join(root, file)) ? "found" : "missing"}`);
}
log("- dependencies: none to install");
log("- app type: static browser app");
log("");
log("Next commands:");
log("- npm run dev");
log("- open http://localhost:4173");
