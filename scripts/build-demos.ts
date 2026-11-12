import { copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, '.demo-build')
await build({
  absWorkingDir: root,
  entryPoints: { demo: 'src/demo-entry.tsx' },
  outdir: output,
  bundle: true,
  minify: true,
  target: 'es2022',
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  external: ['/hero.webp'],
  legalComments: 'inline',
})
await copyFile(path.join(root, 'public', 'mark.svg'), path.join(output, 'mark.svg'))
