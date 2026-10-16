import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The web UI lives in src/web. In development, API calls go to the local
// sfbench server started with `npm run dev:server`.
export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:7717',
    },
  },
})
