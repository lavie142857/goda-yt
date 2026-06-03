import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type {
  AuthMode,
  CookiesBrowser,
  DownloadPlatform,
  ErrorCategory,
  VideoMetadata,
  VideoQualityOption,
} from '../types.js'
import { pushJsRuntimeArgs, resolveYtDlpPath } from './binaries.js'
import type { CookiesHandle } from './auth-store.js'
import { detectPlatform } from './platform.js'

interface YtDlpFormat {
  acodec?: string
  ext?: string
  format_id?: string
  format_note?: string
  height?: number
  protocol?: string
  resolution?: string
  vcodec?: string
  width?: number
}

interface YtDlpInfo {
  duration?: number
  formats?: YtDlpFormat[]
  id?: string
  thumbnail?: string
  title?: string
}

interface ProbeSuccessResult {
  ok: true
  metadata: VideoMetadata
}

interface ProbeFailureResult {
  ok: false
  errorInfo: { message: string; category: ErrorCategory }
}

type ProbeResult = ProbeSuccessResult | ProbeFailureResult

type ProbeAuthAttempt = 'public' | 'cookies'

type TikTokExtractorProfile = 'web' | 'app-api'

interface FallbackMetadata {
  title: string | null
  duration: number | null
  thumbnail: string | null
}

function classifyError(errorOutput: string): { message: string; category: ErrorCategory } {
  const lower = errorOutput.toLowerCase()

  if (
    lower.includes('this video is not available')
    || lower.includes('video has been removed')
    || lower.includes('video has been deleted')
  ) {
    return {
      message: 'Video not available.',
      category: 'permanent',
    }
  }

  if (lower.includes('private video') || lower.includes('video is private')) {
    return {
      message: 'Private video.',
      category: 'permanent',
    }
  }

  if (lower.includes('geoblocked') || lower.includes('not available in your country')) {
    return {
      message: 'Geo-blocked video.',
      category: 'permanent',
    }
  }

  if (lower.includes('age restricted') || lower.includes('age_restricted')) {
    return {
      message: 'Age verification required.',
      category: 'permanent',
    }
  }

  if (lower.includes('sign in') || lower.includes('authentication required')) {
    return {
      message: 'Login required.',
      category: 'permanent',
    }
  }

  if (lower.includes('empty media response')) {
    return {
      message: 'Instagram requires login or cookies for this link.',
      category: 'permanent',
    }
  }

  // A hard IP/network block won't clear by retrying immediately — treat as
  // permanent so we fall back fast instead of wasting retry attempts.
  if (lower.includes('ip address is blocked') || lower.includes('blocked from accessing')) {
    return {
      message: 'Your network is temporarily blocked by the platform. Try later, switch network, or log in.',
      category: 'permanent',
    }
  }

  if (lower.includes('429') || lower.includes('too many requests')) {
    return {
      message: 'Rate limited.',
      category: 'temporary',
    }
  }

  if (lower.includes('timeout') || lower.includes('timed out')) {
    return {
      message: 'Connection timeout.',
      category: 'temporary',
    }
  }

  if (lower.includes('connection') || lower.includes('network') || lower.includes('unreachable')) {
    return {
      message: 'Network error.',
      category: 'temporary',
    }
  }

  if (lower.includes('no such file') || lower.includes('yt-dlp not found')) {
    return {
      message: 'yt-dlp not found.',
      category: 'system',
    }
  }

  if (lower.includes('permission denied') || lower.includes('access denied')) {
    return {
      message: 'Permission denied.',
      category: 'system',
    }
  }

  if (errorOutput.trim()) {
    const firstLine = errorOutput.split('\n')[0].replace('ERROR: ', '').substring(0, 96)
    return {
      message: firstLine || 'Unknown error.',
      category: 'temporary',
    }
  }

  return {
    message: 'Unknown error.',
    category: 'temporary',
  }
}

export class VideoInfoService {
  constructor(private readonly getCookies: () => CookiesHandle | null = () => null) {}

