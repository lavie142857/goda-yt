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
import { CPU_H264_RECODE_ARGS, resolveH264RecodePlan } from './gpu.js'
import { getSessionTikTokDeviceId } from './tiktok-device.js'
import type { CookiesHandle } from './auth-store.js'
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

interface RecodeProgressState {
  durationSeconds: number | null
  timeSeconds: number | null
  speed: { label: string; value: number | null } | null
}

type DownloadAuthAttempt = 'public' | 'cookies'

type TikTokExtractorProfile = 'web' | 'app-api'

type YouTubeExtractorProfile = 'default' | 'web-embedded'

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
  constructor(
    private readonly getCookies: () => CookiesHandle | null = () => null,
    private readonly hasCookies: () => boolean = () => false,
  ) {}

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
    const expectsRecode = this.willRecodeVideo(request, options.settings)
    const recodePlan = expectsRecode
      ? await resolveH264RecodePlan(options.settings.recodeEncoder)
      : null
    if (options.signal.aborted) {
      throw new Error('DOWNLOAD_ABORTED')
    }
    // Trimming re-encodes (keyframe-accurate cut) and yt-dlp emits ffmpeg frame=/
    // time= progress instead of "[download] %", so reuse the recode progress path
    // and measure against the clip length rather than the full video.
    const trimSection = this.buildDownloadSection(request.trimStart, request.trimEnd)
    const clipDurationSeconds = trimSection ? this.computeClipDurationSeconds(request) : null
    const downloadComponentIds: string[] = []
    const mapsSeparateStreams = platform === 'youtube'
      && request.preset !== 'audioMp3'
      && request.preset !== 'audioM4a'
    const runWithArgs = async (args: string[]): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })

        let mergedErrorOutput = ''
        let recodeStarted = false
        const recodeProgressState: RecodeProgressState = {
          durationSeconds: null,
          timeSeconds: null,
          speed: null,
        }

        let stdoutBuffer = ''
        let stderrBuffer = ''

        const handleLine = (lineRaw: string) => {
          const line = lineRaw.trim()
          if (!line) {
            return
          }

          if (line.startsWith('FLASH_PROGRESS|')) {
            const [, rawFormatId = '', rawPercent = '', rawSpeed = '', rawEta = ''] = line.split('|')
            const rawPercentNumber = Number(rawPercent.replace(/[^\d.]/g, ''))
            const speed = rawSpeed.trim()
            const eta = rawEta.trim()
            let percent = Number.isFinite(rawPercentNumber) ? rawPercentNumber : undefined

            if (percent !== undefined && mapsSeparateStreams) {
              const formatId = rawFormatId.trim()
              let componentIndex = downloadComponentIds.indexOf(formatId)
              if (componentIndex < 0) {
                downloadComponentIds.push(formatId)
                componentIndex = downloadComponentIds.length - 1
              }

              // Most YouTube quality downloads fetch video and audio separately.
              // Reserve the final 1% for merging so the displayed total never
              // reaches 100% and then falls back to 0% for the audio stream.
              percent = componentIndex === 0
                ? percent * 0.9
                : componentIndex === 1
                  ? 90 + percent * 0.09
                  : 99 + percent * 0.009
            }

            options.onProgress({
              percent,
              speed: speed && !/^(?:NA|Unknown(?: B\/s)?)$/i.test(speed) ? speed : undefined,
              eta: eta && !/^(?:NA|Unknown)$/i.test(eta) ? eta : undefined,
              stage: 'dang-tai',
            })
            return
          }

          if (line.startsWith('FLASH_OUTPUT|')) {
            const outputFile = this.resolveOutputFilePath(line.slice('FLASH_OUTPUT|'.length), outputDir)
            options.onOutputFile(outputFile)
            return
          }

          const progressMatch = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%.*?at\s+([^\s]+).*?ETA\s+([\d:]+)/i)
          if (progressMatch) {
            const percent = Number(progressMatch[1])
            options.onProgress({
              percent,
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

          if (line.startsWith('[VideoConvertor]') || line.startsWith('[Recode')) {
            recodeStarted = true
            options.onProgress({
              percent: 0,
              speed: '-',
              eta: '--:--',
              stage: 'dang-chuyen-ma',
            })
            return
          }

          if (recodeStarted || expectsRecode || trimSection) {
            const progressDuration = trimSection ? clipDurationSeconds : request.duration
            const recodeProgress = this.extractRecodeProgress(line, progressDuration, recodeProgressState)
            if (recodeProgress) {
              options.onProgress(recodeProgress)
              return
            }
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

        const handleOutput = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
          const buffered = stream === 'stdout' ? stdoutBuffer : stderrBuffer
          const text = buffered + chunk.toString('utf8')
          const lines = text.split(/\r?\n|\r/)
          const tail = lines.pop() ?? ''

          if (stream === 'stdout') {
            stdoutBuffer = tail
          } else {
            stderrBuffer = tail
          }

          lines.filter(Boolean).forEach((line) => handleLine(line))
        }

        const flushOutput = () => {
          if (stdoutBuffer) {
            handleLine(stdoutBuffer)
            stdoutBuffer = ''
          }
          if (stderrBuffer) {
            handleLine(stderrBuffer)
            stderrBuffer = ''
          }
        }

        child.stdout.on('data', (chunk: Buffer) => handleOutput(chunk, 'stdout'))
        child.stderr.on('data', (chunk: Buffer) => {
          mergedErrorOutput += chunk.toString('utf8')
          handleOutput(chunk, 'stderr')
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
          flushOutput()

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

    const runDownloadAttempt = async (authAttempt: DownloadAuthAttempt): Promise<void> => {
      // Decrypt cookies only for an authenticated attempt. Public attempts must not
      // attach cookies or --cookies-from-browser, otherwise stale auth can break
      // public YouTube videos.
      const cookies = authAttempt === 'cookies' ? this.getCookies() : null
      const cookiesPath = cookies?.path ?? null
      const initialYouTubeProfile: YouTubeExtractorProfile =
        platform === 'youtube' && authAttempt === 'public' ? 'web-embedded' : 'default'

      try {
        const baseProfile = this.getDefaultTikTokExtractorProfile(platform)
        await runWithArgs(this.buildArgs(
          request,
          options.settings,
          {
            relaxed: false,
            platform,
            authAttempt,
            tiktokProfile: baseProfile,
            // Public YouTube downloads use embedded first because the normal web
            // client is commonly challenged before transfer starts. Authenticated
            // attempts keep the normal client so login-only formats still work.
            youtubeProfile: initialYouTubeProfile,
            recodeArgs: recodePlan?.args,
          },
          cookiesPath,
        ))
      } catch (error) {
        let details = (error as Error).message

        // Keep the alternate YouTube client as a compatibility fallback. Public
        // attempts normally start embedded; cookie attempts start with regular web.
        const shouldTryAlternateYouTubeClient =
          initialYouTubeProfile === 'web-embedded'
            ? platform === 'youtube' && details !== 'DOWNLOAD_ABORTED'
            : this.shouldRetryWithYouTubeEmbedded(details, platform)

        if (shouldTryAlternateYouTubeClient) {
          const fallbackProfiles: YouTubeExtractorProfile[] = initialYouTubeProfile === 'default'
            ? ['web-embedded', 'web-embedded']
            : ['default']
          for (let attempt = 0; attempt < fallbackProfiles.length; attempt++) {
            if (attempt > 0) {
              await this.sleep(800 + Math.floor(Math.random() * 500))
            }

            options.onProgress({
              speed: '-',
              eta: '--:--',
              stage: 'dang-ket-noi',
            })

            try {
              await runWithArgs(this.buildArgs(
                request,
                options.settings,
                {
                  relaxed: false,
                  platform,
                  authAttempt,
                  tiktokProfile: this.getDefaultTikTokExtractorProfile(platform),
                  youtubeProfile: fallbackProfiles[attempt],
                  recodeArgs: recodePlan?.args,
                },
                cookiesPath,
              ))
              return
            } catch (embeddedError) {
              details = (embeddedError as Error).message
              if (!this.shouldRetryWithYouTubeEmbedded(details, platform)) {
                break
              }
            }
          }
        }

        // A hardware (GPU) encoder failed the recode at runtime -> retry once
        // forcing the CPU encoder so the download still completes.
        if (recodePlan?.hardware && this.isGpuEncoderError(details)) {
          try {
            await runWithArgs(this.buildArgs(
              request,
              options.settings,
              {
                relaxed: false,
                platform,
                authAttempt,
                tiktokProfile: this.getDefaultTikTokExtractorProfile(platform),
                recodeArgs: CPU_H264_RECODE_ARGS,
              },
              cookiesPath,
            ))
            return
          } catch (cpuError) {
            details = (cpuError as Error).message
          }
        }

        if (this.shouldRetryWithRelaxedSelector(details, platform)) {
          try {
            await runWithArgs(this.buildArgs(
              request,
              options.settings,
              {
                relaxed: true,
                platform,
                authAttempt,
                tiktokProfile: this.getDefaultTikTokExtractorProfile(platform),
              },
              cookiesPath,
            ))
            return
          } catch (retryError) {
            details = (retryError as Error).message
          }
        }

        if (this.shouldRetryWithTikTokAppApi(details, platform)) {
          const rescueProfiles: TikTokExtractorProfile[] = ['web', 'app-api', 'app-api']
          for (let rescueAttempt = 1; rescueAttempt <= rescueProfiles.length; rescueAttempt++) {
            await this.sleep(450 * rescueAttempt + Math.floor(Math.random() * 300))
            const rescueProfile = rescueProfiles[rescueAttempt - 1]
            try {
              await runWithArgs(this.buildArgs(
                request,
                options.settings,
                { relaxed: false, platform, authAttempt, tiktokProfile: rescueProfile },
                cookiesPath,
              ))
              return
            } catch (rescueError) {
              details = (rescueError as Error).message

              if (this.shouldRetryWithRelaxedSelector(details, platform)) {
                try {
                  await runWithArgs(this.buildArgs(
                    request,
                    options.settings,
                    { relaxed: true, platform, authAttempt, tiktokProfile: rescueProfile },
                    cookiesPath,
                  ))
                  return
                } catch (relaxedRescueError) {
                  details = (relaxedRescueError as Error).message
                }
              }

              if (!this.shouldRetryWithTikTokAppApi(details, platform)) {
                break
              }
            }
          }
        }

        throw new Error(details)
      } finally {
        cookies?.cleanup()
      }
    }

    const cookieSourceAvailable = this.hasCookies()
      || (options.settings.cookiesBrowser !== 'none')
    const authAttempts = this.buildDownloadAuthAttempts(
      options.settings.authMode ?? 'public',
      cookieSourceAvailable,
    )
    let lastError: Error | null = null

    for (let index = 0; index < authAttempts.length; index++) {
      const authAttempt = authAttempts[index]
      try {
        await runDownloadAttempt(authAttempt)
        finalizeOutput()
        return
      } catch (error) {
        lastError = error as Error
        const nextAuthAttempt = authAttempts[index + 1]
        if (!this.shouldTryNextDownloadAuth(lastError.message, authAttempt, nextAuthAttempt)) {
          break
        }
      }
    }

    const normalized = this.normalizeYtDlpError(lastError?.message ?? 'yt-dlp failed.')
    throw new YtDlpDownloadError(normalized.message, normalized.permanent)
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
    options: {
      relaxed: boolean
      platform: DownloadPlatform | null
      authAttempt: DownloadAuthAttempt
      tiktokProfile?: TikTokExtractorProfile
      youtubeProfile?: YouTubeExtractorProfile
      recodeArgs?: string | null
    },
    cookiesPath: string | null,
  ): string[] {
    const outputDir = request.outputDir?.trim() || settings.outputDir
    const outputTemplate = this.buildOutputTemplate(request.title)

    // Four concurrent fragments keeps good throughput without making unstable
    // connections or YouTube CDNs more likely to reject ranged requests.
    const fragmentConcurrency = '4'

    const args = [
      '--newline',
      '--no-colors',
      // --print after_move enables quiet mode in yt-dlp; force progress back on so
      // the UI still receives FLASH_PROGRESS events during the transfer.
      '--progress',
      '--no-playlist',
      '--progress-template',
      'download:FLASH_PROGRESS|%(info.format_id)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
      '--print',
      'after_move:FLASH_OUTPUT|%(filepath)s',
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
      '--retry-sleep',
      'http:exp=1:8',
      '--retry-sleep',
      'fragment:exp=1:8',
      '--retry-sleep',
      'extractor:exp=1:8',
      '--paths',
      outputDir,
      '--output',
      outputTemplate,
      '--windows-filenames',
    ]

    if (options.platform === 'youtube' || options.platform === 'tiktok') {
      args.push('--sleep-requests', '0.5')
    }

    const ffmpegLocation = resolveFfmpegLocation()
    if (ffmpegLocation) {
      args.push('--ffmpeg-location', ffmpegLocation)
    }

    if (options.authAttempt === 'cookies' && cookiesPath) {
      args.push('--cookies', cookiesPath)
    } else if (
      options.authAttempt === 'cookies'
      && settings.cookiesBrowser
      && settings.cookiesBrowser !== 'none'
    ) {
      args.push('--cookies-from-browser', settings.cookiesBrowser)
    }

    // Clip range (trim): download only the requested section with keyframe-accurate cuts.
    const section = this.buildDownloadSection(request.trimStart, request.trimEnd)
    if (section) {
      args.push('--download-sections', section)
      args.push('--force-keyframes-at-cuts')
    }

    // Write title/uploader/etc. into the file, and embed the thumbnail as cover
    // art. Thumbnail embedding is only supported for some containers — forcing it
    // on webm/avi FAILS the whole download, so gate it on the output format.
    if (settings.embedMetadata) {
      args.push('--embed-metadata')
      if (this.supportsThumbnailEmbed(request, settings)) {
        args.push('--embed-thumbnail')
      }
    }

    pushJsRuntimeArgs(args)
    this.pushYouTubeExtractorArgs(args, options.platform, options.youtubeProfile)
    this.pushTikTokExtractorArgs(args, options.platform, options.tiktokProfile)
    this.pushRequestArgs(args, request, settings.defaultFormat, settings.forceH264, options.recodeArgs, options)

    args.push(request.url)

    return args
  }

  // yt-dlp can only embed a thumbnail into some containers (mp3, mkv, m4a,
  // mp4/m4v/mov, ogg/opus/flac). Forcing it on webm/avi fails the whole download.
  private supportsThumbnailEmbed(request: DownloadRequest, settings: AppSettings): boolean {
    if (request.preset === 'audioMp3' || request.preset === 'audioM4a') {
      return true // mp3 / m4a both support embedding
    }

    const format = request.format ?? settings.defaultFormat
    return format === 'mp4' || format === 'mkv' || format === 'mov'
  }

  // Build a yt-dlp --download-sections value ("*start-end") from optional trim
  // timestamps. Returns null when neither is set (download the whole video).
  private buildDownloadSection(
    trimStart?: string | null,
    trimEnd?: string | null,
  ): string | null {
    const start = trimStart?.trim()
    const end = trimEnd?.trim()
    if (!start && !end) {
      return null
    }

    // Reject unparseable or illogical (start >= end) ranges rather than passing
    // garbage to yt-dlp, which would fail the whole download with a cryptic error.
    const startSec = start ? this.parseTimestampSeconds(start) : 0
    const endSec = end ? this.parseTimestampSeconds(end) : null
    if ((start && startSec === null) || (end && endSec === null)) {
      return null
    }
    if (startSec !== null && endSec !== null && startSec >= endSec) {
      return null
    }

    return `*${start || '0'}-${end || 'inf'}`
  }

  // Length of the trimmed clip in seconds, for progress. End defaults to the full
  // video duration; returns null when it can't be determined.
  private computeClipDurationSeconds(request: DownloadRequest): number | null {
    const start = this.parseTimestampSeconds(request.trimStart) ?? 0
    const fullDuration =
      typeof request.duration === 'number' && Number.isFinite(request.duration) ? request.duration : null
    const end = this.parseTimestampSeconds(request.trimEnd) ?? fullDuration
    if (end === null) {
      return null
    }

    const clip = end - start
    return clip > 0 ? clip : null
  }

  // Parse "H:MM:SS.mmm" / "MM:SS.mmm" / "SS.mmm" / plain seconds into seconds.
  private parseTimestampSeconds(value?: string | null): number | null {
    const trimmed = value?.trim()
    if (!trimmed) {
      return null
    }

    const parts = trimmed.split(':').map((part) => part.trim())
    if (parts.length > 3 || parts.some((part) => part === '' || Number.isNaN(Number(part)))) {
      return null
    }

    const seconds = parts.reduce((acc, part) => acc * 60 + Number(part), 0)
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
  }

  private pushRequestArgs(
    args: string[],
    request: DownloadRequest,
    defaultFormat: OutputFormat,
    forceH264: boolean,
    recodeArgs: string | null | undefined,
    options: { relaxed: boolean; platform: DownloadPlatform | null },
  ): void {
    const requestedFormat = request.format ?? defaultFormat
    const maxHeight = this.resolveRequestedHeight(request.quality)
    const selectorMaxHeight = this.shouldDropHeightOnRelaxed(options) ? null : maxHeight

    if (request.variantSelector?.trim() && options.platform === 'youtube' && requestedFormat === 'mp4') {
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
          args.push('--merge-output-format', 'mp4')
        } else {
          args.push('-S', `res:${height},vcodec:vp9,acodec:aac`)
          args.push(
            '-f',
            `bv*${hf}[vcodec^=vp9]+ba[ext=m4a]/bv*${hf}[vcodec^=vp9]+ba/bv*${hf}+ba[ext=m4a]/b${hf}`,
          )
          if (forceH264) {
            // Above 1080p YouTube has no H.264, so the video is VP9/AV1 — unreadable
            // in many editors (Premiere). Re-encode to H.264. Merge to MKV first so
            // the recode actually runs (recode->mp4 is skipped if already an mp4).
            // Encoder honors the user's GPU/CPU choice (GPU makes 4K re-encodes fast).
            args.push('--merge-output-format', 'mkv')
            args.push('--recode-video', 'mp4')
            args.push(
              '--postprocessor-args',
              `VideoConvertor:${recodeArgs || CPU_H264_RECODE_ARGS} -stats -stats_period 0.5 -progress pipe:2`,
            )
          } else {
            args.push('--merge-output-format', 'mp4')
          }
        }
        return
      }
      args.push('-f', request.variantSelector.trim())
      this.pushContainerArgs(args, requestedFormat)
      return
    }

    const selector = this.buildVideoSelector(requestedFormat, selectorMaxHeight, options)

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

    if (
      requestedFormat === 'webm'
      && options.platform
      && options.platform !== 'youtube'
    ) {
      // TikTok/Facebook/Instagram normally expose MP4/H.264 only. Asking yt-dlp
      // for a native WebM format fails before post-processing, so fetch the best
      // available stream and perform the requested container/codec conversion.
      const heightFilter = selectorMaxHeight ? `[height<=${selectorMaxHeight}]` : ''
      args.push('-f', `b${heightFilter}/bv*${heightFilter}+ba/best`)
      args.push('--recode-video', 'webm')
      return
    }

    if (request.preset === 'best') {
      args.push('-f', selector)
      this.pushContainerArgs(args, requestedFormat)
      return
    }

    if (selectorMaxHeight) {
      args.push('-S', this.buildSortSelector(selectorMaxHeight, options, requestedFormat))
    } else if (!options.relaxed && options.platform === 'youtube') {
      args.push('-S', 'codec:h264')
    }

    args.push('-f', selector)
    this.pushContainerArgs(args, requestedFormat)
  }

  private getDefaultTikTokExtractorProfile(platform: DownloadPlatform | null): TikTokExtractorProfile {
    return platform === 'tiktok' ? 'app-api' : 'web'
  }

  private pushTikTokExtractorArgs(
    args: string[],
    platform: DownloadPlatform | null,
    profile: TikTokExtractorProfile | undefined,
  ): void {
    if (platform !== 'tiktok' || profile !== 'app-api') {
      return
    }

    // TikTok's web page often omits the rehydration JSON, which makes yt-dlp fail
    // intermittently. Supplying app API parameters makes yt-dlp try the app endpoint
    // first while preserving its normal webpage fallback for web-only posts.
    args.push(
      '--extractor-args',
      `tiktok:device_id=${getSessionTikTokDeviceId()};app_info=`,
    )
  }

  private shouldDropHeightOnRelaxed(options: { relaxed: boolean; platform: DownloadPlatform | null }): boolean {
    return Boolean(
      options.relaxed
      && (
        options.platform === 'instagram'
        || options.platform === 'facebook'
        || options.platform === 'tiktok'
      ),
    )
  }

  private buildVideoSelector(
    requestedFormat: OutputFormat,
    maxHeight: number | null,
    options: { relaxed: boolean; platform: DownloadPlatform | null },
  ): string {
    const heightFilter = maxHeight ? `[height<=${maxHeight}]` : ''
    const prefersCombinedBest =
      requestedFormat !== 'webm'
      && (
        options.relaxed ||
        options.platform === 'instagram' ||
        options.platform === 'facebook' ||
        options.platform === 'tiktok'
      )

    if (prefersCombinedBest) {
      return `b${heightFilter}/bv*${heightFilter}+ba/best`
    }

    if (requestedFormat === 'mp4') {
      return `bv*[ext=mp4]${heightFilter}+ba[ext=m4a]/b[ext=mp4]${heightFilter}/b${heightFilter}`
    }

    if (requestedFormat === 'webm') {
      return `bv*[ext=webm]${heightFilter}+ba[ext=webm]/b[ext=webm]${heightFilter}`
    }

    return `bv*${heightFilter}+ba/b${heightFilter}`
  }

  private buildSortSelector(
    maxHeight: number,
    options: { relaxed: boolean; platform: DownloadPlatform | null },
    requestedFormat: OutputFormat,
  ): string {
    if (
      options.relaxed ||
      options.platform === 'instagram' ||
      options.platform === 'facebook' ||
      options.platform === 'tiktok'
    ) {
      return `res:${maxHeight}`
    }

    if (requestedFormat === 'webm') {
      return `res:${maxHeight},codec:vp9`
    }

    if (requestedFormat === 'mkv') {
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
    // Parse the height from any "<N>p" label (144p … 2160p, 4320p). Previously this
    // only knew ≤1080p, so 1440p/2160p resolved to null and silently downgraded the
    // download to 1080p. "Auto" / no label -> null (no cap).
    const match = quality?.match(/(\d{3,4})/)
    return match ? Number(match[1]) : null
  }

  private willRecodeVideo(request: DownloadRequest, settings: AppSettings): boolean {
    const requestedFormat = request.format ?? settings.defaultFormat
    const requestedHeight = this.resolveRequestedHeight(request.quality)

    return Boolean(
      detectPlatform(request.url) === 'youtube'
      && request.variantSelector?.trim()
      && settings.forceH264
      && requestedFormat === 'mp4'
      && requestedHeight
      && requestedHeight > 1080,
    )
  }

  // Recognise a hardware-encoder failure so we can retry on the CPU encoder.
  private isGpuEncoderError(raw: string): boolean {
    return /nvenc|h264_qsv|h264_amf|qsv|cuda|cuvid|impossible to convert|error initializing output stream|error while opening encoder|openencodesessionex|no capable devices|hardware/i.test(
      raw,
    )
  }

  private extractRecodeProgress(
    line: string,
    duration: number | null | undefined,
    state: RecodeProgressState,
  ): { percent?: number; speed?: string; eta?: string; stage: string } | null {
    const durationSeconds = this.extractDurationSeconds(line)
    const timeSeconds = this.extractProgressTimeSeconds(line)
    const speed = this.extractProgressSpeed(line)

    if (durationSeconds !== null) {
      state.durationSeconds = durationSeconds
    }
    if (timeSeconds !== null) {
      state.timeSeconds = timeSeconds
    }
    if (speed) {
      state.speed = speed
    }

    if (timeSeconds === null && !speed) {
      return null
    }

    const currentTimeSeconds = state.timeSeconds
    const currentSpeed = state.speed
    const effectiveDuration = typeof duration === 'number' && Number.isFinite(duration) && duration > 0
      ? duration
      : state.durationSeconds

    if (typeof effectiveDuration !== 'number' || !Number.isFinite(effectiveDuration) || effectiveDuration <= 0) {
      return {
        stage: 'dang-chuyen-ma',
        speed: currentSpeed?.label,
      }
    }

    if (currentTimeSeconds === null) {
      return {
        stage: 'dang-chuyen-ma',
        speed: currentSpeed?.label,
      }
    }

    const ratio = Math.min(1, Math.max(0, currentTimeSeconds / effectiveDuration))
    const remainingSeconds = Math.max(0, effectiveDuration - currentTimeSeconds)
    const eta = currentSpeed?.value && currentSpeed.value > 0
      ? this.formatEta(remainingSeconds / currentSpeed.value)
      : undefined

    return {
      percent: ratio * 100,
      speed: currentSpeed?.label,
      eta,
      stage: 'dang-chuyen-ma',
    }
  }

  private extractDurationSeconds(line: string): number | null {
    const durationMatch = line.match(/Duration:\s*(-?\d+):(\d+):(\d+(?:\.\d+)?)/i)
    if (!durationMatch) {
      return null
    }

    return (Number(durationMatch[1]) * 3600) + (Number(durationMatch[2]) * 60) + Number(durationMatch[3])
  }

  private extractProgressTimeSeconds(line: string): number | null {
    const timeMatch = line.match(/(?:^|\s)(?:time|out_time)=(-?\d+):(\d+):(\d+(?:\.\d+)?)/i)
    if (timeMatch) {
      return (Number(timeMatch[1]) * 3600) + (Number(timeMatch[2]) * 60) + Number(timeMatch[3])
    }

    const microsecondsMatch = line.match(/(?:^|\s)out_time_(?:ms|us)=(\d+)/i)
    if (microsecondsMatch) {
      return Number(microsecondsMatch[1]) / 1_000_000
    }

    return null
  }

  private extractProgressSpeed(line: string): { label: string; value: number | null } | null {
    const speedMatch = line.match(/(?:^|\s)speed=\s*([^\s]+)/i)
    if (!speedMatch?.[1]) {
      return null
    }

    const label = speedMatch[1]
    const numeric = Number(label.replace(/x$/i, ''))
    return {
      label,
      value: Number.isFinite(numeric) ? numeric : null,
    }
  }

  private formatEta(seconds: number): string {
    const safeSeconds = Math.max(0, Math.round(seconds))
    const hours = Math.floor(safeSeconds / 3600)
    const minutes = Math.floor((safeSeconds % 3600) / 60)
    const secs = safeSeconds % 60

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    }

    return `${minutes}:${String(secs).padStart(2, '0')}`
  }

  private buildDownloadAuthAttempts(
    authMode: AppSettings['authMode'],
    cookieSourceAvailable: boolean,
  ): DownloadAuthAttempt[] {
    if (!cookieSourceAvailable) {
      return ['public']
    }

    if (authMode === 'cookies') {
      return ['cookies', 'public']
    }

    if (authMode === 'auto') {
      return ['public', 'cookies']
    }

    return ['public']
  }

  private shouldTryNextDownloadAuth(
    raw: string,
    current: DownloadAuthAttempt,
    next: DownloadAuthAttempt | undefined,
  ): boolean {
    if (!next || raw === 'DOWNLOAD_ABORTED') {
      return false
    }

    if (current === 'cookies' && next === 'public') {
      return true
    }

    return this.canCookiesHelp(raw)
  }

  private canCookiesHelp(raw: string): boolean {
    return /sign in|authentication required|login required|age[-_\s]?restricted|confirm your age|private video|members[- ]only|join this channel|cookies|required|empty media response|account is private|not returning public media|unexpected response from webpage request|challenge|captcha|http error 403|forbidden/i.test(
      raw,
    )
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
        message: 'This media requires login or age verification. Switch Download mode to Auto/Always cookies and log in or import cookies.',
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

  private shouldRetryWithTikTokAppApi(raw: string, platform: DownloadPlatform | null): boolean {
    if (platform !== 'tiktok' || raw === 'DOWNLOAD_ABORTED') {
      return false
    }

    return /unable to extract universal data|unable to extract webpage video data|unable to extract aweme|failed to parse json|no video formats found|video not available, status code 0|unexpected response from webpage request|solve challenge|challenge|captcha|http error (?:403|429)|too many requests|timed? ?out|connection|network|incomplete data/i.test(
      raw,
    )
  }

  private shouldRetryWithYouTubeEmbedded(raw: string, platform: DownloadPlatform | null): boolean {
    if (platform !== 'youtube' || raw === 'DOWNLOAD_ABORTED') {
      return false
    }

    return /http error (?:403|429)|forbidden|too many requests|sign in to confirm.*not a bot|confirm you.?re not a bot|missing required visitor data|unable to fetch gvs po token/i.test(raw)
  }

  private pushYouTubeExtractorArgs(
    args: string[],
    platform: DownloadPlatform | null,
    profile: YouTubeExtractorProfile | undefined,
  ): void {
    if (platform === 'youtube' && profile === 'web-embedded') {
      args.push('--extractor-args', 'youtube:player_client=web_embedded')
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  getNodeRuntimePath(): string | null {
    const spec = resolveNodeRuntimeSpec()
    return spec ? spec.replace(/^node:/, '') : null
  }
}
