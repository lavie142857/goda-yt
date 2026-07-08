import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { detectPlatform } from './platform.js'
import { HistoryStore } from './history-store.js'
import { SettingsStore } from './settings-store.js'
import { canonicalizeVideoKey } from './video-key.js'
import { YtDlpDownloadError, YtDlpService } from './yt-dlp-service.js'
import type { DownloadRequest, DownloadResult, DownloadTask, QueueControlState } from '../types.js'

export class DownloadManager {
  private readonly tasks = new Map<string, DownloadTask>()

  private readonly activeControllers = new Map<string, AbortController>()

  private readonly pausedTaskIds = new Set<string>()

  private paused = false

  private emitTimer: ReturnType<typeof setTimeout> | null = null

  private emitPending = false

  private static readonly EMIT_THROTTLE_MS = 250

  private static readonly MAX_TERMINAL_TASKS = 200

  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly ytDlpService: YtDlpService,
    private readonly historyStore: HistoryStore,
    private readonly onQueueChanged: (tasks: DownloadTask[]) => void,
  ) {}

  // History key: same video + same preset/quality/format -> same produced file.
  // Only YouTube exposes a real quality ladder; on TikTok/Facebook/Instagram the
  // quality label is unstable across probes (e.g. "Auto" vs "1080p" for the very
  // same file), so we ignore it there and key by video + preset + format only.
  private reuseKey(request: DownloadRequest): string {
    const videoKey = canonicalizeVideoKey(request.url)
    const platform = detectPlatform(request.url)
    const quality = platform === 'youtube' ? (request.quality ?? '') : ''
    const format = request.format ?? ''

    // forceH264 changes the produced file ONLY for >1080p MP4 (VP9 vs re-encoded
    // H.264). Tag the key with the resulting codec there so toggling the setting
    // doesn't reuse a wrong-codec cached file. ≤1080p / non-mp4 is unaffected.
    const height = Number(request.quality?.match(/(\d{3,4})/)?.[1] ?? 0)
    const codecTag =
      platform === 'youtube' && format === 'mp4' && height > 1080
        ? (this.settingsStore.get().forceH264 ? '|h264' : '|vp9')
        : ''

    return `${videoKey}|${request.preset}|${quality}|${format}${codecTag}`
  }

  private queueKey(request: DownloadRequest): string {
    const videoKey = canonicalizeVideoKey(request.url)
    const platform = detectPlatform(request.url)
    const quality = platform === 'youtube' ? (request.quality ?? '') : ''
    const variantSelector = platform === 'youtube' ? (request.variantSelector ?? '') : ''

    return [
      videoKey,
      request.preset,
      quality,
      request.format ?? '',
      variantSelector,
    ].join('|')
  }

  // If this exact (video, quality) was downloaded before and the file still
  // exists, copy it into the current output folder instead of re-downloading.
  // Returns true when the file was reused. Honors the abort signal (a cancel/pause
  // during the copy throws DOWNLOAD_ABORTED, handled like any aborted download).
  // Any unexpected failure returns false so we fall back to a normal download
  // rather than leaving the task stuck.
  private async tryReuseExisting(task: DownloadTask, signal: AbortSignal): Promise<boolean> {
    try {
      const key = this.reuseKey(task.request)
      const entry = this.historyStore.find(key)
      if (!entry) {
        return false
      }

      // Old file is gone (deleted/moved): drop the stale entry and download fresh.
      if (!existsSync(entry.outputFile)) {
        this.historyStore.remove(key)
        return false
      }

      if (signal.aborted) {
        throw new Error('DOWNLOAD_ABORTED')
      }

      const targetDir = task.request.outputDir?.trim() || this.settingsStore.get().outputDir
      const targetPath = path.join(targetDir, path.basename(entry.outputFile))

      if (entry.outputFile !== targetPath && !existsSync(targetPath)) {
        await mkdir(targetDir, { recursive: true })
        await copyFile(entry.outputFile, targetPath)
      }

      // The copy can't be interrupted mid-flight, so re-check after it finishes.
      if (signal.aborted) {
        throw new Error('DOWNLOAD_ABORTED')
      }

      task.outputFile = existsSync(targetPath) ? targetPath : entry.outputFile
      task.reused = true
      task.status = 'completed'
      task.progress = { percent: 100, speed: '-', eta: '00:00', stage: 'sao-chep' }
      task.updatedAt = Date.now()
      this.historyStore.record(key, task.outputFile)
      return true
    } catch (error) {
      if ((error as Error).message === 'DOWNLOAD_ABORTED') {
        throw error // let runTask treat it as a cancel/pause
      }
      return false // copy/lookup failed -> fall back to a normal download
    }
  }

  getQueue(): DownloadTask[] {
    return [...this.tasks.values()].sort((a, b) => {
      if (a.queueIndex !== b.queueIndex) {
        return a.queueIndex - b.queueIndex
      }

      return a.createdAt - b.createdAt
    })
  }

  getControlState(): QueueControlState {
    return { paused: this.paused }
  }

  pause(): QueueControlState {
    this.paused = true

    // Stop running downloads now; they revert to pending and resume from the
    // partial .part files when the queue is resumed.
    for (const [id, controller] of this.activeControllers) {
      this.pausedTaskIds.add(id)
      controller.abort()
    }

    return this.getControlState()
  }

  resume(): QueueControlState {
    this.paused = false
    this.schedule()
    return this.getControlState()
  }

  reorder(sourceId: string, targetId: string): boolean {
    if (sourceId === targetId) {
      return true
    }

    const queue = this.getQueue()
    const sourceIndex = queue.findIndex((task) => task.id === sourceId)
    const targetIndex = queue.findIndex((task) => task.id === targetId)

    if (sourceIndex < 0 || targetIndex < 0) {
      return false
    }

    const [moved] = queue.splice(sourceIndex, 1)
    queue.splice(targetIndex, 0, moved)

    queue.forEach((task, index) => {
      task.queueIndex = index
      task.updatedAt = Date.now()
    })

    this.emitQueueImmediate()
    this.schedule()
    return true
  }

  enqueueMany(downloads: DownloadRequest[]): DownloadResult {
    const accepted: DownloadTask[] = []
    const rejected: Array<{ url: string; reason: string }> = []
    const knownItems = new Set(
      [...this.tasks.values()]
        .filter((task) => task.status === 'pending' || task.status === 'active')
        .map((task) => this.queueKey(task.request))
        .filter(Boolean) as string[],
    )

    for (const item of downloads) {
      const url = item.url.trim()
      if (!url) {
        continue
      }

      const itemKey = this.queueKey({ ...item, url })
      if (itemKey && knownItems.has(itemKey)) {
        rejected.push({
          url,
          reason: 'Bien the tai nay da ton tai trong queue.',
        })
        continue
      }

      const platform = detectPlatform(url)
      if (!platform) {
        rejected.push({
          url,
          reason: 'Link khong thuoc YouTube, TikTok, Facebook hoac Instagram.',
        })
        continue
      }

      const now = Date.now()
      const task: DownloadTask = {
        id: randomUUID(),
        platform,
        queueIndex: this.nextQueueIndex(),
        request: {
          url,
          title: item.title,
          thumbnail: item.thumbnail,
          preset: item.preset,
          quality: item.quality,
          format: item.format,
          variantId: item.variantId,
          variantSelector: item.variantSelector,
          outputDir: item.outputDir,
          duration: item.duration,
          trimStart: item.trimStart,
          trimEnd: item.trimEnd,
        },
        status: 'pending',
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
        progress: {
          percent: 0,
          speed: '-',
          eta: '--:--',
          stage: 'cho-xep-hang',
        },
      }

      this.tasks.set(task.id, task)
      accepted.push(task)
      if (itemKey) {
        knownItems.add(itemKey)
      }
    }

    this.emitQueueImmediate()
    this.schedule()

    return { accepted, rejected }
  }

  cancel(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task) {
      return false
    }

    const activeController = this.activeControllers.get(id)
    if (activeController) {
      activeController.abort()
    }

    if (task.status === 'pending') {
      task.status = 'cancelled'
      task.updatedAt = Date.now()
      task.progress.stage = 'da-huy'
      this.emitQueueImmediate()
    }

    return true
  }

  retry(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task || task.status !== 'failed') {
      return false
    }

    const taskKey = this.queueKey(task.request)
    const hasActiveDuplicate = [...this.tasks.values()].some(
      (item) =>
        item.id !== id
        && (item.status === 'pending' || item.status === 'active')
        && this.queueKey(item.request) === taskKey,
    )
    if (hasActiveDuplicate) {
      return false
    }

    task.status = 'pending'
    task.retryCount = 0
    task.error = undefined
    task.outputFile = undefined
    task.reused = false
    task.queueIndex = this.nextQueueIndex()
    task.progress = {
      percent: 0,
      speed: '-',
      eta: '--:--',
      stage: 'cho-xep-hang',
    }
    task.updatedAt = Date.now()

    this.emitQueueImmediate()
    this.schedule()
    return true
  }

  clearCompleted(): boolean {
    let removed = false
    for (const [id, task] of this.tasks) {
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        this.tasks.delete(id)
        removed = true
      }
    }

    if (removed) {
      this.emitQueueImmediate()
    }

    return removed
  }

  private schedule(): void {
    if (this.paused) {
      return
    }

    const settings = this.settingsStore.get()

    while (this.activeControllers.size < settings.maxConcurrent) {
      const nextTask = this.getQueue().find((task) => task.status === 'pending')

      if (!nextTask) {
        return
      }

      this.runTask(nextTask).catch(() => {
        // Errors are reflected in task state and queue event.
      })
    }
  }

  private async runTask(task: DownloadTask): Promise<void> {
    let shouldScheduleAfterFinish = true

    // Mark active synchronously so the scheduler won't re-pick this task while
    // the (async) reuse check runs. Clear any error from a previous attempt so a
    // task that later completes (e.g. succeeds on retry) doesn't keep showing it.
    task.status = 'active'
    task.error = undefined
    task.updatedAt = Date.now()
    task.progress.stage = 'dang-ket-noi'

    // Reserve the concurrency slot synchronously (before any await) so the
    // scheduler's maxConcurrent check stays correct while the async reuse check runs.
    const controller = new AbortController()
    this.activeControllers.set(task.id, controller)
    this.emitQueueImmediate()

    try {
      // Reuse a previously-downloaded file if possible (handled inside the try so
      // the finally always frees the slot and the catch handles a cancel/pause).
      if (await this.tryReuseExisting(task, controller.signal)) {
        return
      }

      await this.ytDlpService.download(task.request, {
        settings: this.settingsStore.get(),
        signal: controller.signal,
        onProgress: (patch: {
          percent?: number
          speed?: string
          eta?: string
          stage?: string
        }) => {
          task.progress = {
            ...task.progress,
            ...patch,
            percent: patch.percent ?? task.progress.percent,
            speed: patch.speed ?? task.progress.speed,
            eta: patch.eta ?? task.progress.eta,
            stage: patch.stage ?? task.progress.stage,
          }
          task.updatedAt = Date.now()
          this.emitQueue()
        },
        onOutputFile: (outputFile: string) => {
          task.outputFile = outputFile
          task.updatedAt = Date.now()
          this.emitQueue()
        },
      })

      task.status = 'completed'
      task.progress.stage = 'hoan-tat'
      task.progress.percent = 100
      task.updatedAt = Date.now()

      if (task.outputFile) {
        this.historyStore.record(this.reuseKey(task.request), task.outputFile)
      }
    } catch (error) {
      const isAborted = (error as Error).message === 'DOWNLOAD_ABORTED'
      if (isAborted) {
        if (this.pausedTaskIds.has(task.id)) {
          this.pausedTaskIds.delete(task.id)
          task.status = 'pending'
          task.progress.stage = 'tam-dung'
          task.updatedAt = Date.now()
        } else {
          task.status = 'cancelled'
          task.progress.stage = 'da-huy'
          task.updatedAt = Date.now()
        }
      } else {
        const currentSettings = this.settingsStore.get()
        const normalizedError = error as Error
        const isPermanent = normalizedError instanceof YtDlpDownloadError && normalizedError.permanent

        if (!isPermanent && task.retryCount < currentSettings.maxRetries) {
          task.retryCount += 1
          task.status = 'pending'
          task.progress.stage = `thu-lai-${task.retryCount}`
          task.error = normalizedError.message
          task.updatedAt = Date.now()

          const backoffMs = Math.min(30000, 4000 * 2 ** (task.retryCount - 1))
          this.emitQueue()
          this.activeControllers.delete(task.id)
          shouldScheduleAfterFinish = false
          setTimeout(() => this.schedule(), backoffMs)
          return
        }

        task.status = 'failed'
        task.error = normalizedError.message
        task.progress.stage = 'that-bai'
        task.updatedAt = Date.now()
        console.error('[DownloadManager] task failed', {
          id: task.id,
          platform: task.platform,
          title: task.request.title ?? null,
          url: task.request.url,
          error: normalizedError.message,
        })
      }
    } finally {
      this.activeControllers.delete(task.id)
      this.emitQueueImmediate()
      if (shouldScheduleAfterFinish) {
        this.schedule()
      }
    }
  }

  private emitQueue(): void {
    this.emitPending = true

    if (this.emitTimer) {
      return
    }

    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      if (this.emitPending) {
        this.emitPending = false
        this.pruneTerminalTasks()
        this.onQueueChanged(this.getQueue())
      }
    }, DownloadManager.EMIT_THROTTLE_MS)
  }

  private emitQueueImmediate(): void {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer)
      this.emitTimer = null
    }
    this.emitPending = false
    this.pruneTerminalTasks()
    this.onQueueChanged(this.getQueue())
  }

  private pruneTerminalTasks(): void {
    const terminalTasks: DownloadTask[] = []
    for (const task of this.tasks.values()) {
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        terminalTasks.push(task)
      }
    }

    if (terminalTasks.length <= DownloadManager.MAX_TERMINAL_TASKS) {
      return
    }

    terminalTasks.sort((a, b) => a.updatedAt - b.updatedAt)
    const toRemove = terminalTasks.length - DownloadManager.MAX_TERMINAL_TASKS
    for (let i = 0; i < toRemove; i++) {
      this.tasks.delete(terminalTasks[i].id)
    }
  }


  private nextQueueIndex(): number {
    let maxIndex = -1
    for (const task of this.tasks.values()) {
      if (task.queueIndex > maxIndex) {
        maxIndex = task.queueIndex
      }
    }

    return maxIndex + 1
  }
}
