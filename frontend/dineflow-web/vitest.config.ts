import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    // Node 22+ exposes an experimental `localStorage` global that shadows the one jsdom installs,
    // leaving it undefined in tests. Disabling it in the worker keeps `npm test` deterministic on
    // whichever Node the developer or CI happens to be running, without a shell-specific
    // NODE_OPTIONS that would not work on Windows.
    pool: 'forks',
    execArgv: ['--no-experimental-webstorage'],
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
