import type {
  AppSettings,
  DiagnosticsReport,
  DownloadResult,
  DownloadTask,
  QueueControlState,
  StartDownloadInput,
  SystemNotification,
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
  clearCompletedDownloads: () => Promise<boolean>
  openDownloadFolder: (id: string) => Promise<boolean>
  pickOutputDirectory: () => Promise<AppSettings | null>
  probeYtDlp: () => Promise<YtDlpProbe>
  updateYtDlp: () => Promise<YtDlpUpdateResult>
  runDiagnostics: () => Promise<DiagnosticsReport>
  listNotifications: () => Promise<SystemNotification[]>
  clearNotifications: () => Promise<SystemNotification[]>
  readClipboard: () => Promise<string>
  probeVideoInfo: (url: string) => Promise<VideoMetadata>
  probeVideoMultiple: (urls: string[]) => Promise<VideoMetadata[]>
  onDownloadsChanged: (listener: (tasks: DownloadTask[]) => void) => () => void
  onSettingsChanged: (listener: (settings: AppSettings) => void) => () => void
  onDownloadControlStateChanged: (listener: (state: QueueControlState) => void) => () => void
  onNotificationsChanged: (listener: (items: SystemNotification[]) => void) => () => void
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
