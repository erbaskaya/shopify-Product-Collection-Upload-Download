param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot
)

$ErrorActionPreference = "Stop"

$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backupRoot = Join-Path $ProjectRoot ".backups\ci-registry-fix\$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

$targets = @(
  @{ Source = Join-Path $sourceRoot "package-lock.json"; Target = Join-Path $ProjectRoot "package-lock.json" },
  @{ Source = Join-Path $sourceRoot ".github\workflows\build-installers.yml"; Target = Join-Path $ProjectRoot ".github\workflows\build-installers.yml" }
)

foreach ($item in $targets) {
  if (Test-Path $item.Target) {
    $relative = $item.Target.Substring($ProjectRoot.Length).TrimStart('\')
    $backupPath = Join-Path $backupRoot $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backupPath) | Out-Null
    Copy-Item $item.Target $backupPath -Force
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $item.Target) | Out-Null
  Copy-Item $item.Source $item.Target -Force
}

Write-Host "CI registry fix installed." -ForegroundColor Green
Write-Host "Backup: $backupRoot"
Write-Host "Commit and push package-lock.json and .github/workflows/build-installers.yml to GitHub."