  async probeVideoInfo(
    url: string,
    authMode: AuthMode = 'public',
    cookiesBrowser: CookiesBrowser = 'none',
  ): Promise<VideoMetadata> {
    const platform = detectPlatform(url)
    if (!platform) {
      return {
        url,
        title: null,
        duration: null,
        thumbnail: null,
        platform: null,
        availableQualities: [this.buildAutoQuality()],
        probeLimited: true,
        error: {
          message: 'Unsupported URL.',
          category: 'system',
        },
      }
    }

    const probeAttempts = this.buildProbeAuthAttempts(authMode)
    let primaryProbe: ProbeResult | null = null

    for (let index = 0; index < probeAttempts.length; index++) {
      const authAttempt = probeAttempts[index]
      const result = await this.probeViaYtDlpWithRetries(url, platform, cookiesBrowser, authAttempt)
      primaryProbe = result

      if (result.ok) {
        break
      }

      const nextAuthAttempt = probeAttempts[index + 1]
      if (!this.shouldTryNextProbeAuth(result.errorInfo, authAttempt, nextAuthAttempt)) {
        break
      }
    }

    primaryProbe ??= {
      ok: false,
      errorInfo: {
        message: 'Probe failed.',
        category: 'temporary',
      },
    }

    if (primaryProbe.ok) {
      const filledMetadata = this.fillMissingMetadata(primaryProbe.metadata)
      return this.hydrateThumbnail(filledMetadata)
    }

    const fallbackMetadata = await this.fetchFallbackMetadata(url, platform)
    const resolvedTitle = fallbackMetadata.title ?? this.buildGenericTitle(platform, url)
    const resolvedThumbnail = fallbackMetadata.thumbnail ?? this.buildPlatformThumbnail(platform, url)
    const recoveredMetadata = Boolean(fallbackMetadata.title || fallbackMetadata.thumbnail)

    const fallbackResult = this.fillMissingMetadata({
      url,
      title: resolvedTitle,
      duration: fallbackMetadata.duration,
      thumbnail: resolvedThumbnail,
      platform,
      availableQualities: [this.buildAutoQuality()],
      probeLimited: true,
      ...(recoveredMetadata
        ? {
            warning: { message: 'Limited metadata.' },
          }
        : {
            error: primaryProbe.errorInfo,
          }),
    })

    return this.hydrateThumbnail(fallbackResult)
  }

  // Probe many URLs and stream each result via onResult the moment it's ready,
  // so the UI can show videos progressively instead of waiting for the batch.
  async probeStream(
    urls: string[],
    authMode: AuthMode,
    cookiesBrowser: CookiesBrowser,
    onResult: (metadata: VideoMetadata) => void,
  ): Promise<void> {
    // Keep this modest: too many parallel probes trips YouTube rate-limiting on
    // large pastes, which is worse than a slightly slower batch.
    const concurrency = 3
    let nextIndex = 0

    const runNext = async (): Promise<void> => {
      while (nextIndex < urls.length) {
        const currentIndex = nextIndex++
        const metadata = await this.probeVideoInfo(urls[currentIndex], authMode, cookiesBrowser)
        onResult(metadata)
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => runNext()))
  }

