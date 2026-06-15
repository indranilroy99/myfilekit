$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "MyFileKit setup"
Write-Host "==============="
Write-Host "Detected OS: Windows"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js was not found."
  Write-Host "Install Node.js 18+ from https://nodejs.org/ to use npm run dev."
  Write-Host "You can still open index.html directly, or use VS Code Live Server."
  exit 1
}

node scripts/setup.js

