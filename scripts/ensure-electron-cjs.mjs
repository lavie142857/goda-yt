import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const outDir = path.resolve(process.cwd(), 'dist-electron')
const markerFile = path.join(outDir, 'package.json')

await mkdir(outDir, { recursive: true })
await writeFile(markerFile, '{"type":"commonjs"}\n', 'utf8')
