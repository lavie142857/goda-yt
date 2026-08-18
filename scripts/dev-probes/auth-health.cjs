const { app, safeStorage } = require('electron')
const { spawn } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

const rootDir = path.resolve(__dirname, '..', '..')
const userDataDir = path.join(app.getPath('appData'), 'goda-yt')
app.setPath('userData', userDataDir)

function runYtDlp(cookiesPath) {
  return new Promise((resolve) => {
    const child = spawn(
      path.join(rootDir, 'bin', 'yt-dlp.exe'),
      [
        '--skip-download',
        '--no-playlist',
        '--no-warnings',
        '--cookies', cookiesPath,
        '--js-runtimes', `node:${path.join(rootDir, 'bin', 'node.exe')}`,
        '--sleep-requests', '0.5',
        '--retry-sleep', 'http:exp=1:8',
        '--print', '%(id)s',
        'https://www.youtube.com/watch?v=DbXMjAYSa68',
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )

    let output = ''
    let errorOutput = ''
    const timeout = setTimeout(() => child.kill(), 30000)
    child.stdout.on('data', (chunk) => { output += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { errorOutput += chunk.toString('utf8') })
    child.on('error', (error) => {
      clearTimeout(timeout)
      resolve({ ok: false, message: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve({
        ok: code === 0 && output.includes('DbXMjAYSa68'),
        message: code === 0 ? 'yt-dlp accepted the stored cookies.' : errorOutput.trim().split(/\r?\n/).at(-1),
      })
    })
  })
}

function runPipelineSelfTest(AuthStore) {
  const originalUserData = app.getPath('userData')
  const testRoot = path.join(tmpdir(), `flash-media-auth-probe-${process.pid}`)
  const sourcePath = path.join(testRoot, 'cookies.txt')
  const futureExpiry = Math.floor(Date.now() / 1000) + 3600

  try {
    mkdirSync(testRoot, { recursive: true })
    app.setPath('userData', testRoot)
    writeFileSync(
      sourcePath,
      `# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t${futureExpiry}\tLOGIN_INFO\tdiagnostic-value\n`,
      'utf8',
    )
    const testStore = new AuthStore()
    const imported = testStore.importCookiesFile(sourcePath)
    const handle = testStore.materializeCookies()
    const materialized = Boolean(handle && readFileSync(handle.path, 'utf8').includes('diagnostic-value'))
    handle?.cleanup()
    return imported && materialized
  } catch {
    return false
  } finally {
    app.setPath('userData', originalUserData)
    rmSync(testRoot, { recursive: true, force: true })
  }
}

app.whenReady().then(async () => {
  const { AuthStore } = require(path.join(rootDir, 'dist-electron', 'services', 'auth-store.js'))
  const authStore = new AuthStore()
  const pipelineSelfTest = runPipelineSelfTest(AuthStore)
  const encryptedPath = path.join(userDataDir, 'cookies.enc')
  let decryptable = false
  let decryptError = null
  if (existsSync(encryptedPath)) {
    try {
      decryptable = Boolean(safeStorage.decryptString(readFileSync(encryptedPath)))
    } catch (error) {
      decryptError = error instanceof Error ? error.message : String(error)
    }
  }
  const handle = authStore.materializeCookies()

  if (!handle) {
    console.log(JSON.stringify({ pipelineSelfTest, decryptable, decryptError, usableCookies: false, onlineProbe: false, message: 'No unexpired login cookies are stored.' }))
    app.quit()
    return
  }

  try {
    const result = await runYtDlp(handle.path)
    console.log(JSON.stringify({ pipelineSelfTest, decryptable, usableCookies: true, onlineProbe: result.ok, message: result.message }))
  } finally {
    handle.cleanup()
    app.quit()
  }
})
