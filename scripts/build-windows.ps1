#!/usr/bin/env pwsh

# Build script that works around winCodeSign symlink issue

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Building FLASH MEDIA (NSIS Installer)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Clean old cache
Write-Host "`nCleaning electron-builder cache..." -ForegroundColor Yellow
$ebCache = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
if (Test-Path $ebCache) {
    Remove-Item -Force -Recurse $ebCache -ErrorAction SilentlyContinue
    Write-Host "Cache cleaned" -ForegroundColor Green
}

# Build
Write-Host "`nStarting electron-builder..." -ForegroundColor Yellow
npx electron-builder --win nsis

if ($LASTEXITCODE -ne 0) {
    # If build fails due to symlink, try workaround
    if ($LASTEXITCODE -eq 1 -or $LASTEXITCODE -eq 2) {
        Write-Host "`nBuild failed, attempting workaround..." -ForegroundColor Red
        
        # Remove the problematic darwin folder
        $darwin = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign\*\darwin"
        Get-Item $darwin -ErrorAction SilentlyContinue | Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
        
        Write-Host "Retrying build..." -ForegroundColor Yellow
        npx electron-builder --win nsis
    }
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "BUILD SUCCESSFUL!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    
    # Show output files
    $files = Get-ChildItem "release" -File | Where-Object {$_.Extension -match "exe|zip"}
    Write-Host "`nGenerated files:" -ForegroundColor Cyan
    $files | ForEach-Object {
        $sizeMB = [math]::Round($_.Length / 1MB, 2)
        Write-Host "  ✓ $($_.Name) ($sizeMB MB)" -ForegroundColor Green
    }
} else {
    Write-Host "`nBUILD FAILED!" -ForegroundColor Red
    exit 1
}
