import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// The web UI lives in src/web. In development, API calls go to the local
// sfbench server started with `npm run dev:server` (see docs/design.md).
// The server accepts the Vite dev server only as http://localhost:5173,
// so the host and port are fixed here.
export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  define: {
    __SFBENCH_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:17717',
    },
  },
})
