import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loginAndCaptureCookies, type LoginResult } from './browser-login.js'

const AUTH_COOKIE_NAMES = new Set([
  'SID', 'SSID', 'HSID', 'SAPISID', 'APISID', '__Secure-1PSID', '__Secure-3PSID', 'LOGIN_INFO',
  'sessionid', 'sid_tt', 'sessionid_ss', 'c_user', 'xs', 'ds_user_id',
])

const AUTH_DOMAINS = ['google.com', 'youtube.com', 'tiktok.com', 'facebook.com', 'instagram.com']

// A decrypted cookies file materialized for a single yt-dlp run. The caller must
// call cleanup() once the process has exited so the plaintext never lingers.
export interface CookiesHandle {
  path: string
  cleanup: () => void
}

// Stores login cookies encrypted at rest with the OS keystore (DPAPI on Windows
// via Electron safeStorage). The plaintext Netscape file only ever exists in a
// temp file for the duration of a single yt-dlp invocation, then is deleted.
export class AuthStore {
  private migrated = false

  // Encrypted blob (preferred). Legacy plaintext is migrated into this on first use.
  private get encPath(): string {
    return path.join(app.getPath('userData'), 'cookies.enc')
  }

  private get legacyPath(): string {
    return path.join(app.getPath('userData'), 'cookies.txt')
  }

  private get loginProfileDir(): string {
    return path.join(app.getPath('userData'), 'login-browser-profile')
  }

  private encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  // Encrypt a freshly-found plaintext cookies.txt (e.g. from an older build) and
  // remove the plaintext. Runs once, lazily, so it happens after the app is ready.
  private ensureMigrated(): void {
    if (this.migrated) {
      return
    }
    this.migrated = true

    if (this.encryptionAvailable() && existsSync(this.legacyPath) && !existsSync(this.encPath)) {
      try {
        this.saveCookiesText(readFileSync(this.legacyPath, 'utf8'))
      } catch {
        // Keep the legacy file as a fallback if migration fails.
      }
    }
  }

  // Persist cookies, encrypted when possible. Falls back to plaintext only if the
  // OS keystore is unavailable (not expected on Windows).
  private saveCookiesText(text: string): void {
    if (this.encryptionAvailable()) {
      writeFileSync(this.encPath, safeStorage.encryptString(text))
      if (existsSync(this.legacyPath)) {
        try {
          unlinkSync(this.legacyPath)
        } catch {
          // ignore
        }
      }
      return
    }

    writeFileSync(this.legacyPath, text, 'utf8')
  }

  private readCookiesText(): string | null {
    if (this.encryptionAvailable() && existsSync(this.encPath)) {
      try {
        return safeStorage.decryptString(readFileSync(this.encPath))
      } catch {
        return null
      }
    }

    if (existsSync(this.legacyPath)) {
      try {
        return readFileSync(this.legacyPath, 'utf8')
      } catch {
        return null
      }
    }

    return null
  }

  hasCookiesFile(): boolean {
    this.ensureMigrated()
    const text = this.readCookiesText()
    return Boolean(text && this.hasUsableAuthCookies(text))
  }

  // Decrypt cookies into a unique temp file for one yt-dlp run. Returns null when
  // no cookies are stored. The caller owns cleanup().
  materializeCookies(): CookiesHandle | null {
    this.ensureMigrated()
    const text = this.readCookiesText()
    if (!text || !this.hasUsableAuthCookies(text)) {
      return null
    }

    const tmpPath = path.join(tmpdir(), `flashmedia-ck-${randomUUID()}.txt`)
    try {
      writeFileSync(tmpPath, text, 'utf8')
    } catch {
      return null
    }

    return {
      path: tmpPath,
      cleanup: () => {
        try {
          unlinkSync(tmpPath)
        } catch {
          // ignore — temp dir is cleared by the OS eventually
        }
      },
    }
  }

  // Copy a user-supplied Netscape cookies.txt (exported from a real browser),
  // re-encrypting it at rest.
  importCookiesFile(sourcePath: string): boolean {
    try {
      const text = readFileSync(sourcePath, 'utf8')
      if (!this.hasUsableAuthCookies(text)) {
        return false
      }
      this.saveCookiesText(text)
      return true
    } catch {
      return false
    }
  }

  // Open the user's real Chrome/Edge to log in, then capture + encrypt cookies.
  async loginViaBrowser(): Promise<LoginResult> {
    return loginAndCaptureCookies(this.loginProfileDir, (netscape) => this.saveCookiesText(netscape))
  }

  logout(): void {
    for (const filePath of [this.encPath, this.legacyPath]) {
      if (existsSync(filePath)) {
        try {
          unlinkSync(filePath)
        } catch {
          // ignore
        }
      }
    }
  }

  private hasUsableAuthCookies(text: string): boolean {
    const nowSeconds = Math.floor(Date.now() / 1000)

    return text.split(/\r?\n/).some((rawLine) => {
      const line = rawLine.startsWith('#HttpOnly_') ? rawLine.slice('#HttpOnly_'.length) : rawLine
      if (!line || line.startsWith('#')) {
        return false
      }

      const fields = line.split('\t')
      if (fields.length < 7) {
        return false
      }

      const domain = fields[0].replace(/^\./, '').toLowerCase()
      const expires = Number(fields[4])
      const name = fields[5]
      const value = fields.slice(6).join('\t')
      const supportedDomain = AUTH_DOMAINS.some(
        (candidate) => domain === candidate || domain.endsWith(`.${candidate}`),
      )
      const unexpired = expires === 0 || (Number.isFinite(expires) && expires > nowSeconds)

      return supportedDomain && AUTH_COOKIE_NAMES.has(name) && Boolean(value) && unexpired
    })
  }
}
