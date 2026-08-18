import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { accessSync, constants, mkdirSync } from 'node:fs'
import path from 'node:path'
import { readJsonWithBackup, writeJsonAtomically } from './json-store.js'
import type { AppLanguage, AppSettings, AuthMode, CookiesBrowser, OutputFormat, RecodeEncoder, YtDlpAutoUpdateMode } from '../types.js'

const SETTINGS_FILE = 'settings.json'

export class SettingsStore {
  private readonly settingsPath: string

  private settings: AppSettings

  private outputDirWarning: string | null = null

  constructor() {
    const userDataPath = app.getPath('userData')
    this.settingsPath = path.join(userDataPath, SETTINGS_FILE)
    this.settings = this.load()
    const configuredOutputDir = this.settings.outputDir
    this.settings.outputDir = this.resolveUsableOutputDir(configuredOutputDir)
    if (this.settings.outputDir !== configuredOutputDir) {
      this.persist()
    }
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

  takeOutputDirWarning(): string | null {
    const warning = this.outputDirWarning
    this.outputDirWarning = null
    return warning
  }

  update(payload: Partial<AppSettings>): AppSettings {
    const requestedOutputDir = payload.outputDir?.trim() || this.settings.outputDir
    const next: AppSettings = {
      ...this.settings,
      ...payload,
      maxConcurrent: clampNumber(payload.maxConcurrent, 1, 5, this.settings.maxConcurrent),
      maxRetries: clampNumber(payload.maxRetries, 0, 5, this.settings.maxRetries),
      outputDir: this.resolveUsableOutputDir(requestedOutputDir, this.settings.outputDir),
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
      authMode: normalizeAuthMode(payload.authMode, this.settings.authMode),
      cookiesBrowser: normalizeCookiesBrowser(payload.cookiesBrowser, this.settings.cookiesBrowser),
      userName: typeof payload.userName === 'string' ? payload.userName.slice(0, 80) : this.settings.userName,
      userEmail: typeof payload.userEmail === 'string' ? payload.userEmail.slice(0, 120) : this.settings.userEmail,
      lastVersion: typeof payload.lastVersion === 'string' ? payload.lastVersion : this.settings.lastVersion,
      forceH264: normalizeBoolean(payload.forceH264, this.settings.forceH264),
      recodeEncoder: normalizeRecodeEncoder(payload.recodeEncoder, this.settings.recodeEncoder),
      embedMetadata: normalizeBoolean(payload.embedMetadata, this.settings.embedMetadata),
    }

    this.settings = next
    this.persist()
    return this.get()
  }

  private load(): AppSettings {
    const defaultSettings = getDefaultSettings()
    const parsed = readJsonWithBackup<Partial<AppSettings>>(this.settingsPath)

    if (!parsed || typeof parsed !== 'object') {
      return defaultSettings
    }

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
      authMode: normalizeAuthMode(parsed.authMode, defaultSettings.authMode),
      cookiesBrowser: normalizeCookiesBrowser(parsed.cookiesBrowser, defaultSettings.cookiesBrowser),
      userName: typeof parsed.userName === 'string' ? parsed.userName : defaultSettings.userName,
      userEmail: typeof parsed.userEmail === 'string' ? parsed.userEmail : defaultSettings.userEmail,
      lastVersion: typeof parsed.lastVersion === 'string' ? parsed.lastVersion : defaultSettings.lastVersion,
      forceH264: normalizeBoolean(parsed.forceH264, defaultSettings.forceH264),
      recodeEncoder: normalizeRecodeEncoder(parsed.recodeEncoder, defaultSettings.recodeEncoder),
      embedMetadata: normalizeBoolean(parsed.embedMetadata, defaultSettings.embedMetadata),
    }
  }

  private persist(): void {
    writeJsonAtomically(this.settingsPath, this.settings, true)
  }

  private resolveUsableOutputDir(preferred: string, current?: string): string {
    const defaultOutputDir = path.join(app.getPath('videos'), 'FLASH MEDIA')
    const emergencyOutputDir = path.join(app.getPath('userData'), 'downloads')
    const candidates = [preferred, current, defaultOutputDir, emergencyOutputDir]
      .filter((candidate): candidate is string => Boolean(candidate))
    const uniqueCandidates = [...new Set(candidates)]

    for (const candidate of uniqueCandidates) {
      if (this.ensureWritableOutputDir(candidate)) {
        if (candidate !== preferred) {
          this.outputDirWarning = `Không thể ghi vào thư mục tải “${preferred}”. Đã chuyển sang “${candidate}”.`
        }
        return candidate
      }
    }

    throw new Error('Không tìm được thư mục có quyền ghi để lưu video.')
  }

  private ensureWritableOutputDir(outputDir: string): boolean {
    try {
      mkdirSync(outputDir, { recursive: true })
      accessSync(outputDir, constants.W_OK)
      return true
    } catch {
      return false
    }
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
    authMode: 'public',
    cookiesBrowser: 'none',
    userName: '',
    userEmail: '',
    lastVersion: '',
    forceH264: true,
    recodeEncoder: 'auto',
    embedMetadata: true,
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

function normalizeAuthMode(
  value: AuthMode | undefined,
  fallback: AuthMode,
): AuthMode {
  if (value === 'public' || value === 'auto' || value === 'cookies') {
    return value
  }

  return fallback
}

function normalizeRecodeEncoder(
  value: RecodeEncoder | undefined,
  fallback: RecodeEncoder,
): RecodeEncoder {
  if (value === 'auto' || value === 'gpu' || value === 'cpu') {
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
