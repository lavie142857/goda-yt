import { randomUUID } from 'node:crypto'
import { detectPlatform } from './platform.js'
import { SettingsStore } from './settings-store.js'
import { YtDlpDownloadError, YtDlpService } from './yt-dlp-service.js'
import type { DownloadRequest, DownloadResult, DownloadTask, QueueControlState } from '../types.js'

export class DownloadManager {
  private readonly tasks = new Map<string, DownloadTask>()

  private readonly activeControllers = new Map<string, AbortController>()

  private paused = false

  private emitTimer: ReturnType<typeof setTimeout> | null = null

  private emitPending = false

  private static readonly EMIT_THROTTLE_MS = 250

  private static readonly MAX_TERMINAL_TASKS = 200

  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly ytDlpService: YtDlpService,
    private readonly onQueueChanged: (tasks: DownloadTask[]) => void,
  ) {}

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
    const knownUrls = new Set(
      [...this.tasks.values()]
        .map((task) => this.normalizeUrl(task.request.url))
        .filter(Boolean) as string[],
    )

    for (const item of downloads) {
      const url = item.url.trim()
      if (!url) {
        continue
      }

      const normalizedUrl = this.normalizeUrl(url)
      if (normalizedUrl && knownUrls.has(normalizedUrl)) {
        rejected.push({
          url,
          reason: 'URL da ton tai trong queue/lich su tai.',
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
      if (normalizedUrl) {
        knownUrls.add(normalizedUrl)
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
    task.status = 'active'
    task.updatedAt = Date.now()
    task.progress.stage = 'dang-ket-noi'

    const controller = new AbortController()
    this.activeControllers.set(task.id, controller)
    this.emitQueueImmediate()

    try {
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
    } catch (error) {
      const isAborted = (error as Error).message === 'DOWNLOAD_ABORTED'
      if (isAborted) {
        task.status = 'cancelled'
        task.progress.stage = 'da-huy'
        task.updatedAt = Date.now()
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
          setTimeout(() => this.schedule(), backoffMs)
          return
        }

        task.status = 'failed'
        task.error = normalizedError.message
        task.progress.stage = 'that-bai'
        task.updatedAt = Date.now()
      }
    } finally {
      this.activeControllers.delete(task.id)
      this.emitQueueImmediate()
      this.schedule()
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

  private normalizeUrl(url: string): string | null {
    const trimmed = url.trim()
    if (!trimmed) {
      return null
    }

    try {
      const parsed = new URL(trimmed)
      parsed.hash = ''
      return parsed.toString()
    } catch {
      return trimmed
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
