import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  DiagnosticsReport,
  DownloadResult,
  DownloadTask,
  NetworkStatus,
  QueueControlState,
  StartDownloadInput,
  SystemNotification,
  VideoMetadata,
  UpdateStatus,
  YtDlpProbe,
  YtDlpUpdateResult,
} from './types.js'

const api = {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),

  updateSettings: (payload: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update', payload),

  startDownloads: (input: StartDownloadInput): Promise<DownloadResult> =>
    ipcRenderer.invoke('downloads:start', input),

  listDownloads: (): Promise<DownloadTask[]> => ipcRenderer.invoke('downloads:list'),

  getDownloadControlState: (): Promise<QueueControlState> =>
    ipcRenderer.invoke('downloads:control-state'),

  pauseDownloads: (): Promise<QueueControlState> => ipcRenderer.invoke('downloads:pause'),

  resumeDownloads: (): Promise<QueueControlState> => ipcRenderer.invoke('downloads:resume'),

  reorderDownloads: (sourceId: string, targetId: string): Promise<boolean> =>
    ipcRenderer.invoke('downloads:reorder', sourceId, targetId),

  cancelDownload: (id: string): Promise<boolean> => ipcRenderer.invoke('downloads:cancel', id),

  retryDownload: (id: string): Promise<boolean> => ipcRenderer.invoke('downloads:retry', id),

  clearCompletedDownloads: (): Promise<boolean> => ipcRenderer.invoke('downloads:clear-completed'),

  openDownloadFolder: (id: string): Promise<boolean> => ipcRenderer.invoke('downloads:open-folder', id),

  pickOutputDirectory: (): Promise<AppSettings | null> =>
    ipcRenderer.invoke('settings:pick-output-dir'),

  probeYtDlp: (): Promise<YtDlpProbe> => ipcRenderer.invoke('yt-dlp:probe'),

  updateYtDlp: (): Promise<YtDlpUpdateResult> => ipcRenderer.invoke('yt-dlp:update'),

  runDiagnostics: (): Promise<DiagnosticsReport> => ipcRenderer.invoke('diagnostics:run'),

  listNotifications: (): Promise<SystemNotification[]> => ipcRenderer.invoke('notifications:list'),

  clearNotifications: (): Promise<SystemNotification[]> => ipcRenderer.invoke('notifications:clear'),

  readClipboard: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),

  pingNetwork: (): Promise<NetworkStatus> => ipcRenderer.invoke('network:ping'),

  reportError: (context: string, message: string): Promise<void> =>
    ipcRenderer.invoke('report:error', context, message),

  reportBug: (name: string, email: string, message: string): Promise<boolean> =>
    ipcRenderer.invoke('report:bug', name, email, message),

  getAuthStatus: (): Promise<boolean> => ipcRenderer.invoke('auth:status'),

  openLogin: (): Promise<boolean> => ipcRenderer.invoke('auth:open-login'),

  importCookies: (): Promise<boolean> => ipcRenderer.invoke('auth:import-cookies'),

  logout: (): Promise<boolean> => ipcRenderer.invoke('auth:logout'),

  probeVideoInfo: (url: string): Promise<VideoMetadata> =>
    ipcRenderer.invoke('video:probe-info', url),

  probeVideoStream: (urls: string[]): Promise<void> =>
    ipcRenderer.invoke('video:probe-stream', urls),

  onProbeResult: (listener: (metadata: VideoMetadata) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, metadata: VideoMetadata) => {
      listener(metadata)
    }

    ipcRenderer.on('video:probe-result', wrapped)
    return () => ipcRenderer.removeListener('video:probe-result', wrapped)
  },

  onDownloadsChanged: (listener: (tasks: DownloadTask[]) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, tasks: DownloadTask[]) => {
      listener(tasks)
    }

    ipcRenderer.on('downloads:changed', wrapped)
    return () => ipcRenderer.removeListener('downloads:changed', wrapped)
  },

  onSettingsChanged: (listener: (settings: AppSettings) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, settings: AppSettings) => {
      listener(settings)
    }

    ipcRenderer.on('settings:changed', wrapped)
    return () => ipcRenderer.removeListener('settings:changed', wrapped)
  },

  onDownloadControlStateChanged: (listener: (state: QueueControlState) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: QueueControlState) => {
      listener(state)
    }

    ipcRenderer.on('downloads:control-state-changed', wrapped)
    return () => ipcRenderer.removeListener('downloads:control-state-changed', wrapped)
  },

  onNotificationsChanged: (listener: (items: SystemNotification[]) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, items: SystemNotification[]) => {
      listener(items)
    }

    ipcRenderer.on('notifications:changed', wrapped)
    return () => ipcRenderer.removeListener('notifications:changed', wrapped)
  },

  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),

  retryUpdate: (): Promise<void> => ipcRenderer.invoke('update:retry'),

  openReleasesPage: (): Promise<void> => ipcRenderer.invoke('update:open-releases'),

  onUpdateStatus: (listener: (status: UpdateStatus) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => {
      listener(status)
    }

    ipcRenderer.on('update:status', wrapped)
    return () => ipcRenderer.removeListener('update:status', wrapped)
  },

  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),

  windowMaximizeToggle: (): Promise<boolean> => ipcRenderer.invoke('window:maximize-toggle'),

  windowClose: (): Promise<void> => ipcRenderer.invoke('window:close'),

  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),

  onWindowMaximizedChanged: (listener: (maximized: boolean) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, maximized: boolean) => {
      listener(maximized)
    }

    ipcRenderer.on('window:maximized-changed', wrapped)
    return () => ipcRenderer.removeListener('window:maximized-changed', wrapped)
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)
