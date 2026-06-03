import type {
  AppSettings,
  DiagnosticsReport,
  DownloadResult,
  DownloadTask,
  QueueControlState,
  StartDownloadInput,
  NetworkStatus,
  SystemNotification,
  UpdateStatus,
  VideoMetadata,
  YtDlpProbe,
  YtDlpUpdateResult,
} from '../shared/contracts'

interface ElectronAPI {
  getSettings: () => Promise<AppSettings>
  updateSettings: (payload: Partial<AppSettings>) => Promise<AppSettings>
  startDownloads: (input: StartDownloadInput) => Promise<DownloadResult>
  listDownloads: () => Promise<DownloadTask[]>
  getDownloadControlState: () => Promise<QueueControlState>
  pauseDownloads: () => Promise<QueueControlState>
  resumeDownloads: () => Promise<QueueControlState>
  reorderDownloads: (sourceId: string, targetId: string) => Promise<boolean>
  cancelDownload: (id: string) => Promise<boolean>
  retryDownload: (id: string) => Promise<boolean>
  clearCompletedDownloads: () => Promise<boolean>
  openDownloadFolder: (id: string) => Promise<boolean>
  pickOutputDirectory: () => Promise<AppSettings | null>
  probeYtDlp: () => Promise<YtDlpProbe>
  updateYtDlp: () => Promise<YtDlpUpdateResult>
  runDiagnostics: () => Promise<DiagnosticsReport>
  listNotifications: () => Promise<SystemNotification[]>
  clearNotifications: () => Promise<SystemNotification[]>
  readClipboard: () => Promise<string>
  pingNetwork: () => Promise<NetworkStatus>
  reportError: (context: string, message: string) => Promise<void>
  reportBug: (name: string, email: string, message: string) => Promise<boolean>
  getAuthStatus: () => Promise<boolean>
  openLogin: () => Promise<boolean>
  importCookies: () => Promise<boolean>
  logout: () => Promise<boolean>
  probeVideoInfo: (url: string) => Promise<VideoMetadata>
  probeVideoStream: (urls: string[]) => Promise<void>
  onProbeResult: (listener: (metadata: VideoMetadata) => void) => () => void
  onDownloadsChanged: (listener: (tasks: DownloadTask[]) => void) => () => void
  onSettingsChanged: (listener: (settings: AppSettings) => void) => () => void
  onDownloadControlStateChanged: (listener: (state: QueueControlState) => void) => () => void
  onNotificationsChanged: (listener: (items: SystemNotification[]) => void) => () => void
  installUpdate: () => Promise<void>
  retryUpdate: () => Promise<void>
  openReleasesPage: () => Promise<void>
  onUpdateStatus: (listener: (status: UpdateStatus) => void) => () => void
  windowMinimize: () => Promise<void>
  windowMaximizeToggle: () => Promise<boolean>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>
  onWindowMaximizedChanged: (listener: (maximized: boolean) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }

  const __APP_VERSION__: string
}

export {}
