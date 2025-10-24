/**
 * E2E Test Environment Configuration
 *
 * This module provides environment-specific configuration for E2E tests.
 * Tests use the same code but different baseURL and configuration based on environment.
 *
 * Usage:
 *   const env = getEnvironment()
 *   await request.post(`${env.baseURL}/v1/sessions`, ...)
 */

export interface Environment {
  baseURL: string
  wsURL: string
  timeout: number
  retries: number
}

export const environments: Record<string, Environment> = {
  local: {
    baseURL: 'http://localhost:3000',
    wsURL: 'ws://localhost:3000/ws',
    timeout: 30000, // 30 seconds
    retries: 2
  },
  staging: {
    baseURL: 'https://synckairos-staging.fly.dev',
    wsURL: 'wss://synckairos-staging.fly.dev/ws',
    timeout: 60000, // 60 seconds
    retries: 3
  },
  production: {
    baseURL: 'https://synckairos-production.fly.dev',
    wsURL: 'wss://synckairos-production.fly.dev/ws',
    timeout: 60000, // 60 seconds
    retries: 1 // Don't retry on prod - fail fast
  }
}

/**
 * Get the current environment configuration based on E2E_ENV environment variable.
 * Defaults to 'local' if not specified.
 */
export function getEnvironment(): Environment {
  const env = process.env.E2E_ENV || 'local'

  if (!(env in environments)) {
    throw new Error(
      `Invalid E2E_ENV: ${env}. Valid values: ${Object.keys(environments).join(', ')}`
    )
  }

  return environments[env]
}
