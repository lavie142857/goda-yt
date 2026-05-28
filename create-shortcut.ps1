$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $scriptPath "scripts\windows\create-shortcut.ps1"

if (-not (Test-Path $target)) {
  Write-Host "Error: Cannot find $target"
  exit 1
}

powershell -ExecutionPolicy Bypass -File $target