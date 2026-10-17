import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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
    // In development, serve the file of the last `npm run build`, if any.
    configureServer(server) {
      server.middlewares.use('/licenses.txt', (_req, res) => {
        const built = new URL('./dist/web/licenses.txt', import.meta.url)
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        if (existsSync(built)) res.end(readFileSync(built))
        else {
          res.statusCode = 404
          res.end('licenses.txt is written by `npm run build`.')
        }
      })
    },
    generateBundle(_options, bundle) {
      const dirs = new Set<string>()
      const add = (id: string) => {
        const dir = packageDir(id.replace(/\\/g, '/').replace(/^\0/, ''))
        if (dir && existsSync(join(dir, 'package.json'))) dirs.add(dir)
      }
      for (const output of Object.values(bundle)) {
        if (output.type === 'asset') {
          // Stylesheets, fonts and images copied from packages.
          for (const file of (output as { originalFileNames?: string[] }).originalFileNames ?? []) add(file)
          continue
        }
        for (const id of output.moduleIds) {
          // Modules with code left after tree shaking; CSS goes to the stylesheet instead.
          if (output.modules[id]?.renderedLength || /\.css(\?|$)/.test(id)) add(id)
        }
      }
      const sections = [...dirs]
        .map((dir) => {
          const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string; version: string }
          // LICENSE, LICENSE.md, LICENSE-MIT, COPYING, and NOTICE (which Apache-2.0 requires to be passed on).
          const files = readdirSync(dir)
            .filter((f) => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(f))
            .filter((f) => statSync(join(dir, f)).isFile())
          // Most licenses (MIT among them) require their text and copyright notice to be included.
          if (files.length === 0) this.error(`${pkg.name} has no license file to include in licenses.txt`)
          const text = files.map((f) => readFileSync(join(dir, f), 'utf8').trim()).join('\n\n')
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
