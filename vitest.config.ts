import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  define: {
    __SFBENCH_VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // Component tests opt in with `// @vitest-environment jsdom`.
    environment: 'node',
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
})
