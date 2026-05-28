import type { DownloadPlatform } from '../types.js'

const YOUTUBE_PATTERNS = [
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
]

const TIKTOK_PATTERNS = [/(^|\.)tiktok\.com$/i]

const FACEBOOK_PATTERNS = [
  /(^|\.)facebook\.com$/i,
  /(^|\.)fb\.watch$/i,
]

const INSTAGRAM_PATTERNS = [
  /(^|\.)instagram\.com$/i,
  /(^|\.)instagr\.am$/i,
]

function matchesHost(hostname: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(hostname))
}

export function detectPlatform(url: string): DownloadPlatform | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const host = parsed.hostname.toLowerCase()

  if (matchesHost(host, YOUTUBE_PATTERNS)) {
    return 'youtube'
  }

  if (matchesHost(host, TIKTOK_PATTERNS)) {
    return 'tiktok'
  }

  if (matchesHost(host, FACEBOOK_PATTERNS)) {
    return 'facebook'
  }

  if (matchesHost(host, INSTAGRAM_PATTERNS)) {
    return 'instagram'
  }

  return null
}
