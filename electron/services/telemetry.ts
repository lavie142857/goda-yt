import { app } from 'electron'
import { spawnSync } from 'node:child_process'
import { request as httpsRequest } from 'node:https'
import { arch, hostname, release } from 'node:os'
import type { AppSettings } from '../types.js'

// ============================================================================
// TELEGRAM CONFIG — paste your bot token and chat id here.
//   1. Talk to @BotFather on Telegram -> /newbot -> copy the token.
//   2. Send any message to your bot, then open
//      https://api.telegram.org/bot<TOKEN>/getUpdates to find your chat id.
// SECURITY: these values are embedded in the distributed app and CAN be
// extracted by users. Use a bot dedicated only to receiving telemetry.
// ============================================================================
const TELEGRAM_BOT_TOKEN = '7425581998:AAGp4tS6_uwYfpBE59qdY2_uI_4ND_zNJmo'
const TELEGRAM_CHAT_ID = '730011734'

// Persistent "already pinged" marker in HKCU — survives an %APPDATA% wipe or a
// reinstall, so each machine notifies Telegram only once, ever.
const REG_KEY = 'HKCU\\Software\\FLASH MEDIA'
const REG_VALUE = 'InstallPinged'

function isConfigured(): boolean {
  return Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID)
}

// Fire-and-forget Telegram message. Never throws.
// onSuccess runs only when Telegram accepts the message (HTTP 2xx).
function sendTelegram(text: string, onSuccess?: () => void): void {
  if (!isConfigured()) {
    return
  }

  const payload = JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text,
    disable_notification: true,
  })

  const req = httpsRequest(
    {
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
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

  const lines = [
    '🟢 FLASH MEDIA cài đặt',
    `machine: ${machine}`,
    `app: ${app.getVersion()}`,
    `os: Windows ${release()} (${arch()})`,
    `date: ${installDate}`,
  ]
  const name = settings.userName?.trim()
  if (name) {
    lines.push(`user: ${name}`)
  }

  // Mark as sent only after Telegram confirms — so an offline first launch
  // retries on the next launch instead of losing the install ping forever.
  sendTelegram(lines.join('\n'), () => writeRegistryMarker(`${installDate}|${machine}`))
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

// ---- Error reporting (throttled to avoid flooding Telegram) ----------------

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

  // Drop entries older than the cooldown so the dedupe map can't grow unbounded.
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
