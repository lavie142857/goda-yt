import { app } from 'electron'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'
import { arch, hostname, networkInterfaces, release, userInfo } from 'node:os'
import path from 'node:path'
import type { AppSettings } from '../types.js'

interface TelegramConfig {
  botToken: string
  chatId: string
}

function getPackagedTelegramConfig(): TelegramConfig | null {
  try {
    const configPath = path.join(__dirname, 'telemetry-config.json')
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<TelegramConfig>
    const botToken = parsed.botToken?.trim()
    const chatId = parsed.chatId?.trim()
    return botToken && chatId ? { botToken, chatId } : null
  } catch {
    return null
  }
}

// Desktop binaries are public and cannot safely contain a Telegram bot secret.
// Development/private deployments may provide both values at runtime:
//   FLASH_MEDIA_TELEGRAM_BOT_TOKEN=<bot token>
//   FLASH_MEDIA_TELEGRAM_CHAT_ID=<chat id>
function getTelegramConfig(): TelegramConfig | null {
  const botToken = process.env.FLASH_MEDIA_TELEGRAM_BOT_TOKEN?.trim()
  const chatId = process.env.FLASH_MEDIA_TELEGRAM_CHAT_ID?.trim()

  if (botToken && chatId) {
    return { botToken, chatId }
  }

  return getPackagedTelegramConfig()
}

// Persistent "already pinged" marker in HKCU. This survives an %APPDATA% wipe or
// reinstall, so each machine notifies Telegram only once.
const REG_KEY = 'HKCU\\Software\\FLASH MEDIA'
// V2 adds install ID, Windows account and network addresses. A separate marker
// lets existing installations submit the richer report exactly once after update.
const REG_VALUE = 'InstallPingedV2'

function isConfigured(): boolean {
  return Boolean(getTelegramConfig())
}

