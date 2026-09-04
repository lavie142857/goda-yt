import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent, SyntheticEvent } from 'react'
import type {
  AppLanguage,
  AppSettings,
  AuthMode,
  DiagnosticsReport,
  DownloadPreset,
  DownloadStatus,
  DownloadTask,
  NetworkStatus,
  QueueControlState,
  OutputFormat,
  RecodeEncoder,
  SystemNotification,
  UpdateStatus,
  VideoMetadata,
  VideoQualityOption,
  YtDlpAutoUpdateMode,
  YtDlpProbe,
  YtDlpUpdateResult,
} from './shared/contracts'
import { mergeImportedUrls, parseTextInput } from './lib/url-import'
import { canonicalizeVideoKey } from './lib/video-key'
import { getMessages, type Messages } from './lib/i18n'
import './App.css'

const FORMAT_OPTIONS: Array<{ value: OutputFormat; label: string }> = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WebM' },
  { value: 'mkv', label: 'MKV' },
  { value: 'avi', label: 'AVI' },
  { value: 'mov', label: 'MOV' },
]

interface StagedVideo extends VideoMetadata {
  id: string
  preset: DownloadPreset
  selectedVariantId: string
  fileNameOverride: string
  trimStart: string
  trimEnd: string
}

interface NoticeState {
  tone: 'info' | 'success' | 'error'
  message: string
}

type SmartProfileId = 'balanced' | 'fast' | 'safe'

const AUTO_QUALITY: VideoQualityOption = {
  id: 'auto',
  label: 'Auto',
  height: null,
  ext: null,
  selector: 'best',
}

const RECOMMENDED_BATCH_QUALITY = '__recommended__'

const SMART_PROFILES: Array<{
  id: SmartProfileId
  labelKey: 'profileBalanced' | 'profileFast' | 'profileSafe'
  descKey: 'profileBalancedDesc' | 'profileFastDesc' | 'profileSafeDesc'
  patch: Pick<AppSettings, 'maxConcurrent' | 'maxRetries' | 'defaultFormat'>
}> = [
  {
    id: 'balanced',
    labelKey: 'profileBalanced',
    descKey: 'profileBalancedDesc',
    patch: {
      maxConcurrent: 2,
      maxRetries: 2,
      defaultFormat: 'mp4',
    },
  },
  {
    id: 'fast',
    labelKey: 'profileFast',
    descKey: 'profileFastDesc',
    patch: {
      maxConcurrent: 4,
      maxRetries: 1,
      defaultFormat: 'mp4',
    },
  },
  {
    id: 'safe',
    labelKey: 'profileSafe',
    descKey: 'profileSafeDesc',
    patch: {
      maxConcurrent: 1,
      maxRetries: 4,
      defaultFormat: 'mp4',
    },
  },
]

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--'

  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return `${mins}:${String(secs).padStart(2, '0')}`
}

function platformLabel(platform: VideoMetadata['platform'], t: Messages): string {
  if (platform === 'youtube') return 'YouTube'
  if (platform === 'tiktok') return 'TikTok'
  if (platform === 'facebook') return 'Facebook'
  if (platform === 'instagram') return 'Instagram'
  return t.platformUnknown
}

function platformIcon(platform: VideoMetadata['platform']): string {
  if (platform === 'youtube') return '▶'
  if (platform === 'tiktok') return '♪'
  if (platform === 'facebook') return 'f'
  if (platform === 'instagram') return '◎'
  return '●'
}

function platformColorClass(platform: VideoMetadata['platform']): string {
  if (platform === 'youtube') return 'platform-youtube'
  if (platform === 'tiktok') return 'platform-tiktok'
  if (platform === 'facebook') return 'platform-facebook'
  if (platform === 'instagram') return 'platform-instagram'
  return ''
}

function queueTitle(task: DownloadTask, t: Messages): string {
  return task.request.title?.trim() || platformLabel(task.platform, t)
}

function formatQueueError(error: string, t: Messages): string {
  const cleaned = error
    .replace(/^ERROR:\s*/i, '')
    .replace(/^\[[^\]]+\]\s*/i, '')
    .trim()

  if (/requested format is not available/i.test(cleaned)) {
    return t.errQualityUnavailable
  }
  if (/empty media response/i.test(cleaned)) {
    return t.errInstagramNoMedia
  }
  if (/video unavailable|this video is unavailable/i.test(cleaned)) {
    return t.errVideoUnavailable
  }
  if (/private video|sign in if you'?ve been granted/i.test(cleaned)) {
    return t.errPrivateVideo
  }
  if (/members[- ]only|join this channel/i.test(cleaned)) {
    return t.errMembersOnly
  }
  if (/sign in to confirm your age|age[- ]restricted|inappropriate for some/i.test(cleaned)) {
    return t.errAgeRestricted
  }
  if (/this live event will begin|live stream recordings are not available/i.test(cleaned)) {
    return t.errLiveNotStarted
  }
  if (/premiere will begin/i.test(cleaned)) {
    return t.errPremiere
  }
  if (/HTTP Error 429|too many requests/i.test(cleaned)) {
    return t.err429
  }
  if (/HTTP Error 403|forbidden/i.test(cleaned)) {
    return t.err403
  }
  if (/HTTP Error 404|not found/i.test(cleaned)) {
    return t.err404
  }
  if (/(geo|country).{0,20}(restrict|block|not available)/i.test(cleaned)) {
    return t.errGeo
  }
  if (/copyright|removed by the uploader/i.test(cleaned)) {
    return t.errCopyright
  }
  if (/unable to download webpage|getaddrinfo|ENOTFOUND|ECONNRESET|ECONNREFUSED|network is unreachable|timed? ?out/i.test(cleaned)) {
    return t.errNetwork
  }
  if (/no video formats found|unable to extract|unsupported url/i.test(cleaned)) {
    return t.errExtract
  }
  if (/ffmpeg/i.test(cleaned) && /not found|missing|no such file/i.test(cleaned)) {
    return t.errFfmpegMissing
  }
  if (/disk full|no space left/i.test(cleaned)) {
    return t.errDiskFull
  }
  if (/permission denied|access is denied|EACCES/i.test(cleaned)) {
    return t.errPermission
  }
  if (/playlist|members.*only/i.test(cleaned) && /no entries/i.test(cleaned)) {
    return t.errPlaylistEmpty
  }
  if (/requires login|login or .*cookies|cookies are required|not returning public media|account is private/i.test(cleaned)) {
    return t.errRequiresLogin
  }
  if (/not available in public-only mode/i.test(cleaned)) {
    return t.errPublicOnly
  }
  if (/did not expose the requested quality|safer fallback/i.test(cleaned)) {
    return t.errQualityFallback
  }
  if (/javascript runtime|node\.?js/i.test(cleaned)) {
    return t.errNoJsRuntime
  }
  if (/ssl|certificate|cert.*verif/i.test(cleaned)) {
    return t.errSsl
  }
  if (/HTTP Error 5\d\d|server error|service unavailable|bad gateway/i.test(cleaned)) {
    return t.errServer5xx
  }
  if (/unsupported url|no suitable extractor|is not a valid url/i.test(cleaned)) {
    return t.errUnsupportedUrl
  }

  // Không hiển thị mã lỗi/raw thô — đưa ra thông báo chẩn đoán gọn, dễ hiểu.
  return t.errGeneric
}

function summarizeImport(
  sourceLabel: string,
  addedCount: number,
  duplicateCount: number,
  invalidCount: number,
  t: Messages,
): NoticeState {
  const parts = [t.importNewLinks(sourceLabel, addedCount)]

  if (duplicateCount > 0) {
    parts.push(t.importDuplicates(duplicateCount))
  }

  if (invalidCount > 0) {
    parts.push(t.importSkipped(invalidCount))
  }

  return {
    tone: addedCount > 0 ? 'success' : 'info',
    message: parts.join(' · '),
  }
}

function parseQualityRank(label: string): number {
  const match = label.match(/(\d+)/)
  if (match) {
    return Number(match[1])
  }

  if (label.toLowerCase() === 'auto') {
    return -1
  }

  return 0
}

function sortQualityOptions(options: VideoQualityOption[]): VideoQualityOption[] {
  return [...options].sort((left, right) => {
    const leftScore = scoreQualityOption(left)
    const rightScore = scoreQualityOption(right)
    if (leftScore !== rightScore) {
      return rightScore - leftScore
    }

    const heightDiff = (right.height ?? parseQualityRank(right.label)) - (left.height ?? parseQualityRank(left.label))
    if (heightDiff !== 0) {
      return heightDiff
    }

    if (left.label === 'Auto') return 1
    if (right.label === 'Auto') return -1

    return left.label.localeCompare(right.label)
  })
}

function scoreQualityOption(quality: VideoQualityOption): number {
  let score = quality.height ?? parseQualityRank(quality.label)

  if (quality.ext === 'mp4') {
    score += 80
  }

  if (quality.selector && !quality.selector.includes('+')) {
    score += 40
  }

  if (quality.id === AUTO_QUALITY.id || quality.label.toLowerCase() === 'auto') {
    score -= 20
  }

  return score
}

function ensureQualityOptions(metadata: VideoMetadata): VideoQualityOption[] {
  const source = metadata.availableQualities.length > 0 ? metadata.availableQualities : [AUTO_QUALITY]
  return sortQualityOptions(source)
}

function pickSelectedVariantId(
  qualities: VideoQualityOption[],
  preferredId?: string,
  preferredLabel?: string,
): string {
  if (preferredId && qualities.some((quality) => quality.id === preferredId)) {
    return preferredId
  }

  if (preferredLabel) {
    const matchingLabel = qualities.find((quality) => quality.label === preferredLabel)
    if (matchingLabel) {
      return matchingLabel.id
    }
  }

  return getRecommendedQuality(qualities).id
}

function getRecommendedQuality(qualities: VideoQualityOption[]): VideoQualityOption {
  const sorted = sortQualityOptions(qualities)
  // Default to the best option at or below 1080p — it's H.264 (no re-encode) and
  // far faster than 4K. The user can still pick a higher chip (1440p/2160p) by hand.
  return sorted.find((quality) => quality.height != null && quality.height <= 1080) ?? sorted[0] ?? AUTO_QUALITY
}

function createStagedVideo(metadata: VideoMetadata): StagedVideo {
  const availableQualities = ensureQualityOptions(metadata)

  return {
    ...metadata,
    availableQualities,
    id: crypto.randomUUID(),
    preset: 'smart1080',
    selectedVariantId: pickSelectedVariantId(availableQualities),
    fileNameOverride: '',
    trimStart: '',
    trimEnd: '',
  }
}

