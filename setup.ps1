$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "MyFileKit setup"
Write-Host "==============="
Write-Host "Detected OS: Windows"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js was not found."
  Write-Host "Install Node.js 18+ from https://nodejs.org/, then run this setup again."
  Write-Host "The TypeScript source app must be built by Vite and cannot be opened directly."
  exit 1
}

node scripts/setup.js
