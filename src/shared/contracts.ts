export type DownloadPlatform = 'youtube' | 'tiktok' | 'facebook' | 'instagram'

export type DownloadPreset =
  | 'smart1080'
  | 'best'
  | 'audioMp3'
  | 'audioM4a'

export type QualityOption = string

export type OutputFormat = 'mp4' | 'webm' | 'mkv' | 'avi' | 'mov'

export type YtDlpAutoUpdateMode = 'weekly' | 'on-start'

export type AppLanguage = 'vi' | 'en'

export type CookiesBrowser = 'none' | 'chrome' | 'edge' | 'firefox' | 'brave'

export interface UpdateStatus {
  state: 'downloading' | 'ready' | 'error'
  version?: string
  percent?: number
}

export type ErrorCategory = 'permanent' | 'temporary' | 'system'

export type DownloadStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface VideoQualityOption {
  id: string
  label: string
  height: number | null
  ext: string | null
  selector: string | null
}

export interface DownloadTask {
  id: string
  platform: DownloadPlatform
  queueIndex: number
  request: {
    url: string
    title?: string | null
    thumbnail?: string | null
    preset: DownloadPreset
    quality?: QualityOption
    format?: OutputFormat
    outputDir?: string
    variantId?: string | null
    variantSelector?: string | null
  }
  status: DownloadStatus
  retryCount: number
  error?: string
  outputFile?: string
  createdAt: number
  updatedAt: number
  progress: {
    percent: number
    speed: string
    eta: string
    stage: string
  }
}

export interface AppSettings {
  maxConcurrent: number
  maxRetries: number
  outputDir: string
  defaultFormat: OutputFormat
  showSettingsPanel: boolean
  autoUpdateYtDlp: boolean
  ytDlpAutoUpdateMode: YtDlpAutoUpdateMode
  lastYtDlpAutoUpdateAt: number | null
  language: AppLanguage
  telemetryEnabled: boolean
  telemetryInstallId: string
  telemetrySent: boolean
  cookiesBrowser: CookiesBrowser
  userName: string
  userEmail: string
}

export interface QueueControlState {
  paused: boolean
}

export interface DownloadResult {
  accepted: DownloadTask[]
  rejected: Array<{ url: string; reason: string }>
}

export interface YtDlpProbe {
  available: boolean
  version: string | null
  executable: string
  error?: string
}

export interface YtDlpUpdateResult {
  ok: boolean
  version: string | null
  executable: string
  message: string
}

export interface DiagnosticsCheck {
  ok: boolean
  message: string
}

export interface DiagnosticsReport {
  generatedAt: number
  ytDlp: DiagnosticsCheck & { version: string | null }
  ffmpeg: DiagnosticsCheck
  node: DiagnosticsCheck
  network: DiagnosticsCheck
}

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'

export interface SystemNotification {
  id: string
  level: NotificationLevel
  source: 'download' | 'system' | 'diagnostics' | 'yt-dlp'
  message: string
  timestamp: number
}

export interface DownloadURLWithPreset {
  url: string
  title?: string | null
  thumbnail?: string | null
  preset: DownloadPreset
  quality?: QualityOption
  format?: OutputFormat
  variantId?: string | null
  variantSelector?: string | null
}

export interface VideoMetadata {
  url: string
  title: string | null
  duration: number | null
  thumbnail: string | null
  platform: DownloadPlatform | null
  availableQualities: VideoQualityOption[]
  probeLimited?: boolean
  error?: VideoError
  warning?: VideoWarning
}

export interface StartDownloadInput {
  downloads: DownloadURLWithPreset[]
}

export interface VideoError {
  message: string
  category: ErrorCategory
}

export interface VideoWarning {
  message: string
}