function getSelectedQuality(video: StagedVideo): VideoQualityOption {
  return (
    video.availableQualities.find((quality) => quality.id === video.selectedVariantId)
    ?? video.availableQualities[0]
    ?? AUTO_QUALITY
  )
}

function collectBatchQualityLabels(videos: StagedVideo[]): string[] {
  const labels = new Set<string>()
  for (const video of videos) {
    for (const quality of video.availableQualities) {
      labels.add(quality.label)
    }
  }

  return [...labels].sort((left, right) => parseQualityRank(right) - parseQualityRank(left))
}

function formatStatusLabel(status: DownloadStatus, t: Messages, stage?: string): string {
  if (status === 'pending') return t.statusPending
  if (status === 'active') {
    if (stage === 'dang-ket-noi') return t.statusConnecting
    if (stage === 'dang-chuyen-ma') return t.statusRecode
    if (stage === 'dang-xu-ly-audio') return t.statusAudioProcessing
    if (stage === 'sao-chep') return t.statusCopying
    return t.statusActive
  }
  if (status === 'completed') return t.statusCompleted
  if (status === 'failed') return t.statusFailed
  return t.statusCancelled
}

function smartProfileMatchesSettings(profile: (typeof SMART_PROFILES)[number], settings: AppSettings | null): boolean {
  if (!settings) {
    return false
  }

  return settings.maxConcurrent === profile.patch.maxConcurrent
    && settings.maxRetries === profile.patch.maxRetries
    && settings.defaultFormat === profile.patch.defaultFormat
}

function isAudioOnlyPreset(preset: DownloadPreset): boolean {
  return preset === 'audioMp3' || preset === 'audioM4a'
}

function normalizeQualityTag(tag: string): string {
  const normalized = tag.trim()
  if (!normalized) {
    return 'Auto'
  }

  return normalized
}

function appendTagIfMissing(base: string, tag: string): string {
  const normalizedBase = base.trim().replace(/\s+/g, ' ')
  if (!normalizedBase) {
    return `[${tag}]`
  }

  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tagPattern = new RegExp(`\\[\\s*${escapedTag}\\s*\\]`, 'i')
  if (tagPattern.test(normalizedBase)) {
    return normalizedBase
  }

  return `${normalizedBase} [${tag}]`
}

function buildDownloadFileName(video: StagedVideo, selectedQuality: VideoQualityOption, t: Messages): string {
  const customTitle = video.fileNameOverride.trim()
  const baseTitle = customTitle || video.title?.trim() || platformLabel(video.platform, t)
  const qualityTag = isAudioOnlyPreset(video.preset)
    ? 'MP3'
    : normalizeQualityTag(selectedQuality.label)

  let name = appendTagIfMissing(baseTitle, qualityTag)
  const trimTag = formatTrimTag(video.trimStart, video.trimEnd)
  if (trimTag) {
    name = `${name} [${trimTag}]`
  }
  return name
}

// Filesystem-safe trim marker for the output filename, e.g. "cut 0-05~1-30.500".
// Colons (invalid on Windows) become dashes; the range keeps millisecond detail.
function formatTrimTag(trimStart?: string | null, trimEnd?: string | null): string | null {
  const start = trimStart?.trim()
  const end = trimEnd?.trim()
  if (!start && !end) {
    return null
  }

  const safe = (value: string): string => value.replace(/:/g, '-').replace(/[^\d.-]/g, '')
  return `cut ${start ? safe(start) : '0'}~${end ? safe(end) : 'end'}`
}

function buildDownloadVariantKey(input: {
  url: string
  preset: DownloadPreset
  quality?: string
  format?: OutputFormat
  variantSelector?: string | null
  trimStart?: string | null
  trimEnd?: string | null
}): string {
  const videoKey = canonicalizeVideoKey(input.url)
  const isYouTube = videoKey.startsWith('youtube:')
  const trim = (input.trimStart?.trim() || input.trimEnd?.trim())
    ? `${input.trimStart?.trim() ?? ''}-${input.trimEnd?.trim() ?? ''}`
    : ''

  return [
    videoKey,
    input.preset,
    isYouTube ? (input.quality ?? '') : '',
    input.format ?? '',
    isYouTube ? (input.variantSelector ?? '') : '',
    trim,
  ].join('|')
}

function formatDateTime(timestamp: number | null, t: Messages): string {
  if (!timestamp) {
    return t.never
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function isTerminalStatus(status: DownloadStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

// True when an error means the content requires sign-in / cookies to download.
function needsLogin(rawError: string): boolean {
  return /requires login|login or .*cookies|cookies are required|not returning public media|account is private|sign in|members[- ]only|join this channel|age[- ]restricted|confirm your age|private video|not available in public-only mode|empty media response/i.test(
    rawError,
  )
}

function computeReorderTarget(
  queue: DownloadTask[],
  taskId: string,
  direction: 'up' | 'down',
): string | null {
  const reorderable = queue.filter((item) => !isTerminalStatus(item.status))
  const index = reorderable.findIndex((item) => item.id === taskId)
  if (index < 0) {
    return null
  }

  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= reorderable.length) {
    return null
  }

  return reorderable[targetIndex]?.id ?? null
}

interface QueueRowProps {
  id: string
  status: DownloadStatus
  stage: string
  percent: number
  speed: string
  eta: string
  error?: string
  outputFile?: string
  reused?: boolean
  title: string
  thumbnail?: string | null
  platform: DownloadTask['platform']
  isDragging: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  showLoginHint: boolean
  t: Messages
  onDragStart: (event: DragEvent<HTMLElement>, id: string, status: DownloadStatus) => void
  onDragEnd: () => void
  onDragOver: (event: DragEvent<HTMLElement>, id: string) => void
  onDrop: (id: string) => void
  onMoveUp: (id: string) => void
  onMoveDown: (id: string) => void
  onCancel: (id: string) => void
  onRetry: (id: string) => void
  onOpenFolder: (id: string) => void
  onLoginHint: () => void
}

// Empty SVG used to swap out a thumbnail whose URL failed to load (expired/blocked
// YouTube/TikTok thumbnails are common) so the row shows the clean placeholder
// gradient instead of the browser's broken-image icon.
const THUMB_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"

function handleThumbError(event: SyntheticEvent<HTMLImageElement>): void {
  const img = event.currentTarget
  if (img.dataset.fallback) {
    return
  }
  img.dataset.fallback = '1'
  img.classList.add('placeholder')
  img.src = THUMB_FALLBACK
}

// --- Trim time helpers (millisecond-precise) ---

// Parse "H:MM:SS.mmm" / "MM:SS.mmm" / "SS.mmm" / plain seconds into seconds.
// Returns null for empty/invalid input.
function parseTimeToSeconds(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const parts = trimmed.split(':').map((part) => part.trim())
  if (parts.length > 3 || parts.some((part) => part === '' || Number.isNaN(Number(part)))) {
    return null
  }

  const seconds = parts.reduce((acc, part) => acc * 60 + Number(part), 0)
  return seconds >= 0 ? seconds : null
}

// Format seconds as "M:SS" (or "H:MM:SS"), appending ".mmm" only when there are
// sub-second milliseconds, so whole-second cuts stay clean.
function formatSecondsToTime(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0
  const ms = Math.round((safe % 1) * 1000)
  const whole = Math.floor(safe) + (ms === 1000 ? 1 : 0)
  const millis = ms === 1000 ? 0 : ms
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = whole % 60
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0')
  const base = hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
  return millis > 0 ? `${base}.${pad(millis, 3)}` : base
}

// Dual-handle range slider over a video's duration. Dragging a handle reports the
// new start/end (in seconds); the parent stores them as time strings. Falls back
// to nothing when the duration is unknown (caller shows plain inputs instead).
function TrimSlider(props: {
  duration: number
  startSec: number
  endSec: number
  onChange: (startSec: number, endSec: number) => void
}) {
  const { duration, startSec, endSec, onChange } = props
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef<'start' | 'end' | null>(null)
  const startPct = duration > 0 ? Math.min(100, (startSec / duration) * 100) : 0
  const endPct = duration > 0 ? Math.min(100, (endSec / duration) * 100) : 100

  const timeFromClientX = useCallback(
    (clientX: number): number => {
      const track = trackRef.current
      if (!track) {
        return 0
      }
      const rect = track.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      return ratio * duration
    },
    [duration],
  )

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!draggingRef.current) {
        return
      }
      const time = timeFromClientX(event.clientX)
      if (draggingRef.current === 'start') {
        onChange(Math.min(time, endSec), endSec)
      } else {
        onChange(startSec, Math.max(time, startSec))
      }
    }
    const onUp = () => {
      draggingRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [startSec, endSec, timeFromClientX, onChange])

  return (
    <div className="trim-slider" ref={trackRef}>
      <div className="trim-slider-fill" style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }} />
      <div
        className="trim-slider-handle"
        style={{ left: `${startPct}%` }}
        onPointerDown={() => {
          draggingRef.current = 'start'
        }}
        role="slider"
        aria-label="start"
        tabIndex={0}
      />
      <div
        className="trim-slider-handle"
        style={{ left: `${endPct}%` }}
        onPointerDown={() => {
          draggingRef.current = 'end'
        }}
        role="slider"
        aria-label="end"
        tabIndex={0}
      />
    </div>
  )
}

