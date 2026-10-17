import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/** The package directory (holding package.json) of a file under node_modules. */
function packageDir(file: string): string | undefined {
  const at = file.lastIndexOf('/node_modules/')
  if (at === -1) return undefined
  const rest = file.slice(at + '/node_modules/'.length).split('/')
  const name = rest[0].startsWith('@') ? rest.slice(0, 2) : rest.slice(0, 1)
  return join(file.slice(0, at), 'node_modules', ...name)
}

/**
 * Writes licenses.txt next to the bundle: the license of every package whose
 * code ended up in it (docs/web.md "ライブラリ"). Published with the package.
 */
function licenses(): Plugin {
  return {
    name: 'sfbench-licenses',
    apply: 'build',
    generateBundle(_options, bundle) {
      const dirs = new Set<string>()
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const id of chunk.moduleIds) {
          const dir = packageDir(id.replace(/\\/g, '/').replace(/^\0/, ''))
          if (dir && existsSync(join(dir, 'package.json'))) dirs.add(dir)
        }
      }
      const sections = [...dirs]
        .map((dir) => {
          const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string; version: string; license?: string }
          const file = readdirSync(dir).find((f) => /^(license|licence|copying)(\.|$)/i.test(f))
          const text = file ? readFileSync(join(dir, file), 'utf8').trim() : `License: ${pkg.license ?? 'unknown'}`
          return { name: pkg.name, text: `${pkg.name} ${pkg.version}\n\n${text}` }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
      const head = 'sfbench includes the following third-party software in its web interface.'
      this.emitFile({
        type: 'asset',
        fileName: 'licenses.txt',
        source: `${head}\n\n${sections.map((s) => s.text).join(`\n\n${'-'.repeat(72)}\n\n`)}\n`,
      })
    },
  }
}

// The web UI lives in src/web. In development, API calls go to the local
// sfbench server started with `npm run dev:server` (see docs/design.md).
// The server accepts the Vite dev server only as http://localhost:5173,
// so the host and port are fixed here.
export default defineConfig({
  root: 'src/web',
  plugins: [react(), licenses()],
  define: {
    __SFBENCH_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    // Served from the local machine, so one large bundle (mostly the SOQL
    // parser and CodeMirror) costs nothing worth splitting for.
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      // The object form keeps the Host header (localhost:5173), which the
      // server checks against the Origin. The string shorthand would set
      // changeOrigin and send Host 127.0.0.1:17717 instead.
      '/api/': { target: 'http://127.0.0.1:17717', changeOrigin: false },
    },
  },
})
