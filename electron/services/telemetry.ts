import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import { arch, hostname, userInfo } from 'node:os'
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

// Stable, non-reversible device fingerprint — lets installs be counted/compared
// across machines without sending the raw username or computer name.
function machineFingerprint(): string {
  try {
    const raw = `${hostname()}|${userInfo().username}|${arch()}`
    return createHash('sha256').update(raw).digest('hex').slice(0, 16)
  } catch {
    return 'unknown'
  }
}

// Fire-and-forget device ping, sent only once per machine (guarded by a
// persistent registry marker). Returns true if a request was dispatched.
// Never throws; network failures are ignored.
export function sendInstallTelemetry(settings: AppSettings): boolean {
  if (!settings.telemetryEnabled) {
    return false
  }

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return false
  }

  if (hasRegistryMarker()) {
    return false
  }

  const installDate = new Date().toISOString().slice(0, 10)
  const fingerprint = machineFingerprint()
  const text = ['FLASH MEDIA installed', `date: ${installDate}`, `machine: ${fingerprint}`].join('\n')

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
      res.resume()
    },
  )

  req.on('error', () => {
    // Telemetry must never affect app behavior.
  })
  req.write(payload)
  req.end()

  writeRegistryMarker(`${installDate}|${fingerprint}`)

  return true
}
