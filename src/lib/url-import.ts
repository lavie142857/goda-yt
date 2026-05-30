import { canonicalizeVideoKey } from './video-key'

const URL_PATTERN = /https?:\/\/[^\s"',<>]+/gi

const SUPPORTED_HOST_MATCHERS = [
  /(^|\.)youtube\.com$/i,
  /^youtu\.be$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)facebook\.com$/i,
  /^fb\.watch$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)instagr\.am$/i,
]

export interface ParsedImportResult {
  addedUrls: string[]
  duplicateCount: number
  invalidCount: number
}

export interface ParsedInputPayload {
  urls: string[]
  invalidCount: number
}

export function parseTextInput(text: string): ParsedInputPayload {
  const matches = text.match(URL_PATTERN) ?? []
  const urls = matches.filter((candidate) => isSupportedUrl(candidate))
  const invalidCount = text.trim() && urls.length === 0 ? 1 : 0

  return { urls, invalidCount }
}

export async function parseImportFile(file: File): Promise<ParsedInputPayload> {
  const text = await file.text()
  const extension = file.name.split('.').pop()?.toLowerCase()

  if (extension === 'json') {
    return collectUrlsFromJsonText(text)
  }

  if (extension === 'csv') {
    return collectUrlsFromCsvText(text)
  }

  return collectUrlsFromTxtText(text)
}

export function mergeImportedUrls(existingUrls: string[], incomingUrls: string[]): ParsedImportResult {
  const seen = new Set(existingUrls.map((url) => canonicalizeVideoKey(url)))
  const nextUrls: string[] = []
  let duplicateCount = 0
  let invalidCount = 0

  for (const rawUrl of incomingUrls) {
    const trimmed = rawUrl.trim()
    if (!trimmed || !isSupportedUrl(trimmed)) {
      invalidCount += 1
      continue
    }

    const key = canonicalizeVideoKey(trimmed)
    if (seen.has(key)) {
      duplicateCount += 1
      continue
    }

    seen.add(key)
    nextUrls.push(trimmed)
  }

  return {
    addedUrls: nextUrls,
    duplicateCount,
    invalidCount,
  }
}

export function getDroppedText(dataTransfer: DataTransfer): string {
  const uriList = dataTransfer.getData('text/uri-list').trim()
  if (uriList) {
    return uriList
  }

  return dataTransfer.getData('text/plain').trim()
}

function collectUrlsFromTxtText(text: string): ParsedInputPayload {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  return collectUrlsFromEntries(lines)
}

function collectUrlsFromCsvText(text: string): ParsedInputPayload {
  const cells = text
    .split(/[\r\n,;\t]/)
    .map((cell) => cell.trim())
    .filter(Boolean)

  return collectUrlsFromEntries(cells)
}

function collectUrlsFromJsonText(text: string): ParsedInputPayload {
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    return { urls: [], invalidCount: 1 }
  }

  const values: string[] = []
  walkJson(parsed, values)
  return collectUrlsFromEntries(values)
}

function walkJson(value: unknown, values: string[]): void {
  if (typeof value === 'string') {
    values.push(value)
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item) => walkJson(item, values))
    return
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => walkJson(item, values))
  }
}

function isSupportedUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim())
    return SUPPORTED_HOST_MATCHERS.some((matcher) => matcher.test(parsed.hostname))
  } catch {
    return false
  }
}

function collectUrlsFromEntries(entries: string[]): ParsedInputPayload {
  const urls: string[] = []
  let invalidCount = 0

  for (const entry of entries) {
    const parsed = parseTextInput(entry)
    if (parsed.urls.length === 0) {
      invalidCount += 1
      continue
    }

    urls.push(...parsed.urls)
  }

  return { urls, invalidCount }
}
