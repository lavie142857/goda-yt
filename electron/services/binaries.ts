import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

// Single source of truth for locating the bundled binaries / JS runtime, used by
// both the downloader and the probe so they can never drift out of sync.

function resolveBinFile(file: string): string | null {
  const cwdPath = path.join(process.cwd(), 'bin', file)
  if (existsSync(cwdPath)) {
    return cwdPath
  }

  const resourcesPath = path.join(process.resourcesPath, 'bin', file)
  if (existsSync(resourcesPath)) {
    return resourcesPath
  }

  return null
}

export function resolveYtDlpPath(): string {
  return resolveBinFile('yt-dlp.exe') ?? 'yt-dlp'
}

export function resolveFfmpegLocation(): string | null {
  const ffmpeg = resolveBinFile('ffmpeg.exe')
  return ffmpeg ? path.dirname(ffmpeg) : null
}

// Optional multi-connection downloader. Present -> yt-dlp uses it for faster,
// parallel downloads; absent -> yt-dlp falls back to its built-in downloader.
export function resolveAria2cPath(): string | null {
  return resolveBinFile('aria2c.exe')
}

export function resolveNodeRuntimeSpec(): string | null {
  const fromEnv = process.env.YTVIBEZ_NODE_PATH?.trim()
  if (fromEnv) {
    return `node:${fromEnv}`
  }

  const bundledNode = resolveBinFile('node.exe')
  if (bundledNode) {
    return `node:${bundledNode}`
  }

  const whichCommand = process.platform === 'win32' ? 'where' : 'which'
  const probe = spawnSync(whichCommand, ['node'], { encoding: 'utf8', windowsHide: true })
  if (probe.status === 0 && probe.stdout) {
    const firstLine = probe.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
    if (firstLine) {
      return `node:${firstLine}`
    }
  }

  return null
}

export function pushJsRuntimeArgs(args: string[]): void {
  const spec = resolveNodeRuntimeSpec()
  // Fallback: let yt-dlp discover node from PATH.
  args.push('--js-runtimes', spec ?? 'node')
}
