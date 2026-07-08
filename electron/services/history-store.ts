import { app } from 'electron'
import path from 'node:path'
import { readJsonWithBackup, writeJsonAtomically } from './json-store.js'

interface HistoryEntry {
  outputFile: string
  savedAt: number
}

interface HistoryFile {
  version: number
  entries: Record<string, HistoryEntry>
}

const HISTORY_FILE = 'download-history.json'
const MAX_ENTRIES = 1000
// Bump whenever the reuse-key format changes. Entries written under an older
// scheme are discarded on load so a stale key can never reuse the wrong file.
// v2: reuse keys now encode the trim (clip) range.
const SCHEMA_VERSION = 2

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
    const parsed = readJsonWithBackup<Partial<HistoryFile>>(this.filePath)
    if (
      parsed
      && typeof parsed === 'object'
      && !Array.isArray(parsed)
      && parsed.version === SCHEMA_VERSION
      && parsed.entries
      && typeof parsed.entries === 'object'
    ) {
      return parsed.entries
    }

    // Missing/old/unknown schema: discard so keys computed under a different
    // scheme can't reuse a wrong file (e.g. a full video reusing a trimmed clip).
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
      const payload: HistoryFile = { version: SCHEMA_VERSION, entries: this.entries }
      writeJsonAtomically(this.filePath, payload)
    } catch {
      // Best-effort; failing to persist history must not break downloads.
    }
  }
}
