import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { resolveFfmpegLocation } from './binaries.js'
import type { RecodeEncoder } from '../types.js'

// GPU H.264 encoders in preference order (NVIDIA, Intel QuickSync, AMD).
const GPU_ENCODERS = ['h264_nvenc', 'h264_qsv', 'h264_amf'] as const

// undefined = not probed yet; null = no working GPU encoder; string = the encoder.
let cachedGpuEncoder: string | null | undefined

function ffmpegPath(): string {
  const location = resolveFfmpegLocation()
  return location ? path.join(location, 'ffmpeg.exe') : 'ffmpeg'
}

// ffmpeg listing an encoder (compiled in) does NOT mean the GPU/driver can use it,
// so actually run a tiny encode of a null source and check the exit code. Cached
// for the process lifetime since hardware doesn't change while the app runs.
function detectGpuEncoder(): string | null {
  if (cachedGpuEncoder !== undefined) {
    return cachedGpuEncoder
  }

  const ffmpeg = ffmpegPath()
  for (const encoder of GPU_ENCODERS) {
    // A real 256x256 black frame (not nullsrc) — some hardware encoders reject
    // tiny/uninitialised sources and would give a false negative otherwise.
    const result = spawnSync(
      ffmpeg,
      [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.1',
        '-c:v', encoder, '-f', 'null', '-',
      ],
      { windowsHide: true, timeout: 15000 },
    )
    if (result.status === 0) {
      cachedGpuEncoder = encoder
      return encoder
    }
  }

  cachedGpuEncoder = null
  return null
}

// ffmpeg '-c:v ...' arguments for re-encoding to H.264, honoring the user's
// GPU/CPU choice. 'cpu' forces libx264; 'auto'/'gpu' use a hardware encoder when
// one actually works, otherwise fall back to libx264 so the download never fails.
export function resolveH264RecodeArgs(setting: RecodeEncoder): string {
  const gpu = setting === 'cpu' ? null : detectGpuEncoder()

  // -pix_fmt yuv420p is critical: editors (Premiere) need 8-bit 4:2:0 H.264.
  // Without it a hardware encoder can emit 4:4:4 / other formats that won't import.
  switch (gpu) {
    case 'h264_nvenc':
      return '-c:v h264_nvenc -preset p5 -rc vbr -cq 21 -b:v 0 -pix_fmt yuv420p'
    case 'h264_qsv':
      return '-c:v h264_qsv -global_quality 21 -pix_fmt yuv420p'
    case 'h264_amf':
      return '-c:v h264_amf -quality balanced -rc cqp -qp_i 21 -qp_p 21 -pix_fmt yuv420p'
    default:
      return '-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p'
  }
}
