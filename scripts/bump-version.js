#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bump = process.argv[2];
const allowed = new Set(["patch", "minor", "major"]);

if (!allowed.has(bump)) {
  process.stderr.write("Usage: npm run version:patch | version:minor | version:major\n");
  process.exit(1);
}

const packagePath = path.join(root, "package.json");
const lockPath = path.join(root, "package-lock.json");
const readmePath = path.join(root, "README.md");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const [major, minor, patch] = packageJson.version.split(".").map(Number);

const nextVersion = bump === "major"
  ? `${major + 1}.0.0`
  : bump === "minor"
    ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`;

packageJson.version = nextVersion;
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

if (fs.existsSync(lockPath)) {
  const lockJson = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  lockJson.version = nextVersion;
  if (lockJson.packages?.[""]) lockJson.packages[""].version = nextVersion;
  fs.writeFileSync(lockPath, `${JSON.stringify(lockJson, null, 2)}\n`);
}

if (fs.existsSync(readmePath)) {
  const readme = fs.readFileSync(readmePath, "utf8");
  const nextReadme = readme
    .replace(/Current app version: `[^`]+`/, `Current app version: \`${nextVersion}\``)
    .replace(/The current version is `[^`]+`/, `The current version is \`${nextVersion}\``)
    .replace(/(shields\.io\/badge\/version-)[^-\s)]+/, `$1${nextVersion}`);
  fs.writeFileSync(
    readmePath,
    nextReadme
  );
}

process.stdout.write(`MyFileKit version bumped to ${nextVersion}\n`);
