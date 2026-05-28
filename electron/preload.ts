import { contextBridge, ipcRenderer } from 'electron'
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

  probeVideoInfo: (url: string): Promise<VideoMetadata> =>
    ipcRenderer.invoke('video:probe-info', url),

  probeVideoMultiple: (urls: string[]): Promise<VideoMetadata[]> =>
    ipcRenderer.invoke('video:probe-multiple', urls),

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
