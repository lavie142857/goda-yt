import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { detectPlatform } from './platform.js'
import type {
  AppSettings,
  DownloadPlatform,
  DownloadRequest,
  OutputFormat,
  QualityOption,
  YtDlpProbe,
  YtDlpUpdateResult,
} from '../types.js'

interface DownloadExecOptions {
  settings: AppSettings
  onProgress: (patch: { percent?: number; speed?: string; eta?: string; stage?: string }) => void
  onOutputFile: (outputFile: string) => void
  signal: AbortSignal
}

export class YtDlpDownloadError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message)
    this.name = 'YtDlpDownloadError'
  }
}

export class YtDlpService {
  constructor(private readonly getSettings: () => AppSettings) {}

  async probe(): Promise<YtDlpProbe> {
    const executable = this.resolveExecutablePath()

    return new Promise((resolve) => {
      const child = spawn(executable, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })

      let output = ''
      let errorOutput = ''

      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8')
      })

      child.stderr.on('data', (chunk: Buffer) => {
        errorOutput += chunk.toString('utf8')
      })

      child.on('error', (error) => {
        resolve({
          available: false,
          version: null,
          executable,
          error: error.message,
        })
      })

      child.on('close', (code) => {
        if (code === 0) {
          resolve({
            available: true,
            version: output.trim() || 'unknown',
            executable,
          })
          return
        }

        resolve({
          available: false,
          version: null,
          executable,
          error: errorOutput.trim() || `yt-dlp exited with code ${code}`,
        })
      })
    })
  }

  async updateBinary(): Promise<YtDlpUpdateResult> {
    const executable = this.resolveExecutablePath()

    return new Promise((resolve) => {
      const child = spawn(executable, ['-U'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })

      let output = ''
      let errorOutput = ''

      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8')
      })

      child.stderr.on('data', (chunk: Buffer) => {
        errorOutput += chunk.toString('utf8')
      })

      child.on('error', async (error) => {
        resolve({
          ok: false,
          version: null,
          executable,
          message: error.message || 'Update failed.',
        })
      })

      child.on('close', async (code) => {
        if (code !== 0) {
          resolve({
            ok: false,
            version: null,
            executable,
            message: this.dedupeErrorLines(errorOutput) || `yt-dlp exited with code ${code ?? 'unknown'}`,
          })
          return
        }

        const probe = await this.probe()
        resolve({
          ok: probe.available,
          version: probe.version,
          executable,
          message: this.pickUpdateMessage(output, errorOutput),
        })
      })
    })
  }

  async download(
    request: DownloadRequest,
    options: DownloadExecOptions,
  ): Promise<void> {
    const executable = this.resolveExecutablePath()
    const platform = detectPlatform(request.url)
    const outputDir = request.outputDir?.trim() || options.settings.outputDir
    const runWithArgs = async (args: string[]): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })

        let mergedErrorOutput = ''

        const handleLine = (lineRaw: string) => {
          const line = lineRaw.trim()
          if (!line) {
            return
          }

          const progressMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%.*?at\s+([^\s]+).*?ETA\s+([\d:]+)/i)
          if (progressMatch) {
            options.onProgress({
              percent: Number(progressMatch[1]),
              speed: progressMatch[2],
              eta: progressMatch[3],
              stage: 'dang-tai',
            })
            return
          }

          if (line.startsWith('[ExtractAudio]')) {
            options.onProgress({ stage: 'dang-xu-ly-audio' })
            return
          }

          const outputFile = this.extractOutputFileFromLine(line, outputDir)
          if (outputFile) {
            options.onOutputFile(outputFile)
            return
          }

          if (line.startsWith('ERROR:')) {
            mergedErrorOutput += `${line}\n`
          }
        }

        const handleOutput = (chunk: Buffer) => {
          const text = chunk.toString('utf8')
          text
            .split(/\r?\n/)
            .filter(Boolean)
            .forEach((line) => handleLine(line))
        }

        child.stdout.on('data', handleOutput)
        child.stderr.on('data', (chunk: Buffer) => {
          mergedErrorOutput += chunk.toString('utf8')
          handleOutput(chunk)
        })

        const abortHandler = () => {
          child.kill('SIGTERM')
        }
        options.signal.addEventListener('abort', abortHandler)

        child.on('error', (error) => {
          options.signal.removeEventListener('abort', abortHandler)
          reject(error)
        })

        child.on('close', (code) => {
          options.signal.removeEventListener('abort', abortHandler)

          if (options.signal.aborted) {
            reject(new Error('DOWNLOAD_ABORTED'))
            return
          }

          if (code === 0) {
            options.onProgress({ percent: 100, stage: 'hoan-tat', eta: '00:00' })
            resolve()
            return
          }

          reject(
            new Error(
              mergedErrorOutput.trim() || `yt-dlp exited with code ${code ?? 'unknown'}`,
            ),
          )
        })
      })
    }

    try {
      await runWithArgs(this.buildArgs(request, options.settings, { relaxed: false, platform }))
    } catch (error) {
      const details = (error as Error).message

      if (this.shouldRetryWithRelaxedSelector(details, platform)) {
        try {
          await runWithArgs(this.buildArgs(request, options.settings, { relaxed: true, platform }))
          return
        } catch (retryError) {
          const normalized = this.normalizeYtDlpError((retryError as Error).message)
          throw new YtDlpDownloadError(normalized.message, normalized.permanent)
        }
      }

      const normalized = this.normalizeYtDlpError(details)
      throw new YtDlpDownloadError(normalized.message, normalized.permanent)
    }
  }

  private extractOutputFileFromLine(line: string, outputDir: string): string | null {
    const patterns = [
      /Destination:\s+(.+)$/i,
      /Merging formats into\s+(.+)$/i,
      /Moving file\s+.+?\s+to\s+(.+)$/i,
    ]

    for (const pattern of patterns) {
      const match = line.match(pattern)
      if (!match?.[1]) {
        continue
      }

      return this.resolveOutputFilePath(match[1], outputDir)
    }

    return null
  }

  private resolveOutputFilePath(rawPath: string, outputDir: string): string {
    const cleaned = rawPath
      .trim()
      .replace(/^file:/i, '')
      .replace(/^["']|["']$/g, '')

    if (path.isAbsolute(cleaned)) {
      return cleaned
    }

    return path.resolve(outputDir, cleaned)
  }

  private buildArgs(
    request: DownloadRequest,
    settings: AppSettings,
    options: { relaxed: boolean; platform: DownloadPlatform | null },
  ): string[] {
    const outputDir = request.outputDir?.trim() || settings.outputDir
    const outputTemplate = this.buildOutputTemplate(request.title)

    const args = [
      '--newline',
      '--no-playlist',
      '--retries',
      String(settings.maxRetries),
      '--fragment-retries',
      String(settings.maxRetries),
      '--socket-timeout',
      '30',
      '--paths',
      outputDir,
      '--output',
      outputTemplate,
      '--windows-filenames',
    ]

    const ffmpegLocation = this.resolveFfmpegLocation()
    if (ffmpegLocation) {
      args.push('--ffmpeg-location', ffmpegLocation)
    }

    this.pushJavaScriptRuntimeArgs(args)
    this.pushRequestArgs(args, request, settings.defaultFormat, options)

    args.push(request.url)

    return args
  }

  private pushJavaScriptRuntimeArgs(args: string[]): void {
    const runtimeSpec = this.resolveNodeRuntimeSpec()
    if (runtimeSpec) {
      args.push('--js-runtimes', runtimeSpec)
      return
    }

    // Fallback: allow yt-dlp to discover node from PATH.
    args.push('--js-runtimes', 'node')
  }

  private pushRequestArgs(
    args: string[],
    request: DownloadRequest,
    defaultFormat: OutputFormat,
    options: { relaxed: boolean; platform: DownloadPlatform | null },
  ): void {
    const requestedFormat = request.format ?? defaultFormat
    const maxHeight = this.resolveRequestedHeight(request.quality)

    if (request.variantSelector?.trim()) {
      args.push('-f', request.variantSelector.trim())
      this.pushContainerArgs(args, requestedFormat)
      return
    }

    const selector = this.buildVideoSelector(requestedFormat, maxHeight, options)

    if (request.preset === 'audioMp3') {
      args.push('-f', 'bestaudio/best')
      args.push('-x', '--audio-format', 'mp3')
      return
    }

    if (request.preset === 'audioM4a') {
      args.push('-f', 'bestaudio[ext=m4a]/bestaudio/best')
      args.push('-x', '--audio-format', 'm4a')
      return
    }

    if (request.preset === 'best') {
      args.push('-f', selector)
      this.pushContainerArgs(args, requestedFormat)
      return
    }

    if (maxHeight) {
      args.push('-S', this.buildSortSelector(maxHeight, options))
    } else if (!options.relaxed) {
      args.push('-S', 'codec:h264')
    }

    args.push('-f', selector)
    this.pushContainerArgs(args, requestedFormat)
  }

  private buildVideoSelector(
    requestedFormat: OutputFormat,
    maxHeight: number | null,
    options: { relaxed: boolean; platform: DownloadPlatform | null },
  ): string {
    const heightFilter = maxHeight ? `[height<=${maxHeight}]` : ''
    const prefersCombinedBest =
      options.relaxed ||
      options.platform === 'instagram' ||
      options.platform === 'facebook' ||
      options.platform === 'tiktok'

    if (prefersCombinedBest) {
      return `b${heightFilter}/bv*${heightFilter}+ba/best`
    }

    if (requestedFormat === 'mp4') {
      return `bv*[ext=mp4]${heightFilter}+ba[ext=m4a]/b[ext=mp4]${heightFilter}/b${heightFilter}`
    }

    if (requestedFormat === 'webm') {
      return `bv*[ext=webm]${heightFilter}+ba[ext=webm]/b[ext=webm]${heightFilter}/b${heightFilter}`
    }

    return `bv*${heightFilter}+ba/b${heightFilter}`
  }

  private buildSortSelector(
    maxHeight: number,
    options: { relaxed: boolean; platform: DownloadPlatform | null },
  ): string {
    if (
      options.relaxed ||
      options.platform === 'instagram' ||
      options.platform === 'facebook' ||
      options.platform === 'tiktok'
    ) {
      return `res:${maxHeight}`
    }

    return `res:${maxHeight},codec:h264`
  }

  private pushContainerArgs(args: string[], requestedFormat: OutputFormat): void {
    if (requestedFormat === 'avi' || requestedFormat === 'mov') {
      args.push('--merge-output-format', 'mkv')
      args.push('--remux-video', requestedFormat)
      return
    }

    args.push('--merge-output-format', requestedFormat)
  }

  private buildOutputTemplate(customTitle: string | null | undefined): string {
    const sanitized = this.sanitizeFileStem(customTitle)
    if (!sanitized) {
      return '%(title).120B [%(id)s].%(ext)s'
    }

    return `${sanitized}.%(ext)s`
  }

  private sanitizeFileStem(raw: string | null | undefined): string | null {
    if (!raw) {
      return null
    }

    const withoutReserved = raw
      .replace(/%/g, '')
      .replace(/[<>:"/\\|?*]/g, ' ')

    const cleaned = withoutReserved
      .split('')
      .map((char) => (char.charCodeAt(0) < 32 ? ' ' : char))
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '')

    if (!cleaned) {
      return null
    }

    const capped = cleaned.slice(0, 160)
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(capped)) {
      return `_${capped}`
    }

    return capped
  }

  private resolveRequestedHeight(quality: QualityOption | undefined): number | null {
    if (quality === '1080p') return 1080
    if (quality === '720p') return 720
    if (quality === '480p') return 480
    if (quality === '360p') return 360
    if (quality === '240p') return 240
    return null
  }

  private resolveNodeRuntimeSpec(): string | null {
    const fromEnv = process.env.YTVIBEZ_NODE_PATH?.trim()
    if (fromEnv) {
      return `node:${fromEnv}`
    }

    const whichCommand = process.platform === 'win32' ? 'where' : 'which'
    const probe = spawnSync(whichCommand, ['node'], {
      encoding: 'utf8',
      windowsHide: true,
    })

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

  private normalizeYtDlpError(raw: string): { message: string; permanent: boolean } {
    const details = this.dedupeErrorLines(raw)

    if (/empty media response/i.test(details) && /\[instagram\]/i.test(details)) {
      return {
        message: 'Instagram is not returning public media data for this reel. Login or browser cookies are required for this link.',
        permanent: true,
      }
    }

    if (/requested format is not available/i.test(details) && /\[instagram\]/i.test(details)) {
      return {
        message: 'Instagram did not expose the requested quality or container for this reel. The app already retried with a safer fallback. Try MP4 with Auto quality, or this reel may require login/cookies.',
        permanent: true,
      }
    }

    if (
      /sign in/i.test(details)
      || /authentication required/i.test(details)
      || /age[-_\s]?restricted/i.test(details)
    ) {
      return {
        message: 'This media requires login or age verification. The current build only supports public content.',
        permanent: true,
      }
    }

    if (/This video is not available/i.test(details)) {
      return {
        message: 'This video is not available in public-only mode. It may be private, removed, or restricted.',
        permanent: true,
      }
    }

    if (/No supported JavaScript runtime could be found/i.test(details)) {
      return {
        message: 'yt-dlp could not find a JavaScript runtime. Check Node.js installation or YTVIBEZ_NODE_PATH.',
        permanent: false,
      }
    }

    return {
      message: details,
      permanent: false,
    }
  }

  private dedupeErrorLines(raw: string): string {
    const seen = new Set<string>()
    const uniqueLines: string[] = []

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || seen.has(trimmed)) {
        continue
      }

      seen.add(trimmed)
      uniqueLines.push(trimmed)
    }

    return uniqueLines.join('\n').trim()
  }

  private pickUpdateMessage(stdout: string, stderr: string): string {
    const merged = `${stdout}\n${stderr}`.trim()

    if (/up to date/i.test(merged)) {
      return 'yt-dlp is already up to date.'
    }

    if (/updated yt-dlp to/i.test(merged)) {
      return merged.split(/\r?\n/).find((line) => /updated yt-dlp to/i.test(line))?.trim()
        ?? 'yt-dlp updated.'
    }

    return 'yt-dlp updated.'
  }

  private shouldRetryWithRelaxedSelector(
    raw: string,
    platform: DownloadPlatform | null,
  ): boolean {
    if (!platform) {
      return false
    }

    if (!/requested format is not available/i.test(raw)) {
      return false
    }

    return platform === 'instagram' || platform === 'facebook' || platform === 'tiktok'
  }

  private resolveExecutablePath(): string {
    const cwdBinary = path.join(process.cwd(), 'bin', 'yt-dlp.exe')
    if (existsSync(cwdBinary)) {
      return cwdBinary
    }

    const resourcesBinary = path.join(process.resourcesPath, 'bin', 'yt-dlp.exe')
    if (existsSync(resourcesBinary)) {
      return resourcesBinary
    }

    return 'yt-dlp'
  }

  private resolveFfmpegLocation(): string | null {
    const cwdDir = path.join(process.cwd(), 'bin')
    if (existsSync(path.join(cwdDir, 'ffmpeg.exe'))) {
      return cwdDir
    }

    const resourcesDir = path.join(process.resourcesPath, 'bin')
    if (existsSync(path.join(resourcesDir, 'ffmpeg.exe'))) {
      return resourcesDir
    }

    return null
  }

  getActiveExecutablePath(): string {
    return this.resolveExecutablePath()
  }

  getSettingsSnapshot(): AppSettings {
    return this.getSettings()
  }
}