// Memoized so progress ticks (every 250ms) only re-render the rows whose data
// actually changed, not the whole queue. Props are primitives + stable callbacks.
const QueueRow = memo(function QueueRow(props: QueueRowProps) {
  const { id, status, stage, percent, speed, eta, error, outputFile, reused, title, thumbnail, platform, isDragging, canMoveUp, canMoveDown, showLoginHint, t } = props
  const terminal = isTerminalStatus(status)
  const showIndeterminateProgress = status === 'active'
    && (stage === 'dang-ket-noi'
      || (percent <= 0 && (stage === 'dang-tai' || stage === 'dang-chuyen-ma')))

  return (
    <article
      className={`download-row queue-row status-${status} ${isDragging ? 'dragging' : ''}`}
      draggable={!terminal}
      onDragStart={(event) => props.onDragStart(event, id, status)}
      onDragEnd={props.onDragEnd}
      onDragOver={(event) => props.onDragOver(event, id)}
      onDrop={(event) => {
        event.preventDefault()
        props.onDrop(id)
      }}
    >
      {!terminal && <span className="queue-drag-handle" aria-hidden="true">⠿</span>}
      <div className="row-thumb-wrap">
        {thumbnail ? (
          <img className="row-thumb" src={thumbnail} alt="" referrerPolicy="no-referrer" loading="lazy" onError={handleThumbError} />
        ) : (
          <div className="row-thumb placeholder" />
        )}
        <span className={`platform-badge ${platformColorClass(platform)}`}>{platformIcon(platform)}</span>
      </div>
      <div className="row-content">
        <div className="row-title">{title}</div>
        <div className="row-subline">
          <span className={`platform-tag ${platformColorClass(platform)}`}>{platformLabel(platform, t)}</span>
          <span>{formatStatusLabel(status, t, stage)}</span>
          {reused && <span className="reused-tag" title={t.reusedHint}>♻ {t.reusedBadge}</span>}
          {status === 'active' && !showIndeterminateProgress && (
            <span className="speed-tag">{Math.round(Math.max(0, Math.min(100, percent)))}%</span>
          )}
          {status === 'active' && speed !== '-' && <span className="speed-tag">{speed}</span>}
          {status === 'active' && eta !== '--:--' && <span>ETA {eta}</span>}
          {error && <span className="row-error">{formatQueueError(error, t)}</span>}
          {error && showLoginHint && (
            <button className="login-hint-button" type="button" onClick={props.onLoginHint}>
              {t.loginToDownload}
            </button>
          )}
        </div>
        {!terminal && (
          <div
            className={`desktop-progress ${status === 'active' ? 'progress-animated' : ''} ${showIndeterminateProgress ? 'progress-indeterminate' : ''}`}
            aria-hidden="true"
          >
            <div style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
          </div>
        )}
      </div>
      <div className="row-actions compact-actions">
        {!terminal && (
          <>
            <button className="round-action" type="button" onClick={() => props.onMoveUp(id)} disabled={!canMoveUp} title={t.moveUp}>↑</button>
            <button className="round-action" type="button" onClick={() => props.onMoveDown(id)} disabled={!canMoveDown} title={t.moveDown}>↓</button>
          </>
        )}
        {(status === 'active' || status === 'pending') && (
          <button className="round-action danger-action" type="button" onClick={() => props.onCancel(id)} title={t.cancel}>×</button>
        )}
        {status === 'failed' && (
          <button className="row-open-button retry-button" type="button" onClick={() => props.onRetry(id)} title={t.retryDownloadTitle}>
            {t.retryDownload}
          </button>
        )}
        {(status === 'completed' || Boolean(outputFile)) && (
          <button className="row-open-button" type="button" onClick={() => props.onOpenFolder(id)}>📂 {t.open}</button>
        )}
      </div>
    </article>
  )
})

