# FLASH MEDIA Quick Start

## Launch Development Server

### Option 1

Double-click `quick-start.vbs`.

This opens the development server with a hidden command window.

### Option 2

Double-click `quick-start.bat`.

This opens the development server with a visible command window showing build progress and server logs.

### Option 3

```powershell
cd "C:\Users\Admin\Desktop\GODA YT"
npm.cmd run dev
```

## Launch Production App

### Option 1

Double-click `launch-app.vbs`.

This opens only the app window without a command window. The launcher builds automatically if needed.

### Option 2

```powershell
npm.cmd run start
```

## Package Windows Installer

```powershell
npm.cmd run package:win
```

The installer is generated in `release\`.

## Use The App

1. Paste supported URLs into the input area, import a `.txt` / `.csv` / `.json` file, or drag URL text into the app.
2. Review the staging list and adjust quality, MP3/video mode, or filename before downloading.
3. Use Settings to choose language, output folder, defaults, file reuse, login/cookies, yt-dlp update behavior, and diagnostics.
4. For >1080p MP4 downloads, editor-compatible H.264 recode is enabled by default. Turn it off only when fast download/playback matters more than editor import.

## Login And Cookies

- Supported platforms: YouTube, TikTok, Facebook, and Instagram.
- Public videos download without login.
- For videos that require sign-in, use the account section in Settings to open the browser login flow or import a `cookies.txt` file.
- Some private, removed, geo-blocked, or age-restricted videos may still be unavailable depending on the platform.

## Troubleshooting

### yt-dlp Not Ready

- Check that `bin\yt-dlp.exe` exists, or install `yt-dlp` on `PATH`.

### Import Found Nothing

- Make sure the file contains full `https://...` URLs for supported hosts.
- `.json` import scans nested string values, but it still only keeps supported URLs.

### Download Issues

- Check network connection.
- Update yt-dlp from Settings, or run `bin\yt-dlp.exe -U`.
- Ensure `ffmpeg` is bundled or installed if you use merge/remux/recode-heavy output formats.
