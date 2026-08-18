const { app } = require('electron')
const { mkdirSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..', '..')
const probeRoot = path.join(tmpdir(), `flash-media-settings-probe-${process.pid}`)
const userDataDir = path.join(probeRoot, 'user-data')
const videosDir = path.join(probeRoot, 'videos')
const invalidOutput = path.join(probeRoot, 'not-a-directory')

mkdirSync(userDataDir, { recursive: true })
mkdirSync(videosDir, { recursive: true })
writeFileSync(invalidOutput, 'file blocks directory creation', 'utf8')
writeFileSync(
  path.join(userDataDir, 'settings.json'),
  JSON.stringify({ outputDir: invalidOutput }),
  'utf8',
)

app.setPath('userData', userDataDir)
app.setPath('videos', videosDir)

app.whenReady().then(() => {
  try {
    const { SettingsStore } = require(path.join(rootDir, 'dist-electron', 'services', 'settings-store.js'))
    const store = new SettingsStore()
    const outputDir = store.get().outputDir
    const warning = store.takeOutputDirWarning()
    const ok = outputDir === path.join(videosDir, 'FLASH MEDIA') && Boolean(warning)
    console.log(JSON.stringify({ ok, outputDir, warning: Boolean(warning) }))
    process.exitCode = ok ? 0 : 1
  } finally {
    rmSync(probeRoot, { recursive: true, force: true })
    app.quit()
  }
})