  private probeViaYtDlp(
    url: string,
    platform: DownloadPlatform,
    cookiesBrowser: CookiesBrowser,
    authAttempt: ProbeAuthAttempt,
    tiktokProfile: TikTokExtractorProfile = 'web',
  ): Promise<ProbeResult> {
    return new Promise((resolve) => {
      const executable = resolveYtDlpPath()
      // In public mode, never attach stored/browser cookies. Stale cookies are a
      // common source of false YouTube failures for otherwise public videos.
      const cookies = authAttempt === 'cookies' ? this.getCookies() : null
      const usingCookies = authAttempt === 'cookies' && (Boolean(cookies) || (cookiesBrowser !== 'none'))

      let settled = false
      const settle = (result: ProbeResult): void => {
        if (settled) {
          return
        }
        settled = true
        cookies?.cleanup()
        resolve(result)
      }

      const args = [
        '--dump-single-json',
        '--skip-download',
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificate',
        // Fewer transient extraction failures while reading metadata.
        '--extractor-retries',
        '2',
        // Force IPv4 — faster and fewer timeouts on dual-stack networks.
        '--force-ipv4',
        '--socket-timeout',
        '8',
      ]

      if (usingCookies && cookies) {
        args.push('--cookies', cookies.path)
      } else if (usingCookies && cookiesBrowser && cookiesBrowser !== 'none') {
        args.push('--cookies-from-browser', cookiesBrowser)
      }

      pushJsRuntimeArgs(args)
      this.pushTikTokExtractorArgs(args, platform, tiktokProfile)
      args.push(url)

      const child = spawn(executable, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })

      let output = ''
      let errorOutput = ''

      const timeout = setTimeout(() => {
        child.kill()
        settle({
          ok: false,
          errorInfo: {
            message: 'Timeout.',
            category: 'temporary',
          },
        })
      }, 18000)

      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8')
      })

      child.stderr.on('data', (chunk: Buffer) => {
        errorOutput += chunk.toString('utf8')
      })

      child.on('error', (error) => {
        clearTimeout(timeout)
        settle({
          ok: false,
          errorInfo: {
            message: error.message || 'Probe failed.',
            category: 'system',
          },
        })
      })