// Fire-and-forget Telegram message. Never throws.
// onSuccess runs only when Telegram accepts the message (HTTP 2xx).
function sendTelegram(text: string, onSuccess?: () => void): void {
  const config = getTelegramConfig()
  if (!config) {
    return
  }

  const payload = JSON.stringify({
    chat_id: config.chatId,
    text,
    disable_notification: true,
  })

  const req = httpsRequest(
    {
      hostname: 'api.telegram.org',
      path: `/bot${config.botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    },
    (res) => {
      const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300
      res.resume()
      res.on('end', () => {
        if (ok) {
          onSuccess?.()
        }
      })
    },
  )

  req.on('error', () => {
    // Telemetry must never affect app behavior.
  })
  req.write(payload)
  req.end()
}

function hasRegistryMarker(): boolean {
  try {
    const result = spawnSync('reg', ['query', REG_KEY, '/v', REG_VALUE], {
      windowsHide: true,
      encoding: 'utf8',
    })
    return result.status === 0
  } catch {
    return false
  }
}

function writeRegistryMarker(value: string): void {
  try {
    spawnSync('reg', ['add', REG_KEY, '/v', REG_VALUE, '/t', 'REG_SZ', '/d', value, '/f'], {
      windowsHide: true,
    })
  } catch {
    // Marker is best-effort; failing to write must not affect the app.
  }
}

function getLocalIpAddresses(): string {
  const addresses: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address)
    }
  }
  return [...new Set(addresses)].join(', ') || '-'
}

function getWindowsUserName(): string {
  try {
    return userInfo().username || '-'
  } catch {
    return process.env.USERNAME?.trim() || '-'
  }
}

async function getPublicIpAddress(): Promise<string> {
  return new Promise((resolve) => {
    const req = httpsRequest(
      {
        hostname: 'api.ipify.org',
        path: '/?format=json',
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      (res) => {
        let body = ''
        res.on('data', (chunk: Buffer) => {
          if (body.length < 4096) body += chunk.toString('utf8')
        })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body) as { ip?: unknown }
            resolve(typeof parsed.ip === 'string' ? parsed.ip : '-')
          } catch {
            resolve('-')
          }
        })
      },
    )
    req.setTimeout(4000, () => req.destroy())
    req.on('error', () => resolve('-'))
    req.end()
  })
}

// Sent once per machine (guarded by a persistent registry marker).
export function sendInstallTelemetry(settings: AppSettings): boolean {
  if (!settings.telemetryEnabled || !isConfigured()) {
    return false
  }

  if (hasRegistryMarker()) {
    return false
  }

  const installDate = new Date().toISOString().slice(0, 10)
  const machine = hostname()

  void getPublicIpAddress().then((publicIp) => {
    const lines = [
      '🟢 FLASH MEDIA cài đặt',
      `install_id: ${settings.telemetryInstallId || '-'}`,
      `machine: ${machine}`,
      `windows_user: ${getWindowsUserName()}`,
      `app: ${app.getVersion()}`,
      `os: Windows ${release()} (${arch()})`,
      `local_ip: ${getLocalIpAddresses()}`,
      `public_ip: ${publicIp}`,
      `date: ${installDate}`,
      `user: ${settings.userName?.trim() || '-'}`,
    ]

    // Mark only after Telegram confirms so an offline first launch retries.
    sendTelegram(lines.join('\n'), () => writeRegistryMarker(`${installDate}|${machine}`))
  })
  return true
}

// Sent once after the app restarts onto a newer version (update completed).
export function sendUpdateSuccess(report: { from: string; to: string; userName: string }): void {
  if (!isConfigured()) {
    return
  }

  sendTelegram(
    [
      '⬆️ FLASH MEDIA cập nhật thành công',
      `machine: ${hostname()}`,
      `from: ${report.from}`,
      `to: ${report.to}`,
      `user: ${report.userName?.trim() || '-'}`,
    ].join('\n'),
  )
}

// User-submitted bug report from the Settings "Báo lỗi" form.
export function sendBugReport(report: { name: string; email: string; message: string; appVersion: string }): void {
  if (!isConfigured()) {
    return
  }

  sendTelegram(
    [
      '🐞 Báo lỗi từ người dùng',
      `name: ${report.name.trim() || '-'}`,
      `email: ${report.email.trim() || '-'}`,
      `machine: ${hostname()}`,
      `app: ${report.appVersion}`,
      '',
      report.message.trim().slice(0, 1500),
    ].join('\n'),
  )
}

const recentErrors = new Map<string, number>()
let lastErrorSentAt = 0
const SAME_ERROR_COOLDOWN_MS = 60_000
const GLOBAL_ERROR_INTERVAL_MS = 4_000

export interface ErrorReport {
  context: string
  message: string
  userName: string
  appVersion: string
}

export function reportError(report: ErrorReport): void {
  if (!isConfigured()) {
    return
  }

  const message = report.message.slice(0, 500)
  const signature = `${report.context}|${message.slice(0, 120)}`
  const now = Date.now()

  // Drop entries older than the cooldown so the dedupe map cannot grow unbounded.
  if (recentErrors.size > 200) {
    for (const [key, ts] of recentErrors) {
      if (now - ts >= SAME_ERROR_COOLDOWN_MS) {
        recentErrors.delete(key)
      }
    }
  }

  const lastSame = recentErrors.get(signature)
  if (lastSame && now - lastSame < SAME_ERROR_COOLDOWN_MS) {
    return
  }
  if (now - lastErrorSentAt < GLOBAL_ERROR_INTERVAL_MS) {
    return
  }

  recentErrors.set(signature, now)
  lastErrorSentAt = now

  sendTelegram(
    [
      '⚠️ FLASH MEDIA lỗi',
      `user: ${report.userName?.trim() || '-'}`,
      `machine: ${hostname()}`,
      `app: ${report.appVersion}`,
      `ctx: ${report.context}`,
      message,
    ].join('\n'),
  )
}
