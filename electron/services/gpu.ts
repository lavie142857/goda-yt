import { spawn } from 'node:child_process'
import path from 'node:path'
import { resolveFfmpegLocation } from './binaries.js'
import type { RecodeEncoder } from '../types.js'

// GPU H.264 encoders in preference order (NVIDIA, Intel QuickSync, AMD).
const GPU_ENCODERS = ['h264_nvenc', 'h264_qsv', 'h264_amf'] as const

let cachedGpuEncoder: Promise<string | null> | null = null

export interface H264RecodePlan {
  args: string
  hardware: boolean
}

export const CPU_H264_RECODE_ARGS = '-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p'

function ffmpegPath(): string {
  const location = resolveFfmpegLocation()
  return location ? path.join(location, 'ffmpeg.exe') : 'ffmpeg'
}

// ffmpeg listing an encoder (compiled in) does NOT mean the GPU/driver can use it,
// so actually run a tiny encode of a null source and check the exit code. Cached
// for the process lifetime since hardware doesn't change while the app runs.
async function detectGpuEncoder(): Promise<string | null> {
  if (cachedGpuEncoder) {
    return cachedGpuEncoder
  }

  cachedGpuEncoder = (async () => {
    const ffmpeg = ffmpegPath()
    for (const encoder of GPU_ENCODERS) {
      if (await probeEncoder(ffmpeg, encoder)) {
        return encoder
      }
    }
    return null
  })()

  return cachedGpuEncoder
}

function probeEncoder(ffmpeg: string, encoder: typeof GPU_ENCODERS[number]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      ffmpeg,
      [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.1',
        '-c:v', encoder, '-f', 'null', '-',
      ],
      { windowsHide: true, stdio: 'ignore' },
    )

    let settled = false
    const finish = (working: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(working)
    }
    const timeout = setTimeout(() => {
      child.kill()
      finish(false)
    }, 5000)

    child.on('error', () => finish(false))
    child.on('close', (code) => finish(code === 0))
  })
}

// ffmpeg '-c:v ...' arguments for re-encoding to H.264, honoring the user's
// GPU/CPU choice. 'cpu' forces libx264; 'auto'/'gpu' use a hardware encoder when
// one actually works, otherwise fall back to libx264 so the download never fails.
export async function resolveH264RecodePlan(setting: RecodeEncoder): Promise<H264RecodePlan> {
  const gpu = setting === 'cpu' ? null : await detectGpuEncoder()

  // -pix_fmt yuv420p is critical: editors (Premiere) need 8-bit 4:2:0 H.264.
  // Without it a hardware encoder can emit 4:4:4 / other formats that won't import.
  switch (gpu) {
    case 'h264_nvenc':
      return { args: '-c:v h264_nvenc -preset p5 -rc vbr -cq 21 -b:v 0 -pix_fmt yuv420p', hardware: true }
    case 'h264_qsv':
      return { args: '-c:v h264_qsv -global_quality 21 -pix_fmt yuv420p', hardware: true }
    case 'h264_amf':
      return { args: '-c:v h264_amf -quality balanced -rc cqp -qp_i 21 -qp_p 21 -pix_fmt yuv420p', hardware: true }
    default:
      return { args: CPU_H264_RECODE_ARGS, hardware: false }
  }
}
