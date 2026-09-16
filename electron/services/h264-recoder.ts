import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { resolveFfmpegLocation } from './binaries.js'
import { CPU_H264_RECODE_ARGS, resolveH264RecodePlan } from './gpu.js'
import type { RecodeEncoder } from '../types.js'

export interface H264RecodeProgress {
  percent?: number
  speed?: string
  eta?: string
  stage: 'dang-chuyen-ma'
}

interface RecodeOptions {
  encoder: RecodeEncoder
  duration: number | null
  signal: AbortSignal
  onProgress: (progress: H264RecodeProgress) => void
}

export function isH264Codec(codec: string | null | undefined): boolean {
  return Boolean(codec && /^(?:h264|avc1)$/i.test(codec))
}

function splitEncoderArgs(args: string): string[] {
  return args.trim().split(/\s+/).filter(Boolean)
}

function formatEta(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = safe % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`
}

function runFfmpegAttempt(
  inputFile: string,
  outputFile: string,
  encoderArgs: string,
  options: RecodeOptions,
): Promise<void> {
  const location = resolveFfmpegLocation()
  const executable = location ? path.join(location, 'ffmpeg.exe') : 'ffmpeg'

  return new Promise((resolve, reject) => {
    const args = [
      '-y', '-hide_banner', '-i', inputFile,
      '-map', '0:v:0', '-map', '0:a?',
      ...splitEncoderArgs(encoderArgs),
      '-c:a', 'aac', '-b:a', '192k',
      '-map_metadata', '0', '-movflags', '+faststart',
      '-progress', 'pipe:2', '-nostats', outputFile,
    ]
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    let buffer = ''
    let encodedSeconds: number | null = null
    let speedValue: number | null = null
    let speedLabel: string | undefined

    const emitProgress = () => {
      const duration = options.duration
      const percent = encodedSeconds !== null && duration && duration > 0
        ? Math.min(100, Math.max(0, encodedSeconds / duration * 100))
        : undefined
      const eta = percent !== undefined && encodedSeconds !== null && duration && speedValue && speedValue > 0
        ? formatEta((duration - encodedSeconds) / speedValue)
        : undefined
      options.onProgress({ percent, speed: speedLabel, eta, stage: 'dang-chuyen-ma' })
    }

    const handleLine = (line: string) => {
      const timeMatch = line.match(/^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/i)
      const microsMatch = line.match(/^out_time_(?:ms|us)=(\d+)/i)
      const speedMatch = line.match(/^speed=\s*([^\s]+)/i)
      if (timeMatch) {
        encodedSeconds = Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3])
      } else if (microsMatch) {
        encodedSeconds = Number(microsMatch[1]) / 1_000_000
      } else if (speedMatch) {
        speedLabel = speedMatch[1]
        const parsed = Number(speedLabel.replace(/x$/i, ''))
        speedValue = Number.isFinite(parsed) ? parsed : null
      }
      if (timeMatch || microsMatch || speedMatch) emitProgress()
    }

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      if (stderr.length < 256_000) stderr += text
      const lines = (buffer + text).split(/\r?\n|\r/)
      buffer = lines.pop() ?? ''
      lines.forEach(handleLine)
    })

    const abort = () => {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      } else {
        child.kill('SIGTERM')
      }
    }
    options.signal.addEventListener('abort', abort)

    child.on('error', (error) => {
      options.signal.removeEventListener('abort', abort)
      reject(error)
    })
    child.on('close', (code) => {
      options.signal.removeEventListener('abort', abort)
      if (buffer) handleLine(buffer)
      if (options.signal.aborted) {
        reject(new Error('DOWNLOAD_ABORTED'))
      } else if (code === 0) {
        resolve()
      } else {
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code ?? 'unknown'}`))
      }
    })
  })
}

export async function recodeMediaToH264(inputFile: string, options: RecodeOptions): Promise<void> {
  const parsed = path.parse(inputFile)
  const token = randomUUID()
  const temporary = path.join(parsed.dir, `${parsed.name}.h264-${token}.mp4`)
  const backup = path.join(parsed.dir, `${parsed.name}.original-${token}${parsed.ext}`)
  const plan = await resolveH264RecodePlan(options.encoder)

  options.onProgress({ percent: 0, speed: '-', eta: '--:--', stage: 'dang-chuyen-ma' })
  try {
    try {
      await runFfmpegAttempt(inputFile, temporary, plan.args, options)
    } catch (error) {
      if (!plan.hardware || (error as Error).message === 'DOWNLOAD_ABORTED') throw error
      await unlink(temporary).catch(() => undefined)
      await runFfmpegAttempt(inputFile, temporary, CPU_H264_RECODE_ARGS, options)
    }

    await rename(inputFile, backup)
    try {
      await rename(temporary, inputFile)
    } catch (error) {
      await rename(backup, inputFile).catch(() => undefined)
      throw error
    }
    await unlink(backup).catch(() => undefined)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}
