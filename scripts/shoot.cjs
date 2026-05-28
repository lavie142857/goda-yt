// One-off: screenshot the built renderer (empty state) for layout verification.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const indexHtml = path.join(root, 'dist', 'index.html')
const out = path.join(root, 'scripts', 'shot.png')

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 790,
    height: 620,
    show: false,
    webPreferences: { offscreen: true },
  })
  let latest = null
  win.webContents.on('paint', (_e, _d, image) => { latest = image })
  win.webContents.setFrameRate(30)

  await win.loadFile(indexHtml)
  await new Promise((r) => setTimeout(r, 1500))

  const image = latest || (await win.webContents.capturePage())
  fs.writeFileSync(out, image.toPNG())
  console.log('wrote', out, image.getSize())
  app.quit()
})
