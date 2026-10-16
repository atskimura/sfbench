import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * `npm run dev` (mode "with-server"): starts the local server of
 * `npm run dev:server` along with Vite, and stops it with Vite.
 */
function localServer(): Plugin {
  let child: ChildProcess | undefined
  const stop = () => child?.kill()
  return {
    name: 'sfbench-local-server',
    apply: 'serve',
    configureServer(server) {
      child = spawn(process.execPath, ['--use-env-proxy', '--watch', 'src/server/cli.ts', '--dev'], { stdio: 'inherit' })
      server.httpServer?.once('close', stop)
      process.once('exit', stop)
    },
  }
}

// The web UI lives in src/web. In development, API calls go to the local
// sfbench server started with `npm run dev:server` (see docs/design.md).
// The server accepts the Vite dev server only as http://localhost:5173,
// so the host and port are fixed here.
export default defineConfig(({ mode }) => ({
  root: 'src/web',
  plugins: mode === 'with-server' ? [react(), localServer()] : [react()],
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
      // Only the server's API: src/web/api/client.ts is also served as /api/client.ts.
      // Keep the Host header (localhost:5173): the server checks it against the Origin.
      '^/api/(?!.*\\.tsx?(\\?.*)?$)': { target: 'http://127.0.0.1:17717', changeOrigin: false },
    },
  },
}))
