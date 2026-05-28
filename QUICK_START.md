# YTvibez Quick Start

## Launch Development Server

### Option 1 (Recommended)

Double-click `quick-start.vbs`.

This opens the development server with a hidden command window. The console window runs in the background, keeping your screen clean while the dev server starts up.

### Option 2

Double-click `quick-start.bat`.

This opens the development server with a visible command window showing the build progress and server logs. The window title is automatically renamed to "YTvibez Development Server".

### Option 3

```powershell
cd C:\Users\Admin\Desktop\YTvibez
npm.cmd run dev
```

### Option 4

```powershell
powershell -ExecutionPolicy Bypass -File create-shortcut.ps1
```

This creates a desktop shortcut that launches the development server.

## Launch Production App

### Option 1

Double-click `launch-app.vbs`.

This opens only the app window without any command window. The app automatically builds if needed.

### Option 2

```powershell
powershell -ExecutionPolicy Bypass -File create-shortcut.ps1
```

This creates a desktop shortcut to launch the app directly.

## Portable package

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\package-portable.ps1
```

This creates `YTvibez-Packaged`. Double-click `YTvibez-Packaged\YTvibez.vbs` to open the packaged app without a command window.

## Use the app

1. Paste supported URLs into the input area, or click `Import file` for `.txt`, `.csv`, `.json`.
2. You can also drag and drop a file or plain URL text directly into the input card.
3. **Edit video names**: Click on the "Chỉnh sửa tên file..." field to customize the filename for each video before downloading.
4. Review the staging list, adjust quality/format, then start the download.
5. Use the Preferences card to choose the output folder and defaults.

## Public-only behavior

- Supported platforms stay the same: YouTube, TikTok, Facebook.
- This build only downloads public content.
- Videos that require sign-in, age verification, or private access will be marked unsupported.

## Troubleshooting

### yt-dlp not ready

- Check that `bin/yt-dlp.exe` exists, or install `yt-dlp` on `PATH`.

### Import found nothing

- Make sure the file contains full `https://...` URLs for supported hosts.
- `.json` import scans nested string values, but it still only keeps supported URLs.

### Download issues

- Check network connection.
- Update `yt-dlp`: `.\bin\yt-dlp.exe -U`
- Ensure `ffmpeg` is installed if you use remux-heavy output formats.
