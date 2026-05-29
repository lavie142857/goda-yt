import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { AppLanguage, AppSettings, CookiesBrowser, OutputFormat, YtDlpAutoUpdateMode } from '../types.js'

const SETTINGS_FILE = 'settings.json'

export class SettingsStore {
  private readonly settingsPath: string

  private settings: AppSettings

  constructor() {
    const userDataPath = app.getPath('userData')
    this.settingsPath = path.join(userDataPath, SETTINGS_FILE)
    this.settings = this.load()
    this.ensureOutputDir(this.settings.outputDir)
    this.ensureInstallId()
  }

  private ensureInstallId(): void {
    if (!this.settings.telemetryInstallId) {
      this.settings.telemetryInstallId = randomUUID()
      this.persist()
    }
  }

  get(): AppSettings {
    return { ...this.settings }
  }

  update(payload: Partial<AppSettings>): AppSettings {
    const next: AppSettings = {
      ...this.settings,
      ...payload,
      maxConcurrent: clampNumber(payload.maxConcurrent, 1, 5, this.settings.maxConcurrent),
      maxRetries: clampNumber(payload.maxRetries, 0, 5, this.settings.maxRetries),
      outputDir: payload.outputDir?.trim() || this.settings.outputDir,
      defaultFormat: normalizeOutputFormat(payload.defaultFormat, this.settings.defaultFormat),
      showSettingsPanel: normalizeBoolean(payload.showSettingsPanel, this.settings.showSettingsPanel),
      autoUpdateYtDlp: normalizeBoolean(payload.autoUpdateYtDlp, this.settings.autoUpdateYtDlp),
      ytDlpAutoUpdateMode: normalizeAutoUpdateMode(payload.ytDlpAutoUpdateMode, this.settings.ytDlpAutoUpdateMode),
      lastYtDlpAutoUpdateAt: normalizeNullableTimestamp(
        payload.lastYtDlpAutoUpdateAt,
        this.settings.lastYtDlpAutoUpdateAt,
      ),
      language: normalizeLanguage(payload.language, this.settings.language),
      telemetryEnabled: normalizeBoolean(payload.telemetryEnabled, this.settings.telemetryEnabled),
      telemetryInstallId: this.settings.telemetryInstallId,
      telemetrySent: normalizeBoolean(payload.telemetrySent, this.settings.telemetrySent),
      cookiesBrowser: normalizeCookiesBrowser(payload.cookiesBrowser, this.settings.cookiesBrowser),
      userName: typeof payload.userName === 'string' ? payload.userName.slice(0, 80) : this.settings.userName,
      userEmail: typeof payload.userEmail === 'string' ? payload.userEmail.slice(0, 120) : this.settings.userEmail,
    }

    this.ensureOutputDir(next.outputDir)
    this.settings = next
    this.persist()
    return this.get()
  }

  private load(): AppSettings {
    const defaultSettings = getDefaultSettings()

    try {
      const raw = readFileSync(this.settingsPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<AppSettings>
      return {
        ...defaultSettings,
        ...parsed,
        maxConcurrent: clampNumber(parsed.maxConcurrent, 1, 5, defaultSettings.maxConcurrent),
        maxRetries: clampNumber(parsed.maxRetries, 0, 5, defaultSettings.maxRetries),
        outputDir: parsed.outputDir?.trim() || defaultSettings.outputDir,
        defaultFormat: normalizeOutputFormat(parsed.defaultFormat, defaultSettings.defaultFormat),
        showSettingsPanel: normalizeBoolean(parsed.showSettingsPanel, defaultSettings.showSettingsPanel),
        autoUpdateYtDlp: normalizeBoolean(parsed.autoUpdateYtDlp, defaultSettings.autoUpdateYtDlp),
        ytDlpAutoUpdateMode: normalizeAutoUpdateMode(parsed.ytDlpAutoUpdateMode, defaultSettings.ytDlpAutoUpdateMode),
        lastYtDlpAutoUpdateAt: normalizeNullableTimestamp(
          parsed.lastYtDlpAutoUpdateAt,
          defaultSettings.lastYtDlpAutoUpdateAt,
        ),
        language: normalizeLanguage(parsed.language, defaultSettings.language),
        telemetryEnabled: normalizeBoolean(parsed.telemetryEnabled, defaultSettings.telemetryEnabled),
        telemetryInstallId:
          typeof parsed.telemetryInstallId === 'string'
            ? parsed.telemetryInstallId
            : defaultSettings.telemetryInstallId,
        telemetrySent: normalizeBoolean(parsed.telemetrySent, defaultSettings.telemetrySent),
        cookiesBrowser: normalizeCookiesBrowser(parsed.cookiesBrowser, defaultSettings.cookiesBrowser),
        userName: typeof parsed.userName === 'string' ? parsed.userName : defaultSettings.userName,
        userEmail: typeof parsed.userEmail === 'string' ? parsed.userEmail : defaultSettings.userEmail,
      }
    } catch {
      return defaultSettings
    }
  }

  private persist(): void {
    writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf8')
  }

  private ensureOutputDir(outputDir: string): void {
    mkdirSync(outputDir, { recursive: true })
  }
}

function getDefaultSettings(): AppSettings {
  const outputDir = path.join(app.getPath('videos'), 'FLASH MEDIA')
  return {
    maxConcurrent: 2,
    maxRetries: 2,
    outputDir,
    defaultFormat: 'mp4',
    showSettingsPanel: false,
    autoUpdateYtDlp: true,
    ytDlpAutoUpdateMode: 'weekly',
    lastYtDlpAutoUpdateAt: null,
    language: 'vi',
    telemetryEnabled: true,
    telemetryInstallId: '',
    telemetrySent: false,
    cookiesBrowser: 'none',
    userName: '',
    userEmail: '',
  }
}

function clampNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || Number.isNaN(value)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.round(value)))
}

function normalizeOutputFormat(
  value: OutputFormat | undefined,
  fallback: OutputFormat,
): OutputFormat {
  if (value === 'mp4' || value === 'webm' || value === 'mkv' || value === 'avi' || value === 'mov') {
    return value
  }

  return fallback
}

function normalizeBoolean(
  value: boolean | undefined,
  fallback: boolean,
): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  return fallback
}

function normalizeAutoUpdateMode(
  value: YtDlpAutoUpdateMode | undefined,
  fallback: YtDlpAutoUpdateMode,
): YtDlpAutoUpdateMode {
  if (value === 'weekly' || value === 'on-start') {
    return value
  }

  return fallback
}

function normalizeLanguage(
  value: AppLanguage | undefined,
  fallback: AppLanguage,
): AppLanguage {
  if (value === 'vi' || value === 'en') {
    return value
  }

  return fallback
}

function normalizeCookiesBrowser(
  value: CookiesBrowser | undefined,
  fallback: CookiesBrowser,
): CookiesBrowser {
  if (
    value === 'none'
    || value === 'chrome'
    || value === 'edge'
    || value === 'firefox'
    || value === 'brave'
  ) {
    return value
  }

  return fallback
}

function normalizeNullableTimestamp(
  value: number | null | undefined,
  fallback: number | null,
): number | null {
  if (value === null) {
    return null
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }

  return fallback
}
