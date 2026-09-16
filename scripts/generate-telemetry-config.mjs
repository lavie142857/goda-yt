import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const localConfigPath = path.join(root, '.telemetry.local.json')
const outputPath = path.join(root, 'dist-electron', 'services', 'telemetry-config.json')

let localConfig = {}
if (existsSync(localConfigPath)) {
  try {
    localConfig = JSON.parse(readFileSync(localConfigPath, 'utf8'))
  } catch {
    throw new Error('.telemetry.local.json is not valid JSON.')
  }
}

const botToken = process.env.FLASH_MEDIA_TELEGRAM_BOT_TOKEN?.trim()
  || String(localConfig.botToken ?? '').trim()
const chatId = process.env.FLASH_MEDIA_TELEGRAM_CHAT_ID?.trim()
  || String(localConfig.chatId ?? '').trim()

mkdirSync(path.dirname(outputPath), { recursive: true })
writeFileSync(
  outputPath,
  `${JSON.stringify(botToken && chatId ? { botToken, chatId } : {}, null, 2)}\n`,
  'utf8',
)

console.log(`[telemetry] packaged config: ${botToken && chatId ? 'configured' : 'disabled'}`)