function App() {
  const [urlInput, setUrlInput] = useState('')
  const [showManualInput, setShowManualInput] = useState(false)
  const [stagedVideos, setStagedVideos] = useState<StagedVideo[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [renamingIds, setRenamingIds] = useState<Set<string>>(new Set())
  const [trimmingIds, setTrimmingIds] = useState<Set<string>>(new Set())
  const [reloadingIds, setReloadingIds] = useState<Set<string>>(new Set())
  const [queue, setQueue] = useState<DownloadTask[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [probe, setProbe] = useState<YtDlpProbe | null>(null)
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [isAddingUrls, setIsAddingUrls] = useState(false)
  const [isUpdatingYtDlp, setIsUpdatingYtDlp] = useState(false)
  const [queueControl, setQueueControl] = useState<QueueControlState>({ paused: false })
  const [draggedQueueTaskId, setDraggedQueueTaskId] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<DiagnosticsReport | null>(null)
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false)
  const [authLoggedIn, setAuthLoggedIn] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [bugName, setBugName] = useState('')
  const [bugEmail, setBugEmail] = useState('')
  const [bugMsg, setBugMsg] = useState('')
  const [isSendingBug, setIsSendingBug] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine)
  const [serverPing, setServerPing] = useState<NetworkStatus | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme')
    if (saved === 'dark' || saved === 'light') return saved
    
    // Auto-detect system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
    return 'light'
  })
  const [toasts, setToasts] = useState<Array<{
    id: string
    type: 'success' | 'error' | 'warning' | 'info'
    title: string
    message: string
  }>>([])
  const urlTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const startDownloadShortcutRef = useRef<() => void>(() => undefined)
  const handlePasteAddShortcutRef = useRef<() => void>(() => undefined)
  const toggleSettingsShortcutRef = useRef<() => void>(() => undefined)

  const hasBridge = Boolean(window.electronAPI)
  const t = getMessages(settings?.language)
  // Suggest logging in for explicit auth errors, and for the generic failure
  // (whose message itself lists "requires sign-in" as a likely cause). But never
  // when already logged in — re-prompting to log in is confusing and the real
  // error should show instead.
  const suggestLogin = (rawError: string): boolean =>
    !authLoggedIn && (needsLogin(rawError) || formatQueueError(rawError, t) === t.errGeneric)

  // Refs holding the latest values so QueueRow callbacks can stay referentially
  // stable (empty-deps useCallback) without going stale.
  const queueRef = useRef<DownloadTask[]>([])
  const draggedRef = useRef<string | null>(null)
  const messagesRef = useRef(t)
  const loginHintRef = useRef<() => void>(() => undefined)
  queueRef.current = queue
  draggedRef.current = draggedQueueTaskId
  messagesRef.current = t
  loginHintRef.current = () => void openLoginSettings()

  const onRowDragStart = useCallback((event: DragEvent<HTMLElement>, id: string, status: DownloadStatus) => {
    if (isTerminalStatus(status)) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
    setDraggedQueueTaskId(id)
  }, [])

  const onRowDragEnd = useCallback(() => setDraggedQueueTaskId(null), [])

  const onRowDragOver = useCallback((event: DragEvent<HTMLElement>, id: string) => {
    const src = draggedRef.current
    if (!src || src === id) return
    event.preventDefault()
  }, [])

  const onRowDrop = useCallback((id: string) => {
    const src = draggedRef.current
    setDraggedQueueTaskId(null)
    if (!src || src === id) return
    void window.electronAPI?.reorderDownloads(src, id).then((ok) => {
      if (!ok) setNotice({ tone: 'error', message: messagesRef.current.cannotReorder })
    })
  }, [])

  const onRowReorder = useCallback((id: string, direction: 'up' | 'down') => {
    const target = computeReorderTarget(queueRef.current, id, direction)
    if (!target) return
    void window.electronAPI?.reorderDownloads(id, target).then((ok) => {
      if (!ok) setNotice({ tone: 'error', message: messagesRef.current.cannotMove })
    })
  }, [])

  const onRowMoveUp = useCallback((id: string) => onRowReorder(id, 'up'), [onRowReorder])
  const onRowMoveDown = useCallback((id: string) => onRowReorder(id, 'down'), [onRowReorder])

  const onRowCancel = useCallback((id: string) => {
    void window.electronAPI?.cancelDownload(id)
  }, [])

  const onRowRetry = useCallback((id: string) => {
    void window.electronAPI?.retryDownload(id).then((ok) => {
      if (!ok) setNotice({ tone: 'error', message: messagesRef.current.cannotRetryDownload })
    })
  }, [])

  const onRowOpenFolder = useCallback((id: string) => {
    void window.electronAPI?.openDownloadFolder(id).then((ok) => {
      if (!ok) setNotice({ tone: 'error', message: messagesRef.current.cannotOpenFolder })
    })
  }, [])

  const onRowLoginHint = useCallback(() => loginHintRef.current(), [])
  const isSettingsVisible = Boolean(settings?.showSettingsPanel)
  const batchTargets = selectedIds.size > 0
    ? stagedVideos.filter((video) => selectedIds.has(video.id))
    : stagedVideos
  const batchQualityLabels = collectBatchQualityLabels(batchTargets)
  const batchTargetCount = batchTargets.length
  const activeQueueItems = queue.filter((task) => task.status === 'active')
  const activeQueueCount = activeQueueItems.length
  const pendingQueueCount = queue.filter((task) => task.status === 'pending').length
  const completedQueueCount = queue.filter((task) => task.status === 'completed').length
  const activeQueueProgress = activeQueueCount > 0
    ? Math.round(activeQueueItems.reduce((sum, task) => sum + task.progress.percent, 0) / activeQueueCount)
    : 0
  const queueSummaryParts: string[] = []
  if (stagedVideos.length > 0) queueSummaryParts.push(t.countWaiting(stagedVideos.length))
  if (activeQueueCount > 0) queueSummaryParts.push(t.countDownloading(activeQueueCount))
  if (pendingQueueCount > 0) queueSummaryParts.push(t.countQueued(pendingQueueCount))
  if (completedQueueCount > 0) queueSummaryParts.push(t.countCompleted(completedQueueCount))
  const queueSummaryText = queueSummaryParts.length > 0 ? queueSummaryParts.join(' · ') : t.noItems
  const allStagedSelected = stagedVideos.length > 0 && stagedVideos.every((v) => selectedIds.has(v.id))
  const someStagedSelected = selectedIds.size > 0 && !allStagedSelected
  const isEmptyState = stagedVideos.length === 0 && queue.length === 0 && !isAddingUrls

  // Auto-clear notice after a delay
  useEffect(() => {
    if (!notice) return
    const timeout = setTimeout(() => setNotice(null), notice.tone === 'error' ? 8000 : 4000)
    return () => clearTimeout(timeout)
  }, [notice])

  // Toast notification helper
  const showToast = useCallback((type: 'success' | 'error' | 'warning' | 'info', title: string, message: string) => {
    const id = crypto.randomUUID()
    setToasts((current) => [...current, { id, type, title, message }])
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id))
    }, 5000)
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (e: MediaQueryListEvent) => {
      const saved = localStorage.getItem('theme')
      if (!saved) {
        setTheme(e.matches ? 'dark' : 'light')
      }
    }
    
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'light' ? 'dark' : 'light'))
  }, [])

  // Real-time online/offline status from the OS.
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  // Poll server latency while the Settings panel is open (and stop when closed).
  useEffect(() => {
    if (!hasBridge || !isSettingsVisible) return

    let cancelled = false
    const ping = async () => {
      const result = await window.electronAPI.pingNetwork()
      if (!cancelled) setServerPing(result)
    }
    void ping()
    const timer = setInterval(() => void ping(), 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [hasBridge, isSettingsVisible])

  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)

  const toggleKeyboardShortcuts = useCallback(() => {
    setShowKeyboardShortcuts((current) => !current)
  }, [])

  useEffect(() => {
    if (!hasBridge) return

    window.electronAPI.getSettings().then(setSettings)
    window.electronAPI.listDownloads().then(setQueue)
    window.electronAPI.getDownloadControlState().then(setQueueControl)
    window.electronAPI.probeYtDlp().then(setProbe)
    window.electronAPI.getAuthStatus().then(setAuthLoggedIn)
    const offUpdate = window.electronAPI.onUpdateStatus(setUpdateStatus)

    const offQueue = window.electronAPI.onDownloadsChanged(setQueue)
    const offSettings = window.electronAPI.onSettingsChanged(setSettings)
    const offQueueControl = window.electronAPI.onDownloadControlStateChanged(setQueueControl)

    window.electronAPI.windowIsMaximized().then(setIsMaximized)
    const offMax = window.electronAPI.onWindowMaximizedChanged(setIsMaximized)

    return () => {
      offQueue()
      offSettings()
      offQueueControl()
      offMax()
      offUpdate()
    }
  }, [hasBridge])

  // Hiển thị thông báo hệ thống (tải xong/lỗi...) dưới dạng toast trong app
  useEffect(() => {
    if (!hasBridge) return

    const seen = new Set<string>()
    let seeded = false

    const titleForLevel = (level: SystemNotification['level']): string => {
      if (level === 'success') return t.levelSuccess
      if (level === 'error') return t.levelError
      if (level === 'warning') return t.levelWarning
      return t.levelInfo
    }

    const handle = (items: SystemNotification[]): void => {
      if (!seeded) {
        items.forEach((item) => seen.add(item.id))
        seeded = true
        return
      }

      // Mảng mới nhất ở đầu; hiển thị mục chưa thấy theo thứ tự thời gian
      items
        .filter((item) => !seen.has(item.id))
        .reverse()
        .forEach((item) => {
          seen.add(item.id)
          showToast(item.level, titleForLevel(item.level), item.message)
        })
    }

    void window.electronAPI.listNotifications().then(handle)
    return window.electronAPI.onNotificationsChanged(handle)
  }, [hasBridge, showToast, t])

  // Ô nhập link tự giãn cao theo số dòng (tới giới hạn CSS rồi cuộn)
  useEffect(() => {
    const el = urlTextareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [showManualInput, urlInput])

  useEffect(() => {
    setBugName(settings?.userName ?? '')
    setBugEmail(settings?.userEmail ?? '')
  }, [settings?.userName, settings?.userEmail])

  // Forward renderer crashes to the error reporter.
  useEffect(() => {
    if (!hasBridge) return

    const onError = (event: ErrorEvent) => {
      // .catch prevents a reject -> unhandledrejection -> report loop.
      window.electronAPI.reportError('window-error', `${event.message} @ ${event.filename}:${event.lineno}`).catch(() => {})
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason)
      window.electronAPI.reportError('unhandled-rejection', reason).catch(() => {})
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [hasBridge])

  const updateSettings = useCallback(async (patch: Partial<AppSettings>): Promise<void> => {
    if (!hasBridge) return

    const updated = await window.electronAPI.updateSettings(patch)
    setSettings(updated)
  }, [hasBridge])

  const toggleSettingsPanel = useCallback(async (): Promise<void> => {
    if (!settings) {
      return
    }

    await updateSettings({ showSettingsPanel: !settings.showSettingsPanel })
  }, [settings, updateSettings])

  const closeSettingsPanel = useCallback(async (): Promise<void> => {
    if (!settings?.showSettingsPanel) {
      return
    }

    await updateSettings({ showSettingsPanel: false })
  }, [settings?.showSettingsPanel, updateSettings])

  async function applySmartProfile(profileId: SmartProfileId): Promise<void> {
    if (!settings) {
      return
    }

    const profile = SMART_PROFILES.find((item) => item.id === profileId)
    if (!profile) {
      return
    }

    await updateSettings(profile.patch)
    setNotice({
      tone: 'success',
      message: t.appliedProfile(t[profile.labelKey]),
    })
  }

  function toggleVideoMp3(id: string): void {
    setStagedVideos((currentVideos) =>
      currentVideos.map((video) => {
        if (video.id !== id) {
          return video
        }

        const nextPreset: DownloadPreset = video.preset === 'audioMp3' ? 'smart1080' : 'audioMp3'
        return {
          ...video,
          preset: nextPreset,
        }
      }),
    )
  }

  function getBatchTargetIds(): Set<string> {
    return selectedIds.size > 0
      ? new Set(selectedIds)
      : new Set(stagedVideos.map((video) => video.id))
  }

  function applyBatchQuality(value: string): void {
    const targetIds = getBatchTargetIds()
    if (targetIds.size === 0) return

    setStagedVideos((currentVideos) =>
      currentVideos.map((video) => {
        if (!targetIds.has(video.id)) {
          return video
        }

        const nextQuality = value === RECOMMENDED_BATCH_QUALITY
          ? getRecommendedQuality(video.availableQualities)
          : video.availableQualities.find((quality) => quality.label === value) ?? getRecommendedQuality(video.availableQualities)

        return {
          ...video,
          preset: 'smart1080',
          selectedVariantId: nextQuality.id,
        }
      }),
    )

    setNotice({
      tone: 'success',
      message: value === RECOMMENDED_BATCH_QUALITY
        ? t.appliedRecommendedQuality(targetIds.size)
        : t.appliedQuality(value, targetIds.size),
    })
  }

  function applyBatchMp3(enabled: boolean): void {
    const targetIds = getBatchTargetIds()
    if (targetIds.size === 0) return

    setStagedVideos((currentVideos) =>
      currentVideos.map((video) => {
        if (!targetIds.has(video.id)) {
          return video
        }

        const nextQuality = getRecommendedQuality(video.availableQualities)
        return {
          ...video,
          preset: enabled ? 'audioMp3' : 'smart1080',
          selectedVariantId: enabled ? video.selectedVariantId : nextQuality.id,
        }
      }),
    )

    setNotice({
      tone: 'success',
      message: enabled
        ? t.enabledMp3(targetIds.size)
        : t.switchedToVideo(targetIds.size),
    })
  }

  useEffect(() => {
    if (!isSettingsVisible) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void closeSettingsPanel()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isSettingsVisible, closeSettingsPanel])

  useEffect(() => {
    if (!showKeyboardShortcuts) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowKeyboardShortcuts(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showKeyboardShortcuts])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement | null

      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        toggleSettingsShortcutRef.current()
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'Enter') {
        event.preventDefault()
        startDownloadShortcutRef.current()
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && activeElement === urlTextareaRef.current) {
        event.preventDefault()
        handlePasteAddShortcutRef.current()
        return
      }

      if (event.key === '?' && activeElement?.tagName !== 'INPUT' && activeElement?.tagName !== 'TEXTAREA') {
        event.preventDefault()
        toggleKeyboardShortcuts()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleKeyboardShortcuts])

  async function addUrls(rawUrls: string[], invalidCount: number, sourceLabel: string): Promise<void> {
    if (!hasBridge) return

    const mergeResult = mergeImportedUrls(
      stagedVideos.map((video) => video.url),
      rawUrls,
    )
    const totalInvalid = invalidCount + mergeResult.invalidCount

    if (mergeResult.addedUrls.length === 0) {
      setNotice(summarizeImport(sourceLabel, 0, mergeResult.duplicateCount, totalInvalid, t))
      return
    }

    setIsAddingUrls(true)
    setNotice({
      tone: 'info',
      message: t.readingMetadata(sourceLabel, mergeResult.addedUrls.length),
    })

    // Show each video the moment its probe finishes, instead of waiting for the
    // whole batch. Results stream back over an event; a key check keeps it
    // idempotent (no duplicates even across overlapping pastes).
    const offResult = window.electronAPI.onProbeResult((metadata) => {
      const staged = createStagedVideo(metadata)
      const key = canonicalizeVideoKey(staged.url)
      setStagedVideos((currentVideos) =>
        currentVideos.some((video) => canonicalizeVideoKey(video.url) === key)
          ? currentVideos
          : [staged, ...currentVideos],
      )
    })

    try {
      await window.electronAPI.probeVideoStream(mergeResult.addedUrls)
      setNotice(
        summarizeImport(
          sourceLabel,
          mergeResult.addedUrls.length,
          mergeResult.duplicateCount,
          totalInvalid,
          t,
        ),
      )
    } catch (error) {
      setNotice({
        tone: 'error',
        message: t.metadataFailed(formatQueueError(error instanceof Error ? error.message : String(error), t)),
      })
    } finally {
      offResult()
      setIsAddingUrls(false)
    }
  }

  async function handlePasteAdd(): Promise<void> {
    const parsed = parseTextInput(urlInput)
    if (parsed.urls.length === 0) {
      setNotice({
        tone: 'error',
        message: t.pasteAtLeastOne,
      })
      return
    }

    await addUrls(parsed.urls, parsed.invalidCount, t.sourcePaste)
    setUrlInput('')
  }

  async function handleClipboardPaste(): Promise<void> {
    if (!hasBridge) return

    let clipboardText = ''
    try {
      clipboardText = await window.electronAPI.readClipboard()
    } catch {
      setNotice({ tone: 'error', message: t.clipboardReadFailed })
      return
    }

    const parsed = parseTextInput(clipboardText)
    if (parsed.urls.length === 0) {
      setNotice({ tone: 'error', message: t.clipboardNoLinks })
      return
    }

    await addUrls(parsed.urls, parsed.invalidCount, t.sourceClipboard)
  }

  function updateVideo(id: string, updates: Partial<StagedVideo>): void {
    setStagedVideos((currentVideos) =>
      currentVideos.map((video) => (video.id === id ? { ...video, ...updates } : video)),
    )
  }

  function updateVideoQuality(id: string, optionId: string): void {
    updateVideo(id, { selectedVariantId: optionId })
  }

  // Re-probe a single staged link (for ones that errored or only got limited
  // quality), replacing its metadata in place while keeping its row + custom name.
  async function reloadVideo(id: string): Promise<void> {
    if (!hasBridge || reloadingIds.has(id)) return
    const target = stagedVideos.find((video) => video.id === id)
    if (!target) return

    setReloadingIds((current) => new Set(current).add(id))
    try {
      const metadata = await window.electronAPI.probeVideoInfo(target.url)
      setStagedVideos((currentVideos) =>
        currentVideos.map((video) => {
          if (video.id !== id) return video
          const fresh = createStagedVideo(metadata)
          return {
            ...fresh,
            id: video.id,
            fileNameOverride: video.fileNameOverride,
            trimStart: video.trimStart,
            trimEnd: video.trimEnd,
          }
        }),
      )
    } catch (error) {
      setNotice({
        tone: 'error',
        message: t.metadataFailed(formatQueueError(error instanceof Error ? error.message : String(error), t)),
      })
    } finally {
      setReloadingIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  function removeVideo(id: string): void {
    setStagedVideos((currentVideos) => currentVideos.filter((video) => video.id !== id))
    setSelectedIds((currentSelected) => {
      const nextSelected = new Set(currentSelected)
      nextSelected.delete(id)
      return nextSelected
    })
    setRenamingIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }

  function toggleRename(id: string): void {
    setRenamingIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function toggleTrim(id: string): void {
    setTrimmingIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function toggleSelection(id: string): void {
    setSelectedIds((currentSelected) => {
      const nextSelected = new Set(currentSelected)
      if (nextSelected.has(id)) {
        nextSelected.delete(id)
      } else {
        nextSelected.add(id)
      }
      return nextSelected
    })
  }

  async function startDownload(targetOverrideIds?: Set<string>): Promise<void> {
    if (!hasBridge || stagedVideos.length === 0) return

    const targetIds = targetOverrideIds ?? (selectedIds.size > 0
      ? selectedIds
      : new Set(stagedVideos.map((video) => video.id)))
    const targets = stagedVideos.filter((video) => targetIds.has(video.id))

    if (targets.length === 0) {
      return
    }

    const existingItems = new Set(
      queue
        .filter((task) => task.status === 'pending' || task.status === 'active')
        .map((task) =>
          buildDownloadVariantKey({
            url: task.request.url,
            preset: task.request.preset,
            quality: task.request.quality,
            format: task.request.format,
            variantSelector: task.request.variantSelector,
            trimStart: task.request.trimStart,
            trimEnd: task.request.trimEnd,
          }),
        ),
    )
    const seenIncoming = new Set<string>()
    let duplicateCount = 0
    const queueable = targets.filter((video) => {
      const normalized = canonicalizeVideoKey(video.url)
      if (!normalized) {
        return false
      }

      const selectedQuality = getSelectedQuality(video)
      const audioOnly = isAudioOnlyPreset(video.preset)
      const itemKey = buildDownloadVariantKey({
        url: video.url,
        preset: video.preset,
        quality: audioOnly ? undefined : selectedQuality.label,
        format: audioOnly ? undefined : settings?.defaultFormat ?? 'mp4',
        variantSelector: audioOnly ? null : selectedQuality.selector,
        trimStart: video.trimStart,
        trimEnd: video.trimEnd,
      })

      if (existingItems.has(itemKey) || seenIncoming.has(itemKey)) {
        duplicateCount += 1
        return false
      }

      seenIncoming.add(itemKey)
      return true
    })

    if (duplicateCount > 0) {
      setNotice({
        tone: queueable.length > 0 ? 'info' : 'error',
        message: t.skippedDuplicates(duplicateCount),
      })
    }

    if (queueable.length === 0) {
      return
    }

    try {
      const result = await window.electronAPI.startDownloads({
        downloads: queueable.map((video) => {
          const selectedQuality = getSelectedQuality(video)
          const audioOnly = isAudioOnlyPreset(video.preset)
          const fileName = buildDownloadFileName(video, selectedQuality, t)

          return {
            url: video.url,
            title: fileName,
            thumbnail: video.thumbnail,
            preset: video.preset,
            quality: audioOnly ? undefined : selectedQuality.label,
            format: audioOnly ? undefined : settings?.defaultFormat ?? 'mp4',
            variantId: audioOnly ? null : selectedQuality.id,
            variantSelector: audioOnly ? null : selectedQuality.selector,
            duration: video.duration,
            trimStart: video.trimStart.trim() || null,
            trimEnd: video.trimEnd.trim() || null,
          }
        }),
      })

      const acceptedUrls = new Set(result.accepted.map((task) => task.request.url))
      const queueableIds = new Set(queueable.map((video) => video.id))
      setStagedVideos((currentVideos) =>
        currentVideos.filter((video) => !acceptedUrls.has(video.url) || !queueableIds.has(video.id)),
      )
      setSelectedIds(new Set())

      if (result.accepted.length === 0) {
        showToast('error', t.cannotDownload, t.noItemsQueued)
        return
      }

      const rejectedSuffix = result.rejected.length > 0 ? t.rejectedSuffix(result.rejected.length) : ''
      showToast('success', t.addedToQueue, t.addedItems(result.accepted.length, rejectedSuffix))
    } catch (error) {
      const errorMsg = t.cannotAddToQueue(formatQueueError(error instanceof Error ? error.message : String(error), t))
      showToast('error', t.downloadError, errorMsg)
    }
  }

  async function onClearCompleted(): Promise<void> {
    if (!hasBridge) return
    await window.electronAPI.clearCompletedDownloads()
  }

  async function pickOutputDirectory(): Promise<void> {
    if (!hasBridge) return

    const updated = await window.electronAPI.pickOutputDirectory()
    if (updated) {
      setSettings(updated)
      setNotice({
        tone: 'success',
        message: t.outputDirUpdated,
      })
    }
  }

  async function onUpdateYtDlp(): Promise<void> {
    if (!hasBridge || isUpdatingYtDlp) return

    setIsUpdatingYtDlp(true)
    try {
      const result: YtDlpUpdateResult = await window.electronAPI.updateYtDlp()
      const nextProbe = await window.electronAPI.probeYtDlp()
      setProbe(nextProbe)
      setNotice({
        tone: result.ok ? 'success' : 'error',
        message: result.version ? `${result.message} (${result.version})` : result.message,
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: t.updateYtDlpFailed(formatQueueError(error instanceof Error ? error.message : String(error), t)),
      })
    } finally {
      setIsUpdatingYtDlp(false)
    }
  }

  async function toggleQueuePause(): Promise<void> {
    if (!hasBridge) {
      return
    }

    const nextState = queueControl.paused
      ? await window.electronAPI.resumeDownloads()
      : await window.electronAPI.pauseDownloads()

    setQueueControl(nextState)
    setNotice({
      tone: 'info',
      message: nextState.paused ? t.queuePaused : t.queueResumed,
    })
  }

  async function onRunDiagnostics(): Promise<void> {
    if (!hasBridge || isRunningDiagnostics) {
      return
    }

    setIsRunningDiagnostics(true)
    try {
      const report = await window.electronAPI.runDiagnostics()
      setDiagnostics(report)
      const allGood = [report.ytDlp.ok, report.ffmpeg.ok, report.node.ok, report.network.ok]
        .every(Boolean)

      setNotice({
        tone: allGood ? 'success' : 'info',
        message: allGood ? t.diagnosticsNoIssues : t.diagnosticsFoundIssues,
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: t.diagnosticsFailed(formatQueueError(error instanceof Error ? error.message : String(error), t)),
      })
    } finally {
      setIsRunningDiagnostics(false)
    }
  }

  async function onOpenLogin(): Promise<void> {
    if (!hasBridge || isLoggingIn) {
      return
    }

    setIsLoggingIn(true)
    try {
      const loggedIn = await window.electronAPI.openLogin()
      setAuthLoggedIn(loggedIn)
    } finally {
      setIsLoggingIn(false)
    }
  }

  async function onImportCookies(): Promise<void> {
    if (!hasBridge) {
      return
    }

    const loggedIn = await window.electronAPI.importCookies()
    setAuthLoggedIn(loggedIn)
  }

  async function onLogout(): Promise<void> {
    if (!hasBridge) {
      return
    }

    const loggedIn = await window.electronAPI.logout()
    setAuthLoggedIn(loggedIn)
  }

  async function openLoginSettings(): Promise<void> {
    if (!settings) {
      return
    }
    if (!settings.showSettingsPanel) {
      await updateSettings({ showSettingsPanel: true })
    }
    setTimeout(() => {
      document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 200)
  }

  async function onSendBug(): Promise<void> {
    if (!hasBridge || isSendingBug || !bugMsg.trim() || !isValidEmail(bugEmail)) {
      return
    }

    setIsSendingBug(true)
    try {
      await window.electronAPI.reportBug(bugName.trim(), bugEmail.trim(), bugMsg.trim())
      setBugMsg('')
      showToast('success', t.bugSentTitle, t.bugSentMsg)
    } finally {
      setIsSendingBug(false)
    }
  }

  function toggleSelectAll(): void {
    if (allStagedSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(stagedVideos.map((v) => v.id)))
    }
  }

  startDownloadShortcutRef.current = () => {
    void startDownload()
  }
  handlePasteAddShortcutRef.current = () => {
    void handlePasteAdd()
  }
  toggleSettingsShortcutRef.current = () => {
    void toggleSettingsPanel()
  }

  function getReorderTargetId(taskId: string, direction: 'up' | 'down'): string | null {
    return computeReorderTarget(queue, taskId, direction)
  }

  return (
    <main className="app-shell">
      <div className={`app-window ${isEmptyState ? 'is-empty' : ''}`}>
        <header className="window-titlebar">
          <div className="window-title">
            <span className="brand-stack">
              <strong className="brand-name">
                <span className="brand-goda">FLASH</span>
                <span className="brand-yt">MEDIA</span>
              </strong>
              <span className="brand-version">v{__APP_VERSION__}</span>
            </span>
            <span className="brand-divider" aria-hidden="true" />
            <span className="brand-tagline">{t.tagline}</span>
          </div>
          <div className="titlebar-right">
            <div className="titlebar-actions">
            <button
              className="toolbar-button"
              type="button"
              onClick={() => void toggleSettingsPanel()}
              disabled={!settings}
              title={t.openSettings}
              style={{ minHeight: '32px', padding: '0 12px', fontSize: '1.1rem' }}
            >
              <span className="animated-icon">⚙</span>
            </button>
            <button
              className="toolbar-button"
              type="button"
              onClick={toggleKeyboardShortcuts}
              title={t.shortcutsTitle}
              style={{ minHeight: '32px', padding: '0 12px', fontSize: '1rem', fontWeight: 700 }}
            >
              ?
            </button>
            <button
              className="toolbar-button"
              type="button"
              onClick={toggleTheme}
              title={theme === 'light' ? t.switchToDark : t.switchToLight}
              style={{ minHeight: '32px', padding: '0 12px', fontSize: '1.1rem' }}
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
            </div>
            {hasBridge && (
              <div className="window-controls" aria-label="Window controls">
                <button
                  className="win-control"
                  type="button"
                  onClick={() => void window.electronAPI.windowMinimize()}
                  title={t.minimize}
                  aria-label={t.minimize}
                >─</button>
                <button
                  className="win-control"
                  type="button"
                  onClick={() => void window.electronAPI.windowMaximizeToggle()}
                  title={isMaximized ? t.restore : t.maximize}
                  aria-label={isMaximized ? t.restore : t.maximize}
                >{isMaximized ? '❐' : '□'}</button>
                <button
                  className="win-control win-control-close"
                  type="button"
                  onClick={() => void window.electronAPI.windowClose()}
                  title={t.close}
                  aria-label={t.close}
                >✕</button>
              </div>
            )}
          </div>
        </header>

        <section className="desktop-toolbar">
          <button
            className="toolbar-button"
            type="button"
            onClick={() => void handleClipboardPaste()}
            disabled={isAddingUrls}
            title={t.pasteFromClipboardTitle}
          >
            <span className={isAddingUrls ? 'spinning-icon' : ''}>📋</span> {t.pasteFromClipboard}
          </button>
          <button
            className={`toolbar-button ${showManualInput ? 'active' : ''}`}
            type="button"
            onClick={() => setShowManualInput((open) => !open)}
            title={t.toggleManualInputTitle}
          >
            ✎ {t.manualInput}
          </button>
          {stagedVideos.length > 0 && (
            <label className="select-all-control" title={allStagedSelected ? t.deselectAll : t.selectAll}>
              <input
                type="checkbox"
                checked={allStagedSelected}
                ref={(el) => { if (el) el.indeterminate = someStagedSelected }}
                onChange={toggleSelectAll}
              />
              <span className="select-all-label">{t.all}</span>
            </label>
          )}
          {batchTargetCount > 0 && (
            <div className="batch-controls" aria-label={t.batchSettings}>
              <select
                value=""
                onChange={(event) => {
                  if (!event.target.value) return
                  applyBatchQuality(event.target.value)
                  event.currentTarget.value = ''
                }}
                title={selectedIds.size > 0 ? t.applyToSelected : t.applyToAllPending}
              >
                <option value="">{t.quality}</option>
                <option value={RECOMMENDED_BATCH_QUALITY}>{t.recommended}</option>
                {batchQualityLabels.map((label) => (
                  <option key={label} value={label}>{label}</option>
                ))}
              </select>
              <button className="batch-button" type="button" onClick={() => applyBatchMp3(true)} title={t.allToMp3}>
                🎵 {t.mp3}
              </button>
              <button className="batch-button" type="button" onClick={() => applyBatchMp3(false)} title={t.allToVideo}>
                🎬 {t.video}
              </button>
            </div>
          )}
          <div className="toolbar-right">
            <label className="format-control">
              <span>{t.format}</span>
              <select
                value={settings?.defaultFormat ?? 'mp4'}
                onChange={(event) => void updateSettings({ defaultFormat: event.target.value as OutputFormat })}
                disabled={!settings}
                title={t.defaultVideoFormat}
              >
                {FORMAT_OPTIONS.map((format) => (
                  <option key={format.value} value={format.value}>{format.label}</option>
                ))}
              </select>
            </label>
            <button
              className="toolbar-button"
              type="button"
              onClick={() => void toggleQueuePause()}
              disabled={queue.length === 0}
              title={queueControl.paused ? t.resumeTitle : t.pauseTitle}
            >
              {queueControl.paused ? '▶' : '⏸'}
            </button>
            <button
              className="toolbar-button primary-button"
              type="button"
              onClick={() => void startDownload()}
              disabled={stagedVideos.length === 0}
              title={t.startDownloadTitle}
            >
              <span className={activeQueueCount > 0 ? 'bouncing-icon' : ''}>↓</span> {t.download}
            </button>
          </div>
        </section>

        {showManualInput && (
          <section className="link-entry">
            <textarea
              ref={urlTextareaRef}
              className="desktop-url-input"
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              placeholder={t.urlPlaceholder}
              autoFocus
            />
            <div className="link-entry-actions">
              <button
                className="toolbar-button primary-button"
                type="button"
                onClick={() => void handlePasteAdd()}
                disabled={isAddingUrls || !urlInput.trim()}
                title={t.addToListTitle}
              >
                <span className={isAddingUrls ? 'spinning-icon' : ''}>＋</span> {t.addToList}
              </button>
            </div>
          </section>
        )}

        <section className="downloader-list" aria-label={t.downloadListAria}>
          {stagedVideos.length === 0 && queue.length === 0 && !isAddingUrls ? (
            <div className="desktop-empty">
              <div className="empty-hero">
                <div className="empty-logo">
                  <img src="./icon.png" alt="FLASH MEDIA" />
                </div>
                <h2 className="empty-title">{t.readyToDownload}</h2>
                <p className="empty-subtitle">{t.emptySubtitle}</p>
                <p className="shortcut-hint">{t.pressForShortcuts('?')}</p>
              </div>
            </div>
          ) : null}

          {/* Skeleton Loading */}
          {isAddingUrls && (
            <>
              {[1, 2, 3].map((i) => (
                <div key={`skeleton-${i}`} className="skeleton-row">
                  <div className="skeleton" style={{ width: '18px', height: '18px', borderRadius: '4px' }} />
                  <div className="skeleton skeleton-thumb" />
                  <div className="row-content">
                    <div className="skeleton skeleton-text long" />
                    <div className="skeleton skeleton-text short" />
                  </div>
                  <div style={{ width: '120px' }}>
                    <div className="skeleton skeleton-text" style={{ width: '100%' }} />
                  </div>
                </div>
              ))}
            </>
          )}

          {stagedVideos.map((video) => {
            const selectedQuality = getSelectedQuality(video)
            const audioOnly = isAudioOnlyPreset(video.preset)
            const recommendedQuality = getRecommendedQuality(video.availableQualities)

            return (
              <article
                key={video.id}
                className={`download-row staged-row ${selectedIds.has(video.id) ? 'selected' : ''}`}
              >
                <label className="row-check">
                  <input type="checkbox" checked={selectedIds.has(video.id)} onChange={() => toggleSelection(video.id)} />
                </label>
                <div className="row-thumb-wrap">
                  {video.thumbnail ? (
                    <img className="row-thumb" src={video.thumbnail} alt="" referrerPolicy="no-referrer" loading="lazy" onError={handleThumbError} />
                  ) : (
                    <div className="row-thumb placeholder" />
                  )}
                  <span className="duration-badge">{formatDuration(video.duration)}</span>
                  <span className={`platform-badge ${platformColorClass(video.platform)}`}>{platformIcon(video.platform)}</span>
                </div>
                <div className="row-content">
                  <div className="row-title">{video.title || platformLabel(video.platform, t)}</div>
                  {video.error && (
                    <div className="video-status-badge error-badge" title={video.error.message}>
                      ⚠ {video.error.category === 'permanent' ? t.errorLabel : t.tempErrorLabel}: {formatQueueError(video.error.message, t)}
                      {suggestLogin(video.error.message) && (
                        <button className="login-hint-button" type="button" onClick={() => void openLoginSettings()}>
                          {t.loginToDownload}
                        </button>
                      )}
                    </div>
                  )}
                  {!video.error && video.warning && (
                    <div className="video-status-badge warning-badge" title={video.warning.message}>
                      ⚠ {formatQueueError(video.warning.message, t)}
                    </div>
                  )}
                  {!video.error && !video.warning && video.probeLimited && (
                    <div className="video-status-badge info-badge">
                      {t.limitedData}
                    </div>
                  )}
                  {renamingIds.has(video.id) && (
                    <input
                      type="text"
                      className="filename-edit"
                      placeholder={t.editFileNamePlaceholder}
                      value={video.fileNameOverride}
                      onChange={(e) => updateVideo(video.id, { fileNameOverride: e.target.value })}
                      title={t.fileNameTitle}
                      autoFocus
                    />
                  )}
                  {trimmingIds.has(video.id) && (() => {
                    const dur = video.duration ?? 0
                    const startSec = parseTimeToSeconds(video.trimStart) ?? 0
                    const endSec = parseTimeToSeconds(video.trimEnd) ?? dur
                    const clipLen = dur > 0 && endSec > startSec ? formatSecondsToTime(endSec - startSec) : null
                    const hasTrim = Boolean(video.trimStart.trim() || video.trimEnd.trim())
                    const startBad = video.trimStart.trim() !== '' && parseTimeToSeconds(video.trimStart) === null
                    const endBad = video.trimEnd.trim() !== '' && parseTimeToSeconds(video.trimEnd) === null
                    const rangeBad = !startBad && !endBad && video.trimEnd.trim() !== '' && startSec >= endSec
                    return (
                      <div className="trim-editor">
                        {dur > 0 && (
                          <TrimSlider
                            duration={dur}
                            startSec={startSec}
                            endSec={endSec}
                            onChange={(s, e) =>
                              updateVideo(video.id, {
                                trimStart: s <= 0 ? '' : formatSecondsToTime(s),
                                trimEnd: e >= dur ? '' : formatSecondsToTime(e),
                              })
                            }
                          />
                        )}
                        <div className="trim-fields">
                          <span className="trim-icon" aria-hidden="true">✂</span>
                          <input
                            type="text"
                            className={`trim-input ${startBad || rangeBad ? 'trim-input-invalid' : ''}`}
                            placeholder={t.trimStartPlaceholder}
                            value={video.trimStart}
                            onChange={(e) => updateVideo(video.id, { trimStart: e.target.value })}
                            autoFocus
                          />
                          <span className="trim-sep" aria-hidden="true">→</span>
                          <input
                            type="text"
                            className={`trim-input ${endBad || rangeBad ? 'trim-input-invalid' : ''}`}
                            placeholder={t.trimEndPlaceholder}
                            value={video.trimEnd}
                            onChange={(e) => updateVideo(video.id, { trimEnd: e.target.value })}
                          />
                          {clipLen && <span className="trim-duration">{t.clipLength(clipLen)}</span>}
                          {hasTrim && (
                            <button
                              type="button"
                              className="trim-reset"
                              onClick={() => updateVideo(video.id, { trimStart: '', trimEnd: '' })}
                            >
                              {t.trimReset}
                            </button>
                          )}
                        </div>
                        <span className="trim-hint">{t.trimHint}</span>
                      </div>
                    )
                  })()}
                  {!audioOnly && (
                    <div className="quality-strip">
                      {video.availableQualities.map((quality) => (
                        <button
                          key={quality.id}
                          className={`quality-chip ${selectedQuality.id === quality.id ? 'active' : ''} ${quality.id === recommendedQuality.id ? 'smart' : ''}`}
                          type="button"
                          onClick={() => updateVideoQuality(video.id, quality.id)}
                        >
                          {quality.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="row-actions compact-actions">
                  <label className="mini-switch" title={t.toMp3Title}>
                    <input type="checkbox" checked={audioOnly} onChange={() => toggleVideoMp3(video.id)} />
                    <span />
                    <small className="mini-switch-label">{t.mp3}</small>
                  </label>
                  <button
                    className={`round-action ${(video.error || video.warning || video.probeLimited) ? 'attention' : ''}`}
                    type="button"
                    title={t.reloadMetadata}
                    disabled={reloadingIds.has(video.id)}
                    onClick={() => void reloadVideo(video.id)}
                  ><span className={reloadingIds.has(video.id) ? 'spinning-icon' : ''}>↻</span></button>
                  <button
                    className={`round-action ${renamingIds.has(video.id) || video.fileNameOverride.trim() ? 'active' : ''}`}
                    type="button"
                    title={t.renameFileTitle}
                    onClick={() => toggleRename(video.id)}
                  >✎</button>
                  <button
                    className={`round-action ${trimmingIds.has(video.id) || video.trimStart.trim() || video.trimEnd.trim() ? 'active' : ''}`}
                    type="button"
                    title={t.trimTitle}
                    onClick={() => toggleTrim(video.id)}
                  >✂</button>
                  <button className="round-action" type="button" title={t.downloadNowTitle} onClick={() => void startDownload(new Set([video.id]))}>↓</button>
                  <button className="round-action danger-action" type="button" title={t.removeFromListTitle} onClick={() => removeVideo(video.id)}>×</button>
                </div>
              </article>
            )
          })}

          {queue.length > 0 && (() => {
            const activeItems = queue.filter((t) => t.status === 'active')
            const pendingItems = queue.filter((t) => t.status === 'pending')
            const terminalItems = queue.filter((t) => isTerminalStatus(t.status))

            const renderQueueItem = (task: DownloadTask) => (
              <QueueRow
                key={task.id}
                id={task.id}
                status={task.status}
                stage={task.progress.stage}
                percent={task.progress.percent}
                speed={task.progress.speed}
                eta={task.progress.eta}
                error={task.error}
                outputFile={task.outputFile}
                reused={task.reused}
                title={queueTitle(task, t)}
                thumbnail={task.request.thumbnail}
                platform={task.platform}
                isDragging={draggedQueueTaskId === task.id}
                canMoveUp={Boolean(getReorderTargetId(task.id, 'up'))}
                canMoveDown={Boolean(getReorderTargetId(task.id, 'down'))}
                showLoginHint={Boolean(task.error) && suggestLogin(task.error ?? '')}
                t={t}
                onDragStart={onRowDragStart}
                onDragEnd={onRowDragEnd}
                onDragOver={onRowDragOver}
                onDrop={onRowDrop}
                onMoveUp={onRowMoveUp}
                onMoveDown={onRowMoveDown}
                onCancel={onRowCancel}
                onRetry={onRowRetry}
                onOpenFolder={onRowOpenFolder}
                onLoginHint={onRowLoginHint}
              />
            )

            return (
              <>
                {activeItems.length > 0 && (
                  <div className="queue-group">
                    <div className="queue-group-header">
                      <span className="queue-group-icon active-pulse">↓</span>
                      <span>{t.downloadingGroup(activeItems.length)}</span>
                    </div>
                    {activeItems.map(renderQueueItem)}
                  </div>
                )}
                {pendingItems.length > 0 && (
                  <div className="queue-group">
                    <div className="queue-group-header">
                      <span className="queue-group-icon">⏳</span>
                      <span>{t.pendingGroup(pendingItems.length)}</span>
                    </div>
                    {pendingItems.map(renderQueueItem)}
                  </div>
                )}
                {terminalItems.length > 0 && (
                  <div className="queue-group">
                    <div className="queue-group-header">
                      <span className="queue-group-icon">✓</span>
                      <span>{t.completedGroup(terminalItems.length)}</span>
                      <button
                        className="queue-group-clear"
                        type="button"
                        onClick={() => void onClearCompleted()}
                        title={t.clearCompletedTitle}
                      >
                        🗑 {t.clear}
                      </button>
                    </div>
                    {terminalItems.map(renderQueueItem)}
                  </div>
                )}
              </>
            )
          })()}
        </section>

        <footer className={`status-bar ${notice ? `notice-${notice.tone}` : ''}`}>
          <span>{notice?.message ?? queueSummaryText}</span>
          <div className="status-bar-right">
            {activeQueueCount > 0 && (
              <span className="status-progress-mini">
                <span className="status-progress-bar">
                  <span style={{ width: `${activeQueueProgress}%` }} />
                </span>
                <span>{activeQueueProgress}%</span>
              </span>
            )}
            <span>{queueControl.paused ? t.paused : activeQueueCount > 0 ? t.downloadingStatus : t.ready}</span>
          </div>
        </footer>

        {isSettingsVisible && (
          <div className="settings-overlay" role="presentation" onClick={() => void closeSettingsPanel()}>
            <section
              className="panel settings-modal"
              id="settings-panel"
              role="dialog"
              aria-modal="true"
              aria-label={t.settings}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="settings-modal-head">
                <div className="section-header-copy">
                  <h2>{t.settings}</h2>
                  <span>{t.settingsSubtitle}</span>
                </div>
                <button className="ghost-button" type="button" onClick={() => void closeSettingsPanel()}>
                  {t.close}
                </button>
              </div>

              <div className="settings-section-label">{t.secBasic}</div>

              <div className="settings-grid">
                <label className="field">
                  <span>{t.language}</span>
                  <select
                    value={settings?.language ?? 'vi'}
                    onChange={(event) =>
                      void updateSettings({ language: event.target.value as AppLanguage })
                    }
                    disabled={!settings}
                  >
                    <option value="vi">Tiếng Việt</option>
                    <option value="en">English</option>
                  </select>
                </label>

                <label className="field">
                  <span>{t.formatLabel}</span>
                  <select
                    value={settings?.defaultFormat ?? 'mp4'}
                    onChange={(event) =>
                      void updateSettings({ defaultFormat: event.target.value as OutputFormat })
                    }
                    disabled={!settings}
                  >
                    {FORMAT_OPTIONS.map((format) => (
                      <option key={format.value} value={format.value}>
                        {format.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>{t.concurrentDownloads}</span>
                  <select
                    value={settings?.maxConcurrent ?? 2}
                    onChange={(event) =>
                      void updateSettings({ maxConcurrent: Number(event.target.value) })
                    }
                    disabled={!settings}
                  >
                    {[1, 2, 3, 4, 5].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>{t.retries}</span>
                  <select
                    value={settings?.maxRetries ?? 2}
                    onChange={(event) =>
                      void updateSettings({ maxRetries: Number(event.target.value) })
                    }
                    disabled={!settings}
                  >
                    {[0, 1, 2, 3, 4, 5].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="smart-profile-grid">
                {SMART_PROFILES.map((profile) => (
                  <button
                    key={profile.id}
                    className={`smart-profile ${smartProfileMatchesSettings(profile, settings) ? 'active' : ''}`}
                    type="button"
                    onClick={() => void applySmartProfile(profile.id)}
                    disabled={!settings}
                  >
                    <strong>{t[profile.labelKey]}</strong>
                    <span>{t[profile.descKey]}</span>
                    {smartProfileMatchesSettings(profile, settings) && <small>{t.inUse}</small>}
                  </button>
                ))}
              </div>

              <div className="settings-auto-row">
                <label className="switch-line">
                  <input
                    className="switch-input"
                    type="checkbox"
                    checked={settings?.forceH264 ?? true}
                    onChange={(event) => void updateSettings({ forceH264: event.target.checked })}
                    disabled={!settings}
                  />
                  <span className="switch-track" aria-hidden="true">
                    <span className="switch-thumb" />
                  </span>
                  <span className="switch-text">{t.forceH264}</span>
                </label>
                <small>{t.forceH264Note}</small>
              </div>

              <div className="settings-auto-row">
                <label className="field field-inline">
                  <span className="switch-text">{t.recodeEncoderLabel}</span>
                  <select
                    value={settings?.recodeEncoder ?? 'auto'}
                    onChange={(event) =>
                      void updateSettings({ recodeEncoder: event.target.value as RecodeEncoder })
                    }
                    disabled={!settings}
                  >
                    <option value="auto">{t.recodeAuto}</option>
                    <option value="gpu">{t.recodeGpu}</option>
                    <option value="cpu">{t.recodeCpu}</option>
                  </select>
                </label>
                <small>{t.recodeEncoderNote}</small>
              </div>

              <div className="settings-auto-row">
                <label className="switch-line">
                  <input
                    className="switch-input"
                    type="checkbox"
                    checked={settings?.embedMetadata ?? true}
                    onChange={(event) => void updateSettings({ embedMetadata: event.target.checked })}
                    disabled={!settings}
                  />
                  <span className="switch-track" aria-hidden="true">
                    <span className="switch-thumb" />
                  </span>
                  <span className="switch-text">{t.embedMetadata}</span>
                </label>
                <small>{t.embedMetadataNote}</small>
              </div>

              <div className="settings-auto-row">
                <label className="switch-line">
                  <input
                    className="switch-input"
                    type="checkbox"
                    checked={settings?.reuseDownloadedFiles ?? true}
                    onChange={(event) => void updateSettings({ reuseDownloadedFiles: event.target.checked })}
                    disabled={!settings}
                  />
                  <span className="switch-track" aria-hidden="true">
                    <span className="switch-thumb" />
                  </span>
                  <span className="switch-text">{t.reuseDownloadedFiles}</span>
                </label>
                <small>{t.reuseDownloadedFilesNote}</small>
              </div>

              <div className="settings-section-label">{t.outputFolder}</div>

              <div className="folder-row">
                <input type="text" value={settings?.outputDir ?? ''} readOnly title={t.outputDirTitle} />
                <button className="secondary-button" type="button" onClick={() => void pickOutputDirectory()}>
                  {t.chooseFolder}
                </button>
              </div>

              <div className="settings-section-label" id="auth-section">{t.secAccount}</div>

              <div className="auth-card">
                <div className="auth-card-head">
                  <strong>{t.loginAccount}</strong>
                  <span className={`auth-badge ${authLoggedIn ? 'on' : 'off'}`}>
                    {authLoggedIn ? t.loggedIn : t.notLoggedIn}
                  </span>
                </div>

                <label className="auth-mode-row">
                  <span>{t.authMode}</span>
                  <select
                    value={settings?.authMode ?? 'public'}
                    onChange={(event) => void updateSettings({ authMode: event.target.value as AuthMode })}
                    disabled={!settings}
                  >
                    <option value="public">{t.authModePublic}</option>
                    <option value="auto">{t.authModeAuto}</option>
                    <option value="cookies">{t.authModeCookies}</option>
                  </select>
                  <small>{t.authModeNote}</small>
                </label>

                {authLoggedIn ? (
                  <div className="auth-method">
                    <div className="auth-method-text">
                      <span>{t.loggedInNote}</span>
                    </div>
                    <button className="secondary-button" type="button" onClick={() => void onLogout()}>
                      {t.logout}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="auth-method">
                      <div className="auth-method-text">
                        <strong>{t.methodBrowserTitle}</strong>
                        <span>{t.methodBrowserDesc}</span>
                      </div>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => void onOpenLogin()}
                        disabled={isLoggingIn}
                      >
                        {isLoggingIn ? t.loggingIn : t.login}
                      </button>
                    </div>

                    <div className="auth-method">
                      <div className="auth-method-text">
                        <strong>{t.methodFileTitle}</strong>
                        <span>{t.methodFileDesc}</span>
                        <button
                          className="link-button"
                          type="button"
                          onClick={() =>
                            window.open(
                              'https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc',
                              '_blank',
                            )
                          }
                        >
                          {t.getExtension} ↗
                        </button>
                      </div>
                      <button className="secondary-button" type="button" onClick={() => void onImportCookies()}>
                        {t.importCookies}
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="settings-section-label">{t.secTools}</div>

              <div className="settings-health-row">
                <div className="tool-pill settings-tool-pill">
                  <span>yt-dlp</span>
                  <strong className={probe?.available ? 'state-ready' : 'state-error'}>
                    {probe?.available ? t.ytDlpReady : t.offline}
                  </strong>
                  <small>{probe?.version ?? t.notDetected}</small>
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void onUpdateYtDlp()}
                  disabled={isUpdatingYtDlp}
                >
                  {isUpdatingYtDlp ? t.updating : t.updateYtDlp}
                </button>
              </div>

              <div className="conn-card">
                <div className="conn-row">
                  <span className="conn-label">{t.networkLabelStatus}</span>
                  <span className={`conn-value ${isOnline ? 'on' : 'off'}`}>
                    <span className="conn-dot" />
                    {isOnline ? t.networkOnline : t.networkOffline}
                  </span>
                </div>
                <div className="conn-row">
                  <span className="conn-label">{t.serverLabel}</span>
                  <span
                    className={`conn-value ${
                      !isOnline || !serverPing?.ok
                        ? 'off'
                        : serverPing.latencyMs < 200
                          ? 'on'
                          : serverPing.latencyMs < 500
                            ? 'mid'
                            : 'off'
                    }`}
                  >
                    <span className="conn-dot" />
                    {!isOnline || (serverPing && !serverPing.ok)
                      ? t.serverDown
                      : serverPing
                        ? `${serverPing.latencyMs < 200 ? t.serverGood : serverPing.latencyMs < 500 ? t.serverSlow : t.serverVerySlow} · ${serverPing.latencyMs}ms`
                        : t.serverChecking}
                  </span>
                </div>
              </div>

              <div className="settings-auto-row">
                <label className="switch-line">
                  <input
                    className="switch-input"
                    type="checkbox"
                    checked={settings?.autoUpdateYtDlp ?? false}
                    onChange={(event) =>
                      void updateSettings({ autoUpdateYtDlp: event.target.checked })
                    }
                    disabled={!settings}
                  />
                  <span className="switch-track" aria-hidden="true">
                    <span className="switch-thumb" />
                  </span>
                  <span className="switch-text">{t.autoUpdateYtDlp}</span>
                </label>

                <label className="field compact-field">
                  <span>{t.updateSchedule}</span>
                  <select
                    value={settings?.ytDlpAutoUpdateMode ?? 'weekly'}
                    onChange={(event) =>
                      void updateSettings({ ytDlpAutoUpdateMode: event.target.value as YtDlpAutoUpdateMode })
                    }
                    disabled={!settings || !settings.autoUpdateYtDlp}
                  >
                    <option value="weekly">{t.weekly}</option>
                    <option value="on-start">{t.onStart}</option>
                  </select>
                </label>

                <small>{t.lastAutoUpdate(formatDateTime(settings?.lastYtDlpAutoUpdateAt ?? null, t))}</small>
              </div>

              <div className="diagnostics-panel">
                <div className="diagnostics-head">
                  <div>
                    <strong>{t.diagnostics}</strong>
                    <p>{t.diagnosticsSubtitle}</p>
                  </div>
                  <button
                    className="secondary-button compact-button"
                    type="button"
                    onClick={() => void onRunDiagnostics()}
                    disabled={isRunningDiagnostics}
                  >
                    {isRunningDiagnostics ? t.running : t.runDiagnostics}
                  </button>
                </div>

                {diagnostics && (
                  <ul className="diagnostics-list">
                    <li className={diagnostics.ytDlp.ok ? 'state-ready' : 'state-error'}>
                      <span>yt-dlp</span>
                      <small>{diagnostics.ytDlp.message}</small>
                    </li>
                    <li className={diagnostics.ffmpeg.ok ? 'state-ready' : 'state-error'}>
                      <span>ffmpeg</span>
                      <small>{diagnostics.ffmpeg.message}</small>
                    </li>
                    <li className={diagnostics.node.ok ? 'state-ready' : 'state-error'}>
                      <span>{t.nodeLabel}</span>
                      <small>{diagnostics.node.message}</small>
                    </li>
                    <li className={diagnostics.network.ok ? 'state-ready' : 'state-error'}>
                      <span>{t.networkLabel}</span>
                      <small>{diagnostics.network.message}</small>
                    </li>
                    <li>
                      <span>{t.generatedAt}</span>
                      <small>{formatDateTime(diagnostics.generatedAt, t)}</small>
                    </li>
                  </ul>
                )}
              </div>

              <div className="settings-section-label">{t.secReport}</div>

              <div className="bug-report">
                <p className="bug-report-desc">{t.reportBugDesc}</p>
                <div className="bug-report-row">
                  <label className="field">
                    <span>{t.yourName}</span>
                    <input
                      type="text"
                      value={bugName}
                      placeholder={t.yourNamePlaceholder}
                      onChange={(event) => setBugName(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>{t.emailLabel}</span>
                    <input
                      type="email"
                      className={bugEmail.trim() && !isValidEmail(bugEmail) ? 'input-invalid' : ''}
                      value={bugEmail}
                      placeholder={t.emailPlaceholder}
                      onChange={(event) => setBugEmail(event.target.value)}
                    />
                    {bugEmail.trim() && !isValidEmail(bugEmail) && (
                      <small className="field-error">{t.invalidEmail}</small>
                    )}
                  </label>
                </div>
                <label className="field">
                  <span>{t.bugMessage}</span>
                  <textarea
                    className="bug-report-text"
                    value={bugMsg}
                    placeholder={t.bugMessagePlaceholder}
                    onChange={(event) => setBugMsg(event.target.value)}
                    rows={3}
                  />
                </label>
                <div className="bug-report-foot">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void onSendBug()}
                    disabled={isSendingBug || !bugMsg.trim() || !isValidEmail(bugEmail)}
                  >
                    {isSendingBug ? t.sending : t.sendBug}
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>

      {/* Keyboard Shortcuts Overlay */}
      {showKeyboardShortcuts && (
        <div className="settings-overlay" onClick={toggleKeyboardShortcuts}>
          <div className="panel settings-modal" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-head">
              <div className="section-header-copy">
                <h2>{t.shortcutsModalTitle}</h2>
                <span>{t.shortcutsSubtitle}</span>
              </div>
              <button className="ghost-button" type="button" onClick={toggleKeyboardShortcuts}>
                {t.close}
              </button>
            </div>

            <div style={{ display: 'grid', gap: '12px' }}>
              {[
                { label: t.addLink, keys: 'Ctrl + Enter' },
                { label: t.startDownloadShort, keys: 'Ctrl + Shift + Enter' },
                { label: t.openSettingsShort, keys: 'Ctrl + ,' },
                { label: t.closeModal, keys: 'Esc' },
                { label: t.showShortcuts, keys: '?' },
              ].map((row) => (
                <div className="tool-pill" key={row.keys}>
                  <div className="shortcut-row">
                    <span>{row.label}</span>
                    <kbd className="kbd">{row.keys}</kbd>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Blocking overlay — ONLY when the update is downloaded and ready to install. */}
      {updateStatus?.state === 'ready' && (
        <div className="update-overlay">
          <div className="update-box">
            <h2>{t.updateTitle}</h2>
            <p>{t.updateReady(updateStatus.version ?? '')}</p>
            <p className="update-desc">{t.updateReadyDesc}</p>
            <button className="primary-button" type="button" onClick={() => void window.electronAPI.installUpdate()}>
              {t.updateNow}
            </button>
          </div>
        </div>
      )}

      {/* Non-blocking banner while downloading / on error — the app stays usable. */}
      {(updateStatus?.state === 'downloading' || updateStatus?.state === 'error') && (
        <div className={`update-banner ${updateStatus.state === 'error' ? 'is-error' : ''}`}>
          {updateStatus.state === 'downloading' ? (
            <>
              <span className="update-banner-text">↓ {t.updateDownloading(updateStatus.percent ?? 0)}</span>
              <span className="update-banner-bar">
                <span style={{ width: `${updateStatus.percent ?? 0}%` }} />
              </span>
            </>
          ) : (
            <>
              <span className="update-banner-text">⚠ {t.updateErrorTitle}</span>
              <button className="update-banner-btn" type="button" onClick={() => void window.electronAPI.retryUpdate()}>
                {t.retry}
              </button>
              <button className="update-banner-btn" type="button" onClick={() => void window.electronAPI.openReleasesPage()}>
                {t.downloadManual}
              </button>
              <button className="update-banner-btn ghost" type="button" onClick={() => setUpdateStatus(null)}>
                {t.updateDismiss}
              </button>
            </>
          )}
        </div>
      )}

      {/* Toast Notifications */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast-${toast.type}`}
            onClick={() => removeToast(toast.id)}
          >
            <div className="toast-icon">
              {toast.type === 'success' && '✓'}
              {toast.type === 'error' && '✕'}
              {toast.type === 'warning' && '⚠'}
              {toast.type === 'info' && 'ℹ'}
            </div>
            <div className="toast-content">
              <div className="toast-title">{toast.title}</div>
              <div className="toast-message">{toast.message}</div>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}

export default App
