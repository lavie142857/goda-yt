import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Read JSON, falling back to a side-by-side ".bak" if the main file is missing or
// corrupt. Used by the settings and history stores.
export function readJsonWithBackup<T>(filePath: string): T | null {
  return readJsonFile<T>(filePath) ?? readJsonFile<T>(`${filePath}.bak`)
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

// Atomic write: write to a temp file, back up the current file, then rename into
// place. Prevents a half-written/corrupt file if the process dies mid-write.
export function writeJsonAtomically(filePath: string, value: unknown, pretty = false): void {
  const tmpPath = `${filePath}.${process.pid}.tmp`
  const backupPath = `${filePath}.bak`

  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(tmpPath, JSON.stringify(value, null, pretty ? 2 : undefined), 'utf8')

  try {
    if (existsSync(filePath)) {
      copyFileSync(filePath, backupPath)
    }
    renameSync(tmpPath, filePath)
  } catch (error) {
    try {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath)
      }
    } catch {
      // ignore cleanup failures
    }
    throw error
  }
}
