Option Explicit

' GODA YT Launcher - Single-File Version
' Automatically builds if needed and launches the Electron app silently

Dim shell, fso, rootDir, mainJs, indexHtml, electronExe, packageJson
Dim needsBuild, errorMsg

' Initialize COM objects
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get project root directory (where this script is located)
rootDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Define critical file paths
mainJs = rootDir & "\dist-electron\main.js"
indexHtml = rootDir & "\dist\index.html"
electronExe = rootDir & "\node_modules\electron\dist\electron.exe"
packageJson = rootDir & "\dist-electron\package.json"

' Check if build is needed
needsBuild = False
If Not fso.FileExists(mainJs) Then needsBuild = True
If Not fso.FileExists(indexHtml) Then needsBuild = True

' Build if necessary
If needsBuild Then
    ' Change to project directory and build
    shell.CurrentDirectory = rootDir
    
    ' Run build command hidden
    Dim buildResult
    buildResult = shell.Run("cmd /c npm run build > nul 2>&1", 0, True)
    
    If buildResult <> 0 Then
        ' Build failed - show error message
        MsgBox "Build failed. Please ensure Node.js and npm are installed and run 'npm install' first.", vbCritical, "GODA YT Launch Error"
        WScript.Quit 1
    End If
End If

' Ensure dist-electron has package.json with commonjs type
If Not fso.FileExists(packageJson) Then
    Dim pkgFile
    Set pkgFile = fso.CreateTextFile(packageJson, True)
    pkgFile.WriteLine "{""type"":""commonjs""}"
    pkgFile.Close
    Set pkgFile = Nothing
End If

' Launch Electron app
shell.CurrentDirectory = rootDir

' Set environment variables for clean Electron launch
shell.Environment("Process")("ELECTRON_NO_ATTACH_CONSOLE") = "1"
' Remove (not blank) ELECTRON_RUN_AS_NODE: Electron treats the var's mere
' presence as "run as Node" and would launch with no GUI window.
shell.Environment("Process").Remove("ELECTRON_RUN_AS_NODE")

' Launch Electron (hidden, no console)
If fso.FileExists(electronExe) Then
    shell.Run """" & electronExe & """ .", 0, False
Else
    ' Fallback to electron.cmd if direct exe not found
    shell.Run "cmd /c """ & rootDir & "\node_modules\.bin\electron.cmd"" .", 0, False
End If

' Cleanup
Set shell = Nothing
Set fso = Nothing
