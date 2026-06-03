import path from 'node:path'
import { readdirSync, statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import {
  pushJsRuntimeArgs,
  resolveFfmpegLocation,
  resolveNodeRuntimeSpec,
  resolveYtDlpPath,
} from './binaries.js'
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
  constructor(private readonly getCookiesFile: () => string | null = () => null) {}

  async probe(): Promise<YtDlpProbe> {
    const executable = resolveYtDlpPath()

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
    const executable = resolveYtDlpPath()

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
    const executable = resolveYtDlpPath()
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
          if (process.platform === 'win32' && child.pid) {
            // SIGTERM only kills the yt-dlp launcher, leaving ffmpeg/worker children
            // running. taskkill /T terminates the whole process tree immediately.
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
          } else {
            child.kill('SIGTERM')
          }
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

    // yt-dlp's console output drops emoji/special chars from filenames (even with
    // --print), so the path parsed from stdout can mismatch the real file. After a
    // successful download, locate the actual file on disk by its known name stem.
    const finalizeOutput = () => {
      const located = this.locateFinalOutput(request, options.settings)
      if (located) {
        options.onOutputFile(located)
      }
    }

    try {
      await runWithArgs(this.buildArgs(request, options.settings, { relaxed: false, platform }))
      finalizeOutput()
    } catch (error) {
      const details = (error as Error).message

      if (this.shouldRetryWithRelaxedSelector(details, platform)) {
        try {
          await runWithArgs(this.buildArgs(request, options.settings, { relaxed: true, platform }))
          finalizeOutput()
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

  // Find the real output file in the folder by the known filename stem (read from
  // the filesystem so emoji/special chars are preserved). Returns null when the
  // stem is unknown (fallback template) so the caller keeps the stdout-parsed path.
  private locateFinalOutput(request: DownloadRequest, settings: AppSettings): string | null {
    const stem = this.sanitizeFileStem(request.title)
    if (!stem) {
      return null
    }

    const outputDir = request.outputDir?.trim() || settings.outputDir
    const prefix = `${stem}.`

    try {
      const candidates = readdirSync(outputDir).filter(
        (name) =>
          name.startsWith(prefix)
          && !name.endsWith('.part')
          && !name.endsWith('.ytdl')
          && !/\.f\d+\.[a-z0-9]+$/i.test(name), // skip leftover fragment files
      )
      if (candidates.length === 0) {
        return null
      }

      let best = candidates[0]
      let bestTime = -1
      for (const name of candidates) {
        const mtime = statSync(path.join(outputDir, name)).mtimeMs
        if (mtime >= bestTime) {
          bestTime = mtime
          best = name
        }
      }
      return path.join(outputDir, best)
    } catch {
      return null
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

    // YouTube serves large fragmented DASH streams (parallelize aggressively).
    // Instagram/Facebook are rate-limit sensitive, so keep fewer parallel
    // fragments to avoid 429 blocks; TikTok is usually a single file anyway.
    const fragmentConcurrency = options.platform === 'youtube' ? '8' : '4'

    const args = [
      '--newline',
      '--no-playlist',
      '--retries',
      String(settings.maxRetries),
      '--fragment-retries',
      String(settings.maxRetries),
      // Retry transient extraction failures (reduces "could not extract" errors).
      '--extractor-retries',
      '3',
      // Retry transient file locks (e.g. antivirus scanning the .part file).
      '--file-access-retries',
      '3',
      // Download DASH/HLS fragments in parallel to better use bandwidth.
      '--concurrent-fragments',
      fragmentConcurrency,
      // Force IPv4 — avoids throttling/timeouts common on dual-stack networks.
      '--force-ipv4',
      '--socket-timeout',
      '30',
      '--paths',
      outputDir,
      '--output',
      outputTemplate,
      '--windows-filenames',
    ]

    const ffmpegLocation = resolveFfmpegLocation()
    if (ffmpegLocation) {
      args.push('--ffmpeg-location', ffmpegLocation)
    }

    const cookiesFile = this.getCookiesFile()
    if (cookiesFile) {
      args.push('--cookies', cookiesFile)
    } else if (settings.cookiesBrowser && settings.cookiesBrowser !== 'none') {
      args.push('--cookies-from-browser', settings.cookiesBrowser)
    }

    pushJsRuntimeArgs(args)
    this.pushRequestArgs(args, request, settings.defaultFormat, options)

    args.push(request.url)

    return args
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
      if (requestedFormat === 'mp4') {
        // MP4 output should always have AAC audio (never Opus) and an editor-
        // friendly video codec. YouTube only has H.264 up to 1080p; above that it's
        // VP9/AV1. So: at ≤1080p use H.264 (perfect for Premiere); above 1080p honor
        // the chosen resolution but prefer VP9 over AV1 (av01 breaks many editors).
        const height = this.resolveRequestedHeight(request.quality)
        const hf = height ? `[height<=${height}]` : ''

        if (!height || height <= 1080) {
          args.push('-S', `${height ? `res:${height},` : ''}vcodec:h264,acodec:aac`)
          args.push(
            '-f',
            `bv*${hf}[vcodec^=avc1]+ba[ext=m4a]/b${hf}[vcodec^=avc1]/bv*${hf}+ba[ext=m4a]/b${hf}`,
          )
        } else {
          args.push('-S', `res:${height},vcodec:vp9,acodec:aac`)
          args.push(
            '-f',
            `bv*${hf}[vcodec^=vp9]+ba[ext=m4a]/bv*${hf}[vcodec^=vp9]+ba/bv*${hf}+ba[ext=m4a]/b${hf}`,
          )
        }
      } else {
        args.push('-f', request.variantSelector.trim())
      }
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

  getNodeRuntimePath(): string | null {
    const spec = resolveNodeRuntimeSpec()
    return spec ? spec.replace(/^node:/, '') : null
  }
}
