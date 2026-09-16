const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

process.resourcesPath = process.cwd()

const { DownloadManager } = require('../../dist-electron/services/download-manager.js')
const { parseMediaProbeOutput } = require('../../dist-electron/services/media-probe.js')
const { YtDlpService } = require('../../dist-electron/services/yt-dlp-service.js')
const { ytDlpOperationGate } = require('../../dist-electron/services/yt-dlp-gate.js')

function selectorFrom(service, request, qualityFallback = false) {
  const settings = {
    outputDir: '.',
    defaultFormat: 'mp4',
    maxRetries: 0,
    embedMetadata: false,
    forceH264: true,
    cookiesBrowser: 'none',
  }
  const args = service.buildArgs(
    request,
    settings,
    {
      relaxed: false,
      qualityFallback,
      platform: 'youtube',
      authAttempt: 'public',
      youtubeProfile: 'web-embedded',
    },
    null,
  )
  return args[args.indexOf('-f') + 1]
}

async function waitForTask(task) {
  const deadline = Date.now() + 5000
  while (task.status === 'pending' || task.status === 'active') {
    if (Date.now() > deadline) throw new Error('DownloadManager test timed out.')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function main() {
  const gateEvents = []
  let releaseOperation
  const heldOperation = ytDlpOperationGate.runOperation(async () => {
    gateEvents.push('operation-start')
    await new Promise((resolve) => { releaseOperation = resolve })
    gateEvents.push('operation-end')
  })
  const maintenance = ytDlpOperationGate.runMaintenance(async () => {
    gateEvents.push('maintenance')
  })
  const queuedOperation = ytDlpOperationGate.runOperation(async () => {
    gateEvents.push('queued-operation')
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(gateEvents, ['operation-start'])
  releaseOperation()
  await Promise.all([heldOperation, maintenance, queuedOperation])
  assert.deepEqual(gateEvents, ['operation-start', 'operation-end', 'maintenance', 'queued-operation'])

  const service = new YtDlpService(() => null, () => false)
  const baseRequest = {
    url: 'https://www.youtube.com/watch?v=quality-test',
    preset: 'smart1080',
    quality: '1080p',
    format: 'mp4',
    variantSelector: '137+bestaudio/best',
  }

  const exactSelector = selectorFrom(service, baseRequest)
  assert.match(exactSelector, /\[height=1080\]/)
  assert.doesNotMatch(exactSelector, /height<=1080/)

  const fallbackSelector = selectorFrom(service, baseRequest, true)
  assert.match(fallbackSelector, /\[height<=1080\]/)

  const webmSelector = selectorFrom(service, {
    ...baseRequest,
    format: 'webm',
    variantSelector: '248+bestaudio/best',
  })
  assert.equal(webmSelector, '248+bestaudio/best')

  const facebookArgs = service.buildArgs(
    {
      ...baseRequest,
      url: 'https://www.facebook.com/reel/quality-test',
      variantSelector: 'facebook-video+facebook-audio',
    },
    {
      outputDir: '.',
      defaultFormat: 'mp4',
      maxRetries: 0,
      embedMetadata: false,
      forceH264: true,
      cookiesBrowser: 'none',
    },
    {
      relaxed: false,
      qualityFallback: false,
      platform: 'facebook',
      authAttempt: 'public',
    },
    null,
  )
  assert.equal(facebookArgs[facebookArgs.indexOf('-f') + 1], 'facebook-video+facebook-audio')

  const longOutputTemplate = service.buildOutputTemplate(`${'x'.repeat(200)} [1080p]`)
  assert.equal(longOutputTemplate.length, 168)
  assert.match(longOutputTemplate, /\[1080p\]\.\%\(ext\)s$/)

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flash-media-quality-'))
  const output1080 = path.join(testDir, 'Example [1080p].mp4')
  const output360 = path.join(testDir, 'Example [360p].mp4')
  const durationOutput = path.join(testDir, 'Duration [1080p].mp4')
  const collisionOutput = path.join(testDir, 'Collision [1080p].mp4')

  try {
    fs.writeFileSync(collisionOutput, 'existing media')
    const collisionRequest = {
      ...baseRequest,
      title: 'Collision [1080p]',
      outputDir: testDir,
    }
    const collisionSettings = {
      outputDir: testDir,
      defaultFormat: 'mp4',
    }
    const firstReservation = service.reserveOutputRequest(collisionRequest, collisionSettings)
    const secondReservation = service.reserveOutputRequest(collisionRequest, collisionSettings)
    assert.equal(firstReservation.request.title, 'Collision [1080p] (2)')
    assert.equal(secondReservation.request.title, 'Collision [1080p] (3)')
    firstReservation.release()
    secondReservation.release()

    const probe = parseMediaProbeOutput([
      'Duration: 00:00:00.50, start: 0.000000, bitrate: 100 kb/s',
      'Stream #0:0: Video: h264, yuv420p, 640x360, 25 fps',
      'Stream #0:1: Audio: aac, 44100 Hz, mono',
    ].join('\n'))
    assert.ok(probe)
    assert.equal(probe.qualityHeight, 360)
    assert.equal(probe.hasVideo, true)
    assert.equal(probe.hasAudio, true)
    assert.equal(probe.videoCodec, 'h264')
    assert.ok(probe.duration > 0)

    const audioOnlyProbe = parseMediaProbeOutput([
      'Duration: 00:00:10.00, start: 0.000000, bitrate: 192 kb/s',
      'Stream #0:0: Video: mjpeg, yuvj420p, 600x600 (attached pic)',
      'Stream #0:1: Audio: mp3, 44100 Hz, stereo',
    ].join('\n'))
    assert.ok(audioOnlyProbe)
    assert.equal(audioOnlyProbe.hasVideo, false)
    assert.equal(audioOnlyProbe.hasAudio, true)
    assert.equal(audioOnlyProbe.videoCodec, null)

    const historyRecords = []
    const settingsStore = {
      get: () => ({
        maxConcurrent: 1,
        maxRetries: 0,
        outputDir: testDir,
        forceH264: true,
        reuseDownloadedFiles: false,
      }),
    }
    const historyStore = {
      find: () => undefined,
      remove: () => {},
      record: (key, outputFile) => historyRecords.push({ key, outputFile }),
    }
    const fakeDownloader = {
      download: async (_request, hooks) => {
        fs.writeFileSync(output1080, 'mock media')
        hooks.onOutputFile(output1080, { width: 640, height: 360 })
      },
    }
    const inspectMedia = async () => probe
    const manager = new DownloadManager(settingsStore, fakeDownloader, historyStore, () => {}, inspectMedia)
    const task = manager.enqueueMany([{ ...baseRequest, title: 'Example [1080p]', duration: 0.5 }]).accepted[0]
    await waitForTask(task)

    assert.equal(task.status, 'completed')
    assert.equal(task.actualQuality, '360p')
    assert.equal(task.qualityFallbackUsed, true)
    assert.equal(task.outputFile, output360)
    assert.equal(fs.existsSync(output360), true)
    assert.equal(historyRecords.length, 1)
    assert.match(historyRecords[0].key, /\|360p\|/)

    const durationProbe = {
      width: 1920,
      height: 1080,
      qualityHeight: 1080,
      videoCodec: 'h264',
      duration: 20,
      hasVideo: true,
      hasAudio: true,
    }
    const durationDownloader = {
      download: async (_request, hooks) => {
        fs.writeFileSync(durationOutput, 'mock media')
        hooks.onOutputFile(durationOutput, { width: 1920, height: 1080 })
      },
    }
    const durationManager = new DownloadManager(
      settingsStore,
      durationDownloader,
      historyStore,
      () => {},
      async () => durationProbe,
    )
    const durationTask = durationManager.enqueueMany([{
      ...baseRequest,
      title: 'Duration [1080p]',
      duration: 100,
    }]).accepted[0]
    await waitForTask(durationTask)
    assert.equal(durationTask.status, 'completed')
    assert.equal(durationTask.validationWarning, 'duration-mismatch')
    assert.equal(historyRecords.length, 1)

    let codecProbeCalls = 0
    let recodeCalls = 0
    const vp9Probe = {
      width: 1920,
      height: 1080,
      qualityHeight: 1080,
      videoCodec: 'vp9',
      duration: 100,
      hasVideo: true,
      hasAudio: true,
    }
    const h264Probe = { ...vp9Probe, videoCodec: 'h264' }
    const codecOutput = path.join(testDir, 'Codec [1080p].mp4')
    const codecDownloader = {
      download: async (_request, hooks) => {
        fs.writeFileSync(codecOutput, 'mock media')
        hooks.onOutputFile(codecOutput, { width: 1920, height: 1080 })
      },
    }
    const codecManager = new DownloadManager(
      settingsStore,
      codecDownloader,
      historyStore,
      () => {},
      async () => codecProbeCalls++ === 0 ? vp9Probe : h264Probe,
      async (_file, options) => {
        recodeCalls += 1
        options.onProgress({ percent: 50, speed: '2x', eta: '0:25', stage: 'dang-chuyen-ma' })
      },
    )
    const codecTask = codecManager.enqueueMany([{
      ...baseRequest,
      title: 'Codec [1080p]',
      duration: 100,
    }]).accepted[0]
    await waitForTask(codecTask)
    assert.equal(codecTask.status, 'completed')
    assert.equal(codecTask.actualVideoCodec, 'h264')
    assert.equal(recodeCalls, 1)
    assert.equal(historyRecords.length, 2)

    console.log('QUALITY_TEST=PASS')
  } finally {
    for (const file of [output1080, output360, durationOutput, collisionOutput, path.join(testDir, 'Codec [1080p].mp4')]) {
      if (fs.existsSync(file)) fs.unlinkSync(file)
    }
    fs.rmdirSync(testDir)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
