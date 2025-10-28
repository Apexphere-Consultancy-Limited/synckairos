import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false, // Allow tests within a file to run in parallel
      },
    },
    // Run test FILES sequentially to avoid cross-file race conditions
    fileParallelism: false,
    // Exclude performance tests from default test runs
    // Performance tests should be run explicitly via `pnpm test:performance`
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/performance/**'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
