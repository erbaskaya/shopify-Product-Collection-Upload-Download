param(
  [switch]$IncludeMsi
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

if ($env:OS -ne "Windows_NT") {
  throw "The Windows installer must be built on Windows."
}

foreach ($command in @("node", "npm", "cargo", "rustc")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command is not installed or is not in PATH."
  }
}

Write-Host "Installing locked frontend dependencies..." -ForegroundColor Cyan
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }

Write-Host "Validating the frontend..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "Frontend validation failed." }

Write-Host "Building the Windows NSIS setup executable..." -ForegroundColor Cyan
npm run tauri build -- --bundles nsis
if ($LASTEXITCODE -ne 0) { throw "NSIS build failed." }

if ($IncludeMsi) {
  Write-Host "Building the optional Windows MSI package..." -ForegroundColor Cyan
  npm run tauri build -- --bundles msi
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "MSI build failed. The NSIS setup EXE can still be used."
  }
}

$Destination = Join-Path $ProjectRoot "installers\windows"
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$BundleRoot = Join-Path $ProjectRoot "src-tauri\target\release\bundle"
Get-ChildItem $BundleRoot -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -in @(".exe", ".msi") } |
  Copy-Item -Destination $Destination -Force

Write-Host "" 
Write-Host "Windows installer build completed." -ForegroundColor Green
Write-Host "Output: $Destination"
Get-ChildItem $Destination -File | Select-Object Name, Length, LastWriteTime
