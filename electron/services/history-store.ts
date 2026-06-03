import { app } from 'electron'
import path from 'node:path'
import { readJsonWithBackup, writeJsonAtomically } from './json-store.js'

interface HistoryEntry {
  outputFile: string
  savedAt: number
}

const HISTORY_FILE = 'download-history.json'
const MAX_ENTRIES = 1000

// Persistent record of completed downloads, keyed by video + quality, so the
// same video at the same quality can be re-used (copied) instead of re-downloaded.
export class HistoryStore {
  private readonly filePath: string

  private entries: Record<string, HistoryEntry>

  constructor() {
    this.filePath = path.join(app.getPath('userData'), HISTORY_FILE)
    this.entries = this.load()
  }

  find(key: string): HistoryEntry | undefined {
    return this.entries[key]
  }

  record(key: string, outputFile: string): void {
    this.entries[key] = { outputFile, savedAt: Date.now() }
    this.prune()
    this.persist()
  }

  // Drop a stale entry (e.g. its file was deleted/moved) so it stops being reused.
  remove(key: string): void {
    if (this.entries[key]) {
      delete this.entries[key]
      this.persist()
    }
  }

  private load(): Record<string, HistoryEntry> {
    const parsed = readJsonWithBackup<Record<string, HistoryEntry>>(this.filePath)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed
    }

    return {}
  }

  private prune(): void {
    const keys = Object.keys(this.entries)
    if (keys.length <= MAX_ENTRIES) {
      return
    }

    keys.sort((a, b) => this.entries[a].savedAt - this.entries[b].savedAt)
    for (let i = 0; i < keys.length - MAX_ENTRIES; i++) {
      delete this.entries[keys[i]]
    }
  }

  private persist(): void {
    try {
      writeJsonAtomically(this.filePath, this.entries)
    } catch {
      // Best-effort; failing to persist history must not break downloads.
    }
  }
}
