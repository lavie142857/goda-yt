import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { get as httpsGet } from 'node:https'
import path from 'node:path'
import { AuthStore } from './services/auth-store.js'
import { DownloadManager } from './services/download-manager.js'
import { SettingsStore } from './services/settings-store.js'
import { reportError, sendBugReport, sendInstallTelemetry } from './services/telemetry.js'
import { YtDlpService } from './services/yt-dlp-service.js'
import { VideoInfoService } from './services/video-info-service.js'
import type {
  AppSettings,
  DiagnosticsCheck,
  DiagnosticsReport,
  DownloadTask,
  StartDownloadInput,
  SystemNotification,
  UpdateStatus,
} from './types.js'

app.setPath('sessionData', path.join(app.getPath('userData'), 'session-data'))

let mainWindow: InstanceType<typeof BrowserWindow> | null = null

const settingsStore = new SettingsStore()
const authStore = new AuthStore()
const ytDlpService = new YtDlpService(
  () => settingsStore.get(),
  () => authStore.getCookiesFilePath(),
)
const videoInfoService = new VideoInfoService(() => authStore.getCookiesFilePath())
const notifications: SystemNotification[] = []
const taskStatusSnapshot = new Map<string, DownloadTask['status']>()

let autoUpdateRunning = false

const downloadManager = new DownloadManager(
  settingsStore,
  ytDlpService,
  (tasks: DownloadTask[]) => {
    detectTaskTransitions(tasks)

    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }

    mainWindow.webContents.send('downloads:changed', tasks)
  },
)

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

// Report an error to Telegram (respects the telemetry toggle, includes identity).
function maybeReportError(context: string, message: string): void {
  const settings = settingsStore.get()
  if (!settings.telemetryEnabled) {
    return
  }

  reportError({
    context,
    message,
    userName: settings.userName,
    appVersion: app.getVersion(),
  })
}

function sendUpdateStatus(status: UpdateStatus): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', status)
  }
}

process.on('uncaughtException', (error) => {
  maybeReportError('main-uncaught', toErrorMessage(error))
})

process.on('unhandledRejection', (reason) => {
  maybeReportError('main-rejection', toErrorMessage(reason))
})

function pushNotification(
  notification: Omit<SystemNotification, 'id' | 'timestamp'>,
): SystemNotification {
  const entry: SystemNotification = {
    id: randomUUID(),
    timestamp: Date.now(),
    ...notification,
  }

  notifications.unshift(entry)
  notifications.splice(80)

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('notifications:changed', notifications)
  }

  return entry
}

function detectTaskTransitions(tasks: DownloadTask[]): void {
  for (const task of tasks) {
    const previous = taskStatusSnapshot.get(task.id)
    if (previous === task.status) {
      continue
    }

    taskStatusSnapshot.set(task.id, task.status)

    if (task.status === 'completed') {
      const title = task.request.title?.trim() || task.platform.toUpperCase()
      pushNotification({
        level: 'success',
        source: 'download',
        message: `Download xong: ${title}`,
      })
      continue
    }

    if (task.status === 'failed') {
      const title = task.request.title?.trim() || task.platform.toUpperCase()
      pushNotification({
        level: 'error',
        source: 'download',
        message: `Download loi: ${title}`,
      })
      continue
    }

    if (task.status === 'cancelled' && previous) {
      const title = task.request.title?.trim() || task.platform.toUpperCase()
      pushNotification({
        level: 'warning',
        source: 'download',
        message: `Da huy: ${title}`,
      })
    }
  }

  const currentIds = new Set(tasks.map((task) => task.id))
  for (const id of taskStatusSnapshot.keys()) {
    if (!currentIds.has(id)) {
      taskStatusSnapshot.delete(id)
    }
  }
}

function shouldRunAutoUpdate(settings: AppSettings): boolean {
  if (!settings.autoUpdateYtDlp) {
    return false
  }

  if (settings.ytDlpAutoUpdateMode === 'on-start') {
    return true
  }

  if (settings.lastYtDlpAutoUpdateAt === null) {
    return true
  }

  const oneWeekMs = 7 * 24 * 60 * 60 * 1000
  return Date.now() - settings.lastYtDlpAutoUpdateAt >= oneWeekMs
}

