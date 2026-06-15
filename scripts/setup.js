#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
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

function main() {
  const nodeVersion = process.version;
  const npmVersion = commandVersion("npm");
  const packageJson = path.join(root, "package.json");
  const indexHtml = path.join(root, "index.html");
  const invoiceHtml = path.join(root, "invoice-generator", "index.html");

  log("MyFileKit setup");
  log("================");
  log(`Detected OS: ${osLabel()} (${os.platform()} ${os.arch()})`);
  log(`Detected Node.js: ${nodeVersion}`);

  if (nodeMajor(nodeVersion) < minimumNodeMajor) {
    log("");
    log(`Node.js ${minimumNodeMajor}+ is recommended for the local dev server.`);
    log("Install the current LTS version from https://nodejs.org/ and run this setup again.");
    process.exitCode = 1;
    return;
  }

  log(`Detected npm: ${npmVersion || "not found"}`);
  if (!npmVersion) {
    log("npm was not found. Reinstall Node.js from https://nodejs.org/ if you want to use npm scripts.");
  }

  log("");
  log("Project checks:");
  log(`- package.json: ${fs.existsSync(packageJson) ? "found" : "missing"}`);
  log(`- dashboard: ${fs.existsSync(indexHtml) ? "found" : "missing"}`);
  log(`- invoice generator: ${fs.existsSync(invoiceHtml) ? "found" : "missing"}`);
  log("- dependencies: none to install");
  log("- static mode: supported by opening index.html directly");

  log("");
  log("Next commands:");
  log("- npm run dev");
  log("- open http://localhost:4173");
  log("");
  log("Alternatives:");
  log("- VS Code Live Server");
  log("- python3 -m http.server 4173");
  log("- open index.html directly for most tools");
}

main();

