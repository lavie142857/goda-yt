import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type {
  AppSettings,
  DiagnosticsReport,
  DownloadPreset,
  DownloadStatus,
  DownloadTask,
  QueueControlState,
  OutputFormat,
  SystemNotification,
  VideoMetadata,
  VideoQualityOption,
  YtDlpAutoUpdateMode,
  YtDlpProbe,
  YtDlpUpdateResult,
} from './shared/contracts'
import { mergeImportedUrls, parseTextInput } from './lib/url-import'
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
  label: string
  description: string
  patch: Pick<AppSettings, 'maxConcurrent' | 'maxRetries' | 'defaultFormat'>
}> = [
  {
    id: 'balanced',
    label: 'Cân bằng',
    description: 'Thiết lập ổn định cho hầu hết liên kết.',
    patch: {
      maxConcurrent: 2,
      maxRetries: 2,
      defaultFormat: 'mp4',
    },
  },
  {
    id: 'fast',
    label: 'Nhanh',
    description: 'Tăng số lượt tải song song, giảm số lần thử lại.',
    patch: {
      maxConcurrent: 4,
      maxRetries: 1,
      defaultFormat: 'mp4',
    },
  },
  {
    id: 'safe',
    label: 'An toàn',
    description: 'Tải chậm hơn, thử lại kỹ hơn khi mạng không ổn định.',
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

function platformLabel(platform: VideoMetadata['platform']): string {
  if (platform === 'youtube') return 'YouTube'
  if (platform === 'tiktok') return 'TikTok'
  if (platform === 'facebook') return 'Facebook'
  if (platform === 'instagram') return 'Instagram'
  return 'Không rõ'
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

function queueTitle(task: DownloadTask): string {
  return task.request.title?.trim() || platformLabel(task.platform)
}

function formatQueueError(error: string): string {
  const cleaned = error
    .replace(/^ERROR:\s*/i, '')
    .replace(/^\[[^\]]+\]\s*/i, '')
    .trim()

  if (/requested format is not available/i.test(cleaned)) {
    return 'Chất lượng đã chọn không khả dụng.'
  }
  if (/empty media response/i.test(cleaned)) {
    return 'Instagram không trả về dữ liệu media công khai.'
  }
  if (/video unavailable|this video is unavailable/i.test(cleaned)) {
    return 'Video không khả dụng (đã xóa hoặc bị giới hạn).'
  }
  if (/private video|sign in if you'?ve been granted/i.test(cleaned)) {
    return 'Video ở chế độ riêng tư.'
  }
  if (/members[- ]only|join this channel/i.test(cleaned)) {
    return 'Video chỉ dành cho thành viên kênh.'
  }
  if (/sign in to confirm your age|age[- ]restricted|inappropriate for some/i.test(cleaned)) {
    return 'Video bị giới hạn độ tuổi — cần đăng nhập.'
  }
  if (/this live event will begin|live stream recordings are not available/i.test(cleaned)) {
    return 'Livestream chưa bắt đầu hoặc chưa lưu lại.'
  }
  if (/premiere will begin/i.test(cleaned)) {
    return 'Video premiere chưa phát.'
  }
  if (/HTTP Error 429|too many requests/i.test(cleaned)) {
    return 'Bị giới hạn truy cập (429) — thử lại sau ít phút.'
  }
  if (/HTTP Error 403|forbidden/i.test(cleaned)) {
    return 'Bị từ chối (403) — cần đăng nhập hoặc cookies.'
  }
  if (/HTTP Error 404|not found/i.test(cleaned)) {
    return 'URL không tồn tại (404).'
  }
  if (/(geo|country).{0,20}(restrict|block|not available)/i.test(cleaned)) {
    return 'Bị chặn theo vùng địa lý.'
  }
  if (/copyright|removed by the uploader/i.test(cleaned)) {
    return 'Video đã bị gỡ (bản quyền hoặc do người đăng).'
  }
  if (/unable to download webpage|getaddrinfo|ENOTFOUND|ECONNRESET|ECONNREFUSED|network is unreachable|timed? ?out/i.test(cleaned)) {
    return 'Lỗi mạng — kiểm tra kết nối Internet.'
  }
  if (/no video formats found|unable to extract|unsupported url/i.test(cleaned)) {
    return 'Không trích xuất được video từ URL này.'
  }
  if (/ffmpeg/i.test(cleaned) && /not found|missing|no such file/i.test(cleaned)) {
    return 'Thiếu ffmpeg — cài đặt và thêm vào PATH.'
  }
  if (/disk full|no space left/i.test(cleaned)) {
    return 'Hết dung lượng ổ đĩa.'
  }
  if (/permission denied|access is denied|EACCES/i.test(cleaned)) {
    return 'Không có quyền ghi vào thư mục lưu.'
  }
  if (/playlist|members.*only/i.test(cleaned) && /no entries/i.test(cleaned)) {
    return 'Playlist rỗng hoặc không truy cập được.'
  }
  if (/requires login|login or .*cookies|cookies are required|not returning public media|account is private/i.test(cleaned)) {
    return 'Nội dung này cần đăng nhập hoặc cookies (app chỉ hỗ trợ nội dung công khai).'
  }
  if (/not available in public-only mode/i.test(cleaned)) {
    return 'Nội dung không khả dụng ở chế độ công khai (riêng tư, đã xóa hoặc bị giới hạn).'
  }
  if (/did not expose the requested quality|safer fallback/i.test(cleaned)) {
    return 'Chất lượng/định dạng yêu cầu không có. Hãy thử MP4 với chất lượng Auto.'
  }
  if (/javascript runtime|node\.?js/i.test(cleaned)) {
    return 'Thiếu môi trường JavaScript (Node.js) mà yt-dlp cần.'
  }
  if (/ssl|certificate|cert.*verif/i.test(cleaned)) {
    return 'Lỗi chứng chỉ SSL — kiểm tra ngày giờ hệ thống hoặc kết nối mạng.'
  }
  if (/HTTP Error 5\d\d|server error|service unavailable|bad gateway/i.test(cleaned)) {
    return 'Máy chủ nguồn đang lỗi — thử lại sau.'
  }
  if (/unsupported url|no suitable extractor|is not a valid url/i.test(cleaned)) {
    return 'Link không được hỗ trợ hoặc không hợp lệ.'
  }

  // Không hiển thị mã lỗi/raw thô — đưa ra thông báo chẩn đoán gọn, dễ hiểu.
  return 'Không tải được video. Link có thể không hợp lệ, bị giới hạn khu vực, riêng tư hoặc cần đăng nhập.'
}

function summarizeImport(
  sourceLabel: string,
  addedCount: number,
  duplicateCount: number,
  invalidCount: number,
): NoticeState {
  const parts = [`${sourceLabel}: ${addedCount} link mới`]

  if (duplicateCount > 0) {
    parts.push(`${duplicateCount} trùng`)
  }

  if (invalidCount > 0) {
    parts.push(`${invalidCount} bỏ qua`)
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

function formatStatusLabel(status: DownloadStatus): string {
  if (status === 'pending') return 'Chờ tải'
  if (status === 'active') return 'Đang tải'
  if (status === 'completed') return 'Hoàn tất'
  if (status === 'failed') return 'Lỗi'
  return 'Đã hủy'
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

function buildDownloadFileName(video: StagedVideo, selectedQuality: VideoQualityOption): string {
  const customTitle = video.fileNameOverride.trim()
  const baseTitle = customTitle || video.title?.trim() || platformLabel(video.platform)
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

function formatDateTime(timestamp: number | null): string {
  if (!timestamp) {
    return 'Never'
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
  if (stagedVideos.length > 0) queueSummaryParts.push(`${stagedVideos.length} chờ`)
  if (activeQueueCount > 0) queueSummaryParts.push(`${activeQueueCount} đang tải`)
  if (pendingQueueCount > 0) queueSummaryParts.push(`${pendingQueueCount} xếp hàng`)
  if (completedQueueCount > 0) queueSummaryParts.push(`${completedQueueCount} hoàn tất`)
  const queueSummaryText = queueSummaryParts.length > 0 ? queueSummaryParts.join(' · ') : 'Chưa có mục nào'
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
    }
  }, [hasBridge])

  // Hiển thị thông báo hệ thống (tải xong/lỗi...) dưới dạng toast trong app
  useEffect(() => {
    if (!hasBridge) return

    const seen = new Set<string>()
    let seeded = false

    const titleForLevel = (level: SystemNotification['level']): string => {
      if (level === 'success') return 'Hoàn tất'
      if (level === 'error') return 'Lỗi'
      if (level === 'warning') return 'Cảnh báo'
      return 'Thông báo'
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
  }, [hasBridge, showToast])

  // Ô nhập link tự giãn cao theo số dòng (tới giới hạn CSS rồi cuộn)
  useEffect(() => {
    const el = urlTextareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [showManualInput, urlInput])

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
      message: `Đã áp dụng hồ sơ ${profile.label}.`,
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
        ? `Đã chọn chất lượng đề xuất cho ${targetIds.size} mục.`
        : `Đã đặt ${value} cho ${targetIds.size} mục.`,
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
        ? `Đã bật MP3 cho ${targetIds.size} mục.`
        : `Đã chuyển ${targetIds.size} mục về video.`,
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
      setNotice(summarizeImport(sourceLabel, 0, mergeResult.duplicateCount, totalInvalid))
      return
    }

    setIsAddingUrls(true)
    setNotice({
      tone: 'info',
      message: `${sourceLabel}: đang đọc metadata cho ${mergeResult.addedUrls.length} link`,
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
        ),
      )
    } catch (error) {
      setNotice({
        tone: 'error',
        message: `Đọc metadata thất bại: ${formatQueueError(error instanceof Error ? error.message : String(error))}`,
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
        message: 'Dán ít nhất một URL được hỗ trợ.',
      })
      return
    }

    await addUrls(parsed.urls, parsed.invalidCount, 'Dán')
    setUrlInput('')
  }

  async function handleClipboardPaste(): Promise<void> {
    if (!hasBridge) return

    let clipboardText = ''
    try {
      clipboardText = await window.electronAPI.readClipboard()
    } catch {
      setNotice({ tone: 'error', message: 'Không đọc được clipboard.' })
      return
    }

    const parsed = parseTextInput(clipboardText)
    if (parsed.urls.length === 0) {
      setNotice({ tone: 'error', message: 'Clipboard không có link được hỗ trợ.' })
      return
    }

    await addUrls(parsed.urls, parsed.invalidCount, 'Clipboard')
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
        message: `Bỏ qua ${duplicateCount} link trùng đã có trong hàng đợi hoặc lịch sử.`,
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
          const fileName = buildDownloadFileName(video, selectedQuality)

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
        showToast('error', 'Không thể tải', 'Chưa có mục nào được đưa vào hàng đợi.')
        return
      }

      const rejectedSuffix = result.rejected.length > 0 ? ` · ${result.rejected.length} bị từ chối` : ''
      showToast('success', 'Đã thêm vào hàng đợi', `${result.accepted.length} mục đã được thêm${rejectedSuffix}`)
    } catch (error) {
      const errorMsg = `Không thể thêm vào hàng đợi: ${formatQueueError(error instanceof Error ? error.message : String(error))}`
      showToast('error', 'Lỗi tải xuống', errorMsg)
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
        message: 'Không thể mở thư mục lưu. Hãy kiểm tra lại file hoặc thư mục đầu ra.',
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
        message: 'Đã cập nhật thư mục lưu.',
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
        message: `Cập nhật yt-dlp thất bại: ${formatQueueError(error instanceof Error ? error.message : String(error))}`,
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
      message: nextState.paused ? 'Đã tạm dừng hàng đợi.' : 'Đã tiếp tục hàng đợi.',
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
        message: 'Chưa thể sắp xếp lại mục này.',
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
      const allGood = [report.ytDlp.ok, report.ffmpeg.ok, report.outputDir.ok, report.network.ok]
        .every(Boolean)

      setNotice({
        tone: allGood ? 'success' : 'info',
        message: allGood ? 'Chẩn đoán không phát hiện lỗi.' : 'Chẩn đoán phát hiện vấn đề cần kiểm tra.',
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: `Chẩn đoán thất bại: ${formatQueueError(error instanceof Error ? error.message : String(error))}`,
      })
    } finally {
      setIsRunningDiagnostics(false)
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
        message: 'Chưa thể di chuyển lượt tải này.',
      })
    }
  }

  return (
    <main className="app-shell">
      <div className={`app-window ${isEmptyState ? 'is-empty' : ''}`}>
        <header className="window-titlebar">
          <div className="window-title">
            <strong className="brand-name">
              <span className="brand-goda">FLASH</span>
              <span className="brand-yt">MEDIA</span>
            </strong>
            <span className="brand-divider" aria-hidden="true" />
            <span className="brand-tagline">Trình tải video chất lượng cao</span>
          </div>
          <div className="titlebar-right">
            <div className="titlebar-actions">
            <button
              className="toolbar-button"
              type="button"
              onClick={() => void toggleSettingsPanel()}
              disabled={!settings}
              title="Mở cài đặt (Ctrl+,)"
              style={{ minHeight: '32px', padding: '0 12px', fontSize: '1.1rem' }}
            >
              <span className="animated-icon">⚙</span>
            </button>
            <button
              className="toolbar-button"
              type="button"
              onClick={toggleKeyboardShortcuts}
              title="Phím tắt (?)"
              style={{ minHeight: '32px', padding: '0 12px', fontSize: '1rem', fontWeight: 700 }}
            >
              ?
            </button>
            <button
              className="toolbar-button"
              type="button"
              onClick={toggleTheme}
              title={theme === 'light' ? 'Chuyển sang chế độ tối' : 'Chuyển sang chế độ sáng'}
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
                  title="Thu nhỏ"
                  aria-label="Thu nhỏ"
                >─</button>
                <button
                  className="win-control"
                  type="button"
                  onClick={() => void window.electronAPI.windowMaximizeToggle()}
                  title={isMaximized ? 'Khôi phục' : 'Phóng to'}
                  aria-label={isMaximized ? 'Khôi phục' : 'Phóng to'}
                >{isMaximized ? '❐' : '□'}</button>
                <button
                  className="win-control win-control-close"
                  type="button"
                  onClick={() => void window.electronAPI.windowClose()}
                  title="Đóng"
                  aria-label="Đóng"
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
            title="Đọc link trực tiếp từ clipboard"
          >
            <span className={isAddingUrls ? 'spinning-icon' : ''}>📋</span> Dán từ clipboard
          </button>
          <button
            className={`toolbar-button ${showManualInput ? 'active' : ''}`}
            type="button"
            onClick={() => setShowManualInput((open) => !open)}
            title="Hiện/ẩn ô nhập link thủ công"
          >
            ✎ Nhập tay
          </button>
          {stagedVideos.length > 0 && (
            <label className="select-all-control" title={allStagedSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}>
              <input
                type="checkbox"
                checked={allStagedSelected}
                ref={(el) => { if (el) el.indeterminate = someStagedSelected }}
                onChange={toggleSelectAll}
              />
              <span className="select-all-label">Tất cả</span>
            </label>
          )}
          {batchTargetCount > 0 && (
            <div className="batch-controls" aria-label="Thiết lập hàng loạt">
              <select
                value=""
                onChange={(event) => {
                  if (!event.target.value) return
                  applyBatchQuality(event.target.value)
                  event.currentTarget.value = ''
                }}
                title={selectedIds.size > 0 ? 'Áp dụng cho mục đã chọn' : 'Áp dụng cho toàn bộ mục chờ'}
              >
                <option value="">Chất lượng</option>
                <option value={RECOMMENDED_BATCH_QUALITY}>Đề xuất</option>
                {batchQualityLabels.map((label) => (
                  <option key={label} value={label}>{label}</option>
                ))}
              </select>
              <button className="batch-button" type="button" onClick={() => applyBatchMp3(true)} title="Chuyển tất cả sang MP3">
                🎵 MP3
              </button>
              <button className="batch-button" type="button" onClick={() => applyBatchMp3(false)} title="Chuyển tất cả sang Video">
                🎬 Video
              </button>
            </div>
          )}
          <div className="toolbar-right">
            <label className="format-control">
              <span>Format</span>
              <select
                value={settings?.defaultFormat ?? 'mp4'}
                onChange={(event) => void updateSettings({ defaultFormat: event.target.value as OutputFormat })}
                disabled={!settings}
                title="Định dạng video mặc định"
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
              title={queueControl.paused ? 'Tiếp tục tải (Resume)' : 'Tạm dừng tải (Pause)'}
            >
              {queueControl.paused ? '▶' : '⏸'}
            </button>
            <button
              className="toolbar-button primary-button"
              type="button"
              onClick={() => void startDownload()}
              disabled={stagedVideos.length === 0}
              title="Bắt đầu tải xuống (Ctrl+Shift+Enter)"
            >
              <span className={activeQueueCount > 0 ? 'bouncing-icon' : ''}>↓</span> Tải xuống
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
              placeholder="Dán hoặc nhập link tại đây, mỗi link một dòng..."
              autoFocus
            />
            <div className="link-entry-actions">
              <button
                className="toolbar-button primary-button"
                type="button"
                onClick={() => void handlePasteAdd()}
                disabled={isAddingUrls || !urlInput.trim()}
                title="Thêm link đã nhập vào danh sách (Ctrl+Enter)"
              >
                <span className={isAddingUrls ? 'spinning-icon' : ''}>＋</span> Thêm vào danh sách
              </button>
            </div>
          </section>
        )}

        <section className="downloader-list" aria-label="Danh sách tải">
          {stagedVideos.length === 0 && queue.length === 0 && !isAddingUrls ? (
            <div className="desktop-empty">
              <div className="empty-hero">
                <div className="empty-logo">
                  <img src="./icon.png" alt="FLASH MEDIA" />
                </div>
                <h2 className="empty-title">Sẵn sàng tải video</h2>
                <p className="empty-subtitle">Dán link YouTube, TikTok, Facebook hoặc Instagram để bắt đầu</p>
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
                  <div className="row-title">{video.title || platformLabel(video.platform)}</div>
                  {video.error && (
                    <div className="video-status-badge error-badge" title={video.error.message}>
                      ⚠ {video.error.category === 'permanent' ? 'Lỗi' : 'Tạm lỗi'}: {formatQueueError(video.error.message)}
                    </div>
                  )}
                  {!video.error && video.warning && (
                    <div className="video-status-badge warning-badge" title={video.warning.message}>
                      ⚠ {formatQueueError(video.warning.message)}
                    </div>
                  )}
                  {!video.error && !video.warning && video.probeLimited && (
                    <div className="video-status-badge info-badge">
                      Dữ liệu giới hạn
                    </div>
                  )}
                  {renamingIds.has(video.id) && (
                    <input
                      type="text"
                      className="filename-edit"
                      placeholder="Chỉnh sửa tên file..."
                      value={video.fileNameOverride}
                      onChange={(e) => updateVideo(video.id, { fileNameOverride: e.target.value })}
                      title="Tên file khi tải"
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
                  <label className="mini-switch" title="Chuyển sang MP3">
                    <input type="checkbox" checked={audioOnly} onChange={() => toggleVideoMp3(video.id)} />
                    <span />
                  </label>
                  <button
                    className={`round-action ${renamingIds.has(video.id) || video.fileNameOverride.trim() ? 'active' : ''}`}
                    type="button"
                    title="Đổi tên file"
                    onClick={() => toggleRename(video.id)}
                  >✎</button>
                  <button className="round-action" type="button" title="Tải ngay" onClick={() => void startDownload(new Set([video.id]))}>↓</button>
                  <button className="round-action danger-action" type="button" title="Xóa khỏi danh sách" onClick={() => removeVideo(video.id)}>×</button>
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
                    <div className="row-title">{queueTitle(task)}</div>
                    <div className="row-subline">
                      <span className={`platform-tag ${platformColorClass(task.platform)}`}>{platformLabel(task.platform)}</span>
                      <span>{formatStatusLabel(task.status)}</span>
                      {task.status === 'active' && <span className="speed-tag">{task.progress.speed}</span>}
                      {task.status === 'active' && <span>ETA {task.progress.eta}</span>}
                      {task.error && <span className="row-error">{formatQueueError(task.error)}</span>}
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
                        <button className="round-action" type="button" onClick={() => void moveQueueTask(task.id, 'up')} disabled={!canMoveUp} title="Di chuyển lên">↑</button>
                        <button className="round-action" type="button" onClick={() => void moveQueueTask(task.id, 'down')} disabled={!canMoveDown} title="Di chuyển xuống">↓</button>
                      </>
                    )}
                    {(task.status === 'active' || task.status === 'pending') && (
                      <button className="round-action danger-action" type="button" onClick={() => void onCancelDownload(task.id)} title="Hủy">×</button>
                    )}
                    {(task.status === 'completed' || Boolean(task.outputFile)) && (
                      <button className="row-open-button" type="button" onClick={() => void onOpenDownloadFolder(task.id)}>📂 Mở</button>
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
                      <span>Đang tải ({activeItems.length})</span>
                    </div>
                    {activeItems.map(renderQueueItem)}
                  </div>
                )}
                {pendingItems.length > 0 && (
                  <div className="queue-group">
                    <div className="queue-group-header">
                      <span className="queue-group-icon">⏳</span>
                      <span>Chờ ({pendingItems.length})</span>
                    </div>
                    {pendingItems.map(renderQueueItem)}
                  </div>
                )}
                {terminalItems.length > 0 && (
                  <div className="queue-group">
                    <div className="queue-group-header">
                      <span className="queue-group-icon">✓</span>
                      <span>Hoàn tất ({terminalItems.length})</span>
                      <button
                        className="queue-group-clear"
                        type="button"
                        onClick={() => void onClearCompleted()}
                        title="Xóa các mục đã hoàn tất khỏi danh sách"
                      >
                        🗑 Xóa
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
            <span>{queueControl.paused ? '⏸ Tạm dừng' : activeQueueCount > 0 ? '↓ Đang tải' : '● Sẵn sàng'}</span>
          </div>
        </footer>

        {isSettingsVisible && (
          <div className="settings-overlay" role="presentation" onClick={() => void closeSettingsPanel()}>
            <section
              className="panel settings-modal"
              id="settings-panel"
              role="dialog"
              aria-modal="true"
              aria-label="Cài đặt"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="settings-modal-head">
                <div className="section-header-copy">
                  <h2>Cài đặt</h2>
                  <span>Điều khiển tải, yt-dlp và chẩn đoán</span>
                </div>
                <button className="ghost-button" type="button" onClick={() => void closeSettingsPanel()}>
                  Đóng
                </button>
              </div>

              <div className="settings-health-row">
                <div className="tool-pill settings-tool-pill">
                  <span>yt-dlp</span>
                  <strong className={probe?.available ? 'state-ready' : 'state-error'}>
                    {probe?.available ? 'Sẵn sàng' : 'Ngoại tuyến'}
                  </strong>
                  <small>{probe?.version ?? 'Chưa phát hiện'}</small>
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void onUpdateYtDlp()}
                  disabled={isUpdatingYtDlp}
                >
                  {isUpdatingYtDlp ? 'Đang cập nhật' : 'Cập nhật yt-dlp'}
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
                  <span className="switch-text">Tự cập nhật yt-dlp</span>
                </label>

                <label className="field compact-field">
                  <span>Lịch cập nhật</span>
                  <select
                    value={settings?.ytDlpAutoUpdateMode ?? 'weekly'}
                    onChange={(event) =>
                      void updateSettings({ ytDlpAutoUpdateMode: event.target.value as YtDlpAutoUpdateMode })
                    }
                    disabled={!settings || !settings.autoUpdateYtDlp}
                  >
                    <option value="weekly">Hàng tuần</option>
                    <option value="on-start">Khi mở app</option>
                  </select>
                </label>

                <small>{`Lần tự cập nhật gần nhất: ${formatDateTime(settings?.lastYtDlpAutoUpdateAt ?? null)}`}</small>
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
                    <strong>{profile.label}</strong>
                    <span>{profile.description}</span>
                    {smartProfileMatchesSettings(profile, settings) && <small>Đang dùng</small>}
                  </button>
                ))}
              </div>

              <div className="settings-grid">
                <label className="field">
                  <span>Định dạng</span>
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
                  <span>Tải song song</span>
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
                  <span>Thử lại</span>
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

              <div className="folder-row">
                <input type="text" value={settings?.outputDir ?? ''} readOnly title="Đường dẫn lưu (chỉ đọc — có thể bôi đen để sao chép)" />
                <button className="secondary-button" type="button" onClick={() => void pickOutputDirectory()}>
                  Chọn thư mục
                </button>
              </div>

              <div className="diagnostics-panel">
                <div className="diagnostics-head">
                  <div>
                    <strong>Chẩn đoán</strong>
                    <p>Kiểm tra yt-dlp, ffmpeg, thư mục lưu và mạng</p>
                  </div>
                  <button
                    className="secondary-button compact-button"
                    type="button"
                    onClick={() => void onRunDiagnostics()}
                    disabled={isRunningDiagnostics}
                  >
                    {isRunningDiagnostics ? 'Đang chạy' : 'Chạy chẩn đoán'}
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
                    <li className={diagnostics.outputDir.ok ? 'state-ready' : 'state-error'}>
                      <span>Thư mục lưu</span>
                      <small>{diagnostics.outputDir.message}</small>
                    </li>
                    <li className={diagnostics.network.ok ? 'state-ready' : 'state-error'}>
                      <span>Mạng</span>
                      <small>{diagnostics.network.message}</small>
                    </li>
                    <li>
                      <span>Thời điểm tạo</span>
                      <small>{formatDateTime(diagnostics.generatedAt)}</small>
                    </li>
                  </ul>
                )}
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
                <h2>⌨️ Phím tắt</h2>
                <span>Các phím tắt hữu ích để sử dụng nhanh</span>
              </div>
              <button className="ghost-button" type="button" onClick={toggleKeyboardShortcuts}>
                Đóng
              </button>
            </div>

            <div style={{ display: 'grid', gap: '12px' }}>
              <div className="tool-pill">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>Thêm link</span>
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
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>Bắt đầu tải</span>
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
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>Mở cài đặt</span>
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
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>Đóng modal</span>
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
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>Hiện phím tắt</span>
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