async function runScheduledAutoUpdate(): Promise<void> {
  if (autoUpdateRunning) {
    return
  }

  const settings = settingsStore.get()
  if (!shouldRunAutoUpdate(settings)) {
    return
  }

  autoUpdateRunning = true

  try {
    const result = await ytDlpService.updateBinary()
    const updated = settingsStore.update({
      lastYtDlpAutoUpdateAt: Date.now(),
    })
    mainWindow?.webContents.send('settings:changed', updated)

    if (result.ok) {
      pushNotification({
        level: 'info',
        source: 'yt-dlp',
        message: `Auto update yt-dlp thanh cong (${result.version ?? 'unknown'})`,
      })
      return
    }

    pushNotification({
      level: 'warning',
      source: 'yt-dlp',
      message: `Auto update yt-dlp that bai: ${result.message}`,
    })
  } catch (error) {
    pushNotification({
      level: 'error',
      source: 'yt-dlp',
      message: `Auto update yt-dlp loi: ${toErrorMessage(error)}`,
    })
  } finally {
    autoUpdateRunning = false
  }
}

function resolveBundledFfmpeg(): string | null {
  const cwdFfmpeg = path.join(process.cwd(), 'bin', 'ffmpeg.exe')
  if (existsSync(cwdFfmpeg)) {
    return cwdFfmpeg
  }

  const resourcesFfmpeg = path.join(process.resourcesPath, 'bin', 'ffmpeg.exe')
  if (existsSync(resourcesFfmpeg)) {
    return resourcesFfmpeg
  }

  return null
}

function checkFfmpegAvailability(): DiagnosticsCheck {
  const bundled = resolveBundledFfmpeg()
  const executable = bundled ?? 'ffmpeg'
  try {
    const result = spawnSync(executable, ['-version'], {
      windowsHide: true,
      timeout: 5000,
      encoding: 'utf8',
    })

    if (result.status === 0) {
      return {
        ok: true,
        message: bundled ? 'ffmpeg di kem ung dung' : 'ffmpeg co san trong PATH',
      }
    }

    const stderr = result.stderr.trim()
    return {
      ok: false,
      message: stderr || 'Khong tim thay ffmpeg.',
    }
  } catch (error) {
    return {
      ok: false,
      message: `Khong the kiem tra ffmpeg: ${toErrorMessage(error)}`,
    }
  }
}

function checkNodeRuntime(): DiagnosticsCheck {
  const nodePath = ytDlpService.getNodeRuntimePath()
  if (!nodePath) {
    return {
      ok: false,
      message: 'Khong tim thay Node.js (can cho YouTube).',
    }
  }

  return {
    ok: true,
    message: `Node.js san sang (${nodePath})`,
  }
}

async function checkNetworkConnectivity(): Promise<DiagnosticsCheck> {
  return new Promise((resolve) => {
    const request = httpsGet('https://www.google.com/generate_204', (response) => {
      const statusCode = response.statusCode ?? 0
      response.resume()

      if (statusCode >= 200 && statusCode < 400) {
        resolve({ ok: true, message: `Mang on (HTTP ${statusCode})` })
        return
      }

      resolve({ ok: false, message: `Network test tra ve HTTP ${statusCode}` })
    })

    request.setTimeout(6000, () => {
      request.destroy(new Error('timeout'))
    })

    request.on('error', (error) => {
      resolve({ ok: false, message: `Network test loi: ${toErrorMessage(error)}` })
    })
  })
}

