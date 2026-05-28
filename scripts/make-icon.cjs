// One-off: render public/favicon.svg to a 256x256 PNG using Electron offscreen rendering.
// Run with: node_modules/electron/dist/electron.exe scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const svg = fs.readFileSync(path.join(root, 'public', 'favicon.svg'), 'utf8')
const outPng = path.join(root, 'public', 'icon.png')

const SIZE = 256
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:transparent}
  #wrap{width:${SIZE}px;height:${SIZE}px;display:flex;align-items:center;justify-content:center}
  #wrap svg{width:${Math.round(SIZE * 0.78)}px;height:auto}
</style></head><body><div id="wrap">${svg}</div></body></html>`

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    transparent: true,
    webPreferences: { offscreen: true },
  })

  let latest = null
  win.webContents.on('paint', (_event, _dirty, image) => {
    latest = image
  })
  win.webContents.setFrameRate(30)

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 1000))

  const image = latest || (await win.webContents.capturePage())
  fs.writeFileSync(outPng, image.toPNG())
  console.log('wrote', outPng, image.getSize())
  app.quit()
})
