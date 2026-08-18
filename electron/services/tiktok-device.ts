import { randomBytes } from 'node:crypto'

let sessionDeviceId: string | null = null

// Keep one plausible TikTok device id for the lifetime of the app. Rotating it on
// every metadata/download retry makes requests from the same process look less
// consistent, while persisting it across installs would create needless tracking.
export function getSessionTikTokDeviceId(): string {
  if (sessionDeviceId) {
    return sessionDeviceId
  }

  const min = 7250000000000000000n
  const max = 7325099899999994577n
  const span = max - min + 1n
  const random = BigInt(`0x${randomBytes(8).toString('hex')}`)
  sessionDeviceId = (min + (random % span)).toString()
  return sessionDeviceId
}