async function runDiagnostics(): Promise<DiagnosticsReport> {
  const ytProbe = await ytDlpService.probe()
  const ffmpeg = checkFfmpegAvailability()
  const node = checkNodeRuntime()
  const network = await checkNetworkConnectivity()

  const report: DiagnosticsReport = {
    generatedAt: Date.now(),
    ytDlp: {
      ok: ytProbe.available,
      message: ytProbe.available
        ? `yt-dlp san sang (${ytProbe.version ?? 'unknown'})`
        : ytProbe.error || 'yt-dlp chua san sang.',
      version: ytProbe.version,
    },
    ffmpeg,
    node,
    network,
  }

  if ([report.ytDlp.ok, report.ffmpeg.ok, report.node.ok, report.network.ok].every(Boolean)) {
    pushNotification({
      level: 'success',
      source: 'diagnostics',
      message: 'Diagnostics: moi kiem tra deu OK.',
    })
  } else {
    pushNotification({
      level: 'warning',
      source: 'diagnostics',
      message: 'Diagnostics phat hien van de, mo tab Diagnostics de xem chi tiet.',
    })
  }

  return report
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1140,
    height: 640,
    minWidth: 760,
    minHeight: 560,
    title: 'FLASH MEDIA',
    icon: path.join(__dirname, '..', 'dist', 'icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#0f0f1e',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', false)
  })

  mainWindow.webContents.on('did-finish-load', async () => {
    const hasBridge = await mainWindow?.webContents.executeJavaScript(
      'typeof window.electronAPI !== "undefined"',
      true,
    )
    console.log(`[FLASH MEDIA] preload bridge available: ${String(hasBridge)}`)
  })

  mainWindow.webContents.on(
    'did-fail-load',
    (_event: Electron.Event, code: number, description: string, url: string) => {
    console.error(`[FLASH MEDIA] load failed: ${code} ${description} ${url}`)
    },
  )

  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl).catch(() => {
      mainWindow?.loadFile(path.join(process.cwd(), 'dist', 'index.html'))
    })
    // DevTools disabled for clean dev interface
    // Uncomment line below to enable: mainWindow.webContents.openDevTools({ mode: 'detach' })
    mainWindow.show()
    return
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  mainWindow.show()
}

