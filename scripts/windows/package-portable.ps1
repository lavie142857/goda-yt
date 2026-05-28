$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
$packageRoot = Join-Path $projectRoot "YTvibez-Packaged"
$appRoot = Join-Path $packageRoot "app"
$electronRoot = Join-Path $packageRoot "electron"
$electronDist = Join-Path $projectRoot "node_modules\electron\dist"

Set-Location $projectRoot

if (-not (Test-Path $electronDist)) {
  throw "Electron runtime not found. Run npm install first."
}

npm.cmd run build

if (Test-Path $packageRoot) {
  Remove-Item -LiteralPath $packageRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $appRoot, $electronRoot | Out-Null

Copy-Item -LiteralPath (Join-Path $projectRoot "dist") -Destination (Join-Path $appRoot "dist") -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot "dist-electron") -Destination (Join-Path $appRoot "dist-electron") -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot "bin") -Destination (Join-Path $appRoot "bin") -Recurse
Copy-Item -Path (Join-Path $electronDist "*") -Destination $electronRoot -Recurse

$localesDir = Join-Path $electronRoot "locales"
if (Test-Path $localesDir) {
  Get-ChildItem -LiteralPath $localesDir -File |
    Where-Object { $_.Name -notin @("en-US.pak", "vi.pak") } |
    Remove-Item -Force
}

Get-ChildItem -LiteralPath $electronRoot -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -in @(".pdb", ".log") } |
  Remove-Item -Force

@'
{
  "name": "ytvibez-portable",
  "version": "0.0.0",
  "main": "dist-electron/main.js"
}
'@ | Set-Content -LiteralPath (Join-Path $appRoot "package.json") -Encoding UTF8

@'
@echo off
set "ROOT=%~dp0"
set "APP_DIR=%ROOT%app"
set "ELECTRON_EXE=%ROOT%electron\electron.exe"
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_NO_ATTACH_CONSOLE=1"
if not exist "%ELECTRON_EXE%" (
  echo Missing Electron runtime: %ELECTRON_EXE%
  pause
  exit /b 1
)
cd /d "%APP_DIR%"
start "" "%ELECTRON_EXE%" "%APP_DIR%"
'@ | Set-Content -LiteralPath (Join-Path $packageRoot "YTvibez.bat") -Encoding ASCII

@'
Option Explicit

Dim shell, fso, env, rootDir, appDir, electronExe, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set env = shell.Environment("PROCESS")

rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
appDir = rootDir & "\app"
electronExe = rootDir & "\electron\electron.exe"

If Not fso.FileExists(electronExe) Then
  MsgBox "Missing Electron runtime: " & electronExe, vbCritical, "YTvibez"
  WScript.Quit 1
End If

env("ELECTRON_RUN_AS_NODE") = ""
env("ELECTRON_NO_ATTACH_CONSOLE") = "1"
shell.CurrentDirectory = appDir
command = """" & electronExe & """ """ & appDir & """"
shell.Run command, 0, False
'@ | Set-Content -LiteralPath (Join-Path $packageRoot "YTvibez.vbs") -Encoding ASCII

@'
# YTvibez Portable

Double-click `YTvibez.vbs` to open the app without a command window.

Included:
- Production renderer: `app/dist`
- Electron main/preload: `app/dist-electron`
- yt-dlp binary: `app/bin/yt-dlp.exe`
- Electron runtime: `electron/`

Do not move files out of this folder. Move the whole `YTvibez-Packaged` folder together.
'@ | Set-Content -LiteralPath (Join-Path $packageRoot "README.txt") -Encoding UTF8

Write-Host "Portable package created: $packageRoot"
