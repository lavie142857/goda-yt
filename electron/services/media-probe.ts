import { spawn } from 'node:child_process'
import path from 'node:path'
import { resolveFfmpegLocation } from './binaries.js'

export interface MediaProbeResult {
  width: number | null
  height: number | null
  qualityHeight: number | null
  videoCodec: string | null
  duration: number | null
  hasVideo: boolean
  hasAudio: boolean
}

export function parseMediaProbeOutput(stderr: string): MediaProbeResult | null {
  const lines = stderr.split(/\r?\n/)
  const videoLines = lines.filter((line) => /Stream .*Video:/i.test(line))
  const videoLine = videoLines.find((line) => !/attached pic/i.test(line))
  const match = videoLine?.match(/(?:^|\s)(\d{2,5})x(\d{2,5})(?:[\s,]|$)/)
  const codecMatch = videoLine?.match(/Video:\s*([^,\s]+)/i)
  const width = match ? Number(match[1]) : null
  const height = match ? Number(match[2]) : null
  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/i)
  const duration = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : null
  const hasVideo = Boolean(videoLine)
  const hasAudio = lines.some((line) => /Stream .*Audio:/i.test(line))

  if (!hasVideo && !hasAudio) return null

  return {
    width: width && width > 0 ? width : null,
    height: height && height > 0 ? height : null,
    qualityHeight: width && height && width > 0 && height > 0 ? Math.min(width, height) : null,
    videoCodec: codecMatch?.[1]?.toLowerCase() ?? null,
    duration: duration !== null && Number.isFinite(duration) ? duration : null,
    hasVideo,
    hasAudio,
  }
}

// ffmpeg prints stream metadata before decoding. With only an input it exits
// immediately after probing, so this stays cheap even for large video files.
export async function probeMediaFile(filePath: string): Promise<MediaProbeResult | null> {
  const location = resolveFfmpegLocation()
  const executable = location
    ? path.join(location, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    : 'ffmpeg'

  return new Promise((resolve) => {
    const child = spawn(executable, ['-hide_banner', '-i', filePath], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    let settled = false

    const finish = (result: MediaProbeResult | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish(null)
    }, 10_000)

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 256_000) stderr += chunk.toString('utf8')
    })
    child.on('error', () => finish(null))
    child.on('close', () => {
      finish(parseMediaProbeOutput(stderr))
    })
  })
}
