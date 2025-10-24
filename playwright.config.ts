import { defineConfig, devices } from '@playwright/test'
import { getEnvironment } from './tests/e2e/setup/environments'

const env = getEnvironment()

/**
 * Playwright E2E Test Configuration for SyncKairos
 *
 * This configuration supports tag-based test execution and environment-specific settings.
 *
 * Usage:
 *   pnpm test:e2e                    # Run all tests against local
 *   pnpm test:e2e --grep @smoke      # Run smoke tests only
 *   E2E_ENV=staging pnpm test:e2e    # Run against staging
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: env.timeout,
  retries: env.retries,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Reporter configuration
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/e2e-html' }],
    ['json', { outputFile: 'test-results/e2e-results.json' }]
  ],

  use: {
    baseURL: env.baseURL,

    // Collect trace on failure for debugging
    trace: 'retain-on-failure',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // Maximum time each action such as `click()` can take
    actionTimeout: 10000
  },

  // Test projects for different test types
  projects: [
    {
      name: 'critical',
      grep: /@critical/,
      retries: 1,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'smoke',
      grep: /@smoke/,
      retries: 1,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'comprehensive',
      grep: /@comprehensive/,
      retries: 2,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'websocket',
      grep: /@websocket/,
      retries: 2,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'api',
      grep: /@api/,
      retries: 2,
      use: { ...devices['Desktop Chrome'] }
    }
  ],

  // Run tests in parallel
  workers: process.env.CI ? 2 : 4,

  // Limit the number of failures before stopping
  maxFailures: process.env.CI ? 10 : undefined
})
