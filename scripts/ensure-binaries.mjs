import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptsDir, '..')
const binDir = path.join(rootDir, 'bin')
const cacheDir = path.join(rootDir, '.cache', 'flash-media-binaries')
const manifest = JSON.parse(
  await import('node:fs/promises').then(({ readFile }) =>
    readFile(path.join(scriptsDir, 'binaries.manifest.json'), 'utf8'),
  ),
)

async function sha256(filePath) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}

async function matches(filePath, expectedHash) {
  try {
    return (await sha256(filePath)) === expectedHash.toLowerCase()
  } catch {
    return false
  }
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}): ${url}`)
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
}

async function findFile(directory, fileName) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
      return entryPath
    }
    if (entry.isDirectory()) {
      const nested = await findFile(entryPath, fileName)
      if (nested) return nested
    }
  }
  return null
}

function expandZip(archivePath, destination) {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
      archivePath,
      destination,
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Could not extract binary archive.')
  }
}

async function installBinary(fileName, descriptor) {
  const targetPath = path.join(binDir, fileName)
  if (await matches(targetPath, descriptor.sha256)) {
    console.log(`[binaries] ${fileName} ${descriptor.version}: verified`)
    return
  }

  const workDir = path.join(cacheDir, fileName.replace(/\.exe$/i, ''))
  const downloadPath = path.join(workDir, descriptor.kind === 'zip' ? 'download.zip' : 'download.exe')
  const stagedPath = path.join(workDir, `${fileName}.verified`)
  await rm(workDir, { recursive: true, force: true })
  await mkdir(workDir, { recursive: true })

  console.log(`[binaries] ${fileName} ${descriptor.version}: downloading`)
  await download(descriptor.url, downloadPath)

  let sourcePath = downloadPath
  if (descriptor.kind === 'zip') {
    const extractedDir = path.join(workDir, 'extracted')
    await mkdir(extractedDir, { recursive: true })
    expandZip(downloadPath, extractedDir)
    sourcePath = await findFile(extractedDir, descriptor.archiveMember)
    if (!sourcePath) {
      throw new Error(`${descriptor.archiveMember} was not found in ${descriptor.url}`)
    }
  }

  if (!(await matches(sourcePath, descriptor.sha256))) {
    const actual = await sha256(sourcePath)
    throw new Error(`Checksum mismatch for ${fileName}: expected ${descriptor.sha256}, got ${actual}`)
  }

  await copyFile(sourcePath, stagedPath)
  await mkdir(binDir, { recursive: true })
  await rm(targetPath, { force: true })
  await rename(stagedPath, targetPath)

  const installed = await stat(targetPath)
  if (!installed.isFile() || !(await matches(targetPath, descriptor.sha256))) {
    throw new Error(`Verification failed after installing ${fileName}`)
  }
  console.log(`[binaries] ${fileName} ${descriptor.version}: installed and verified`)
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('FLASH MEDIA packaging currently supports Windows x64 only.')
}

await mkdir(binDir, { recursive: true })
await mkdir(cacheDir, { recursive: true })

for (const [fileName, descriptor] of Object.entries(manifest)) {
  await installBinary(fileName, descriptor)
}
