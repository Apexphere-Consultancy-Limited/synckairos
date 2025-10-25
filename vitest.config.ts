import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false, // Enable parallel execution for isolated tests
      },
    },
    // Run tests in parallel by default
    fileParallelism: true,
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
