# FLASH MEDIA

Desktop downloader for YouTube, TikTok, Facebook, and Instagram videos using Electron + yt-dlp.

## Current direction

- Public downloads by default, with optional browser/cookies login for restricted media.
- Single dark glass desktop UI with one staging flow.
- Smart URL intake from paste, drag-and-drop text, or `.txt` / `.csv` / `.json` files.
- Realtime queue with progress, speed, ETA, retry state, and cancel.

## Features

- Paste one or many supported URLs into a staging list.
- Import URL files and automatically dedupe repeated links.
- Batch-adjust quality and format before download.
- Save preferences for default format, output folder, concurrency, and retries.
- Preserve per-item `quality`, `format`, and duration metadata all the way down to yt-dlp arguments.
- Editor-compatible mode is enabled by default for >1080p MP4 downloads: the app re-encodes to H.264 and reports real recode progress.

## Requirements

- Node.js 20+
- Windows 10/11
- `yt-dlp` available in `bin/yt-dlp.exe` or on `PATH`
- `ffmpeg` recommended on `PATH` for merge/remux stability

## Development

```powershell
npm install
npm run dev
```

## Quick Launch

Double-click `launch-app.vbs` to open the app without a visible command window. The launcher reuses the existing production build when available and only rebuilds if `dist/` or `dist-electron/` is missing.

## Build

```powershell
npm run build
```

Before packaging, verify or restore the pinned Windows binaries:

```powershell
npm run ensure:binaries
```

The versions, official download URLs, and SHA-256 hashes are defined in
`scripts/binaries.manifest.json`. All package scripts run this check automatically.

Outputs:

- Renderer: `dist/`
- Electron main/preload: `dist-electron/`

## Lint

```powershell
npm run lint
```

## Important files

- `src/App.tsx`: main renderer workflow and dark glass UI
- `src/lib/url-import.ts`: smart URL parsing for paste/import/drop
- `electron/main.ts`: BrowserWindow setup and IPC handlers
- `electron/services/download-manager.ts`: queue, retry, cancel
- `electron/services/yt-dlp-service.ts`: yt-dlp execution and progress parsing
- `electron/services/video-info-service.ts`: metadata probing and error classification
- `electron/services/settings-store.ts`: persisted preferences

## Notes

- The app can use imported cookies or a browser login flow when media requires sign-in.
- Some private, removed, geo-blocked, or age-restricted media may still be unavailable depending on the platform.
- Keeping concurrency around `2-3` is usually the safest default.
