import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type {
  AppLanguage,
  AppSettings,
  DiagnosticsReport,
  DownloadPreset,
  DownloadStatus,
  DownloadTask,
  QueueControlState,
  OutputFormat,
  SystemNotification,
  UpdateStatus,
  VideoMetadata,
  VideoQualityOption,
  YtDlpAutoUpdateMode,
  YtDlpProbe,
  YtDlpUpdateResult,
} from './shared/contracts'
import { mergeImportedUrls, parseTextInput } from './lib/url-import'
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
  return sortQualityOptions(qualities)[0] ?? AUTO_QUALITY
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

function formatStatusLabel(status: DownloadStatus, t: Messages): string {
  if (status === 'pending') return t.statusPending
  if (status === 'active') return t.statusActive
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

  return appendTagIfMissing(baseTitle, qualityTag)
}

function normalizeUrlForCompare(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) {
    return ''
  }

  try {
    const parsed = new URL(trimmed)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return trimmed
  }
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

function App() {
  const [urlInput, setUrlInput] = useState('')
  const [showManualInput, setShowManualInput] = useState(false)
  const [stagedVideos, setStagedVideos] = useState<StagedVideo[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [renamingIds, setRenamingIds] = useState<Set<string>>(new Set())
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
  // (whose message itself lists "requires sign-in" as a likely cause).
  const suggestLogin = (rawError: string): boolean =>
    needsLogin(rawError) || formatQueueError(rawError, t) === t.errGeneric
  const isSettingsVisible = Boolean(settings?.showSettingsPanel)
  const batchTargets = selectedIds.size > 0
    ? stagedVideos.filter((video) => selectedIds.has(video.id))
    : stagedVideos
  const batchQualityLabels = collectBatchQualityLabels(batchTargets)
  const batchTargetCount = batchTargets.length
  const activeQueueCount = queue.filter((task) => task.status === 'active').length
  const pendingQueueCount = queue.filter((task) => task.status === 'pending').length
  const completedQueueCount = queue.filter((task) => task.status === 'completed').length
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

    try {
      const metadata = await window.electronAPI.probeVideoMultiple(mergeResult.addedUrls)
      const nextVideos = metadata.map((item) => createStagedVideo(item))

      setStagedVideos((currentVideos) => [...nextVideos, ...currentVideos])
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

    const existingUrls = new Set(queue.map((task) => normalizeUrlForCompare(task.request.url)))
    const seenIncoming = new Set<string>()
    let duplicateCount = 0
    const queueable = targets.filter((video) => {
      const normalized = normalizeUrlForCompare(video.url)
      if (!normalized) {
        return false
      }

      if (existingUrls.has(normalized) || seenIncoming.has(normalized)) {
        duplicateCount += 1
        return false
      }

      seenIncoming.add(normalized)
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

  async function onCancelDownload(id: string): Promise<void> {
    if (!hasBridge) return
    await window.electronAPI.cancelDownload(id)
  }

  async function onClearCompleted(): Promise<void> {
    if (!hasBridge) return
    await window.electronAPI.clearCompletedDownloads()
  }

  async function onOpenDownloadFolder(id: string): Promise<void> {
    if (!hasBridge) return
    const opened = await window.electronAPI.openDownloadFolder(id)
    if (!opened) {
      setNotice({
        tone: 'error',
        message: t.cannotOpenFolder,
      })
    }
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

  function onQueueDragStart(event: DragEvent<HTMLElement>, task: DownloadTask): void {
    if (isTerminalStatus(task.status)) {
      return
    }

    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', task.id)
    setDraggedQueueTaskId(task.id)
  }

  async function onQueueDrop(targetTask: DownloadTask): Promise<void> {
    if (!hasBridge) {
      setDraggedQueueTaskId(null)
      return
    }

    const sourceId = draggedQueueTaskId
    setDraggedQueueTaskId(null)

    if (!sourceId || sourceId === targetTask.id) {
      return
    }

    const ok = await window.electronAPI.reorderDownloads(sourceId, targetTask.id)
    if (!ok) {
      setNotice({
        tone: 'error',
        message: t.cannotReorder,
      })
    }
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

  async function moveQueueTask(taskId: string, direction: 'up' | 'down'): Promise<void> {
    if (!hasBridge) {
      return
    }

    const targetId = getReorderTargetId(taskId, direction)
    if (!targetId) {
      return
    }

    const ok = await window.electronAPI.reorderDownloads(taskId, targetId)
    if (!ok) {
      setNotice({
        tone: 'error',
        message: t.cannotMove,
      })
    }
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
                    <img className="row-thumb" src={video.thumbnail} alt="" referrerPolicy="no-referrer" loading="lazy" />
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
                    className={`round-action ${renamingIds.has(video.id) || video.fileNameOverride.trim() ? 'active' : ''}`}
                    type="button"
                    title={t.renameFileTitle}
                    onClick={() => toggleRename(video.id)}
                  >✎</button>
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

            const renderQueueItem = (task: DownloadTask) => {
              const canMoveUp = Boolean(getReorderTargetId(task.id, 'up'))
              const canMoveDown = Boolean(getReorderTargetId(task.id, 'down'))

              return (
                <article
                  key={task.id}
                  className={`download-row queue-row status-${task.status} ${draggedQueueTaskId === task.id ? 'dragging' : ''}`}
                  draggable={!isTerminalStatus(task.status)}
                  onDragStart={(event) => onQueueDragStart(event, task)}
                  onDragEnd={() => setDraggedQueueTaskId(null)}
                  onDragOver={(event) => {
                    if (!draggedQueueTaskId || draggedQueueTaskId === task.id) return
                    event.preventDefault()
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    void onQueueDrop(task)
                  }}
                >
                  {!isTerminalStatus(task.status) && (
                    <span className="queue-drag-handle" aria-hidden="true">⠿</span>
                  )}
                  <div className="row-thumb-wrap">
                    {task.request.thumbnail ? (
                      <img className="row-thumb" src={task.request.thumbnail} alt="" referrerPolicy="no-referrer" loading="lazy" />
                    ) : (
                      <div className="row-thumb placeholder" />
                    )}
                    <span className={`platform-badge ${platformColorClass(task.platform)}`}>{platformIcon(task.platform)}</span>
                  </div>
                  <div className="row-content">
                    <div className="row-title">{queueTitle(task, t)}</div>
                    <div className="row-subline">
                      <span className={`platform-tag ${platformColorClass(task.platform)}`}>{platformLabel(task.platform, t)}</span>
                      <span>{formatStatusLabel(task.status, t)}</span>
                      {task.status === 'active' && <span className="speed-tag">{task.progress.speed}</span>}
                      {task.status === 'active' && <span>ETA {task.progress.eta}</span>}
                      {task.error && <span className="row-error">{formatQueueError(task.error, t)}</span>}
                      {task.error && suggestLogin(task.error) && (
                        <button className="login-hint-button" type="button" onClick={() => void openLoginSettings()}>
                          {t.loginToDownload}
                        </button>
                      )}
                    </div>
                    {!isTerminalStatus(task.status) && (
                      <div className={`desktop-progress ${task.status === 'active' ? 'progress-animated' : ''}`} aria-hidden="true">
                        <div style={{ width: `${Math.max(0, Math.min(100, task.progress.percent))}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="row-actions compact-actions">
                    {!isTerminalStatus(task.status) && (
                      <>
                        <button className="round-action" type="button" onClick={() => void moveQueueTask(task.id, 'up')} disabled={!canMoveUp} title={t.moveUp}>↑</button>
                        <button className="round-action" type="button" onClick={() => void moveQueueTask(task.id, 'down')} disabled={!canMoveDown} title={t.moveDown}>↓</button>
                      </>
                    )}
                    {(task.status === 'active' || task.status === 'pending') && (
                      <button className="round-action danger-action" type="button" onClick={() => void onCancelDownload(task.id)} title={t.cancel}>×</button>
                    )}
                    {(task.status === 'completed' || Boolean(task.outputFile)) && (
                      <button className="row-open-button" type="button" onClick={() => void onOpenDownloadFolder(task.id)}>📂 {t.open}</button>
                    )}
                  </div>
                </article>
              )
            }

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
                  <span style={{ width: `${Math.round(queue.filter(t => t.status === 'active').reduce((sum, t) => sum + t.progress.percent, 0) / Math.max(1, activeQueueCount))}%` }} />
                </span>
                <span>{Math.round(queue.filter(t => t.status === 'active').reduce((sum, t) => sum + t.progress.percent, 0) / Math.max(1, activeQueueCount))}%</span>
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

              <div className="settings-grid">
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
                  <label className="field compact-field">
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
              <div className="tool-pill">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{t.addLink}</span>
                  <kbd style={{ 
                    padding: '4px 8px', 
                    background: 'var(--surface-muted)', 
                    border: '1px solid var(--line-strong)',
                    borderRadius: '6px',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem'
                  }}>Ctrl + Enter</kbd>
                </div>
              </div>

              <div className="tool-pill">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{t.startDownloadShort}</span>
                  <kbd style={{ 
                    padding: '4px 8px', 
                    background: 'var(--surface-muted)', 
                    border: '1px solid var(--line-strong)',
                    borderRadius: '6px',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem'
                  }}>Ctrl + Shift + Enter</kbd>
                </div>
              </div>

              <div className="tool-pill">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{t.openSettingsShort}</span>
                  <kbd style={{ 
                    padding: '4px 8px', 
                    background: 'var(--surface-muted)', 
                    border: '1px solid var(--line-strong)',
                    borderRadius: '6px',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem'
                  }}>Ctrl + ,</kbd>
                </div>
              </div>

              <div className="tool-pill">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{t.closeModal}</span>
                  <kbd style={{ 
                    padding: '4px 8px', 
                    background: 'var(--surface-muted)', 
                    border: '1px solid var(--line-strong)',
                    borderRadius: '6px',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem'
                  }}>Esc</kbd>
                </div>
              </div>

              <div className="tool-pill">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{t.showShortcuts}</span>
                  <kbd style={{ 
                    padding: '4px 8px', 
                    background: 'var(--surface-muted)', 
                    border: '1px solid var(--line-strong)',
                    borderRadius: '6px',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem'
                  }}>?</kbd>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Forced update overlay — blocks the app until updated */}
      {updateStatus && (
        <div className="update-overlay">
          <div className="update-box">
            <h2>{t.updateTitle}</h2>
            {updateStatus.state === 'downloading' && (
              <>
                <p>{t.updateDownloading(updateStatus.percent ?? 0)}</p>
                <div className="update-progress">
                  <div style={{ width: `${updateStatus.percent ?? 0}%` }} />
                </div>
              </>
            )}
            {updateStatus.state === 'ready' && (
              <>
                <p>{t.updateReady(updateStatus.version ?? '')}</p>
                <p className="update-desc">{t.updateReadyDesc}</p>
                <button className="primary-button" type="button" onClick={() => void window.electronAPI.installUpdate()}>
                  {t.updateNow}
                </button>
              </>
            )}
            {updateStatus.state === 'error' && (
              <>
                <p>{t.updateErrorTitle}</p>
                <p className="update-desc">{t.updateErrorDesc}</p>
                <div className="update-error-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void window.electronAPI.openReleasesPage()}
                  >
                    {t.downloadManual}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setUpdateStatus(null)}>
                    {t.updateDismiss}
                  </button>
                </div>
              </>
            )}
          </div>
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