function registerIpcHandlers(): void {
  ipcMain.handle('settings:get', async () => settingsStore.get())

  ipcMain.handle('settings:update', async (_event, payload) => {
    const updated = settingsStore.update(payload)
    mainWindow?.webContents.send('settings:changed', updated)
    return updated
  })

  ipcMain.handle('downloads:start', async (_event, input: StartDownloadInput) => {
    return downloadManager.enqueueMany(input.downloads)
  })

  ipcMain.handle('downloads:list', async () => downloadManager.getQueue())

  ipcMain.handle('downloads:control-state', async () => downloadManager.getControlState())

  ipcMain.handle('downloads:pause', async () => {
    const state = downloadManager.pause()
    mainWindow?.webContents.send('downloads:control-state-changed', state)
    return state
  })

  ipcMain.handle('downloads:resume', async () => {
    const state = downloadManager.resume()
    mainWindow?.webContents.send('downloads:control-state-changed', state)
    return state
  })

  ipcMain.handle('downloads:reorder', async (_event, sourceId: string, targetId: string) => {
    return downloadManager.reorder(sourceId, targetId)
  })

  ipcMain.handle('downloads:cancel', async (_event, id: string) => {
    return downloadManager.cancel(id)
  })

  ipcMain.handle('downloads:clear-completed', async () => {
    return downloadManager.clearCompleted()
  })

  ipcMain.handle('downloads:open-folder', async (_event, id: string) => {
    const task = downloadManager.getQueue().find((item) => item.id === id)
    if (!task) {
      return false
    }

    if (task.outputFile && existsSync(task.outputFile)) {
      shell.showItemInFolder(task.outputFile)
      return true
    }

    const outputDir = task.request.outputDir?.trim() || settingsStore.get().outputDir
    if (!existsSync(outputDir)) {
      return false
    }

    const openError = await shell.openPath(outputDir)
    return !openError
  })

  ipcMain.handle('settings:pick-output-dir', async () => {
    const picked = await dialog.showOpenDialog({
      title: 'Choose output folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: settingsStore.get().outputDir,
    })
    if (picked.canceled || picked.filePaths.length === 0) {
      return null
    }

    return settingsStore.update({
      outputDir: picked.filePaths[0],
    })
  })

  ipcMain.handle('yt-dlp:probe', async () => ytDlpService.probe())

  ipcMain.handle('yt-dlp:update', async () => {
    const result = await ytDlpService.updateBinary()
    if (result.ok) {
      pushNotification({
        level: 'info',
        source: 'yt-dlp',
        message: `Cap nhat yt-dlp thanh cong (${result.version ?? 'unknown'})`,
      })
    } else {
      pushNotification({
        level: 'error',
        source: 'yt-dlp',
        message: `Cap nhat yt-dlp that bai: ${result.message}`,
      })
    }

    return result
  })

  ipcMain.handle('diagnostics:run', async () => runDiagnostics())

  ipcMain.handle('notifications:list', async () => notifications)

  ipcMain.handle('notifications:clear', async () => {
    notifications.length = 0
    mainWindow?.webContents.send('notifications:changed', notifications)
    return notifications
  })

  ipcMain.handle('clipboard:read', () => clipboard.readText())

  ipcMain.handle('report:error', async (_event, context: string, message: string) => {
    maybeReportError(`renderer-${context}`, message)
  })

  ipcMain.handle('report:bug', async (_event, name: string, email: string, message: string) => {
    const persisted = settingsStore.update({ userName: name, userEmail: email })
    sendBugReport({ name, email, message, appVersion: app.getVersion() })
    mainWindow?.webContents.send('settings:changed', persisted)
    return true
  })

  ipcMain.handle('update:install', async () => {
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('update:open-releases', async () => {
    await shell.openExternal('https://github.com/lavie142857/goda-yt/releases/latest')
  })

  ipcMain.handle('auth:status', async () => authStore.hasCookiesFile())

  ipcMain.handle('auth:open-login', async () => {
    const result = await authStore.loginViaBrowser()

    if (result.ok) {
      pushNotification({
        level: 'success',
        source: 'system',
        message: 'Đã đăng nhập tài khoản, cookies đã được lưu.',
      })
    } else {
      const reason =
        result.error === 'no-browser'
          ? 'Không tìm thấy Chrome hoặc Edge trên máy.'
          : result.error === 'no-cookies'
            ? 'Chưa lấy được cookies. Hãy đăng nhập rồi đóng cửa sổ trình duyệt.'
            : 'Không mở được trình duyệt để đăng nhập.'
      pushNotification({ level: 'warning', source: 'system', message: reason })
    }

    return authStore.hasCookiesFile()
  })

  ipcMain.handle('auth:import-cookies', async () => {
    const picked = await dialog.showOpenDialog({
      title: 'Chọn file cookies.txt',
      properties: ['openFile'],
      filters: [{ name: 'cookies.txt', extensions: ['txt'] }],
    })

    if (picked.canceled || picked.filePaths.length === 0) {
      return authStore.hasCookiesFile()
    }

    const imported = authStore.importCookiesFile(picked.filePaths[0])
    if (imported) {
      pushNotification({
        level: 'success',
        source: 'system',
        message: 'Đã nhập cookies đăng nhập.',
      })
    }
    return authStore.hasCookiesFile()
  })

  ipcMain.handle('auth:logout', async () => {
    authStore.logout()
    return false
  })

  ipcMain.handle('video:probe-info', async (_event, url: string) => {
    return videoInfoService.probeVideoInfo(url, settingsStore.get().cookiesBrowser)
  })

  ipcMain.handle('video:probe-multiple', async (_event, urls: string[]) => {
    return videoInfoService.probeMultiple(urls, settingsStore.get().cookiesBrowser)
  })

  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize()
  })

  ipcMain.handle('window:maximize-toggle', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
      return false
    }
    mainWindow.maximize()
    return true
  })

  ipcMain.handle('window:close', () => {
    mainWindow?.close()
  })

  ipcMain.handle('window:is-maximized', () => {
    return mainWindow?.isMaximized() ?? false
  })
}

function setupAppAutoUpdate(): void {
  if (!app.isPackaged) {
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // Only block the app once an update is actually found. A failed update *check*
  // (offline, GitHub unreachable, no release yet) must NOT lock out a working app.
  let updateActive = false

  autoUpdater.on('update-available', (info) => {
    updateActive = true
    sendUpdateStatus({ state: 'downloading', version: info.version, percent: 0 })
  })

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({ state: 'downloading', percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({ state: 'ready', version: info.version })
  })

  autoUpdater.on('error', (error) => {
    console.error('[FLASH MEDIA] auto-update error:', toErrorMessage(error))
    // Show the blocking error UI only if a real update download was underway.
    if (updateActive) {
      sendUpdateStatus({ state: 'error' })
    }
  })

  autoUpdater.checkForUpdates().catch((error) => {
    console.error('[FLASH MEDIA] update check failed:', toErrorMessage(error))
  })
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.flashmedia.app')
  }
  registerIpcHandlers()
  createWindow()
  void runScheduledAutoUpdate()
  setupAppAutoUpdate()

  // Guarded internally by a persistent registry marker (written only on a
  // successful send), so calling every launch safely retries if it failed.
  sendInstallTelemetry(settingsStore.get())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
