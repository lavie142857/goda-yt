# GODA YT Desktop Shortcut Creator
# This script creates a desktop shortcut for quick app launch

$ErrorActionPreference = "Stop"

try {
    $scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
    $appPath = (Resolve-Path (Join-Path $scriptPath "..\..")).Path
    $launcher = Join-Path $appPath "GODA YT.vbs"
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktopPath "GODA YT.lnk"

    # Check if launcher exists
    if (-not (Test-Path $launcher)) {
        Write-Host "Error: 'GODA YT.vbs' not found in $appPath"
        exit 1
    }

    # Create WScript Shell object
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $launcher
    $shortcut.WorkingDirectory = $appPath
    $shortcut.Description = "Launch GODA YT Video Downloader"

    $iconPath = Join-Path $appPath "icon.ico"
    if (Test-Path $iconPath) {
        $shortcut.IconLocation = $iconPath
    }

    $shortcut.Save()

    Write-Host "Desktop shortcut created successfully at $shortcutPath"
    Write-Host "You can now double-click the shortcut to launch GODA YT"
}
catch {
    Write-Host "Error creating shortcut: $_"
    exit 1
}