      child.on('close', (code) => {
        clearTimeout(timeout)

        if (code !== 0) {
          settle({
            ok: false,
            errorInfo: classifyError(errorOutput),
          })
          return
        }

        try {
          const parsed: YtDlpInfo = JSON.parse(output)
          const availableQualities = this.normalizeAvailableQualities(parsed.formats ?? [])

          settle({
            ok: true,
            metadata: {
              url,
              title: parsed.title || null,
              duration: parsed.duration || null,
              thumbnail: parsed.thumbnail || null,
              platform,
              availableQualities: availableQualities.length > 0
                ? availableQualities
                : [this.buildAutoQuality()],
              probeLimited: availableQualities.length === 0,
              warning: availableQualities.length === 0
                ? { message: 'Limited quality data.' }
                : undefined,
            },
          })
        } catch {
          settle({
            ok: false,
            errorInfo: {
              message: 'Failed to parse video information.',
              category: 'temporary',
            },
          })
        }
      })
    })
  }

  private async probeViaYtDlpWithRetries(
    url: string,
    platform: DownloadPlatform,
    cookiesBrowser: CookiesBrowser,
    authAttempt: ProbeAuthAttempt,
  ): Promise<ProbeResult> {
    // Retry transient failures (network/timeout/rate-limit, and TikTok's flaky
    // "rehydration" extraction) with growing backoff + jitter before falling back
    // to the weaker OpenGraph metadata. TikTok gets an app API profile because the
    // public webpage intermittently omits the rehydration JSON.
    const profiles: TikTokExtractorProfile[] = platform === 'tiktok'
      ? ['app-api', 'app-api', 'web', 'app-api']
      : ['web', 'web', 'web']

    let result: ProbeResult | null = null
    for (let attempt = 0; attempt < profiles.length; attempt++) {
      if (attempt > 0) {
        const backoff = 450 * attempt + Math.floor(Math.random() * 350)
        await new Promise((r) => setTimeout(r, backoff))
      }

      result = await this.probeViaYtDlp(url, platform, cookiesBrowser, authAttempt, profiles[attempt])
      if (result.ok || result.errorInfo.category !== 'temporary') {
        break
      }
    }

    return result ?? {
      ok: false,
      errorInfo: {
        message: 'Probe failed.',
        category: 'temporary',
      },
    }
  }

  private buildProbeAuthAttempts(authMode: AuthMode): ProbeAuthAttempt[] {
    if (authMode === 'cookies') {
      return ['cookies', 'public']
    }

    if (authMode === 'auto') {
      return ['public', 'cookies']
    }

    return ['public']
  }

  private shouldTryNextProbeAuth(
    errorInfo: ProbeFailureResult['errorInfo'],
    current: ProbeAuthAttempt,
    next: ProbeAuthAttempt | undefined,
  ): boolean {
    if (!next) {
      return false
    }

    if (current === 'cookies' && next === 'public') {
      return true
    }

    return this.canCookiesHelp(errorInfo.message)
  }

  private canCookiesHelp(message: string): boolean {
    return /sign in|authentication required|login required|age verification|age[-_\s]?restricted|private video|members[- ]only|join this channel|cookies|required|empty media response|account is private/i.test(
      message,
    )
  }

  private pushTikTokExtractorArgs(
    args: string[],
    platform: DownloadPlatform,
    profile: TikTokExtractorProfile,
  ): void {
    if (platform !== 'tiktok' || profile !== 'app-api') {
      return
    }

    args.push(
      '--extractor-args',
      `tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com;device_id=${this.buildTikTokDeviceId()};app_info=`,
    )
  }

  private buildTikTokDeviceId(): string {
    const min = 7250000000000000000n
    const max = 7325099899999994577n
    const span = max - min + 1n
    const random = BigInt(`0x${randomBytes(8).toString('hex')}`)

    return (min + (random % span)).toString()
  }

  private normalizeAvailableQualities(formats: YtDlpFormat[]): VideoQualityOption[] {
    const grouped = new Map<string, { score: number; option: VideoQualityOption }>()

    for (const format of formats) {
      const formatId = format.format_id?.trim()
      if (!formatId || format.ext === 'mhtml' || format.protocol === 'mhtml') {
        continue
      }

      if (format.vcodec === 'none') {
        continue
      }

      const dimensions = this.resolveDimensions(format)
      const qualityHeight = dimensions
        ? Math.min(dimensions.width, dimensions.height)
        : format.height ?? null
      const label = this.buildQualityLabel(qualityHeight, format.format_note)
      const hasAudio = Boolean(format.acodec && format.acodec !== 'none')
      const selector = hasAudio ? formatId : `${formatId}+bestaudio/best`
      const ext = format.ext ?? null

      const option: VideoQualityOption = {
        id: formatId,
        label,
        height: qualityHeight,
        ext,
        selector,
      }

      const score = this.scoreFormatOption({
        ext,
        formatNote: format.format_note ?? null,
        hasAudio,
        height: qualityHeight,
      })
      const existing = grouped.get(label)
      if (!existing || score > existing.score) {
        grouped.set(label, { score, option })
      }
    }

    return [...grouped.values()]
      .map((entry) => entry.option)
      .sort((left, right) => {
        const leftHeight = left.height ?? -1
        const rightHeight = right.height ?? -1
        if (leftHeight !== rightHeight) {
          return rightHeight - leftHeight
        }
        return left.label.localeCompare(right.label)
      })
  }

  private resolveDimensions(format: YtDlpFormat): { width: number; height: number } | null {
    if (format.width && format.height) {
      return { width: format.width, height: format.height }
    }

    if (!format.resolution) {
      return null
    }

    const match = format.resolution.match(/(\d+)x(\d+)/)
    if (!match) {
      return null
    }

    return {
      width: Number(match[1]),
      height: Number(match[2]),
    }
  }

  private buildQualityLabel(height: number | null, formatNote: string | undefined): string {
    if (height && Number.isFinite(height)) {
      return `${Math.round(height)}p`
    }

    const normalizedNote = formatNote?.trim()
    if (normalizedNote) {
      return normalizedNote
    }

    return 'Auto'
  }

  private scoreFormatOption(input: {
    ext: string | null
    formatNote: string | null
    hasAudio: boolean
    height: number | null
  }): number {
    let score = 0

    if (input.height) {
      score += input.height * 100
    }

    if (input.ext === 'mp4') {
      score += 50
    } else if (input.ext === 'webm') {
      score += 30
    }

    if (input.hasAudio) {
      score += 40
    }

    if (input.formatNote?.toLowerCase().includes('dash')) {
      score -= 5
    }

    return score
  }

  private buildAutoQuality(): VideoQualityOption {
    return {
      id: 'auto',
      label: 'Auto',
      height: null,
      ext: null,
      selector: 'best',
    }
  }

  private fillMissingMetadata(metadata: VideoMetadata): VideoMetadata {
    const normalizedThumbnail = this.normalizeThumbnailUrl(metadata.thumbnail, metadata.url)

    return {
      ...metadata,
      title: metadata.title || this.buildGenericTitle(metadata.platform, metadata.url),
      thumbnail: normalizedThumbnail || this.buildPlatformThumbnail(metadata.platform, metadata.url),
      availableQualities: metadata.availableQualities.length > 0
        ? metadata.availableQualities
        : [this.buildAutoQuality()],
    }
  }

  private async hydrateThumbnail(metadata: VideoMetadata): Promise<VideoMetadata> {
    const normalizedThumbnail = this.normalizeThumbnailUrl(metadata.thumbnail, metadata.url)
    if (!normalizedThumbnail) {
      return {
        ...metadata,
        thumbnail: this.buildPlatformThumbnail(metadata.platform, metadata.url),
      }
    }

    if (metadata.platform !== 'instagram') {
      return {
        ...metadata,
        thumbnail: normalizedThumbnail,
      }
    }

    const proxiedThumbnail = await this.fetchImageAsDataUrl(normalizedThumbnail)

    return {
      ...metadata,
      thumbnail: proxiedThumbnail ?? normalizedThumbnail,
    }
  }

  private async fetchFallbackMetadata(
    url: string,
    platform: DownloadPlatform,
  ): Promise<FallbackMetadata> {
    const fallbackFromPage = await this.fetchOpenGraphMetadata(url)
    const normalizedTitle = this.normalizeFallbackTitle(platform, fallbackFromPage.title)

    return {
      title: normalizedTitle,
      duration: fallbackFromPage.duration ?? null,
      thumbnail: fallbackFromPage.thumbnail ?? this.buildPlatformThumbnail(platform, url),
    }
  }

  private async fetchOpenGraphMetadata(url: string): Promise<FallbackMetadata> {
    try {
      const response = await fetch(url, {
        headers: {
          'accept-language': 'en-US,en;q=0.9',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        return { title: null, duration: null, thumbnail: null }
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('text/html')) {
        return { title: null, duration: null, thumbnail: null }
      }

      const html = await response.text()
      const durationRaw =
        this.findMetaContent(html, 'property', 'video:duration')
        ?? this.findMetaContent(html, 'name', 'video:duration')
        ?? this.findMetaContent(html, 'itemprop', 'duration')

      return {
        title:
          this.findMetaContent(html, 'property', 'og:title')
          ?? this.findMetaContent(html, 'name', 'twitter:title')
          ?? this.findMetaContent(html, 'name', 'title')
          ?? this.findTitleTag(html),
        duration: this.parseDuration(durationRaw),
        thumbnail:
          this.findMetaContent(html, 'property', 'og:image')
          ?? this.findMetaContent(html, 'name', 'twitter:image')
          ?? this.findMetaContent(html, 'property', 'og:image:url'),
      }
    } catch {
      return { title: null, duration: null, thumbnail: null }
    }
  }

  private normalizeThumbnailUrl(rawUrl: string | null | undefined, pageUrl: string): string | null {
    if (!rawUrl) {
      return null
    }

    let normalized = this.decodeHtml(rawUrl.trim())
    if (!normalized) {
      return null
    }

    normalized = normalized
      .replace(/\\u0026/gi, '&')
      .replace(/\\u003d/gi, '=')
      .replace(/\\u0025/gi, '%')
      .replace(/\\\//g, '/')

    try {
      if (normalized.startsWith('//')) {
        return new URL(`https:${normalized}`).toString()
      }

      return new URL(normalized, pageUrl).toString()
    } catch {
      return null
    }
  }

  private async fetchImageAsDataUrl(imageUrl: string): Promise<string | null> {
    const maxBytes = 5 * 1024 * 1024

    try {
      const response = await fetch(imageUrl, {
        headers: {
          accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          referer: 'https://www.instagram.com/',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(6000),
      })

      if (!response.ok) {
        return null
      }

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
      if (!contentType.startsWith('image/')) {
        return null
      }

      const contentLength = Number(response.headers.get('content-length') ?? '0')
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        return null
      }

      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length === 0 || bytes.length > maxBytes) {
        return null
      }

      const type = contentType.split(';')[0] || 'image/jpeg'
      return `data:${type};base64,${bytes.toString('base64')}`
    } catch {
      return null
    }
  }

  private findMetaContent(html: string, attribute: string, value: string): string | null {
    const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
      new RegExp(
        `<meta[^>]+${attribute}=["']${escapedValue}["'][^>]+content=["']([^"']+)["'][^>]*>`,
        'i',
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${escapedValue}["'][^>]*>`,
        'i',
      ),
    ]

    for (const pattern of patterns) {
      const match = html.match(pattern)
      if (match?.[1]) {
        return this.decodeHtml(match[1].trim())
      }
    }

    return null
  }

  private findTitleTag(html: string): string | null {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    return match?.[1] ? this.decodeHtml(match[1].trim()) : null
  }

  private parseDuration(raw: string | null): number | null {
    if (!raw) {
      return null
    }

    const seconds = Number(raw)
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds
    }

    const isoMatch = raw.match(
      /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i,
    )
    if (!isoMatch) {
      return null
    }

    const [, days = '0', hours = '0', minutes = '0', secs = '0'] = isoMatch
    return (
      Number(days) * 86400
      + Number(hours) * 3600
      + Number(minutes) * 60
      + Number(secs)
    )
  }

  private buildGenericTitle(platform: DownloadPlatform | null, url: string): string {
    if (platform === 'youtube') {
      const videoId = this.extractYouTubeVideoId(url)
      return videoId ? `YouTube video ${videoId}` : 'YouTube video'
    }

    if (platform === 'tiktok') {
      return 'TikTok video'
    }

    if (platform === 'facebook') {
      return 'Facebook video'
    }

    if (platform === 'instagram') {
      return 'Instagram reel'
    }

    return 'Video'
  }

  private buildPlatformThumbnail(platform: DownloadPlatform | null, url: string): string | null {
    if (platform !== 'youtube') {
      return null
    }

    const videoId = this.extractYouTubeVideoId(url)
    if (!videoId) {
      return null
    }

    return `https://i.ytimg.com/vi_webp/${videoId}/hqdefault.webp`
  }

  private extractYouTubeVideoId(url: string): string | null {
    try {
      const parsed = new URL(url)
      const host = parsed.hostname.toLowerCase()

      if (host === 'youtu.be') {
        return parsed.pathname.replace(/^\/+/, '').split('/')[0] || null
      }

      if (host.endsWith('youtube.com')) {
        const fromQuery = parsed.searchParams.get('v')
        if (fromQuery) {
          return fromQuery
        }

        const segments = parsed.pathname.split('/').filter(Boolean)
        const key = segments[0]
        if (key === 'shorts' || key === 'embed' || key === 'live') {
          return segments[1] || null
        }
      }
    } catch {
      return null
    }

    return null
  }

  private decodeHtml(value: string): string {
    return value
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, '\'')
      .replace(/&apos;/gi, '\'')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#8226;/gi, '•')
      .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
  }

  private normalizeFallbackTitle(
    platform: DownloadPlatform,
    title: string | null,
  ): string | null {
    if (!title) {
      return null
    }

    const normalized = title.trim()
    if (!normalized) {
      return null
    }

    if (platform === 'instagram') {
      const lower = normalized.toLowerCase()
      if (lower === 'instagram' || lower === 'login • instagram' || lower === 'login â€¢ instagram') {
        return null
      }
    }

    return normalized
  }
}
