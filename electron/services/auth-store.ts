import { app } from 'electron'
import { copyFileSync, existsSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { loginAndCaptureCookies, type LoginResult } from './browser-login.js'

export class AuthStore {
  private get cookiesFilePath(): string {
    return path.join(app.getPath('userData'), 'cookies.txt')
  }

  private get loginProfileDir(): string {
    return path.join(app.getPath('userData'), 'login-browser-profile')
  }

  // Path to the cookies file, or null if none has been set up yet.
  getCookiesFilePath(): string | null {
    return existsSync(this.cookiesFilePath) ? this.cookiesFilePath : null
  }

  hasCookiesFile(): boolean {
    return existsSync(this.cookiesFilePath)
  }

  // Copy a user-supplied Netscape cookies.txt (exported from a real browser).
  importCookiesFile(sourcePath: string): boolean {
    try {
      copyFileSync(sourcePath, this.cookiesFilePath)
      return true
    } catch {
      return false
    }
  }

  // Open the user's real Chrome/Edge to log in, then capture cookies.
  async loginViaBrowser(): Promise<LoginResult> {
    return loginAndCaptureCookies(this.loginProfileDir, this.cookiesFilePath)
  }

  logout(): void {
    if (existsSync(this.cookiesFilePath)) {
      unlinkSync(this.cookiesFilePath)
    }
  }
}
